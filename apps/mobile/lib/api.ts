import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { FileSystemUploadType, getInfoAsync, uploadAsync } from "expo-file-system/legacy";
import {
  resolveMediaUrl,
  type ChatMessageDto,
  type AchievementsOverviewDto,
  type ConversationDto,
  type DailyOverviewDto,
  type GlobalMessageDto,
  type GameChatDto,
  type GameChatMessageDto,
  type GameChatScope,
  type LeaderboardGame,
  type FriendRequestsDto,
  type GameDto,
  type GuessResultDto,
  type LeaderboardEntryDto,
  type MyClipDto,
  type PlayableClipDto,
  type PublicProfileDto,
  type UserSummaryDto,
  type ReportPlayerInput,
  type VersusMatchDto,
  type VersusStatsDto,
  type PurchaseDto,
  type ShopDto,
  type VipProductId,
  type VipStatusDto,
  type SeasonDto,
  type ContributorsBoardDto,
  type SuggestionDto,
  type SuggestionInput,
  type SubmitClipInput,
  type SubmitGuessInput,
  type UserSearchResultDto,
  type UserRole,
  type AnnouncementDto,
  type EquipFlairInput,
  type FlairDto,
  type MyRewardsDto,
  type LiveGuessAckDto,
  type CreateRoomInput,
  type RoomDto,
  type RoomPreviewDto,
  type RoomsOverviewDto,
  type PublicRoomDto,
  type QuickPlayResultDto,
  type RoomHistoryDto,
  type RoomMode,
  type CreateTournamentInput,
  type TournamentDto,
  type TournamentPreviewDto,
  type TournamentsOverviewDto,
  type MyRatingsDto,
  type RatingBoardDto,
  type RatingScope,
  type RatingSeasonsDto,
  type SeasonArchiveDto,
  type HigherLowerAnswerDto,
  type HigherLowerChoice,
  type HigherLowerOverviewDto,
  type HigherLowerRunDto,
} from "@ranksight/shared";

export const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
/**
 * Version de l'application (champ `version` de app.json, intégrée au build), envoyée à l'API dans l'en-tête
 * `X-App-Version` : elle permet de repérer les anciennes versions encore utilisées. L'API ne refuse aucune version.
 */
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
const VERSION_HEADER = { "X-App-Version": APP_VERSION };
/** Site web (pages légales, contact) */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
/** Administration (équipe) : ouverte dans le navigateur depuis le profil */
export const ADMIN_URL = (process.env.EXPO_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/+$/, "");
export const API_ORIGIN = API.replace(/\/v1\/?$/, "");
export const media = (url: string) => resolveMediaUrl(url, API);

const ACCESS = "rs_access";
const REFRESH = "rs_refresh";

/** Jetons stockés dans le Keychain (iOS) / Keystore (Android) via SecureStore. */
export const tokens = {
  get: () => Promise.all([SecureStore.getItemAsync(ACCESS), SecureStore.getItemAsync(REFRESH)]),
  access: () => SecureStore.getItemAsync(ACCESS),
  set: (a: string, r: string) => Promise.all([SecureStore.setItemAsync(ACCESS, a), SecureStore.setItemAsync(REFRESH, r)]),
  clear: () => Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]),
};

