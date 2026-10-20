// Objets SQL absents de schema.prisma (créés par les migrations SQL) : contraintes CHECK et d'exclusion, index partiels,
// déclencheurs, fonctions et schéma d'archive. Prisma ne les connaît pas : une migration générée automatiquement par
// Prisma sur une base existante peut proposer de supprimer l'index partiel `rooms_system_slot_lobby_key` (un index que
// le schéma ne déclare pas), et aucune migration générée ne recrée ces objets. Ce test vérifie, après les migrations,
// que chacun est présent ET qu'aucun nouvel objet de ce type n'a été ajouté sans être inscrit ici (et documenté dans
// le README, « Migrations sûres »).
/* global process, URL */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import pg from "pg";
import { cleanup, sql } from "./lib.mjs";

after(cleanup);

/** Liste de référence (partagée avec deploy/restore.sh) : à mettre à jour avec la migration qui ajoute ou retire l'objet */
export const SQL_ONLY_OBJECTS = readFileSync(new URL("../../prisma/sql-only-objects.txt", import.meta.url), "utf8")
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

const CATALOG = readFileSync(new URL("../../prisma/sql-only-objects.sql", import.meta.url), "utf8");

test("objets SQL hors schéma Prisma : tous présents, aucun inconnu", async () => {
  const actual = (await sql(CATALOG)).map((r) => r.k).sort();
  const missing = SQL_ONLY_OBJECTS.filter((k) => !actual.includes(k));
  const unknown = actual.filter((k) => !SQL_ONLY_OBJECTS.includes(k));
  assert.deepEqual(missing, [], `objets supprimés par une migration : ${missing.join(", ")}`);
  assert.deepEqual(unknown, [], `nouveaux objets SQL à inscrire dans apps/api/prisma/sql-only-objects.txt : ${unknown.join(", ")}`);
});

test("index partiel des salons par défaut : définition exacte", async () => {
  const [row] = await sql("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rooms_system_slot_lobby_key'");
  assert.ok(row, "index présent");
  assert.match(row.indexdef, /^CREATE UNIQUE INDEX rooms_system_slot_lobby_key ON public\.rooms USING btree \(system_slot\) WHERE/);
  assert.match(row.indexdef, /status = 'LOBBY'/);
  assert.match(row.indexdef, /system_slot IS NOT NULL/);
});

test("contraintes actives : la base refuse les valeurs interdites (transaction annulée, rien n'est écrit)", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://ranksight:ranksight@localhost:5432/ranksight" });
  await client.connect();
  try {
    await client.query("BEGIN");
    const refuse = async (label, query, code) => {
      await client.query("SAVEPOINT s");
      await assert.rejects(client.query(query), (e) => e.code === code, label);
      await client.query("ROLLBACK TO SAVEPOINT s");
    };
    await refuse("rooms_rounds_check", `INSERT INTO rooms (id, code, game_id, rounds, round_sec, expires_at, visibility)
      VALUES (gen_random_uuid(), 'ZZCHECK1', gen_random_uuid(), 0, 30, now(), 'PUBLIC')`, "23514");
    await refuse("competitive_ratings_rating_check (plancher 100)", `INSERT INTO competitive_ratings (user_id, scope, rating, peak, updated_at)
      VALUES (gen_random_uuid(), 'global', 99, 99, now())`, "23514");
    await refuse("competitive_ratings_career_check", `INSERT INTO competitive_ratings (user_id, scope, games, wins, career_games, updated_at)
      VALUES (gen_random_uuid(), 'global', 1, 1, 0, now())`, "23514");
    // Deux saisons de l'an 1900 qui se chevauchent (la première est annulée avec la transaction)
    const season = (key, from, to) => `INSERT INTO seasons (id, key, name, starts_at, ends_at, rewards, updated_at)
      VALUES (gen_random_uuid(), '${key}', 'Test', '${from}', '${to}', '[]', now())`;
    await client.query(season("test-1900-a", "1900-01-01", "1900-03-01"));
    await refuse("seasons_no_overlap", season("test-1900-b", "1900-02-01", "1900-04-01"), "23P01");
    await refuse("seasons_valid_dates", season("test-1900-c", "1900-06-01", "1900-05-01"), "23514");
    // Journal d'audit en ajout seul : une entrée récente ne se modifie ni ne se supprime
    await client.query(`INSERT INTO audit_logs (id, action, entity_type, entity_id) VALUES ('00000000-0000-4000-8000-00000000a0d1', 'test.schema', 'test', 'x')`);
    await refuse("audit_logs_append_only (modification)", "UPDATE audit_logs SET action = 'x' WHERE id = '00000000-0000-4000-8000-00000000a0d1'", "42501");
    await refuse("audit_logs_append_only (suppression)", "DELETE FROM audit_logs WHERE id = '00000000-0000-4000-8000-00000000a0d1'", "42501");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
