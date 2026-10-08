import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/LegalPage";
import { LEGAL, orMissing } from "@/lib/legal";

export const metadata: Metadata = { title: "Mentions légales" };

export default function MentionsPage() {
  return (
    <LegalPage title="Mentions légales" current="/legal/mentions">
      <Section title="Éditeur du site">
        <ul>
          <li>Nom ou raison sociale : {orMissing(LEGAL.publisherName)}</li>
          <li>Statut : {orMissing(LEGAL.publisherStatus)}</li>
          <li>Adresse : {orMissing(LEGAL.address)}</li>
          <li>Email : {orMissing(LEGAL.email)}</li>
          <li>SIRET : {orMissing(LEGAL.siret)}</li>
          <li>{LEGAL.vatNote}</li>
          <li>Directeur de la publication : {orMissing(LEGAL.director)}</li>
        </ul>
      </Section>
      <Section title="Hébergement">
        <ul>
          <li>Hébergeur : {orMissing(LEGAL.hostName)}</li>
          <li>Adresse : {orMissing(LEGAL.hostAddress)}</li>
          <li>Contact : {orMissing(LEGAL.hostContact)}</li>
        </ul>
      </Section>
      <Section title="Propriété intellectuelle">
        <p>
          Le nom RankGuess, la charte graphique, les emblèmes de rang par défaut et le code du site appartiennent à l&apos;éditeur.
          League of Legends et Valorant sont des marques de Riot Games, Inc. ; Counter-Strike 2 est une marque de Valve Corporation ;
          Rocket League est une marque de Psyonix LLC (Epic Games). RankGuess est un projet indépendant, ni approuvé ni sponsorisé par ces éditeurs.
        </p>
        <p lang="en">
          RankGuess was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy using assets owned by Riot Games.
          Riot Games does not endorse or sponsor this project.
        </p>
        <p lang="en">
          Portions of the materials used are trademarks and/or copyrighted works of Epic Games, Inc. All rights reserved by Epic.
          This material is not official and is not endorsed by Epic.
        </p>
        <p>
          Les clips proposés par les joueurs restent la propriété de leurs auteurs, qui accordent à RankGuess une licence d&apos;utilisation
          décrite dans les <a href="/legal/cgu">conditions d&apos;utilisation</a>. Pour signaler un contenu qui porte atteinte à vos droits,
          écrivez-nous via la page <a href="/contact">Contact</a> en précisant le clip concerné : il sera retiré rapidement.
        </p>
      </Section>
      <Section title="Signaler un contenu illicite">
        <p>
          Chaque clip, message et profil peut être signalé depuis le jeu. Vous pouvez aussi nous écrire via la page <a href="/contact">Contact</a>.
          Les signalements sont examinés par l&apos;équipe de modération.
        </p>
      </Section>
    </LegalPage>
  );
}
