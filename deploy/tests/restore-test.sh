#!/bin/sh
# Test de deploy/restore.sh sur des bases jetables (jamais sur le serveur) : sauvegarde d'une base source, restauration
# dans une nouvelle base, contenu identique, base source intacte, refus d'écraser, sauvegarde abîmée sans effet sur la
# base en service, bascule et retour arrière (confirmation, échecs de renommage sans effet sur la base en service),
# puis démarrage de l'API sur la base restaurée (/health et lecture). La sauvegarde est faite par deploy/backup.sh.
#
#   SOURCE_DB=ranksight_test PGHOST=localhost PGUSER=ranksight PGPASSWORD=ranksight sh deploy/tests/restore-test.sh
#
# Variables : PG_EXEC (outils PostgreSQL ; vide = locaux, ex. « docker exec -i <conteneur> » en CI), SOURCE_DB,
# API_PORT (4100), RESTORE_TEST_MIGRATE=1 pour lancer aussi `prisma migrate deploy` sur la base restaurée,
# BACKUP_TEST_PGHOST (hôte ou socket vu par pg_dump à travers PG_EXEC ; CI : /var/run/postgresql).
# Ne crée et ne supprime que des bases nommées restoretest_<horodatage>_*.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
PG_EXEC=${PG_EXEC-}
SOURCE=${SOURCE_DB:-ranksight_test}
USER_=${PGUSER:-ranksight}
PORT=${API_PORT:-4100}
RUN=restoretest_$(date -u +%Y%m%d%H%M%S)
work=$(mktemp -d)
api_pid=""

