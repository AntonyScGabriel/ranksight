import { env } from "../../config/env.js";
import { AllowUnverified } from "../../common/decorators/allow-unverified.decorator.js";
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { levelFromXp, Pseudo, TERMS_VERSION, type FriendRelation, type PublicProfileDto, pseudoKey } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Premium } from "../../common/decorators/roles.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { assertPseudoAllowed } from "../../common/pseudo-policy.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { TokenService } from "../auth/token.service.js";
import { ClipRemovalService } from "../clips/clip-removal.service.js";
import { ClipsModule } from "../clips/clips.module.js";
import { isVip, vipSelect, vipStatus } from "../shop/vip.js";
import { CosmeticsService } from "../cosmetics/cosmetics.service.js";
import { cosmeticRefSelect, flairSelect, toCosmeticRef, toFlair } from "../cosmetics/flair.js";
import { AvatarController, AvatarService } from "./avatar.service.js";

const UpdateMe = z
  .object({
    /** Pseudo RankGuess (unique, sans tenir compte des majuscules) */
    pseudo: Pseudo,
    timezone: z.string().max(64),
    notifyDaily: z.boolean(),
  })
  .partial()
  .strict();

/** Suppression du compte : le joueur retape son pseudo pour confirmer */
const DeleteMeBody = z.object({ confirm: z.string().trim().min(1, "Retape ton pseudo pour confirmer.") });

const PushTokenBody = z.object({ token: z.string().min(10).max(255), platform: z.enum(["IOS", "ANDROID", "WEB"]) });

const AcceptTermsBody = z.object({ accept: z.literal(true) });

