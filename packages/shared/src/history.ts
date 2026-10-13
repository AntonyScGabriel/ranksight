/**
 * Historique d'un joueur dans l'administration (enquête en cas de suspicion de triche) :
 * parties, records et statistiques, journal d'audit et indicateurs explicables.
 */
import { z } from "zod";
import { GameSlug } from "./schemas.js";

export const GameMode = z.enum(["DAILY", "INFINITE", "VERSUS", "EXCLUSIVE"]);
export type GameMode = z.infer<typeof GameMode>;
export const GAME_MODE_LABEL: Record<GameMode, string> = {
  DAILY: "Défi du jour",
  INFINITE: "Infini",
  VERSUS: "Duel",
  EXCLUSIVE: "Mode VIP",
};

/** Résultat d'une réponse : rang exact, proche (1 ou 2 rangs d'écart, des points quand même) ou manqué (0 point) */
export const GuessResult = z.enum(["exact", "close", "miss"]);
export type GuessResult = z.infer<typeof GuessResult>;
export const GUESS_RESULT_LABEL: Record<GuessResult, string> = { exact: "Exact", close: "Proche", miss: "Manqué" };
export const guessResultOf = (distance: number): GuessResult => (distance === 0 ? "exact" : distance <= 2 ? "close" : "miss");

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");

/** Filtres de l'historique des parties (pagination côté serveur) */
export const PlayerHistoryQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    game: GameSlug.optional(),
    mode: GameMode.optional(),
    result: GuessResult.optional(),
    /** Réponses précises (identifiants séparés par des virgules, 50 au maximum) : celles citées par un indicateur */
    ids: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.string().uuid("Identifiant de réponse invalide.")).max(50).optional()),
    /** Période, bornes incluses (jours UTC) */
    from: Day.optional(),
    to: Day.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "La date de début doit précéder la date de fin.", path: ["from"] });
export type PlayerHistoryQuery = z.input<typeof PlayerHistoryQuery>;

export const PLAYER_HISTORY_PAGE_SIZE = 50;

/**
 * Seuils des indicateurs (aide à l'enquête, jamais de sanction automatique). Un clip dure au moins 5 secondes :
 * un rang exact donné en moins de 1,5 seconde après la remise du clip est inhabituel.
 */
export const SUSPICION_THRESHOLDS = {
  /** Réponse exacte reçue moins de 1,5 s après la remise du clip (mesure du serveur) */
  fastResponseMs: 1500,
  /** Temps de visionnage déclaré par l'application inférieur à 1 s */
  shortWatchMs: 1000,
  /** Part de réponses exactes très rapides au-delà de laquelle l'indicateur s'allume (sur au moins 5 réponses exactes) */
  fastShare: 0.25,
  minFastExact: 5,
  /** Taux de rangs exacts : au moins 30 réponses, au moins 50 % et au moins le double de la moyenne des autres joueurs */
  minGuessesForAccuracy: 30,
  accuracyFloor: 0.5,
  accuracyFactor: 2,
  /** Réponses dans une même heure : 120 = une toutes les 30 secondes pendant une heure entière */
  answersPerHour: 120,
  /** Deux réponses au même clip à moins de 2 secondes d'écart : double envoi */
  duplicateWindowMs: 2000,
} as const;

type RankRef = { name: string; color: string };

/** Anomalies propres à une réponse (codes expliqués par HISTORY_FLAG_LABEL) */
export const HistoryFlag = z.enum(["SCORE_RULE", "DISTANCE_RULE", "XP_RULE", "FAST_EXACT", "SHORT_WATCH_EXACT", "DAILY_OTHER_DAY"]);
export type HistoryFlag = z.infer<typeof HistoryFlag>;
export const HISTORY_FLAG_LABEL: Record<HistoryFlag, string> = {
  SCORE_RULE: "Score différent du barème pour cet écart",
  DISTANCE_RULE: "Écart différent de la position actuelle des rangs (rang du clip ou échelle modifiés depuis ?)",
  XP_RULE: "XP supérieure au maximum possible pour ce score (série + VIP)",
  FAST_EXACT: "Rang exact donné très vite après la remise du clip (mesure du serveur)",
  SHORT_WATCH_EXACT: "Rang exact avec un temps de visionnage déclaré très court",
  DAILY_OTHER_DAY: "Défi du jour répondu un autre jour que celui du défi",
};

export interface PlayerHistoryItemDto {
  /** Identifiant de la réponse (tentative) */
  id: string;
  createdAt: string;
  mode: GameMode;
  game: { slug: string; name: string };
  /** Partie à laquelle appartient la réponse */
  context:
    | { kind: "daily"; challengeId: string; date: string; slot: number }
    | { kind: "infinite"; runId: string; runScore: number; ended: boolean }
    | { kind: "versus"; matchId: string; status: string; outcome: "WIN" | "LOSS" | "DRAW" | null }
    | { kind: "other" };
  clip: { id: string; inGamePseudo: string | null; deleted: boolean; rank: RankRef };
  guessedRank: RankRef;
  distance: number;
  result: GuessResult;
  score: number;
  xpGained: number;
  /** Temps de visionnage déclaré par l'application */
  watchedMs: number;
  /** Temps de réponse mesuré par le serveur (null pour les réponses enregistrées avant cette mesure) */
  responseMs: number | null;
  /** false = réponse antérieure à une remise à zéro des statistiques (ne compte plus) */
  counted: boolean;
  flags: HistoryFlag[];
}

export interface PlayerHistoryDto {
  items: PlayerHistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
  statsResetAt: string | null;
}

