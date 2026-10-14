import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Redis } from "ioredis";
import {
  AUDIT_ACTION_LABEL, GAME_NAMES, PLAYER_HISTORY_PAGE_SIZE, SCORE_STEPS, SUSPICION_THRESHOLDS as T, VIP_XP_MULTIPLIER, guessResultOf,
  levelFromXp, scoreForDistance,
  type GameMode, type GameSlug, type GuessAggregateDto, type HistoryFlag, type PlayerAuditDto, type PlayerHistoryDto, type PlayerHistoryItemDto,
  PlayerHistoryQuery, type PlayerIndicatorDto, type PlayerIndicatorsDto, type PlayerStatsDto,
} from "@ranksight/shared";
import type { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { LeaderboardsService } from "../leaderboards/leaderboards.service.js";

type HistoryFilters = z.output<typeof PlayerHistoryQuery>;
type Agg = { guesses: number; exact: number; close: number; miss: number; total_score: number; avg_score: number; avg_distance: number };

/** Score du barème pour un écart, en SQL (construit à partir de SCORE_STEPS : une seule source pour la règle) */
const SCORE_CASE = Prisma.raw(`CASE g.distance ${SCORE_STEPS.map((s, i) => `WHEN ${i} THEN ${s}`).join(" ")} ELSE 0 END`);
/** XP maximale pour un score : bonus de série plafonné à +50 %, puis +50 % VIP (arrondis comme à l'enregistrement) */
const MAX_XP = (score: number) => Math.round(Math.round(score * 1.5) * VIP_XP_MULTIPLIER);
const MAX_XP_SQL = Prisma.raw(`ROUND(ROUND(g.score * 1.5) * ${VIP_XP_MULTIPLIER})`);
/** Multiplicateur maximal du mode Infini (difficulté 5) */
const MAX_INFINITE_MULTIPLIER = 1.5;
const AUDIT_PAGE = 30;

const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
/** « 13/10/2026 à 14 h UTC » */
const fmtHour = (d: Date) => `${d.toLocaleDateString("fr-FR", { timeZone: "UTC" })} à ${d.getUTCHours()} h UTC`;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** Instant UTC comparable aux colonnes `timestamp` (sans fuseau, en UTC) de la base, quel que soit le fuseau de la session */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function toAggregate(r: Agg | undefined): GuessAggregateDto {
  const guesses = Number(r?.guesses ?? 0);
  const exact = Number(r?.exact ?? 0);
  return {
    guesses,
    exact,
    close: Number(r?.close ?? 0),
    miss: Number(r?.miss ?? 0),
    totalScore: Number(r?.total_score ?? 0),
    avgScore: Math.round(Number(r?.avg_score ?? 0) * 10) / 10,
    avgDistance: Math.round(Number(r?.avg_distance ?? 0) * 100) / 100,
    accuracy: guesses ? exact / guesses : 0,
  };
}

const AGG_COLUMNS = Prisma.sql`
  COUNT(*)::int AS guesses,
  COUNT(*) FILTER (WHERE g.distance = 0)::int AS exact,
  COUNT(*) FILTER (WHERE g.distance BETWEEN 1 AND 2)::int AS close,
  COUNT(*) FILTER (WHERE g.distance >= 3)::int AS miss,
  COALESCE(SUM(g.score), 0)::int AS total_score,
  COALESCE(AVG(g.score), 0)::float AS avg_score,
  COALESCE(AVG(g.distance), 0)::float AS avg_distance`;

/**
 * Historique d'un joueur pour l'équipe (enquête en cas de suspicion de triche) : parties, records et statistiques,
 * journal d'audit et indicateurs explicables. Tout est calculé à partir des données enregistrées : rien n'est
 * reconstitué ni estimé, et aucun indicateur n'entraîne de sanction automatique.
 */
@Injectable()
export class PlayerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly leaderboards: LeaderboardsService,
  ) {}

  private async player(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("Joueur introuvable.");
    return user;
  }

  // ---------- Parties ----------

  async history(userId: string, q: HistoryFilters): Promise<PlayerHistoryDto> {
    const user = await this.player(userId);
    const where: Prisma.GuessWhereInput = {
      userId,
      ...(q.ids?.length ? { id: { in: q.ids } } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
      ...(q.game ? { clip: { game: { slug: q.game } } } : {}),
      ...(q.result === "exact" ? { distance: 0 } : q.result === "close" ? { distance: { gte: 1, lte: 2 } } : q.result === "miss" ? { distance: { gte: 3 } } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lt: new Date(day(q.to).getTime() + 86_400_000) } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.guess.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * PLAYER_HISTORY_PAGE_SIZE,
        take: PLAYER_HISTORY_PAGE_SIZE,
        include: {
          clip: {
            select: {
              id: true, inGamePseudo: true, deletedAt: true,
              rank: { select: { name: true, color: true, order: true } },
              game: { select: { slug: true, name: true } },
            },
          },
          guessedRank: { select: { name: true, color: true, order: true } },
          dailyChallenge: { select: { id: true, date: true, slot: true } },
          infiniteRun: { select: { id: true, score: true, endedAt: true } },
          versusMatch: { select: { id: true, status: true, winnerId: true } },
        },
      }),
      this.prisma.guess.count({ where }),
    ]);

    const items: PlayerHistoryItemDto[] = rows.map((g) => {
      const flags: HistoryFlag[] = [];
      if (g.score !== scoreForDistance(g.distance)) flags.push("SCORE_RULE");
      if (g.distance !== Math.abs(g.guessedRank.order - g.clip.rank.order)) flags.push("DISTANCE_RULE");
      if (g.xpGained > MAX_XP(g.score)) flags.push("XP_RULE");
      if (g.distance === 0 && g.responseMs !== null && g.responseMs < T.fastResponseMs) flags.push("FAST_EXACT");
      if (g.distance === 0 && g.watchedMs < T.shortWatchMs) flags.push("SHORT_WATCH_EXACT");
      if (g.mode === "DAILY" && g.dailyChallenge && fmtDay(g.dailyChallenge.date) !== fmtDay(g.createdAt)) flags.push("DAILY_OTHER_DAY");

      const context: PlayerHistoryItemDto["context"] = g.dailyChallenge
        ? { kind: "daily", challengeId: g.dailyChallenge.id, date: fmtDay(g.dailyChallenge.date), slot: g.dailyChallenge.slot }
        : g.infiniteRun
          ? { kind: "infinite", runId: g.infiniteRun.id, runScore: g.infiniteRun.score, ended: !!g.infiniteRun.endedAt }
          : g.versusMatch
            ? {
                kind: "versus",
                matchId: g.versusMatch.id,
                status: g.versusMatch.status,
                outcome: g.versusMatch.status !== "FINISHED" ? null : !g.versusMatch.winnerId ? "DRAW" : g.versusMatch.winnerId === userId ? "WIN" : "LOSS",
              }
            : { kind: "other" };

      return {
        id: g.id,
        createdAt: g.createdAt.toISOString(),
        mode: g.mode as GameMode,
        game: g.clip.game,
        context,
        clip: { id: g.clip.id, inGamePseudo: g.clip.inGamePseudo, deleted: !!g.clip.deletedAt, rank: { name: g.clip.rank.name, color: g.clip.rank.color } },
        guessedRank: { name: g.guessedRank.name, color: g.guessedRank.color },
        distance: g.distance,
        result: guessResultOf(g.distance),
        score: g.score,
        xpGained: g.xpGained,
        watchedMs: g.watchedMs,
        responseMs: g.responseMs,
        counted: !user.statsResetAt || g.createdAt > user.statsResetAt,
        flags,
      };
    });
    return { items, total, page: q.page, pageSize: PLAYER_HISTORY_PAGE_SIZE, statsResetAt: user.statsResetAt?.toISOString() ?? null };
  }

  // ---------- Records et statistiques ----------

  async stats(userId: string): Promise<PlayerStatsDto> {
    const user = await this.player(userId);
    const since = user.statsResetAt ?? new Date(0);
    const [allTime, counted, byMode, byGame, last, daily, bestDay, infinite, versus, seasons, weekly] = await Promise.all([
      this.prisma.$queryRaw<Agg[]>`SELECT ${AGG_COLUMNS} FROM guesses g WHERE g.user_id = ${userId}::uuid`,
      this.prisma.$queryRaw<Agg[]>`SELECT ${AGG_COLUMNS} FROM guesses g WHERE g.user_id = ${userId}::uuid AND g.created_at > ${utc(since)}`,
      this.prisma.$queryRaw<(Agg & { mode: GameMode })[]>`
        SELECT g.mode::text AS mode, ${AGG_COLUMNS} FROM guesses g WHERE g.user_id = ${userId}::uuid GROUP BY g.mode ORDER BY g.mode`,
      this.prisma.$queryRaw<(Agg & { slug: string; name: string })[]>`
        SELECT ga.slug, ga.name, ${AGG_COLUMNS}
        FROM guesses g JOIN clips c ON c.id = g.clip_id JOIN games ga ON ga.id = c.game_id
        WHERE g.user_id = ${userId}::uuid GROUP BY ga.slug, ga.name, ga.sort_order ORDER BY ga.sort_order`,
      this.prisma.guess.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      this.prisma.$queryRaw<{ challenges: number; days: number }[]>`
        SELECT COUNT(*)::int AS challenges, COUNT(DISTINCT d.date)::int AS days
        FROM guesses g JOIN daily_challenges d ON d.id = g.daily_challenge_id WHERE g.user_id = ${userId}::uuid`,
      this.prisma.$queryRaw<{ date: Date; score: number }[]>`
        SELECT d.date, SUM(g.score)::int AS score
        FROM guesses g JOIN daily_challenges d ON d.id = g.daily_challenge_id WHERE g.user_id = ${userId}::uuid
        GROUP BY d.date ORDER BY score DESC, d.date ASC LIMIT 1`,
      // Terminée = 3 vies perdues ; abandonnée = remplacée par une nouvelle partie (ou close à une remise à zéro)
      this.prisma.$queryRaw<{ started: number; finished: number; abandoned: number; best: number; avg: number; best_clips: number }[]>`
        SELECT COUNT(*)::int AS started, COUNT(*) FILTER (WHERE lives <= 0)::int AS finished,
               COUNT(*) FILTER (WHERE ended_at IS NOT NULL AND lives > 0)::int AS abandoned,
               COALESCE(MAX(score) FILTER (WHERE lives <= 0), 0)::int AS best,
               COALESCE(AVG(score) FILTER (WHERE lives <= 0), 0)::float AS avg,
               COALESCE(MAX(clips_played), 0)::int AS best_clips
        FROM infinite_runs WHERE user_id = ${userId}::uuid`,
      this.prisma.$queryRaw<{ played: number; finished: number; wins: number; losses: number; draws: number; forfeits: number; best: number }[]>`
        SELECT COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'FINISHED'))::int AS played,
               COUNT(*) FILTER (WHERE status = 'FINISHED')::int AS finished,
               COUNT(*) FILTER (WHERE status = 'FINISHED' AND winner_id = ${userId}::uuid)::int AS wins,
               COUNT(*) FILTER (WHERE status = 'FINISHED' AND winner_id IS NOT NULL AND winner_id <> ${userId}::uuid)::int AS losses,
               COUNT(*) FILTER (WHERE status = 'FINISHED' AND winner_id IS NULL)::int AS draws,
               COUNT(*) FILTER (WHERE forfeited_by_id = ${userId}::uuid)::int AS forfeits,
               COALESCE(MAX(CASE WHEN creator_id = ${userId}::uuid THEN creator_score ELSE opponent_score END) FILTER (WHERE status = 'FINISHED'), 0)::int AS best
        FROM versus_matches WHERE creator_id = ${userId}::uuid OR opponent_id = ${userId}::uuid`,
      this.prisma.leaderboardSnapshot.findMany({
        where: { userId, period: "SEASON", NOT: { periodKey: { contains: ":" } } },
        orderBy: [{ position: "asc" }, { periodKey: "desc" }],
        take: 6,
        select: { periodKey: true, position: true, score: true },
      }),
      this.prisma.$queryRaw<{ week: Date; guesses: number; avg_score: number; exact: number }[]>`
        SELECT * FROM (
          SELECT date_trunc('week', g.created_at) AS week, COUNT(*)::int AS guesses, AVG(g.score)::float AS avg_score,
                 COUNT(*) FILTER (WHERE g.distance = 0)::int AS exact
          FROM guesses g WHERE g.user_id = ${userId}::uuid GROUP BY 1 ORDER BY 1 DESC LIMIT 26
        ) w ORDER BY week ASC`,
    ]);

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        statsResetAt: user.statsResetAt?.toISOString() ?? null,
        lastPlayedAt: last?.createdAt.toISOString() ?? null,
      },
      stored: {
        xp: user.xp, level: user.level, totalGuesses: user.totalGuesses, exactGuesses: user.exactGuesses, dailyStreak: user.dailyStreak,
        bestDailyStreak: user.bestDailyStreak, winStreak: user.winStreak, bestWinStreak: user.bestWinStreak, infiniteBest: user.infiniteBest,
      },
      allTime: toAggregate(allTime[0]),
      counted: toAggregate(counted[0]),
      byMode: byMode.map((r) => ({ mode: r.mode, ...toAggregate(r) })),
      byGame: byGame.map((r) => ({ slug: r.slug, name: r.name, ...toAggregate(r) })),
      sessions: {
        daily: {
          challenges: daily[0]?.challenges ?? 0,
          days: daily[0]?.days ?? 0,
          bestDayScore: bestDay[0]?.score ?? 0,
          bestDay: bestDay[0] ? fmtDay(bestDay[0].date) : null,
        },
        infinite: {
          started: infinite[0]?.started ?? 0,
          finished: infinite[0]?.finished ?? 0,
          abandoned: infinite[0]?.abandoned ?? 0,
          bestScore: infinite[0]?.best ?? 0,
          avgScore: Math.round(Number(infinite[0]?.avg ?? 0)),
          bestClips: infinite[0]?.best_clips ?? 0,
        },
        versus: {
          played: versus[0]?.played ?? 0,
          finished: versus[0]?.finished ?? 0,
          wins: versus[0]?.wins ?? 0,
          losses: versus[0]?.losses ?? 0,
          draws: versus[0]?.draws ?? 0,
          forfeits: versus[0]?.forfeits ?? 0,
          bestScore: versus[0]?.best ?? 0,
        },
      },
      seasons: seasons.map((s) => ({ season: s.periodKey, position: s.position, score: s.score })),
      weekly: weekly.map((w) => ({
        week: fmtDay(w.week),
        guesses: w.guesses,
        avgScore: Math.round(Number(w.avg_score) * 10) / 10,
        accuracy: w.guesses ? w.exact / w.guesses : 0,
      })),
    };
  }

  // ---------- Journal d'audit ----------

  /**
   * Entrées du journal qui concernent le joueur (actions de l'équipe ou du système sur son compte, ses résultats,
   * ses clips) et celles dont il est l'auteur. L'adresse IP n'est montrée qu'au fondateur.
   */
  async audit(userId: string, page: number, opts: { showIp: boolean }): Promise<PlayerAuditDto> {
    await this.player(userId);
    const where: Prisma.AuditLogWhereInput = { OR: [{ targetUserId: userId }, { actorId: userId }] };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (Math.max(page, 1) - 1) * AUDIT_PAGE,
        take: AUDIT_PAGE,
        include: { actor: { select: { id: true, displayName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actor: r.actor,
        byPlayer: r.actorId === userId,
        action: r.action,
        label: AUDIT_ACTION_LABEL[r.action] ?? r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        reason: r.reason,
        metadata: r.metadata,
        ...(opts.showIp ? { ip: r.ip } : {}),
      })),
      total,
      page: Math.max(page, 1),
      pageSize: AUDIT_PAGE,
    };
  }

  // ---------- Indicateurs ----------

  async indicators(userId: string): Promise<PlayerIndicatorsDto> {
    const user = await this.player(userId);
    const since = user.statsResetAt ?? new Date(0);
    const indicators = await Promise.all([
      this.scoreRules(userId),
      this.infiniteRuns(userId),
      this.counters(user, since),
      this.records(user, since),
      this.duplicates(userId),
      this.accuracy(userId),
      this.speed(userId),
      this.activity(userId),
    ]);
    return { generatedAt: new Date().toISOString(), indicators: indicators.flat() };
  }

  /** Score, écart et XP de chaque réponse comparés aux règles du jeu */
  private async scoreRules(userId: string): Promise<PlayerIndicatorDto[]> {
    const [score, distance, xp] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; distance: number; score: number }[]>`
        SELECT g.id, g.distance, g.score FROM guesses g
        WHERE g.user_id = ${userId}::uuid AND g.score <> ${SCORE_CASE} ORDER BY g.created_at DESC`,
      this.prisma.$queryRaw<{ id: string; distance: number; expected: number }[]>`
        SELECT g.id, g.distance, ABS(gr."order" - cr."order")::int AS expected
        FROM guesses g JOIN clips c ON c.id = g.clip_id JOIN ranks cr ON cr.id = c.rank_id JOIN ranks gr ON gr.id = g.guessed_rank_id
        WHERE g.user_id = ${userId}::uuid AND g.distance <> ABS(gr."order" - cr."order") ORDER BY g.created_at DESC`,
      this.prisma.$queryRaw<{ id: string; score: number; xp_gained: number }[]>`
        SELECT g.id, g.score, g.xp_gained FROM guesses g
        WHERE g.user_id = ${userId}::uuid AND g.xp_gained > ${MAX_XP_SQL} ORDER BY g.created_at DESC`,
    ]);
    return [
      {
        code: "SCORE_RULE",
        title: "Scores conformes au barème",
        status: score.length ? "alert" : "ok",
        rule: `Chaque réponse doit valoir ${SCORE_STEPS.join(", ")} points pour 0, 1, 2 rangs d'écart, puis 0.`,
        finding: score.length ? `${score.length} réponse(s) ont un score différent du barème pour leur écart.` : "Toutes les réponses respectent le barème.",
        details: score.slice(0, 5).map((r) => `Écart ${r.distance} : ${r.score} points enregistrés au lieu de ${scoreForDistance(r.distance)}`),
        guessIds: score.slice(0, 20).map((r) => r.id),
      },
      {
        code: "DISTANCE_RULE",
        title: "Écarts conformes aux rangs",
        status: distance.length ? "warning" : "ok",
        rule: "L'écart enregistré doit correspondre à la différence de position entre le rang proposé et le rang du clip.",
        finding: distance.length
          ? `${distance.length} réponse(s) ont un écart différent. Cause possible : rang du clip corrigé ou échelle des rangs modifiée après la réponse.`
          : "Tous les écarts correspondent aux rangs.",
        details: distance.slice(0, 5).map((r) => `Écart enregistré ${r.distance}, écart actuel ${r.expected}`),
        guessIds: distance.slice(0, 20).map((r) => r.id),
      },
      {
        code: "XP_RULE",
        title: "XP gagnée plausible",
        status: xp.length ? "alert" : "ok",
        rule: `L'XP d'une réponse ne peut pas dépasser son score +50 % (série) puis ×${VIP_XP_MULTIPLIER} (VIP).`,
        finding: xp.length ? `${xp.length} réponse(s) rapportent plus d'XP que le maximum possible.` : "Aucune réponse au-dessus du maximum.",
        details: xp.slice(0, 5).map((r) => `Score ${r.score} : ${r.xp_gained} XP pour ${MAX_XP(r.score)} au maximum`),
        guessIds: xp.slice(0, 20).map((r) => r.id),
      },
    ];
  }

  /** Parties Infini : nombre de clips et score de partie cohérents avec les réponses enregistrées */
  private async infiniteRuns(userId: string): Promise<PlayerIndicatorDto> {
    const rows = await this.prisma.$queryRaw<{ id: string; score: number; clips_played: number; answers: number; base: number }[]>`
      SELECT r.id, r.score, r.clips_played, COUNT(g.id)::int AS answers, COALESCE(SUM(g.score), 0)::int AS base
      FROM infinite_runs r LEFT JOIN guesses g ON g.infinite_run_id = r.id
      WHERE r.user_id = ${userId}::uuid
      GROUP BY r.id, r.score, r.clips_played
      HAVING r.clips_played <> COUNT(g.id) OR r.score > CEIL(COALESCE(SUM(g.score), 0) * ${MAX_INFINITE_MULTIPLIER}::numeric)`;
    return {
      code: "INFINITE_RUNS",
      title: "Parties Infini cohérentes",
      status: rows.length ? "alert" : "ok",
      rule: `Le nombre de clips d'une partie doit égaler ses réponses, et son score ne peut pas dépasser la somme des points ×${MAX_INFINITE_MULTIPLIER} (difficulté maximale).`,
      finding: rows.length ? `${rows.length} partie(s) Infini incohérente(s).` : "Toutes les parties Infini sont cohérentes.",
      details: rows.slice(0, 5).map(
        (r) => `Partie ${r.id.slice(0, 8)} : ${r.clips_played} clip(s) pour ${r.answers} réponse(s), score ${r.score} (maximum ${Math.ceil(r.base * MAX_INFINITE_MULTIPLIER)})`,
      ),
      guessIds: [],
    };
  }

  /** Compteurs du compte comparés aux réponses enregistrées depuis la dernière remise à zéro */
  private async counters(user: { id: string; xp: number; level: number; totalGuesses: number; exactGuesses: number }, since: Date): Promise<PlayerIndicatorDto> {
    const userId = user.id;
    const [totals, games, achievementsXp, dailyScore] = await Promise.all([
      this.prisma.$queryRaw<{ guesses: number; exact: number; xp: number }[]>`
        SELECT COUNT(*)::int AS guesses, COUNT(*) FILTER (WHERE distance = 0)::int AS exact, COALESCE(SUM(xp_gained), 0)::int AS xp
        FROM guesses WHERE user_id = ${userId}::uuid AND created_at > ${utc(since)}`,
      this.prisma.$queryRaw<{ slug: string; s_guesses: number | null; s_exact: number | null; s_distance: number | null; s_score: number | null; guesses: number; exact: number; distance: number; score: number }[]>`
        WITH computed AS (
          SELECT c.game_id, COUNT(*)::int AS guesses, COUNT(*) FILTER (WHERE g.distance = 0)::int AS exact,
                 COALESCE(SUM(g.distance), 0)::int AS distance, COALESCE(SUM(g.score), 0)::int AS score
          FROM guesses g JOIN clips c ON c.id = g.clip_id
          WHERE g.user_id = ${userId}::uuid AND g.created_at > ${utc(since)} GROUP BY c.game_id
        )
        SELECT ga.slug, s.guesses AS s_guesses, s.exact AS s_exact, s.total_distance AS s_distance, s.total_score AS s_score,
               COALESCE(c.guesses, 0) AS guesses, COALESCE(c.exact, 0) AS exact, COALESCE(c.distance, 0) AS distance, COALESCE(c.score, 0) AS score
        FROM games ga
        LEFT JOIN user_game_stats s ON s.game_id = ga.id AND s.user_id = ${userId}::uuid
        LEFT JOIN computed c ON c.game_id = ga.id
        WHERE s.user_id IS NOT NULL OR c.game_id IS NOT NULL`,
      this.prisma.$queryRaw<{ xp: number }[]>`
        SELECT COALESCE(SUM(a.xp_reward), 0)::int AS xp FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
        WHERE ua.user_id = ${userId}::uuid`,
      this.prisma.$queryRaw<{ score: number }[]>`
        SELECT COALESCE(SUM(score), 0)::int AS score FROM guesses WHERE user_id = ${userId}::uuid AND mode = 'DAILY' AND created_at > ${utc(since)}`,
    ]);
    const t = totals[0];
    const expectedXp = (t?.xp ?? 0) + (achievementsXp[0]?.xp ?? 0);
    const boardScore = Number((await this.redis.zscore(this.leaderboards.key("all_time")!, userId)) ?? 0);
    const details: string[] = [];
    const check = (label: string, stored: number, computed: number) => {
      if (stored !== computed) details.push(`${label} : ${stored} enregistré(s), ${computed} d'après les réponses`);
    };
    check("Réponses", user.totalGuesses, t?.guesses ?? 0);
    check("Rangs exacts", user.exactGuesses, t?.exact ?? 0);
    check("XP (réponses + succès)", user.xp, expectedXp);
    check("Niveau", user.level, levelFromXp(user.xp).level);
    check("Classement général (points des défis du jour)", boardScore, dailyScore[0]?.score ?? 0);
    for (const g of games) {
      const name = GAME_NAMES[g.slug as GameSlug] ?? g.slug;
      check(`${name} : réponses`, g.s_guesses ?? 0, g.guesses);
      check(`${name} : rangs exacts`, g.s_exact ?? 0, g.exact);
      check(`${name} : écart cumulé`, g.s_distance ?? 0, g.distance);
      check(`${name} : points cumulés`, g.s_score ?? 0, g.score);
    }
    return {
      code: "COUNTERS",
      title: "Statistiques cohérentes avec les réponses",
      status: details.length ? "alert" : "ok",
      rule: "Les compteurs du compte (réponses, rangs exacts, XP, niveau, statistiques par jeu, classement général) sont recalculés à partir des réponses enregistrées depuis la dernière remise à zéro.",
      finding: details.length ? `${details.length} compteur(s) ne correspondent pas aux réponses enregistrées.` : "Tous les compteurs correspondent aux réponses enregistrées.",
      details,
      guessIds: [],
    };
  }

  /** Records du compte : chacun doit être justifié par des parties enregistrées ; modifications par l'équipe ou le système */
  private async records(user: { id: string; infiniteBest: number; bestWinStreak: number; bestDailyStreak: number }, since: Date): Promise<PlayerIndicatorDto[]> {
    const userId = user.id;
    const [bestRun, winStreak, dailyStreak, changes] = await Promise.all([
      this.prisma.$queryRaw<{ best: number }[]>`
        SELECT COALESCE(MAX(score), 0)::int AS best FROM infinite_runs
        WHERE user_id = ${userId}::uuid AND lives <= 0 AND ended_at > ${utc(since)}`,
      this.prisma.$queryRaw<{ best: number }[]>`
        WITH g AS (
          SELECT distance, SUM(CASE WHEN distance <> 0 THEN 1 ELSE 0 END) OVER (ORDER BY created_at, id) AS grp
          FROM guesses WHERE user_id = ${userId}::uuid AND created_at > ${utc(since)}
        )
        SELECT COALESCE(MAX(n), 0)::int AS best FROM (SELECT COUNT(*) FILTER (WHERE distance = 0) AS n FROM g GROUP BY grp) x`,
      this.prisma.$queryRaw<{ best: number }[]>`
        WITH d AS (
          SELECT DISTINCT created_at::date AS day FROM guesses
          WHERE user_id = ${userId}::uuid AND mode = 'DAILY' AND created_at > ${utc(since)}
        )
        SELECT COALESCE(MAX(n), 0)::int AS best FROM (
          SELECT COUNT(*) AS n FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM d) s GROUP BY grp
        ) x`,
      this.prisma.auditLog.groupBy({
        by: ["action"],
        where: { targetUserId: userId, action: { in: ["user.reset_stats", "record.infinite"] } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const details: string[] = [];
    if (user.infiniteBest !== (bestRun[0]?.best ?? 0)) {
      details.push(`Record Infini : ${user.infiniteBest} enregistré, meilleure partie terminée (3 vies perdues) : ${bestRun[0]?.best ?? 0}`);
    }
    if (user.bestWinStreak !== (winStreak[0]?.best ?? 0)) {
      details.push(`Meilleure série de victoires : ${user.bestWinStreak} enregistrée, ${winStreak[0]?.best ?? 0} d'après les réponses`);
    }
    if (user.bestDailyStreak !== (dailyStreak[0]?.best ?? 0)) {
      details.push(`Meilleure série de jours : ${user.bestDailyStreak} enregistrée, ${dailyStreak[0]?.best ?? 0} d'après les défis joués`);
    }
    const resets = changes.find((c) => c.action === "user.reset_stats");
    const infiniteRecords = changes.find((c) => c.action === "record.infinite");
    const history = [
      resets ? `${resets._count._all} remise(s) à zéro des statistiques par l'équipe, la dernière le ${resets._max.createdAt!.toLocaleDateString("fr-FR", { timeZone: "UTC" })}` : null,
      infiniteRecords ? `${infiniteRecords._count._all} nouveau(x) record(s) Infini enregistré(s) au journal` : null,
    ].filter((v): v is string => !!v);
    return [
      {
        code: "RECORDS",
        title: "Records justifiés par les parties",
        status: details.length ? "alert" : "ok",
        rule: "Record Infini (parties terminées, les parties abandonnées ne comptent pas), meilleure série de victoires (rangs exacts d'affilée) et meilleure série de jours sont recalculés à partir des parties enregistrées depuis la dernière remise à zéro.",
        finding: details.length ? `${details.length} record(s) ne correspondent à aucune partie enregistrée.` : "Chaque record correspond aux parties enregistrées.",
        details,
        guessIds: [],
      },
      {
        code: "RECORD_CHANGES",
        title: "Modifications des records et statistiques",
        status: history.length ? "info" : "ok",
        rule: "Remises à zéro par l'équipe et nouveaux records inscrits au journal d'audit (les records antérieurs à cet enregistrement ne peuvent pas être reconstitués).",
        finding: history.length ? history.join(" · ") : "Aucune modification inscrite au journal.",
        details: [],
        guessIds: [],
      },
    ];
  }

  /** Réponses en double : même partie, défi répondu un autre jour, ou double envoi immédiat */
  private async duplicates(userId: string): Promise<PlayerIndicatorDto> {
    const [same, otherDay, quick] = await Promise.all([
      this.prisma.$queryRaw<{ ids: string[] }[]>`
        SELECT ARRAY_AGG(id::text ORDER BY created_at) AS ids FROM guesses
        WHERE user_id = ${userId}::uuid
        GROUP BY clip_id, mode, COALESCE(daily_challenge_id, infinite_run_id, versus_match_id)
        HAVING COUNT(*) > 1 AND COALESCE(daily_challenge_id, infinite_run_id, versus_match_id) IS NOT NULL`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT g.id FROM guesses g JOIN daily_challenges d ON d.id = g.daily_challenge_id
        WHERE g.user_id = ${userId}::uuid AND g.created_at::date <> d.date`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT b.id FROM guesses a JOIN guesses b ON b.user_id = a.user_id AND b.clip_id = a.clip_id AND b.id <> a.id
          AND b.created_at >= a.created_at AND b.created_at - a.created_at < ${T.duplicateWindowMs}::int * INTERVAL '1 millisecond'
          AND (b.created_at > a.created_at OR b.id > a.id)
        WHERE a.user_id = ${userId}::uuid`,
    ]);
    const details = [
      same.length ? `${same.length} clip(s) répondus plusieurs fois dans la même partie` : null,
      otherDay.length ? `${otherDay.length} défi(s) du jour répondus un autre jour que celui du défi` : null,
      quick.length ? `${quick.length} réponse(s) au même clip envoyées moins de ${T.duplicateWindowMs / 1000} s après une autre` : null,
    ].filter((v): v is string => !!v);
    return {
      code: "DUPLICATES",
      title: "Réponses en double",
      status: details.length ? "alert" : "ok",
      rule: "Une seule réponse par clip et par partie (défi du jour, partie Infini, duel), le défi du jour répondu le jour même, pas de double envoi.",
      finding: details.length ? details.join(" · ") : "Aucune réponse en double.",
      details: [],
      guessIds: [...same.flatMap((s) => s.ids.slice(1)), ...otherDay.map((r) => r.id), ...quick.map((r) => r.id)].slice(0, 20),
    };
  }

  /** Taux de rangs exacts comparé à la moyenne des autres joueurs */
  private async accuracy(userId: string): Promise<PlayerIndicatorDto> {
    const [mine, others] = await Promise.all([
      this.prisma.$queryRaw<{ n: number; exact: number }[]>`
        SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE distance = 0)::int AS exact FROM guesses WHERE user_id = ${userId}::uuid`,
      this.prisma.$queryRaw<{ n: number; exact: number }[]>`
        SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE distance = 0)::int AS exact FROM guesses WHERE user_id <> ${userId}::uuid`,
    ]);
    const n = mine[0]?.n ?? 0;
    const rate = n ? (mine[0]?.exact ?? 0) / n : 0;
    const avg = others[0]?.n ? others[0].exact / others[0].n : 0;
    const enough = n >= T.minGuessesForAccuracy;
    const high = enough && rate >= T.accuracyFloor && rate >= avg * T.accuracyFactor;
    return {
      code: "ACCURACY",
      title: "Taux de rangs exacts",
      status: high ? "warning" : enough ? "ok" : "info",
      rule: `À partir de ${T.minGuessesForAccuracy} réponses : au moins ${pct(T.accuracyFloor)} de rangs exacts et au moins ${T.accuracyFactor} fois la moyenne des autres joueurs.`,
      finding: enough
        ? `${pct(rate)} de rangs exacts sur ${n} réponses (moyenne des autres joueurs : ${others[0]?.n ? pct(avg) : "pas encore de données"}).`
        : `${n} réponse(s) : pas assez pour comparer (${T.minGuessesForAccuracy} au minimum).`,
      details: [],
      guessIds: [],
    };
  }

  /** Rapidité des réponses exactes (temps mesuré par le serveur, et temps de visionnage déclaré) */
  private async speed(userId: string): Promise<PlayerIndicatorDto> {
    const rows = await this.prisma.$queryRaw<{ measured: number; fast: number; short_watch: number; exact: number; fast_ids: string[] | null }[]>`
      SELECT COUNT(*) FILTER (WHERE response_ms IS NOT NULL)::int AS measured,
             COUNT(*) FILTER (WHERE response_ms < ${T.fastResponseMs})::int AS fast,
             COUNT(*) FILTER (WHERE watched_ms < ${T.shortWatchMs})::int AS short_watch,
             COUNT(*)::int AS exact,
             (ARRAY_AGG(id::text ORDER BY created_at DESC) FILTER (WHERE response_ms < ${T.fastResponseMs}))[1:20] AS fast_ids
      FROM guesses WHERE user_id = ${userId}::uuid AND distance = 0`;
    const r = rows[0];
    const measured = r?.measured ?? 0;
    const share = measured ? (r?.fast ?? 0) / measured : 0;
    const flagged = (r?.fast ?? 0) >= T.minFastExact && share >= T.fastShare;
    return {
      code: "SPEED",
      title: "Réponses exactes très rapides",
      status: flagged ? "warning" : measured ? "ok" : "info",
      rule: `Rang exact reçu moins de ${T.fastResponseMs / 1000} s après la remise du clip (mesure du serveur). L'indicateur s'allume à partir de ${T.minFastExact} réponses et ${pct(T.fastShare)} des rangs exacts mesurés.`,
      finding: measured
        ? `${r?.fast ?? 0} rang(s) exact(s) très rapide(s) sur ${measured} mesuré(s) (${pct(share)}).`
        : "Aucune réponse exacte avec un temps mesuré (mesure enregistrée depuis cette mise à jour).",
      details: r?.short_watch ? [`${r.short_watch} rang(s) exact(s) sur ${r.exact} avec moins de ${T.shortWatchMs / 1000} s de visionnage déclaré par l'application`] : [],
      guessIds: r?.fast_ids ?? [],
    };
  }

  /** Volume d'activité : pic de réponses sur une heure */
  private async activity(userId: string): Promise<PlayerIndicatorDto> {
    const rows = await this.prisma.$queryRaw<{ hour: Date; n: number }[]>`
      SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS n FROM guesses
      WHERE user_id = ${userId}::uuid GROUP BY 1 ORDER BY n DESC, hour DESC LIMIT 3`;
    const days = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT created_at::date)::int AS n FROM guesses WHERE user_id = ${userId}::uuid`;
    const peak = rows[0];
    const flagged = !!peak && peak.n >= T.answersPerHour;
    return {
      code: "ACTIVITY",
      title: "Activité anormale",
      status: flagged ? "warning" : "ok",
      rule: `${T.answersPerHour} réponses ou plus dans une même heure (une toutes les 30 secondes pendant une heure entière).`,
      finding: peak
        ? `Pic : ${peak.n} réponse(s) le ${fmtHour(peak.hour)} · ${days[0]?.n ?? 0} jour(s) d'activité.`
        : "Aucune réponse enregistrée.",
      details: rows.slice(1).map((r) => `${r.n} réponse(s) le ${fmtHour(r.hour)}`),
      guessIds: [],
    };
  }
}
