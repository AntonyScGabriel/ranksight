import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/LegalPage";
import { LEGAL, orMissing } from "@/lib/legal";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Politique de confidentialité" current="/legal/confidentialite">
      <Section title="Responsable du traitement">
        <p>{orMissing(LEGAL.publisherName)}, {orMissing(LEGAL.address)} — contact : {orMissing(LEGAL.email)}.</p>
      </Section>
      <Section title="Données collectées et utilisation">
        <table>
          <thead><tr><th>Données</th><th>Pourquoi</th><th>Base légale</th></tr></thead>
          <tbody>
            <tr><td>Pseudo, email, mot de passe (stocké haché, jamais en clair), photo de profil (envoyée par toi, sans métadonnées, ou avatar Google ou Discord)</td><td>Créer et sécuriser ton compte</td><td>Contrat (CGU)</td></tr>
            <tr><td>Réponses, scores, séries, succès, duels, titres et badges</td><td>Faire fonctionner le jeu et les classements</td><td>Contrat</td></tr>
            <tr><td>Messages du chat et messages privés</td><td>Discuter entre joueurs, modérer</td><td>Contrat, intérêt légitime (sécurité)</td></tr>
            <tr><td>Clips proposés (vidéo, pseudo en jeu, plateforme, région)</td><td>Publier tes clips après vérification</td><td>Contrat</td></tr>
            <tr><td>Adresse IP, appareil, journaux de connexion</td><td>Sécurité, lutte contre la triche et les abus</td><td>Intérêt légitime, obligation légale</td></tr>
            <tr><td>Achats VIP (montant, date ; jamais les données de carte)</td><td>Vente et comptabilité</td><td>Contrat, obligation légale</td></tr>
            <tr><td>Jeton de notification du téléphone</td><td>T&apos;envoyer les notifications que tu as acceptées</td><td>Consentement</td></tr>
          </tbody>
        </table>
        <p>Aucune donnée n&apos;est vendue. Aucune publicité ciblée ni outil de mesure d&apos;audience tiers.</p>
      </Section>
      <Section title="Durées de conservation">
        <ul>
          <li>Compte : tant qu&apos;il est actif. À la suppression, il est anonymisé immédiatement (pseudo, email, connexions effacés) ; les réponses restent dans les statistiques des clips, sans lien avec toi.</li>
          <li>Clips refusés : vidéo supprimée 14 jours après le refus. Clips retirés : vidéo supprimée immédiatement.</li>
          <li>Photo de profil : supprimée dès que tu la changes ou la retires, ou à la suppression du compte.</li>
          <li>Journaux de connexion et de modération : 1 an.</li>
          <li>Données de facturation : 10 ans (obligation comptable).</li>
        </ul>
      </Section>
      <Section title="Destinataires et sous-traitants">
        <ul>
          <li>Hébergement : {orMissing(LEGAL.hostName)}.</li>
          <li>Stockage des vidéos : Cloudflare (R2).</li>
          <li>Paiement : Stripe (achats VIP sur le site) et Google Play (achats dans l&apos;application Android). RankGuess reçoit seulement la preuve d&apos;achat (numéro de commande, produit, date), jamais tes données bancaires.</li>
          <li>Envoi des emails : le prestataire d&apos;emails de l&apos;éditeur.</li>
          <li>Connexion facultative avec Google ou Discord, selon leurs propres politiques.</li>
          <li>Suivi des erreurs techniques (sans données personnelles), s&apos;il est activé.</li>
        </ul>
        <p>Certains prestataires peuvent traiter des données hors de l&apos;Union européenne, encadrés par les clauses contractuelles types de la Commission européenne.</p>
      </Section>
      <Section title="Tes droits">
        <p>
          Accès, rectification, effacement, limitation, opposition, portabilité, et directives après décès. Tu peux supprimer ton
          compte toi-même depuis ton profil. Pour exercer tes autres droits : page <a href="/contact">Contact</a> ou {orMissing(LEGAL.email)}.
          Tu peux introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr">cnil.fr</a>).
        </p>
      </Section>
      <Section title="Sécurité">
        <p>
          Connexions chiffrées (HTTPS), mots de passe hachés (scrypt), double authentification pour l&apos;équipe, secrets
          chiffrés en base, accès de l&apos;équipe journalisés, sauvegardes régulières.
        </p>
      </Section>
    </LegalPage>
  );
}