export interface GuessAggregateDto {
  guesses: number;
  exact: number;
  close: number;
  miss: number;
  totalScore: number;
  avgScore: number;
  avgDistance: number;
  /** Part de rangs exacts (0 à 1) */
  accuracy: number;
}

export interface PlayerStatsDto {
  user: {
    id: string;
    displayName: string;
    username: string;
    role: string;
    status: string;
    createdAt: string;
    statsResetAt: string | null;
    lastPlayedAt: string | null;
  };
  /** Compteurs enregistrés sur le compte (ceux affichés au joueur) */
  stored: {
    xp: number;
    level: number;
    totalGuesses: number;
    exactGuesses: number;
    dailyStreak: number;
    bestDailyStreak: number;
    winStreak: number;
    bestWinStreak: number;
    infiniteBest: number;
  };
  /** Toutes les réponses enregistrées, et celles qui comptent (depuis la dernière remise à zéro) */
  allTime: GuessAggregateDto;
  counted: GuessAggregateDto;
  byMode: (GuessAggregateDto & { mode: GameMode })[];
  byGame: (GuessAggregateDto & { slug: string; name: string })[];
  /** Parties jouées et terminées, par mode */
  sessions: {
    daily: { challenges: number; days: number; bestDayScore: number; bestDay: string | null };
    /** Terminée = 3 vies perdues (seules ces parties comptent pour le record) ; abandonnée = remplacée par une nouvelle partie */
    infinite: { started: number; finished: number; abandoned: number; bestScore: number; avgScore: number; bestClips: number };
    versus: { played: number; finished: number; wins: number; losses: number; draws: number; forfeits: number; bestScore: number };
  };
  /** Meilleures places en fin de saison (classement général archivé) */
  seasons: { season: string; position: number; score: number }[];
  /** Évolution par semaine (lundi, UTC) sur les 26 dernières semaines jouées */
  weekly: { week: string; guesses: number; avgScore: number; accuracy: number }[];
}

export interface PlayerAuditEntryDto {
  id: string;
  createdAt: string;
  /** null = action du système */
  actor: { id: string; displayName: string } | null;
  /** Le joueur est l'auteur de l'action (ex. activation de sa double authentification) */
  byPlayer: boolean;
  action: string;
  /** Libellé lisible de l'action */
  label: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  metadata: unknown;
  /** Adresse IP de l'auteur : présente seulement pour le fondateur */
  ip?: string | null;
}

export interface PlayerAuditDto {
  items: PlayerAuditEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export const IndicatorStatus = z.enum(["ok", "info", "warning", "alert"]);
export type IndicatorStatus = z.infer<typeof IndicatorStatus>;
export const INDICATOR_STATUS_LABEL: Record<IndicatorStatus, string> = {
  ok: "Rien à signaler",
  info: "Pour information",
  warning: "À vérifier",
  alert: "Incohérence",
};

/**
 * Indicateur explicable : ce qui a été vérifié, le résultat chiffré et, si besoin, les réponses en cause.
 * Un indicateur aide à enquêter ; il ne déclenche aucune sanction.
 */
export interface PlayerIndicatorDto {
  code: string;
  title: string;
  status: IndicatorStatus;
  /** Ce qui a été vérifié et comment */
  rule: string;
  /** Résultat pour ce joueur, avec les chiffres */
  finding: string;
  /** Écarts détaillés (valeur enregistrée / valeur recalculée…) */
  details: string[];
  /** Réponses concernées (identifiants), 20 au maximum */
  guessIds: string[];
}

export interface PlayerIndicatorsDto {
  generatedAt: string;
  indicators: PlayerIndicatorDto[];
}

/** Libellés des actions du journal d'audit liées à un joueur */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "user.update": "Rôle ou statut du compte modifié",
  "user.reset_stats": "Statistiques remises à zéro",
  "user.verify_email": "Email confirmé par l'équipe",
  "user.delete": "Compte supprimé",
  "user.mute": "Chat coupé",
  "user.unmute": "Chat rétabli",
  "user.avatar_remove": "Photo de profil retirée",
  "mfa.enable": "Double authentification activée",
  "mfa.disable": "Double authentification désactivée",
  "mfa.reset": "Double authentification retirée par l'équipe",
  "mfa.recovery_code": "Code de secours utilisé",
  "vip.grant": "VIP offert",
  "vip.revoke": "VIP retiré",
  "vip.refund": "Achat VIP remboursé",
  "gift_code.redeem": "Code cadeau utilisé",
  "cosmetic.grant": "Récompense attribuée",
  "cosmetic.revoke": "Récompense retirée",
  "chat.purge": "Messages du chat supprimés",
  "chat.delete": "Message du chat supprimé",
  "player_report.resolve": "Signalement traité",
  "clip.approve": "Clip accepté",
  "clip.reject": "Clip refusé",
  "suggestion.review": "Suggestion traitée",
  "suggestion.delete": "Suggestion supprimée",
  "record.infinite": "Nouveau record en mode Infini",
};

/** Libellés des valeurs « avant / après » du journal */
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  role: "Rôle",
  status: "Statut",
  xp: "XP",
  level: "Niveau",
  totalGuesses: "Réponses",
  exactGuesses: "Rangs exacts",
  dailyStreak: "Série de jours",
  bestDailyStreak: "Record de série de jours",
  winStreak: "Série de victoires",
  bestWinStreak: "Record de série de victoires",
  infiniteBest: "Record Infini",
  statsResetAt: "Remise à zéro",
  chatMutedUntil: "Chat coupé jusqu'au",
  vipUntil: "VIP jusqu'au",
};
