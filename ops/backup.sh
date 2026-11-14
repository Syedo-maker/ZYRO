#!/usr/bin/env bash
# Backs up Zyro's data: PostgreSQL (stores, users, orders, payments) and MongoDB (products, reviews,
# AI content). Redis is not backed up: it holds carts, rate-limit counters, caches and job queues,
# all rebuilt or short-lived (a lost cart is the worst case).
#
#   DATABASE_URL=... MONGODB_URI=... ops/backup.sh [backup-root]
#
# Writes <backup-root>/<UTC timestamp>/ with postgres.dump (pg_dump custom format), mongo.archive.gz
# (mongodump archive) and manifest.json (sizes and SHA-256 checksums). Backups older than
# BACKUP_KEEP_DAYS (default 30) in <backup-root> are deleted afterwards.
#
# Uploaded files (product images, receipts, voice notes) live in object storage; protect them with
# the storage service's own versioning and soft delete, not with this script.
# Keep backups away from the database servers, and encrypted at rest.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

: "${DATABASE_URL:?set DATABASE_URL}"
: "${MONGODB_URI:?set MONGODB_URI}"
ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ROOT/$STAMP"
WORK_DIR="$(cd "$ROOT/$STAMP" && pwd)"
# pg_dump does not accept Prisma's ?schema= parameter.
export WORK_DIR PGURL="${DATABASE_URL%%\?*}" MONGOURL="$MONGODB_URI"

echo "Backing up to $WORK_DIR"
in_tool "$PG_IMAGE" pg_dump 'pg_dump --format=custom --no-owner --no-privileges --file "$FILES/postgres.dump" "$PGURL"'
in_tool "$MONGO_IMAGE" mongodump 'mongodump --quiet --uri "$MONGOURL" --gzip --archive="$FILES/mongo.archive.gz"'

[[ -s "$WORK_DIR/postgres.dump" ]] || die "the PostgreSQL dump is empty"
[[ -s "$WORK_DIR/mongo.archive.gz" ]] || die "the MongoDB archive is empty"

cat > "$WORK_DIR/manifest.json" <<JSON
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgres": { "file": "postgres.dump", "bytes": $(wc -c < "$WORK_DIR/postgres.dump"), "sha256": "$(sha "$WORK_DIR/postgres.dump")" },
  "mongoDatabase": "$(echo "${MONGODB_URI%%\?*}" | sed 's#.*/##')",
  "mongo": { "file": "mongo.archive.gz", "bytes": $(wc -c < "$WORK_DIR/mongo.archive.gz"), "sha256": "$(sha "$WORK_DIR/mongo.archive.gz")" }
}
JSON
echo "Done: postgres.dump $(wc -c < "$WORK_DIR/postgres.dump" | tr -d ' ') bytes, mongo.archive.gz $(wc -c < "$WORK_DIR/mongo.archive.gz" | tr -d ' ') bytes"

KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} + | sed 's/^/Removed old backup: /'
