-- CreateEnum
CREATE TYPE "GiftType" AS ENUM ('FRIEND', 'CODE');

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "gift_type" "GiftType",
ADD COLUMN     "recipient_id" UUID;

-- CreateTable
CREATE TABLE "gift_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_enc" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "purchase_id" UUID,
    "created_by_id" UUID,
    "note" VARCHAR(200),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_redemptions" (
    "code_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_redemptions_pkey" PRIMARY KEY ("code_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_codes_code_hash_key" ON "gift_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gift_codes_purchase_id_key" ON "gift_codes"("purchase_id");

-- CreateIndex
CREATE INDEX "gift_redemptions_user_id_idx" ON "gift_redemptions"("user_id");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_codes" ADD CONSTRAINT "gift_codes_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_codes" ADD CONSTRAINT "gift_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "gift_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
