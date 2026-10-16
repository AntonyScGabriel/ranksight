import { z } from "zod";
import { CosmeticRefDto, FlairDto } from "./rewards.js";

/** Contrats d'API partagés (validation côté client et serveur, typage des réponses). */

// ---------- Rôles ----------

export const ROLES = ["USER", "REVIEWER", "MODERATOR", "ADMIN", "OWNER"] as const;
export const UserRole = z.enum(ROLES);
export type UserRole = z.infer<typeof UserRole>;
/** Rôles attribuables depuis l'administration (le grade de fondateur se donne uniquement sur le serveur) */
export const ASSIGNABLE_ROLES = ["USER", "REVIEWER", "MODERATOR", "ADMIN"] as const satisfies readonly UserRole[];
export const ROLE_LABEL: Record<UserRole, string> = {
  USER: "Joueur",
  REVIEWER: "Trieur de clips",
  MODERATOR: "Modérateur",
  ADMIN: "Administrateur",
  OWNER: "Fondateur",
};
/** Libellé court affiché à côté du pseudo dans le chat */
export const ROLE_TAG: Partial<Record<UserRole, string>> = { MODERATOR: "Modo", ADMIN: "Admin", OWNER: "Fondateur" };
/** Hiérarchie : fondateur ⊃ administrateur ⊃ modérateur ⊃ trieur de clips ⊃ joueur */
export const ROLE_LEVEL: Record<UserRole, number> = { USER: 0, REVIEWER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
export const hasRole = (role: string | null | undefined, min: UserRole) => !!role && role in ROLE_LEVEL && ROLE_LEVEL[role as UserRole] >= ROLE_LEVEL[min];
/** Équipe de modération (chat, joueurs, clips) : le trieur de clips n'en fait pas partie, il est joueur partout ailleurs */
export const isStaffRole = (role: string | null | undefined) => hasRole(role, "MODERATOR");
/** Administrateur ou fondateur */
export const isAdminRole = (role: string | null | undefined) => hasRole(role, "ADMIN");

/** Les 4 jeux disponibles, dans l'ordre d'affichage. */
export const GAME_SLUGS = ["lol", "valorant", "rocket-league", "cs2"] as const;
export const GameSlug = z.enum(GAME_SLUGS);
export type GameSlug = z.infer<typeof GameSlug>;

export const GAME_NAMES: Record<GameSlug, string> = {
  lol: "League of Legends",
  valorant: "Valorant",
  "rocket-league": "Rocket League",
  cs2: "Counter-Strike 2",
};

export const RankDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tier: z.string(),
  division: z.number().int().nullable(),
  order: z.number().int(),
  /** Image du rang envoyée depuis l'administration (adresse relative à l'API : resolveMediaUrl) ; null = emblème par défaut */
  iconUrl: z.string().nullable(),
  color: z.string(),
});
export type RankDto = z.infer<typeof RankDto>;

export const GameDto = z.object({
  id: z.string().uuid(),
  slug: GameSlug,
  name: z.string(),
  iconUrl: z.string().url().nullable(),
  ranks: z.array(RankDto),
});
export type GameDto = z.infer<typeof GameDto>;

/** Un clip tel qu'envoyé au joueur AVANT sa réponse : jamais de rang réel. */
export const PlayableClipDto = z.object({
  id: z.string().uuid(),
  playToken: z.string(),
  game: GameDto.omit({ ranks: true }),
  ranks: z.array(RankDto),
  /** Absolue (stockage S3/R2) ou relative à l'API (/v1/storage/…) : utiliser resolveMediaUrl() */
  videoUrl: z.string(),
  posterUrl: z.string().nullable(),
  durationSec: z.number(),
  mode: z.enum(["DAILY", "INFINITE", "VERSUS", "ROOM"]),
  dailyDate: z.string().nullable(),
  difficulty: z.number().int().min(1).max(5),
});
export type PlayableClipDto = z.infer<typeof PlayableClipDto>;

export const SubmitGuessInput = z.object({
  playToken: z.string().min(10),
  rankId: z.string().uuid(),
  watchedMs: z.number().int().min(0).max(120_000),
  /** Salon en mode Confiance : jetons engagés sur cette réponse (1 à 3 ; 0 seulement avec un solde vide) */
  stake: z.number().int().min(0).max(3).optional(),
});
export type SubmitGuessInput = z.infer<typeof SubmitGuessInput>;

export const GuessResultDto = z.object({
  guessId: z.string().uuid(),
  correctRank: RankDto,
  guessedRank: RankDto,
  distance: z.number().int(),
  score: z.number().int(),
  xpGained: z.number().int(),
  level: z.number().int(),
  dailyStreak: z.number().int(),
  /** Réponses exactes consécutives après cette réponse */
  winStreak: z.number().int(),
  communityDistribution: z.record(z.string(), z.number()),
  /** Le bonus d'XP VIP a été appliqué à cette réponse */
  vipBoost: z.boolean(),
  /** Joueur filmé, révélé seulement après la réponse (avant, il permettrait de chercher son rang) */
  clipPlayer: z.object({ inGamePseudo: z.string(), platform: z.string().nullable(), region: z.string().nullable() }).nullable(),
  unlockedAchievements: z.array(z.object({ code: z.string(), name: z.string(), iconUrl: z.string().nullable() })),
  /** Titres, badges ou cadres débloqués par cette réponse (palier de niveau, succès) */
  unlockedRewards: z.array(CosmeticRefDto),
});
export type GuessResultDto = z.infer<typeof GuessResultDto>;

/** Réponse enregistrée pendant un duel ou un salon : rien n'est dévoilé (rang réel, score) avant la fin de la manche */
export const LiveGuessAckDto = z.object({
  guessId: z.string().uuid(),
  pending: z.literal(true),
  live: z.object({ position: z.number().int(), rounds: z.number().int() }),
});
export type LiveGuessAckDto = z.infer<typeof LiveGuessAckDto>;

// ---------- Défis du jour (3 par jeu) ----------

/** Nombre de défis par jeu et par jour (chacun avec son propre clip) */
export const DAILY_PER_GAME = 3;

export const DailyStatus = z.enum(["AVAILABLE", "PLAYED", "UNAVAILABLE"]);
export type DailyStatus = z.infer<typeof DailyStatus>;

