import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { assertCanManage, assertCanSetRole } from "../../common/staff-policy.js";
import { KEY_PATTERN, StorageService, type UploadContentType } from "../storage/storage.service.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { ClipRemovalService } from "../clips/clip-removal.service.js";
import { ClipsService, todayUtc } from "../clips/clips.service.js";
import { ClipProcessingService } from "../clips/clip-processing.service.js";
import { UsersService } from "../users/users.module.js";
import { TokenService } from "../auth/token.service.js";
import { vipStatus } from "../shop/vip.js";
import { LeaderboardsService } from "../leaderboards/leaderboards.service.js";
import { CosmeticsService } from "../cosmetics/cosmetics.service.js";
import { PushService } from "../notifications/notifications.module.js";
import type { ClipStatus, Prisma, ReportStatus } from "../../generated/prisma/client.js";
import type {
  AchievementBody, CreateClipBody, ResolveReportBody, ReviewClipBody, ScheduleDailyBody, UpdateUserBody,
} from "./admin.dto.js";

const PAGE = 25;
const paginate = (page: number) => ({ take: PAGE, skip: (Math.max(page, 1) - 1) * PAGE });

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly achievements: AchievementEngine,
    private readonly removal: ClipRemovalService,
    private readonly clips: ClipsService,
    private readonly processing: ClipProcessingService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly leaderboards: LeaderboardsService,
    private readonly cosmetics: CosmeticsService,
    private readonly push: PushService,
  ) {}

  async overview() {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [users, dau, guesses24h, clipsByStatus, openReports, premium, games, triaged] = await Promise.all([
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.guess.groupBy({ by: ["userId"], where: { createdAt: { gte: dayAgo } } }).then((r) => r.length),
      this.prisma.guess.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.clip.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING"] }, currentPeriodEnd: { gt: new Date() } } }),
      this.prisma.$queryRaw<{ slug: string; guesses: bigint; avg_distance: number }[]>`
        SELECT g.slug, COUNT(gu.id) AS guesses, COALESCE(AVG(gu.distance), 0)::float AS avg_distance
        FROM games g LEFT JOIN clips c ON c.game_id = g.id LEFT JOIN guesses gu ON gu.clip_id = c.id
        WHERE g.is_active
        GROUP BY g.slug, g.sort_order ORDER BY g.sort_order`,
      this.prisma.clip.count({ where: { status: "PENDING_REVIEW", deletedAt: null, triageDecision: { not: null } } }),
    ]);
    return {
      users, dau, guesses24h, openReports, premium,
      conversionRate: users ? premium / users : 0,
      clips: Object.fromEntries(clipsByStatus.map((c) => [c.status, c._count])),
      /** Clips en attente déjà pré-triés par un trieur : décision rapide */
      triaged,
      games: games.map((g) => ({ ...g, guesses: Number(g.guesses) })),
    };
  }

  async uploadUrl(b: { contentType: UploadContentType; sizeBytes: number }) {
    try {
      return await this.storage.createUploadUrl(b.contentType, b.sizeBytes);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  async createClip(actorId: string, b: z.infer<typeof CreateClipBody>) {
    const rank = await this.prisma.rank.findUnique({ where: { id: b.rankId }, include: { game: { select: { isActive: true } } } });
    if (!rank || rank.gameId !== b.gameId || !rank.game.isActive) throw new BadRequestException("Le rang n'appartient pas à ce jeu");
    if (!(await this.storage.exists(b.storageKey))) throw new BadRequestException("La vidéo n'a pas été reçue. Réessaie l'envoi.");
    if (b.posterKey && !KEY_PATTERN.test(b.posterKey)) throw new BadRequestException("Image d'aperçu invalide.");
    // Un clip ajouté par la modération est publié directement
    const clip = await this.prisma.clip.create({
      data: { ...b, uploaderId: actorId, source: "ADMIN", status: "APPROVED", reviewerId: actorId, reviewedAt: new Date() },
    });
    await this.audit.log(actorId, "clip.create", "clip", clip.id);
    void this.processing.enqueue(clip.id);
    return clip;
  }

  /**
   * Liste des clips. `status` : un statut de modération, ALL, ou une vue liée aux défis du jour :
   * TODAY (défis du jour en cours), SCHEDULED (planifiés pour les jours suivants),
   * AVAILABLE (acceptés et jamais passés en défi : candidats pour les prochains tirages).
   */
  async listClips(status: string, page: number, game?: string) {
    const today = todayUtc();
    const view: Record<string, Prisma.ClipWhereInput> = {
      ALL: {},
      TODAY: { dailies: { some: { date: today } } },
      SCHEDULED: { dailies: { some: { date: { gt: today } } } },
      AVAILABLE: { status: "APPROVED", dailies: { none: {} } },
      // En attente : avec ou sans avis d'un trieur
      TRIAGED: { status: "PENDING_REVIEW", triageDecision: { not: null } },
      UNTRIAGED: { status: "PENDING_REVIEW", triageDecision: null },
    };
    const where: Prisma.ClipWhereInput = {
      deletedAt: null,
      game: { isActive: true, ...(game ? { slug: game } : {}) },
      ...(view[status] ?? { status: status as ClipStatus }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.clip.findMany({
        where,
        include: {
          game: { select: { slug: true, name: true } },
          rank: { select: { name: true } },
          uploader: { select: { displayName: true, username: true } },
          triagedBy: { select: { displayName: true } },
          dailies: { select: { date: true }, orderBy: { date: "desc" }, take: 5 },
        },
        orderBy: { createdAt: ["PENDING_REVIEW", "TRIAGED", "UNTRIAGED"].includes(status) ? "asc" : "desc" },
        ...paginate(page),
      }),
      this.prisma.clip.count({ where }),
    ]);
    // Réponses au clip actuel du défi du jour (un défi dont le clip a été remplacé garde les réponses à l'ancien clip)
    const todayAnswers = await this.prisma.guess.groupBy({
      by: ["clipId"],
      where: { clipId: { in: rows.map((c) => c.id) }, dailyChallenge: { date: today } },
      _count: true,
    });
    const answersOf = (clipId: string) => todayAnswers.find((a) => a.clipId === clipId)?._count ?? 0;
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const items = rows.map(({ dailies, ...c }) => ({
      ...c,
      daily: {
        today: dailies.some((d) => d.date.getTime() === today.getTime()),
        todayPlayers: answersOf(c.id),
        upcoming: dailies.filter((d) => d.date > today).map((d) => day(d.date)).sort(),
        past: dailies.filter((d) => d.date < today).map((d) => day(d.date)),
      },
    }));
    return { items, total, page, pageSize: PAGE };
  }

  // ---------- Stockage ----------

  storageOverview() {
    return this.processing.overview();
  }

  async storageCleanup(actorId: string) {
    const report = await this.processing.cleanup();
    await this.audit.log(actorId, "storage.cleanup", "storage", "all", { ...report });
    return report;
  }

  async clipDetail(id: string) {
    const clip = await this.prisma.clip.findUnique({
      where: { id },
      include: {
        game: { include: { ranks: { orderBy: { order: "asc" } } } },
        rank: true,
        reports: true,
        uploader: { select: { displayName: true, username: true } },
        triagedBy: { select: { displayName: true } },
      },
    });
    if (!clip || clip.deletedAt) throw new NotFoundException();
    return { ...clip, previewUrl: clip.fileDeletedAt ? null : await this.storage.signedReadUrl(clip.storageKey) };
  }

  async reviewClip(actorId: string, id: string, b: z.infer<typeof ReviewClipBody>) {
    const existing = await this.prisma.clip.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!existing || existing.deletedAt) throw new NotFoundException();
    const data: Prisma.ClipUpdateInput =
      b.decision === "APPROVE"
        ? { status: "APPROVED", ...(b.rankId ? { rank: { connect: { id: b.rankId } } } : {}), ...(b.difficulty ? { difficulty: b.difficulty } : {}) }
        : { status: "REJECTED", rejectionReason: b.reason.trim() };
    const clip = await this.prisma.clip.update({
      where: { id },
      data: { ...data, reviewer: { connect: { id: actorId } }, reviewedAt: new Date() },
    });
    await this.audit.log(actorId, `clip.${b.decision.toLowerCase()}`, "clip", id, {
      ...b,
      ...(clip.triageDecision ? { triage: clip.triageDecision, triageAgreed: clip.triageDecision === b.decision } : {}),
    });
    if (clip.source === "COMMUNITY") {
      // Succès « clips acceptés » pour l'auteur, et notification de la décision sur son téléphone
      if (b.decision === "APPROVE") await this.achievements.evaluate(clip.uploaderId);
      await this.push.toUsers([clip.uploaderId], {
        title: b.decision === "APPROVE" ? "Ton clip est accepté !" : "Ton clip n'a pas été retenu",
        body: b.decision === "APPROVE" ? "Il rejoint les clips du jeu : les joueurs vont bientôt deviner ton rang." : `Motif : ${b.reason}`,
        data: { url: "my-clips" },
      });
    }
    return clip;
  }

  /**
   * Confirme d'un coup les avis des trieurs (clips pré-triés encore en attente) : même effet qu'une décision
   * clip par clip (journal, notification, succès). Un clip déjà traité entre-temps est ignoré.
   */
  async confirmTriage(actorId: string, ids: string[]) {
    const clips = await this.prisma.clip.findMany({
      where: { id: { in: ids }, status: "PENDING_REVIEW", deletedAt: null, triageDecision: { not: null } },
      select: { id: true, triageDecision: true, triageNote: true },
    });
    let approved = 0;
    let rejected = 0;
    for (const c of clips) {
      if (c.triageDecision === "APPROVE") {
        await this.reviewClip(actorId, c.id, { decision: "APPROVE" });
        approved++;
      } else {
        await this.reviewClip(actorId, c.id, { decision: "REJECT", reason: c.triageNote?.trim() || "Clip non retenu après vérification." });
        rejected++;
      }
    }
    return { approved, rejected, skipped: ids.length - clips.length };
  }

  async scheduleDaily(actorId: string, b: z.infer<typeof ScheduleDailyBody>) {
    const date = new Date(`${b.date}T00:00:00Z`);
    if (date.getTime() <= Date.now() - 86_400_000) throw new BadRequestException("Impossible de modifier un jour passé");
    const clip = await this.prisma.clip.findUnique({ where: { id: b.clipId }, include: { game: { select: { isActive: true } } } });
    if (clip?.status !== "APPROVED" || clip.deletedAt || !clip.game.isActive) throw new BadRequestException("Le clip doit être accepté");
    const existing = await this.prisma.dailyChallenge.findUnique({
      where: { date_gameId: { date, gameId: clip.gameId } },
      include: { _count: { select: { guesses: true } } },
    });
    if (existing && existing._count.guesses > 0 && existing.clipId !== clip.id) {
      throw new BadRequestException("Des joueurs ont déjà répondu à ce défi : il ne peut plus être changé.");
    }
    // Un défi par jeu et par jour : planifier remplace le clip prévu pour ce jeu à cette date
    const daily = await this.prisma.dailyChallenge.upsert({
      where: { date_gameId: { date, gameId: clip.gameId } },
      create: { date, gameId: clip.gameId, clipId: clip.id },
      update: { clipId: clip.id },
    });
    await this.audit.log(actorId, "daily.schedule", "daily", daily.id, b);
    return daily;
  }

  /** Retire un clip du planning (le clip reste disponible) ; un tirage au sort le remplacera ce jour-là. */
  async unscheduleDaily(actorId: string, id: string) {
    const daily = await this.prisma.dailyChallenge.findUnique({ where: { id }, include: { _count: { select: { guesses: true } } } });
    if (!daily) throw new NotFoundException("Défi introuvable.");
    if (daily.date < todayUtc()) throw new BadRequestException("Impossible de modifier un jour passé.");
    if (daily._count.guesses > 0) {
      throw new BadRequestException("Des joueurs ont déjà répondu à ce défi. Pour le changer quand même, supprime le clip : il sera remplacé.");
    }
    await this.prisma.dailyChallenge.delete({ where: { id } });
    await this.audit.log(actorId, "daily.unschedule", "daily", id, { clipId: daily.clipId, date: daily.date.toISOString().slice(0, 10) });
  }

  /** Suppression d'un clip (voir ClipRemovalService), journalisée. */
  async deleteClip(actorId: string, id: string) {
    const result = await this.removal.remove(id);
    if (result === "missing") throw new NotFoundException();
    await this.audit.log(actorId, "clip.delete", "clip", id, { result });
    // S'il était défi du jour, le remplaçant est tiré au sort tout de suite
    await this.clips.ensureTodayDailies();
  }

  /**
   * Annule l'acceptation d'un clip (accepté par erreur) : il repart en file d'attente et n'est plus proposé aux joueurs.
   * Les défis du jour à venir qui l'utilisaient sont libérés.
   */
  async unpublishClip(actorId: string, id: string) {
    const clip = await this.prisma.clip.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
    if (!clip || clip.deletedAt) throw new NotFoundException();
    if (clip.status !== "APPROVED") throw new BadRequestException("Seul un clip accepté peut être retiré de la publication.");
    await this.prisma.dailyChallenge.deleteMany({ where: { clipId: id, guesses: { none: {} } } });
    const updated = await this.prisma.clip.update({ where: { id }, data: { status: "PENDING_REVIEW", reviewedAt: null } });
    await this.audit.log(actorId, "clip.unpublish", "clip", id);
    return updated;
  }

  dailyCalendar() {
    return this.prisma.dailyChallenge.findMany({
      where: { date: { gte: new Date(Date.now() - 7 * 86_400_000) }, game: { isActive: true } },
      include: {
        game: { select: { slug: true, name: true, sortOrder: true } },
        clip: { select: { id: true, inGamePseudo: true, rank: { select: { name: true } } } },
        _count: { select: { guesses: true } },
      },
      orderBy: [{ date: "asc" }, { game: { sortOrder: "asc" } }],
    });
  }

  async listUsers(q: string, page: number) {
    const where: Prisma.UserWhereInput = {
      status: { not: "DELETED" },
      ...(q ? { OR: [{ username: { contains: q.toLowerCase() } }, { email: { contains: q.toLowerCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, username: true, displayName: true, email: true, role: true, status: true, xp: true, level: true, createdAt: true, avatarUrl: true,
          emailVerifiedAt: true, chatMutedUntil: true, totpEnabledAt: true,
          subscription: { select: { status: true, currentPeriodEnd: true } },
        },
        orderBy: { createdAt: "desc" },
        ...paginate(page),
      }),
      this.prisma.user.count({ where }),
    ]);
    const now = new Date();
    const items = rows.map(({ subscription, emailVerifiedAt, chatMutedUntil, totpEnabledAt, ...u }) => ({
      ...u,
      vip: vipStatus(subscription),
      emailVerified: !!emailVerifiedAt,
      chatMutedUntil: chatMutedUntil && chatMutedUntil > now ? chatMutedUntil.toISOString() : null,
      mfaEnabled: !!totpEnabledAt,
    }));
    // Fondateur présent : lui seul peut agir sur les comptes administrateurs
    const ownerExists = (await this.prisma.user.count({ where: { role: "OWNER" } })) > 0;
    return { items, total, page, pageSize: PAGE, ownerExists };
  }

  async updateUser(actorId: string, id: string, b: z.infer<typeof UpdateUserBody>) {
    if (id === actorId) throw new BadRequestException("Impossible de modifier son propre compte");
    await assertCanManage(this.prisma, actorId, id);
    if (b.role) await assertCanSetRole(this.prisma, actorId, b.role);
    const user = await this.prisma.user.update({ where: { id }, data: b, select: { id: true, role: true, status: true } });
    if (b.status && b.status !== "ACTIVE") await this.tokens.revokeAll(id);
    await this.audit.log(actorId, "user.update", "user", id, b);
    return user;
  }

  /**
   * Remise à zéro des statistiques d'un joueur (faille exploitée, triche) : XP, niveau, séries, record Infini,
   * statistiques par jeu, succès, places dans les classements (en cours et saisons archivées) et bilan des duels.
   * Les réponses déjà données restent en base mais ne comptent plus (statsResetAt) : les défis du jour
   * déjà joués ne peuvent donc pas être rejoués.
   */
  async resetStats(actorId: string, id: string) {
    await assertCanManage(this.prisma, actorId, id);
    const target = await this.prisma.user.findUnique({ where: { id }, select: { status: true, displayName: true, xp: true, totalGuesses: true } });
    if (!target || target.status === "DELETED") throw new NotFoundException("Compte introuvable.");
    const now = new Date();
    const [, , achievements, snapshots] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          xp: 0, level: 1, dailyStreak: 0, bestDailyStreak: 0, lastDailyDate: null, infiniteBest: 0,
          winStreak: 0, bestWinStreak: 0, totalGuesses: 0, exactGuesses: 0, statsResetAt: now,
        },
      }),
      this.prisma.userGameStats.deleteMany({ where: { userId: id } }),
      this.prisma.userAchievement.deleteMany({ where: { userId: id } }),
      this.prisma.leaderboardSnapshot.deleteMany({ where: { userId: id } }),
      this.prisma.infiniteRun.updateMany({ where: { userId: id, endedAt: null }, data: { endedAt: now } }),
    ]);
    const leaderboards = await this.leaderboards.removeUser(id);
    // Titres, badges et cadres gagnés en jouant retirés (ceux attribués par l'équipe restent)
    const rewards = await this.cosmetics.revokeEarned(id);
    await this.audit.log(actorId, "user.reset_stats", "user", id, {
      rewards,
      displayName: target.displayName, xp: target.xp, totalGuesses: target.totalGuesses,
      achievements: achievements.count, archivedRankings: snapshots.count, leaderboards,
    });
    return { achievements: achievements.count, leaderboards, archivedRankings: snapshots.count, rewards };
  }

  /** Confirmation de l'adresse email par un administrateur (email jamais reçu), journalisée. */
  async verifyEmail(actorId: string, id: string) {
    await assertCanManage(this.prisma, actorId, id);
    const target = await this.prisma.user.findUnique({ where: { id }, select: { status: true, email: true, emailVerifiedAt: true } });
    if (!target || target.status === "DELETED") throw new NotFoundException("Compte introuvable.");
    if (!target.email) throw new BadRequestException("Ce compte n'a pas d'adresse email.");
    if (target.emailVerifiedAt) throw new BadRequestException("L'adresse email est déjà confirmée.");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { emailVerifiedAt: now } }),
      // Les liens de confirmation encore valides ne servent plus
      this.prisma.emailVerificationToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } }),
    ]);
    await this.audit.log(actorId, "user.verify_email", "user", id, { email: target.email });
  }

  /** Suppression d'un compte par un administrateur (même effet que la suppression par le joueur), journalisée. */
  async deleteUser(actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException("Supprime ton propre compte depuis ton profil sur le site.");
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true, displayName: true } });
    if (!target || target.status === "DELETED") throw new NotFoundException("Compte introuvable.");
    await assertCanManage(this.prisma, actorId, id);
    if (target.role === "ADMIN" || target.role === "OWNER") throw new BadRequestException("Retire d'abord le rôle administrateur de ce compte.");
    await this.users.deleteAccount(id);
    await this.audit.log(actorId, "user.delete", "user", id, { displayName: target.displayName });
  }

  async listReports(status: string, page: number) {
    const where = { status: status as ReportStatus };
    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: { clip: { select: { id: true, reportCount: true, game: { select: { slug: true } } } }, reporter: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
        ...paginate(page),
      }),
      this.prisma.report.count({ where }),
    ]);
    return { items, total, page, pageSize: PAGE };
  }

  async resolveReport(actorId: string, id: string, b: z.infer<typeof ResolveReportBody>) {
    const report = await this.prisma.report.update({
      where: { id },
      data: { status: b.status, resolution: b.resolution, resolverId: actorId, resolvedAt: new Date() },
    });
    if (b.archiveClip) {
      await this.prisma.clip.update({
        where: { id: report.clipId },
        data: { status: "ARCHIVED", rejectionReason: "Retiré après un signalement de joueur.", reviewedAt: new Date() },
      });
    }
    await this.audit.log(actorId, "report.resolve", "report", id, b);
    return report;
  }

  async upsertAchievement(actorId: string, id: string | undefined, b: z.infer<typeof AchievementBody>) {
    const data = { ...b, criteria: b.criteria as Prisma.InputJsonValue };
    const a = id
      ? await this.prisma.achievement.update({ where: { id }, data })
      : await this.prisma.achievement.create({ data });
    await this.audit.log(actorId, id ? "achievement.update" : "achievement.create", "achievement", a.id);
    return a;
  }

  auditTrail(page: number) {
    return this.prisma.auditLog.findMany({
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      ...paginate(page),
    });
  }
}
