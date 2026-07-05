# models/ — AI model provisioning (doc 27 Đợt 7 W7-D, gap V4)

Model **binaries are gitignored** (`*.onnx`, `*.gguf`) and are NEVER committed.
This directory ships only:

- `manifest.json` — the declared model set (name, file, URL, pinned SHA-256, size guard, what each model powers)
- `manifest.lock.json` — SHA-256 pins recorded on first download (trust-on-first-use; commit this file)
- this README

Without the models the AI stack **degrades honestly** (it never fabricates results):
embeddings fall back `onnx → text-of-image (GGUF) → heuristic`, and the active tier is
labelled in every output (`embeddingSource`, `getDinov2ModelHealth().activeTier`) and on
the admin **DB & Ingest health** card (`db_feature_status` row `ai_models`, written at
server startup by `server/services/aiModelAvailability.ts`).

## What each model powers

| Model | File / location | Powers | Feature flags |
|---|---|---|---|
| **DINOv2-small ONNX** (fp32, ~88 MB, 384-d) | `models/dinov2.onnx` (= `AI_DINOV2_MODEL_PATH` default) | Real visual embeddings: embed-at-ingest (`ai_image_embeddings`), PatchCore anomaly banks + scoring, visual similarity search, first-party embedding-head classifier | `AOI_EMBEDDING_ENABLED`, `ANOMALY_DETECTION_ENABLED`, `IMAGE_EMBEDDING_DEFAULT=onnx`, `AOI_DL_HEAD_ENABLED` |
| DINOv2-base ONNX (optional, ~346 MB, 768-d) | `models/dinov2-base.onnx` | Higher-accuracy embedding tier (do NOT mix vector spaces — re-embed history before switching) | `AOI_EMBEDDING_MODEL_CODE=dinov2-base` |
| Qwen3-30B-A3B GGUF (~18 GB) | `GGUF_MODELS_DIR` (external) | Deep tier: RCA Copilot, exec reports, deep chat | (aiGgufEngine router) |
| Qwen3-4B GGUF (~2.5 GB) | `GGUF_MODELS_DIR` (external) | Fast tier: intent/chat/extract | (aiGgufEngine router) |
| Qwen3-VL-8B + mmproj GGUF (~6 GB) | `GGUF_VISION_MODEL` / `GGUF_VISION_MMPROJ` (external) | VLM describe/analyze; text-of-image embedding fallback tier | vision endpoints |
| Qwen3-Embedding-0.6B GGUF (~1.2 GB) | `GGUF_MODELS_DIR` (external) | KB/RAG text embeddings (1024-d); text-of-image tier | RAG/KB |
| bge-reranker-v2-m3 GGUF (~0.6 GB) | `GGUF_MODELS_DIR` (external) | KB cross-encoder rerank | `RAG_RERANKER_MODE=gguf` |

`external-gguf` entries are **presence-checked only** — they are already provisioned on
this host under `GGUF_MODELS_DIR` (see `.env`); the fetch script does not download them.

### DINOv2 source (canonical)

Community ONNX export of `facebook/dinov2-small` by the transformers.js project:
**repo `Xenova/dinov2-small`, file `onnx/model.onnx`** →
`https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx`.
Override with `MODEL_DINOV2_URL`; enforce a specific hash with `MODEL_DINOV2_SHA256`
(otherwise the hash pinned in `manifest.lock.json` at first download is enforced).
Validated shape: input `pixel_values [N,3,224,224]` → `last_hidden_state [N,257,384]`
(dynamic batch axis confirmed — used by the V6 micro-batcher). The CLS token (token 0)
is pooled by `aiImageEmbedding.poolEmbeddingFromOutput` → 384-d vector, L2-normalized.

## Disk / VRAM budget (RTX 5090, 32 GB VRAM — decision #6)

Estimates, not measurements — the ONNX path is CPU/DirectML/CUDA depending on
`AI_INFER_EP`/`ENABLE_GPU`, and GGUF offload is managed by aiGgufEngine's VRAM guard
(`GGUF_VRAM_GUARD_PCT=90`):

