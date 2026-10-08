import Link from "next/link";
import { TERMS_VERSION } from "@ranksight/shared";

const NAV: [string, string][] = [
  ["/legal/mentions", "Mentions légales"],
  ["/legal/cgu", "Conditions d'utilisation"],
  ["/legal/cgv", "Conditions de vente"],
  ["/legal/confidentialite", "Confidentialité"],
  ["/legal/cookies", "Cookies"],
  ["/legal/suppression-compte", "Supprimer son compte"],
];

const updated = new Date(`${TERMS_VERSION}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Mise en page commune des pages légales et d'information. */
export function LegalPage({ title, current, children }: { title: string; current?: string; children: React.ReactNode }) {
  return (
    // Colonne de navigation seulement pour les pages légales : sinon le texte prend toute la largeur
    <div className={current ? "grid gap-8 lg:grid-cols-[14rem_1fr]" : "mx-auto max-w-3xl"}>
      {current && (
        <nav aria-label="Pages légales" className="h-fit space-y-1 text-sm lg:sticky lg:top-24">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={current === href ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 ${current === href ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      <article className="prose-legal glass space-y-5 p-6 md:p-10">
        <header>
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          {current && <p className="mt-1 text-xs text-muted">Dernière mise à jour : {updated}</p>}
        </header>
        {children}
      </article>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}
