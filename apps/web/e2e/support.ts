// Outils des tests d'interface : joueurs, VIP et clips créés dans la base de test, connexion par le formulaire du site.
// Même garde-fou que les tests d'intégration de l'API : API et base locales, base dédiée (CI ou nom en « _test »).
// Chaque fichier ne supprime que ce qu'il a créé.
import { randomBytes, randomInt } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { assertSafeTarget } from "../../api/test/integration/guard.mjs";

export const API = process.env.API_URL ?? "http://localhost:4000/v1";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ranksight:ranksight@localhost:5432/ranksight";
assertSafeTarget({ apiUrl: API, databaseUrl: DATABASE_URL, env: process.env });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3, allowExitOnIdle: true });
export const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const PASSWORD = "motdepasse-test-1";
const tag = randomBytes(3).toString("hex");
const created = { users: [] as string[], clips: [] as string[] };

// Réponses de l'API lues librement par les tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Response = { status: number; body: any };
type Cookie = { name: string; value: string; path: string; sameSite: "Lax" | "Strict" | "None" };
type Api = ((path: string, body?: unknown) => Promise<Response>) & { cookies: () => Cookie[] };
export type Player = { id: string; pseudo: string; email: string; api: Api };

/** Session de l'API (cookies), avec une adresse IP propre (limitation de débit par IP) */
function apiSession(): Api {
  const jar: Record<string, string> = {};
  const attrs: Record<string, Cookie> = {};
  const ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
  const call = async (path: string, body?: unknown): Promise<Response> => {
    const res = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...rest] = c.split(";").map((x) => x.trim());
      const [k, v] = kv!.split(/=(.*)/s);
      if (!k) continue;
      jar[k] = v ?? "";
      const opt = (name: string) => rest.find((r) => r.toLowerCase().startsWith(`${name}=`))?.split("=")[1];
      const same = (opt("samesite") ?? "Lax").toLowerCase();
      attrs[k] = { name: k, value: v ?? "", path: opt("path") ?? "/", sameSite: same === "strict" ? "Strict" : same === "none" ? "None" : "Lax" };
    }
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* texte brut */ }
    return { status: res.status, body: parsed };
  };
  return Object.assign(call, { cookies: () => Object.values(attrs).filter((c) => c.value) });
}

/** Nouveau joueur, adresse email confirmée, connecté à l'API */
export async function newPlayer(prefix: string): Promise<Player> {
  const api = apiSession();
  const pseudo = `${prefix}${tag}${randomBytes(2).toString("hex")}`.slice(0, 20);
  const email = `${pseudo.toLowerCase()}@test.invalid`;
  const r = await api("/auth/signup", { pseudo, email, password: PASSWORD, passwordConfirm: PASSWORD, acceptTerms: true });
  if (r.status >= 300) throw new Error(`Inscription impossible (${r.status}) : ${JSON.stringify(r.body)}`);
  const [u] = await sql<{ id: string }>("UPDATE users SET email_verified_at = now() WHERE display_name = $1 RETURNING id", [pseudo]);
  created.users.push(u!.id);
  // Nouvelle session après la confirmation de l'adresse (jeton à jour)
  const login = await api("/auth/login", { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`Connexion impossible (${login.status}) : ${JSON.stringify(login.body)}`);
  return { id: u!.id, pseudo, email, api };
}

export async function grantVip(userId: string) {
  await sql(
    `INSERT INTO subscriptions (id, user_id, provider, external_id, plan, status, current_period_end, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, 'MANUAL', 'test-vip:' || $1::text, 'manual', 'ACTIVE', (now() at time zone 'utc') + interval '30 days', now())
     ON CONFLICT (user_id) DO UPDATE SET status = 'ACTIVE', current_period_end = (now() at time zone 'utc') + interval '30 days'`,
    [userId],
  );
}

/** Clips acceptés d'un jeu (proposés par un joueur de test, donc jamais tirés pour lui-même) */
export async function addClips(gameSlug: string, count: number) {
  const uploader = await newPlayer("up");
  const [game] = await sql<{ id: string }>("SELECT id FROM games WHERE slug = $1", [gameSlug]);
  const ranks = await sql<{ id: string }>(`SELECT id FROM ranks WHERE game_id = $1 ORDER BY "order"`, [game!.id]);
  const rankOf: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const rank = ranks[i % ranks.length]!;
    const [c] = await sql<{ id: string }>(
      `INSERT INTO clips (id, game_id, rank_id, uploader_id, source, status, storage_key, duration_sec, creator_consent, difficulty, reviewed_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ADMIN', 'APPROVED', 'clips/test-' || gen_random_uuid() || '.mp4', 20, true, 2, now(), now(), now()) RETURNING id`,
      [game!.id, rank.id, uploader.id],
    );
    created.clips.push(c!.id);
    rankOf[c!.id] = rank.id;
  }
  return { rankOf, ranks };
}