export const DAILY_STATUS_LABEL: Record<DailyStatus, string> = {
  AVAILABLE: "Défi disponible",
  PLAYED: "Terminé",
  UNAVAILABLE: "Bientôt disponible",
};

export const DailyResultDto = z.object({
  score: z.number().int(),
  distance: z.number().int(),
  guessedRank: z.object({ name: z.string(), color: z.string() }),
  correctRank: z.object({ name: z.string(), color: z.string() }),
});
export type DailyResultDto = z.infer<typeof DailyResultDto>;

/** Un des défis du jour d'un jeu (n° 1 à DAILY_PER_GAME) */
export const DailyChallengeDto = z.object({
  slot: z.number().int(),
  status: DailyStatus,
  /** Renseigné quand le défi est terminé */
  result: DailyResultDto.nullable(),
});
export type DailyChallengeDto = z.infer<typeof DailyChallengeDto>;

export const DailyGameDto = z.object({
  game: z.object({ id: z.string().uuid(), slug: GameSlug, name: z.string(), iconUrl: z.string().nullable(), accent: z.string() }),
  /** État d'ensemble : disponible tant qu'il reste un défi à jouer, terminé quand tous sont joués */
  status: DailyStatus,
  /** Dernier résultat du jeu (compatibilité avec les anciennes versions de l'application) */
  result: DailyResultDto.nullable(),
  /** Les défis du jour de ce jeu */
  challenges: z.array(DailyChallengeDto),
  /** Score cumulé sur les défis du jour de ce jeu */
  score: z.number().int(),
});
export type DailyGameDto = z.infer<typeof DailyGameDto>;

export const DailyOverviewDto = z.object({
  date: z.string(),
  games: z.array(DailyGameDto),
  /** Somme des scores du jour (100 points au maximum par défi) */
  totalScore: z.number().int(),
  played: z.number().int(),
  /** Nombre de défis proposés aujourd'hui (tous jeux confondus) */
  total: z.number().int(),
  dailyStreak: z.number().int(),
});
export type DailyOverviewDto = z.infer<typeof DailyOverviewDto>;

// ---------- Classements ----------

export const LeaderboardScope = z.enum(["global", "friends"]);
export type LeaderboardScope = z.infer<typeof LeaderboardScope>;
/** "season" = saison mensuelle (1er au dernier jour du mois, heure UTC) */
export const LeaderboardPeriod = z.enum(["daily", "weekly", "season", "all_time", "infinite"]);
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriod>;
/** Filtre par jeu des classements journalier, hebdomadaire et général ("all" = les 4 jeux cumulés) */
export const LeaderboardGame = z.union([z.literal("all"), GameSlug]);
export type LeaderboardGame = z.infer<typeof LeaderboardGame>;

export const LeaderboardEntryDto = z.object({
  rank: z.number().int(),
  userId: z.string().uuid(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
  score: z.number(),
  vip: z.boolean(),
  flair: FlairDto,
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDto>;

/**
 * Clé de saison : identifiant stable utilisé dans les classements, les archives et les adresses
 * (« 2026-10 » pour les premières saisons mensuelles, « saison-1 », « saison-2 »… ensuite).
 */
export const SeasonKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Saison invalide");

/** Récompenses de fin de saison : nom et couleur de chaque titre ou badge créé à la clôture */
export const SeasonRewardDef = z.object({
  name: z.string().trim().min(2, "Nom de récompense trop court.").max(40, "40 caractères maximum."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #RRGGBB."),
});
export type SeasonRewardDef = z.infer<typeof SeasonRewardDef>;
export const SEASON_REWARD_SLOTS = ["champion", "podium", "top10", "contributor"] as const;
export type SeasonRewardSlot = (typeof SEASON_REWARD_SLOTS)[number];
export const SEASON_REWARD_LABEL: Record<SeasonRewardSlot, string> = {
  champion: "Titre du 1er",
  podium: "Titre du top 3",
  top10: "Badge du top 10",
  contributor: "Titre du meilleur contributeur",
};
export const SeasonRewards = z.object({
  champion: SeasonRewardDef,
  podium: SeasonRewardDef,
  top10: SeasonRewardDef,
  contributor: SeasonRewardDef,
});
export type SeasonRewards = z.infer<typeof SeasonRewards>;

/** Récompenses proposées par défaut pour une nouvelle saison, d'après son nom */
export function defaultSeasonRewards(name: string): SeasonRewards {
  // « Saison 1 » → « Champion saison 1 » ; « Tournoi d'été » → « Champion Tournoi d'été »
  const label = name.trim().replace(/^saison\b/i, "saison");
  return {
    champion: { name: `Champion ${label}`.slice(0, 40), color: "#FACC15" },
    podium: { name: `Podium ${label}`.slice(0, 40), color: "#E5E7EB" },
    top10: { name: `Top 10 ${label}`.slice(0, 40), color: "#A78BFA" },
    contributor: { name: `Contributeur ${label}`.slice(0, 40), color: "#34D399" },
  };
}

export const SeasonStatus = z.enum(["upcoming", "current", "to_close", "closed"]);
export type SeasonStatus = z.infer<typeof SeasonStatus>;
export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  upcoming: "À venir",
  current: "En cours",
  to_close: "À clôturer",
  closed: "Clôturée",
};

export const SeasonDto = z.object({
  key: z.string(),
  /** Numéro affiché (Saison 1, 2…) ; null = saison hors numérotation (bêta, événement) */
  number: z.number().int().nullable(),
  /** « Saison bêta », « Saison 1 »… */
  name: z.string(),
  /** Libellé affiché (le nom) */
  label: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  current: z.boolean(),
  upcoming: z.boolean(),
  closed: z.boolean(),
  /** Récompenses attribuées à la clôture ; null = saison sans récompense */
  rewards: SeasonRewards.nullable(),
});
export type SeasonDto = z.infer<typeof SeasonDto>;

/** Création ou modification d'une saison par l'équipe (dates en ISO 8601) */
export const SeasonInput = z
  .object({
    name: z.string().trim().min(3, "Nom trop court.").max(60, "60 caractères maximum."),
    number: z.number().int().min(1).max(999).nullable(),
    startsAt: z.string().datetime({ offset: true, message: "Date de début invalide." }),
    endsAt: z.string().datetime({ offset: true, message: "Date de fin invalide." }),
    rewardsEnabled: z.boolean(),
    rewards: SeasonRewards,
  })
  .refine((s) => new Date(s.startsAt) < new Date(s.endsAt), { message: "La fin doit être après le début.", path: ["endsAt"] });
export type SeasonInput = z.input<typeof SeasonInput>;

export const AdminSeasonDto = SeasonDto.extend({
  status: SeasonStatus,
  rewardsEnabled: z.boolean(),
  /** Récompenses configurées (même désactivées) */
  rewardsConfig: SeasonRewards,
  players: z.number().int(),
  top: z.array(z.object({ rank: z.number().int(), userId: z.string(), username: z.string(), score: z.number() })),
  closedAt: z.string().nullable(),
});
export type AdminSeasonDto = z.infer<typeof AdminSeasonDto>;

/** Classement des contributeurs : saison (AAAA-MM) ou "all" (depuis le lancement) */
export const ContributorsPeriod = z.union([z.literal("all"), SeasonKey]);
export type ContributorsPeriod = z.infer<typeof ContributorsPeriod>;

/**
 * Classement des contributeurs : nombre de clips proposés par chaque joueur et acceptés par l'équipe
 * (pendant la saison, d'après la date d'acceptation). À égalité, le premier à atteindre ce nombre passe devant.
 * Le premier de chaque saison reçoit le titre « Contributeur saison N » à la clôture.
 */
export const ContributorsBoardDto = z.object({
  entries: z.array(LeaderboardEntryDto),
  me: z.object({ rank: z.number().int(), score: z.number() }).nullable(),
  /** Titre promis au premier de la saison (null pour le classement depuis le lancement) */
  reward: z.string().nullable(),
});
export type ContributorsBoardDto = z.infer<typeof ContributorsBoardDto>;

// ---------- Succès ----------

export const ACHIEVEMENT_CATEGORIES = ["PROGRESSION", "ACCURACY", "STREAK", "GAME_EXPERT", "VERSUS", "SOCIAL", "SEASON", "SECRET"] as const;
export const AchievementCategory = z.enum(ACHIEVEMENT_CATEGORIES);
export type AchievementCategory = z.infer<typeof AchievementCategory>;

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  PROGRESSION: "Progression",
  ACCURACY: "Précision",
  STREAK: "Régularité",
  GAME_EXPERT: "Experts",
  VERSUS: "Duels",
  SOCIAL: "Communauté",
  SEASON: "Saisons",
  SECRET: "Secrets",
};

export const AchievementDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  iconUrl: z.string().nullable(),
  category: AchievementCategory,
  xpReward: z.number().int(),
  hidden: z.boolean(),
  unlockedAt: z.string().nullable(),
  /** Avancement vers le succès (null pour les succès attribués en fin de saison ou secrets non débloqués) */
  progress: z.object({ current: z.number(), target: z.number() }).nullable(),
  /** Part des joueurs qui l'ont débloqué (0 → 1) */
  rarity: z.number(),
});
export type AchievementDto = z.infer<typeof AchievementDto>;

