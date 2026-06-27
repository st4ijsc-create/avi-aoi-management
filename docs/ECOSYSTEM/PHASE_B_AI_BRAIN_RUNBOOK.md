# PHASE B — AI BRAIN OPERATIONAL RUNBOOK

**Subsystem:** Local-First AI Brain v2 (L6 Intelligence) of the AVI/AOI platform
**Hardware baseline:** RTX 5090 32GB · i7-12700KF (12c/20t) · 48GB RAM · Windows 11
**Scope:** everything built across phases **B0–B6** (see design doc
[`04_AI_BRAIN_NEXTGEN_DESIGN_AND_UPGRADE_2026-06.md`](./04_AI_BRAIN_NEXTGEN_DESIGN_AND_UPGRADE_2026-06.md)).
**Audience:** operators / on-call engineers turning capabilities on, tuning VRAM, and rolling back.

> **Golden rule:** every capability below is **additive and flag-gated, default OFF/UNSET**. With
> the default env, the system behaves exactly as the Foundation baseline. Turn capabilities on one
> at a time, watch `/ai-brain` + logs, and keep this runbook open for rollback.

---

## 0. Quick orientation

| Layer | Key files | Default state |
|---|---|---|
| GGUF text engine (in-process) | `server/services/aiGgufEngine.ts` | always on (no model loads until first request) |
| Model Router (Cognitive Escalation Ladder) | `server/services/aiModelRouter.ts` | always on (pure decision layer) |
| Concurrency semaphore | `server/services/ggufConcurrency.ts` | always on |
| Vision sidecar (llama-server mtmd) | `server/services/llamaVisionSidecar.ts` | OFF unless 3 vision vars set |
| Anomaly detection | `server/services/aiAnomalyDetection.ts` | OFF |
| RAG reranker / causal graph / auto-ingest | `aiReranker.ts`, `aiCausalGraph.ts`, `aiLocalKnowledgeService.ts` | OFF |
| Orchestration watcher | `server/services/orchestration/aiWatcher.ts` | OFF |
| Agentic write (HITL) | `aiAgentOrchestrator.ts`, `aiAgentPlanner.ts` | OFF |
| Executive reports | `aiExecutiveReport.ts`, `reportScheduler.ts` | OFF |
| Self-learning (MLOps) | `aiSelfLearningScheduler.ts` | OFF (owned by B5) |
| Thinking tier (B6.2) | `aiModelRouter.ts` + `aiGgufEngine.ts` | OFF/UNSET |

---

## 1. Flag inventory (B0–B6)

> Defaults are read from the parsing code in each service. "Safe to flip" = effect of turning it on.
> Unless noted, all flags are read **once at process start** — change the env then **restart** the server.

