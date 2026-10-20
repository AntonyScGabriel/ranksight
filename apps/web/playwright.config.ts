import { defineConfig, devices } from "@playwright/test";

/**
 * Tests d'interface du site (parcours Duels, Salons, VIP, joueurs gratuits, fin de partie, transfert d'hôte).
 * Ils pilotent un vrai navigateur sur le site démarré (`next start`, port 3000) relié à l'API de test (port 4000) et
 * préparent leurs données dans la base de test : même garde-fou que les tests d'intégration (CI, ou base « _test »).
 * Prérequis et commandes : README, « Tests d'interface ».
 */
export default defineConfig({
  testDir: "./e2e",
  // Les parcours partagent la base et les salons par défaut du serveur : un seul navigateur à la fois
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    // Navigateur installé par `npx playwright install chromium` ; PLAYWRIGHT_CHROMIUM permet d'en indiquer un autre
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"] }, testIgnore: /telephone\.spec/ },
    { name: "telephone", use: { ...devices["Pixel 7"] }, testMatch: /telephone\.spec/ },
  ],
});
