"use client";

import { useCallback, useEffect, useState } from "react";
import { GAME_NAMES, GAME_SLUGS, PLATFORM_LABEL, REGION_LABEL, type Platform, type Region } from "@ranksight/shared";
import { adminFetch, media } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Status = "PENDING_REVIEW" | "TRIAGED" | "APPROVED" | "REJECTED" | "TODAY" | "SCHEDULED" | "AVAILABLE";
type ClipRow = {
  id: string; createdAt: string; difficulty: number; source: "ADMIN" | "COMMUNITY"; status: string; timesPlayed: number;
  game: { slug: string; name: string }; rank: { name: string }; uploader: { displayName: string; username: string };
  inGamePseudo: string | null; platform: string | null; region: string | null;
  /** Avis d'un trieur de clips, à confirmer */
  triageDecision: "APPROVE" | "REJECT" | null; triageNote: string | null; triagedAt: string | null; triagedBy: { displayName: string } | null;
  /** Passages en défi du jour : aujourd'hui (et nombre de joueurs ayant répondu), à venir, passés */
  daily?: { today: boolean; todayPlayers: number; upcoming: string[]; past: string[] };
};
type ClipDetail = ClipRow & {
  previewUrl: string | null; proofUrl: string | null; rankId: string; submitterNote: string | null; rejectionReason: string | null;
  game: { ranks: { id: string; name: string }[] } & ClipRow["game"];
};