### (A) GGUF engine · model loading · VRAM

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `GGUF_MODELS_DIR` | `./uploads/gguf-models` | Directory holding `.gguf` files | Point at your real model store |
| `GGUF_DEFAULT_MODEL` | _unset_ | Deep/Tier-2 model basename (Qwen3-30B-A3B-Instruct) | The reasoning workhorse; see rollback §6 |
| `GGUF_FAST_MODEL` | _unset_ | Fast/Tier-1 model basename (Qwen3-4B) | When unset, Tier-1 falls back to default model |
| `GGUF_EMBED_MODEL` | _unset_ (`mxbai…` in legacy example) | Dedicated embedding model basename | Required for RAG/embeddings; mismatch dim → hard error |
| `GGUF_EMBED_DIM` | `1024` | Expected embedding dim; mismatch throws | Keep aligned with the embed model |
| `GGUF_MAX_LOADED_MODELS` | `2` | Max resident models (LRU evicts oldest idle) | **On 5090 set `4`** to keep fast+deep+embed hot |
| `GGUF_MAX_VRAM_MB` | `0` (off) | Soft VRAM cap (MB) for eviction; best-effort | Opt-in; getVramState unreliable on some setups |
| `GGUF_VRAM_GUARD_PCT` | `90` | Evict LRU idle model when VRAM ≥ this % before loading | `0`/`100+` disables; thin 4GB headroom → keep 90 |
| `GGUF_SEQUENCES` | `4` | Parallel sequences per context (KV slots) | Higher = more KV-cache VRAM |
| `GGUF_DEFAULT_CTX` | `4096` | Default n_ctx when no per-task hint | Router overrides per task on first load |
| `GGUF_MAX_CTX` | `32768` | Hard upper bound on requested n_ctx | Guards against absurd KV-cache |
| `GGUF_GPU` | `auto` | `false` forces CPU; else CUDA/Vulkan auto | Set `false` only to debug GPU issues |
| `GGUF_CUDA_BIN` | from `%CUDA_PATH%\bin` | Explicit CUDA runtime DLL dir prepended to PATH | Set if cudart/cublas not found (see §5) |
| `GGUF_MAX_CONCURRENCY` | `1` | Global FIFO max in-flight inferences | **On 5090 raise to `4`** for parallel fast+deep+embed |
| `GGUF_QUEUE_MAX` | `8` | Max waiters before backpressure rejection | Raise for bursty workloads |
| `GGUF_INFER_TIMEOUT_MS` | `120000` | Max wait for a free inference slot | Raise if large prompts queue |

### (B) Model router · Thinking tier (B6.2)

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `AI_THINKING_TIER_ENABLED` | `false` | Master switch for the Thinking/reasoning tier | Opt-in; needs `GGUF_THINKING_MODEL` too (§4) |
| `GGUF_THINKING_MODEL` | _unset_ | Thinking model basename (Qwen3-30B-A3B-Thinking) | Same size as deep model → load-on-demand/LRU |

> Router escalates to the Thinking model **only** when `difficulty === "hard"` **AND** task ∈ `{rca, report}`,
> **AND** the flag is on, **AND** the file exists. Otherwise byte-identical to legacy. The Thinking model
> emits `<think>…</think>`; the engine helper `stripThinking()` removes it before display.

### (C) Vision sidecar (local llama-server mtmd)

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `LLAMA_SERVER_BIN` | _unset_ | Path to `llama-server` built with mtmd | All 3 (bin+model+mmproj) required → else `VISION_NOT_AVAILABLE` |
| `GGUF_VISION_MODEL` | _unset_ | Vision model file (Qwen3-VL-8B) | — |
| `GGUF_VISION_MMPROJ` | _unset_ | Matching mmproj file | Must match the VL model family |
| `LLAMA_VISION_HOST` | `127.0.0.1` | Sidecar bind host (localhost only) | Keep localhost — no outbound network |
| `LLAMA_VISION_PORT` | `8081` | Sidecar bind port | Change if 8081 taken |
| `LLAMA_VISION_READY_TIMEOUT_MS` | `120000` | Healthcheck timeout while model loads | Raise for slow cold-load |
| `LLAMA_VISION_IDLE_TIMEOUT_MS` | `600000` | Auto-kill sidecar after idle (reclaims ~6GB) | Lower to free VRAM faster |
| `LLAMA_VISION_GPU_LAYERS` | `999` | `-ngl` offload (999 = all) | Lower only if VRAM-starved |
| `LLAMA_VISION_CTX` / `_CTX_MAX` | `8192` / `16384` | Vision n_ctx and its hard cap | Larger = more VRAM |

