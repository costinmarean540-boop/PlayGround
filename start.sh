#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 -m http.server 3002 --bind 0.0.0.0
