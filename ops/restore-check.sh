#!/usr/bin/env bash
# Proves a restore worked: compares the exact row count of every PostgreSQL table and the document
# count of every MongoDB collection between the source and the restored copy. Read-only on both.
#
#   DATABASE_URL=<source> MONGODB_URI=<source> RESTORE_DATABASE_URL=<copy> RESTORE_MONGODB_URI=<copy> ops/restore-check.sh
#
# Exits 1 if any count differs. Run it against the restored copy and the source as it was when the
# backup was taken (for a tested restore drill, a source nobody writes to in the meantime).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

: "${DATABASE_URL:?}" "${MONGODB_URI:?}" "${RESTORE_DATABASE_URL:?}" "${RESTORE_MONGODB_URI:?}"
WORK_DIR="$(mktemp -d)"
export WORK_DIR

PG_COUNTS='psql --no-psqlrc -At -F"|" "$PGURL" -c "select table_name, (xpath('"'"'/row/c/text()'"'"', query_to_xml(format('"'"'select count(*) as c from %I.%I'"'"', table_schema, table_name), false, true, '"'"''"'"')))[1]::text from information_schema.tables where table_schema = '"'"'public'"'"' and table_type = '"'"'BASE TABLE'"'"' order by 1"'
MONGO_COUNTS='mongosh --quiet "$MONGOURL" --eval "db.getCollectionNames().sort().forEach((c) => print(c + \"|\" + db.getCollection(c).countDocuments()))"'

counts() { # <pg-url> <mongo-url>
  PGURL="${1%%\?*}" MONGOURL="$2" in_tool "$PG_IMAGE" psql "$PG_COUNTS" | sed 's/^/pg:/'
  PGURL="" MONGOURL="$2" in_tool "$MONGO_IMAGE" mongosh "$MONGO_COUNTS" | sed 's/^/mongo:/'
}

counts "$DATABASE_URL" "$MONGODB_URI" | sort > "$WORK_DIR/source"
counts "$RESTORE_DATABASE_URL" "$RESTORE_MONGODB_URI" | sort > "$WORK_DIR/restored"

printf "%-44s %10s %10s\n" "table or collection" "source" "restored"
status=0
while IFS='|' read -r name n; do
  r=$(grep -F "$name|" "$WORK_DIR/restored" | head -1 | cut -d'|' -f2 || true)
  mark="ok"; [[ "$r" == "$n" ]] || { mark="DIFFERENT"; status=1; }
  printf "%-44s %10s %10s  %s\n" "$name" "$n" "${r:-missing}" "$mark"
done < "$WORK_DIR/source"
rm -rf "$WORK_DIR"
if [[ $status -eq 0 ]]; then echo "Restore check passed: every table and collection has the same count."; else echo "Restore check FAILED."; fi
exit $status
