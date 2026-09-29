#!/usr/bin/env sh
set -eu
LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO_DIR=$(git -C "$LAB_DIR" rev-parse --show-toplevel)
export PYTHONPATH="$LAB_DIR/src"
CACHE_DIR=${LOCAL_LLM_MODEL_CACHE:-"${XDG_CACHE_HOME:-$HOME/.cache}/local-llm-lab/models"}
STATE_DIR=${LOCAL_LLM_LAB_STATE_DIR:-"${XDG_STATE_HOME:-$HOME/.local/state}/local-llm-lab"}
LLAMA_SERVER_BIN=${LLAMA_SERVER_BIN:-llama-server}
LLAMA_BENCH_BIN=${LLAMA_BENCH_BIN:-llama-bench}
common=$(python3 -c 'import os,sys; print(os.path.commonpath([os.path.realpath(sys.argv[1]),os.path.realpath(sys.argv[2])]))' "$REPO_DIR" "$CACHE_DIR")
[ "$common" != "$REPO_DIR" ] || { echo "Model cache must be outside tracked repository" >&2; exit 1; }
for cmd in python3 curl "$LLAMA_SERVER_BIN" "$LLAMA_BENCH_BIN"; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done
mkdir -p "$CACHE_DIR" "$STATE_DIR"
server_version=$($LLAMA_SERVER_BIN --version 2>&1) || { echo "llama-server --version failed" >&2; exit 1; }
bench_version=$($LLAMA_BENCH_BIN --version 2>&1) || { echo "llama-bench --version failed" >&2; exit 1; }
server_help=$($LLAMA_SERVER_BIN --help 2>&1) || true
bench_help=$($LLAMA_BENCH_BIN --help 2>&1) || true
printf '%s' "$server_help" | grep -q -- '--jinja' || { echo "llama-server lacks --jinja" >&2; exit 1; }
printf '%s' "$server_help" | grep -q -- '--offline' || { echo "llama-server lacks --offline" >&2; exit 1; }
printf '%s' "$server_help" | grep -q -- '--list-devices' || { echo "llama-server lacks --list-devices" >&2; exit 1; }
printf '%s' "$bench_help" | grep -q -- 'jsonl' || { echo "llama-bench lacks JSONL output" >&2; exit 1; }
printf '%s' "$bench_help" | grep -q -- '--list-devices' || { echo "llama-bench lacks --list-devices" >&2; exit 1; }
python3 -m local_llm_lab.system_probe > "$STATE_DIR/SYSTEM_SNAPSHOT.json"
"$LLAMA_SERVER_BIN" --list-devices > "$STATE_DIR/llama-devices.txt" 2>&1 || true
python3 - "$LAB_DIR/config/runtime.json" "$STATE_DIR/RUNTIME_IDENTITY.json" "$server_version" "$bench_version" "$STATE_DIR" <<'PY_RUNTIME'
import json,sys
cfg=json.load(open(sys.argv[1],encoding='utf-8'))
obj={
    'runtime_contract':cfg,
    'observed':{
        'llama_server':{'returncode':0,'output':sys.argv[3]},
        'llama_bench':{'returncode':0,'output':sys.argv[4]},
        'devices':open(sys.argv[5]+'/llama-devices.txt',encoding='utf-8',errors='replace').read(),
    },
    'feature_probe':{
        'server_jinja':True,
        'server_offline':True,
        'server_device_listing':True,
        'bench_jsonl':True,
        'bench_device_listing':True,
    },
    'selected_execution_default':{'gpu_layers':0,'mode':'cpu_only_unless_operator_explicitly_overrides'},
}
with open(sys.argv[2],'w',encoding='utf-8') as f:
    json.dump(obj,f,ensure_ascii=False,indent=2); f.write('\n')
PY_RUNTIME
tmp="$STATE_DIR/model-lock-records.jsonl"
: > "$tmp"
python3 - "$LAB_DIR/config/models.json" <<'PY_MODELS' | while IFS='|' read -r mid repo rev fname sha size; do
import json,sys
for m in json.load(open(sys.argv[1],encoding='utf-8'))['models']:
    print('|'.join([m['model_id'],m['source_repository'],m['source_revision'],m['source_filename'],m['expected_or_observed_sha256'],str(m['file_size_bytes'])]))
PY_MODELS
  path="$CACHE_DIR/$fname"
  if [ ! -f "$path" ]; then
    echo "Downloading pinned artifact $mid"
    curl -fL --retry 2 --retry-delay 2 "https://huggingface.co/$repo/resolve/$rev/$fname" -o "$path.part"
    python3 - "$path.part" "$sha" "$size" <<'PY_VERIFY_DOWNLOAD'
import hashlib,sys,os
p=sys.argv[1]; expected=sys.argv[2]; size=int(sys.argv[3])
if os.path.getsize(p)!=size: raise SystemExit('downloaded size mismatch')
h=hashlib.sha256()
with open(p,'rb') as f:
    for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
if h.hexdigest()!=expected: raise SystemExit('downloaded sha256 mismatch')
PY_VERIFY_DOWNLOAD
    mv "$path.part" "$path"
  fi
  python3 -m local_llm_lab.runner verify-model --model-id "$mid" --path "$path" >> "$tmp"
done
python3 - "$tmp" "$STATE_DIR/MODEL_LOCK.json" <<'PY_LOCK'
import json,sys
rows=[json.loads(x) for x in open(sys.argv[1],encoding='utf-8') if x.strip()]
with open(sys.argv[2],'w',encoding='utf-8') as f:
    json.dump({'lock_version':'local-llm-lab.observed-model-lock.v1','models':rows},f,ensure_ascii=False,indent=2); f.write('\n')
PY_LOCK
rm -f "$tmp"
echo "LOCAL_LLM_LAB_NUC_PREPARE=PASS"
echo "state_dir=$STATE_DIR"
echo "model_cache=$CACHE_DIR"
