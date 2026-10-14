import type { Metadata } from "next";
import { MIN_AGE } from "@ranksight/shared";
import { LegalPage, Section } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions générales d'utilisation" };

export default function CguPage() {
  return (
    <LegalPage title="Conditions générales d'utilisation" current="/legal/cgu">
      <Section title="1. Objet">
        <p>
          Les présentes conditions encadrent l&apos;utilisation de RankGuess ({LEGAL.siteUrl}) et de ses applications mobiles :
          un jeu gratuit où l&apos;on devine le rang d&apos;un joueur à partir d&apos;un clip vidéo. Créer un compte vaut acceptation de ces
          conditions. En cas de modification, la nouvelle version est présentée à la connexion et doit être acceptée pour continuer.
        </p>
      </Section>
      <Section title="2. Compte">
        <ul>
          <li>Il faut avoir au moins {MIN_AGE} ans pour créer un compte.</li>
          <li>Un seul compte par personne. Le pseudo ne doit pas être injurieux, trompeur ni usurper l&apos;identité d&apos;autrui.</li>
          <li>Tu es responsable de la confidentialité de ton mot de passe. Active la double authentification si elle t&apos;est proposée.</li>
          <li>Un compte créé avec une adresse email est activé quand l&apos;adresse est confirmée (lien envoyé à l&apos;inscription, valable 48 heures).</li>
          <li>Tu peux supprimer ton compte à tout moment depuis ton profil.</li>
        </ul>
      </Section>
      <Section title="3. Règles de jeu et de conduite">
        <ul>
          <li>Interdits : triche, exploitation d&apos;une faille, automatisation (robots, scripts), comptes multiples pour fausser les classements.</li>
          <li>Interdits dans le chat et les messages : harcèlement, insultes, propos haineux ou discriminatoires, contenus sexuels, spam, publicité, partage d&apos;informations personnelles d&apos;autrui.</li>
          <li>Tout joueur peut signaler un message ou un profil, et bloquer un autre joueur.</li>
        </ul>
        <p>
          En cas de manquement, l&apos;équipe peut supprimer un contenu, couper l&apos;accès au chat, remettre à zéro les statistiques
          (faille exploitée, triche), suspendre ou supprimer le compte. Les achats déjà consommés ne sont pas remboursés en cas
          de sanction pour manquement grave.
        </p>
      </Section>
      <Section title="4. Clips proposés par les joueurs">
        <ul>
          <li>Tu ne proposes que des clips que tu as enregistrés toi-même, ou pour lesquels tu as l&apos;accord de leur auteur et des personnes visibles ou audibles.</li>
          <li>Le pseudo, le rang et toute information personnelle doivent être masqués dans la vidéo.</li>
          <li>
            En proposant un clip, tu accordes à l&apos;éditeur une licence gratuite, non exclusive et mondiale pour l&apos;héberger, le compresser,
            l&apos;afficher dans le jeu et le montrer aux autres joueurs, pour toute la durée de sa présence sur RankGuess.
            Tu peux le retirer à tout moment depuis « Mes clips ».
          </li>
          <li>Les clips sont vérifiés avant publication ; l&apos;équipe peut les refuser, les modifier (rang, difficulté) ou les retirer.</li>
          <li>Les images des jeux appartiennent à leurs éditeurs ; RankGuess les utilise dans le cadre de leurs règles pour les créations de fans.</li>
        </ul>
      </Section>
      <Section title="5. VIP">
        <p>
          Le VIP est un avantage optionnel (bonus d&apos;XP, badge) vendu selon les <a href="/legal/cgv">conditions générales de vente</a>.
          Il ne donne aucun avantage sur les classements.
        </p>
      </Section>
      <Section title="6. Disponibilité et responsabilité">
        <p>
          Le service est fourni gratuitement, en l&apos;état. L&apos;éditeur fait ses meilleurs efforts pour qu&apos;il soit disponible et sûr,
          mais peut l&apos;interrompre pour maintenance ou le faire évoluer (modes de jeu, saisons, récompenses). Les classements,
          niveaux et succès n&apos;ont aucune valeur monétaire.
        </p>
      </Section>
      <Section title="7. Données personnelles">
        <p>Voir la <a href="/legal/confidentialite">politique de confidentialité</a>.</p>
      </Section>
      <Section title="8. Droit applicable">
        <p>
          Ces conditions sont soumises au droit français. En cas de litige, une solution amiable est recherchée d&apos;abord
          (page <a href="/contact">Contact</a>) ; à défaut, les tribunaux français sont compétents, sous réserve des règles
          protectrices applicables aux consommateurs.
        </p>
      </Section>
    </LegalPage>
  );
}
