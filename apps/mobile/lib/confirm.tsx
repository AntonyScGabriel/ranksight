import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { colors, radius } from "./theme";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Action irréversible : bouton rouge */
  danger?: boolean;
  /** Texte à retaper pour activer le bouton (ex. le pseudo avant de supprimer son compte) */
  requireText?: string;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<string | false>>(async () => false);

/** Fenêtre de confirmation de l'application. `await confirm({...})` renvoie false si annulé, sinon le texte saisi. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((v: string | false) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setText("");
    setOptions(o);
    return new Promise<string | false>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: string | false) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const blocked = !!options?.requireText && text.trim().toLowerCase() !== options.requireText.toLowerCase();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal visible={!!options} transparent animationType="fade" onRequestClose={() => close(false)}>
        <Pressable onPress={() => close(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 24 }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 20, gap: 12 }}>
            <Text style={{ color: colors.ink, fontSize: 19, fontWeight: "700" }}>{options?.title}</Text>
            {options?.message ? <Text style={{ color: colors.muted, lineHeight: 20 }}>{options.message}</Text> : null}
            {options?.requireText ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: colors.ink }}>Tape « {options.requireText} » pour confirmer</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line }}
                />
              </View>
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
              <Pressable onPress={() => close(false)} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.line }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>Annuler</Text>
              </Pressable>
              <Pressable
                disabled={blocked}
                onPress={() => close(text)}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: options?.danger ? colors.danger : colors.violet, opacity: blocked ? 0.4 : 1 }}
              >
                <Text style={{ color: "white", fontWeight: "700" }}>{options?.confirmLabel ?? "Confirmer"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