/** Supprime uniquement les joueurs, salons et clips créés par ce fichier */
export async function cleanup() {
  const { users, clips } = created;
  try {
    await sql("DELETE FROM rooms WHERE created_by_id = ANY($1::uuid[]) OR host_id = ANY($1::uuid[]) OR id IN (SELECT room_id FROM room_players WHERE user_id = ANY($1::uuid[]))", [users]);
    await sql("DELETE FROM guesses WHERE clip_id = ANY($1::uuid[])", [clips]);
    await sql("DELETE FROM clips WHERE id = ANY($1::uuid[])", [clips]);
    await sql("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  } catch {
    await sql("UPDATE clips SET deleted_at = now() WHERE id = ANY($1::uuid[])", [clips]).catch(() => undefined);
  } finally {
    // Les fichiers de tests partagent ce module (un seul processus) : la liste est vidée, la connexion reste ouverte
    created.users = [];
    created.clips = [];
  }
}

/**
 * Nouvel onglet connecté. Par défaut, la session du joueur (cookies de l'API) est reprise telle quelle : la connexion
 * par le formulaire est limitée à 30 essais par adresse IP et par quart d'heure, et le navigateur passe toujours par la
 * même adresse. `viaForm` : connexion par le formulaire du site, comme un joueur.
 */
export async function signedIn(
  browser: Browser, player: Player, options: Parameters<Browser["newContext"]>[0] = {},
  prepare?: (context: BrowserContext) => Promise<void>, viaForm = false,
): Promise<Page> {
  const context = await browser.newContext(options);
  // Avant la première page : la connexion temps réel s'ouvre dès le chargement du site
  await prepare?.(context);
  const page = await context.newPage();
  if (!viaForm) {
    const host = new URL(API).hostname;
    await context.addCookies(player.api.cookies().map((c) => ({ ...c, domain: host, httpOnly: true, secure: false })));
    await page.goto("/");
    return page;
  }
  // Page hydratée (scripts chargés) avant de remplir : sinon le formulaire serait envoyé sans JavaScript
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(player.email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Joue une manche par l'API pour chaque joueur (le compte à rebours est avancé, aucune attente de 3 s) */
export async function playRound(roomId: string, players: Player[], clips: { rankOf: Record<string, string>; ranks: { id: string }[] }, exact: (p: Player) => boolean) {
  await sql("UPDATE rooms SET round_starts_at = (now() at time zone 'utc') - interval '2 seconds' WHERE id = $1::uuid", [roomId]);
  for (const p of players) {
    const c = await p.api(`/rooms/${roomId}/next`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const right = clips.rankOf[c.body.id]!;
    const rankId = exact(p) ? right : clips.ranks.find((r) => r.id !== right)!.id;
    const g = await p.api("/guesses", { playToken: c.body.playToken, rankId, watchedMs: 900 });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
  }
}

export const hostOf = async (roomId: string) => (await sql<{ host_id: string | null }>("SELECT host_id FROM rooms WHERE id = $1::uuid", [roomId]))[0]?.host_id ?? null;