export const AchievementsOverviewDto = z.object({
  unlocked: z.number().int(),
  total: z.number().int(),
  winStreak: z.number().int(),
  bestWinStreak: z.number().int(),
  items: z.array(AchievementDto),
});
export type AchievementsOverviewDto = z.infer<typeof AchievementsOverviewDto>;

// ---------- Signalements ----------

export const ReportReason = z.enum(["WRONG_RANK", "INAPPROPRIATE", "LOW_QUALITY", "SPOILER_UI", "COPYRIGHT", "OTHER"]);
export type ReportReason = z.infer<typeof ReportReason>;
export const CLIP_REPORT_REASON_LABEL: Record<ReportReason, string> = {
  WRONG_RANK: "Rang annoncé faux",
  INAPPROPRIATE: "Contenu inapproprié",
  LOW_QUALITY: "Mauvaise qualité",
  SPOILER_UI: "Rang visible à l'écran",
  COPYRIGHT: "Droits d'auteur",
  OTHER: "Autre",
};
export const CreateReportInput = z.object({
  clipId: z.string().uuid(),
  reason: ReportReason,
  details: z.string().max(500).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportInput>;

// ---------- Clips proposés par les joueurs ----------

/** Durée d'un clip : de 5 secondes à 1 minute (petite tolérance sur la durée lue dans le fichier) */
export const CLIP_MIN_SEC = 5;
export const CLIP_MAX_SEC = 60;
export const CLIP_DURATION_LABEL = "5 secondes à 1 minute";
export const clipDurationOk = (sec: number) => sec >= CLIP_MIN_SEC - 0.3 && sec <= CLIP_MAX_SEC + 0.5;
/** Taille maximale d'une vidéo envoyée (1 minute en 1080p) ; elle est ensuite compressée en 720p */
export const CLIP_MAX_MB = 150;
export const CLIP_MAX_BYTES = CLIP_MAX_MB * 1024 * 1024;

export const UploadContentType = z.enum(["video/mp4", "video/webm"]);
export const UploadUrlInput = z.object({
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive().max(CLIP_MAX_BYTES, `La vidéo dépasse ${CLIP_MAX_MB} Mo.`),
});
export type UploadUrlInput = z.infer<typeof UploadUrlInput>;

export const PLATFORMS = ["PC", "PLAYSTATION", "XBOX", "SWITCH"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;
export const PLATFORM_LABEL: Record<Platform, string> = {
  PC: "PC",
  PLAYSTATION: "PlayStation",
  XBOX: "Xbox",
  SWITCH: "Nintendo Switch",
};
/** Plateformes possibles par jeu (Rocket League est le seul jeu multiplateforme du catalogue) */
export const GAME_PLATFORMS: Record<GameSlug, readonly Platform[]> = {
  lol: ["PC"],
  valorant: ["PC", "PLAYSTATION", "XBOX"],
  "rocket-league": ["PC", "PLAYSTATION", "XBOX", "SWITCH"],
  cs2: ["PC"],
};

export const REGIONS = ["EUROPE", "NORTH_AMERICA", "SOUTH_AMERICA", "ASIA", "OCEANIA", "MIDDLE_EAST", "AFRICA"] as const;
export const Region = z.enum(REGIONS);
export type Region = z.infer<typeof Region>;
export const REGION_LABEL: Record<Region, string> = {
  EUROPE: "Europe",
  NORTH_AMERICA: "Amérique du Nord",
  SOUTH_AMERICA: "Amérique du Sud",
  ASIA: "Asie",
  OCEANIA: "Océanie",
  MIDDLE_EAST: "Moyen-Orient",
  AFRICA: "Afrique",
};

/**
 * Pseudo en jeu du joueur filmé (Riot ID, nom Steam, Epic…) : distinct du pseudo RankGuess.
 * Espaces, # et caractères accentués acceptés ; caractères invisibles et balises refusés.
 */
export const InGamePseudo = z
  .string({ message: "Le pseudo en jeu est obligatoire." })
  .trim()
  .min(2, "Le pseudo en jeu est obligatoire (2 caractères minimum).")
  .max(32, "Le pseudo en jeu fait 32 caractères au maximum.")
  .regex(/^[^\p{C}<>]+$/u, "Le pseudo en jeu contient des caractères non autorisés.");

export const SubmitClipInput = z.object({
  gameId: z.string().uuid(),
  rankId: z.string().uuid(),
  inGamePseudo: InGamePseudo,
  platform: Platform.optional(),
  region: Region.optional(),
  storageKey: z.string().regex(/^raw\/[0-9a-f-]{36}\.(mp4|webm)$/),
  durationSec: z.number().min(CLIP_MIN_SEC - 0.3, `Le clip doit durer de ${CLIP_DURATION_LABEL}.`).max(CLIP_MAX_SEC + 0.5, `Le clip doit durer de ${CLIP_DURATION_LABEL}.`),
  proofUrl: z.string().url().max(500).optional(),
  note: z.string().max(300).optional(),
  ownsRights: z.literal(true, { message: "Tu dois être l'auteur du clip ou avoir l'accord de son auteur." }),
});
export type SubmitClipInput = z.infer<typeof SubmitClipInput>;

/** Statut vu par le joueur : les états internes (traitement, archivage) n'apparaissent pas. */
export const SubmissionStatus = z.enum(["PENDING", "ACCEPTED", "REJECTED"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  PENDING: "En attente",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
};

export const MyClipDto = z.object({
  id: z.string().uuid(),
  game: z.object({ slug: z.string(), name: z.string() }),
  rank: z.object({ name: z.string(), color: z.string() }),
  inGamePseudo: z.string().nullable(),
  platform: z.string().nullable(),
  region: z.string().nullable(),
  status: SubmissionStatus,
  rejectionReason: z.string().nullable(),
  timesPlayed: z.number().int(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  previewUrl: z.string().nullable(),
});
export type MyClipDto = z.infer<typeof MyClipDto>;

// ---------- Amis ----------

export const UserSummaryDto = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  level: z.number().int(),
  flair: FlairDto,
});
export type UserSummaryDto = z.infer<typeof UserSummaryDto>;

export const FriendRelation = z.enum(["none", "friends", "request_sent", "request_received", "self"]);
export type FriendRelation = z.infer<typeof FriendRelation>;

export const UserSearchResultDto = UserSummaryDto.extend({ relation: FriendRelation });
export type UserSearchResultDto = z.infer<typeof UserSearchResultDto>;

export const FriendRequestsDto = z.object({
  received: z.array(UserSummaryDto.extend({ requestedAt: z.string() })),
  sent: z.array(UserSummaryDto.extend({ requestedAt: z.string() })),
});
export type FriendRequestsDto = z.infer<typeof FriendRequestsDto>;

// ---------- Messagerie ----------

export const SendMessageInput = z.object({
  body: z.string().trim().min(1, "Message vide").max(1000, "1000 caractères maximum"),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export const ChatMessageDto = z.object({
  id: z.string().uuid(),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDto>;

export const ConversationDto = z.object({
  friend: UserSummaryDto,
  lastMessage: ChatMessageDto.nullable(),
  unread: z.number().int(),
});
export type ConversationDto = z.infer<typeof ConversationDto>;

/** Événements Socket.IO de la messagerie (namespace /ws/chat). */
export const CHAT_EVENTS = {
  message: "chat:message",
  read: "chat:read",
  typing: "chat:typing",
} as const;

// ---------- Chat global ----------

export const GLOBAL_MESSAGE_MAX = 500;

export const SendGlobalMessageInput = z.object({
  body: z.string().trim().min(1, "Message vide").max(GLOBAL_MESSAGE_MAX, `${GLOBAL_MESSAGE_MAX} caractères maximum`),
});
export type SendGlobalMessageInput = z.infer<typeof SendGlobalMessageInput>;

export const GlobalMessageDto = z.object({
  id: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  author: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    role: UserRole,
    vip: z.boolean(),
    flair: FlairDto,
  }),
});
export type GlobalMessageDto = z.infer<typeof GlobalMessageDto>;

/** Événements Socket.IO du chat global (namespace /ws/chat, salle "global"). */
export const GLOBAL_CHAT_EVENTS = {
  join: "global:join",
  leave: "global:leave",
  message: "global:message",
  deleted: "global:deleted",
  /** Réglages du chat changés par la modération (mode lent) */
  settings: "global:settings",
} as const;

// ---------- Authentification ----------

/** Pseudo RankGuess : unique (sans tenir compte des majuscules), visible dans les classements et le chat. */
/** Lettres de toutes les langues (accents compris), chiffres, _ - et . (pas d'espace : le pseudo reste un seul mot) */
const PSEUDO_PATTERN = /^[\p{L}\p{M}\p{N}_.-]{3,20}$/u;
export const PSEUDO_RULE = "3 à 20 caractères : lettres (accents compris), chiffres, _ - ou .";
export const Pseudo = z
  .string()
  .trim()
  .transform((s) => s.normalize("NFC"))
  .pipe(
    z
      .string()
      .regex(PSEUDO_PATTERN, `Le pseudo doit contenir ${PSEUDO_RULE}`)
      .regex(/[\p{L}\p{N}]/u, "Le pseudo doit contenir au moins une lettre ou un chiffre."),
  );

/**
 * Clé d'unicité d'un pseudo : sans accents ni majuscules. « Éric » et « eric » désignent donc le même compte : impossible
 * d'imiter un joueur en ajoutant un accent.
 */
export const pseudoKey = (pseudo: string) => pseudo.trim().normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC").toLowerCase();

export const Email = z.string().trim().toLowerCase().max(254).email("Adresse email invalide.");

export const Password = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .max(128, "Le mot de passe fait 128 caractères au maximum.")
  .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre.")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre.");

const ClientKind = z.enum(["web", "mobile"]).default("web");

/** Version des CGU et de la politique de confidentialité : la changer redemande l'acceptation à tous les joueurs. */
export const TERMS_VERSION = "2026-10-07";
/** Âge minimum pour s'inscrire (majorité numérique en France pour consentir seul au traitement de ses données) */
export const MIN_AGE = 15;

export const SignupInput = z
  .object({
    pseudo: Pseudo,
    email: Email,
    password: Password,
    passwordConfirm: z.string(),
    /** Case « J'ai 15 ans ou plus et j'accepte les CGU et la politique de confidentialité » */
    acceptTerms: z.literal(true, { error: `Tu dois avoir ${MIN_AGE} ans ou plus et accepter les conditions d'utilisation.` }),
    client: ClientKind,
  })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Les mots de passe ne correspondent pas." });
export type SignupInput = z.input<typeof SignupInput>;

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1, "Mot de passe requis.").max(128),
  client: ClientKind,
});
export type LoginInput = z.input<typeof LoginInput>;

export const ForgotPasswordInput = z.object({ email: Email });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z
  .object({ token: z.string().min(20).max(200), password: Password, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Les mots de passe ne correspondent pas." });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** Première erreur lisible d'une validation Zod (affichage dans les formulaires). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides.";
}

export const AuthTokensDto = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type AuthTokensDto = z.infer<typeof AuthTokensDto>;

/** Messages affichés quand aucun clip n'est disponible. */
export const NO_CLIP_MESSAGES = {
  title: "Aucun défi disponible pour le moment.",
  subtitle: "De nouveaux clips arrivent bientôt.",
} as const;

/**
 * Les vidéos stockées en local sont servies par l'API avec une adresse relative (/v1/storage/…),
 * ce qui fonctionne quelle que soit l'adresse utilisée pour joindre l'API (localhost, IP du réseau…).
 */
const AVATAR_PATH = /\/v1\/avatars\/([A-Za-z0-9-]+\.webp)$/;

export function resolveMediaUrl(url: string, apiBaseUrl: string): string {
  // Photo de profil servie par l'API : toujours rattachée à l'adresse de l'API qu'utilise ce client
  // (une adresse enregistrée avec un autre domaine, ex. localhost, reste affichable depuis un téléphone)
  const avatar = AVATAR_PATH.exec(url);
  if (avatar) return `${apiBaseUrl.replace(/\/+$/, "")}/avatars/${avatar[1]}`;
  if (/^https?:\/\//.test(url)) return url;
  return new URL(url, new URL(apiBaseUrl).origin).toString();
}

// ---------- Boutique VIP ----------

/** Bonus d'XP des joueurs VIP : +50 % sur chaque réponse */
export const VIP_XP_MULTIPLIER = 1.5;

/**
 * Passes VIP. `priceCents` est le prix normal ; `promoPriceCents` le prix pendant la promo du moment (soldes, lancement,
 * événement…), appliqué tant que la promo est active (page « Boutique » de l'administration).
 */
export const VIP_PRODUCTS = [
  { id: "vip_1m", name: "VIP 1 mois", days: 30, priceCents: 499, promoPriceCents: 249, highlight: null },
  { id: "vip_3m", name: "VIP 3 mois", days: 90, priceCents: 1299, promoPriceCents: 649, highlight: "−13 %" },
  { id: "vip_12m", name: "VIP 12 mois", days: 365, priceCents: 3999, promoPriceCents: 1999, highlight: "−33 %" },
] as const;

/** Prix payé pour un pass, selon qu'une promo est en cours ou non */
export const vipPriceCents = (p: { priceCents: number; promoPriceCents: number }, promoRunning: boolean) =>
  promoRunning ? p.promoPriceCents : p.priceCents;
export type VipProductId = (typeof VIP_PRODUCTS)[number]["id"];
export const VipProductId = z.enum(["vip_1m", "vip_3m", "vip_12m"]);

/**
 * Promo du moment : réutilisable à chaque événement (lancement, Noël, anniversaire du site…). Nom affiché aux joueurs,
 * date de fin facultative (la promo s'arrête toute seule).
 */
export const ShopPromo = z.object({
  active: z.boolean(),
  label: z.string().trim().min(3, "Nom de la promo trop court.").max(40, "Nom de la promo trop long (40 caractères)."),
  endsAt: z.string().datetime({ offset: true }).nullable(),
});
export type ShopPromo = z.infer<typeof ShopPromo>;
export const DEFAULT_SHOP_PROMO: ShopPromo = { active: true, label: "Offre de lancement", endsAt: null };

/** Promo active et pas encore terminée */
export const isPromoRunning = (promo: ShopPromo, now = new Date()) => promo.active && (!promo.endsAt || new Date(promo.endsAt) > now);

/** Promo telle que montrée aux joueurs (null : pas de promo en cours) */
export const PromoInfoDto = z.object({ label: z.string(), endsAt: z.string().nullable() }).nullable();
export type PromoInfoDto = z.infer<typeof PromoInfoDto>;

/**
 * Pass VIP tel que réglé dans l'administration (page « Boutique »). Les identifiants restent fixes : ce sont aussi ceux
 * des produits Google Play. Les prix Google Play se règlent séparément dans la Play Console.
 */
export const ShopProduct = z
  .object({
    id: VipProductId,
    name: z.string().trim().min(3, "Nom trop court.").max(40, "Nom trop long (40 caractères)."),
    days: z.number().int().min(1, "Au moins 1 jour.").max(3650, "10 ans maximum."),
    /** Prix normal, en centimes TTC */
    priceCents: z.number().int().min(50, "Prix minimum : 0,50 €.").max(100_000, "Prix maximum : 1 000 €."),
    /** Prix pendant la promo du moment, en centimes TTC */
    promoPriceCents: z.number().int().min(50, "Prix minimum : 0,50 €.").max(100_000, "Prix maximum : 1 000 €."),
    /** Étiquette affichée sur l'offre (ex. « −13 % », « Le plus choisi ») */
    highlight: z.string().trim().max(20, "Étiquette trop longue (20 caractères).").nullable(),
    /** Pass proposé à l'achat */
    active: z.boolean(),
  })
  .refine((p) => p.promoPriceCents <= p.priceCents, { message: "Le prix promo ne peut pas dépasser le prix normal.", path: ["promoPriceCents"] });
export type ShopProduct = z.infer<typeof ShopProduct>;

/** Catalogue par défaut (avant tout réglage dans l'administration) */
export const DEFAULT_SHOP_PRODUCTS: ShopProduct[] = VIP_PRODUCTS.map((p) => ({ ...p, active: true }));

export const ShopSettingsInput = z.object({
  promo: ShopPromo,
  products: z
    .array(ShopProduct)
    .length(VIP_PRODUCTS.length)
    .refine((list) => new Set(list.map((p) => p.id)).size === list.length, "Chaque pass doit apparaître une fois.")
    .refine((list) => list.some((p) => p.active), "Garde au moins un pass en vente.")
    .optional(),
});
export type ShopSettingsInput = z.infer<typeof ShopSettingsInput>;

export const ShopSettingsDto = z.object({ promo: ShopPromo, products: z.array(ShopProduct) });
export type ShopSettingsDto = z.infer<typeof ShopSettingsDto>;

/** Prix publics (conditions générales de vente) */
export const ShopCatalogDto = z.object({
  promo: PromoInfoDto,
  products: z.array(z.object({ id: VipProductId, name: z.string(), days: z.number(), priceCents: z.number(), promoPriceCents: z.number() })),
});
export type ShopCatalogDto = z.infer<typeof ShopCatalogDto>;

export const VIP_PERKS = [
  "+50 % d'XP sur chaque réponse (défis du jour et mode Infini)",
  "Badge VIP à côté de ton pseudo (classements, chat, profil)",
  "Création de salons privés jusqu'à 8 joueurs : tes amis rejoignent et jouent gratuitement",
  "Soutien direct au développement de RankGuess",
] as const;

export const VipStatusDto = z.object({ active: z.boolean(), until: z.string().nullable() });
export type VipStatusDto = z.infer<typeof VipStatusDto>;

export const ShopDto = z.object({
  products: z.array(z.object({
    id: VipProductId, name: z.string(), days: z.number(),
    /** Prix à payer maintenant */
    priceCents: z.number(),
    /** Prix normal (après la promo) */
    regularPriceCents: z.number(),
    highlight: z.string().nullable(),
  })),
  /** Promo en cours (nom, date de fin), ou null */
  promo: PromoInfoDto,
  /** Paiement par carte activé sur le serveur (clés Stripe renseignées) */
  paymentsEnabled: z.boolean(),
  /** Achat dans l'application Android activé sur le serveur (compte de service Google Play renseigné) */
  googlePlayEnabled: z.boolean(),
  vip: VipStatusDto,
});
export type ShopDto = z.infer<typeof ShopDto>;

export const PurchaseDto = z.object({
  id: z.string().uuid(),
  product: z.string(),
  days: z.number().int(),
  amountCents: z.number().int(),
  status: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]),
  gift: z.boolean(),
  /** Où l'achat a été fait : site (carte bancaire), application Android (Google Play) ou VIP offert */
  store: z.enum(["web", "google_play", "gift"]),
  createdAt: z.string(),
  /** Pass offert à un ami : son pseudo */
  giftTo: z.string().nullable(),
  /** Pass acheté sous forme de code cadeau : le code et s'il a déjà servi */
  giftCode: z.object({ code: z.string(), used: z.boolean() }).nullable(),
  /** VIP reçu avec un code cadeau */
  redeemedCode: z.boolean(),
  /** Pass offert par un ami : son pseudo */
  giftFrom: z.string().nullable(),
});
export type PurchaseDto = z.infer<typeof PurchaseDto>;

/** Achat Google Play à faire vérifier par le serveur (jeton remis par Google à l'application) */
export const GooglePlayPurchaseInput = z.object({
  product: VipProductId,
  purchaseToken: z.string().min(10).max(500).regex(/^[A-Za-z0-9._:-]+$/, "Jeton d'achat invalide."),
  /** Case obligatoire : accès immédiat demandé et renonciation au droit de rétractation (contenu numérique) */
  waiveWithdrawal: z.literal(true, { error: "Confirme l'accès immédiat au VIP pour continuer." }),
});
export type GooglePlayPurchaseInput = z.infer<typeof GooglePlayPurchaseInput>;

// ---------- VIP à offrir ----------

/** Achat pour soi, pour un ami (VIP ajouté directement à son compte) ou sous forme de code cadeau à transmettre */
export const GiftChoice = z.discriminatedUnion("type", [
  z.object({ type: z.literal("friend"), friendId: z.string().uuid() }),
  z.object({ type: z.literal("code") }),
]);
export type GiftChoice = z.infer<typeof GiftChoice>;

/** Code cadeau saisi par le joueur : espaces, tirets et minuscules acceptés */
export const RedeemCodeInput = z.object({
  code: z.string().trim().min(8, "Code incomplet.").max(40, "Code trop long."),
});
export type RedeemCodeInput = z.infer<typeof RedeemCodeInput>;

/** Codes créés par l'équipe (concours, créateurs de contenu…) */
export const CreateGiftCodesInput = z.object({
  count: z.number().int().min(1).max(100),
  days: z.number().int().min(1).max(3650),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export type CreateGiftCodesInput = z.input<typeof CreateGiftCodesInput>;

export const AdminGiftCodeDto = z.object({
  id: z.string().uuid(),
  code: z.string(),
  days: z.number().int(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  expiresAt: z.string().nullable(),
  disabled: z.boolean(),
  /** Acheté par un joueur (pseudo) ou créé par l'équipe */
  boughtBy: z.string().nullable(),
  createdBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminGiftCodeDto = z.infer<typeof AdminGiftCodeDto>;

export function formatPrice(cents: number) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

// ---------- Duels ----------

export const VERSUS_ROUNDS = 5;
/** Duel en direct : temps de réponse par manche, compte à rebours avant la 1re manche et pause d'affichage entre deux manches */
export const VERSUS_ROUND_SEC = 30;
/** Durée d'une manche de duel : au moins VERSUS_ROUND_SEC, et toujours la durée du clip + 10 s pour répondre */
export const versusRoundSec = (clipDurationSec: number) => Math.max(VERSUS_ROUND_SEC, Math.ceil(clipDurationSec) + 10);
export const VERSUS_COUNTDOWN_SEC = 5;
export const VERSUS_REVEAL_SEC = 6;
/** Une recherche ou une invitation reste ouverte tant que son auteur est sur la page (signal toutes les 15 s) */
export const VERSUS_WAIT_SEC = 45;
export const VERSUS_HEARTBEAT_SEC = 15;

export const VersusOpponent = z.union([z.literal("random"), z.string().uuid()]);
export const CreateVersusInput = z.object({
  /** "random" = premier joueur disponible, sinon identifiant d'un ami */
  opponent: VersusOpponent,
  game: z.union([z.literal("all"), GameSlug]).default("all"),
});
export type CreateVersusInput = z.input<typeof CreateVersusInput>;

export const VersusStatus = z.enum(["OPEN", "PENDING", "ACTIVE", "FINISHED", "DECLINED", "EXPIRED", "CANCELED"]);
export type VersusStatus = z.infer<typeof VersusStatus>;

export const VersusPlayerDto = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  vip: z.boolean(),
  score: z.number().int(),
  flair: FlairDto,
});
export type VersusPlayerDto = z.infer<typeof VersusPlayerDto>;

const VersusRankRef = z.object({ id: z.string().uuid(), name: z.string(), color: z.string(), order: z.number().int(), iconUrl: z.string().nullable() });

/** Manche terminée : réponses des deux joueurs dévoilées */
export const VersusRoundDto = z.object({
  position: z.number().int(),
  game: z.object({ slug: z.string(), name: z.string() }),
  correctRank: VersusRankRef,
  me: z.object({ rank: VersusRankRef, score: z.number().int() }).nullable(),
  opponent: z.object({ rank: VersusRankRef, score: z.number().int() }).nullable(),
});
export type VersusRoundDto = z.infer<typeof VersusRoundDto>;

/** Manche en cours d'un duel en direct (dates du serveur ; `serverNow` permet de recaler l'horloge du client) */
export const VersusLiveDto = z.object({
  round: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  serverNow: z.string(),
  answered: z.boolean(),
  opponentAnswered: z.boolean(),
});
export type VersusLiveDto = z.infer<typeof VersusLiveDto>;

export const VersusMatchDto = z.object({
  id: z.string().uuid(),
  status: VersusStatus,
  random: z.boolean(),
  game: z.object({ slug: z.string(), name: z.string() }).nullable(),
  rounds: z.number().int(),
  /** Le joueur connecté a créé le duel */
  isCreator: z.boolean(),
  me: VersusPlayerDto,
  /** null tant qu'aucun adversaire n'a rejoint un duel « au hasard » */
  opponent: VersusPlayerDto.nullable(),
  /** "me" | "opponent" | "draw" | null (pas terminé) */
  result: z.enum(["me", "opponent", "draw"]).nullable(),
  /** Abandon d'un des joueurs (le résultat est alors une victoire de l'autre) */
  forfeit: z.boolean(),
  canAccept: z.boolean(),
  canCancel: z.boolean(),
  live: VersusLiveDto.nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Manches terminées, réponses des deux joueurs comprises */
  details: z.array(VersusRoundDto),
  /** Duel au hasard terminé : variation de la cote du joueur connecté (classement compétitif) */
  rating: z.object({ scope: z.string(), before: z.number().int(), after: z.number().int(), delta: z.number().int(), counted: z.boolean() }).nullable(),
});
export type VersusMatchDto = z.infer<typeof VersusMatchDto>;

export const VersusStatsDto = z.object({ wins: z.number().int(), losses: z.number().int(), draws: z.number().int() });
export type VersusStatsDto = z.infer<typeof VersusStatsDto>;

export const VERSUS_STATUS_LABEL: Record<VersusStatus, string> = {
  OPEN: "Recherche d'un adversaire",
  PENDING: "Invitation en attente",
  ACTIVE: "En direct",
  FINISHED: "Terminé",
  DECLINED: "Refusé",
  EXPIRED: "Expiré",
  CANCELED: "Annulé",
};

/** Événement Socket.IO (namespace /ws/chat, salle de chaque joueur) : un duel a changé */
export const VERSUS_EVENT = "versus:update";

// ---------- Profil public ----------

export const PublicProfileDto = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  vip: z.boolean(),
  level: z.number().int(),
  flair: FlairDto,
  /** Titres et badges obtenus (vitrine du profil) */
  collection: z.array(CosmeticRefDto),
  createdAt: z.string(),
  stats: z.object({
    totalGuesses: z.number().int(),
    exactRate: z.number(),
    bestWinStreak: z.number().int(),
    bestDailyStreak: z.number().int(),
    infiniteBest: z.number().int(),
  }),
  versus: VersusStatsDto,
  achievements: z.array(z.object({ code: z.string(), name: z.string(), description: z.string(), category: z.string(), unlockedAt: z.string() })),
  /** null si le visiteur n'est pas connecté */
  relation: FriendRelation.nullable(),
  /** Le visiteur a bloqué ce joueur */
  blockedByMe: z.boolean(),
});
export type PublicProfileDto = z.infer<typeof PublicProfileDto>;

// ---------- Modération des joueurs ----------

export const CHAT_REPORT_REASONS = ["HARASSMENT", "HATE", "SPAM", "CHEATING", "INAPPROPRIATE_NAME", "INAPPROPRIATE_AVATAR", "OTHER"] as const;
export const ChatReportReason = z.enum(CHAT_REPORT_REASONS);
export type ChatReportReason = z.infer<typeof ChatReportReason>;
export const CHAT_REPORT_REASON_LABEL: Record<ChatReportReason, string> = {
  HARASSMENT: "Harcèlement ou insultes",
  HATE: "Propos haineux ou discriminatoires",
  SPAM: "Spam ou publicité",
  CHEATING: "Triche",
  INAPPROPRIATE_NAME: "Pseudo inapproprié",
  INAPPROPRIATE_AVATAR: "Photo de profil inappropriée",
  OTHER: "Autre",
};

export const ReportPlayerInput = z.object({
  targetUserId: z.string().uuid(),
  reason: ChatReportReason,
  details: z.string().trim().max(500).optional(),
  /** Message signalé (chat global ou message privé), facultatif */
  globalMessageId: z.string().uuid().optional(),
  directMessageId: z.string().uuid().optional(),
});
export type ReportPlayerInput = z.input<typeof ReportPlayerInput>;

// ---------- Contact ----------

export const ContactInput = z.object({
  email: Email,
  subject: z.string().trim().min(3, "Objet trop court.").max(120),
  message: z.string().trim().min(10, "Message trop court (10 caractères minimum).").max(3000),
  /** Champ invisible : rempli uniquement par les robots */
  website: z.string().max(0).optional(),
});
export type ContactInput = z.input<typeof ContactInput>;

// ---------- Double authentification ----------

export const TotpCodeInput = z.object({ code: z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/, "Code invalide.") });
export type TotpCodeInput = z.infer<typeof TotpCodeInput>;

// ---------- Tri des clips (trieurs) ----------

export const TriageDecision = z.enum(["APPROVE", "REJECT"]);
export type TriageDecision = z.infer<typeof TriageDecision>;

/** Motifs de refus proposés (le trieur peut aussi écrire le sien) */
export const TRIAGE_REJECT_REASONS = [
  "Rang visible à l'écran",
  "Pseudo visible à l'écran",
  "Rang annoncé douteux (preuve absente ou incohérente)",
  "Vidéo de mauvaise qualité ou illisible",
  "Pas assez d'action pour deviner le rang",
  "Contenu inapproprié",
  "Doublon d'un clip existant",
] as const;

export const TriageInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), note: z.string().trim().max(300).optional() }),
  z.object({ decision: z.literal("REJECT"), note: z.string().trim().min(3, "Indique la raison du refus.").max(300) }),
]);
export type TriageInput = z.infer<typeof TriageInput>;

