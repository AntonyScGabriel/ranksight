/* global URL */
// Garde-fou des tests d'intégration : ils ne tournent que contre une API et une base locales, et seulement sur une base
// dédiée aux tests (CI, ou base dont le nom finit par « _test »). Jamais en production : une base de production n'est
// ni locale ni nommée « _test », et NODE_ENV=production est refusé dans tous les cas.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function checkTarget({ apiUrl, databaseUrl, env = {} }) {
  let api;
  let db;
  try {
    api = new URL(apiUrl);
    db = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: "adresse de l'API ou de la base illisible" };
  }
  if (env.NODE_ENV === "production") return { ok: false, reason: "NODE_ENV=production" };
  if (!LOCAL_HOSTS.has(api.hostname)) return { ok: false, reason: `API distante (${api.hostname})` };
  if (!LOCAL_HOSTS.has(db.hostname)) return { ok: false, reason: `base distante (${db.hostname})` };
  const name = decodeURIComponent(db.pathname.replace(/^\//, ""));
  if (env.CI !== "true" && !name.endsWith("_test")) return { ok: false, reason: `base « ${name} » non dédiée aux tests (nom attendu : …_test)` };
  return { ok: true, reason: null };
}

export function assertSafeTarget(target) {
  const r = checkTarget(target);
  if (!r.ok) throw new Error(`Tests d'intégration refusés : ${r.reason}. API locale et base dédiée uniquement.`);
}
