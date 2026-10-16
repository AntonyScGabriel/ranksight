import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import {
  RATING_MIN_GAMES, RATING_PAIR_LIMIT, RATING_PAIR_WINDOW_HOURS, RATING_PROVISIONAL_GAMES, RATING_START, RATING_TIERS, placements, ratingDelta,
  type DuelRatingDto, type DuelResult, type MyRatingsDto, type RatingBoardDto, type RatingDto, type RatingScope, type RatingSeasonDto,
  type RatingSeasonsDto, type RatingTierKey, type SeasonArchiveDto, type SeasonResultDto,
} from "@ranksight/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { isVip, vipSelect } from "../shop/vip.js";

const HOUR_MS = 3_600_000;
const eligible = { games: { gte: RATING_MIN_GAMES }, user: { status: "ACTIVE" as const, deletedAt: null } };
type Reason = "PAIR_LIMIT" | "EARLY_FORFEIT";

/**
 * Rang et cote de départ de la saison suivante, calculés en SQL à partir de l'échelle partagée (aucun seuil recopié ici).
 * Même règle que `seasonResetRating` : seuil du rang atteint ; sans être classé, jamais au-dessus de la cote de départ.
 */
const tierSql = Prisma.raw(`CASE ${RATING_TIERS.map((t) => `WHEN cr.rating >= ${t.min} THEN '${t.key}'`).join(" ")} ELSE '${RATING_TIERS.at(-1)!.key}' END`);
const floorSql = Prisma.raw(`CASE ${RATING_TIERS.map((t) => `WHEN cr.rating >= ${t.min} THEN ${t.min}`).join(" ")} ELSE ${RATING_TIERS.at(-1)!.min} END`);
const rankedSql = Prisma.raw(`(cr.games >= ${RATING_MIN_GAMES} AND u.status = 'ACTIVE' AND u.deleted_at IS NULL)`);

/**
 * Classement compétitif : cote Elo par jeu et globale, mise à jour à la fin de chaque duel « au hasard » terminé.
 * Ne comptent jamais : les duels entre amis, les salons publics ou privés, les tournois, les duels annulés ou expirés.
 * L'admissibilité est décidée ici, d'après le duel enregistré en base (jamais d'après une valeur envoyée par le client).
 * Chaque duel n'est compté qu'une fois par joueur et par périmètre (contrainte d'unicité) ; contre un même adversaire,
 * seuls les 3 premiers duels sur 24 heures glissantes font bouger la cote (lignes verrouillées : résiste aux duels simultanés).
 * Le VIP n'intervient nulle part dans le calcul.
 *
 * Saisons : à la fin d'une saison (dates gérées dans l'administration), le classement final est archivé puis chaque cote
 * repart au seuil du rang atteint, dans une seule transaction et une seule fois (saison verrouillée, date de réinitialisation).
 */
