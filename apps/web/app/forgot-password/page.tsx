"use client";

import Link from "next/link";
import { useState } from "react";
import { ForgotPasswordInput, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { AuthCard, Field, FormError, errorMessage } from "@/components/AuthForm";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ForgotPasswordInput.safeParse({ email });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setPending(true);
    setError(null);
    try {
      await api.forgotPassword(parsed.data.email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Vérifie tes emails">
        <p className="text-center text-muted">
          Si un compte existe avec l&apos;adresse <strong className="text-ink">{email.trim().toLowerCase()}</strong>, tu vas recevoir un lien
          pour choisir un nouveau mot de passe. Il est valable 1 heure.
        </p>
        <Link href="/login" className="btn-ghost mx-auto flex w-fit">Retour à la connexion</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Mot de passe oublié" subtitle="Indique l'email de ton compte : on t'envoie un lien pour en choisir un nouveau.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <FormError message={error} />
        <button disabled={pending} className="btn-primary w-full">{pending ? "Envoi…" : "Recevoir le lien"}</button>
      </form>
      <p className="text-center text-sm"><Link href="/login" className="text-violet-soft hover:underline">Retour à la connexion</Link></p>
    </AuthCard>
  );
}
