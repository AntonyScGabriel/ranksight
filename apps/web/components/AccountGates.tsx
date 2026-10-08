"use client";

import Link from "next/link";
import { useState } from "react";
import { MIN_AGE } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "./AuthForm";

/**
 * Obligations du compte connecté :
 * - CGU modifiées (ou compte créé avec Google/Discord) : acceptation demandée avant de continuer ;
 * - adresse email non confirmée : bandeau avec renvoi du lien (nécessaire pour écrire et proposer des clips).
 */
export function AccountGates() {
  const { me, refresh } = useSession();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (!me) return null;

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
