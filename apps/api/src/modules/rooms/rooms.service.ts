import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_COUNTDOWN_SEC, ROOM_EVENT, ROOM_INVITE_EVENT, ROOM_LOBBY_TTL_MIN, ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS, ROOM_REVEAL_SEC, SUDDEN_DEATH_MAX_ROUNDS, TEAM_NAMES, finalPlacements, formatRoomCode, roomRoundSec, suddenDeathOutcome,
  teamPlacements, teamSuddenDeathEntry, teamTotals, tiedLeaders, IMPOSTOR_MIN_PLAYERS, IMPOSTOR_VOTE_SEC, impostorBonuses, pickImpostor,
  type DecidedBy,
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
import { TokensService } from "../tokens/tokens.module.js";

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
const spectator = () =>
  new ForbiddenException({ code: "SUDDEN_DEATH_SPECTATOR", message: "Manche décisive : seuls les joueurs à égalité en tête répondent." });
/** Clips des manches prévues : seuls leurs points comptent dans le total (pas ceux des manches décisives) */
const regularClips = (rounds: { clipId: string; suddenDeath: boolean; altClipId?: string | null }[]) =>
  rounds.filter((r) => !r.suddenDeath).flatMap((r) => (r.altClipId ? [r.clipId, r.altClipId] : [r.clipId]));
/** Clip servi à un joueur pour une manche : celui de l'intrus s'il l'est, sinon le clip de la manche */
const clipFor = (round: { clipId: string; altClipId: string | null; impostorId: string | null }, userId: string) =>
  round.impostorId === userId && round.altClipId ? round.altClipId : round.clipId;
