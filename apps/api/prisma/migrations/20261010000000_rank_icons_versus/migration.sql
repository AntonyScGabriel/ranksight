-- Images des rangs (administration) et mode Duel.

-- CreateEnum
CREATE TYPE "VersusStatus" AS ENUM ('OPEN', 'PENDING', 'ACTIVE', 'FINISHED', 'DECLINED', 'EXPIRED', 'CANCELED');

-- AlterEnum
ALTER TYPE "GameMode" ADD VALUE 'VERSUS';

-- AlterEnum
ALTER TYPE "AchievementCategory" ADD VALUE 'VERSUS';

-- AlterTable
ALTER TABLE "guesses" ADD COLUMN     "versus_match_id" UUID;

-- CreateTable
CREATE TABLE "rank_icons" (
    "rank_id" UUID NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rank_icons_pkey" PRIMARY KEY ("rank_id")
);

-- CreateTable
CREATE TABLE "versus_matches" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "opponent_id" UUID,
    "game_id" UUID,
    "random" BOOLEAN NOT NULL DEFAULT false,
    "status" "VersusStatus" NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 5,
    "creator_score" INTEGER NOT NULL DEFAULT 0,
    "opponent_score" INTEGER NOT NULL DEFAULT 0,
    "creator_finished_at" TIMESTAMP(3),
    "opponent_finished_at" TIMESTAMP(3),
    "winner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "versus_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versus_clips" (
    "match_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "clip_id" UUID NOT NULL,

    CONSTRAINT "versus_clips_pkey" PRIMARY KEY ("match_id","position")
);

-- CreateIndex
CREATE INDEX "versus_matches_status_game_id_created_at_idx" ON "versus_matches"("status", "game_id", "created_at");

-- CreateIndex
CREATE INDEX "versus_matches_creator_id_created_at_idx" ON "versus_matches"("creator_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "versus_matches_opponent_id_created_at_idx" ON "versus_matches"("opponent_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "versus_matches_status_expires_at_idx" ON "versus_matches"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "versus_clips_match_id_clip_id_key" ON "versus_clips"("match_id", "clip_id");

-- CreateIndex
CREATE UNIQUE INDEX "guesses_user_id_versus_match_id_clip_id_key" ON "guesses"("user_id", "versus_match_id", "clip_id");

-- AddForeignKey
ALTER TABLE "rank_icons" ADD CONSTRAINT "rank_icons_rank_id_fkey" FOREIGN KEY ("rank_id") REFERENCES "ranks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_versus_match_id_fkey" FOREIGN KEY ("versus_match_id") REFERENCES "versus_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_matches" ADD CONSTRAINT "versus_matches_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_matches" ADD CONSTRAINT "versus_matches_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_matches" ADD CONSTRAINT "versus_matches_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_matches" ADD CONSTRAINT "versus_matches_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_clips" ADD CONSTRAINT "versus_clips_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "versus_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versus_clips" ADD CONSTRAINT "versus_clips_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
