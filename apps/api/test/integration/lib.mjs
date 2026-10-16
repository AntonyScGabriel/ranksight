// Outils des tests d'intégration : ils parlent à une API démarrée (API_URL) et lisent la base (DATABASE_URL).
// À lancer uniquement sur une base de test locale (nom terminé par « _test ») ou sur celle de la CI : jamais sur la
// production ni sur une base de développement. Aucun test ne vide la base : chaque fichier crée ses propres joueurs et
// clips (noms aléatoires) et ne supprime que ce qu'il a créé. Le test des saisons clôture une saison fictive de 2001,
// ce qui réinitialise toutes les cotes de la base de test : d'où l'exigence d'une base dédiée.
/* global process, setTimeout, fetch, console */
import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { assertSafeTarget } from "./guard.mjs";

export const API = process.env.API_URL ?? "http://localhost:4000/v1";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ranksight:ranksight@localhost:5432/ranksight";

assertSafeTarget({ apiUrl: API, databaseUrl: DATABASE_URL, env: process.env });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
export const sql = async (text, params = []) => (await pool.query(text, params)).rows;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const created = { users: [], clips: [] };
const tag = randomBytes(3).toString("hex");

/** Session HTTP avec ses cookies ; chaque joueur a sa propre adresse IP (limitation de débit par IP, derrière « trust proxy ») */
export function session() {
  const jar = {};
  const ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
  const call = async (path, opts = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(API + path, {
      redirect: "manual",
      ...opts,
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, cookie, ...opts.headers },
    });
    for (const s of res.headers.getSetCookie?.() ?? []) {
      const [kv] = s.split(";");
      const [k, v] = kv.split(/=(.*)/s);
      if (v === "" || /Expires=Thu, 01 Jan 1970/.test(s)) delete jar[k];
      else jar[k] = v;
    }
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  call.get = (path) => call(path);
  call.post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  call.del = (path) => call(path, { method: "DELETE" });
  return call;
}

/** Nouveau joueur (adresse email confirmée), connecté */
export async function newUser(prefix = "t") {
  const s = session();
  const pseudo = `${prefix}${tag}${randomBytes(2).toString("hex")}`.slice(0, 20);
  const r = await s.post("/auth/signup", {
    pseudo, email: `${pseudo.toLowerCase()}@test.invalid`, password: "motdepasse-test-1", passwordConfirm: "motdepasse-test-1", acceptTerms: true,
  });
  if (r.status >= 300) throw new Error(`Inscription impossible (${r.status}) : ${JSON.stringify(r.body)}`);
  const [u] = await sql("UPDATE users SET email_verified_at = now() WHERE display_name = $1 RETURNING id", [pseudo]);
  created.users.push(u.id);
  return { s, id: u.id, pseudo };
}

export async function grantVip(userId) {
  await sql(
    `INSERT INTO subscriptions (id, user_id, provider, external_id, plan, status, current_period_end, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, 'MANUAL', 'test-vip:' || $1::text, 'manual', 'ACTIVE', (now() at time zone 'utc') + interval '30 days', now())
     ON CONFLICT (user_id) DO UPDATE SET status = 'ACTIVE', current_period_end = (now() at time zone 'utc') + interval '30 days'`,
    [userId],
  );
}

/** Clips acceptés pour un jeu, proposés par un joueur de test (jamais tirés pour lui-même) */
export async function addClips(gameSlug, count) {
  const uploader = await newUser("up");
  const [game] = await sql("SELECT id FROM games WHERE slug = $1", [gameSlug]);
  const ranks = await sql(`SELECT id, "order" FROM ranks WHERE game_id = $1 ORDER BY "order"`, [game.id]);
  const rankOf = {};
  for (let i = 0; i < count; i++) {
    const r = ranks[i % ranks.length];
    const [c] = await sql(
      `INSERT INTO clips (id, game_id, rank_id, uploader_id, source, status, storage_key, duration_sec, creator_consent, difficulty, reviewed_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ADMIN', 'APPROVED', 'clips/test-' || gen_random_uuid() || '.mp4', 20, true, 2, now(), now(), now()) RETURNING id`,
      [game.id, r.id, uploader.id],
    );
    created.clips.push(c.id);
    rankOf[c.id] = r.id;
  }
  return { gameId: game.id, rankOf, ranks };
}

/** Supprime uniquement les données créées par ce fichier de tests */
export async function cleanup() {
  const users = created.users;
  const clips = created.clips;
  try {
    await sql("DELETE FROM rooms WHERE created_by_id = ANY($1::uuid[]) OR host_id = ANY($1::uuid[])", [users]);
    await sql("DELETE FROM versus_matches WHERE creator_id = ANY($1::uuid[]) OR opponent_id = ANY($1::uuid[])", [users]);
    await sql("DELETE FROM guesses WHERE clip_id = ANY($1::uuid[])", [clips]);
    await sql("DELETE FROM clips WHERE id = ANY($1::uuid[])", [clips]);
    await sql("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  } catch (e) {
    // Clip encore utilisé par un salon d'un autre joueur : retiré du jeu au lieu d'être supprimé
    await sql("UPDATE clips SET deleted_at = now() WHERE id = ANY($1::uuid[])", [clips]).catch(() => {});
    console.error(`Nettoyage partiel : ${e.message}`);
  } finally {
    await pool.end();
  }
}
