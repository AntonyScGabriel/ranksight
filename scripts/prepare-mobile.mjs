// `npm run mobile` : prépare puis lance l'application mobile (Expo).
// 1. Adresse de l'ordinateur : sur un téléphone, "localhost" désigne le téléphone lui-même. On écrit donc dans
//    apps/mobile/.env l'adresse IP locale, recalculée à chaque lancement (elle change selon le Wi-Fi).
//    Pour fixer une adresse à la main, retire la première ligne du fichier généré.
// 2. Dépendances natives : vérifie qu'une seule version de Reanimated et de Worklets est installée, celle attendue
//    par Expo Go (sinon : erreur « Mismatch between JavaScript code version and Worklets Babel plugin version »).
// 3. Cache : vidé automatiquement au premier lancement après un changement de ces dépendances.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.join(root, "apps", "mobile");
const target = path.join(mobile, ".env");
const MARKER = "# Généré par npm run mobile";

// ---------- 1. Adresse de l'API ----------

function writeEnv() {
  if (existsSync(target) && !readFileSync(target, "utf8").startsWith(MARKER)) {
    console.log("• apps/mobile/.env personnalisé : conservé tel quel");
    return;
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
}

// ---------- 2. Versions des dépendances natives ----------

/** Version d'un paquet tel que le voit le fichier `from` (même résolution que Babel et Metro) */
function versionFrom(from, name) {
  try {
    const req = createRequire(path.join(from, "noop.js"));
    const file = req.resolve(`${name}/package.json`);
    return { version: JSON.parse(readFileSync(file, "utf8")).version, dir: path.dirname(file) };
  } catch {
    return null;
  }
}

function checkNativeDeps() {
  const expo = versionFrom(mobile, "expo");
  if (!expo) {
    console.error("✖ Dépendances absentes : lance d'abord « npm install » à la racine du projet.");
    process.exit(1);
  }
  const expected = JSON.parse(readFileSync(path.join(expo.dir, "bundledNativeModules.json"), "utf8"));
  const problems = [];
  const seen = new Map();
  const note = (name, from, label) => {
    const v = versionFrom(from, name);
    if (!v) return null;
    const list = seen.get(name) ?? [];
    list.push(`${v.version} (${label})`);
    seen.set(name, list);
    return v;
  };
  // Babel (plugin Worklets) résout depuis apps/mobile ; le code les résout depuis Reanimated et le contrôleur de clavier
  const reanimated = note("react-native-reanimated", mobile, "application");
  note("react-native-worklets", mobile, "plugin Babel");
  if (reanimated) note("react-native-worklets", reanimated.dir, "Reanimated");
  const keyboard = versionFrom(mobile, "react-native-keyboard-controller");
  if (keyboard) {
    const r = note("react-native-reanimated", keyboard.dir, "contrôleur de clavier");
    if (r) note("react-native-worklets", r.dir, "contrôleur de clavier");
  }
  for (const [name, list] of seen) {
    const versions = new Set(list.map((l) => l.split(" ")[0]));
    const wanted = expected[name]?.replace(/^[~^]/, "");
    if (versions.size > 1 || (wanted && !versions.has(wanted))) problems.push(`${name} : ${list.join(", ")} — attendu ${wanted ?? "une seule version"}`);
  }
  if (problems.length) {
    console.error("✖ Installation incohérente (plusieurs versions installées, souvent après une copie par-dessus l'ancien dossier) :");
    for (const p of problems) console.error(`   - ${p}`);
    console.error("  Corrige avec :  npm run reinstall   (supprime les dossiers node_modules puis réinstalle), puis relance npm run mobile.");
    process.exit(1);
  }
  return [...seen.entries()].map(([n, l]) => `${n}@${l[0].split(" ")[0]}`).concat(`expo@${expo.version}`).join(" ");
}

// ---------- 3. Lancement (cache vidé si les dépendances ont changé) ----------

writeEnv();
const fingerprint = checkNativeDeps();
const stamp = path.join(mobile, ".expo", "deps-fingerprint");
const changed = !existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint;
if (changed) {
  mkdirSync(path.dirname(stamp), { recursive: true });
  writeFileSync(stamp, fingerprint);
  console.log("• Dépendances modifiées depuis le dernier lancement : cache vidé (premier démarrage un peu plus long)");
}
const args = ["run", "dev", "-w", "@ranksight/mobile", ...(changed ? ["--", "--clear"] : [])];
const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