/** Clip à trier : vidéo, rang annoncé, preuve et informations du joueur filmé (jamais l'identité de l'auteur de l'envoi) */
export const TriageClipDto = z.object({
  id: z.string().uuid(),
  game: z.object({ slug: z.string(), name: z.string() }),
  claimedRank: z.object({ id: z.string().uuid(), name: z.string(), color: z.string(), iconUrl: z.string().nullable() }),
  previewUrl: z.string().nullable(),
  durationSec: z.number(),
  proofUrl: z.string().nullable(),
  inGamePseudo: z.string().nullable(),
  platform: z.string().nullable(),
  region: z.string().nullable(),
  submitterNote: z.string().nullable(),
  createdAt: z.string(),
});
export type TriageClipDto = z.infer<typeof TriageClipDto>;

export const TriageStatsDto = z.object({
  /** Clips triés par ce trieur */
  total: z.number().int(),
  today: z.number().int(),
  /** Décision finale identique à son avis */
  confirmed: z.number().int(),
  /** Décision finale différente */
  overturned: z.number().int(),
  /** En attente de confirmation par la modération */
  awaiting: z.number().int(),
  /** Clips encore à trier (tous trieurs confondus) */
  queue: z.number().int(),
});
export type TriageStatsDto = z.infer<typeof TriageStatsDto>;

