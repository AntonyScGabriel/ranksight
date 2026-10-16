import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SUDDEN_DEATH_MAX_ROUNDS, TOURNAMENT_EVENT, TOURNAMENT_LOBBY_TTL_MIN, TOURNAMENT_MIN_PLAYERS,
  TOURNAMENT_READY_MIN, bracketSize, eliminatedPlacement, firstRoundPairs, nextSlot, stageCount,
  type CreateTournamentInput, type TournamentDecidedBy, type TournamentDto, type TournamentMatchDto, type TournamentPreviewDto,
  type TournamentSummaryDto, type TournamentsOverviewDto,
} from "@ranksight/shared";
import type { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { PushService } from "../notifications/notifications.module.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { canHostVipGames, isVip, vipSelect } from "../shop/vip.js";

const SEC = 1000;
/** Codes faux tolérés par joueur et par heure (compteur partagé avec les salons) */
const MAX_CODE_FAILURES = 15;
const LIVE = ["LOBBY", "ACTIVE"] as const;

const playerSelect = { id: true, displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } as const;
const tournamentInclude = {
  game: { select: { slug: true, name: true } },
  host: { select: { displayName: true } },
  players: { include: { user: { select: playerSelect } }, orderBy: { joinedAt: "asc" as const } },
  matches: { orderBy: [{ stage: "asc" }, { slot: "asc" }] as Prisma.TournamentMatchOrderByWithRelationInput[] },
} satisfies Prisma.TournamentInclude;

type TournamentRow = Prisma.TournamentGetPayload<{ include: typeof tournamentInclude }>;
type MatchRow = TournamentRow["matches"][number];
type CreateInput = z.output<typeof CreateTournamentInput>;

const later = (ms: number) => new Date(Date.now() + ms);
const notFound = () => new NotFoundException({ code: "TOURNAMENT_NOT_FOUND", message: "Tournoi introuvable." });
const vipRequired = () =>
  new HttpException(
    { code: "PREMIUM_REQUIRED", message: "Créer un tournoi est réservé aux joueurs VIP. S'inscrire au tournoi d'un ami reste gratuit." },
    HttpStatus.PAYMENT_REQUIRED,
  );

/**
 * Tournois privés à élimination directe. Seule la création exige le VIP (vérifié en base) ; s'inscrire, jouer
 * et gagner est gratuit, et un tournoi lancé va à son terme même si le créateur perd son VIP.
 * Chaque match est un salon à 2 avec mort subite (`RoomsService.createMatch`), lancé quand les deux joueurs sont prêts ;
 * absences et forfaits sont réglés par la boucle de suivi (une seule instance de l'API, verrou Redis).
 */
@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly gateway: ChatGateway,
    private readonly push: PushService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------- Inscriptions ----------

  async create(userId: string, input: CreateInput): Promise<TournamentDto> {
    if (!(await canHostVipGames(this.prisma, userId))) throw vipRequired();
    const game = await this.prisma.game.findFirst({ where: { slug: input.game, isActive: true }, select: { id: true } });
    if (!game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    // De quoi jouer un match complet, mort subite comprise
    const needed = input.rounds + SUDDEN_DEATH_MAX_ROUNDS;
    const available = await this.prisma.clip.count({ where: { status: "APPROVED", deletedAt: null, gameId: game.id, uploaderId: { not: userId } } });
    if (available < needed) {
      throw new NotFoundException({ code: "NOT_ENOUGH_CLIPS", message: "Pas encore assez de clips sur ce jeu pour un tournoi. Choisis un autre jeu ou moins de manches." });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = this.newCode();
        if (await tx.tournament.findUnique({ where: { code }, select: { id: true } })) continue;
        const t = await tx.tournament.create({
          data: {
            code, createdById: userId, hostId: userId, gameId: game.id, capacity: input.capacity, rounds: input.rounds, roundSec: input.roundSec,
            expiresAt: later(TOURNAMENT_LOBBY_TTL_MIN * 60 * SEC), players: { create: { userId } },
          },
        });
        return t.id;
      }
      throw new ConflictException({ code: "TOURNAMENT_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
    });
    return this.detail(userId, id);
  }

  async preview(userId: string, code: string): Promise<TournamentPreviewDto> {
    const t = await this.byCode(userId, code);
    return {
      id: t.id, code: t.code, host: t.host.displayName, game: t.game, capacity: t.capacity, rounds: t.rounds,
      players: t.players.filter((p) => !p.leftAt).length, status: t.status, member: t.players.some((p) => p.userId === userId),
    };
  }

  /** Inscription avec le code : gratuite, jusqu'au lancement et dans la limite des places. */
  async join(userId: string, code: string): Promise<TournamentDto> {
    const found = await this.byCode(userId, code);
    if (found.players.some((p) => p.userId === userId)) return this.detail(userId, found.id);
    if (found.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
    const others = found.players.map((p) => p.userId);
    const blocked = await this.prisma.userBlock.count({
      where: { OR: [{ blockerId: userId, blockedId: { in: others } }, { blockerId: { in: others }, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException({ code: "TOURNAMENT_UNAVAILABLE", message: "Impossible de rejoindre ce tournoi." });
    await this.prisma.$transaction(async (tx) => {
      const [t] = await tx.$queryRaw<{ status: string; capacity: number }[]>`
        SELECT status::text, capacity FROM tournaments WHERE id = ${found.id}::uuid FOR UPDATE`;
      if (!t || t.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
      const count = await tx.tournamentPlayer.count({ where: { tournamentId: found.id } });
      if (count >= t.capacity) throw new ConflictException({ code: "TOURNAMENT_FULL", message: "Ce tournoi est complet." });
      await tx.tournamentPlayer.create({ data: { tournamentId: found.id, userId } });
    });
    await this.notify(found.id);
    return this.detail(userId, found.id);
  }

  /**
   * Quitter : avant le lancement, l'inscription est retirée (l'hôte est remplacé par le plus ancien inscrit) ;
   * après, le joueur perd son match en cours ou à venir par forfait.
   */
  async leave(userId: string, tournamentId: string) {
    const t = await this.memberTournament(userId, tournamentId);
    const seat = t.players.find((p) => p.userId === userId)!;
    if (t.status === "LOBBY") {
      await this.prisma.$transaction(async (tx) => {
        await tx.tournamentPlayer.delete({ where: { tournamentId_userId: { tournamentId, userId } } });
        const remaining = await tx.tournamentPlayer.findFirst({ where: { tournamentId }, orderBy: { joinedAt: "asc" }, select: { userId: true } });
        if (!remaining) await tx.tournament.update({ where: { id: tournamentId }, data: { status: "CLOSED", finishedAt: new Date() } });
        else if (t.hostId === userId) await tx.tournament.update({ where: { id: tournamentId }, data: { hostId: remaining.userId } });
      });
      this.gateway.emitToUser(userId, TOURNAMENT_EVENT, { id: tournamentId });
      await this.notify(tournamentId);
      return;
    }
    if (t.status !== "ACTIVE" || seat.leftAt) return;
    await this.prisma.tournamentPlayer.update({ where: { tournamentId_userId: { tournamentId, userId } }, data: { leftAt: new Date() } });
    const match = t.matches.find((m) => !m.winnerId && (m.player1Id === userId || m.player2Id === userId));
    if (match?.roomId) {
      // Match en cours : le départ du salon le termine (victoire de l'adversaire), réglé par la boucle de suivi
      await this.rooms.leave(userId, match.roomId);
    } else if (match) {
      const other = match.player1Id === userId ? match.player2Id : match.player1Id;
      if (other) await this.resolve(match.id, other, "FORFEIT");
    }
    await this.notify(tournamentId);
  }

  /** Lancement par l'hôte (3 joueurs au moins) : têtes de série au hasard, tableau complet, qualifiés d'office. */
  async start(userId: string, tournamentId: string): Promise<TournamentDto> {
    const t = await this.memberTournament(userId, tournamentId);
    if (t.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut lancer le tournoi." });
    if (t.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
    const players = t.players.map((p) => p.userId);
    if (players.length < TOURNAMENT_MIN_PLAYERS) {
      throw new BadRequestException({ code: "NOT_ENOUGH_PLAYERS", message: `Il faut au moins ${TOURNAMENT_MIN_PLAYERS} joueurs pour lancer le tournoi.` });
    }
    // Têtes de série tirées au sort (mélange de Fisher-Yates, aléa cryptographique)
    const order = [...players];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const size = bracketSize(players.length);
    const pairs = firstRoundPairs(players.length);
    const deadline = later(TOURNAMENT_READY_MIN * 60 * SEC);
    const started = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tournament.updateMany({
        where: { id: tournamentId, status: "LOBBY", hostId: userId },
        data: { status: "ACTIVE", startedAt: new Date(), bracketSize: size },
      });
      if (!count) return false;
      for (const [i, userId_] of order.entries()) {
        await tx.tournamentPlayer.update({ where: { tournamentId_userId: { tournamentId, userId: userId_ } }, data: { seed: i + 1 } });
      }
      const bySeed = (seed: number | null) => (seed === null ? null : order[seed - 1]!);
      const data: Prisma.TournamentMatchCreateManyInput[] = [];
      pairs.forEach(([a, b], slot) => {
        const p1 = bySeed(a);
        const p2 = bySeed(b);
        data.push({ tournamentId, stage: 1, slot, player1Id: p1, player2Id: p2, deadlineAt: p1 && p2 ? deadline : null });
      });
      for (let stage = 2; stage <= stageCount(size); stage++) {
        for (let slot = 0; slot < size / 2 ** stage; slot++) data.push({ tournamentId, stage, slot });
      }
      await tx.tournamentMatch.createMany({ data });
      return true;
    });
    if (!started) throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
    // Qualifiés d'office (place vide en face)
    const byes = await this.prisma.tournamentMatch.findMany({ where: { tournamentId, stage: 1, OR: [{ player1Id: null }, { player2Id: null }] } });
    for (const m of byes) await this.resolve(m.id, (m.player1Id ?? m.player2Id)!, "BYE");
    await this.announceReadyMatches(tournamentId);
    await this.notify(tournamentId);
    return this.detail(userId, tournamentId);
  }

  // ---------- Matchs ----------

  /**
   * « Je suis prêt » pour son match (adversaire connu, avant l'heure limite). Quand les deux le sont,
   * le salon du match est créé et lancé ; les deux joueurs y sont envoyés.
   */
  async ready(userId: string, tournamentId: string): Promise<TournamentDto> {
    const t = await this.memberTournament(userId, tournamentId);
    if (t.status !== "ACTIVE") throw new ConflictException({ code: "TOURNAMENT_NOT_ACTIVE", message: "Le tournoi n'est pas en cours." });
    const m = t.matches.find((x) => !x.winnerId && x.player1Id && x.player2Id && (x.player1Id === userId || x.player2Id === userId));
    if (!m) throw new ConflictException({ code: "NO_MATCH", message: "Tu n'as pas de match à jouer pour l'instant." });
    if (m.roomId) return this.detail(userId, tournamentId);
    if (!m.deadlineAt || m.deadlineAt.getTime() < Date.now()) throw new ConflictException({ code: "MATCH_EXPIRED", message: "L'heure limite de ce match est passée." });
    const side = m.player1Id === userId ? 1 : 2;
    await this.prisma.tournamentMatch.updateMany({
      where: { id: m.id, winnerId: null, roomId: null, ...(side === 1 ? { ready1At: null } : { ready2At: null }) },
      data: side === 1 ? { ready1At: new Date() } : { ready2At: new Date() },
    });
    const fresh = await this.prisma.tournamentMatch.findUniqueOrThrow({ where: { id: m.id } });
    if (fresh.ready1At && fresh.ready2At && !fresh.roomId && !fresh.winnerId) await this.launch(t, fresh);
    await this.notify(tournamentId);
    return this.detail(userId, tournamentId);
  }

  /** Création du salon du match : une seule fois, même si les deux joueurs cliquent au même instant. */
  private async launch(t: TournamentRow, m: MatchRow) {
    const lock = await this.redis.set(`tournament:launch:${m.id}`, "1", "EX", 30, "NX");
    if (!lock) return;
    try {
      const roomId = await this.rooms.createMatch({
        gameId: t.gameId, rounds: t.rounds, roundSec: t.roundSec, createdById: t.createdById, players: [m.player1Id!, m.player2Id!],
      });
      await this.prisma.tournamentMatch.updateMany({ where: { id: m.id, roomId: null, winnerId: null }, data: { roomId } });
    } catch (e) {
      // Pas assez de clips sans ceux des deux joueurs : le match se règle à l'heure limite (meilleure tête de série)
      this.logger.warn(`Match ${m.id} : salon impossible à créer (${(e as Error).message})`);
      await this.redis.del(`tournament:launch:${m.id}`);
      throw e;
    }
  }

  /**
   * Résultat d'un match (une seule fois) : place de l'éliminé, qualification du gagnant pour le match suivant,
   * ou fin du tournoi après la finale.
   */
  private async resolve(matchId: string, winnerId: string, decidedBy: TournamentDecidedBy, scores: { score1?: number | null; score2?: number | null } = {}) {
    const m = await this.prisma.tournamentMatch.findUnique({ where: { id: matchId }, include: { tournament: { select: { id: true, bracketSize: true } } } });
    if (!m || m.winnerId) return;
    const size = m.tournament.bracketSize!;
    const loserId = m.player1Id === winnerId ? m.player2Id : m.player1Id;
    const final = m.stage === stageCount(size);
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tournamentMatch.updateMany({
        where: { id: matchId, winnerId: null },
        data: { winnerId, decidedBy, finishedAt: new Date(), deadlineAt: null, score1: scores.score1 ?? null, score2: scores.score2 ?? null },
      });
      if (!count) return false;
      if (loserId) {
        await tx.tournamentPlayer.update({
          where: { tournamentId_userId: { tournamentId: m.tournamentId, userId: loserId } },
          data: { placement: eliminatedPlacement(size, m.stage) },
        });
      }
      if (final) {
        await tx.tournamentPlayer.update({ where: { tournamentId_userId: { tournamentId: m.tournamentId, userId: winnerId } }, data: { placement: 1 } });
        await tx.tournament.update({ where: { id: m.tournamentId }, data: { status: "FINISHED", finishedAt: new Date() } });
        return true;
      }
      const next = nextSlot(m.stage, m.slot);
      await tx.tournamentMatch.update({
        where: { tournamentId_stage_slot: { tournamentId: m.tournamentId, stage: next.stage, slot: next.slot } },
        data: next.side === 1 ? { player1Id: winnerId } : { player2Id: winnerId },
      });
      return true;
    });
    if (!done || final) return;
    await this.announceReadyMatches(m.tournamentId);
  }

  /**
   * Matchs dont les deux adversaires viennent d'être connus : heure limite pour être prêt, prévenus en direct
   * et par notification ; un joueur qui a quitté le tournoi perd aussitôt par forfait.
   */
  private async announceReadyMatches(tournamentId: string) {
    const fresh = await this.prisma.tournamentMatch.findMany({
      where: { tournamentId, winnerId: null, roomId: null, deadlineAt: null, player1Id: { not: null }, player2Id: { not: null } },
    });
    if (!fresh.length) return;
    const t = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { game: { select: { name: true } }, players: { include: { user: { select: { displayName: true } } } } },
    });
    for (const m of fresh) {
      const p1 = t.players.find((p) => p.userId === m.player1Id)!;
      const p2 = t.players.find((p) => p.userId === m.player2Id)!;
      if (p1.leftAt || p2.leftAt) {
        const winner = p1.leftAt && p2.leftAt ? ((p1.seed ?? 99) < (p2.seed ?? 99) ? p1 : p2) : p1.leftAt ? p2 : p1;
        await this.resolve(m.id, winner.userId, p1.leftAt && p2.leftAt ? "NO_SHOW" : "FORFEIT");
        continue;
      }
      const { count } = await this.prisma.tournamentMatch.updateMany({
        where: { id: m.id, deadlineAt: null, winnerId: null },
        data: { deadlineAt: later(TOURNAMENT_READY_MIN * 60 * SEC) },
      });
      if (!count) continue;
      for (const [me, other] of [[p1, p2], [p2, p1]] as const) {
        await this.push.toUsers([me.userId], {
          title: "Tournoi : ton match est prêt",
          body: `Contre ${other.user.displayName} sur ${t.game.name}. Tu as ${TOURNAMENT_READY_MIN} minutes pour cliquer sur « Je suis prêt ».`,
          data: { url: `tournaments/${tournamentId}` },
        });
      }
    }
  }

  /** Chaque seconde (une seule instance, verrou Redis) : matchs terminés, heures limites dépassées, inscriptions abandonnées. */
  @Interval(SEC)
  async tick() {
    const lock = await this.redis.set("tournaments:tick", "1", "PX", 900, "NX").catch(() => null);
    if (!lock) return;
    const now = new Date();
    try {
      const played = await this.prisma.tournamentMatch.findMany({
        where: { winnerId: null, room: { is: { status: "FINISHED" } } },
        include: {
          room: { select: { decidedBy: true, players: { select: { userId: true, placement: true, score: true, leftAt: true } } } },
          tournament: { select: { players: { select: { userId: true, seed: true } } } },
        },
        take: 100,
      });
      for (const m of played) await this.resolveFromRoom(m);

      const late = await this.prisma.tournamentMatch.findMany({
        where: { winnerId: null, roomId: null, deadlineAt: { lt: now }, player1Id: { not: null }, player2Id: { not: null } },
        include: { tournament: { select: { players: { select: { userId: true, seed: true } } } } },
        take: 100,
      });
      for (const m of late) {
        const seed = (id: string) => m.tournament.players.find((p) => p.userId === id)?.seed ?? 99;
        const better = seed(m.player1Id!) <= seed(m.player2Id!) ? m.player1Id! : m.player2Id!;
        // Un seul joueur prêt : il gagne par forfait ; aucun (ou les deux, salon impossible) : meilleure tête de série
        if (m.ready1At && !m.ready2At) await this.resolve(m.id, m.player1Id!, "FORFEIT");
        else if (m.ready2At && !m.ready1At) await this.resolve(m.id, m.player2Id!, "FORFEIT");
        else await this.resolve(m.id, better, m.ready1At ? "SEED" : "NO_SHOW");
        await this.notify(m.tournamentId);
      }

      const stale = await this.prisma.tournament.findMany({ where: { status: "LOBBY", expiresAt: { lte: now } }, select: { id: true }, take: 100 });
      for (const t of stale) {
        const { count } = await this.prisma.tournament.updateMany({ where: { id: t.id, status: "LOBBY" }, data: { status: "CLOSED", finishedAt: now } });
        if (count) await this.notify(t.id);
      }
    } catch (e) {
      this.logger.error("Suivi des tournois impossible", e as Error);
    }
  }

  /** Salon du match terminé : le 1er du salon gagne ; égalité parfaite → meilleure tête de série. */
  private async resolveFromRoom(m: {
    id: string; tournamentId: string; player1Id: string | null; player2Id: string | null;
    room: { decidedBy: string | null; players: { userId: string; placement: number | null; score: number; leftAt: Date | null }[] } | null;
    tournament: { players: { userId: string; seed: number | null }[] };
  }) {
    const seat = (id: string | null) => m.room!.players.find((p) => p.userId === id);
    const a = seat(m.player1Id);
    const b = seat(m.player2Id);
    const seed = (id: string | null) => m.tournament.players.find((p) => p.userId === id)?.seed ?? 99;
    let winner: string;
    let decidedBy: TournamentDecidedBy;
    if (a?.placement === 1 && b?.placement !== 1) winner = m.player1Id!;
    else if (b?.placement === 1 && a?.placement !== 1) winner = m.player2Id!;
    else winner = seed(m.player1Id) <= seed(m.player2Id) ? m.player1Id! : m.player2Id!;
    const loser = winner === m.player1Id ? b : a;
    if (a?.placement === 1 && b?.placement === 1) decidedBy = "SEED";
    else if (loser?.leftAt) decidedBy = "FORFEIT";
    else decidedBy = (["POINTS", "SUDDEN_DEATH", "SPEED"] as const).find((d) => d === m.room!.decidedBy) ?? "POINTS";
    await this.resolve(m.id, winner, decidedBy, { score1: a?.score ?? 0, score2: b?.score ?? 0 });
    await this.notify(m.tournamentId);
  }

  // ---------- Lecture ----------

  async overview(userId: string): Promise<TournamentsOverviewDto> {
    const [canHost, seats] = await Promise.all([
      canHostVipGames(this.prisma, userId),
      this.prisma.tournamentPlayer.findMany({
        where: { userId },
        orderBy: { joinedAt: "desc" },
        take: 20,
        include: { tournament: { include: { game: { select: { slug: true, name: true } }, host: { select: { displayName: true } }, _count: { select: { players: true } } } } },
      }),
    ]);
    const summary = (s: (typeof seats)[number]): TournamentSummaryDto => ({
      id: s.tournament.id, code: s.tournament.code, status: s.tournament.status, game: s.tournament.game, host: s.tournament.host.displayName,
      players: s.tournament._count.players, capacity: s.tournament.capacity, placement: s.placement, createdAt: s.tournament.createdAt.toISOString(),
    });
    return {
      canHost,
      current: seats.filter((s) => LIVE.some((st) => st === s.tournament.status) && !s.leftAt).map(summary),
      recent: seats.filter((s) => s.tournament.status === "FINISHED").slice(0, 10).map(summary),
    };
  }

  async detail(userId: string, tournamentId: string): Promise<TournamentDto> {
    const t = await this.memberTournament(userId, tournamentId);
    const me = t.players.find((p) => p.userId === userId)!;
    const now = Date.now();
    const status = (m: MatchRow): TournamentMatchDto["status"] =>
      m.winnerId ? "DONE" : m.roomId ? "PLAYING" : m.player1Id && m.player2Id ? "READY" : "WAITING";
    const stats = (id: string) => {
      const mine = t.matches.filter((m) => m.winnerId && (m.player1Id === id || m.player2Id === id));
      return {
        wins: mine.filter((m) => m.winnerId === id && m.decidedBy !== "BYE").length,
        points: mine.reduce((sum, m) => sum + ((m.player1Id === id ? m.score1 : m.score2) ?? 0), 0),
      };
    };
    const myMatch = t.matches.find((m) => !m.winnerId && (m.player1Id === userId || m.player2Id === userId));
    const players = [...t.players].sort((a, b) =>
      t.status === "FINISHED" ? (a.placement ?? 99) - (b.placement ?? 99) : t.status === "ACTIVE" ? (a.seed ?? 99) - (b.seed ?? 99) : 0,
    );
    return {
      id: t.id,
      code: t.code,
      status: t.status,
      game: t.game,
      capacity: t.capacity,
      rounds: t.rounds,
      roundSec: t.roundSec,
      bracketSize: t.bracketSize,
      isHost: t.hostId === userId,
      left: !!me.leftAt,
      canStart: t.status === "LOBBY" && t.hostId === userId && t.players.length >= TOURNAMENT_MIN_PLAYERS,
      players: players.map((p) => ({
        id: p.userId,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        vip: isVip(p.user.subscription),
        flair: toFlair(p.user),
        isHost: p.userId === t.hostId,
        seed: p.seed,
        left: !!p.leftAt,
        eliminated: t.matches.some((m) => m.winnerId && m.winnerId !== p.userId && (m.player1Id === p.userId || m.player2Id === p.userId)),
        placement: p.placement,
        ...stats(p.userId),
      })),
      matches: t.matches.map((m) => ({
        id: m.id,
        stage: m.stage,
        slot: m.slot,
        player1: m.player1Id,
        player2: m.player2Id,
        ready1: !!m.ready1At,
        ready2: !!m.ready2At,
        score1: m.score1,
        score2: m.score2,
        winnerId: m.winnerId,
        decidedBy: m.decidedBy,
        status: status(m),
        deadlineAt: !m.winnerId && !m.roomId && m.deadlineAt && m.deadlineAt.getTime() > now - 60 * SEC ? m.deadlineAt.toISOString() : null,
        roomId: m.player1Id === userId || m.player2Id === userId ? m.roomId : null,
      })),
      myMatch: myMatch?.id ?? null,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      finishedAt: t.finishedAt?.toISOString() ?? null,
      expiresAt: t.expiresAt.toISOString(),
      serverNow: new Date().toISOString(),
    };
  }

  // ---------- Outils ----------

  private newCode() {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    return code;
  }

  private async byCode(userId: string, code: string): Promise<TournamentRow> {
    const key = `room:codefail:${userId}`;
    const failures = Number(await this.redis.get(key)) || 0;
    if (failures >= MAX_CODE_FAILURES) {
      throw new HttpException({ code: "TOO_MANY_ATTEMPTS", message: "Trop de codes incorrects. Réessaie dans une heure." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const t = await this.prisma.tournament.findUnique({ where: { code }, include: tournamentInclude });
    if (!t || t.status === "CLOSED") {
      await this.redis.multi().incr(key).expire(key, 3600).exec();
      throw new NotFoundException({ code: "TOURNAMENT_NOT_FOUND", message: "Aucun tournoi ouvert avec ce code." });
    }
    return t;
  }

  private async memberTournament(userId: string, tournamentId: string): Promise<TournamentRow> {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId }, include: tournamentInclude });
    if (!t || !t.players.some((p) => p.userId === userId)) throw notFound();
    return t;
  }

  private async notify(tournamentId: string) {
    const players = await this.prisma.tournamentPlayer.findMany({ where: { tournamentId }, select: { userId: true } });
    for (const p of players) this.gateway.emitToUser(p.userId, TOURNAMENT_EVENT, { id: tournamentId });
  }
}
