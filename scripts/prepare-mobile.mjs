// Préparation avant `npm run mobile` :
// sur un téléphone, "localhost" désigne le téléphone lui-même. On écrit donc dans apps/mobile/.env
// l'adresse IP locale de l'ordinateur, recalculée à chaque lancement (elle change selon le Wi-Fi).
// Pour fixer une adresse à la main, retire la première ligne du fichier généré.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "apps", "mobile", ".env");
const MARKER = "# Généré par npm run mobile";

if (existsSync(target) && !readFileSync(target, "utf8").startsWith(MARKER)) {
  console.log("• apps/mobile/.env personnalisé : conservé tel quel");
  process.exit(0);
}

const candidates = Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list ?? []).map((i) => ({ name, ...i })))
  .filter((i) => i.family === "IPv4" && !i.internal && !/vEthernet|docker|vbox|vmware|wsl|br-|veth/i.test(i.name));
// Réseau domestique en priorité (192.168.x.x), puis les autres plages privées
const ip =
  candidates.find((i) => i.address.startsWith("192.168."))?.address ??
  candidates.find((i) => /^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(i.address))?.address ??
  candidates[0]?.address ??
  "localhost";

writeFileSync(target, `${MARKER}\nEXPO_PUBLIC_API_URL=http://${ip}:4000/v1\nEXPO_PUBLIC_WEB_URL=http://${ip}:3000\nEXPO_PUBLIC_ADMIN_URL=http://${ip}:3001\n`);
console.log(`• L'application utilisera l'API sur http://${ip}:4000 (téléphone et ordinateur sur le même Wi-Fi)`);
