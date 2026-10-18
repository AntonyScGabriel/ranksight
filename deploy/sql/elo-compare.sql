-- Répétition de la conversion des cotes : comparaison avant / après, sur la COPIE isolée seulement.
-- `rehearsal_before` contient les cotes et l'historique copiés avant la migration (deploy/elo-rehearsal.sh).
-- Rien n'est conservé (vues temporaires dans une transaction annulée) ; refuse de tourner sur une base sans
-- `rehearsal_before`, donc jamais sur la production. Échoue (code de sortie non nul) si la conversion ne donne pas
-- exactement le résultat attendu :
-- cote - 500 avec un plancher de 100, record idem, duels de carrière = duels, compteurs et lignes inchangés.
\set QUIET on
\pset footer off
BEGIN;
\set QUIET off
SELECT to_regnamespace('rehearsal_before') IS NOT NULL AS is_rehearsal \gset
\if :is_rehearsal
\else
  \echo 'Base sans copie rehearsal_before : ce script ne tourne que sur la copie de répétition.'
  ROLLBACK;
  \quit
\endif

\echo '== Lignes avant / après'
SELECT 'cotes' AS donnees, (SELECT count(*) FROM rehearsal_before.competitive_ratings) AS avant, (SELECT count(*) FROM competitive_ratings) AS apres
UNION ALL SELECT 'historique', (SELECT count(*) FROM rehearsal_before.rating_changes), (SELECT count(*) FROM rating_changes);

CREATE TEMP VIEW ecarts_cotes AS
SELECT coalesce(b.user_id, a.user_id) AS user_id, coalesce(b.scope, a.scope) AS scope,
       b.rating AS cote_avant, a.rating AS cote_apres, GREATEST(100, b.rating - 500) AS cote_attendue,
       b.peak AS record_avant, a.peak AS record_apres,
       CASE WHEN b.user_id IS NULL THEN 'ligne ajoutée'
            WHEN a.user_id IS NULL THEN 'ligne perdue'
            WHEN a.rating <> GREATEST(100, b.rating - 500) THEN 'cote'
            WHEN a.peak <> GREATEST(100, b.peak - 500) THEN 'record'
            WHEN a.career_games <> b.games THEN 'duels de carrière'
            WHEN (a.games, a.wins, a.losses, a.draws) <> (b.games, b.wins, b.losses, b.draws) THEN 'compteurs'
       END AS probleme
  FROM rehearsal_before.competitive_ratings b
  FULL JOIN competitive_ratings a ON a.user_id = b.user_id AND a.scope = b.scope;

CREATE TEMP VIEW ecarts_historique AS
SELECT coalesce(b.id, a.id) AS id,
       CASE WHEN b.id IS NULL THEN 'ligne ajoutée'
            WHEN a.id IS NULL THEN 'ligne perdue'
            WHEN a.before <> GREATEST(100, b.before - 500) OR a.after <> GREATEST(100, b.after - 500) THEN 'avant/après'
            WHEN a.delta <> a.after - a.before THEN 'écart'
            WHEN a.counted <> b.counted THEN 'compté'
            WHEN NOT a.counted AND a.reason IS DISTINCT FROM 'PAIR_LIMIT' THEN 'motif'
            WHEN a.counted AND a.reason IS NOT NULL THEN 'motif'
       END AS probleme
  FROM rehearsal_before.rating_changes b
  FULL JOIN rating_changes a ON a.id = b.id;

\echo ''
\echo '== Écarts par rapport au résultat attendu (doivent être vides)'
SELECT probleme, count(*) FROM ecarts_cotes WHERE probleme IS NOT NULL GROUP BY 1
UNION ALL SELECT 'historique : ' || probleme, count(*) FROM ecarts_historique WHERE probleme IS NOT NULL GROUP BY 1;
SELECT * FROM ecarts_cotes WHERE probleme IS NOT NULL LIMIT 20;

\echo ''
\echo '== Joueurs ramenés au plancher (cote d''avant sous 600)'
SELECT scope, count(*) AS joueurs, min(cote_avant) AS plus_basse_avant, max(cote_avant) AS plus_haute_avant
  FROM ecarts_cotes WHERE cote_avant < 600 GROUP BY scope ORDER BY scope;

\echo ''
\echo '== Rang conservé (ancienne échelle → nouvelle échelle)'
SELECT count(*) FILTER (WHERE ancien = nouveau) AS meme_rang, count(*) FILTER (WHERE ancien <> nouveau) AS rang_change
  FROM (SELECT CASE WHEN cote_avant >= 1500 THEN 1 WHEN cote_avant >= 1300 THEN 2 WHEN cote_avant >= 1150 THEN 3
                    WHEN cote_avant >= 1000 THEN 4 WHEN cote_avant >= 850 THEN 5 ELSE 6 END AS ancien,
               CASE WHEN cote_apres >= 1000 THEN 1 WHEN cote_apres >= 800 THEN 2 WHEN cote_apres >= 650 THEN 3
                    WHEN cote_apres >= 500 THEN 4 WHEN cote_apres >= 350 THEN 5 ELSE 6 END AS nouveau
          FROM ecarts_cotes WHERE probleme IS NULL) r;

DO $$
DECLARE n int;
BEGIN
  SELECT (SELECT count(*) FROM ecarts_cotes WHERE probleme IS NOT NULL) + (SELECT count(*) FROM ecarts_historique WHERE probleme IS NOT NULL) INTO n;
  IF n > 0 THEN RAISE EXCEPTION 'Répétition en échec : % écart(s) par rapport à la conversion attendue', n; END IF;
  RAISE NOTICE 'Répétition réussie : conversion conforme pour toutes les cotes et tout l''historique.';
END $$;

ROLLBACK;
