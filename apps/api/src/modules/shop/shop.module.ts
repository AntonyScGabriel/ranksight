import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { CreateGiftCodesInput, GiftChoice, GooglePlayPurchaseInput, RedeemCodeInput, ShopSettingsInput, VipProductId } from "@ranksight/shared";
import { GiftsService } from "./gifts.service.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { GooglePlayService } from "./google-play.service.js";
import { ShopService } from "./shop.service.js";
import { StripeService } from "./stripe.service.js";

const CheckoutBody = z.object({
  product: VipProductId,
  /** Case obligatoire : accès immédiat demandé et renonciation au droit de rétractation (contenu numérique) */
  waiveWithdrawal: z.literal(true, { error: "Coche la case d'accès immédiat au VIP pour continuer." }),
  /** VIP offert : à un ami (livré dès le paiement) ou sous forme de code à transmettre */
  gift: GiftChoice.optional(),
});
const GrantBody = z.object({ days: z.number().int().min(1).max(3650) });

@Controller("shop")
export class ShopController {
  constructor(private readonly shop: ShopService, private readonly stripe: StripeService, private readonly gifts: GiftsService) {}

  /** GET /v1/shop/catalog — prix publics des passes (conditions générales de vente) */
  @Public()
  @Get("catalog")
  catalog() {
    return this.shop.catalog();
  }

  /** GET /v1/shop — offres VIP, paiement disponible ou non, statut VIP du joueur */
  @Get()
  overview(@CurrentUser() u: AuthUser) {
    return this.shop.overview(u.sub);
  }

  /** POST /v1/shop/checkout — { product } → adresse de la page de paiement Stripe */
  @Post("checkout")
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  checkout(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CheckoutBody)) body: z.infer<typeof CheckoutBody>) {
    return this.shop.checkout(u.sub, body.product, body.gift);
  }

  /** GET /v1/shop/checkout/:sessionId — confirmation au retour du paiement */
  @Get("checkout/:sessionId")
  confirm(@CurrentUser() u: AuthUser, @Param("sessionId") sessionId: string) {
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) throw new BadRequestException("Paiement inconnu.");
    return this.shop.confirm(u.sub, sessionId);
  }

  /** POST /v1/shop/google-play — { product, purchaseToken } : achat fait dans l'application Android, vérifié auprès de Google */
  @Post("google-play")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  googlePlay(@CurrentUser() u: AuthUser, @Body(new ZodPipe(GooglePlayPurchaseInput)) body: GooglePlayPurchaseInput) {
    return this.shop.googlePlayPurchase(u.sub, body.product, body.purchaseToken);
  }

  /** POST /v1/shop/redeem — { code } : utiliser un code cadeau VIP */
  @Post("redeem")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  redeem(@CurrentUser() u: AuthUser, @Body(new ZodPipe(RedeemCodeInput)) body: RedeemCodeInput) {
    return this.gifts.redeem(u.sub, body.code);
  }

  /** GET /v1/shop/purchases — historique des achats et VIP offerts */
  @Get("purchases")
  purchases(@CurrentUser() u: AuthUser) {
    return this.shop.purchases(u.sub);
  }

  /** POST /v1/shop/webhook — notifications signées de Stripe */
  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    const event = this.stripe.verifyWebhook(req.rawBody, signature);
    if (!event) throw new BadRequestException("Signature invalide.");
    await this.shop.webhook(event);
    return { received: true };
  }
}

/** VIP offert ou retiré par un administrateur (journalisé) */
@Controller("admin/users/:id/vip")
@Roles("ADMIN")
export class ShopAdminController {
  constructor(private readonly shop: ShopService) {}

  @Post()
  @HttpCode(200)
  grant(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(GrantBody)) body: z.infer<typeof GrantBody>) {
    return this.shop.grant(u.sub, id, body.days);
  }

  @Delete()
  revoke(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.shop.revoke(u.sub, id);
  }
}

/** Réglages de la boutique et codes cadeaux créés par l'équipe (concours, créateurs de contenu) */
@Controller("admin")
@Roles("ADMIN")
export class ShopSettingsAdminController {
  constructor(private readonly shop: ShopService, private readonly gifts: GiftsService) {}

  /** GET /v1/admin/shop/settings — offre de lancement et passes (nom, durée, prix, étiquette, en vente) */
  @Get("shop/settings")
  settings() {
    return this.shop.settings();
  }

  /** PUT /v1/admin/shop/settings — { launchOffer, products? } */
  @Put("shop/settings")
  updateSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ShopSettingsInput)) body: ShopSettingsInput) {
    return this.shop.updateSettings(u.sub, body);
  }

  @Get("gift-codes")
  async giftCodes() {
    return { items: await this.gifts.list() };
  }

  @Post("gift-codes")
  createGiftCodes(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateGiftCodesInput)) body: z.output<typeof CreateGiftCodesInput>) {
    return this.gifts.createBatch(u.sub, body);
  }

  @Post("gift-codes/:id/disable")
  @HttpCode(204)
  async disableGiftCode(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.gifts.disable(u.sub, id);
  }
}

@Module({
  controllers: [ShopController, ShopAdminController, ShopSettingsAdminController],
  providers: [ShopService, StripeService, GooglePlayService, GiftsService],
})
export class ShopModule {}
