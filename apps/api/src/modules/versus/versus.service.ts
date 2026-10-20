import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Redis } from "ioredis";
import {
  VERSUS_COUNTDOWN_SEC, VERSUS_EVENT, VERSUS_REVEAL_SEC, VERSUS_ROUNDS, VERSUS_WAIT_SEC, versusRoundSec,
  type PlayableClipDto, type VersusMatchDto, type VersusRoundDto, type VersusStatsDto,
} from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { ClipsService, clipInclude, noClipAvailable } from "../clips/clips.service.js";
import { PlayTokenService } from "../clips/play-token.service.js";
import { PushService } from "../notifications/notifications.module.js";
import { isVip, vipSelect } from "../shop/vip.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { RatingsService } from "../ratings/ratings.service.js";
import { playableLinkSql } from "../clips/clip-video.js";

const SEC = 1000;
/** Marge accordée à une réponse envoyée juste avant la fin du chrono (latence réseau) */
const ANSWER_GRACE = 2 * SEC;
const LIVE_STATUSES = ["OPEN", "PENDING", "ACTIVE"] as const;

const playerSelect = { id: true, displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } as const;
const matchInclude = {
  creator: { select: playerSelect },
  opponent: { select: playerSelect },
  game: { select: { slug: true, name: true } },
} as const;
const rankSelect = { id: true, name: true, color: true, order: true, iconUrl: true } as const;

type MatchRow = Prisma.VersusMatchGetPayload<{ include: typeof matchInclude }>;
type Player = MatchRow["creator"];
type RoundAnswer = { userId: string; clipId: string };

const later = (ms: number) => new Date(Date.now() + ms);

/**
 * Duels en direct : deux joueurs voient le même clip au même moment (5 manches).
 * Chaque manche dure 30 s ; elle se termine dès que les deux ont répondu ou à la fin du chrono,
 * les deux réponses sont alors dévoilées, puis la manche suivante démarre après une courte pause.
 * Barème habituel (100 / 20 / 5 / 0), pas de réponse = 0. Le total le plus élevé gagne.
 * Les duels donnent de l'XP et des succès mais ne modifient pas les classements.
 */
@Injectable()
export class VersusService {
  private readonly logger = new Logger(VersusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clips: ClipsService,
    private readonly playTokens: PlayTokenService,
    private readonly gateway: ChatGateway,
    private readonly push: PushService,
    private readonly achievements: AchievementEngine,
    private readonly ratings: RatingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------- Création ----------

  async create(userId: string, opponent: string, game: string) {
    const active = await this.prisma.versusMatch.findFirst({
      where: { status: "ACTIVE", OR: [{ creatorId: userId }, { opponentId: userId }] },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({ code: "DUEL_IN_PROGRESS", message: "Tu as déjà un duel en cours : termine-le avant d'en lancer un autre.", id: active.id });
    }
    // Une seule recherche ou invitation à la fois : la précédente est annulée
    const previous = await this.prisma.versusMatch.findMany({
      where: { creatorId: userId, status: { in: ["OPEN", "PENDING"] } },
      select: { id: true },
    });
    if (previous.length) {
      await this.prisma.versusMatch.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "CANCELED" } });
      for (const p of previous) await this.notifyMatch(p.id);
    }

    const gameRow = game === "all" ? null : await this.prisma.game.findFirst({ where: { slug: game, isActive: true } });
    if (game !== "all" && !gameRow) throw new BadRequestException("Ce jeu n'est pas disponible.");
    const gameId = gameRow?.id ?? null;

    if (opponent === "random") {
      const joined = await this.joinOpenMatch(userId, gameId);
      if (joined) return this.detail(userId, joined);
      const clipIds = await this.pickClips(gameId, [userId]);
      const match = await this.prisma.versusMatch.create({
        data: {
          creatorId: userId, gameId, random: true, status: "OPEN", rounds: clipIds.length,
          expiresAt: later(VERSUS_WAIT_SEC * SEC),
          clips: { create: clipIds.map((clipId, position) => ({ clipId, position })) },
        },
      });
      return this.detail(userId, match.id);
    }

