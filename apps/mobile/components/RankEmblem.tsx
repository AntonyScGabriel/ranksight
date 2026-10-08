import { Image } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, Stop, Text as SvgText } from "react-native-svg";
import { media } from "@/lib/api";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function shade(hex: string, factor: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = (shift: number) => Math.round(((n >> shift) & 255) * factor);
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

/** Image d'un rang (envoyée depuis l'administration) ou emblème RankGuess aux couleurs du rang. */
export function RankEmblem({
  rank, size = 36,
}: { rank: { id?: string; name: string; color: string; order?: number; iconUrl?: string | null }; size?: number }) {
  if (rank.iconUrl) return <Image source={{ uri: media(rank.iconUrl) }} style={{ width: size, height: size }} resizeMode="contain" />;
  const gid = `g${(rank.id ?? rank.name).replace(/[^a-zA-Z0-9]/g, "")}`;
  const label = rank.order !== undefined ? ROMAN[rank.order] ?? String(rank.order + 1) : rank.name.slice(0, 2).toUpperCase();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={rank.color} />
          <Stop offset="1" stopColor={shade(rank.color, 0.45)} />
        </LinearGradient>
      </Defs>
      <Polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill={`url(#${gid})`} />
      <Polygon points="32,11 50,21.5 50,42.5 32,53 14,42.5 14,21.5" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
      <Polygon points="32,3 38,8 32,13 26,8" fill="rgba(255,255,255,0.85)" />
      <SvgText x="32" y="38.5" textAnchor="middle" fontSize={label.length > 2 ? 13 : 16} fontWeight="800" fill="#ffffff">
        {label}
      </SvgText>
    </Svg>
  );
}