/** Les deux clips d'une manche (mode Intrus) */
const roundClips = (round: { clipId: string; altClipId: string | null }) => (round.altClipId ? [round.clipId, round.altClipId] : [round.clipId]);

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
    private readonly tokens: TokensService,
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
            code, createdById: userId, hostId: userId, gameId: game.id, rounds: input.rounds, roundSec: input.roundSec, suddenDeath: input.suddenDeath,
            confidence: input.confidence, teamSize: input.teamSize || null, impostor: input.impostor,
            maxPlayers: input.teamSize ? input.teamSize * 2 : ROOM_MAX_PLAYERS, expiresAt: later(ROOM_LOBBY_TTL_MIN * 60 * SEC),
            players: { create: { userId, team: input.teamSize ? 1 : null } },
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
      suddenDeath: room.suddenDeath, confidence: room.confidence, teamSize: room.teamSize, impostor: room.impostor, players: players.length, maxPlayers: room.maxPlayers, status: room.status,
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
      const [room] = await tx.$queryRaw<{ status: string; max_players: number; team_size: number | null }[]>`
        SELECT status::text, max_players, team_size FROM rooms WHERE id = ${found.id}::uuid FOR UPDATE`;
      if (!room || room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
      const busy = await tx.roomPlayer.findFirst({
        where: { userId, leftAt: null, room: { status: "ACTIVE" } },
        select: { roomId: true },
      });
      if (busy) throw new ConflictException({ code: "ROOM_IN_PROGRESS", message: "Termine d'abord ta partie en cours.", id: busy.roomId });
      const left = await this.leaveOtherLobbies(tx, userId, found.id);
      const count = await tx.roomPlayer.count({ where: { roomId: found.id, leftAt: null } });
      if (count >= room.max_players) throw new ConflictException({ code: "ROOM_FULL", message: "Ce salon est complet." });
      // Duel par équipes : placé dans l'équipe la moins remplie (il peut en changer ensuite)
      let team: number | null = null;
      if (room.team_size) {
        const blue = await tx.roomPlayer.count({ where: { roomId: found.id, leftAt: null, team: 1 } });
        team = blue <= count - blue ? 1 : 2;
      }
      await tx.roomPlayer.create({ data: { roomId: found.id, userId, team } });
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

  /** Duel par équipes : changer d'équipe (soi-même), ou placer un joueur (hôte), tant que la partie n'a pas commencé. */
  async setTeam(userId: string, roomId: string, team: 1 | 2, targetId = userId) {
    const room = await this.memberRoom(userId, roomId);
    if (!room.teamSize) throw new BadRequestException({ code: "NO_TEAMS", message: "Ce salon ne se joue pas par équipes." });
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    if (targetId !== userId && room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut placer les autres joueurs." });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      const seat = await tx.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
      if (!seat || seat.leftAt) throw new NotFoundException("Ce joueur n'est pas dans le salon.");
      if (seat.team === team) return;
      const size = await tx.roomPlayer.count({ where: { roomId, leftAt: null, team } });
      if (size >= room.teamSize!) throw new ConflictException({ code: "TEAM_FULL", message: `${TEAM_NAMES[team]} est complète.` });
      await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId: targetId } }, data: { team } });
    });
    await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
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
    // Duel par équipes : une équipe sans plus aucun joueur perd aussitôt par abandon
    if (!finish && room.status === "ACTIVE" && room.teamSize) {
      const remaining = await this.prisma.roomPlayer.findMany({ where: { roomId, leftAt: null }, select: { team: true } });
      if (new Set(remaining.map((p) => p.team)).size < 2) {
        const current = await this.loadRoom(roomId);
        if (current) {
          await this.settle(current, current.currentRound);
          await this.decideTeams(current, current.currentRound);
        }
        await this.notifyRoom(roomId);
        return;
      }
    }
    if (finish) {
      const current = await this.loadRoom(roomId);
      if (current) await this.settle(current, current.currentRound);
      await this.finish(roomId);
    }
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
    if (room.impostor && players.length < IMPOSTOR_MIN_PLAYERS) {
      throw new BadRequestException({ code: "NOT_ENOUGH_PLAYERS", message: `Il faut au moins ${IMPOSTOR_MIN_PLAYERS} joueurs pour le mode Intrus.` });
    }
    if (room.teamSize) {
      const sizes = [1, 2].map((t) => room.players.filter((p) => !p.leftAt && p.team === t).length);
      if (sizes.some((n) => n !== room.teamSize)) {
        throw new BadRequestException({ code: "TEAMS_INCOMPLETE", message: `Il faut ${room.teamSize} joueurs dans chaque équipe pour lancer la partie.` });
      }
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
      if (room.impostor) await this.assignImpostor(tx, roomId, 0, players);
      return true;
    });
    if (!started) throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
  }

  // ---------- Manches ----------

  private loadRoom(roomId: string) {
    return this.prisma.room.findUnique({
      where: { id: roomId },
      include: { roundList: { orderBy: { position: "asc" }, include: { clip: { select: { durationSec: true } } } } },
    });
  }

  /** Clip de la manche en cours (sans le rang), pendant le chrono, pour un joueur qui répond à cette manche et n'a pas encore répondu. */
  async next(userId: string, roomId: string): Promise<RoomClip> {
    const room = await this.loadRoom(roomId);
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
    if (current.suddenDeath && !seat.finalist) throw spectator();
    if (room.phase !== "ANSWER") throw new ConflictException({ code: "ROUND_OVER", message: "Les réponses sont terminées pour cette manche." });
    const answered = await this.prisma.guess.count({ where: { userId, roomId, clipId: { in: roundClips(current) } } });
    if (answered) throw new ConflictException({ code: "ALREADY_ANSWERED", message: "Tu as déjà répondu à cette manche." });
    // Mode Intrus : l'intrus reçoit l'autre clip, sans le savoir
    const clip = await this.prisma.clip.findUnique({ where: { id: clipFor(current, userId) }, include: clipInclude });
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

  /** Avant d'enregistrer une réponse : clip de la manche en cours, partie en cours, joueur qui y répond, dans le temps. */
  async assertCanAnswer(userId: string, roomId: string, clipId: string) {
    const room = await this.loadRoom(roomId);
    const seat = room ? await this.prisma.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } } }) : null;
    const current = room?.roundList[(room?.currentRound ?? 0) - 1];
    if (!room || !seat || seat.leftAt || room.status !== "ACTIVE" || !current || clipFor(current, userId) !== clipId || !room.roundEndsAt || room.phase !== "ANSWER") {
      throw new ConflictException({ code: "ROUND_OVER", message: "Cette manche est terminée." });
    }
    if (current.suddenDeath && !seat.finalist) throw spectator();
    if (Date.now() > room.roundEndsAt.getTime() + ANSWER_GRACE) {
      throw new ConflictException({ code: "ROUND_OVER", message: "Temps écoulé : ta réponse n'a pas été prise en compte." });
    }
    // Mode Confiance : mise sur les manches prévues (pas sur les manches décisives)
    return { round: room.currentRound, staked: room.confidence && !current.suddenDeath };
  }

  /** Après une réponse : total du joueur recalculé ; la manche se termine dès que tous les joueurs concernés ont répondu. */
  async afterAnswer(userId: string, roomId: string) {
    const room = await this.loadRoom(roomId);
    if (room) {
      const totals = await this.regularTotals(roomId, room.roundList);
      await this.prisma.roomPlayer.update({ where: { roomId_userId: { roomId, userId } }, data: { score: totals.get(userId) ?? 0 } });
    }
    await this.checkRoundComplete(roomId);
    return { position: room?.currentRound ?? 0, rounds: room?.rounds ?? 0 };
  }

  private async checkRoundComplete(roomId: string) {
    const room = await this.loadRoom(roomId);
    if (!room || room.status !== "ACTIVE") return;
    const current = room.roundList[room.currentRound - 1];
    const [players, answered] = await Promise.all([
      this.prisma.roomPlayer.findMany({ where: { roomId, leftAt: null }, select: { userId: true, finalist: true } }),
      current ? this.prisma.guess.findMany({ where: { roomId, clipId: { in: roundClips(current) } }, select: { userId: true } }) : [],
    ]);
    const respondents = players.filter((p) => !current?.suddenDeath || p.finalist);
    const done = new Set(answered.map((a) => a.userId));
    // Manche décisive avec un seul finaliste encore là : inutile d'attendre, il l'emporte
    if (current?.suddenDeath && respondents.length <= 1) await this.advance(roomId, room.currentRound, "ANSWER");
    else if (respondents.length && respondents.every((p) => done.has(p.userId))) await this.advance(roomId, room.currentRound, "ANSWER");
    else await this.notifyRoom(roomId);
  }

  /**
   * Fin de la manche `round` : manche suivante après la pause d'affichage, mort subite ou fin de la partie.
   * Conditionnée à la manche courante : une seule instance de l'API l'applique.
   */
  private async advance(roomId: string, round: number, phase: string) {
    const room = await this.loadRoom(roomId);
    if (!room || room.status !== "ACTIVE" || room.currentRound !== round || room.phase !== phase) return;
    const current = room.roundList[round - 1];
    // Mode Intrus : après les réponses, le vote ; après le vote, les points du vote puis la suite
    if (room.impostor && current?.impostorId && !current.suddenDeath) {
      if (phase === "ANSWER") return this.startVote(roomId, round);
      await this.resolveVote(roomId, round, current.impostorId);
    }
    await this.settle(room, round);
    if (round < room.rounds) {
      const next = room.roundList[round];
      const startsAt = later(ROOM_REVEAL_SEC * SEC);
      if (room.impostor) {
        const active = await this.prisma.roomPlayer.findMany({ where: { roomId, leftAt: null }, select: { userId: true } });
        await this.prisma.$transaction((tx) => this.assignImpostor(tx, roomId, round, active.map((p) => p.userId)));
      }
      const { count } = await this.prisma.room.updateMany({
        where: { id: roomId, status: "ACTIVE", currentRound: round, phase },
        data: {
          currentRound: round + 1, roundStartsAt: startsAt, phase: "ANSWER",
          roundEndsAt: new Date(startsAt.getTime() + roomRoundSec(next?.clip.durationSec ?? 0, room.roundSec) * SEC),
        },
      });
      if (count) await this.notifyRoom(roomId);
      return;
    }
    await this.decide(room, round);
  }

  // ---------- Mode Intrus ----------

  /**
   * Intrus de la manche `index` (0 = première) : un joueur encore là, le moins souvent intrus jusqu'ici, reçoit un autre clip
   * du même jeu, d'un rang différent d'au moins 2 crans et d'une difficulté proche, jamais joué dans le salon ni proposé par un joueur.
   */
  private async assignImpostor(tx: Prisma.TransactionClient, roomId: string, index: number, players: string[]) {
    if (players.length < 2) return;
    const rounds = await tx.roomRound.findMany({ where: { roomId }, select: { position: true, clipId: true, altClipId: true, impostorId: true } });
    const target = rounds.find((r) => r.position === index);
    if (!target || target.impostorId) return;
    const room = await tx.room.findUniqueOrThrow({ where: { id: roomId }, select: { gameId: true, players: { select: { userId: true } } } });
    const used = rounds.flatMap((r) => (r.altClipId ? [r.clipId, r.altClipId] : [r.clipId]));
    const uploaders = room.players.map((p) => p.userId);
    const [main] = await tx.$queryRaw<{ difficulty: number; rank_order: number }[]>`
      SELECT c.difficulty, r."order" AS rank_order FROM clips c JOIN ranks r ON r.id = c.rank_id WHERE c.id = ${target.clipId}::uuid`;
    if (!main) return;
    const candidates = await tx.$queryRaw<{ id: string; close: boolean }[]>`
      SELECT c.id, abs(c.difficulty - ${main.difficulty}) <= 1 AS close FROM clips c JOIN ranks r ON r.id = c.rank_id
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${room.gameId}::uuid
        AND abs(r."order" - ${main.rank_order}) >= 2 AND c.id <> ALL(${used}::uuid[]) AND c.uploader_id <> ALL(${uploaders}::uuid[])
      ORDER BY random() LIMIT 20`;
    const alt = candidates.find((c) => c.close) ?? candidates[0];
    if (!alt) return;
    const impostorId = pickImpostor(players, rounds.map((r) => r.impostorId).filter((x): x is string => !!x));
    await tx.roomRound.update({ where: { roomId_position: { roomId, position: index } }, data: { impostorId, altClipId: alt.id } });
  }

  /** Fin des réponses : place au vote, pendant 25 secondes (ou jusqu'à ce que tout le monde ait voté). */
  private async startVote(roomId: string, round: number) {
    const { count } = await this.prisma.room.updateMany({
      where: { id: roomId, status: "ACTIVE", currentRound: round, phase: "ANSWER" },
      data: { phase: "VOTE", roundEndsAt: later(IMPOSTOR_VOTE_SEC * SEC) },
    });
    if (count) await this.notifyRoom(roomId);
  }

  /** Vote d'un joueur encore en jeu pour un autre joueur encore en jeu ; un seul vote par manche. */
  async vote(userId: string, roomId: string, targetId: string) {
    const room = await this.loadRoom(roomId);
    const seat = room ? await this.prisma.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } } }) : null;
    if (!room || !seat) throw notFound();
    const current = room.roundList[room.currentRound - 1];
    if (room.status !== "ACTIVE" || !room.impostor || room.phase !== "VOTE" || !current || !room.roundEndsAt || Date.now() > room.roundEndsAt.getTime() + ANSWER_GRACE) {
      throw new ConflictException({ code: "VOTE_CLOSED", message: "Le vote n'est pas ouvert." });
    }
    if (seat.leftAt) throw new ConflictException({ code: "ROOM_LEFT", message: "Tu as quitté cette partie." });
    if (targetId === userId) throw new BadRequestException({ code: "SELF_VOTE", message: "Tu ne peux pas voter pour toi." });
    const target = await this.prisma.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
    if (!target || target.leftAt) throw new BadRequestException({ code: "INVALID_TARGET", message: "Ce joueur n'est pas dans la partie." });
    try {
      await this.prisma.roomVote.create({ data: { roomId, round: room.currentRound, voterId: userId, targetId } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException({ code: "ALREADY_VOTED", message: "Tu as déjà voté pour cette manche." });
      throw e;
    }
    const [active, votes] = await Promise.all([
      this.prisma.roomPlayer.count({ where: { roomId, leftAt: null } }),
      this.prisma.roomVote.count({ where: { roomId, round: room.currentRound } }),
    ]);
    if (votes >= active) await this.advance(roomId, room.currentRound, "VOTE");
    else await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
  }

  /** Points du vote (une seule fois : clé joueur + manche), puis totaux des joueurs recalculés. */
  private async resolveVote(roomId: string, round: number, impostorId: string) {
    const votes = await this.prisma.roomVote.findMany({ where: { roomId, round }, select: { voterId: true, targetId: true } });
    const { bonuses } = impostorBonuses(impostorId, votes);
    await this.prisma.roomBonus.createMany({ data: bonuses.map((b) => ({ roomId, round, userId: b.userId, points: b.points, reason: b.reason })), skipDuplicates: true });
    const room = await this.loadRoom(roomId);
    if (!room) return;
    const totals = await this.regularTotals(roomId, room.roundList);
    for (const [userId, score] of totals) await this.prisma.roomPlayer.updateMany({ where: { roomId, userId }, data: { score } });
  }

  /** Total de chaque joueur : points des réponses aux manches prévues (hors mort subite) + points du vote (mode Intrus). */
  private async regularTotals(
    roomId: string, rounds: { clipId: string; suddenDeath: boolean; altClipId?: string | null }[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, number>> {
    const [guesses, bonuses] = await Promise.all([
      db.guess.groupBy({ by: ["userId"], where: { roomId, clipId: { in: regularClips(rounds) } }, _sum: { score: true } }),
      db.roomBonus.groupBy({ by: ["userId"], where: { roomId }, _sum: { points: true } }),
    ]);
    const out = new Map<string, number>();
    for (const g of guesses) out.set(g.userId, (out.get(g.userId) ?? 0) + (g._sum.score ?? 0));
    for (const b of bonuses) out.set(b.userId, (out.get(b.userId) ?? 0) + (b._sum.points ?? 0));
    return out;
  }

  /** Mode Confiance : mises de la manche réglées (une seule fois, même si la fin de manche est traitée deux fois) */
  private async settle(room: { id: string; confidence: boolean; roundList: { clipId: string; suddenDeath: boolean }[] }, round: number) {
    const current = room.roundList[round - 1];
    if (room.confidence && current && !current.suddenDeath) await this.tokens.settleRound(room.id, round, current.clipId);
  }

  /** Après la dernière manche prévue ou une manche décisive : vainqueur, nouvelle manche décisive ou victoire partagée. */
  private async decide(room: NonNullable<Awaited<ReturnType<RoomsService["loadRoom"]>>>, round: number) {
    if (room.teamSize) return this.decideTeams(room, round);
    const players = await this.prisma.roomPlayer.findMany({ where: { roomId: room.id }, select: { userId: true, leftAt: true, finalist: true } });
    const current = room.roundList[round - 1];
    if (current?.suddenDeath) {
      const finalists = players.filter((p) => p.finalist).map((p) => p.userId);
      const stillIn = players.filter((p) => p.finalist && !p.leftAt).map((p) => p.userId);
      if (stillIn.length <= 1) {
        return this.finish(room.id, round, stillIn.length ? { winnerId: stillIn[0], finalists, decidedBy: "SUDDEN_DEATH" } : {});
      }
      const answers = await this.prisma.guess.findMany({ where: { roomId: room.id, clipId: current.clipId }, select: { userId: true, score: true, responseMs: true } });
      const outcome = suddenDeathOutcome(
        stillIn.map((id) => {
          const a = answers.find((x) => x.userId === id);
          return { id, score: a?.score ?? null, responseMs: a ? (a.responseMs ?? Number.MAX_SAFE_INTEGER) : null };
        }),
        room.suddenDeathRounds,
      );
      if (outcome.kind === "winner") return this.finish(room.id, round, { winnerId: outcome.winnerId, finalists, decidedBy: outcome.decidedBy });
      if (outcome.kind === "shared") return this.finish(room.id, round, { sharedWinners: outcome.finalists, finalists, decidedBy: "SHARED" });
      return this.launchSuddenDeath(room, round, outcome.finalists, players.map((p) => p.userId));
    }
    const totals = await this.regularTotals(room.id, room.roundList);
    const stayed = players.filter((p) => !p.leftAt).map((p) => ({ id: p.userId, score: totals.get(p.userId) ?? 0 }));
    const tied = tiedLeaders(stayed);
    if (tied.length && room.suddenDeath) return this.launchSuddenDeath(room, round, tied, players.map((p) => p.userId));
    return this.finish(room.id, round, { decidedBy: stayed.length ? (tied.length ? "SHARED" : "POINTS") : undefined, sharedWinners: tied.length ? tied : undefined });
  }

  /**
   * Duel par équipes : total de chaque équipe (points de tous ses joueurs, partis compris). Une équipe dont tous les joueurs
   * sont partis perd par abandon. Égalité : mort subite entre les deux équipes si l'option est active, sinon match nul.
   */
  private async decideTeams(room: NonNullable<Awaited<ReturnType<RoomsService["loadRoom"]>>>, round: number) {
    const players = await this.prisma.roomPlayer.findMany({ where: { roomId: room.id }, select: { userId: true, leftAt: true, finalist: true, team: true } });
    const everyone = players.map((p) => p.userId);
    const present = (team: string) => players.filter((p) => String(p.team) === team && !p.leftAt);
    const current = room.roundList[round - 1];
    const forfeit = ["1", "2"].filter((t) => present(t).length === 0);
    if (forfeit.length === 1) return this.finish(room.id, round, { teamWinner: forfeit[0] === "1" ? "2" : "1", decidedBy: "FORFEIT" });
    if (forfeit.length === 2) return this.finish(room.id, round, {});
    if (current?.suddenDeath) {
      const teams = ["1", "2"].filter((t) => present(t).some((p) => p.finalist));
      if (teams.length === 1) return this.finish(room.id, round, { teamWinner: teams[0], decidedBy: "SUDDEN_DEATH" });
      const answers = await this.prisma.guess.findMany({ where: { roomId: room.id, clipId: current.clipId }, select: { userId: true, score: true, responseMs: true } });
      const outcome = suddenDeathOutcome(
        teams.map((t) => teamSuddenDeathEntry(t, present(t).flatMap((p) => {
          const a = answers.find((x) => x.userId === p.userId);
          return a ? [{ score: a.score, responseMs: a.responseMs ?? Number.MAX_SAFE_INTEGER }] : [];
        }))),
        room.suddenDeathRounds,
      );
      if (outcome.kind === "winner") return this.finish(room.id, round, { teamWinner: outcome.winnerId, decidedBy: outcome.decidedBy });
      if (outcome.kind === "shared") return this.finish(room.id, round, { teamShared: true, decidedBy: "SHARED" });
      return this.launchSuddenDeath(room, round, outcome.finalists.flatMap((t) => present(t).map((p) => p.userId)), everyone);
    }
    const totals = await this.teamScores(room.id, room.roundList, players);
    const tied = tiedLeaders(totals);
    if (tied.length && room.suddenDeath) return this.launchSuddenDeath(room, round, players.filter((p) => !p.leftAt).map((p) => p.userId), everyone);
    return this.finish(room.id, round, tied.length ? { teamShared: true, decidedBy: "SHARED" } : { decidedBy: "POINTS" });
  }

  private async teamScores(
    roomId: string, rounds: { clipId: string; suddenDeath: boolean; altClipId?: string | null }[], players: { userId: string; team: number | null }[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const totals = await this.regularTotals(roomId, rounds, db);
    return teamTotals(players.map((p) => ({ team: p.team, score: totals.get(p.userId) ?? 0 })));
  }

  /** Nouvelle manche décisive entre `finalists`, sur un clip jamais joué dans ce salon ; sans clip disponible, victoire partagée. */
  private async launchSuddenDeath(
    room: NonNullable<Awaited<ReturnType<RoomsService["loadRoom"]>>>, round: number, finalists: string[], everyone: string[],
  ) {
    const used = room.roundList.flatMap((r) => roundClips(r));
    const [clip] = await this.prisma.$queryRaw<{ id: string; duration_sec: number }[]>`
      SELECT c.id, c.duration_sec FROM clips c
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${room.gameId}::uuid
        AND c.uploader_id <> ALL(${everyone}::uuid[]) AND c.id <> ALL(${used}::uuid[])
      ORDER BY random() LIMIT 1`;
    if (!clip) return this.finish(room.id, round, { sharedWinners: finalists, finalists, decidedBy: "SHARED" });
    const startsAt = later(ROOM_REVEAL_SEC * SEC);
    const launched = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.room.updateMany({
        where: { id: room.id, status: "ACTIVE", currentRound: round, suddenDeathRounds: { lt: SUDDEN_DEATH_MAX_ROUNDS } },
        data: {
          currentRound: round + 1, suddenDeathRounds: { increment: 1 }, roundStartsAt: startsAt, phase: "ANSWER",
          roundEndsAt: new Date(startsAt.getTime() + roomRoundSec(clip.duration_sec, room.roundSec) * SEC),
        },
      });
      if (!count) return false;
      await tx.roomRound.create({ data: { roomId: room.id, position: round, clipId: clip.id, suddenDeath: true } });
      await tx.roomPlayer.updateMany({ where: { roomId: room.id }, data: { finalist: false } });
      await tx.roomPlayer.updateMany({ where: { roomId: room.id, userId: { in: finalists } }, data: { finalist: true } });
      return true;
    });
    if (launched) await this.notifyRoom(room.id);
  }

  /** Fin de partie : totaux recalculés depuis les réponses (hors manches décisives) et places finales. */
  private async finish(
    roomId: string, round?: number,
    decision: {
      winnerId?: string; sharedWinners?: string[]; finalists?: string[]; decidedBy?: DecidedBy;
      /** Duel par équipes : équipe gagnante ("1" ou "2"), ou match nul */
      teamWinner?: string; teamShared?: boolean;
    } = {},
  ) {
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.room.updateMany({
        where: { id: roomId, status: "ACTIVE", ...(round ? { currentRound: round } : {}) },
        data: { status: "FINISHED", finishedAt: new Date(), roundStartsAt: null, roundEndsAt: null, phase: "ANSWER", decidedBy: decision.decidedBy ?? null },
      });
      if (!count) return false;
      const rounds = await tx.roomRound.findMany({ where: { roomId }, select: { clipId: true, suddenDeath: true, altClipId: true } });
      const [players, totals, room] = await Promise.all([
        tx.roomPlayer.findMany({ where: { roomId }, select: { userId: true, leftAt: true, team: true } }),
        this.regularTotals(roomId, rounds, tx),
        tx.room.findUniqueOrThrow({ where: { id: roomId }, select: { teamSize: true } }),
      ]);
      const scored = players.map((p) => ({ id: p.userId, left: !!p.leftAt, score: totals.get(p.userId) ?? 0 }));
      let places: Map<string, number>;
      if (room.teamSize) {
        // Duel par équipes : chaque joueur prend la place de son équipe
        const teamPlaces = teamPlacements(await this.teamScores(roomId, rounds, players, tx), {
          winnerId: decision.teamWinner, sharedWinners: decision.teamShared ? ["1", "2"] : undefined,
        });
        places = new Map(players.map((p) => [p.userId, teamPlaces.get(String(p.team)) ?? 2]));
      } else {
        places = finalPlacements(scored, decision);
      }
      for (const p of scored) {
        await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId: p.id } }, data: { score: p.score, placement: places.get(p.id)! } });
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
      select: { id: true, currentRound: true, phase: true },
      take: 200,
    });
    for (const r of overdue) {
      try {
        await this.advance(r.id, r.currentRound, r.phase);
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
    const current = room.status === "ACTIVE" ? rounds[room.currentRound - 1] : undefined;
    const answers = await this.prisma.guess.findMany({
      where: { roomId },
      select: { userId: true, clipId: true, score: true, guessedRank: { select: rankSelect } },
    });
    const [stakes, me_] = await Promise.all([
      room.confidence ? this.prisma.roomStake.findMany({ where: { roomId }, select: { round: true, userId: true, stake: true, payout: true } }) : [],
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenBalance: true } }),
    ]);
    const stakeOf = (round: number, uid: string) => stakes.find((x) => x.round === round && x.userId === uid);
    // Mode Intrus : rang du clip de l'intrus, votes et points du vote (dévoilés seulement avec la manche)
    const [altRanks, votes, bonuses] = room.impostor
      ? await Promise.all([
          this.prisma.clip.findMany({ where: { id: { in: rounds.flatMap((r) => (r.altClipId ? [r.altClipId] : [])) } }, select: { id: true, rank: { select: rankSelect } } }),
          this.prisma.roomVote.findMany({ where: { roomId }, select: { round: true, voterId: true, targetId: true } }),
          this.prisma.roomBonus.findMany({ where: { roomId }, select: { round: true, userId: true, points: true } }),
        ])
      : [[], [], []];
    // Manches dévoilées : celles déjà terminées (toutes une fois la partie finie). Jamais le rang de la manche en cours.
    const resolved = room.status === "ACTIVE" ? room.currentRound - 1 : room.status === "FINISHED" ? rounds.length : 0;
    const details: RoomRoundDto[] = rounds.slice(0, resolved).map((r) => ({
      position: r.position + 1,
      suddenDeath: r.suddenDeath,
      correctRank: r.clip.rank,
      impostor: r.impostorId && r.altClipId
        ? {
            userId: r.impostorId,
            rank: altRanks.find((c) => c.id === r.altClipId)!.rank,
            caught: bonuses.some((b) => b.round === r.position + 1 && b.userId !== r.impostorId),
            votes: votes.filter((v) => v.round === r.position + 1).map((v) => ({ voterId: v.voterId, targetId: v.targetId })),
            bonuses: bonuses.filter((b) => b.round === r.position + 1).map((b) => ({ userId: b.userId, points: b.points })),
          }
        : null,
      answers: answers.filter((a) => a.clipId === r.clipId || a.clipId === r.altClipId).map((a) => {
        const st = stakeOf(r.position + 1, a.userId);
        return { userId: a.userId, rank: a.guessedRank, score: a.score, stake: st?.stake ?? null, payout: st?.payout ?? null };
      }),
    }));
    const currentAnswers = current ? answers.filter((a) => a.clipId === current.clipId || a.clipId === current.altClipId) : [];
    const answeredNow = new Set(currentAnswers.map((a) => a.userId));
    const currentVotes = current ? votes.filter((v) => v.round === current.position + 1) : [];
    // Scores affichés pendant une manche : sans les points de la manche en cours (sinon, une fois les rangs proposés
    // dévoilés au vote du mode Intrus, on pourrait en déduire le rang réel et l'intrus)
    const pending = new Map(current && !current.suddenDeath ? currentAnswers.map((a) => [a.userId, a.score] as const) : []);
    const shownScore = (p: { userId: string; score: number }) => p.score - (pending.get(p.userId) ?? 0);
    const me = room.players.find((p) => p.userId === userId)!;
    const active = room.players.filter((p) => !p.leftAt);
    const players = [...room.players].sort((a, b) =>
      room.status === "FINISHED" ? (a.placement ?? 99) - (b.placement ?? 99) : room.status === "ACTIVE" ? shownScore(b) - shownScore(a) : 0,
    );
    return {
      id: room.id,
      code: room.code,
      status: room.status,
      game: room.game,
      rounds: room.rounds,
      roundSec: room.roundSec,
      maxPlayers: room.maxPlayers,
      suddenDeath: room.suddenDeath,
      confidence: room.confidence,
      teamSize: room.teamSize,
      impostor: room.impostor,
      teams: room.teamSize
        ? [1, 2].map((t) => {
            const members = room.players.filter((p) => p.team === t);
            return {
              team: t, name: TEAM_NAMES[t]!, players: members.filter((p) => !p.leftAt).length,
              score: members.reduce((sum, p) => sum + shownScore(p), 0),
              placement: room.status === "FINISHED" ? (members[0]?.placement ?? null) : null,
            };
          })
        : [],
      myTokens: me_.tokenBalance,
      myStake: room.status === "ACTIVE" ? (stakeOf(room.currentRound, userId)?.stake ?? null) : null,
      suddenDeathRounds: room.suddenDeathRounds,
      decidedBy: room.status === "FINISHED" ? (room.decidedBy as DecidedBy | null) : null,
      isHost: room.hostId === userId,
      left: !!me.leftAt,
      canStart: room.status === "LOBBY" && room.hostId === userId && active.length >= (room.impostor ? IMPOSTOR_MIN_PLAYERS : ROOM_MIN_PLAYERS)
        && (!room.teamSize || [1, 2].every((t) => active.filter((p) => p.team === t).length === room.teamSize)),
      players: players.map((p) => ({
        id: p.userId,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        vip: isVip(p.user.subscription),
        flair: toFlair(p.user),
        score: shownScore(p),
        isHost: p.userId === room.hostId,
        left: !!p.leftAt,
        answered: answeredNow.has(p.userId),
        placement: p.placement,
        finalist: p.finalist,
        team: p.team,
        // Bénéfice net sur les manches déjà réglées : les mises de la manche en cours restent cachées
        tokensNet: room.confidence
          ? stakes.filter((x) => x.userId === p.userId && x.payout !== null).reduce((sum, x) => sum + x.payout! - x.stake, 0)
          : null,
      })),
      live: room.status === "ACTIVE" && room.roundStartsAt && room.roundEndsAt
        ? {
            round: room.currentRound,
            suddenDeath: !!current?.suddenDeath,
            playing: !me.leftAt && (!current?.suddenDeath || me.finalist),
            startsAt: room.roundStartsAt.toISOString(),
            endsAt: room.roundEndsAt.toISOString(),
            serverNow: new Date().toISOString(),
            answered: answeredNow.has(userId),
            phase: room.phase === "VOTE" ? "VOTE" : "ANSWER",
            // Vote : rangs proposés par chacun (sans le rang réel, sans les points, sans désigner l'intrus)
            guesses: room.phase === "VOTE" ? currentAnswers.map((a) => ({ userId: a.userId, rank: a.guessedRank })) : [],
            myVote: currentVotes.find((v) => v.voterId === userId)?.targetId ?? null,
            voted: currentVotes.map((v) => v.voterId),
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
