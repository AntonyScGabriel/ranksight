import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Pseudo, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AccountSecurity } from "@/components/AccountSecurity";
import { colors } from "@/lib/theme";
import { Card, GhostButton, Hud, Loading, LoginRequired, PrimaryButton } from "@/components/ui";
import { AvatarEditor } from "@/components/AvatarEditor";
import { FlairBadge, TitleText } from "@/components/Flair";
import { errorMessage } from "@/components/AuthUi";
import { useConfirm } from "@/lib/confirm";
import { KeyboardScroll } from "@/components/Keyboard";

export default function ProfileScreen() {
  const { me, loading, refresh, logout } = useSession();
  const [editing, setEditing] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirm = useConfirm();
  useFocusEffect(() => {
    void refresh();
  });

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired text="Connecte-toi pour voir ton profil et tes statistiques." /></View>;

  const stats: [string, string | number][] = [
    ["Niveau", me.level],
    ["XP", me.xp],
    ["Série", me.dailyStreak],
    ["Record", me.bestDailyStreak],
    ["Réponses", me.totalGuesses],
    ["Exactes", me.exactGuesses],
    ["Victoires d'affilée", me.winStreak],
    ["Record victoires", me.bestWinStreak],
  ];
  const methods = [
    ...(me.hasPassword ? ["Email et mot de passe"] : []),
    ...me.linkedProviders.map((p) => (p === "GOOGLE" ? "Google" : "Discord")),
  ];

  const save = async () => {
    const parsed = Pseudo.safeParse(pseudo);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setSaving(true);
    setError(null);
    try {
      await api.updatePseudo(parsed.data);
      await refresh();
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    const typed = await confirm({
      title: "Supprimer ton compte ?",
      message:
        "Action définitive : ton pseudo, ton email, tes amis, tes messages du chat global et les clips que tu as proposés seront supprimés." +
        (me.vip.active ? " Ton VIP en cours sera perdu." : ""),
      confirmLabel: "Supprimer",
      danger: true,
      requireText: me.displayName,
    });
    if (typed === false) return;
    setDeleteError(null);
    try {
      await api.deleteAccount(typed.trim());
      await logout();
      router.replace("/");
    } catch (e) {
      setDeleteError(errorMessage(e, "Suppression impossible, réessaie."));
    }
  };

  const confirmLogout = async () => {
    const ok = await confirm({ title: "Se déconnecter ?", confirmLabel: "Se déconnecter", danger: true });
    if (ok === false) return;
    await logout();
    router.replace("/");
  };

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <Card style={{ alignItems: "center", gap: 6 }}>
        <AvatarEditor name={me.displayName} url={me.avatarUrl} flair={me.flair} onChanged={refresh} />
        <Hud>Pseudo RankGuess</Hud>
        {editing ? (
          <View style={{ alignSelf: "stretch", gap: 8 }}>
            <TextInput
              value={pseudo}
              onChangeText={setPseudo}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              style={{ color: colors.ink, backgroundColor: colors.surface2, borderColor: error ? colors.danger : colors.line, borderWidth: 1, borderRadius: 12, padding: 12 }}
            />
            {error && <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>}
            <PrimaryButton label={saving ? "Enregistrement…" : "Enregistrer"} onPress={save} disabled={saving} />
            <GhostButton label="Annuler" onPress={() => { setEditing(false); setError(null); }} />
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "700" }}>
                {me.displayName}
                {me.vip.active ? <Text style={{ color: colors.warn, fontSize: 13 }}>  VIP</Text> : null}
              </Text>
              <FlairBadge flair={me.flair} size={14} />
            </View>
            {me.flair.title && <TitleText title={me.flair.title} size={12} />}
            <Text onPress={() => { setPseudo(me.displayName); setEditing(true); }} style={{ color: colors.violetSoft }}>Modifier</Text>
          </>
        )}
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>Affiché dans les classements, le chat et la liste d&apos;amis.</Text>
        {me.email && <Text style={{ color: colors.muted, fontSize: 12 }}>{me.email}</Text>}
        <Text style={{ color: colors.muted, fontSize: 12 }}>Connexion : {methods.join(", ") || "—"}</Text>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Pseudo en jeu (clips)</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Le pseudo du joueur filmé, indiqué à chaque clip proposé. Il ne remplace pas ton pseudo RankGuess.</Text>
        {me.inGamePseudos.length ? (
          me.inGamePseudos.map((p) => (
            <View key={`${p.game.slug}:${p.inGamePseudo}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.muted }}>{p.game.name}</Text>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>{p.inGamePseudo}</Text>
            </View>
          ))
        ) : (
          <Text style={{ color: colors.muted }}>Aucun clip proposé pour l&apos;instant.</Text>
        )}
      </Card>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {stats.map(([k, v]) => (
          <Card key={k} style={{ width: "31%", gap: 4 }}>
            <Hud>{k}</Hud>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>{v}</Text>
          </Card>
        ))}
      </View>
      <GhostButton
        label={me.newRewards > 0 ? `Titres, badges et cadres (${me.newRewards} nouveau${me.newRewards > 1 ? "x" : ""})` : "Titres, badges et cadres"}
        onPress={() => router.push("/rewards")}
      />
      <GhostButton label="Mes succès" onPress={() => router.push("/achievements")} />
      <GhostButton label="Mes clips" onPress={() => router.push("/my-clips")} />
      <GhostButton
        label={me.vip.active && me.vip.until ? `VIP jusqu'au ${new Date(me.vip.until).toLocaleDateString("fr-FR")}` : Platform.OS === "android" ? "Devenir VIP" : "Avantages VIP"}
        onPress={() => router.push("/shop")}
      />
      <GhostButton label="Proposer un clip" onPress={() => router.push("/submit")} />
      <GhostButton label="Suggestions" onPress={() => router.push("/suggestions")} />
      {me.role !== "USER" && (
        <GhostButton label={me.role === "REVIEWER" ? "Tri des clips" : "Administration"} onPress={() => router.push(me.role === "REVIEWER" ? "/admin/triage" : "/admin")} />
      )}
      <AccountSecurity me={me} />
      <GhostButton label="Se déconnecter" danger onPress={confirmLogout} />
      {deleteError && <Text style={{ color: colors.danger, textAlign: "center" }}>{deleteError}</Text>}
      <Text onPress={deleteAccount} style={{ color: colors.danger, textAlign: "center", marginTop: 8, fontSize: 13 }}>Supprimer mon compte</Text>
    </KeyboardScroll>
  );
}
