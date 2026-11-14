#!/usr/bin/env bash
# Shared helpers for the backup scripts. Sourced, not run.
#
# The database tools (pg_dump, pg_restore, psql, mongodump, mongorestore, mongosh) are used from the
# PATH when present. Otherwise, with DOCKER_NETWORK set, they run from the official images on that
# Docker network (the database hosts in the URLs must then be names on that network, for example the
# compose service names "postgres" and "mongo"). Connection URLs travel only as environment
# variables (PGURL, MONGOURL) read inside the shell, never as visible arguments, and are never printed.
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17.11-alpine}"
MONGO_IMAGE="${MONGO_IMAGE:-mongo:8.0.38}"

die() { echo "error: $*" >&2; exit 1; }

# in_tool <image> <tool> <shell command> [args...]
#   Runs the shell command where <tool> is available: locally if it is on the PATH, else in <image>
#   on DOCKER_NETWORK. Files are under $FILES: WORK_DIR locally, /work in Docker.
in_tool() {
  local image="$1" tool="$2" script="$3"; shift 3
  if command -v "$tool" > /dev/null 2>&1; then
    FILES="$WORK_DIR" sh -c "$script" sh "$@"
  elif [[ -n "${DOCKER_NETWORK:-}" ]]; then
    local mount="${WORK_DIR:?WORK_DIR not set}"
    # Git Bash on Windows: Docker wants C:/... rather than /c/...
    if command -v cygpath > /dev/null 2>&1; then mount="$(cygpath -m "$mount")"; fi
    MSYS_NO_PATHCONV=1 docker run --rm -i --network "$DOCKER_NETWORK" \
      -e PGURL -e MONGOURL -e FILES=/work -v "$mount:/work" -w /work \
      "$image" sh -c "$script" sh "$@"
  else
    die "$tool is not installed; install the PostgreSQL and MongoDB client tools, or set DOCKER_NETWORK to run them in Docker"
  fi
}

# A MongoDB URL without its database name (query options kept): mongodb://host:27017/?opts
server_uri() {
  local u="$1" q=""
  if [[ "$u" == *\?* ]]; then q="?${u#*\?}"; u="${u%%\?*}"; fi
  echo "${u%/*}/$q"
}

sha() { if command -v sha256sum > /dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
