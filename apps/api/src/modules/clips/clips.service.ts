import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NO_CLIP_MESSAGES, type DailyOverviewDto, type PlayableClipDto, type RankDto } from "@ranksight/shared";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { PlayTokenService } from "./play-token.service.js";

/** Jour de jeu courant : reset à 00:00 UTC pour que tout le monde ait les mêmes clips. */
export function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Erreur unique renvoyée quand aucun clip n'est jouable : le client affiche un message neutre. */
export function noClipAvailable() {
  return new NotFoundException({ code: "NO_CLIP_AVAILABLE", message: NO_CLIP_MESSAGES.title });
}

export const clipInclude = {
  game: { include: { ranks: { orderBy: { order: "asc" as const } } } },
} as const;

/** Un clip jouable : accepté par la modération, non supprimé, d'un jeu proposé sur le site. */
const PLAYABLE = { status: "APPROVED" as const, deletedAt: null, game: { isActive: true } };

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly playTokens: PlayTokenService,
  ) {}

  // ----- Défis du jour : un par jeu -----

  /** Les 4 défis du jour et, pour chacun, l'état du joueur : disponible, terminé (avec son score) ou indisponible. */
  async dailyOverview(userId: string): Promise<DailyOverviewDto> {
    const date = todayUtc();
    const games = await this.prisma.game.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    const dailies = await Promise.all(games.map((g) => this.ensureDaily(g.id)));
    const ids = dailies.filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.id);
    const [guesses, user] = await Promise.all([
      this.prisma.guess.findMany({
        where: { userId, dailyChallengeId: { in: ids } },
        include: { guessedRank: { select: { name: true, color: true } }, clip: { select: { rank: { select: { name: true, color: true } } } } },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dailyStreak: true, lastDailyDate: true } }),
    ]);
    const byDaily = new Map(guesses.map((g) => [g.dailyChallengeId, g]));

    const items = games.map((game, i) => {
      const daily = dailies[i];
      const guess = daily ? byDaily.get(daily.id) : undefined;
      return {
        game: { id: game.id, slug: game.slug as DailyOverviewDto["games"][number]["game"]["slug"], name: game.name, iconUrl: game.iconUrl, accent: game.accent },
        status: guess ? ("PLAYED" as const) : daily ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
        result: guess
          ? { score: guess.score, distance: guess.distance, guessedRank: guess.guessedRank, correctRank: guess.clip.rank }
          : null,
      };
    });
    // La série est perdue si le joueur n'a joué ni hier ni aujourd'hui
    const daysSince = user.lastDailyDate ? Math.round((date.getTime() - user.lastDailyDate.getTime()) / 86_400_000) : Infinity;
    return {
      date: date.toISOString().slice(0, 10),
      games: items,
      totalScore: guesses.reduce((s, g) => s + g.score, 0),
      played: guesses.length,
      dailyStreak: daysSince <= 1 ? user.dailyStreak : 0,
    };
  }

  /** Clip du défi du jour d'un jeu. Refusé si le joueur a déjà répondu : une seule tentative par jeu et par jour. */
  async dailyForGame(userId: string, slug: string): Promise<PlayableClipDto> {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game || !game.isActive) throw new NotFoundException({ code: "GAME_NOT_FOUND", message: "Ce jeu n'est pas disponible." });
    const daily = await this.ensureDaily(game.id);
    if (!daily) throw noClipAvailable();

    const played = await this.prisma.guess.findUnique({
      where: { userId_dailyChallengeId: { userId, dailyChallengeId: daily.id } },
      select: { id: true },
    });
    if (played) {
      throw new ConflictException({
        code: "ALREADY_PLAYED",
        message: `Tu as déjà joué le défi ${game.name} aujourd'hui. Reviens demain pour un nouveau clip !`,
      });
    }
    const token = await this.playTokens.sign({ uid: userId, cid: daily.clipId, mode: "DAILY", did: daily.id });
    return this.toPlayable(daily.clip, token, "DAILY", daily.date);
  }

  /** Garantit un défi du jour pour chaque jeu actif (après la suppression d'un clip par l'équipe, par exemple). */
  async ensureTodayDailies() {
    const games = await this.prisma.game.findMany({ where: { isActive: true }, select: { id: true } });
    await Promise.all(games.map((g) => this.ensureDaily(g.id)));
  }

  /**
   * Défi du jour d'un jeu : celui planifié par la modération, sinon un clip accepté de ce jeu tiré au sort
   * (en priorité un clip jamais passé en défi). La contrainte unique (date, jeu) garantit un seul défi par jeu et par jour.
   */
  private async ensureDaily(gameId: string) {
    const date = todayUtc();
    const where = { date_gameId: { date, gameId } };
    const existing = await this.prisma.dailyChallenge.findUnique({ where, include: { clip: { include: clipInclude } } });
    if (existing && existing.clip.status === "APPROVED" && !existing.clip.deletedAt) return existing;

    const playable = { ...PLAYABLE, gameId };
    const pick = (await this.randomClip({ ...playable, dailies: { none: {} } })) ?? (await this.randomClip(playable));
    if (!pick) return null;

    if (existing) {
      // Le clip du défi a été retiré par l'équipe : il est remplacé pour la suite de la journée.
      // Les joueurs qui avaient déjà répondu gardent leur résultat (leur réponse reste liée au clip d'origine).
      return this.prisma.dailyChallenge.update({ where: { id: existing.id }, data: { clipId: pick.id }, include: { clip: { include: clipInclude } } });
    }
    try {
      const created = await this.prisma.dailyChallenge.create({ data: { date, gameId, clipId: pick.id }, include: { clip: { include: clipInclude } } });
      this.logger.log(`Défi du ${date.toISOString().slice(0, 10)} (${gameId}) tiré au sort : ${pick.id}`);
      return created;
    } catch {
      // Deux requêtes simultanées : l'autre a déjà créé le défi du jour pour ce jeu
      return this.prisma.dailyChallenge.findUnique({ where, include: { clip: { include: clipInclude } } });
    }
  }

  private async randomClip(where: Record<string, unknown>) {
    const count = await this.prisma.clip.count({ where });
    if (count === 0) return null;
    return this.prisma.clip.findFirst({ where, skip: Math.floor(Math.random() * count), select: { id: true } });
  }

  // ----- Mode Infini -----

  async startRun(userId: string) {
    // Une seule partie active à la fois
    await this.prisma.infiniteRun.updateMany({ where: { userId, endedAt: null }, data: { endedAt: new Date() } });
    return this.prisma.infiniteRun.create({ data: { userId } });
  }

  async nextInfinite(userId: string, runId: string, gameSlug?: string): Promise<PlayableClipDto> {
    const run = await this.prisma.infiniteRun.findFirst({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException();
    if (run.endedAt) throw new ConflictException({ code: "RUN_ENDED" });

    // Exclus : clips déjà vus par le joueur et clips qu'il a lui-même proposés (il connaît le rang)
    const seen = await this.prisma.guess.findMany({ where: { userId }, select: { clipId: true }, take: 2000, orderBy: { createdAt: "desc" } });
    const base = {
      ...PLAYABLE,
      id: { notIn: seen.map((s) => s.clipId) },
      uploaderId: { not: userId },
      game: { isActive: true, ...(gameSlug ? { slug: gameSlug } : {}) },
    };
    // Fenêtre de difficulté ±1 autour du niveau de la partie, élargie si le catalogue est trop petit
    let where: typeof base & { difficulty?: { gte: number; lte: number } } = {
      ...base,
      difficulty: { gte: Math.max(1, run.difficulty - 1), lte: Math.min(5, run.difficulty + 1) },
    };
    let count = await this.prisma.clip.count({ where });
    if (count === 0) {
      where = base;
      count = await this.prisma.clip.count({ where });
    }
    if (count === 0) {
      await this.prisma.infiniteRun.update({ where: { id: run.id }, data: { endedAt: new Date() } });
      throw noClipAvailable();
    }

    const clip = await this.prisma.clip.findFirstOrThrow({ where, include: clipInclude, skip: Math.floor(Math.random() * count) });
    const token = await this.playTokens.sign({ uid: userId, cid: clip.id, mode: "INFINITE", rid: run.id });
    return this.toPlayable(clip, token, "INFINITE", null);
  }

  /** Projection publique : ni rankId, ni preuve, ni clé de stockage. */
  async toPlayable(
    clip: {
      id: string; storageKey: string; hlsKey: string | null; posterKey: string | null; durationSec: number; difficulty: number;
      game: { id: string; slug: string; name: string; iconUrl: string | null; ranks: (RankDto & { gameId: string })[] };
    },
    playToken: string,
    mode: "DAILY" | "INFINITE" | "VERSUS",
    dailyDate: Date | null,
  ): Promise<PlayableClipDto> {
    const { ranks, ...game } = clip.game;
    return {
      id: clip.id,
      playToken,
      game: { id: game.id, slug: game.slug as PlayableClipDto["game"]["slug"], name: game.name, iconUrl: game.iconUrl },
      ranks: ranks.map(({ gameId: _gameId, ...r }) => r),
      videoUrl: await this.storage.signedReadUrl(clip.hlsKey ?? clip.storageKey),
      posterUrl: clip.posterKey ? await this.storage.signedReadUrl(clip.posterKey) : null,
      durationSec: clip.durationSec,
      mode,
      dailyDate: dailyDate?.toISOString().slice(0, 10) ?? null,
      difficulty: clip.difficulty,
    };
  }
}
