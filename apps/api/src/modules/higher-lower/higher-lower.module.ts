import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpException, HttpStatus, Injectable, Module,
  NotFoundException, Param, ParseUUIDPipe, Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  AnswerHigherLowerInput, HIGHER_LOWER_FREE_RUNS, StartHigherLowerInput, higherLowerCorrect,
  type HigherLowerAnswerDto, type HigherLowerOverviewDto, type HigherLowerRunDto, type RankDto,
} from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { todayUtc } from "../clips/clips.service.js";
import { canHostVipGames } from "../shop/vip.js";
import { StorageService } from "../storage/storage.service.js";

const clipSelect = {
  id: true, storageKey: true, hlsKey: true, posterKey: true, durationSec: true,
  rank: { select: { id: true, name: true, tier: true, division: true, order: true, iconUrl: true, color: true } },
} as const;
type ClipRow = Prisma.ClipGetPayload<{ select: typeof clipSelect }>;
type RunRow = Prisma.HigherLowerRunGetPayload<{ include: { game: { select: { slug: true; name: true } } } }>;

const freeLimitReached = () =>
  new HttpException(
    {
      code: "PREMIUM_REQUIRED",
      message: `Tu as joué tes ${HIGHER_LOWER_FREE_RUNS} séries gratuites du jour. Reviens demain, ou passe VIP pour jouer sans limite.`,
    },
    HttpStatus.PAYMENT_REQUIRED,
  );

/**
 * Plus haut / Plus bas (solo). L'état de la série est gardé par le serveur : le rang du clip à comparer n'est envoyé
 * qu'après la réponse, et chaque question n'accepte qu'une réponse (numéro de question vérifié en base).
 * Pas de classement public ni d'XP : seul le record personnel compte, le mode ne peut pas servir à gagner des avantages.
 */
