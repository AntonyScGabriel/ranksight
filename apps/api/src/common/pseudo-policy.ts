import { BadRequestException } from "@nestjs/common";
import { isReservedPseudo, pseudoBannedWord } from "@ranksight/shared";
import type { PrismaService } from "../prisma/prisma.service.js";

/** Pseudo refusé : imitation de l'équipe ou du site, ou mot interdit par la modération du chat */
export async function pseudoProblem(prisma: PrismaService, pseudo: string): Promise<string | null> {
  if (isReservedPseudo(pseudo)) return "Ce pseudo est réservé : choisis-en un autre.";
  const row = await prisma.appSetting.findUnique({ where: { key: "chat" }, select: { value: true } });
  const banned = ((row?.value as { bannedWords?: string[] } | undefined)?.bannedWords ?? []).filter((w) => typeof w === "string");
  if (pseudoBannedWord(pseudo, banned)) return "Ce pseudo n'est pas autorisé : choisis-en un autre.";
  return null;
}

export async function assertPseudoAllowed(prisma: PrismaService, pseudo: string) {
  const problem = await pseudoProblem(prisma, pseudo);
  if (problem) throw new BadRequestException({ code: "PSEUDO_FORBIDDEN", message: problem });
}
