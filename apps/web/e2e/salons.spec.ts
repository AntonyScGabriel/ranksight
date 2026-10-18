// Parcours Duels / Salons : joueur gratuit (salons par défaut, pas de création, pas d'expulsion), joueur VIP (création,
// lien d'invitation, expulsion dans son salon), fin de partie (résultats, salon fermé).
import { expect, test } from "@playwright/test";
import { addClips, cleanup, grantVip, newPlayer, playRound, signedIn, sql } from "./support";

const GAME = "valorant";
let clips: Awaited<ReturnType<typeof addClips>>;

test.beforeAll(async () => {
  clips = await addClips(GAME, 30);
  // Les salons gratuits par défaut sont entretenus par le serveur (toutes les 5 s) : attendre qu'ils existent sur ce jeu
  await expect.poll(async () => Number((await sql<{ n: string }>(
    "SELECT count(*) AS n FROM rooms r JOIN games g ON g.id = r.game_id WHERE r.status = 'LOBBY' AND r.system_slot LIKE 'CLASSIC:%' AND g.slug = $1", [GAME],
  ))[0]!.n), { timeout: 30_000 }).toBeGreaterThan(0);
});
test.afterAll(cleanup);

test("joueur gratuit : Duels sans salons, Salons avec explication VIP, salon gratuit rejoint, personne ne peut être retiré", async ({ browser }) => {
  const free = await newPlayer("eg");
  const other = await newPlayer("eo");
  // Connexion par le formulaire du site
  const page = await signedIn(browser, free, {}, undefined, true);

  await page.goto("/versus");
  await expect(page.getByRole("heading", { name: "Duels", level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByText("Jouer maintenant")).toHaveCount(0);

  await page.getByRole("banner").getByRole("link", { name: "Salons" }).click();
  await expect(page.getByRole("heading", { name: "Salons", level: 1 })).toBeVisible();
  await expect(page.getByText("Créer un salon, public ou privé, est réservé aux joueurs VIP")).toBeVisible();
  await expect(page.getByRole("button", { name: /Créer le salon/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Devenir VIP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jouer maintenant" })).toBeVisible();

  // Salon gratuit par défaut encore vide sur le jeu préparé : le premier arrivé en devient l'hôte, sans VIP
  const row = page.getByRole("listitem").filter({ hasText: "Salon gratuit" }).filter({ hasText: "Valorant" }).filter({ hasText: "0/" }).first();
  await row.getByRole("button", { name: "Rejoindre" }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  const roomId = page.url().split("/").pop()!;
  await expect(page.getByText("Salon gratuit par défaut")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lancer la partie" })).toBeVisible();

  // Un autre joueur arrive (affiché en direct) : aucun bouton « Retirer » dans un salon par défaut
  expect((await other.api(`/rooms/${roomId}/join`, {})).status).toBe(200);
  await expect(page.getByText(other.pseudo)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retirer/ })).toHaveCount(0);
  // Et le serveur refuse l'expulsion, même envoyée directement à l'API (client modifié)
  const kick = await free.api(`/rooms/${roomId}/kick/${other.id}`, {});
  expect(kick.status).toBe(403);
  expect(kick.body.code).toBe("SYSTEM_ROOM");
  await expect(page.getByText(other.pseudo)).toBeVisible();
});

test("VIP : crée un salon public, partage le lien, un joueur gratuit rejoint par le lien, l'hôte peut le retirer", async ({ browser }) => {
  const vip = await newPlayer("ev");
  await grantVip(vip.id);
  const free = await newPlayer("ef");
  const host = await signedIn(browser, vip, { permissions: ["clipboard-read", "clipboard-write"] });

  await host.goto("/rooms");
  const create = host.getByRole("button", { name: "Créer le salon public" });
  await expect(create).toBeVisible();
  const form = host.locator("div.glass", { has: create });
  await form.getByLabel("Jeu").selectOption(GAME);
  await create.click();
  await expect(host).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  await host.getByRole("button", { name: "Copier le lien d'invitation" }).click();
  await expect(host.getByRole("button", { name: "Lien copié ✓" })).toBeVisible();
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/rooms\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const guest = await signedIn(browser, free);
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByText(`Salon de ${vip.pseudo}`)).toBeVisible();
  await guest.getByRole("button", { name: "Rejoindre gratuitement" }).click();
  await expect(guest).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  await expect(guest.getByRole("button", { name: "Lancer la partie" })).toHaveCount(0);

  // Salon créé par un VIP : l'hôte peut retirer un joueur
  await expect(host.getByText(free.pseudo)).toBeVisible();
  await host.getByRole("button", { name: `Retirer ${free.pseudo}` }).click();
  await host.getByRole("alertdialog").getByRole("button", { name: "Retirer" }).click();
  await expect(host.getByText(free.pseudo)).toHaveCount(0);
});

test("fin de partie : classement final, salon fermé et plus rejoignable", async ({ browser }) => {
  const vip = await newPlayer("ew");
  await grantVip(vip.id);
  const free = await newPlayer("ex");
  const created = await vip.api("/rooms", { game: GAME, visibility: "PRIVATE", rounds: 3, roundSec: 20 });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const room = created.body;
  expect((await free.api("/rooms/join", { code: room.code })).status).toBe(200);

  const host = await signedIn(browser, vip);
  const guest = await signedIn(browser, free);
  await host.goto(`/rooms/${room.id}`);
  await guest.goto(`/rooms/${room.id}`);
  await host.getByRole("button", { name: "Lancer la partie" }).click();
  for (let round = 1; round <= 3; round++) {
    await expect.poll(async () => (await sql<{ current_round: number }>("SELECT current_round FROM rooms WHERE id = $1::uuid", [room.id]))[0]!.current_round).toBe(round);
    await playRound(room.id, [vip, free], clips, (p) => p.id === free.id);
  }
  // Le joueur gratuit a répondu juste à chaque manche : il gagne ; l'hôte termine deuxième
  await expect(guest.getByText("Victoire !")).toBeVisible({ timeout: 30_000 });
  await expect(host.getByText("2e place")).toBeVisible();
  for (const p of [host, guest]) await expect(p.getByText("Partie terminée : ce salon est fermé et n'est plus rejoignable.")).toBeVisible();
  await expect(guest.getByRole("link", { name: "Rejouer dans un salon" })).toBeVisible();
  // Code du salon terminé refusé
  const other = await newPlayer("ey");
  expect((await other.api("/rooms/join", { code: room.code })).status).toBeGreaterThanOrEqual(400);
});