@Injectable()
export class HigherLowerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async overview(userId: string): Promise<HigherLowerOverviewDto> {
    const [vip, startedToday, best, active, recent] = await Promise.all([
      canHostVipGames(this.prisma, userId),
      this.startedToday(userId),
      this.best(userId),
      this.prisma.higherLowerRun.findFirst({ where: { userId, endedAt: null }, include: { game: { select: { slug: true, name: true } } } }),
      this.prisma.higherLowerRun.findMany({
        where: { userId, endedAt: { not: null }, endReason: { not: "ABANDONED" } },
        orderBy: { startedAt: "desc" },
        take: 10,
        include: { game: { select: { name: true } } },
      }),
    ]);
    return {
      freeRunsLeft: vip ? null : Math.max(0, HIGHER_LOWER_FREE_RUNS - startedToday),
      freeRunsPerDay: HIGHER_LOWER_FREE_RUNS,
      vip,
      best,
      active: active ? await this.toDto(active, best) : null,
      recent: recent.map((r) => ({ id: r.id, game: r.game.name, score: r.score, startedAt: r.startedAt.toISOString() })),
    };
  }

  /** Nouvelle série : la précédente, si elle était en cours, est abandonnée. 3 par jour sans VIP (vérifié en base). */
  async start(userId: string, gameSlug: string): Promise<HigherLowerRunDto> {
    const game = await this.prisma.game.findFirst({ where: { slug: gameSlug, isActive: true }, select: { id: true } });
    if (!game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    const vip = await canHostVipGames(this.prisma, userId);
    const run = await this.prisma.$transaction(async (tx) => {
      // Verrou sur le joueur : deux lancements simultanés ne dépassent pas la limite gratuite
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!vip && (await tx.higherLowerRun.count({ where: { userId, startedAt: { gte: todayUtc() } } })) >= HIGHER_LOWER_FREE_RUNS) {
        throw freeLimitReached();
      }
      await tx.higherLowerRun.updateMany({ where: { userId, endedAt: null }, data: { endedAt: new Date(), endReason: "ABANDONED", nextClipId: null } });
      const [first] = await tx.$queryRaw<{ id: string; rank_order: number }[]>`
        SELECT c.id, r."order" AS rank_order FROM clips c JOIN ranks r ON r.id = c.rank_id
        WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${game.id}::uuid AND c.uploader_id <> ${userId}::uuid
        ORDER BY random() LIMIT 1`;
      if (!first) throw notEnough();
      const next = await this.pickNext(tx, game.id, userId, first.rank_order, [first.id]);
      if (!next) throw notEnough();
      return tx.higherLowerRun.create({
        data: { userId, gameId: game.id, currentClipId: first.id, nextClipId: next, usedClipIds: [first.id, next] },
        include: { game: { select: { slug: true, name: true } } },
      });
    });
    return this.toDto(run, await this.best(userId));
  }

  async get(userId: string, id: string): Promise<HigherLowerRunDto> {
    const run = await this.prisma.higherLowerRun.findFirst({ where: { id, userId }, include: { game: { select: { slug: true, name: true } } } });
    if (!run) throw new NotFoundException("Série introuvable.");
    return this.toDto(run, await this.best(userId));
  }

  /** Réponse à la question `round` : comparée par le serveur, une seule fois (mise à jour conditionnée à la question en cours). */
  async answer(userId: string, id: string, round: number, choice: "higher" | "lower"): Promise<HigherLowerAnswerDto> {
    const bestBefore = await this.best(userId);
    const result = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM higher_lower_runs WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException("Série introuvable.");
      const run = await tx.higherLowerRun.findUniqueOrThrow({ where: { id } });
      if (run.endedAt || !run.nextClipId) throw new ConflictException({ code: "RUN_ENDED", message: "Cette série est terminée." });
      if (run.round !== round) throw new ConflictException({ code: "ALREADY_ANSWERED", message: "Tu as déjà répondu à cette question." });
      const [current, next] = await Promise.all([
        tx.clip.findUniqueOrThrow({ where: { id: run.currentClipId }, select: clipSelect }),
        tx.clip.findUniqueOrThrow({ where: { id: run.nextClipId }, select: clipSelect }),
      ]);
      const correct = higherLowerCorrect(current.rank.order, next.rank.order, choice);
      if (!correct) {
        await tx.higherLowerRun.update({ where: { id }, data: { endedAt: new Date(), endReason: "WRONG", round: run.round + 1 } });
        return { correct, revealed: next.rank };
      }
      const following = await this.pickNext(tx, run.gameId, userId, next.rank.order, run.usedClipIds);
      await tx.higherLowerRun.update({
        where: { id },
        data: {
          score: run.score + 1,
          round: run.round + 1,
          currentClipId: next.id,
          nextClipId: following,
          usedClipIds: following ? [...run.usedClipIds, following] : run.usedClipIds,
          ...(following ? {} : { endedAt: new Date(), endReason: "COMPLETE" }),
        },
      });
      return { correct, revealed: next.rank };
    });
    const run = await this.prisma.higherLowerRun.findUniqueOrThrow({ where: { id }, include: { game: { select: { slug: true, name: true } } } });
    const best = Math.max(bestBefore, run.score);
    return { ...result, record: run.score > bestBefore, run: await this.toDto(run, best) };
  }

  // ---------- Outils ----------

  /** Clip suivant : même jeu, rang différent du clip affiché, jamais montré dans la série ni proposé par le joueur. */
  private async pickNext(tx: Prisma.TransactionClient, gameId: string, userId: string, currentOrder: number, used: string[]) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM clips c JOIN ranks r ON r.id = c.rank_id
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${gameId}::uuid AND c.uploader_id <> ${userId}::uuid
        AND r."order" <> ${currentOrder} AND c.id <> ALL(${used}::uuid[])
      ORDER BY random() LIMIT 1`;
    return row?.id ?? null;
  }

  private startedToday(userId: string) {
    return this.prisma.higherLowerRun.count({ where: { userId, startedAt: { gte: todayUtc() } } });
  }

  private async best(userId: string) {
    const r = await this.prisma.higherLowerRun.aggregate({ where: { userId }, _max: { score: true } });
    return r._max.score ?? 0;
  }

  private async clipView(clip: ClipRow) {
    return {
      id: clip.id,
      videoUrl: await this.storage.signedReadUrl(clip.hlsKey ?? clip.storageKey),
      posterUrl: clip.posterKey ? await this.storage.signedReadUrl(clip.posterKey) : null,
      durationSec: clip.durationSec,
    };
  }

  private async toDto(run: RunRow, best: number): Promise<HigherLowerRunDto> {
    const [current, next, ranks] = await Promise.all([
      this.prisma.clip.findUniqueOrThrow({ where: { id: run.currentClipId }, select: clipSelect }),
      run.nextClipId && !run.endedAt ? this.prisma.clip.findUnique({ where: { id: run.nextClipId }, select: clipSelect }) : null,
      this.prisma.rank.findMany({ where: { gameId: run.gameId }, orderBy: { order: "asc" }, select: clipSelect.rank.select }),
    ]);
    return {
      id: run.id,
      game: run.game,
      status: run.endedAt ? "ENDED" : "ACTIVE",
      endReason: (run.endReason as HigherLowerRunDto["endReason"]) ?? null,
      score: run.score,
      round: run.round,
      current: { ...(await this.clipView(current)), rank: current.rank as RankDto },
      next: next ? await this.clipView(next) : null,
      ranks: ranks as RankDto[],
      best,
      startedAt: run.startedAt.toISOString(),
    };
  }
}

const notEnough = () =>
  new NotFoundException({ code: "NOT_ENOUGH_CLIPS", message: "Pas encore assez de clips de rangs différents sur ce jeu. Essaie un autre jeu." });

@Controller("higher-lower")
export class HigherLowerController {
  constructor(private readonly service: HigherLowerService) {}

  /** GET /v1/higher-lower — séries gratuites restantes, record, série en cours, dernières séries */
  @Get()
  overview(@CurrentUser() u: AuthUser) {
    return this.service.overview(u.sub);
  }

  /** POST /v1/higher-lower/runs — { game } : nouvelle série */
  @Post("runs")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  start(@CurrentUser() u: AuthUser, @Body(new ZodPipe(StartHigherLowerInput)) body: StartHigherLowerInput) {
    return this.service.start(u.sub, body.game);
  }

  @Get("runs/:id")
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.get(u.sub, id);
  }

  /** POST /v1/higher-lower/runs/:id/answer — { round, choice } */
  @Post("runs/:id/answer")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  answer(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(AnswerHigherLowerInput)) body: AnswerHigherLowerInput) {
    return this.service.answer(u.sub, id, body.round, body.choice);
  }
}

@Module({
  controllers: [HigherLowerController],
  providers: [HigherLowerService],
})
export class HigherLowerModule {}
