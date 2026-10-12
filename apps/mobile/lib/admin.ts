import type {
  AdminGiftCodeDto, AdminSuggestionsDto, AnnouncementDto, AnnouncementInput, ChatReportReason, CreateGiftCodesInput, ReportReason, ShopSettingsDto,
  ShopSettingsInput, SuggestionReviewInput, SuggestionStatus, TriageClipDto, TriageInput, TriageStatsDto, UserRole,
} from "@ranksight/shared";
import { request } from "./api";

/** Appels de l'administration depuis l'application (mêmes routes que l'administration web, mêmes droits). */

export interface AdminOverview {
  users: number;
  dau: number;
  guesses24h: number;
  openReports: number;
  premium: number;
  clips: Partial<Record<"PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ARCHIVED", number>>;
  triaged: number;
  /** Suggestions de joueurs pas encore traitées */
  newSuggestions: number;
}

export interface AdminClipRow {
  id: string;
  createdAt: string;
  status: string;
  durationSec: number;
  triageDecision: "APPROVE" | "REJECT" | null;
  triageNote: string | null;
  game: { slug: string; name: string };
  rank: { name: string };
  uploader: { displayName: string; username: string } | null;
  triagedBy: { displayName: string } | null;
}

export interface AdminClipDetail {
  id: string;
  status: string;
  source: "ADMIN" | "COMMUNITY";
  createdAt: string;
  durationSec: number;
  difficulty: number;
  proofUrl: string | null;
  inGamePseudo: string | null;
  platform: string | null;
  region: string | null;
  submitterNote: string | null;
  rejectionReason: string | null;
  triageDecision: "APPROVE" | "REJECT" | null;
  triageNote: string | null;
  triagedBy: { displayName: string } | null;
  uploader: { displayName: string; username: string } | null;
  rankId: string;
  rank: { id: string; name: string; color: string; iconUrl: string | null };
  game: { id: string; slug: string; name: string; ranks: { id: string; name: string; color: string; iconUrl: string | null; order: number }[] };
  reports: { id: string; reason: ReportReason; details: string | null; status: string }[];
  previewUrl: string | null;
}

export interface ClipReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  clip: { id: string; reportCount: number; game: { slug: string } };
  reporter: { displayName: string };
}

