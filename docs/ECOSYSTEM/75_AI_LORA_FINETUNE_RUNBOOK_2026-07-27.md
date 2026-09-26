# 75 — AI LoRA/QLoRA Fine-Tune Runbook (doc69 Giai đoạn 5 / Wave E3, task E3-6)

Status: CODE + RUNBOOK shipped. Default OFF (`LLM_FINETUNE_CMD` unset). No live GPU fine-tune,
GGUF conversion, or activation has been run as part of this task — everything below is either
verified by mocked unit tests or is an OPS step for an operator with a GPU to run for real.

## 1. What this is (and isn't) — read this first

An operator-managed, **gated** pipeline: train a LoRA adapter on a Knowledge & Training Studio
corpus (`kb_studio_chunks`, doc69 E3-1/E3-2), convert it to a standalone GGUF, and register it as
a `model_versions` row that lands in the **same eval → gate → activate path as every other model**
in this codebase. It is a subsystem an operator opts into, not a default — the RAG-grounded local
chat/RCA answer path stays the fast, always-on default regardless of whether this is ever enabled.

### Honest framing — LoRA teaches STYLE, not FACTS

A LoRA adapter shifts the base model's **phrasing, format, and domain idiom** — how it structures
an answer, what terminology/tone it prefers — because it was shown examples of that in the
fine-tune corpus. It does **not** teach the model new facts it didn't already know, and it does
not replace retrieval. **Facts stay in RAG**: the KB corpus is retrieved at answer time regardless
of which adapter/model is currently active. Combine LoRA (style) with RAG (facts) — never treat a
LoRA fine-tune as a way to "teach the model the KB"; that's what the RAG retrieval path already
does, every request, without any training at all.

### Never auto-activated

`aiLlmFinetuneSidecar.startLoraFinetune` registers a **new, NOT-active** `model_versions` row
(`status: "VALIDATING"` → `"READY"` once its own independent eval completes) and stops. Activating
it — flipping `status` to `"ACTIVE"` and making it the model actually served — is a **separate,
human-driven step**: the existing `aiModelRouter.activateVersion` tRPC mutation →
`aiModelService.activateModelVersionManual`, which independently re-checks:

- the **eval quality gate** (`evalReport.gate.pass === true`), and
- the **D3 model-card gate** (`AI_MODEL_CARD_REQUIRED`, if enabled),

before allowing activation — `force:true` + a non-empty audited `reason` is the only override. This
is the exact same gate every vision model version goes through; a LoRA version gets no special
treatment or shortcut.

## 2. Architecture — mirrors the existing vision sidecar

This subsystem is a straight structural mirror of the existing, already-shipped Tier-2 vision
trainer (`server/services/localSidecarTrainer.ts` + `tools/trainer/train.py`) — read that pair
first if you haven't. Same file-based, no-shell contract:

```
Node (server/services/aiLlmFinetuneSidecar.ts)      Python sidecar (tools/trainer/finetune_lora.py)
──────────────────────────────────────────────     ─────────────────────────────────────────────────
1. listCorpusChunksForTraining(corpus)  → bounded, deterministic train/test JSONL split
2. mkdir  uploads/training/jobs/lora/<jobId>/{output,logs,dataset}
3. write  <jobDir>/job.json                    ──►  read job.json
4. spawn  LLM_FINETUNE_CMD <jobDir>            ──►  load base HF checkpoint + tokenizer (offline)
   (NO shell — arg array, no injection)              apply LoRA (peft.LoraConfig)
                                                       train (manual loop, atomic progress.json/epoch)
                                                       merge_and_unload() + save merged HF checkpoint
                                                       convert_hf_to_gguf.py (llama.cpp) → model.gguf
                                                       evaluate held-out loss (ADVISORY)
                                                       write result.json
5. exit code 0 + output/model.gguf present  ◄──
   → read result.json (ADVISORY metrics — never trusted for the gate)
   → copy GGUF → uploads/models/trained/lora_<jobId>_<version>.gguf
   → createModelVersion(status:"VALIDATING", NOT active)
   → evaluateLoraCandidate() — INDEPENDENT eval on the LOCKED held-out test split
   → persistEvalReport() (reuses aiEvalHarness.evaluateQualityGate + persistEvalReport)
   → updateModelVersion(status:"READY")
   → STOP. Activation is a separate human step (see §1).

   otherwise (timeout / non-zero exit / ENOENT / no GGUF) → typed error, NO model_versions row,
   job directory removed (fs.rmSync, best-effort).
```

### Why the eval step doesn't call `aiEvalHarness.evaluateModelVersion`/`compareBeforeAfter` directly

