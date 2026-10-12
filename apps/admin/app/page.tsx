"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ANNOUNCEMENT_TONE_LABEL, AnnouncementInput, type AnnouncementDto, type AnnouncementTone } from "@ranksight/shared";
import { API, adminFetch, session } from "@/lib/api";

type Overview = {
  users: number; dau: number; guesses24h: number; openReports: number; premium: number; conversionRate: number;
  clips: Record<string, number>;
  triaged: number;
  newSuggestions: number;
  games: { slug: string; guesses: number; avg_distance: number }[];
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
