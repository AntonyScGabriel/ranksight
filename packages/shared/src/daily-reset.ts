/** Les défis du jour changent chaque jour à minuit UTC (2 h du matin à Paris en été, 1 h en hiver). */

/** Instant (ms) du prochain changement des défis du jour */
export function nextDailyReset(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Compte à rebours « HH:MM:SS » (jamais négatif) */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
