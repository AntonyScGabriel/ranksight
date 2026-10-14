import { Injectable, Logger } from "@nestjs/common";
import { levelFromXp, type CosmeticRefDto } from "@ranksight/shared";
import type { SeasonRecord } from "../cosmetics/cosmetics.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CosmeticsService } from "../cosmetics/cosmetics.service.js";

export type Criteria =
  | { type: "total_guesses"; threshold: number }
  | { type: "exact_guesses"; threshold: number }
  | { type: "daily_streak"; threshold: number }
  | { type: "win_streak"; threshold: number }
  | { type: "level"; threshold: number }
  | { type: "infinite_score"; threshold: number }
  | { type: "game_exact"; game: string; threshold: number }
  | { type: "game_accuracy"; game: string; minGuesses: number; maxAvgDistance: number }
  | { type: "daily_full_days"; threshold: number }
  | { type: "daily_perfect_days"; threshold: number }
  | { type: "friends"; threshold: number }
  | { type: "accepted_clips"; threshold: number }
  | { type: "versus_wins"; threshold: number }
  | { type: "season_rank"; maxRank: number; season?: number };

/** DonnÃ©es du joueur nÃ©cessaires pour mesurer l'avancement de tous les succÃ¨s. */
interface Snapshot {
  totalGuesses: number;
  exactGuesses: number;
  bestDailyStreak: number;
  bestWinStreak: number;
  level: number;
  infiniteBest: number;
  gameStats: Map<string, { guesses: number; exact: number; totalDistance: number }>;
  dailyFullDays: number;
  dailyPerfectDays: number;
  friends: number;
  acceptedClips: number;
  versusWins: number;
}

/**
 * Moteur de succÃ¨s pilotÃ© par la donnÃ©e : chaque succÃ¨s a un `criteria` JSON (crÃ©able depuis l'administration
 * sans redÃ©ploiement). Ã‰valuÃ© aprÃ¨s chaque rÃ©ponse ; les succÃ¨s de saison sont attribuÃ©s Ã  la clÃ´ture du mois.
 */
@Injectable()
export class AchievementEngine {
  private readonly logger = new Logger(AchievementEngine.name);

  constructor(private readonly prisma: PrismaService, private readonly cosmetics: CosmeticsService) {}

  /** Avancement d'un succÃ¨s : valeur actuelle et objectif. null = non mesurable en continu (succÃ¨s de saison). */
  measure(c: Criteria, s: Snapshot): { current: number; target: number } | null {
    switch (c.type) {
      case "total_guesses": return { current: s.totalGuesses, target: c.threshold };
      case "exact_guesses": return { current: s.exactGuesses, target: c.threshold };
      case "daily_streak": return { current: s.bestDailyStreak, target: c.threshold };
      case "win_streak": return { current: s.bestWinStreak, target: c.threshold };
      case "level": return { current: s.level, target: c.threshold };
      case "infinite_score": return { current: s.infiniteBest, target: c.threshold };
      case "game_exact": return { current: s.gameStats.get(c.game)?.exact ?? 0, target: c.threshold };
      case "game_accuracy": {
        const g = s.gameStats.get(c.game);
        const ok = !!g && g.guesses >= c.minGuesses && g.totalDistance / g.guesses <= c.maxAvgDistance;
        return { current: ok ? c.minGuesses : Math.min(g?.guesses ?? 0, c.minGuesses - 1), target: c.minGuesses };
      }
      case "daily_full_days": return { current: s.dailyFullDays, target: c.threshold };
      case "daily_perfect_days": return { current: s.dailyPerfectDays, target: c.threshold };
      case "friends": return { current: s.friends, target: c.threshold };
      case "accepted_clips": return { current: s.acceptedClips, target: c.threshold };
      case "versus_wins": return { current: s.versusWins, target: c.threshold };
      default: return null;
    }
  }

