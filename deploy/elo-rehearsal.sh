#!/bin/sh
# Répétition de la conversion des cotes (migration 20261031) sur une COPIE ISOLÉE d'une sauvegarde : jamais sur la
# base en service. Un PostgreSQL jetable est lancé à part (conteneur sans réseau, données en mémoire, supprimé à la
# fin) ; la sauvegarde y est restaurée, les cotes sont copiées, les migrations du dépôt sont appliquées par l'image
# de l'API construite depuis ce dépôt, puis avant et après sont comparés.
#
#   cd deploy
#   sh elo-rehearsal.sh backups/rankguess-AAAA-MM-JJ_HHMM.dump
#
# Rapports : deploy/rehearsal/<date>/ (avant.txt, apres.txt, comparaison.txt, migrations.txt) ; ils contiennent des
# pseudos de joueurs : à garder sur le serveur (dossier ignoré par git).
# Variables : API_IMAGE (image déjà construite à utiliser), REHEARSAL_OUT (dossier des rapports), REHEARSAL_PG_EXEC + REHEARSAL_DB + MIGRATE_CMD (tests :
# base et outils locaux à la place du conteneur jetable).
set -eu
cd "$(dirname "$0")"
dump=${1:-}
[ -f "$dump" ] || { echo "Usage : sh elo-rehearsal.sh backups/rankguess-....dump"; exit 1; }
STAMP=$(date -u +%Y%m%d_%H%M%S)
out=${REHEARSAL_OUT:-rehearsal/$STAMP}
mkdir -p "$out"
container=""
cleanup() { [ -z "$container" ] || docker stop "$container" > /dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -n "${REHEARSAL_PG_EXEC+set}" ]; then
  # Mode test : base vide fournie, outils indiqués (jamais la base du serveur)
  PG_EXEC=$REHEARSAL_PG_EXEC
  DB=${REHEARSAL_DB:?REHEARSAL_DB requis}
  case "$DB" in rankguess | rankguess_*) echo "Refusé : $DB n'est pas une base de répétition"; exit 1 ;; esac
  DBUSER=${REHEARSAL_PGUSER:-${PGUSER:-ranksight}}
  [ -n "${MIGRATE_CMD:-}" ] || { echo "MIGRATE_CMD requis en mode test"; exit 1; }
else
  command -v docker > /dev/null || { echo "Docker est nécessaire"; exit 1; }
  DB=rehearsal
  DBUSER=rankguess
  password=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
  container=rankguess-elo-rehearsal-$(date -u +%Y%m%d%H%M%S)
  # Sans réseau (--network none), données en mémoire (--tmpfs), supprimé à l'arrêt (--rm)
  docker run -d --rm --name "$container" --network none --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER="$DBUSER" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$DB" postgres:17-alpine > /dev/null
  for _ in $(seq 1 60); do docker exec "$container" pg_isready -U "$DBUSER" -d "$DB" > /dev/null 2>&1 && break; sleep 1; done
  sleep 2 # premier démarrage : redémarrage interne de l'image officielle après l'initialisation
  for _ in $(seq 1 30); do docker exec "$container" pg_isready -U "$DBUSER" -d "$DB" > /dev/null 2>&1 && break; sleep 1; done
  PG_EXEC="docker exec -i $container"
  if [ -z "${API_IMAGE:-}" ]; then
    API_IMAGE=rankguess-api:rehearsal
    echo "Construction de l'image de l'API depuis ce dépôt ($API_IMAGE ; l'image en service n'est pas touchée)…"
    docker build -q -f ../apps/api/Dockerfile -t "$API_IMAGE" .. > /dev/null
  fi
  # Même espace réseau que le PostgreSQL jetable (localhost), toujours sans accès extérieur
  MIGRATE_CMD="docker run --rm --network container:$container -e DATABASE_URL=postgresql://$DBUSER:$password@localhost:5432/$DB $API_IMAGE npx prisma migrate deploy"
fi

pg() { $PG_EXEC "$@"; }
q() { pg psql -X -v ON_ERROR_STOP=1 -U "$DBUSER" -d "$DB" "$@"; }

if [ -f "$dump.sha256" ]; then
  [ "$(cut -d' ' -f1 < "$dump.sha256")" = "$(sha256sum < "$dump" | cut -d' ' -f1)" ] || { echo "Empreinte différente : sauvegarde abîmée"; exit 1; }
fi
echo "Restauration de $dump dans la copie isolée…"
pg pg_restore -U "$DBUSER" -d "$DB" --no-owner --no-privileges --exit-on-error --single-transaction < "$dump"

echo "Audit avant migration → $out/avant.txt"
q -f - < sql/elo-audit.sql > "$out/avant.txt"
if [ "$(q -At -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competitive_ratings' AND column_name = 'career_games')")" = "t" ]; then
  echo "Cette sauvegarde est déjà convertie (migration 20261031 appliquée) : rien à répéter. Voir $out/avant.txt"
  exit 0
fi
q -q -c "CREATE SCHEMA rehearsal_before;
  CREATE TABLE rehearsal_before.competitive_ratings AS SELECT * FROM competitive_ratings;
  CREATE TABLE rehearsal_before.rating_changes AS SELECT * FROM rating_changes;"

echo "Migrations du dépôt sur la copie → $out/migrations.txt"
eval "$MIGRATE_CMD" > "$out/migrations.txt" 2>&1 || { tail -20 "$out/migrations.txt"; echo "Migration en échec sur la copie : NE PAS déployer."; exit 1; }

echo "Audit après migration → $out/apres.txt"
q -f - < sql/elo-audit.sql > "$out/apres.txt"
echo "Comparaison → $out/comparaison.txt"
if q -f - < sql/elo-compare.sql > "$out/comparaison.txt" 2>&1; then
  grep -h "Répétition réussie" "$out/comparaison.txt" || true
  sed -n '/Joueurs ramenés au plancher/,/^$/p' "$out/comparaison.txt"
  if [ -n "$container" ]; then echo "Répétition terminée : copie supprimée à l'arrêt du conteneur, rapports dans $out"; else echo "Répétition terminée (mode test : base $DB conservée), rapports dans $out"; fi
else
  tail -20 "$out/comparaison.txt"
  echo "Répétition en ÉCHEC : voir $out/comparaison.txt. NE PAS déployer."
  exit 1
fi
