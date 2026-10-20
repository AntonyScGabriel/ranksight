// Transfert d'hôte en salle d'attente, vu depuis le site : une coupure courte (moins de 30 s) ne change rien et
// n'affiche aucun message ; une absence plus longue transfère le rôle et, au retour de la connexion, l'ancien hôte voit
// « Tu n'es plus l'hôte » sans quitter le salon.
import { expect, test, type BrowserContext, type WebSocketRoute } from "@playwright/test";
import { ROOM_HOST_AWAY_SEC } from "@ranksight/shared";
import { addClips, cleanup, grantVip, hostOf, newPlayer, signedIn, type Player } from "./support";

test.beforeAll(async () => {
  await addClips("valorant", 10);
});
test.afterAll(cleanup);

async function lobby(browser: Parameters<typeof signedIn>[0], prefix: string) {
  const vip = await newPlayer(`${prefix}h`);
  await grantVip(vip.id);
  const player = await newPlayer(`${prefix}p`);
  const created = await vip.api("/rooms", { game: "valorant", visibility: "PRIVATE" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await player.api("/rooms/join", { code: created.body.code })).status).toBe(200);
  // Les deux joueurs ont le salon ouvert (connexion temps réel active) ; la connexion de l'hôte passe par un relais
  // qui permet de la couper comme une perte de réseau
  let network!: Awaited<ReturnType<typeof relay>>;
  const host = await signedIn(browser, vip, {}, async (context) => { network = await relay(context); });
  const guest = await signedIn(browser, player);
  await host.goto(`/rooms/${created.body.id}`);
  await guest.goto(`/rooms/${created.body.id}`);
  await expect(host.getByRole("button", { name: "Lancer la partie" })).toBeVisible();
  await expect(guest.getByText(vip.pseudo, { exact: true })).toBeVisible();
  return { roomId: created.body.id as string, vip, player, host, guest, network };
}

/**
 * Réseau de l'onglet : `cut()` ferme la connexion temps réel et bloque requêtes et reconnexions (comme un téléphone
 * qui perd le réseau ou une application en arrière-plan), `restore()` rétablit tout. L'émulation « hors ligne » du
 * navigateur seule ne ferme pas une connexion WebSocket déjà ouverte.
 */
async function relay(context: BrowserContext) {
  let down = false;
  const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  // Socket.IO : l'adresse est /socket.io/ (l'espace /ws/chat est choisi dans le protocole)
  await context.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (down) return ws.close({ code: 1001, reason: "réseau coupé" });
    const pair = { page: ws, server: ws.connectToServer() };
    open.add(pair);
    ws.onClose(() => open.delete(pair));
  });
  return {
    async cut() {
      down = true;
      await context.setOffline(true);
      for (const { page, server } of open) {
        await server.close().catch(() => undefined);
        await page.close({ code: 1001, reason: "réseau coupé" }).catch(() => undefined);
      }
      open.clear();
    },
    async restore() {
      down = false;
      await context.setOffline(false);
    },
  };
}

test(`coupure de moins de ${ROOM_HOST_AWAY_SEC} s : toujours hôte, aucun message`, async ({ browser }) => {
  const { roomId, vip, host, network } = await lobby(browser, "hs");
  await network.cut();
  // Durée de la coupure simulée (c'est ce qui est testé, pas une attente de synchronisation)
  await host.waitForTimeout(12_000);
  await network.restore();
  await expect(host.getByText("Connexion perdue")).toHaveCount(0, { timeout: 20_000 });
  await expect(host.getByRole("button", { name: "Lancer la partie" })).toBeVisible();
  await expect(host.getByTestId("host-lost")).toHaveCount(0);
  expect(await hostOf(roomId)).toBe(vip.id);
});

test(`absence de plus de ${ROOM_HOST_AWAY_SEC} s : rôle transféré, message au retour, toujours dans le salon`, async ({ browser }) => {
  const { roomId, player, host, guest, network } = await lobby(browser, "hl");
  await network.cut();
  await expect.poll(() => hostOf(roomId), { timeout: 70_000, intervals: [1000] }).toBe(player.id);
  await expect(guest.getByRole("button", { name: "Lancer la partie" })).toBeVisible();
  await expect(guest.getByTestId("host-lost")).toHaveCount(0);
  // Retour de la connexion : l'état est relu et le message s'affiche
  await network.restore();
  const notice = host.getByTestId("host-lost");
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toContainText("Tu n'es plus l'hôte");
  await expect(notice).toContainText((player as Player).pseudo);
  await expect(host.getByRole("button", { name: "Lancer la partie" })).toHaveCount(0);
  await expect(host.getByText("Salle d'attente").or(host.getByText("Joueurs")).first()).toBeVisible();
  await notice.getByRole("button", { name: "J'ai compris" }).click();
  await expect(notice).toHaveCount(0);
});
