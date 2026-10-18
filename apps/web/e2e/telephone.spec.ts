// Téléphone : navigation du bas avec Duels et Salons, liste des salons gratuits, pas de défilement horizontal.
import { expect, test } from "@playwright/test";
import { addClips, cleanup, newPlayer, signedIn, sql } from "./support";

test.beforeAll(async () => {
  await addClips("valorant", 10);
  await expect.poll(async () => Number((await sql<{ n: string }>(
    "SELECT count(*) AS n FROM rooms r JOIN games g ON g.id = r.game_id WHERE r.status = 'LOBBY' AND r.system_slot IS NOT NULL AND g.slug = 'valorant'",
  ))[0]!.n), { timeout: 30_000 }).toBeGreaterThan(0);
});
test.afterAll(cleanup);

test("navigation du bas : Duels et Salons séparés, salons gratuits listés, sans défilement horizontal", async ({ browser, playwright }) => {
  const player = await newPlayer("mt");
  const page = await signedIn(browser, player, { ...playwright.devices["Pixel 7"] });
  await page.goto("/versus");
  const bottom = page.locator("nav.fixed");
  await expect(bottom.getByRole("link", { name: "Duels" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Jouer maintenant")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await bottom.getByRole("link", { name: "Salons" }).click();
  await expect(page.getByRole("heading", { name: "Salons", level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Salon gratuit" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
