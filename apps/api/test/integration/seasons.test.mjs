// Fin de saison du classement compétitif : archive, cotes au seuil du rang atteint, une seule fois.
// La saison de test (janvier 2001) ne chevauche aucune saison réelle ; elle est supprimée à la fin.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { RATING_START, seasonResetRating } from "@ranksight/shared";
import { cleanup, newUser, sql } from "./lib.mjs";
import { services } from "./nest.mjs";

let nest;
let season;
const players = {};
before(async () => {
  nest = await services();
  [season] = await sql(
    `INSERT INTO seasons (id, key, name, starts_at, ends_at, rewards_enabled, rewards, updated_at)
     VALUES (gen_random_uuid(), 'test-' || substr(md5(random()::text), 1, 8), 'Saison de test', '2001-01-01', '2001-01-31 23:59:59', false, '{}'::jsonb, now())
     RETURNING id, key`,
  );
  // Joueurs classés (≥ 5 duels) et non classés, autour des seuils
  const setups = {
    diamond: { rating: 870, games: 12 },
    master: { rating: 1450, games: 30 },
    edge: { rating: 799, games: 8 },
    exact: { rating: 800, games: 8 },
    bronze: { rating: 210, games: 6 },
    unrankedHigh: { rating: 900, games: 4 },
    unrankedLow: { rating: 420, games: 2 },
  };
  for (const [name, s] of Object.entries(setups)) {
    const u = await newUser(name.slice(0, 6));
    players[name] = { ...u, ...s };
    await sql(
      `INSERT INTO competitive_ratings (user_id, scope, rating, peak, games, wins, losses, draws, career_games, updated_at)
       VALUES ($1, 'global', $2, $2 + 15, $3, $3, 0, 0, $3 + 20, now())`,
      [u.id, s.rating, s.games],
    );
  }
});
after(async () => {
  await sql("DELETE FROM seasons WHERE id = $1", [season.id]);
  await nest.app.close();
  await cleanup();
});

const resultOf = async (u) => (await sql("SELECT * FROM competitive_season_results WHERE season_id = $1 AND user_id = $2 AND scope = 'global'", [season.id, u.id]))[0];
const ratingOf = async (u) => (await sql("SELECT * FROM competitive_ratings WHERE user_id = $1 AND scope = 'global'", [u.id]))[0];

test("clôture simultanée et répétée : une seule réinitialisation", async () => {
  const runs = await Promise.allSettled([nest.ratings.closeSeason(season.id), nest.ratings.closeSeason(season.id), nest.ratings.closeSeason(season.id)]);
  assert.ok(runs.every((r) => r.status === "fulfilled"), runs.map((r) => r.reason?.message).join(" | "));
  // L'API peut l'avoir déjà clôturée (tâche de chaque minute) : dans tous les cas, au plus une exécution a travaillé
  assert.ok(runs.filter((r) => r.value).length <= 1);
  assert.equal(await nest.ratings.closeSeason(season.id), null, "déjà réinitialisée : rien ne se passe");
  const [{ n }] = await sql("SELECT count(*)::int AS n FROM competitive_season_results WHERE season_id = $1 AND user_id = ANY($2::uuid[])", [season.id, Object.values(players).map((p) => p.id)]);
  assert.equal(n, Object.keys(players).length, "une ligne d'archive par joueur et par périmètre");
  const [s] = await sql("SELECT competitive_reset_at FROM seasons WHERE id = $1", [season.id]);
  assert.ok(s.competitive_reset_at);
});

test("archive : cote finale, rang, place, statistiques et cote de départ suivante", async () => {
  const d = await resultOf(players.diamond);
  assert.equal(d.rating, 870);
  assert.equal(d.peak, 885);
  assert.equal(d.tier, "DIAMOND");
  assert.equal(d.games, 12);
  assert.equal(d.reset_to, 800);
  assert.ok(d.placement > 0, "classé : place archivée");
  const m = await resultOf(players.master);
  assert.ok(m.placement < d.placement, "ordre du classement conservé");
  const u = await resultOf(players.unrankedHigh);
  assert.equal(u.placement, null, "non classé : pas de place");
  assert.equal(u.tier, "DIAMOND");
});

test("nouvelles cotes : seuil minimal du rang atteint, frontières, joueurs non classés", async () => {
  const expect = {
    diamond: 800, master: 1000, edge: 650, exact: 800, bronze: 100, unrankedHigh: RATING_START, unrankedLow: 350,
  };
  for (const [name, value] of Object.entries(expect)) {
    const p = players[name];
    const r = await ratingOf(p);
    assert.equal(r.rating, value, name);
    assert.equal(value, seasonResetRating(p.rating, p.games >= 5), `${name} : même règle que la règle partagée`);
    assert.equal(r.peak, value);
    assert.equal(r.games, 0, "compteurs de la nouvelle saison à zéro");
    assert.equal(r.wins + r.losses + r.draws, 0);
    assert.equal(r.career_games, p.games + 20, "duels de carrière conservés");
  }
});

test("archives consultables par les joueurs", async () => {
  const me = players.diamond;
  const list = (await me.s.get("/ratings/seasons")).body;
  assert.ok(list.past.some((s) => s.key === season.key));
  const mine = list.mine.find((m) => m.season === season.key);
  assert.equal(mine.results[0].resetTo, 800);
  const board = (await me.s.get(`/ratings/seasons/${season.key}?scope=global`)).body;
  assert.equal(board.me.tier, "DIAMOND");
  assert.ok(board.entries.some((e) => e.userId === players.master.id));
  assert.ok(!board.entries.some((e) => e.userId === players.unrankedHigh.id), "non classé absent du classement final");
  assert.equal((await me.s.get("/ratings/seasons/inconnue-0?scope=global")).status, 404);
});
