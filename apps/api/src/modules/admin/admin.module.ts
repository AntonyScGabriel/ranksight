import { Module } from "@nestjs/common";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { ClipsModule } from "../clips/clips.module.js";
import { UsersModule } from "../users/users.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LeaderboardsModule } from "../leaderboards/leaderboards.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { PlayerHistoryService } from "./player-history.service.js";

@Module({ imports: [AchievementsModule, AuthModule, ClipsModule, LeaderboardsModule, UsersModule], controllers: [AdminController], providers: [AdminService, PlayerHistoryService] })
export class AdminModule {}
