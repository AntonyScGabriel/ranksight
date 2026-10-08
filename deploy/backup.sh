#!/bin/sh
# Sauvegarde quotidienne de PostgreSQL (format compressé de pg_dump), conservée BACKUP_KEEP_DAYS jours.
# Restauration : voir deploy/restore.sh
set -eu
mkdir -p /backups
while true; do
  file="/backups/rankguess-$(date -u +%Y-%m-%d_%H%M).dump"
  if pg_dump -h postgres -U rankguess -d rankguess -Fc -f "$file.part"; then
    mv "$file.part" "$file"
    echo "Sauvegarde OK : $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "ÉCHEC de la sauvegarde" >&2
  fi
  find /backups -name 'rankguess-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  sleep 86400
done
