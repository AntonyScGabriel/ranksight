/**
 * Classement compétitif RankSight (cote Elo), distinct du rang réel dans les jeux.
 * Seuls les duels « au hasard » comptent : jamais les duels entre amis, les salons ni les tournois privés,
 * pour qu'on ne puisse pas monter en jouant entre amis. Le VIP n'apporte aucun point.
 */
import { z } from "zod";
import { FlairDto } from "./rewards.js";
import { GAME_SLUGS, GameSlug } from "./schemas.js";

export const RATING_START = 1000;
export const RATING_FLOOR = 100;
/** Facteur K : 32 pendant les 20 premiers duels (cote provisoire), 20 ensuite */
export const RATING_K_NEW = 32;
export const RATING_K = 20;
export const RATING_PROVISIONAL_GAMES = 20;
/** Duels à jouer avant d'apparaître dans le classement */
export const RATING_MIN_GAMES = 5;
/** Contre un même adversaire, seuls les 3 premiers duels de 24 heures comptent (anti-arrangement) */
export const RATING_PAIR_LIMIT = 3;

/** « global » (tous les duels au hasard) ou un jeu (duels au hasard sur ce jeu) */
export const RatingScope = z.union([z.literal("global"), GameSlug]);
export type RatingScope = z.infer<typeof RatingScope>;
export const RATING_SCOPES: readonly RatingScope[] = ["global", ...GAME_SLUGS];

export type DuelResult = "WIN" | "LOSS" | "DRAW";
const POINTS: Record<DuelResult, number> = { WIN: 1, DRAW: 0.5, LOSS: 0 };

/** Probabilité de victoire attendue face à l'adversaire */
export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));

/** Variation de cote après un duel (arrondie), jamais en dessous du plancher */
export function ratingDelta(rating: number, opponent: number, result: DuelResult, gamesPlayed: number): number {
  const k = gamesPlayed < RATING_PROVISIONAL_GAMES ? RATING_K_NEW : RATING_K;
  const delta = Math.round(k * (POINTS[result] - expectedScore(rating, opponent)));
  // « || 0 » : jamais de -0 (une perte attendue contre bien plus fort coûte 0)
  return Math.max(RATING_FLOOR - rating, delta) || 0;
}

/** Paliers affichés (repères, sans effet sur la cote) */
export const RATING_TIERS = [
  { min: 1500, name: "Maître", color: "#F472B6" },
  { min: 1300, name: "Diamant", color: "#22D3EE" },
  { min: 1150, name: "Platine", color: "#2DD4BF" },
  { min: 1000, name: "Or", color: "#FACC15" },
  { min: 850, name: "Argent", color: "#CBD5E1" },
  { min: 0, name: "Bronze", color: "#D97706" },
] as const;
export const ratingTier = (rating: number) => RATING_TIERS.find((t) => rating >= t.min)!;

export const RATING_RULES = [
  "Seuls les duels « au hasard » comptent : jamais les duels entre amis, les salons ni les tournois privés.",
  `Cote de départ ${RATING_START}. Gagner contre un joueur mieux classé rapporte plus ; perdre contre un joueur moins bien classé coûte plus (méthode Elo).`,
  `Les ${RATING_PROVISIONAL_GAMES} premiers duels font bouger la cote plus vite (cote provisoire).`,
  "Un duel sur un jeu compte pour le classement de ce jeu et pour le classement global ; « Tous les jeux » compte pour le global seulement.",
  `Contre un même adversaire, seuls ${RATING_PAIR_LIMIT} duels par 24 heures comptent. Un abandon compte comme une défaite.`,
  `Il faut ${RATING_MIN_GAMES} duels pour apparaître dans le classement. Le VIP n'apporte aucun point.`,
] as const;

// ---------- Réponses de l'API ----------

export const RatingDto = z.object({
  scope: RatingScope,
  rating: z.number().int(),
  peak: z.number().int(),
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  /** Place dans le classement (null tant que le joueur n'a pas assez de duels) */
  rank: z.number().int().nullable(),
});
export type RatingDto = z.infer<typeof RatingDto>;

export const RatingChangeDto = z.object({
  scope: RatingScope,
  matchId: z.string().uuid(),
  opponent: z.string(),
  result: z.enum(["WIN", "LOSS", "DRAW"]),
  before: z.number().int(),
  after: z.number().int(),
  delta: z.number().int(),
  /** false : duel au-delà de la limite contre ce même adversaire, sans effet sur la cote */
  counted: z.boolean(),
  createdAt: z.string(),
});
export type RatingChangeDto = z.infer<typeof RatingChangeDto>;

export const MyRatingsDto = z.object({ ratings: z.array(RatingDto), history: z.array(RatingChangeDto) });
export type MyRatingsDto = z.infer<typeof MyRatingsDto>;

export const RatingEntryDto = z.object({
  rank: z.number().int(),
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  vip: z.boolean(),
  flair: FlairDto,
  rating: z.number().int(),
  games: z.number().int(),
  wins: z.number().int(),
});
export type RatingEntryDto = z.infer<typeof RatingEntryDto>;

export const RatingBoardDto = z.object({
  scope: RatingScope,
  entries: z.array(RatingEntryDto),
  me: RatingDto.nullable(),
});
export type RatingBoardDto = z.infer<typeof RatingBoardDto>;

/** Variation de cote d'un duel, pour l'écran de fin du duel */
export const DuelRatingDto = z.object({ scope: RatingScope, before: z.number().int(), after: z.number().int(), delta: z.number().int(), counted: z.boolean() });
export type DuelRatingDto = z.infer<typeof DuelRatingDto>;
