import Link from "next/link";
import { ROOM_MODE_LABEL, ROOM_VISIBILITY_LABEL, formatRoomCode, type RoomSummaryDto } from "@ranksight/shared";

/** Partie de salon terminée : jeu, mode, visibilité, hôte et place du joueur */
export function RecentRoom({ r }: { r: RoomSummaryDto }) {
  return (
    <li>
      <Link href={`/rooms/${r.id}`} className="glass flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-violet">
        <span className="text-sm">
          {r.game.name} · {ROOM_MODE_LABEL[r.mode]} · salon {ROOM_VISIBILITY_LABEL[r.visibility].toLowerCase()} de {r.host} · {r.players} joueurs
          <span className="ml-2 font-mono text-xs text-muted">{formatRoomCode(r.code)}</span>
        </span>
        <span className="text-sm font-semibold">
          {r.placement === 1 ? <span className="text-neon">Victoire</span> : r.placement ? `${r.placement}e place` : "Terminé"}
        </span>
      </Link>
    </li>
  );
}