export const ReviewerStatsDto = TriageStatsDto.omit({ queue: true }).extend({
  userId: z.string().uuid(),
  displayName: z.string(),
  role: UserRole,
  lastTriageAt: z.string().nullable(),
});
export type ReviewerStatsDto = z.infer<typeof ReviewerStatsDto>;

// ---------- Suggestions des joueurs ----------

export const SuggestionCategory = z.enum(["FEATURE", "GAMEPLAY", "CONTENT", "INTERFACE", "OTHER"]);
export type SuggestionCategory = z.infer<typeof SuggestionCategory>;
export const SUGGESTION_CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  FEATURE: "Nouvelle fonctionnalité",
  GAMEPLAY: "Modes de jeu et scores",
  CONTENT: "Jeux, rangs et clips",
  INTERFACE: "Site et application",
  OTHER: "Autre",
};

export const SuggestionStatus = z.enum(["NEW", "PLANNED", "DONE", "DECLINED"]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;
export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  NEW: "En attente",
  PLANNED: "Retenue",
  DONE: "Réalisée",
  DECLINED: "Non retenue",
};

/** Nombre maximal de suggestions par joueur sur 24 heures */
export const SUGGESTIONS_PER_DAY = 5;
export const SUGGESTION_MAX_LENGTH = 1000;
export const SUGGESTION_REPLY_MAX_LENGTH = 500;