Those two functions are ONNX-image-classifier-specific: they load an image file and run
`predictWithLocalClassifier(modelId, classifierPath, imagePath)` against a `{imageUrl,label}`
manifest — there is no image, no label, and no ONNX classifier here. Instead,
`aiLlmFinetuneSidecar.evaluateLoraCandidate` reuses the **same shared primitives** those functions
are themselves built on:

- `aiMetrics.buildConfusionMatrix` / `computeMetrics` for the metric math,
- `aiEvalHarness.evaluateQualityGate` for the pass/fail decision,
- `aiEvalHarness.persistEvalReport` for writing `model_versions.metrics` / `.evalReport`,

so the resulting `evalReport` is structurally **identical** to a vision model's `CompareReport` —
`activateModelVersionManual`'s `evalReport.gate.pass` check works without caring which model type
produced it.

The eval method itself: for each held-out test chunk, split it into a prompt prefix (~40% of its
words) and the expected completion (the rest), ask the **candidate** GGUF to continue the prompt,
and score the lenient word-overlap between the generation and the expected completion. This is a
deliberately simple **style/vocabulary similarity** signal — consistent with "LoRA=style, not
facts" — not a semantic-correctness judge. If the base model already has an `ACTIVE` version, that
version's GGUF is used as the comparison baseline (same "regression vs. current production"
pattern `aiTrainingPipeline.ts` uses for vision models); with no baseline, the gate simply accepts
the candidate as the first version.

### Why the training-data source is `kb_studio_chunks` only

The existing `aiDatasetBuilder.ts` (image classification / segmentation datasets) was
investigated per the task brief and ruled out: every sample shape there is `{imageUrl,label}` or
`{imageUrl,masks}` — image/label data, fundamentally incompatible with LLM text fine-tuning. LoRA
training text is read exclusively from the Knowledge & Training Studio's `kb_studio_chunks` table
(doc69 E3-1/E3-2) via a new `kbStudioService.listCorpusChunksForTraining(corpus, limit)` — bounded,
deterministically ordered. Training records are plain completion-style `{"text": "..."}` lines
(the raw corpus chunk text) — **not** synthesized instruction/answer pairs; this subsystem never
fabricates Q&A that wasn't in the source corpus.

## 3. GPU / hardware requirements

- An NVIDIA RTX-class GPU (Ampere or newer recommended for `bfloat16`). CPU-only LoRA is possible
  for a tiny smoke test but impractically slow for anything real.
- VRAM, full-precision LoRA (`quantization: "none"`): roughly the base model's own inference VRAM
  footprint **plus** optimizer state for the (small) trainable LoRA parameters — a 7-8B model in
  `bfloat16` needs on the order of 16-20GB VRAM to fine-tune comfortably at a small batch size.
- VRAM, QLoRA (`quantization: "4bit"` or `"8bit"`): substantially lower — a 7-8B model in 4-bit can
  often fit in ~8-12GB VRAM, at the cost of slower training and a `bitsandbytes` dependency.
- **`bitsandbytes` (QLoRA) is Linux/CUDA-first.** On Windows, run the sidecar under **WSL2** if
  you need 4-bit/8-bit quantization; full-precision LoRA (`quantization: "none"`) works natively
  on Windows without it.

## 4. Install

```bash
python -m venv .venv-lora
. .venv-lora/bin/activate          # Windows: .venv-lora\Scripts\activate
pip install -r tools/trainer/requirements-lora.txt
```

