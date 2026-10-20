"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ALL_GAMES, COSMETIC_TYPE_LABEL, EVENT_TOURNAMENT_CAPACITIES, GAME_NAMES, GAME_SLUGS, ROOM_TIME_CHOICES, TOURNAMENT_ROUND_CHOICES,
  TOURNAMENT_STATUS_LABEL, firstIssue, tournamentRewardLabel, CreateEventTournamentInput,
  type AdminCosmeticDto, type GameSlug, type TournamentRewardDto, type TournamentStatus,
} from "@ranksight/shared";
import { adminFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type EventRow = {
  id: string; code: string; title: string | null; status: TournamentStatus; game: { slug: string; name: string };
  capacity: number; rounds: number; roundSec: number; players: number; reward: TournamentRewardDto | null;
  rewardGrantedAt: string | null; winner: string | null; createdAt: string; expiresAt: string; startsAt: string | null;
};

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000";

/** Événements : tournois créés par l'équipe, visibles par tous les joueurs, jusqu'à 64 places, récompense du vainqueur. */
export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [cosmetics, setCosmetics] = useState<AdminCosmeticDto[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const [form, setForm] = useState({
    title: "", game: GAME_SLUGS[0] as GameSlug | typeof ALL_GAMES.slug, capacity: 16, rounds: 3, roundSec: 30, rewardCosmeticId: "", rewardVipDays: "", startsAt: "",
  });

  const load = useCallback(() => {
    adminFetch<EventRow[]>("/tournaments").then(setEvents, (e: Error) => setMessage({ text: e.message, ok: false }));
  }, []);
  useEffect(() => {
    load();
    adminFetch<AdminCosmeticDto[]>("/cosmetics").then((c) => setCosmetics(c.filter((x) => x.isActive)), () => setCosmetics([]));
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ text: success, ok: true });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = CreateEventTournamentInput.safeParse({
      ...form, rewardCosmeticId: form.rewardCosmeticId || null, rewardVipDays: form.rewardVipDays ? Number(form.rewardVipDays) : null,
      // Heure locale du navigateur → ISO
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    });
    if (!parsed.success) return setMessage({ text: firstIssue(parsed.error), ok: false });
    void run(async () => {
      await adminFetch("/tournaments", { method: "POST", body: JSON.stringify(parsed.data) });
      setForm((f) => ({ ...f, title: "", rewardCosmeticId: "", rewardVipDays: "", startsAt: "" }));
    }, "Événement créé : il apparaît dans la page Tournois du site.");
  };

  const start = async (ev: EventRow) => {
    const ok = await confirm({ title: `Lancer « ${ev.title} » ?`, message: `${ev.players} inscrit${ev.players > 1 ? "s" : ""} : les inscriptions seront fermées et le tableau tiré au sort.`, confirmLabel: "Lancer" });
    if (ok === false) return;
    void run(() => adminFetch(`/tournaments/${ev.id}/start`, { method: "POST" }), "Événement lancé.");
  };

  const reward = tournamentRewardLabel(form.rewardCosmeticId || form.rewardVipDays
    ? { cosmetic: cosmetics.find((c) => c.id === form.rewardCosmeticId) ?? null, vipDays: form.rewardVipDays ? Number(form.rewardVipDays) : null }
    : null);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Événements</h1>
        <p className="text-sm text-muted">
          Tournois organisés par l&apos;équipe : visibles par tous dans la page Tournois, inscription gratuite, jusqu&apos;à 64 joueurs.
          La récompense est donnée automatiquement au vainqueur à la fin de la finale.
        </p>
      </header>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}

      <form onSubmit={create} className="glass grid gap-3 p-5 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="hud-label">Nom de l&apos;événement</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={60} placeholder="Ex. Coupe d'hiver Valorant" className="input" required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Jeu</span>
          <select value={form.game} onChange={(e) => setForm({ ...form, game: e.target.value as GameSlug })} className="input">
            {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
            <option value={ALL_GAMES.slug}>{ALL_GAMES.name}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Places</span>
          <select value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} className="input">
            {EVENT_TOURNAMENT_CAPACITIES.map((n) => <option key={n} value={n}>{n} joueurs</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Manches par match</span>
          <select value={form.rounds} onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })} className="input">
            {TOURNAMENT_ROUND_CHOICES.map((n) => <option key={n} value={n}>{n} manches</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Temps par manche</span>
          <select value={form.roundSec} onChange={(e) => setForm({ ...form, roundSec: Number(e.target.value) })} className="input">
            {ROOM_TIME_CHOICES.map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Récompense : titre, badge ou cadre</span>
          <select value={form.rewardCosmeticId} onChange={(e) => setForm({ ...form, rewardCosmeticId: e.target.value })} className="input">
            <option value="">Aucun</option>
            {cosmetics.map((c) => <option key={c.id} value={c.id}>{COSMETIC_TYPE_LABEL[c.type]} · {c.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Récompense : jours de VIP</span>
          <input type="number" min={1} max={365} value={form.rewardVipDays} onChange={(e) => setForm({ ...form, rewardVipDays: e.target.value })} placeholder="Aucun" className="input" />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="hud-label">Début programmé (facultatif)</span>
          <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="input" />
          <span className="block text-xs text-muted">
            À cette heure, l&apos;événement se lance tout seul s&apos;il a au moins 3 inscrits (sinon il est fermé). Les inscrits reçoivent un rappel 10 minutes avant.
            Sans heure, tu le lances à la main avec le bouton « Lancer ».
          </span>
        </label>
        <p className="text-sm text-muted sm:col-span-2">Vainqueur : {reward ?? "pas de récompense"}. Les titres, badges et cadres se créent dans la page Récompenses.</p>
        <button disabled={busy} className="btn-primary sm:col-span-2 sm:w-fit">Créer l&apos;événement</button>
      </form>

      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="text-left text-muted">
            <tr><th className="p-3 font-normal">Événement</th><th className="font-normal">Statut</th><th className="font-normal">Inscrits</th><th className="font-normal">Récompense</th><th className="font-normal">Vainqueur</th><th /></tr>
          </thead>
          <tbody>
            {events?.map((ev) => (
              <tr key={ev.id} className="border-t border-line/60">
                <td className="p-3">
                  <a href={`${WEB_URL}/tournaments/${ev.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:text-neon">{ev.title}</a>
                  <p className="text-xs text-muted">{ev.game.name} · {ev.rounds} manches · {ev.roundSec} s · code {ev.code}</p>
                  {ev.startsAt && <p className="text-xs text-neon">Début programmé : {new Date(ev.startsAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</p>}
                </td>
                <td>{TOURNAMENT_STATUS_LABEL[ev.status]}</td>
                <td>{ev.players}/{ev.capacity}</td>
                <td>{tournamentRewardLabel(ev.reward) ?? "—"}{ev.rewardGrantedAt && <span className="block text-xs text-success">donnée</span>}</td>
                <td>{ev.winner ?? "—"}</td>
                <td className="pr-3 text-right">
                  {ev.status === "LOBBY" && <button disabled={busy || ev.players < 3} onClick={() => start(ev)} className="btn-ghost !py-1 text-xs" title={ev.players < 3 ? "3 inscrits au moins" : undefined}>Lancer</button>}
                </td>
              </tr>
            ))}
            {events?.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Aucun événement pour l&apos;instant.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
