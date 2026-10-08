import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  COSMETIC_TYPE_PLURAL, type CosmeticType, type EquipFlairInput, type FlairDto, type LockedCosmeticDto,
  type MyRewardsDto, type OwnedCosmeticDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { BadgeChip, CosmeticVisual, TitleText } from "@/components/Flair";
import { Avatar, Card, GhostButton, Loading, Message, Muted } from "@/components/ui";

const TYPES: CosmeticType[] = ["TITLE", "BADGE", "FRAME"];
const FIELD: Record<CosmeticType, keyof EquipFlairInput> = { TITLE: "titleId", BADGE: "badgeId", FRAME: "frameId" };
const SLOT: Record<CosmeticType, keyof FlairDto> = { TITLE: "title", BADGE: "badge", FRAME: "frame" };
const HELP: Record<CosmeticType, string> = {
  TITLE: "Affiché sous ton pseudo : chat, classements, duels et profil.",
  BADGE: "Petite icône à côté de ton pseudo.",
  FRAME: "Anneau de couleur autour de ta photo de profil.",
};

/** Mes récompenses : titres, badges et cadres obtenus (à équiper) et ceux qui restent à gagner. */
export default function RewardsScreen() {
  const { me, refresh } = useSession();
  const [data, setData] = useState<MyRewardsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.rewards().then(
      (r) => {
        setData(r);
        setFailed(false);
        // Les nouvelles récompenses sont maintenant vues : la pastille du profil disparaît
        if (r.owned.some((o) => o.isNew)) void refresh();
      },
      () => setFailed(true),
    );
  }, [refresh]);
  useFocusEffect(load);

  if (failed && !data) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Connexion au serveur impossible" text="Vérifie ta connexion internet puis réessaie.">
          <GhostButton label="Réessayer" onPress={load} />
        </Message>
      </View>
    );
  }
  if (!data || !me) return <Loading />;

  const equip = async (type: CosmeticType, id: string | null) => {
    setPending(`${type}:${id ?? "none"}`);
    setError(null);
    try {
      const equipped = await api.equip({ [FIELD[type]]: id });
      setData((d) => (d ? { ...d, equipped } : d));
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={me.displayName} url={me.avatarUrl} size={52} frame={data.equipped.frame} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 17 }} numberOfLines={1}>{me.displayName}</Text>
            {data.equipped.badge && <BadgeChip badge={data.equipped.badge} size={12} />}
          </View>
          {data.equipped.title ? <TitleText title={data.equipped.title} /> : <Text style={{ color: colors.muted, fontSize: 12 }}>Aucun titre</Text>}
          <Text style={{ color: colors.muted, fontSize: 12 }}>Ce que voient les autres joueurs</Text>
        </View>
      </Card>
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}

      {TYPES.map((type) => {
        const owned = data.owned.filter((o) => o.type === type);
        const current = data.equipped[SLOT[type]];
        return (
          <View key={type} style={{ gap: 8 }}>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{COSMETIC_TYPE_PLURAL[type]}</Text>
            <Muted>{HELP[type]}</Muted>
            <Option
              selected={!current}
              disabled={!current || pending !== null}
              onPress={() => equip(type, null)}
              left={<View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line }} />}
              title="Aucun"
              subtitle={!current ? "Équipé" : "Ne rien afficher"}
            />
            {owned.map((o) => (
              <OwnedOption key={o.id} item={o} equipped={current?.id === o.id} busy={pending === `${type}:${o.id}`} disabled={pending !== null} onEquip={() => equip(type, o.id)} />
            ))}
            {owned.length === 0 && <Muted>Rien pour l&apos;instant : monte de niveau et débloque des succès.</Muted>}
          </View>
        );
      })}

      {data.locked.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>À gagner</Text>
          <Muted>Tu es niveau {data.level}.</Muted>
          {data.locked.map((l) => <LockedRow key={l.id} item={l} level={data.level} />)}
        </View>
      )}
    </ScrollView>
  );
}

function Option({
  selected, disabled, onPress, left, title, subtitle, right,
}: { selected: boolean; disabled: boolean; onPress: () => void; left: React.ReactNode; title: React.ReactNode; subtitle: string; right?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface,
        borderWidth: selected ? 2 : 1, borderColor: selected ? colors.neon : colors.line,
      }}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === "string" ? <Text style={{ color: colors.ink, fontWeight: "600" }}>{title}</Text> : title}
        <Text style={{ color: colors.muted, fontSize: 12 }}>{subtitle}</Text>
      </View>
      {right ? <Text style={{ color: selected ? colors.neon : colors.violetSoft, fontSize: 12, fontWeight: "600" }}>{right}</Text> : null}
    </Pressable>
  );
}

function OwnedOption({ item, equipped, busy, disabled, onEquip }: { item: OwnedCosmeticDto; equipped: boolean; busy: boolean; disabled: boolean; onEquip: () => void }) {
  return (
    <Option
      selected={equipped}
      disabled={equipped || disabled}
      onPress={onEquip}
      left={<CosmeticVisual item={item} />}
      title={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {item.type === "TITLE" ? <TitleText title={item} size={12} /> : <Text style={{ color: item.color, fontWeight: "700" }}>{item.name}</Text>}
          {item.isNew && <Text style={{ backgroundColor: colors.neon, color: colors.void, fontSize: 10, fontWeight: "800", paddingHorizontal: 6, borderRadius: 8 }}>Nouveau</Text>}
        </View>
      }
      subtitle={`${item.description && !item.hint.includes(item.description) ? `${item.description} · ` : ""}Obtenu : ${item.hint}`}
      right={busy ? "…" : equipped ? "Équipé" : "Équiper"}
    />
  );
}

function LockedRow({ item, level }: { item: LockedCosmeticDto; level: number }) {
  const pct = item.unlock.kind === "level" ? Math.min(100, Math.round((level / item.unlock.level) * 100)) : null;
  // Description qui répète seulement la condition : non affichée
  const description = item.description && !item.description.toLowerCase().includes(item.unlock.kind === "level" ? `niveau ${item.unlock.level}` : item.unlock.achievement.toLowerCase())
    ? item.description
    : null;
  return (
    <Card style={{ gap: 8, opacity: 0.8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CosmeticVisual item={item} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: item.color, fontWeight: "700" }}>{item.name}</Text>
          {description ? <Text style={{ color: colors.muted, fontSize: 12 }}>{description}</Text> : null}
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{`Pour l'obtenir : ${item.hint}`}</Text>
      {pct !== null && (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2 }}>
          <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: colors.violet }} />
        </View>
      )}
    </Card>
  );
}
