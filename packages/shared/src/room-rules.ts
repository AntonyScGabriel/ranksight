/**
 * Règles de score des parties multijoueurs (salons, équipes, tournois), regroupées ici pour être
 * appliquées par le serveur, affichées par les applications et vérifiées par des tests.
 */
import { placements } from "./rooms.js";

// ---------- Mort subite ----------

/** Nombre maximal de manches de mort subite ; au-delà, la réponse la plus rapide départage */
export const SUDDEN_DEATH_MAX_ROUNDS = 3;

export type DecidedBy = "POINTS" | "SUDDEN_DEATH" | "SPEED" | "SHARED";
export const DECIDED_BY_LABEL: Record<DecidedBy, string> = {
  POINTS: "Victoire aux points",
  SUDDEN_DEATH: "Victoire en mort subite",
  SPEED: "Victoire à la rapidité (mort subite toujours à égalité)",
  SHARED: "Victoire partagée",
};

export const SUDDEN_DEATH_RULES = [
  "En cas d'égalité en tête à la fin des manches prévues, les ex aequo disputent une manche décisive sur un nouveau clip.",
  "Le meilleur score de la manche décisive l'emporte ; ses points ne s'ajoutent pas au total.",
  `Toujours à égalité : nouvelle manche décisive, ${SUDDEN_DEATH_MAX_ROUNDS} au maximum.`,
  "Après la dernière, la réponse la plus rapide (mesurée par le serveur) parmi les meilleurs scores l'emporte.",
] as const;

/** Réponse d'un concurrent (joueur ou équipe) à une manche décisive : null = pas de réponse */
export interface SuddenDeathEntry {
  id: string;
  score: number | null;
  /** Temps de réponse mesuré par le serveur (ms), null sans réponse */
  responseMs: number | null;
}

export type SuddenDeathOutcome =
  | { kind: "winner"; winnerId: string; decidedBy: "SUDDEN_DEATH" | "SPEED" }
  | { kind: "again"; finalists: string[] }
  | { kind: "shared"; finalists: string[] };

/**
 * Résultat d'une manche décisive. Sans réponse = moins bien que toute réponse.
 * Un seul meilleur score → vainqueur. Sinon, nouvelle manche entre les meilleurs tant que `round` < maximum ;
 * à la dernière, le plus rapide parmi les meilleurs ; si personne n'a répondu ou temps identiques, victoire partagée.
 */
export function suddenDeathOutcome(entries: SuddenDeathEntry[], round: number, maxRounds = SUDDEN_DEATH_MAX_ROUNDS): SuddenDeathOutcome {
  const value = (e: SuddenDeathEntry) => (e.score === null ? -1 : e.score);
  const best = Math.max(...entries.map(value));
  const top = entries.filter((e) => value(e) === best);
  if (top.length === 1) return { kind: "winner", winnerId: top[0]!.id, decidedBy: "SUDDEN_DEATH" };
  if (round < maxRounds) return { kind: "again", finalists: top.map((e) => e.id) };
  const answered = top.filter((e) => e.responseMs !== null);
  if (!answered.length) return { kind: "shared", finalists: top.map((e) => e.id) };
  const fastest = Math.min(...answered.map((e) => e.responseMs!));
  const quick = answered.filter((e) => e.responseMs === fastest);
  return quick.length === 1 ? { kind: "winner", winnerId: quick[0]!.id, decidedBy: "SPEED" } : { kind: "shared", finalists: quick.map((e) => e.id) };
}

/** Concurrents à égalité en tête (au moins 2), ou liste vide s'il y a un premier unique */
export function tiedLeaders<T extends { id: string; score: number }>(entries: T[]): string[] {
  if (entries.length < 2) return [];
  const best = Math.max(...entries.map((e) => e.score));
  const top = entries.filter((e) => e.score === best);
  return top.length > 1 ? top.map((e) => e.id) : [];
}

/**
 * Places finales d'un salon : les joueurs restés jusqu'au bout d'abord, puis ceux partis en cours de partie.
 * Si une mort subite a désigné un vainqueur, il est 1er et les autres finalistes restés sont 2es ex aequo,
 * puis les autres joueurs selon leur total. `sharedWinners` : finalistes à égalité jusqu'au bout (tous 1ers).
 */
export function finalPlacements(
  players: { id: string; score: number; left: boolean }[],
  decision: { winnerId?: string; finalists?: string[]; sharedWinners?: string[] } = {},
): Map<string, number> {
  const stayed = players.filter((p) => !p.left);
  const left = players.filter((p) => p.left);
  const out = new Map<string, number>();
  if (decision.winnerId || decision.sharedWinners?.length) {
    const winners = decision.winnerId ? [decision.winnerId] : decision.sharedWinners!;
    const runnersUp = (decision.finalists ?? []).filter((id) => !winners.includes(id) && stayed.some((p) => p.id === id));
    winners.forEach((id) => out.set(id, 1));
    runnersUp.forEach((id) => out.set(id, winners.length + 1));
    const rest = stayed.filter((p) => !out.has(p.id));
    const offset = winners.length + runnersUp.length;
    placements(rest).forEach((place, id) => out.set(id, offset + place));
  } else {
    placements(stayed).forEach((place, id) => out.set(id, place));
  }
  placements(left).forEach((place, id) => out.set(id, stayed.length + place));
  return out;
}
