import type { Metadata } from "next";
import { MIN_AGE } from "@ranksight/shared";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Questions fréquentes" };

const QA: [string, React.ReactNode][] = [
  ["RankGuess est-il gratuit ?", "Oui. Tous les modes de jeu sont gratuits. Le VIP, optionnel, donne seulement un bonus d'XP et un badge."],
  ["À partir de quel âge peut-on jouer ?", `Il faut avoir au moins ${MIN_AGE} ans pour créer un compte.`],
  ["Je n'ai pas reçu l'email de confirmation.", "Vérifie tes courriers indésirables, puis utilise « Renvoyer l'email » dans le bandeau en haut du site. Le lien est valable 48 heures."],
  ["Pourquoi je ne peux pas écrire dans le chat ?", "Il faut d'abord confirmer ton adresse email. Si l'équipe a suspendu ton accès au chat, la date de fin est indiquée quand tu essaies d'écrire."],
  ["Mon compte est bloqué après plusieurs essais de mot de passe.", "Par sécurité, il est verrouillé 15 minutes après 10 mots de passe incorrects. Utilise « Mot de passe oublié » si besoin."],
  ["Comment proposer un clip ?", <>Depuis « Proposer un clip » : vidéo de 5 secondes à 1 minute, ton vrai rang, et ton pseudo en jeu (montré aux joueurs après leur réponse). Masque ton pseudo et ton rang dans la vidéo. Détails dans les <a href="/legal/cgu">conditions d&apos;utilisation</a>.</>],
  ["Mon clip a été refusé, pourquoi ?", "La raison est indiquée dans « Mes clips ». Le plus souvent : rang visible à l'écran, vidéo trop courte ou illisible."],
  ["Quelqu'un m'insulte, que faire ?", "Sur son profil ou sur le message : « Signaler » prévient l'équipe, « Bloquer » coupe tout contact (messages, demandes d'ami, duels)."],
  ["Le VIP se rembourse-t-il ?", <>Le VIP étant activé immédiatement, le droit de rétractation ne s&apos;applique pas une fois activé (voir les <a href="/legal/cgv">CGV</a>). En cas de problème d&apos;activation, contacte-nous. Un achat fait dans l&apos;application Android peut aussi être remboursé par Google Play, selon ses règles : les jours de VIP correspondants sont alors retirés.</>],
  ["Où acheter le VIP ?", "Sur le site (carte bancaire) ou dans l'application Android (Google Play). Le VIP est lié à ton compte : il vaut partout."],
  ["Comment offrir le VIP à un ami ?", <>Dans la <a href="/shop">boutique du site</a>, bouton « Offrir » sous le pass choisi : choisis un ami de ta liste (son VIP est activé dès le paiement) ou un code cadeau à lui transmettre.</>],
  ["J'ai reçu un code cadeau, comment l'utiliser ?", <>Connecte-toi sur le site, ouvre la <a href="/shop#code-cadeau">boutique</a> et saisis le code (RG-XXXX-XXXX-XXXX) dans « Tu as un code cadeau ? ». Les jours de VIP s&apos;ajoutent tout de suite.</>],
  ["Combien de défis du jour par jour ?", "3 clips par jeu, chaque jour, les mêmes pour tout le monde. Chaque défi se joue une seule fois ; ton score du jour additionne tous tes défis."],
  ["Puis-je mettre des accents dans mon pseudo ?", "Oui : lettres accentuées, chiffres, _ - et . (3 à 20 caractères). Deux pseudos qui ne diffèrent que par les accents ou les majuscules ne peuvent pas coexister."],
  ["Comment gagner le titre « Contributeur » ?", <>Fais accepter le plus de clips pendant la saison : l&apos;onglet « Contributeurs » des <a href="/leaderboard?period=contributors">classements</a> montre le classement en cours. Le premier reçoit le titre à la fin du mois.</>],
  ["J'ai une idée pour améliorer le jeu.", <>Envoie-la depuis la page <a href="/suggestions">Suggestions</a> : l&apos;équipe lit chaque idée et te répond sur la même page.</>],
  ["Comment obtenir un titre ou un badge ?", <>En montant de niveau, en débloquant certains succès ou en finissant en haut du classement (ou des contributeurs) d&apos;une saison ; d&apos;autres sont attribués par l&apos;équipe (créateurs de contenu…). La page <a href="/rewards">Récompenses</a> indique pour chacun comment l&apos;obtenir.</>],
  ["Comment supprimer mon compte ?", <>Depuis ton profil, « Supprimer mon compte ». Tes données personnelles sont effacées immédiatement (détails sur la page <a href="/legal/suppression-compte">Supprimer son compte</a>).</>],
  ["J'ai trouvé un bug ou une faille.", <>Merci ! Écris-nous via la page <a href="/contact">Contact</a> sans l&apos;exploiter. Exploiter une faille peut entraîner la remise à zéro des statistiques.</>],
];

export default function FaqPage() {
  return (
    <LegalPage title="Questions fréquentes">
      <div className="space-y-3">
        {QA.map(([q, a]) => (
          <details key={q} className="rounded-xl border border-line p-4 open:bg-surface-2">
            <summary className="cursor-pointer font-medium">{q}</summary>
            <div className="mt-2 text-sm text-ink/90">{a}</div>
          </details>
        ))}
      </div>
    </LegalPage>
  );
}
