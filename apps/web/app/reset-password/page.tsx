"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResetPasswordInput, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { AuthCard, Field, FormError, errorMessage } from "@/components/AuthForm";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}

function ResetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ResetPasswordInput.safeParse({ token, password, passwordConfirm });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setPending(true);
    setError(null);
    try {
      await api.resetPassword(token, password, passwordConfirm);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Lien incomplet" subtitle="Ouvre le lien reçu par email, ou fais une nouvelle demande.">
        <Link href="/forgot-password" className="btn-primary w-full">Nouvelle demande</Link>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title="Mot de passe modifié" subtitle="Par sécurité, toutes tes sessions ont été fermées. Connecte-toi avec ton nouveau mot de passe.">
        <Link href="/login" className="btn-primary w-full">Se connecter</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Nouveau mot de passe">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Mot de passe" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="8 caractères minimum, avec au moins une lettre et un chiffre" />
        <Field label="Confirmation du mot de passe" type="password" autoComplete="new-password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
        <FormError message={error} />
        <button disabled={pending} className="btn-primary w-full">{pending ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </AuthCard>
  );
}
