-- CreateEnum
CREATE TYPE "SuggestionCategory" AS ENUM ('FEATURE', 'GAMEPLAY', 'CONTENT', 'INTERFACE', 'OTHER');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'PLANNED', 'DONE', 'DECLINED');

-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "SuggestionCategory" NOT NULL DEFAULT 'FEATURE',
    "text" VARCHAR(1000) NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "reply" VARCHAR(500),
    "replied_by_id" UUID,
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_status_created_at_idx" ON "suggestions"("status", "created_at");

-- CreateIndex
CREATE INDEX "suggestions_user_id_created_at_idx" ON "suggestions"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_replied_by_id_fkey" FOREIGN KEY ("replied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
