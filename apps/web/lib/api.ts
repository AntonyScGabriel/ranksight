import {
  resolveMediaUrl,
  type ChatMessageDto,
  type AchievementsOverviewDto,
  type ConversationDto,
  type DailyOverviewDto,
  type GlobalMessageDto,
  type LeaderboardGame,
  type FriendRequestsDto,
  type GameDto,
  type GuessResultDto,
  type LeaderboardEntryDto,
  type MyClipDto,
  type PlayableClipDto,
  type PublicProfileDto,
  type VersusMatchDto,
  type VersusStatsDto,
  type PurchaseDto,
  type ShopDto,
  type ShopCatalogDto,
  type GiftChoice,
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
  type UserSummaryDto,
  type ContactInput,
  type ReportPlayerInput,
  type EquipFlairInput,
  type FlairDto,
  type MyRewardsDto,
  type LiveGuessAckDto,
  type CreateRoomInput,
  type RoomDto,
  type RoomPreviewDto,
  type RoomsOverviewDto,
} from "@ranksight/shared";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
export const WS_URL = new URL(API).origin;
export const media = (url: string) => resolveMediaUrl(url, API);

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
  /** Adresse email confirmée (ou compte Google/Discord) : nécessaire pour écrire et proposer des clips */
  emailVerified: boolean;
  /** Compte bloqué tant que l'adresse email n'est pas confirmée (inscription par email) */
  mustVerifyEmail: boolean;
  /** CGU en vigueur acceptées */
  termsAccepted: boolean;
  /** Chat coupé par la modération jusqu'à cette date */
  chatMutedUntil: string | null;
  mfaEnabled: boolean;
  /** Titre, badge et cadre équipés */
  flair: FlairDto;
  /** Récompenses obtenues depuis la dernière visite de « Mes récompenses » */
  newRewards: number;
}

let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Client HTTP : session dans des cookies httpOnly (credentials: "include").
 * Sur 401, un seul renouvellement de session est tenté, puis la requête est rejouée.
 */
