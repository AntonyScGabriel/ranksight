// Types du garde-fou (guard.mjs), pour les tests d'interface en TypeScript (apps/web/e2e)
export type Target = { apiUrl: string; databaseUrl: string; env?: Record<string, string | undefined> };
export function checkTarget(target: Target): { ok: boolean; reason: string | null };
export function assertSafeTarget(target: Target): void;
