"use client";

import { useCallback, useEffect, useState } from "react";
import { CreateGiftCodesInput, ShopSettingsInput, formatPrice, isAdminRole, type AdminGiftCodeDto, type ShopProduct, type ShopSettingsDto } from "@ranksight/shared";
import { adminFetch, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Notice = { text: string; ok: boolean } | null;

/** Boutique : passes VIP (prix, prix de lancement, durées, mise en vente) et codes cadeaux (concours, créateurs de contenu…). */
export default function ShopAdminPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    session.me().then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="glass h-40 animate-pulse" />;
  if (!isAdminRole(me?.role)) return <p className="text-muted">La boutique est gérée par les administrateurs.</p>;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Boutique</h1>
        <p className="text-sm text-muted">Prix des passes VIP et codes cadeaux. Chaque modification est enregistrée dans le journal d&apos;audit.</p>
      </div>
      <ShopSettingsEditor />
      <GiftCodes />
    </div>
  );
}

type ProductForm = { id: ShopProduct["id"]; name: string; days: string; price: string; launchPrice: string; highlight: string; active: boolean };

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
/** « 4,99 » ou « 4.99 » → 499 centimes (NaN si la saisie n'est pas un prix) */
const toCents = (value: string) => {
  const v = value.trim().replace(",", ".").replace(/\s|€/g, "");
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : Number.NaN;
};
const toForm = (p: ShopProduct): ProductForm => ({
  id: p.id, name: p.name, days: String(p.days), price: euros(p.priceCents), launchPrice: euros(p.launchPriceCents), highlight: p.highlight ?? "", active: p.active,
});