This is a **separate** requirements file from `tools/trainer/requirements.txt` (the existing
vision/ONNX trainer's deps, untouched by this task) — a LoRA operator does not need
torchvision/onnx/ultralytics, and a vision-sidecar operator does not need
transformers/peft/bitsandbytes. See `tools/trainer/requirements-lora.txt`'s header comment for the
CUDA torch wheel note and the QLoRA/WSL2 caveat above.

### GGUF conversion — a local `llama.cpp` checkout is required, separately

`finetune_lora.py`'s `merge_and_export_gguf` shells out to `convert_hf_to_gguf.py` from a **local**
`llama.cpp` checkout (not a pip package):

```bash
git clone https://github.com/ggml-org/llama.cpp
# no build needed for convert_hf_to_gguf.py itself, but its own light Python deps
pip install -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
```

Set the env var (see §5) to that script's absolute path.

### IMPORTANT — the base model must be a HuggingFace checkpoint DIRECTORY, not a `.gguf` file

`server/services/aiGgufEngine.ts` (the engine that actually serves local chat/RAG inference) only
ever loads a single `.gguf` file — a format `transformers`/`peft` cannot load or fine-tune
directly. `job.json`'s `baseModelPath` must point at the **original HuggingFace-format
checkpoint** (a directory with `config.json`, tokenizer files, and
`*.safetensors`/`pytorch_model.bin`) that your `.gguf` was quantized **from** — typically the same
local HF cache used to produce that GGUF in the first place. If you only kept the `.gguf`, fetch
(or re-locate) the original HF checkpoint before enabling this subsystem; there is no way to
recover it from the quantized GGUF alone.

### Why merge-then-convert, not adapter-only GGUF

`llama.cpp` actually ships **two** LoRA-adjacent conversion paths: `convert_lora_to_gguf.py`
(produces a small, separate adapter GGUF meant to be loaded *alongside* a base GGUF via `--lora`
at inference time) and merging the adapter into the base weights first, then running the normal
`convert_hf_to_gguf.py` on the merged model (produces one standalone GGUF). This subsystem
implements **only the second path**, deliberately: `aiGgufEngine.loadGgufModel`/`GgufModelConfig`
has no "base + LoRA adapter" loading mode today — it only ever loads one standalone `.gguf` file.
An adapter-only GGUF would not be servable by the existing engine without first extending it. A
LoRA-adapter-only GGUF path (smaller artifacts, multiple adapters swappable at load time without
re-merging) is a documented, **not-implemented-here** fast-follow for whoever extends the engine
to support `--lora` at load time.

## 5. Environment variables

| Env var | Meaning | Default |
| --- | --- | --- |
| `LLM_FINETUNE_CMD` | Command to launch the sidecar, e.g. `python tools/trainer/finetune_lora.py`. The server appends `<jobDir>` as the final argument. **Empty/unset → the entire subsystem is disabled.** Split on whitespace, spawned **without a shell** (no injection). | unset (OFF) |
| `LLM_FINETUNE_TIMEOUT_MS` | Hard timeout for one fine-tune run (ms). On timeout the sidecar process is `SIGKILL`ed and the job fails (typed error, job dir cleaned up). | `14400000` (4h) |
| `LLM_FINETUNE_MAX_SAMPLES` | Bound on how many `kb_studio_chunks` rows feed one fine-tune ("bounded, honest data assembly"). | `5000` |
| `LLM_FINETUNE_MIN_SAMPLES` | Minimum corpus size to even attempt a fine-tune (guarantees a non-trivial train **and** test split). Below this the request is refused **before** any spawn. | `10` |
| `LLAMA_CPP_CONVERT_SCRIPT` (Python-side, set for the sidecar process) | Absolute path to your `llama.cpp` checkout's `convert_hf_to_gguf.py`. Missing/absent → the sidecar fails with a clear error before wasting a training run's time (checked right before conversion, after training). | unset (required for a real run) |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | Set to `"1"` by `finetune_lora.py` itself (offline-first — no network access is attempted at train time; the base checkpoint must already be local). | forced `1` by the script |

## 6. The `job.json` file contract

Written by `aiLlmFinetuneSidecar.ts`, read by `tools/trainer/finetune_lora.py`:

```jsonc
{
  "jobId": "lora_1732600000000_a1b2c3d4",
  "baseModelId": 12,
  "targetVersion": "1.0.0-lora.1",
  "baseModelPath": "/abs/path/to/hf-checkpoint-dir",  // see §4's warning — NOT a .gguf
  "corpus": "vendor-x-manuals",                        // informational only, never used in a path/shell arg
  "manifests": {
    "train": "/abs/.../dataset/train.jsonl",
    "test":  "/abs/.../dataset/test.jsonl"              // LOCKED held-out split
  },
  "hyperparams": {
    "rank": 16, "alpha": 32, "epochs": 3, "learningRate": 0.0002,
    "quantization": "none",                             // "none" | "4bit" | "8bit"
    "maxSeqLen": 2048, "batchSize": 4
  },
  "output": {
    "dir":        "/abs/.../output",
    "adapterDir": "/abs/.../output/adapter",
    "ggufPath":   "/abs/.../output/model.gguf",
    "resultPath": "/abs/.../output/result.json"
  },
  "progressPath": "/abs/.../progress.json",
  "logsDir":      "/abs/.../logs"
}
```

Manifest line (JSONL): `{"text": "..."}` — a plain corpus chunk (not a synthesized instruction).

`result.json` (sidecar → Node, written once on success — **ADVISORY ONLY**, the Node side
independently re-evaluates the produced GGUF and never trusts these numbers for the activation
gate):

```jsonc
{
  "success": true,
  "ggufPath": "/abs/.../output/model.gguf",
  "durationMs": 3612000,
  "metrics": { "trainLoss": 0.82, "evalLoss": 0.91, "perplexity": 2.48, "samples": 812, "epochs": 3 }
}
```

Exit code `0` **and** `output/model.gguf` present ⇒ success. Anything else (non-zero exit, missing
GGUF, timeout) ⇒ the run fails, **no** `model_versions` row is created, and the job directory is
removed.

## 7. Triggering a run

Gated tRPC mutation `kbStudio.startFinetune` (`roleProcedure("admin","engineer").use(require2FA)`
— the same gate as the rest of the Training Studio router):

```ts
await trpc.kbStudio.startFinetune.mutate({
  baseModelId: 12,             // ai_models.id of the base model
  corpus: "vendor-x-manuals",  // kb_studio_chunks corpus name
  targetVersion: "1.0.0-lora.1",
  hyperparams: { rank: 16, quantization: "4bit" }, // all fields optional, defaults apply
});
```

This mutation **awaits the full run** (build data → spawn → wait for the sidecar to finish →
register → independent eval) and returns once it's done — it is not a fire-and-forget job kickoff.
A real GPU fine-tune is expected to take anywhere from tens of minutes to a few hours; the request
will be open that whole time. This is an accepted characteristic of this gated, ops-run subsystem
(not built as a background/polled job in this task) — a future fast-follow could move this behind
a job-queue + polling UI (mirroring `kb_ingest_jobs`'s pattern) if synchronous invocation proves
inconvenient in practice.

The Training Studio "Model Builder" tab (`client/src/components/kbStudio/ModelBuilderTab.tsx`,
built as a placeholder in E3-2) is **not** wired to this endpoint in this task — the button stays
disabled with "coming soon" copy. Wiring it up (a form for `baseModelId`/`corpus`/`targetVersion`/
hyperparameters, a submit calling `kbStudio.startFinetune`, and a result/progress view) is a
documented fast-follow; the endpoint itself is this task's deliverable.

## 8. Eval → gate → activate (HITL — never automatic)

1. `startFinetune` returns `{ jobId, status:"succeeded", versionId, version, gate, evaluated, skipped }`.
   `gate` is `null` if the independent eval step itself failed to run (the version is still
   registered — see §1 — just without an `evalReport`; `activateModelVersionManual` will refuse to
   activate it without an explicit `force:true` override).
2. Inspect the new version (AI Model Management UI, or `aiModel.getVersions` for `baseModelId`) —
   its `evalReport.gate.pass` reflects whether the independent eval considered it a non-regression
   relative to the current `ACTIVE` version (or, with no baseline, the first-version pass).
3. **Activate manually** — an admin/engineer with 2FA calls the existing
   `aiModel.activateVersion` mutation (→ `activateModelVersionManual`). This is the **exact same
   activation path** every vision model version goes through:
   - refuses if `evalReport.gate.pass !== true` (unless `force:true` + a non-empty `reason`,
     audited),
   - refuses if the D3 model-card gate is enforced and unsatisfied (same override),
   - on success, writes the governance audit row and flips the model's serving `filePath` to the
     new GGUF.
4. Nothing in this subsystem ever calls `activateModelVersion`/`activateModelVersionManual` itself,
   and it never reads `AI_AUTO_PROMOTE_ENABLED` — that flag is simply not consulted here. A LoRA
   version becomes servable **only** through the human-driven step above.

## 9. Verifying it's wired correctly (no live GPU needed)

- `LLM_FINETUNE_CMD` unset (default): `kbStudio.startFinetune` returns `FORBIDDEN` with a message
  naming `LLM_FINETUNE_CMD` — confirms the subsystem is inert by default.
- Unit tests (`server/services/aiLlmFinetuneSidecar.test.ts`) mock `child_process.spawn` and every
  DB/eval call — they verify the `job.json` contract shape, the no-shell arg-array spawn, the
  register→eval→STOP flow (and that activation is never triggered), and every fail-safe path
  (spawn error, non-zero exit, timeout, missing GGUF output, too-small/unmigrated corpus,
  missing base model) — including that a malicious corpus name cannot influence the spawned
  command or any filesystem path.
- `tools/trainer/finetune_lora.py` is **not** unit-tested (it's the ops-run artifact) — its syntax
  was checked with `python -m py_compile tools/trainer/finetune_lora.py`, not executed.

## 10. Known gaps / fast-follows

- **FE wiring**: the Model Builder tab's "Start fine-tune" button stays a disabled placeholder
  (§7).
- **No background job registry**: unlike the vision `training_jobs` table, a LoRA run has no
  polled/queryable job row while it's in flight — the tRPC call is synchronous end-to-end. A
  `kb_ingest_jobs`-style tracked-job table would be the natural next step if synchronous
  invocation proves inconvenient for a multi-hour run.
- **Adapter-only GGUF** (§4) is not implemented — only merge-then-convert.
- **Non-Llama-family base models**: `finetune_lora.py`'s `DEFAULT_TARGET_MODULES` (LoRA target
  projections) assumes a Llama/Qwen-style attention+MLP naming convention. A base model from a
  different architecture family may need a different target-module list — currently a module
  constant in the Python script, not a `job.json` field.
- **`datasetId` (a non-KB-corpus text source)** is not supported — only `kb_studio_chunks` corpora
  feed a fine-tune (see §2's dataset-source rationale).
