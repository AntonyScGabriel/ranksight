import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Cookies" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies" current="/legal/cookies">
      <Section title="Uniquement des cookies nécessaires">
        <p>
          RankGuess n&apos;utilise que des cookies indispensables au fonctionnement du site. Ils sont exemptés de consentement
          (article 82 de la loi Informatique et Libertés) : aucun bandeau n&apos;est donc nécessaire. Aucun cookie publicitaire,
          de mesure d&apos;audience ou de réseau social.
        </p>
        <table>
          <thead><tr><th>Cookie</th><th>Rôle</th><th>Durée</th></tr></thead>
          <tbody>
            <tr><td>rs_access</td><td>Garder ta session ouverte (jeton de connexion)</td><td>15 minutes, renouvelé</td></tr>
            <tr><td>rs_refresh</td><td>Renouveler ta session sans te reconnecter</td><td>30 jours</td></tr>
          </tbody>
        </table>
        <p>
          Les polices de caractères sont hébergées par RankGuess : ta visite n&apos;est pas transmise à un service tiers.
          Les boutons « Continuer avec Google / Discord » et la page de paiement Stripe ne déposent des cookies que lorsque tu les utilises.
        </p>
      </Section>
    </LegalPage>
  );
}
