import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PROMO_TERMS_VERSION } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { newServiceToken, PROMO_SCOPE, type ServiceTokenContext } from "./service-token.js";

/** Durée de validité de l'adresse de téléchargement transmise (le temps de télécharger le fichier) */
const VIDEO_URL_TTL_SEC = 900;
const MAX_PAGE = 100;

/**
 * Clip exploitable pour la promotion : publié après validation par la modération (le rang est donc celui validé),
 * fichier vidéo MP4 encore stocké (jamais un clip à lien YouTube / Medal), auteur actif et accord de promotion en cours.
 */
export const promoEligibleWhere = (): Prisma.ClipWhereInput => ({
  status: "APPROVED",
  reviewedAt: { not: null },
  deletedAt: null,
  fileDeletedAt: null,
  linkProvider: null,
  storageKey: { endsWith: ".mp4" },
  promoConsentAt: { not: null },
  game: { isActive: true },
  uploader: { status: "ACTIVE" },
});

const CLIP_SELECT = {
  id: true,
  storageKey: true,
  durationSec: true,
  reviewedAt: true,
  updatedAt: true,
  game: { select: { slug: true, name: true } },
  rank: { select: { id: true, name: true, order: true } },
} satisfies Prisma.ClipSelect;

type PromoClipRow = Prisma.ClipGetPayload<{ select: typeof CLIP_SELECT }>;

@Injectable()
export class PromoService {
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

  /** Données transmises : aucune donnée personnelle (ni auteur, ni pseudo en jeu, ni preuve, ni note, ni région) */
  private async toDto(c: PromoClipRow) {
    return {
      id: c.id,
      game: { slug: c.game.slug, name: c.game.name },
      rank: { id: c.rank.id, name: c.rank.name, order: c.rank.order },
      durationSec: c.durationSec,
      approvedAt: c.reviewedAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
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
      this.prisma.clip.findMany({ where: { id: { in: unique } }, select: { id: true, deletedAt: true, promoConsentAt: true, status: true } }),
    ]);
    const ok = new Set(eligible.map((c) => c.id));
    const byId = new Map(known.map((c) => [c.id, c]));
    const reason = (id: string) => {
      const c = byId.get(id);
      if (!c || c.deletedAt) return "supprimé";
      if (!c.promoConsentAt) return "accord de promotion absent ou retiré";
      if (c.status !== "APPROVED") return "plus publié sur RankSight";
      return "indisponible";
    };
    await this.log(token, "status", unique);
    return { items: unique.map((id) => (ok.has(id) ? { id, available: true, reason: null } : { id, available: false, reason: reason(id) })) };
  }

  /** Utilisation déclarée par l'outil de production : refusée si l'accord a été retiré entre-temps */
  async recordUse(token: ServiceTokenContext, id: string, reference: string) {
    const clip = await this.prisma.clip.findFirst({ where: { ...promoEligibleWhere(), id }, select: { id: true, rankId: true } });
    if (!clip) throw new NotFoundException("Clip indisponible pour la promotion : il ne doit pas être utilisé.");
    const use = await this.prisma.promoUse.create({ data: { clipId: id, tokenId: token.id, rankId: clip.rankId, reference } });
    await this.log(token, "use", [id]);
    return { id: use.id, clipId: id, rankId: clip.rankId, createdAt: use.createdAt.toISOString() };
  }

  // ---------- Accord de promotion ----------

  get consentEnabled() {
    return env().PROMO_CONSENT_ENABLED;
  }

  /** Enregistre un accord ou un retrait (avec son historique). Sans effet si l'état ne change pas. */
  async setConsent(clipId: string, actorId: string, consent: boolean, tx: Prisma.TransactionClient = this.prisma) {
    const clip = await tx.clip.findUnique({ where: { id: clipId }, select: { promoConsentAt: true, linkProvider: true } });
    if (!clip) throw new NotFoundException("Clip introuvable.");
    if (consent && clip.linkProvider) throw new BadRequestException("Un clip proposé par un lien ne peut pas être repris dans les vidéos RankSight.");
    if (consent === !!clip.promoConsentAt) return clip.promoConsentAt;
    const at = consent ? new Date() : null;
    await tx.clip.update({ where: { id: clipId }, data: { promoConsentAt: at } });
    await tx.promoConsentEvent.create({ data: { clipId, actorId, action: consent ? "GRANT" : "WITHDRAW", termsVersion: PROMO_TERMS_VERSION } });
    return at;
  }

  /** Choix du joueur sur l'un de ses clips (« Mes clips ») */
  async setOwnConsent(userId: string, clipId: string, consent: boolean) {
    if (!this.consentEnabled) throw new ForbiddenException("La promotion sur les réseaux sociaux n'est pas encore proposée.");
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { uploaderId: true, deletedAt: true } });
    if (!clip || clip.uploaderId !== userId || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
    const at = await this.prisma.$transaction((tx) => this.setConsent(clipId, userId, consent, tx));
    return { promoConsent: !!at };
  }

  /** Clip ajouté par la modération : elle atteste l'accord de son auteur (jamais pour un clip proposé par un joueur) */
  async setStaffConsent(actorId: string, clipId: string, consent: boolean) {
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { source: true, deletedAt: true } });
    if (!clip || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
    if (consent && !this.consentEnabled) throw new ForbiddenException("La promotion sur les réseaux sociaux n'est pas encore proposée.");
    if (consent && clip.source !== "ADMIN") throw new ForbiddenException("Seul l'auteur d'un clip proposé par un joueur peut donner son accord.");
    const at = await this.prisma.$transaction((tx) => this.setConsent(clipId, actorId, consent, tx));
    await this.audit.log(actorId, consent ? "clip.promo_consent" : "clip.promo_withdraw", "clip", clipId);
    return { promoConsent: !!at };
  }

  /** Historique de promotion d'un clip (administration) */
  async history(clipId: string) {
    const [events, uses] = await Promise.all([
      this.prisma.promoConsentEvent.findMany({ where: { clipId }, orderBy: { createdAt: "asc" } }),
      this.prisma.promoUse.findMany({ where: { clipId }, orderBy: { createdAt: "asc" }, include: { token: { select: { name: true } } } }),
    ]);
    return {
      consentEvents: events.map((e) => ({ action: e.action, actorId: e.actorId, termsVersion: e.termsVersion, createdAt: e.createdAt.toISOString() })),
      uses: uses.map((u) => ({ id: u.id, tool: u.token.name, reference: u.reference, rankId: u.rankId, createdAt: u.createdAt.toISOString() })),
    };
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
}
