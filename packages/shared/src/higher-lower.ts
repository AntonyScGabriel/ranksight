/**
 * Plus haut / Plus bas : un clip est affiché avec son rang, le joueur dit si le rang du clip suivant est
 * plus haut ou plus bas. Une erreur termine la série ; deux clips de même rang ne sont jamais comparés.
 */
import { z } from "zod";
import { GameSlug, RankDto } from "./schemas.js";

/** Séries gratuites par jour (jour UTC) ; illimitées pour les joueurs VIP */
export const HIGHER_LOWER_FREE_RUNS = 3;

export const HigherLowerChoice = z.enum(["higher", "lower"]);
export type HigherLowerChoice = z.infer<typeof HigherLowerChoice>;

export const StartHigherLowerInput = z.object({ game: GameSlug }).strict();
export type StartHigherLowerInput = z.infer<typeof StartHigherLowerInput>;

export const AnswerHigherLowerInput = z
  .object({
    /** Question à laquelle le joueur répond : empêche qu'une même réponse soit comptée deux fois */
    round: z.number().int().min(1),
    choice: HigherLowerChoice,
  })
  .strict();
export type AnswerHigherLowerInput = z.infer<typeof AnswerHigherLowerInput>;

/** Bonne réponse ? (les paires de même rang sont exclues du tirage) */
export function higherLowerCorrect(currentOrder: number, nextOrder: number, choice: HigherLowerChoice): boolean {
  return choice === "higher" ? nextOrder > currentOrder : nextOrder < currentOrder;
}

const ClipView = z.object({
  id: z.string().uuid(),
  videoUrl: z.string(),
  posterUrl: z.string().nullable(),
  durationSec: z.number(),
});

export const HigherLowerRunDto = z.object({
  id: z.string().uuid(),
  game: z.object({ slug: z.string(), name: z.string() }),
  status: z.enum(["ACTIVE", "ENDED"]),
  endReason: z.enum(["WRONG", "COMPLETE", "ABANDONED"]).nullable(),
  score: z.number().int(),
  round: z.number().int(),
  /** Clip affiché, avec son rang */
  current: ClipView.extend({ rank: RankDto }),
  /** Clip à comparer : jamais son rang tant que la série est en cours */
  next: ClipView.nullable(),
  /** Rangs du jeu, du plus bas au plus haut (aide à la comparaison) */
  ranks: z.array(RankDto),
  best: z.number().int(),
  startedAt: z.string(),
});
export type HigherLowerRunDto = z.infer<typeof HigherLowerRunDto>;

export const HigherLowerAnswerDto = z.object({
  correct: z.boolean(),
  /** Rang du clip comparé, dévoilé après la réponse */
  revealed: RankDto,
  /** Nouveau record personnel */
  record: z.boolean(),
  run: HigherLowerRunDto,
});
export type HigherLowerAnswerDto = z.infer<typeof HigherLowerAnswerDto>;

export const HigherLowerOverviewDto = z.object({
  /** null = illimité (VIP) */
  freeRunsLeft: z.number().int().nullable(),
  freeRunsPerDay: z.number().int(),
  vip: z.boolean(),
  best: z.number().int(),
  active: HigherLowerRunDto.nullable(),
  recent: z.array(z.object({ id: z.string().uuid(), game: z.string(), score: z.number().int(), startedAt: z.string() })),
});
export type HigherLowerOverviewDto = z.infer<typeof HigherLowerOverviewDto>;

export const HIGHER_LOWER_RULES = [
  "Le premier clip est affiché avec son rang.",
  "Regarde le clip suivant et dis si son rang est plus haut ou plus bas.",
  "Bonne réponse : il devient le clip de référence et la série continue. Une erreur termine la série.",
  "Deux clips du même rang ne sont jamais comparés.",
  `${HIGHER_LOWER_FREE_RUNS} séries gratuites par jour, illimitées avec le VIP. Pas de classement public : seul ton record compte.`,
] as const;
