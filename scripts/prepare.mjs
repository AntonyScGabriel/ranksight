// Préparation avant `npm run dev` :
//   1. crée le fichier .env à partir de .env.example s'il n'existe pas,
//      ou y ajoute les variables apparues depuis dans .env.example (les valeurs existantes ne sont jamais modifiées)
//   2. vérifie que PostgreSQL et Redis répondent, sinon les démarre avec Docker
import { execSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const keysOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l.trim()))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.trim()]);

const examplePath = path.join(root, ".env.example");
if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("• Fichier .env créé à partir de .env.example");
} else {
  const present = new Set(keysOf(envPath).map(([k]) => k));
  const missing = keysOf(examplePath).filter(([k]) => !present.has(k));
  if (missing.length) {
    appendFileSync(envPath, `\n# Ajouté automatiquement depuis .env.example\n${missing.map(([, line]) => line).join("\n")}\n`);
    console.log(`• .env complété : ${missing.map(([k]) => k).join(", ")}`);
  }
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

// ffmpeg (facultatif en local) : compression des vidéos envoyées
try {
  execSync(`"${env.FFMPEG_PATH || "ffmpeg"}" -version`, { stdio: "ignore" });
} catch {
  console.log("• ffmpeg n'est pas installé : les vidéos ne seront pas compressées en local (facultatif, voir README)");
}

function reachable(url, fallbackPort) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const socket = net.connect({ host: u.hostname, port: Number(u.port || fallbackPort), timeout: 1500 });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

const dbUp = await reachable(env.DATABASE_URL, 5432);
const redisUp = await reachable(env.REDIS_URL, 6379);

if (!dbUp || !redisUp) {
  console.log("• Démarrage de PostgreSQL et Redis (Docker)…");
  try {
    execSync("docker compose up -d --wait", { cwd: root, stdio: "inherit" });
  } catch {
    console.error(
      "\n✖ Impossible de démarrer la base de données.\n" +
        "  Lance Docker Desktop, attends qu'il indique « Engine running », puis relance : npm run dev\n",
    );
    process.exit(1);
  }
}

console.log("• Base de données et Redis prêts");