case "${PGHOST:-localhost}" in localhost | 127.0.0.1 | /*) ;; *) [ "${CI:-}" = "true" ] || { echo "Refusé : serveur PostgreSQL distant (${PGHOST})"; exit 1; } ;; esac
case "$SOURCE" in rankguess | rankguess_*) echo "Refusé : base du serveur ($SOURCE)"; exit 1 ;; esac

pg() { $PG_EXEC "$@"; }
q() { _q_db=$1; shift; pg psql -X -q -v ON_ERROR_STOP=1 -U "$USER_" -d "$_q_db" -At "$@"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $*"; }
fail() { echo "not ok - $*" >&2; exit 1; }
# Empreinte d'une base : nombre de lignes de chaque table publique, et identifiants des joueurs et des clips
fingerprint() {
  for t in $(q "$1" -c "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('public', 'archive') ORDER BY 1"); do
    printf '%s=%s\n' "$t" "$(q "$1" -c "SELECT count(*) FROM $t")"
  done
  q "$1" -c "SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM users"
  q "$1" -c "SELECT md5(coalesce(string_agg(id::text || status::text, ',' ORDER BY id), '')) FROM clips"
}
cleanup() {
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  for db in $(q postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '${RUN}%'"); do
    q postgres -c "DROP DATABASE IF EXISTS \"$db\"" || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

restore() { PG_EXEC="$PG_EXEC" RESTORE_PGUSER="$USER_" RESTORE_YES=1 RESTORE_STOP="" RESTORE_START="" sh "$root/deploy/restore.sh" "$@"; }

# 0. Sauvegarde par deploy/backup.sh (même script que le service « backup » du serveur), avec son empreinte
mkdir -p "$work/backups"
BACKUP_ONCE=1 BACKUP_DIR="$work/backups" BACKUP_PGHOST="${BACKUP_TEST_PGHOST:-${PGHOST:-localhost}}" BACKUP_PGUSER="$USER_" \
  BACKUP_PGDATABASE="$SOURCE" BACKUP_PG_DUMP="${PG_EXEC:+$PG_EXEC }pg_dump" sh "$root/deploy/backup.sh" > "$work/backup.log" 2>&1 || { cat "$work/backup.log"; fail "backup.sh"; }
dump=$(ls "$work"/backups/rankguess-*.dump)
[ -s "$dump" ] && [ -f "$dump.sha256" ] || fail "sauvegarde ou empreinte absente"
(cd "$work/backups" && sha256sum -c "$(basename "$dump").sha256" > /dev/null) || fail "empreinte écrite par backup.sh invalide"
cp "$dump" "$work/source.dump"
before=$(fingerprint "$SOURCE")
ok "backup.sh : sauvegarde au format personnalisé et empreinte SHA-256 valide ($(basename "$dump"))"

# 1. Restauration dans une nouvelle base, vérifiée
RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_a" restore "$work/source.dump" > "$work/a.log" 2>&1 || { cat "$work/a.log"; fail "restauration"; }
grep -q "Restauration vérifiée" "$work/a.log" || { cat "$work/a.log"; fail "vérification après restauration"; }
ok "restauration dans une nouvelle base, vérification réussie"
[ "$(fingerprint "${RUN}_a")" = "$before" ] || fail "contenu restauré différent de la source"
ok "contenu identique : lignes de chaque table, joueurs et clips"
[ "$(fingerprint "$SOURCE")" = "$before" ] || fail "la base source a changé"
ok "base source intacte"
expected=$(grep -v '^#' "$root/apps/api/prisma/sql-only-objects.txt" | sed '/^$/d' | LC_ALL=C sort)
actual=$(q "${RUN}_a" -f - < "$root/apps/api/prisma/sql-only-objects.sql" | LC_ALL=C sort)
[ "$actual" = "$expected" ] || { printf 'attendu:\n%s\nobtenu:\n%s\n' "$expected" "$actual"; fail "objets SQL hors Prisma (index partiel, CHECK, déclencheur, archive)"; }
ok "index partiel, contraintes, déclencheur et schéma archive restaurés"

# 2. Jamais d'écrasement : une base existante n'est pas touchée
q "${RUN}_a" -c "CREATE TABLE restore_marker (x int); INSERT INTO restore_marker VALUES (42)"
if RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_a" restore "$work/source.dump" > "$work/b.log" 2>&1; then fail "écrasement accepté"; fi
grep -q "existe déjà" "$work/b.log" || { cat "$work/b.log"; fail "message"; }
[ "$(q "${RUN}_a" -c "SELECT x FROM restore_marker")" = "42" ] || fail "base existante modifiée"
if RESTORE_LIVE_DB="${RUN}_a" RESTORE_TARGET="${RUN}_a" restore "$work/source.dump" > /dev/null 2>&1; then fail "restauration sur la base en service"; fi
ok "base existante ou en service jamais écrasée"

# 3. Sauvegarde abîmée : refusée avant toute création de base, base source intacte
(cd "$work" && sha256sum source.dump > source.dump.sha256)
cp "$work/source.dump" "$work/flipped.dump"
cp "$work/source.dump.sha256" "$work/flipped.dump.sha256"
size=$(wc -c < "$work/source.dump")
printf 'XXXXXXXXXXXXXXXX' | dd of="$work/flipped.dump" bs=1 seek=$((size / 2)) conv=notrunc 2> /dev/null
if RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_flipped" restore "$work/flipped.dump" > "$work/c.log" 2>&1; then fail "sauvegarde modifiée acceptée"; fi
grep -q "empreinte différente" "$work/c.log" || { cat "$work/c.log"; fail "message d'empreinte"; }
head -c $((size / 4)) "$work/source.dump" > "$work/truncated.dump"
if RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_truncated" restore "$work/truncated.dump" > "$work/c2.log" 2>&1; then fail "sauvegarde tronquée acceptée"; fi
grep -q "illisible" "$work/c2.log" || { cat "$work/c2.log"; fail "message de sauvegarde illisible"; }
[ -z "$(q postgres -c "SELECT datname FROM pg_database WHERE datname IN ('${RUN}_flipped', '${RUN}_truncated')")" ] || fail "base créée pour une sauvegarde refusée"
RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_checked" restore "$work/source.dump" > "$work/c3.log" 2>&1 || { cat "$work/c3.log"; fail "sauvegarde intacte avec empreinte"; }
grep -q "Empreinte SHA-256 vérifiée" "$work/c3.log" || fail "empreinte non contrôlée"
[ "$(fingerprint "$SOURCE")" = "$before" ] || fail "la base source a changé"
ok "sauvegarde modifiée ou tronquée : refusée sans créer de base ; empreinte contrôlée ; base source intacte"

# 4. Bascule et retour arrière (sur des bases jetables : ${RUN}_live joue la base en service)
RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_live" restore "$work/source.dump" > /dev/null 2>&1 || fail "copie de travail"
q "${RUN}_live" -c "CREATE TABLE restore_marker (x int); INSERT INTO restore_marker VALUES (7)"
RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_new" restore "$work/source.dump" > /dev/null 2>&1 || fail "seconde restauration"
RESTORE_LIVE_DB="${RUN}_live" restore switch "${RUN}_new" > "$work/d.log" 2>&1 || { cat "$work/d.log"; fail "bascule"; }
old=$(q postgres -c "SELECT datname FROM pg_database WHERE datname LIKE '${RUN}_live_avant_%'")
[ -n "$old" ] || fail "ancienne base non conservée"
[ "$(q "$old" -c "SELECT x FROM restore_marker")" = "7" ] || fail "ancienne base modifiée"
[ "$(q "${RUN}_live" -c "SELECT to_regclass('restore_marker') IS NULL")" = "t" ] || fail "la base en service n'est pas la restauration"
ok "bascule : base restaurée en service, ancienne base gardée intacte ($old)"
RESTORE_LIVE_DB="${RUN}_live" restore rollback "$old" > "$work/e.log" 2>&1 || { cat "$work/e.log"; fail "retour arrière"; }
[ "$(q "${RUN}_live" -c "SELECT x FROM restore_marker")" = "7" ] || fail "retour arrière incomplet"
ok "retour arrière : ancienne base remise en service, base restaurée gardée"

# 4 bis. Confirmation tapée, arrêt et redémarrage des services, et échecs pendant la bascule
printf 'echo stop >> "%s/hooks"\n' "$work" > "$work/stop.sh"
printf 'echo start >> "%s/hooks"\n' "$work" > "$work/start.sh"
interactive() { PG_EXEC="$PG_EXEC" RESTORE_PGUSER="$USER_" RESTORE_STOP="sh $work/stop.sh" RESTORE_START="sh $work/start.sh" sh "$root/deploy/restore.sh" "$@"; }
names() { q postgres -c "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE '${RUN}_%'"; }
RESTORE_LIVE_DB="$SOURCE" RESTORE_TARGET="${RUN}_n2" restore "$work/source.dump" > /dev/null 2>&1 || fail "copie pour la confirmation"
state=$(names)
if printf 'oui\n' | RESTORE_LIVE_DB="${RUN}_live" interactive switch "${RUN}_n2" > "$work/f.log" 2>&1; then fail "bascule sans le mot de confirmation"; fi
grep -q "Annulé" "$work/f.log" || { cat "$work/f.log"; fail "annulation"; }
[ "$(names)" = "$state" ] && [ ! -f "$work/hooks" ] || fail "bascule annulée : quelque chose a changé"
ok "bascule : refusée sans le mot « BASCULER » (aucune base renommée, aucun service arrêté)"
# Connexion ouverte sur la base en service : le renommage échoue, rien ne change, les services redémarrent
pg psql -X -q -U "$USER_" -d "${RUN}_live" -c "SELECT pg_sleep(30)" > /dev/null 2>&1 &
holder=$!
for _ in $(seq 1 50); do [ "$(q postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '${RUN}_live'")" -ge 1 ] && break; sleep 0.2; done
if printf 'BASCULER\n' | RESTORE_LIVE_DB="${RUN}_live" interactive switch "${RUN}_n2" > "$work/g.log" 2>&1; then fail "bascule malgré une connexion ouverte"; fi
grep -q "rien n'a changé, services redémarrés" "$work/g.log" || { cat "$work/g.log"; fail "message d'échec de bascule"; }
[ "$(names)" = "$state" ] || fail "échec de bascule : bases renommées"
[ "$(q "${RUN}_live" -c "SELECT x FROM restore_marker")" = "7" ] || fail "échec de bascule : base en service modifiée"
[ "$(tr '\n' ' ' < "$work/hooks")" = "stop start " ] || fail "services non redémarrés après l'échec"
kill "$holder" 2> /dev/null || true; wait "$holder" 2> /dev/null || true
q postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RUN}_live' AND pid <> pg_backend_pid()" > /dev/null
ok "connexion ouverte sur la base en service : bascule refusée, base intacte, services redémarrés"
# Connexion ouverte sur la base restaurée : 1er renommage fait, 2e en échec → base d'origine remise en place
: > "$work/hooks"
pg psql -X -q -U "$USER_" -d "${RUN}_n2" -c "SELECT pg_sleep(30)" > /dev/null 2>&1 &
holder=$!
for _ in $(seq 1 50); do [ "$(q postgres -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '${RUN}_n2'")" -ge 1 ] && break; sleep 0.2; done
if printf 'BASCULER\n' | RESTORE_LIVE_DB="${RUN}_live" interactive switch "${RUN}_n2" > "$work/h.log" 2>&1; then fail "bascule malgré une connexion sur la base restaurée"; fi
grep -q "base d'origine remise en place" "$work/h.log" || { cat "$work/h.log"; fail "message de remise en place"; }
[ "$(names)" = "$state" ] || { echo "avant : $state / après : $(names)"; fail "base d'origine pas remise sous son nom"; }
[ "$(q "${RUN}_live" -c "SELECT x FROM restore_marker")" = "7" ] || fail "base en service modifiée"
[ "$(tr '\n' ' ' < "$work/hooks")" = "stop start " ] || fail "services non redémarrés"
kill "$holder" 2> /dev/null || true; wait "$holder" 2> /dev/null || true
q postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RUN}_n2' AND pid <> pg_backend_pid()" > /dev/null
ok "échec au 2e renommage : base d'origine remise sous son nom, intacte, services redémarrés"
# Confirmation correcte : bascule faite, services arrêtés puis redémarrés
: > "$work/hooks"
printf 'BASCULER\n' | RESTORE_LIVE_DB="${RUN}_live" interactive switch "${RUN}_n2" > "$work/i.log" 2>&1 || { cat "$work/i.log"; fail "bascule confirmée"; }
[ "$(tr '\n' ' ' < "$work/hooks")" = "stop start " ] || fail "arrêt et redémarrage des services"
[ "$(q "${RUN}_live" -c "SELECT to_regclass('restore_marker') IS NULL")" = "t" ] || fail "bascule confirmée non faite"
ok "bascule confirmée par « BASCULER » : services arrêtés puis redémarrés, base restaurée en service"

# 5. Redémarrage de l'API sur la base restaurée
restored_url=$(printf 'postgresql://%s:%s@%s:%s/%s' "$USER_" "${PGPASSWORD:-}" "${PGHOST:-localhost}" "${PGPORT:-5432}" "${RUN}_a")
if [ "${RESTORE_TEST_MIGRATE:-0}" = "1" ]; then
  (cd "$root/apps/api" && DATABASE_URL="$restored_url" npx prisma migrate deploy) > "$work/m.log" 2>&1 || { cat "$work/m.log"; fail "migrate deploy sur la base restaurée"; }
  grep -q "No pending migrations" "$work/m.log" || { cat "$work/m.log"; fail "migrations en attente sur une sauvegarde à jour"; }
  ok "prisma migrate deploy : historique des migrations restauré, rien en attente"
fi
(cd "$root/apps/api" && DATABASE_URL="$restored_url" API_PORT="$PORT" exec node --env-file-if-exists=../../.env dist/main.js) > "$work/api.log" 2>&1 &
api_pid=$!
up=""
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/health" > "$work/health.json" 2>/dev/null; then up=1; break; fi
  sleep 1
done
[ -n "$up" ] || { tail -30 "$work/api.log"; fail "l'API ne démarre pas sur la base restaurée"; }
games=$(curl -sf "http://localhost:$PORT/v1/games" | grep -o '"slug"' | wc -l)
expected_games=$(q "$SOURCE" -c "SELECT count(*) FROM games WHERE is_active")
[ "$games" -ge 1 ] && [ "$games" = "$expected_games" ] || fail "lecture des jeux : $games au lieu de $expected_games"
ok "API démarrée sur la base restaurée : /health $(cat "$work/health.json" | head -c 80), $games jeux"
echo "# $pass tests réussis"
