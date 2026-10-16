import { Pressable, Text, View } from "react-native";
import { colors, radius } from "@/lib/theme";

/** Choix parmi quelques valeurs (jeu, manches, temps) */
export function Chips<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.chip, borderWidth: 1.5, borderColor: active ? colors.neon : colors.line, backgroundColor: active ? `${colors.neon}1A` : colors.surface2 }}
          >
            <Text style={{ color: active ? colors.neon : colors.ink, fontWeight: "600" }}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
