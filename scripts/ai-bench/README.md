# ai-bench — Local GGUF inference benchmark harness (Doc 34 P0)

Reproducible benchmark for the local LLM serving tier. Records a **baseline** of
tok/s (prefill + decode), model load time, and peak VRAM for each logical model,
so model-card numbers stop being hardcoded and P0's exit criterion
("benchmark ghi lại") is satisfiable.

It is **self-contained**: it loads `node-llama-cpp` directly (the same API
`server/services/aiGgufEngine.ts` uses) and does **not** boot the app or import
any `server/` code. It reads the same `GGUF_*` env the engine reads.

---

## What it measures

For each **logical** model (resolved from env):

| logical | env var              | type  | metrics                                             |
|---------|----------------------|-------|-----------------------------------------------------|
| `deep`  | `GGUF_DEFAULT_MODEL` | text  | load ms, prefill tok/s, decode tok/s, peak VRAM     |
| `fast`  | `GGUF_FAST_MODEL`    | text  | same                                                |
| `code`  | `GGUF_CODE_MODEL`    | text  | same (optional; skipped if env unset)               |
| `fim`   | `GGUF_FIM_MODEL`     | text  | same (optional; measured as a text proxy)           |
| `embed` | `GGUF_EMBED_MODEL`   | embed | load ms, embed latency, input tok/s, peak VRAM      |

- **Prefill tok/s** = `promptTokens / time-to-first-token`, measured at a couple
  of prompt sizes (`--prefill`, default `128,1024` — the "context sizes").
- **Decode tok/s** = `generatedTokens / (total − TTFT)`.
- **Peak VRAM** = max `nvidia-smi` "memory.used" sampled around load + each timed
  iteration, plus `llama.getVramState()` after load (`engineVram`). If `nvidia-smi`
  is unavailable the fields are `null` and the run still completes.
- Each measurement runs `--warmup` discarded iterations then `--iters` timed
  iterations; results are reported as `{ n, mean, median, min, max }`.

Temperature is fixed to `0` for deterministic decode.

---

## Requirements / env

- `node-llama-cpp` installed (already a repo dependency).
- Models placed under `GGUF_MODELS_DIR` (default `./uploads/gguf-models`) and the
  relevant `GGUF_*` basenames set in repo-root `.env` (loaded via `dotenv`).
- **GPU (CUDA) on Windows:** the harness mirrors the engine — if GPU is enabled it
  prepends `GGUF_CUDA_BIN` (or `%CUDA_PATH%\bin`) to `PATH` so `cudart`/`cublas`
  DLLs resolve. Set `GGUF_CUDA_BIN` if the CUDA Toolkit bin is not already on PATH.
- Force CPU with `--cpu` or `GGUF_GPU=false`.

---

## Run

Self-check first (validates wiring; **loads no big model**):

```bash
node scripts/ai-bench/bench.mjs --selfcheck
```

Full benchmark (all configured models):

```bash
node scripts/ai-bench/bench.mjs
```

If the `ai:bench` npm script is present:

```bash
npm run ai:bench -- --selfcheck
npm run ai:bench
```

### Common options

| flag                 | default        | meaning                                             |
|----------------------|----------------|-----------------------------------------------------|
| `--selfcheck`        | off            | wiring check only; no model is loaded               |
| `--models a,b`       | all configured | subset, e.g. `--models deep,fast`                   |
| `--warmup N`         | `1`            | discarded warmup iterations                         |
| `--iters M`          | `3`            | timed iterations                                    |
| `--maxTokens N`      | `256`          | tokens to decode per generation                     |
| `--prefill a,b`      | `128,1024`     | target prompt token sizes for prefill               |
| `--ctx N`            | derived        | override context size (else max prefill + maxTokens + 512) |
| `--cpu`              | off            | force CPU (no CUDA)                                  |
| `--label NAME`       | ISO timestamp  | output filename + report label (see note below)     |
| `--out DIR`          | `./baselines`  | output directory                                    |

> **Label note:** the default label is `new Date().toISOString()` (made filesystem-safe).
> If `Date` is restricted in the execution context, it falls back to `bench-latest`.
> Pin a stable name with `--label 2026-07-05-rtx5090`.

Examples:

```bash
# deep + fast only, 5 timed iters, custom label
node scripts/ai-bench/bench.mjs --models deep,fast --iters 5 --label 2026-07-05-rtx5090

# just the embedding model
node scripts/ai-bench/bench.mjs --models embed

# CPU baseline
node scripts/ai-bench/bench.mjs --cpu --models fast
```

---

## Output

Written to `scripts/ai-bench/baselines/<label>.json`:

```jsonc
{
  "schemaVersion": 1,
  "label": "2026-07-05T...Z",
  "hardware": { "gpuName", "vramTotalMib", "cpu", "cpuCores", "totalMemGb", "platform", "nodeVersion" },
  "engine":   { "nodeLlamaCppVersion", "gpuMode" },
  "config":   { "warmup", "iters", "maxTokens", "prefillTargetTokens", "gpu", "modelsDir" },
  "models": [
    {
      "logical": "deep", "file": "...", "modelId": "...", "sizeGb": 17.2,
      "loadTimeMs": 4210,
      "engineVram": { "totalMib", "usedMib", "freeMib" },
      "vram": { "baselineUsedMib", "peakUsedMib", "modelDeltaMib", "samples": [...] },
      "contextSize": 1792,
      "results": [
        { "prefillTargetTokens": 128, "promptTokens": 141,
          "prefillTokPerSec": { "median": 3200, ... },
          "decodeTokPerSec":  { "median": 95, ... },
          "ttftMs": {...}, "totalMs": {...}, "genTokens": {...}, "rawIters": [...] }
      ]
    }
  ],
  "skipped": [ { "logical": "code", "env": "GGUF_CODE_MODEL", "reason": "env unset" } ]
}
```

Embed models report `embedMs` + `inputTokPerSec` + `dimensions` instead of prefill/decode.

## Compare runs

Baselines are plain JSON. To compare two runs, diff them or read the medians, e.g.:

```bash
# quick eyeball
node -e "const a=require('./scripts/ai-bench/baselines/A.json'),b=require('./scripts/ai-bench/baselines/B.json');\
for(const m of a.models){const n=b.models.find(x=>x.logical===m.logical);if(!n||!m.results)continue;\
for(const r of m.results){const s=n.results.find(y=>y.prefillTargetTokens===r.prefillTargetTokens);\
if(s)console.log(m.logical,'@',r.prefillTargetTokens,'decode',r.decodeTokPerSec.median,'->',s.decodeTokPerSec.median,'tok/s');}}"
```

A model that is not present on disk / not a valid GGUF is **skipped** (recorded in
`skipped[]`), never fails the run — so the same command works on any host with a
subset of the models.

---

## Notes / limitations

- Prefill throughput uses `LlamaChatSession` + `onTextChunk` for TTFT. The chat
  template adds a few tokens, so `promptTokens` is a close approximation of the
  tokens actually prefilled (dominant at 1k+ prompts).
- `fim` is measured with the same text path as a proxy (no model-specific FIM
  template) — good enough for a throughput baseline of the small model.
- Peak VRAM is system-wide `nvidia-smi` "used" (includes other processes). With
  two agents/models contending for VRAM, run the bench in isolation for a clean
  baseline.
