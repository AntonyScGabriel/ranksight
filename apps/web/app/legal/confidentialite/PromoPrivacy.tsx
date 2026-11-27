import { PROMO_REMOVAL_DAYS } from "@ranksight/shared";

/** Vidéos promotionnelles : lignes ajoutées au tableau des données (texte validé, publié avec l'option) */
export function PromoPrivacyRows() {
  return (
    <>
      <tr>
        <td>Accord ou retrait pour la promotion d&apos;un clip (identifiant du clip et de ton compte, date, version des conditions, motif d&apos;un retrait)</td>
        <td>Prouver ton accord et respecter son retrait</td>
        <td>Consentement pour l&apos;utilisation du clip ; intérêt légitime pour la conservation de la preuve</td>
      </tr>
      <tr>
        <td>Utilisations promotionnelles d&apos;un clip (référence de la vidéo produite, date, version de l&apos;accord, rang au moment de l&apos;utilisation)</td>
        <td>Savoir quelles vidéos utilisent un clip</td>
        <td>Intérêt légitime</td>
      </tr>
      <tr>
        <td>Publications des vidéos promotionnelles (réseau, lien, date) et demandes de suppression avec leur traitement</td>
        <td>Retirer les vidéos après un retrait</td>
        <td>Intérêt légitime, respect de ton retrait</td>
      </tr>
      <tr>
        <td>Journaux techniques de l&apos;outil de production des vidéos (appels, clips transmis)</td>
        <td>Sécurité, contrôle des accès</td>
        <td>Intérêt légitime</td>
      </tr>
    </>
  );
}

/** Vidéos promotionnelles : durées de conservation (texte validé, publié avec l'option) */
export function PromoRetentionItems() {
  return (
    <>
      <li>
        Vidéos promotionnelles : l&apos;outil de production reçoit seulement le clip, le jeu, le rang validé, la durée, la version et la date de
        l&apos;accord et l&apos;indication « son coupé », jamais ton identité, tes pseudos, ton email, ta région, la preuve de rang ni tes notes.
      </li>
      <li>Fichier du clip chez l&apos;outil de production : supprimé juste après le montage, et en tout cas dans les 24 heures.</li>
      <li>Vidéos produites non publiées : supprimées dès la fin de l&apos;accord ou l&apos;abandon de la vidéo.</li>
      <li>Copie locale d&apos;une vidéo publiée chez l&apos;outil de production : supprimée après 30 jours, ou dès la fin de l&apos;accord.</li>
      <li>Vidéos sur les comptes officiels : supprimées sous {PROMO_REMOVAL_DAYS} jours au plus après la fin de l&apos;accord.</li>
      <li>
        Preuves d&apos;accord, de retrait, d&apos;utilisation, de publication et de suppression : 5 ans après la fin de l&apos;accord ou la
        suppression du clip, sans aucun fichier vidéo.
      </li>
      <li>Journaux techniques de l&apos;outil de production : 12 mois.</li>
    </>
  );
}
