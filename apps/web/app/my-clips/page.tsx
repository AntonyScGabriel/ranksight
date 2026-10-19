"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PLATFORM_LABEL, REGION_LABEL, SUBMISSION_STATUS_LABEL, type MyClipDto, type Platform, type Region, type SubmissionStatus,
} from "@ranksight/shared";
import { api, media } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { ErrorPanel, LoginRequired, Panel, Skeleton } from "@/components/States";

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  PENDING: "bg-warn/15 text-warn",
  ACCEPTED: "bg-success/15 text-success",
  REJECTED: "bg-danger/15 text-danger",
};

export default function MyClipsPage() {
  const { me, loading } = useSession();
  const [clips, setClips] = useState<MyClipDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    api.myClips().then(
      (c) => {
        setClips(c);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const remove = async (clip: MyClipDto) => {
    const ok = await confirm({
      title: "Supprimer ce clip ?",
      message:
        clip.status === "ACCEPTED"
          ? `Ton clip ${clip.game.name} ne sera plus proposé aux joueurs. Les points déjà gagnés dessus restent acquis.`
          : `Ton clip ${clip.game.name} sera supprimé définitivement.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok === false) return;
    try {
      await api.withdrawClip(clip.id);
      setNotice("Clip supprimé.");
    } catch (e) {
      setNotice(errorMessage(e, "Suppression impossible, réessaie."));
    }
    load();
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/my-clips" text="Connecte-toi pour suivre les clips que tu as proposés." />;
  if (failed) return <ErrorPanel retry={load} />;
  if (!clips) return <Skeleton />;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Mes clips</h1>
          <p className="text-muted">Suis la validation des clips que tu as proposés.</p>
        </div>
        <Link href="/submit" className="btn-primary">Proposer un clip</Link>
      </header>

      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}

      {clips.length === 0 ? (
        <Panel title="Aucun clip pour l'instant" text="Propose ton premier clip : une fois accepté, toute la communauté pourra le jouer." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {clips.map((c) => (
            <li key={c.id} className="glass overflow-hidden">
              {c.previewUrl && (c.videoKind === "FILE"
                ? <video src={media(c.previewUrl)} className="aspect-video w-full bg-black" controls preload="metadata" />
                // Clip proposé par un lien : lecteur intégré, sans lecture automatique dans la liste
                : <iframe src={c.previewUrl.replace("autoplay=1", "autoplay=0")} title={`Clip ${c.game.name}`} loading="lazy" allow="encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full bg-black" />)}
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {c.game.name} · <span style={{ color: c.rank.color }}>{c.rank.name}</span>
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status]}`}>{SUBMISSION_STATUS_LABEL[c.status]}</span>
                </div>
                <p className="text-sm text-muted">
                  Pseudo en jeu : <span className="text-ink">{c.inGamePseudo ?? "—"}</span>
                  {c.platform && ` · ${PLATFORM_LABEL[c.platform as Platform] ?? c.platform}`}
                  {c.region && ` · ${REGION_LABEL[c.region as Region] ?? c.region}`}
                </p>
                <p className="text-xs text-muted">
                  Envoyé le {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                  {c.status === "ACCEPTED" && ` · joué ${c.timesPlayed} fois`}
                </p>
                {c.status === "REJECTED" && c.rejectionReason && (
                  <p className="rounded-lg bg-danger/10 p-3 text-sm"><span className="font-semibold">Raison du refus : </span>{c.rejectionReason}</p>
                )}
                <button onClick={() => remove(c)} className="text-xs text-muted hover:text-danger">Supprimer ce clip</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
