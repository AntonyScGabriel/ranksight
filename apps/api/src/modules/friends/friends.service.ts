import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { FriendRelation, FriendRequestsDto, UserSearchResultDto, UserSummaryDto } from "@ranksight/shared";
import { PrismaService } from "../../prisma/prisma.service.js";
import { flairSelect, toFlair } from "../cosmetics/flair.js";

const summarySelect = { id: true, username: true, displayName: true, avatarUrl: true, level: true, ...flairSelect } as const;

type SummaryRow = { id: string; username: string; displayName: string; avatarUrl: string | null; level: number } & Parameters<typeof toFlair>[0];
const toSummary = ({ title, badge, frame, ...u }: SummaryRow): UserSummaryDto => ({ ...u, flair: toFlair({ title, badge, frame }) });
const MAX_FRIENDS = 200;

/**
 * Une ligne `friendships` par paire, orientée demandeur → destinataire.
 * PENDING = demande en cours · ACCEPTED = amis. Refuser ou supprimer efface la ligne.
 */
@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friendship.findFirst({
      where: { status: "ACCEPTED", OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] },
      select: { status: true },
    });
    return !!row;
  }

  async list(userId: string): Promise<UserSummaryDto[]> {
    const ids = await this.friendIds(userId);
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: "ACTIVE" },
      select: summarySelect,
      orderBy: { displayName: "asc" },
    });
    return rows.map(toSummary);
  }

  /** Recherche par pseudo ou nom affiché, avec la relation actuelle pour chaque résultat. */
  async search(userId: string, q: string): Promise<UserSearchResultDto[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        id: { not: userId },
        OR: [{ username: { contains: term.toLowerCase() } }, { displayName: { contains: term, mode: "insensitive" } }],
      },
      select: summarySelect,
      orderBy: { username: "asc" },
      take: 20,
    });
    const links = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: { in: users.map((u) => u.id) } },
          { addresseeId: userId, requesterId: { in: users.map((u) => u.id) } },
        ],
      },
    });
    return users.map((u) => {
      const link = links.find((l) => l.requesterId === u.id || l.addresseeId === u.id);
      let relation: FriendRelation = "none";
      if (link?.status === "ACCEPTED") relation = "friends";
      else if (link?.status === "PENDING") relation = link.requesterId === userId ? "request_sent" : "request_received";
      return { ...toSummary(u), relation };
    });
  }

  async requests(userId: string): Promise<FriendRequestsDto> {
    const [received, sent] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { addresseeId: userId, status: "PENDING", requester: { status: "ACTIVE" } },
        include: { requester: { select: summarySelect } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.friendship.findMany({
        where: { requesterId: userId, status: "PENDING", addressee: { status: "ACTIVE" } },
        include: { addressee: { select: summarySelect } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      received: received.map((r) => ({ ...toSummary(r.requester), requestedAt: r.createdAt.toISOString() })),
      sent: sent.map((r) => ({ ...toSummary(r.addressee), requestedAt: r.createdAt.toISOString() })),
    };
  }

  /** Envoie une demande. Si l'autre joueur en avait déjà envoyé une, vous devenez amis directement. */
  async sendRequest(userId: string, targetId: string): Promise<{ status: "pending" | "accepted" }> {
    if (targetId === userId) throw new BadRequestException("Tu ne peux pas t'ajouter toi-même.");
    const target = await this.prisma.user.findFirst({ where: { id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) throw new NotFoundException("Joueur introuvable.");
    const blocked = await this.prisma.userBlock.count({
      where: { OR: [{ blockerId: userId, blockedId: targetId }, { blockerId: targetId, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException("Impossible d'envoyer une demande à ce joueur.");

    const reverse = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: targetId, addresseeId: userId } },
    });
    if (reverse?.status === "ACCEPTED") throw new ConflictException("Vous êtes déjà amis.");
    if (reverse?.status === "PENDING") {
      await this.assertCapacity(userId);
      await this.prisma.friendship.update({
        where: { requesterId_addresseeId: { requesterId: targetId, addresseeId: userId } },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      return { status: "accepted" };
    }

    const existing = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: userId, addresseeId: targetId } },
    });
    if (existing?.status === "ACCEPTED") throw new ConflictException("Vous êtes déjà amis.");
    if (existing?.status === "PENDING") return { status: "pending" };

    await this.assertCapacity(userId);
    await this.prisma.friendship.create({ data: { requesterId: userId, addresseeId: targetId } });
    return { status: "pending" };
  }

  async accept(userId: string, requesterId: string) {
    await this.assertCapacity(userId);
    const updated = await this.prisma.friendship.updateMany({
      where: { requesterId, addresseeId: userId, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException("Demande introuvable.");
  }

  /** Refuse une demande reçue ou annule une demande envoyée. */
  async declineOrCancel(userId: string, otherId: string) {
    const deleted = await this.prisma.friendship.deleteMany({
      where: {
        status: "PENDING",
        OR: [{ requesterId: otherId, addresseeId: userId }, { requesterId: userId, addresseeId: otherId }],
      },
    });
    if (deleted.count === 0) throw new NotFoundException("Demande introuvable.");
  }

  async remove(userId: string, friendId: string) {
    const deleted = await this.prisma.friendship.deleteMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: friendId, addresseeId: userId }, { requesterId: userId, addresseeId: friendId }],
      },
    });
    if (deleted.count === 0) throw new NotFoundException("Ce joueur ne fait pas partie de tes amis.");
  }

  private async assertCapacity(userId: string) {
    if ((await this.friendIds(userId)).length >= MAX_FRIENDS) throw new ConflictException(`Limite de ${MAX_FRIENDS} amis atteinte.`);
  }
}
