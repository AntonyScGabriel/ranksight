"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { Panel, Skeleton } from "@/components/States";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <VerifyEmail />
    </Suspense>
  );
}

/** Lien reçu par email : confirmation de l'adresse. */
function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const { refresh } = useSession();
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api.verifyEmail(token).then(
      () => {
        setState({ ok: true, message: "Ton adresse email est confirmée : ton compte est activé. Bon jeu !" });
        void refresh();
      },
      (e) => setState({ ok: false, message: errorMessage(e, "Ce lien n'est pas valide.") }),
    );
  }, [token, refresh]);

  if (!state) return <Skeleton />;
  return (
    <Panel title={state.ok ? "Adresse confirmée" : "Lien invalide"} text={state.message}>
      <Link href={state.ok ? "/play/daily" : "/profile"} className="btn-primary mx-auto w-fit">{state.ok ? "Jouer" : "Mon profil"}</Link>
    </Panel>
  );
}
