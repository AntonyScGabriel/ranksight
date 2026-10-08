"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Erreur inattendue dans une page : le joueur peut réessayer sans recharger tout le site */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="mx-auto max-w-lg space-y-5 py-16 text-center">
      <p className="hud-label">Oups</p>
      <h1 className="font-display text-4xl font-bold">Quelque chose a raté</h1>
      <p className="text-muted">Une erreur est survenue sur cette page. Réessaie : si le problème continue, préviens-nous depuis la page Contact.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="btn-primary">Réessayer</button>
        <Link href="/contact" className="btn-ghost">Contact</Link>
      </div>
    </section>
  );
}
