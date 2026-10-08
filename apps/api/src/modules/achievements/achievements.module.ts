import { Controller, Get, Module, Param, ParseUUIDPipe } from "@nestjs/common";
import type { AchievementCategory, AchievementDto, AchievementsOverviewDto } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AchievementEngine, type Criteria } from "./achievement-engine.service.js";

const CATEGORY_ORDER: AchievementCategory[] = ["PROGRESSION", "ACCURACY", "STREAK", "GAME_EXPERT", "VERSUS", "SOCIAL", "SEASON", "SECRET"];

@Controller("achievements")
export class AchievementsController {
  constructor(private readonly prisma: PrismaService, private readonly engine: AchievementEngine) {}

  /**
   * GET /v1/achievements/me — tous les succès avec, pour chacun : obtenu ou non, date, avancement et rareté.
   * Les succès secrets restent masqués tant qu'ils ne sont pas obtenus.
   */
  @Get("me")
  async mine(@CurrentUser() user: AuthUser): Promise<AchievementsOverviewDto> {
    const [all, mine, players, counts, snap, streak] = await Promise.all([
      this.prisma.achievement.findMany({ where: { isActive: true, OR: [{ gameId: null }, { game: { isActive: true } }] }, orderBy: { createdAt: "asc" } }),
      this.prisma.userAchievement.findMany({ where: { userId: user.sub } }),
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.userAchievement.groupBy({ by: ["achievementId"], _count: true }),
      this.engine.snapshot(user.sub),
      this.prisma.user.findUniqueOrThrow({ where: { id: user.sub }, select: { winStreak: true, bestWinStreak: true } }),
    ]);
    const unlocked = new Map(mine.map((m) => [m.achievementId, m.unlockedAt]));
    const owners = new Map(counts.map((c) => [c.achievementId, c._count]));

    const items: AchievementDto[] = all.map((a) => {
      const unlockedAt = unlocked.get(a.id)?.toISOString() ?? null;
      const rarity = players ? Math.min(1, (owners.get(a.id) ?? 0) / players) : 0;
      const category = (a.isHidden ? "SECRET" : a.category) as AchievementCategory;
      if (a.isHidden && !unlockedAt) {
        return { id: a.id, code: "???", name: "Succès secret", description: "Continue de jouer pour le découvrir.", iconUrl: null, category, xpReward: a.xpReward, hidden: true, unlockedAt, progress: null, rarity };
      }
      const measured = this.engine.measure(a.criteria as Criteria, snap);
      const progress = measured ? { current: Math.min(measured.current, measured.target), target: measured.target } : null;
      return { id: a.id, code: a.code, name: a.name, description: a.description, iconUrl: a.iconUrl, category, xpReward: a.xpReward, hidden: a.isHidden, unlockedAt, progress, rarity };
    });
    items.sort((x, y) => CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category));
    return { unlocked: items.filter((i) => i.unlockedAt).length, total: items.length, ...streak, items };
  }

  /** GET /v1/achievements/users/:userId — succès obtenus par un joueur (profil public) */
  @Public()
  @Get("users/:userId")
  byUser(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: { select: { code: true, name: true, description: true, iconUrl: true, category: true } } },
      orderBy: { unlockedAt: "desc" },
    });
  }
}

@Module({ controllers: [AchievementsController], providers: [AchievementEngine], exports: [AchievementEngine] })
export class AchievementsModule {}
