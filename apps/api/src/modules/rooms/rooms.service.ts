import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_COUNTDOWN_SEC, ROOM_EVENT, ROOM_INVITE_EVENT, ROOM_LOBBY_TTL_MIN, ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS, ROOM_REVEAL_SEC, formatRoomCode, placements, roomRoundSec,
  type PlayableClipDto, type RoomDto, type RoomInviteDto, type RoomPreviewDto, type RoomRoundDto,
  type RoomSummaryDto, type RoomsOverviewDto,
} from "@ranksight/shared";
import type { z } from "zod";
import type { CreateRoomInput } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { ClipsService, clipInclude, noClipAvailable } from "../clips/clips.service.js";
import { PlayTokenService } from "../clips/play-token.service.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { PushService } from "../notifications/notifications.module.js";
import { canHostVipGames, isVip, vipSelect } from "../shop/vip.js";

const SEC = 1000;
/** Marge accordée à une réponse envoyée juste avant la fin du chrono (latence réseau) */
const ANSWER_GRACE = 2 * SEC;
/** Codes faux tolérés par joueur et par heure avant blocage temporaire (protège les salons contre la recherche de codes) */
const MAX_CODE_FAILURES = 15;
const LIVE = ["LOBBY", "ACTIVE"] as const;

const playerSelect = { id: true, displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } as const;
const roomInclude = {
  game: { select: { slug: true, name: true } },
  host: { select: { displayName: true } },
  players: { include: { user: { select: playerSelect } }, orderBy: { joinedAt: "asc" as const } },
} as const;
const rankSelect = { id: true, name: true, color: true, order: true, iconUrl: true } as const;

type RoomRow = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;
type CreateInput = z.output<typeof CreateRoomInput>;
export type RoomClip = PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string };

const later = (ms: number) => new Date(Date.now() + ms);
const vipRequired = () =>
  new HttpException(
    { code: "PREMIUM_REQUIRED", message: "Créer un salon privé est réservé aux joueurs VIP. Rejoindre le salon d'un ami reste gratuit." },
    HttpStatus.PAYMENT_REQUIRED,
  );
const notFound = () => new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Salon introuvable." });

/**
 * Salons privés : jusqu'à 8 joueurs voient le même clip au même moment.
 * Seule la création exige le VIP (vérifié en base) ; rejoindre, jouer et consulter les résultats est gratuit,
 * et une partie lancée va toujours à son terme, même si l'hôte perd son VIP entre-temps.
 * Les réponses passent par le circuit habituel (jeton de partie à usage unique, score calculé par le serveur) ;
 * le rang réel et les réponses des autres ne sont dévoilés qu'à la fin de chaque manche.
 * Les salons donnent de l'XP mais ne modifient aucun classement.
 */
