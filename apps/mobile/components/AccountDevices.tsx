import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { colors } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { Hud } from "./ui";

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Profil : appareils connectés au compte, chacun déconnectable (celui-ci se ferme avec « Se déconnecter ») */
export function AccountDevices() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sessions().then(setSessions, () => setSessions([]));
  }, []);
  useEffect(load, [load]);

  const revoke = async (s: SessionDto) => {
    setError(null);
    try {
      await api.revokeSession(s.id);
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  return (
    <View style={{ gap: 8 }}>
      <Hud>Appareils connectés</Hud>
      {sessions === null ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Chargement…</Text>
      ) : (
        sessions.map((s) => (
          <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink }} numberOfLines={1}>
                {s.device}
                {s.current ? <Text style={{ color: colors.success, fontSize: 12 }}>  · cet appareil</Text> : null}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Connecté le {when(s.createdAt)} · actif le {when(s.lastActiveAt)}</Text>
            </View>
            {!s.current && (
              <Pressable onPress={() => revoke(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Déconnecter ${s.device}`}>
                <Text style={{ color: colors.danger, fontSize: 13 }}>Déconnecter</Text>
              </Pressable>
            )}
          </View>
        ))
      )}
      {error && <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}
