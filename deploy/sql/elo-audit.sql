-- Audit des cotes compétitives (Elo) : STRICTEMENT EN LECTURE SEULE.
-- Toute la lecture se fait dans une transaction READ ONLY annulée à la fin : PostgreSQL refuse toute écriture.
-- Fonctionne avant la conversion (échelle de départ 1000, migration 20261030) et après (échelle 500, migration
-- 20261031 : cote - 500, plancher 100). Sur le serveur :
--   docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
--     psql -X -v ON_ERROR_STOP=1 -U rankguess -d rankguess -f - < sql/elo-audit.sql
\set QUIET on
\pset footer off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
\set QUIET off

\echo '== 1. Migrations du classement appliquées'
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_history \gset
\if :has_history
SELECT migration_name, finished_at IS NOT NULL AS terminee, rolled_back_at IS NOT NULL AS annulee
  FROM _prisma_migrations WHERE migration_name >= '20261030' ORDER BY migration_name;
\else
\echo '(pas de table _prisma_migrations : base créée sans Prisma)'
\endif

SELECT to_regclass('public.competitive_ratings') IS NOT NULL AS has_ratings,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'competitive_ratings' AND column_name = 'career_games') AS converted
\gset
\if :has_ratings
\else
  \echo 'Table competitive_ratings absente : classement compétitif pas encore installé, rien à auditer.'
  ROLLBACK;
  \quit
\endif
\if :converted
  \echo 'État : conversion déjà faite (échelle 500, plancher 100).'
\else
  \echo 'État : avant conversion (échelle 1000). La migration 20261031 appliquera : cote - 500, plancher 100.'
\endif

\echo ''
\echo '== 2. Vue d''ensemble par classement (scope)'
SELECT scope, count(*) AS joueurs, min(rating) AS cote_min, round(avg(rating)) AS cote_moy, max(rating) AS cote_max,
       max(peak) AS record_max, sum(games) AS duels,
       count(*) FILTER (WHERE rating IS NULL OR peak IS NULL OR games IS NULL) AS valeurs_nulles
  FROM competitive_ratings GROUP BY scope ORDER BY scope;

\echo ''
\if :converted
\echo '== 3. Cotes au plancher (100) : joueurs dont la cote d''avant était peut-être sous 600'
SELECT scope, count(*) AS au_plancher, count(*) FILTER (WHERE peak = 100) AS record_au_plancher
  FROM competitive_ratings WHERE rating = 100 GROUP BY scope ORDER BY scope;
\else
\echo '== 3. Cotes sous 600 : ramenées au plancher 100 par la conversion (écart exact perdu, rang Bronze conservé)'
SELECT scope, count(*) AS sous_600, min(rating) AS plus_basse, count(*) FILTER (WHERE peak < 600) AS record_sous_600
  FROM competitive_ratings WHERE rating < 600 OR peak < 600 GROUP BY scope ORDER BY scope;
\echo 'Détail (50 premiers) :'
SELECT c.scope, c.user_id, u.display_name, c.rating, c.peak, c.games,
       GREATEST(100, c.rating - 500) AS cote_apres, c.rating - 500 - GREATEST(100, c.rating - 500) AS points_perdus
  FROM competitive_ratings c JOIN users u ON u.id = c.user_id
 WHERE c.rating < 600 OR c.peak < 600 ORDER BY c.rating, c.scope LIMIT 50;
\endif

\echo ''
\echo '== 4. Anomalies (toutes doivent être à 0)'
SELECT 'record inférieur à la cote' AS controle, count(*) AS lignes FROM competitive_ratings WHERE peak < rating
UNION ALL SELECT 'cote sous 100', count(*) FROM competitive_ratings WHERE rating < 100
UNION ALL SELECT 'victoires + défaites + nuls <> duels', count(*) FROM competitive_ratings WHERE wins + losses + draws <> games
UNION ALL SELECT 'valeurs négatives', count(*) FROM competitive_ratings WHERE games < 0 OR wins < 0 OR losses < 0 OR draws < 0
UNION ALL SELECT 'cote d''un compte supprimé (users absent)', count(*) FROM competitive_ratings c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
UNION ALL SELECT 'historique : après <> avant + écart', count(*) FROM rating_changes WHERE after <> before + delta
UNION ALL SELECT 'historique sans cote correspondante', count(*) FROM rating_changes r
  WHERE NOT EXISTS (SELECT 1 FROM competitive_ratings c WHERE c.user_id = r.user_id AND c.scope = r.scope)
UNION ALL SELECT 'historique : résultat inconnu', count(*) FROM rating_changes WHERE result NOT IN ('WIN', 'LOSS', 'DRAW');

\echo 'Information (pas forcément une anomalie : une fin de saison ramène les cotes sans ligne d''historique) :'
SELECT 'cote différente du dernier « après » de l''historique' AS controle, count(*) AS lignes FROM competitive_ratings c
  JOIN LATERAL (SELECT after FROM rating_changes r WHERE r.user_id = c.user_id AND r.scope = c.scope AND r.counted
                ORDER BY r.created_at DESC, r.id DESC LIMIT 1) last ON true WHERE last.after <> c.rating;

\echo ''
\if :converted
\echo '== 5. Historique : écarts recalculés par le plancher (avant ou après à 100)'
SELECT count(*) AS lignes_au_plancher, count(*) FILTER (WHERE NOT counted) AS non_comptees,
       count(*) FILTER (WHERE reason IS NULL AND NOT counted) AS sans_motif
  FROM rating_changes WHERE before = 100 OR after = 100;
\else
\echo '== 5. Historique : lignes dont l''écart sera recalculé (avant ou après sous 600)'
SELECT count(*) AS lignes, count(*) FILTER (WHERE delta <> GREATEST(100, after - 500) - GREATEST(100, before - 500)) AS ecart_modifie,
       count(*) FILTER (WHERE NOT counted) AS non_comptees_motif_PAIR_LIMIT
  FROM rating_changes WHERE before < 600 OR after < 600;
SELECT count(*) AS duels_non_comptes_total FROM rating_changes WHERE NOT counted;
\endif

\echo ''
\echo '== 6. Répartition par rang (nouvelle échelle ; avant conversion : cote - 500, plancher 100)'
SELECT scope,
       CASE WHEN r >= 1000 THEN '1 Maître' WHEN r >= 800 THEN '2 Diamant' WHEN r >= 650 THEN '3 Platine'
            WHEN r >= 500 THEN '4 Or' WHEN r >= 350 THEN '5 Argent' ELSE '6 Bronze' END AS rang,
       count(*) AS joueurs
  FROM (SELECT scope, CASE WHEN :'converted'::boolean THEN rating ELSE GREATEST(100, rating - 500) END AS r FROM competitive_ratings) x
 GROUP BY 1, 2 ORDER BY 1, 2;

ROLLBACK;