const TABS: [Status, string][] = [["PENDING_REVIEW", "En attente"], ["TRIAGED", "Pré-triés"], ["APPROVED", "Acceptés"], ["REJECTED", "Refusés"]];
/** Vues liées aux défis du jour */
const DAILY_TABS: [Status, string, string][] = [
  ["TODAY", "Défi du jour", "Clips joués aujourd'hui en défi du jour (un par jeu)."],
  ["SCHEDULED", "Planifiés", "Clips prévus en défi du jour pour les prochains jours."],
  ["AVAILABLE", "Disponibles", "Clips acceptés jamais passés en défi : ce sont eux qui sont tirés au sort pour les prochains défis."],
];
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Modération des clips : accepter (avec correction du rang si besoin), refuser avec une raison, supprimer. */
export default function ClipsPage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Status>("PENDING_REVIEW");
  const [game, setGame] = useState("");
  const [items, setItems] = useState<ClipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState<ClipDetail | null>(null);
  const [rankId, setRankId] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    adminFetch<{ items: ClipRow[]; total: number }>(`/clips?status=${tab}${game ? `&game=${game}` : ""}`)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setSelected(new Set());
      })
      .catch((e: Error) => setError(e.message));
  }, [tab, game]);
  useEffect(load, [load]);

  const open = async (id: string) => {
    setError(null);
    setRejecting(false);
    setReason("");
    const d = await adminFetch<ClipDetail>(`/clips/${id}`);
    setCurrent(d);
    setRankId(d.rankId);
    setDifficulty(d.difficulty);
  };

  const done = () => {
    setCurrent(null);
    load();
  };

  const approve = async () => {
    if (!current) return;
    try {
      await adminFetch(`/clips/${current.id}/review`, { method: "POST", body: JSON.stringify({ decision: "APPROVE", rankId, difficulty }) });
      done();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reject = async () => {
    if (!current) return;
    try {
      await adminFetch(`/clips/${current.id}/review`, { method: "POST", body: JSON.stringify({ decision: "REJECT", reason }) });
      done();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Confirme d'un coup les avis des trieurs sélectionnés (accepter ou refuser avec leur motif) */
  const confirmSelected = async () => {
    const ids = [...selected];
    const rejects = items.filter((c) => selected.has(c.id) && c.triageDecision === "REJECT").length;
    const ok = await confirm({
      title: `Confirmer ${ids.length} avis ?`,
      message: `${ids.length - rejects} clip(s) acceptés et ${rejects} refusé(s) avec le motif indiqué par le trieur. Les joueurs sont prévenus.`,
      confirmLabel: "Confirmer",
    });
    if (ok === false) return;
    setError(null);
    try {
      const r = await adminFetch<{ approved: number; rejected: number; skipped: number }>("/clips/confirm-triage", { method: "POST", body: JSON.stringify({ ids }) });
      setNotice(`${r.approved} clip(s) acceptés, ${r.rejected} refusé(s).${r.skipped ? ` ${r.skipped} déjà traité(s) entre-temps.` : ""}`);
      setCurrent(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Suppression depuis la fiche ou directement depuis la liste */
  const remove = async (clip: { id: string; game: { name: string }; rank: { name: string }; daily?: ClipRow["daily"] }) => {
    const inDaily = clip.daily?.today
      ? ` C'est le défi ${clip.game.name} du jour : un autre clip le remplace immédiatement${clip.daily.todayPlayers ? ` (les ${clip.daily.todayPlayers} joueur(s) qui ont déjà répondu gardent leur résultat)` : ""}.`
      : clip.daily?.upcoming.length
        ? ` Il était planifié en défi du jour (${clip.daily.upcoming.map(fmtDay).join(", ")}) : un autre clip sera tiré au sort.`
        : "";
    const ok = await confirm({
      title: "Supprimer ce clip ?",
      message: `${clip.game.name} · ${clip.rank.name} : il disparaîtra du jeu et de « Mes clips » du joueur. Les points déjà gagnés dessus restent acquis.${inDaily}`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok === false) return;
    try {
      await adminFetch(`/clips/${clip.id}`, { method: "DELETE" });
      if (current?.id === clip.id) done();
      else void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Accepté par erreur : le clip repart en file d'attente et n'est plus proposé aux joueurs */
  const unpublish = async () => {
    if (!current) return;
    const ok = await confirm({
      title: "Annuler l'acceptation ?",
      message: "Le clip n'est plus proposé aux joueurs et repart dans « En attente », où tu peux le refuser ou le supprimer.",
      confirmLabel: "Annuler l'acceptation",
    });
    if (ok === false) return;
    try {
      await adminFetch(`/clips/${current.id}/unpublish`, { method: "POST" });
      done();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Clips</h1>
        <div className="flex flex-wrap items-center gap-2">
          {[TABS, DAILY_TABS].map((group, i) => (
            <div key={i} className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={i ? "Défis du jour" : "Modération"}>
              {group.map(([s, label]) => (
                <button key={s} role="tab" aria-selected={tab === s} onClick={() => { setTab(s); setCurrent(null); }} className={`rounded-lg px-3 py-1.5 text-sm ${tab === s ? "bg-violet text-white" : "text-muted hover:text-ink"}`}>
                  {label}{tab === s ? ` (${total})` : ""}
                </button>
              ))}
            </div>
          ))}
          <select value={game} onChange={(e) => { setGame(e.target.value); setCurrent(null); }} aria-label="Filtrer par jeu" className="input !w-auto">
            <option value="">Tous les jeux</option>
            {GAME_SLUGS.map((g) => <option key={g} value={g}>{GAME_NAMES[g]}</option>)}
          </select>
        </div>
      </div>
      {DAILY_TABS.find(([s]) => s === tab) && <p className="text-sm text-muted">{DAILY_TABS.find(([s]) => s === tab)![2]}</p>}
      {tab === "TRIAGED" && (
        <div className="glass flex flex-wrap items-center gap-3 p-4 text-sm">
          <p className="flex-1 text-muted">
            Clips déjà vus par un trieur : vérifie son avis (vidéo et preuve) puis confirme-le, ou tranche autrement depuis la fiche du clip.
          </p>
          <button
            onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((c) => c.id)))}
            disabled={!items.length}
            className="btn-ghost !py-1.5"
          >
            {selected.size === items.length && items.length ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          <button onClick={confirmSelected} disabled={!selected.size} className="btn-primary !py-2">Confirmer les avis ({selected.size})</button>
        </div>
      )}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
        <ul className="glass h-fit divide-y divide-line/60">
          {items.map((c) => (
            <li key={c.id} className={`group flex items-start hover:bg-surface-2 ${current?.id === c.id ? "bg-surface-2" : ""}`}>
              {tab === "TRIAGED" && (
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                  aria-label={`Sélectionner le clip ${c.game.name} · ${c.rank.name}`}
                  className="ml-4 mt-4 accent-violet"
                />
              )}
              <button onClick={() => open(c.id)} className="flex-1 px-4 py-3 text-left">
                <p className="font-medium">{c.game.name} · {c.rank.name}</p>
                {c.inGamePseudo && <p className="text-xs text-ink/80">Pseudo en jeu : {c.inGamePseudo}</p>}
                <p className="text-xs text-muted">
                  {c.source === "COMMUNITY" ? `Proposé par @${c.uploader.username}` : "Ajouté par l'équipe"} · {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                  {c.status === "APPROVED" && ` · joué ${c.timesPlayed} fois`}
                </p>
                <DailyBadges daily={c.daily} />
                <TriageBadge clip={c} />
              </button>
              <button
                onClick={() => remove(c)}
                aria-label={`Supprimer le clip ${c.game.name} · ${c.rank.name}`}
                title="Supprimer"
                className="m-2 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-danger/10 hover:text-danger"
              >
                Supprimer
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="p-6 text-center text-muted">Aucun clip dans cette liste.</li>}
        </ul>

        {current && (
          <div className="glass space-y-4 p-6">
            {current.previewUrl
              ? <video src={media(current.previewUrl)} controls className="aspect-video w-full rounded-xl bg-black" />
              : <p className="rounded-xl bg-surface-2 p-6 text-center text-sm text-muted">Vidéo supprimée du stockage (clip refusé depuis plus de 14 jours ou supprimé).</p>}
            <div className="grid gap-2 text-sm">
              <p>
                <span className="text-muted">Pseudo en jeu : </span>{current.inGamePseudo ?? "—"}
                {current.platform && ` · ${PLATFORM_LABEL[current.platform as Platform] ?? current.platform}`}
                {current.region && ` · ${REGION_LABEL[current.region as Region] ?? current.region}`}
              </p>
              <p><span className="text-muted">Source : </span>{current.source === "COMMUNITY" ? `${current.uploader.displayName} (@${current.uploader.username})` : "Équipe"}</p>
              {current.proofUrl && <a href={current.proofUrl} target="_blank" rel="noreferrer noopener" className="text-neon underline">Voir la preuve du rang ↗</a>}
              {current.submitterNote && <p className="rounded-lg bg-surface-2 p-3"><span className="text-muted">Note du joueur : </span>{current.submitterNote}</p>}
              {current.rejectionReason && current.status !== "APPROVED" && <p className="rounded-lg bg-danger/10 p-3"><span className="text-muted">Raison du refus : </span>{current.rejectionReason}</p>}
            </div>

            <DailyBadges daily={items.find((c) => c.id === current.id)?.daily} />
            {current.triageDecision && current.status === "PENDING_REVIEW" && (
              <div className={`rounded-lg border p-3 text-sm ${current.triageDecision === "APPROVE" ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>
                <p className="font-semibold">
                  Avis de {current.triagedBy?.displayName ?? "un trieur"} : {current.triageDecision === "APPROVE" ? "à accepter" : "à refuser"}
                </p>
                {current.triageNote && <p className="text-muted">{current.triageNote}</p>}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm"><span className="hud-label">Rang réel</span>
                  <select value={rankId} onChange={(e) => setRankId(e.target.value)} className="w-full rounded-lg border border-line bg-surface p-2">
                    {current.game.ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm"><span className="hud-label">Difficulté : {difficulty}/5</span>
                  <input type="range" min={1} max={5} value={difficulty} onChange={(e) => setDifficulty(+e.target.value)} className="w-full" />
                </label>
            </div>

            {current.status === "PENDING_REVIEW" && (
              <ul className="list-inside list-disc text-xs text-muted">
                <li>Pseudo, rang et indices de classement masqués ?</li>
                <li>Durée 15 à 30 s, image lisible, aucun contenu choquant ?</li>
                <li>Rang cohérent avec la preuve fournie ?</li>
              </ul>
            )}

            {rejecting ? (
              <div className="space-y-2">
                <label className="hud-label" htmlFor="reason">Raison du refus (visible par le joueur)</label>
                <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className="w-full rounded-lg border border-line bg-surface p-2 text-sm" placeholder="Ex. : le rang est visible en haut de l'écran." />
                <div className="flex gap-3">
                  <button onClick={reject} disabled={reason.trim().length < 3} className="btn-primary flex-1">Confirmer le refus</button>
                  <button onClick={() => setRejecting(false)} className="btn-ghost">Annuler</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button onClick={approve} className="btn-primary flex-1">{current.status === "APPROVED" ? "Enregistrer" : "Accepter"}</button>
                {current.status !== "REJECTED" && (
                  <button
                    onClick={() => {
                      // Motif du trieur proposé par défaut (modifiable)
                      if (current.triageDecision === "REJECT" && current.triageNote && !reason) setReason(current.triageNote);
                      setRejecting(true);
                    }}
                    className="btn-ghost"
                  >
                    Refuser
                  </button>
                )}
                {current.status === "APPROVED" && <button onClick={unpublish} className="btn-ghost">Annuler l&apos;acceptation</button>}
                <button onClick={() => remove({ ...current, daily: items.find((c) => c.id === current.id)?.daily })} className="btn-ghost hover:!border-danger hover:!text-danger">Supprimer</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Avis du trieur sur un clip en attente */
function TriageBadge({ clip }: { clip: ClipRow }) {
  if (!clip.triageDecision || clip.status !== "PENDING_REVIEW") return null;
  const approve = clip.triageDecision === "APPROVE";
  return (
    <p className={`mt-1 text-[11px] ${approve ? "text-success" : "text-danger"}`}>
      <span className={`rounded-full px-2 py-0.5 font-semibold ${approve ? "bg-success/15" : "bg-danger/15"}`}>
        {approve ? "Pré-validé" : "Pré-refusé"}{clip.triagedBy ? ` par ${clip.triagedBy.displayName}` : ""}
      </span>
      {clip.triageNote && <span className="ml-1 text-muted">{clip.triageNote}</span>}
    </p>
  );
}

/** Passages du clip en défi du jour */
function DailyBadges({ daily }: { daily?: ClipRow["daily"] }) {
  if (!daily || (!daily.today && !daily.upcoming.length && !daily.past.length)) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
      {daily.today && (
        <span className="rounded-full bg-neon/15 px-2 py-0.5 font-semibold text-neon">
          Défi du jour · {daily.todayPlayers} réponse{daily.todayPlayers > 1 ? "s" : ""}
        </span>
      )}
      {daily.upcoming.map((d) => <span key={d} className="rounded-full bg-violet/20 px-2 py-0.5 text-violet-soft">Prévu le {fmtDay(d)}</span>)}
      {daily.past.length > 0 && <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted">Déjà en défi le {fmtDay(daily.past[0])}</span>}
    </p>
  );
}
