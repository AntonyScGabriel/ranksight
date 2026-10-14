"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MIN_AGE } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "./AuthForm";

/**
 * Obligations du compte connecté :
 * - CGU modifiées (ou compte créé avec Google/Discord) : acceptation demandée avant de continuer ;
 * - inscription par email : compte bloqué jusqu'à la confirmation de l'adresse (renvoi du lien, correction de l'adresse) ;
 * - adresse email non confirmée sans blocage (configuration facultative) : bandeau avec renvoi du lien.
 */

/** Pages consultables avant la confirmation (lien de confirmation, pages légales, contact) */
const OPEN_PAGES = ["/verify-email", "/legal", "/contact", "/reset-password", "/faq"];
export function AccountGates() {
  const { me, refresh, logout } = useSession();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Confirmation faite dans un autre onglet : le blocage disparaît au retour sur la page
  const waiting = !!me?.mustVerifyEmail;
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting, refresh]);

  if (!me) return null;

  if (me.mustVerifyEmail && !OPEN_PAGES.some((p) => pathname.startsWith(p))) {
    return <VerifyEmailGate email={me.email ?? ""} hasPassword={me.hasPassword} onRefresh={refresh} onLogout={logout} />;
  }

  if (!me.termsAccepted) {
    const accept = async () => {
      setError(null);
      try {
        await api.acceptTerms();
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    return (
      <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="glass w-full max-w-md space-y-4 p-6 shadow-2xl">
          <h2 id="terms-title" className="font-display text-xl font-bold">Conditions d&apos;utilisation</h2>
          <p className="text-sm text-muted">
            Pour continuer à jouer, merci de lire et d&apos;accepter nos conditions d&apos;utilisation et notre politique de confidentialité.
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet" />
            <span>
              J&apos;ai {MIN_AGE} ans ou plus et j&apos;accepte les{" "}
              <Link href="/legal/cgu" target="_blank" className="text-violet-soft underline">conditions d&apos;utilisation</Link> et la{" "}
              <Link href="/legal/confidentialite" target="_blank" className="text-violet-soft underline">politique de confidentialité</Link>.
            </span>
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={accept} disabled={!checked} className="btn-primary">Continuer</button>
          </div>
        </div>
      </div>
    );
  }

  if (!me.emailVerified && me.email) {
    const resend = async () => {
      setError(null);
      try {
        await api.resendVerification();
        setSent(me.email);
      } catch (e) {
        setError(errorMessage(e));
      }
    };
    return (
      <div className="border-b border-warn/30 bg-warn/10">
        <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
          <span>
            {sent ? `Email envoyé à ${sent} : clique sur le lien qu'il contient.` : `Confirme ton adresse email (${me.email}) pour discuter et proposer des clips.`}
          </span>
          {!sent && <button onClick={resend} className="font-semibold text-warn underline">Renvoyer l&apos;email</button>}
          {error && <span className="text-danger">{error}</span>}
        </p>
      </div>
    );
  }
  return null;
}

function VerifyEmailGate({ email, hasPassword, onRefresh, onLogout }: { email: string; hasPassword: boolean; onRefresh: () => Promise<unknown>; onLogout: () => void }) {
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
      return true;
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    await onRefresh();
    setNotice({ text: "Adresse pas encore confirmée : ouvre le lien reçu par email, puis réessaie.", ok: false });
  };

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.changeEmail(form.email, form.password), `Adresse modifiée : un nouveau lien a été envoyé à ${form.email.trim().toLowerCase()}.`);
    if (ok) {
      setChanging(false);
      setForm({ email: "", password: "" });
      await onRefresh();
    }
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="verify-title" className="glass w-full max-w-md space-y-4 p-6 shadow-2xl">
        <h2 id="verify-title" className="font-display text-xl font-bold">Confirme ton adresse email</h2>
        <p className="text-sm text-muted">
          Un lien de confirmation a été envoyé à <strong className="text-ink">{email}</strong>. Ouvre-le pour activer ton compte et commencer à jouer.
          Pense à regarder dans les courriers indésirables.
        </p>
        {notice && <p role="status" className={`text-sm ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
        {changing ? (
          <form onSubmit={change} className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>Nouvelle adresse email</span>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" autoComplete="email" />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Mot de passe du compte</span>
              <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" autoComplete="current-password" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setChanging(false)} className="btn-ghost">Annuler</button>
              <button type="submit" disabled={busy} className="btn-primary">Envoyer le lien</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={check} disabled={busy} className="btn-primary">J&apos;ai confirmé</button>
            <button onClick={() => act(() => api.resendVerification(), `Nouveau lien envoyé à ${email}.`)} disabled={busy} className="btn-ghost">
              Renvoyer l&apos;email
            </button>
            {hasPassword && (
              <button onClick={() => setChanging(true)} className="btn-ghost">Mauvaise adresse ?</button>
            )}
          </div>
        )}
        <p className="flex justify-between text-xs text-muted">
          <Link href="/contact" className="underline">Besoin d&apos;aide ?</Link>
          <button onClick={onLogout} className="underline hover:text-ink">Se déconnecter</button>
        </p>
      </div>
    </div>
  );
}
