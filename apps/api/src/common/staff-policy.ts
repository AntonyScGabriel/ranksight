import { ForbiddenException } from "@nestjs/common";
import type { Role } from "../generated/prisma/client.js";
import type { PrismaService } from "../prisma/prisma.service.js";

const OWNER_PROTECTED = {
  code: "OWNER_PROTECTED",
  message: "Le compte du fondateur est protégé : seul le fondateur peut le modifier.",
};
const OWNER_ONLY_ADMINS = {
  code: "OWNER_ONLY",
  message: "Seul le fondateur peut nommer, retirer ou sanctionner un administrateur.",
};

async function ownerExists(prisma: PrismaService) {
  return (await prisma.user.count({ where: { role: "OWNER" } })) > 0;
}

/**
 * Action de l'équipe sur le compte d'un autre membre (rôle, suspension, suppression, remise à zéro, double
 * authentification, photo, récompenses, VIP retiré…) :
 * - le compte du fondateur n'est modifiable que par lui-même ;
 * - dès qu'un fondateur existe, seul lui peut agir sur un administrateur (un administrateur ne peut pas en
 *   écarter un autre). Sans fondateur, les administrateurs gardent les mêmes droits qu'avant.
 */
export async function assertCanManage(prisma: PrismaService, actorId: string, targetId: string) {
  if (actorId === targetId) return;
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: targetId }, select: { role: true } }),
  ]);
  if (!target) return;
  if (target.role === "OWNER") throw new ForbiddenException(OWNER_PROTECTED);
  if (target.role === "ADMIN" && actor?.role !== "OWNER" && (await ownerExists(prisma))) throw new ForbiddenException(OWNER_ONLY_ADMINS);
}

/** Changement de rôle : le grade de fondateur ne se donne pas depuis l'administration ; nommer un administrateur est réservé au fondateur. */
export async function assertCanSetRole(prisma: PrismaService, actorId: string, next: Role) {
  if (next === "OWNER") {
    throw new ForbiddenException({ code: "OWNER_CLI_ONLY", message: "Le grade de fondateur se transmet uniquement depuis le serveur (commande admin:promote)." });
  }
  if (next !== "ADMIN") return;
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "OWNER" && (await ownerExists(prisma))) throw new ForbiddenException(OWNER_ONLY_ADMINS);
}