export interface PlayerReport {
  id: string;
  reason: ChatReportReason;
  details: string | null;
  excerpt: string | null;
  createdAt: string;
  globalMessageId: string | null;
  directMessageId: string | null;
  reporter: { id: string; displayName: string };
  target: {
    id: string; displayName: string; username: string; status: string; chatMutedUntil: string | null; avatarUrl: string | null;
    role: UserRole;
    _count: { chatReportsAbout: number };
  };
  globalMessage: { id: string; deletedAt: string | null } | null;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
  level: number;
  createdAt: string;
  avatarUrl: string | null;
  vip: { active: boolean; until: string | null };
  emailVerified: boolean;
  chatMutedUntil: string | null;
  mfaEnabled: boolean;
}

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const adminApi = {
  overview: () => request<AdminOverview>("/admin/stats/overview"),

  // Annonce
  announcement: () => request<{ announcement: AnnouncementDto | null }>("/announcement"),
  setAnnouncement: (input: AnnouncementInput) => request<AnnouncementDto>("/admin/announcement", json("PUT", input)),
  clearAnnouncement: () => request<void>("/admin/announcement", json("DELETE")),

  // Tri des clips (trieurs et modération)
  triageQueue: () => request<TriageClipDto[]>("/admin/triage/queue"),
  triageStats: () => request<TriageStatsDto>("/admin/triage/stats"),
  triage: (id: string, input: TriageInput) => request<unknown>(`/admin/triage/${id}`, json("POST", input)),

  // Clips à valider
  clips: (status: "TRIAGED" | "UNTRIAGED", page = 1) => request<Page<AdminClipRow>>(`/admin/clips?status=${status}&page=${page}`),
  clip: (id: string) => request<AdminClipDetail>(`/admin/clips/${id}`),
  review: (id: string, body: { decision: "APPROVE"; rankId?: string; difficulty?: number } | { decision: "REJECT"; reason: string }) =>
    request<unknown>(`/admin/clips/${id}/review`, json("POST", body)),
  confirmTriage: (ids: string[]) => request<{ approved: number; rejected: number }>("/admin/clips/confirm-triage", json("POST", { ids })),

  // Suggestions des joueurs
  suggestions: (status: SuggestionStatus, offset = 0) => request<AdminSuggestionsDto>(`/admin/suggestions?status=${status}&limit=30&offset=${offset}`),
  reviewSuggestion: (id: string, body: SuggestionReviewInput) => request<unknown>(`/admin/suggestions/${id}`, json("PATCH", body)),
  deleteSuggestion: (id: string) => request<void>(`/admin/suggestions/${id}`, json("DELETE")),

  // Signalements
  clipReports: (page = 1) => request<Page<ClipReport>>(`/admin/reports?status=OPEN&page=${page}`),
  resolveClipReport: (id: string, body: { status: "RESOLVED" | "DISMISSED"; resolution: string; archiveClip: boolean }) =>
    request<unknown>(`/admin/reports/${id}/resolve`, json("POST", body)),
  playerReports: (page = 1) => request<Page<PlayerReport>>(`/admin/player-reports?status=OPEN&page=${page}`),
  resolvePlayerReport: (
    id: string,
    body: { status: "RESOLVED" | "DISMISSED"; resolution?: string; deleteMessage: boolean; muteHours: number; ban: boolean },
  ) => request<void>(`/admin/player-reports/${id}/resolve`, json("POST", body)),

  // Joueurs
  users: (q: string, page = 1) => request<Page<AdminUser> & { ownerExists: boolean }>(`/admin/users?q=${encodeURIComponent(q)}&page=${page}`),
  updateUser: (id: string, body: { role?: UserRole; status?: "ACTIVE" | "BANNED" }) => request<unknown>(`/admin/users/${id}`, json("PATCH", body)),
  mute: (id: string, hours: number) => request<{ chatMutedUntil: string | null }>(`/admin/users/${id}/mute`, json("POST", { hours })),
  grantVip: (id: string, days: number) => request<unknown>(`/admin/users/${id}/vip`, json("POST", { days })),
  revokeVip: (id: string) => request<unknown>(`/admin/users/${id}/vip`, json("DELETE")),
  verifyEmail: (id: string) => request<void>(`/admin/users/${id}/verify-email`, json("POST", {})),
  resetMfa: (id: string) => request<void>(`/admin/users/${id}/mfa/reset`, json("POST", {})),
  removeAvatar: (id: string) => request<void>(`/admin/users/${id}/avatar`, json("DELETE")),
  resetStats: (id: string) => request<{ achievements: number; leaderboards: number; rewards: number }>(`/admin/users/${id}/reset-stats`, json("POST", {})),
  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, json("DELETE")),

  // Boutique
  shopSettings: () => request<ShopSettingsDto>("/admin/shop/settings"),
  saveShopSettings: (input: ShopSettingsInput) => request<ShopSettingsDto>("/admin/shop/settings", json("PUT", input)),
  giftCodes: () => request<{ items: AdminGiftCodeDto[] }>("/admin/gift-codes"),
  createGiftCodes: (input: CreateGiftCodesInput) => request<{ codes: string[] }>("/admin/gift-codes", json("POST", input)),
  disableGiftCode: (id: string) => request<void>(`/admin/gift-codes/${id}/disable`, json("POST", {})),

  // Double authentification du compte
  mfaStatus: () => request<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean; unlocked: boolean }>("/auth/mfa"),
  mfaSetup: () => request<{ secret: string; uri: string }>("/auth/mfa/setup", json("POST", {})),
  mfaEnable: (code: string) => request<{ recoveryCodes: string[] }>("/auth/mfa/enable", json("POST", { code })),
  mfaDisable: (code: string) => request<void>("/auth/mfa/disable", json("POST", { code })),
};
