-- DropIndex
DROP INDEX "users_country_code_idx";

-- DropIndex
DROP INDEX "leaderboard_snapshots_period_period_key_country_code_positi_idx";

-- DropIndex
DROP INDEX "leaderboard_snapshots_period_period_key_country_code_user_i_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "country_code";

-- AlterTable
ALTER TABLE "friendships" ADD COLUMN     "responded_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "submitter_note" VARCHAR(300),
ALTER COLUMN "rejection_reason" SET DATA TYPE VARCHAR(300);

-- AlterTable
ALTER TABLE "leaderboard_snapshots" DROP COLUMN "country_code";

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" UUID NOT NULL,
    "conversation_key" VARCHAR(73) NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_messages_conversation_key_created_at_idx" ON "direct_messages"("conversation_key", "created_at" DESC);

-- CreateIndex
CREATE INDEX "direct_messages_recipient_id_read_at_idx" ON "direct_messages"("recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "friendships_requester_id_status_idx" ON "friendships"("requester_id", "status");

-- CreateIndex
CREATE INDEX "clips_uploader_id_created_at_idx" ON "clips"("uploader_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_period_period_key_position_idx" ON "leaderboard_snapshots"("period", "period_key", "position");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_snapshots_period_period_key_user_id_key" ON "leaderboard_snapshots"("period", "period_key", "user_id");

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
