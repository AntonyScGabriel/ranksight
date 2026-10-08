import type { SeasonDto } from "@ranksight/shared";
import { env } from "../../config/env.js";

/**
 * Saisons mensuelles : une saison = un mois civil (heure UTC), du 1er à 00:00 au dernier jour à 23:59.
 * Saison 1 = SEASON_ONE (mois de lancement), saison 2 = le mois suivant, etc.
 */
export function seasonKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const toIndex = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

export function seasonNumber(key: string): number {
  return toIndex(key) - toIndex(env().SEASON_ONE) + 1;
}

export function previousSeasonKey(key: string): string {
  return fromIndex(toIndex(key) - 1);
}

export function seasonInfo(key: string, now = new Date()): SeasonDto {
  const [y, m] = key.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1) - 1);
  const month = start.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const number = seasonNumber(key);
  return {
    key,
    number,
    label: `Saison ${number} · ${month}`,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    current: key === seasonKeyOf(now),
  };
}

/** Saisons de la plus récente (en cours) à la saison 1. */
export function allSeasons(now = new Date()): SeasonDto[] {
  const first = toIndex(env().SEASON_ONE);
  const list: SeasonDto[] = [];
  for (let i = toIndex(seasonKeyOf(now)); i >= first; i--) list.push(seasonInfo(fromIndex(i), now));
  return list;
}