### (D) Anomaly detection (PatchCore memory bank)

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `ANOMALY_DETECTION_ENABLED` | `false` | Master gate for scoring + VL escalation gate | Needs a built memory bank first (§3) |
| `ANOMALY_KNN_K` | `5` | k for kNN distance scoring | — |
| `ANOMALY_THRESHOLD_PCT` | `99` | Percentile threshold from OK bank | Lower = more sensitive |
| `ANOMALY_CORESET_RATIO` | `0.25` | Coreset subsample ratio | — |
| `ANOMALY_BANK_SCAN_LIMIT` | `4000` | Max bank rows scanned per query | RAM/CPU guard |
| `ANOMALY_HEURISTIC_GRID` | `4` | Fallback handcrafted-feature grid NxN | Used only when embeddings absent |
| `ANOMALY_VL_SUSPECT_RATIO` | `1.0` | VL escalation threshold multiplier | `<1` widens, `>1` tightens |
| `ANOMALY_VL_SUSPECT_ABS` | `0` | Absolute suspect score (0 = use ratio) | — |
| `ANOMALY_VL_MAX_PER_MIN` | `6` | Hard cap on VL escalations/min (0 = off) | Back-pressure; key at 20k img/shift |
| `ANOMALY_CREATE_ALERTS` | `false` | Raise PATTERN_ANOMALY predictive alert | Wire into quality gate |

### (E) RAG · reranker · knowledge graph · KB

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `RAG_RERANKER_ENABLED` | `false` | Cross-doc rerank (top-N → top-K) before LLM | Biggest RAG precision lever; fail-safe off |
| `RAG_RERANKER_MODE` | `llm` | `llm` (fast GGUF) or `gguf` (native reranker) | `gguf` needs `GGUF_RERANKER_MODEL` (§4) |
| `GGUF_RERANKER_MODEL` | _unset_ | Native cross-encoder GGUF basename | Enables `gguf` mode; load-on-demand ~1GB |
| `RAG_RERANKER_MAX_CANDIDATES` | `20` | Candidates fed to reranker | Cost guard |
| `RAG_RERANKER_DOC_CHARS` | `480` | Per-doc char cap for scoring | — |
| `RAG_RERANKER_BLEND` | `0.85` | `final = blend·rerank + (1-blend)·cosine` | — |
| `RAG_RERANKER_POOL` | `20` | Initial candidate pool size | — |
| `RAG_CAUSAL_GRAPH_ENABLED` | `false` | Causal KG (defect→cause→action) for RCA | Hybrid vector+graph; off = vector-only |
| `RAG_AUTO_INGEST_ENABLED` | `false` | Auto-ingest new RCA/insights into KB | Self-enriching loop; idempotent dedupe |
| `KB_PGVECTOR_ENABLED` | `false` | pgvector store vs file jsonl bruteforce | Decision B2.1 = **keep file** for now |
| `KB_QA_*` (cache/ctx/token budgets) | various | QA generation tuning (TTL 600000, ctx cap 1200, num_predict 512…) | Tune for latency vs completeness |
| `KB_HINTS_*` | on / 280 / 2 | Fenced context hints in answers | — |

### (F) Orchestration · watcher · agentic write · RBAC

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `ORCHESTRATION_ENABLED` | `false` | Event bus + rules engine | Foundation for watcher |
| `AI_ORCHESTRATION_ENABLED` | `false` | AI watcher (advisory RCA/next-step → `ai_insights`) | **Advisory-only, never executes** |
| `AI_WATCHER_MIN_INTERVAL_MS` | `60000` | Per-machine throttle protecting GGUF slot | Raise to reduce insight spam |
| `AI_AGENTIC_ENABLED` | `0` | Multi-step agentic write (manager/admin/eng roles) | **Every write via propose→confirm HITL** |
| `AGENT_MAX_STEPS` | `6` | Max steps per plan | — |
| `AGENT_MAX_WRITES_PER_SESSION` | `3` | Max writes per session (safety cap) | Keep low; raise deliberately |

### (G) Executive reports

| Flag | Default | What it does | Safe-to-flip note |
|---|---|---|---|
| `EXEC_REPORT_ENABLED` | `false` | Cron exec summary (shift/day/week) via 30B | No-op scheduler when off |
| `EXEC_REPORT_SHIFT_HOURS` | `8` | Shift length for shift reports | — |
| `EXEC_REPORT_PDM_MAX_MACHINES` | `20` | Machines in PdM risk summary | — |
| `EXEC_REPORT_LANG` | `vi` | Report language (vi/en) | — |

