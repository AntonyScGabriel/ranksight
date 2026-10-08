"use client";

import type { RankDto } from "@ranksight/shared";
import { RankEmblem } from "./RankEmblem";

/** Échelle de rangs : grille de "chips" colorées, du plus bas au plus haut. */
export function RankPicker({
  ranks,
  value,
  onChange,
  disabled,
}: {
  ranks: RankDto[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Choisis un rang" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {ranks.map((r) => {
        const active = value === r.id;
        return (
          <button
            key={r.id}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(r.id)}
            className={`group relative overflow-hidden rounded-xl border px-3 py-3 text-left transition active:scale-[0.97] ${
              active ? "border-transparent" : "border-line bg-surface hover:border-violet/60"
            }`}
            style={active ? { background: `linear-gradient(135deg, ${r.color}33, ${r.color}11)`, boxShadow: `0 0 0 1.5px ${r.color}, 0 0 24px -8px ${r.color}` } : undefined}
          >
            <RankEmblem rank={r} size={40} className="mb-2 transition group-hover:scale-105" />
            <span className="block font-display text-sm font-semibold leading-tight">{r.name}</span>
          </button>
        );
      })}
    </div>
  );
}
