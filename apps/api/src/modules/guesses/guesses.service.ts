import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Redis } from "ioredis";
import {
  infiniteMultiplier,
  levelFromXp,
  scoreGuess,
  xpForGuess,
  type GameSlug,
  type GuessResultDto,
  type SubmitGuessInput,
  VIP_XP_MULTIPLIER,
} from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { PlayTokenService } from "../clips/play-token.service.js";
import { todayUtc } from "../clips/clips.service.js";
import { LeaderboardsService } from "../leaderboards/leaderboards.service.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { VersusService } from "../versus/versus.service.js";

const LIFE_LOST_FROM_DISTANCE = 2; // Infini : ≥ 2 rangs d'écart = une vie perdue
const CLIPS_PER_DIFFICULTY_STEP = 3;

const alreadyAnswered = (mode: string) =>
  mode === "DAILY" ? "Tu as déjà joué ce défi aujourd'hui. Reviens demain pour un nouveau clip !" : "Tu as déjà répondu à ce clip.";

@Injectable()
export class GuessesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly playTokens: PlayTokenService,
    private readonly leaderboards: LeaderboardsService,
    private readonly achievements: AchievementEngine,
    private readonly versus: VersusService,
    private readonly audit: AuditService,
  ) {}

  async submit(userId: string, input: SubmitGuessInput): Promise<GuessResultDto & { run?: unknown; versus?: unknown }> {
    // 1. Jeton de partie : authentique et émis pour ce joueur
    const claims = await this.playTokens.verify(input.playToken, userId);

    // 2. Cohérence temporelle : impossible d'avoir regardé plus longtemps que le temps écoulé
    const elapsedMs = Date.now() - claims.iat * 1000;
    if (input.watchedMs > elapsedMs + 2000) throw new BadRequestException({ code: "INVALID_WATCH_TIME" });

    // 3. Données de référence
    const clip = await this.prisma.clip.findUnique({
      where: { id: claims.cid },
      include: { rank: true, game: { select: { id: true, slug: true, isActive: true } } },
    });
    if (!clip || clip.deletedAt || !clip.game.isActive) throw new NotFoundException();
    const guessed = await this.prisma.rank.findUnique({ where: { id: input.rankId } });
    if (!guessed || guessed.gameId !== clip.gameId) throw new BadRequestException({ code: "RANK_NOT_IN_GAME" });

    if (claims.mode === "DAILY" && claims.did) {
      const daily = await this.prisma.dailyChallenge.findUnique({ where: { id: claims.did } });
      if (!daily || daily.date.getTime() !== todayUtc().getTime()) throw new ConflictException({ code: "DAILY_EXPIRED" });
    }
    if (claims.mode === "VERSUS") {
      if (!claims.vid) throw new BadRequestException({ code: "INVALID_PLAY_TOKEN" });
      await this.versus.assertCanAnswer(userId, claims.vid, clip.id);
    }

    // 4. Score (règle partagée avec les clients) : écart entre les positions des rangs dans l'échelle du jeu
    const { distance, score } = scoreGuess(guessed.order, clip.rank.order);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: vipSelect });
    const vipBoost = isVip(user.subscription);

    const streak = claims.mode === "DAILY" ? this.nextStreak(user.lastDailyDate, user.dailyStreak) : user.dailyStreak;
    // Boost VIP : +50 % d'XP (le score et les classements ne changent pas)
    const xpGained = Math.round(xpForGuess(score, streak) * (vipBoost ? VIP_XP_MULTIPLIER : 1));
    // Série de victoires : réponses exactes consécutives, tous modes confondus
    const winStreak = distance === 0 ? user.winStreak + 1 : 0;
    const { level } = levelFromXp(user.xp + xpGained);

    // 5. Usage unique du jeton, réservé seulement une fois la réponse validée
    const fresh = await this.redis.set(`play:used:${claims.jti}`, "1", "EX", 3600, "NX");
    if (!fresh) throw new ConflictException({ code: "ALREADY_ANSWERED", message: alreadyAnswered(claims.mode) });

    // 6. Écriture atomique
    const result = await this.prisma.$transaction(async (tx) => {
      const guess = await tx.guess.create({
        data: {
          userId,
          clipId: clip.id,
          guessedRankId: guessed.id,
          mode: claims.mode,
          dailyChallengeId: claims.did ?? null,
          infiniteRunId: claims.rid ?? null,
          versusMatchId: claims.vid ?? null,
          distance,
          score,
          xpGained,
          watchedMs: input.watchedMs,
          // Mesuré par le serveur (le temps de visionnage, lui, est déclaré par l'application)
          responseMs: Math.max(0, elapsedMs),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          xp: { increment: xpGained },
          level,
          totalGuesses: { increment: 1 },
          exactGuesses: { increment: distance === 0 ? 1 : 0 },
          winStreak,
          bestWinStreak: Math.max(user.bestWinStreak, winStreak),
          ...(claims.mode === "DAILY"
            ? { dailyStreak: streak, bestDailyStreak: Math.max(user.bestDailyStreak, streak), lastDailyDate: todayUtc() }
            : {}),
        },
      });

      await tx.userGameStats.upsert({
        where: { userId_gameId: { userId, gameId: clip.gameId } },
        create: { userId, gameId: clip.gameId, guesses: 1, exact: distance === 0 ? 1 : 0, totalDistance: distance, totalScore: score },
        update: {
          guesses: { increment: 1 },
          exact: { increment: distance === 0 ? 1 : 0 },
          totalDistance: { increment: distance },
          totalScore: { increment: score },
        },
      });

      await tx.clip.update({ where: { id: clip.id }, data: { timesPlayed: { increment: 1 } } });

      let run = null;
      if (claims.mode === "INFINITE" && claims.rid) {
        const current = await tx.infiniteRun.findUniqueOrThrow({ where: { id: claims.rid } });
        if (current.endedAt) throw new ConflictException({ code: "RUN_ENDED" });
        const lives = current.lives - (distance >= LIFE_LOST_FROM_DISTANCE ? 1 : 0);
        const clipsPlayed = current.clipsPlayed + 1;
        run = await tx.infiniteRun.update({
          where: { id: current.id },
          data: {
            lives,
            clipsPlayed,
            score: { increment: Math.round(score * infiniteMultiplier(current.difficulty)) },
            difficulty: Math.min(5, 1 + Math.floor(clipsPlayed / CLIPS_PER_DIFFICULTY_STEP)),
            endedAt: lives <= 0 ? new Date() : null,
          },
        });
      }
      return { guess, run };
    }).catch((e: { code?: string }) => {
      // Contrainte unique (joueur, défi) : une seule réponse par jeu et par jour, même avec un nouveau jeton
      if (e?.code === "P2002") throw new ConflictException({ code: "ALREADY_ANSWERED", message: alreadyAnswered(claims.mode) });
      throw e;
    });

    // 7. Effets de bord hors transaction (non bloquants pour la cohérence)
    await this.redis.hincrby(`clip:dist:${clip.id}`, guessed.id, 1);
    if (claims.mode === "DAILY") await this.leaderboards.recordScore(userId, score, clip.game.slug as GameSlug);
    if (result.run?.endedAt) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { infiniteBest: Math.max(user.infiniteBest, result.run.score) },
      });
      await this.leaderboards.recordInfiniteRun(userId, result.run.score);
      // Nouveau record personnel : inscrit au journal (historique du joueur dans l'administration)
      if (result.run.score > user.infiniteBest) {
        await this.audit.system("record.infinite", "infinite_run", result.run.id, { clipsPlayed: result.run.clipsPlayed }, {
          targetUserId: userId,
          before: { infiniteBest: user.infiniteBest },
          after: { infiniteBest: result.run.score },
        });
      }
    }
    const versus = claims.mode === "VERSUS" && claims.vid ? await this.versus.afterAnswer(userId, claims.vid) : undefined;
    const { achievements: unlockedAchievements, rewards: unlockedRewards } = await this.achievements.evaluateWithRewards(userId);

    const { gameId: _correctGameId, ...correctRank } = clip.rank;
    const { gameId: _guessedGameId, ...guessedRank } = guessed;
    return {
      guessId: result.guess.id,
      correctRank,
      guessedRank,
      distance,
      score,
      xpGained,
      level,
      dailyStreak: streak,
      winStreak,
      vipBoost,
      communityDistribution: await this.distribution(clip.id),
      clipPlayer: clip.inGamePseudo ? { inGamePseudo: clip.inGamePseudo, platform: clip.platform, region: clip.region } : null,
      unlockedAchievements,
      unlockedRewards,
      run: result.run ?? undefined,
      versus,
    };
  }

  /** Série : +1 si dernière partie hier, conservée si aujourd'hui, sinon repart à 1. */
  private nextStreak(last: Date | null, current: number): number {
    if (!last) return 1;
    const days = Math.round((todayUtc().getTime() - last.getTime()) / 86_400_000);
    return days === 1 ? current + 1 : days === 0 ? current : 1;
  }

  /** Pourcentage de joueurs par rang choisi (affiché après la réponse). */
  private async distribution(clipId: string): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(`clip:dist:${clipId}`);
    const total = Object.values(raw).reduce((s, v) => s + Number(v), 0) || 1;
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((Number(v) / total) * 1000) / 10]));
  }

  async history(userId: string, opts: { limit: number; cursor?: string; premium: boolean }) {
    // Gratuit : 30 derniers jours. Premium : historique complet.
    const since = opts.premium ? undefined : new Date(Date.now() - 30 * 86_400_000);
    return this.prisma.guess.findMany({
      where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
      include: {
        clip: { select: { id: true, game: { select: { slug: true, name: true } }, rank: { select: { name: true, color: true } } } },
        guessedRank: { select: { name: true, color: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(opts.limit, 50),
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  }
}
