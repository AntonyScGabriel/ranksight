"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipVideoKind } from "@ranksight/shared";

/**
 * Lecteur de clip : mesure le temps réellement regardé (envoyé à l'API pour l'anti-triche),
 * pas de téléchargement ni de menu contextuel, relecture autorisée.
 */
export function ClipPlayer({
  src,
  poster,
  onWatched,
  kind = "FILE",
  durationSec,
}: {
  src: string;
  poster?: string | null;
  onWatched: (ms: number) => void;
  /** YOUTUBE / MEDAL : src est l'adresse du lecteur intégré du clip proposé par un lien */
  kind?: ClipVideoKind;
  durationSec?: number;
}) {
  if (kind !== "FILE") return <EmbedPlayer src={src} durationSec={durationSec ?? 0} onWatched={onWatched} />;
  return <FilePlayer src={src} poster={poster} onWatched={onWatched} />;
}

/**
 * Lecteur intégré YouTube / Medal (clip proposé par un lien) : le temps regardé est celui passé sur la page, onglet
 * visible (le lecteur d'un autre site ne dit pas où en est la lecture). Des zones transparentes recouvrent le titre et
 * le logo, qui mènent sinon à la page d'origine de la vidéo (description, commentaires…).
 */
export function EmbedPlayer({ src, durationSec, onWatched }: { src: string; durationSec: number; onWatched?: (ms: number) => void }) {
  const watched = useRef(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") watched.current += now - last;
      last = now;
      setProgress(durationSec ? Math.min(1, watched.current / (durationSec * 1000)) : 0);
      onWatched?.(Math.round(watched.current));
    }, 250);
    return () => clearInterval(id);
  }, [durationSec, onWatched]);

  return (
    <div className="glass relative overflow-hidden">
      <iframe src={src} title="Clip" allow="autoplay; encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full bg-black" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-14" onContextMenu={(e) => e.preventDefault()} />
      <div aria-hidden className="absolute bottom-0 right-0 h-12 w-32" onContextMenu={(e) => e.preventDefault()} />
      <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
        <div className="h-full bg-gradient-to-r from-violet to-neon transition-[width]" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function FilePlayer({ src, poster, onWatched }: { src: string; poster?: string | null; onWatched: (ms: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const watched = useRef(0);
  const lastTick = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tick = () => {
      if (!v.paused && lastTick.current !== null) watched.current += performance.now() - lastTick.current;
      lastTick.current = v.paused ? null : performance.now();
      setProgress(v.duration ? v.currentTime / v.duration : 0);
      onWatched(Math.round(watched.current));
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [onWatched]);

  return (
    <div className="glass relative overflow-hidden">
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        className="aspect-video w-full bg-black"
        playsInline
        autoPlay
        muted
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onEnded={() => setEnded(true)}
        onPlay={() => setEnded(false)}
      />
      <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
        <div className="h-full bg-gradient-to-r from-violet to-neon transition-[width]" style={{ width: `${progress * 100}%` }} />
      </div>
      {ended && (
        <button
          onClick={() => ref.current?.play()}
          className="absolute right-3 top-3 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-ink backdrop-blur"
        >
          ↻ Revoir
        </button>
      )}
    </div>
  );
}
