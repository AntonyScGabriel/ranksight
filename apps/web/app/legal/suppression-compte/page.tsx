import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/LegalPage";
import { LEGAL, orMissing } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Supprimer son compte",
  description: "Comment supprimer ton compte RankGuess et ce qu'il advient de tes données.",
};

export default function AccountDeletionPage() {
  return (
    <LegalPage title="Supprimer son compte" current="/legal/suppression-compte">
      <Section title="Depuis l'application ou le site">
        <ol>
          <li>Connecte-toi à ton compte RankGuess (application Android ou site).</li>
          <li>Ouvre ton <a href="/profile">profil</a>.</li>
          <li>Choisis « Supprimer mon compte » et confirme.</li>
        </ol>
        <p>La suppression est immédiate et définitive.</p>
      </Section>
      <Section title="Sans accès à ton compte">
        <p>
          Écris-nous depuis la page <a href="/contact">Contact</a> ou à {orMissing(LEGAL.email)}, depuis l&apos;adresse email de ton
          compte, en indiquant ton pseudo. Nous supprimons le compte sous 30 jours au plus et te le confirmons par email.
        </p>
      </Section>
      <Section title="Ce qui est supprimé">
        <ul>
          <li>Pseudo, adresse email, mot de passe (stocké sous forme chiffrée), photo de profil et connexions Google ou Discord.</li>
          <li>Amis, messages privés, sessions et appareils connectés, notifications.</li>
          <li>Tes clips proposés et leurs vidéos.</li>
        </ul>
      </Section>
      <Section title="Ce qui est conservé">
        <ul>
          <li>Tes réponses aux clips, sans aucun lien avec toi, pour que les statistiques des clips restent justes.</li>
          <li>Les preuves d&apos;achat VIP (date, produit, montant, numéro de commande) pendant 10 ans, par obligation comptable.</li>
        </ul>
        <p>Le VIP en cours est perdu à la suppression du compte et n&apos;est pas remboursé.</p>
      </Section>
    </LegalPage>
  );
}
