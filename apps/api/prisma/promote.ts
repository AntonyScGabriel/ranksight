/**
 * Donne un rôle à un compte existant (commande à lancer sur le serveur : c'est la seule façon de nommer le fondateur).
 *   npm run admin:promote -- <pseudo>                    → ADMIN
 *   npm run admin:promote -- <pseudo> OWNER              → fondateur (propriétaire unique du site)
 *   npm run admin:promote -- <pseudo> OWNER --transfer   → transmet le grade : l'ancien fondateur devient ADMIN
 *   npm run admin:promote -- <pseudo> MODERATOR          → MODERATOR
 *   npm run admin:promote -- <pseudo> REVIEWER           → trieur de clips (pré-tri des clips proposés)
 *   npm run admin:promote -- <pseudo> USER               → retire les droits
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Role } from "../src/generated/prisma/client.js";
import { pseudoKey } from "@ranksight/shared";

config({ path: "../../.env", quiet: true });
config({ quiet: true });

const args = process.argv.slice(2);
const transfer = args.includes("--transfer");
const [username, roleArg = "ADMIN"] = args.filter((a) => !a.startsWith("--"));
const role = roleArg.toUpperCase() as Role;
const ROLES: Role[] = ["USER", "REVIEWER", "MODERATOR", "ADMIN", "OWNER"];

if (!username || !ROLES.includes(role)) {
  console.error("Usage : npm run admin:promote -- <pseudo> [OWNER|ADMIN|MODERATOR|REVIEWER|USER] [--transfer]");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

try {
  const user = await prisma.user.findUnique({ where: { username: pseudoKey(username) } });
  if (!user) {
    console.error(`Aucun compte avec le pseudo « ${username} ». Crée le compte (ou connecte-toi une première fois) sur le site, puis relance la commande.`);
    process.exitCode = 1;
  } else if (user.status !== "ACTIVE") {
    console.error(`Le compte « ${user.displayName} » n'est pas actif (${user.status}).`);
    process.exitCode = 1;
  } else {
    const message = await prisma.$transaction(
      async (tx) => {
        if (role === "OWNER") {
          // Un seul fondateur : le grade se transmet explicitement
          const current = await tx.user.findFirst({ where: { role: "OWNER", id: { not: user.id } }, select: { id: true, displayName: true } });
          if (current && !transfer) {
            return `ERREUR:${current.displayName} est déjà fondateur. Ajoute --transfer pour lui transmettre le grade (il deviendra administrateur).`;
          }
          if (current) await tx.user.update({ where: { id: current.id }, data: { role: "ADMIN" } });
          await tx.user.update({ where: { id: user.id }, data: { role } });
          return current
            ? `${user.displayName} (@${user.username}) est maintenant fondateur ; ${current.displayName} devient administrateur.`
            : `${user.displayName} (@${user.username}) est maintenant fondateur du site.`;
        }
        await tx.user.update({ where: { id: user.id }, data: { role } });
        return `${user.displayName} (@${user.username}) a maintenant le rôle ${role}.`;
      },
      { isolationLevel: "Serializable" },
    );
    if (message.startsWith("ERREUR:")) {
      console.error(message.slice(7));
      process.exitCode = 1;
    } else {
      console.log(message);
    }
  }
} finally {
  await prisma.$disconnect();
}
