"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SEASON_REWARD_LABEL, SEASON_REWARD_SLOTS, SEASON_STATUS_LABEL, SeasonInput, defaultSeasonRewards, isAdminRole,
  type AdminSeasonDto, type SeasonRewards, type SeasonStatus,
} from "@ranksight/shared";
import { adminFetch, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

const STATUS_STYLE: Record<SeasonStatus, string> = {
  upcoming: "bg-neon/10 text-neon",
  current: "bg-success/15 text-success",
  to_close: "bg-warn/15 text-warn",
  closed: "bg-violet/20 text-violet-soft",
};

type Form = { name: string; number: string; startsAt: string; endsAt: string; rewardsEnabled: boolean; rewards: SeasonRewards };
type Editing = { mode: "create" } | { mode: "edit"; season: AdminSeasonDto };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/**
 * Les saisons suivent l'heure UTC, comme le changement des défis du jour (1 h du matin à Paris en hiver, 2 h en été).
 * Jour UTC d'une date ISO, pour un champ <input type="date">.
 */
const utcDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** Début (00:00 UTC) ou fin (23:59:59 UTC) d'un jour */
const dayStart = (day: string) => `${day}T00:00:00.000Z`;
const dayEnd = (day: string) => `${day}T23:59:59.999Z`;
const fmt = (iso: string) => `${new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;

/** Proposition pour une nouvelle saison : numéro suivant, du lendemain de la dernière saison, pour un mois */
function suggestion(seasons: AdminSeasonDto[]): Form {
  const number = Math.max(0, ...seasons.map((s) => s.number ?? 0)) + 1;
  const lastEnd = Math.max(Date.now(), ...seasons.map((s) => new Date(s.endsAt).getTime()));
  const start = new Date(lastEnd + 1);
  start.setUTCHours(0, 0, 0, 0);
  if (start.getTime() <= lastEnd) start.setTime(start.getTime() + DAY);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setTime(end.getTime() - 1);
  const name = `Saison ${number}`;
  return { name, number: String(number), startsAt: start.toISOString(), endsAt: end.toISOString(), rewardsEnabled: true, rewards: defaultSeasonRewards(name) };
}

/** Saisons à dates libres : création, modification, suppression avant le début, clôture et classement. */
export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<AdminSeasonDto[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const confirm = useConfirm();
  const admin = isAdminRole(me?.role);

  const load = useCallback(() => {
    adminFetch<AdminSeasonDto[]>("/seasons").then(setSeasons, (e: Error) => setMessage({ text: e.message, ok: false }));
  }, []);
  useEffect(() => {
    load();
    session.me().then(setMe).catch(() => setMe(null));
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ text: success, ok: true });
      load();
      return true;
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    if (!seasons) return;
    setEditing({ mode: "create" });
    setForm(suggestion(seasons));
  };
  const openEdit = (s: AdminSeasonDto) => {
    setEditing({ mode: "edit", season: s });
    setForm({ name: s.name, number: s.number ? String(s.number) : "", startsAt: s.startsAt, endsAt: s.endsAt, rewardsEnabled: s.rewardsEnabled, rewards: s.rewardsConfig });
  };
  const closeEditor = () => {
    setEditing(null);
    setForm(null);
  };

  const save = async () => {
    if (!form || !editing) return;
    const body = { ...form, name: form.name.trim(), number: form.number ? Number(form.number) : null };
    const parsed = SeasonInput.safeParse(body);
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Formulaire incomplet.", ok: false });
    const ok =
      editing.mode === "create"
        ? await run(() => adminFetch("/seasons", { method: "POST", body: JSON.stringify(parsed.data) }), `${body.name} créée.`)
        : await run(() => adminFetch(`/seasons/${editing.season.key}`, { method: "PATCH", body: JSON.stringify(parsed.data) }), `${body.name} enregistrée.`);
    if (ok) closeEditor();
  };

  const remove = async (s: AdminSeasonDto) => {
    const ok = await confirm({ title: `Supprimer ${s.name} ?`, message: "Elle n'a pas commencé : aucun point n'est perdu.", confirmLabel: "Supprimer", danger: true });
    if (ok === false) return;
    await run(() => adminFetch(`/seasons/${s.key}`, { method: "DELETE" }), `${s.name} supprimée.`);
  };

  const close = async (s: AdminSeasonDto) => {
    const ok = await confirm({
      title: `Clôturer ${s.name} ?`,
      message: s.rewardsEnabled
        ? "Le classement sera figé et les récompenses attribuées (succès, titres, badge, meilleur contributeur). Action définitive."
        : "Le classement sera figé. Cette saison n'attribue pas de récompense. Action définitive.",
      confirmLabel: "Clôturer",
    });
    if (ok === false) return;
    await run(() => adminFetch(`/seasons/${s.key}/close`, { method: "POST" }), `${s.name} clôturée.`);
  };

  if (!seasons) return message ? <p className="text-danger">{message.text}</p> : <div className="glass h-40 animate-pulse" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h1 className="font-display text-2xl font-bold">Saisons</h1>
          <p className="text-sm text-muted">
            Chaque saison a ses dates, son nom et ses récompenses. Les défis du jour comptent pour la saison en cours ; entre deux saisons, seuls les
            classements jour, semaine et total avancent. Une saison terminée est clôturée automatiquement dans l&apos;heure : classement figé et
            récompenses attribuées si elle en a. Les dates suivent l&apos;heure UTC, comme le changement des défis du jour
            (1 h du matin à Paris en hiver, 2 h en été).
          </p>
        </div>
        {admin && !editing && (
          <button onClick={openCreate} className="btn-primary">Nouvelle saison</button>
        )}
      </div>
      {message && <p role="status" className={`glass p-3 text-sm ${message.ok ? "" : "text-danger"}`}>{message.text}</p>}

      {editing && form && (
        <SeasonEditor
          title={editing.mode === "create" ? "Nouvelle saison" : `Modifier ${editing.season.name}`}
          status={editing.mode === "edit" ? editing.season.status : "upcoming"}
          form={form}
          setForm={setForm}
          busy={busy}
          onSave={() => void save()}
          onCancel={closeEditor}
        />
      )}

      <ul className="space-y-4">
        {seasons.map((s) => (
          <li key={s.key} className="glass space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-display text-lg font-semibold">
                  {s.name}
                  {s.number === null && <span className="ml-2 text-xs font-normal text-muted">hors numérotation</span>}
                </p>
                <p className="text-xs text-muted">
                  Du {fmt(s.startsAt)} au {fmt(s.endsAt)} · {s.players} joueur(s) classé(s) · clé {s.key}
                  {s.closedAt && ` · clôturée le ${new Date(s.closedAt).toLocaleString("fr-FR")}`}
                </p>
                <p className="text-xs">
                  {s.rewardsEnabled ? (
                    <>
                      Récompenses :{" "}
                      {SEASON_REWARD_SLOTS.map((slot) => (
                        <span key={slot} className="mr-2" style={{ color: s.rewardsConfig[slot].color }}>
                          {s.rewardsConfig[slot].name}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-muted">Sans récompense</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{SEASON_STATUS_LABEL[s.status]}</span>
                {admin && !editing && (
                  <button onClick={() => openEdit(s)} className="btn-ghost !py-1.5 text-sm">Modifier</button>
                )}
                {admin && s.status === "upcoming" && !editing && (
                  <button onClick={() => remove(s)} disabled={busy} className="btn-ghost !py-1.5 text-sm hover:!border-danger hover:!text-danger">Supprimer</button>
                )}
                {admin && s.status === "to_close" && (
                  <button onClick={() => close(s)} disabled={busy} className="btn-primary !py-1.5 text-sm">Clôturer</button>
                )}
              </div>
            </div>
            {s.status !== "upcoming" &&
              (s.top.length > 0 ? (
                <ol className="divide-y divide-line/60 text-sm">
                  {s.top.map((e) => (
                    <li key={e.userId} className="flex items-center gap-3 py-2">
                      <span className={`w-6 font-mono ${e.rank <= 3 ? "text-neon" : "text-muted"}`}>{e.rank}</span>
                      <span className="flex-1">{e.username}</span>
                      <span className="font-mono">{e.score} pts</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Aucun point marqué pendant cette saison.</p>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeasonEditor({ title, status, form, setForm, busy, onSave, onCancel }: {
  title: string;
  status: SeasonStatus;
  form: Form;
  setForm: (f: Form) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const closed = status === "closed";
  const started = status !== "upcoming";
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setReward = (slot: keyof SeasonRewards, patch: Partial<SeasonRewards[keyof SeasonRewards]>) =>
    set({ rewards: { ...form.rewards, [slot]: { ...form.rewards[slot], ...patch } } });

  return (
    <section className="glass space-y-5 border-violet/40 p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {closed && <p className="text-sm text-warn">Saison clôturée : seul son nom peut encore être modifié.</p>}
      {!closed && started && <p className="text-sm text-muted">La saison a commencé : sa date de début est figée, la date de fin reste modifiable.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="hud-label block">Nom</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} className="input" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label block">Numéro</span>
          <input
            type="number"
            min={1}
            value={form.number}
            onChange={(e) => set({ number: e.target.value })}
            disabled={closed}
            placeholder="Aucun (bêta, événement)"
            className="input disabled:opacity-50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label block">Début (00:00 UTC)</span>
          <input
            type="date"
            value={utcDay(form.startsAt)}
            onChange={(e) => e.target.value && set({ startsAt: dayStart(e.target.value) })}
            disabled={started}
            className="input disabled:opacity-50"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label block">Fin (23:59 UTC)</span>
          <input
            type="date"
            value={utcDay(form.endsAt)}
            onChange={(e) => e.target.value && set({ endsAt: dayEnd(e.target.value) })}
            disabled={closed}
            className="input disabled:opacity-50"
          />
        </label>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.rewardsEnabled} onChange={(e) => set({ rewardsEnabled: e.target.checked })} disabled={closed} className="h-4 w-4 accent-violet" />
          Récompenses de fin de saison (succès de classement, titres, badge, meilleur contributeur)
        </label>
        <div className={`grid gap-3 sm:grid-cols-2 ${form.rewardsEnabled ? "" : "opacity-50"}`}>
          {SEASON_REWARD_SLOTS.map((slot) => (
            <div key={slot} className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-sm">
                <span className="hud-label block">{SEASON_REWARD_LABEL[slot]}</span>
                <input
                  value={form.rewards[slot].name}
                  onChange={(e) => setReward(slot, { name: e.target.value })}
                  maxLength={40}
                  disabled={closed}
                  className="input"
                  style={{ color: form.rewards[slot].color }}
                />
              </label>
              <input
                type="color"
                value={form.rewards[slot].color}
                onChange={(e) => setReward(slot, { color: e.target.value.toUpperCase() })}
                disabled={closed}
                aria-label={`Couleur : ${SEASON_REWARD_LABEL[slot]}`}
                className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-surface"
              />
            </div>
          ))}
        </div>
        {!closed && (
          <button onClick={() => set({ rewards: defaultSeasonRewards(form.name.trim() || "Saison") })} className="text-xs text-violet-soft hover:underline">
            Noms des récompenses d&apos;après le nom de la saison
          </button>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">Annuler</button>
        <button onClick={onSave} disabled={busy} className="btn-primary">{busy ? "…" : "Enregistrer"}</button>
      </div>
    </section>
  );
}
