-- Boutique VIP : historique des achats (paiements Stripe et VIP offert par l'équipe).

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "SubscriptionProvider" ADD VALUE 'MANUAL';

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "provider" "SubscriptionProvider" NOT NULL,
    "external_id" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "granted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_external_id_key" ON "purchases"("external_id");

-- CreateIndex
CREATE INDEX "purchases_user_id_created_at_idx" ON "purchases"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
