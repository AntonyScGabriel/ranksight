import { media } from "@/lib/api";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Assombrit une couleur #rrggbb (dégradé de l'emblème). */
function shade(hex: string, factor: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = (shift: number) => Math.round(((n >> shift) & 255) * factor);
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

/**
 * Image d'un rang : celle envoyée depuis l'administration, sinon un emblème RankGuess
 * (hexagone aux couleurs du rang, numéro de palier au centre).
 */
export function RankEmblem({
  rank, size = 40, className = "",
}: { rank: { id?: string; name: string; color: string; order?: number; iconUrl?: string | null }; size?: number; className?: string }) {
  if (rank.iconUrl) {
    return <img src={media(rank.iconUrl)} alt="" width={size} height={size} className={`object-contain ${className}`} style={{ width: size, height: size }} />;
  }
  const gid = `g-${(rank.id ?? rank.name).replace(/[^a-zA-Z0-9]/g, "")}`;
  const label = rank.order !== undefined ? ROMAN[rank.order] ?? String(rank.order + 1) : rank.name.slice(0, 2).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={rank.color} />
          <stop offset="1" stopColor={shade(rank.color, 0.45)} />
        </linearGradient>
      </defs>
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill={`url(#${gid})`} />
      <polygon points="32,11 50,21.5 50,42.5 32,53 14,42.5 14,21.5" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
      <polygon points="32,3 38,8 32,13 26,8" fill="rgba(255,255,255,0.85)" />
      <text x="32" y="38.5" textAnchor="middle" fontSize={label.length > 2 ? 13 : 16} fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-display)" }}>
        {label}
      </text>
    </svg>
  );
}