export class ApiError extends Error {
  constructor(public status: number, public code?: string, message?: string) {
    super(message ?? code ?? `HTTP ${status}`);
  }
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  role: UserRole;
  hasPassword: boolean;
  vip: VipStatusDto;
  linkedProviders: ("GOOGLE" | "DISCORD")[];
  /** Pseudos en jeu utilisés dans ses clips proposés (distincts du pseudo RankGuess) */
  inGamePseudos: { game: { slug: string; name: string }; inGamePseudo: string }[];
  xp: number;
  level: number;
  dailyStreak: number;
  bestDailyStreak: number;
  winStreak: number;
  bestWinStreak: number;
  infiniteBest: number;
  totalGuesses: number;
  exactGuesses: number;
  progress: { level: number; current: number; next: number };
  emailVerified: boolean;
  /** Compte bloqué tant que l'adresse email n'est pas confirmée (inscription par email) */
  mustVerifyEmail: boolean;
  termsAccepted: boolean;
  chatMutedUntil: string | null;
  mfaEnabled: boolean;
  /** Titre, badge et cadre équipés */
  flair: FlairDto;
  /** Récompenses obtenues depuis la dernière visite de l'écran des récompenses */
  newRewards: number;
  /** Réglages réservés au fondateur (boutique, VIP offert, annonce, stockage…) ; les administrateurs les ont s'il n'y a pas de fondateur */
  siteOwner: boolean;
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  // Mutualise les renouvellements concurrents (plusieurs requêtes en 401 en même temps)
  refreshing ??= (async () => {
    const [, r] = await tokens.get();
    if (!r) return false;
    const res = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...VERSION_HEADER },
      body: JSON.stringify({ refreshToken: r, client: "mobile" }),
    }).catch(() => null);
    if (!res?.ok) {
      if (res && res.status === 401) await tokens.clear();
      return false;
    }
    const t = await res.json();
    await tokens.set(t.accessToken, t.refreshToken);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const access = await tokens.access();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...VERSION_HEADER, ...(access ? { Authorization: `Bearer ${access}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Connexion au serveur impossible. Vérifie ta connexion internet.");
  }
  if (res.status === 401 && retry && (await refresh())) return request<T>(path, init, false);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const message = typeof b?.message === "string" ? b.message : b?.message?.message;
    throw new ApiError(res.status, b?.code ?? b?.message?.code, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const del = (path: string) => request<void>(path, { method: "DELETE" });
/** Routes d'authentification : un 401 signifie « identifiants refusés », pas « session expirée » */
const authPost = <T = void>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }, false);
type Tokens = { accessToken: string; refreshToken: string };

export const api = {
  // Session
  providers: () => request<{ google: boolean; discord: boolean; password: boolean }>("/auth/providers"),
  exchange: async (code: string) => {
    const t = await post<{ accessToken: string; refreshToken: string }>("/auth/exchange", { code });
    await tokens.set(t.accessToken, t.refreshToken);
  },
  login: async (email: string, password: string) => {
    const t = await authPost<Tokens>("/auth/login", { email, password, client: "mobile" });
    await tokens.set(t.accessToken, t.refreshToken);
  },
  signup: async (body: { pseudo: string; email: string; password: string; passwordConfirm: string; acceptTerms: boolean }) => {
    const t = await authPost<Tokens>("/auth/signup", { ...body, client: "mobile" });
    await tokens.set(t.accessToken, t.refreshToken);
  },
  forgotPassword: (email: string) => authPost("/auth/password/forgot", { email }),
  logout: async () => {
    const [, r] = await tokens.get();
    await fetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", ...VERSION_HEADER }, body: JSON.stringify({ refreshToken: r }) }).catch(() => undefined);
    await tokens.clear();
  },
  me: () => request<Me>("/users/me"),
  resendVerification: () => post<{ sent: boolean }>("/auth/email/resend"),
  changeEmail: (email: string, password: string) => post<{ sent: boolean }>("/auth/email/change", { email, password }),
  acceptTerms: () => post<void>("/users/me/terms", { accept: true }),
  logoutAll: async () => {
    await post<void>("/auth/logout-all").catch(() => undefined);
    await tokens.clear();
  },
  blocks: () => request<{ id: string; displayName: string; avatarUrl: string | null; blockedAt: string }[]>("/users/me/blocks"),
  block: (userId: string) => post<void>(`/users/${userId}/block`),
  unblock: (userId: string) => del(`/users/${userId}/block`),
  reportPlayer: (body: ReportPlayerInput) => post<void>("/reports/players", body),
  deleteAccount: async (confirm: string) => {
    await request<void>("/users/me", { method: "DELETE", body: JSON.stringify({ confirm }) });
    await tokens.clear();
  },
  updatePseudo: (pseudo: string) => request<{ displayName: string }>("/users/me", { method: "PATCH", body: JSON.stringify({ pseudo }) }),
  registerPush: (token: string, platform: "IOS" | "ANDROID") => post("/users/me/push-tokens", { token, platform }),

  // Jeu
  games: () => request<GameDto[]>("/games"),
  dailyOverview: () => request<DailyOverviewDto>("/play/daily"),
  /** Défi du jour n° `slot` d'un jeu (sans numéro : le premier pas encore joué) */
  daily: (game: string, slot?: number) =>
    request<PlayableClipDto & { slot: number }>(`/play/daily/${encodeURIComponent(game)}${slot ? `?slot=${slot}` : ""}`),
  startRun: () => post<{ id: string; lives: number }>("/play/infinite/runs"),
  nextInfinite: (runId: string) => request<PlayableClipDto>(`/play/infinite/runs/${runId}/next`),
  guess: (b: SubmitGuessInput) => post<GuessResultDto & { run?: { lives: number; score: number; endedAt: string | null } }>("/guesses", b),
  /** Réponse pendant un duel ou un salon : enregistrée sans rien dévoiler avant la fin de la manche */
  liveGuess: (b: SubmitGuessInput) => post<LiveGuessAckDto>("/guesses", b),
  report: (clipId: string) => post("/reports", { clipId, reason: "WRONG_RANK" }),
  leaderboard: (period: string, scope: string, game: LeaderboardGame = "all", season?: string) =>
    request<{ entries: LeaderboardEntryDto[]; me: { rank: number; score: number } | null }>(
      `/leaderboards?period=${period}&scope=${scope}&game=${game}${season ? `&season=${season}` : ""}`,
    ),
  seasons: () => request<SeasonDto[]>("/leaderboards/seasons"),
  contributors: (scope: string, season?: string) =>
    request<ContributorsBoardDto>(`/leaderboards/contributors?scope=${scope}&limit=50${season ? `&season=${season}` : ""}`),
  achievements: () => request<AchievementsOverviewDto>("/achievements/me"),
  leaderboardKeys: (game: LeaderboardGame = "all") => request<Record<string, string>>(`/leaderboards/keys?game=${game}`),

  // Clips proposés
  uploadUrl: (contentType: string, sizeBytes: number) => post<{ key: string; url: string }>("/clips/upload-url", { contentType, sizeBytes }),
  submitClip: (body: SubmitClipInput) => post<MyClipDto>("/clips", body),
  myClips: () => request<MyClipDto[]>("/clips/mine"),
  withdrawClip: (id: string) => del(`/clips/mine/${id}`),
  // Suggestions
  suggest: (body: SuggestionInput) => post<SuggestionDto>("/suggestions", body),
  mySuggestions: () => request<SuggestionDto[]>("/suggestions/me"),
  withdrawSuggestion: (id: string) => del(`/suggestions/${id}`),

  // Profils publics
  profile: (userId: string) => request<PublicProfileDto>(`/users/${userId}/profile`),

  // Duels
  versusList: () => request<{ matches: VersusMatchDto[]; stats: VersusStatsDto }>("/versus"),
  versus: (id: string) => request<VersusMatchDto>(`/versus/${id}`),
  createVersus: (opponent: string, game: string) => post<VersusMatchDto>("/versus", { opponent, game }),
  versusNext: (id: string) =>
    request<PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string }>(`/versus/${id}/next`),
  versusWait: (id: string) => post<VersusMatchDto>(`/versus/${id}/wait`),
  forfeitVersus: (id: string) => post(`/versus/${id}/forfeit`),
  acceptVersus: (id: string) => post<VersusMatchDto>(`/versus/${id}/accept`),
  declineVersus: (id: string) => post(`/versus/${id}/decline`),
  cancelVersus: (id: string) => del(`/versus/${id}`),

  // Plus haut / Plus bas
  higherLower: () => request<HigherLowerOverviewDto>("/higher-lower"),
  startHigherLower: (game: string) => post<HigherLowerRunDto>("/higher-lower/runs", { game }),
  higherLowerRun: (id: string) => request<HigherLowerRunDto>(`/higher-lower/runs/${id}`),
  answerHigherLower: (id: string, round: number, choice: HigherLowerChoice) =>
    post<HigherLowerAnswerDto>(`/higher-lower/runs/${id}/answer`, { round, choice }),

  // Classement compétitif
  ratingBoard: (scope: RatingScope) => request<RatingBoardDto>(`/ratings/leaderboard?scope=${scope}`),
  myRatings: () => request<MyRatingsDto>("/ratings/me"),
  ratingSeasons: () => request<RatingSeasonsDto>("/ratings/seasons"),
  ratingArchive: (key: string, scope: RatingScope) => request<SeasonArchiveDto>(`/ratings/seasons/${encodeURIComponent(key)}?scope=${scope}`),

  // Tournois privés
  tournaments: () => request<TournamentsOverviewDto>("/tournaments"),
  tournament: (id: string) => request<TournamentDto>(`/tournaments/${id}`),
  createTournament: (body: CreateTournamentInput) => post<TournamentDto>("/tournaments", body),
  tournamentPreview: (code: string) => request<TournamentPreviewDto>(`/tournaments/code/${encodeURIComponent(code)}`),
  joinTournament: (code: string) => post<TournamentDto>("/tournaments/join", { code }),
  startTournament: (id: string) => post<TournamentDto>(`/tournaments/${id}/start`),
  readyForMatch: (id: string) => post<TournamentDto>(`/tournaments/${id}/ready`),
  leaveTournament: (id: string) => post(`/tournaments/${id}/leave`),
  claimTournamentHost: (id: string) => post<TournamentDto>(`/tournaments/${id}/claim-host`),

  // Salons (publics et privés)
  rooms: () => request<RoomsOverviewDto>("/rooms"),
  room: (id: string) => request<RoomDto>(`/rooms/${id}`),
  createRoom: (body: CreateRoomInput) => post<RoomDto>("/rooms", body),
  roomPreview: (code: string) => request<RoomPreviewDto>(`/rooms/code/${encodeURIComponent(code)}`),
  joinRoom: (code: string) => post<RoomDto>("/rooms/join", { code }),
  publicRooms: (filters: { game?: string; mode?: RoomMode; available?: boolean }) => {
    const q: string[] = [];
    if (filters.game) q.push(`game=${encodeURIComponent(filters.game)}`);
    if (filters.mode) q.push(`mode=${filters.mode}`);
    if (filters.available) q.push("available=true");
    return request<PublicRoomDto[]>(`/rooms/public${q.length ? `?${q.join("&")}` : ""}`);
  },
  joinPublicRoom: (id: string) => post<RoomDto>(`/rooms/${id}/join`),
  quickPlay: (game: string, mode: RoomMode, create = false) => post<QuickPlayResultDto>("/rooms/quick-play", { game, mode, create }),
  closeRoom: (id: string) => post(`/rooms/${id}/close`),
  roomHistory: (cursor?: string) => request<RoomHistoryDto>(`/rooms/history${cursor ? `?cursor=${cursor}` : ""}`),
  roomNext: (id: string) =>
    request<PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string }>(`/rooms/${id}/next`),
  startRoom: (id: string) => post<RoomDto>(`/rooms/${id}/start`),
  leaveRoom: (id: string) => post(`/rooms/${id}/leave`),
  /** Geste du joueur en salle d'attente (inactivité vérifiée par le serveur) */
  roomActive: (id: string) => post(`/rooms/${id}/active`),
  inviteToRoom: (id: string, userId: string) => post<{ invited: boolean }>(`/rooms/${id}/invite`, { userId }),
  declineRoomInvite: (id: string) => del(`/rooms/${id}/invite`),
  kickFromRoom: (id: string, userId: string) => post<RoomDto>(`/rooms/${id}/kick/${userId}`),
  voteInRoom: (id: string, targetId: string) => post<RoomDto>(`/rooms/${id}/vote`, { targetId }),
  setRoomTeam: (id: string, team: 1 | 2, userId?: string) => post<RoomDto>(`/rooms/${id}/team`, { team, ...(userId ? { userId } : {}) }),

  // Amis
  friends: () => request<UserSummaryDto[]>("/friends"),
  searchUsers: (q: string) => request<UserSearchResultDto[]>(`/friends/search?q=${encodeURIComponent(q)}`),
  friendRequests: () => request<FriendRequestsDto>("/friends/requests"),
  sendFriendRequest: (userId: string) => post<{ status: "pending" | "accepted" }>(`/friends/requests/${userId}`),
  acceptFriend: (userId: string) => post(`/friends/requests/${userId}/accept`),
  declineFriend: (userId: string) => del(`/friends/requests/${userId}`),
  removeFriend: (userId: string) => del(`/friends/${userId}`),

  // Messagerie
  conversations: () => request<ConversationDto[]>("/chat/conversations"),
  unread: () => request<{ unread: number }>("/chat/unread"),
  messages: (friendId: string, before?: string) =>
    request<ChatMessageDto[]>(`/chat/${friendId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendMessage: (friendId: string, body: string) => post<ChatMessageDto>(`/chat/${friendId}/messages`, { body }),
  markRead: (friendId: string) => post(`/chat/${friendId}/read`),

  // Boutique VIP
  shop: () => request<ShopDto>("/shop"),
  /** Achat Google Play : le jeton remis par Google est vérifié par le serveur avant l'activation du VIP */
  googlePlayPurchase: (product: VipProductId, purchaseToken: string) =>
    post<{ status: "PENDING" | "PAID" | "FAILED" | "REFUNDED"; vip: VipStatusDto }>("/shop/google-play", { product, purchaseToken, waiveWithdrawal: true }),
  purchases: () => request<PurchaseDto[]>("/shop/purchases"),

  // Récompenses et photo de profil
  rewards: () => request<MyRewardsDto>("/users/me/rewards"),
  equip: (input: EquipFlairInput) => request<FlairDto>("/users/me/flair", { method: "PUT", body: JSON.stringify(input) }),
  /** Photo choisie dans la galerie : envoyée telle quelle, recadrée et allégée par le serveur */
  uploadAvatar: (uri: string, contentType: string) => sendFile<{ avatarUrl: string }>(`${API}/users/me/avatar`, uri, contentType, true),
  deleteAvatar: () => del("/users/me/avatar"),

  // Modération depuis le chat (modérateurs et administrateurs)
  chatSettings: () => request<{ slowModeSec: number }>("/chat/global/settings"),
  announcement: () => request<{ announcement: AnnouncementDto | null }>("/announcement"),
  muteUser: (userId: string, hours: number) => post<{ chatMutedUntil: string | null }>(`/admin/users/${userId}/mute`, { hours }),
  purgeMessages: (userId: string, hours: number) => post<{ deleted: number }>(`/admin/chat/purge/${userId}`, { hours }),
  setSlowMode: (slowModeSec: number) =>
    request<{ slowModeSec: number }>("/admin/chat/settings", { method: "PATCH", body: JSON.stringify({ slowModeSec }) }),
  mfaVerify: (code: string) => post<{ unlocked: boolean }>("/auth/mfa/verify", { code }),

  // Chat global
  globalMessages: (before?: string) =>
    request<GlobalMessageDto[]>(`/chat/global${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendGlobal: (body: string) => post<GlobalMessageDto>("/chat/global", { body }),
  // Tchat d'un salon ou d'un tournoi
  gameChat: (scope: GameChatScope, id: string) => request<GameChatDto>(`/chat/game/${scope}/${id}`),
  sendGameChat: (scope: GameChatScope, id: string, body: string, team = false) => post<GameChatMessageDto>(`/chat/game/${scope}/${id}`, { body, team }),
  deleteGameChat: (scope: GameChatScope, id: string, messageId: string) => request<void>(`/chat/game/${scope}/${id}/messages/${messageId}`, { method: "DELETE" }),
  muteInTournament: (tournamentId: string, userId: string, muted: boolean) => post<{ muted: boolean }>(`/chat/game/tournament/${tournamentId}/mute/${userId}`, { muted }),
  deleteGlobal: (id: string) => del(`/chat/global/${id}`),
};

/** Taille réelle d'un fichier du téléphone (celle annoncée par la galerie est parfois absente ou arrondie) */
export async function fileSize(uri: string) {
  const info = await getInfoAsync(uri);
  if (!info.exists) throw new ApiError(0, "FILE_MISSING", "Ce fichier n'est plus disponible sur le téléphone. Choisis-le à nouveau.");
  return info.size;
}

/**
 * Envoi d'un fichier du téléphone (PUT, contenu brut) lu directement depuis le disque : rien n'est copié en mémoire,
 * même pour une vidéo de plusieurs dizaines de Mo. `auth` : requête de l'API (jeton de session, renouvelé si besoin).
 */
async function sendFile<T>(url: string, fileUri: string, contentType: string, auth: boolean, retry = true): Promise<T> {
  const access = auth ? await tokens.access() : null;
  let res: Awaited<ReturnType<typeof uploadAsync>>;
  try {
    res = await uploadAsync(url, fileUri, {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      // Vers l'API seulement : une URL signée de stockage n'accepte que les en-têtes prévus à la signature
      headers: { "Content-Type": contentType, ...(auth ? VERSION_HEADER : {}), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "L'envoi a été interrompu. Vérifie ta connexion internet et réessaie.");
  }
  if (res.status === 401 && auth && retry && (await refresh())) return sendFile<T>(url, fileUri, contentType, auth, false);
  if (res.status < 200 || res.status >= 300) {
    type ErrorBody = { code?: string; message?: string | { code?: string; message?: string } };
    const body = ((): ErrorBody => {
      try {
        return JSON.parse(res.body) as ErrorBody;
      } catch {
        return {};
      }
    })();
    const message = typeof body.message === "string" ? body.message : body.message?.message;
    throw new ApiError(res.status, body.code ?? (typeof body.message === "object" ? body.message?.code : undefined) ?? "UPLOAD_FAILED", message ?? "L'envoi du fichier a échoué.");
  }
  if (!res.body) return undefined as T;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return undefined as T;
  }
}

/** Envoi d'une vidéo locale vers l'URL signée (stockage de l'API ou S3). */
export async function uploadVideo(url: string, fileUri: string, contentType: string) {
  await sendFile<void>(media(url), fileUri, contentType, false);
}
