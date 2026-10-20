import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCountdown, nextDailyReset } from "./daily-reset.js";

test("prochain changement des défis : minuit UTC suivant, y compris en fin de mois et d'année", () => {
  assert.equal(nextDailyReset(Date.parse("2026-10-20T13:13:05Z")), Date.parse("2026-10-21T00:00:00Z"));
  assert.equal(nextDailyReset(Date.parse("2026-10-31T23:59:59Z")), Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(nextDailyReset(Date.parse("2026-12-31T22:00:00Z")), Date.parse("2027-01-01T00:00:00Z"));
  // Pile à minuit : le défi vient de changer, le suivant est dans 24 h
  assert.equal(nextDailyReset(Date.parse("2026-10-21T00:00:00Z")), Date.parse("2026-10-22T00:00:00Z"));
});

test("compte à rebours HH:MM:SS, jamais négatif", () => {
  assert.equal(formatCountdown(10 * 3600_000 + 46 * 60_000 + 55_000), "10:46:55");
  assert.equal(formatCountdown(59_000), "00:00:59");
  assert.equal(formatCountdown(500), "00:00:01");
  assert.equal(formatCountdown(-5_000), "00:00:00");
});