    if (opponent === userId) throw new BadRequestException("Tu ne peux pas te défier toi-même.");
    const friend = await this.prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId, addresseeId: opponent }, { requesterId: opponent, addresseeId: userId }],
      },
      include: { requester: { select: { status: true } }, addressee: { select: { status: true } } },
    });
    if (!friend || friend.requester.status !== "ACTIVE" || friend.addressee.status !== "ACTIVE") {
      throw new ForbiddenException("Tu ne peux défier que tes amis (ou un joueur au hasard).");
    }
    const busy = await this.prisma.versusMatch.count({ where: { status: "ACTIVE", OR: [{ creatorId: opponent }, { opponentId: opponent }] } });
    if (busy) throw new ConflictException({ code: "FRIEND_BUSY", message: "Ton ami est déjà en plein duel. Réessaie dans quelques minutes." });

    const clipIds = await this.pickClips(gameId, [userId, opponent]);
    const match = await this.prisma.versusMatch.create({
      data: {
        creatorId: userId, opponentId: opponent, gameId, random: false, status: "PENDING", rounds: clipIds.length,
        expiresAt: later(VERSUS_WAIT_SEC * SEC),
        clips: { create: clipIds.map((clipId, position) => ({ clipId, position })) },
      },
      include: { creator: { select: { displayName: true } } },
    });
    this.notify([opponent], match.id);
    await this.push.toUsers([opponent], {
      title: "Duel en direct",
      body: `${match.creator.displayName} te défie sur ${gameRow?.name ?? "tous les jeux"} : rejoins-le maintenant !`,
      data: { url: `versus/${match.id}` },
    });
    return this.detail(userId, match.id);
  }

  /** Rejoint le plus ancien joueur en attente (jamais soi-même, jamais un duel contenant un de ses clips) et lance le duel. */
  private async joinOpenMatch(userId: string, gameId: string | null): Promise<string | null> {
    const candidates = await this.prisma.versusMatch.findMany({
      where: {
        status: "OPEN", gameId, creatorId: { not: userId }, expiresAt: { gt: new Date() },
        clips: { none: { clip: { uploaderId: userId } } },
        creator: { status: "ACTIVE" },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true },
    });
    for (const c of candidates) {
      const { count } = await this.prisma.versusMatch.updateMany({
        where: { id: c.id, status: "OPEN" },
        data: { opponentId: userId, ...(await this.startData(c.id)) },
      });
      if (count === 1) {
        await this.notifyMatch(c.id);
        return c.id;
      }
    }
    return null;
  }

  /** Lancement du duel : compte à rebours, puis manche 1. */
  private async startData(matchId: string) {
    const startsAt = later(VERSUS_COUNTDOWN_SEC * SEC);
    return {
      status: "ACTIVE" as const,
      acceptedAt: new Date(),
      currentRound: 1,
      roundStartsAt: startsAt,
      roundEndsAt: new Date(startsAt.getTime() + (await this.roundSec(matchId, 1)) * SEC),
    };
  }

  /** Durée d'une manche : 30 s au moins, et toujours de quoi regarder le clip en entier (sa durée + 10 s pour répondre) */
  private async roundSec(matchId: string, round: number) {
    const entry = await this.prisma.versusClip.findUnique({
      where: { matchId_position: { matchId, position: round - 1 } },
      select: { clip: { select: { durationSec: true } } },
    });
    return versusRoundSec(entry?.clip.durationSec ?? 0);
  }

  /** 5 clips acceptés au hasard (jeu imposé ou tous les jeux), jamais proposés par un des joueurs. */
  private async pickClips(gameId: string | null, players: string[]): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM clips c JOIN games g ON g.id = c.game_id
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND g.is_active
        AND (${gameId}::uuid IS NULL OR c.game_id = ${gameId}::uuid)
        AND c.uploader_id <> ALL(${players}::uuid[]) ${playableLinkSql()}
      ORDER BY random() LIMIT ${VERSUS_ROUNDS}`;
    if (rows.length < VERSUS_ROUNDS) {
      throw new NotFoundException({ code: "NOT_ENOUGH_CLIPS", message: "Pas encore assez de clips pour un duel sur ce jeu. Essaie « Tous les jeux »." });
    }
    return rows.map((r) => r.id);
  }

  // ---------- Attente, invitation ----------

  /** Signal de présence de l'auteur d'une recherche ou d'une invitation : elle reste ouverte tant qu'il attend sur la page. */
  async wait(userId: string, id: string) {
    await this.prisma.versusMatch.updateMany({
      where: { id, creatorId: userId, status: { in: ["OPEN", "PENDING"] } },
      data: { expiresAt: later(VERSUS_WAIT_SEC * SEC) },
    });
    return this.detail(userId, id);
  }

  async accept(userId: string, id: string) {
    const busy = await this.prisma.versusMatch.findFirst({
      where: { status: "ACTIVE", OR: [{ creatorId: userId }, { opponentId: userId }] },
      select: { id: true },
    });
    if (busy) throw new ConflictException({ code: "DUEL_IN_PROGRESS", message: "Termine d'abord ton duel en cours.", id: busy.id });
    const { count } = await this.prisma.versusMatch.updateMany({
      where: { id, opponentId: userId, status: "PENDING", expiresAt: { gt: new Date() } },
      data: await this.startData(id),
    });
    if (!count) throw new NotFoundException("Invitation introuvable ou expirée : ton ami n'attend plus.");
    // L'invité ne garde pas de recherche « au hasard » en parallèle
    await this.prisma.versusMatch.updateMany({ where: { creatorId: userId, status: { in: ["OPEN", "PENDING"] } }, data: { status: "CANCELED" } });
    await this.notifyMatch(id);
    return this.detail(userId, id);
  }

  async decline(userId: string, id: string) {
    const { count } = await this.prisma.versusMatch.updateMany({ where: { id, opponentId: userId, status: "PENDING" }, data: { status: "DECLINED" } });
    if (!count) throw new NotFoundException("Invitation introuvable.");
    await this.notifyMatch(id);
  }

  /** Le créateur annule sa recherche ou son invitation tant que le duel n'a pas commencé. */
  async cancel(userId: string, id: string) {
    const { count } = await this.prisma.versusMatch.updateMany({
      where: { id, creatorId: userId, status: { in: ["OPEN", "PENDING"] } },
      data: { status: "CANCELED" },
    });
    if (!count) throw new BadRequestException("Ce duel a déjà commencé : il ne peut plus être annulé.");
    await this.notifyMatch(id);
  }

  /** Abandon en cours de duel : victoire de l'adversaire. */
  async forfeit(userId: string, id: string) {
    const m = await this.prisma.versusMatch.findUnique({ where: { id } });
    if (!m || (m.creatorId !== userId && m.opponentId !== userId)) throw new NotFoundException("Duel introuvable.");
    if (m.status !== "ACTIVE" || !m.opponentId) throw new BadRequestException("Ce duel n'est pas en cours.");
    const winnerId = m.creatorId === userId ? m.opponentId : m.creatorId;
    const { count } = await this.prisma.versusMatch.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "FINISHED", winnerId, forfeitedById: userId, finishedAt: new Date(), roundStartsAt: null, roundEndsAt: null },
    });
    if (count) {
      await this.achievements.evaluate(winnerId);
      await this.rate(id);
      await this.notifyMatch(id);
    }
  }

  // ---------- Manches ----------

  /** Clip de la manche en cours, disponible uniquement pendant le chrono et tant que le joueur n'a pas répondu. */
  async next(userId: string, id: string): Promise<PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string }> {
    const match = await this.prisma.versusMatch.findUnique({ where: { id }, include: { clips: { orderBy: { position: "asc" } } } });
    if (!match || (match.creatorId !== userId && match.opponentId !== userId)) throw new NotFoundException("Duel introuvable.");
    if (match.status !== "ACTIVE" || !match.roundStartsAt || !match.roundEndsAt) {
      throw new ConflictException({ code: "VERSUS_CLOSED", message: "Ce duel n'est pas en cours." });
    }
    const now = Date.now();
    if (now < match.roundStartsAt.getTime() - 500) throw new ConflictException({ code: "ROUND_NOT_STARTED", message: "La manche n'a pas encore commencé." });
    if (now > match.roundEndsAt.getTime()) throw new ConflictException({ code: "ROUND_OVER", message: "Temps écoulé pour cette manche." });
    const current = match.clips[match.currentRound - 1];
    if (!current) throw noClipAvailable();
    const answered = await this.prisma.guess.count({ where: { userId, versusMatchId: id, clipId: current.clipId } });
    if (answered) throw new ConflictException({ code: "ALREADY_ANSWERED", message: "Tu as déjà répondu à cette manche." });
    const clip = await this.prisma.clip.findUnique({ where: { id: current.clipId }, include: clipInclude });
    if (!clip) throw noClipAvailable();
    const token = await this.playTokens.sign({ uid: userId, cid: clip.id, mode: "VERSUS", vid: id });
    return {
      ...(await this.clips.toPlayable(clip, token, "VERSUS", null)),
      position: match.currentRound,
      rounds: match.rounds,
      endsAt: match.roundEndsAt.toISOString(),
      serverNow: new Date().toISOString(),
    };
  }

  /** Vérification avant d'enregistrer une réponse de duel : seulement pour le clip de la manche en cours, pendant le chrono. */
  async assertCanAnswer(userId: string, matchId: string, clipId: string) {
    const match = await this.prisma.versusMatch.findUnique({ where: { id: matchId }, include: { clips: { orderBy: { position: "asc" } } } });
    const current = match?.clips[(match?.currentRound ?? 0) - 1];
    if (
      !match || match.status !== "ACTIVE" || (match.creatorId !== userId && match.opponentId !== userId)
      || !current || current.clipId !== clipId || !match.roundEndsAt
    ) {
      throw new ConflictException({ code: "ROUND_OVER", message: "Cette manche est terminée." });
    }
    if (Date.now() > match.roundEndsAt.getTime() + ANSWER_GRACE) {
      throw new ConflictException({ code: "ROUND_OVER", message: "Temps écoulé : ta réponse n'a pas été prise en compte." });
    }
  }

  /** Après une réponse : score du joueur ; la manche se termine aussitôt si les deux ont répondu. */
  async afterAnswer(userId: string, matchId: string) {
    const match = await this.prisma.versusMatch.findUniqueOrThrow({ where: { id: matchId }, include: { clips: { orderBy: { position: "asc" } } } });
    const answers = await this.prisma.guess.findMany({ where: { versusMatchId: matchId }, select: { userId: true, clipId: true, score: true } });
    const score = answers.filter((a) => a.userId === userId).reduce((s, a) => s + a.score, 0);
    await this.prisma.versusMatch.update({
      where: { id: matchId },
      data: match.creatorId === userId ? { creatorScore: score } : { opponentScore: score },
    });
    const current = match.clips[match.currentRound - 1];
    const bothAnswered = !!current && this.answeredBy(answers, current.clipId).size >= 2;
    if (bothAnswered) await this.advance(matchId, match.currentRound);
    else await this.notifyMatch(matchId);
    return { position: match.currentRound, rounds: match.rounds, score };
  }

  private answeredBy(answers: RoundAnswer[], clipId: string) {
    return new Set(answers.filter((a) => a.clipId === clipId).map((a) => a.userId));
  }

  /**
   * Fin de la manche `round` (les deux ont répondu ou chrono écoulé) : manche suivante après la pause d'affichage,
   * ou fin du duel. Conditionnée à la manche courante : une seule instance de l'API l'applique.
   */
  private async advance(id: string, round: number) {
    const m = await this.prisma.versusMatch.findUnique({ where: { id } });
    if (!m || m.status !== "ACTIVE" || m.currentRound !== round) return;

    if (round < m.rounds) {
      const startsAt = later(VERSUS_REVEAL_SEC * SEC);
      const { count } = await this.prisma.versusMatch.updateMany({
        where: { id, status: "ACTIVE", currentRound: round },
        data: { currentRound: round + 1, roundStartsAt: startsAt, roundEndsAt: new Date(startsAt.getTime() + (await this.roundSec(id, round + 1)) * SEC) },
      });
      if (count) await this.notifyMatch(id);
      return;
    }

    // Dernière manche : scores définitifs recalculés depuis les réponses
    const answers = await this.prisma.guess.groupBy({ by: ["userId"], where: { versusMatchId: id }, _sum: { score: true } });
    const total = (uid: string | null) => answers.find((a) => a.userId === uid)?._sum.score ?? 0;
    const creatorScore = total(m.creatorId);
    const opponentScore = total(m.opponentId);
    const winnerId = creatorScore === opponentScore ? null : creatorScore > opponentScore ? m.creatorId : m.opponentId;
    const { count } = await this.prisma.versusMatch.updateMany({
      where: { id, status: "ACTIVE", currentRound: round },
      data: { status: "FINISHED", creatorScore, opponentScore, winnerId, finishedAt: new Date(), roundStartsAt: null, roundEndsAt: null },
    });
    if (!count) return;
    if (winnerId) await this.achievements.evaluate(winnerId);
    await this.rate(id);
    await this.notifyMatch(id);
  }

  /**
   * Chaque seconde (une seule instance de l'API à la fois, verrou Redis) :
   * manches dont le chrono est écoulé, recherches et invitations abandonnées.
   */
  @Interval(SEC)
  async tick() {
    const lock = await this.redis.set("versus:tick", "1", "PX", 900, "NX").catch(() => null);
    if (!lock) return;
    const now = new Date();
    const overdue = await this.prisma.versusMatch.findMany({
      where: { status: "ACTIVE", roundEndsAt: { lt: new Date(now.getTime() - ANSWER_GRACE) } },
      select: { id: true, currentRound: true },
      take: 200,
    });
    for (const m of overdue) {
      try {
        await this.advance(m.id, m.currentRound);
      } catch (e) {
        this.logger.error(`Duel ${m.id} : passage de manche impossible`, e as Error);
      }
    }
    const stale = await this.prisma.versusMatch.findMany({
      where: { status: { in: ["OPEN", "PENDING"] }, expiresAt: { lte: now } },
      select: { id: true, status: true },
      take: 200,
    });
    for (const m of stale) {
      const { count } = await this.prisma.versusMatch.updateMany({ where: { id: m.id, status: m.status }, data: { status: "EXPIRED" } });
      if (count) await this.notifyMatch(m.id);
    }
  }

  // ---------- Lecture ----------

  async list(userId: string): Promise<{ matches: VersusMatchDto[]; stats: VersusStatsDto }> {
    const rows = await this.prisma.versusMatch.findMany({
      where: { OR: [{ creatorId: userId }, { opponentId: userId }] },
      include: matchInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // L'historique ne montre que les duels joués ou en cours ; les recherches abandonnées sont masquées
    const visible = rows.filter((m) => LIVE_STATUSES.some((s) => s === m.status) || !!m.acceptedAt || m.status === "DECLINED");
    return { matches: visible.map((m) => this.toDto(m, userId, [], [])), stats: await this.stats(userId) };
  }

  async detail(userId: string, id: string): Promise<VersusMatchDto> {
    const m = await this.prisma.versusMatch.findUnique({ where: { id }, include: matchInclude });
    if (!m || (m.creatorId !== userId && m.opponentId !== userId)) throw new NotFoundException("Duel introuvable.");
    const [clips, answers] = await Promise.all([
      this.prisma.versusClip.findMany({
        where: { matchId: id },
        orderBy: { position: "asc" },
        include: { clip: { select: { id: true, game: { select: { slug: true, name: true } }, rank: { select: rankSelect } } } },
      }),
      this.prisma.guess.findMany({
        where: { versusMatchId: id },
        select: { userId: true, clipId: true, score: true, guessedRank: { select: rankSelect } },
      }),
    ]);
    const opponentId = m.creatorId === userId ? m.opponentId : m.creatorId;
    // Manches dévoilées : celles déjà terminées (toutes une fois le duel fini)
    const resolved = m.status === "ACTIVE" ? m.currentRound - 1 : m.status === "FINISHED" ? m.rounds : 0;
    const find = (uid: string | null, clipId: string) => answers.find((a) => a.userId === uid && a.clipId === clipId);
    const details: VersusRoundDto[] = clips.slice(0, resolved).map((c) => {
      const mine = find(userId, c.clipId);
      const theirs = find(opponentId, c.clipId);
      return {
        position: c.position + 1,
        game: c.clip.game,
        correctRank: c.clip.rank,
        me: mine ? { rank: mine.guessedRank, score: mine.score } : null,
        opponent: theirs ? { rank: theirs.guessedRank, score: theirs.score } : null,
      };
    });
    const currentClip = m.status === "ACTIVE" ? clips[m.currentRound - 1]?.clipId : undefined;
    const roundAnswers = currentClip ? answers.filter((a) => a.clipId === currentClip) : [];
    const rating = m.random && m.status === "FINISHED" ? await this.ratings.forDuel(userId, id, m.game?.slug ?? null) : null;
    return { ...this.toDto(m, userId, details, roundAnswers), rating };
  }

  /** Bilan des duels (depuis la dernière remise à zéro des statistiques du joueur, le cas échéant). */
  async stats(userId: string): Promise<VersusStatsDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { statsResetAt: true } });
    const finished = await this.prisma.versusMatch.findMany({
      where: {
        status: "FINISHED",
        OR: [{ creatorId: userId }, { opponentId: userId }],
        ...(user?.statsResetAt ? { finishedAt: { gt: user.statsResetAt } } : {}),
      },
      select: { winnerId: true },
    });
    return {
      wins: finished.filter((m) => m.winnerId === userId).length,
      losses: finished.filter((m) => m.winnerId && m.winnerId !== userId).length,
      draws: finished.filter((m) => !m.winnerId).length,
    };
  }

  private toDto(m: MatchRow, userId: string, details: VersusRoundDto[], roundAnswers: RoundAnswer[]): VersusMatchDto {
    const isCreator = m.creatorId === userId;
    const meRow = isCreator ? m.creator : m.opponent!;
    const otherRow = isCreator ? m.opponent : m.creator;
    const myScore = isCreator ? m.creatorScore : m.opponentScore;
    const otherScore = isCreator ? m.opponentScore : m.creatorScore;
    const player = (u: Player, score: number) => ({
      id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, vip: isVip(u.subscription), score, flair: toFlair(u),
    });
    const ended = m.status === "FINISHED";
    const live = m.status === "ACTIVE" && m.roundStartsAt && m.roundEndsAt
      ? {
          round: m.currentRound,
          startsAt: m.roundStartsAt.toISOString(),
          endsAt: m.roundEndsAt.toISOString(),
          serverNow: new Date().toISOString(),
          answered: roundAnswers.some((a) => a.userId === userId),
          opponentAnswered: roundAnswers.some((a) => a.userId !== userId),
        }
      : null;
    return {
      id: m.id,
      status: m.status,
      random: m.random,
      game: m.game,
      rounds: m.rounds,
      isCreator,
      me: player(meRow, myScore),
      opponent: otherRow ? player(otherRow, otherScore) : null,
      result: ended ? (m.winnerId === null ? "draw" : m.winnerId === userId ? "me" : "opponent") : null,
      forfeit: !!m.forfeitedById,
      canAccept: !isCreator && m.status === "PENDING" && m.expiresAt > new Date(),
      canCancel: isCreator && (m.status === "OPEN" || m.status === "PENDING"),
      live,
      createdAt: m.createdAt.toISOString(),
      expiresAt: m.expiresAt.toISOString(),
      finishedAt: m.finishedAt?.toISOString() ?? null,
      details,
      rating: null,
    };
  }

  /** Classement compétitif (duels au hasard seulement) ; une erreur ici ne bloque pas la fin du duel, le rattrapage s'en charge. */
  private async rate(matchId: string) {
    try {
      await this.ratings.recordDuel(matchId);
    } catch (e) {
      this.logger.error(`Duel ${matchId} : cote non mise à jour`, e as Error);
    }
  }

  // ---------- Temps réel ----------

  private notify(userIds: string[], matchId: string) {
    for (const id of userIds) this.gateway.emitToUser(id, VERSUS_EVENT, { id: matchId });
  }

  private async notifyMatch(matchId: string) {
    const m = await this.prisma.versusMatch.findUnique({ where: { id: matchId }, select: { creatorId: true, opponentId: true } });
    if (m) this.notify([m.creatorId, ...(m.opponentId ? [m.opponentId] : [])], matchId);
  }
}
