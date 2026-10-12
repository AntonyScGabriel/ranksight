// `npm run reinstall` : réinstallation propre des dépendances.
// Supprime tous les dossiers node_modules du projet (racine, apps/*, packages/*) puis relance `npm install` à partir de
// package-lock.json. Utile après avoir copié une nouvelle version du projet par-dessus l'ancienne : des copies
// d'anciennes versions peuvent rester dans node_modules et provoquer des erreurs au lancement de l'application.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [path.join(root, "node_modules")];
for (const group of ["apps", "packages"]) {
  const base = path.join(root, group);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base)) dirs.push(path.join(base, name, "node_modules"), path.join(base, name, ".expo"));
}

for (const dir of dirs.filter(existsSync)) {
  console.log(`• Suppression de ${path.relative(root, dir)}`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

console.log("• npm install…");
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) {
  console.error("✖ L'installation a échoué. Ferme les terminaux et éditeurs qui utilisent le projet (fichiers verrouillés sous Windows), puis relance npm run reinstall.");
  process.exit(result.status ?? 1);
}
console.log("✔ Dépendances réinstallées. Lance maintenant : npm run mobile");
