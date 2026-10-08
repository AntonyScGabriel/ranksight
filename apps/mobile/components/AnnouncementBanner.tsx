import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { AnnouncementDto } from "@ranksight/shared";
import { api, WEB_URL } from "@/lib/api";
import { colors, radius } from "@/lib/theme";

const CLOSED_KEY = "rg_announcement_closed";
const TONE: Record<AnnouncementDto["tone"], string> = { info: colors.violet, event: colors.neon, warning: colors.warn };

/** Annonce de l'équipe (maintenance, nouvelle saison, événement), fermable jusqu'à la suivante. */
export function AnnouncementBanner() {
  const [a, setA] = useState<AnnouncementDto | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { announcement } = await api.announcement();
      const closed = await SecureStore.getItemAsync(CLOSED_KEY).catch(() => null);
      if (alive && announcement && announcement.id !== closed) setA(announcement);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!a) return null;
  const color = TONE[a.tone];
  const close = () => {
    void SecureStore.setItemAsync(CLOSED_KEY, a.id).catch(() => undefined);
    setA(null);
  };
  const open = () => a.link && void WebBrowser.openBrowserAsync(a.link.startsWith("/") ? `${WEB_URL}${a.link}` : a.link);

  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", borderWidth: 1, borderColor: `${color}66`, backgroundColor: `${color}1f`, borderRadius: radius.card, padding: 12 }}>
      <Pressable onPress={a.link ? open : undefined} style={{ flex: 1 }} accessibilityRole={a.link ? "link" : "text"}>
        <Text style={{ color: a.tone === "warning" ? colors.warn : colors.ink, lineHeight: 20 }}>
          {a.text}
          {a.link ? <Text style={{ fontWeight: "700", textDecorationLine: "underline" }}>  En savoir plus</Text> : null}
        </Text>
      </Pressable>
      <Pressable onPress={close} accessibilityLabel="Fermer l'annonce" hitSlop={10}>
        <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
      </Pressable>
    </View>
  );
}
