#!/bin/sh
# Sauvegarde quotidienne de PostgreSQL (format compressé de pg_dump), conservée BACKUP_KEEP_DAYS jours, avec son
# empreinte SHA-256 (fichier .sha256 à côté). Restauration : voir deploy/restore.sh
# Valeurs par défaut = service « backup » de docker-compose.prod.yml. Tests : BACKUP_DIR, BACKUP_PGHOST,
# BACKUP_PGUSER, BACKUP_PGDATABASE, BACKUP_PG_DUMP (commande pg_dump), BACKUP_ONCE=1 (une sauvegarde puis arrêt).
set -eu
dir=${BACKUP_DIR:-/backups}
host=${BACKUP_PGHOST:-postgres}
user=${BACKUP_PGUSER:-rankguess}
database=${BACKUP_PGDATABASE:-rankguess}
PG_DUMP=${BACKUP_PG_DUMP:-pg_dump}
mkdir -p "$dir"
while true; do
  file="$dir/rankguess-$(date -u +%Y-%m-%d_%H%M).dump"
  # Découpage en mots voulu : BACKUP_PG_DUMP peut être une commande avec ses arguments
  if $PG_DUMP -h "$host" -U "$user" -d "$database" -Fc > "$file.part"; then
    mv "$file.part" "$file"
    # Empreinte : restore.sh refuse un fichier abîmé ou incomplet (copie interrompue, disque)
    (cd "$dir" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
    echo "Sauvegarde OK : $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "ÉCHEC de la sauvegarde" >&2
  fi
  find "$dir" -name 'rankguess-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  find "$dir" -name 'rankguess-*.dump.sha256' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  [ "${BACKUP_ONCE:-}" = "1" ] && exit 0
  sleep 86400
done
