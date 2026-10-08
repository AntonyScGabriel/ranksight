import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import {
  ANNOUNCEMENT_TONE_LABEL, AnnouncementInput, ROLE_LABEL, firstIssue, isAdminRole, isStaffRole,
  type AnnouncementDto, type AnnouncementTone, type TriageStatsDto,
} from "@ranksight/shared";
import * as WebBrowser from "expo-web-browser";
import { ADMIN_URL } from "@/lib/api";
import { adminApi, type AdminOverview } from "@/lib/admin";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Card, Hud, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { Chips, Field, NoticeText, SmallButton, StatCard, formatDateTime, useAdminAction } from "@/components/admin/AdminUi";

const DURATIONS = [
  { value: 0, label: "Sans fin" },
  { value: 24, label: "24 h" },
  { value: 72, label: "3 jours" },
  { value: 168, label: "7 jours" },
] as const;

function MenuItem({ href, label, detail, count }: { href: Href; label: string; detail: string; count?: number }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1,
        borderRadius: radius.chip, padding: 14, opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{detail}</Text>
      </View>
      {count ? (
        <Text style={{ color: colors.void, backgroundColor: colors.neon, borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 2, fontWeight: "800" }}>
          {count}
        </Text>
      ) : null}
      <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

/** Accueil de l'administration : chiffres du jour, annonce, accès aux outils selon le rôle. */
export default function AdminHome() {
  const { me } = useSession();
  const staff = isStaffRole(me?.role);
  const admin = isAdminRole(me?.role);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [playerReports, setPlayerReports] = useState(0);
  const [triage, setTriage] = useState<TriageStatsDto | null>(null);
  const [current, setCurrent] = useState<AnnouncementDto | null>(null);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>("info");
  const [hours, setHours] = useState<number>(0);
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(() => {
    void run(async () => {
      const [stats, reports, t, a] = await Promise.all([
        staff ? adminApi.overview() : Promise.resolve(null),
        staff ? adminApi.playerReports() : Promise.resolve(null),
        adminApi.triageStats(),
        adminApi.announcement(),
      ]);
      setOverview(stats);
      setPlayerReports(reports?.total ?? 0);
      setTriage(t);
      setCurrent(a.announcement);
    });
  }, [run, staff]);

  useFocusEffect(load);

  const publish = async () => {
    const parsed = AnnouncementInput.safeParse({
      text,
      tone,
      until: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
    });
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    const r = await run(() => adminApi.setAnnouncement(parsed.data), "Annonce publiée sur le site et dans l'application.");
    if (r) {
      setCurrent(r);
      setText("");
    }
  };

  const clear = async () => {
    const done = await run(async () => {
      await adminApi.clearAnnouncement();
      return true;
    }, "Annonce retirée.");
    if (done) setCurrent(null);
  };

  const pending = overview?.clips.PENDING_REVIEW ?? 0;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Bonjour {me?.displayName}</Text>
        <Text style={{ color: colors.muted }}>{me ? ROLE_LABEL[me.role] : ""}</Text>
      </View>

      <NoticeText notice={notice} onPress={() => setNotice(null)} />

      {staff && overview && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatCard label="Joueurs actifs (24 h)" value={overview.dau} />
          <StatCard label="Réponses (24 h)" value={overview.guesses24h} />
          <StatCard label="Comptes" value={overview.users} />
          <StatCard label="VIP" value={overview.premium} tone={colors.warn} />
        </View>
      )}
      {!staff && triage && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatCard label="Mes tris (aujourd'hui)" value={triage.today} />
          <StatCard label="Mes tris (total)" value={triage.total} />
          <StatCard label="Avis confirmés" value={triage.confirmed} tone={colors.success} />
          <StatCard label="Clips à trier" value={triage.queue} tone={colors.neon} />
        </View>
      )}

      <View style={{ gap: 10 }}>
        <Hud>Outils</Hud>
        <MenuItem href="/admin/triage" label="Tri des clips" detail="Donner un avis sur les clips proposés" count={triage?.queue} />
        {staff && (
          <>
            <MenuItem href="/admin/clips" label="Clips à valider" detail={`Décision finale${overview?.triaged ? ` · ${overview.triaged} pré-trié(s)` : ""}`} count={pending} />
            <MenuItem href="/admin/reports" label="Signalements" detail="Clips et joueurs signalés" count={(overview?.openReports ?? 0) + playerReports} />
            <MenuItem href="/admin/users" label="Joueurs" detail={admin ? "Rôles, sanctions, VIP, comptes" : "Chat, photos, profils"} />
          </>
        )}
        {admin && <MenuItem href="/admin/shop" label="Boutique" detail="Prix des passes, offre de lancement, codes cadeaux" />}
        <MenuItem href="/admin/security" label="Sécurité du compte" detail="Double authentification" />
        {staff && (
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
            Planning des défis du jour, saisons, rangs, récompenses et stockage :{" "}
            <Text onPress={() => void WebBrowser.openBrowserAsync(ADMIN_URL)} style={{ color: colors.violetSoft, textDecorationLine: "underline" }}>
              administration complète
            </Text>{" "}
            (plus confortable sur ordinateur).
          </Text>
        )}
      </View>

      {staff && (
        <Card style={{ gap: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Annonce</Text>
          {current ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.ink }}>{current.text}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {ANNOUNCEMENT_TONE_LABEL[current.tone]}
                {current.until ? ` · jusqu'au ${formatDateTime(current.until)}` : " · sans date de fin"}
              </Text>
              <View style={{ flexDirection: "row" }}>
                <SmallButton label="Retirer l'annonce" tone="danger" onPress={() => void clear()} disabled={busy} />
              </View>
            </View>
          ) : (
            <Text style={{ color: colors.muted }}>Aucune annonce en cours.</Text>
          )}
          <Field
            label={current ? "Remplacer par" : "Nouvelle annonce"}
            value={text}
            onChangeText={setText}
            maxLength={200}
            multiline
            placeholder="Ex. Maintenance ce soir de 23 h à 23 h 30."
            hint={`${text.length}/200 · affichée en haut du site et de l'application`}
          />
          <Chips options={(Object.keys(ANNOUNCEMENT_TONE_LABEL) as AnnouncementTone[]).map((t) => ({ value: t, label: ANNOUNCEMENT_TONE_LABEL[t] }))} value={tone} onChange={setTone} />
          <Chips options={DURATIONS} value={hours} onChange={setHours} />
          <PrimaryButton label={busy ? "…" : "Publier l'annonce"} onPress={() => void publish()} disabled={busy || text.trim().length < 3} />
        </Card>
      )}
    </KeyboardScroll>
  );
}