const publicSelect = {
  id: true, username: true, displayName: true, avatarUrl: true,
  xp: true, level: true, dailyStreak: true, bestDailyStreak: true, winStreak: true, bestWinStreak: true, infiniteBest: true,
  totalGuesses: true, exactGuesses: true, createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly clips: ClipRemovalService,
    private readonly cosmetics: CosmeticsService,
    private readonly storage: StorageService,
  ) {}

  async me(userId: string) {
    const { passwordHash, oauthAccounts, uploadedClips, subscription, ...user } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...publicSelect, email: true, role: true, timezone: true, notifyDaily: true, passwordHash: true,
        emailVerifiedAt: true, termsAcceptedAt: true, termsVersion: true, chatMutedUntil: true, totpEnabledAt: true,
        ...flairSelect,
        subscription: { select: { status: true, plan: true, currentPeriodEnd: true } },
        oauthAccounts: { select: { provider: true } },
        // Pseudos en jeu utilisés dans ses clips : jamais confondus avec le pseudo RankGuess
        uploadedClips: {
          where: { inGamePseudo: { not: null }, deletedAt: null, game: { isActive: true } },
          select: { inGamePseudo: true, game: { select: { slug: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    const seen = new Set<string>();
    const inGamePseudos = uploadedClips
      .filter((c) => !seen.has(`${c.game.slug}:${c.inGamePseudo}`) && seen.add(`${c.game.slug}:${c.inGamePseudo}`))
      .map((c) => ({ game: c.game, inGamePseudo: c.inGamePseudo! }));
    const { emailVerifiedAt, termsAcceptedAt, termsVersion, chatMutedUntil, totpEnabledAt, title, badge, frame, ...rest } = user;
    return {
      ...rest,
      flair: toFlair({ title, badge, frame }),
      /** Récompenses obtenues depuis la dernière visite de l'écran des récompenses */
      newRewards: await this.cosmetics.unseenCount(userId),
      // Adresse confirmée, ou compte Google/Discord (identité vérifiée par le fournisseur)
      emailVerified: !!emailVerifiedAt || oauthAccounts.length > 0,
      /** Compte bloqué jusqu'à la confirmation de l'adresse (inscription par email ; jamais pour l'équipe) */
      mustVerifyEmail: env().EMAIL_VERIFICATION_REQUIRED === "true" && !emailVerifiedAt && oauthAccounts.length === 0 && user.role === "USER",
      /** CGU de la version en vigueur acceptées (sinon les clients demandent l'acceptation) */
      termsAccepted: !!termsAcceptedAt && termsVersion === TERMS_VERSION,
      chatMutedUntil: chatMutedUntil && chatMutedUntil > new Date() ? chatMutedUntil.toISOString() : null,
      mfaEnabled: !!totpEnabledAt,
      // Accès réservé au fondateur (boutique, VIP offert, annonce, stockage, journal) ; les administrateurs l'ont tant
      // qu'aucun fondateur n'est nommé
      siteOwner: user.role === "OWNER" || (user.role === "ADMIN" && (await this.prisma.user.count({ where: { role: "OWNER" } })) === 0),
      hasPassword: !!passwordHash,
      vip: vipStatus(subscription),
      linkedProviders: oauthAccounts.map((a) => a.provider),
      inGamePseudos,
      progress: levelFromXp(user.xp),
    };
  }

  async acceptTerms(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } });
  }

  async update(userId: string, input: z.infer<typeof UpdateMe>) {
    const { pseudo, ...rest } = input;
    if (pseudo) await assertPseudoAllowed(this.prisma, pseudo);
    const data = { ...rest, ...(pseudo ? { username: pseudoKey(pseudo), displayName: pseudo } : {}) };
    try {
      return await this.prisma.user.update({ where: { id: userId }, data, select: publicSelect });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException({ code: "PSEUDO_TAKEN", message: "Ce pseudo est déjà utilisé." });
      throw e;
    }
  }

  async publicProfile(username: string) {
    const user = await this.prisma.user.findFirst({
      where: { username: pseudoKey(username), status: "ACTIVE" },
      select: { ...publicSelect, gameStats: { where: { game: { isActive: true } }, include: { game: { select: { slug: true, name: true } } } } },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  /**
   * Profil public d'un joueur (clic sur un pseudo dans le classement, le chat, les amis) :
   * niveau, statistiques, duels, succès obtenus et, pour un visiteur connecté, la relation d'amitié.
   */
  async profileById(id: string, viewerId?: string): Promise<PublicProfileDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, status: "ACTIVE" },
      select: {
        id: true, displayName: true, avatarUrl: true, level: true, createdAt: true,
        totalGuesses: true, exactGuesses: true, bestWinStreak: true, bestDailyStreak: true, infiniteBest: true, statsResetAt: true,
        ...vipSelect,
        ...flairSelect,
        cosmetics: {
          where: { cosmetic: { isActive: true, type: { in: ["TITLE", "BADGE"] } } },
          select: { cosmetic: { select: cosmeticRefSelect } },
          orderBy: { grantedAt: "desc" },
          take: 40,
        },
        achievements: {
          where: { achievement: { isActive: true } },
          select: { unlockedAt: true, achievement: { select: { code: true, name: true, description: true, category: true } } },
          orderBy: { unlockedAt: "desc" },
        },
      },
    });
    if (!user) throw new NotFoundException("Joueur introuvable.");
    const [finished, relation] = await Promise.all([
      // Bilan des duels depuis la dernière remise à zéro des statistiques par l'équipe
      this.prisma.versusMatch.findMany({
        where: { status: "FINISHED", OR: [{ creatorId: id }, { opponentId: id }], ...(user.statsResetAt ? { finishedAt: { gt: user.statsResetAt } } : {}) },
        select: { winnerId: true },
      }),
      viewerId ? this.relation(viewerId, id) : Promise.resolve(null),
    ]);
    const blockedByMe = viewerId && viewerId !== id
      ? (await this.prisma.userBlock.count({ where: { blockerId: viewerId, blockedId: id } })) > 0
      : false;
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      vip: isVip(user.subscription),
      level: user.level,
      flair: toFlair(user),
      collection: user.cosmetics.map((c) => toCosmeticRef(c.cosmetic)!).filter(Boolean),
      createdAt: user.createdAt.toISOString(),
      stats: {
        totalGuesses: user.totalGuesses,
        exactRate: user.totalGuesses ? user.exactGuesses / user.totalGuesses : 0,
        bestWinStreak: user.bestWinStreak,
        bestDailyStreak: user.bestDailyStreak,
        infiniteBest: user.infiniteBest,
      },
      versus: {
        wins: finished.filter((m) => m.winnerId === id).length,
        losses: finished.filter((m) => m.winnerId && m.winnerId !== id).length,
        draws: finished.filter((m) => !m.winnerId).length,
      },
      achievements: user.achievements.map((a) => ({ ...a.achievement, unlockedAt: a.unlockedAt.toISOString() })),
      relation,
      blockedByMe,
    };
  }

  private async relation(viewerId: string, id: string): Promise<FriendRelation> {
    if (viewerId === id) return "self";
    const links = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: viewerId, addresseeId: id }, { requesterId: id, addresseeId: viewerId }] },
    });
    if (links.some((l) => l.status === "ACCEPTED")) return "friends";
    if (links.some((l) => l.status === "PENDING" && l.requesterId === viewerId)) return "request_sent";
    if (links.some((l) => l.status === "PENDING" && l.requesterId === id)) return "request_received";
    return "none";
  }

  /** Statistiques de base (gratuit) */
  async stats(userId: string) {
    const perGame = await this.prisma.userGameStats.findMany({
      where: { userId, game: { isActive: true } },
      include: { game: { select: { slug: true, name: true } } },
    });
    return perGame.map((s) => ({
      game: s.game,
      guesses: s.guesses,
      accuracy: s.guesses ? s.exact / s.guesses : 0,
      avgDistance: s.guesses ? s.totalDistance / s.guesses : 0,
      avgScore: s.guesses ? s.totalScore / s.guesses : 0,
    }));
  }

  /** Statistiques avancées (Premium) : biais sur/sous-estimation par rang, évolution 90 j */
  async advancedStats(userId: string) {
    const bias = await this.prisma.$queryRaw<{ game: string; rank: string; samples: bigint; bias: number }[]>`
      SELECT g.slug AS game, r.name AS rank, COUNT(*) AS samples,
             AVG(gr."order" - r."order")::float AS bias
      FROM guesses gu
      JOIN clips c ON c.id = gu.clip_id
      JOIN ranks r ON r.id = c.rank_id
      JOIN ranks gr ON gr.id = gu.guessed_rank_id
      JOIN games g ON g.id = c.game_id
      WHERE gu.user_id = ${userId}::uuid
      GROUP BY g.slug, r.name, r."order"
      ORDER BY g.slug, r."order"`;
    const trend = await this.prisma.$queryRaw<{ day: Date; avg_score: number; guesses: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day, AVG(score)::float AS avg_score, COUNT(*) AS guesses
      FROM guesses WHERE user_id = ${userId}::uuid AND created_at > now() - interval '90 days'
      GROUP BY 1 ORDER BY 1`;
    return {
      bias: bias.map((b) => ({ ...b, samples: Number(b.samples) })),
      trend: trend.map((t) => ({ ...t, guesses: Number(t.guesses) })),
    };
  }

  /**
   * Suppression d'un compte (par le joueur ou par un administrateur).
   * Le compte est anonymisé : pseudo et email libérés, connexions Google/Discord, mot de passe, double authentification,
   * sessions, amis, blocages, messages privés, messages du chat global, suggestions et clips proposés supprimés. Les réponses déjà données restent dans les statistiques
   * des clips, sans lien avec une personne identifiable ; les achats restent pour la comptabilité.
   */
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status === "DELETED") throw new NotFoundException("Compte introuvable.");
    await this.tokens.revokeAll(userId);

    const clips = await this.prisma.clip.findMany({ where: { uploaderId: userId, source: "COMMUNITY", deletedAt: null }, select: { id: true } });
    for (const c of clips) await this.clips.remove(c.id);
    const { avatarKey } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarKey: true } });
    if (avatarKey) await this.storage.delete(avatarKey).catch(() => undefined);

    await this.prisma.$transaction([
      this.prisma.oAuthAccount.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId } }),
      this.prisma.directMessage.deleteMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
      this.prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      this.prisma.pushToken.deleteMany({ where: { userId } }),
      this.prisma.userCosmetic.deleteMany({ where: { userId } }),
      this.prisma.suggestion.deleteMany({ where: { userId } }),
      this.prisma.friendship.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      this.prisma.globalMessage.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: new Date() } }),
      this.prisma.subscription.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: "DELETED",
          role: "USER",
          deletedAt: new Date(),
          email: null,
          emailVerifiedAt: null,
          passwordHash: null,
          username: `deleted_${userId.replace(/-/g, "")}`,
          displayName: "Joueur supprimé",
          avatarUrl: null,
          avatarKey: null,
          titleId: null,
          badgeId: null,
          frameId: null,
          notifyDaily: false,
          totpSecret: null,
          totpEnabledAt: null,
          totpRecovery: [],
        },
      }),
    ]);
  }

  /** Le joueur supprime son propre compte en retapant son pseudo. */
  async deleteOwnAccount(userId: string, confirm: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    if (confirm.toLowerCase() !== user.displayName.toLowerCase()) {
      throw new BadRequestException({ code: "CONFIRMATION_MISMATCH", message: "Le pseudo saisi ne correspond pas." });
    }
    await this.deleteAccount(userId);
  }

  registerPushToken(userId: string, body: z.infer<typeof PushTokenBody>) {
    return this.prisma.pushToken.upsert({
      where: { token: body.token },
      create: { userId, ...body },
      update: { userId, platform: body.platform },
    });
  }
}

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @AllowUnverified() @Get("me") me(@CurrentUser() u: AuthUser) { return this.users.me(u.sub); }

  @AllowUnverified() @Patch("me")
  update(@CurrentUser() u: AuthUser, @Body(new ZodPipe(UpdateMe)) body: z.infer<typeof UpdateMe>) {
    return this.users.update(u.sub, body);
  }

  /** DELETE /v1/users/me — { confirm: pseudo } ; supprime le compte et ferme la session */
  @AllowUnverified() @Delete("me") @HttpCode(204)
  async remove(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(DeleteMeBody)) body: z.infer<typeof DeleteMeBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.deleteOwnAccount(u.sub, body.confirm);
    res.clearCookie("rs_access", { path: "/" });
    res.clearCookie("rs_refresh", { path: "/v1/auth" });
  }

  /** POST /v1/users/me/terms — acceptation des CGU en vigueur (et déclaration d'avoir 15 ans ou plus) */
  @AllowUnverified() @Post("me/terms") @HttpCode(204)
  async acceptTerms(@CurrentUser() u: AuthUser, @Body(new ZodPipe(AcceptTermsBody)) _b: z.infer<typeof AcceptTermsBody>) {
    await this.users.acceptTerms(u.sub);
  }

  @Get("me/stats") stats(@CurrentUser() u: AuthUser) { return this.users.stats(u.sub); }

  @Premium() @Get("me/stats/advanced")
  advanced(@CurrentUser() u: AuthUser) { return this.users.advancedStats(u.sub); }

  @AllowUnverified() @Post("me/push-tokens") @HttpCode(204)
  push(@CurrentUser() u: AuthUser, @Body(new ZodPipe(PushTokenBody)) body: z.infer<typeof PushTokenBody>) {
    return this.users.registerPushToken(u.sub, body);
  }

  /** GET /v1/users/:id/profile — profil public (la relation d'amitié est ajoutée si le visiteur est connecté) */
  @Public() @Get(":id/profile")
  publicById(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() viewer?: AuthUser) {
    return this.users.profileById(id, viewer?.sub);
  }

  @Public() @Get(":username")
  profile(@Param("username") username: string) { return this.users.publicProfile(username); }
}

@Module({
  imports: [AuthModule, ClipsModule],
  controllers: [UsersController, AvatarController],
  providers: [UsersService, AvatarService],
  exports: [UsersService, AvatarService],
})
export class UsersModule {}
