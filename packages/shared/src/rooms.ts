/**
 * Salons personnalisés (jusqu'à 8 joueurs), toujours non classés : ils ne modifient jamais la cote compétitive.
 * - Public : visible dans la liste des salons et rejoignable sans invitation tant qu'il reste de la place. Création gratuite.
 * - Privé : absent des listes, rejoignable seulement avec le code ou une invitation. Création réservée aux joueurs VIP.
 * Rejoindre, jouer et consulter les résultats est toujours gratuit.
 */
import { z } from "zod";
import { FlairDto } from "./rewards.js";
import { GameSlug } from "./schemas.js";

export const ROOM_MAX_PLAYERS = 8;
export const ROOM_MIN_PLAYERS = 2;
/** Nombres de manches proposés à l'hôte */
export const ROOM_ROUND_CHOICES = [3, 5, 7, 10] as const;
/** Temps de réponse proposés à l'hôte (secondes) */
export const ROOM_TIME_CHOICES = [20, 30, 45, 60] as const;
export const ROOM_DEFAULT_ROUNDS = 5;
export const ROOM_DEFAULT_TIME = 30;
/** Compte à rebours avant la 1re manche, puis pause d'affichage des réponses entre deux manches */
export const ROOM_COUNTDOWN_SEC = 5;
export const ROOM_REVEAL_SEC = 8;
/** Une salle d'attente non lancée se ferme toute seule au bout d'une heure */
export const ROOM_LOBBY_TTL_MIN = 60;

/** Code d'invitation : 8 caractères parmi 31 (sans 0/O, 1/I/L), soit environ 40 bits d'aléa */
export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Code saisi par un joueur (minuscules, espaces, tirets acceptés) → code canonique, ou null s'il ne peut pas être valide */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return code;
}

/** Affichage du code en deux groupes de 4 (ex. « K7QM-2XPA ») */
export const formatRoomCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Durée d'une manche : le temps choisi par l'hôte, et toujours de quoi regarder le clip en entier (sa durée + 10 s) */
export const roomRoundSec = (clipDurationSec: number, roundSec: number) => Math.max(roundSec, Math.ceil(clipDurationSec) + 10);

/**
 * Places finales à partir des scores : classement « sportif » (deux premiers ex aequo → 1, 1, 3).
 * Les joueurs à égalité partagent la même place.
 */
export function placements<T extends { id: string; score: number }>(players: T[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const out = new Map<string, number>();
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    out.set(p.id, previous && previous.score === p.score ? out.get(previous.id)! : i + 1);
  });
  return out;
}

// ---------- Visibilité et modes ----------

export const RoomVisibility = z.enum(["PUBLIC", "PRIVATE"]);
export type RoomVisibility = z.infer<typeof RoomVisibility>;
export const ROOM_VISIBILITY_LABEL: Record<RoomVisibility, string> = { PUBLIC: "Public", PRIVATE: "Privé" };
export const ROOM_VISIBILITY_HINT: Record<RoomVisibility, string> = {
  PUBLIC: "Visible dans la liste des salons : n'importe quel joueur peut le rejoindre tant qu'il reste de la place.",
  PRIVATE: "Invisible dans les listes : seuls tes amis invités et les joueurs qui ont le code peuvent entrer.",
};

/** Mode de jeu d'un salon (déduit de ses paramètres) : sert aux filtres et à « Jouer maintenant » */
export const RoomMode = z.enum(["CLASSIC", "TEAMS_2", "TEAMS_3", "IMPOSTOR"]);
export type RoomMode = z.infer<typeof RoomMode>;
export const ROOM_MODES = RoomMode.options;
export const ROOM_MODE_LABEL: Record<RoomMode, string> = {
  CLASSIC: "Chacun pour soi",
  TEAMS_2: "Équipes 2 contre 2",
  TEAMS_3: "Équipes 3 contre 3",
  IMPOSTOR: "Intrus",
};
export function roomMode(room: { teamSize: number | null; impostor: boolean }): RoomMode {
  if (room.impostor) return "IMPOSTOR";
  if (room.teamSize === 2) return "TEAMS_2";
  if (room.teamSize === 3) return "TEAMS_3";
  return "CLASSIC";
}
/** Paramètres de salon correspondant à un mode */
export function modeSettings(mode: RoomMode): { teamSize: 0 | 2 | 3; impostor: boolean } {
  return mode === "IMPOSTOR" ? { teamSize: 0, impostor: true } : mode === "TEAMS_2" ? { teamSize: 2, impostor: false } : mode === "TEAMS_3" ? { teamSize: 3, impostor: false } : { teamSize: 0, impostor: false };
}

