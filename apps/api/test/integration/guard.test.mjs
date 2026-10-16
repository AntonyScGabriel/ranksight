/* global URL */
// Les tests d'intégration ne peuvent jamais viser une base de production, ni lancer de migration ou de nettoyage global.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { checkTarget } from "./guard.mjs";

const api = "http://localhost:4000/v1";

test("garde-fou : base dédiée locale acceptée, production et bases distantes refusées", () => {
  assert.equal(checkTarget({ apiUrl: api, databaseUrl: "postgresql://u:p@localhost:5432/ranksight_test", env: {} }).ok, true);
  assert.equal(checkTarget({ apiUrl: api, databaseUrl: "postgresql://u:p@127.0.0.1:5432/ranksight", env: { CI: "true" } }).ok, true, "CI : base éphémère");
  const refused = [
    [{ apiUrl: api, databaseUrl: "postgresql://u:p@localhost:5432/ranksight", env: {} }, "base de développement"],
    [{ apiUrl: api, databaseUrl: "postgresql://rankguess:x@postgres:5432/rankguess", env: { CI: "true" } }, "base du serveur (Docker)"],
    [{ apiUrl: api, databaseUrl: "postgresql://u:p@db.exemple.fr:5432/ranksight_test", env: {} }, "base distante, même nommée _test"],
    [{ apiUrl: "https://api.rankguess.fr/v1", databaseUrl: "postgresql://u:p@localhost:5432/x_test", env: {} }, "API de production"],
    [{ apiUrl: "https://api.rankguess.fr/v1?localhost", databaseUrl: "postgresql://u:p@localhost:5432/x_test", env: {} }, "« localhost » ailleurs que dans le nom d'hôte"],
    [{ apiUrl: api, databaseUrl: "postgresql://u:p@localhost:5432/x_test", env: { NODE_ENV: "production" } }, "NODE_ENV=production"],
    [{ apiUrl: api, databaseUrl: "pas une adresse", env: {} }, "adresse illisible"],
  ];
  for (const [target, label] of refused) assert.equal(checkTarget(target).ok, false, label);
});

test("aucun test ne lance de migration ni ne vide la base", () => {
  const dir = new URL(".", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs") && x !== "guard.test.mjs")) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /migrate (deploy|dev|reset)|db push|TRUNCATE|DROP (DATABASE|TABLE|SCHEMA)|FLUSHALL|FLUSHDB/i, f);
  }
});
