import Link from "next/link";

const LINKS: [string, string][] = [
  ["/how-to-play", "Comment jouer"],
  ["/faq", "FAQ"],
  ["/suggestions", "Suggestions"],
  ["/contact", "Contact"],
  ["/legal/mentions", "Mentions légales"],
  ["/legal/cgu", "CGU"],
  ["/legal/cgv", "CGV"],
  ["/legal/confidentialite", "Confidentialité"],
  ["/legal/cookies", "Cookies"],
];

export function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-28 pt-4 text-xs text-muted md:pb-10">
      <nav aria-label="Informations" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line/60 pt-6">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="hover:text-ink">{label}</Link>
        ))}
      </nav>
      <p className="mt-3">
        RankGuess est un projet indépendant, non affilié à Riot Games, Valve, Psyonix ou Epic Games. League of Legends, Valorant,
        Counter-Strike 2 et Rocket League sont des marques de leurs propriétaires respectifs.
      </p>
      {/* Mentions exigées par les règles des éditeurs pour les créations de fans (texte original, non traduit) */}
      <p className="mt-2" lang="en">
        RankGuess was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy using assets owned by Riot Games.
        Riot Games does not endorse or sponsor this project. Portions of the materials used are trademarks and/or copyrighted
        works of Epic Games, Inc. All rights reserved by Epic. This material is not official and is not endorsed by Epic.
      </p>
    </footer>
  );
}
