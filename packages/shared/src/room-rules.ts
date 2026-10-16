/**
 * Règles de score des parties multijoueurs (salons, équipes, tournois), regroupées ici pour être
 * appliquées par le serveur, affichées par les applications et vérifiées par des tests.
 */
import { placements } from "./rooms.js";

// ---------- Mort subite ----------

/** Nombre maximal de manches de mort subite ; au-delà, la réponse la plus rapide départage */
export const SUDDEN_DEATH_MAX_ROUNDS = 3;

export type DecidedBy = "POINTS" | "SUDDEN_DEATH" | "SPEED" | "SHARED" | "FORFEIT";
export const DECIDED_BY_LABEL: Record<DecidedBy, string> = {
  POINTS: "Victoire aux points",
  SUDDEN_DEATH: "Victoire en mort subite",
  SPEED: "Victoire à la rapidité (mort subite toujours à égalité)",
  SHARED: "Victoire partagée",
  FORFEIT: "Victoire par abandon de l'équipe adverse",
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

// ---------- Duels par équipes ----------

export const TEAM_SIZES = [2, 3] as const;
export const TEAM_NAMES: Record<number, string> = { 1: "Équipe bleue", 2: "Équipe rouge" };
export const TEAM_COLORS: Record<number, string> = { 1: "#3B82F6", 2: "#F43F5E" };

export const TEAM_RULES = [
  "Deux équipes de même taille ; tout le monde voit le même clip en même temps et répond seul.",
  "Score d'une équipe : somme des points de ses joueurs (les joueurs partis gardent les points déjà marqués).",
  "L'équipe au plus haut total gagne ; en cas d'égalité, mort subite entre les deux équipes si l'option est active, sinon match nul.",
  "En mort subite : somme des points de la manche décisive, puis réponse moyenne la plus rapide.",
] as const;

/** Total de chaque équipe (1 et 2) à partir des points des joueurs */
export function teamTotals(players: { team: number | null; score: number }[]): { id: string; score: number }[] {
  return [1, 2].map((t) => ({ id: String(t), score: players.filter((p) => p.team === t).reduce((s, p) => s + p.score, 0) }));
}

/**
 * Manche décisive par équipes : points des joueurs de l'équipe qui ont répondu (null si aucun),
 * temps moyen de ceux qui ont répondu.
 */
export function teamSuddenDeathEntry(team: string, answers: { score: number; responseMs: number }[]): SuddenDeathEntry {
  if (!answers.length) return { id: team, score: null, responseMs: null };
  return {
    id: team,
    score: answers.reduce((s, a) => s + a.score, 0),
    responseMs: Math.round(answers.reduce((s, a) => s + a.responseMs, 0) / answers.length),
  };
}

/** Place de chaque équipe : vainqueur désigné, places partagées, ou selon les totaux */
export function teamPlacements(totals: { id: string; score: number }[], decision: { winnerId?: string; sharedWinners?: string[] } = {}): Map<string, number> {
  if (decision.winnerId) return new Map(totals.map((t) => [t.id, t.id === decision.winnerId ? 1 : 2]));
  if (decision.sharedWinners?.length) return new Map(totals.map((t) => [t.id, 1]));
  return placements(totals);
}

// ---------- Mode Intrus ----------

export const IMPOSTOR_MIN_PLAYERS = 4;
/** Durée du vote (secondes) */
export const IMPOSTOR_VOTE_SEC = 25;
export const IMPOSTOR_FOUND_POINTS = 100;
export const IMPOSTOR_HIDDEN_POINTS = 200;

export const IMPOSTOR_RULES = [
  `À chaque manche, un joueur tiré au sort (jamais le même tant que d'autres ne l'ont pas été) reçoit un autre clip du même jeu, d'une difficulté proche mais d'un autre rang. Il ne le sait pas.`,
  "Chacun propose un rang comme d'habitude (points habituels sur son propre clip).",
  `Puis, d'après les rangs proposés par chacun, tout le monde vote pour l'intrus (${IMPOSTOR_VOTE_SEC} secondes, pas pour soi).`,
  `Intrus démasqué (strictement plus de votes que tout autre joueur) : +${IMPOSTOR_FOUND_POINTS} à chaque joueur qui a voté pour lui.`,
  `Intrus non démasqué : +${IMPOSTOR_HIDDEN_POINTS} pour l'intrus.`,
  `${IMPOSTOR_MIN_PLAYERS} joueurs minimum.`,
] as const;

export interface ImpostorBonus { userId: string; points: number; reason: "IMPOSTOR_FOUND" | "IMPOSTOR_HIDDEN" }

/**
 * Résultat du vote d'une manche : l'intrus est démasqué s'il reçoit strictement plus de votes que chacun des autres.
 * Démasqué → +100 à chaque votant qui l'a désigné ; sinon → +200 pour l'intrus. Les votes pour soi sont ignorés.
 */
export function impostorBonuses(impostorId: string, votes: { voterId: string; targetId: string }[]): { caught: boolean; counts: Map<string, number>; bonuses: ImpostorBonus[] } {
  const valid = votes.filter((v) => v.voterId !== v.targetId);
  const counts = new Map<string, number>();
  for (const v of valid) counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  const against = counts.get(impostorId) ?? 0;
  const caught = against > 0 && [...counts.entries()].every(([id, n]) => id === impostorId || n < against);
  const bonuses: ImpostorBonus[] = caught
    ? valid.filter((v) => v.targetId === impostorId).map((v) => ({ userId: v.voterId, points: IMPOSTOR_FOUND_POINTS, reason: "IMPOSTOR_FOUND" }))
    : [{ userId: impostorId, points: IMPOSTOR_HIDDEN_POINTS, reason: "IMPOSTOR_HIDDEN" }];
  return { caught, counts, bonuses };
}

/**
 * Intrus de la manche : parmi les joueurs encore là, ceux qui l'ont été le moins souvent dans la partie,
 * puis au hasard (`random` dans [0, 1[ pour pouvoir tester).
 */
export function pickImpostor(players: string[], previous: string[], random = Math.random): string {
  const count = (id: string) => previous.filter((p) => p === id).length;
  const fewest = Math.min(...players.map(count));
  const candidates = players.filter((p) => count(p) === fewest);
  return candidates[Math.floor(random() * candidates.length)]!;
}
