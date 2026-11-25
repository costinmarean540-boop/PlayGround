#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CAPTURE_URL:-}" || -z "${CAPTURE_DIR:-}" ]]; then
  echo "CAPTURE_URL and CAPTURE_DIR are required" >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/home/runner/work/_temp/omgithub-runtime}"
export CAPTURE_URL CAPTURE_DIR
export CAPTURE_STRICT="${CAPTURE_STRICT:-1}"

/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p env CAPTURE_URL="$CAPTURE_URL" CAPTURE_DIR="$CAPTURE_DIR" RUNTIME_DIR="$RUNTIME_DIR" CAPTURE_STRICT="$CAPTURE_STRICT" \
  node "$RUNTIME_DIR/scripts/default-capture.mjs"
