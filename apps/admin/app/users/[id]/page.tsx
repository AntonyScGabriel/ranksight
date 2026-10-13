"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AUDIT_FIELD_LABEL, GAME_MODE_LABEL, GAME_NAMES, GAME_SLUGS, GUESS_RESULT_LABEL, HISTORY_FLAG_LABEL, INDICATOR_STATUS_LABEL, ROLE_LABEL,
  type GameMode, type GuessAggregateDto, type GuessResult, type IndicatorStatus, type PlayerAuditDto, type PlayerAuditEntryDto,
  type PlayerHistoryDto, type PlayerHistoryItemDto, type PlayerIndicatorDto, type PlayerIndicatorsDto, type PlayerStatsDto, type UserRole,
} from "@ranksight/shared";
import { adminFetch } from "@/lib/api";

type Tab = "games" | "records" | "audit" | "indicators";
type Filters = { game: string; mode: string; result: string; from: string; to: string; ids: string };

const EMPTY_FILTERS: Filters = { game: "", mode: "", result: "", from: "", to: "", ids: "" };
const STATUS_ORDER: IndicatorStatus[] = ["alert", "warning", "info", "ok"];
const STATUS_STYLE: Record<IndicatorStatus, string> = {
  alert: "bg-danger/15 text-danger border-danger/40",
  warning: "bg-warn/15 text-warn border-warn/40",
  info: "bg-violet/15 text-violet-soft border-violet/40",
  ok: "bg-success/10 text-success border-success/30",
};
const RESULT_STYLE: Record<GuessResult, string> = { exact: "text-success", close: "text-warn", miss: "text-danger" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Actif", SUSPENDED: "Suspendu", BANNED: "Banni", DELETED: "Supprimé" };

const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;
const dateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" });
const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/** Fiche d'un joueur : historique des parties, records et statistiques, journal d'audit, indicateurs pour enquêter. */
export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("games");
  const [stats, setStats] = useState<PlayerStatsDto | null>(null);
  const [indicators, setIndicators] = useState<PlayerIndicatorsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const loadSummary = useCallback(() => {
    adminFetch<PlayerStatsDto>(`/users/${id}/stats`).then(setStats, (e: Error) => setError(e.message));
    adminFetch<PlayerIndicatorsDto>(`/users/${id}/indicators`).then(setIndicators, (e: Error) => setError(e.message));
  }, [id]);
  useEffect(loadSummary, [loadSummary]);

  const flagged = indicators?.indicators.filter((i) => i.status === "alert" || i.status === "warning").length ?? 0;

  const showGuesses = (ids: string[]) => {
    setFilters({ ...EMPTY_FILTERS, ids: ids.join(",") });
    setTab("games");
  };

  if (error && !stats) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="glass p-6 text-danger">{error}</p>
      </div>
    );
  }
  if (!stats) return <div className="glass h-40 animate-pulse" />;
  const u = stats.user;

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold">{u.displayName}</h1>
          <p className="text-sm text-muted">
            @{u.username} · {ROLE_LABEL[u.role as UserRole] ?? u.role} ·{" "}
            <span className={u.status === "ACTIVE" ? "text-success" : "text-danger"}>{STATUS_LABEL[u.status] ?? u.status}</span> · inscrit le{" "}
            {new Date(u.createdAt).toLocaleDateString("fr-FR")}
            {u.lastPlayedAt ? ` · dernière partie le ${dateTime(u.lastPlayedAt)}` : " · aucune partie"}
          </p>
          {u.statsResetAt && (
            <p className="text-sm text-warn">Statistiques remises à zéro le {dateTime(u.statsResetAt)} : les parties antérieures restent visibles mais ne comptent plus.</p>
          )}
        </div>
        <p className="max-w-sm text-xs text-muted">
          Ces informations servent à enquêter. Aucun indicateur ne déclenche de sanction : bannissement et remise à zéro restent des décisions de
          l&apos;équipe, depuis la liste des utilisateurs.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-line/60" role="tablist">
        {(
          [
            ["games", "Parties"],
            ["records", "Records et statistiques"],
            ["audit", "Journal"],
            ["indicators", "Indicateurs"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-violet text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
            {k === "indicators" && flagged > 0 && <span className="ml-2 rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{flagged}</span>}
          </button>
        ))}
      </nav>

      {tab === "games" && <GamesTab key={filters.ids} id={id} filters={filters} setFilters={setFilters} />}
      {tab === "records" && <RecordsTab stats={stats} />}
      {tab === "audit" && <AuditTab id={id} />}
      {tab === "indicators" && <IndicatorsTab data={indicators} onShow={showGuesses} onRefresh={loadSummary} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/users" className="text-sm text-muted hover:text-ink">
      ← Utilisateurs
    </Link>
  );
}

// ---------- Parties ----------

function GamesTab({ id, filters, setFilters }: { id: string; filters: Filters; setFilters: (f: Filters) => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PlayerHistoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page) });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters, page]);

  useEffect(() => {
    adminFetch<PlayerHistoryDto>(`/users/${id}/history?${query}`).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [id, query]);

  const set = (patch: Partial<Filters>) => {
    setPage(1);
    setFilters({ ...filters, ...patch, ids: "" });
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <Select label="Jeu" value={filters.game} onChange={(game) => set({ game })} options={GAME_SLUGS.map((s) => [s, GAME_NAMES[s]])} />
        <Select label="Mode" value={filters.mode} onChange={(mode) => set({ mode })} options={(Object.keys(GAME_MODE_LABEL) as GameMode[]).map((m) => [m, GAME_MODE_LABEL[m]])} />
        <Select label="Résultat" value={filters.result} onChange={(result) => set({ result })} options={(Object.keys(GUESS_RESULT_LABEL) as GuessResult[]).map((r) => [r, GUESS_RESULT_LABEL[r]])} />
        <label className="space-y-1">
          <span className="hud-label block">Du</span>
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="rounded-lg border border-line bg-surface p-2" />
        </label>
        <label className="space-y-1">
          <span className="hud-label block">Au</span>
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="rounded-lg border border-line bg-surface p-2" />
        </label>
        {Object.values(filters).some(Boolean) && (
          <button onClick={() => { setPage(1); setFilters(EMPTY_FILTERS); }} className="btn-ghost !py-2">
            Tout afficher
          </button>
        )}
      </div>
      {filters.ids && <p className="text-sm text-violet-soft">Réponses citées par un indicateur ({filters.ids.split(",").length}).</p>}
      {error && <p className="glass p-3 text-sm text-danger">{error}</p>}

      {!data ? (
        <div className="glass h-32 animate-pulse" />
      ) : data.items.length === 0 ? (
        <p className="glass p-6 text-center text-muted">Aucune partie pour ces filtres.</p>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="hud-label">
                {["Date", "Jeu · mode", "Partie", "Clip (rang réel)", "Proposé", "Résultat", "Score", "XP", "Réponse / visionnage", "Réponse n°", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.items.map((g) => <GameRow key={g.id} g={g} />)}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            {data.total} réponse{data.total > 1 ? "s" : ""} · page {data.page} sur {pages}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédentes</button>
            <button className="btn-ghost !py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivantes</button>
          </div>
        </div>
      )}
    </section>
  );
}

function contextLabel(g: PlayerHistoryItemDto) {
  const c = g.context;
  if (c.kind === "daily") return `Défi n° ${c.slot} du ${shortDate(c.date)}`;
  if (c.kind === "infinite") return `Partie ${c.runId.slice(0, 8)} · ${c.runScore} pts${c.ended ? "" : " (en cours)"}`;
  if (c.kind === "versus") {
    const outcome = c.outcome === "WIN" ? "victoire" : c.outcome === "LOSS" ? "défaite" : c.outcome === "DRAW" ? "égalité" : "non terminé";
    return `Duel ${c.matchId.slice(0, 8)} · ${outcome}`;
  }
  return "—";
}

function GameRow({ g }: { g: PlayerHistoryItemDto }) {
  return (
    <tr className={g.counted ? "" : "opacity-60"}>
      <td className="whitespace-nowrap px-3 py-2">
        {dateTime(g.createdAt)}
        {!g.counted && <span className="block text-[11px] text-warn">ne compte plus</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{g.game.name} · {GAME_MODE_LABEL[g.mode]}</td>
      <td className="whitespace-nowrap px-3 py-2 text-muted">{contextLabel(g)}</td>
      <td className="px-3 py-2">
        <span style={{ color: g.clip.rank.color }} className="font-medium">{g.clip.rank.name}</span>
        <span className="block text-[11px] text-muted" title={g.clip.id}>
          {g.clip.inGamePseudo ?? "sans pseudo"} · {g.clip.id.slice(0, 8)}
          {g.clip.deleted ? " · supprimé" : ""}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2" style={{ color: g.guessedRank.color }}>{g.guessedRank.name}</td>
      <td className={`whitespace-nowrap px-3 py-2 ${RESULT_STYLE[g.result]}`}>
        {GUESS_RESULT_LABEL[g.result]}
        {g.distance > 0 && <span className="text-muted"> ({g.distance} rang{g.distance > 1 ? "s" : ""})</span>}
      </td>
      <td className="px-3 py-2 font-mono">{g.score}</td>
      <td className="px-3 py-2 font-mono">{g.xpGained}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs" title="Temps de réponse mesuré par le serveur / temps de visionnage déclaré par l'application">
        {seconds(g.responseMs)} / {seconds(g.watchedMs)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted">
        <button onClick={() => void navigator.clipboard?.writeText(g.id)} title={`${g.id} (cliquer pour copier)`} className="hover:text-ink">
          {g.id.slice(-12)}
        </button>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {g.flags.map((f) => (
            <span key={f} title={HISTORY_FLAG_LABEL[f]} className="cursor-help rounded border border-warn/40 bg-warn/10 px-1.5 text-[11px] text-warn">
              {HISTORY_FLAG_LABEL[f].split(" ").slice(0, 3).join(" ")}…
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (readonly [string, string])[] }) {
  return (
    <label className="space-y-1">
      <span className="hud-label block">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-line bg-surface p-2">
        <option value="">Tous</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ---------- Records et statistiques ----------

function RecordsTab({ stats }: { stats: PlayerStatsDto }) {
  const s = stats.stored;
  const { daily, infinite, versus } = stats.sessions;
  const cards: [string, string, string?][] = [
    ["Réponses", String(stats.allTime.guesses), stats.user.statsResetAt ? `${stats.counted.guesses} depuis la remise à zéro` : undefined],
    ["Rangs exacts", `${stats.allTime.exact} · ${pct(stats.allTime.accuracy)}`],
    ["Score total", String(stats.allTime.totalScore), `moyenne ${stats.allTime.avgScore} par réponse`],
    ["Meilleur score d'une partie", String(Math.max(infinite.bestScore, versus.bestScore, daily.bestDayScore)), "Infini, duel ou journée de défis"],
    ["Record Infini", String(s.infiniteBest), `${infinite.bestClips} clips au plus dans une partie`],
    ["Série de victoires", `${s.winStreak} (record ${s.bestWinStreak})`, "rangs exacts d'affilée"],
    ["Série de jours", `${s.dailyStreak} (record ${s.bestDailyStreak})`],
    ["Niveau", `${s.level} · ${s.xp} XP`],
  ];
  return (
    <section className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="glass space-y-1 p-4">
            <p className="hud-label">{label}</p>
            <p className="font-display text-2xl font-bold">{value}</p>
            {hint && <p className="text-xs text-muted">{hint}</p>}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Parties jouées et terminées</h2>
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/60">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Défis du jour</th>
                <td className="px-4 py-3">{daily.challenges} défi(s) sur {daily.days} jour(s)</td>
                <td className="px-4 py-3 text-muted">{daily.bestDay ? `Meilleure journée : ${daily.bestDayScore} pts le ${shortDate(daily.bestDay)}` : "—"}</td>
              </tr>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Infini</th>
                <td className="px-4 py-3">{infinite.started} commencée(s) · {infinite.finished} terminée(s) · {infinite.abandoned} abandonnée(s)</td>
                <td className="px-4 py-3 text-muted">Meilleure : {infinite.bestScore} pts · moyenne {infinite.avgScore} pts</td>
              </tr>
              <tr>
                <th className="px-4 py-3 text-left font-medium">Duels</th>
                <td className="px-4 py-3">
                  {versus.played} joué(s) · {versus.finished} terminé(s) · {versus.wins} V / {versus.draws} N / {versus.losses} D
                  {versus.forfeits ? ` · ${versus.forfeits} abandon(s)` : ""}
                </td>
                <td className="px-4 py-3 text-muted">Meilleur score : {versus.bestScore} pts</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AggregateTable title="Par mode" rows={stats.byMode.map((m) => [GAME_MODE_LABEL[m.mode], m])} />
        <AggregateTable title="Par jeu" rows={stats.byGame.map((g) => [g.name, g])} />
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Évolution par semaine</h2>
        {stats.weekly.length ? <WeeklyChart weeks={stats.weekly} /> : <p className="glass p-6 text-center text-muted">Aucune partie.</p>}
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Meilleures places en fin de saison</h2>
        {stats.seasons.length ? (
          <ul className="glass divide-y divide-line/60 text-sm">
            {stats.seasons.map((x) => (
              <li key={x.season} className="flex justify-between px-4 py-2">
                <span>Saison {x.season}</span>
                <span className="font-mono">#{x.position} · {x.score} pts</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Aucune saison clôturée avec ce joueur au classement.</p>
        )}
      </div>
    </section>
  );
}

function AggregateTable({ title, rows }: { title: string; rows: [string, GuessAggregateDto][] }) {
  return (
    <div className="space-y-2">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="glass overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="hud-label">
              {["", "Réponses", "Exacts", "Réussite", "Écart moyen", "Score moyen", "Total"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted">Aucune partie.</td></tr>}
            {rows.map(([label, a]) => (
              <tr key={label}>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium">{label}</th>
                <td className="px-3 py-2 font-mono">{a.guesses}</td>
                <td className="px-3 py-2 font-mono">{a.exact}</td>
                <td className="px-3 py-2 font-mono">{pct(a.accuracy)}</td>
                <td className="px-3 py-2 font-mono">{a.avgDistance}</td>
                <td className="px-3 py-2 font-mono">{a.avgScore}</td>
                <td className="px-3 py-2 font-mono">{a.totalScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Réponses par semaine (barres) et score moyen (ligne, échelle 0–100 à droite) */
function WeeklyChart({ weeks }: { weeks: PlayerStatsDto["weekly"] }) {
  const W = 720, H = 200, padL = 36, padR = 40, padT = 12, padB = 28;
  const maxN = Math.max(1, ...weeks.map((w) => w.guesses));
  const step = (W - padL - padR) / weeks.length;
  const x = (i: number) => padL + step * i + step / 2;
  const yN = (n: number) => padT + (H - padT - padB) * (1 - n / maxN);
  const yS = (s: number) => padT + (H - padT - padB) * (1 - s / 100);
  const line = weeks.map((w, i) => `${i ? "L" : "M"}${x(i)},${yS(w.avgScore)}`).join(" ");
  const labelEvery = Math.ceil(weeks.length / 8);
  const barW = Math.min(step * 0.64, 36);
  return (
    <figure className="glass space-y-2 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Réponses et score moyen par semaine">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={padT + (H - padT - padB) * t} y2={padT + (H - padT - padB) * t} className="stroke-line" strokeWidth={1} />
            <text x={padL - 6} y={padT + (H - padT - padB) * t + 4} textAnchor="end" className="fill-muted text-[10px]">{Math.round(maxN * (1 - t))}</text>
            <text x={W - padR + 6} y={padT + (H - padT - padB) * t + 4} className="fill-muted text-[10px]">{Math.round(100 * (1 - t))}</text>
          </g>
        ))}
        {weeks.map((w, i) => (
          <g key={w.week}>
            <rect x={x(i) - barW / 2} width={barW} y={yN(w.guesses)} height={H - padB - yN(w.guesses)} rx={2} className="fill-violet/50">
              <title>{`Semaine du ${shortDate(w.week)} : ${w.guesses} réponse(s), score moyen ${w.avgScore}, ${pct(w.accuracy)} de rangs exacts`}</title>
            </rect>
            {i % labelEvery === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">{shortDate(w.week).slice(0, 5)}</text>}
          </g>
        ))}
        <path d={line} fill="none" className="stroke-neon" strokeWidth={2} />
        {weeks.map((w, i) => <circle key={w.week} cx={x(i)} cy={yS(w.avgScore)} r={3} className="fill-neon" />)}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm bg-violet/50" />Réponses (échelle de gauche)</span>
        <span><span className="mr-1 inline-block h-0.5 w-3 bg-neon align-middle" />Score moyen par réponse (0 à 100, à droite)</span>
        <span>Survoler une barre : détail de la semaine</span>
      </figcaption>
    </figure>
  );
}

// ---------- Journal ----------

function AuditTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PlayerAuditDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<PlayerAuditDto>(`/users/${id}/audit?page=${page}`).then(setData, (e: Error) => setError(e.message));
  }, [id, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">
        Actions de l&apos;équipe et du système sur ce compte, ses résultats et ses clips, et actions du joueur sur la sécurité de son compte. Le journal ne
        peut être ni modifié ni effacé (il est conservé un an). Les événements antérieurs à leur enregistrement n&apos;y figurent pas.
      </p>
      {error && <p className="glass p-3 text-sm text-danger">{error}</p>}
      {!data ? (
        <div className="glass h-32 animate-pulse" />
      ) : data.items.length === 0 ? (
        <p className="glass p-6 text-center text-muted">Aucune entrée.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((e: PlayerAuditEntryDto) => (
            <li key={e.id} className="glass space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="font-medium">{e.label}</span>
                  <span className="text-muted"> · {e.actor ? (e.byPlayer ? "par le joueur" : `par ${e.actor.displayName}`) : "par le système"}</span>
                </p>
                <span className="text-xs text-muted">
                  {dateTime(e.createdAt)}
                  {"ip" in e && e.ip ? ` · IP ${e.ip}` : ""}
                </span>
              </div>
              <Changes before={e.before} after={e.after} />
              {e.reason && <p><span className="text-muted">Motif : </span>{e.reason}</p>}
              {e.metadata !== null && e.metadata !== undefined && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">Détails ({e.action} · {e.entityType} {e.entityId.slice(0, 8)})</summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-2">{JSON.stringify(e.metadata, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{data.total} entrée(s) · page {data.page} sur {pages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>Plus récentes</button>
            <button className="btn-ghost !py-1" disabled={page >= pages} onClick={() => setPage(page + 1)}>Plus anciennes</button>
          </div>
        </div>
      )}
    </section>
  );
}

function show(key: string, v: unknown) {
  if (v === null || v === undefined) return "—";
  if (key === "role") return ROLE_LABEL[v as UserRole] ?? String(v);
  if (key === "status") return STATUS_LABEL[String(v)] ?? String(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  return String(v);
}

function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return null;
  return (
    <table className="text-xs">
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td className="pr-3 text-muted">{AUDIT_FIELD_LABEL[k] ?? k}</td>
            <td className="pr-2 font-mono">{show(k, b[k])}</td>
            <td className="pr-2 text-muted">→</td>
            <td className="font-mono">{show(k, a[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Indicateurs ----------

function IndicatorsTab({ data, onShow, onRefresh }: { data: PlayerIndicatorsDto | null; onShow: (ids: string[]) => void; onRefresh: () => void }) {
  if (!data) return <div className="glass h-32 animate-pulse" />;
  const sorted = [...data.indicators].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Contrôles recalculés à partir des données enregistrées, le {dateTime(data.generatedAt)}. Un indicateur allumé est une piste à vérifier, pas une
          preuve : aucune sanction n&apos;est appliquée automatiquement.
        </p>
        <button onClick={onRefresh} className="btn-ghost !py-1">Recalculer</button>
      </div>
      <ul className="space-y-3">
        {sorted.map((i) => <IndicatorCard key={i.code} i={i} onShow={onShow} />)}
      </ul>
    </section>
  );
}

function IndicatorCard({ i, onShow }: { i: PlayerIndicatorDto; onShow: (ids: string[]) => void }) {
  return (
    <li className={`glass space-y-2 border p-4 ${i.status === "ok" ? "" : STATUS_STYLE[i.status].split(" ").find((c) => c.startsWith("border-"))}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{i.title}</h3>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[i.status]}`}>{INDICATOR_STATUS_LABEL[i.status]}</span>
      </div>
      <p className="text-sm">{i.finding}</p>
      {i.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {i.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
      <p className="text-xs text-muted">Vérification : {i.rule}</p>
      {i.guessIds.length > 0 && (
        <button onClick={() => onShow(i.guessIds)} className="btn-ghost !py-1 text-xs">
          Voir les réponses concernées ({i.guessIds.length})
        </button>
      )}
    </li>
  );
}
