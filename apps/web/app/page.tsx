import Link from "next/link";
import { GAME_NAMES, GAME_SLUGS, SCORE_STEPS } from "@ranksight/shared";

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
        <div className="animate-rise space-y-6">
          <p className="hud-label">4 défis chaque jour · un par jeu</p>
          <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight md:text-7xl">
            Tu crois savoir
            <br />
            <span className="bg-gradient-to-r from-violet-soft via-violet to-neon bg-clip-text text-transparent">jauger un joueur&nbsp;?</span>
          </h1>
          <p className="max-w-md text-lg text-muted">
            30 secondes de gameplay. Un rang à deviner. Chaque jour, un clip League of Legends, Valorant, Rocket League et
            Counter-Strike 2, le même pour tout le monde.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/play/daily" className="btn-primary">Défis du jour</Link>
            <Link href="/play/infinite" className="btn-ghost">Mode Infini →</Link>
          </div>
        </div>

        <div className="glass animate-glow relative aspect-video overflow-hidden">
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-surface-2 to-abyss">
            <span className="font-display text-6xl font-bold text-white/10">?</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-4">
            <span className="hud-label">Quel est son rang ?</span>
            <span className="rounded-md bg-violet/20 px-2 py-1 font-mono text-xs text-violet-soft">0:30</span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Regarde", "Un clip de 15 à 30 secondes, sans pseudo ni rang affiché."],
          ["Devine", "Choisis le rang du joueur sur l'échelle du jeu."],
          ["Marque", `${SCORE_STEPS[0]} points pour le rang exact, ${SCORE_STEPS[1]} à un rang près, ${SCORE_STEPS[2]} à deux rangs. Au-delà, c'est zéro.`],
        ].map(([t, d], i) => (
          <div key={t} className="glass p-6">
            <p className="font-mono text-sm text-neon">0{i + 1}</p>
            <h3 className="mt-2 font-display text-xl font-semibold">{t}</h3>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="glass flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
        <div>
          <h2 className="font-display text-xl font-semibold">Tu as un clip qui vaut le détour ?</h2>
          <p className="text-sm text-muted">Propose-le : une fois validé, il rejoint les défis de la communauté.</p>
        </div>
        <Link href="/submit" className="btn-ghost">Proposer un clip</Link>
      </section>

      <section>
        <p className="hud-label mb-4">Jeux disponibles</p>
        <ul className="flex flex-wrap gap-2">
          {GAME_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/play/daily/${slug}`} className="block rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-violet hover:text-ink">
                {GAME_NAMES[slug]}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
