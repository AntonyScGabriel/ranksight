"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAME_NAMES, GAME_SLUGS, PLATFORM_LABEL, REGION_LABEL, ROLE_LABEL, TRIAGE_REJECT_REASONS, isStaffRole,
  type Platform, type Region, type ReviewerStatsDto, type TriageClipDto, type TriageStatsDto,
} from "@ranksight/shared";
import { adminFetch, media, session, type Me } from "@/lib/api";
import { RankEmblem } from "@/components/RankEmblem";

type Last = { id: string; label: string };

/**
 * Tri des clips proposés par les joueurs : le trieur donne un avis (valider ou refuser avec un motif),
 * qu'un modérateur ou un administrateur confirme ensuite en un clic dans « Clips » → « Pré-triés ».
 * Raccourcis : V valider, R refuser, P passer, 1 à 7 motifs de refus, Entrée confirmer.
 */
export default function TriagePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [game, setGame] = useState("");
  const [queue, setQueue] = useState<TriageClipDto[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<TriageStatsDto | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    adminFetch<TriageClipDto[]>(`/triage/queue${game ? `?game=${game}` : ""}`).then(setQueue, (e: Error) => setError(e.message));
    adminFetch<TriageStatsDto>("/triage/stats").then(setStats, () => undefined);
  }, [game]);
  useEffect(load, [load]);
  useEffect(() => {
    session.me().then(setMe, () => setMe(null));
  }, []);

  const current = queue?.find((c) => !skipped.has(c.id)) ?? null;

  const reset = () => {
    setRejecting(false);
    setNote("");
  };

  /** Retire le clip de la file ; la suite est chargée quand les clips chargés sont épuisés */
  const removeFromQueue = useCallback((id: string) => {
    const remaining = (queue ?? []).filter((c) => c.id !== id && !skipped.has(c.id));
    setQueue((q) => q?.filter((c) => c.id !== id) ?? q);
    if (!remaining.length) load();
  }, [queue, skipped, load]);

  const decide = useCallback(async (decision: "APPROVE" | "REJECT") => {
    if (!current || pending) return;
    if (decision === "REJECT" && note.trim().length < 3) {
      setError("Choisis ou écris le motif du refus.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await adminFetch(`/triage/${current.id}`, { method: "POST", body: JSON.stringify({ decision, note: note.trim() || undefined }) });
      setLast({ id: current.id, label: `${current.game.name} · ${current.claimedRank.name} : ${decision === "APPROVE" ? "à valider" : "à refuser"}` });
      setStats((s) => (s ? { ...s, total: s.total + 1, today: s.today + 1, awaiting: s.awaiting + 1, queue: Math.max(0, s.queue - 1) } : s));
      reset();
      removeFromQueue(current.id);
    } catch (e) {
      setError((e as Error).message);
      // Clip déjà trié par quelqu'un d'autre : on passe au suivant
      reset();
      removeFromQueue(current.id);
    } finally {
      setPending(false);
    }
  }, [current, pending, note, removeFromQueue]);

  const undo = async () => {
    if (!last) return;
    try {
      await adminFetch(`/triage/${last.id}`, { method: "DELETE" });
      setLast(null);
      setSkipped(new Set());
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const skip = useCallback(() => {
    if (!current) return;
    setSkipped((s) => new Set(s).add(current.id));
    reset();
    setError(null);
  }, [current]);

  // Raccourcis clavier (hors saisie de texte)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === "Enter" && rejecting && !e.shiftKey) {
        e.preventDefault();
        void decide("REJECT");
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "v") void decide("APPROVE");
      else if (k === "r") {
        setRejecting(true);
        setTimeout(() => noteRef.current?.focus(), 0);
      } else if (k === "p") skip();
      else if (k === "escape") setRejecting(false);
      else if (rejecting && /^[1-9]$/.test(k) && TRIAGE_REJECT_REASONS[Number(k) - 1]) setNote(TRIAGE_REJECT_REASONS[Number(k) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, skip, rejecting]);

  const rate = stats && stats.confirmed + stats.overturned ? Math.round((stats.confirmed / (stats.confirmed + stats.overturned)) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Tri des clips</h1>
          <p className="text-sm text-muted">
            Ton avis prépare le travail de la modération : chaque clip reste en attente jusqu&apos;à sa confirmation.
          </p>
        </div>
        <select value={game} onChange={(e) => { setGame(e.target.value); setSkipped(new Set()); }} aria-label="Filtrer par jeu" className="input !w-auto">
          <option value="">Tous les jeux</option>
          {GAME_SLUGS.map((g) => <option key={g} value={g}>{GAME_NAMES[g]}</option>)}
        </select>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="À trier" value={stats.queue} />
          <Kpi label="Mes tris aujourd'hui" value={stats.today} />
          <Kpi label="Avis confirmés" value={rate === null ? "—" : `${rate} %`} hint={`${stats.confirmed} confirmés · ${stats.overturned} contredits`} />
          <Kpi label="En attente de confirmation" value={stats.awaiting} />
        </div>
      )}

      {last && (
        <p role="status" className="glass flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span>Avis enregistré : {last.label}</span>
          <button onClick={undo} className="text-violet-soft hover:underline">Annuler</button>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {queue === null ? (
        <div className="glass h-64 animate-pulse" />
      ) : !current ? (
        <div className="glass space-y-2 p-10 text-center">
          <p className="font-display text-xl font-bold">Plus aucun clip à trier</p>
          <p className="text-sm text-muted">Merci pour ton aide ! Reviens plus tard : les joueurs proposent des clips tous les jours.</p>
          {skipped.size > 0 && <button onClick={() => { setSkipped(new Set()); load(); }} className="btn-ghost mx-auto">Revoir les clips passés ({skipped.size})</button>}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-3">
            {current.previewUrl ? (
              <video key={current.id} src={media(current.previewUrl)} controls autoPlay muted playsInline className="aspect-video w-full rounded-xl bg-black" />
            ) : (
              <p className="rounded-xl bg-surface-2 p-10 text-center text-sm text-muted">Vidéo indisponible.</p>
            )}
            <ul className="list-inside list-disc text-xs text-muted">
              <li>Aucun pseudo, rang ni indice de classement visible à l&apos;écran ?</li>
              <li>Image lisible, assez d&apos;action pour deviner, rien de choquant ?</li>
              <li>Rang annoncé cohérent avec la preuve ?</li>
            </ul>
          </div>

          <div className="glass h-fit space-y-4 p-5">
            <div className="flex items-center gap-3">
              <RankEmblem rank={current.claimedRank} size={52} />
              <div>
                <p className="hud-label">{current.game.name} · rang annoncé</p>
                <p className="font-display text-xl font-bold" style={{ color: current.claimedRank.color }}>{current.claimedRank.name}</p>
              </div>
            </div>
            <dl className="space-y-1 text-sm">
              <Row label="Pseudo en jeu">{current.inGamePseudo ?? "—"}</Row>
              {current.platform && <Row label="Plateforme">{PLATFORM_LABEL[current.platform as Platform] ?? current.platform}</Row>}
              {current.region && <Row label="Région">{REGION_LABEL[current.region as Region] ?? current.region}</Row>}
              <Row label="Durée">{Math.round(current.durationSec)} s</Row>
              <Row label="Proposé le">{new Date(current.createdAt).toLocaleDateString("fr-FR")}</Row>
            </dl>
            {current.proofUrl ? (
              <a href={current.proofUrl} target="_blank" rel="noreferrer noopener" className="block text-sm text-neon underline">Voir la preuve du rang ↗</a>
            ) : (
              <p className="text-sm text-warn">Aucune preuve fournie.</p>
            )}
            {current.submitterNote && <p className="rounded-lg bg-surface-2 p-3 text-sm"><span className="text-muted">Note du joueur : </span>{current.submitterNote}</p>}

            {rejecting ? (
              <div className="space-y-2">
                <p className="hud-label">Motif du refus</p>
                <div className="flex flex-wrap gap-1.5">
                  {TRIAGE_REJECT_REASONS.map((r, i) => (
                    <button key={r} type="button" onClick={() => setNote(r)} aria-pressed={note === r}
                      className={`rounded-full border px-2.5 py-1 text-xs ${note === r ? "border-danger bg-danger/15 text-ink" : "border-line text-muted hover:text-ink"}`}>
                      <span className="mr-1 font-mono opacity-60">{i + 1}</span>{r}
                    </button>
                  ))}
                </div>
                <textarea ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} className="input text-sm" placeholder="Ou écris le motif (vu par le joueur si la modération le confirme)" />
                <div className="flex gap-2">
                  <button onClick={() => decide("REJECT")} disabled={pending || note.trim().length < 3} className="flex-1 rounded-xl bg-danger px-4 py-2.5 font-semibold text-white disabled:opacity-40">Refuser (Entrée)</button>
                  <button onClick={() => setRejecting(false)} className="btn-ghost">Retour</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => decide("APPROVE")} disabled={pending} className="btn-primary flex-1">Valider <Key>V</Key></button>
                  <button onClick={() => { setRejecting(true); setTimeout(() => noteRef.current?.focus(), 0); }} className="btn-ghost flex-1">Refuser <Key>R</Key></button>
                </div>
                <button onClick={skip} className="w-full text-xs text-muted hover:text-ink">Passer (je ne sais pas) <Key>P</Key></button>
              </div>
            )}
          </div>
        </div>
      )}

      {isStaffRole(me?.role) && <Reviewers />}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="glass p-4">
      <p className="hud-label">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="ml-1.5 rounded border border-white/30 px-1 font-mono text-[10px] opacity-70">{children}</kbd>
);

