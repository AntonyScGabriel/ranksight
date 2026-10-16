/**
 * Classement compétitif RankSight (cote Elo), distinct du rang réel dans les jeux.
 * Seuls les duels « au hasard » comptent : jamais les duels entre amis, les salons (publics ou privés) ni les tournois,
 * pour qu'on ne puisse pas monter en jouant entre amis. Le VIP n'apporte aucun point.
 */
import { z } from "zod";
import { FlairDto } from "./rewards.js";
import { GAME_SLUGS, GameSlug } from "./schemas.js";

export const RATING_START = 500;
export const RATING_FLOOR = 100;
/** Facteur K : 32 pendant les 20 premiers duels admissibles de la carrière (placement), 20 ensuite */
export const RATING_K_NEW = 32;
export const RATING_K = 20;
export const RATING_PROVISIONAL_GAMES = 20;
/** Duels admissibles à jouer dans la saison avant d'apparaître dans le classement */
export const RATING_MIN_GAMES = 5;
/** Contre un même adversaire, seuls les 3 premiers duels admissibles de 24 heures (fenêtre glissante) comptent */
export const RATING_PAIR_LIMIT = 3;
export const RATING_PAIR_WINDOW_HOURS = 24;
/** Ancienne échelle (cote de départ 1000) : les cotes existantes sont décalées d'autant à la migration */
export const RATING_LEGACY_OFFSET = 500;

/** « global » (tous les duels au hasard) ou un jeu (duels au hasard sur ce jeu) */
export const RatingScope = z.union([z.literal("global"), GameSlug]);
export type RatingScope = z.infer<typeof RatingScope>;
export const RATING_SCOPES: readonly RatingScope[] = ["global", ...GAME_SLUGS];

export type DuelResult = "WIN" | "LOSS" | "DRAW";
const POINTS: Record<DuelResult, number> = { WIN: 1, DRAW: 0.5, LOSS: 0 };

/** Probabilité de victoire attendue face à l'adversaire */
export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));

/** Facteur K selon le nombre de duels admissibles déjà comptés dans la carrière du joueur */
export const ratingK = (careerGames: number) => (careerGames < RATING_PROVISIONAL_GAMES ? RATING_K_NEW : RATING_K);

/** Variation de cote après un duel (arrondie), jamais en dessous du plancher */
export function ratingDelta(rating: number, opponent: number, result: DuelResult, careerGames: number): number {
  const delta = Math.round(ratingK(careerGames) * (POINTS[result] - expectedScore(rating, opponent)));
  // « || 0 » : jamais de -0 (une perte attendue contre bien plus fort coûte 0)
  return Math.max(RATING_FLOOR - rating, delta) || 0;
}

/**
 * Échelle officielle des rangs compétitifs, unique pour l'API, le site et l'application.
 * C'est l'échelle d'origine (Bronze, Argent, Or, Platine, Diamant, Maître) avec les mêmes écarts, alignée sur la cote
 * de départ de 500 : un nouveau joueur commence au seuil de l'Or. Le seuil du Bronze est le plancher de cote.
 */
export const RATING_TIERS = [
  { key: "MASTER", min: 1000, name: "Maître", color: "#F472B6" },
  { key: "DIAMOND", min: 800, name: "Diamant", color: "#22D3EE" },
  { key: "PLATINUM", min: 650, name: "Platine", color: "#2DD4BF" },
  { key: "GOLD", min: 500, name: "Or", color: "#FACC15" },
  { key: "SILVER", min: 350, name: "Argent", color: "#CBD5E1" },
  { key: "BRONZE", min: RATING_FLOOR, name: "Bronze", color: "#D97706" },
] as const;
export type RatingTier = (typeof RATING_TIERS)[number];
export type RatingTierKey = RatingTier["key"];
export const RatingTierKey = z.enum(["MASTER", "DIAMOND", "PLATINUM", "GOLD", "SILVER", "BRONZE"]);

/** Rang correspondant à une cote (une cote exactement au seuil appartient au rang du seuil) */
export const ratingTier = (rating: number): RatingTier => RATING_TIERS.find((t) => rating >= t.min) ?? RATING_TIERS[RATING_TIERS.length - 1]!;
export const tierByKey = (key: string): RatingTier => RATING_TIERS.find((t) => t.key === key) ?? RATING_TIERS[RATING_TIERS.length - 1]!;

/** Progression vers le rang suivant (null au rang le plus haut) */
export function tierProgress(rating: number): { tier: RatingTier; next: RatingTier | null; pointsToNext: number | null; progress: number } {
  const tier = ratingTier(rating);
  const index = RATING_TIERS.indexOf(tier);
  const next = index > 0 ? RATING_TIERS[index - 1]! : null;
  if (!next) return { tier, next: null, pointsToNext: null, progress: 1 };
  const span = next.min - tier.min;
  return { tier, next, pointsToNext: next.min - rating, progress: Math.min(1, Math.max(0, (rating - tier.min) / span)) };
}

/**
 * Réinitialisation de saison (partielle) : la nouvelle cote est le seuil minimal du rang atteint à la fin de la saison.
 * - Joueur classé (au moins RATING_MIN_GAMES duels admissibles dans la saison) : seuil de son rang, quel que soit l'écart
 *   avec ce seuil (une cote très au-dessus, même au rang Maître sans plafond, repart au seuil ; une cote juste sous le
 *   rang suivant reste dans son rang : seule la cote finale compte, sans arrondi).
 * - Joueur non classé : même règle, sans jamais dépasser la cote de départ (aucun rang élevé n'est attribué sans les
 *   duels nécessaires) ; un joueur non classé sous la cote de départ repart au seuil de son rang, comme les autres.
 */
