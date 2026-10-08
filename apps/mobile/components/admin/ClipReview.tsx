import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { PLATFORM_LABEL, REGION_LABEL, TRIAGE_REJECT_REASONS, type Platform, type Region } from "@ranksight/shared";
import { colors } from "@/lib/theme";
import { RankEmblem } from "@/components/RankEmblem";
import { Chips, Field, SmallButton } from "./AdminUi";

export interface ClipFactsProps {
  game: { name: string };
  rank: { id?: string; name: string; color: string; iconUrl: string | null };
  durationSec: number;
  proofUrl: string | null;
  inGamePseudo: string | null;
  platform: string | null;
  region: string | null;
  submitterNote: string | null;
}

/** Ce que le joueur a déclaré avec son clip : rang annoncé, preuve, pseudo en jeu, plateforme, région, contexte */
export function ClipFacts({ game, rank, durationSec, proofUrl, inGamePseudo, platform, region, submitterNote }: ClipFactsProps) {
  const line = (label: string, value: string | null) =>
    value ? (
      <Text style={{ color: colors.muted }}>
        {label} : <Text style={{ color: colors.ink }}>{value}</Text>
      </Text>
    ) : null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <RankEmblem rank={rank} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{game.name} · rang annoncé</Text>
          <Text style={{ color: rank.color, fontSize: 18, fontWeight: "800" }}>{rank.name}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{Math.round(durationSec)} s</Text>
      </View>
      {line("Pseudo en jeu", inGamePseudo)}
      {line("Plateforme", platform ? PLATFORM_LABEL[platform as Platform] ?? platform : null)}
      {line("Région", region ? REGION_LABEL[region as Region] ?? region : null)}
      {line("Contexte", submitterNote)}
      {proofUrl ? (
        <Text onPress={() => void Linking.openURL(proofUrl)} style={{ color: colors.violetSoft, textDecorationLine: "underline" }}>
          Voir la preuve du rang
        </Text>
      ) : (
        <Text style={{ color: colors.warn }}>Aucune preuve du rang fournie</Text>
      )}
    </View>
  );
}

/** Motif de refus : motifs courants en un appui, ou texte libre */
export function RejectForm({ busy, onCancel, onReject }: { busy: boolean; onCancel: () => void; onReject: (reason: string) => void }) {
  const [preset, setPreset] = useState<string | null>(null);
  const [text, setText] = useState("");
  const reason = [preset, text.trim()].filter(Boolean).join(" — ");
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>Motif du refus (envoyé au joueur)</Text>
      <Chips options={TRIAGE_REJECT_REASONS.map((r) => ({ value: r, label: r }))} value={preset} onChange={(v) => setPreset(v === preset ? null : v)} />
      <Field label="Précision (facultatif)" value={text} onChangeText={setText} maxLength={200} multiline />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SmallButton label="Annuler" onPress={onCancel} disabled={busy} />
        <SmallButton label="Confirmer le refus" tone="danger" onPress={() => onReject(reason)} disabled={busy || reason.length < 3} />
      </View>
    </View>
  );
}
