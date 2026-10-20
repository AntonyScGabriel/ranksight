-- Etat des migrations des PR #30 et #32 dans une base : STRICTEMENT EN LECTURE SEULE.
-- Transaction READ ONLY (et, lance par deploy/README.md, PGOPTIONS default_transaction_read_only=on) : toute
-- ecriture est refusee par PostgreSQL. Une ligne par controle, au format cle|valeur. Texte ASCII (envoi par ssh).
\set QUIET on
BEGIN TRANSACTION READ ONLY;
\set QUIET off
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_history \gset
SELECT 'lecture_seule', current_setting('transaction_read_only');
\if :has_history
SELECT 'migration_pr30', coalesce((
  SELECT CASE WHEN rolled_back_at IS NOT NULL THEN 'annulee' WHEN finished_at IS NULL THEN 'echouee' ELSE 'appliquee' END
    FROM _prisma_migrations WHERE migration_name = '20261031000000_ranked_seasons_public_rooms'
   ORDER BY started_at DESC LIMIT 1), 'absente');
SELECT 'empreinte_pr30', coalesce((SELECT checksum FROM _prisma_migrations
   WHERE migration_name = '20261031000000_ranked_seasons_public_rooms' ORDER BY started_at DESC LIMIT 1), '-');
SELECT 'migration_pr32', coalesce((
  SELECT CASE WHEN rolled_back_at IS NOT NULL THEN 'annulee' WHEN finished_at IS NULL THEN 'echouee' ELSE 'appliquee' END
    FROM _prisma_migrations WHERE migration_name = '20261101000000_room_system_slots'
   ORDER BY started_at DESC LIMIT 1), 'absente');
SELECT 'empreinte_pr32', coalesce((SELECT checksum FROM _prisma_migrations
   WHERE migration_name = '20261101000000_room_system_slots' ORDER BY started_at DESC LIMIT 1), '-');
SELECT 'migrations_en_echec', count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT 'derniere_migration', max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
\else
SELECT 'migration_pr30', 'pas_d_historique_prisma';
\endif
-- Traces dans le schema, independantes de l'historique
SELECT 'schema_archive', CASE WHEN to_regnamespace('archive') IS NULL THEN 'absent' ELSE 'present' END;
SELECT 'colonne_career_games', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'competitive_ratings' AND column_name = 'career_games') THEN 'presente' ELSE 'absente' END;
SELECT 'colonne_rooms_visibility', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'visibility') THEN 'presente' ELSE 'absente' END;
SELECT 'colonne_rooms_system_slot', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'system_slot') THEN 'presente' ELSE 'absente' END;
\set QUIET on
ROLLBACK;
