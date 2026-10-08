import { useCallback, useState } from "react";
import { Linking, Share, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { adminApi } from "@/lib/admin";
import { colors, radius } from "@/lib/theme";
import { Card, Loading, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { Field, NoticeText, SmallButton, formatDate, useAdminAction } from "@/components/admin/AdminUi";

type Status = Awaited<ReturnType<typeof adminApi.mfaStatus>>;

/**
 * Double authentification du compte (obligatoire pour l'administration en production) : activable depuis le téléphone
 * avec une application d'authentification (Google Authenticator, Microsoft Authenticator, 2FAS…).
 */
export default function AdminSecurity() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(() => {
    void run(async () => setStatus(await adminApi.mfaStatus()));
  }, [run]);
  useFocusEffect(load);

  const start = async () => {
    const r = await run(() => adminApi.mfaSetup());
    if (r) setSetup(r);
  };

  const openApp = async () => {
    if (!setup) return;
    try {
      await Linking.openURL(setup.uri);
    } catch {
      setNotice({ text: "Aucune application d'authentification trouvée : installe-en une, ou recopie la clé à la main.", ok: false });
    }
  };

  const enable = async () => {
    const r = await run(() => adminApi.mfaEnable(code.trim()), "Double authentification activée.");
    if (r) {
      setRecovery(r.recoveryCodes);
      setSetup(null);
      setCode("");
      load();
    }
  };

  if (!status) return notice ? <View style={{ padding: 16 }}><NoticeText notice={notice} /></View> : <Loading />;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <NoticeText notice={notice} onPress={() => setNotice(null)} />

      {recovery && (
        <Card style={{ gap: 10, borderColor: colors.warn }}>
          <Text style={{ color: colors.warn, fontSize: 17, fontWeight: "700" }}>Codes de secours</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Garde-les en lieu sûr (gestionnaire de mots de passe). Chacun remplace une fois le code de l&apos;application si tu perds ton
            téléphone. Ils ne seront plus affichés.
          </Text>
          <Text selectable style={{ color: colors.ink, fontFamily: "monospace", letterSpacing: 1, lineHeight: 24 }}>{recovery.join("\n")}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SmallButton label="Partager / enregistrer" onPress={() => void Share.share({ message: `Codes de secours RankGuess :\n${recovery.join("\n")}` })} />
            <SmallButton label="C'est noté" onPress={() => setRecovery(null)} />
          </View>
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Double authentification</Text>
        {status.enabled ? (
          <>
            <Text style={{ color: colors.success }}>Activée{status.enabledAt ? ` depuis le ${formatDate(status.enabledAt)}` : ""}.</Text>
            <Text style={{ color: colors.muted }}>Codes de secours restants : {status.recoveryCodesLeft}</Text>
            <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
              Le code est demandé une fois par session (puis toutes les 12 heures) avant une action d&apos;administration.
            </Text>
          </>
        ) : setup ? (
          <>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              1. Ajoute le compte dans ton application d&apos;authentification (bouton ci-dessous, ou clé à recopier).{"\n"}
              2. Saisis le code à 6 chiffres qu&apos;elle affiche.
            </Text>
            <SmallButton label="Ouvrir l'application d'authentification" onPress={() => void openApp()} />
            <View style={{ backgroundColor: colors.surface2, borderRadius: radius.chip, padding: 12, gap: 4 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Clé (à recopier si besoin)</Text>
              <Text selectable style={{ color: colors.ink, fontFamily: "monospace", letterSpacing: 1 }}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</Text>
            </View>
            <Field label="Code à 6 chiffres" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" />
            <PrimaryButton label={busy ? "…" : "Activer"} onPress={() => void enable()} disabled={busy || code.length !== 6} />
          </>
        ) : (
          <>
            <Text style={{ color: status.required ? colors.warn : colors.muted, lineHeight: 20 }}>
              {status.required
                ? "Obligatoire pour accéder à l'administration : active-la maintenant."
                : "Recommandée pour protéger ton compte de l'équipe."}
            </Text>
            <PrimaryButton label={busy ? "…" : "Activer la double authentification"} onPress={() => void start()} disabled={busy} />
          </>
        )}
      </Card>
    </KeyboardScroll>
  );
}