### (H) Self-learning / MLOps (owned by B5 — listed for completeness)

| Flag | Default | What it does |
|---|---|---|
| `AI_SELF_LEARNING_ENABLED` | `false` | Self-learning scheduler (uncertainty scan → label queue) |
| `AI_SELF_LEARNING_CRON` | `0 3 * * *` | Schedule |
| `AI_SELF_LEARNING_TZ` | `Asia/Ho_Chi_Minh` | Timezone |
| `AI_SELF_LEARNING_UNCERTAINTY` | `0.5` | Confidence threshold for enqueue |
| `AI_SELF_LEARNING_SINCE_HOURS` | `24` | Lookback window |
| `AI_SELF_LEARNING_MAX_ITEMS` | `200` | Max items/model/run |
| `AI_SELF_LEARNING_AUTORETRAIN` | `false` | Flag models for retrain (never trains without approval) |

### (I) Embedding-at-ingest + batch RCA + observability

| Flag | Default | What it does |
|---|---|---|
| `AOI_EMBEDDING_ENABLED` | `false` | Embed-at-ingest (DINOv2) at AOI commit (fire-and-forget) |
| `AOI_EMBEDDING_MODEL_CODE` | `dinov2-small` | ACTIVE model code in `ai_models` |
| `AOI_EMBEDDING_CONCURRENCY` | `2` | Parallel inspections (max 8) |
| `AOI_EMBEDDING_RESULT_FILTER` | `NG` | Embed `NG` only or `ALL` |
| `AI_BATCH_RCA_ENABLED` | `true` | Nightly batch RCA scheduler |
| `AI_BATCH_RCA_CRON` | `0 2 * * *` | Schedule |
| `METRICS_ENABLED` | (hook) | Inference latency histograms (per-model/tier) |

**Approximate flag count: ~90 AI-brain flags** across the eleven areas above (plus legacy Ollama,
ONNX EP, and shared storage flags not central to the GGUF brain).

---

## 2. VRAM budget (RTX 5090 32GB)

| Resident (hot) | VRAM | Notes |
|---|---|---|
| Qwen3-30B-A3B-Instruct (deep, MoE 3B active) | ~17.7GB | `GGUF_DEFAULT_MODEL` |
| Qwen3-4B-Instruct (fast) | ~2.5GB | `GGUF_FAST_MODEL` |
| Qwen3-Embedding-0.6B | ~1.2GB | `GGUF_EMBED_MODEL` |
| Qwen3-VL-8B + mmproj (sidecar process) | ~6GB | separate process; idle-killed |
| **Total hot** | **~27.7GB** | **~4GB headroom** for KV-cache + ONNX |
| DINOv2 ONNX (anomaly / image vector) | <1GB | CPU/GPU |

**Safe to keep hot simultaneously:** deep + fast + embed (in-process, `GGUF_MAX_LOADED_MODELS=4`) **plus**
the VL sidecar. **Headroom is only ~4GB** — keep `GGUF_VRAM_GUARD_PCT=90` on.

**NOT hot-simultaneously with the deep model:**
- **Thinking model** (~17GB, same size as deep) → load-on-demand, LRU-evicts the Instruct deep model.
- **Native reranker** (`GGUF_RERANKER_MODEL`, ~1GB) → load-on-demand; small enough to coexist briefly.

**Rule:** never add a 5th large hot model without freeing the 30B first. The router + LRU handle the swap.

---

## 3. Go-live checklists (per capability)

**Advisory watcher (B1.2)**
1. `ORCHESTRATION_ENABLED=true`, then `AI_ORCHESTRATION_ENABLED=true`, `AI_WATCHER_MIN_INTERVAL_MS=60000`.
2. Restart; trigger an NG burst; confirm an `ai_insights` row appears (advisory-only, no writes).
3. Watch GGUF queue depth on `/ai-brain` — raise the throttle if insights spam.

