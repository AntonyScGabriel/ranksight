import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PROMO_PLATFORMS, PROMO_REMOVAL_DAYS, PROMO_TERMS_VERSION, type PromoPlatform } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { newServiceToken, PROMO_SCOPE, type ServiceTokenContext } from "./service-token.js";

/** Durée de validité de l'adresse de téléchargement transmise (le temps de télécharger le fichier) */
const VIDEO_URL_TTL_SEC = 900;
const MAX_PAGE = 100;
/** Journaux techniques des appels des jetons : conservés 12 mois (proposition à valider), puis supprimés */
const ACCESS_LOG_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;

/**
 * Clip exploitable pour la promotion :
 * - proposé par un joueur (jamais un clip ajouté par la modération : elle ne peut pas consentir à la place de l'auteur) ;
 * - accepté par la modération (le rang transmis est donc le rang validé), fichier MP4 encore stocké, auteur actif ;
 * - accord de promotion de l'auteur en cours ;
 * - vérifié apte par la modération (voix, identifiants, musique, éléments protégés).
 */
export const promoEligibleWhere = (): Prisma.ClipWhereInput => ({
  source: "COMMUNITY",
  status: "APPROVED",
  reviewedAt: { not: null },
  deletedAt: null,
  fileDeletedAt: null,
  linkProvider: null,
  storageKey: { endsWith: ".mp4" },
  promoConsentAt: { not: null },
  promoReviewStatus: "APPROVED",
  game: { isActive: true },
  uploader: { status: "ACTIVE" },
});

const CLIP_SELECT = {
  id: true,
  storageKey: true,
  durationSec: true,
  reviewedAt: true,
  updatedAt: true,
  promoConsentAt: true,
  promoMuteAudio: true,
  game: { select: { slug: true, name: true } },
  rank: { select: { id: true, name: true, order: true } },
} satisfies Prisma.ClipSelect;

type PromoClipRow = Prisma.ClipGetPayload<{ select: typeof CLIP_SELECT }>;

/** Ce que couvre l'accord : publications organiques des comptes officiels sur ces réseaux seulement */
export const PROMO_USAGE = { organic: true, paidAds: false, platforms: [...PROMO_PLATFORMS] } as const;

@Injectable()
export class PromoService {
  private readonly logger = new Logger("Promo");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Export (jeton de service) ----------

  private log(token: ServiceTokenContext, action: string, clipIds: string[]) {
    return this.prisma.promoAccessLog.create({ data: { tokenId: token.id, action, clipIds } });
  }

  /** Adresse absolue (le stockage local renvoie une adresse relative à l'API) */
  private async videoUrl(key: string) {
    const url = await this.storage.signedReadUrl(key, VIDEO_URL_TTL_SEC);
    return url.startsWith("/") ? env().API_PUBLIC_URL + url : url;
  }

  /** Accord en cours d'un clip : le dernier accord enregistré (version des conditions et date) */
  private lastGrant(clipId: string) {
    return this.prisma.promoConsentEvent.findFirst({ where: { clipId, action: "GRANT" }, orderBy: { createdAt: "desc" } });
  }

  /** Données transmises : aucune donnée personnelle (ni auteur, ni pseudo en jeu, ni preuve, ni note, ni région) */
  private async toDto(c: PromoClipRow) {
    const grant = await this.lastGrant(c.id);
    return {
      id: c.id,
      game: { slug: c.game.slug, name: c.game.name },
      rank: { id: c.rank.id, name: c.rank.name, order: c.rank.order },
      durationSec: c.durationSec,
      approvedAt: c.reviewedAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
      consent: { version: grant?.termsVersion ?? PROMO_TERMS_VERSION, grantedAt: (grant?.createdAt ?? c.promoConsentAt)!.toISOString() },
      usage: PROMO_USAGE,
      audio: !c.promoMuteAudio,
      video: {
        url: await this.videoUrl(c.storageKey),
        contentType: "video/mp4",
        expiresAt: new Date(Date.now() + VIDEO_URL_TTL_SEC * 1000).toISOString(),
      },
    };
  }

