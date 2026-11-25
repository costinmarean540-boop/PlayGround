#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"
PORT="${PORT:-3000}"
DIST_DIR="$PROJECT_DIR/dist"
METADATA_DIR="/home/runner/work/_temp/omgithub-web"

/usr/bin/time -p mkdir -p "$DIST_DIR" "$METADATA_DIR"

if [[ -f "$PROJECT_DIR/package.json" ]]; then
  if [[ -f "$PROJECT_DIR/package-lock.json" || -f "$PROJECT_DIR/npm-shrinkwrap.json" ]]; then
    /usr/bin/time -p npm ci
  else
    /usr/bin/time -p npm install
  fi
  if node -e 'const p=require("./package.json"); process.exit(p.scripts?.build ? 0 : 1)' 2>/dev/null; then
    /usr/bin/time -p npm run build
  fi
fi

# This static project has no framework build step. Publish only project-local static output.
/usr/bin/time -p cp -f "$PROJECT_DIR/index.html" "$DIST_DIR/index.html"
/usr/bin/time -p cp -f "$PROJECT_DIR/style.css" "$DIST_DIR/style.css"
/usr/bin/time -p cp -f "$PROJECT_DIR/game.js" "$DIST_DIR/game.js"

/usr/bin/time -p mkdir -p "$METADATA_DIR"
/usr/bin/time -p python3 - "$METADATA_DIR/deployment-output.json" "$PROJECT_DIR" "$DIST_DIR" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump({"project": sys.argv[2], "directory": sys.argv[3]}, handle)
PY

exec /usr/bin/time -p python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIST_DIR"
