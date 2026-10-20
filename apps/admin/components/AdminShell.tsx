"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ROLE_LABEL, isStaffRole } from "@ranksight/shared";
import { mfa, session, type Me, type MfaStatus } from "@/lib/api";
import { MfaPrompt, MfaSettings } from "./Mfa";

const NAV = [
  ["/", "Vue d'ensemble", "◎"],
  ["/triage", "Tri des clips", "✓"],
  ["/clips", "Clips", "▶"],
  ["/upload", "Ajouter un clip", "⇪"],
  ["/daily", "Défis du jour", "▦"],
  ["/seasons", "Saisons", "♛"],
  ["/events", "Événements", "🏆"],
  ["/ranks", "Rangs", "◆"],
  ["/reports", "Signalements clips", "⚑"],
  ["/moderation", "Signalements joueurs", "⚠"],
  ["/chat", "Chat global", "✉"],
  ["/suggestions", "Suggestions", "✎"],
  ["/users", "Utilisateurs", "◉"],
  ["/rewards", "Récompenses", "✦"],
  ["/shop", "Boutique", "€"],
  ["/storage", "Stockage", "▤"],
  ["/security", "Sécurité du compte", "⚿"],
] as const;

/** Pages accessibles aux trieurs de clips (le reste de l'administration est réservé à la modération) */
const REVIEWER_PAGES = ["/triage", "/security"];
/** Pages réservées au fondateur (aux administrateurs tant qu'aucun fondateur n'est nommé) */
const OWNER_PAGES = ["/shop", "/storage"];

