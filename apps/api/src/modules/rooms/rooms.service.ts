import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_COUNTDOWN_SEC, ROOM_CREATE_VIP_HINT, ROOM_EVENT, ROOM_INVITE_EVENT, ROOM_LOBBY_TTL_MIN, ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS, ROOM_MODES, ROOM_REVEAL_SEC, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_SYSTEM_SLOTS, SUDDEN_DEATH_MAX_ROUNDS, TEAM_NAMES,
  finalPlacements, formatRoomCode, modeSettings, nextSystemGame, pickFinalists, roomClipsNeeded, roomMode, roomRoundSec, roomSystemSlot, suddenDeathOutcome,
  teamPlacements, teamSuddenDeathEntry, teamTotals, tiedLeaders, IMPOSTOR_MIN_PLAYERS, IMPOSTOR_VOTE_SEC, impostorBonuses, pickImpostor,
  type DecidedBy, type PublicRoomDto, type QuickPlayResultDto, type RoomHistoryDto, type RoomMode,
  type PlayableClipDto, type RoomDto, type RoomInviteDto, type RoomPreviewDto, type RoomRoundDto,
  type RoomSummaryDto, type RoomsOverviewDto,
} from "@ranksight/shared";
import type { z } from "zod";
import type { CreateRoomInput, PublicRoomsQuery, QuickPlayInput } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { ChatGateway } from "../chat/chat.gateway.js";
import { ClipsService, clipInclude, noClipAvailable } from "../clips/clips.service.js";
import { PlayTokenService } from "../clips/play-token.service.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";
import { PushService } from "../notifications/notifications.module.js";
import { canHostVipGames, isVip, vipSelect } from "../shop/vip.js";

type RoomSettings = { visibility: "PUBLIC" | "PRIVATE"; rounds: number; roundSec: number; suddenDeath: boolean; teamSize: number; impostor: boolean };

const SEC = 1000;
/** Marge accordée à une réponse envoyée juste avant la fin du chrono (latence réseau) */
const ANSWER_GRACE = 2 * SEC;
/** Codes faux tolérés par joueur et par heure avant blocage temporaire (protège les salons contre la recherche de codes) */
const MAX_CODE_FAILURES = 15;
const LIVE = ["LOBBY", "ACTIVE"] as const;
/** Hôte déconnecté depuis plus de 30 s en salle d'attente : le rôle passe à un joueur connecté */
const HOST_AWAY_MS = 30 * SEC;
/** Joueur déconnecté depuis plus de 2 min en salle d'attente : retiré du salon (sa place se libère) */
const PLAYER_AWAY_MS = 120 * SEC;
/** Salons par défaut et présence : vérifiés toutes les 5 s (dans la boucle d'une seconde) */
const SWEEP_MS = 5 * SEC;
/** Une salle d'attente par défaut n'expire pas (elle attend ses joueurs) ; date lointaine, jamais atteinte en pratique */
const SYSTEM_LOBBY_TTL_MS = 365 * 24 * 3600 * SEC;

const playerSelect = { id: true, displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } as const;
const roomInclude = {
  game: { select: { slug: true, name: true } },
  host: { select: { displayName: true } },
  players: { include: { user: { select: playerSelect } }, orderBy: { joinedAt: "asc" as const } },
  tournamentMatch: { select: { tournamentId: true } },
} as const;
const rankSelect = { id: true, name: true, color: true, order: true, iconUrl: true } as const;

type RoomRow = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;
type CreateInput = z.output<typeof CreateRoomInput>;
type QuickPlay = z.output<typeof QuickPlayInput>;
type PublicQuery = z.output<typeof PublicRoomsQuery>;
export type RoomClip = PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string };

