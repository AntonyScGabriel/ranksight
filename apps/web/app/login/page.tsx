"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginInput, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { AuthCard, Divider, Field, FormError, OAUTH_ERRORS, OAuthButtons, errorMessage } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, refresh } = useSession();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(OAUTH_ERRORS[params.get("auth_error") ?? ""] ?? null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setPending(true);
    setError(null);
    try {
      await api.login(parsed.data.email, parsed.data.password);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Connexion impossible, réessaie dans un instant."));
      setPending(false);
    }
  };

  return (
    <AuthCard title="Se connecter" subtitle="Ta progression est la même sur le site et l'application.">
      <OAuthButtons next={next} onError={setError} />
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-violet-soft hover:underline">Mot de passe oublié ?</Link>
        </div>
        {params.get("motdepasse") === "1" && !error && (
          <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">Mot de passe modifié : reconnecte-toi avec le nouveau.</p>
        )}
        <FormError message={error} />
        <button disabled={pending} className="btn-primary w-full">{pending ? "Connexion…" : "Se connecter"}</button>
      </form>
      <p className="text-center text-sm text-muted">
        Pas encore de compte ?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-violet-soft hover:underline">Créer un compte</Link>
      </p>
    </AuthCard>
  );
}
