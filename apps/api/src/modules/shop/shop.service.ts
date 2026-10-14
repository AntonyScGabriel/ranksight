import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import {
  DEFAULT_SHOP_PRODUCTS, DEFAULT_SHOP_PROMO, ShopProduct, ShopPromo, formatPrice, isPromoRunning, vipPriceCents,
  type GiftChoice, type PromoInfoDto, type PurchaseDto, type ShopCatalogDto, type ShopDto, type ShopSettingsDto, type ShopSettingsInput, type VipProductId,
} from "@ranksight/shared";
import { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { escapeHtml } from "../auth/mfa.service.js";
import { MailService } from "../mail/mail.service.js";
import { PushService } from "../notifications/notifications.module.js";
import { GiftsService } from "./gifts.service.js";
import { GooglePlayError, GooglePlayService } from "./google-play.service.js";
import { StripeService, type CheckoutSession, type StripeCharge, type StripeEvent } from "./stripe.service.js";
import { extendVip, isVip, vipSelect, vipStatus } from "./vip.js";
import { assertCanManage } from "../../common/staff-policy.js";

const DAY_MS = 86_400_000;
/** Dernière vérification des remboursements Google Play (Google conserve 30 jours d'historique) */
const VOIDED_CURSOR_KEY = "shop:gplay:voided-since";

type PaidPurchase = {
  id: string; userId: string; product: string; days: number; amountCents: number; withdrawalWaivedAt: Date | null; orderId: string | null;
  giftType?: "FRIEND" | "CODE" | null; recipientId?: string | null;
};
/** Résultat de la livraison d'un achat : pour soi, offert à un ami ou code cadeau créé */
type Delivery = { until: Date | null; recipient: { id: string; displayName: string; email: string | null } | null; code: string | null };

const SETTINGS_KEY = "shop";
const SETTINGS_CACHE_MS = 10_000;

/**
 * Boutique VIP. Un pass VIP est un achat unique (pas de renouvellement automatique) qui prolonge le statut VIP
 * de N jours : acheté pendant un VIP en cours, il s'ajoute à la date de fin.
 * Deux moyens de paiement : Stripe sur le site, Google Play Billing dans l'application Android.
 * Un paiement est crédité une seule fois (identifiant de session Stripe ou jeton d'achat Google unique en base),
 * quel que soit le nombre de confirmations reçues.
 */
@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly googlePlay: GooglePlayService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly gifts: GiftsService,
    private readonly push: PushService,
  ) {}

  private settingsCache: { value: ShopSettingsDto; at: number } | null = null;

  /**
   * Réglages de la boutique (page « Boutique » de l'administration) : promo du moment et passes (nom, durée, prix,
   * prix promo, étiquette, mise en vente). Sans réglage enregistré : catalogue par défaut et « Offre de lancement ».
   * Les réglages enregistrés avant l'arrivée de la promo du moment (offre de lancement) sont repris tels quels.
   */
  async settings(): Promise<ShopSettingsDto> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < SETTINGS_CACHE_MS) return this.settingsCache.value;
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as { promo?: unknown; launchOffer?: boolean; products?: unknown };
    const legacyProducts = Array.isArray(stored.products)
      ? stored.products.map((p: Record<string, unknown>) => ("launchPriceCents" in p && !("promoPriceCents" in p) ? { ...p, promoPriceCents: p.launchPriceCents } : p))
      : stored.products;
    const saved = z.array(ShopProduct).safeParse(legacyProducts);
    const products = DEFAULT_SHOP_PRODUCTS.map((d) => (saved.success ? saved.data.find((p) => p.id === d.id) : undefined) ?? d);
    const promoSaved = ShopPromo.safeParse(stored.promo);
    const promo = promoSaved.success
      ? promoSaved.data
      : { ...DEFAULT_SHOP_PROMO, active: stored.launchOffer ?? DEFAULT_SHOP_PROMO.active };
    const value = { promo, products };
    this.settingsCache = { value, at: Date.now() };
    return value;
  }

  /** Promo en cours (active et pas terminée) : nom et date de fin, sinon null */
  async runningPromo(): Promise<PromoInfoDto> {
    const { promo } = await this.settings();
    return isPromoRunning(promo) ? { label: promo.label, endsAt: promo.endsAt } : null;
  }

  private async product(id: VipProductId) {
    return (await this.settings()).products.find((p) => p.id === id)!;
  }

  /** Prix à payer maintenant pour ce pass (prix promo pendant une promo en cours) */
  private async currentPrice(product: ShopProduct) {
    return vipPriceCents(product, (await this.runningPromo()) !== null);
  }

  async updateSettings(actorId: string, input: ShopSettingsInput) {
    if (input.promo.active && input.promo.endsAt && new Date(input.promo.endsAt) <= new Date()) {
      throw new BadRequestException({ code: "PROMO_ENDED", message: "La date de fin de la promo est déjà passée." });
    }
    const current = await this.settings();
    const value: ShopSettingsDto = {
      promo: { ...input.promo, endsAt: input.promo.endsAt ? new Date(input.promo.endsAt).toISOString() : null },
      products: input.products ? DEFAULT_SHOP_PRODUCTS.map((d) => input.products!.find((p) => p.id === d.id)!) : current.products,
    };
    await this.prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value, updatedById: actorId },
      update: { value, updatedById: actorId },
    });
    this.settingsCache = { value, at: Date.now() };
    if (JSON.stringify(value.promo) !== JSON.stringify(current.promo)) {
      await this.audit.log(actorId, "shop.promo", "app_setting", SETTINGS_KEY, { from: current.promo, to: value.promo });
    }
    if (input.products) {
      // Journal : uniquement ce qui a changé, pass par pass
      const changes = value.products.flatMap((p) => {
        const before = current.products.find((c) => c.id === p.id)!;
        const diff = (Object.keys(p) as (keyof ShopProduct)[]).filter((k) => p[k] !== before[k]);
        return diff.length ? [{ id: p.id, ...Object.fromEntries(diff.map((k) => [k, { from: before[k], to: p[k] }])) }] : [];
      });
      if (changes.length) await this.audit.log(actorId, "shop.products", "app_setting", SETTINGS_KEY, { changes });
    }
    return value;
  }

  /** Prix publics (conditions générales de vente) : passes en vente uniquement */
  async catalog(): Promise<ShopCatalogDto> {
    const [{ products }, promo] = await Promise.all([this.settings(), this.runningPromo()]);
    return {
      promo,
      products: products.filter((p) => p.active).map(({ id, name, days, priceCents, promoPriceCents }) => ({ id, name, days, priceCents, promoPriceCents })),
    };
  }

  async overview(userId: string): Promise<ShopDto> {
    const [user, { products }, promo] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: vipSelect }),
      this.settings(),
      this.runningPromo(),
    ]);
    return {
      products: products.filter((p) => p.active).map((p) => ({
        id: p.id, name: p.name, days: p.days, highlight: p.highlight || null, priceCents: vipPriceCents(p, promo !== null), regularPriceCents: p.priceCents,
      })),
      promo,
      paymentsEnabled: this.stripe.enabled,
      googlePlayEnabled: this.googlePlay.enabled,
      vip: vipStatus(user.subscription),
    };
  }

  async checkout(userId: string, productId: VipProductId, gift?: GiftChoice) {
    const product = await this.product(productId);
    if (!product.active) throw new BadRequestException({ code: "PRODUCT_UNAVAILABLE", message: "Ce pass n'est plus proposé. Recharge la boutique." });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const recipient = gift?.type === "friend" ? await this.giftRecipient(userId, gift.friendId) : null;
    const amountCents = await this.currentPrice(product);
    const session = await this.stripe.createCheckout({
      userId,
      email: user.email,
      productId: product.id,
      name: gift ? `${product.name} à offrir${recipient ? ` à ${recipient.displayName}` : " (code cadeau)"}` : product.name,
      amountCents,
      successUrl: `${env().WEB_URL}/shop?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${env().WEB_URL}/shop?cancelled=1`,
    });
    await this.prisma.purchase.create({
      data: {
        userId, product: product.id, days: product.days, amountCents, provider: "STRIPE", externalId: session.id,
        giftType: gift ? (gift.type === "friend" ? "FRIEND" : "CODE") : null,
        recipientId: recipient?.id ?? null,
        // Case cochée avant le paiement : exécution immédiate demandée, renonciation au droit de rétractation (art. L221-28 13°)
        withdrawalWaivedAt: new Date(),
      },
    });
    return { url: session.url, sessionId: session.id };
  }

  /** Un pass ne s'offre qu'à un ami (amitié acceptée, compte actif, aucun blocage entre les deux) */
  private async giftRecipient(userId: string, friendId: string) {
    if (friendId === userId) throw new BadRequestException("Pour toi-même, choisis « Acheter ».");
    const [a, b] = [userId, friendId].sort();
    const [friendship, friend, blocked] = await Promise.all([
      this.prisma.friendship.findFirst({
        where: { status: "ACCEPTED", OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
        select: { status: true },
      }),
      this.prisma.user.findUnique({ where: { id: friendId }, select: { id: true, displayName: true, status: true } }),
      this.prisma.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: friendId }, { blockerId: friendId, blockedId: userId }] } }),
    ]);
    if (!friendship || !friend || friend.status !== "ACTIVE" || blocked) {
      throw new BadRequestException({ code: "GIFT_NOT_FRIEND", message: "Tu peux offrir le VIP seulement à un joueur de ta liste d'amis." });
    }
    return friend;
  }

  /** Retour du joueur après le paiement : vérifie la session auprès de Stripe et crédite le VIP si elle est payée. */
  async confirm(userId: string, sessionId: string) {
    const purchase = await this.prisma.purchase.findUnique({ where: { externalId: sessionId } });
    if (!purchase || purchase.userId !== userId) throw new NotFoundException("Achat introuvable.");
    if (purchase.status === "PENDING") {
      const session = await this.stripe.getCheckout(sessionId);
      if (session.payment_status === "paid") await this.fulfil(sessionId);
      else if (session.status === "expired") await this.prisma.purchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
    }
    const [updated, user] = await Promise.all([
      this.prisma.purchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: { recipient: { select: { displayName: true } }, giftCode: { select: { codeEnc: true } } },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: vipSelect }),
    ]);
    return {
      status: updated.status,
      vip: vipStatus(user.subscription),
      // Pass offert : à qui il a été livré, ou le code à transmettre
      gift: updated.giftType
        ? { to: updated.giftType === "FRIEND" && !updated.giftCode ? (updated.recipient?.displayName ?? null) : null, code: updated.giftCode ? this.gifts.readable(updated.giftCode.codeEnc) : null }
        : null,
    };
  }

  /**
   * Notifications de Stripe : paiement terminé (y compris si le joueur a fermé la page avant le retour), paiement
   * échoué ou session expirée, remboursement total depuis le tableau de bord Stripe (jours de VIP retirés).
   */
  async webhook(event: StripeEvent) {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as CheckoutSession;
        if (session.payment_status === "paid") await this.fulfil(session.id);
        return;
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as CheckoutSession;
        await this.prisma.purchase.updateMany({ where: { externalId: session.id, status: "PENDING" }, data: { status: "FAILED" } });
        return;
      }
      case "charge.refunded": {
        const charge = event.data.object as StripeCharge;
        // Remboursement partiel : le VIP est conservé (geste commercial), seul un remboursement total retire les jours
        if (!charge.payment_intent || charge.amount_refunded < charge.amount) return;
        const session = await this.stripe.checkoutForPaymentIntent(charge.payment_intent);
        const purchase = session ? await this.prisma.purchase.findUnique({ where: { externalId: session.id } }) : null;
        if (purchase?.provider === "STRIPE" && (await this.refund(purchase.id, "stripe"))) {
          this.logger.log(`Stripe : achat ${purchase.id} remboursé, VIP ajusté`);
        }
        return;
      }
    }
  }

  // ---------- Google Play (application Android) ----------

  /**
   * Achat fait dans l'application Android : le jeton est vérifié auprès de Google (jamais sur la seule parole de l'application),
   * le VIP est crédité une seule fois, puis l'achat est consommé pour que le pass puisse être racheté plus tard.
   * Rappelée sans risque (relance de l'application, réseau coupé) : un jeton déjà crédité n'est jamais recompté.
   */
  async googlePlayPurchase(userId: string, productId: VipProductId, purchaseToken: string) {
    // Achat déjà payé à Google : crédité même si le pass vient d'être retiré de la vente
    const product = await this.product(productId);
    const existing = await this.prisma.purchase.findUnique({ where: { externalId: purchaseToken } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException({ code: "PURCHASE_OTHER_ACCOUNT", message: "Cet achat est déjà associé à un autre compte RankGuess." });
    }
    if (existing && existing.status !== "PENDING") {
      if (existing.status === "PAID") await this.consumeQuietly(productId, purchaseToken);
      return this.googleResult(userId, existing.status);
    }

    let gp;
    try {
      gp = await this.googlePlay.getProductPurchase(productId, purchaseToken);
    } catch (e) {
      if (e instanceof GooglePlayError && (e.status === 400 || e.status === 404 || e.status === 410)) {
        throw new BadRequestException({ code: "PURCHASE_NOT_FOUND", message: "Achat introuvable sur Google Play." });
      }
      throw e;
    }
    // L'application transmet l'identifiant du compte à Google au moment de l'achat : un jeton d'un autre compte est refusé
    if (gp.obfuscatedExternalAccountId && gp.obfuscatedExternalAccountId !== userId) {
      throw new ForbiddenException({ code: "PURCHASE_OTHER_ACCOUNT", message: "Cet achat a été fait depuis un autre compte RankGuess." });
    }
    if (gp.purchaseState === 2) return this.googleResult(userId, "PENDING");
    if (gp.purchaseState !== 0) return this.googleResult(userId, "FAILED");

    const quantity = Math.max(1, gp.quantity ?? 1);
    const isTest = gp.purchaseType === 0;
    let credited: { purchase: PaidPurchase; until: Date } | null = null;
    try {
      credited = await this.prisma.$transaction(async (tx) => {
        const purchase = await tx.purchase.create({
          data: {
            userId, product: product.id, days: product.days * quantity,
            // Achat de test (comptes testeurs de la Play Console) : aucun montant réellement payé
            amountCents: isTest ? 0 : (await this.currentPrice(product)) * quantity,
            provider: "GOOGLE_PLAY", externalId: purchaseToken, orderId: gp.orderId ?? null,
            status: "PAID", paidAt: new Date(),
            // Confirmation affichée avant l'ouverture du paiement Google Play
            withdrawalWaivedAt: new Date(),
          },
        });
        const until = await extendVip(tx, userId, purchase.days, "GOOGLE_PLAY", product.id);
        return { purchase, until };
      });
    } catch (e) {
      // Deux confirmations simultanées du même achat : la seconde trouve l'achat déjà crédité
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    if (credited) {
      this.logger.log(`VIP ${product.id} crédité pour ${userId} (Google Play${isTest ? ", achat de test" : ""})`);
      await this.sendConfirmation(credited.purchase, credited.until, "GOOGLE_PLAY");
    }
    if (gp.consumptionState === 0) await this.consumeQuietly(productId, purchaseToken);
    return this.googleResult(userId, "PAID");
  }

  /** La consommation est retentée à la prochaine confirmation si Google ne répond pas : le VIP reste crédité. */
  private async consumeQuietly(productId: string, purchaseToken: string) {
    try {
      await this.googlePlay.consume(productId, purchaseToken);
    } catch (e) {
      this.logger.warn(`Consommation Google Play différée : ${(e as Error).message}`);
    }
  }

  private async googleResult(userId: string, status: "PENDING" | "PAID" | "FAILED" | "REFUNDED") {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: vipSelect });
    return { status, vip: vipStatus(user.subscription) };
  }

  /** Toutes les heures : les achats Google Play remboursés ou annulés retirent les jours de VIP correspondants. */
  @Cron("17 * * * *", { timeZone: "UTC" })
  async syncGoogleRefunds() {
    if (!this.googlePlay.enabled) return 0;
    if (!(await this.redis.set("shop:gplay:voided-lock", "1", "EX", 900, "NX"))) return 0;
    try {
      const startedAt = Date.now();
      const saved = Number(await this.redis.get(VOIDED_CURSOR_KEY));
      // Léger chevauchement entre deux passages : un achat déjà remboursé n'est jamais retraité
      const since = new Date(Math.max(saved ? saved - 3_600_000 : 0, startedAt - 30 * DAY_MS));
      const voided = await this.googlePlay.voidedSince(since);
      let refunded = 0;
      for (const v of voided) {
        const purchase = await this.prisma.purchase.findUnique({ where: { externalId: v.purchaseToken }, select: { id: true, provider: true } });
        if (purchase?.provider === "GOOGLE_PLAY" && (await this.refund(purchase.id, "google_play"))) refunded++;
      }
      await this.redis.set(VOIDED_CURSOR_KEY, String(startedAt));
      if (refunded) this.logger.log(`Google Play : ${refunded} achat(s) remboursé(s), VIP ajusté`);
      return refunded;
    } catch (e) {
      this.logger.error(`Remboursements Google Play non synchronisés : ${(e as Error).message}`);
      return 0;
    } finally {
      await this.redis.del("shop:gplay:voided-lock");
    }
  }

  /** Remboursement : l'achat passe en REFUNDED (une seule fois) et ses jours sont retirés du VIP. */
  private async refund(purchaseId: string, source: string) {
    const purchase = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.purchase.updateMany({ where: { id: purchaseId, status: "PAID" }, data: { status: "REFUNDED", refundedAt: new Date() } });
      if (count === 0) return null;
      const p = await tx.purchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: { giftCode: { select: { id: true, redemptions: { select: { userId: true } } } } },
      });
      // Qui a reçu les jours : l'acheteur, l'ami à qui le pass a été offert, ou le joueur qui a utilisé le code
      let holders: string[] = [p.userId];
      if (p.giftCode) {
        await tx.giftCode.update({ where: { id: p.giftCode.id }, data: { disabledAt: new Date() } });
        holders = p.giftCode.redemptions.map((r) => r.userId);
      } else if (p.giftType === "FRIEND") {
        holders = p.recipientId ? [p.recipientId] : [];
      }
      const now = new Date();
      for (const userId of holders) {
        const sub = await tx.subscription.findUnique({ where: { userId } });
        if (!sub) continue;
        const end = new Date(Math.max(now.getTime(), sub.currentPeriodEnd.getTime() - p.days * DAY_MS));
        await tx.subscription.update({ where: { userId }, data: { currentPeriodEnd: end, ...(end <= now ? { status: "EXPIRED" } : {}) } });
      }
      return p;
    });
    if (purchase) await this.audit.log(purchase.userId, "vip.refund", "purchase", purchase.id, { source, days: purchase.days }, { targetUserId: purchase.userId });
    return !!purchase;
  }

  /**
   * Livre un achat payé : VIP pour l'acheteur, pour l'ami à qui il est offert, ou code cadeau créé.
   * Le passage PENDING → PAID est atomique : un achat n'est jamais livré deux fois.
   */
  private async fulfil(sessionId: string) {
    const credited = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { externalId: sessionId } });
      if (!purchase) return null;
      const { count } = await tx.purchase.updateMany({ where: { id: purchase.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
      if (count === 0) return null;
      const delivery: Delivery = { until: null, recipient: null, code: null };
      const recipient = purchase.giftType === "FRIEND" && purchase.recipientId
        ? await tx.user.findFirst({ where: { id: purchase.recipientId, status: "ACTIVE" }, select: { id: true, displayName: true, email: true } })
        : null;
      if (recipient) {
        delivery.recipient = recipient;
        delivery.until = await extendVip(tx, recipient.id, purchase.days, "STRIPE", purchase.product);
      } else if (purchase.giftType) {
        // Code cadeau demandé, ou ami dont le compte n'existe plus entre-temps : l'acheteur reçoit un code à transmettre
        if (purchase.giftType === "FRIEND") await tx.purchase.update({ where: { id: purchase.id }, data: { giftType: "CODE", recipientId: null } });
        delivery.code = await this.gifts.create(tx, { days: purchase.days, purchaseId: purchase.id });
      } else {
        delivery.until = await extendVip(tx, purchase.userId, purchase.days, "STRIPE", purchase.product);
      }
      this.logger.log(`VIP ${purchase.product} livré (${purchase.giftType ?? "pour soi"}) pour l'achat ${purchase.id}`);
      return { purchase, delivery };
    });
    if (!credited) return;
    await this.sendConfirmation(credited.purchase, credited.delivery.until, "STRIPE", credited.delivery);
    if (credited.delivery.recipient) await this.notifyRecipient(credited.purchase, credited.delivery.recipient, credited.delivery.until!);
  }

  /** L'ami reçoit une notification et un email : « X t'a offert N jours de VIP » */
  private async notifyRecipient(p: PaidPurchase, recipient: NonNullable<Delivery["recipient"]>, until: Date) {
    const buyer = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { displayName: true } });
    const from = buyer?.displayName ?? "Un ami";
    const end = until.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    await this.push.toUsers([recipient.id], { title: "Cadeau !", body: `${from} t'a offert ${p.days} jours de VIP.`, data: { url: "shop" } });
    if (!recipient.email) return;
    const text = `${from} t'a offert ${p.days} jours de VIP sur RankGuess ! Ton VIP est actif jusqu'au ${end}.`;
    await this.mail.send({
      to: recipient.email,
      subject: `${from} t'a offert le VIP RankGuess`,
      text: `Bonjour ${recipient.displayName},\n\n${text}\n\nBon jeu,\nL'équipe RankGuess`,
      html: `<p>Bonjour ${escapeHtml(recipient.displayName)},</p><p>${escapeHtml(text)}</p><p>Bon jeu,<br>L'équipe RankGuess</p>`,
    });
  }

  /** Confirmation de commande sur un support durable (email), exigée pour une vente à distance. */
  private async sendConfirmation(
    p: PaidPurchase,
    until: Date | null,
    provider: "STRIPE" | "GOOGLE_PLAY",
    delivery?: Delivery,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { email: true, displayName: true } });
    if (!user?.email) return;
    const name = (await this.settings()).products.find((v) => v.id === p.product)?.name ?? "Pass VIP";
    const end = until?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
    const outcome = delivery?.recipient
      ? `Pass offert à ${delivery.recipient.displayName} : son VIP est actif jusqu'au ${end}. Il a été prévenu.`
      : delivery?.code
        ? `Ton code cadeau : ${delivery.code} (${p.days} jours de VIP, sans date limite). Il s'utilise sur ${env().WEB_URL}/shop?code=${delivery.code}, et reste visible dans « Mes achats ».`
        : `Ton VIP est actif jusqu'au ${end}.`;
    const lines = [
      `Commande n° ${p.id}${p.orderId ? ` (Google Play : ${p.orderId})` : ""}`,
      provider === "GOOGLE_PLAY"
        ? `${name} (${p.days} jours) : paiement unique via Google Play, sans abonnement. Le montant exact figure sur le reçu envoyé par Google.`
        : `${name} (${p.days} jours) : ${formatPrice(p.amountCents)} TTC, paiement unique, sans abonnement.`,
      outcome,
      p.withdrawalWaivedAt
        ? "Tu as demandé l'accès immédiat au VIP et reconnu perdre ton droit de rétractation une fois le VIP activé (article L221-28 13° du Code de la consommation)."
        : "",
      `Conditions générales de vente : ${env().WEB_URL}/legal/cgv`,
    ].filter(Boolean);
    await this.mail.send({
      to: user.email,
      subject: "Confirmation de ton achat RankGuess",
      text: `Bonjour ${user.displayName},\n\nMerci pour ton achat !\n\n${lines.join("\n")}\n\nL'équipe RankGuess`,
      html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>Merci pour ton achat !</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p>L'équipe RankGuess</p>`,
    });
  }

  async purchases(userId: string): Promise<PurchaseDto[]> {
    const rows = await this.prisma.purchase.findMany({
      // Ses achats et les passes que ses amis lui ont offerts
      where: { OR: [{ userId }, { recipientId: userId }], status: { not: "PENDING" } },
      include: {
        user: { select: { displayName: true } },
        recipient: { select: { displayName: true } },
        giftCode: { select: { codeEnc: true, uses: true, maxUses: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((p) => p.userId !== userId ? {
      id: p.id, product: p.product, days: p.days, amountCents: 0, status: p.status, gift: true, store: "gift" as const,
      createdAt: p.createdAt.toISOString(), giftTo: null, giftCode: null, redeemedCode: false, giftFrom: p.user.displayName,
    } : {
      id: p.id, product: p.product, days: p.days, amountCents: p.amountCents, status: p.status, giftFrom: null,
      gift: p.provider === "MANUAL", store: p.provider === "GOOGLE_PLAY" ? "google_play" : p.provider === "MANUAL" ? "gift" : "web",
      createdAt: p.createdAt.toISOString(),
      giftTo: p.giftType === "FRIEND" && !p.giftCode ? (p.recipient?.displayName ?? "Joueur supprimé") : null,
      giftCode: p.giftCode ? { code: this.gifts.readable(p.giftCode.codeEnc), used: p.giftCode.uses >= p.giftCode.maxUses } : null,
      redeemedCode: p.product === "gift_code",
    });
  }

  // ---------- Administration ----------

  async grant(actorId: string, userId: string, days: number) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!target || target.status === "DELETED") throw new NotFoundException("Joueur introuvable.");
    const previous = await this.prisma.subscription.findUnique({ where: { userId } });
    const until = await this.prisma.$transaction(async (tx) => {
      await tx.purchase.create({
        data: { userId, product: "manual", days, amountCents: 0, provider: "MANUAL", status: "PAID", paidAt: new Date(), grantedById: actorId },
      });
      return extendVip(tx, userId, days, "MANUAL", "manual");
    });
    await this.audit.log(actorId, "vip.grant", "user", userId, { days }, {
      before: { vipUntil: previous && isVip(previous) ? previous.currentPeriodEnd.toISOString() : null },
      after: { vipUntil: until.toISOString() },
    });
    return { active: true, until: until.toISOString() };
  }

  async revoke(actorId: string, userId: string) {
    await assertCanManage(this.prisma, actorId, userId);
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub || !isVip(sub)) throw new BadRequestException("Ce joueur n'est pas VIP.");
    await this.prisma.subscription.update({ where: { userId }, data: { status: "CANCELED", currentPeriodEnd: new Date() } });
    await this.audit.log(actorId, "vip.revoke", "user", userId, undefined, {
      before: { vipUntil: sub.currentPeriodEnd.toISOString() },
      after: { vipUntil: null },
    });
    return { active: false, until: null };
  }
}
