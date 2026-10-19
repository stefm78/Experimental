#!/usr/bin/env sh
set -eu
LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd); export PYTHONPATH="$LAB_DIR/src"; RUN_DIR=${1:-}
if [ -z "$RUN_DIR" ]; then RUN_DIR=$(find "$LAB_DIR/runs" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true); fi
[ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ] || { echo "No run directory found" >&2; exit 1; }
python3 -m local_llm_lab.runner handoff --run-dir "$RUN_DIR" | python3 -c 'import re,sys; s=sys.stdin.read(); s=re.sub(r"sk-[A-Za-z0-9_-]{12,}","[REDACTED]",s); print(s,end="")'
