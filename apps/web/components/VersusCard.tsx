import Link from "next/link";
import { VERSUS_STATUS_LABEL, type VersusMatchDto } from "@ranksight/shared";
import { Avatar } from "./Header";
import { FlairBadge } from "./Flair";

const RESULT: Record<string, [string, string]> = {
  me: ["Victoire", "bg-success/15 text-success"],
  opponent: ["Défaite", "bg-danger/15 text-danger"],
  draw: ["Égalité", "bg-white/10 text-ink"],
};

/** Résumé d'un duel dans les listes. */
export function VersusCard({ m, actions }: { m: VersusMatchDto; actions?: React.ReactNode }) {
  const [label, style] = m.result ? RESULT[m.result] : [VERSUS_STATUS_LABEL[m.status], m.status === "ACTIVE" ? "bg-neon/15 text-neon" : "bg-violet/20 text-violet-soft"];
  const opponentName = m.opponent?.displayName ?? "Adversaire au hasard";
  const played = m.status === "ACTIVE" || m.status === "FINISHED";
  return (
    <li className="glass flex flex-wrap items-center gap-4 p-4">
      <Avatar name={opponentName} url={m.opponent?.avatarUrl ?? null} size={40} frame={m.opponent?.flair.frame} />
      <Link href={`/versus/${m.id}`} className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 font-medium">
          Toi <span className="text-muted">contre</span> {opponentName}
          {m.opponent && <FlairBadge flair={m.opponent.flair} size={12} />}
        </p>
        <p className="text-xs text-muted">
          {m.game?.name ?? "Tous les jeux"}
          {m.status === "ACTIVE" && m.live ? ` · manche ${m.live.round}/${m.rounds}` : ""}
          {m.forfeit ? " · abandon" : ""}
          {m.finishedAt ? ` · ${new Date(m.finishedAt).toLocaleDateString("fr-FR")}` : ""}
        </p>
      </Link>
      {played && m.opponent && <span className="font-mono text-sm">{m.me.score} – {m.opponent.score}</span>}
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>
      {actions}
    </li>
  );
}
