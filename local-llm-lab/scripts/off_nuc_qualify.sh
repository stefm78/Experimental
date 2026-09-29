#!/usr/bin/env sh
set -eu
LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO_DIR=$(git -C "$LAB_DIR" rev-parse --show-toplevel)
if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
  echo "Tracked working tree is not clean; qualify an exact Git state." >&2
  exit 1
fi
commit=$(git -C "$REPO_DIR" rev-parse HEAD)
echo "LOCAL LLM LAB OFF-NUC QUALIFICATION"
echo "commit=$commit"
export PYTHONPATH="$LAB_DIR/src"
echo "[1/8] Python and shell syntax/import"
python3 -m compileall -q "$LAB_DIR/src" "$LAB_DIR/tests"
python3 -c 'import local_llm_lab.runner, local_llm_lab.evaluator, local_llm_lab.system_probe'
for script in "$LAB_DIR"/scripts/*.sh; do sh -n "$script"; done
echo "[2/8] Unit/contract tests"
python3 -m unittest discover -s "$LAB_DIR/tests" -v
echo "[3/8] JSON/JSONL contracts"
python3 - "$LAB_DIR" <<'PY_JSON_CHECK'
import json,sys
from pathlib import Path
root=Path(sys.argv[1])
for p in [*root.glob('config/*.json'),*root.glob('campaigns/*.json'),*root.glob('schemas/*.json')]:
    json.load(p.open(encoding='utf-8'))
PY_JSON_CHECK
python3 -m local_llm_lab.runner validate-fixtures
echo "[4/8] Artifact hygiene"
tracked=$(git -C "$REPO_DIR" ls-files local-llm-lab)
if printf '%s\n' "$tracked" | grep -Eqi '\.(gguf|safetensors|onnx)$|(^|/)runs/|(^|/)\.state/'; then
  echo "Tracked model/run/cache artifact detected" >&2
  exit 1
fi
if git -C "$REPO_DIR" grep -nE 'sk-[A-Za-z0-9_-]{12,}|api[_-]?key[[:space:]]*=[[:space:]]*[^$[:space:]]+' -- local-llm-lab ':!local-llm-lab/README.md' >/dev/null 2>&1; then
  echo "Potential tracked secret detected" >&2
  exit 1
fi
echo "[5/8] No cloud-model API path"
if git -C "$REPO_DIR" grep -nEi 'import (openai|anthropic)|api\.openai\.com|api\.anthropic\.com' -- local-llm-lab/src local-llm-lab/scripts >/dev/null 2>&1; then
  echo "Cloud model API path detected" >&2
  exit 1
fi
echo "[6/8] Deterministic stub end-to-end"
python3 -m local_llm_lab.runner dry-run
echo "[7/8] Required generated artifacts remain ignored"
for candidate in local-llm-lab/runs/__probe__/SUMMARY.json local-llm-lab/.state/__probe__.json local-llm-lab/__probe__.gguf; do
  git -C "$REPO_DIR" check-ignore -q "$candidate" || { echo "Expected ignored path is not ignored: $candidate" >&2; exit 1; }
done
echo "[8/8] Final tracked-state check"
if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
  echo "Qualification changed tracked state" >&2
  exit 1
fi
echo "LOCAL_LLM_LAB_OFF_NUC_QUALIFICATION=PASS"
echo "qualified_commit=$commit"
