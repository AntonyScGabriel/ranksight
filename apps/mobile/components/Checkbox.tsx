import { Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { WEB_URL } from "@/lib/api";
import { colors } from "@/lib/theme";

/** Case à cocher accessible (le texte peut contenir des liens). */
export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
    >
      <View
        style={{
          width: 22, height: 22, borderRadius: 6, borderWidth: 2, marginTop: 1,
          borderColor: checked ? colors.violet : colors.line, backgroundColor: checked ? colors.violet : "transparent",
          alignItems: "center", justifyContent: "center",
        }}
      >
        {checked && <Text style={{ color: "white", fontWeight: "800", fontSize: 13 }}>✓</Text>}
      </View>
      <Text style={{ flex: 1, color: colors.ink, lineHeight: 20 }}>{children}</Text>
    </Pressable>
  );
}

/** Lien vers une page du site (pages légales, contact), ouverte dans le navigateur intégré. */
export function WebLink({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <Text onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`)} style={{ color: colors.violetSoft, textDecorationLine: "underline" }}>
      {children}
    </Text>
  );
}
