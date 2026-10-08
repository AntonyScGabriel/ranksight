/**
 * Ajoute (ou remplace) l'email et le mot de passe d'un compte existant.
 * Utile pour les comptes créés avant l'arrivée des comptes email + mot de passe.
 *   npm run account:password -- <pseudo> <email>
 * Le mot de passe est demandé dans le terminal (saisie masquée) : il n'apparaît ni à l'écran ni dans l'historique.
 */
import { config } from "dotenv";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { Email, Password } from "@ranksight/shared";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password-hash.js";

config({ path: "../../.env", quiet: true });
config({ quiet: true });

const [pseudo, emailArg] = process.argv.slice(2);
if (!pseudo || !emailArg) {
  console.error("Usage : npm run account:password -- <pseudo> <email>");
  process.exit(1);
}
const email = Email.safeParse(emailArg);
if (!email.success) {
  console.error("Adresse email invalide.");
  process.exit(1);
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void });
    write._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
      else if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n");
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
try {
  const user = await prisma.user.findUnique({ where: { username: pseudo.toLowerCase() } });
  if (!user) {
    console.error(`Aucun compte avec le pseudo « ${pseudo} ».`);
    process.exitCode = 1;
  } else {
    const owner = await prisma.user.findUnique({ where: { email: email.data }, select: { id: true } });
    if (owner && owner.id !== user.id) {
      console.error("Cette adresse email est déjà utilisée par un autre compte.");
      process.exitCode = 1;
    } else {
      const password = await ask("Nouveau mot de passe : ");
      const parsed = Password.safeParse(password);
      if (!parsed.success) {
        console.error(parsed.error.issues[0]?.message ?? "Mot de passe invalide.");
        process.exitCode = 1;
      } else if ((await ask("Confirmation : ")) !== password) {
        console.error("Les mots de passe ne correspondent pas.");
        process.exitCode = 1;
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: { email: email.data, emailVerifiedAt: user.email === email.data ? user.emailVerifiedAt : null, passwordHash: await hashPassword(password) },
        });
        await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        console.log(`Compte ${user.displayName} : connexion possible avec ${email.data} et ce mot de passe.`);
      }
    }
  }
} finally {
  await prisma.$disconnect();
}