// ---------- Entrées ----------

/** Création d'un salon. Objet strict : aucun champ supplémentaire (statut VIP, score, classement…) n'est accepté du client. */
export const CreateRoomInput = z
  .object({
    game: GameSlug,
    /** Public (liste des salons, création gratuite) ou privé (code ou invitation, création VIP). Privé par défaut. */
    visibility: RoomVisibility.default("PRIVATE"),
    rounds: z.coerce.number().int().refine((n) => (ROOM_ROUND_CHOICES as readonly number[]).includes(n), "Nombre de manches non proposé.").default(ROOM_DEFAULT_ROUNDS),
    roundSec: z.coerce.number().int().refine((n) => (ROOM_TIME_CHOICES as readonly number[]).includes(n), "Temps de réponse non proposé.").default(ROOM_DEFAULT_TIME),
    /** Mort subite en cas d'égalité en tête */
    suddenDeath: z.boolean().default(false),
    /** Duel par équipes : 2 (2 contre 2) ou 3 (3 contre 3) ; 0 = chacun pour soi */
    teamSize: z.union([z.literal(0), z.literal(2), z.literal(3)]).default(0),
    /** Mode Intrus (chacun pour soi) */
    impostor: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !v.impostor || v.teamSize === 0, { message: "Le mode Intrus se joue chacun pour soi.", path: ["impostor"] });
export type CreateRoomInput = z.input<typeof CreateRoomInput>;

export const VoteInput = z.object({ targetId: z.string().uuid() }).strict();
export type VoteInput = z.infer<typeof VoteInput>;

export const JoinRoomInput = z
  .object({
    code: z.string().max(20).transform((v, ctx) => {
      const code = normalizeRoomCode(v);
      if (!code) {
        ctx.addIssue({ code: "custom", message: "Code de salon invalide : 8 caractères, lettres et chiffres." });
        return z.NEVER;
      }
      return code;
    }),
  })
  .strict();
export type JoinRoomInput = z.input<typeof JoinRoomInput>;

export const InviteToRoomInput = z.object({ userId: z.string().uuid() }).strict();

/** « Jouer maintenant » : rejoindre un salon public compatible (jeu et mode), ou en créer un si `create` */
export const QuickPlayInput = z.object({ game: GameSlug, mode: RoomMode.default("CLASSIC"), create: z.boolean().default(false) }).strict();
export type QuickPlayInput = z.input<typeof QuickPlayInput>;

/** Liste des salons publics : filtres facultatifs */
export const PublicRoomsQuery = z.object({
  game: GameSlug.optional(),
  mode: RoomMode.optional(),
  /** Seulement les salons qu'on peut rejoindre maintenant (salle d'attente avec de la place) */
  available: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});
export type PublicRoomsQuery = z.input<typeof PublicRoomsQuery>;

/** Choix d'équipe dans la salle d'attente : pour soi, ou pour un autre joueur (hôte seulement) */
export const SetRoomTeamInput = z.object({ team: z.union([z.literal(1), z.literal(2)]), userId: z.string().uuid().optional() }).strict();
export type SetRoomTeamInput = z.infer<typeof SetRoomTeamInput>;

// ---------- Réponses de l'API ----------

export const RoomStatus = z.enum(["LOBBY", "ACTIVE", "FINISHED", "CLOSED"]);
export type RoomStatus = z.infer<typeof RoomStatus>;
export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  LOBBY: "Salle d'attente",
  ACTIVE: "Partie en cours",
  FINISHED: "Terminé",
  CLOSED: "Fermé",
};

const RoomRankRef = z.object({ id: z.string().uuid(), name: z.string(), color: z.string(), order: z.number().int(), iconUrl: z.string().nullable() });

