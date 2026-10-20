import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { api, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { AccountCredentials } from "./AccountCredentials";
import { AccountDevices } from "./AccountDevices";
import { WebLink } from "./Checkbox";
import { Avatar, Card, GhostButton, Hud } from "./ui";

type Blocked = Awaited<ReturnType<typeof api.blocks>>[number];

/** Profil : adresse email, joueurs bloqués, sessions, informations légales. */
export function AccountSecurity({ me }: { me: Me }) {
  const confirm = useConfirm();
  const { refresh } = useSession();
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    api.blocks().then(setBlocked, () => setBlocked([]));
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
    }
  };

  const logoutAll = async () => {
    const ok = await confirm({
      title: "Se déconnecter partout ?",
      message: "Toutes tes sessions seront fermées : ordinateurs, téléphones et applications, y compris celle-ci.",
      confirmLabel: "Tout déconnecter",
      danger: true,
    });
    if (ok === false) return;
    await api.logoutAll();
    await refresh();
    router.replace("/");
  };

  return (
    <>
      <Card style={{ gap: 10 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Sécurité et confidentialité</Text>
        {me.email && (
          <View style={{ gap: 4 }}>
            <Hud>Adresse email</Hud>
            <Text style={{ color: colors.ink }}>{me.email}</Text>
            {me.emailVerified ? (
              <Text style={{ color: colors.success, fontSize: 12 }}>Confirmée</Text>
            ) : (
              <Text onPress={() => run(() => api.resendVerification(), "Email de confirmation envoyé.")} style={{ color: colors.warn, fontSize: 13 }}>
                Non confirmée : nécessaire pour discuter et proposer des clips. Renvoyer l&apos;email
              </Text>
            )}
          </View>
        )}
        <AccountCredentials />
        {me.chatMutedUntil && (
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            L&apos;équipe a suspendu ton accès au chat jusqu&apos;au {new Date(me.chatMutedUntil).toLocaleString("fr-FR")}.
          </Text>
        )}
        <Hud>Joueurs bloqués</Hud>
        {blocked.length ? (
          blocked.map((b) => (
            <View key={b.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Avatar name={b.displayName} url={b.avatarUrl} size={26} />
              <Text style={{ color: colors.ink, flex: 1 }} onPress={() => router.push({ pathname: "/player/[id]", params: { id: b.id } })}>{b.displayName}</Text>
              <Pressable onPress={() => run(async () => { await api.unblock(b.id); load(); }, `${b.displayName} est débloqué.`)} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Débloquer</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Aucun. Tu peux bloquer un joueur depuis son profil.</Text>
        )}
        <AccountDevices />
        <GhostButton label="Se déconnecter de tous les appareils" onPress={logoutAll} />
        {notice && <Text style={{ color: notice.ok ? colors.success : colors.danger, fontSize: 13 }}>{notice.text}</Text>}
      </Card>
      <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 22 }}>
        <WebLink path="/how-to-play">Comment jouer</WebLink> · <WebLink path="/faq">FAQ</WebLink> · <WebLink path="/contact">Contact</WebLink>
        {"\n"}
        <WebLink path="/legal/cgu">CGU</WebLink> · <WebLink path="/legal/confidentialite">Confidentialité</WebLink> ·{" "}
        <WebLink path="/legal/mentions">Mentions légales</WebLink>
      </Text>
      <Text style={{ color: colors.muted, fontSize: 10, textAlign: "center", lineHeight: 15 }}>
        RankGuess was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy using assets owned by Riot Games. Riot Games does
        not endorse or sponsor this project. Portions of the materials used are trademarks and/or copyrighted works of Epic Games, Inc.
        All rights reserved by Epic. This material is not official and is not endorsed by Epic.
      </Text>
    </>
  );
}
