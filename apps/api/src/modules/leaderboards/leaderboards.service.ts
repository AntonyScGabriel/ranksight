import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import { GAME_SLUGS, type ContributorsBoardDto, type ContributorsPeriod, type LeaderboardEntryDto, type LeaderboardGame, type LeaderboardPeriod, type LeaderboardScope } from "@ranksight/shared";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { FriendsService } from "../friends/friends.service.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { allSeasons, previousSeasonKey, seasonInfo, seasonKeyOf, seasonNumber } from "./seasons.js";
import { LeaderboardsGateway } from "./leaderboards.gateway.js";

/** Semaine ISO : 2026-W41 */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Classements en temps réel dans des sorted sets Redis (écriture O(log n), lecture paginée) :
 *   lb:daily:2026-10-05 · lb:weekly:2026-W41 · lb:season:2026-10 · lb:all_time · lb:infinite (meilleure partie)
 * Chaque défi du jour alimente le classement cumulé (4 jeux) et celui de son jeu :
 *   lb:daily:2026-10-05:valorant · lb:weekly:2026-W41:valorant · lb:season:2026-10:valorant · lb:all_time:valorant
 * Saison = mois civil. À sa clôture, le classement est archivé (leaderboard_snapshots, période SEASON)
 * et les succès de saison sont attribués.
 * Deux portées : mondiale (le sorted set) et amis (scores lus pour la liste d'amis).
 * Les classements journaliers clôturés sont archivés dans PostgreSQL (leaderboard_snapshots).
 */
type Board = { entries: LeaderboardEntryDto[]; me: { rank: number; score: number } | null };

@Injectable()
export class LeaderboardsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeaderboardsService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly gateway: LeaderboardsGateway,
    private readonly achievements: AchievementEngine,
    private readonly audit: AuditService,
  ) {}

  /** Clé Redis d'un classement ; `game` = "all" pour le cumul des 4 jeux (le mode Infini n'a qu'un classement). */
  key(period: LeaderboardPeriod, at = new Date(), game: LeaderboardGame = "all") {
    const suffix = game === "all" || period === "infinite" ? "" : `:${game}`;
    if (period === "daily") return `lb:daily:${at.toISOString().slice(0, 10)}${suffix}`;
    if (period === "weekly") return `lb:weekly:${isoWeek(at)}${suffix}`;
    if (period === "season") return `lb:season:${seasonKeyOf(at)}${suffix}`;
    return `lb:${period}${suffix}`;
  }

  async recordScore(userId: string, points: number, game: LeaderboardGame) {
    if (points <= 0) return;
    const now = new Date();
    const keys: string[] = [];
    const pipe = this.redis.multi();
    for (const scope of ["all", game] as const) {
      for (const period of ["daily", "weekly", "season", "all_time"] as const) {
        const key = this.key(period, now, scope);
        keys.push(key);
        pipe.zincrby(key, points, userId);
        if (period === "daily") pipe.expire(key, 3 * 86_400);
        if (period === "weekly") pipe.expire(key, 21 * 86_400);
        // Conservée au-delà du mois : la clôture peut avoir lieu quelques jours plus tard (serveur arrêté)
        if (period === "season") pipe.expire(key, 120 * 86_400);
      }
    }
    await pipe.exec();
    for (const key of keys) this.gateway.notify(key);
  }

  /** Retire un joueur de tous les classements en cours (remise à zéro de ses statistiques par l'équipe). */
  async removeUser(userId: string) {
    let cursor = "0";
    const touched: string[] = [];
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", "lb:*", "COUNT", 200);
      cursor = next;
      if (keys.length) {
        const pipe = this.redis.multi();
        for (const k of keys) pipe.zrem(k, userId);
        const res = (await pipe.exec()) ?? [];
        // Les clés qui ne sont pas des classements (verrous de clôture) renvoient une erreur de type : ignorées
        res.forEach(([err, removed], i) => !err && removed && touched.push(keys[i]));
      }
    } while (cursor !== "0");
    for (const key of touched) this.gateway.notify(key);
    return touched.length;
  }

  async recordInfiniteRun(userId: string, runScore: number) {
    await this.redis.zadd(this.key("infinite"), "GT", runScore, userId);
    this.gateway.notify(this.key("infinite"));
  }

  async get(opts: {
    period: LeaderboardPeriod; scope: LeaderboardScope; game: LeaderboardGame; userId: string; limit: number; offset: number; season?: string;
  }): Promise<Board> {
    // Saison passée et déjà clôturée : lecture de l'archive
    if (opts.period === "season" && opts.season && opts.season !== seasonKeyOf(new Date())) {
      const archived = await this.prisma.leaderboardSnapshot.count({ where: { period: "SEASON", periodKey: snapshotKey(opts.season, opts.game) } });
      if (archived > 0) return this.archivedSeason(opts.season, opts);
    }
    const at = opts.period === "season" && opts.season ? new Date(`${opts.season}-15T00:00:00Z`) : new Date();
    const key = this.key(opts.period, at, opts.game);
    if (opts.scope === "friends") return this.friendsBoard(key, opts.userId);

    const raw = await this.redis.zrevrange(key, opts.offset, opts.offset + opts.limit - 1, "WITHSCORES");
    const pairs: [string, number][] = [];
    for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], Number(raw[i + 1])]);

    const entries = await this.hydrate(pairs, opts.offset);
    const [rank, score] = await Promise.all([this.redis.zrevrank(key, opts.userId), this.redis.zscore(key, opts.userId)]);
    return { entries, me: rank === null ? null : { rank: rank + 1, score: Number(score) } };
  }

  private async friendsBoard(key: string, userId: string) {
    const ids = [userId, ...(await this.friends.friendIds(userId))];
    const scores = await this.redis.zmscore(key, ...ids);
    const pairs = ids
      .map((id, i) => [id, Number(scores[i] ?? 0)] as [string, number])
      .sort((a, b) => b[1] - a[1]);
    const entries = await this.hydrate(pairs, 0);
    const me = entries.find((e) => e.userId === userId);
    return { entries, me: me ? { rank: me.rank, score: me.score } : null };
  }

  private async hydrate(pairs: [string, number][], offset: number): Promise<LeaderboardEntryDto[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: pairs.map(([id]) => id) }, status: "ACTIVE" },
      select: { id: true, displayName: true, avatarUrl: true, ...vipSelect, ...flairSelect },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return pairs
      .filter(([id]) => byId.has(id))
      .map(([id, score], i) => {
        const u = byId.get(id)!;
        return { rank: offset + i + 1, userId: id, username: u.displayName, avatarUrl: u.avatarUrl, score, vip: isVip(u.subscription), flair: toFlair(u) };
      });
  }

  seasons() {
    return allSeasons();
  }

  /**
   * Classement des contributeurs, calculé depuis la base : clips proposés par les joueurs et acceptés
   * (toujours en ligne), comptés à la date d'acceptation. À égalité, le premier à atteindre ce nombre passe devant.
   */
  private async contributorRanking(period: ContributorsPeriod): Promise<{ userId: string; count: number }[]> {
    const info = period === "all" ? null : seasonInfo(period);
    const rows = await this.prisma.clip.groupBy({
      by: ["uploaderId"],
      where: {
        source: "COMMUNITY",
        status: "APPROVED",
        deletedAt: null,
        reviewedAt: info ? { gte: new Date(info.startsAt), lte: new Date(info.endsAt) } : { not: null },
      },
      _count: { _all: true },
      _max: { reviewedAt: true },
    });
    const active = new Set(
      (await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploaderId) }, status: "ACTIVE" }, select: { id: true } })).map((u) => u.id),
    );
    return rows
      .filter((r) => active.has(r.uploaderId))
      .sort((a, b) => b._count._all - a._count._all || (a._max.reviewedAt?.getTime() ?? 0) - (b._max.reviewedAt?.getTime() ?? 0))
      .map((r) => ({ userId: r.uploaderId, count: r._count._all }));
  }

  async contributors(opts: { period: ContributorsPeriod; scope: LeaderboardScope; userId: string; limit: number; offset: number }): Promise<ContributorsBoardDto> {
    let ranking = await this.contributorRanking(opts.period);
    const reward = opts.period === "all" ? null : `Contributeur saison ${seasonNumber(opts.period)}`;
    if (opts.scope === "friends") {
      const ids = new Set([opts.userId, ...(await this.friends.friendIds(opts.userId))]);
      ranking = ranking.filter((r) => ids.has(r.userId));
      const entries = await this.hydrate(ranking.map((r) => [r.userId, r.count] as [string, number]), 0);
      const me = entries.find((e) => e.userId === opts.userId);
      return { entries, me: me ? { rank: me.rank, score: me.score } : null, reward };
    }
    const page = ranking.slice(opts.offset, opts.offset + opts.limit);
    const entries = await this.hydrate(page.map((r) => [r.userId, r.count] as [string, number]), opts.offset);
    const mine = ranking.findIndex((r) => r.userId === opts.userId);
    return { entries, me: mine < 0 ? null : { rank: mine + 1, score: ranking[mine].count }, reward };
  }

  private async archivedSeason(
    season: string,
    opts: { scope: LeaderboardScope; game: LeaderboardGame; userId: string; limit: number; offset: number },
  ): Promise<Board> {
    const periodKey = snapshotKey(season, opts.game);
    const where = {
      period: "SEASON" as const,
      periodKey,
      ...(opts.scope === "friends" ? { userId: { in: [opts.userId, ...(await this.friends.friendIds(opts.userId))] } } : {}),
    };
    const rows = await this.prisma.leaderboardSnapshot.findMany({
      where,
      orderBy: { position: "asc" },
      ...(opts.scope === "friends" ? {} : { skip: opts.offset, take: opts.limit }),
      include: { user: { select: { displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } } },
    });
    const entries = rows
      .filter((r) => r.user.status === "ACTIVE")
      .map((r, i) => ({
        rank: opts.scope === "friends" ? i + 1 : r.position,
        userId: r.userId,
        username: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        score: r.score,
        vip: isVip(r.user.subscription),
        flair: toFlair(r.user),
      }));
    const mine = await this.prisma.leaderboardSnapshot.findUnique({
      where: { period_periodKey_userId: { period: "SEASON", periodKey, userId: opts.userId } },
    });
    const meFriends = entries.find((e) => e.userId === opts.userId);
    return {
      entries,
      me: opts.scope === "friends" ? (meFriends ? { rank: meFriends.rank, score: meFriends.score } : null) : mine ? { rank: mine.position, score: mine.score } : null,
    };
  }

  /**
   * Vue d'administration : toutes les saisons, de la plus récente à la saison 1, avec leur statut
   * (en cours, clôturée, à clôturer), le nombre de joueurs classés et le top 10 du classement général.
   */
  async adminSeasons() {
    const now = new Date();
    return Promise.all(
      allSeasons(now).map(async (season) => {
        const archived = await this.prisma.leaderboardSnapshot.count({ where: { period: "SEASON", periodKey: season.key } });
        if (archived > 0) {
          const rows = await this.prisma.leaderboardSnapshot.findMany({
            where: { period: "SEASON", periodKey: season.key },
            orderBy: { position: "asc" },
            take: 10,
          });
          const top = await this.hydrate(rows.map((r) => [r.userId, r.score] as [string, number]), 0);
          const closedAt = await this.prisma.auditLog.findFirst({ where: { action: "season.close", entityId: season.key }, orderBy: { createdAt: "desc" } });
          return { ...season, status: "closed" as const, players: archived, top, closedAt: closedAt?.createdAt.toISOString() ?? rows[0]?.createdAt.toISOString() ?? null };
        }
        const key = this.key("season", new Date(`${season.key}-15T00:00:00Z`));
        const [players, raw] = await Promise.all([this.redis.zcard(key), this.redis.zrevrange(key, 0, 9, "WITHSCORES")]);
        const pairs: [string, number][] = [];
        for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], Number(raw[i + 1])]);
        return {
          ...season,
          status: season.current ? ("current" as const) : ("to_close" as const),
          players,
          top: await this.hydrate(pairs, 0),
          closedAt: null,
        };
      }),
    );
  }

  /**
   * Clôture d'une saison : archive le classement complet (général et par jeu)
   * puis attribue les succès de saison d'après le classement général, et le titre du meilleur contributeur. Sans effet si la saison est déjà archivée.
   */
  async closeSeason(season: string): Promise<{ season: string; players: number; alreadyClosed: boolean }> {
    if (season >= seasonKeyOf(new Date())) throw new Error("Une saison en cours ne peut pas être clôturée.");
    const lockKey = `lb:season-closing:${season}`;
    if (!(await this.redis.set(lockKey, "1", "EX", 600, "NX"))) return { season, players: 0, alreadyClosed: true };
    try {
      const done = await this.prisma.leaderboardSnapshot.count({ where: { period: "SEASON", periodKey: season } });
      if (done > 0) return { season, players: done, alreadyClosed: true };

      const at = new Date(`${season}-15T00:00:00Z`);
      let players = 0;
      for (const game of ["all", ...GAME_SLUGS] as const) {
        const raw = await this.redis.zrevrange(this.key("season", at, game), 0, -1, "WITHSCORES");
        const data = [];
        for (let i = 0; i < raw.length; i += 2) {
          data.push({ period: "SEASON" as const, periodKey: snapshotKey(season, game), userId: raw[i], position: i / 2 + 1, score: Number(raw[i + 1]) });
        }
        if (data.length) await this.prisma.leaderboardSnapshot.createMany({ data, skipDuplicates: true });
        if (game === "all") {
          players = data.length;
          await this.achievements.awardSeason(seasonNumber(season), data.map((d) => ({ userId: d.userId, position: d.position })));
        }
      }
      const [contributor] = await this.contributorRanking(season);
      if (contributor) await this.achievements.awardSeasonContributor(seasonNumber(season), contributor.userId);
      this.logger.log(`Saison ${season} clôturée : ${players} joueur(s) classé(s)`);
      return { season, players, alreadyClosed: false };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /** Au démarrage et chaque jour à 00:10 UTC : clôture la saison précédente si ce n'est pas déjà fait. */
  @Cron("10 0 * * *", { timeZone: "UTC" })
  async closePreviousSeason() {
    const previous = previousSeasonKey(seasonKeyOf(new Date()));
    if (seasonNumber(previous) < 1) return;
    try {
      const result = await this.closeSeason(previous);
      // Clôture automatique : action du système, inscrite au journal
      if (!result.alreadyClosed) await this.audit.system("season.close", "season", previous, result);
    } catch (e) {
      this.logger.error(`Clôture de la saison ${previous} impossible : ${(e as Error).message}`);
    }
  }

  onApplicationBootstrap() {
    void this.closePreviousSeason();
  }

  /** Chaque jour à 00:05 UTC : archive le top 1000 de la veille. */
  @Cron("5 0 * * *", { timeZone: "UTC" })
  async archiveYesterday() {
    const yesterday = new Date(Date.now() - 86_400_000);
    const periodKey = yesterday.toISOString().slice(0, 10);
    const raw = await this.redis.zrevrange(this.key("daily", yesterday), 0, 999, "WITHSCORES");
    const data = [];
    for (let i = 0; i < raw.length; i += 2) {
      data.push({ period: "DAILY" as const, periodKey, userId: raw[i], position: i / 2 + 1, score: Number(raw[i + 1]) });
    }
    if (data.length) await this.prisma.leaderboardSnapshot.createMany({ data, skipDuplicates: true });
  }
}

/** Clé d'archive d'une saison : "2026-10" (général) ou "2026-10:valorant" (par jeu) */
function snapshotKey(season: string, game: LeaderboardGame) {
  return game === "all" ? season : `${season}:${game}`;
}
