import { PROMO_REMOVAL_DAYS, PROMO_TERMS_VERSION } from "@ranksight/shared";
import { Section } from "@/components/LegalPage";

/**
 * Vidéos promotionnelles « Devine le rang » : texte validé (version 2 du projet relu par le juriste). Publié seulement
 * quand l'option est ouverte aux joueurs (PROMO_CONSENT_ENABLED=true au moment de la construction du site).
 */
export function PromoTermsSection() {
  return (
    <Section title="4 bis. Vidéos promotionnelles « Devine le rang » (facultatif)">
      <p className="text-xs text-muted">Version des conditions : {PROMO_TERMS_VERSION}</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Qui utilise les clips.</strong> Le bénéficiaire de l&apos;autorisation est l&apos;éditeur du site, identifié dans les{" "}
          <a href="/legal/mentions">mentions légales</a> (ci-après « l&apos;éditeur »).
        </li>
        <li>
          <strong>Objet.</strong> L&apos;éditeur publie sur les comptes officiels de RankSight des vidéos courtes au format « Devine le rang » : le clip
          est présenté, les spectateurs sont invités à deviner le rang du joueur, puis le rang réel est révélé.
        </li>
        <li>
          <strong>Un accord facultatif, explicite et séparé.</strong> Un clip n&apos;est utilisé que si son auteur a coché lui-même la case prévue, à
          l&apos;envoi du clip ou plus tard dans « Mes clips ». La case n&apos;est jamais cochée par défaut. Refuser, ou ne rien cocher, ne change rien à
          la publication du clip dans le jeu, à ton compte ni à tes avantages. Chaque accord est enregistré avec sa date et la version des présentes
          conditions. Un clip proposé par un lien (YouTube, Medal) ou ajouté par l&apos;équipe de RankSight n&apos;est jamais utilisé : l&apos;équipe ne
          peut pas donner d&apos;accord à la place de l&apos;auteur.
        </li>
        <li>
          <strong>Ce que tu autorises.</strong> En donnant ton accord pour un clip, tu accordes à l&apos;éditeur une licence gratuite et non exclusive,
          limitée aux utilisations suivantes : reproduire le clip dans des vidéos « Devine le rang » ; l&apos;adapter à ce format (découpage, recadrage
          vertical, ralenti ou arrêt sur image, ajout de textes, d&apos;un compte à rebours, d&apos;une musique libre de droits ou autorisée, du logo
          RankSight, du nom du jeu et du rang validé par la modération ; floutage, coupure ou remplacement du son si nécessaire) ; et diffuser ces
          vidéos en publications organiques, c&apos;est-à-dire non sponsorisées, sur les comptes officiels de RankSight sur TikTok, YouTube Shorts et
          Instagram Reels uniquement.
        </li>
        <li>
          <strong>Ce que tu n&apos;autorises pas.</strong> Aucune publicité payante (vidéo sponsorisée, promotion payante d&apos;une publication,
          campagne publicitaire) : elle demanderait un nouvel accord, distinct et explicite. Aucun autre réseau ou support que ceux cités ci-dessus.
          Aucune vente ni cession du clip à un tiers. Tu restes propriétaire de ton clip.
        </li>
        <li>
          <strong>Autres personnes et éléments présents dans le clip.</strong> Ton accord ne vaut que pour tes propres droits : il ne remplace pas
          l&apos;accord des autres personnes visibles ou audibles (coéquipiers, adversaires, voix en vocal, pseudos affichés…). Avant toute vidéo,
          l&apos;équipe vérifie le clip : voix et conversations, pseudos, identifiants, messages du chat, comptes et autres informations visibles ou
          audibles, musiques, images ou autres éléments protégés. Masquer un pseudo ne suffit pas à rendre une personne non identifiable. Si une
          autorisation nécessaire manque, l&apos;équipe coupe le son, floute ou retire l&apos;élément concerné, ou renonce à utiliser le clip. La présence
          d&apos;une musique ou d&apos;un élément protégé dans un clip ne donne aucun droit à l&apos;éditeur sur cet élément. Les images des jeux
          restent la propriété de leurs éditeurs et sont utilisées dans le respect de leurs règles pour les contenus créés par les joueurs.
        </li>
        <li>
          <strong>Ce qui n&apos;apparaît jamais.</strong> Les vidéos n&apos;affichent jamais ton pseudo RankSight, ton adresse email, ta région ni tes
          informations de compte. Elles indiquent seulement le jeu et le rang validé par la modération.
        </li>
        <li>
          <strong>Tes garanties.</strong> En donnant ton accord, tu confirmes que tu es l&apos;auteur du clip, ou que son auteur t&apos;a autorisé à le
          proposer, et que le clip respecte la section 4. Tu n&apos;as pas à garantir l&apos;accord des autres personnes présentes : leur cas est traité
          au point 6.
        </li>
        <li>
          <strong>Retrait de ton accord.</strong> Tu peux retirer ton accord à tout moment, sans justification, en décochant la case dans « Mes
          clips ». L&apos;accord prend fin aussi si tu supprimes le clip ou ton compte, ou si la modération refuse le clip ou le retire de la
          publication. À la fin de l&apos;accord, le clip n&apos;est plus transmis à l&apos;outil de production et n&apos;est plus jamais utilisé dans
          une nouvelle vidéo ; les vidéos en préparation qui l&apos;utilisent sont abandonnées et leurs fichiers supprimés ; l&apos;éditeur supprime de
          ses comptes officiels les vidéos déjà publiées qui utilisent ce clip, dans un délai de {PROMO_REMOVAL_DAYS} jours au plus.
        </li>
        <li>
          <strong>Copies faites par des tiers.</strong> L&apos;éditeur ne contrôle pas les réseaux sociaux. Une vidéo supprimée de ses comptes peut
          avoir été téléchargée, copiée ou republiée par d&apos;autres : l&apos;éditeur ne peut pas garantir la suppression de ces copies. Sur
          demande, il t&apos;aide à faire un signalement auprès du réseau concerné.
        </li>
        <li>
          <strong>Engagements de l&apos;éditeur.</strong> N&apos;utiliser que des clips acceptés par la modération, vérifiés au sens du point 6 et
          dont l&apos;auteur a donné son accord, avec le rang validé par la modération ; vérifier que l&apos;accord est toujours valable avant chaque
          nouvelle vidéo et avant chaque publication ; tenir compte d&apos;un retrait sans délai pour toute nouvelle production et supprimer les vidéos
          publiées dans le délai du point 9 ; conserver la trace des accords, des retraits, des utilisations, des publications et des suppressions,
          et te la communiquer sur demande ; traiter rapidement toute demande de retrait d&apos;une vidéo envoyée via la page{" "}
          <a href="/contact">Contact</a>, la tienne, celle d&apos;une personne présente dans le clip ou celle d&apos;un ayant droit. Aucune rémunération
          n&apos;est due pour l&apos;utilisation d&apos;un clip, et l&apos;éditeur ne s&apos;engage pas à publier un clip donné.
        </li>
        <li>
          <strong>Version des conditions.</strong> Chaque accord est lié à la version des présentes conditions en vigueur au moment où il est donné.
          Si elles changent de façon importante, l&apos;accord à la nouvelle version est redemandé avant toute nouvelle utilisation.
        </li>
      </ol>
    </Section>
  );
}
