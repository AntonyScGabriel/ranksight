import { resolveMediaUrl, type UserRole } from "@ranksight/shared";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
export const media = (url: string) => resolveMediaUrl(url, API);

export class AdminError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401 && retry) {
    const refreshed = await fetch(`${API}/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (refreshed.ok) return call<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.issues?.fieldErrors ? Object.values(body.issues.fieldErrors).flat().join(" ") : null;
    const message = (typeof body?.message === "string" ? body.message : body?.message?.message) ?? detail ?? `Erreur ${res.status}`;
    const code = typeof body?.code === "string" ? body.code : typeof body?.message?.code === "string" ? body.message.code : undefined;
    throw new AdminError(res.status, message, code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Routes /v1/admin/* (rôle modérateur ou administrateur vérifié par l'API). */
export const adminFetch = <T>(path: string, init: RequestInit = {}) => call<T>(`/admin${path}`, init);

export interface Me {
  id: string;
  displayName: string;
  username: string;
  email: string | null;
  role: UserRole;
  mfaEnabled: boolean;
}

export interface MfaStatus { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean; unlocked: boolean }

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

/** Double authentification du compte connecté */
export const mfa = {
  status: () => call<MfaStatus>("/auth/mfa"),
  setup: () => post<{ secret: string; uri: string }>("/auth/mfa/setup"),
  enable: (code: string) => post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code }),
  verify: (code: string) => post<{ unlocked: boolean }>("/auth/mfa/verify", { code }),
  disable: (code: string) => post<void>("/auth/mfa/disable", { code }),
};

export const session = {
  me: () => call<Me>("/users/me"),
  providers: () => call<{ google: boolean; discord: boolean; password: boolean }>("/auth/providers"),
  oauthUrl: (provider: "google" | "discord") =>
    `${API}/auth/oauth/${provider}/start?client=web&returnTo=${encodeURIComponent(window.location.href)}`,
  // Pas de renouvellement de session sur 401 : ici, 401 veut dire « identifiants refusés »
  login: (email: string, password: string) =>
    call("/auth/login", { method: "POST", body: JSON.stringify({ email, password, client: "web" }) }, false),
  logout: () => fetch(`${API}/auth/logout`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }),
};

/** Envoi direct de la vidéo vers l'URL signée : la vidéo ne transite pas par l'application. */
export async function uploadFile(file: File, onProgress: (p: number) => void): Promise<string> {
  const { key, url } = await adminFetch<{ key: string; url: string }>("/clips/upload-url", {
    method: "POST",
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", media(url));
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("L'envoi de la vidéo a échoué.")));
    xhr.onerror = () => reject(new Error("L'envoi de la vidéo a échoué."));
    xhr.send(file);
  });
  return key;
}
