import Link from "next/link";

/** Lien vers le profil public d'un joueur (classement, chat, amis, duels). */
export function PlayerLink({ id, children, className = "" }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={`/players/${id}`} className={`hover:underline ${className}`} title="Voir le profil">
      {children}
    </Link>
  );
}
