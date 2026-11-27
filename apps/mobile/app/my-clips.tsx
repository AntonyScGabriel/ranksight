import { useCallback, useState } from "react";
import { FlatList, Switch, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  PLATFORM_LABEL, REGION_LABEL, SUBMISSION_STATUS_LABEL, type MyClipDto, type Platform, type Region, type SubmissionStatus,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { colors } from "@/lib/theme";
import { Card, Loading, Message, PrimaryButton } from "@/components/ui";

const STATUS_COLOR: Record<SubmissionStatus, string> = { PENDING: colors.warn, ACCEPTED: colors.success, REJECTED: colors.danger };

export default function MyClipsScreen() {
  const [clips, setClips] = useState<MyClipDto[] | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    api.myClips().then(setClips).catch(() => setClips([]));
  }, []);
  useFocusEffect(load);

  const remove = async (clip: MyClipDto) => {
    const ok = await confirm({
      title: "Supprimer ce clip ?",
      message:
        clip.status === "ACCEPTED"
          ? `Ton clip ${clip.game.name} ne sera plus proposé aux joueurs. Les points déjà gagnés dessus restent acquis.`
          : `Ton clip ${clip.game.name} sera supprimé définitivement.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok !== false) api.withdrawClip(clip.id).then(load, load);
  };

  /** Accord facultatif à la promotion : le retrait est immédiat et toujours possible */
  const togglePromo = async (clip: MyClipDto, consent: boolean) => {
    if (!consent) {
      const ok = await confirm({
        title: "Retirer ton accord ?",
        message:
          "Le clip ne sera plus utilisé dans les vidéos RankSight. Les vidéos en préparation sont abandonnées et celles déjà publiées " +
          "sont retirées des comptes officiels sous 30 jours (les copies faites par d'autres ne peuvent pas être garanties).",
        confirmLabel: "Retirer",
        danger: true,
      });
      if (ok === false) return;
    }
    api.setPromoConsent(clip.id, consent).then(load, load);
  };

  if (!clips) return <Loading />;

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={clips}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={<PrimaryButton label="Proposer un clip" onPress={() => router.push("/submit")} />}
      ListEmptyComponent={<Message title="Aucun clip pour l'instant" text="Propose ton premier clip : une fois accepté, toute la communauté pourra le jouer." />}
      renderItem={({ item }) => (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>
              {item.game.name} · <Text style={{ color: item.rank.color }}>{item.rank.name}</Text>
            </Text>
            <Text style={{ color: STATUS_COLOR[item.status], fontWeight: "700", fontSize: 12 }}>{SUBMISSION_STATUS_LABEL[item.status]}</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            Pseudo en jeu : <Text style={{ color: colors.ink }}>{item.inGamePseudo ?? "—"}</Text>
            {item.platform ? ` · ${PLATFORM_LABEL[item.platform as Platform] ?? item.platform}` : ""}
            {item.region ? ` · ${REGION_LABEL[item.region as Region] ?? item.region}` : ""}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Envoyé le {new Date(item.createdAt).toLocaleDateString("fr-FR")}
            {item.status === "ACCEPTED" ? ` · joué ${item.timesPlayed} fois` : ""}
          </Text>
          {item.status === "REJECTED" && item.rejectionReason && (
            <Text style={{ color: colors.ink, backgroundColor: `${colors.danger}22`, padding: 10, borderRadius: 8 }}>Raison du refus : {item.rejectionReason}</Text>
          )}
          {item.promoConsent !== null && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#ffffff0d", padding: 10, borderRadius: 8 }}>
              <Switch value={item.promoConsent} onValueChange={(v) => togglePromo(item, v)} />
              <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
                {item.promoConsent
                  ? `Autorisé dans les vidéos RankSight (TikTok, YouTube Shorts, Instagram Reels, sans publicité payante).${
                      item.promoReview === "PENDING" ? " En attente de vérification par l'équipe." : item.promoReview === "REJECTED" ? " Non retenu par l'équipe." : ""
                    }`
                  : "Facultatif : autoriser ce clip dans les vidéos RankSight sur les réseaux sociaux (jeu et rang affichés, jamais tes pseudos)."}
              </Text>
            </View>
          )}
          <Text onPress={() => remove(item)} style={{ color: colors.muted, fontSize: 12 }}>Supprimer ce clip</Text>
        </Card>
      )}
    />
  );
}