/** Accès réservé à l'équipe : connexion, contrôle du rôle, navigation. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  /** Téléphone : menu replié derrière un bouton */
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(() => {
    session.me().then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(load, [load]);

  // Double authentification : état vérifié avant d'afficher l'administration
  const loadMfa = useCallback(() => {
    // En cas d'erreur, l'API reste seule juge : chaque route de l'administration vérifie la double authentification
    mfa.status().then(setMfaStatus, () => setMfaStatus({ enabled: false, enabledAt: null, recoveryCodesLeft: 0, required: false, unlocked: false }));
  }, []);
  useEffect(() => {
    if (!me || me.role === "USER") return;
    loadMfa();
    window.addEventListener("mfa-changed", loadMfa);
    return () => window.removeEventListener("mfa-changed", loadMfa);
  }, [me, loadMfa]);

  const reviewer = me?.role === "REVIEWER";
  const allowed = !reviewer || REVIEWER_PAGES.some((p) => pathname.startsWith(p));
  // Un trieur arrive directement sur le tri des clips
  useEffect(() => {
    if (reviewer && pathname === "/") router.replace("/triage");
  }, [reviewer, pathname, router]);

  const logout = async () => {
    await session.logout().catch(() => undefined);
    setMe(null);
  };

  if (me === undefined) return <div className="grid min-h-dvh place-items-center text-muted">Chargement…</div>;
  if (!me) return <AdminLogin onDone={load} />;
  if (me.role === "USER") {
    return (
      <Centered>
        <h1 className="font-display text-2xl font-bold">Accès refusé</h1>
        <p className="text-muted">Le compte @{me.username} n&apos;a pas accès à l&apos;administration.</p>
        <button onClick={logout} className="btn-ghost mx-auto">Changer de compte</button>
      </Centered>
    );
  }

  if (!mfaStatus) return <div className="grid min-h-dvh place-items-center text-muted">Chargement…</div>;
  if (mfaStatus.enabled && !mfaStatus.unlocked) return <MfaPrompt onDone={loadMfa} onLogout={logout} />;
  // Double authentification obligatoire pour la modération ; facultative pour les trieurs de clips
  if (mfaStatus.required && !mfaStatus.enabled && isStaffRole(me.role)) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6 md:p-12">
        <h1 className="font-display text-2xl font-bold">Double authentification obligatoire</h1>
        <p className="text-sm text-muted">Pour protéger l&apos;administration, active-la avant de continuer.</p>
        <MfaSettings status={mfaStatus} onChange={loadMfa} />
        <button onClick={logout} className="text-xs text-danger hover:underline">Se déconnecter</button>
      </div>
    );
  }

  const visibleNav = NAV.filter(([href]) => (!reviewer || REVIEWER_PAGES.includes(href)) && (me.siteOwner || !OWNER_PAGES.includes(href)));
  const currentLabel = visibleNav.find(([href]) => (href === "/" ? pathname === "/" : pathname.startsWith(href)))?.[1] ?? "Administration";

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col border-b border-line/60 bg-abyss/80 p-4 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 md:mb-6">
          <a href="https://ranksight.fr" aria-label="Retourner à l'accueil de RankSight" className="font-display text-lg font-bold">
            RANK<span className="text-neon">GUESS</span> <span className="text-xs text-muted">admin</span>
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            className="btn-ghost !px-3 !py-1.5 text-sm md:hidden"
          >
            {menuOpen ? "Fermer ✕" : `Menu · ${currentLabel}`}
          </button>
        </div>
        <nav id="admin-nav" className={`${menuOpen ? "mt-3 grid grid-cols-2 gap-1" : "hidden"} md:mt-0 md:flex md:flex-col md:gap-1`}>
          {visibleNav.map(([href, label, icon]) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`flex items-center gap-3 truncate rounded-lg px-3 py-2 text-sm hover:bg-surface hover:text-ink ${active ? "bg-surface text-ink" : "text-muted"}`}>
                <span className="w-4 text-center text-violet-soft">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className={`${menuOpen ? "mt-4 block" : "hidden"} border-t border-line/60 pt-4 text-sm md:mt-auto md:block`}>
          <p className="truncate">{me.displayName}</p>
          <p className="text-xs text-muted">{ROLE_LABEL[me.role]}</p>
          <button onClick={logout} className="mt-3 text-xs text-danger hover:underline">Se déconnecter</button>
        </div>
      </aside>
      <main className="min-w-0 p-4 md:p-8">
        {allowed ? children : (
          <div className="glass mx-auto mt-10 max-w-md space-y-3 p-6 text-center">
            <h1 className="font-display text-xl font-bold">Page réservée à la modération</h1>
            <p className="text-sm text-muted">Ton rôle de trieur de clips donne accès au tri des clips proposés par les joueurs.</p>
            <Link href="/triage" className="btn-primary mx-auto w-fit">Trier des clips</Link>
          </div>
        )}
      </main>
    </div>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Connexion annulée.",
  expired: "La demande de connexion a expiré, réessaie.",
  disabled: "Ce compte est suspendu.",
  unavailable: "Ce mode de connexion n'est pas disponible pour le moment.",
  email_in_use: "Un compte utilise déjà cette adresse email : connecte-toi avec ton email et ton mot de passe.",
  failed: "La connexion a échoué, réessaie.",
};

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [providers, setProviders] = useState<{ google: boolean; discord: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    session
      .providers()
      .catch(() => ({ google: false, discord: false, password: true }))
      .then((p) => {
        setProviders(p);
        const code = new URLSearchParams(window.location.search).get("auth_error");
        if (code) setError(OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed);
      });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await session.login(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message && !err.message.startsWith("Erreur") ? err.message : "Connexion impossible.");
    } finally {
      setPending(false);
    }
  };

  const oauth = (provider: "google" | "discord") => (e: React.MouseEvent) => {
    if (providers && !providers[provider]) {
      e.preventDefault();
      setError(OAUTH_ERRORS.unavailable);
    }
  };

  return (
    <Centered>
      <h1 className="font-display text-2xl font-bold">
        RANK<span className="text-neon">GUESS</span> <span className="text-sm text-muted">admin</span>
      </h1>
      <p className="text-sm text-muted">Se connecter avec le compte de l&apos;équipe.</p>
      <a href={session.oauthUrl("google")} onClick={oauth("google")} className="block rounded-xl bg-white px-4 py-3 font-semibold text-black">Continuer avec Google</a>
      <a href={session.oauthUrl("discord")} onClick={oauth("discord")} className="block rounded-xl px-4 py-3 font-semibold text-white" style={{ background: "#5865F2" }}>Continuer avec Discord</a>
      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted">
        <span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={submit} className="space-y-3 text-left">
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="w-full rounded-xl border border-line bg-surface p-3" />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Mot de passe</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="w-full rounded-xl border border-line bg-surface p-3" />
        </label>
        <button disabled={pending} className="btn-primary w-full">{pending ? "Connexion…" : "Se connecter"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-sm space-y-4 p-8 text-center">{children}</div>
    </div>
  );
}
