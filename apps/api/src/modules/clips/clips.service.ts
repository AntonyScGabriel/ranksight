import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DAILY_PER_GAME, NO_CLIP_MESSAGES, type DailyOverviewDto, type PlayableClipDto, type RankDto } from "@ranksight/shared";
import type { ClipLinkProvider } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { PlayTokenService } from "./play-token.service.js";
import { clipVideo, playableLinkWhere } from "./clip-video.js";

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
const playable = () => ({ status: "APPROVED" as const, deletedAt: null, game: { isActive: true }, ...playableLinkWhere() });

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly playTokens: PlayTokenService,
  ) {}

  // ----- Défis du jour : DAILY_PER_GAME par jeu -----

  /** Les défis du jour (3 par jeu) et, pour chacun, l'état du joueur : disponible, terminé (avec son score) ou indisponible. */
  async dailyOverview(userId: string): Promise<DailyOverviewDto> {
    const date = todayUtc();
    const games = await this.prisma.game.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    const dailies = await Promise.all(games.map((g) => this.ensureDailies(g.id)));
    const ids = dailies.flat().map((d) => d.id);
    const [guesses, user] = await Promise.all([
      this.prisma.guess.findMany({
        where: { userId, dailyChallengeId: { in: ids } },
        include: { guessedRank: { select: { name: true, color: true } }, clip: { select: { rank: { select: { name: true, color: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dailyStreak: true, lastDailyDate: true } }),
    ]);
    const byDaily = new Map(guesses.map((g) => [g.dailyChallengeId, g]));
    const toResult = (g: (typeof guesses)[number]) => ({ score: g.score, distance: g.distance, guessedRank: g.guessedRank, correctRank: g.clip.rank });

    const items = games.map((game, i) => {
      const challenges = Array.from({ length: DAILY_PER_GAME }, (_, k) => {
        const daily = dailies[i].find((d) => d.slot === k + 1);
        const guess = daily ? byDaily.get(daily.id) : undefined;
        return {
          slot: k + 1,
          status: guess ? ("PLAYED" as const) : daily ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
          result: guess ? toResult(guess) : null,
        };
      });
      const played = challenges.filter((c) => c.result);
      return {
        game: { id: game.id, slug: game.slug as DailyOverviewDto["games"][number]["game"]["slug"], name: game.name, iconUrl: game.iconUrl, accent: game.accent },
        status: challenges.some((c) => c.status === "AVAILABLE") ? ("AVAILABLE" as const) : played.length ? ("PLAYED" as const) : ("UNAVAILABLE" as const),
        result: played.at(-1)?.result ?? null,
        challenges,
        score: played.reduce((sum, c) => sum + (c.result?.score ?? 0), 0),
      };
    });
    // La série est perdue si le joueur n'a joué ni hier ni aujourd'hui
    const daysSince = user.lastDailyDate ? Math.round((date.getTime() - user.lastDailyDate.getTime()) / 86_400_000) : Infinity;
    return {
      date: date.toISOString().slice(0, 10),
      games: items,
      totalScore: guesses.reduce((s, g) => s + g.score, 0),
      played: guesses.length,
      total: ids.length,
      dailyStreak: daysSince <= 1 ? user.dailyStreak : 0,
    };
  }

  /**
   * Clip d'un défi du jour (n° `slot`, ou le premier pas encore joué si `slot` est absent : anciennes versions de
   * l'application). Une seule tentative par défi.
   */
  async dailyForGame(userId: string, slug: string, slot?: number): Promise<PlayableClipDto & { slot: number }> {
    const game = await this.prisma.game.findUnique({ where: { slug } });
    if (!game || !game.isActive) throw new NotFoundException({ code: "GAME_NOT_FOUND", message: "Ce jeu n'est pas disponible." });
    // Les défis des autres jeux sont tirés en même temps : « Grand chelem » et « Sans faute » se mesurent
    // sur l'ensemble des défis du jour
    const [dailies] = await Promise.all([this.ensureDailies(game.id), this.ensureTodayDailies(game.id)]);
    if (!dailies.length) throw noClipAvailable();

    const played = new Set(
      (await this.prisma.guess.findMany({ where: { userId, dailyChallengeId: { in: dailies.map((d) => d.id) } }, select: { dailyChallengeId: true } }))
        .map((g) => g.dailyChallengeId),
    );
    const daily = slot ? dailies.find((d) => d.slot === slot) : dailies.find((d) => !played.has(d.id));
    if (slot && !daily) throw noClipAvailable();
    if (!daily || played.has(daily.id)) {
      const left = dailies.filter((d) => !played.has(d.id)).length;
      throw new ConflictException({
        code: "ALREADY_PLAYED",
        message: left
          ? `Tu as déjà joué ce défi ${game.name}. Il t'en reste ${left} aujourd'hui !`
          : `Tu as joué les ${dailies.length} défis ${game.name} du jour. Reviens demain pour de nouveaux clips !`,
      });
    }
    const token = await this.playTokens.sign({ uid: userId, cid: daily.clipId, mode: "DAILY", did: daily.id });
    return { ...(await this.toPlayable(daily.clip, token, "DAILY", daily.date)), slot: daily.slot };
  }

  /** Garantit les défis du jour de chaque jeu actif (après la suppression d'un clip par l'équipe, par exemple). */
  async ensureTodayDailies(exceptGameId?: string) {
    const games = await this.prisma.game.findMany({ where: { isActive: true, ...(exceptGameId ? { id: { not: exceptGameId } } : {}) }, select: { id: true } });
    await Promise.all(games.map((g) => this.ensureDailies(g.id)));
  }

  /** Les défis du jour d'un jeu, triés par numéro (moins de DAILY_PER_GAME si le catalogue manque de clips). */
  private async ensureDailies(gameId: string) {
    const list = [];
    // Dans l'ordre : chaque tirage exclut les clips déjà retenus pour les défis précédents du jour
    for (let slot = 1; slot <= DAILY_PER_GAME; slot++) {
      const daily = await this.ensureDaily(gameId, slot);
      if (daily) list.push(daily);
    }
    return list;
  }

  /**
   * Défi n° `slot` du jour d'un jeu : celui planifié par la modération, sinon un clip accepté de ce jeu tiré au sort
   * (en priorité un clip jamais passé en défi, jamais deux fois le même clip le même jour). La contrainte unique
   * (date, jeu, numéro) garantit un seul clip par défi.
   */
  private async ensureDaily(gameId: string, slot: number) {
    const date = todayUtc();
    const where = { date_gameId_slot: { date, gameId, slot } };
    const existing = await this.prisma.dailyChallenge.findUnique({ where, include: { clip: { include: clipInclude } } });
    if (existing && existing.clip.status === "APPROVED" && !existing.clip.deletedAt) return existing;

    const usedToday = (await this.prisma.dailyChallenge.findMany({ where: { date, gameId, slot: { not: slot } }, select: { clipId: true } })).map((d) => d.clipId);
    const candidates = { ...playable(), gameId, id: { notIn: usedToday } };
    const pick = (await this.randomClip({ ...candidates, dailies: { none: {} } })) ?? (await this.randomClip(candidates));
    if (!pick) return null;

    if (existing) {
      // Le clip du défi a été retiré par l'équipe : il est remplacé pour la suite de la journée.
      // Les joueurs qui avaient déjà répondu gardent leur résultat (leur réponse reste liée au clip d'origine).
      return this.prisma.dailyChallenge.update({ where: { id: existing.id }, data: { clipId: pick.id }, include: { clip: { include: clipInclude } } });
    }
    try {
      const created = await this.prisma.dailyChallenge.create({ data: { date, gameId, slot, clipId: pick.id }, include: { clip: { include: clipInclude } } });
      this.logger.log(`Défi n° ${slot} du ${date.toISOString().slice(0, 10)} (${gameId}) tiré au sort : ${pick.id}`);
      return created;
    } catch {
      // Deux requêtes simultanées : l'autre a déjà créé ce défi
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
      ...playable(),
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
      linkProvider: ClipLinkProvider | null; linkVideoId: string | null; linkStartSec: number | null;
      game: { id: string; slug: string; name: string; iconUrl: string | null; ranks: (RankDto & { gameId: string })[] };
    },
    playToken: string,
    mode: "DAILY" | "INFINITE" | "VERSUS" | "ROOM",
    dailyDate: Date | null,
  ): Promise<PlayableClipDto> {
    const { ranks, ...game } = clip.game;
    return {
      id: clip.id,
      playToken,
      game: { id: game.id, slug: game.slug as PlayableClipDto["game"]["slug"], name: game.name, iconUrl: game.iconUrl },
      ranks: ranks.map(({ gameId: _gameId, ...r }) => r),
      ...(await clipVideo(this.storage, clip)),
      durationSec: clip.durationSec,
      mode,
      dailyDate: dailyDate?.toISOString().slice(0, 10) ?? null,
      difficulty: clip.difficulty,
    };
  }
}
