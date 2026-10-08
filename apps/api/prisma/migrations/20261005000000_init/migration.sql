-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'DISCORD');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClipSource" AS ENUM ('ADMIN', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('DAILY', 'INFINITE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('PROGRESSION', 'STREAK', 'ACCURACY', 'GAME_EXPERT', 'SOCIAL', 'SECRET');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'SEASON', 'ALL_TIME', 'INFINITE');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('WRONG_RANK', 'INAPPROPRIATE', 'LOW_QUALITY', 'SPOILER_UI', 'COPYRIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('STRIPE', 'APPLE', 'GOOGLE_PLAY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "display_name" VARCHAR(32) NOT NULL,
    "avatar_url" TEXT,
    "country_code" CHAR(2),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "daily_streak" INTEGER NOT NULL DEFAULT 0,
    "best_daily_streak" INTEGER NOT NULL DEFAULT 0,
    "last_daily_date" DATE,
    "infinite_best" INTEGER NOT NULL DEFAULT 0,
    "total_guesses" INTEGER NOT NULL DEFAULT 0,
    "exact_guesses" INTEGER NOT NULL DEFAULT 0,
    "notify_daily" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "provider_username" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" INET,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "requester_id" UUID NOT NULL,
    "addressee_id" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("requester_id","addressee_id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon_url" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#7C3AED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranks" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "division" INTEGER,
    "order" INTEGER NOT NULL,
    "icon_url" TEXT,
    "color" TEXT NOT NULL DEFAULT '#A78BFA',

    CONSTRAINT "ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clips" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "rank_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "source" "ClipSource" NOT NULL DEFAULT 'ADMIN',
    "status" "ClipStatus" NOT NULL DEFAULT 'PROCESSING',
    "storage_key" TEXT NOT NULL,
    "hls_key" TEXT,
    "poster_key" TEXT,
    "duration_sec" DOUBLE PRECISION NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "proof_url" TEXT,
    "creator_consent" BOOLEAN NOT NULL DEFAULT false,
    "creator_handle" TEXT,
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "times_played" INTEGER NOT NULL DEFAULT 0,
    "avg_distance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_challenges" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "clip_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guesses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "guessed_rank_id" UUID NOT NULL,
    "mode" "GameMode" NOT NULL,
    "daily_challenge_id" UUID,
    "infinite_run_id" UUID,
    "distance" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "xp_gained" INTEGER NOT NULL,
    "watched_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infinite_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lives" INTEGER NOT NULL DEFAULT 3,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "score" INTEGER NOT NULL DEFAULT 0,
    "clips_played" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "infinite_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_game_stats" (
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "guesses" INTEGER NOT NULL DEFAULT 0,
    "exact" INTEGER NOT NULL DEFAULT 0,
    "total_distance" INTEGER NOT NULL DEFAULT 0,
    "total_score" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_game_stats_pkey" PRIMARY KEY ("user_id","game_id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon_url" TEXT,
    "category" "AchievementCategory" NOT NULL,
    "game_id" UUID,
    "criteria" JSONB NOT NULL,
    "xp_reward" INTEGER NOT NULL DEFAULT 0,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" UUID NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "period_key" TEXT NOT NULL,
    "country_code" CHAR(2),
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "clip_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolver_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" INET,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_country_code_idx" ON "users"("country_code");

-- CreateIndex
CREATE INDEX "users_xp_idx" ON "users"("xp" DESC);

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "friendships_addressee_id_status_idx" ON "friendships"("addressee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ranks_game_id_order_key" ON "ranks"("game_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ranks_game_id_name_key" ON "ranks"("game_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clips_storage_key_key" ON "clips"("storage_key");

-- CreateIndex
CREATE INDEX "clips_status_game_id_difficulty_idx" ON "clips"("status", "game_id", "difficulty");

-- CreateIndex
CREATE INDEX "clips_status_created_at_idx" ON "clips"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_challenges_date_key" ON "daily_challenges"("date");

-- CreateIndex
CREATE INDEX "guesses_user_id_created_at_idx" ON "guesses"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "guesses_clip_id_idx" ON "guesses"("clip_id");

-- CreateIndex
CREATE UNIQUE INDEX "guesses_user_id_daily_challenge_id_key" ON "guesses"("user_id", "daily_challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "guesses_user_id_clip_id_infinite_run_id_key" ON "guesses"("user_id", "clip_id", "infinite_run_id");

-- CreateIndex
CREATE INDEX "infinite_runs_user_id_score_idx" ON "infinite_runs"("user_id", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_period_period_key_country_code_positi_idx" ON "leaderboard_snapshots"("period", "period_key", "country_code", "position");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_snapshots_period_period_key_country_code_user_i_key" ON "leaderboard_snapshots"("period", "period_key", "country_code", "user_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reports_clip_id_reporter_id_key" ON "reports"("clip_id", "reporter_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_id_key" ON "subscriptions"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranks" ADD CONSTRAINT "ranks_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_rank_id_fkey" FOREIGN KEY ("rank_id") REFERENCES "ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_guessed_rank_id_fkey" FOREIGN KEY ("guessed_rank_id") REFERENCES "ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_daily_challenge_id_fkey" FOREIGN KEY ("daily_challenge_id") REFERENCES "daily_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_infinite_run_id_fkey" FOREIGN KEY ("infinite_run_id") REFERENCES "infinite_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infinite_runs" ADD CONSTRAINT "infinite_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_game_stats" ADD CONSTRAINT "user_game_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_game_stats" ADD CONSTRAINT "user_game_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolver_id_fkey" FOREIGN KEY ("resolver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
