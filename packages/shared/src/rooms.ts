/**
 * Salons privés : partie entre amis jusqu'à 8 joueurs.
 * Seul le joueur qui crée le salon doit être VIP ; les invités rejoignent, jouent et consultent les résultats gratuitement.
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

// ---------- Entrées ----------

/** Création d'un salon. Objet strict : aucun champ supplémentaire (statut VIP, score…) n'est accepté du client. */
export const CreateRoomInput = z
  .object({
    game: GameSlug,
    rounds: z.coerce.number().int().refine((n) => (ROOM_ROUND_CHOICES as readonly number[]).includes(n), "Nombre de manches non proposé.").default(ROOM_DEFAULT_ROUNDS),
    roundSec: z.coerce.number().int().refine((n) => (ROOM_TIME_CHOICES as readonly number[]).includes(n), "Temps de réponse non proposé.").default(ROOM_DEFAULT_TIME),
    /** Mort subite en cas d'égalité en tête */
    suddenDeath: z.boolean().default(false),
    /** Mode Confiance : chaque réponse engage 1 à 3 jetons virtuels */
    confidence: z.boolean().default(false),
    /** Duel par équipes : 2 (2 contre 2) ou 3 (3 contre 3) ; 0 = chacun pour soi */
    teamSize: z.union([z.literal(0), z.literal(2), z.literal(3)]).default(0),
    /** Mode Intrus (chacun pour soi, sans mises) */
    impostor: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !v.impostor || (v.teamSize === 0 && !v.confidence), { message: "Le mode Intrus se joue chacun pour soi, sans mises.", path: ["impostor"] });
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
  /** Mode Confiance : bénéfice net en jetons sur les manches terminées (null hors mode Confiance) */
  tokensNet: z.number().int().nullable(),
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
  answers: z.array(z.object({
    userId: z.string().uuid(), rank: RoomRankRef, score: z.number().int(),
    /** Mode Confiance : jetons engagés et rendus (null sans mise) */
    stake: z.number().int().nullable(), payout: z.number().int().nullable(),
  })),
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
  game: z.object({ slug: z.string(), name: z.string() }),
  rounds: z.number().int(),
  roundSec: z.number().int(),
  maxPlayers: z.number().int(),
  suddenDeath: z.boolean(),
  confidence: z.boolean(),
  /** Duel par équipes : joueurs par équipe (null = chacun pour soi) */
  teamSize: z.number().int().nullable(),
  impostor: z.boolean(),
  /** Duel par équipes : total et place de chaque équipe */
  teams: z.array(z.object({ team: z.number().int(), name: z.string(), score: z.number().int(), placement: z.number().int().nullable(), players: z.number().int() })),
  /** Solde de jetons du joueur connecté (mode Confiance) */
  myTokens: z.number().int(),
  /** Mise du joueur connecté sur la manche en cours, une fois sa réponse envoyée */
  myStake: z.number().int().nullable(),
  /** Manches de mort subite jouées */
  suddenDeathRounds: z.number().int(),
  /** Comment la première place a été attribuée (partie terminée) */
  decidedBy: z.enum(["POINTS", "SUDDEN_DEATH", "SPEED", "SHARED", "FORFEIT"]).nullable(),
  isHost: z.boolean(),
  /** Le joueur connecté a quitté la partie (il peut encore voir les résultats) */
  left: z.boolean(),
  canStart: z.boolean(),
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
  confidence: z.boolean(),
  teamSize: z.number().int().nullable(),
  impostor: z.boolean(),
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
  game: z.object({ slug: z.string(), name: z.string() }),
  host: z.string(),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  /** Place du joueur connecté (partie terminée) */
  placement: z.number().int().nullable(),
  createdAt: z.string(),
});
export type RoomSummaryDto = z.infer<typeof RoomSummaryDto>;

export const RoomInviteDto = z.object({
  roomId: z.string().uuid(),
  code: z.string(),
  from: z.string(),
  game: z.object({ slug: z.string(), name: z.string() }),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  createdAt: z.string(),
});
export type RoomInviteDto = z.infer<typeof RoomInviteDto>;

export const RoomsOverviewDto = z.object({
  /** Le joueur peut créer un salon (droit VIP vérifié par le serveur) */
  canHost: z.boolean(),
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
] as const;

// ---------- Jetons virtuels ----------

export const TokenReason = z.enum(["WELCOME", "DAILY_REFILL", "STAKE", "PAYOUT"]);
export type TokenReason = z.infer<typeof TokenReason>;
export const TOKEN_REASON_LABEL: Record<TokenReason, string> = {
  WELCOME: "Solde de départ",
  DAILY_REFILL: "Recharge quotidienne",
  STAKE: "Mise",
  PAYOUT: "Gain",
};

export const TokensDto = z.object({
  balance: z.number().int(),
  /** La recharge quotidienne est disponible (solde sous le seuil, pas encore utilisée aujourd'hui) */
  canRefill: z.boolean(),
  refillTo: z.number().int(),
  /** Bénéfice net du jour et plafond */
  profitToday: z.number().int(),
  dailyProfitCap: z.number().int(),
  history: z.array(z.object({
    id: z.string().uuid(),
    delta: z.number().int(),
    balanceAfter: z.number().int(),
    reason: TokenReason,
    roomCode: z.string().nullable(),
    round: z.number().int().nullable(),
    createdAt: z.string(),
  })),
});
export type TokensDto = z.infer<typeof TokensDto>;