async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401 && retry && (await refreshSession())) return request<T>(path, init, false);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : body?.message?.message;
    throw new ApiError(res.status, body?.code ?? body?.message?.code, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
/** Routes d'authentification : un 401 signifie « identifiants refusés », pas « session expirée » */
const authPost = <T = void>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }, false);
const del = <T = void>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  // Session
  providers: () => request<{ google: boolean; discord: boolean; password: boolean }>("/auth/providers"),
  oauthUrl: (provider: "google" | "discord", returnTo: string) =>
    `${API}/auth/oauth/${provider}/start?client=web&returnTo=${encodeURIComponent(returnTo)}`,
  signup: (body: { pseudo: string; email: string; password: string; passwordConfirm: string; acceptTerms: boolean }) =>
    authPost("/auth/signup", { ...body, client: "web" }),
  login: (email: string, password: string) => authPost("/auth/login", { email, password, client: "web" }),
  forgotPassword: (email: string) => authPost("/auth/password/forgot", { email }),
  resetPassword: (token: string, password: string, passwordConfirm: string) =>
    authPost("/auth/password/reset", { token, password, passwordConfirm }),
  verifyEmail: (token: string) => post<void>("/auth/email/verify", { token }),
  resendVerification: () => post<{ sent: boolean }>("/auth/email/resend"),
  changeEmail: (email: string, password: string) => post<{ sent: boolean }>("/auth/email/change", { email, password }),
  acceptTerms: () => post<void>("/users/me/terms", { accept: true }),
  logoutAll: () => post<void>("/auth/logout-all"),
  blocks: () => request<{ id: string; displayName: string; avatarUrl: string | null; blockedAt: string }[]>("/users/me/blocks"),
  block: (userId: string) => post<void>(`/users/${userId}/block`),
  unblock: (userId: string) => del(`/users/${userId}/block`),
  reportPlayer: (body: ReportPlayerInput) => post<void>("/reports/players", body),
  contact: (body: ContactInput) => post<void>("/contact", body),
  deleteAccount: (confirm: string) => request<void>("/users/me", { method: "DELETE", body: JSON.stringify({ confirm }) }),
  updatePseudo: (pseudo: string) => request<{ displayName: string }>("/users/me", { method: "PATCH", body: JSON.stringify({ pseudo }) }),
  logout: () => fetch(`${API}/auth/logout`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }),
  me: () => request<Me>("/users/me"),
  myStats: () =>
    request<{ game: { slug: string; name: string }; guesses: number; accuracy: number; avgDistance: number; avgScore: number }[]>("/users/me/stats"),

  // Jeu
  games: () => request<GameDto[]>("/games"),
  dailyOverview: () => request<DailyOverviewDto>("/play/daily"),
  /** Défi du jour n° `slot` d'un jeu (sans numéro : le premier pas encore joué) */
  daily: (game: string, slot?: number) =>
    request<PlayableClipDto & { slot: number }>(`/play/daily/${encodeURIComponent(game)}${slot ? `?slot=${slot}` : ""}`),
  startRun: () => post<{ id: string; lives: number }>("/play/infinite/runs"),
  nextInfinite: (runId: string) => request<PlayableClipDto>(`/play/infinite/runs/${runId}/next`),
  guess: (body: SubmitGuessInput) =>
    post<GuessResultDto & { run?: { lives: number; score: number; endedAt: string | null } }>("/guesses", body),
  /** Réponse pendant un duel ou un salon : enregistrée sans rien dévoiler avant la fin de la manche */
  liveGuess: (body: SubmitGuessInput) => post<LiveGuessAckDto>("/guesses", body),
  report: (clipId: string, reason: string) => post("/reports", { clipId, reason }),
  leaderboard: (period: string, scope: string, game: LeaderboardGame = "all", season?: string) =>
    request<{ entries: LeaderboardEntryDto[]; me: { rank: number; score: number } | null }>(
      `/leaderboards?period=${period}&scope=${scope}&game=${game}&limit=50${season ? `&season=${season}` : ""}`,
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

  // Profils
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

  // Salons privés
  rooms: () => request<RoomsOverviewDto>("/rooms"),
  room: (id: string) => request<RoomDto>(`/rooms/${id}`),
  createRoom: (body: CreateRoomInput) => post<RoomDto>("/rooms", body),
  roomPreview: (code: string) => request<RoomPreviewDto>(`/rooms/code/${encodeURIComponent(code)}`),
  joinRoom: (code: string) => post<RoomDto>("/rooms/join", { code }),
  roomNext: (id: string) =>
    request<PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string }>(`/rooms/${id}/next`),
  startRoom: (id: string) => post<RoomDto>(`/rooms/${id}/start`),
  leaveRoom: (id: string) => post(`/rooms/${id}/leave`),
  inviteToRoom: (id: string, userId: string) => post<{ invited: boolean }>(`/rooms/${id}/invite`, { userId }),
  declineRoomInvite: (id: string) => del(`/rooms/${id}/invite`),
  kickFromRoom: (id: string, userId: string) => post<RoomDto>(`/rooms/${id}/kick/${userId}`),

  // Boutique VIP
  shop: () => request<ShopDto>("/shop"),
  shopCatalog: () => request<ShopCatalogDto>("/shop/catalog"),
  checkout: (product: VipProductId, gift?: GiftChoice) =>
    post<{ url: string; sessionId: string }>("/shop/checkout", { product, waiveWithdrawal: true, ...(gift ? { gift } : {}) }),
  confirmCheckout: (sessionId: string) =>
    request<{ status: "PENDING" | "PAID" | "FAILED" | "REFUNDED"; vip: VipStatusDto; gift: { to: string | null; code: string | null } | null }>(
      `/shop/checkout/${encodeURIComponent(sessionId)}`,
    ),
  redeemGiftCode: (code: string) => post<{ days: number; until: string; from: string | null; vip: VipStatusDto }>("/shop/redeem", { code }),
  purchases: () => request<PurchaseDto[]>("/shop/purchases"),

  // Chat global
  globalMessages: (before?: string) =>
    request<GlobalMessageDto[]>(`/chat/global${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendGlobal: (body: string) => post<GlobalMessageDto>("/chat/global", { body }),
  deleteGlobal: (id: string) => del(`/chat/global/${id}`),
  chatSettings: () => request<{ slowModeSec: number }>("/chat/global/settings"),
  announcement: () => request<{ announcement: AnnouncementDto | null }>("/announcement"),
  /** Code de double authentification (équipe) : déverrouille la modération pour la session */
  mfaVerify: (code: string) => post<{ unlocked: boolean }>("/auth/mfa/verify", { code }),
  // Modération depuis le chat (modérateurs et administrateurs)
  muteUser: (userId: string, hours: number) => post<{ chatMutedUntil: string | null }>(`/admin/users/${userId}/mute`, { hours }),
  purgeMessages: (userId: string, hours: number) => post<{ deleted: number }>(`/admin/chat/purge/${userId}`, { hours }),
  setSlowMode: (slowModeSec: number) =>
    request<{ slowModeSec: number }>("/admin/chat/settings", { method: "PATCH", body: JSON.stringify({ slowModeSec }) }),

  // Récompenses et photo de profil
  rewards: () => request<MyRewardsDto>("/users/me/rewards"),
  equip: (input: EquipFlairInput) => request<FlairDto>("/users/me/flair", { method: "PUT", body: JSON.stringify(input) }),
  uploadAvatar: (file: Blob) =>
    request<{ avatarUrl: string }>("/users/me/avatar", { method: "PUT", body: file, headers: { "Content-Type": file.type } }),
  deleteAvatar: () => del("/users/me/avatar"),
};

/** Envoi direct du fichier vers l'URL signée, avec progression. */
export function uploadToSignedUrl(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", media(url));
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("L'envoi de la vidéo a échoué.")));
    xhr.onerror = () => reject(new Error("L'envoi de la vidéo a échoué."));
    xhr.send(file);
  });
}

/** Durée d'une vidéo locale, lue dans le navigateur avant l'envoi. */
export function videoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(v.duration);
    };
    v.onerror = () => reject(new Error("Format vidéo non lisible."));
    v.src = URL.createObjectURL(file);
  });
}