export const RoomPlayerDto = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  vip: z.boolean(),
  flair: FlairDto,
  score: z.number().int(),
  isHost: z.boolean(),
  /** A quitté la partie (garde ses points) */
  left: z.boolean(),
  /** A déjà répondu à la manche en cours (jamais sa réponse avant la fin de la manche) */
  answered: z.boolean(),
  /** Place finale, une fois la partie terminée */
  placement: z.number().int().nullable(),
  /** Dispute la mort subite (à égalité en tête) */
  finalist: z.boolean(),
  /** Duel par équipes : 1 ou 2 (null = chacun pour soi) */
  team: z.number().int().nullable(),
});
export type RoomPlayerDto = z.infer<typeof RoomPlayerDto>;

/** Manche terminée : rang réel et réponses de chaque joueur */
export const RoomRoundDto = z.object({
  position: z.number().int(),
  /** Manche décisive (mort subite) */
  suddenDeath: z.boolean(),
  /** Mode Intrus (dévoilé à la fin du vote) : l'intrus, le rang de son clip, les votes reçus et les points du vote */
  impostor: z.object({
    userId: z.string().uuid(),
    rank: RoomRankRef,
    caught: z.boolean(),
    votes: z.array(z.object({ voterId: z.string().uuid(), targetId: z.string().uuid() })),
    bonuses: z.array(z.object({ userId: z.string().uuid(), points: z.number().int() })),
  }).nullable(),
  correctRank: RoomRankRef,
  answers: z.array(z.object({ userId: z.string().uuid(), rank: RoomRankRef, score: z.number().int() })),
});
export type RoomRoundDto = z.infer<typeof RoomRoundDto>;

export const RoomLiveDto = z.object({
  round: z.number().int(),
  /** Manche décisive : seuls les finalistes répondent */
  suddenDeath: z.boolean(),
  /** Le joueur connecté répond à cette manche (toujours vrai hors mort subite, sauf s'il a quitté) */
  playing: z.boolean(),
  /** Étape de la manche : réponses, ou vote (mode Intrus) ; endsAt est la fin de l'étape */
  phase: z.enum(["ANSWER", "VOTE"]),
  /** Vote en cours : rang proposé par chaque joueur (sans le rang réel ni les points) */
  guesses: z.array(z.object({ userId: z.string().uuid(), rank: RoomRankRef })),
  /** Joueur pour qui le joueur connecté a voté (null s'il n'a pas encore voté) */
  myVote: z.string().uuid().nullable(),
  /** Joueurs qui ont déjà voté */
  voted: z.array(z.string().uuid()),
  startsAt: z.string(),
  endsAt: z.string(),
  serverNow: z.string(),
  answered: z.boolean(),
});
export type RoomLiveDto = z.infer<typeof RoomLiveDto>;

export const RoomDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  game: z.object({ slug: z.string(), name: z.string() }),
  rounds: z.number().int(),
  roundSec: z.number().int(),
  maxPlayers: z.number().int(),
  suddenDeath: z.boolean(),
  /** Duel par équipes : joueurs par équipe (null = chacun pour soi) */
  teamSize: z.number().int().nullable(),
  impostor: z.boolean(),
  /** Duel par équipes : total et place de chaque équipe */
  teams: z.array(z.object({ team: z.number().int(), name: z.string(), score: z.number().int(), placement: z.number().int().nullable(), players: z.number().int() })),
  /** Manches de mort subite jouées */
  suddenDeathRounds: z.number().int(),
  /** Comment la première place a été attribuée (partie terminée) */
  decidedBy: z.enum(["POINTS", "SUDDEN_DEATH", "SPEED", "SHARED", "FORFEIT"]).nullable(),
  isHost: z.boolean(),
  /** Match de tournoi : tournoi auquel appartient ce salon */
  tournamentId: z.string().uuid().nullable(),
  /** Le joueur connecté a quitté la partie (il peut encore voir les résultats) */
  left: z.boolean(),
  canStart: z.boolean(),
  /** Partie terminée : le joueur connecté peut proposer une revanche (hôte du salon, hors tournoi) */
  canRematch: z.boolean(),
  /** Revanche proposée : nouveau salon (mêmes réglages) que chaque joueur confirme en le rejoignant */
  rematch: z.object({ id: z.string().uuid(), code: z.string(), host: z.string(), status: RoomStatus, joined: z.boolean(), players: z.number().int(), maxPlayers: z.number().int() }).nullable(),
  players: z.array(RoomPlayerDto),
  live: RoomLiveDto.nullable(),
  /** Manches terminées (toutes une fois la partie finie) */
  details: z.array(RoomRoundDto),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string(),
});
export type RoomDto = z.infer<typeof RoomDto>;

