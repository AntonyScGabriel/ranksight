import Link from "next/link";

export const metadata = { title: "Page introuvable" };

/** Page inconnue */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-lg space-y-5 py-16 text-center">
      <p className="hud-label">Erreur 404</p>
      <h1 className="font-display text-4xl font-bold">Rang introuvable</h1>
      <p className="text-muted">
        Cette page n&apos;existe pas, ou plus. Même avec le meilleur œil du serveur, impossible de deviner où elle est passée.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/play/daily" className="btn-primary">Jouer aux défis du jour</Link>
        <Link href="/" className="btn-ghost">Accueil</Link>
      </div>
    </section>
  );
}
