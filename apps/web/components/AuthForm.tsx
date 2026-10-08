"use client";

import { useEffect, useId, useState } from "react";
import { api, ApiError } from "@/lib/api";

/** Messages affichés au retour de Google ou Discord (paramètre auth_error). */
export const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Connexion annulée.",
  expired: "La demande de connexion a expiré, réessaie.",
  disabled: "Ce compte est suspendu.",
  unavailable: "Ce mode de connexion n'est pas disponible pour le moment.",
  email_in_use: "Un compte RankGuess utilise déjà cette adresse email. Connecte-toi avec ton email et ton mot de passe.",
  failed: "La connexion a échoué, réessaie dans un instant.",
};

export function errorMessage(err: unknown, fallback = "Une erreur est survenue, réessaie dans un instant.") {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 429 && err.code !== "SLOW_DOWN") return "Trop de tentatives. Patiente quelques minutes avant de réessayer.";
  if (err.status >= 500) return fallback;
  if (err.message && !/^HTTP \d+$/.test(err.message) && err.message !== err.code) return err.message;
  return fallback;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass animate-rise mx-auto max-w-sm space-y-5 p-8">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Boutons Google et Discord, toujours affichés ; si un fournisseur n'est pas activé sur le serveur, un message l'indique.
 * `next` : page où revenir après la connexion (l'adresse complète est calculée au clic, côté navigateur).
 */
export function OAuthButtons({ next, onError }: { next: string; onError: (message: string) => void }) {
  const [providers, setProviders] = useState<{ google: boolean; discord: boolean } | null>(null);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => setProviders({ google: false, discord: false }));
  }, []);

  const go = (provider: "google" | "discord") => (e: React.MouseEvent) => {
    e.preventDefault();
    if (providers && !providers[provider]) return onError(OAUTH_ERRORS.unavailable);
    // En cas d'erreur, le fournisseur renvoie sur la page de connexion qui affiche le message ; sinon on repart vers `next`
    window.location.assign(api.oauthUrl(provider, `${window.location.origin}/login?next=${encodeURIComponent(next)}`));
  };

  return (
    <div className="space-y-3">
      <a
        href={api.oauthUrl("google", "")}
        onClick={go("google")}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-white/90"
      >
        <GoogleIcon /> Continuer avec Google
      </a>
      <a
        href={api.oauthUrl("discord", "")}
        onClick={go("discord")}
        className="flex w-full items-center justify-center gap-3 rounded-xl px-4 py-3 font-semibold text-white transition hover:brightness-110"
        style={{ background: "#5865F2" }}
      >
        <DiscordIcon /> Continuer avec Discord
      </a>
    </div>
  );
}

export function Divider({ label = "ou" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Field({
  label, error, hint, ...input
}: { label: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const help = error ?? hint;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input
        {...input}
        id={id}
        aria-invalid={!!error}
        aria-describedby={help ? `${id}-help` : undefined}
        className={`input ${error ? "border-danger" : ""}`}
      />
      {help && <p id={`${id}-help`} className={`text-xs ${error ? "text-danger" : "text-muted"}`}>{help}</p>}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-center text-sm text-danger">{message}</p>;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.2a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 -.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7zM8.5 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z" />
    </svg>
  );
}