const later = (ms: number) => new Date(Date.now() + ms);
const vipRequired = () => new HttpException({ code: "PREMIUM_REQUIRED", message: ROOM_CREATE_VIP_HINT }, HttpStatus.PAYMENT_REQUIRED);
const notFound = () => new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Salon introuvable." });
const systemRoomForbidden = (message: string) => new ForbiddenException({ code: "SYSTEM_ROOM", message });
const roomFull = () => new ConflictException({ code: "ROOM_FULL", message: "Ce salon est complet." });
const roomStarted = (status: string) =>
  new ConflictException({ code: "ROOM_STARTED", message: status === "ACTIVE" ? "La partie a déjà commencé." : "Ce salon est fermé." });
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
 * Salons personnalisés : jusqu'à 8 joueurs voient le même clip au même moment.
 * Créer un salon (public ou privé, tous modes) est réservé aux joueurs VIP, vérifié en base à la création. Rejoindre, jouer,
 * devenir hôte et consulter les résultats est gratuit ; aucun autre contrôle VIP ensuite (lancement, transfert d'hôte,
 * mort subite), et une partie lancée va toujours à son terme.
 * Public : listé, rejoignable sans invitation tant qu'il reste de la place. Privé : code ou invitation seulement.
 * Salons par défaut : le serveur garde 2 salles d'attente publiques par mode (jeu tournant), sans créateur ; le premier
 * joueur qui entre devient hôte. Exception système à la règle de création, jamais une création par un joueur.
 * Hôte : s'il part ou reste déconnecté, le rôle passe au joueur présent arrivé le plus tôt (connecté de préférence).
 * Fin de partie : le salon est retiré (plus listé ni rejoignable, invitations effacées) ; ses résultats restent dans
 * l'historique. Une salle d'attente vidée sans avoir été lancée est supprimée de la base (aucun résultat à garder).
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

  /** Accès aux fonctions VIP (abonnement relu en base, comme pour les autres droits VIP) */
  private vip(userId: string) {
    return canHostVipGames(this.prisma, userId);
  }

  /** Créer un salon, public ou privé, quel que soit le mode : réservé aux VIP (vérifié en base, jamais d'après la requête). */
  private async assertCanCreate(userId: string) {
    if (!(await this.vip(userId))) throw vipRequired();
  }

  private async activeGame(slug: string) {
    const game = await this.prisma.game.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    return game;
  }

  async create(userId: string, input: CreateInput): Promise<RoomDto> {
    await this.assertCanCreate(userId);
    const game = await this.activeGame(input.game);
    // Assez de clips pour toutes les manches, et pour l'intrus en mode Intrus (vérifié de nouveau au lancement, avec tous les joueurs)
    await this.pickClips(game.id, roomClipsNeeded(input), [userId], true);

    const { id, left } = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const left = await this.leaveOtherLobbies(tx, userId);
      return { id: await this.insertRoom(tx, userId, game.id, input), left };
    });
    for (const roomId of left) await this.notifyRoom(roomId);
    return this.detail(userId, id);
  }

  /**
   * Nouveau salon en salle d'attente (code unique tiré au hasard) : avec son créateur comme hôte et premier joueur, ou,
   * pour un salon par défaut (`userId` null), sans créateur ni joueur, rattaché à son emplacement.
   */
  private async insertRoom(
    tx: Prisma.TransactionClient, userId: string | null, gameId: string, input: RoomSettings, systemSlot?: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.newCode();
      if (await tx.room.findUnique({ where: { code }, select: { id: true } })) continue;
      const room = await tx.room.create({
        data: {
          code, createdById: userId, hostId: userId, gameId, visibility: input.visibility, systemSlot: systemSlot ?? null,
          rounds: input.rounds, roundSec: input.roundSec, suddenDeath: input.suddenDeath,
          teamSize: input.teamSize || null, impostor: input.impostor,
          maxPlayers: input.teamSize ? input.teamSize * 2 : ROOM_MAX_PLAYERS,
          expiresAt: later(systemSlot ? SYSTEM_LOBBY_TTL_MS : ROOM_LOBBY_TTL_MIN * 60 * SEC),
          ...(userId ? { players: { create: { userId, team: input.teamSize ? 1 : null } } } : {}),
        },
      });
      return room.id;
    }
    throw new ConflictException({ code: "ROOM_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
  }

  /** Aperçu d'un salon par son code, avant de le rejoindre. */
  async preview(userId: string, code: string): Promise<RoomPreviewDto> {
    const room = await this.byCode(userId, code);
    const players = room.players.filter((p) => !p.leftAt);
    return {
      id: room.id, code: room.code, host: room.host?.displayName ?? null, game: room.game, rounds: room.rounds, roundSec: room.roundSec,
      suddenDeath: room.suddenDeath, teamSize: room.teamSize, impostor: room.impostor, visibility: room.visibility, mode: roomMode(room),
      system: !!room.systemSlot,
      players: players.length, maxPlayers: room.maxPlayers, status: room.status,
      member: room.players.some((p) => p.userId === userId),
    };
  }

  /** Rejoindre avec le code (salon public ou privé), ou depuis une invitation. Toujours gratuit. */
  async join(userId: string, code: string): Promise<RoomDto> {
    return this.enter(userId, await this.byCode(userId, code));
  }

  /**
   * Rejoindre un salon public depuis la liste, sans code. Un salon privé n'est jamais accessible ainsi (même réponse
   * qu'un salon inexistant, pour ne rien dévoiler), sauf pour un joueur invité ou déjà membre.
   */
  async joinPublic(userId: string, roomId: string): Promise<RoomDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
    if (!room || room.status === "CLOSED" || room.status === "FINISHED") throw notFound();
    const member = room.players.some((p) => p.userId === userId);
    const invited = !member && room.visibility === "PRIVATE"
      ? await this.prisma.roomInvite.count({ where: { roomId, userId } })
      : 0;
    if (room.visibility !== "PUBLIC" && !member && !invited) throw notFound();
    return this.enter(userId, room);
  }

  /** Contrôles communs avant d'entrer dans un salon, puis inscription atomique (capacité vérifiée sous verrou). */
  private async enter(userId: string, found: RoomRow): Promise<RoomDto> {
    if (found.players.some((p) => p.userId === userId && !p.leftAt)) return this.detail(userId, found.id);
    if (found.status !== "LOBBY") throw roomStarted(found.status);
    await this.assertMayEnter(userId, found.id, found.players.map((p) => p.userId));
    const left = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const left = await this.leaveOtherLobbies(tx, userId, found.id);
      await this.seat(tx, userId, found.id);
      return left;
    });
    for (const roomId of left) await this.notifyRoom(roomId);
    await this.notifyRoom(found.id);
    return this.detail(userId, found.id);
  }

  /** Joueur retiré par l'hôte, ou blocage entre lui et un joueur du salon : entrée refusée. */
  private async assertMayEnter(userId: string, roomId: string, members: string[]) {
    if (await this.redis.sismember(`room:kicked:${roomId}`, userId)) {
      throw new ForbiddenException({ code: "ROOM_KICKED", message: "L'hôte t'a retiré de ce salon." });
    }
    const blocked = await this.prisma.userBlock.count({
      where: { OR: [{ blockerId: userId, blockedId: { in: members } }, { blockerId: { in: members }, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException({ code: "ROOM_UNAVAILABLE", message: "Impossible de rejoindre ce salon." });
  }

  /**
   * Place dans un salon en salle d'attente, sous verrou de la ligne du salon : deux demandes simultanées pour la dernière
   * place ne peuvent pas la prendre toutes les deux (la seconde reçoit ROOM_FULL), et un joueur n'est jamais inscrit deux fois.
   * Salon sans hôte (salon par défaut vide) : le joueur qui entre devient hôte, VIP ou non.
   */
  private async seat(tx: Prisma.TransactionClient, userId: string, roomId: string) {
    const [room] = await tx.$queryRaw<{ status: string; max_players: number; team_size: number | null; host_id: string | null }[]>`
      SELECT status::text, max_players, team_size, host_id::text FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
    if (!room || room.status !== "LOBBY") throw roomStarted(room?.status ?? "CLOSED");
    const existing = await tx.roomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } }, select: { leftAt: true } });
    if (existing && !existing.leftAt) return;
    const count = await tx.roomPlayer.count({ where: { roomId, leftAt: null } });
    if (count >= room.max_players) throw roomFull();
    // Duel par équipes : placé dans l'équipe la moins remplie (il peut en changer ensuite)
    let team: number | null = null;
    if (room.team_size) {
      const blue = await tx.roomPlayer.count({ where: { roomId, leftAt: null, team: 1 } });
      team = blue <= count - blue ? 1 : 2;
    }
    await tx.roomPlayer.create({ data: { roomId, userId, team } });
    await tx.roomInvite.deleteMany({ where: { roomId, userId } });
    if (!room.host_id) await tx.room.update({ where: { id: roomId }, data: { hostId: userId } });
  }

  /**
   * « Jouer maintenant » : rejoint le salon public compatible (même jeu, même mode) le plus rempli parmi ceux qui ont
   * encore de la place, salons par défaut compris ; sans salon compatible, en crée un (réglages par défaut) si `create`
   * et si le joueur est VIP, sinon renvoie null.
   * Les demandes pour un même jeu et un même mode passent l'une après l'autre (verrou PostgreSQL de transaction) :
   * deux joueurs qui cliquent en même temps se retrouvent dans le même salon au lieu d'en créer deux, et la dernière
   * place n'est attribuée qu'une fois. Jamais de salon privé, jamais de jeu ou de mode différent.
   */
  async quickPlay(userId: string, input: QuickPlay): Promise<QuickPlayResultDto> {
    const game = await this.activeGame(input.game);
    const settings = modeSettings(input.mode);
    const defaults = { visibility: "PUBLIC" as const, rounds: ROOM_DEFAULT_ROUNDS, roundSec: ROOM_DEFAULT_TIME, suddenDeath: false, ...settings };
    // Créer un salon est réservé aux VIP, y compris depuis « Jouer maintenant »
    if (input.create) {
      await this.assertCanCreate(userId);
      await this.pickClips(game.id, roomClipsNeeded(defaults), [userId], true);
    }
    const [kickedFrom, blocks] = await Promise.all([
      this.redis.smembers(`room:kicked-from:${userId}`),
      this.prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } }),
    ]);
    const avoid = blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickplay:${game.id}:${input.mode}`}))`;
      await this.lockUser(tx, userId);
      const busy = await tx.roomPlayer.findFirst({ where: { userId, leftAt: null, room: { status: "ACTIVE" } }, select: { roomId: true } });
      if (busy) throw new ConflictException({ code: "ROOM_IN_PROGRESS", message: "Termine d'abord ta partie en cours.", id: busy.roomId });
      const candidates = await tx.$queryRaw<{ id: string; member: boolean }[]>`
        SELECT r.id, EXISTS (SELECT 1 FROM room_players p WHERE p.room_id = r.id AND p.user_id = ${userId}::uuid AND p.left_at IS NULL) AS member
        FROM rooms r
        WHERE r.visibility = 'PUBLIC' AND r.status = 'LOBBY' AND r.game_id = ${game.id}::uuid
          AND r.expires_at > (now() AT TIME ZONE 'UTC')
          AND r.impostor = ${settings.impostor} AND r.team_size IS NOT DISTINCT FROM ${settings.teamSize || null}::int
          AND r.id <> ALL(${kickedFrom}::uuid[])
          AND NOT EXISTS (SELECT 1 FROM room_players p WHERE p.room_id = r.id AND p.user_id = ANY(${avoid}::uuid[]))
          AND (SELECT count(*) FROM room_players p WHERE p.room_id = r.id AND p.left_at IS NULL) < r.max_players
        ORDER BY member DESC, (SELECT count(*) FROM room_players p WHERE p.room_id = r.id AND p.left_at IS NULL) DESC, r.created_at ASC
        LIMIT 20`;
      for (const c of candidates) {
        if (c.member) return { id: c.id, created: false, left: [] as string[] };
        try {
          await tx.$executeRaw`SAVEPOINT seat_attempt`;
          await this.seat(tx, userId, c.id);
          await tx.$executeRaw`RELEASE SAVEPOINT seat_attempt`;
        } catch (e) {
          // Salon rempli ou lancé entre-temps : on essaie le suivant
          if ((e as { response?: { code?: string } }).response?.code === "ROOM_FULL" || (e as { response?: { code?: string } }).response?.code === "ROOM_STARTED") {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT seat_attempt`;
            continue;
          }
          throw e;
        }
        // Inscrit : il quitte son éventuelle autre salle d'attente
        return { id: c.id, created: false, left: await this.leaveOtherLobbies(tx, userId, c.id) };
      }
      if (!input.create) return null;
      const left = await this.leaveOtherLobbies(tx, userId);
      return { id: await this.insertRoom(tx, userId, game.id, defaults), created: true, left };
    });
    if (!result) return { room: null, created: false };
    for (const roomId of result.left) await this.notifyRoom(roomId);
    await this.notifyRoom(result.id);
    return { room: await this.detail(userId, result.id), created: result.created };
  }

  /** Liste des salons publics (salle d'attente, et parties en cours sauf filtre « places disponibles »), filtrable. */
  async publicList(userId: string, query: PublicQuery): Promise<PublicRoomDto[]> {
    const game = query.game ? await this.prisma.game.findFirst({ where: { slug: query.game }, select: { id: true } }) : null;
    if (query.game && !game) return [];
    const settings = query.mode ? modeSettings(query.mode) : null;
    const blocks = await this.prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
    const avoid = blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
    const rows = await this.prisma.room.findMany({
      where: {
        visibility: "PUBLIC",
        status: query.available ? "LOBBY" : { in: ["LOBBY", "ACTIVE"] },
        ...(game ? { gameId: game.id } : {}),
        ...(settings ? { impostor: settings.impostor, teamSize: settings.teamSize || null } : {}),
        ...(avoid.length ? { NOT: { players: { some: { userId: { in: avoid } } } } } : {}),
        OR: [{ status: "ACTIVE" }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        game: { select: { slug: true, name: true } },
        host: { select: { displayName: true } },
        _count: { select: { players: { where: { leftAt: null } } } },
      },
    });
    return rows
      .map((r) => ({
        id: r.id, status: r.status, mode: roomMode(r), game: r.game, host: r.host?.displayName ?? null, rounds: r.rounds, roundSec: r.roundSec,
        suddenDeath: r.suddenDeath, system: !!r.systemSlot, players: r._count.players, maxPlayers: r.maxPlayers,
        joinable: r.status === "LOBBY" && r._count.players < r.maxPlayers, createdAt: r.createdAt.toISOString(),
      }))
      .filter((r) => !query.available || r.joinable)
      .sort((a, b) => Number(b.joinable) - Number(a.joinable))
      .slice(0, 50);
  }

  /**
   * L'hôte ferme sa salle d'attente : tout le monde sort et le salon, jamais lancé, est supprimé. Un salon par défaut ne se
   * ferme pas (il appartient au serveur) : l'hôte peut seulement le quitter.
   */
  async close(userId: string, roomId: string) {
    const room = await this.memberRoom(userId, roomId);
    if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut fermer le salon." });
    if (room.systemSlot) throw new ForbiddenException({ code: "SYSTEM_ROOM", message: "Un salon par défaut ne se ferme pas : tu peux le quitter." });
    if (room.status !== "LOBBY") throw roomStarted(room.status);
    const members = room.players.map((p) => p.userId);
    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      const { count } = await tx.room.deleteMany({ where: { id: roomId, status: "LOBBY", hostId: userId } });
      return count;
    });
    if (!deleted) throw roomStarted("ACTIVE");
    await this.forget(roomId);
    for (const id of members) this.gateway.emitToUser(id, ROOM_EVENT, { id: roomId });
  }

  /** Historique des salons personnalisés terminés (hors matchs de tournoi) et statistiques du joueur, sans lien avec la cote. */
  async history(userId: string, cursor?: string): Promise<RoomHistoryDto> {
    const PAGE = 20;
    const where = { userId, room: { status: "FINISHED" as const, tournamentMatch: { is: null } } };
    const [seats, stats] = await Promise.all([
      this.prisma.roomPlayer.findMany({
        where,
        orderBy: [{ joinedAt: "desc" }, { roomId: "desc" }],
        take: PAGE + 1,
        ...(cursor ? { cursor: { roomId_userId: { roomId: cursor, userId } }, skip: 1 } : {}),
        include: { room: { include: { game: { select: { slug: true, name: true } }, host: { select: { displayName: true } }, _count: { select: { players: { where: { leftAt: null } } } } } } },
      }),
      this.prisma.$queryRaw<{ team_size: number | null; impostor: boolean; played: bigint; wins: bigint; podiums: bigint }[]>`
        SELECT r.team_size, r.impostor, count(*) AS played,
          count(*) FILTER (WHERE p.placement = 1) AS wins, count(*) FILTER (WHERE p.placement <= 3) AS podiums
        FROM room_players p JOIN rooms r ON r.id = p.room_id
        WHERE p.user_id = ${userId}::uuid AND r.status = 'FINISHED'
          AND NOT EXISTS (SELECT 1 FROM tournament_matches tm WHERE tm.room_id = r.id)
        GROUP BY r.team_size, r.impostor`,
    ]);
    const byMode = new Map<RoomMode, { played: number; wins: number }>();
    let podiums = 0;
    for (const s of stats) {
      const mode = roomMode({ teamSize: s.team_size, impostor: s.impostor });
      const cur = byMode.get(mode) ?? { played: 0, wins: 0 };
      byMode.set(mode, { played: cur.played + Number(s.played), wins: cur.wins + Number(s.wins) });
      podiums += Number(s.podiums);
    }
    const modes = [...byMode.entries()].map(([mode, v]) => ({ mode, ...v }));
    const page = seats.slice(0, PAGE);
    return {
      stats: { played: modes.reduce((a, m) => a + m.played, 0), wins: modes.reduce((a, m) => a + m.wins, 0), podiums, byMode: modes },
      items: page.map((s) => this.summary(s)),
      nextCursor: seats.length > PAGE ? page[page.length - 1]!.roomId : null,
    };
  }

  private summary(s: {
    placement: number | null;
    room: {
      id: string; code: string; status: RoomDto["status"]; visibility: "PUBLIC" | "PRIVATE"; teamSize: number | null; impostor: boolean;
      game: { slug: string; name: string }; host: { displayName: string } | null; _count: { players: number }; maxPlayers: number; createdAt: Date; finishedAt: Date | null;
    };
  }): RoomSummaryDto {
    return {
      id: s.room.id, code: s.room.code, status: s.room.status, visibility: s.room.visibility, mode: roomMode(s.room), game: s.room.game,
      host: s.room.host?.displayName ?? null, players: s.room._count.players, maxPlayers: s.room.maxPlayers, placement: s.placement,
      createdAt: s.room.createdAt.toISOString(), finishedAt: s.room.finishedAt?.toISOString() ?? null,
    };
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
      title: room.visibility === "PRIVATE" ? "Salon privé" : "Salon",
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
    if (targetId !== userId) {
      // Salon par défaut : l'hôte est désigné automatiquement, il ne choisit pas l'équipe des autres (chacun choisit la sienne)
      if (room.systemSlot) throw systemRoomForbidden("Dans un salon par défaut, chaque joueur choisit lui-même son équipe.");
      if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut placer les autres joueurs." });
    }
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
    // Salon par défaut : ouvert à tous, son hôte (désigné automatiquement) ne peut retirer personne
    if (room.systemSlot) throw systemRoomForbidden("Personne ne peut être retiré d'un salon par défaut.");
    if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut retirer un joueur." });
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    if (targetId === userId) throw new BadRequestException("Utilise « Quitter » pour partir du salon.");
    const { count } = await this.prisma.roomPlayer.deleteMany({ where: { roomId, userId: targetId } });
    if (!count) throw new NotFoundException("Ce joueur n'est pas dans le salon.");
    await this.redis.multi()
      .sadd(`room:kicked:${roomId}`, targetId).expire(`room:kicked:${roomId}`, 6 * 3600)
      .sadd(`room:kicked-from:${targetId}`, roomId).expire(`room:kicked-from:${targetId}`, 6 * 3600)
      .exec();
    this.gateway.emitToUser(targetId, ROOM_EVENT, { id: roomId });
    await this.notifyRoom(roomId);
    return this.detail(userId, roomId);
  }

  /**
   * Quitter : en salle d'attente, le joueur sort du salon ; pendant la partie, il garde ses points mais ne répond plus.
   * Si l'hôte part, le joueur présent arrivé le plus tôt devient hôte (VIP non requis). Sans plus personne : une salle
   * d'attente est supprimée (salon par défaut : il reste ouvert, sans hôte), une partie se termine.
   */
  async leave(userId: string, roomId: string) {
    const room = await this.memberRoom(userId, roomId);
    const seat = room.players.find((p) => p.userId === userId);
    if (!seat || seat.leftAt || !LIVE.some((s) => s === room.status)) return;
    let finish = false;
    let deleted = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      const current = await tx.room.findUnique({ where: { id: roomId }, select: { status: true } });
      if (current?.status === "LOBBY") {
        await tx.roomPlayer.delete({ where: { roomId_userId: { roomId, userId } } });
        deleted = (await this.vacate(tx, roomId, userId)) === "deleted";
      } else if (current?.status === "ACTIVE") {
        await tx.roomPlayer.update({ where: { roomId_userId: { roomId, userId } }, data: { leftAt: new Date() } });
        finish = (await this.vacate(tx, roomId, userId)) === "empty";
      }
    });
    this.gateway.emitToUser(userId, ROOM_EVENT, { id: roomId });
    if (deleted) return this.forget(roomId);
    // Duel par équipes : une équipe sans plus aucun joueur perd aussitôt par abandon
    if (!finish && room.status === "ACTIVE" && room.teamSize) {
      const remaining = await this.prisma.roomPlayer.findMany({ where: { roomId, leftAt: null }, select: { team: true } });
      if (new Set(remaining.map((p) => p.team)).size < 2) {
        const current = await this.loadRoom(roomId);
        if (current) await this.decideTeams(current, current.currentRound);
        await this.notifyRoom(roomId);
        return;
      }
    }
    if (finish) await this.finish(roomId);
    else if (room.status === "ACTIVE") await this.checkRoundComplete(roomId);
    await this.notifyRoom(roomId);
  }

  /** Lancement par l'hôte : au moins 2 joueurs ; les clips sont tirés à ce moment (jamais ceux proposés par un joueur du salon). */
  async start(userId: string, roomId: string): Promise<RoomDto> {
    const room = await this.memberRoom(userId, roomId);
    if (room.hostId !== userId) throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut lancer la partie." });
    if (room.status !== "LOBBY") throw new ConflictException({ code: "ROOM_STARTED", message: "La partie a déjà commencé." });
    // Aucun contrôle VIP au lancement : seul le créateur devait être VIP, l'hôte actuel peut être n'importe quel joueur
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
    // Salon par défaut lancé : son emplacement est remplacé tout de suite par une nouvelle salle d'attente
    if (room.systemSlot) void this.ensureSystemRooms().catch((e) => this.logger.error("Salons par défaut", e as Error));
    return this.detail(userId, roomId);
  }

  /**
   * Match de tournoi : salon à 2 créé et lancé aussitôt (les deux joueurs ont cliqué « Je suis prêt »), avec mort subite.
   * Pas de vérification VIP ici : le droit a été vérifié à la création du tournoi.
   * Les deux joueurs quittent leurs éventuelles salles d'attente ; les clips ne viennent jamais de l'un d'eux.
   */
  async createMatch(input: { gameId: string; rounds: number; roundSec: number; createdById: string; players: [string, string] }): Promise<string> {
    const clipIds = await this.pickClips(input.gameId, input.rounds, input.players);
    const first = await this.prisma.clip.findUniqueOrThrow({ where: { id: clipIds[0]! }, select: { durationSec: true } });
    const startsAt = later(ROOM_COUNTDOWN_SEC * SEC);
    const left: string[] = [];
    const roomId = await this.prisma.$transaction(async (tx) => {
      for (const userId of input.players) {
        await this.lockUser(tx, userId);
        left.push(...(await this.leaveLobbiesOnly(tx, userId)));
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = this.newCode();
        if (await tx.room.findUnique({ where: { code }, select: { id: true } })) continue;
        const room = await tx.room.create({
          data: {
            code, createdById: input.createdById, hostId: input.players[0], gameId: input.gameId, rounds: input.rounds, roundSec: input.roundSec,
            suddenDeath: true, maxPlayers: 2, status: "ACTIVE", startedAt: new Date(), currentRound: 1, roundStartsAt: startsAt,
            roundEndsAt: new Date(startsAt.getTime() + roomRoundSec(first.durationSec, input.roundSec) * SEC),
            expiresAt: new Date(),
            players: { create: input.players.map((userId) => ({ userId })) },
          },
        });
        await tx.roomRound.createMany({ data: clipIds.map((clipId, position) => ({ roomId: room.id, clipId, position })) });
        return room.id;
      }
      throw new ConflictException({ code: "ROOM_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
    });
    for (const id of left) await this.notifyRoom(id);
    await this.notifyRoom(roomId);
    return roomId;
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
    return { round: room.currentRound };
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
    if (tied.length && room.suddenDeath) {
      const finalists = await this.finalistsAmong(room.id, room.roundList, tied);
      return this.launchSuddenDeath(room, round, finalists, players.map((p) => p.userId), tied);
    }
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

  /**
   * Finalistes de la mort subite parmi les joueurs à égalité en tête : 3 au plus, choisis par une règle déterministe
   * (`pickFinalists` : rangs exacts, puis temps de réponse moyen, puis arrivée dans le salon), sur les manches prévues.
   */
  private async finalistsAmong(roomId: string, rounds: { clipId: string; suddenDeath: boolean; altClipId?: string | null }[], tied: string[]) {
    if (tied.length <= 3) return tied;
    const [guesses, seats] = await Promise.all([
      this.prisma.guess.findMany({ where: { roomId, userId: { in: tied }, clipId: { in: regularClips(rounds) } }, select: { userId: true, distance: true, responseMs: true } }),
      this.prisma.roomPlayer.findMany({ where: { roomId, userId: { in: tied } }, select: { userId: true, joinedAt: true } }),
    ]);
    return pickFinalists(seats.map((s) => {
      const mine = guesses.filter((g) => g.userId === s.userId);
      const timed = mine.filter((g) => g.responseMs !== null);
      return {
        id: s.userId,
        exact: mine.filter((g) => g.distance === 0).length,
        avgResponseMs: timed.length ? timed.reduce((sum, g) => sum + g.responseMs!, 0) / timed.length : null,
        joinedAt: s.joinedAt,
      };
    }));
  }

  /**
   * Nouvelle manche décisive entre `finalists`, sur un clip jamais joué dans ce salon ; sans clip disponible, victoire
   * partagée entre tous les joueurs à égalité (`tied`, par défaut les finalistes).
   */
  private async launchSuddenDeath(
    room: NonNullable<Awaited<ReturnType<RoomsService["loadRoom"]>>>, round: number, finalists: string[], everyone: string[], tied = finalists,
  ) {
    const used = room.roundList.flatMap((r) => roundClips(r));
    const [clip] = await this.prisma.$queryRaw<{ id: string; duration_sec: number }[]>`
      SELECT c.id, c.duration_sec FROM clips c
      WHERE c.status = 'APPROVED' AND c.deleted_at IS NULL AND c.game_id = ${room.gameId}::uuid
        AND c.uploader_id <> ALL(${everyone}::uuid[]) AND c.id <> ALL(${used}::uuid[])
      ORDER BY random() LIMIT 1`;
    if (!clip) return this.finish(room.id, round, { sharedWinners: tied, finalists: tied, decidedBy: "SHARED" });
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
      // Salon retiré : plus d'invitation en attente ; il n'est plus listé ni rejoignable (résultats gardés pour l'historique)
      await tx.roomInvite.deleteMany({ where: { roomId } });
      return true;
    });
    if (done) {
      await this.forget(roomId);
      await this.notifyRoom(roomId);
    }
  }

  private lastSweep = 0;

  /**
   * Chaque seconde (une seule instance à la fois, verrou Redis) : chronos écoulés, salles d'attente abandonnées ;
   * toutes les 5 s, présence des joueurs en salle d'attente (hôte déconnecté remplacé) et salons par défaut.
   * Tout l'état utile est en base ou dans Redis : après un redémarrage de l'API, la boucle reprend là où elle en était.
   */
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
    // Salle d'attente jamais lancée et expirée : supprimée (aucun résultat à garder)
    const stale = await this.prisma.room.findMany({
      where: { status: "LOBBY", expiresAt: { lte: now }, systemSlot: null },
      select: { id: true, players: { select: { userId: true } } },
      take: 200,
    });
    for (const r of stale) {
      const { count } = await this.prisma.room.deleteMany({ where: { id: r.id, status: "LOBBY" } });
      if (!count) continue;
      await this.forget(r.id);
      for (const p of r.players) this.gateway.emitToUser(p.userId, ROOM_EVENT, { id: r.id });
    }
    if (now.getTime() - this.lastSweep < SWEEP_MS) return;
    this.lastSweep = now.getTime();
    try {
      await this.presenceSweep(now.getTime());
      await this.ensureSystemRooms();
    } catch (e) {
      this.logger.error("Présence ou salons par défaut", e as Error);
    }
  }

  /**
   * Salons par défaut : pour chaque mode, 2 salles d'attente publiques (emplacements « MODE:1 » et « MODE:2 »).
   * Un emplacement libre (sa salle d'attente a été lancée) reçoit une nouvelle salle d'attente, sur le jeu suivant de la
   * rotation qui a assez de clips acceptés pour ce mode (`roomClipsNeeded`), si possible différent de celui de l'autre
   * salon du même mode. Une salle d'attente encore vide dont le jeu n'a plus assez de clips (clips retirés, jeu désactivé)
   * est remplacée ; occupée, elle reste en place (le lancement signale le manque de clips). L'index unique partiel de la
   * base garantit au plus une salle d'attente par emplacement, même si plusieurs demandes ou instances tentent de la créer
   * en même temps (la création en double est simplement ignorée). Un salon plein reste en place (affiché complet).
   */
  async ensureSystemRooms(): Promise<number> {
    const slots = ROOM_MODES.flatMap((mode) => Array.from({ length: ROOM_SYSTEM_SLOTS }, (_, i) => ({ mode, index: i + 1, slot: roomSystemSlot(mode, i + 1) })));
    const games = (await this.prisma.game.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true } })).map((g) => g.id);
    const approved = await this.approvedClipsByGame();
    const playable = new Map(ROOM_MODES.map((mode) => {
      const needed = roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings(mode) });
      return [mode, new Set(games.filter((g) => (approved.get(g) ?? 0) >= needed))] as const;
    }));
    const modeOf = (slot: string) => slots.find((s) => s.slot === slot)!.mode;
    const open = await this.prisma.room.findMany({
      where: { status: "LOBBY", systemSlot: { in: slots.map((s) => s.slot) } },
      select: { id: true, systemSlot: true, gameId: true, _count: { select: { players: true } } },
    });
    const lobbies = new Map<string, string>(); // emplacement → jeu de sa salle d'attente
    for (const o of open) {
      if (!o._count.players && !playable.get(modeOf(o.systemSlot!))!.has(o.gameId)) {
        // Vide et injouable : supprimée (seulement si toujours vide), l'emplacement est recréé ci-dessous
        const { count } = await this.prisma.room.deleteMany({ where: { id: o.id, status: "LOBBY", players: { none: {} } } });
        if (count) {
          await this.forget(o.id);
          continue;
        }
      }
      lobbies.set(o.systemSlot!, o.gameId);
    }
    let created = 0;
    for (const s of slots) {
      if (lobbies.has(s.slot)) continue;
      const last = await this.prisma.room.findFirst({ where: { systemSlot: s.slot }, orderBy: { createdAt: "desc" }, select: { gameId: true } });
      const siblings = slots.filter((o) => o.mode === s.mode && o.slot !== s.slot).map((o) => lobbies.get(o.slot)).filter((g): g is string => !!g);
      const gameId = nextSystemGame(games, playable.get(s.mode)!, last?.gameId ?? null, s.index, siblings);
      if (!gameId) continue; // aucun jeu n'a assez de clips pour ce mode : pas de salon injouable
      const settings = { visibility: "PUBLIC" as const, rounds: ROOM_DEFAULT_ROUNDS, roundSec: ROOM_DEFAULT_TIME, suddenDeath: false, ...modeSettings(s.mode) };
      try {
        await this.prisma.$transaction((tx) => this.insertRoom(tx, null, gameId, settings, s.slot));
        created++;
      } catch (e) {
        // Déjà recréé au même moment (index unique partiel) : rien à faire
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
      lobbies.set(s.slot, gameId);
    }
    return created;
  }

  /** Clips acceptés et non supprimés, par jeu */
  private async approvedClipsByGame(): Promise<Map<string, number>> {
    const rows = await this.prisma.clip.groupBy({ by: ["gameId"], where: { status: "APPROVED", deletedAt: null }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.gameId, r._count._all]));
  }

  /**
   * Présence en salle d'attente (connexion temps réel du site ou de l'application) : un hôte déconnecté depuis plus de
   * 30 s cède son rôle au joueur connecté arrivé le plus tôt ; un joueur déconnecté depuis plus de 2 min est retiré du salon.
   * Les heures de déconnexion sont gardées dans Redis (`room:away:<salon>`), elles survivent donc à un redémarrage de l'API.
   */
  private async presenceSweep(now: number) {
    const lobbies = await this.prisma.room.findMany({
      where: { status: "LOBBY", players: { some: {} } },
      select: { id: true, hostId: true, players: { orderBy: { joinedAt: "asc" }, select: { userId: true } } },
      take: 500,
    });
    for (const room of lobbies) {
      const key = `room:away:${room.id}`;
      const away = await this.redis.hgetall(key);
      const online = new Set<string>();
      for (const p of room.players) {
        if (await this.gateway.isOnline(p.userId)) {
          online.add(p.userId);
          if (away[p.userId]) await this.redis.hdel(key, p.userId);
        } else if (!away[p.userId]) {
          away[p.userId] = String(now);
          await this.redis.multi().hset(key, p.userId, String(now)).expire(key, 24 * 3600).exec();
        }
      }
      const since = (id: string) => (online.has(id) ? 0 : now - Number(away[id] ?? now));
      // Joueurs absents trop longtemps : retirés (comme s'ils avaient quitté), seulement si quelqu'un est encore connecté
      const gone = room.players.filter((p) => since(p.userId) >= PLAYER_AWAY_MS).map((p) => p.userId);
      if (gone.length && online.size) {
        for (const id of gone) {
          await this.leave(id, room.id).catch(() => undefined);
          await this.redis.hdel(key, id);
        }
        continue;
      }
      // Hôte absent depuis plus de 30 s : le joueur connecté arrivé le plus tôt devient hôte (aucune condition de VIP)
      const hostId = room.hostId;
      if (hostId && since(hostId) >= HOST_AWAY_MS && online.size) {
        const changed = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${room.id}::uuid FOR UPDATE`;
          const current = await tx.room.findUnique({ where: { id: room.id }, select: { status: true, hostId: true } });
          if (current?.status !== "LOBBY" || current.hostId !== hostId) return false;
          const next = await this.nextHost(tx, room.id, hostId);
          if (!next || !online.has(next)) return false;
          await tx.room.update({ where: { id: room.id }, data: { hostId: next } });
          return true;
        });
        if (changed) await this.notifyRoom(room.id);
      }
    }
  }

  // ---------- Lecture ----------

  async overview(userId: string): Promise<RoomsOverviewDto> {
    const [canCreate, seats, invites] = await Promise.all([
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
    const summary = (s: (typeof seats)[number]) => this.summary(s);
    const current = seats.find((s) => !s.leftAt && LIVE.some((st) => st === s.room.status));
    return {
      canCreate,
      vip: canCreate,
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
      answers: answers.filter((a) => a.clipId === r.clipId || a.clipId === r.altClipId).map((a) => ({ userId: a.userId, rank: a.guessedRank, score: a.score })),
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
      visibility: room.visibility,
      mode: roomMode(room),
      suddenDeath: room.suddenDeath,
      system: !!room.systemSlot,
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
      suddenDeathRounds: room.suddenDeathRounds,
      decidedBy: room.status === "FINISHED" ? (room.decidedBy as DecidedBy | null) : null,
      isHost: room.hostId === userId,
      tournamentId: room.tournamentMatch?.tournamentId ?? null,
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
    // Salon terminé ou fermé : retiré, son code ne mène plus nulle part (les membres retrouvent les résultats dans l'historique)
    if (!room || room.status === "CLOSED" || room.status === "FINISHED") {
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

  /**
   * Nouvel hôte : le joueur présent arrivé le plus tôt, de préférence connecté (site ou application ouverts), jamais
   * `except` ; aucune condition de VIP. Null s'il ne reste personne.
   */
  private async nextHost(tx: Prisma.TransactionClient, roomId: string, except?: string): Promise<string | null> {
    const players = await tx.roomPlayer.findMany({
      where: { roomId, leftAt: null, ...(except ? { userId: { not: except } } : {}) },
      orderBy: { joinedAt: "asc" },
      select: { userId: true },
    });
    for (const p of players) if (await this.gateway.isOnline(p.userId)) return p.userId;
    return players[0]?.userId ?? null;
  }

  /**
   * Après le départ de `userId` (déjà retiré ou marqué parti), sous verrou du salon : s'il ne reste personne, une salle
   * d'attente est supprimée (« deleted ») — un salon par défaut reste ouvert sans hôte (« kept ») — et une partie en cours
   * doit se terminer (« empty ») ; sinon, si c'était l'hôte, le rôle passe au joueur suivant (« kept »).
   */
  private async vacate(tx: Prisma.TransactionClient, roomId: string, userId: string): Promise<"deleted" | "empty" | "kept"> {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { status: true, hostId: true, systemSlot: true } });
    if (!room) return "deleted";
    const remaining = await tx.roomPlayer.count({ where: { roomId, leftAt: null } });
    if (!remaining) {
      if (room.status !== "LOBBY") return "empty";
      if (room.systemSlot) {
        await tx.room.update({ where: { id: roomId }, data: { hostId: null } });
        return "kept";
      }
      await tx.room.delete({ where: { id: roomId } });
      return "deleted";
    }
    if (room.hostId === userId) await tx.room.update({ where: { id: roomId }, data: { hostId: await this.nextHost(tx, roomId) } });
    return "kept";
  }

  /** État temporaire d'un salon retiré ou supprimé (Redis) : joueurs retirés par l'hôte, absences. */
  private async forget(roomId: string) {
    await this.redis.del(`room:kicked:${roomId}`, `room:away:${roomId}`).catch(() => undefined);
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
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${l.roomId}::uuid FOR UPDATE`;
      await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: l.roomId, userId } } });
      await this.vacate(tx, l.roomId, userId);
    }
    return lobbies.map((l) => l.roomId);
  }

  /** Sortie des salles d'attente (jamais d'une partie en cours), avant un match de tournoi. */
  private async leaveLobbiesOnly(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const lobbies = await tx.roomPlayer.findMany({ where: { userId, room: { status: "LOBBY" } }, select: { roomId: true, room: { select: { hostId: true } } } });
    for (const l of lobbies) {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${l.roomId}::uuid FOR UPDATE`;
      await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: l.roomId, userId } } });
      await this.vacate(tx, l.roomId, userId);
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
