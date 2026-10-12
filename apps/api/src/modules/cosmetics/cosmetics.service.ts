import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  AdminCosmeticDto, CosmeticHolderDto, CosmeticRefDto, CosmeticType, EquipFlairInput, LockedCosmeticDto, MyRewardsDto, OwnedCosmeticDto,
} from "@ranksight/shared";
import { CosmeticInput } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { cosmeticRefSelect, flairSelect, toCosmeticRef, toFlair, unlockHint } from "./flair.js";
import { assertCanManage } from "../../common/staff-policy.js";
import { pseudoKey } from "@ranksight/shared";

type CosmeticData = z.output<typeof CosmeticInput>;

const EQUIP_FIELD: Record<CosmeticType, "titleId" | "badgeId" | "frameId"> = { TITLE: "titleId", BADGE: "badgeId", FRAME: "frameId" };

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "recompense";

/** Récompenses de fin de saison, créées automatiquement à la clôture de chaque saison */
const SEASON_REWARDS = [
  { suffix: "champion", type: "TITLE", maxRank: 1, name: (n: number) => `Champion saison ${n}`, color: "#FACC15", description: (n: number) => `1re place du classement de la saison ${n}` },
  { suffix: "podium", type: "TITLE", maxRank: 3, name: (n: number) => `Podium saison ${n}`, color: "#E5E7EB", description: (n: number) => `Top 3 du classement de la saison ${n}` },
  { suffix: "top10", type: "BADGE", maxRank: 10, name: (n: number) => `Top 10 saison ${n}`, color: "#A78BFA", description: (n: number) => `Top 10 du classement de la saison ${n}`, icon: "trophy" },
] as const;

/** Récompense du meilleur contributeur de la saison (le plus de clips acceptés) */
const CONTRIBUTOR_REWARD = {
  suffix: "contributor",
  name: (n: number) => `Contributeur saison ${n}`,
  color: "#34D399",
  description: (n: number) => `Le plus de clips acceptés pendant la saison ${n}`,
} as const;

/**
 * Récompenses des joueurs : titres, badges et cadres d'avatar.
 * - Paliers de niveau et succès : attribuées automatiquement après chaque partie (et à tous les joueurs déjà éligibles
 *   quand l'équipe crée ou modifie une récompense automatique).
 * - Classement de fin de saison : titres « Champion », « Podium » et badge « Top 10 » de la saison,
 *   titre « Contributeur » pour le joueur qui a fait accepter le plus de clips pendant la saison.
 * - Attribution manuelle par l'équipe (Youtubeur, Streamer…), journalisée.
 */
