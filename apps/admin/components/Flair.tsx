import { BADGE_ICONS, type BadgeIcon, type CosmeticRefDto, type FlairDto } from "@ranksight/shared";

/** Icône d'un badge (traits SVG de la couleur du badge) */
export function CosmeticIcon({ icon, color, size = 14 }: { icon: string | null; color: string; size?: number }) {
  const def = icon ? BADGE_ICONS[icon as BadgeIcon] : undefined;
  if (!def) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {def.paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** Badge équipé, à côté du pseudo */
export function BadgeChip({ badge, size = 14 }: { badge: Pick<CosmeticRefDto, "name" | "color" | "icon"> & { hint?: string }; size?: number }) {
  return (
    <span
      title={badge.hint ? `${badge.name} — ${badge.hint}` : badge.name}
      aria-label={`Badge ${badge.name}`}
      className="inline-grid shrink-0 place-items-center rounded-md align-middle"
      style={{ width: size + 8, height: size + 8, background: `${badge.color}1f`, border: `1px solid ${badge.color}66` }}
    >
      <CosmeticIcon icon={badge.icon} color={badge.color} size={size} />
    </span>
  );
}

/** Titre équipé, sous ou à côté du pseudo */
export function TitleText({ title, className = "" }: { title: Pick<CosmeticRefDto, "name" | "color"> & { hint?: string }; className?: string }) {
  return (
    <span title={title.hint ? `Titre « ${title.name} » — ${title.hint}` : undefined} className={`text-[11px] font-semibold uppercase tracking-wider ${className}`} style={{ color: title.color }}>
      {title.name}
    </span>
  );
}

export function frameBackground(frame: Pick<CosmeticRefDto, "color" | "color2">) {
  return frame.color2 ? `linear-gradient(135deg, ${frame.color}, ${frame.color2})` : frame.color;
}

/** Aperçu d'un cadre : anneau à ses couleurs */
export function FrameSwatch({ frame, size = 28 }: { frame: Pick<CosmeticRefDto, "color" | "color2">; size?: number }) {
  const ring = Math.max(3, Math.round(size / 7));
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: frameBackground(frame) }}>
      <span className="rounded-full bg-surface" style={{ width: size - ring * 2, height: size - ring * 2 }} />
    </span>
  );
}

/** Badge équipé (s'il y en a un) : à placer juste après le pseudo */
export function FlairBadge({ flair, size }: { flair: FlairDto | undefined; size?: number }) {
  return flair?.badge ? <BadgeChip badge={flair.badge} size={size} /> : null;
}
