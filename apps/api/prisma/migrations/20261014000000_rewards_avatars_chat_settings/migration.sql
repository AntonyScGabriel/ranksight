-- CreateEnum
CREATE TYPE "CosmeticType" AS ENUM ('TITLE', 'BADGE', 'FRAME');

-- CreateEnum
CREATE TYPE "CosmeticSource" AS ENUM ('MANUAL', 'LEVEL', 'ACHIEVEMENT', 'SEASON');

-- AlterEnum
ALTER TYPE "ChatReportReason" ADD VALUE 'INAPPROPRIATE_AVATAR';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_key" TEXT,
ADD COLUMN     "badge_id" UUID,
ADD COLUMN     "frame_id" UUID,
ADD COLUMN     "title_id" UUID;

-- AlterTable
ALTER TABLE "global_messages" ADD COLUMN     "auto_hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "cosmetics" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" "CosmeticType" NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "color" VARCHAR(7) NOT NULL,
    "color2" VARCHAR(7),
    "icon" VARCHAR(24),
    "unlock_level" INTEGER,
    "unlock_achievement_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "user_id" UUID NOT NULL,
    "cosmetic_id" UUID NOT NULL,
    "source" "CosmeticSource" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_id" UUID,
    "note" VARCHAR(200),
    "seen_at" TIMESTAMP(3),

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("user_id","cosmetic_id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "cosmetics_key_key" ON "cosmetics"("key");

-- CreateIndex
CREATE INDEX "cosmetics_unlock_level_idx" ON "cosmetics"("unlock_level");

-- CreateIndex
CREATE INDEX "user_cosmetics_cosmetic_id_idx" ON "user_cosmetics"("cosmetic_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_frame_id_fkey" FOREIGN KEY ("frame_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_unlock_achievement_id_fkey" FOREIGN KEY ("unlock_achievement_id") REFERENCES "achievements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmetic_id_fkey" FOREIGN KEY ("cosmetic_id") REFERENCES "cosmetics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
