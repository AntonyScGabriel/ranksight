/**
 * Barème de score — source unique, partagée entre l'API (calcul officiel) et les clients (affichage).
 *
 * L'écart se mesure sur la position des rangs dans l'échelle du jeu (champ `order`),
 * jamais sur leur nom : la règle est la même pour tous les jeux.
 *
 *   Rang exact            → 100 points
 *   1 rang d'écart        →  20 points
 *   2 rangs d'écart       →   5 points
 *   3 rangs d'écart ou +  →   0 point
 *
 * Exemple, clip Gold (League of Legends) : Gold 100 · Silver ou Platinum 20 ·
 * Bronze ou Emerald 5 · Iron, Diamond et au-dessus 0.
 */

export const SCORE_STEPS = [100, 20, 5] as const;

/** Écart à partir duquel une réponse ne rapporte plus rien. */
export const ZERO_POINT_DISTANCE = SCORE_STEPS.length;

/** Points pour un écart donné (en nombre de rangs). */
export function scoreForDistance(distance: number): number {
  const d = Math.abs(Math.trunc(distance));
  return SCORE_STEPS[d] ?? 0;
}

/** Écart entre deux rangs, à partir de leur position dans l'échelle du jeu. */
export function rankDistance(guessOrder: number, actualOrder: number): number {
  return Math.abs(guessOrder - actualOrder);
}

/** Calcul complet d'une réponse à partir des positions des deux rangs. */
export function scoreGuess(guessOrder: number, actualOrder: number) {
  const distance = rankDistance(guessOrder, actualOrder);
  return { distance, score: scoreForDistance(distance) };
}

/** Barème lisible : [100, 20, 5], puis 0 au-delà. */
export function scoreTable(): number[] {
  return [...SCORE_STEPS];
}

/**
 * Mode Infini : multiplicateur de difficulté (1.0 → 1.5).
 * Ne s'applique qu'au score de la partie Infinie, pas au score de base.
 */
export function infiniteMultiplier(difficulty: number): number {
  const clamped = Math.min(Math.max(difficulty, 1), 5);
  return 1 + (clamped - 1) * 0.125;
}

/** XP gagnée par réponse : le score, + bonus de série quotidienne (max +50 %). */
export function xpForGuess(score: number, dailyStreak: number): number {
  const streakBonus = Math.min(dailyStreak, 10) * 0.05;
  return Math.round(score * (1 + streakBonus));
}

/** Courbe de niveau : XP cumulée nécessaire pour atteindre `level` (niveau 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(250 * Math.pow(level - 1, 1.6));
}

export function levelFromXp(xp: number): { level: number; current: number; next: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, current: xp - xpForLevel(level), next: xpForLevel(level + 1) - xpForLevel(level) };
}
