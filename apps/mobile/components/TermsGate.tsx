import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { MIN_AGE } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { Checkbox, WebLink } from "./Checkbox";
import { PrimaryButton } from "./ui";

/** CGU modifiées, ou compte créé avec Google/Discord : acceptation demandée avant de continuer. */
export function TermsGate() {
  const { me, refresh } = useSession();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || me.termsAccepted) return null;

  const accept = async () => {
    setError(null);
    try {
      await api.acceptTerms();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 14 }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>Conditions d&apos;utilisation</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Pour continuer à jouer, merci de lire et d&apos;accepter nos conditions d&apos;utilisation et notre politique de confidentialité.
          </Text>
          <Checkbox checked={checked} onChange={setChecked}>
            J&apos;ai {MIN_AGE} ans ou plus et j&apos;accepte les <WebLink path="/legal/cgu">conditions d&apos;utilisation</WebLink> et la{" "}
            <WebLink path="/legal/confidentialite">politique de confidentialité</WebLink>.
          </Checkbox>
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
          <PrimaryButton label="Continuer" onPress={accept} disabled={!checked} />
        </View>
      </View>
    </Modal>
  );
}