  async snapshot(userId: string): Promise<Snapshot> {
    const [user, gameStats, days, friends, acceptedClips, versusWins] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { totalGuesses: true, exactGuesses: true, bestDailyStreak: true, bestWinStreak: true, level: true, infiniteBest: true, statsResetAt: true },
      }),
      this.prisma.userGameStats.findMany({ where: { userId }, include: { game: { select: { slug: true } } } }),
      // Jours oÃ¹ le joueur a jouÃ© tous les dÃ©fis du jour (tous les jeux actifs, chacun de leurs dÃ©fis), et combien de ces
      // jours sans aucune erreur
      this.prisma.$queryRaw<{ full_days: bigint; perfect_days: bigint }[]>`
        WITH per_day AS (
          SELECT d.date, COUNT(*) AS played, COUNT(*) FILTER (WHERE gu.distance = 0) AS exact
          FROM guesses gu
          JOIN daily_challenges d ON d.id = gu.daily_challenge_id
          JOIN games g ON g.id = d.game_id AND g.is_active
          JOIN users u ON u.id = gu.user_id
          WHERE gu.user_id = ${userId}::uuid AND (u.stats_reset_at IS NULL OR gu.created_at > u.stats_reset_at)
          GROUP BY d.date
        ), offered AS (
          SELECT d.date, COUNT(*) AS n
          FROM daily_challenges d JOIN games g ON g.id = d.game_id AND g.is_active
          WHERE d.date IN (SELECT date FROM per_day)
          GROUP BY d.date
        )
        SELECT COUNT(*) FILTER (WHERE p.played >= o.n) AS full_days,
               COUNT(*) FILTER (WHERE p.played >= o.n AND p.exact >= o.n) AS perfect_days
        FROM per_day p JOIN offered o ON o.date = p.date`,
      this.prisma.friendship.count({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      this.prisma.clip.count({ where: { uploaderId: userId, source: "COMMUNITY", status: "APPROVED" } }),
      this.prisma.versusMatch.findMany({ where: { status: "FINISHED", winnerId: userId }, select: { finishedAt: true } }),
    ]);
    const { statsResetAt, ...counters } = user;
    return {
      ...counters,
      gameStats: new Map(gameStats.map((g) => [g.game.slug, g])),
      dailyFullDays: Number(days[0]?.full_days ?? 0),
      dailyPerfectDays: Number(days[0]?.perfect_days ?? 0),
      friends,
      acceptedClips,
      // AprÃ¨s une remise Ã  zÃ©ro par l'Ã©quipe, seuls les duels gagnÃ©s depuis comptent
      versusWins: versusWins.filter((m) => !statsResetAt || (m.finishedAt && m.finishedAt > statsResetAt)).length,
    };
  }

  /** Ã‰value les succÃ¨s non encore obtenus et attribue ceux qui sont atteints (avec leur bonus d'XP). */
  async evaluate(userId: string) {
    return (await this.evaluateWithRewards(userId)).achievements;
  }

  /**
   * SuccÃ¨s atteints, puis rÃ©compenses (titres, badges, cadres) dÃ©bloquÃ©es par un palier de niveau ou par un succÃ¨s.
   * AppelÃ© aprÃ¨s chaque partie : le niveau a pu changer mÃªme sans nouveau succÃ¨s.
   */
  async evaluateWithRewards(userId: string): Promise<{ achievements: { code: string; name: string; iconUrl: string | null }[]; rewards: CosmeticRefDto[] }> {
    const [unlocked, candidates] = await Promise.all([
      this.prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
      this.prisma.achievement.findMany({ where: { isActive: true } }),
    ]);
    const owned = new Set(unlocked.map((u) => u.achievementId));
    const pending = candidates.filter((a) => !owned.has(a.id));
    let achievements: { code: string; name: string; iconUrl: string | null }[] = [];
    if (pending.length) {
      const snap = await this.snapshot(userId);
      const newly = pending.filter((a) => {
        const m = this.measure(a.criteria as Criteria, snap);
        return !!m && m.current >= m.target;
      });
      achievements = await this.grant(userId, newly);
    }
    return { achievements, rewards: await this.cosmetics.sync(userId) };
  }

  /**
   * ClÃ´ture d'une saison : attribue les succÃ¨s de type season_rank aux joueurs classÃ©s
   * (positions du classement gÃ©nÃ©ral de la saison, tous jeux confondus).
   */
  /**
   * ClÃ´ture d'une saison avec rÃ©compenses : succÃ¨s de classement (Â« Champion de saison Â», ou d'une saison prÃ©cise par
   * son numÃ©ro), puis titres et badge de la saison.
   */
  async awardSeason(season: SeasonRecord, ranking: { userId: string; position: number }[]) {
    const seasonal = (await this.prisma.achievement.findMany({ where: { isActive: true } })).filter((a) => {
      const c = a.criteria as Criteria;
      return c.type === "season_rank" && (c.season === undefined || c.season === season.number);
    });
    let granted = 0;
    for (const { userId, position } of ranking) {
      const eligible = seasonal.filter((a) => position <= (a.criteria as { maxRank: number }).maxRank);
      if (!eligible.length) continue;
      const owned = new Set(
        (await this.prisma.userAchievement.findMany({ where: { userId, achievementId: { in: eligible.map((a) => a.id) } } })).map((u) => u.achievementId),
      );
      granted += (await this.grant(userId, eligible.filter((a) => !owned.has(a.id)))).length;
    }
    if (granted) this.logger.log(`${season.name} : ${granted} succÃ¨s attribuÃ©s`);
    await this.cosmetics.awardSeason(season, ranking);
    // Les succÃ¨s de saison peuvent dÃ©bloquer des rÃ©compenses
    for (const { userId } of ranking.filter((r) => r.position <= 10)) await this.cosmetics.sync(userId);
  }

  /** Titre du meilleur contributeur de la saison (le plus de clips acceptÃ©s) */
  awardSeasonContributor(season: SeasonRecord, userId: string) {
    return this.cosmetics.awardSeasonContributor(season, userId);
  }


  private async grant(userId: string, achievements: { id: string; code: string; name: string; iconUrl: string | null; xpReward: number }[]) {
    if (!achievements.length) return [];

    const granted = await this.prisma.$transaction(async (tx) => {
      const newlyGranted: typeof achievements = [];
      let xp = 0;

      for (const achievement of achievements) {
        const result = await tx.userAchievement.createMany({
          data: [{ userId, achievementId: achievement.id }],
          skipDuplicates: true,
        });

        if (result.count > 0) {
          newlyGranted.push(achievement);
          xp += achievement.xpReward;
        }
      }

      if (xp > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { xp: { increment: xp } },
        });

        const { xp: total } = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { xp: true },
        });

        await tx.user.update({
          where: { id: userId },
          data: { level: levelFromXp(total).level },
        });
      }

      return newlyGranted;
    });

    return granted.map((a) => ({
      code: a.code,
      name: a.name,
      iconUrl: a.iconUrl,
    }));
  }
}