  async games(token: ServiceTokenContext) {
    const games = await this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true, ranks: { orderBy: { order: "asc" }, select: { id: true, name: true, tier: true, division: true, order: true, color: true } } },
    });
    await this.log(token, "games", []);
    return { items: games };
  }

  async clips(token: ServiceTokenContext, limit = MAX_PAGE, cursor?: string) {
    const take = Math.min(Math.max(1, limit), MAX_PAGE);
    const rows = await this.prisma.clip.findMany({
      where: { ...promoEligibleWhere(), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: take + 1,
      select: CLIP_SELECT,
    });
    const page = rows.slice(0, take);
    const items = await Promise.all(page.map((c) => this.toDto(c)));
    await this.log(token, "clips", page.map((c) => c.id));
    return { items, nextCursor: rows.length > take ? page[page.length - 1].id : null };
  }

  async clip(token: ServiceTokenContext, id: string) {
    const row = await this.prisma.clip.findFirst({ where: { ...promoEligibleWhere(), id }, select: CLIP_SELECT });
    if (!row) throw new NotFoundException("Clip indisponible pour la promotion.");
    await this.log(token, "clip", [id]);
    return this.toDto(row);
  }

  async status(token: ServiceTokenContext, ids: string[]) {
    const unique = [...new Set(ids)];
    const [eligible, known] = await Promise.all([
      this.prisma.clip.findMany({ where: { ...promoEligibleWhere(), id: { in: unique } }, select: { id: true } }),
      this.prisma.clip.findMany({ where: { id: { in: unique } }, select: { id: true, deletedAt: true, promoConsentAt: true, status: true, promoReviewStatus: true } }),
    ]);
    const ok = new Set(eligible.map((c) => c.id));
    const byId = new Map(known.map((c) => [c.id, c]));
    const reason = (id: string) => {
      const c = byId.get(id);
      if (!c || c.deletedAt) return "supprimé";
      if (!c.promoConsentAt) return "accord de promotion absent ou retiré";
      if (c.status !== "APPROVED") return "plus publié sur RankSight";
      if (c.promoReviewStatus !== "APPROVED") return "non retenu par la modération pour la promotion";
      return "indisponible";
    };
    await this.log(token, "status", unique);
    return { items: unique.map((id) => (ok.has(id) ? { id, available: true, reason: null } : { id, available: false, reason: reason(id) })) };
  }

  /** Utilisation déclarée par l'outil de production, reliée à l'accord en cours ; refusée si l'accord a été retiré */
  async recordUse(token: ServiceTokenContext, id: string, reference: string) {
    const clip = await this.prisma.clip.findFirst({ where: { ...promoEligibleWhere(), id }, select: { id: true, rankId: true } });
    const grant = clip && (await this.lastGrant(id));
    if (!clip || !grant) throw new NotFoundException("Clip indisponible pour la promotion : il ne doit pas être utilisé.");
    const existing = await this.prisma.promoUse.findFirst({ where: { clipId: id, tokenId: token.id, reference } });
    const use =
      existing ??
      (await this.prisma.promoUse.create({
        data: { clipId: id, tokenId: token.id, rankId: clip.rankId, reference, consentEventId: grant.id, consentVersion: grant.termsVersion, consentGrantedAt: grant.createdAt },
      }));
    await this.log(token, "use", [id]);
    return { id: use.id, clipId: id, rankId: use.rankId, consentVersion: use.consentVersion, consentGrantedAt: use.consentGrantedAt.toISOString(), createdAt: use.createdAt.toISOString() };
  }

  private async ownUse(token: ServiceTokenContext, useId: string) {
    const use = await this.prisma.promoUse.findUnique({ where: { id: useId } });
    if (!use || use.tokenId !== token.id) throw new NotFoundException("Utilisation introuvable.");
    return use;
  }

  /** Vidéo produite puis abandonnée sans publication (retrait de l'accord, rejet) : son fichier a été supprimé */
  async discardUse(token: ServiceTokenContext, useId: string) {
    const use = await this.ownUse(token, useId);
    if (await this.prisma.promoPublication.count({ where: { useId } })) throw new ConflictException("Cette vidéo a déjà été publiée.");
    const updated = use.discardedAt ? use : await this.prisma.promoUse.update({ where: { id: useId }, data: { discardedAt: new Date() } });
    await this.log(token, "discard", [use.clipId]);
    return { id: useId, discardedAt: updated.discardedAt!.toISOString() };
  }

  /**
   * Publication réalisée sur un compte officiel (déclarée après coup : elle est toujours enregistrée, pour pouvoir la
   * retirer). Seuls les réseaux couverts sont acceptés, jamais une publicité payante. Si l'accord n'est plus en cours,
   * une demande de suppression est ouverte aussitôt.
   */
  async recordPublication(token: ServiceTokenContext, useId: string, b: { platform: PromoPlatform; url: string; publishedAt: Date; paid: boolean }) {
    if (b.paid) throw new BadRequestException("L'accord des joueurs ne couvre pas la publicité payante : publication refusée.");
    if (!PROMO_PLATFORMS.includes(b.platform)) throw new BadRequestException("Réseau non couvert par l'accord.");
    const use = await this.ownUse(token, useId);
    if (use.discardedAt) throw new ConflictException("Cette vidéo a été abandonnée : elle ne doit pas être publiée.");
    const publication = await this.prisma.promoPublication.upsert({
      where: { useId_platform: { useId, platform: b.platform } },
      create: { useId, clipId: use.clipId, platform: b.platform, postUrl: b.url, publishedAt: b.publishedAt },
      update: { postUrl: b.url, publishedAt: b.publishedAt },
    });
    const stillAllowed = await this.prisma.clip.count({ where: { ...promoEligibleWhere(), id: use.clipId } });
    if (!stillAllowed) await this.openRemovals(use.clipId, "publication déclarée après le retrait de l'accord");
    await this.log(token, "publication", [use.clipId]);
    const removal = await this.prisma.promoRemovalRequest.findUnique({ where: { publicationId: publication.id } });
    return { id: publication.id, platform: publication.platform, removalRequired: !!removal && removal.status === "OPEN", removalDueAt: removal?.dueAt.toISOString() ?? null };
  }

  /** Demandes de suppression ouvertes pour les publications déclarées par ce jeton */
  async removals(token: ServiceTokenContext) {
    const rows = await this.prisma.promoRemovalRequest.findMany({
      where: { status: "OPEN", publication: { use: { tokenId: token.id } } },
      orderBy: { dueAt: "asc" },
      include: { publication: { include: { use: { select: { id: true, reference: true } } } } },
    });
    await this.log(token, "removals", [...new Set(rows.map((r) => r.clipId))]);
    return { items: rows.map((r) => this.removalDto(r)) };
  }

  private removalDto(r: Prisma.PromoRemovalRequestGetPayload<{ include: { publication: { include: { use: { select: { id: true; reference: true } } } } } }>) {
    return {
      id: r.id,
      clipId: r.clipId,
      useId: r.publication.use.id,
      reference: r.publication.use.reference,
      platform: r.publication.platform,
      url: r.publication.postUrl,
      reason: r.reason,
      requestedAt: r.requestedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      status: r.status,
      doneAt: r.doneAt?.toISOString() ?? null,
    };
  }

  /** Suppression confirmée par l'outil de production (la vidéo a été retirée du compte officiel) */
  async completeRemovalByToken(token: ServiceTokenContext, id: string, note?: string) {
    const r = await this.prisma.promoRemovalRequest.findUnique({ where: { id }, include: { publication: { include: { use: true } } } });
    if (!r || r.publication.use.tokenId !== token.id) throw new NotFoundException("Demande introuvable.");
    if (r.status === "OPEN") {
      await this.prisma.promoRemovalRequest.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), doneByTokenId: token.id, note: note ?? null } });
    }
    await this.log(token, "removal_done", [r.clipId]);
    return { id, status: "DONE" as const };
  }

  // ---------- Accord de promotion ----------

  get consentEnabled() {
    return env().PROMO_CONSENT_ENABLED;
  }

  /** Ouvre une demande de suppression (30 jours) pour chaque publication de ce clip encore en ligne */
  private async openRemovals(clipId: string, reason: string, tx: Prisma.TransactionClient = this.prisma) {
    const publications = await tx.promoPublication.findMany({ where: { clipId, removal: null }, select: { id: true } });
    const dueAt = new Date(Date.now() + PROMO_REMOVAL_DAYS * DAY_MS);
    for (const p of publications) {
      await tx.promoRemovalRequest.create({ data: { publicationId: p.id, clipId, reason, dueAt } });
    }
    return publications.length;
  }

  /**
   * Fin de l'accord, quelle qu'en soit la cause (retrait par l'auteur, clip supprimé, refusé, retiré de la publication) :
   * plus aucun export ni nouvelle utilisation, et une demande de suppression pour chaque vidéo déjà publiée.
   */
  async endConsent(clipId: string, actorId: string | null, reason: string, tx: Prisma.TransactionClient = this.prisma) {
    const clip = await tx.clip.findUnique({ where: { id: clipId }, select: { promoConsentAt: true } });
    if (!clip?.promoConsentAt) return 0;
    await tx.clip.update({ where: { id: clipId }, data: { promoConsentAt: null } });
    await tx.promoConsentEvent.create({ data: { clipId, actorId, action: "WITHDRAW", termsVersion: PROMO_TERMS_VERSION, reason } });
    return this.openRemovals(clipId, reason, tx);
  }

  /** Choix de l'auteur sur l'un de ses clips (« Mes clips ») : lui seul peut donner ou retirer son accord */
  async setOwnConsent(userId: string, clipId: string, consent: boolean) {
    if (!this.consentEnabled) throw new ForbiddenException("La promotion sur les réseaux sociaux n'est pas encore proposée.");
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { uploaderId: true, deletedAt: true, source: true, linkProvider: true, promoConsentAt: true } });
    if (!clip || clip.uploaderId !== userId || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
    if (consent) {
      if (clip.source !== "COMMUNITY") throw new ForbiddenException("Un clip ajouté par l'équipe ne peut pas être repris dans les vidéos promotionnelles.");
      if (clip.linkProvider) throw new BadRequestException("Un clip proposé par un lien ne peut pas être repris dans les vidéos RankSight.");
      if (!clip.promoConsentAt) await this.grant(clipId, userId);
      return { promoConsent: true, removalRequests: 0 };
    }
    const removalRequests = await this.prisma.$transaction((tx) => this.endConsent(clipId, userId, "retrait par le joueur", tx));
    return { promoConsent: false, removalRequests };
  }

  /** Accord positif de l'auteur, enregistré avec la version des conditions */
  async grant(clipId: string, userId: string) {
    const at = new Date();
    await this.prisma.$transaction([
      this.prisma.clip.update({ where: { id: clipId }, data: { promoConsentAt: at } }),
      this.prisma.promoConsentEvent.create({ data: { clipId, actorId: userId, action: "GRANT", termsVersion: PROMO_TERMS_VERSION, createdAt: at } }),
    ]);
    return at;
  }

  // ---------- Modération ----------

  /** Vérification d'aptitude (pas un consentement) : voix, identifiants, musique et éléments protégés contrôlés */
  async review(actorId: string, clipId: string, b: { decision: "APPROVED" | "REJECTED"; muteAudio: boolean; note?: string }) {
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { deletedAt: true, source: true } });
    if (!clip || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
    if (clip.source !== "COMMUNITY") throw new BadRequestException("Un clip ajouté par l'équipe n'entre jamais dans les vidéos promotionnelles.");
    await this.prisma.clip.update({
      where: { id: clipId },
      data: { promoReviewStatus: b.decision, promoReviewedAt: new Date(), promoReviewerId: actorId, promoReviewNote: b.note ?? null, promoMuteAudio: b.muteAudio },
    });
    await this.audit.log(actorId, `clip.promo_review_${b.decision.toLowerCase()}`, "clip", clipId, { muteAudio: b.muteAudio, note: b.note ?? null });
    return this.clipPromo(clipId);
  }

  /** État de promotion d'un clip et son historique complet (administration) */
  async clipPromo(clipId: string) {
    const clip = await this.prisma.clip.findUnique({
      where: { id: clipId },
      select: { source: true, promoConsentAt: true, promoReviewStatus: true, promoReviewedAt: true, promoReviewNote: true, promoMuteAudio: true },
    });
    if (!clip) throw new NotFoundException("Clip introuvable.");
    const [events, uses, eligible] = await Promise.all([
      this.prisma.promoConsentEvent.findMany({ where: { clipId }, orderBy: { createdAt: "asc" } }),
      this.prisma.promoUse.findMany({
        where: { clipId },
        orderBy: { createdAt: "asc" },
        include: { token: { select: { name: true } }, publications: { include: { removal: true } } },
      }),
      this.prisma.clip.count({ where: { ...promoEligibleWhere(), id: clipId } }),
    ]);
    return {
      source: clip.source,
      consent: !!clip.promoConsentAt,
      consentAt: clip.promoConsentAt?.toISOString() ?? null,
      review: { status: clip.promoReviewStatus, at: clip.promoReviewedAt?.toISOString() ?? null, note: clip.promoReviewNote, muteAudio: clip.promoMuteAudio },
      exportable: eligible > 0,
      consentEvents: events.map((e) => ({ action: e.action, byOwner: e.actorId !== null, termsVersion: e.termsVersion, reason: e.reason, createdAt: e.createdAt.toISOString() })),
      uses: uses.map((u) => ({
        id: u.id,
        tool: u.token.name,
        reference: u.reference,
        consentVersion: u.consentVersion,
        consentGrantedAt: u.consentGrantedAt.toISOString(),
        createdAt: u.createdAt.toISOString(),
        discardedAt: u.discardedAt?.toISOString() ?? null,
        publications: u.publications.map((p) => ({
          platform: p.platform,
          url: p.postUrl,
          publishedAt: p.publishedAt.toISOString(),
          removal: p.removal ? { status: p.removal.status, dueAt: p.removal.dueAt.toISOString(), doneAt: p.removal.doneAt?.toISOString() ?? null } : null,
        })),
      })),
    };
  }

  /** Demandes de suppression (administration), les plus urgentes d'abord */
  async listRemovals(status: "OPEN" | "DONE" = "OPEN") {
    const rows = await this.prisma.promoRemovalRequest.findMany({
      where: { status },
      orderBy: status === "OPEN" ? { dueAt: "asc" } : { doneAt: "desc" },
      take: 200,
      include: { publication: { include: { use: { select: { id: true, reference: true } } } } },
    });
    return rows.map((r) => this.removalDto(r));
  }

  async completeRemovalByStaff(actorId: string, id: string, note: string) {
    const r = await this.prisma.promoRemovalRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException("Demande introuvable.");
    if (r.status === "OPEN") {
      await this.prisma.promoRemovalRequest.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), doneByUserId: actorId, note } });
      await this.audit.log(actorId, "promo.removal_done", "promo_removal", id, { clipId: r.clipId, note });
    }
    return { id, status: "DONE" as const };
  }

  // ---------- Jetons de service (fondateur) ----------

  async listTokens() {
    const tokens = await this.prisma.serviceToken.findMany({ orderBy: { createdAt: "desc" } });
    return tokens.map(({ tokenHash: _hash, ...t }) => t);
  }

  async createToken(actorId: string | null, name: string) {
    const { token, hash, prefix } = newServiceToken();
    const created = await this.prisma.serviceToken.create({ data: { name, tokenHash: hash, prefix, scopes: [PROMO_SCOPE], createdById: actorId } });
    await this.audit.log(actorId, "service_token.create", "service_token", created.id, { name, scopes: [PROMO_SCOPE] });
    return { id: created.id, name, prefix, scopes: created.scopes, token };
  }

  async revokeToken(actorId: string | null, id: string) {
    const token = await this.prisma.serviceToken.findUnique({ where: { id } });
    if (!token) throw new NotFoundException("Jeton introuvable.");
    if (!token.revokedAt) {
      await this.prisma.serviceToken.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actorId } });
      await this.audit.log(actorId, "service_token.revoke", "service_token", id, { name: token.name });
    }
    return { id, revoked: true };
  }

  // ---------- Conservation ----------

  /** Journaux techniques des jetons : supprimés au-delà de la durée de conservation (les preuves d'accord sont gardées) */
  @Cron("30 4 * * *")
  async purgeAccessLogs() {
    const { count } = await this.prisma.promoAccessLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - ACCESS_LOG_RETENTION_DAYS * DAY_MS) } } });
    if (count) this.logger.log(`Journaux d'accès promotionnels supprimés : ${count}`);
  }
}
