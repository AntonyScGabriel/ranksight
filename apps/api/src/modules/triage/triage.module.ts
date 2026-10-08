import {
  ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post,
  Query, Body,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { TriageInput, type ReviewerStatsDto, type TriageClipDto, type TriageStatsDto, type UserRole } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

const QUEUE_SIZE = 10;
const startOfDayUtc = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

type StatsRow = { total: bigint; today: bigint; confirmed: bigint; overturned: bigint; awaiting: bigint; last: Date | null };

/**
 * Pré-tri des clips proposés par les joueurs. Un trieur donne un avis (valider ou refuser avec un motif) ;
 * le clip reste en attente jusqu'à la décision finale d'un modérateur ou d'un administrateur, qui confirme l'avis
 * en un clic ou le contredit. Un trieur ne trie jamais ses propres clips.
 */
@Injectable()
export class TriageService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  private untriaged(userId: string, game?: string) {
    return {
      status: "PENDING_REVIEW" as const,
      deletedAt: null,
      fileDeletedAt: null,
      triageDecision: null,
      uploaderId: { not: userId },
      game: { isActive: true, ...(game ? { slug: game } : {}) },
    };
  }

  /** Prochains clips à trier, du plus ancien au plus récent */
  async queue(userId: string, game?: string): Promise<TriageClipDto[]> {
    const rows = await this.prisma.clip.findMany({
      where: this.untriaged(userId, game),
      include: { game: { select: { slug: true, name: true } }, rank: { select: { id: true, name: true, color: true, iconUrl: true } } },
      orderBy: { createdAt: "asc" },
      take: QUEUE_SIZE,
    });
    return Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        game: c.game,
        claimedRank: c.rank,
        previewUrl: await this.storage.signedReadUrl(c.storageKey, 3600),
        durationSec: c.durationSec,
        proofUrl: c.proofUrl,
        inGamePseudo: c.inGamePseudo,
        platform: c.platform,
        region: c.region,
        submitterNote: c.submitterNote,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  }

  async decide(userId: string, clipId: string, input: TriageInput) {
    const { count } = await this.prisma.clip.updateMany({
      where: { id: clipId, ...this.untriaged(userId) },
      data: { triageDecision: input.decision, triageNote: input.note?.trim() || null, triagedById: userId, triagedAt: new Date() },
    });
    if (count === 0) {
      const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { uploaderId: true, deletedAt: true } });
      if (!clip || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
      if (clip.uploaderId === userId) throw new ForbiddenException("Tu ne peux pas trier un clip que tu as proposé.");
      throw new ConflictException({ code: "ALREADY_TRIAGED", message: "Ce clip a déjà été trié ou traité par la modération." });
    }
    await this.audit.log(userId, `clip.triage_${input.decision.toLowerCase()}`, "clip", clipId, { note: input.note ?? null });
    return { id: clipId, decision: input.decision };
  }

  /** Annuler son avis (erreur de clic) tant que la modération n'a pas tranché */
  async undo(userId: string, clipId: string) {
    const { count } = await this.prisma.clip.updateMany({
      where: { id: clipId, triagedById: userId, status: "PENDING_REVIEW", deletedAt: null },
      data: { triageDecision: null, triageNote: null, triagedById: null, triagedAt: null },
    });
    if (count === 0) throw new ConflictException({ code: "ALREADY_REVIEWED", message: "Ce clip a déjà été traité par la modération." });
    await this.audit.log(userId, "clip.triage_undo", "clip", clipId);
  }

  private async statsRows(userId?: string) {
    const since = startOfDayUtc();
    return this.prisma.$queryRaw<(StatsRow & { triaged_by_id: string })[]>`
      SELECT triaged_by_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE triaged_at >= ${since}) AS today,
        COUNT(*) FILTER (WHERE (status = 'APPROVED' AND triage_decision = 'APPROVE') OR (status = 'REJECTED' AND triage_decision = 'REJECT')) AS confirmed,
        COUNT(*) FILTER (WHERE (status = 'APPROVED' AND triage_decision = 'REJECT') OR (status = 'REJECTED' AND triage_decision = 'APPROVE')) AS overturned,
        COUNT(*) FILTER (WHERE status = 'PENDING_REVIEW' AND deleted_at IS NULL) AS awaiting,
        MAX(triaged_at) AS last
      FROM clips
      WHERE triaged_by_id IS NOT NULL ${userId ? Prisma.sql`AND triaged_by_id = ${userId}::uuid` : Prisma.empty}
      GROUP BY triaged_by_id`;
  }

  /** Statistiques du trieur connecté et taille de la file */
  async stats(userId: string): Promise<TriageStatsDto> {
    const [[row], queue] = await Promise.all([this.statsRows(userId), this.prisma.clip.count({ where: this.untriaged(userId) })]);
    return {
      total: Number(row?.total ?? 0),
      today: Number(row?.today ?? 0),
      confirmed: Number(row?.confirmed ?? 0),
      overturned: Number(row?.overturned ?? 0),
      awaiting: Number(row?.awaiting ?? 0),
      queue,
    };
  }

  /** Bilan de chaque trieur pour la modération : avis confirmés ou contredits */
  async reviewers(): Promise<ReviewerStatsDto[]> {
    const rows = await this.statsRows();
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.triaged_by_id) } },
      select: { id: true, displayName: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows
      .filter((r) => byId.has(r.triaged_by_id))
      .map((r) => {
        const u = byId.get(r.triaged_by_id)!;
        return {
          userId: u.id, displayName: u.displayName, role: u.role as UserRole,
          total: Number(r.total), today: Number(r.today), confirmed: Number(r.confirmed), overturned: Number(r.overturned), awaiting: Number(r.awaiting),
          lastTriageAt: r.last?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.total - a.total);
  }
}

@Controller("admin/triage")
@Roles("REVIEWER")
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /** GET /v1/admin/triage/queue?game= — prochains clips à trier */
  @Get("queue")
  queue(@CurrentUser() u: AuthUser, @Query("game") game?: string) {
    return this.triage.queue(u.sub, game || undefined);
  }

  /** GET /v1/admin/triage/stats — mes tris et la file d'attente */
  @Get("stats")
  stats(@CurrentUser() u: AuthUser) {
    return this.triage.stats(u.sub);
  }

  /** GET /v1/admin/triage/reviewers — bilan des trieurs (modération) */
  @Roles("MODERATOR")
  @Get("reviewers")
  reviewers() {
    return this.triage.reviewers();
  }

  /** POST /v1/admin/triage/:id — { decision: APPROVE | REJECT, note } */
  @Post(":id")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  decide(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(TriageInput)) body: TriageInput) {
    return this.triage.decide(u.sub, id, body);
  }

  /** DELETE /v1/admin/triage/:id — annule mon avis tant que la modération n'a pas tranché */
  @Delete(":id")
  @HttpCode(204)
  async undo(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.triage.undo(u.sub, id);
  }
}

@Module({ controllers: [TriageController], providers: [TriageService], exports: [TriageService] })
export class TriageModule {}