| Component | Disk | VRAM (est.) |
|---|---|---|
| DINOv2-small fp32 | 88 MB | ~0.3–0.5 GB/session (weights + activations at N≤8) |
| DINOv2-base fp32 (optional) | 346 MB | ~1–1.5 GB/session |
| ONNX session cache (`AI_SESSION_CACHE_MAX`, default 5, 8 documented-OK for 32 GB) | — | cache_size × per-model footprint |
| Qwen3-30B-A3B Q4 (deep) | ~18 GB | ~19 GB fully offloaded |
| Qwen3-4B Q4 (fast) | ~2.5 GB | ~3.5 GB |
| Qwen3-VL-8B Q4 + mmproj | ~6 GB | ~7 GB (ctx 8192) |
| Qwen3-Embedding-0.6B | ~1.2 GB | ~1.5 GB |
| reranker (CPU by default, `RAG_RERANKER_GPU=false`) | 0.6 GB | 0 |

Rule of thumb: deep + fast + vision + embed ≈ 31 GB worst-case hot — the GGUF engine's
LRU + VRAM guard (`GGUF_MAX_LOADED_MODELS=4`, guard 90%) is what keeps this workable;
the ONNX embedding/inference footprint is small in comparison. If you enable the ONNX
CUDA/TensorRT EP alongside all four hot GGUF models, drop `GGUF_MAX_LOADED_MODELS` to 3.

## Fetch → verify → enable (runbook)

```bash
# 1. See what is present/missing (no network):
node scripts/fetch-models.mjs --dry-run

# 2. Fetch the required set (resume-capable, size-guarded, sha256-verified):
node scripts/fetch-models.mjs
#    – first download pins the sha256 into models/manifest.lock.json (commit it)
#    – a mismatch against a pinned hash REJECTS the file (kept as *.rejected)

# 3. Validate: create an onnxruntime session + run a dummy tensor (CPU EP):
node scripts/validate-models.mjs
#    expect: dinov2-small … pixel_values[1,3,224,224] → last_hidden_state[1,257,384]

# 4. Re-verify checksums any time:
node scripts/fetch-models.mjs --verify

# 5. Enable the production AI profile (.env — see the W7-D flag block):
#    AOI_EMBEDDING_ENABLED=true          # embed-at-ingest (needs this model)
#    ANOMALY_DETECTION_ENABLED=true      # PatchCore scoring (needs banks built)
#    AI_DRIFT_MONITOR_ENABLED=true
#    AI_MODEL_PERF_SNAPSHOTS_ENABLED=true
#    IMAGE_EMBEDDING_DEFAULT=onnx
#    # phased — OFF until their preconditions exist:
#    AOI_DL_HEAD_ENABLED=false           # enable after the FIRST trained head exists
#    AI_MODEL_AUTOROLLBACK_ENABLED=false # enable after canary/A-B data accumulates
#    AI_AUTO_PROMOTE_ENABLED=false       # human/canary promotion only

# 6. Restart the server and check the consolidated startup line:
#    [AIModels] … → embedding tier: onnx
#    (also visible on the admin DB & Ingest health card via db_feature_status.ai_models)
```

The server also registers ONNX models in the `ai_models` DB table (code
`dinov2-small`, `filePath` → this directory); `aiImageEmbedding.getEmbeddingSession`
falls back to `AI_DINOV2_MODEL_PATH` when the DB `filePath` is stale.

## GPU micro-batching knobs (V6, aiInferenceEngine)

| Env | Default | Meaning |
|---|---|---|
| `AI_BATCH_MAX` | 8 | max images stacked into one `session.run` (`[N,C,H,W]`); `1` disables batching |
| `AI_BATCH_WINDOW_MS` | 25 | collection window before a partial batch flushes |
| `AI_GPU_CONCURRENCY` | 2 | concurrent `session.run` calls across ALL models (semaphore) |
| `AI_SESSION_CACHE_MAX` | 5 | LRU ONNX session cache size (8 is fine on 32 GB VRAM) |

Classification models batch; **detection (YOLO) stays N=1** (box-count outputs are not
cleanly splittable per image and NMS is per-image anyway). Models whose graph rejects
N>1 fall back to per-item runs automatically and are remembered as no-batch.
