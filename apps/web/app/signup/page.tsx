"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MIN_AGE, SignupInput } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { safeNext } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { AuthCard, Divider, Field, FormError, OAuthButtons, errorMessage } from "@/components/AuthForm";

type Fields = "pseudo" | "email" | "password" | "passwordConfirm" | "acceptTerms";

export default function SignupPage() {
  return (
    <Suspense>
      <Signup />
    </Suspense>
  );
}

function Signup() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, refresh } = useSession();
  const next = safeNext(params.get("next"));
  const [form, setForm] = useState({ pseudo: "", email: "", password: "", passwordConfirm: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Fields, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);

  const set = (key: Exclude<Fields, "acceptTerms">) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = SignupInput.safeParse({ ...form, acceptTerms });
    if (!parsed.success) {
      const errors: Partial<Record<Fields, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Fields;
        errors[key] ??= issue.message;
      }
      return setFieldErrors(errors);
    }
    setPending(true);
    try {
      await api.signup({ ...form, acceptTerms });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PSEUDO_TAKEN") setFieldErrors({ pseudo: err.message });
      else if (err instanceof ApiError && err.code === "EMAIL_TAKEN") setFieldErrors({ email: err.message });
      else setError(errorMessage(err, "Inscription impossible, réessaie dans un instant."));
      setPending(false);
    }
  };

  return (
    <AuthCard title="Créer un compte" subtitle="Gratuit. Ton pseudo apparaît dans les classements et le chat.">
      <OAuthButtons next={next} onError={setError} />
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Pseudo" autoComplete="username" value={form.pseudo} onChange={set("pseudo")} error={fieldErrors.pseudo} hint="3 à 20 caractères : lettres, chiffres ou _" maxLength={20} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={fieldErrors.email} />
        <Field label="Mot de passe" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} error={fieldErrors.password} hint="8 caractères minimum, avec au moins une lettre et un chiffre" />
        <Field label="Confirmation du mot de passe" type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={set("passwordConfirm")} error={fieldErrors.passwordConfirm} />
        <div className="space-y-1">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => {
                setAcceptTerms(e.target.checked);
                setFieldErrors((f) => ({ ...f, acceptTerms: undefined }));
              }}
              className="mt-0.5 h-4 w-4 accent-violet"
              aria-describedby="terms-error"
            />
            <span>
              J&apos;ai {MIN_AGE} ans ou plus et j&apos;accepte les{" "}
              <Link href="/legal/cgu" target="_blank" className="text-violet-soft underline">conditions d&apos;utilisation</Link> et la{" "}
              <Link href="/legal/confidentialite" target="_blank" className="text-violet-soft underline">politique de confidentialité</Link>.
            </span>
          </label>
          {fieldErrors.acceptTerms && <p id="terms-error" className="text-xs text-danger">{fieldErrors.acceptTerms}</p>}
        </div>
        <FormError message={error} />
        <button disabled={pending} className="btn-primary w-full">{pending ? "Création…" : "Créer mon compte"}</button>
      </form>
      <p className="text-center text-sm text-muted">
        Déjà un compte ?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-violet-soft hover:underline">Se connecter</Link>
      </p>
    </AuthCard>
  );
}