export function seasonResetRating(rating: number, ranked: boolean): number {
  const floor = ratingTier(rating).min;
  return ranked ? floor : Math.min(floor, RATING_START);
}

/** Pourquoi un duel n'a pas changé la cote (affiché au joueur) */
export const RATING_UNCOUNTED_LABEL: Record<"PAIR_LIMIT" | "EARLY_FORFEIT", string> = {
  PAIR_LIMIT: `Ce duel ne compte pas : déjà ${RATING_PAIR_LIMIT} duels contre ce joueur en 24 heures.`,
  EARLY_FORFEIT: "Victoire par abandon avant la fin de la première manche : elle ne rapporte pas de points.",
};

export const RATING_RULES = [
  "Seuls les duels « au hasard » comptent : jamais les duels entre amis, les salons publics ou privés ni les tournois.",
  `Tout le monde commence à ${RATING_START} points. Battre un joueur mieux classé rapporte plus ; perdre contre un joueur moins bien classé coûte plus.`,
  `Tes ${RATING_PROVISIONAL_GAMES} premiers duels font bouger ta cote plus vite, le temps de trouver ton niveau.`,
  "Un duel sur un jeu compte pour le classement de ce jeu et pour le classement global ; « Tous les jeux » compte pour le global seulement.",
  `Contre un même adversaire, seuls ${RATING_PAIR_LIMIT} duels par 24 heures comptent. Abandonner compte comme une défaite.`,
  `Il faut ${RATING_MIN_GAMES} duels dans la saison pour apparaître dans le classement. Le VIP n'apporte aucun point.`,
  "À la fin de chaque saison, ta cote repart au seuil du rang que tu as atteint.",
] as const;

// ---------- Réponses de l'API ----------

export const RatingDto = z.object({
  scope: RatingScope,
  rating: z.number().int(),
  /** Meilleure cote de la saison */
  peak: z.number().int(),
  /** Duels admissibles de la saison (victoires, défaites, nuls de la saison) */
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  /** Place dans le classement (null tant que le joueur n'a pas assez de duels dans la saison) */
  rank: z.number().int().nullable(),
  /** Placement en cours : moins de RATING_PROVISIONAL_GAMES duels admissibles dans la carrière */
  provisional: z.boolean(),
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
  /** false : duel sans effet sur la cote */
  counted: z.boolean(),
  /** Raison d'un duel non compté : limite contre ce même adversaire, ou abandon avant la fin de la première manche */
  reason: z.enum(["PAIR_LIMIT", "EARLY_FORFEIT"]).nullable(),
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

/** Saison compétitive en cours (dates gérées dans l'administration ; null entre deux saisons) */
export const RatingSeasonDto = z.object({ key: z.string(), name: z.string(), startsAt: z.string(), endsAt: z.string() });
export type RatingSeasonDto = z.infer<typeof RatingSeasonDto>;

export const RatingBoardDto = z.object({
  scope: RatingScope,
  season: RatingSeasonDto.nullable(),
  entries: z.array(RatingEntryDto),
  me: RatingDto.nullable(),
});
export type RatingBoardDto = z.infer<typeof RatingBoardDto>;

/** Variation de cote d'un duel, pour l'écran de fin du duel */
export const DuelRatingDto = z.object({
  scope: RatingScope, before: z.number().int(), after: z.number().int(), delta: z.number().int(), counted: z.boolean(),
  reason: z.enum(["PAIR_LIMIT", "EARLY_FORFEIT"]).nullable(),
});
export type DuelRatingDto = z.infer<typeof DuelRatingDto>;

// ---------- Archives des saisons ----------

/** Résultat d'un joueur à la fin d'une saison, pour un périmètre */
export const SeasonResultDto = z.object({
  scope: RatingScope,
  rating: z.number().int(),
  peak: z.number().int(),
  tier: RatingTierKey,
  /** Place finale (null : pas assez de duels pour être classé) */
  placement: z.number().int().nullable(),
  games: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  draws: z.number().int(),
  /** Cote de départ de la saison suivante */
  resetTo: z.number().int(),
});
export type SeasonResultDto = z.infer<typeof SeasonResultDto>;

export const ArchivedSeasonDto = z.object({ key: z.string(), name: z.string(), startsAt: z.string(), endsAt: z.string(), closedAt: z.string() });
export type ArchivedSeasonDto = z.infer<typeof ArchivedSeasonDto>;

export const RatingSeasonsDto = z.object({
  current: RatingSeasonDto.nullable(),
  /** Saisons terminées et archivées, de la plus récente à la plus ancienne */
  past: z.array(ArchivedSeasonDto),
  /** Résultats du joueur connecté, par saison archivée */
  mine: z.array(z.object({ season: z.string(), results: z.array(SeasonResultDto) })),
});
export type RatingSeasonsDto = z.infer<typeof RatingSeasonsDto>;

export const SeasonArchiveDto = z.object({
  season: ArchivedSeasonDto,
  scope: RatingScope,
  entries: z.array(z.object({
    placement: z.number().int(), userId: z.string().uuid(), displayName: z.string(), avatarUrl: z.string().nullable(),
    rating: z.number().int(), tier: RatingTierKey, games: z.number().int(), wins: z.number().int(),
  })),
  me: SeasonResultDto.nullable(),
});
export type SeasonArchiveDto = z.infer<typeof SeasonArchiveDto>;
