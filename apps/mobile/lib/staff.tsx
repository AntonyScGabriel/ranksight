import { createContext, useCallback, useContext, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { api, ApiError } from "./api";
import { colors, radius } from "./theme";

type Guard = <T>(action: () => Promise<T>) => Promise<T>;
const StaffGuardContext = createContext<Guard>((action) => action());

/**
 * Actions de modération depuis l'application : comme dans l'administration, la double authentification est demandée
 * (une fois par session et par 12 heures). L'action est relancée après la saisie du code.
 */
export function StaffGuardProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<((ok: boolean) => void) | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const guard = useCallback<Guard>(async (action) => {
    try {
      return await action();
    } catch (e) {
      if (e instanceof ApiError && e.code === "MFA_SETUP_REQUIRED") {
        throw new ApiError(403, e.code, "Active d'abord la double authentification : Profil → Administration → Sécurité du compte.");
      }
      if (!(e instanceof ApiError && e.code === "MFA_REQUIRED")) throw e;
      const ok = await new Promise<boolean>((resolve) => setAsk(() => resolve));
      if (!ok) throw new ApiError(403, "CANCELLED", "Action annulée.");
      return action();
    }
  }, []);

  const close = (ok: boolean) => {
    ask?.(ok);
    setAsk(null);
    setCode("");
    setError(null);
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await api.mfaVerify(code);
      close(true);
    } catch (e) {
      setError(e instanceof ApiError && e.message ? e.message : "Code incorrect.");
      setCode("");
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffGuardContext.Provider value={guard}>
      {children}
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => close(false)}>
        <Pressable onPress={() => close(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 20, gap: 12 }}>
            <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}>Double authentification</Text>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              Saisis le code à 6 chiffres de ton application d&apos;authentification (ou un code de secours) pour continuer.
            </Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.trim())}
              autoFocus
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              keyboardType="default"
              textContentType="oneTimeCode"
              placeholder="123456"
              placeholderTextColor={colors.muted}
              style={{
                color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line,
                fontSize: 22, letterSpacing: 6, textAlign: "center",
              }}
            />
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
              <Pressable onPress={() => close(false)} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.line }}>
                <Text style={{ color: colors.ink }}>Annuler</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={pending || code.length < 6}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.violet, opacity: pending || code.length < 6 ? 0.5 : 1 }}
              >
                <Text style={{ color: "white", fontWeight: "700" }}>{pending ? "Vérification…" : "Valider"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </StaffGuardContext.Provider>
  );
}

export const useStaffGuard = () => useContext(StaffGuardContext);
