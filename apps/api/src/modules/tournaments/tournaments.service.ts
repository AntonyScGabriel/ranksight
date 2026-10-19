import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";
import {
  ALL_GAMES, EVENT_LOBBY_TTL_DAYS, EVENT_REMINDER_MIN, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SUDDEN_DEATH_MAX_ROUNDS, TOURNAMENT_EVENT, TOURNAMENT_LOBBY_TTL_MIN, TOURNAMENT_MIN_PLAYERS,
  TOURNAMENT_READY_MIN, bracketSize, eliminatedPlacement, firstRoundPairs, nextSlot, stageCount,
  type CosmeticType, type CreateEventTournamentInput, type CreateTournamentInput, type TournamentDecidedBy, type TournamentRewardDto, type TournamentDto, type TournamentMatchDto, type TournamentPreviewDto,
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
import { canHost, canHostVipGames, extendVip, hostSelect, isVip, vipSelect } from "../shop/vip.js";
import { playableLinkWhere } from "../clips/clip-video.js";

const SEC = 1000;
/** Codes faux tolérés par joueur et par heure (compteur partagé avec les salons) */
const MAX_CODE_FAILURES = 15;
const LIVE = ["LOBBY", "ACTIVE"] as const;

const playerSelect = { id: true, displayName: true, avatarUrl: true, status: true, ...vipSelect, ...flairSelect } as const;
const tournamentInclude = {
  game: { select: { slug: true, name: true } },
  host: { select: { displayName: true } },
  rewardCosmetic: { select: { type: true, name: true, color: true } },
  players: { include: { user: { select: playerSelect } }, orderBy: { joinedAt: "asc" as const } },
  matches: { orderBy: [{ stage: "asc" }, { slot: "asc" }] as Prisma.TournamentMatchOrderByWithRelationInput[] },
} satisfies Prisma.TournamentInclude;

type TournamentRow = Prisma.TournamentGetPayload<{ include: typeof tournamentInclude }>;
const summaryInclude = {
  game: { select: { slug: true, name: true } },
  host: { select: { displayName: true } },
  rewardCosmetic: { select: { type: true, name: true, color: true } },
  _count: { select: { players: true } },
} satisfies Prisma.TournamentInclude;
type MatchRow = TournamentRow["matches"][number];
type CreateInput = z.output<typeof CreateTournamentInput>;
type CreateEventInput = z.output<typeof CreateEventTournamentInput>;

/** Récompense d'un événement telle qu'affichée aux joueurs */
const rewardOf = (t: { isEvent: boolean; rewardVipDays: number | null; rewardCosmetic: { type: CosmeticType; name: string; color: string } | null }): TournamentRewardDto | null =>
  t.isEvent && (t.rewardCosmetic || t.rewardVipDays) ? { cosmetic: t.rewardCosmetic, vipDays: t.rewardVipDays } : null;

const later = (ms: number) => new Date(Date.now() + ms);
const notFound = () => new NotFoundException({ code: "TOURNAMENT_NOT_FOUND", message: "Tournoi introuvable." });
const vipRequired = () =>
  new HttpException(
    { code: "PREMIUM_REQUIRED", message: "Créer un tournoi est réservé aux joueurs VIP. S'inscrire au tournoi d'un ami reste gratuit." },
    HttpStatus.PAYMENT_REQUIRED,
  );

/**
 * Tournois privés à élimination directe. Les opérations de l'organisateur (création, lancement, reprise de
 * l'organisation) exigent le VIP, relu en base à chaque fois ; s'inscrire, jouer et gagner est gratuit, et un tournoi
 * lancé va à son terme même si le créateur perd son VIP.
 * Avant le lancement, l'organisation ne passe qu'à un inscrit VIP : sans VIP inscrit, le tournoi reste sans organisateur
 * (`hostId` désigne alors un joueur qui n'est plus inscrit) jusqu'à ce qu'un VIP inscrit la reprenne ; à défaut, il est
 * fermé au départ du dernier inscrit ou à l'expiration de la salle d'attente.
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
    // Un seul tournoi à la fois par créateur, en attente ou en cours, même s'il l'a quitté : pas de tournois enchaînés
    // ni de liste remplie de tournois abandonnés. Un nouveau tournoi est possible une fois le précédent terminé ou fermé.
    const waiting = await this.prisma.tournament.findFirst({ where: { createdById: userId, isEvent: false, status: { in: [...LIVE] } }, select: { id: true } });
    if (waiting) {
      throw new ConflictException({
        code: "TOURNAMENT_ALREADY_WAITING",
        message: "Tu as déjà un tournoi en attente ou en cours. Tu pourras en créer un autre quand il sera terminé ou fermé.",
        tournamentId: waiting.id,
      });
    }
    // Le créateur est inscrit d'office : un seul tournoi à la fois
    await this.assertNoOtherTournament(userId);
    // « Tous les jeux » : pas de jeu fixé, les matchs tirent leurs clips dans tous les jeux actifs
    const allGames = input.game === ALL_GAMES.slug;
    const game = allGames ? null : await this.prisma.game.findFirst({ where: { slug: input.game, isActive: true }, select: { id: true } });
    if (!allGames && !game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    // De quoi jouer un match complet, mort subite comprise
    const needed = input.rounds + SUDDEN_DEATH_MAX_ROUNDS;
    const available = await this.prisma.clip.count({ where: { status: "APPROVED", deletedAt: null, ...(game ? { gameId: game.id } : { game: { isActive: true } }), uploaderId: { not: userId }, ...playableLinkWhere() } });
    if (available < needed) {
      throw new NotFoundException({ code: "NOT_ENOUGH_CLIPS", message: "Pas encore assez de clips sur ce jeu pour un tournoi. Choisis un autre jeu ou moins de manches." });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = this.newCode();
        if (await tx.tournament.findUnique({ where: { code }, select: { id: true } })) continue;
        const t = await tx.tournament.create({
          data: {
            code, createdById: userId, hostId: userId, gameId: game?.id ?? null, capacity: input.capacity, rounds: input.rounds, roundSec: input.roundSec,
            visibility: input.visibility,
            expiresAt: later(TOURNAMENT_LOBBY_TTL_MIN * 60 * SEC), players: { create: { userId } },
          },
        });
        return t.id;
      }
      throw new ConflictException({ code: "TOURNAMENT_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
    });
    return this.detail(userId, id);
  }

  /**
   * Événement (administration) : visible et rejoignable par tous avec le code affiché dans la liste des événements,
   * jusqu'à 64 places ; l'administrateur l'organise sans y jouer. Récompense facultative donnée au vainqueur.
   */
  async createEvent(adminId: string, input: CreateEventInput): Promise<{ id: string; code: string }> {
    const allGames = input.game === ALL_GAMES.slug;
    const game = allGames ? null : await this.prisma.game.findFirst({ where: { slug: input.game, isActive: true }, select: { id: true } });
    if (!allGames && !game) throw new BadRequestException({ code: "GAME_UNAVAILABLE", message: "Ce jeu n'est pas disponible." });
    if (input.rewardCosmeticId) {
      const c = await this.prisma.cosmetic.findUnique({ where: { id: input.rewardCosmeticId }, select: { isActive: true } });
      if (!c?.isActive) throw new BadRequestException("Cette récompense n'existe pas ou est désactivée.");
    }
    const needed = input.rounds + SUDDEN_DEATH_MAX_ROUNDS;
    const available = await this.prisma.clip.count({ where: { status: "APPROVED", deletedAt: null, ...(game ? { gameId: game.id } : { game: { isActive: true } }), ...playableLinkWhere() } });
    if (available < needed) throw new NotFoundException({ code: "NOT_ENOUGH_CLIPS", message: "Pas encore assez de clips sur ce jeu pour un tournoi." });
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.newCode();
      if (await this.prisma.tournament.findUnique({ where: { code }, select: { id: true } })) continue;
      const t = await this.prisma.tournament.create({
        data: {
          code, createdById: adminId, hostId: adminId, gameId: game?.id ?? null, capacity: input.capacity, rounds: input.rounds, roundSec: input.roundSec,
          isEvent: true, visibility: "PUBLIC", title: input.title, rewardCosmeticId: input.rewardCosmeticId ?? null, rewardVipDays: input.rewardVipDays ?? null,
          // Programmé : lancé à l'heure prévue (fermé s'il n'y a pas assez d'inscrits) ; sinon lancé à la main dans la semaine
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.startsAt ? new Date(new Date(input.startsAt).getTime() + 3600 * SEC) : later(EVENT_LOBBY_TTL_DAYS * 86_400 * SEC),
        },
        select: { id: true, code: true },
      });
      return t;
    }
    throw new ConflictException({ code: "TOURNAMENT_CODE_UNAVAILABLE", message: "Impossible de générer un code, réessaie." });
  }

  /** Événements (administration) : tous, les plus récents d'abord */
  async listEvents() {
    const rows = await this.prisma.tournament.findMany({
      where: { isEvent: true },
      include: { game: { select: { slug: true, name: true } }, rewardCosmetic: { select: { type: true, name: true, color: true } }, _count: { select: { players: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const winners = await this.prisma.tournamentPlayer.findMany({
      where: { tournamentId: { in: rows.map((r) => r.id) }, placement: 1 },
      select: { tournamentId: true, user: { select: { displayName: true } } },
    });
    return rows.map((t) => ({
      id: t.id, code: t.code, title: t.title, status: t.status, game: t.game ?? ALL_GAMES, capacity: t.capacity, rounds: t.rounds, roundSec: t.roundSec,
      players: t._count.players, reward: rewardOf(t), rewardGrantedAt: t.rewardGrantedAt?.toISOString() ?? null, startsAt: t.startsAt?.toISOString() ?? null,
      winner: winners.find((w) => w.tournamentId === t.id)?.user.displayName ?? null,
      createdAt: t.createdAt.toISOString(), expiresAt: t.expiresAt.toISOString(),
    }));
  }

  async preview(userId: string, code: string): Promise<TournamentPreviewDto> {
    const t = await this.byCode(userId, code);
    return {
      id: t.id, code: t.code, host: t.host.displayName, game: t.game ?? ALL_GAMES, capacity: t.capacity, rounds: t.rounds,
      players: t.players.filter((p) => !p.leftAt).length, status: t.status, member: t.players.some((p) => p.userId === userId),
    };
  }

  /** Inscription avec le code : gratuite, jusqu'au lancement et dans la limite des places ; un seul tournoi à la fois. */
  async join(userId: string, code: string): Promise<TournamentDto> {
    const found = await this.byCode(userId, code);
    if (found.players.some((p) => p.userId === userId)) return this.detail(userId, found.id);
    if (found.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
    await this.assertNoOtherTournament(userId);
    const others = found.players.map((p) => p.userId);
    const blocked = await this.prisma.userBlock.count({
      where: { OR: [{ blockerId: userId, blockedId: { in: others } }, { blockerId: { in: others }, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException({ code: "TOURNAMENT_UNAVAILABLE", message: "Impossible de rejoindre ce tournoi." });
    const full = await this.prisma.$transaction(async (tx) => {
      const [t] = await tx.$queryRaw<{ status: string; capacity: number }[]>`
        SELECT status::text, capacity FROM tournaments WHERE id = ${found.id}::uuid FOR UPDATE`;
      if (!t || t.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
      const count = await tx.tournamentPlayer.count({ where: { tournamentId: found.id } });
      if (count >= t.capacity) throw new ConflictException({ code: "TOURNAMENT_FULL", message: "Ce tournoi est complet." });
      await tx.tournamentPlayer.create({ data: { tournamentId: found.id, userId } });
      return count + 1 >= t.capacity;
    });
    // Tournoi de joueurs complet : lancé tout de suite, sans attendre l'organisateur (même s'il est parti sans VIP pour
    // le remplacer). Un événement attend toujours son lancement par l'administration.
    if (full && !found.isEvent) {
      try {
        await this.start(userId, found.id, false, true);
      } catch (e) {
        // Lancé au même instant par l'organisateur, ou départ simultané : l'état est relu ci-dessous
        this.logger.warn(`Tournoi ${found.id} : lancement automatique impossible (${(e as Error).message})`);
      }
    }
    await this.notify(found.id);
    return this.detail(userId, found.id);
  }

  /**
   * Quitter : avant le lancement, l'inscription est retirée ; si c'était l'organisateur, l'organisation passe au plus
   * ancien inscrit VIP (jamais à un joueur gratuit, qui ne pourrait pas lancer le tournoi). Le dernier départ ferme le
   * tournoi. Après le lancement, le joueur perd son match en cours ou à venir par forfait.
   */
  async leave(userId: string, tournamentId: string) {
    const t = await this.memberTournament(userId, tournamentId);
    const seat = t.players.find((p) => p.userId === userId)!;
    if (t.status === "LOBBY") {
      await this.prisma.$transaction(async (tx) => {
        // Verrou du tournoi : départs, reprises de l'organisation et lancement simultanés passent l'un après l'autre
        const row = await this.lockTournament(tx, tournamentId);
        if (row.status !== "LOBBY") {
          throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi vient de commencer : quitter maintenant compte comme un forfait, réessaie." });
        }
        const { count } = await tx.tournamentPlayer.deleteMany({ where: { tournamentId, userId } });
        if (!count) return;
        const remaining = await tx.tournamentPlayer.findMany({
          where: { tournamentId },
          orderBy: { joinedAt: "asc" },
          select: { userId: true, user: { select: hostSelect } },
        });
        // Un événement reste ouvert sans inscrit : l'administration l'organise sans y jouer
        if (!remaining.length && !t.isEvent) {
          await tx.tournament.update({ where: { id: tournamentId }, data: { status: "CLOSED", finishedAt: new Date() } });
        } else if (row.hostId === userId && !t.isEvent) {
          // Sans inscrit VIP, personne n'est désigné : un VIP inscrit pourra reprendre l'organisation (claimHost)
          const heir = remaining.find((p) => canHost(p.user));
          if (heir) await tx.tournament.update({ where: { id: tournamentId }, data: { hostId: heir.userId } });
        }
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

  /**
   * Reprise de l'organisation d'un tournoi resté sans organisateur (il est parti sans inscrit VIP pour le remplacer) :
   * réservée à un inscrit VIP, avant le lancement. Sous verrou : une seule reprise aboutit si plusieurs VIP essaient.
   */
  async claimHost(userId: string, tournamentId: string): Promise<TournamentDto> {
    await this.memberTournament(userId, tournamentId);
    if (!(await canHostVipGames(this.prisma, userId))) {
      throw new HttpException(
        { code: "PREMIUM_REQUIRED", message: "Reprendre l'organisation d'un tournoi est réservé aux joueurs VIP. Tu peux rester inscrit ou quitter le tournoi." },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockTournament(tx, tournamentId);
      if (row.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
      if (row.hostId === userId) return;
      const seats = await tx.tournamentPlayer.findMany({ where: { tournamentId, userId: { in: [userId, row.hostId] } }, select: { userId: true } });
      if (!seats.some((s) => s.userId === userId)) throw notFound();
      if (seats.some((s) => s.userId === row.hostId)) {
        throw new ConflictException({ code: "TOURNAMENT_HAS_HOST", message: "Ce tournoi a déjà un organisateur." });
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { hostId: userId } });
    });
    await this.notify(tournamentId);
    return this.detail(userId, tournamentId);
  }

  /** Lancement par l'hôte (3 joueurs au moins) : têtes de série au hasard, tableau complet, qualifiés d'office. */
  /**
   * `asAdmin` : lancement d'un événement depuis l'administration (n'importe quel administrateur).
   * `auto` : tournoi de joueurs lancé automatiquement quand il est complet (ni organisateur, ni VIP requis).
   */
  async start(userId: string, tournamentId: string, asAdmin = false, auto = false): Promise<TournamentDto> {
    const t = await this.visibleTournament(userId, tournamentId);
    // Événement : lancé uniquement depuis l'administration, jamais automatiquement ni par un joueur
    if (t.isEvent && !asAdmin) throw new ForbiddenException({ code: "EVENT_ADMIN_ONLY", message: "Cet événement est lancé par l'équipe RankGuess depuis l'administration." });
    if (!t.isEvent && !auto && (t.hostId !== userId || !t.players.some((p) => p.userId === userId))) {
      throw new ForbiddenException({ code: "NOT_HOST", message: "Seul l'hôte peut lancer le tournoi." });
    }
    if (t.status !== "LOBBY") throw new ConflictException({ code: "TOURNAMENT_STARTED", message: "Le tournoi a déjà commencé." });
    // Organiser un tournoi est réservé aux VIP : le droit est relu au lancement (une fois lancé, le tournoi va à son terme).
    // Un événement est organisé par l'administration, sans VIP.
    if (!t.isEvent && !auto && !(await canHostVipGames(this.prisma, userId))) {
      throw new HttpException(
        { code: "PREMIUM_REQUIRED", message: "Ton VIP a pris fin : renouvelle-le pour lancer ce tournoi. Les inscrits peuvent quitter le tournoi à tout moment." },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
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
        where: { id: tournamentId, status: "LOBBY", ...(t.isEvent || auto ? {} : { hostId: userId }) },
        data: { status: "ACTIVE", startedAt: new Date(), bracketSize: size },
      });
      if (!count) return false;
      // Un départ simultané (traité sous le même verrou) a changé les inscrits : on annule le lancement
      const seats = await tx.tournamentPlayer.findMany({ where: { tournamentId }, select: { userId: true } });
      if (seats.length !== players.length || seats.some((s) => !players.includes(s.userId))) {
        throw new ConflictException({ code: "TOURNAMENT_PLAYERS_CHANGED", message: "Les inscrits viennent de changer : vérifie la liste et relance le tournoi." });
      }
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
    if (done && final) await this.grantReward(m.tournamentId, winnerId);
    if (!done || final) return;
    await this.announceReadyMatches(m.tournamentId);
  }

  /** Récompense du vainqueur d'un événement : une seule fois (rewardGrantedAt), même si la fin est traitée deux fois */
  private async grantReward(tournamentId: string, winnerId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId }, select: { isEvent: true, title: true, rewardCosmeticId: true, rewardVipDays: true } });
    if (!t?.isEvent || (!t.rewardCosmeticId && !t.rewardVipDays)) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.tournament.updateMany({ where: { id: tournamentId, rewardGrantedAt: null }, data: { rewardGrantedAt: new Date() } });
        if (!count) return;
        const note = `Vainqueur de l'événement « ${t.title ?? "Tournoi"} »`.slice(0, 200);
        if (t.rewardCosmeticId) {
          await tx.userCosmetic.createMany({ data: [{ userId: winnerId, cosmeticId: t.rewardCosmeticId, source: "MANUAL", note }], skipDuplicates: true });
        }
        if (t.rewardVipDays) {
          await tx.purchase.create({ data: { userId: winnerId, product: "tournament_reward", days: t.rewardVipDays, amountCents: 0, provider: "MANUAL", status: "PAID", paidAt: new Date() } });
          await extendVip(tx, winnerId, t.rewardVipDays, "MANUAL", "tournament_reward");
        }
      });
      this.logger.log(`Événement ${tournamentId} : récompense donnée au vainqueur`);
    } catch (e) {
      this.logger.error(`Événement ${tournamentId} : récompense impossible à donner`, e as Error);
    }
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
          body: `Contre ${other.user.displayName} sur ${t.game?.name ?? ALL_GAMES.name.toLowerCase()}. Tu as ${TOURNAMENT_READY_MIN} minutes pour cliquer sur « Je suis prêt ».`,
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

      await this.scheduledEvents(now);

      const stale = await this.prisma.tournament.findMany({ where: { status: "LOBBY", expiresAt: { lte: now } }, select: { id: true }, take: 100 });
      for (const t of stale) {
        const { count } = await this.prisma.tournament.updateMany({ where: { id: t.id, status: "LOBBY" }, data: { status: "CLOSED", finishedAt: now } });
        if (count) await this.notify(t.id);
      }
    } catch (e) {
      this.logger.error("Suivi des tournois impossible", e as Error);
    }
  }

  /**
   * Événements programmés : rappel aux inscrits quelques minutes avant, puis lancement à l'heure prévue. Sans assez
   * d'inscrits à l'heure du début, l'événement est fermé (et les inscrits prévenus).
   */
  private async scheduledEvents(now: Date) {
    const soon = await this.prisma.tournament.findMany({
      where: { isEvent: true, status: "LOBBY", reminderSentAt: null, startsAt: { lte: new Date(now.getTime() + EVENT_REMINDER_MIN * 60 * SEC), gt: now } },
      select: { id: true, title: true, players: { where: { leftAt: null }, select: { userId: true } } },
      take: 20,
    });
    for (const e of soon) {
      const { count } = await this.prisma.tournament.updateMany({ where: { id: e.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!count || !e.players.length) continue;
      await this.push.toUsers(e.players.map((p) => p.userId), {
        title: "Événement bientôt lancé",
        body: `« ${e.title ?? "Tournoi"} » commence dans ${EVENT_REMINDER_MIN} minutes. Reste connecté pour jouer ton premier match.`,
        data: { url: `tournaments/${e.id}` },
      }).catch(() => undefined);
    }
    const due = await this.prisma.tournament.findMany({
      where: { isEvent: true, status: "LOBBY", startsAt: { lte: now } },
      select: { id: true, hostId: true, players: { select: { userId: true } } },
      take: 20,
    });
    for (const e of due) {
      if (e.players.length >= TOURNAMENT_MIN_PLAYERS) {
        await this.start(e.hostId, e.id, true).catch((err: Error) => this.logger.warn(`Événement ${e.id} : lancement programmé impossible (${err.message})`));
      } else {
        const { count } = await this.prisma.tournament.updateMany({ where: { id: e.id, status: "LOBBY" }, data: { status: "CLOSED", finishedAt: now } });
        if (count) await this.notify(e.id);
      }
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
    const [canHost, seats, events, open] = await Promise.all([
      canHostVipGames(this.prisma, userId),
      this.prisma.tournamentPlayer.findMany({
        where: { userId },
        orderBy: { joinedAt: "desc" },
        take: 20,
        include: { tournament: { include: summaryInclude } },
      }),
      this.prisma.tournament.findMany({ where: { isEvent: true, status: { in: [...LIVE] } }, include: summaryInclude, orderBy: { createdAt: "desc" }, take: 20 }),
      // Tournois publics de joueurs encore ouverts aux inscriptions (le joueur n'y est pas déjà inscrit)
      this.prisma.tournament.findMany({
        where: { isEvent: false, visibility: "PUBLIC", status: "LOBBY", players: { none: { userId } } },
        include: summaryInclude,
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    const toSummary = (t: (typeof events)[number], placement: number | null): TournamentSummaryDto => ({
      id: t.id, code: t.code, status: t.status, game: t.game ?? ALL_GAMES, host: t.isEvent ? "RankGuess" : t.host.displayName,
      players: t._count.players, capacity: t.capacity, placement, createdAt: t.createdAt.toISOString(),
      isEvent: t.isEvent, title: t.title, reward: rewardOf(t), startsAt: t.startsAt?.toISOString() ?? null,
    });
    const summary = (s: (typeof seats)[number]) => toSummary(s.tournament, s.placement);
    return {
      canHost,
      current: seats.filter((s) => LIVE.some((st) => st === s.tournament.status) && !s.leftAt).map(summary),
      recent: seats.filter((s) => s.tournament.status === "FINISHED").slice(0, 10).map(summary),
      events: events.map((e) => toSummary(e, null)),
      public: open.map((e) => toSummary(e, null)),
    };
  }

  async detail(userId: string, tournamentId: string): Promise<TournamentDto> {
    const t = await this.visibleTournament(userId, tournamentId);
    // Événement consulté sans être inscrit : pas de place, pas de match
    const me = t.players.find((p) => p.userId === userId);
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
    // Salle d'attente sans organisateur : il est parti et aucun inscrit VIP n'a pu le remplacer
    const hostLeft = !t.isEvent && t.status === "LOBBY" && !t.players.some((p) => p.userId === t.hostId);
    const players = [...t.players].sort((a, b) =>
      t.status === "FINISHED" ? (a.placement ?? 99) - (b.placement ?? 99) : t.status === "ACTIVE" ? (a.seed ?? 99) - (b.seed ?? 99) : 0,
    );
    return {
      id: t.id,
      code: t.code,
      status: t.status,
      game: t.game ?? ALL_GAMES,
      isEvent: t.isEvent,
      title: t.title,
      reward: rewardOf(t),
      startsAt: t.startsAt?.toISOString() ?? null,
      member: !!me,
      visibility: t.visibility,
      capacity: t.capacity,
      rounds: t.rounds,
      roundSec: t.roundSec,
      bracketSize: t.bracketSize,
      isHost: t.hostId === userId,
      hostLeft,
      canClaimHost: hostLeft && !!me && !me.leftAt && (await canHostVipGames(this.prisma, userId)),
      left: !!me?.leftAt,
      // Événement : lancé seulement depuis l'administration
      canStart: !t.isEvent && t.status === "LOBBY" && t.hostId === userId && t.players.length >= TOURNAMENT_MIN_PLAYERS,
      players: players.map((p) => ({
        id: p.userId,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        vip: isVip(p.user.subscription),
        flair: toFlair(p.user),
        isHost: p.userId === t.hostId,
        chatMuted: p.chatMuted,
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

  /**
   * Un joueur ne participe qu'à un tournoi à la fois (en attente ou en cours, sans l'avoir quitté) : pas d'inscriptions
   * dispersées qui laissent des tournois sans joueurs présents.
   */
  private async assertNoOtherTournament(userId: string) {
    const other = await this.prisma.tournamentPlayer.findFirst({
      where: { userId, leftAt: null, tournament: { status: { in: [...LIVE] } } },
      select: { tournamentId: true, tournament: { select: { title: true, isEvent: true } } },
    });
    if (other) {
      throw new ConflictException({
        code: "ALREADY_IN_TOURNAMENT",
        message: `Tu es déjà inscrit à ${other.tournament.isEvent ? `l'événement « ${other.tournament.title} »` : "un autre tournoi"}. Quitte-le avant d'en rejoindre un autre.`,
        tournamentId: other.tournamentId,
      });
    }
  }

  /** Verrouille la ligne du tournoi jusqu'à la fin de la transaction et renvoie son état à jour. */
  private async lockTournament(tx: Prisma.TransactionClient, tournamentId: string) {
    const [row] = await tx.$queryRaw<{ status: string; host_id: string }[]>`
      SELECT status::text, host_id::text FROM tournaments WHERE id = ${tournamentId}::uuid FOR UPDATE`;
    if (!row) throw notFound();
    return { status: row.status, hostId: row.host_id };
  }

  /** Tournoi visible : celui dont le joueur est inscrit, un tournoi public ou un événement (consultables par tous) */
  private async visibleTournament(userId: string, tournamentId: string): Promise<TournamentRow> {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId }, include: tournamentInclude });
    if (!t || !(t.isEvent || t.visibility === "PUBLIC" || t.players.some((p) => p.userId === userId))) throw notFound();
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