@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Fin d'un duel : met à jour les cotes (sans effet si le duel n'est pas « au hasard », pas terminé, ou déjà compté).
   * Abandon : défaite pour celui qui abandonne. Avant la fin de la première manche, le gagnant n'est pas crédité (protection
   * contre les victoires arrangées) ; une déconnexion n'est jamais un abandon : le duel continue au chrono.
   */
  async recordDuel(matchId: string) {
    const m = await this.prisma.versusMatch.findUnique({
      where: { id: matchId },
      select: {
        random: true, status: true, creatorId: true, opponentId: true, winnerId: true, forfeitedById: true, currentRound: true,
        game: { select: { slug: true } },
      },
    });
    if (!m || !m.random || m.status !== "FINISHED" || !m.opponentId) return;
    const scopes: RatingScope[] = ["global", ...(m.game ? [m.game.slug as RatingScope] : [])];
    const resultOf = (uid: string): DuelResult => (m.winnerId === null ? "DRAW" : m.winnerId === uid ? "WIN" : "LOSS");
    const earlyForfeit = !!m.forfeitedById && m.currentRound <= 1;
    const excluded = (uid: string): Reason | null => (earlyForfeit && uid !== m.forfeitedById ? "EARLY_FORFEIT" : null);
    for (const scope of scopes) {
      try {
        await this.prisma.$transaction((tx) => this.apply(tx, scope, matchId, [m.creatorId, m.opponentId!], resultOf, excluded));
      } catch (e) {
        // Déjà compté (deux traitements simultanés du même duel) : la contrainte d'unicité a refusé le second
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
  }

  private async apply(
    tx: Prisma.TransactionClient, scope: RatingScope, matchId: string, players: [string, string],
    resultOf: (uid: string) => DuelResult, excluded: (uid: string) => Reason | null,
  ) {
    const done = await tx.ratingChange.count({ where: { matchId, scope } });
    if (done) return;
    // Lignes créées au besoin (sans erreur si un autre duel la crée au même moment), puis verrouillées dans un ordre fixe
    // (pas d'interblocage entre deux duels simultanés)
    const ordered = [...players].sort();
    for (const userId of ordered) {
      await tx.$executeRaw`
        INSERT INTO competitive_ratings (user_id, scope, rating, peak, updated_at)
        VALUES (${userId}::uuid, ${scope}, ${RATING_START}, ${RATING_START}, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT (user_id, scope) DO NOTHING`;
    }
    await tx.$queryRaw`SELECT 1 FROM competitive_ratings WHERE scope = ${scope} AND user_id = ANY(${ordered}::uuid[]) ORDER BY user_id FOR UPDATE`;
    const rows = await tx.competitiveRating.findMany({ where: { scope, userId: { in: players } } });
    const row = (uid: string) => rows.find((r) => r.userId === uid)!;
    const since = new Date(Date.now() - RATING_PAIR_WINDOW_HOURS * HOUR_MS);
    const plan = [];
    // Tout est calculé à partir des cotes d'avant le duel, puis écrit
    for (const [me, other] of [[players[0], players[1]], [players[1], players[0]]] as const) {
      const recent = await tx.ratingChange.count({ where: { userId: me, opponentId: other, scope, counted: true, createdAt: { gt: since } } });
      const reason: Reason | null = excluded(me) ?? (recent >= RATING_PAIR_LIMIT ? "PAIR_LIMIT" : null);
      const mine = row(me);
      const result = resultOf(me);
      const delta = reason ? 0 : ratingDelta(mine.rating, row(other).rating, result, mine.careerGames);
      plan.push({ me, other, mine, result, delta, reason });
    }
    for (const { me, other, mine, result, delta, reason } of plan) {
      await tx.ratingChange.create({
        data: { userId: me, scope, matchId, opponentId: other, result, before: mine.rating, after: mine.rating + delta, delta, counted: !reason, reason },
      });
      if (reason) continue;
      await tx.competitiveRating.update({
        where: { userId_scope: { userId: me, scope } },
        data: {
          rating: mine.rating + delta,
          peak: Math.max(mine.peak, mine.rating + delta),
          games: { increment: 1 },
          careerGames: { increment: 1 },
          ...(result === "WIN" ? { wins: { increment: 1 } } : result === "LOSS" ? { losses: { increment: 1 } } : { draws: { increment: 1 } }),
        },
      });
    }
  }

  /**
   * Chaque minute (une seule instance, verrou Redis) : duels au hasard terminés ces deux derniers jours sans cote calculée
   * (redémarrage de l'API au mauvais moment, par exemple), puis fin de saison du classement si une saison vient de se terminer.
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
        ORDER BY m.finished_at
        LIMIT 200`;
      for (const m of missing) await this.recordDuel(m.id);
    } catch (e) {
      this.logger.error("Rattrapage du classement compétitif impossible", e as Error);
    }
    await this.closeEndedSeasons();
  }

  /** Saisons terminées dont le classement compétitif n'a pas encore été archivé et réinitialisé */
  async closeEndedSeasons() {
    const ended = await this.prisma.season.findMany({
      where: { endsAt: { lt: new Date() }, competitiveResetAt: null },
      orderBy: { endsAt: "asc" },
      select: { id: true, name: true },
    });
    for (const s of ended) {
      try {
        const result = await this.closeSeason(s.id);
        if (result) this.logger.log(`${s.name} : classement compétitif archivé (${result.archived} cote(s)) et cotes réinitialisées`);
      } catch (e) {
        this.logger.error(`${s.name} : fin de saison du classement compétitif impossible`, e as Error);
      }
    }
  }

  /**
   * Fin de saison, une seule fois : la saison est verrouillée, puis — dans la même transaction — le classement final est
   * archivé (cote, rang, place, statistiques, cote de départ suivante), les cotes repartent au seuil du rang atteint et les
   * compteurs de la saison sont remis à zéro (les duels de carrière sont conservés). Une seconde exécution, simultanée ou
   * après un redémarrage, trouve la date de réinitialisation déjà posée et ne fait rien (null).
   */
  async closeSeason(seasonId: string): Promise<{ archived: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      const [season] = await tx.$queryRaw<{ ends_at: Date; competitive_reset_at: Date | null }[]>`
        SELECT ends_at, competitive_reset_at FROM seasons WHERE id = ${seasonId}::uuid FOR UPDATE`;
      if (!season || season.competitive_reset_at || season.ends_at.getTime() >= Date.now()) return null;
      const archived = await tx.$executeRaw`
        INSERT INTO competitive_season_results
          (season_id, user_id, scope, rating, peak, tier, placement, games, wins, losses, draws, reset_to)
        SELECT ${seasonId}::uuid, cr.user_id, cr.scope, cr.rating, cr.peak, ${tierSql},
          CASE WHEN ${rankedSql} THEN RANK() OVER (PARTITION BY cr.scope, ${rankedSql} ORDER BY cr.rating DESC) END,
          cr.games, cr.wins, cr.losses, cr.draws,
          CASE WHEN ${rankedSql} THEN ${floorSql} ELSE LEAST(${floorSql}, ${RATING_START}) END
        FROM competitive_ratings cr JOIN users u ON u.id = cr.user_id`;
      await tx.$executeRaw`
        UPDATE competitive_ratings cr SET rating = r.reset_to, peak = r.reset_to, games = 0, wins = 0, losses = 0, draws = 0,
          updated_at = (now() AT TIME ZONE 'UTC')
        FROM competitive_season_results r
        WHERE r.season_id = ${seasonId}::uuid AND r.user_id = cr.user_id AND r.scope = cr.scope`;
      await tx.$executeRaw`UPDATE seasons SET competitive_reset_at = (now() AT TIME ZONE 'UTC') WHERE id = ${seasonId}::uuid`;
      return { archived };
    }, { timeout: 120_000, maxWait: 10_000 });
  }

  // ---------- Lecture ----------

  private async currentSeason(): Promise<RatingSeasonDto | null> {
    const now = new Date();
    const s = await this.prisma.season.findFirst({ where: { startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { startsAt: "desc" } });
    return s ? { key: s.key, name: s.name, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() } : null;
  }

  async board(userId: string, scope: RatingScope, limit = 100): Promise<RatingBoardDto> {
    const rows = await this.prisma.competitiveRating.findMany({
      where: { scope, ...eligible },
      // Égalité de cote : même place ; à l'affichage, le joueur avec le plus de duels d'abord, puis par identifiant (ordre stable)
      orderBy: [{ rating: "desc" }, { games: "desc" }, { userId: "asc" }],
      take: limit,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true, ...vipSelect, ...flairSelect } } },
    });
    const ranks = placements(rows.map((r) => ({ id: r.userId, score: r.rating })));
    return {
      scope,
      season: await this.currentSeason(),
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
        result: h.result as DuelResult, before: h.before, after: h.after, delta: h.delta, counted: h.counted, reason: (h.reason as Reason | null) ?? null,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /** Variation de cote d'un duel pour un joueur (périmètre du jeu s'il y en a un, sinon global) */
  async forDuel(userId: string, matchId: string, gameSlug: string | null): Promise<DuelRatingDto | null> {
    const change = await this.prisma.ratingChange.findUnique({ where: { userId_scope_matchId: { userId, scope: gameSlug ?? "global", matchId } } });
    return change
      ? { scope: change.scope as RatingScope, before: change.before, after: change.after, delta: change.delta, counted: change.counted, reason: (change.reason as Reason | null) ?? null }
      : null;
  }

  private async ratingOf(userId: string, scope: RatingScope): Promise<RatingDto | null> {
    const r = await this.prisma.competitiveRating.findUnique({ where: { userId_scope: { userId, scope } } });
    if (!r) return null;
    const ranked = r.games >= RATING_MIN_GAMES;
    const above = ranked ? await this.prisma.competitiveRating.count({ where: { scope, ...eligible, rating: { gt: r.rating } } }) : 0;
    return {
      scope, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws,
      rank: ranked ? above + 1 : null,
      provisional: r.careerGames < RATING_PROVISIONAL_GAMES,
    };
  }

  // ---------- Archives des saisons ----------

  async seasons(userId: string): Promise<RatingSeasonsDto> {
    const [current, past, mine] = await Promise.all([
      this.currentSeason(),
      this.prisma.season.findMany({
        where: { competitiveResetAt: { not: null }, competitiveResults: { some: {} } },
        orderBy: { endsAt: "desc" },
      }),
      this.prisma.competitiveSeasonResult.findMany({ where: { userId }, include: { season: { select: { key: true } } } }),
    ]);
    return {
      current,
      past: past.map((s) => this.archivedSeason(s)),
      mine: past
        .map((s) => ({ season: s.key, results: mine.filter((r) => r.season.key === s.key).map((r) => this.resultDto(r)) }))
        .filter((m) => m.results.length),
    };
  }

  async archive(userId: string, key: string, scope: RatingScope, limit = 100): Promise<SeasonArchiveDto> {
    const season = await this.prisma.season.findUnique({ where: { key } });
    if (!season?.competitiveResetAt) throw new NotFoundException({ code: "SEASON_NOT_ARCHIVED", message: "Aucune archive pour cette saison." });
    const [entries, me] = await Promise.all([
      this.prisma.competitiveSeasonResult.findMany({
        where: { seasonId: season.id, scope, placement: { not: null } },
        orderBy: [{ placement: "asc" }, { games: "desc" }, { userId: "asc" }],
        take: limit,
        include: { user: { select: { displayName: true, avatarUrl: true } } },
      }),
      this.prisma.competitiveSeasonResult.findUnique({ where: { seasonId_userId_scope: { seasonId: season.id, userId, scope } } }),
    ]);
    return {
      season: this.archivedSeason(season),
      scope,
      entries: entries.map((e) => ({
        placement: e.placement!, userId: e.userId, displayName: e.user.displayName, avatarUrl: e.user.avatarUrl,
        rating: e.rating, tier: e.tier as RatingTierKey, games: e.games, wins: e.wins,
      })),
      me: me ? this.resultDto(me) : null,
    };
  }

  private archivedSeason(s: { key: string; name: string; startsAt: Date; endsAt: Date; competitiveResetAt: Date | null }) {
    return { key: s.key, name: s.name, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), closedAt: s.competitiveResetAt!.toISOString() };
  }

  private resultDto(r: {
    scope: string; rating: number; peak: number; tier: string; placement: number | null; games: number; wins: number; losses: number; draws: number; resetTo: number;
  }): SeasonResultDto {
    return {
      scope: r.scope as RatingScope, rating: r.rating, peak: r.peak, tier: r.tier as RatingTierKey, placement: r.placement,
      games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, resetTo: r.resetTo,
    };
  }
}
