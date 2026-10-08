-- Sécurité (2FA, CGU, confirmation d'email), modération des joueurs (blocages, signalements, chat coupé), stockage (compression, nettoyage)

-- CreateEnum
CREATE TYPE "ChatReportReason" AS ENUM ('HARASSMENT', 'HATE', 'SPAM', 'CHEATING', 'INAPPROPRIATE_NAME', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "chat_muted_until" TIMESTAMP(3),
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT,
ADD COLUMN     "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_recovery" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totp_secret" TEXT;

-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "file_deleted_at" TIMESTAMP(3),
ADD COLUMN     "original_size_bytes" INTEGER,
ADD COLUMN     "processed_at" TIMESTAMP(3),
ADD COLUMN     "size_bytes" INTEGER;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "withdrawal_waived_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "chat_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "global_message_id" UUID,
    "direct_message_id" UUID,
    "reason" "ChatReportReason" NOT NULL,
    "details" VARCHAR(500),
    "excerpt" VARCHAR(1000),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolver_id" UUID,
    "resolution" VARCHAR(300),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE INDEX "chat_reports_status_created_at_idx" ON "chat_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "chat_reports_target_user_id_idx" ON "chat_reports"("target_user_id");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_resolver_id_fkey" FOREIGN KEY ("resolver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_global_message_id_fkey" FOREIGN KEY ("global_message_id") REFERENCES "global_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_direct_message_id_fkey" FOREIGN KEY ("direct_message_id") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

