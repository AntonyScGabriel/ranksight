import type { VipStatusDto } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaService } from "../../prisma/prisma.service.js";

const DAY_MS = 86_400_000;

/** Champs de l'abonnement nécessaires pour savoir si un joueur est VIP. */
export const vipSelect = { subscription: { select: { status: true, currentPeriodEnd: true } } } as const;

type Sub = { status: string; currentPeriodEnd: Date } | null | undefined;

/** VIP actif : abonnement actif (acheté ou offert) dont la date de fin n'est pas dépassée. */
export function isVip(sub: Sub, now = new Date()): boolean {
  return !!sub && ["ACTIVE", "TRIALING"].includes(sub.status) && sub.currentPeriodEnd > now;
}

export function vipStatus(sub: Sub): VipStatusDto {
  const active = isVip(sub);
  return { active, until: active ? sub!.currentPeriodEnd.toISOString() : null };
}

/**
 * Prolonge le VIP de N jours (à partir de la fin du VIP en cours, sinon de maintenant), dans une transaction.
 * Renvoie la nouvelle date de fin.
 */
export async function extendVip(
  tx: Prisma.TransactionClient, userId: string, days: number, provider: "STRIPE" | "GOOGLE_PLAY" | "MANUAL", plan: string,
) {
  const current = await tx.subscription.findUnique({ where: { userId } });
  const now = new Date();
  const from = current && isVip(current, now) ? current.currentPeriodEnd : now;
  const currentPeriodEnd = new Date(from.getTime() + days * DAY_MS);
  await tx.subscription.upsert({
    where: { userId },
    create: { userId, provider, plan, status: "ACTIVE", externalId: `vip:${userId}`, currentPeriodEnd },
    update: { provider, plan, status: "ACTIVE", currentPeriodEnd, cancelAtPeriodEnd: false },
  });
  return currentPeriodEnd;
}

/**
 * Droit d'héberger une partie VIP (salon privé…), lu en base à chaque création : jamais le statut envoyé par
 * l'application ni celui du jeton de connexion, qui peut dater d'avant la fin du VIP. L'équipe (admin, fondateur) y a droit.
 */
export async function canHostVipGames(prisma: PrismaService, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: hostSelect });
  return canHost(user);
}

/** Champs nécessaires à `canHost` (à sélectionner, par exemple, dans une transaction) */
export const hostSelect = { role: true, status: true, ...vipSelect } as const;

/** Même règle que `canHostVipGames`, sur un utilisateur déjà lu : compte actif et VIP, ou administrateur. */
export function canHost(user: { role: string; status: string; subscription: Sub } | null | undefined): boolean {
  if (!user || user.status !== "ACTIVE") return false;
  return isVip(user.subscription) || user.role === "ADMIN" || user.role === "OWNER";
}