/** Aperçu d'un salon avant de le rejoindre (par son code) */
export const RoomPreviewDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  host: z.string(),
  game: z.object({ slug: z.string(), name: z.string() }),
  rounds: z.number().int(),
  roundSec: z.number().int(),
  suddenDeath: z.boolean(),
  teamSize: z.number().int().nullable(),
  impostor: z.boolean(),
  visibility: RoomVisibility,
  mode: RoomMode,
  players: z.number().int(),
  maxPlayers: z.number().int(),
  status: RoomStatus,
  /** Le joueur connecté fait déjà partie de ce salon */
  member: z.boolean(),
});
export type RoomPreviewDto = z.infer<typeof RoomPreviewDto>;

export const RoomSummaryDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  game: z.object({ slug: z.string(), name: z.string() }),
  host: z.string(),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  /** Place du joueur connecté (partie terminée) */
  placement: z.number().int().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type RoomSummaryDto = z.infer<typeof RoomSummaryDto>;

/** Salon de la liste publique : uniquement ce qui sert à choisir (pas de code, pas de liste des joueurs) */
export const PublicRoomDto = z.object({
  id: z.string().uuid(),
  status: RoomStatus,
  mode: RoomMode,
  game: z.object({ slug: z.string(), name: z.string() }),
  host: z.string(),
  rounds: z.number().int(),
  roundSec: z.number().int(),
  suddenDeath: z.boolean(),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  /** Salle d'attente avec au moins une place libre */
  joinable: z.boolean(),
  createdAt: z.string(),
});
export type PublicRoomDto = z.infer<typeof PublicRoomDto>;

/** Résultat de « Jouer maintenant » : le salon rejoint ou créé, ou null si aucun salon compatible n'est ouvert */
export const QuickPlayResultDto = z.object({ room: RoomDto.nullable(), created: z.boolean() });
export type QuickPlayResultDto = z.infer<typeof QuickPlayResultDto>;

/** Historique des salons personnalisés et statistiques (sans lien avec la cote compétitive) */
export const RoomHistoryDto = z.object({
  stats: z.object({
    played: z.number().int(),
    wins: z.number().int(),
    podiums: z.number().int(),
    byMode: z.array(z.object({ mode: RoomMode, played: z.number().int(), wins: z.number().int() })),
  }),
  items: z.array(RoomSummaryDto),
  nextCursor: z.string().nullable(),
});
export type RoomHistoryDto = z.infer<typeof RoomHistoryDto>;

export const RoomInviteDto = z.object({
  roomId: z.string().uuid(),
  /** Invitation à la revanche d'une partie jouée ensemble */
  rematch: z.boolean(),
  code: z.string(),
  from: z.string(),
  game: z.object({ slug: z.string(), name: z.string() }),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  createdAt: z.string(),
});
export type RoomInviteDto = z.infer<typeof RoomInviteDto>;

export const RoomsOverviewDto = z.object({
  /** Le joueur peut créer un salon privé (droit VIP vérifié par le serveur) ; un salon public est ouvert à tous */
  canHostPrivate: z.boolean(),
  /** Salon en attente ou en cours dont le joueur fait partie */
  current: RoomSummaryDto.nullable(),
  invites: z.array(RoomInviteDto),
  recent: z.array(RoomSummaryDto),
});
export type RoomsOverviewDto = z.infer<typeof RoomsOverviewDto>;

/** Événements Socket.IO (namespace /ws/chat, salle de chaque joueur) : un salon a changé / invitation reçue */
export const ROOM_EVENT = "room:update";
export const ROOM_INVITE_EVENT = "room:invite";

/** Règles affichées avant le lancement */
export const ROOM_RULES = [
  "Tout le monde voit le même clip en même temps.",
  "Choisis le rang avant la fin du chrono : 100 points pour le rang exact, 20 à un rang près, 5 à deux rangs près.",
  "Les réponses et le rang réel sont dévoilés à la fin de chaque manche.",
  "Le total le plus élevé gagne ; en cas d'égalité, la place est partagée.",
  "Partie personnalisée : elle rapporte de l'XP mais ne change jamais ta cote compétitive.",
] as const;
