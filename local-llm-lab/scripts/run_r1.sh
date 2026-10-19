#!/usr/bin/env sh
set -u
LAB_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO_DIR=$(git -C "$LAB_DIR" rev-parse --show-toplevel)
export PYTHONPATH="$LAB_DIR/src"
STATE_DIR=${LOCAL_LLM_LAB_STATE_DIR:-"${XDG_STATE_HOME:-$HOME/.local/state}/local-llm-lab"}
LLAMA_SERVER_BIN=${LLAMA_SERVER_BIN:-llama-server}
LLAMA_BENCH_BIN=${LLAMA_BENCH_BIN:-llama-bench}
GPU_LAYERS=${LOCAL_LLM_GPU_LAYERS:-0}
THREADS=${LOCAL_LLM_THREADS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)}
TARGET=${1:-all}
if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
  echo "Tracked working tree is not clean" >&2
  exit 1
fi
[ -f "$STATE_DIR/MODEL_LOCK.json" ] || { echo "Run nuc_prepare.sh first (MODEL_LOCK.json missing)" >&2; exit 1; }
[ -f "$STATE_DIR/RUNTIME_IDENTITY.json" ] || { echo "Run nuc_prepare.sh first (RUNTIME_IDENTITY.json missing)" >&2; exit 1; }
commit=$(git -C "$REPO_DIR" rev-parse HEAD)
run_id=${LOCAL_LLM_RUN_ID:-"r1_$(date -u +%Y%m%dT%H%M%SZ)_$(printf %.12s "$commit")"}
RUN_DIR="$LAB_DIR/runs/$run_id"
[ ! -e "$RUN_DIR" ] || { echo "Run directory already exists: $RUN_DIR" >&2; exit 1; }
mkdir -p "$RUN_DIR"
cp "$STATE_DIR/MODEL_LOCK.json" "$RUN_DIR/MODEL_LOCK.json"
python3 -m local_llm_lab.system_probe > "$RUN_DIR/SYSTEM_SNAPSHOT.json"
cp "$STATE_DIR/RUNTIME_IDENTITY.json" "$RUN_DIR/RUNTIME_IDENTITY.json"
: > "$RUN_DIR/FAILURES.jsonl"
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM
models="violet-1b4-chat-q4_k_m qwen3-1.7b-q4_k_m"
[ "$TARGET" = all ] || models="$TARGET"
port=18080
for mid in $models; do
  path=$(python3 - "$RUN_DIR/MODEL_LOCK.json" "$mid" <<'PY_PATH'
import json,sys
m=next((x for x in json.load(open(sys.argv[1],encoding='utf-8'))['models'] if x['model_id']==sys.argv[2]),None)
if not m: raise SystemExit(2)
print(m['path'])
PY_PATH
  ) || { echo "Model $mid absent from lock" >&2; exit 1; }
  python3 -m local_llm_lab.runner verify-model --model-id "$mid" --path "$path" >/dev/null || exit 1
  server_cmd="$LLAMA_SERVER_BIN -m $path --jinja -c 2048 -t $THREADS --n-gpu-layers $GPU_LAYERS --host 127.0.0.1 --port $port --offline"
  log="$RUN_DIR/${mid}.server.log"
  start_ns=$(date +%s%N)
  "$LLAMA_SERVER_BIN" -m "$path" --jinja -c 2048 -t "$THREADS" --n-gpu-layers "$GPU_LAYERS" --host 127.0.0.1 --port "$port" --offline >"$log" 2>&1 &
  SERVER_PID=$!
  if ! python3 - "$port" <<'PY_READY'
import sys,time,urllib.request
url=f'http://127.0.0.1:{sys.argv[1]}/health'; end=time.time()+120
while time.time()<end:
    try:
        with urllib.request.urlopen(url,timeout=2) as r:
            if r.status==200: raise SystemExit(0)
    except Exception:
        time.sleep(1)
raise SystemExit(1)
PY_READY
  then
    printf '{"model_id":"%s","stage":"server_readiness","error":"timeout_or_start_failure"}\n' "$mid" >> "$RUN_DIR/FAILURES.jsonl"
    cleanup
    SERVER_PID=""
    port=$((port+1))
    continue
  fi
  end_ns=$(date +%s%N)
  startup_ms=$(( (end_ns-start_ns)/1000000 ))
  printf '{"kind":"server_startup","model_id":"%s","startup_ms":%s,"context_size":2048,"threads":%s,"gpu_layers":%s}\n' "$mid" "$startup_ms" "$THREADS" "$GPU_LAYERS" >> "$RUN_DIR/benchmark.jsonl"
  if ! python3 -m local_llm_lab.runner run --model-id "$mid" --run-dir "$RUN_DIR" --server-url "http://127.0.0.1:$port" --model-path "$path" --server-command "$server_cmd" --warmup; then
    printf '{"model_id":"%s","stage":"semantic_campaign","error":"runner_failed_or_runtime_errors"}\n' "$mid" >> "$RUN_DIR/FAILURES.jsonl"
  fi
  cleanup
  SERVER_PID=""
  printf '{"kind":"llama_bench_config","model_id":"%s","context_size":2048,"prompt_tokens":256,"generation_tokens":64,"repetitions":3,"threads":%s,"gpu_layers":%s}\n' "$mid" "$THREADS" "$GPU_LAYERS" >> "$RUN_DIR/benchmark.jsonl"
  "$LLAMA_BENCH_BIN" -m "$path" -p 256 -n 64 -r 3 -t "$THREADS" -ngl "$GPU_LAYERS" -o jsonl -oe none >> "$RUN_DIR/benchmark.jsonl" || printf '{"model_id":"%s","stage":"llama_bench","error":"benchmark_failed"}\n' "$mid" >> "$RUN_DIR/FAILURES.jsonl"
  port=$((port+1))
done
status_line=$(python3 -m local_llm_lab.runner finalize --run-dir "$RUN_DIR")
echo "$status_line"
python3 -m local_llm_lab.runner handoff --run-dir "$RUN_DIR"
status=${status_line#RUN_STATUS=}
if [ "$TARGET" = all ]; then
  [ "$status" = COMPLETE ] || exit 1
fi
[ ! -s "$RUN_DIR/FAILURES.jsonl" ]
