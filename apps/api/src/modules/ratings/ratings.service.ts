import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import {
  RATING_MIN_GAMES, RATING_PAIR_LIMIT, placements, ratingDelta,
  type DuelRatingDto, type DuelResult, type MyRatingsDto, type RatingBoardDto, type RatingDto, type RatingScope,
} from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { isVip, vipSelect } from "../shop/vip.js";

const DAY_MS = 86_400_000;
const eligible = { games: { gte: RATING_MIN_GAMES }, user: { status: "ACTIVE" as const, deletedAt: null } };

/**
 * Classement compétitif : cote Elo par jeu et globale, mise à jour à la fin de chaque duel « au hasard »
 * (jamais les duels entre amis, salons ou tournois). Chaque duel n'est compté qu'une fois par joueur et par périmètre
 * (contrainte d'unicité), et contre un même adversaire seuls les premiers duels de 24 heures font bouger la cote.
 * Le VIP n'intervient nulle part dans le calcul.
 */
@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Fin d'un duel : met à jour les cotes (sans effet si le duel n'est pas « au hasard », pas terminé, ou déjà compté). */
  async recordDuel(matchId: string) {
    const m = await this.prisma.versusMatch.findUnique({
      where: { id: matchId },
      select: { random: true, status: true, creatorId: true, opponentId: true, winnerId: true, game: { select: { slug: true } } },
    });
    if (!m || !m.random || m.status !== "FINISHED" || !m.opponentId) return;
    const scopes: RatingScope[] = ["global", ...(m.game ? [m.game.slug as RatingScope] : [])];
    const resultOf = (uid: string): DuelResult => (m.winnerId === null ? "DRAW" : m.winnerId === uid ? "WIN" : "LOSS");
    for (const scope of scopes) {
      try {
        await this.prisma.$transaction((tx) => this.apply(tx, scope, matchId, [m.creatorId, m.opponentId!], resultOf));
      } catch (e) {
        // Déjà compté (deux traitements simultanés du même duel) : la contrainte d'unicité a refusé le second
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
  }

  private async apply(
    tx: Prisma.TransactionClient, scope: RatingScope, matchId: string, players: [string, string], resultOf: (uid: string) => DuelResult,
  ) {
    const done = await tx.ratingChange.count({ where: { matchId, scope } });
    if (done) return;
    // Lignes créées au besoin puis verrouillées dans un ordre fixe (pas d'interblocage entre deux duels simultanés)
    const ordered = [...players].sort();
    for (const userId of ordered) {
      await tx.competitiveRating.upsert({ where: { userId_scope: { userId, scope } }, create: { userId, scope }, update: {} });
    }
    await tx.$queryRaw`SELECT 1 FROM competitive_ratings WHERE scope = ${scope} AND user_id = ANY(${ordered}::uuid[]) ORDER BY user_id FOR UPDATE`;
    const rows = await tx.competitiveRating.findMany({ where: { scope, userId: { in: players } } });
    const row = (uid: string) => rows.find((r) => r.userId === uid)!;
    const [a, b] = players;
    // Anti-arrangement : au-delà de la limite contre ce même adversaire sur 24 heures, le duel ne compte plus
    const recent = await tx.ratingChange.count({
      where: { userId: a, opponentId: b, scope, counted: true, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    const counted = recent < RATING_PAIR_LIMIT;
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const mine = row(me);
      const result = resultOf(me);
      const delta = counted ? ratingDelta(mine.rating, row(other).rating, result, mine.games) : 0;
      await tx.ratingChange.create({
        data: { userId: me, scope, matchId, opponentId: other, result, before: mine.rating, after: mine.rating + delta, delta, counted },
      });
      if (!counted) continue;
      await tx.competitiveRating.update({
        where: { userId_scope: { userId: me, scope } },
        data: {
          rating: mine.rating + delta,
          peak: Math.max(mine.peak, mine.rating + delta),
          games: { increment: 1 },
          ...(result === "WIN" ? { wins: { increment: 1 } } : result === "LOSS" ? { losses: { increment: 1 } } : { draws: { increment: 1 } }),
        },
      });
    }
  }

  /**
   * Rattrapage chaque minute (une seule instance, verrou Redis) : duels au hasard terminés ces deux derniers jours
   * sans cote calculée (redémarrage de l'API au mauvais moment, par exemple).
   */
  @Interval(60_000)
  async catchUp() {
    const lock = await this.redis.set("ratings:catchup", "1", "PX", 55_000, "NX").catch(() => null);
    if (!lock) return;
    try {
      const missing = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM versus_matches m
        WHERE m.random AND m.status = 'FINISHED' AND m.opponent_id IS NOT NULL AND m.finished_at > (now() at time zone 'utc') - interval '2 days'
          AND NOT EXISTS (SELECT 1 FROM rating_changes rc WHERE rc.match_id = m.id AND rc.scope = 'global')
        LIMIT 200`;
      for (const m of missing) await this.recordDuel(m.id);
    } catch (e) {
      this.logger.error("Rattrapage du classement compétitif impossible", e as Error);
    }
  }

  // ---------- Lecture ----------

  async board(userId: string, scope: RatingScope, limit = 100): Promise<RatingBoardDto> {
    const rows = await this.prisma.competitiveRating.findMany({
      where: { scope, ...eligible },
      orderBy: [{ rating: "desc" }, { games: "desc" }],
      take: limit,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true, ...vipSelect, ...flairSelect } } },
    });
    // Cotes égales : même place
    const ranks = placements(rows.map((r) => ({ id: r.userId, score: r.rating })));
    return {
      scope,
      entries: rows.map((r) => ({
        rank: ranks.get(r.userId)!, userId: r.userId, displayName: r.user.displayName, avatarUrl: r.user.avatarUrl,
        vip: isVip(r.user.subscription), flair: toFlair(r.user), rating: r.rating, games: r.games, wins: r.wins,
      })),
      me: await this.ratingOf(userId, scope),
    };
  }

  async mine(userId: string): Promise<MyRatingsDto> {
    const [rows, history] = await Promise.all([
      this.prisma.competitiveRating.findMany({ where: { userId }, orderBy: { scope: "asc" } }),
      this.prisma.ratingChange.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const opponents = await this.prisma.user.findMany({ where: { id: { in: [...new Set(history.map((h) => h.opponentId))] } }, select: { id: true, displayName: true } });
    return {
      ratings: await Promise.all(rows.map((r) => this.ratingOf(userId, r.scope as RatingScope))).then((list) => list.filter((x): x is RatingDto => !!x)),
      history: history.map((h) => ({
        scope: h.scope as RatingScope, matchId: h.matchId, opponent: opponents.find((o) => o.id === h.opponentId)?.displayName ?? "Joueur supprimé",
        result: h.result as DuelResult, before: h.before, after: h.after, delta: h.delta, counted: h.counted, createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /** Variation de cote d'un duel pour un joueur (périmètre du jeu s'il y en a un, sinon global) */
  async forDuel(userId: string, matchId: string, gameSlug: string | null): Promise<DuelRatingDto | null> {
    const change = await this.prisma.ratingChange.findUnique({ where: { userId_scope_matchId: { userId, scope: gameSlug ?? "global", matchId } } });
    return change ? { scope: change.scope as RatingScope, before: change.before, after: change.after, delta: change.delta, counted: change.counted } : null;
  }

  private async ratingOf(userId: string, scope: RatingScope): Promise<RatingDto | null> {
    const r = await this.prisma.competitiveRating.findUnique({ where: { userId_scope: { userId, scope } } });
    if (!r) return null;
    const ranked = r.games >= RATING_MIN_GAMES;
    const above = ranked ? await this.prisma.competitiveRating.count({ where: { scope, ...eligible, rating: { gt: r.rating } } }) : 0;
    return {
      scope, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws,
      rank: ranked ? above + 1 : null,
    };
  }
}
