import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AVATAR_MAX_BYTES, AVATAR_TYPES, type FlairDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { colors } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { Avatar } from "./ui";

const EXT_TYPES: Record<string, (typeof AVATAR_TYPES)[number]> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Photo de profil : choisie dans la galerie, recadrée en carré sur le téléphone puis allégée par le serveur. */
export function AvatarEditor({
  name, url, flair, onChanged,
}: { name: string; url: string | null; flair: FlairDto; onChanged: () => Promise<void> | void }) {
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const ext = a.uri.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const type = (AVATAR_TYPES as readonly string[]).includes(a.mimeType ?? "") ? a.mimeType! : EXT_TYPES[ext];
    if (!type) return setError("Formats acceptés : JPEG, PNG ou WebP.");
    if ((a.fileSize ?? 0) > AVATAR_MAX_BYTES) return setError(`Image trop lourde (${AVATAR_MAX_BYTES / 1024 / 1024} Mo maximum).`);
    setPending(true);
    try {
      await api.uploadAvatar(a.uri, type);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e, "La photo n'a pas pu être envoyée, réessaie."));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: "Retirer ta photo ?", message: "L'initiale de ton pseudo sera affichée à la place.", confirmLabel: "Retirer" });
    if (ok === false) return;
    setPending(true);
    setError(null);
    try {
      await api.deleteAvatar();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Pressable onPress={pick} disabled={pending} accessibilityRole="button" accessibilityLabel="Changer la photo de profil" style={{ opacity: pending ? 0.5 : 1 }}>
        <Avatar name={name} url={url} size={80} frame={flair.frame} />
      </Pressable>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Text onPress={pending ? undefined : pick} style={{ color: colors.violetSoft, fontSize: 13 }}>
          {pending ? "Envoi…" : url ? "Changer la photo" : "Ajouter une photo"}
        </Text>
        {url && !pending ? <Text onPress={remove} style={{ color: colors.muted, fontSize: 13 }}>Retirer</Text> : null}
      </View>
      {error ? <Text style={{ color: colors.danger, fontSize: 12, textAlign: "center" }}>{error}</Text> : null}
    </View>
  );
}
