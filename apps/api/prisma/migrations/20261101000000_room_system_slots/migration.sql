-- Salons : création réservée aux VIP, salons publics par défaut entretenus par le serveur, revanche retirée.
-- Aucune donnée de partie n'est effacée : les salons existants, leurs joueurs, réponses et résultats restent en place.

-- 1. Créateur et hôte facultatifs : un salon par défaut n'a pas de créateur, et reste sans hôte tant qu'il est vide.
--    La suppression d'un compte ne supprime plus les salons qu'il a créés ou qu'il anime (historique des autres joueurs conservé).
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_created_by_id_fkey";
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_host_id_fkey";
ALTER TABLE "rooms" ALTER COLUMN "created_by_id" DROP NOT NULL,
ALTER COLUMN "host_id" DROP NOT NULL;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Salons par défaut
ALTER TABLE "rooms" ADD COLUMN "system_slot" VARCHAR(32);
CREATE INDEX "rooms_system_slot_created_at_idx" ON "rooms"("system_slot", "created_at");
-- Un seul salon par défaut en salle d'attente par emplacement : garanti par la base, même avec des demandes simultanées
-- ou plusieurs instances de l'API (index partiel, non exprimable dans schema.prisma)
CREATE UNIQUE INDEX "rooms_system_slot_lobby_key" ON "rooms"("system_slot") WHERE "status" = 'LOBBY' AND "system_slot" IS NOT NULL;

-- 3. Revanche retirée (colonne ajoutée par la migration précédente de la même version, jamais déployée)
ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "rooms_rematch_check";
ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "rooms_rematch_of_id_fkey";
DROP INDEX IF EXISTS "rooms_rematch_of_id_key";
ALTER TABLE "rooms" DROP COLUMN IF EXISTS "rematch_of_id";