**Agentic-write + RBAC (B1.3) — run the "no bypass HITL" safety tests first**
1. Keep `AGENT_MAX_WRITES_PER_SESSION=3`, `AGENT_MAX_STEPS=6`.
2. `AI_AGENTIC_ENABLED=1`. Restart.
3. Verify `startSession → approvePlan → advance → confirmStep`; every write must require explicit confirm.

**RAG reranker / causal graph (B2.2 / B2.3)**
1. `RAG_RERANKER_ENABLED=true` (mode `llm` needs no extra download). Restart; eval recall@5.
2. Optional native reranker: download GGUF, set `GGUF_RERANKER_MODEL`, `RAG_RERANKER_MODE=gguf` (§4).
3. Causal graph: build `knowledge/semantic-graph.json` then `RAG_CAUSAL_GRAPH_ENABLED=true`.

**Anomaly + memory-bank build (B3.1)**
1. Ensure `AOI_EMBEDDING_ENABLED=true` so embeddings exist.
2. Build the PatchCore memory bank per product/machine (OK images).
3. `ANOMALY_DETECTION_ENABLED=true`; verify scores; keep `ANOMALY_VL_MAX_PER_MIN` as the VL gate.

**Executive reports (B4.3)**
1. `EXEC_REPORT_ENABLED=true`, set `EXEC_REPORT_LANG`, `EXEC_REPORT_SHIFT_HOURS`. Restart.
2. Confirm cron fires and a report is produced from real KPIs.

**Self-learning (B5.1)** — owned by B5
1. `AI_SELF_LEARNING_ENABLED=true`; leave `AI_SELF_LEARNING_AUTORETRAIN=false` until canary is proven.

**Thinking tier (B6.2)**
1. Download the Thinking GGUF (§4) into `GGUF_MODELS_DIR`.
2. `GGUF_THINKING_MODEL=<filename.gguf>`, then `AI_THINKING_TIER_ENABLED=true`. Restart.
3. Send a hard RCA/report request; confirm `route()` returns `thinking: true` and the answer has no
   raw `<think>` (the engine strips it). If the file is missing the router logs once and uses the deep model.

---

## 4. Downloading + enabling optional models

> These models are **not** shipped. Place files under `GGUF_MODELS_DIR` (default `./uploads/gguf-models`).
> Use the basename (filename without path) in the env var; the engine appends `.gguf` when needed.

**Thinking model (Qwen3-30B-A3B-Thinking-2507, ~17GB):**
```bash
# from your model host (example using huggingface-cli); pick a UD-Q4_K_XL quant
huggingface-cli download <repo>/Qwen3-30B-A3B-Thinking-2507-GGUF \
  Qwen3-30B-A3B-Thinking-2507-UD-Q4_K_XL.gguf \
  --local-dir ./uploads/gguf-models
```
```dotenv
GGUF_THINKING_MODEL=Qwen3-30B-A3B-Thinking-2507-UD-Q4_K_XL.gguf
AI_THINKING_TIER_ENABLED=true
```
Restart the server. Same size as the deep model → it LRU-evicts the Instruct deep model on demand.