/** Offre de lancement et passes VIP : nom, durée, prix normal, prix de lancement, étiquette, mise en vente. */
function ShopSettingsEditor() {
  const [saved, setSaved] = useState<ShopSettingsDto | null>(null);
  const [launchOffer, setLaunchOffer] = useState(true);
  const [products, setProducts] = useState<ProductForm[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const apply = useCallback((r: ShopSettingsDto) => {
    setSaved(r);
    setLaunchOffer(r.launchOffer);
    setProducts(r.products.map(toForm));
  }, []);

  useEffect(() => {
    adminFetch<ShopSettingsDto>("/shop/settings").then(apply, (e: Error) => setNotice({ text: e.message, ok: false }));
  }, [apply]);

  const update = (id: string, patch: Partial<ProductForm>) => setProducts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const dirty = saved !== null && (launchOffer !== saved.launchOffer || JSON.stringify(products) !== JSON.stringify(saved.products.map(toForm)));

  const save = async () => {
    const parsed = ShopSettingsInput.safeParse({
      launchOffer,
      products: products.map((p) => ({
        id: p.id, name: p.name, days: Number(p.days), priceCents: toCents(p.price), launchPriceCents: toCents(p.launchPrice),
        highlight: p.highlight.trim() || null, active: p.active,
      })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index = typeof issue?.path[1] === "number" ? issue.path[1] : -1;
      const where = index >= 0 ? `${products[index]?.name || "Pass"} : ` : "";
      const message = issue?.path.at(-1) === "priceCents" || issue?.path.at(-1) === "launchPriceCents"
        ? issue.code === "invalid_type" ? "prix invalide (ex. 4,99)." : issue.message
        : issue?.message;
      setNotice({ text: `${where}${message ?? "vérifie les champs."}`, ok: false });
      return;
    }
    const priceChanged = saved && parsed.data.products?.some((p) => {
      const before = saved.products.find((b) => b.id === p.id)!;
      return p.priceCents !== before.priceCents || p.launchPriceCents !== before.launchPriceCents;
    });
    const ok = await confirm({
      title: "Enregistrer la boutique ?",
      message: (
        <>
          Les nouveaux réglages s&apos;appliquent tout de suite au site (et aux conditions générales de vente).
          {priceChanged && " Pense à reporter les prix dans la Play Console pour l'application Android."} Les achats déjà payés ne changent pas.
        </>
      ),
      confirmLabel: "Enregistrer",
    });
    if (ok === false) return;
    setBusy(true);
    setNotice(null);
    try {
      apply(await adminFetch<ShopSettingsDto>("/shop/settings", { method: "PUT", body: JSON.stringify(parsed.data) }));
      setNotice({ text: "Boutique enregistrée.", ok: true });
    } catch (e) {
      setNotice({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  if (!saved) return notice ? <p className="text-danger">{notice.text}</p> : <div className="glass h-40 animate-pulse" />;

  return (
    <section className="glass space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Passes VIP</h2>
          <p className="text-sm text-muted">
            Prix TTC en euros. Pendant l&apos;offre de lancement, le site affiche « Prix de lancement » et le prix normal appliqué
            ensuite. Les prix de l&apos;application Android se règlent dans la Play Console.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
          <input type="checkbox" checked={launchOffer} onChange={(e) => setLaunchOffer(e.target.checked)} className="h-4 w-4 accent-violet" />
          <span>
            <span className="block font-medium">Offre de lancement</span>
            <span className="block text-xs text-muted">{launchOffer ? "Prix de lancement appliqués" : "Prix normaux appliqués"}</span>
          </span>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {products.map((p) => (
          <fieldset key={p.id} className={`space-y-3 rounded-xl border p-4 ${p.active ? "border-line" : "border-line/40 opacity-70"}`}>
            <legend className="px-1 font-mono text-xs text-muted">{p.id}</legend>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>En vente</span>
              <input type="checkbox" checked={p.active} onChange={(e) => update(p.id, { active: e.target.checked })} className="h-4 w-4 accent-violet" aria-label={`${p.name} en vente`} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Nom</span>
              <input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} maxLength={40} className="input" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Durée (jours)</span>
                <input type="number" min={1} max={3650} value={p.days} onChange={(e) => update(p.id, { days: e.target.value })} className="input" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Étiquette</span>
                <input value={p.highlight} onChange={(e) => update(p.id, { highlight: e.target.value })} maxLength={20} placeholder="−13 %" className="input" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Prix normal (€)</span>
                <input inputMode="decimal" value={p.price} onChange={(e) => update(p.id, { price: e.target.value })} className="input" aria-label={`Prix normal de ${p.name}`} />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Prix de lancement (€)</span>
                <input inputMode="decimal" value={p.launchPrice} onChange={(e) => update(p.id, { launchPrice: e.target.value })} className="input" aria-label={`Prix de lancement de ${p.name}`} />
              </label>
            </div>
            <p className="text-xs text-muted">
              Affiché maintenant : {Number.isNaN(toCents(launchOffer ? p.launchPrice : p.price)) ? "—" : formatPrice(toCents(launchOffer ? p.launchPrice : p.price))}
            </p>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy || !dirty} className="btn-primary">{busy ? "Enregistrement…" : "Enregistrer la boutique"}</button>
        {dirty && <button onClick={() => apply(saved)} disabled={busy} className="btn-ghost">Annuler les modifications</button>}
        {notice && <p role="status" className={`text-sm ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
      </div>
    </section>
  );
}

function GiftCodes() {
  const [codes, setCodes] = useState<AdminGiftCodeDto[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [created, setCreated] = useState<string[]>([]);
  const [form, setForm] = useState({ count: "1", days: "30", maxUses: "1", expiresAt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(() => {
    adminFetch<{ items: AdminGiftCodeDto[] }>("/gift-codes").then((r) => setCodes(r.items), (e: Error) => setNotice({ text: e.message, ok: false }));
  }, []);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = CreateGiftCodesInput.safeParse({
      count: Number(form.count),
      days: Number(form.days),
      maxUses: Number(form.maxUses),
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      note: form.note.trim() || null,
    });
    if (!parsed.success) {
      setNotice({ text: parsed.error.issues[0]?.message ?? "Vérifie les champs.", ok: false });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await adminFetch<{ codes: string[] }>("/gift-codes", { method: "POST", body: JSON.stringify(parsed.data) });
      setCreated(r.codes);
      setCopied(false);
      setNotice({ text: `${r.codes.length} code(s) créé(s).`, ok: true });
      load();
    } catch (err) {
      setNotice({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const disable = async (c: AdminGiftCodeDto) => {
    const ok = await confirm({ title: `Désactiver ${c.code} ?`, message: "Le code ne pourra plus être utilisé. Le VIP déjà obtenu avec ce code est conservé.", confirmLabel: "Désactiver", danger: true });
    if (ok === false) return;
    try {
      await adminFetch(`/gift-codes/${c.id}/disable`, { method: "POST" });
      load();
    } catch (err) {
      setNotice({ text: (err as Error).message, ok: false });
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(created.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Codes cadeaux</h2>
        <p className="text-sm text-muted">
          Codes à distribuer (concours, créateurs de contenu, gestes commerciaux). Les joueurs les utilisent dans la boutique du site.
          Un code à plusieurs utilisations ne sert qu&apos;une fois par joueur.
        </p>
      </div>

      <form onSubmit={create} className="glass grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Nombre de codes</span>
          <input type="number" min={1} max={100} className="input" {...field("count")} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Jours de VIP</span>
          <input type="number" min={1} max={3650} className="input" {...field("days")} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Utilisations par code</span>
          <input type="number" min={1} max={10000} className="input" {...field("maxUses")} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Valable jusqu&apos;au (facultatif)</span>
          <input type="date" className="input" {...field("expiresAt")} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Note interne (facultatif)</span>
          <input maxLength={200} placeholder="Concours Discord de mai" className="input" {...field("note")} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
          <button type="submit" disabled={busy} className="btn-primary">{busy ? "Création…" : "Créer les codes"}</button>
          {notice && <p role="status" className={`text-sm ${notice.ok ? "text-success" : "text-danger"}`}>{notice.text}</p>}
        </div>
      </form>

      {created.length > 0 && (
        <div className="glass space-y-3 border-success/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Codes créés</p>
            <button onClick={copyAll} className="btn-ghost text-sm">{copied ? "Copiés !" : "Tout copier"}</button>
          </div>
          <pre className="max-h-60 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-sm tracking-wider">{created.join("\n")}</pre>
        </div>
      )}

      {!codes ? (
        <div className="glass h-32 animate-pulse" />
      ) : codes.length === 0 ? (
        <p className="text-sm text-muted">Aucun code pour le moment.</p>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">VIP</th>
                <th className="px-4 py-2 font-medium">Utilisations</th>
                <th className="px-4 py-2 font-medium">Origine</th>
                <th className="px-4 py-2 font-medium">État</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const expired = !!c.expiresAt && new Date(c.expiresAt) <= new Date();
                const exhausted = c.uses >= c.maxUses;
                const state = c.disabled ? ["Désactivé", "text-danger"] : expired ? ["Expiré", "text-muted"] : exhausted ? ["Utilisé", "text-muted"] : ["Valable", "text-success"];
                return (
                  <tr key={c.id} className="border-t border-line/60 align-top">
                    <td className="px-4 py-2 font-mono tracking-wider">{c.code}</td>
                    <td className="px-4 py-2">{c.days} j</td>
                    <td className="px-4 py-2">{c.uses} / {c.maxUses}</td>
                    <td className="px-4 py-2 text-muted">
                      {c.boughtBy ? `Acheté par ${c.boughtBy}` : c.createdBy ? `Créé par ${c.createdBy}` : "Équipe"}
                      {c.note && <span className="block text-xs">{c.note}</span>}
                      <span className="block text-xs">
                        Le {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                        {c.expiresAt && ` · jusqu'au ${new Date(c.expiresAt).toLocaleDateString("fr-FR")}`}
                      </span>
                    </td>
                    <td className={`px-4 py-2 ${state[1]}`}>{state[0]}</td>
                    <td className="px-4 py-2 text-right">
                      {!c.disabled && !expired && !exhausted && (
                        <button onClick={() => disable(c)} className="text-xs text-danger hover:underline">Désactiver</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
