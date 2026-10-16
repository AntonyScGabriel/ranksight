/**
 * Tournois privés : tableau à élimination directe, chaque match se jouant dans un salon à 2 avec mort subite.
 * Seul le créateur doit être VIP ; les participants s'inscrivent, jouent et gagnent gratuitement.
 */
import { z } from "zod";
import { FlairDto } from "./rewards.js";
import { GameSlug } from "./schemas.js";
import { ROOM_ROUND_CHOICES, ROOM_TIME_CHOICES, normalizeRoomCode } from "./rooms.js";

export const TOURNAMENT_CAPACITIES = [4, 8, 16] as const;
export const TOURNAMENT_MIN_PLAYERS = 3;
/** Manches par match proposées (les matchs restent courts) */
export const TOURNAMENT_ROUND_CHOICES = [3, 5] as const;
/** Délai pour lancer un match une fois les deux adversaires connus (les deux cliquent « Je suis prêt ») */
export const TOURNAMENT_READY_MIN = 5;
/** Une inscription non lancée se ferme toute seule au bout de deux heures */
export const TOURNAMENT_LOBBY_TTL_MIN = 120;

export type TournamentDecidedBy = "POINTS" | "SUDDEN_DEATH" | "SPEED" | "SEED" | "FORFEIT" | "NO_SHOW" | "BYE";
export const TOURNAMENT_DECIDED_BY_LABEL: Record<TournamentDecidedBy, string> = {
  POINTS: "aux points",
  SUDDEN_DEATH: "en mort subite",
  SPEED: "à la rapidité",
  SEED: "à la tête de série (égalité parfaite)",
  FORFEIT: "par forfait",
  NO_SHOW: "aucun des deux présent : meilleure tête de série",
  BYE: "qualifié d'office",
};

export const TOURNAMENT_RULES = [
  "Tableau à élimination directe : le gagnant de chaque match passe au tour suivant.",
  "Les têtes de série sont tirées au sort au lancement ; s'il manque des joueurs, les meilleures têtes de série sont qualifiées d'office pour le 2e tour.",
  "Chaque match est un duel en direct sur le jeu du tournoi, avec mort subite en cas d'égalité (3 manches décisives au maximum, puis la réponse la plus rapide).",
  "Égalité parfaite (personne n'a répondu) : la meilleure tête de série passe.",
  `Dès que tes deux adversaires sont connus, vous avez ${TOURNAMENT_READY_MIN} minutes pour cliquer sur « Je suis prêt ». Le joueur absent perd par forfait ; si personne n'est prêt, la meilleure tête de série passe.`,
  "Quitter le tournoi fait perdre ton match en cours ou à venir par forfait.",
] as const;

// ---------- Tableau ----------

/** Taille du tableau : la puissance de 2 suffisante pour tous les inscrits (4 au minimum) */
export function bracketSize(players: number): number {
  let size = 4;
  while (size < players) size *= 2;
  return size;
}

/** Ordre des têtes de série dans le tableau (1 et 2 ne se rencontrent qu'en finale) : 4 → [1, 4, 2, 3] */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Nombre de tours (2 pour 4 places, 3 pour 8, 4 pour 16) */
export const stageCount = (size: number) => Math.log2(size);

/** Matchs du premier tour : paires de têtes de série ; une tête de série supérieure au nombre d'inscrits = place vide */
export function firstRoundPairs(players: number): [number | null, number | null][] {
  const order = seedOrder(bracketSize(players));
  const pairs: [number | null, number | null][] = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i]!;
    const b = order[i + 1]!;
    pairs.push([a <= players ? a : null, b <= players ? b : null]);
  }
  return pairs;
}

/** Place d'un joueur éliminé au tour `stage` (1 = premier tour) : perdant de la finale 2e, des demies 3e, etc. */
export function eliminatedPlacement(size: number, stage: number): number {
  return size / 2 ** stage + 1;
}

/** Match suivant : tour + 1, emplacement divisé par 2, et côté (1 ou 2) */
export const nextSlot = (stage: number, slot: number) => ({ stage: stage + 1, slot: Math.floor(slot / 2), side: (slot % 2 === 0 ? 1 : 2) as 1 | 2 });

export const STAGE_NAME = (size: number, stage: number) => {
  const left = stageCount(size) - stage;
  return left === 0 ? "Finale" : left === 1 ? "Demi-finales" : left === 2 ? "Quarts de finale" : "Huitièmes de finale";
};

// ---------- Entrées ----------

export const CreateTournamentInput = z
  .object({
    game: GameSlug,
    capacity: z.coerce.number().int().refine((n) => (TOURNAMENT_CAPACITIES as readonly number[]).includes(n), "Taille de tableau non proposée.").default(8),
    rounds: z.coerce.number().int().refine((n) => (TOURNAMENT_ROUND_CHOICES as readonly number[]).includes(n) && (ROOM_ROUND_CHOICES as readonly number[]).includes(n), "Nombre de manches non proposé.").default(3),
    roundSec: z.coerce.number().int().refine((n) => (ROOM_TIME_CHOICES as readonly number[]).includes(n), "Temps de réponse non proposé.").default(30),
  })
  .strict();
