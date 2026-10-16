-- Classement compétitif : uniquement des ajouts (aucune cote n'est créée pour les comptes existants : elle apparaît au premier duel au hasard).
-- CreateTable
CREATE TABLE "competitive_ratings" (
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "peak" INTEGER NOT NULL DEFAULT 1000,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitive_ratings_pkey" PRIMARY KEY ("user_id","scope")
);

-- CreateTable
CREATE TABLE "rating_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "match_id" UUID NOT NULL,
    "opponent_id" UUID NOT NULL,
    "result" VARCHAR(4) NOT NULL,
    "before" INTEGER NOT NULL,
    "after" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitive_ratings_scope_rating_idx" ON "competitive_ratings"("scope", "rating" DESC);

-- CreateIndex
CREATE INDEX "rating_changes_user_id_created_at_idx" ON "rating_changes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rating_changes_user_id_opponent_id_created_at_idx" ON "rating_changes"("user_id", "opponent_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rating_changes_user_id_scope_match_id_key" ON "rating_changes"("user_id", "scope", "match_id");

-- AddForeignKey
ALTER TABLE "competitive_ratings" ADD CONSTRAINT "competitive_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Garde-fous
ALTER TABLE "competitive_ratings" ADD CONSTRAINT "competitive_ratings_rating_check" CHECK ("rating" >= 100);
ALTER TABLE "competitive_ratings" ADD CONSTRAINT "competitive_ratings_counts_check" CHECK ("games" >= 0 AND "wins" >= 0 AND "losses" >= 0 AND "draws" >= 0 AND "wins" + "losses" + "draws" = "games");
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_result_check" CHECK ("result" IN ('WIN', 'LOSS', 'DRAW'));
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_delta_check" CHECK ("after" = "before" + "delta");
