import { useCallback, useState } from "react";
import { Share, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  CreateGiftCodesInput, ShopSettingsInput, firstIssue, formatPrice,
  type AdminGiftCodeDto, type ShopProduct, type ShopSettingsDto,
} from "@ranksight/shared";
import { adminApi } from "@/lib/admin";
import { useConfirm } from "@/lib/confirm";
import { colors, radius } from "@/lib/theme";
import { Card, Hud, Loading, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { Chips, Field, NoticeText, SmallButton, Tag, formatDate, useAdminAction } from "@/components/admin/AdminUi";

type ProductForm = { id: ShopProduct["id"]; name: string; days: string; price: string; promoPrice: string; highlight: string; active: boolean };
/** Fin de la promo : date déjà enregistrée, sans fin (0) ou dans N jours à partir de maintenant */
type PromoEnd = "keep" | number;
type PromoForm = { active: boolean; label: string; end: PromoEnd };

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
/** « 4,99 » ou « 4.99 » → 499 centimes (NaN si la saisie n'est pas un prix) */
const toCents = (value: string) => {
  const v = value.trim().replace(",", ".").replace(/\s|€/g, "");
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : Number.NaN;
};
const toForm = (p: ShopProduct): ProductForm => ({
  id: p.id, name: p.name, days: String(p.days), price: euros(p.priceCents), promoPrice: euros(p.promoPriceCents), highlight: p.highlight ?? "", active: p.active,
});

const EXPIRIES = [
  { value: 0, label: "Sans limite" },
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
] as const;

function GiftCodes() {
  const [codes, setCodes] = useState<AdminGiftCodeDto[] | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const [count, setCount] = useState("1");
  const [days, setDays] = useState("30");
  const [uses, setUses] = useState("1");
  const [expiry, setExpiry] = useState<number>(0);
  const [note, setNote] = useState("");
  const confirm = useConfirm();
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(() => {
    void run(async () => setCodes((await adminApi.giftCodes()).items));
  }, [run]);
  useFocusEffect(load);

  const create = async () => {
    const parsed = CreateGiftCodesInput.safeParse({
      count: Number(count),
      days: Number(days),
      maxUses: Number(uses),
      expiresAt: expiry ? new Date(Date.now() + expiry * 86_400_000).toISOString() : null,
      note: note.trim() || null,
    });
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    const r = await run(() => adminApi.createGiftCodes(parsed.data), (res) => `${res.codes.length} code(s) créé(s).`);
    if (r) {
      setCreated(r.codes);
      setNote("");
      load();
    }
  };

  const disable = async (c: AdminGiftCodeDto) => {
    const ok = await confirm({ title: `Désactiver ${c.code} ?`, message: "Le code ne pourra plus être utilisé. Le VIP déjà obtenu est conservé.", confirmLabel: "Désactiver", danger: true });
    if (ok === false) return;
    const done = await run(async () => {
      await adminApi.disableGiftCode(c.id);
      return true;
    }, "Code désactivé.");
    if (done) load();
  };

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Codes cadeaux</Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>Concours, créateurs de contenu… Les joueurs les utilisent dans la boutique du site.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="Nombre" value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={3} /></View>
        <View style={{ flex: 1 }}><Field label="Jours de VIP" value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={4} /></View>
        <View style={{ flex: 1 }}><Field label="Utilisations" value={uses} onChangeText={setUses} keyboardType="number-pad" maxLength={5} /></View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>Valable</Text>
      <Chips options={EXPIRIES} value={expiry} onChange={setExpiry} />
      <Field label="Note interne (facultatif)" value={note} onChangeText={setNote} maxLength={200} placeholder="Concours Discord de mai" />
      <NoticeText notice={notice} onPress={() => setNotice(null)} />
      <PrimaryButton label={busy ? "…" : "Créer les codes"} onPress={() => void create()} disabled={busy} />

      {created.length > 0 && (
        <View style={{ gap: 8, borderWidth: 1, borderColor: colors.success, borderRadius: radius.chip, padding: 12 }}>
          <Text style={{ color: colors.success, fontWeight: "700" }}>Codes créés</Text>
          <Text selectable style={{ color: colors.ink, fontFamily: "monospace", letterSpacing: 1, lineHeight: 22 }}>{created.join("\n")}</Text>
          <View style={{ flexDirection: "row" }}>
            <SmallButton label="Partager" onPress={() => void Share.share({ message: created.join("\n") })} />
          </View>
        </View>
      )}

      <Hud>Derniers codes</Hud>
      {!codes ? (
        <Loading />
      ) : codes.length === 0 ? (
        <Text style={{ color: colors.muted }}>Aucun code pour le moment.</Text>
      ) : (
        codes.slice(0, 40).map((c) => {
          const expired = !!c.expiresAt && new Date(c.expiresAt) <= new Date();
          const used = c.uses >= c.maxUses;
          const [label, color] = c.disabled ? ["Désactivé", colors.danger] : expired ? ["Expiré", colors.muted] : used ? ["Utilisé", colors.muted] : ["Valable", colors.success];
          return (
            <View key={c.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 8, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text selectable style={{ color: colors.ink, fontFamily: "monospace", flex: 1 }}>{c.code}</Text>
                <Tag label={label} color={color} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {c.days} j de VIP · {c.uses}/{c.maxUses} · {c.boughtBy ? `acheté par ${c.boughtBy}` : `créé par ${c.createdBy ?? "l'équipe"}`} · {formatDate(c.createdAt)}
                {c.expiresAt ? ` · jusqu'au ${formatDate(c.expiresAt)}` : ""}
                {c.note ? ` · ${c.note}` : ""}
              </Text>
              {!c.disabled && !expired && !used && (
                <View style={{ flexDirection: "row" }}>
                  <SmallButton label="Désactiver" tone="danger" onPress={() => void disable(c)} disabled={busy} />
                </View>
              )}
            </View>
          );
        })
      )}
    </Card>
  );
}

const toPromoForm = (p: ShopSettingsDto["promo"]): PromoForm => ({ active: p.active, label: p.label, end: p.endsAt ? "keep" : 0 });
const PROMO_DAYS = [3, 7, 14, 30] as const;

/** Boutique (fondateur) : promo du moment, passes VIP (nom, durée, prix, prix promo, étiquette, mise en vente) et codes cadeaux. */
export default function AdminShop() {
  const [saved, setSaved] = useState<ShopSettingsDto | null>(null);
  const [promo, setPromo] = useState<PromoForm>({ active: false, label: "", end: 0 });
  const [products, setProducts] = useState<ProductForm[]>([]);
  const confirm = useConfirm();
  const { run, notice, setNotice, busy } = useAdminAction();

  const apply = (r: ShopSettingsDto) => {
    setSaved(r);
    setPromo(toPromoForm(r.promo));
    setProducts(r.products.map(toForm));
  };

  useFocusEffect(
    useCallback(() => {
      void run(async () => apply(await adminApi.shopSettings()));
    }, [run]),
  );

  const update = (id: string, patch: Partial<ProductForm>) => setProducts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const dirty =
    saved !== null &&
    (JSON.stringify(promo) !== JSON.stringify(toPromoForm(saved.promo)) || JSON.stringify(products) !== JSON.stringify(saved.products.map(toForm)));

  const endsAt = (form: PromoForm) =>
    form.end === "keep" ? saved?.promo.endsAt ?? null : form.end ? new Date(Date.now() + form.end * 86_400_000).toISOString() : null;
  const keptEnd = promo.end === "keep" && saved?.promo.endsAt ? new Date(saved.promo.endsAt) : null;
  const running = promo.active && (!keptEnd || keptEnd > new Date());

  const save = async () => {
    const parsed = ShopSettingsInput.safeParse({
      promo: { active: promo.active, label: promo.label, endsAt: endsAt(promo) },
      products: products.map((p) => ({
        id: p.id, name: p.name, days: Number(p.days), priceCents: toCents(p.price), promoPriceCents: toCents(p.promoPrice),
        highlight: p.highlight.trim() || null, active: p.active,
      })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index = typeof issue?.path[1] === "number" ? issue.path[1] : -1;
      const where = index >= 0 ? `${products[index]?.name || "Pass"} : ` : issue?.path[0] === "promo" ? "Promo : " : "";
      const message = issue?.code === "invalid_type" ? "prix invalide (ex. 4,99)." : issue?.message;
      return setNotice({ text: `${where}${message ?? "vérifie les champs."}`, ok: false });
    }
    if (promo.active && keptEnd && keptEnd <= new Date()) {
      return setNotice({ text: "Promo : la date de fin est passée, choisis une nouvelle durée.", ok: false });
    }
    const ok = await confirm({
      title: "Enregistrer la boutique ?",
      message:
        "Les réglages s'appliquent tout de suite au site. Les prix (et la promo) de l'application Android se changent dans la Play Console. Les achats déjà payés ne changent pas.",
      confirmLabel: "Enregistrer",
    });
    if (ok === false) return;
    const r = await run(() => adminApi.saveShopSettings(parsed.data), "Boutique enregistrée.");
    if (r) apply(r);
  };

  if (!saved) return notice ? <View style={{ padding: 16 }}><NoticeText notice={notice} /></View> : <Loading />;

  const endOptions: { value: PromoEnd; label: string }[] = [
    ...(saved.promo.endsAt ? [{ value: "keep" as const, label: `Jusqu'au ${formatDate(saved.promo.endsAt)}` }] : []),
    { value: 0, label: "Sans fin" },
    ...PROMO_DAYS.map((d) => ({ value: d, label: `${d} jours` })),
  ];

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Promo du moment</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {promo.active ? (running ? "Active : prix promo appliqués" : "Active, mais la date de fin est passée") : "Désactivée : prix normaux appliqués"}
            </Text>
          </View>
          <Switch value={promo.active} onValueChange={(active) => setPromo({ ...promo, active })} trackColor={{ true: colors.violet, false: colors.line }} />
        </View>
        <Field label="Nom affiché aux joueurs" value={promo.label} onChangeText={(label) => setPromo({ ...promo, label })} maxLength={40} placeholder="Promo de Noël" />
        <Text style={{ color: colors.muted, fontSize: 13 }}>Fin de la promo (elle s&apos;arrête toute seule)</Text>
        <Chips options={endOptions} value={promo.end} onChange={(end) => setPromo({ ...promo, end })} />
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Réutilisable à chaque événement : change le nom, les prix promo et la fin, puis réactive-la.
        </Text>
      </Card>

      <Card style={{ gap: 14 }}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Passes VIP</Text>
        {products.map((p) => {
          const shown = toCents(running ? p.promoPrice : p.price);
          return (
            <View key={p.id} style={{ gap: 10, borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, opacity: p.active ? 1 : 0.6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ color: colors.ink, fontWeight: "700", flex: 1 }}>{p.name || p.id}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>En vente</Text>
                <Switch value={p.active} onValueChange={(active) => update(p.id, { active })} trackColor={{ true: colors.violet, false: colors.line }} />
              </View>
              <Field label="Nom" value={p.name} onChangeText={(name) => update(p.id, { name })} maxLength={40} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Durée (jours)" value={p.days} onChangeText={(days) => update(p.id, { days })} keyboardType="number-pad" maxLength={4} /></View>
                <View style={{ flex: 1 }}><Field label="Étiquette" value={p.highlight} onChangeText={(highlight) => update(p.id, { highlight })} maxLength={20} placeholder="−13 %" /></View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Prix normal (€)" value={p.price} onChangeText={(price) => update(p.id, { price })} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label="Prix promo (€)" value={p.promoPrice} onChangeText={(promoPrice) => update(p.id, { promoPrice })} keyboardType="decimal-pad" /></View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Affiché maintenant : {Number.isNaN(shown) ? "—" : formatPrice(shown)}</Text>
            </View>
          );
        })}
        <NoticeText notice={notice} onPress={() => setNotice(null)} />
        <PrimaryButton label={busy ? "…" : "Enregistrer la boutique"} onPress={() => void save()} disabled={busy || !dirty} />
        {dirty && <SmallButton label="Annuler les modifications" onPress={() => apply(saved)} disabled={busy} />}
      </Card>
      <GiftCodes />
    </KeyboardScroll>
  );
}
