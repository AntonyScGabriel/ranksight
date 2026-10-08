"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AnnouncementDto } from "@ranksight/shared";
import { api } from "@/lib/api";

const STYLE: Record<AnnouncementDto["tone"], string> = {
  info: "border-violet/40 bg-violet/15 text-ink",
  event: "border-neon/40 bg-neon/10 text-ink",
  warning: "border-warn/50 bg-warn/15 text-warn",
};
const DISMISSED_KEY = "rg:announcement-closed";

/** Annonce de l'équipe (maintenance, nouvelle saison, événement), fermable : elle ne revient pas tant qu'elle ne change pas. */
export function AnnouncementBar() {
  const [a, setA] = useState<AnnouncementDto | null>(null);

  useEffect(() => {
    api.announcement().then(
      ({ announcement }) => {
        let closed: string | null = null;
        try {
          closed = localStorage.getItem(DISMISSED_KEY);
        } catch {
          // Stockage du navigateur indisponible : l'annonce reste affichée
        }
        if (announcement && announcement.id !== closed) setA(announcement);
      },
      () => undefined,
    );
  }, []);

  if (!a) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, a.id);
    } catch {
      // Sans stockage, l'annonce reviendra à la prochaine visite
    }
    setA(null);
  };
  const link = a.link && (a.link.startsWith("/")
    ? <Link href={a.link} className="ml-2 font-semibold underline">En savoir plus</Link>
    : <a href={a.link} target="_blank" rel="noreferrer noopener" className="ml-2 font-semibold underline">En savoir plus</a>);

  return (
    <div role="status" className={`border-b ${STYLE[a.tone]}`}>
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm">
        <p className="flex-1">{a.text}{link}</p>
        <button onClick={close} aria-label="Fermer l'annonce" className="shrink-0 rounded px-1 text-muted hover:text-ink">✕</button>
      </div>
    </div>
  );
}