@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clips: ClipsService,
    private readonly playTokens: PlayTokenService,
    private readonly gateway: ChatGateway,
    private readonly push: PushService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------- Création, accès ----------

  async create(userId: string, input: CreateInput): Promise<RoomDto> {
    if (!(await canHostVipGames(this.prisma, userId))) throw vipRequired();
    const game = await this.prisma.game.findFirst({ where: { slug: input.game, isActive: true }, select: { id: true } });
    if (!game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    // Assez de clips pour toutes les manches (vérifié de nouveau au lancement, avec tous les joueurs)
    await this.pickClips(game.id, input.rounds, [userId], true);

    const { id, left } = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const left = await this.leaveOtherLobbies(tx, userId);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = this.newCode();
        if (await tx.room.findUnique({ where: { code }, select: { id: true } })) continue;
        const room = await tx.room.create({
          data: {
            code, createdById: userId, hostId: userId, gameId: game.id, rounds: input.rounds, roundSec: input.roundSec,
            maxPlayers: ROOM_MAX_PLAYERS, expiresAt: later(ROOM_LOBBY_TTL_MIN * 60 * SEC),
            players: { create: { userId } },
          },
        });
        return { id: room.id, left };
      }
      throw new ConflictException({ code: "ROOM_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
    });
    for (const roomId of left) await this.notifyRoom(roomId);
    return this.detail(userId, id);
  }

  /** Aperçu d'un salon par son code, avant de le rejoindre. */
  async preview(userId: string, code: string): Promise<RoomPreviewDto> {
    const room = await this.byCode(userId, code);
    const players = room.players.filter((p) => !p.leftAt);
    return {
      id: room.id, code: room.code, host: room.host.displayName, game: room.game, rounds: room.rounds, roundSec: room.roundSec,
      players: players.length, maxPlayers: room.maxPlayers, status: room.status,
      member: room.players.some((p) => p.userId === userId),
    };
  }

  /** Rejoindre avec le code (ou depuis une invitation). Aucun VIP n'est demandé aux invités. */
  async join(userId: string, code: string): Promise<RoomDto> {
    const found = await this.byCode(userId, code);
    if (found.players.some((p) => p.userId === userId && !p.leftAt)) return this.detail(userId, found.id);
    if (found.status !== "LOBBY") {
      throw new ConflictException({ code: "ROOM_STARTED", message: found.status === "ACTIVE" ? "La partie a déjà commencé." : "Ce salon est fermé." });
    }
    if (await this.redis.sismember(`room:kicked:${found.id}`, userId)) {
      throw new ForbiddenException({ code: "ROOM_KICKED", message: "L'hôte t'a retiré de ce salon." });
    }
    const others = found.players.map((p) => p.userId);
    const blocked = await this.prisma.userBlock.count({
      where: { OR: [{ blockerId: userId, blockedId: { in: others } }, { blockerId: { in: others }, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException({ code: "ROOM_UNAVAILABLE", message: "Impossible de rejoindre ce salon." });

    const left = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const [room] = await tx.$queryRaw<{ status: string; max_players: number }[]>`
        SELECT status::text, max_players FROM rooms WHERE id = ${found.id}::uuid FOR UPDATE`;
      if (!room || room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
      const busy = await tx.roomPlayer.findFirst({
        where: { userId, leftAt: null, room: { status: "ACTIVE" } },
        select: { roomId: true },
      });
      if (busy) throw new ConflictException({ code: "ROOM_IN_PROGRESS", message: "Termine d'abord ta partie en cours.", id: busy.roomId });
      const left = await this.leaveOtherLobbies(tx, userId, found.id);
      const count = await tx.roomPlayer.count({ where: { roomId: found.id, leftAt: null } });
      if (count >= room.max_players) throw new ConflictException({ code: "ROOM_FULL", message: "Ce salon est complet." });
      await tx.roomPlayer.create({ data: { roomId: found.id, userId } });
      await tx.roomInvite.deleteMany({ where: { roomId: found.id, userId } });
      return left;
    });
    for (const roomId of left) await this.notifyRoom(roomId);
    await this.notifyRoom(found.id);
    return this.detail(userId, found.id);
  }

  /** Inviter un ami (salle d'attente uniquement). L'ami reçoit une notification ; il rejoint sans VIP. */
  async invite(userId: string, roomId: string, friendId: string) {
    const room = await this.memberRoom(userId, roomId);
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    if (friendId === userId) throw new BadRequestException("Tu fais déjà partie du salon.");
    const friend = await this.prisma.friendship.findFirst({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId, addresseeId: friendId }, { requesterId: friendId, addresseeId: userId }] },
      include: { requester: { select: { status: true } }, addressee: { select: { status: true } } },
    });
    if (!friend || friend.requester.status !== "ACTIVE" || friend.addressee.status !== "ACTIVE") {
      throw new ForbiddenException("Tu ne peux inviter que tes amis. Pour les autres, partage le code du salon.");
    }
    if (room.players.some((p) => p.userId === friendId && !p.leftAt)) return { invited: false };
    const me = room.players.find((p) => p.userId === userId)!.user;
    await this.prisma.roomInvite.upsert({
      where: { roomId_userId: { roomId, userId: friendId } },
      create: { roomId, userId: friendId, invitedById: userId },
      update: { invitedById: userId, createdAt: new Date() },
    });
    this.gateway.emitToUser(friendId, ROOM_INVITE_EVENT, { id: roomId });
    await this.push.toUsers([friendId], {
      title: "Salon privé",
      body: `${me.displayName} t'invite à jouer sur ${room.game.name} (code ${formatRoomCode(room.code)}).`,
      data: { url: `rooms/join/${room.code}` },
    });
    return { invited: true };
  }

  async declineInvite(userId: string, roomId: string) {
    await this.prisma.roomInvite.deleteMany({ where: { roomId, userId } });
  }

  /** L'hôte retire un joueur de la salle d'attente (il ne pourra pas revenir dans ce salon). */
  async kick(userId: string, roomId: string, targetId: string) {
    const room = await this.memberRoom(userId, roomId);
    if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut retirer un joueur." });
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    if (targetId === userId) throw new BadRequestException("Utilise « Quitter » pour partir du salon.");
    const { count } = await this.prisma.roomPlayer.deleteMany({ where: { roomId, userId: targetId } });
    if (!count) throw new NotFoundException("Ce joueur n'est pas dans le salon.");
    await this.redis.sadd(`room:kicked:${roomId}`, targetId);
    await this.redis.expire(`room:kicked:${roomId}`, 6 * 3600);
    this.gateway.emitToUser(targetId, ROOM_EVENT, { id: roomId });
    await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
  }

  /**
   * Quitter : en salle d'attente, le joueur sort du salon ; pendant la partie, il garde ses points mais ne répond plus.
   * Si l'hôte part, le joueur arrivé le plus tôt devient hôte ; sans plus personne, le salon ferme (ou la partie se termine).
   */
  async leave(userId: string, roomId: string) {
    const room = await this.memberRoom(userId, roomId);
    const seat = room.players.find((p) => p.userId === userId);
    if (!seat || seat.leftAt || !LIVE.some((s) => s === room.status)) return;
    let finish = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      const current = await tx.room.findUniqueOrThrow({ where: { id: roomId }, select: { status: true, hostId: true } });
      if (current.status === "LOBBY") await tx.roomPlayer.delete({ where: { roomId_userId: { roomId, userId } } });
      else if (current.status === "ACTIVE") await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId } }, data: { leftAt: new Date() } });
      else return;
      const remaining = await tx.roomPlayer.findMany({ where: { roomId, leftAt: null }, orderBy: { joinedAt: "asc" }, select: { userId: true } });
      if (!remaining.length) {
        if (current.status === "LOBBY") await tx.room.update({ where: { id: roomId }, data: { status: "CLOSED", finishedAt: new Date() } });
        else finish = true;
        return;
      }
      if (current.hostId === userId) await tx.room.update({ where: { id: roomId }, data: { hostId: remaining[0]!.userId } });
    });
    this.gateway.emitToUser(userId, ROOM_EVENT, { id: roomId });
    if (finish) await this.finish(roomId);
    else if (room.status === "ACTIVE") await this.checkRoundComplete(roomId);
    await this.notifyRoom(roomId);
  }

  /** Lancement par l'hôte : au moins 2 joueurs ; les clips sont tirés à ce moment (jamais ceux proposés par un joueur du salon). */
  async start(userId: string, roomId: string): Promise<RoomDto> {
    const room = await this.memberRoom(userId, roomId);
    if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut lancer la partie." });
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    const players = room.players.filter((p) => !p.leftAt).map((p) => p.userId);
    if (players.length < ROOM_MIN_PLAYERS) {
      throw new BadRequestException({ code: "NOT_ENOUGH_PLAYERS", message: `Il faut au moins ${ROOM_MIN_PLAYERS} joueurs pour lancer la partie.` });
    }
    const clipIds = await this.pickClips(room.gameId, room.rounds, players);
    const first = await this.prisma.clip.findUniqueOrThrow({ where: { id: clipIds[0]! }, select: { durationSec: true } });
    const startsAt = later(ROOM_COUNTDOWN_SEC * SEC);
    const started = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.room.updateMany({
        where: { id: roomId, status: "LOBBY", hostId: userId },
        data: {
          status: "ACTIVE", startedAt: new Date(), currentRound: 1, roundStartsAt: startsAt,
          roundEndsAt: new Date(startsAt.getTime() + roomRoundSec(first.durationSec, room.roundSec) * SEC),
        },
      });
      if (!count) return false;
      await tx.roomRound.createMany({ data: clipIds.map((clipId, position) => ({ roomId, clipId, position })) });
      await tx.roomInvite.deleteMany({ where: { roomId } });
      return true;
    });
    if (!started) throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
  }

  // ---------- Manches ----------

  /** Clip de la manche en cours (sans le rang), pendant le chrono, pour un joueur encore en jeu qui n'a pas répondu. */
  async next(userId: string, roomId: string): Promise<RoomClip> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { roundList: { orderBy: { position: "asc" } } } });
    const seat = room ? await this.prisma.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } } }) : null;
    if (!room || !seat) throw notFound();
    if (seat.leftAt) throw new ConflictException({ code: "ROOM_LEFT", message: "Tu as quitté cette partie." });
    if (room.status !== "ACTIVE" || !room.roundStartsAt || !room.roundEndsAt) {
      throw new ConflictException({ code: "ROOM_CLOSED", message: "Cette partie n'est pas en cours." });
    }
    const now = Date.now();
    if (now < room.roundStartsAt.getTime() - 500) throw new ConflictException({ code: "ROUND_NOT_STARTED", message: "La manche n'a pas encore commencé." });
    if (now > room.roundEndsAt.getTime()) throw new ConflictException({ code: "ROUND_OVER", message: "Temps écoulé pour cette manche." });
    const current = room.roundList[room.currentRound - 1];
    if (!current) throw noClipAvailable();
    const answered = await this.prisma.guess.count({ where: { userId, roomId, clipId: current.clipId } });
    if (answered) throw new ConflictException({ code: "ALREADY_ANSWERED", message: "Tu as déjà répondu à cette manche." });
    const clip = await this.prisma.clip.findUnique({ where: { id: current.clipId }, include: clipInclude });
    if (!clip) throw noClipAvailable();
    const token = await this.playTokens.sign({ uid: userId, cid: clip.id, mode: "ROOM", rmid: roomId });
    return {
      ...(await this.clips.toPlayable(clip, token, "ROOM", null)),
      position: room.currentRound,
      rounds: room.rounds,
      endsAt: room.roundEndsAt.toISOString(),
      serverNow: new Date().toISOString(),
    };
  }

  /** Avant d'enregistrer une réponse : clip de la manche en cours, partie en cours, joueur encore en jeu, dans le temps. */
  async assertCanAnswer(userId: string, roomId: string, clipId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { roundList: { orderBy: { position: "asc" } } } });
    const seat = room ? await this.prisma.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } } }) : null;
    const current = room?.roundList[(room?.currentRound ?? 0) - 1];
    if (!room || !seat || seat.leftAt || room.status !== "ACTIVE" || !current || current.clipId !== clipId || !room.roundEndsAt) {
      throw new ConflictException({ code: "ROUND_OVER", message: "Cette manche est terminée." });
    }
    if (Date.now() > room.roundEndsAt.getTime() + ANSWER_GRACE) {
      throw new ConflictException({ code: "ROUND_OVER", message: "Temps écoulé : ta réponse n'a pas été prise en compte." });
    }
  }

  /** Après une réponse : total du joueur recalculé ; la manche se termine dès que tous les joueurs en jeu ont répondu. */
  async afterAnswer(userId: string, roomId: string) {
    const total = await this.prisma.guess.aggregate({ where: { roomId, userId }, _sum: { score: true } });
    await this.prisma.roomPlayer.update({ where: { roomId_userId: { roomId, userId } }, data: { score: total._sum.score ?? 0 } });
    const room = await this.checkRoundComplete(roomId);
    return { position: room?.currentRound ?? 0, rounds: room?.rounds ?? 0 };
  }

  private async checkRoundComplete(roomId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { roundList: { orderBy: { position: "asc" } } } });
    if (!room || room.status !== "ACTIVE") return room;
    const current = room.roundList[room.currentRound - 1];
    const [active, answered] = await Promise.all([
      this.prisma.roomPlayer.findMany({ where: { roomId, leftAt: null }, select: { userId: true } }),
      current ? this.prisma.guess.findMany({ where: { roomId, clipId: current.clipId }, select: { userId: true } }) : [],
    ]);
    const done = new Set(answered.map((a) => a.userId));
    if (active.length && active.every((p) => done.has(p.userId))) await this.advance(roomId, room.currentRound);
    else await this.notifyRoom(roomId);
    return room;
  }

  /**
   * Fin de la manche `round` : manche suivante après la pause d'affichage, ou fin de la partie.
   * Conditionnée à la manche courante : une seule instance de l'API l'applique.
   */
  private async advance(roomId: string, round: number) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { roundList: { orderBy: { position: "asc" }, include: { clip: { select: { durationSec: true } } } } } });
    if (!room || room.status !== "ACTIVE" || room.currentRound !== round) return;
    if (round < room.rounds) {
      const next = room.roundList[round];
      const startsAt = later(ROOM_REVEAL_SEC * SEC);
      const { count } = await this.prisma.room.updateMany({
        where: { id: roomId, status: "ACTIVE", currentRound: round },
        data: {
          currentRound: round + 1, roundStartsAt: startsAt,
          roundEndsAt: new Date(startsAt.getTime() + roomRoundSec(next?.clip.durationSec ?? 0, room.roundSec) * SEC),
        },
      });
      if (count) await this.notifyRoom(roomId);
      return;
    }
    await this.finish(roomId, round);
  }

  /** Fin de partie : totaux recalculés depuis les réponses, places finales (les joueurs partis sont classés après les autres). */
  private async finish(roomId: string, round?: number) {
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.room.updateMany({
        where: { id: roomId, status: "ACTIVE", ...(round ? { currentRound: round } : {}) },
        data: { status: "FINISHED", finishedAt: new Date(), roundStartsAt: null, roundEndsAt: null },
      });
      if (!count) return false;
      const [players, totals] = await Promise.all([
        tx.roomPlayer.findMany({ where: { roomId }, select: { userId: true, leftAt: true } }),
        tx.guess.groupBy({ by: ["userId"], where: { roomId }, _sum: { score: true } }),
      ]);
      const scoreOf = (id: string) => totals.find((t) => t.userId === id)?._sum.score ?? 0;
      const stayed = players.filter((p) => !p.leftAt).map((p) => ({ id: p.userId, score: scoreOf(p.userId) }));
      const left = players.filter((p) => p.leftAt).map((p) => ({ id: p.userId, score: scoreOf(p.userId) }));
      const places = placements(stayed);
      const leftPlaces = placements(left);
      for (const p of stayed) {
        await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId: p.id } }, data: { score: p.score, placement: places.get(p.id)! } });
      }
      for (const p of left) {
        await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId: p.id } }, data: { score: p.score, placement: stayed.length + leftPlaces.get(p.id)! } });
      }
      return true;
    });
    if (done) await this.notifyRoom(roomId);
  }

  /** Chaque seconde (une seule instance à la fois, verrou Redis) : chronos écoulés, salles d'attente abandonnées. */
  @Interval(SEC)
  async tick() {
    const lock = await this.redis.set("rooms:tick", "1", "PX", 900, "NX").catch(() => null);
    if (!lock) return;
    const now = new Date();
    const overdue = await this.prisma.room.findMany({
      where: { status: "ACTIVE", roundEndsAt: { lt: new Date(now.getTime() - ANSWER_GRACE) } },
      select: { id: true, currentRound: true },
      take: 200,
    });
    for (const r of overdue) {
      try {
        await this.advance(r.id, r.currentRound);
      } catch (e) {
        this.logger.error(`Salon ${r.id} : passage de manche impossible`, e as Error);
      }
    }
    const stale = await this.prisma.room.findMany({ where: { status: "LOBBY", expiresAt: { lte: now } }, select: { id: true }, take: 200 });
    for (const r of stale) {
      const { count } = await this.prisma.room.updateMany({ where: { id: r.id, status: "LOBBY" }, data: { status: "CLOSED", finishedAt: now } });
      if (count) await this.notifyRoom(r.id);
    }
  }

  // ---------- Lecture ----------

  async overview(userId: string): Promise<RoomsOverviewDto> {
    const [canHost, seats, invites] = await Promise.all([
      canHostVipGames(this.prisma, userId),
      this.prisma.roomPlayer.findMany({
        where: { userId },
        orderBy: { joinedAt: "desc" },
        take: 20,
        include: { room: { include: { game: { select: { slug: true, name: true } }, host: { select: { displayName: true } }, _count: { select: { players: { where: { leftAt: null } } } } } } },
      }),
      this.prisma.roomInvite.findMany({
        where: { userId, room: { status: "LOBBY", expiresAt: { gt: new Date() } } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          invitedBy: { select: { displayName: true } },
          room: { include: { game: { select: { slug: true, name: true } }, _count: { select: { players: { where: { leftAt: null } } } } } },
        },
      }),
    ]);
    const summary = (s: (typeof seats)[number]): RoomSummaryDto => ({
      id: s.room.id, code: s.room.code, status: s.room.status, game: s.room.game, host: s.room.host.displayName,
      players: s.room._count.players, maxPlayers: s.room.maxPlayers, placement: s.placement, createdAt: s.room.createdAt.toISOString(),
    });
    const current = seats.find((s) => !s.leftAt && LIVE.some((st) => st === s.room.status));
    return {
      canHost,
      current: current ? summary(current) : null,
      invites: invites.map((i): RoomInviteDto => ({
        roomId: i.roomId, code: i.room.code, from: i.invitedBy.displayName, game: i.room.game,
        players: i.room._count.players, maxPlayers: i.room.maxPlayers, createdAt: i.createdAt.toISOString(),
      })),
      recent: seats.filter((s) => s.room.status === "FINISHED").slice(0, 10).map(summary),
    };
  }

  /** Détail d'un salon, pour ses membres (y compris ceux qui sont partis pendant la partie). */
  async detail(userId: string, roomId: string): Promise<RoomDto> {
    const room = await this.memberRoom(userId, roomId);
    const rounds = await this.prisma.roomRound.findMany({
      where: { roomId },
      orderBy: { position: "asc" },
      include: { clip: { select: { id: true, rank: { select: rankSelect } } } },
    });
    const answers = await this.prisma.guess.findMany({
      where: { roomId },
      select: { userId: true, clipId: true, score: true, guessedRank: { select: rankSelect } },
    });
    // Manches dévoilées : celles déjà terminées (toutes une fois la partie finie). Jamais le rang de la manche en cours.
    const resolved = room.status === "ACTIVE" ? room.currentRound - 1 : room.status === "FINISHED" ? room.rounds : 0;
    const details: RoomRoundDto[] = rounds.slice(0, resolved).map((r) => ({
      position: r.position + 1,
      correctRank: r.clip.rank,
      answers: answers.filter((a) => a.clipId === r.clipId).map((a) => ({ userId: a.userId, rank: a.guessedRank, score: a.score })),
    }));
    const currentClip = room.status === "ACTIVE" ? rounds[room.currentRound - 1]?.clipId : undefined;
    const answeredNow = new Set(currentClip ? answers.filter((a) => a.clipId === currentClip).map((a) => a.userId) : []);
    const me = room.players.find((p) => p.userId === userId)!;
    const active = room.players.filter((p) => !p.leftAt);
    const players = [...room.players].sort((a, b) =>
      room.status === "FINISHED" ? (a.placement ?? 99) - (b.placement ?? 99) : room.status === "ACTIVE" ? b.score - a.score : 0,
    );
    return {
      id: room.id,
      code: room.code,
      status: room.status,
      game: room.game,
      rounds: room.rounds,
      roundSec: room.roundSec,
      maxPlayers: room.maxPlayers,
      isHost: room.hostId === userId,
      left: !!me.leftAt,
      canStart: room.status === "LOBBY" && room.hostId === userId && active.length >= ROOM_MIN_PLAYERS,
      players: players.map((p) => ({
        id: p.userId,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        vip: isVip(p.user.subscription),
        flair: toFlair(p.user),
        score: p.score,
        isHost: p.userId === room.hostId,
        left: !!p.leftAt,
        answered: answeredNow.has(p.userId),
        placement: p.placement,
      })),
      live: room.status === "ACTIVE" && room.roundStartsAt && room.roundEndsAt
        ? {
            round: room.currentRound,
            startsAt: room.roundStartsAt.toISOString(),
            endsAt: room.roundEndsAt.toISOString(),
            serverNow: new Date().toISOString(),
            answered: answeredNow.has(userId),
          }
        : null,
      details,
      createdAt: room.createdAt.toISOString(),
      startedAt: room.startedAt?.toISOString() ?? null,
      finishedAt: room.finishedAt?.toISOString() ?? null,
      expiresAt: room.expiresAt.toISOString(),
    };
  }

  // ---------- Outils ----------

  private newCode() {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    return code;
  }

  /** Recherche par code, avec limite de codes faux par joueur (une recherche de codes au hasard est vite bloquée). */
  private async byCode(userId: string, code: string): Promise<RoomRow> {
    const key = `room:codefail:${userId}`;
    const failures = Number(await this.redis.get(key)) || 0;
    if (failures >= MAX_CODE_FAILURES) {
      throw new HttpException({ code: "TOO_MANY_ATTEMPTS", message: "Trop de codes incorrects. Réessaie dans une heure." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const room = await this.prisma.room.findUnique({ where: { code }, include: roomInclude });
    if (!room || room.status === "CLOSED") {
      await this.redis.multi().incr(key).expire(key, 3600).exec();
      throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Aucun salon ouvert avec ce code." });
    }
    return room;
  }

  private async memberRoom(userId: string, roomId: string): Promise<RoomRow> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
    if (!room || !room.players.some((p) => p.userId === userId)) throw notFound();
    return room;
  }

  /** Verrou sur le joueur : deux demandes simultanées ne peuvent pas l'inscrire dans deux salons. */
  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  /**
   * Un joueur n'est que dans un salon à la fois : rejoindre ou créer un salon le fait sortir de sa salle d'attente précédente.
   * Une partie déjà lancée doit d'abord être terminée ou quittée.
   */
  private async leaveOtherLobbies(tx: Prisma.TransactionClient, userId: string, exceptRoomId?: string): Promise<string[]> {
    const active = await tx.roomPlayer.findFirst({ where: { userId, leftAt: null, room: { status: "ACTIVE" } }, select: { roomId: true } });
    if (active) throw new ConflictException({ code: "ROOM_IN_PROGRESS", message: "Termine d'abord ta partie en cours.", id: active.roomId });
    const lobbies = await tx.roomPlayer.findMany({
      where: { userId, room: { status: "LOBBY", ...(exceptRoomId ? { id: { not: exceptRoomId } } : {}) } },
      select: { roomId: true, room: { select: { hostId: true } } },
    });
    for (const l of lobbies) {
      await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: l.roomId, userId } } });
      const remaining = await tx.roomPlayer.findFirst({ where: { roomId: l.roomId }, orderBy: { joinedAt: "asc" }, select: { userId: true } });
      if (!remaining) await tx.room.update({ where: { id: l.roomId }, data: { status: "CLOSED", finishedAt: new Date() } });
      else if (l.room.hostId === userId) await tx.room.update({ where: { id: l.roomId }, data: { hostId: remaining.userId } });
    }
    return lobbies.map((l) => l.roomId);
  }

  /** Clips acceptés du jeu choisi, au hasard, jamais proposés par un joueur du salon. */
  private async pickClips(gameId: string, rounds: number, players: string[], checkOnly = false): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM clips c
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${gameId}::uuid
        AND c.uploader_id <> ALL(${players}::uuid[])
      ORDER BY random() LIMIT ${rounds}`;
    if (rows.length < rounds) {
      throw new NotFoundException({
        code: "NOT_ENOUGH_CLIPS",
        message: checkOnly
          ? "Pas encore assez de clips sur ce jeu pour ce nombre de manches. Choisis moins de manches ou un autre jeu."
          : "Pas assez de clips sur ce jeu pour tous les joueurs du salon. Choisis moins de manches.",
      });
    }
    return rows.map((r) => r.id);
  }

  private async notifyRoom(roomId: string) {
    const players = await this.prisma.roomPlayer.findMany({ where: { roomId }, select: { userId: true } });
    for (const p of players) this.gateway.emitToUser(p.userId, ROOM_EVENT, { id: roomId });
  }
}
