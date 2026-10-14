import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import { GAME_SLUGS, type AdminSeasonDto, type ContributorsBoardDto, type ContributorsPeriod, type LeaderboardEntryDto, type LeaderboardGame, type LeaderboardPeriod, type LeaderboardScope } from "@ranksight/shared";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { FriendsService } from "../friends/friends.service.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { SeasonsService, seasonRewards, seasonStatus } from "./seasons.service.js";
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
    private readonly seasonsService: SeasonsService,
  ) { }

  /**
   * Clé Redis d'un classement ; `game` = "all" pour le cumul des 4 jeux (le mode Infini n'a qu'un classement).
   * Saison : celle en cours à cet instant, null entre deux saisons.
   */
  key(period: LeaderboardPeriod, at = new Date(), game: LeaderboardGame = "all"): string | null {
    const suffix = game === "all" || period === "infinite" ? "" : `:${game}`;
    if (period === "daily") return `lb:daily:${at.toISOString().slice(0, 10)}${suffix}`;
    if (period === "weekly") return `lb:weekly:${isoWeek(at)}${suffix}`;
    if (period === "season") {
      const season = this.seasonsService.keyAt(at);
      return season ? this.seasonBoardKey(season, game) : null;
    }
    return `lb:${period}${suffix}`;
  }

  /** Classement d'une saison donnée (en cours ou à clôturer) */
  seasonBoardKey(season: string, game: LeaderboardGame = "all") {
    return `lb:season:${season}${game === "all" ? "" : `:${game}`}`;
  }

  async recordScore(userId: string, points: number, game: LeaderboardGame) {
    if (points <= 0) return;
    const now = new Date();
    const keys: string[] = [];
    const pipe = this.redis.multi();
    const season = this.seasonsService.at(now);
    for (const scope of ["all", game] as const) {
      for (const period of ["daily", "weekly", "season", "all_time"] as const) {
        const key = this.key(period, now, scope);
        if (!key) continue; // entre deux saisons
        keys.push(key);
        pipe.zincrby(key, points, userId);
        if (period === "daily") pipe.expire(key, 3 * 86_400);
        if (period === "weekly") pipe.expire(key, 21 * 86_400);
        // Conservée 60 jours après la fin : la clôture peut avoir lieu plus tard (serveur arrêté)
        if (period === "season" && season) pipe.expire(key, Math.ceil((season.endsAt.getTime() - now.getTime()) / 1000) + 60 * 86_400);
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
    await this.redis.zadd(this.key("infinite")!, "GT", runScore, userId);
    this.gateway.notify(this.key("infinite")!);
  }

  async get(opts: {
    period: LeaderboardPeriod; scope: LeaderboardScope; game: LeaderboardGame; userId: string; limit: number; offset: number; season?: string;
  }): Promise<Board> {
    let key: string | null;
    if (opts.period === "season") {
      // Saison demandée, sinon celle en cours ; clôturée : lecture de l'archive
      const season = opts.season ? this.seasonsService.byKey(opts.season) : this.seasonsService.at();
      if (!season || seasonStatus(season) === "upcoming") return { entries: [], me: null };
      if (season.closedAt) return this.archivedSeason(season.key, opts);
      key = this.seasonBoardKey(season.key, opts.game);
    } else {
      key = this.key(opts.period, new Date(), opts.game);
    }
    if (!key) return { entries: [], me: null };
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
    return this.seasonsService.list();
  }

  /**
   * Classement des contributeurs, calculé depuis la base : clips proposés par les joueurs et acceptés
   * (toujours en ligne), comptés à la date d'acceptation. À égalité, le premier à atteindre ce nombre passe devant.
   */
  private async contributorRanking(period: ContributorsPeriod): Promise<{ userId: string; count: number }[]> {
    const info = period === "all" ? null : this.seasonsService.byKey(period);
    if (period !== "all" && !info) return [];
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
    const season = opts.period === "all" ? null : this.seasonsService.byKey(opts.period);
    const reward = season?.rewardsEnabled ? seasonRewards(season).contributor.name : null;
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
   * Vue d'administration : toutes les saisons (à venir comprises), de la plus récente à la plus ancienne, avec leur
   * statut, leurs récompenses, le nombre de joueurs classés et le top 10 du classement général.
   */
  async adminSeasons(): Promise<AdminSeasonDto[]> {
    // Lecture directe de la base pour l'équipe (modifications faites ailleurs comprises)
    await this.seasonsService.reload();
    const now = new Date();
    return Promise.all(
      [...this.seasonsService.all()].reverse().map(async (season) => {
        const status = seasonStatus(season, now);
        const base = {
          ...this.seasonsService.toDto(season, now),
          status,
          rewardsEnabled: season.rewardsEnabled,
          rewardsConfig: seasonRewards(season),
          closedAt: season.closedAt?.toISOString() ?? null,
        };
        if (status === "closed") {
          const [players, rows] = await Promise.all([
            this.prisma.leaderboardSnapshot.count({ where: { period: "SEASON", periodKey: season.key } }),
            this.prisma.leaderboardSnapshot.findMany({ where: { period: "SEASON", periodKey: season.key }, orderBy: { position: "asc" }, take: 10 }),
          ]);
          return { ...base, players, top: await this.hydrate(rows.map((r) => [r.userId, r.score] as [string, number]), 0) };
        }
        if (status === "upcoming") return { ...base, players: 0, top: [] };
        const key = this.seasonBoardKey(season.key);
        const [players, raw] = await Promise.all([this.redis.zcard(key), this.redis.zrevrange(key, 0, 9, "WITHSCORES")]);
        const pairs: [string, number][] = [];
        for (let i = 0; i < raw.length; i += 2) pairs.push([raw[i], Number(raw[i + 1])]);
        return { ...base, players, top: await this.hydrate(pairs, 0) };
      }),
    );
  }

  /**
   * Clôture d'une saison terminée : archive le classement complet (général et par jeu), puis, si la saison a des
   * récompenses, attribue les succès et récompenses de classement et le titre du meilleur contributeur.
   * Sans effet si la saison est déjà clôturée.
   */
  async closeSeason(key: string): Promise<{ season: string; players: number; alreadyClosed: boolean }> {
    await this.seasonsService.reload();
    const season = this.seasonsService.byKey(key);
    if (!season) throw new Error("Saison introuvable.");
    if (season.closedAt) return { season: key, players: await this.prisma.leaderboardSnapshot.count({ where: { period: "SEASON", periodKey: key } }), alreadyClosed: true };
    if (season.endsAt >= new Date()) throw new Error("Une saison en cours ou à venir ne peut pas être clôturée.");
    const lockKey = `lb:season-closing:${key}`;
    const lockToken = randomUUID();

    if (!(await this.redis.set(lockKey, lockToken, "EX", 600, "NX"))) {
      throw new ConflictException({ code: "SEASON_CLOSING", message: "La clôture de cette saison est déjà en cours. Réessaie dans quelques instants." });
    }
    try {
      let players = 0;
      for (const game of ["all", ...GAME_SLUGS] as const) {
        const raw = await this.redis.zrevrange(this.seasonBoardKey(key, game), 0, -1, "WITHSCORES");
        const data = [];
        for (let i = 0; i < raw.length; i += 2) {
          data.push({ period: "SEASON" as const, periodKey: snapshotKey(key, game), userId: raw[i], position: i / 2 + 1, score: Number(raw[i + 1]) });
        }
        if (data.length) await this.prisma.leaderboardSnapshot.createMany({ data, skipDuplicates: true });
        if (game === "all") {
          players = data.length;
          if (season.rewardsEnabled) await this.achievements.awardSeason(season, data.map((d) => ({ userId: d.userId, position: d.position })));
        }
      }
      if (season.rewardsEnabled) {
        const [contributor] = await this.contributorRanking(key);
        if (contributor) await this.achievements.awardSeasonContributor(season, contributor.userId);
      }
      await this.seasonsService.markClosed(key);
      this.logger.log(`${season.name} clôturée : ${players} joueur(s) classé(s)${season.rewardsEnabled ? ", récompenses attribuées" : ""}`);
      return { season: key, players, alreadyClosed: false };
    } finally {
      await this.redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        lockKey,
        lockToken,
      );
    }
  }

  /** Au démarrage et chaque heure : clôture les saisons terminées. */
  @Cron("7 * * * *", { timeZone: "UTC" })
  async closeEndedSeasons() {
    for (const season of this.seasonsService.toClose()) {
      try {
        const result = await this.closeSeason(season.key);
        // Clôture automatique : action du système, inscrite au journal
        if (!result.alreadyClosed) await this.audit.system("season.close", "season", season.key, result);
      } catch (e) {
        this.logger.error(`Clôture de ${season.name} impossible : ${(e as Error).message}`);
      }
    }
  }

  onApplicationBootstrap() {
    void this.closeEndedSeasons();
  }

  /** Chaque jour à 00:05 UTC : archive le top 1000 de la veille. */
  @Cron("5 0 * * *", { timeZone: "UTC" })
  async archiveYesterday() {
    const yesterday = new Date(Date.now() - 86_400_000);
    const periodKey = yesterday.toISOString().slice(0, 10);
    const raw = await this.redis.zrevrange(this.key("daily", yesterday)!, 0, 999, "WITHSCORES");
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
