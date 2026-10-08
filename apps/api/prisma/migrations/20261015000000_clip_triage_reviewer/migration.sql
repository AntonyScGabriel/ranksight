-- CreateEnum
CREATE TYPE "TriageDecision" AS ENUM ('APPROVE', 'REJECT');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'REVIEWER';

-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "triage_decision" "TriageDecision",
ADD COLUMN     "triage_note" VARCHAR(300),
ADD COLUMN     "triaged_at" TIMESTAMP(3),
ADD COLUMN     "triaged_by_id" UUID;

-- CreateIndex
CREATE INDEX "clips_triaged_by_id_idx" ON "clips"("triaged_by_id");

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_triaged_by_id_fkey" FOREIGN KEY ("triaged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
