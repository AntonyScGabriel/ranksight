import type { CosmeticRefDto, FlairDto } from "@ranksight/shared";

/** Champs d'une récompense nécessaires pour l'afficher à côté d'un joueur (avec la façon de l'obtenir) */
export const cosmeticRefSelect = {
  id: true, type: true, key: true, name: true, color: true, color2: true, icon: true, isActive: true, description: true, unlockLevel: true,
  unlockAchievement: { select: { name: true, isHidden: true } },
} as const;

/** À ajouter au `select` d'un joueur pour obtenir ses récompenses équipées */
export const flairSelect = {
  title: { select: cosmeticRefSelect },
  badge: { select: cosmeticRefSelect },
  frame: { select: cosmeticRefSelect },
} as const;

type RefRow = {
  id: string; type: CosmeticRefDto["type"]; key: string; name: string; color: string; color2: string | null; icon: string | null; isActive: boolean;
  description: string | null; unlockLevel: number | null; unlockAchievement: { name: string; isHidden: boolean } | null;
};

const SEASON_KEY = /^season-(\d+)-(champion|podium|top10|contributor)$/;
const SEASON_HINT: Record<string, (n: string) => string> = {
  champion: (n) => `1re place du classement de la saison ${n}`,
  podium: (n) => `Top 3 du classement de la saison ${n}`,
  top10: (n) => `Top 10 du classement de la saison ${n}`,
  contributor: (n) => `Le plus de clips acceptés pendant la saison ${n}`,
};

/** Comment cette récompense s'obtient, en une phrase courte (affichée au survol et dans les collections) */
export function unlockHint(c: Pick<RefRow, "key" | "description" | "unlockLevel" | "unlockAchievement">): string {
  if (c.unlockLevel !== null) return `Atteindre le niveau ${c.unlockLevel}`;
  if (c.unlockAchievement) return c.unlockAchievement.isHidden ? "Succès secret" : `Succès « ${c.unlockAchievement.name} »`;
  const season = SEASON_KEY.exec(c.key);
  if (season) return SEASON_HINT[season[2]](season[1]);
  return c.description ? `Attribué par l'équipe : ${c.description}` : "Attribué par l'équipe";
}

/** Récompense affichable (une récompense désactivée par l'équipe n'est plus montrée) */
export function toCosmeticRef(c: RefRow | null | undefined): CosmeticRefDto | null {
  if (!c || !c.isActive) return null;
  return { id: c.id, type: c.type, name: c.name, color: c.color, color2: c.color2, icon: c.icon, hint: unlockHint(c) };
}

export function toFlair(u: { title: RefRow | null; badge: RefRow | null; frame: RefRow | null }): FlairDto {
  return { title: toCosmeticRef(u.title), badge: toCosmeticRef(u.badge), frame: toCosmeticRef(u.frame) };
}
