"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BADGE_ICONS, BADGE_ICON_KEYS, COSMETIC_COLORS, COSMETIC_SOURCE_LABEL, COSMETIC_TYPE_LABEL, COSMETIC_TYPE_PLURAL, CosmeticInput,
  type AdminCosmeticDto, type BadgeIcon, type CosmeticHolderDto, type CosmeticType, isAdminRole } from "@ranksight/shared";
import { adminFetch, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { BadgeChip, FrameSwatch, TitleText } from "@/components/Flair";

type AchievementOption = { id: string; code: string; name: string; isActive: boolean; isHidden: boolean };
type Unlock = "none" | "level" | "achievement";
type Form = {
  id?: string; type: CosmeticType; name: string; description: string; color: string; color2: string; icon: BadgeIcon;
  unlock: Unlock; level: string; achievementId: string; isActive: boolean;
};

const TYPES: CosmeticType[] = ["TITLE", "BADGE", "FRAME"];
const EMPTY: Form = {
  type: "TITLE", name: "", description: "", color: "#A78BFA", color2: "", icon: "star", unlock: "none", level: "10", achievementId: "", isActive: true,
};

const toForm = (c: AdminCosmeticDto): Form => ({
  id: c.id, type: c.type, name: c.name, description: c.description ?? "", color: c.color, color2: c.color2 ?? "",
  icon: (c.icon as BadgeIcon) ?? "star",
  unlock: c.unlockLevel ? "level" : c.unlockAchievement ? "achievement" : "none",
  level: String(c.unlockLevel ?? 10), achievementId: c.unlockAchievement?.id ?? "", isActive: c.isActive,
});

function unlockLabel(c: AdminCosmeticDto) {
  if (c.unlockLevel) return `Automatique · niveau ${c.unlockLevel}`;
  if (c.unlockAchievement) return `Automatique · succès « ${c.unlockAchievement.name} »`;
  if (c.key.startsWith("season-")) return "Automatique · classement de saison";
  return "Attribuée par l'équipe";
}

/** Récompenses : titres, badges et cadres d'avatar (création, paliers de niveau, succès, attribution manuelle). */
export default function RewardsPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<AdminCosmeticDto[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementOption[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [filter, setFilter] = useState<CosmeticType | "ALL">("ALL");
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [openHolders, setOpenHolders] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<AdminCosmeticDto[]>("/cosmetics").then(setItems, (e: Error) => setMessage({ text: e.message, ok: false }));
  }, []);
  useEffect(() => {
    load();
    adminFetch<AchievementOption[]>("/cosmetics/achievements").then(setAchievements, () => setAchievements([]));
    session.me().then(setMe, () => setMe(null));
  }, [load]);

  const isAdmin = isAdminRole(me?.role);
  const visible = (items ?? []).filter((c) => filter === "ALL" || c.type === filter);

  const save = async (f: Form) => {
    const body = {
      type: f.type,
      name: f.name,
      description: f.description.trim() || null,
      color: f.color,
      color2: f.type === "FRAME" && f.color2 ? f.color2 : null,
      icon: f.type === "BADGE" ? f.icon : null,
      unlockLevel: f.unlock === "level" ? Number(f.level) : null,
      unlockAchievementId: f.unlock === "achievement" ? f.achievementId || null : null,
      isActive: f.isActive,
    };
    const parsed = CosmeticInput.safeParse(body);
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Formulaire incomplet.", ok: false });
    if (f.unlock === "achievement" && !f.achievementId) return setMessage({ text: "Choisis le succès qui débloque la récompense.", ok: false });
    try {
      const r = await adminFetch<{ id: string; granted: number }>(f.id ? `/cosmetics/${f.id}` : "/cosmetics", {
        method: f.id ? "PATCH" : "POST",
        body: JSON.stringify(parsed.data),
      });
      setMessage({
        text: `« ${f.name} » ${f.id ? "modifiée" : "créée"}.${r.granted ? ` Attribuée à ${r.granted} joueur(s) qui remplissaient déjà la condition.` : ""}`,
        ok: true,
      });
      setForm(null);
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    }
  };

  const toggleActive = async (c: AdminCosmeticDto) => {
    if (c.isActive) {
      const ok = await confirm({
        title: `Désactiver « ${c.name} » ?`,
        message: "Elle ne sera plus affichée ni attribuée. Les joueurs qui l'ont la retrouveront si tu la réactives.",
        confirmLabel: "Désactiver",
        danger: true,
      });
      if (ok === false) return;
    }
    await save({ ...toForm(c), isActive: !c.isActive });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Récompenses</h1>
          <p className="text-sm text-muted">
            Titres (sous le pseudo), badges (à côté du pseudo) et cadres (autour de la photo). Automatiques avec un niveau ou un succès,
            ou attribuées à la main (Youtubeur, Streamer…). Le titre « Champion saison N » est créé et donné à la clôture de chaque saison.
          </p>
        </div>
        {isAdmin && !form && <button onClick={() => setForm({ ...EMPTY })} className="btn-primary !py-2">Nouvelle récompense</button>}
      </div>

      {message && <p role="status" className={`glass p-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      {form && <CosmeticForm form={form} setForm={setForm} achievements={achievements} onSave={save} onCancel={() => setForm(null)} />}

      <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {(["ALL", ...TYPES] as const).map((t) => (
          <button key={t} role="tab" aria-selected={filter === t} onClick={() => setFilter(t)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === t ? "bg-violet text-white" : "text-muted hover:text-ink"}`}>
            {t === "ALL" ? "Toutes" : COSMETIC_TYPE_PLURAL[t]}
            {items ? ` (${t === "ALL" ? items.length : items.filter((c) => c.type === t).length})` : ""}
          </button>
        ))}
      </div>

      {!items ? <p className="text-muted">Chargement…</p> : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <li key={c.id} className={`glass space-y-3 p-4 ${c.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-4">
                <Visual c={c} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" style={{ color: c.color }}>{c.name}</span>
                    <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">{COSMETIC_TYPE_LABEL[c.type]}</span>
                    {!c.isActive && <span className="rounded bg-danger/15 px-1.5 text-[11px] text-danger">désactivée</span>}
                  </p>
                  {c.description && <p className="text-xs text-muted">{c.description}</p>}
                  <p className="text-xs text-muted">{unlockLabel(c)} · {c.owners} joueur{c.owners > 1 ? "s" : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setOpenHolders(openHolders === c.id ? null : c.id)} className="btn-ghost !py-1 text-xs">
                    {openHolders === c.id ? "Fermer" : "Joueurs"}
                  </button>
                  {isAdmin && <button onClick={() => { setForm(toForm(c)); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="btn-ghost !py-1 text-xs">Modifier</button>}
                  {isAdmin && (
                    <button onClick={() => toggleActive(c)} className="btn-ghost !py-1 text-xs">{c.isActive ? "Désactiver" : "Réactiver"}</button>
                  )}
                </div>
              </div>
              {openHolders === c.id && <Holders cosmetic={c} canEdit={isAdmin} onChanged={load} />}
            </li>
          ))}
          {visible.length === 0 && <li className="glass p-6 text-center text-muted">Aucune récompense ici.</li>}
        </ul>
      )}
      {me && !isAdmin && <p className="text-xs text-muted">Seul un administrateur peut créer, modifier ou attribuer une récompense.</p>}
    </div>
  );
}

function Visual({ c, size = 16 }: { c: Pick<AdminCosmeticDto, "type" | "name" | "color" | "color2" | "icon">; size?: number }) {
  if (c.type === "BADGE") return <BadgeChip badge={c} size={size} />;
  if (c.type === "FRAME") return <FrameSwatch frame={c} size={size + 20} />;
  return <span className="grid w-9 place-items-center"><span className="h-3 w-3 rounded-full" style={{ background: c.color }} /></span>;
}

function CosmeticForm({
  form, setForm, achievements, onSave, onCancel,
}: {
  form: Form;
  setForm: (f: Form) => void;
  achievements: AchievementOption[];
  onSave: (f: Form) => Promise<void>;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      await onSave(form);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass space-y-4 p-5">
      <h2 className="font-display text-lg font-semibold">{form.id ? `Modifier « ${form.name} »` : "Nouvelle récompense"}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Type</span>
          <select value={form.type} disabled={!!form.id} onChange={(e) => set({ type: e.target.value as CosmeticType })} className="input">
            {TYPES.map((t) => <option key={t} value={t}>{COSMETIC_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Nom affiché</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} placeholder="Ex. Youtubeur" className="input" required />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-muted">Description (visible par les joueurs)</span>
          <input value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} placeholder="Ex. Créateur de vidéos sur RankGuess" className="input" />
        </label>
      </div>

      <div className="space-y-2 text-sm">
        <p className="text-muted">{form.type === "FRAME" ? "Couleur de départ" : "Couleur"}</p>
        <ColorPicker value={form.color} onChange={(color) => set({ color })} />
      </div>
      {form.type === "FRAME" && (
        <div className="space-y-2 text-sm">
          <p className="text-muted">Couleur de fin du dégradé (facultatif)</p>
          <ColorPicker value={form.color2} onChange={(color2) => set({ color2 })} allowNone />
        </div>
      )}
      {form.type === "BADGE" && (
        <div className="space-y-2 text-sm">
          <p className="text-muted">Icône</p>
          <div className="flex flex-wrap gap-2">
            {BADGE_ICON_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set({ icon: k })}
                aria-pressed={form.icon === k}
                title={BADGE_ICONS[k].label}
                className={`rounded-lg p-1 ${form.icon === k ? "ring-2 ring-neon" : "hover:bg-surface-2"}`}
              >
                <BadgeChip badge={{ name: BADGE_ICONS[k].label, color: form.color, icon: k }} size={16} />
              </button>
            ))}
          </div>
        </div>
      )}

      <fieldset className="space-y-2 text-sm">
        <legend className="text-muted">Obtention</legend>
        <div className="flex flex-wrap gap-4">
          {([["none", "Attribuée par l'équipe"], ["level", "Palier de niveau"], ["achievement", "Succès"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="unlock" checked={form.unlock === k} onChange={() => set({ unlock: k })} className="accent-violet" /> {label}
            </label>
          ))}
        </div>
        {form.unlock === "level" && (
          <label className="flex items-center gap-2">
            Niveau
            <input type="number" min={2} max={500} value={form.level} onChange={(e) => set({ level: e.target.value })} className="input !w-24" />
          </label>
        )}
        {form.unlock === "achievement" && (
          <select value={form.achievementId} onChange={(e) => set({ achievementId: e.target.value })} className="input max-w-md">
            <option value="">Choisir un succès…</option>
            {achievements.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.isHidden ? " (secret)" : ""}{a.isActive ? "" : " (désactivé)"}</option>
            ))}
          </select>
        )}
        {form.unlock !== "none" && (
          <p className="text-xs text-muted">Les joueurs qui remplissent déjà la condition la reçoivent à l&apos;enregistrement.</p>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 border-t border-line/60 pt-4">
        <span className="text-sm text-muted">Aperçu :</span>
        <Preview form={form} />
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary !py-2">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        <button type="button" onClick={onCancel} className="btn-ghost">Annuler</button>
      </div>
    </form>
  );
}

function Preview({ form }: { form: Form }) {
  const ref = { name: form.name || "Nom", color: form.color, color2: form.color2 || null, icon: form.icon };
  const frame = form.type === "FRAME" ? ref : null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2">
      <span
        className="inline-grid place-items-center rounded-full"
        style={{ padding: frame ? 3 : 0, background: frame ? (frame.color2 ? `linear-gradient(135deg, ${frame.color}, ${frame.color2})` : frame.color) : undefined }}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-violet to-neon-blue font-display font-bold text-white">J</span>
      </span>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">Joueur {form.type === "BADGE" && <BadgeChip badge={ref} size={12} />}</p>
        {form.type === "TITLE" && <TitleText title={ref} />}
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowNone && (
        <button type="button" onClick={() => onChange("")} aria-pressed={!value} className={`h-7 rounded-full border border-dashed border-line px-2 text-xs ${!value ? "ring-2 ring-neon" : ""}`}>
          Aucune
        </button>
      )}
      {COSMETIC_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Couleur ${c}`}
          aria-pressed={value.toUpperCase() === c}
          className={`h-7 w-7 rounded-full border border-line ${value.toUpperCase() === c ? "ring-2 ring-neon ring-offset-2 ring-offset-surface" : ""}`}
          style={{ background: c }}
        />
      ))}
      <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label="Autre couleur" className="h-7 w-10 cursor-pointer rounded border border-line bg-surface" />
    </div>
  );
}

