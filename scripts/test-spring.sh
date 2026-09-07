#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JDBC_URL:?Use a disposable PostgreSQL database}"
: "${DB_USER:?Set DB_USER}"
: "${DB_PASSWORD:?Set DB_PASSWORD}"
jar=services/server/target/assurance-server-1.0.0.jar
[[ -f "$jar" ]] || { echo 'Run mvn -B -Ppostgres-it verify first.' >&2; exit 1; }
state=$(mktemp -d)
server_pid=''
cleanup() { if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi; rm -rf "$state"; }
trap cleanup EXIT INT TERM
node scripts/init-auth.mjs "$state" >/dev/null
export ASSURANCE_AUTH_FILE="$state/auth.json"
export PORT=8099
java -jar "$jar" >"$state/server.log" 2>&1 & server_pid=$!
if ! node scripts/test-deployed.mjs "$state" seed; then cat "$state/server.log" >&2; exit 1; fi
kill "$server_pid"; wait "$server_pid" || true
java -jar "$jar" >"$state/restarted.log" 2>&1 & server_pid=$!
if ! node scripts/test-deployed.mjs "$state" verify; then cat "$state/restarted.log" >&2; exit 1; fi