/** Bilan des trieurs, pour la modération : avis confirmés ou contredits */
function Reviewers() {
  const [rows, setRows] = useState<ReviewerStatsDto[] | null>(null);
  useEffect(() => {
    adminFetch<ReviewerStatsDto[]>("/triage/reviewers").then(setRows, () => setRows([]));
  }, []);
  if (!rows) return null;
  return (
    <div className="glass overflow-x-auto p-5">
      <h2 className="mb-1 font-display text-lg font-semibold">Bilan des trieurs</h2>
      <p className="mb-3 text-xs text-muted">Donne le rôle « Trieur de clips » depuis « Utilisateurs ». Un taux de confirmation élevé permet de confirmer leurs avis en lot.</p>
      {rows.length === 0 ? <p className="text-sm text-muted">Aucun tri pour l&apos;instant.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="py-1 font-normal">Trieur</th><th className="font-normal">Tris</th><th className="font-normal">Aujourd&apos;hui</th><th className="font-normal">Confirmés</th><th className="font-normal">Contredits</th><th className="font-normal">En attente</th><th className="font-normal">Dernier tri</th></tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => {
              const decided = r.confirmed + r.overturned;
              return (
                <tr key={r.userId}>
                  <td className="py-2">{r.displayName} <span className="text-xs text-muted">{ROLE_LABEL[r.role]}</span></td>
                  <td>{r.total}</td>
                  <td>{r.today}</td>
                  <td className="text-success">{r.confirmed}{decided ? ` (${Math.round((r.confirmed / decided) * 100)} %)` : ""}</td>
                  <td className={r.overturned ? "text-danger" : ""}>{r.overturned}</td>
                  <td>{r.awaiting}</td>
                  <td className="text-xs text-muted">{r.lastTriageAt ? new Date(r.lastTriageAt).toLocaleString("fr-FR") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
