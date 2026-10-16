-- Jetons virtuels et mode Confiance.
-- Compatibilité : chaque compte existant reçoit le solde de départ (20 jetons), inscrit au journal des mouvements.
-- CreateEnum
CREATE TYPE "TokenReason" AS ENUM ('WELCOME', 'DAILY_REFILL', 'STAKE', 'PAYOUT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "token_balance" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "confidence" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "token_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" "TokenReason" NOT NULL,
    "room_id" UUID,
    "round" INTEGER,
    "key" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_stakes" (
    "room_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "stake" INTEGER NOT NULL,
    "payout" INTEGER,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_stakes_pkey" PRIMARY KEY ("room_id","round","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_transactions_key_key" ON "token_transactions"("key");

-- CreateIndex
CREATE INDEX "token_transactions_user_id_created_at_idx" ON "token_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "room_stakes_room_id_round_settled_at_idx" ON "room_stakes"("room_id", "round", "settled_at");

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stakes" ADD CONSTRAINT "room_stakes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_stakes" ADD CONSTRAINT "room_stakes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Garde-fous : le solde ne devient jamais négatif, une mise vaut 0 à 3 jetons
ALTER TABLE "users" ADD CONSTRAINT "users_token_balance_check" CHECK ("token_balance" >= 0);
ALTER TABLE "room_stakes" ADD CONSTRAINT "room_stakes_stake_check" CHECK ("stake" BETWEEN 1 AND 3);
ALTER TABLE "room_stakes" ADD CONSTRAINT "room_stakes_payout_check" CHECK ("payout" IS NULL OR "payout" >= 0);
ALTER TABLE "token_transactions" ADD CONSTRAINT "token_transactions_balance_check" CHECK ("balance_after" >= 0);

-- Solde de départ des comptes existants : inscrit au journal
INSERT INTO "token_transactions" ("id", "user_id", "delta", "balance_after", "reason", "key", "created_at")
SELECT gen_random_uuid(), "id", "token_balance", "token_balance", 'WELCOME', 'welcome:' || "id", (now() AT TIME ZONE 'UTC') FROM "users";

-- Nouveaux comptes : solde de départ inscrit au journal dès la création (dates en UTC, comme celles écrites par l'API)
CREATE FUNCTION "token_welcome"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "token_transactions" ("id", "user_id", "delta", "balance_after", "reason", "key", "created_at")
  VALUES (gen_random_uuid(), NEW."id", NEW."token_balance", NEW."token_balance", 'WELCOME', 'welcome:' || NEW."id", (now() AT TIME ZONE 'UTC'));
  RETURN NEW;
END $$;
CREATE TRIGGER "token_welcome" AFTER INSERT ON "users" FOR EACH ROW EXECUTE FUNCTION "token_welcome"();
