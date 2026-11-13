#!/usr/bin/env bash
# Restores a backup made by ops/backup.sh into the databases you name.
#
#   RESTORE_DATABASE_URL=... RESTORE_MONGODB_URI=... ops/restore.sh <backup-dir> --yes-replace-target-data
#
# Everything in the target databases that the backup also has is replaced (pg_restore --clean,
# mongorestore --drop). The target is named separately from DATABASE_URL / MONGODB_URI on purpose,
# and the flag is required, so a restore never lands on the live databases by accident: restore into
# a new database first, check it (ops/restore-check.sh), then switch the app over.
#
# The checksums in manifest.json are verified before anything is touched.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DIR="${1:?usage: ops/restore.sh <backup-dir> --yes-replace-target-data}"
[[ "${2:-}" == "--yes-replace-target-data" ]] || die "add --yes-replace-target-data to confirm the target's data may be replaced"
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL (the database to restore INTO)}"
: "${RESTORE_MONGODB_URI:?set RESTORE_MONGODB_URI (the database to restore INTO)}"
WORK_DIR="$(cd "$DIR" && pwd)"
export WORK_DIR PGURL="${RESTORE_DATABASE_URL%%\?*}" MONGOURL="$RESTORE_MONGODB_URI"

for f in postgres.dump mongo.archive.gz manifest.json; do [[ -s "$WORK_DIR/$f" ]] || die "$f is missing from $WORK_DIR"; done
for part in postgres mongo; do
  file=$(sed -n "s/.*\"$part\": { \"file\": \"\([^\"]*\)\".*/\1/p" "$WORK_DIR/manifest.json")
  want=$(sed -n "s/.*\"$part\": {.*\"sha256\": \"\([0-9a-f]*\)\".*/\1/p" "$WORK_DIR/manifest.json")
  [[ "$(sha "$WORK_DIR/$file")" == "$want" ]] || die "$file does not match its checksum in manifest.json: the backup is damaged"
done
echo "Checksums match. Restoring $WORK_DIR"

in_tool "$PG_IMAGE" pg_restore 'pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$PGURL" "$FILES/postgres.dump"'
# The archive keeps its source database's name (recorded in manifest.json); --nsFrom/--nsTo restore
# it under the target's name, so a backup can be restored next to the original.
SOURCE_DB=$(sed -n 's/.*"mongoDatabase": "\([^"]*\)".*/\1/p' "$WORK_DIR/manifest.json")
TARGET_DB=$(echo "${RESTORE_MONGODB_URI%%\?*}" | sed 's#.*/##')
[[ -n "$SOURCE_DB" && -n "$TARGET_DB" ]] || die "could not read the MongoDB database names from manifest.json and RESTORE_MONGODB_URI"
# Connected at server level: a database named in the URL would act as a filter and restore nothing
# from an archive of another database (found in the restore drill).
MONGOURL="$(server_uri "$RESTORE_MONGODB_URI")"
export MONGOURL
in_tool "$MONGO_IMAGE" mongorestore 'mongorestore --uri "$MONGOURL" --gzip --archive="$FILES/mongo.archive.gz" --drop --nsFrom "$1.*" --nsTo "$2.*" 2>&1 | grep -E "document\(s\) restored|error|Failed" || true' "$SOURCE_DB" "$TARGET_DB"
echo "Restored. Check it with ops/restore-check.sh before using it."
