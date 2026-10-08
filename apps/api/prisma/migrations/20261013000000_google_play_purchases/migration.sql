-- AlterEnum
ALTER TYPE "PurchaseStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "order_id" TEXT,
ADD COLUMN     "refunded_at" TIMESTAMP(3);
