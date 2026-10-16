import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import { levelFromXp } from "@ranksight/shared";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";

const SEC = 1000;

/**
 * Duel et salon : l'XP, le niveau, les statistiques et les succès d'une réponse ne sont appliqués
 * qu'une fois sa manche révélée. Sinon, le profil du joueur (XP, réponses exactes) dévoilerait
 * le résultat avant la fin de la manche. Reprend aussi les réponses en attente après un redémarrage.
 */
@Injectable()
export class GuessStatsService {
  private readonly logger = new Logger(GuessStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly achievements: AchievementEngine,
  ) {}

  /** Chaque seconde (une seule instance à la fois, verrou Redis) : réponses dont la manche est terminée. */
  @Interval(SEC)
  async tick() {
    const lock = await this.redis.set("guesses:stats", "1", "PX", 900, "NX").catch(() => null);
    if (!lock) return;
    const ready = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM guesses g
      LEFT JOIN rooms r ON r.id = g.room_id
      LEFT JOIN room_rounds rr ON rr.room_id = g.room_id AND (rr.clip_id = g.clip_id OR rr.alt_clip_id = g.clip_id)
      LEFT JOIN versus_matches v ON v.id = g.versus_match_id
      LEFT JOIN versus_clips vc ON vc.match_id = g.versus_match_id AND vc.clip_id = g.clip_id
      WHERE g.stats_pending
        AND (
          (g.room_id IS NOT NULL AND (r.status <> 'ACTIVE' OR rr.position < r.current_round - 1))
          OR (g.versus_match_id IS NOT NULL AND (v.status <> 'ACTIVE' OR vc.position < v.current_round - 1))
        )
      ORDER BY g.created_at
      LIMIT 500`;
    const users = new Set<string>();
    for (const { id } of ready) {
      try {
        const userId = await this.apply(id);
        if (userId) users.add(userId);
      } catch (e) {
        this.logger.error(`Réponse ${id} : statistiques non appliquées`, e as Error);
      }
    }
    for (const userId of users) {
      await this.achievements.evaluateWithRewards(userId).catch((e) => this.logger.error(`Succès de ${userId} non évalués`, e as Error));
    }
  }

  /** Applique une réponse une seule fois (mise à jour conditionnelle), même si deux instances s'en chargent. */
  async apply(guessId: string): Promise<string | null> {
    const applied = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.guess.updateMany({ where: { id: guessId, statsPending: true }, data: { statsPending: false } });
      if (!count) return null;
      const g = await tx.guess.findUniqueOrThrow({
        where: { id: guessId },
        select: { userId: true, clipId: true, guessedRankId: true, distance: true, score: true, xpGained: true, createdAt: true, clip: { select: { gameId: true } } },
      });
      const [user] = await tx.$queryRaw<{ xp: number; win_streak: number; best_win_streak: number; stats_reset_at: Date | null }[]>`
        SELECT xp, win_streak, best_win_streak, stats_reset_at FROM users WHERE id = ${g.userId}::uuid FOR UPDATE`;
      // Statistiques remises à zéro entre la réponse et la révélation : la réponse ne compte plus
      if (!user || (user.stats_reset_at && g.createdAt <= user.stats_reset_at)) return g;
      const exact = g.distance === 0;
      const winStreak = exact ? user.win_streak + 1 : 0;
      await tx.user.update({
        where: { id: g.userId },
        data: {
          xp: { increment: g.xpGained },
          level: levelFromXp(user.xp + g.xpGained).level,
          totalGuesses: { increment: 1 },
          exactGuesses: { increment: exact ? 1 : 0 },
          winStreak,
          bestWinStreak: Math.max(user.best_win_streak, winStreak),
        },
      });
      await tx.userGameStats.upsert({
        where: { userId_gameId: { userId: g.userId, gameId: g.clip.gameId } },
        create: { userId: g.userId, gameId: g.clip.gameId, guesses: 1, exact: exact ? 1 : 0, totalDistance: g.distance, totalScore: g.score },
        update: {
          guesses: { increment: 1 },
          exact: { increment: exact ? 1 : 0 },
          totalDistance: { increment: g.distance },
          totalScore: { increment: g.score },
        },
      });
      await tx.clip.update({ where: { id: g.clipId }, data: { timesPlayed: { increment: 1 } } });
      return g;
    });
    if (!applied) return null;
    await this.redis.hincrby(`clip:dist:${applied.clipId}`, applied.guessedRankId, 1);
    return applied.userId;
  }
}