**Native reranker (Qwen3-Reranker-0.6B / bge-reranker-v2-m3, ~1GB):**
```bash
huggingface-cli download <repo>/Qwen3-Reranker-0.6B-GGUF \
  qwen3-reranker-0.6b-q8_0.gguf --local-dir ./uploads/gguf-models
```
```dotenv
RAG_RERANKER_ENABLED=true
RAG_RERANKER_MODE=gguf
GGUF_RERANKER_MODEL=qwen3-reranker-0.6b-q8_0.gguf
```
If `RAG_RERANKER_MODE` stays `llm`, no download is needed — it reranks with the fast text model.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Model load crashes / `GGUF model file not found` | Wrong `GGUF_*_MODEL` basename or file not in `GGUF_MODELS_DIR` | Verify the file exists; basename must match (no path); engine appends `.gguf` |
| Out-of-memory / driver reset under load | Too many hot models / thin 4GB headroom | Keep `GGUF_VRAM_GUARD_PCT=90`; lower `GGUF_MAX_LOADED_MODELS`; let VL sidecar idle-kill |
| GPU not used (slow, CPU-only) | CUDA runtime DLLs not on PATH | Set `GGUF_CUDA_BIN=%CUDA_PATH%\bin`; ensure CUDA Toolkit installed; check `[aiGgufEngine] prepended CUDA bin to PATH` log |
| `node-llama-cpp is not available` | Native binding missing / wrong arch | Rebuild node-llama-cpp CUDA for sm_120 (5090) |
| `VISION_NOT_AVAILABLE` | One of the 3 vision vars missing or file absent | Set `LLAMA_SERVER_BIN` + `GGUF_VISION_MODEL` + `GGUF_VISION_MMPROJ`, all on disk |
| Vision sidecar won't start | Port busy / model still loading | Change `LLAMA_VISION_PORT`; raise `LLAMA_VISION_READY_TIMEOUT_MS` |
| Thinking tier silently not used | Flag off, var unset, or file missing | Check log warning; ensure file in `GGUF_MODELS_DIR`; both `AI_THINKING_TIER_ENABLED` and `GGUF_THINKING_MODEL` set |
| Raw `<think>…</think>` leaks to UI | Caller didn't strip | Pass output through `aiGgufEngine.stripThinking()` when `route().thinking === true` |
| Eval recall regression after reranker | Bad blend / over-aggressive rerank | Tune `RAG_RERANKER_BLEND` (toward cosine) or set `RAG_RERANKER_ENABLED=false` to revert |
| Inference requests rejected (backpressure) | Queue full | Raise `GGUF_QUEUE_MAX` / `GGUF_MAX_CONCURRENCY` (watch VRAM) |

---

## 6. Rollback procedures

All capabilities roll back by **flipping a flag off and restarting** — no schema/data changes.

- **Disable a capability:** set its master flag back to default (`*_ENABLED=false`/`AI_AGENTIC_ENABLED=0`)
  and restart. Behaviour returns to the prior baseline immediately.
- **Thinking tier:** set `AI_THINKING_TIER_ENABLED=false` (or unset `GGUF_THINKING_MODEL`). Deep tier
  reverts to `GGUF_DEFAULT_MODEL`. No need to delete the model file.
- **Reranker:** `RAG_RERANKER_ENABLED=false` → retrieval falls back to plain vector order.
- **Swap the deep model back:** point `GGUF_DEFAULT_MODEL` at the previous known-good GGUF basename and
  restart. The LRU drops the old one; the new one loads on first request.
- **Full AI quiesce:** turn off every `*_ENABLED` flag; the engine loads no model until a request arrives,
  so the brain becomes inert without uninstalling anything. (Legacy fallback: `USE_LEGACY_OLLAMA=true`.)

---

## 7. B6 — future modernization (DEFERRED)

These are tracked for later; **not enabled** and out of current scope.

- **Newer llama.cpp in-process** (B6.1): in-process text is pinned to a known-good llama.cpp build for
  Qwen3/qwen3moe. Qwen3.5 / Qwen-Next hybrid 2026 architectures need a newer build for sm_120 (as the
  vision sidecar already did) — upgrade only with an A/B win.
- **Long context per task** (B6.3): enable 128–256K n_ctx selectively for long reports / many-SOP reads
  via the router's per-task `contextSize` (KV-cache costs VRAM — never default-on).
- **Speculative decoding / batching** (B6.5): 4B as draft for the 30B to raise tok/s; batch inference for
  throughput — pending llama.cpp support and a measured gain.
- **Vision upgrades** (B6.4): larger Qwen3-VL or a dedicated OCR model if OCR becomes the bottleneck.

> Each future upgrade must ship with an A/B comparison proving improvement and must not break the
> capabilities already running.
