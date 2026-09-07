#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-java.sh
if [[ ! -f packages/agent/dist/src/cli.js ]]; then echo 'Run npm install && npm run build first.' >&2; exit 1; fi
if [[ -z "${DEMO_PORT:-}" ]]; then
  DEMO_PORT=$(node --input-type=module -e 'import {createServer} from "node:net"; const s=createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')
fi
export DEMO_PORT
java -cp .build/java dev.assurance.core.DevServer "$DEMO_PORT" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT INT TERM
node scripts/demo.mjs