/** Joueurs qui ont la récompense, attribution par pseudo et retrait (attributions manuelles et de saison) */
function Holders({ cosmetic, canEdit, onChanged }: { cosmetic: AdminCosmeticDto; canEdit: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<CosmeticHolderDto[] | null>(null);
  const [pseudo, setPseudo] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    adminFetch<CosmeticHolderDto[]>(`/cosmetics/${cosmetic.id}/holders`).then(setRows, (e: Error) => setMessage({ text: e.message, ok: false }));
  }, [cosmetic.id]);
  useEffect(load, [load]);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      const r = await adminFetch<{ displayName: string }>(`/cosmetics/${cosmetic.id}/grant`, {
        method: "POST",
        body: JSON.stringify({ pseudo: pseudo.trim(), note: note.trim() || null }),
      });
      setMessage({ text: `« ${cosmetic.name} » attribuée à ${r.displayName}.`, ok: true });
      setPseudo("");
      setNote("");
      load();
      onChanged();
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  const revoke = async (h: CosmeticHolderDto) => {
    const ok = await confirm({ title: `Retirer « ${cosmetic.name} » à ${h.displayName} ?`, message: "S'il l'avait équipée, elle est retirée de son profil.", confirmLabel: "Retirer", danger: true });
    if (ok === false) return;
    setMessage(null);
    try {
      await adminFetch(`/users/${h.userId}/cosmetics/${cosmetic.id}`, { method: "DELETE" });
      load();
      onChanged();
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  const automatic = !!cosmetic.unlockLevel || !!cosmetic.unlockAchievement;

  return (
    <div className="space-y-3 border-t border-line/60 pt-3">
      {canEdit && cosmetic.isActive && (
        <form onSubmit={grant} className="flex flex-wrap gap-2">
          <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Pseudo du joueur" className="input !w-48" required />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Raison (interne, facultatif)" className="input min-w-48 flex-1" />
          <button className="btn-primary !py-2">Attribuer</button>
        </form>
      )}
      {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      {!rows ? <p className="text-sm text-muted">Chargement…</p> : rows.length === 0 ? (
        <p className="text-sm text-muted">Personne n&apos;a encore cette récompense.</p>
      ) : (
        <ul className="divide-y divide-line/60 text-sm">
          {rows.map((h) => (
            <li key={h.userId} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{h.displayName}</span>
              <span className="text-xs text-muted">
                {COSMETIC_SOURCE_LABEL[h.source]} · {new Date(h.grantedAt).toLocaleDateString("fr-FR")}
                {h.grantedBy ? ` · par ${h.grantedBy}` : ""}
                {h.note ? ` · ${h.note}` : ""}
              </span>
              {canEdit && (h.source === "MANUAL" || h.source === "SEASON") && (
                <button onClick={() => revoke(h)} className="ml-auto text-xs text-danger hover:underline">Retirer</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {automatic && <p className="text-xs text-muted">Récompense automatique : pour la retirer à tout le monde, désactive-la.</p>}
    </div>
  );
}
