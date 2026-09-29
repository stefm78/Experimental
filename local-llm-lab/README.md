# NUC Local-LLM Lab — R1 foundation

## Research question
How much bounded, mechanically verifiable cognitive work can a local ~1–2B parameter model perform reliably on the existing NUC, and when should execution escalate rather than trust the local result?

R1 is an isolated qualification experiment, not a product integration and not a model leaderboard. `Experimental` is the boundary because this repository already uses disposable laboratories to isolate mechanisms, freeze product boundaries, collect evidence, and integrate only after a separate decision.

## Models and identity
R1 compares two pinned GGUF artifacts:
- `violet-1b4-chat-q4_k_m` — **probe**, not an assumed production candidate. Its unusual Victorian/persona orientation deliberately makes it a difficult transfer probe. SHA-256 `770076932c279de35c442db23112a4980ed0f00da269c3459b5bceb56b1d28d0`.
- `qwen3-1.7b-q4_k_m` — **control**, not an endorsed winner. SHA-256 `d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5`.

`config/models.json` binds repository, immutable revision, filename, exact size/hash, license, quantization, chat-template strategy, and the common 2048-token context. A real run hashes the local file before server start and refuses a mismatch. Weights live outside Git under `~/.cache/local-llm-lab/models` by default.

## Runtime
The R1 documentation baseline is `llama.cpp v0.5.0`, tag commit `7fe450e19305b828c199d602c23a8337aaa1f03b`. Every prepared environment/run records observed `llama-server --version`, `llama-bench --version`, devices, system snapshot, invocation, threads, context, and GPU-layer setting. Default execution is explicitly CPU-only (`gpu_layers=0`); acceleration is detected but never guessed. An operator may explicitly override it.

Both models get the same neutral system message. This avoids comparing Violet's implicit persona injection with Qwen task behavior. Qwen additionally receives its documented direct-answer controls: `enable_thinking=false`, `reasoning_effort=none`. Chain-of-thought is neither requested nor scored.

## Architecture
```text
pinned model bytes outside Git
          |
          v
     llama-server -- one model, 2048 ctx, explicit mode
          |
          +--> one warm-up (timing only)
          v
24 synthetic cases x 2 lanes
  constrained JSON schema | requested JSON without schema
          |
          v
 deterministic local evaluator -- no LLM, no cloud evaluator
          +--> results + preserved raw responses
          +--> metric vectors by model/lane/family/language/difficulty
          +--> compact handoff

llama-bench ---------------------> separate performance evidence
```

Each case is one independent turn: no prior case, answer, evaluator feedback, or history is carried forward. Server-side schema enforcement is only a formatting aid; the local evaluator independently validates JSON shape, semantic oracle, closed-world IDs, required items, and forbidden items.

## Corpus
`fixtures/r1-cases.jsonl` contains 24 independently authored synthetic cases: six primitive families × English/French × simple/adversarial. Families: `FACT_VS_INFERENCE`, `CONTRADICTION_DETECTION`, `CLOSED_WORLD_ID_FIDELITY`, `EVIDENCE_COVERAGE`, `FALSE_PASS_CHALLENGE`, `OPTION_DISCRIMINATION`. Cases contain no product/customer secrets and are not copied or translated from existing holdouts.

## Exact commands
From `local-llm-lab/`:
```bash
./scripts/off_nuc_qualify.sh
./scripts/nuc_prepare.sh
./scripts/run_r1.sh
./scripts/collect_handoff.sh
```
`off_nuc_qualify.sh` never downloads model weights. `nuc_prepare.sh` is the explicit pinned download/verification step. `run_r1.sh` runs Violet then Qwen sequentially, preserves partial results, performs a single warm-up per model, then records separate `llama-bench` evidence. Pass a model ID for an explicit single-model run.

## Run artifacts
A real ignored `runs/<run_id>/` contains `RUN_MANIFEST.json`, `SYSTEM_SNAPSHOT.json`, `MODEL_LOCK.json`, `RUNTIME_IDENTITY.json`, `results.jsonl`, `responses/`, `SUMMARY.json`, `benchmark.jsonl`, logs and failure records. The manifest binds campaign/fixture/prompt digests, Git commit, clean tree, model identity, inference parameters and timestamps.

Summary metrics remain a vector: semantic exact accuracy, contract pass rate, invalid JSON rate, ID violation rate, runtime error rate, latency and tokens. No weighted quality score is created; throughput is not mixed into semantic quality.

## What R1 proves and does not prove
An off-NUC PASS proves deterministic repository/corpus/evaluator/orchestration/hygiene properties for an exact commit. It does **not** prove NUC runtime behavior. `NUC_EXECUTION=PASS` requires direct NUC execution for the exact commit with observed model hashes and runtime identity.

A local-model result is not product authority. R1 cannot establish production readiness or justify LearnIt/Spéculation integration. `EXPERIMENT_PASS != PRODUCT_INTEGRATION_PASS`, `LOCAL_MODEL_OUTPUT != AUTHORITY`, and `OFF_NUC_PASS != NUC_QUALIFIED`.

## Decision gate
Spéculation and LearnIt remain read-only. LearnIt retains deterministic scoring/evidence authority; any future model work begins as shadow evaluation. R2 is deliberately not selected from implementation evidence alone. First execute R1 on the NUC; only observed metric vectors/error modes may justify STOP/REFRAME, Kernel primitive delegation/escalation, Spéculation shadow analysis, or LearnIt shadow analysis. Speed alone cannot select a product-facing R2.
