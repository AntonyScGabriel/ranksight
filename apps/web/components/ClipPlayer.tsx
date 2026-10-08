"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lecteur de clip : mesure le temps réellement regardé (envoyé à l'API pour l'anti-triche),
 * pas de téléchargement ni de menu contextuel, relecture autorisée.
 */
export function ClipPlayer({
  src,
  poster,
  onWatched,
}: {
  src: string;
  poster?: string | null;
  onWatched: (ms: number) => void;
}) {
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