export type CreateTournamentInput = z.input<typeof CreateTournamentInput>;

export const JoinTournamentInput = z
  .object({
    code: z.string().max(20).transform((v, ctx) => {
      const code = normalizeRoomCode(v);
      if (!code) {
        ctx.addIssue({ code: "custom", message: "Code de tournoi invalide : 8 caractères, lettres et chiffres." });
        return z.NEVER;
      }
      return code;
    }),
  })
  .strict();

// ---------- Réponses de l'API ----------

export const TournamentStatus = z.enum(["LOBBY", "ACTIVE", "FINISHED", "CLOSED"]);
export type TournamentStatus = z.infer<typeof TournamentStatus>;
export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  LOBBY: "Inscriptions ouvertes",
  ACTIVE: "En cours",
  FINISHED: "Terminé",
  CLOSED: "Fermé",
};

export const TournamentPlayerDto = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  vip: z.boolean(),
  flair: FlairDto,
  isHost: z.boolean(),
  seed: z.number().int().nullable(),
  left: z.boolean(),
  eliminated: z.boolean(),
  placement: z.number().int().nullable(),
  /** Statistiques : matchs gagnés (hors qualifications d'office), points marqués en match */
  wins: z.number().int(),
  points: z.number().int(),
});
export type TournamentPlayerDto = z.infer<typeof TournamentPlayerDto>;

export const TournamentMatchStatus = z.enum(["WAITING", "READY", "PLAYING", "DONE"]);
export type TournamentMatchStatus = z.infer<typeof TournamentMatchStatus>;

export const TournamentMatchDto = z.object({
  id: z.string().uuid(),
  stage: z.number().int(),
  slot: z.number().int(),
  player1: z.string().uuid().nullable(),
  player2: z.string().uuid().nullable(),
  ready1: z.boolean(),
  ready2: z.boolean(),
  score1: z.number().int().nullable(),
  score2: z.number().int().nullable(),
  winnerId: z.string().uuid().nullable(),
  decidedBy: z.string().nullable(),
  /** WAITING : adversaires pas encore connus ; READY : en attente des deux « Je suis prêt » ; PLAYING : en cours ; DONE : terminé */
  status: TournamentMatchStatus,
  deadlineAt: z.string().nullable(),
  /** Salon du match, donné seulement à ses deux joueurs */
  roomId: z.string().uuid().nullable(),
});
export type TournamentMatchDto = z.infer<typeof TournamentMatchDto>;

export const TournamentDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: TournamentStatus,
  game: z.object({ slug: z.string(), name: z.string() }),
  capacity: z.number().int(),
  rounds: z.number().int(),
  roundSec: z.number().int(),
  /** Taille du tableau une fois lancé (4, 8 ou 16) */
  bracketSize: z.number().int().nullable(),
  isHost: z.boolean(),
  /** Avant le lancement : l'organisateur est parti sans inscrit VIP pour le remplacer */
  hostLeft: z.boolean(),
  /** Le joueur connecté (VIP, inscrit) peut reprendre l'organisation */
  canClaimHost: z.boolean(),
  left: z.boolean(),
  canStart: z.boolean(),
  players: z.array(TournamentPlayerDto),
  matches: z.array(TournamentMatchDto),
  /** Match en cours ou à venir du joueur connecté */
  myMatch: z.string().uuid().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string(),
  serverNow: z.string(),
});
export type TournamentDto = z.infer<typeof TournamentDto>;

export const TournamentPreviewDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  host: z.string(),
  game: z.object({ slug: z.string(), name: z.string() }),
  capacity: z.number().int(),
  rounds: z.number().int(),
  players: z.number().int(),
  status: TournamentStatus,
  member: z.boolean(),
});
export type TournamentPreviewDto = z.infer<typeof TournamentPreviewDto>;

export const TournamentSummaryDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: TournamentStatus,
  game: z.object({ slug: z.string(), name: z.string() }),
  host: z.string(),
  players: z.number().int(),
  capacity: z.number().int(),
  placement: z.number().int().nullable(),
  createdAt: z.string(),
});
export type TournamentSummaryDto = z.infer<typeof TournamentSummaryDto>;

export const TournamentsOverviewDto = z.object({
  canHost: z.boolean(),
  current: z.array(TournamentSummaryDto),
  recent: z.array(TournamentSummaryDto),
});
export type TournamentsOverviewDto = z.infer<typeof TournamentsOverviewDto>;

/** Événement Socket.IO : un tournoi du joueur a changé */
export const TOURNAMENT_EVENT = "tournament:update";
