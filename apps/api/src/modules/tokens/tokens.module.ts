import { ConflictException, Controller, Get, HttpCode, Injectable, Module, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  TOKENS_DAILY_PROFIT_CAP, TOKENS_DAILY_REFILL_TO, cappedPayout, confidencePayout, type TokenReason, type TokensDto,
} from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { todayUtc } from "../clips/clips.service.js";

const day = () => todayUtc().toISOString().slice(0, 10);

/**
 * Jetons virtuels du mode Confiance. Ils ne s'achètent pas, ne se retirent pas, ne se transfèrent pas et ne donnent
 * droit à aucun prix. Le solde ne change que par des mouvements inscrits au journal, chacun avec une clé unique
 * (une mise, un gain ou une recharge ne peut jamais être compté deux fois), dans des transactions atomiques.
 */
@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<TokensDto> {
    const [user, refilled, profitToday, history] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } }),
      this.prisma.tokenTransaction.count({ where: { key: `refill:${userId}:${day()}` } }),
      this.profitToday(this.prisma, userId),
      this.prisma.tokenTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { room: { select: { code: true } } },
      }),
    ]);
    return {
      balance: user.tokenBalance,
      canRefill: user.tokenBalance < TOKENS_DAILY_REFILL_TO && !refilled,
      refillTo: TOKENS_DAILY_REFILL_TO,
      profitToday,
      dailyProfitCap: TOKENS_DAILY_PROFIT_CAP,
      history: history.map((t) => ({
        id: t.id, delta: t.delta, balanceAfter: t.balanceAfter, reason: t.reason as TokenReason,
        roomCode: t.room?.code ?? null, round: t.round, createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  /** Recharge gratuite, une fois par jour : le solde remonte à 10 jetons s'il est en dessous. */
  async refill(userId: string): Promise<TokensDto> {
    await this.prisma.$transaction(async (tx) => {
      const [u] = await tx.$queryRaw<{ token_balance: number }[]>`SELECT token_balance FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const key = `refill:${userId}:${day()}`;
      if (await tx.tokenTransaction.findUnique({ where: { key }, select: { id: true } })) {
        throw new ConflictException({ code: "REFILL_USED", message: "Recharge déjà utilisée aujourd'hui. Reviens demain." });
      }
      if (!u || u.token_balance >= TOKENS_DAILY_REFILL_TO) {
        throw new ConflictException({ code: "REFILL_NOT_NEEDED", message: `La recharge sert quand il te reste moins de ${TOKENS_DAILY_REFILL_TO} jetons.` });
      }
      await tx.user.update({ where: { id: userId }, data: { tokenBalance: TOKENS_DAILY_REFILL_TO } });
      await tx.tokenTransaction.create({
        data: { userId, delta: TOKENS_DAILY_REFILL_TO - u.token_balance, balanceAfter: TOKENS_DAILY_REFILL_TO, reason: "DAILY_REFILL", key },
      });
    });
    return this.get(userId);
  }

  /**
   * Mise sur une réponse, dans la transaction qui enregistre la réponse : le solde est débité seulement s'il suffit
   * (mise à jour conditionnelle), la mise et le mouvement sont uniques par joueur et par manche.
   */
  async stake(tx: Prisma.TransactionClient, userId: string, roomId: string, round: number, stake: number) {
    if (stake === 0) {
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } });
      if (u.tokenBalance > 0) throw notEnoughStake();
      return;
    }
    const rows = await tx.$queryRaw<{ token_balance: number }[]>`
      UPDATE users SET token_balance = token_balance - ${stake} WHERE id = ${userId}::uuid AND token_balance >= ${stake} RETURNING token_balance`;
    if (!rows.length) throw new ConflictException({ code: "NOT_ENOUGH_TOKENS", message: "Pas assez de jetons pour cette mise. Choisis une mise plus petite." });
    await tx.roomStake.create({ data: { roomId, round, userId, stake } });
    await tx.tokenTransaction.create({
      data: { userId, delta: -stake, balanceAfter: rows[0]!.token_balance, reason: "STAKE", roomId, round, key: `stake:${roomId}:${round}:${userId}` },
    });
  }

  /**
   * Fin de manche : chaque mise est réglée une seule fois (marquée réglée sous condition, gain inscrit avec une clé unique).
   * Versement : exact → 3 × la mise, 1 rang d'écart → la mise, sinon rien ; bénéfice plafonné par jour.
   */
  async settleRound(roomId: string, round: number, clipId: string) {
    const stakes = await this.prisma.roomStake.findMany({ where: { roomId, round, settledAt: null } });
    for (const st of stakes) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.roomStake.updateMany({ where: { roomId, round, userId: st.userId, settledAt: null }, data: { settledAt: new Date() } });
        if (!count) return;
        const guess = await tx.guess.findFirst({ where: { roomId, userId: st.userId, clipId }, select: { distance: true } });
        const raw = guess ? confidencePayout(st.stake, guess.distance) : 0;
        const payout = cappedPayout(raw, st.stake, await this.profitToday(tx, st.userId));
        await tx.roomStake.update({ where: { roomId_round_userId: { roomId, round, userId: st.userId } }, data: { payout } });
        if (payout > 0) {
          const u = await tx.user.update({ where: { id: st.userId }, data: { tokenBalance: { increment: payout } }, select: { tokenBalance: true } });
          await tx.tokenTransaction.create({
            data: { userId: st.userId, delta: payout, balanceAfter: u.tokenBalance, reason: "PAYOUT", roomId, round, key: `payout:${roomId}:${round}:${st.userId}` },
          });
        }
      });
    }
  }

  /** Bénéfice net du jour : gains moins mises (les recharges et le solde de départ ne comptent pas) */
  private async profitToday(db: Prisma.TransactionClient | PrismaService, userId: string) {
    const r = await db.tokenTransaction.aggregate({
      where: { userId, reason: { in: ["STAKE", "PAYOUT"] }, createdAt: { gte: todayUtc() } },
      _sum: { delta: true },
    });
    return r._sum.delta ?? 0;
  }
}

const notEnoughStake = () =>
  new ConflictException({ code: "STAKE_REQUIRED", message: "Engage au moins 1 jeton (sans mise seulement quand ton solde est vide)." });

@Controller("tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  /** GET /v1/tokens — solde, recharge disponible, bénéfice du jour, derniers mouvements */
  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.tokens.get(u.sub);
  }

  /** POST /v1/tokens/refill — recharge gratuite quotidienne (jusqu'à 10 jetons) */
  @Post("refill")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  refill(@CurrentUser() u: AuthUser) {
    return this.tokens.refill(u.sub);
  }
}

@Module({
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
