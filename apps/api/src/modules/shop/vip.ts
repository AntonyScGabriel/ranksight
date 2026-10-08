import type { VipStatusDto } from "@ranksight/shared";
import type { Prisma } from "../../generated/prisma/client.js";

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