@Injectable()
export class CosmeticsService {
  private readonly logger = new Logger(CosmeticsService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ---------- Déblocages automatiques ----------

  /** Attribue au joueur les récompenses de niveau et de succès qu'il remplit ; renvoie les nouvelles. */
  async sync(userId: string): Promise<CosmeticRefDto[]> {
    const rows = await this.prisma.$queryRaw<{ cosmetic_id: string }[]>`
      INSERT INTO user_cosmetics (user_id, cosmetic_id, source)
      SELECT u.id, c.id, (CASE WHEN c.unlock_level IS NOT NULL THEN 'LEVEL' ELSE 'ACHIEVEMENT' END)::"CosmeticSource"
      FROM users u
      JOIN cosmetics c ON c.is_active AND (
        (c.unlock_level IS NOT NULL AND u.level >= c.unlock_level)
        OR (c.unlock_achievement_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM user_achievements ua WHERE ua.user_id = u.id AND ua.achievement_id = c.unlock_achievement_id))
      )
      WHERE u.id = ${userId}::uuid AND u.status = 'ACTIVE'
      ON CONFLICT DO NOTHING
      RETURNING cosmetic_id`;
    if (!rows.length) return [];
    const cosmetics = await this.prisma.cosmetic.findMany({ where: { id: { in: rows.map((r) => r.cosmetic_id) } }, select: cosmeticRefSelect });
    return cosmetics.map((c) => toCosmeticRef(c)!).filter(Boolean);
  }

  /** Récompense automatique créée ou modifiée : attribuée à tous les joueurs qui remplissent déjà la condition. */
  private async grantToEligible(cosmeticId: string) {
    return this.prisma.$executeRaw`
      INSERT INTO user_cosmetics (user_id, cosmetic_id, source)
      SELECT u.id, c.id, (CASE WHEN c.unlock_level IS NOT NULL THEN 'LEVEL' ELSE 'ACHIEVEMENT' END)::"CosmeticSource"
      FROM cosmetics c
      JOIN users u ON u.status = 'ACTIVE' AND (
        (c.unlock_level IS NOT NULL AND u.level >= c.unlock_level)
        OR (c.unlock_achievement_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM user_achievements ua WHERE ua.user_id = u.id AND ua.achievement_id = c.unlock_achievement_id))
      )
      WHERE c.id = ${cosmeticId}::uuid AND c.is_active
      ON CONFLICT DO NOTHING`;
  }

  /** Clôture d'une saison : titres et badge de la saison pour le haut du classement général. */
  async awardSeason(seasonNumber: number, ranking: { userId: string; position: number }[]) {
    let granted = 0;
    for (const reward of SEASON_REWARDS) {
      const winners = ranking.filter((r) => r.position <= reward.maxRank);
      if (!winners.length) continue;
      const cosmetic = await this.prisma.cosmetic.upsert({
        where: { key: `season-${seasonNumber}-${reward.suffix}` },
        create: {
          key: `season-${seasonNumber}-${reward.suffix}`, type: reward.type, name: reward.name(seasonNumber), color: reward.color,
          description: reward.description(seasonNumber), icon: "icon" in reward ? reward.icon : null,
        },
        update: {},
      });
      const { count } = await this.prisma.userCosmetic.createMany({
        data: winners.map((w) => ({ userId: w.userId, cosmeticId: cosmetic.id, source: "SEASON" as const })),
        skipDuplicates: true,
      });
      granted += count;
    }
    if (granted) this.logger.log(`Saison ${seasonNumber} : ${granted} récompense(s) de classement attribuée(s)`);
  }

  /** Clôture d'une saison : titre « Contributeur » pour le joueur qui a fait accepter le plus de clips. */
  async awardSeasonContributor(seasonNumber: number, userId: string) {
    const key = `season-${seasonNumber}-${CONTRIBUTOR_REWARD.suffix}`;
    const cosmetic = await this.prisma.cosmetic.upsert({
      where: { key },
      create: { key, type: "TITLE", name: CONTRIBUTOR_REWARD.name(seasonNumber), color: CONTRIBUTOR_REWARD.color, description: CONTRIBUTOR_REWARD.description(seasonNumber) },
      update: {},
    });
    const { count } = await this.prisma.userCosmetic.createMany({ data: [{ userId, cosmeticId: cosmetic.id, source: "SEASON" }], skipDuplicates: true });
    if (count) this.logger.log(`Saison ${seasonNumber} : titre de meilleur contributeur attribué`);
    return count > 0;
  }

  /**
   * Remise à zéro des statistiques : les récompenses gagnées en jouant (niveau, succès, saison) sont retirées ;
   * celles attribuées par l'équipe restent.
   */
  async revokeEarned(userId: string) {
    const { count } = await this.prisma.userCosmetic.deleteMany({ where: { userId, source: { not: "MANUAL" } } });
    await this.unequipMissing(userId);
    return count;
  }

  private async unequipMissing(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { titleId: true, badgeId: true, frameId: true } });
    const equipped = [user.titleId, user.badgeId, user.frameId].filter((v): v is string => !!v);
    if (!equipped.length) return;
    const owned = new Set(
      (await this.prisma.userCosmetic.findMany({ where: { userId, cosmeticId: { in: equipped } }, select: { cosmeticId: true } })).map((o) => o.cosmeticId),
    );
    const data: Record<string, null> = {};
    if (user.titleId && !owned.has(user.titleId)) data.titleId = null;
    if (user.badgeId && !owned.has(user.badgeId)) data.badgeId = null;
    if (user.frameId && !owned.has(user.frameId)) data.frameId = null;
    if (Object.keys(data).length) await this.prisma.user.update({ where: { id: userId }, data });
  }

  // ---------- Joueur ----------

  unseenCount(userId: string) {
    return this.prisma.userCosmetic.count({ where: { userId, seenAt: null, cosmetic: { isActive: true } } });
  }

  /** Écran « Mes récompenses » : récompenses obtenues (les nouvelles sont marquées vues), équipées et à gagner. */
  async myRewards(userId: string): Promise<MyRewardsDto> {
    await this.sync(userId);
    const [user, owned, automatic] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { level: true, ...flairSelect } }),
      this.prisma.userCosmetic.findMany({
        where: { userId, cosmetic: { isActive: true } },
        include: { cosmetic: { select: cosmeticRefSelect } },
        orderBy: { grantedAt: "desc" },
      }),
      this.prisma.cosmetic.findMany({
        where: { isActive: true, OR: [{ unlockLevel: { not: null } }, { unlockAchievementId: { not: null } }] },
        select: { ...cosmeticRefSelect, unlockAchievement: { select: { name: true, isHidden: true, isActive: true } } },
      }),
    ]);
    const ownedIds = new Set(owned.map((o) => o.cosmeticId));
    const ownedDto: OwnedCosmeticDto[] = owned.map((o) => ({
      ...toCosmeticRef(o.cosmetic)!,
      description: o.cosmetic.description,
      source: o.source,
      grantedAt: o.grantedAt.toISOString(),
      isNew: !o.seenAt,
    }));
    const locked: LockedCosmeticDto[] = automatic
      .filter((c) => !ownedIds.has(c.id))
      // Succès secret ou désactivé : la récompense reste une surprise
      .filter((c) => c.unlockLevel !== null || (c.unlockAchievement && c.unlockAchievement.isActive && !c.unlockAchievement.isHidden))
      .map((c) => ({
        ...toCosmeticRef(c)!,
        description: c.description,
        unlock: c.unlockLevel !== null ? { kind: "level" as const, level: c.unlockLevel } : { kind: "achievement" as const, achievement: c.unlockAchievement!.name },
      }))
      .sort((a, b) => {
        const la = a.unlock.kind === "level" ? a.unlock.level : Number.MAX_SAFE_INTEGER;
        const lb = b.unlock.kind === "level" ? b.unlock.level : Number.MAX_SAFE_INTEGER;
        return la - lb || a.name.localeCompare(b.name, "fr");
      });
    if (ownedDto.some((o) => o.isNew)) {
      await this.prisma.userCosmetic.updateMany({ where: { userId, seenAt: null }, data: { seenAt: new Date() } });
    }
    return { level: user.level, equipped: toFlair(user), owned: ownedDto, locked };
  }

  /** Équiper (ou retirer avec null) un titre, un badge, un cadre : uniquement une récompense obtenue et du bon type. */
  async equip(userId: string, input: EquipFlairInput) {
    const data: { titleId?: string | null; badgeId?: string | null; frameId?: string | null } = {};
    for (const [type, field] of Object.entries(EQUIP_FIELD) as [CosmeticType, keyof typeof data][]) {
      const value = input[field];
      if (value === undefined) continue;
      if (value === null) {
        data[field] = null;
        continue;
      }
      const owned = await this.prisma.userCosmetic.findUnique({
        where: { userId_cosmeticId: { userId, cosmeticId: value } },
        select: { cosmetic: { select: { type: true, isActive: true } } },
      });
      if (!owned || !owned.cosmetic.isActive) throw new BadRequestException({ code: "NOT_OWNED", message: "Tu n'as pas encore débloqué cette récompense." });
      if (owned.cosmetic.type !== type) throw new BadRequestException({ code: "WRONG_TYPE", message: "Cette récompense ne peut pas être équipée ici." });
      data[field] = value;
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data, select: flairSelect });
    return toFlair(user);
  }

  // ---------- Administration ----------

  async list(): Promise<AdminCosmeticDto[]> {
    const rows = await this.prisma.cosmetic.findMany({
      include: { unlockAchievement: { select: { id: true, name: true, isHidden: true } }, _count: { select: { owners: true } } },
      orderBy: [{ type: "asc" }, { unlockLevel: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    });
    return rows.map((c) => ({
      id: c.id, key: c.key, type: c.type, name: c.name, description: c.description, color: c.color, color2: c.color2, icon: c.icon, hint: unlockHint(c),
      unlockLevel: c.unlockLevel, unlockAchievement: c.unlockAchievement && { id: c.unlockAchievement.id, name: c.unlockAchievement.name }, isActive: c.isActive, owners: c._count.owners, createdAt: c.createdAt.toISOString(),
    }));
  }

  achievementOptions() {
    return this.prisma.achievement.findMany({
      select: { id: true, code: true, name: true, category: true, isActive: true, isHidden: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async create(actorId: string, input: CosmeticData) {
    await this.checkUnlock(input);
    const base = `${input.type.toLowerCase()}-${slugify(input.name)}`;
    let key = base;
    for (let i = 2; await this.prisma.cosmetic.findUnique({ where: { key }, select: { id: true } }); i++) key = `${base}-${i}`;
    const cosmetic = await this.prisma.cosmetic.create({ data: { key, ...this.data(input) } });
    const granted = await this.grantToEligible(cosmetic.id);
    await this.audit.log(actorId, "cosmetic.create", "cosmetic", cosmetic.id, { name: cosmetic.name, type: cosmetic.type, granted });
    return { id: cosmetic.id, granted };
  }

  async update(actorId: string, id: string, input: CosmeticData) {
    const current = await this.prisma.cosmetic.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Récompense introuvable.");
    if (current.type !== input.type) throw new BadRequestException("Le type d'une récompense ne peut pas changer : crée-en une nouvelle.");
    await this.checkUnlock(input);
    await this.prisma.cosmetic.update({ where: { id }, data: this.data(input) });
    const granted = await this.grantToEligible(id);
    await this.audit.log(actorId, "cosmetic.update", "cosmetic", id, { name: input.name, granted });
    return { id, granted };
  }

  private data(input: CosmeticData) {
    return {
      type: input.type,
      name: input.name,
      description: input.description || null,
      color: input.color.toUpperCase(),
      color2: input.type === "FRAME" && input.color2 ? input.color2.toUpperCase() : null,
      icon: input.type === "BADGE" ? (input.icon ?? null) : null,
      unlockLevel: input.unlockLevel ?? null,
      unlockAchievementId: input.unlockAchievementId ?? null,
      isActive: input.isActive,
    };
  }

  private async checkUnlock(input: CosmeticData) {
    if (input.unlockAchievementId && !(await this.prisma.achievement.findUnique({ where: { id: input.unlockAchievementId }, select: { id: true } }))) {
      throw new BadRequestException("Succès introuvable.");
    }
  }

  async holders(id: string): Promise<CosmeticHolderDto[]> {
    const rows = await this.prisma.userCosmetic.findMany({
      where: { cosmeticId: id, user: { status: { not: "DELETED" } } },
      include: { user: { select: { displayName: true } }, grantedBy: { select: { displayName: true } } },
      orderBy: { grantedAt: "desc" },
      take: 500,
    });
    return rows.map((r) => ({
      userId: r.userId, displayName: r.user.displayName, source: r.source, note: r.note, grantedAt: r.grantedAt.toISOString(), grantedBy: r.grantedBy?.displayName ?? null,
    }));
  }

  /** Récompenses d'un joueur (fiche joueur de l'administration) */
  async ofUser(userId: string) {
    const rows = await this.prisma.userCosmetic.findMany({
      where: { userId },
      include: { cosmetic: { select: cosmeticRefSelect }, grantedBy: { select: { displayName: true } } },
      orderBy: { grantedAt: "desc" },
    });
    return rows.map((r) => ({
      ...toCosmeticRef({ ...r.cosmetic, isActive: true })!,
      isActive: r.cosmetic.isActive,
      source: r.source, note: r.note, grantedAt: r.grantedAt.toISOString(), grantedBy: r.grantedBy?.displayName ?? null,
    }));
  }

  /** Attribution manuelle (par identifiant ou par pseudo), journalisée */
  async grant(actorId: string, target: { userId?: string; pseudo?: string }, cosmeticId: string, note?: string | null) {
    const user = await this.prisma.user.findFirst({
      where: { status: { not: "DELETED" }, ...(target.userId ? { id: target.userId } : { username: pseudoKey(target.pseudo ?? "") }) },
      select: { id: true, displayName: true },
    });
    if (!user) throw new NotFoundException("Joueur introuvable.");
    const cosmetic = await this.prisma.cosmetic.findUnique({ where: { id: cosmeticId }, select: { id: true, name: true, isActive: true } });
    if (!cosmetic) throw new NotFoundException("Récompense introuvable.");
    if (!cosmetic.isActive) throw new BadRequestException("Cette récompense est désactivée.");
    const exists = await this.prisma.userCosmetic.findUnique({ where: { userId_cosmeticId: { userId: user.id, cosmeticId } }, select: { userId: true } });
    if (exists) throw new ConflictException(`${user.displayName} a déjà « ${cosmetic.name} ».`);
    await this.prisma.userCosmetic.create({ data: { userId: user.id, cosmeticId, source: "MANUAL", grantedById: actorId, note: note || null } });
    await this.audit.log(actorId, "cosmetic.grant", "user", user.id, { cosmetic: cosmetic.name, note: note || null });
    return { userId: user.id, displayName: user.displayName };
  }

  async revoke(actorId: string, userId: string, cosmeticId: string) {
    await assertCanManage(this.prisma, actorId, userId);
    const row = await this.prisma.userCosmetic.findUnique({
      where: { userId_cosmeticId: { userId, cosmeticId } },
      select: { source: true, cosmetic: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException("Ce joueur n'a pas cette récompense.");
    if (row.source === "LEVEL" || row.source === "ACHIEVEMENT") {
      throw new BadRequestException(
        "Récompense gagnée automatiquement : elle serait redonnée à la prochaine partie. Désactive la récompense ou remets à zéro les statistiques du joueur.",
      );
    }
    await this.prisma.userCosmetic.delete({ where: { userId_cosmeticId: { userId, cosmeticId } } });
    await this.unequipMissing(userId);
    await this.audit.log(actorId, "cosmetic.revoke", "user", userId, { cosmetic: row.cosmetic.name });
  }
}
