import { LinearGradient } from "expo-linear-gradient";
import { Alert, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { BADGE_ICONS, type BadgeIcon, type CosmeticRefDto, type FlairDto } from "@ranksight/shared";
import { colors } from "@/lib/theme";

/** Icône d'un badge (traits de la couleur du badge) */
export function CosmeticIcon({ icon, color, size = 14 }: { icon: string | null; color: string; size?: number }) {
  const def = icon ? BADGE_ICONS[icon as BadgeIcon] : undefined;
  if (!def) return null;
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {def.paths.map((d) => <Path key={d} d={d} />)}
    </Svg>
  );
}

/** Badge équipé, à côté du pseudo (un appui affiche comment il s'obtient) */
export function BadgeChip({ badge, size = 13 }: { badge: Pick<CosmeticRefDto, "name" | "color" | "icon"> & { hint?: string }; size?: number }) {
  const chip = (
    <View
      style={{
        width: size + 8, height: size + 8, borderRadius: 6, alignItems: "center", justifyContent: "center",
        backgroundColor: `${badge.color}1f`, borderWidth: 1, borderColor: `${badge.color}66`,
      }}
    >
      <CosmeticIcon icon={badge.icon} color={badge.color} size={size} />
    </View>
  );
  if (!badge.hint) return <View accessibilityLabel={`Badge ${badge.name}`}>{chip}</View>;
  const hint = badge.hint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Badge ${badge.name} : ${hint}`}
      hitSlop={6}
      onPress={() => Alert.alert(`Badge « ${badge.name} »`, hint)}
    >
      {chip}
    </Pressable>
  );
}

/** Titre équipé, sous le pseudo */
export function TitleText({ title, size = 11 }: { title: Pick<CosmeticRefDto, "name" | "color">; size?: number }) {
  return (
    <Text numberOfLines={1} style={{ color: title.color, fontSize: size, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
      {title.name}
    </Text>
  );
}

/** Anneau d'un cadre (dégradé si deux couleurs) */
export function FrameRing({ frame, size, ring, children }: { frame: Pick<CosmeticRefDto, "color" | "color2">; size: number; ring: number; children?: React.ReactNode }) {
  return (
    <LinearGradient
      colors={[frame.color, frame.color2 ?? frame.color]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", padding: ring }}
    >
      {children ?? <View style={{ width: size - ring * 2, height: size - ring * 2, borderRadius: size / 2, backgroundColor: colors.surface }} />}
    </LinearGradient>
  );
}

/** Badge équipé (s'il y en a un), à placer juste après le pseudo */
export function FlairBadge({ flair, size }: { flair: FlairDto | undefined; size?: number }) {
  return flair?.badge ? <BadgeChip badge={flair.badge} size={size} /> : null;
}

/** Aperçu d'une récompense quel que soit son type */
export function CosmeticVisual({ item, size = 14 }: { item: CosmeticRefDto; size?: number }) {
  if (item.type === "BADGE") return <BadgeChip badge={item} size={size} />;
  if (item.type === "FRAME") return <FrameRing frame={item} size={size + 18} ring={Math.max(3, Math.round(size / 4))} />;
  return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.color }} />;
}
