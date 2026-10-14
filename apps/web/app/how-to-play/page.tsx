import type { Metadata } from "next";
import Link from "next/link";
import { scoreTable, VERSUS_ROUND_SEC, VERSUS_ROUNDS } from "@ranksight/shared";
import { LegalPage, Section } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Comment jouer",
  description: "Regarde un clip, devine le rang du joueur : défis du jour, mode Infini, duels en direct, saisons et succès.",
};

export default function HowToPlayPage() {
  const table = scoreTable();
  return (
    <LegalPage title="Comment jouer">
      <p className="text-sm text-muted">Regarde un clip de League of Legends, Valorant, Rocket League ou Counter-Strike 2, puis devine le rang du joueur.</p>
      <Section title="Le barème">
        <p>
          Rang exact : {table[0]} points · 1 rang d&apos;écart : {table[1]} · 2 rangs d&apos;écart : {table[2]} · au-delà : 0.
          L&apos;écart se compte sur l&apos;échelle des rangs du jeu.
        </p>
      </Section>
      <Section title="Les modes">
        <ul>
          <li><strong>Défis du jour</strong> : 3 clips par jeu, les mêmes pour tout le monde, une seule tentative par clip. Nouveaux défis chaque jour à minuit (UTC).</li>
          <li><strong>Infini</strong> : des clips à la suite, 3 vies, difficulté croissante.</li>
          <li><strong>Duels en direct</strong> : contre un joueur au hasard ou un ami, {VERSUS_ROUNDS} clips en même temps, {VERSUS_ROUND_SEC} secondes par manche (plus pour un clip long). Le meilleur total gagne.</li>
        </ul>
      </Section>
      <Section title="Progression">
        <ul>
          <li>Chaque réponse rapporte de l&apos;XP ; les niveaux montent avec.</li>
          <li>Séries : jours joués d&apos;affilée et rangs exacts d&apos;affilée.</li>
          <li>Classements du jour, de la semaine, de la saison (dates annoncées dans l&apos;onglet Saison) et de tous les temps, globaux ou entre amis.</li>
          <li>Succès à débloquer dans « Mes succès ».</li>
        </ul>
      </Section>
      <Section title="Proposer tes clips">
        <p>
          Envoie un clip de 5 secondes à 1 minute avec ton vrai rang (« Proposer un clip »). Masque ton pseudo et ton rang à l&apos;écran.
          L&apos;équipe le vérifie, puis il peut tomber en défi du jour pour tout le monde.
        </p>
      </Section>
      <p><Link href="/play/daily" className="btn-primary inline-flex">Jouer maintenant</Link></p>
    </LegalPage>
  );
}
