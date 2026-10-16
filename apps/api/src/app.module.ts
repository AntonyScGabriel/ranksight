import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { env } from "./config/env.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { AuditModule } from "./common/audit/audit.module.js";
import { HttpThrottlerGuard } from "./common/guards/http-throttler.guard.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { RolesGuard } from "./common/guards/roles.guard.js";
import { EmailVerifiedGuard } from "./common/guards/email-verified.guard.js";
import { PremiumGuard } from "./common/guards/premium.guard.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { GamesModule } from "./modules/games/games.module.js";
import { ClipsModule } from "./modules/clips/clips.module.js";
import { GuessesModule } from "./modules/guesses/guesses.module.js";
import { LeaderboardsModule } from "./modules/leaderboards/leaderboards.module.js";
import { AchievementsModule } from "./modules/achievements/achievements.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { FriendsModule } from "./modules/friends/friends.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { MailModule } from "./modules/mail/mail.service.js";
import { ShopModule } from "./modules/shop/shop.module.js";
import { VersusModule } from "./modules/versus/versus.module.js";
import { RoomsModule } from "./modules/rooms/rooms.module.js";
import { TournamentsModule } from "./modules/tournaments/tournaments.module.js";
import { HigherLowerModule } from "./modules/higher-lower/higher-lower.module.js";
import { TokensModule } from "./modules/tokens/tokens.module.js";
import { ModerationModule } from "./modules/moderation/moderation.module.js";
import { ContactModule } from "./modules/contact/contact.module.js";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module.js";
import { CosmeticsModule } from "./modules/cosmetics/cosmetics.module.js";
import { TriageModule } from "./modules/triage/triage.module.js";
import { AnnouncementModule } from "./modules/announcement/announcement.module.js";
import { SuggestionsModule } from "./modules/suggestions/suggestions.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [
    JwtModule.register({ global: true, secret: env().JWT_ACCESS_SECRET }),
    ScheduleModule.forRoot(),
    // 120 req/min par IP par défaut ; surchargé route par route (@Throttle)
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RedisModule,
    AuditModule,
    StorageModule,
    MailModule,
    CosmeticsModule,
    TriageModule,
    AnnouncementModule,
    AuthModule,
    UsersModule,
    GamesModule,
    ClipsModule,
    GuessesModule,
    LeaderboardsModule,
    AchievementsModule,
    ReportsModule,
    AdminModule,
    NotificationsModule,
    FriendsModule,
    ChatModule,
    ShopModule,
    VersusModule,
    RoomsModule,
    TournamentsModule,
    HigherLowerModule,
    TokensModule,
    ModerationModule,
    ContactModule,
    MaintenanceModule,
    SuggestionsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordre : rate-limit → authentification → adresse email confirmée → rôles → premium
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PremiumGuard },
  ],
})
export class AppModule {}
