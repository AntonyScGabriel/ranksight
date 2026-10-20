"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DAILY_PER_GAME, ANNOUNCEMENT_TONE_LABEL, AnnouncementInput, ROOM_DEFAULT_ROUNDS, ROOM_MODES, ROOM_MODE_LABEL, modeSettings, roomClipsNeeded, type AnnouncementDto, type AnnouncementTone, type RoomMode } from "@ranksight/shared";
import { API, adminFetch, session } from "@/lib/api";

type Overview = {
  users: number; dau: number; guesses24h: number; openReports: number; premium: number; conversionRate: number;
  clips: Record<string, number>;
  triaged: number;
  newSuggestions: number;
  games: { slug: string; name: string; guesses: number; avg_distance: number; approvedClips: number; playableModes: RoomMode[]; systemLobbies: number }[];
};

export default function Dashboard() {
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<Overview>("/stats/overview").then(setO).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <p className="text-danger">{err}</p>;
  if (!o) return <div className="glass h-40 animate-pulse" />;

  const kpis: [string, string | number, string?][] = [
    ["Joueurs actifs (24 h)", o.dau],
    ["Réponses (24 h)", o.guesses24h],
    ["Comptes", o.users],
    ["Joueurs VIP", `${o.premium} · ${(o.conversionRate * 100).toFixed(1)} %`],
    ["Clips à valider", `${o.clips.PENDING_REVIEW ?? 0}${o.triaged ? ` · ${o.triaged} pré-triés` : ""}`, "/clips"],
    ["Signalements ouverts", o.openReports, "/reports"],
    ["Suggestions en attente", o.newSuggestions, "/suggestions"],
  ];
  const max = Math.max(1, ...o.games.map((g) => g.guesses));

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold">Vue d&apos;ensemble</h1>
      <DailyAlerts games={o.games} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {kpis.map(([k, v, href]) => {
          const content = (
            <>
              <p className="hud-label">{k}</p>
              <p className="mt-1 font-display text-3xl font-bold">{v}</p>
            </>
          );
          return href ? (
            <Link key={k} href={href} className="glass p-5 transition hover:border-violet">{content}</Link>
          ) : (
            <div key={k} className="glass p-5">{content}</div>
          );
        })}
      </div>
      <AnnouncementEditor />
      <div className="glass p-6">
        <p className="hud-label mb-4">Réponses par jeu · écart moyen</p>
        <ul className="space-y-3">
          {o.games.map((g) => (
            <li key={g.slug} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-4 text-sm">
              <span>{g.slug}</span>
              <span className="h-2 rounded-full bg-white/5"><span className="block h-full rounded-full bg-violet" style={{ width: `${(g.guesses / max) * 100}%` }} /></span>
              <span className="text-right font-mono text-muted">{g.guesses} · {g.avg_distance.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ClipsByGame games={o.games} />
    </div>
  );
}

/**
 * Clips acceptés par jeu et salons gratuits par défaut : un mode n'ouvre de salon gratuit sur un jeu que s'il a assez de
 * clips pour une partie aux réglages par défaut (le mode Intrus en demande deux par manche).
 */
function ClipsByGame({ games }: { games: Overview["games"] }) {
  const needed = (m: RoomMode) => roomClipsNeeded({ rounds: ROOM_DEFAULT_ROUNDS, ...modeSettings(m) });
  return (
    <div className="glass p-6">
      <p className="hud-label mb-1">Clips acceptés par jeu · salons gratuits</p>
      <p className="mb-4 text-xs text-muted">
        Minimum par partie gratuite ({ROOM_DEFAULT_ROUNDS} manches) : {ROOM_MODES.map((m) => `${ROOM_MODE_LABEL[m]} ${needed(m)}`).join(" · ")}.
        Un jeu en dessous n&apos;est plus proposé dans les salons par défaut de ce mode.
      </p>
      <ul className="space-y-3">
        {games.map((g) => {
          const missing = ROOM_MODES.filter((m) => !g.playableModes.includes(m));
          return (
            <li key={g.slug} data-testid={`clips-${g.slug}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-[10rem] font-medium">{g.name}</span>
              <span className="font-mono">{g.approvedClips} clip{g.approvedClips > 1 ? "s" : ""} accepté{g.approvedClips > 1 ? "s" : ""}</span>
              <span className={missing.length ? (g.playableModes.length ? "text-warn" : "text-danger") : "text-success"}>
                {!missing.length
                  ? "Tous les modes jouables"
                  : g.playableModes.length
                    ? `Insuffisant pour : ${missing.map((m) => ROOM_MODE_LABEL[m]).join(", ")}`
                    : "Aucun salon gratuit possible"}
              </span>
              <span className="text-xs text-muted">{g.systemLobbies} salon{g.systemLobbies > 1 ? "s" : ""} gratuit{g.systemLobbies > 1 ? "s" : ""} en attente</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Datetime-local (heure de Paris du navigateur) ↔ ISO */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Annonce en haut du site et de l'application : maintenance, nouvelle saison, événement */
function AnnouncementEditor() {
  const [current, setCurrent] = useState<AnnouncementDto | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>("info");
  const [link, setLink] = useState("");
  const [until, setUntil] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    session.me().then((m) => setCanEdit(m.siteOwner), () => setCanEdit(false));
    fetch(`${API}/announcement`, { credentials: "include" })
      .then((r) => r.json())
      .then(({ announcement }: { announcement: AnnouncementDto | null }) => {
        setCurrent(announcement);
        if (announcement) {
          setText(announcement.text);
          setTone(announcement.tone);
          setLink(announcement.link ?? "");
          setUntil(announcement.until ? toLocalInput(announcement.until) : "");
        }
      })
      .catch(() => setCurrent(null));
  }, []);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { text, tone, link: link.trim() || null, until: until ? new Date(until).toISOString() : null };
    const parsed = AnnouncementInput.safeParse(body);
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Annonce invalide.", ok: false });
    try {
      setCurrent(await adminFetch<AnnouncementDto>("/announcement", { method: "PUT", body: JSON.stringify(parsed.data) }));
      setMessage({ text: "Annonce publiée : elle s'affiche sur le site et dans l'application.", ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  const remove = async () => {
    try {
      await adminFetch("/announcement", { method: "DELETE" });
      setCurrent(null);
      setText("");
      setLink("");
      setUntil("");
      setMessage({ text: "Annonce retirée.", ok: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    }
  };

  if (current === undefined) return null;
  // Annonces réservées au fondateur : l'équipe voit seulement celle en cours
  if (!canEdit) {
    return (
      <div className="glass space-y-2 p-6">
        <p className="hud-label">Annonce sur le site et l&apos;application</p>
        <p className="text-sm">{current ? current.text : <span className="text-muted">Aucune annonce en cours.</span>}</p>
        <p className="text-xs text-muted">Les annonces sont publiées par le fondateur du site.</p>
      </div>
    );
  }
  return (
    <form onSubmit={publish} className="glass space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hud-label">Annonce sur le site et l&apos;application</p>
        <span className={`text-xs ${current ? "text-success" : "text-muted"}`}>
          {current ? `En ligne${current.until ? ` jusqu'au ${new Date(current.until).toLocaleString("fr-FR")}` : ""}` : "Aucune annonce"}
        </span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={200} rows={2} className="input text-sm" placeholder="Ex. Maintenance ce soir de 23 h à 23 h 30. / La saison 2 commence demain !" />
      <div className="grid gap-3 md:grid-cols-3">
        <select value={tone} onChange={(e) => setTone(e.target.value as AnnouncementTone)} aria-label="Type d'annonce" className="input">
          {Object.entries(ANNOUNCEMENT_TONE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Lien facultatif (/leaderboard ou https://…)" className="input" />
        <label className="flex items-center gap-2 text-sm text-muted">
          Jusqu&apos;au
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="input" />
        </label>
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      <div className="flex gap-2">
        <button className="btn-primary !py-2">{current ? "Remplacer l'annonce" : "Publier l'annonce"}</button>
        {current && <button type="button" onClick={remove} className="btn-ghost">Retirer</button>}
      </div>
    </form>
  );
}

type DailyRow = { date: string; slot: number; game: { slug: string } };

/**
 * Défis du jour à surveiller : en rouge, un jeu sans assez de clips acceptés (ses défis ne peuvent pas tous être tirés
 * au sort) ; en orange, les défis de demain pas encore choisis à la main (un clip sera tiré au sort, rien ne casse).
 */
function DailyAlerts({ games }: { games: Overview["games"] }) {
  const [days, setDays] = useState<DailyRow[] | null>(null);
  const [tomorrow, setTomorrow] = useState("");
  useEffect(() => {
    adminFetch<DailyRow[]>("/daily").then((d) => {
      setTomorrow(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
      setDays(d);
    }, () => setDays([]));
  }, []);
  const short = games.filter((g) => g.approvedClips < DAILY_PER_GAME);
  const unplanned = days && tomorrow
    ? games
        .map((g) => ({ name: g.name, missing: DAILY_PER_GAME - days.filter((d) => d.game.slug === g.slug && d.date.slice(0, 10) === tomorrow).length }))
        .filter((g) => g.missing > 0)
    : [];
  if (!short.length && !unplanned.length) return null;
  return (
    <div className="space-y-2" data-testid="daily-alerts">
      {short.length > 0 && (
        <Link href="/clips" className="block rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger transition hover:border-danger">
          <strong>Pas assez de clips acceptés pour les défis du jour</strong> :{" "}
          {short.map((g) => `${g.name} (${g.approvedClips} sur ${DAILY_PER_GAME})`).join(", ")}. Il manquera des défis tant que des clips ne
          sont pas acceptés.
        </Link>
      )}
      {unplanned.length > 0 && (
        <Link href="/daily" className="block rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn transition hover:border-warn">
          <strong>Défis de demain pas encore choisis</strong> : {unplanned.map((g) => `${g.name} (${g.missing})`).join(", ")}. Sans choix,
          un clip accepté sera tiré au sort.
        </Link>
      )}
    </div>
  );
}