export const SuggestionInput = z.object({
  category: SuggestionCategory,
  text: z
    .string()
    .trim()
    .min(10, "Décris ton idée en quelques mots (10 caractères minimum).")
    .max(SUGGESTION_MAX_LENGTH, `${SUGGESTION_MAX_LENGTH} caractères maximum.`),
});
export type SuggestionInput = z.input<typeof SuggestionInput>;

export const SuggestionDto = z.object({
  id: z.string().uuid(),
  category: SuggestionCategory,
  text: z.string(),
  status: SuggestionStatus,
  /** Réponse de l'équipe */
  reply: z.string().nullable(),
  repliedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SuggestionDto = z.infer<typeof SuggestionDto>;

export const AdminSuggestionDto = SuggestionDto.extend({
  author: z.object({ id: z.string().uuid(), displayName: z.string(), status: z.string() }),
  repliedBy: z.string().nullable(),
});
export type AdminSuggestionDto = z.infer<typeof AdminSuggestionDto>;

export const AdminSuggestionsDto = z.object({
  items: z.array(AdminSuggestionDto),
  total: z.number().int(),
  /** Nombre de suggestions par statut (toutes catégories) */
  counts: z.record(SuggestionStatus, z.number().int()),
});
export type AdminSuggestionsDto = z.infer<typeof AdminSuggestionsDto>;

/** Traitement d'une suggestion par l'équipe : statut et réponse facultative (vide = pas de réponse) */
export const SuggestionReviewInput = z.object({
  status: SuggestionStatus,
  reply: z
    .string()
    .trim()
    .max(SUGGESTION_REPLY_MAX_LENGTH, `${SUGGESTION_REPLY_MAX_LENGTH} caractères maximum.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});
export type SuggestionReviewInput = z.input<typeof SuggestionReviewInput>;
