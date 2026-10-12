import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ASSIGNABLE_ROLES, ROLE_LABEL, isAdminRole, isStaffRole, type UserRole } from "@ranksight/shared";
import { adminApi, type AdminUser } from "@/lib/admin";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Avatar, Loading } from "@/components/ui";
import { KeyboardView } from "@/components/Keyboard";
import { Chips, Empty, NoticeText, SmallButton, Tag, formatDate, useAdminAction } from "@/components/admin/AdminUi";

const STATUS_LABEL: Record<AdminUser["status"], string> = { ACTIVE: "Actif", SUSPENDED: "Suspendu", BANNED: "Banni", DELETED: "Supprimé" };
const MUTES = [
  { value: 1, label: "1 h" },
  { value: 24, label: "24 h" },
  { value: 168, label: "7 jours" },
  { value: 720, label: "30 jours" },
] as const;
const VIP_DAYS = [
  { value: 30, label: "+30 jours" },
  { value: 90, label: "+90 jours" },
  { value: 365, label: "+1 an" },
] as const;

type Act = <T>(action: () => Promise<T>, success: string, reload?: boolean) => Promise<void>;

function UserActions({ user, me, ownerExists, act }: { user: AdminUser; me: { id: string; role: UserRole; siteOwner: boolean }; ownerExists: boolean; act: Act }) {
  const confirm = useConfirm();
  const admin = isAdminRole(me.role);
  const self = user.id === me.id;
  // Compte du fondateur intouchable ; comptes administrateurs gérés par le fondateur seul (s'il existe)
  const locked = !self && (user.role === "OWNER" || (user.role === "ADMIN" && ownerExists && me.role !== "OWNER"));
  const canEdit = admin && !self && !locked;
  const roles = ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN" || me.role === "OWNER" || !ownerExists || user.role === "ADMIN");

  const ask = async (title: string, message: string, danger = false, requireText?: string) =>
    (await confirm({ title, message, confirmLabel: "Confirmer", danger, requireText })) !== false;

  if (locked) {
    return (
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        {user.role === "OWNER" ? "Compte du fondateur : personne d'autre ne peut le modifier." : "Seul le fondateur peut gérer un administrateur."}
      </Text>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {canEdit && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Rôle</Text>
          <Chips
            options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            value={user.role}
            onChange={async (role) => {
              if (role === user.role) return;
              if (await ask(`Passer ${user.displayName} en ${ROLE_LABEL[role].toLowerCase()} ?`, "Le changement s'applique immédiatement.")) {
                await act(() => adminApi.updateUser(user.id, { role }), `${user.displayName} est maintenant ${ROLE_LABEL[role].toLowerCase()}.`);
              }
            }}
          />
        </View>
      )}

      {!isStaffRole(user.role) && !self && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Chat</Text>
          {user.chatMutedUntil ? (
            <View style={{ flexDirection: "row" }}>
              <SmallButton label="Rétablir le chat" onPress={() => void act(() => adminApi.mute(user.id, 0), "Chat rétabli.")} />
            </View>
          ) : (
            <Chips
              options={MUTES}
              value={null}
              onChange={async (hours) => {
                const label = MUTES.find((m) => m.value === hours)!.label;
                if (await ask(`Couper le chat de ${user.displayName} (${label}) ?`, "Il ne pourra plus écrire dans le chat ni en message privé.")) {
                  await act(() => adminApi.mute(user.id, hours), `Chat coupé pour ${label}.`);
                }
              }}
            />
          )}
        </View>
      )}

      {me.siteOwner && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>VIP {user.vip.active && user.vip.until ? `(jusqu'au ${formatDate(user.vip.until)})` : ""}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {VIP_DAYS.map((d) => (
              <SmallButton
                key={d.value}
                label={d.label}
                onPress={async () => {
                  if (await ask(`Offrir ${d.label.slice(1)} de VIP à ${user.displayName} ?`, "Ajouté à son VIP en cours, journalisé.")) {
                    await act(() => adminApi.grantVip(user.id, d.value), "VIP offert.");
                  }
                }}
              />
            ))}
            {user.vip.active && (
              <SmallButton
                label="Retirer le VIP"
                tone="danger"
                onPress={async () => {
                  if (await ask(`Retirer le VIP de ${user.displayName} ?`, "Son VIP prend fin immédiatement.", true)) await act(() => adminApi.revokeVip(user.id), "VIP retiré.");
                }}
              />
            )}
          </View>
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Compte</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <SmallButton label="Voir le profil" onPress={() => router.push({ pathname: "/player/[id]", params: { id: user.id } })} />
          {admin && user.email && !user.emailVerified && (
            <SmallButton label="Confirmer l'email" onPress={() => void act(() => adminApi.verifyEmail(user.id), "Adresse email confirmée.")} />
          )}
          {user.avatarUrl && !self && (
            <SmallButton
              label="Retirer la photo"
              onPress={async () => {
                if (await ask("Retirer sa photo de profil ?", "Pour une photo inappropriée. L'action est journalisée.")) await act(() => adminApi.removeAvatar(user.id), "Photo retirée.");
              }}
            />
          )}
          {canEdit && me.siteOwner && user.mfaEnabled && (
            <SmallButton
              label="Retirer la 2FA"
              onPress={async () => {
                if (await ask("Retirer sa double authentification ?", "À faire seulement si ce membre a perdu son téléphone. Il est prévenu par email.", true)) {
                  await act(() => adminApi.resetMfa(user.id), "Double authentification retirée.");
                }
              }}
            />
          )}
          {admin && (self || !locked) && (
            <SmallButton
              label="Remettre les stats à zéro"
              tone="danger"
              onPress={async () => {
                if (await ask(`Remettre à zéro les statistiques de ${user.displayName} ?`, "XP, niveau, séries, succès et classements. Irréversible.", true, user.username)) {
                  await act(() => adminApi.resetStats(user.id), "Statistiques remises à zéro.");
                }
              }}
            />
          )}
          {canEdit &&
            (user.status === "ACTIVE" ? (
              <SmallButton
                label="Bannir"
                tone="danger"
                onPress={async () => {
                  if (await ask(`Bannir ${user.displayName} ?`, "Il est déconnecté et ne peut plus se connecter.", true)) {
                    await act(() => adminApi.updateUser(user.id, { status: "BANNED" }), `${user.displayName} est banni.`);
                  }
                }}
              />
            ) : (
              <SmallButton label="Réactiver" tone="success" onPress={() => void act(() => adminApi.updateUser(user.id, { status: "ACTIVE" }), "Compte réactivé.")} />
            ))}
          {canEdit && me.siteOwner && !isAdminRole(user.role) && (
            <SmallButton
              label="Supprimer le compte"
              tone="danger"
              onPress={async () => {
                if (await ask(`Supprimer le compte de ${user.displayName} ?`, `Données personnelles effacées. Irréversible. Recopie « ${user.username} » pour confirmer.`, true, user.username)) {
                  await act(() => adminApi.deleteUser(user.id), "Compte supprimé.");
                }
              }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

/** Joueurs : recherche par pseudo ou email, sanctions, rôles, VIP (selon les droits de chacun). */
export default function AdminUsers() {
  const { me } = useSession();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [ownerExists, setOwnerExists] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(
    (query: string, p = 1) => {
      void run(async () => {
        const r = await adminApi.users(query.trim(), p);
        setItems((list) => (p === 1 ? r.items : [...(list ?? []), ...r.items]));
        setTotal(r.total);
        setPage(p);
        setOwnerExists(r.ownerExists);
      });
    },
    [run],
  );

  // Recherche au fil de la saisie (petite attente pour ne pas interroger le serveur à chaque lettre)
  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const act: Act = async (action, success) => {
    const ok = await run(async () => {
      await action();
      return true;
    }, success);
    if (ok) load(q);
  };

  if (!me) return <Loading />;

  return (
    <KeyboardView>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Pseudo ou email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, padding: 12 }}
        />
        <NoticeText notice={notice} onPress={() => setNotice(null)} />
      </View>
      {!items ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text="Aucun compte trouvé." />}
          ListFooterComponent={items.length < total ? <SmallButton label={`Afficher plus (${total - items.length})`} onPress={() => load(q, page + 1)} disabled={busy} /> : null}
          renderItem={({ item }) => {
            const open = openId === item.id;
            return (
              <View style={{ backgroundColor: colors.surface, borderColor: open ? colors.violet : colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 12 }}>
                <Pressable onPress={() => setOpenId(open ? null : item.id)} style={{ flexDirection: "row", gap: 10, alignItems: "center" }} accessibilityRole="button">
                  <Avatar name={item.displayName} url={item.avatarUrl} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.ink, fontWeight: "700" }}>
                      {item.displayName} <Text style={{ color: colors.muted, fontWeight: "400" }}>@{item.username}</Text>
                    </Text>
                    {item.email ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                        {item.email}
                        {!item.emailVerified ? " (non confirmé)" : ""}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {item.role !== "USER" && <Tag label={ROLE_LABEL[item.role]} color={item.role === "OWNER" ? colors.warn : colors.violetSoft} />}
                      {item.status !== "ACTIVE" && <Tag label={STATUS_LABEL[item.status]} color={colors.danger} />}
                      {item.vip.active && <Tag label="VIP" color={colors.warn} />}
                      {item.chatMutedUntil && <Tag label="Chat coupé" color={colors.danger} />}
                      {item.mfaEnabled && <Tag label="2FA" color={colors.success} />}
                      <Tag label={`Niv. ${item.level}`} color={colors.muted} />
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 18 }}>{open ? "▾" : "▸"}</Text>
                </Pressable>
                {open && <UserActions user={item} me={me} ownerExists={ownerExists} act={act} />}
              </View>
            );
          }}
        />
      )}
    </KeyboardView>
  );
}
