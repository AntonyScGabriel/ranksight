/**
 * Jetons de service des routes /v1/promo (outil de production des vidéos promotionnelles, par exemple Toon Pilot).
 * À lancer sur le serveur, comme admin:promote. Le jeton n'est affiché qu'une seule fois, à sa création.
 *   npm run promo:token -- create "Toon Pilot"   → crée un jeton (permission promo:read uniquement)
 *   npm run promo:token -- list                  → liste les jetons (sans leur valeur)
 *   npm run promo:token -- revoke <id>           → révoque un jeton immédiatement
 */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { newServiceToken, PROMO_SCOPE } from "../src/modules/promo/service-token.js";

config({ path: "../../.env", quiet: true });
config({ quiet: true });

const [command, arg] = process.argv.slice(2);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

try {
  if (command === "create" && arg && arg.trim().length >= 2) {
    const { token, hash, prefix } = newServiceToken();
    const created = await prisma.serviceToken.create({ data: { name: arg.trim().slice(0, 60), tokenHash: hash, prefix, scopes: [PROMO_SCOPE] } });
    await prisma.auditLog.create({ data: { action: "service_token.create", entityType: "service_token", entityId: created.id, metadata: { name: created.name, via: "cli" } } });
    console.log(`Jeton « ${created.name} » créé (${created.id}). Copie-le maintenant, il ne sera plus jamais affiché :\n${token}`);
  } else if (command === "list") {
    const tokens = await prisma.serviceToken.findMany({ orderBy: { createdAt: "desc" } });
    for (const t of tokens) {
      console.log(`${t.id}  ${t.prefix}…  ${t.name}  créé ${t.createdAt.toISOString()}  ${t.revokedAt ? `révoqué ${t.revokedAt.toISOString()}` : "actif"}`);
    }
    if (!tokens.length) console.log("Aucun jeton de service.");
  } else if (command === "revoke" && arg) {
    const t = await prisma.serviceToken.update({ where: { id: arg }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({ data: { action: "service_token.revoke", entityType: "service_token", entityId: t.id, metadata: { name: t.name, via: "cli" } } });
    console.log(`Jeton « ${t.name} » révoqué.`);
  } else {
    console.error('Usage : npm run promo:token -- create "<nom>" | list | revoke <id>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
