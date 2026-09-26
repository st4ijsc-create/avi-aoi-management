# 71 — Bootstrap-First-Classifier Runbook + "No Active Classifier" Health Signal

**doc69 Wave 6 (F1), 2026-07-26. Updated same day — F1 review fix (servability).** Scope: CODE + RUNBOOK.
No live GPU training was run to produce this doc — the workflow is unit-tested with the DB/fs boundaries
**mocked**, while the real pure trainer/eval math runs against small synthetic embeddings (see §7). Actually
running it against real labeled images is the ops step this runbook documents.

## 0. F1-review update — the workflow now produces a classifier that ACTUALLY runs

The original F1 build trained via `aiLocalTraining.runFewShotLearning`, producing a `format:"CUSTOM"`
artifact with no `metadata.headKind`. A review verified this against `aiInferenceEngine.runInference`'s real
dispatch (`server/services/aiInferenceEngine.ts:363-384`) and found it **only** special-cases the DINOv2
**embedding-head** shape (`isEmbeddingHeadModel()` + `AOI_DL_HEAD_ENABLED=true`) — every other `ACTIVE`
model, including the few-shot artifact the original workflow produced, falls through to the raw ONNX
session path and **throws**. So a "successful" bootstrap could register, gate-pass, and **activate** a model
that would throw the moment anything called `runInference` against it — the health banner would go dark
while inference was still broken.

**Fixed:** `bootstrapFirstClassifier` now trains **only** via the DINOv2 embedding-head pipeline
(`server/services/ai/embeddingHead.ts` + `embeddingHeadTrainer.ts`) — the one classifier shape
`runInference` can dispatch. `aiLocalTraining.runFewShotLearning` is no longer wired into this workflow at
all (see §8). `aiClassifierHealth.checkActiveClassifierHealth` was fixed alongside it: it now decides
"healthy" using `embeddingHead.isServableByInferenceEngine` — the SAME predicate that mirrors
`runInference`'s dispatch — instead of only checking the `AOI_DL_HEAD_ENABLED`-off case, and it evaluates
**every** ACTIVE classifier row (not just the first) so a stale/unservable row can't hide a genuinely
servable one, or the reverse.

**Still true — servable ≠ automatically live in production.** Two more prerequisites, both pre-existing and
outside this workflow's control, still gate whether a bootstrapped classifier is actually reachable:

- `AOI_DL_HEAD_ENABLED=true` — required for `runInference` to dispatch the head path at all (default OFF).
  `aiClassifierHealth` reports `hasActiveClassifier:false` with an explicit reason when it's off, so the
  banner will not lie even right after a "successful" bootstrap.
- `AOI_EMBEDDING_ENABLED=true` — required for embeddings to be captured into `ai_image_embeddings` in the
  first place (default OFF, see `server/services/aoiImageEmbeddingWorker.ts`). With it off there is nothing
  to count, so bootstrap's honesty pre-check honestly reports "insufficient labeled samples" — it never
  fabricates a classifier from zero real data.

## 1. What this solves

The quality-gate / A-B testing / active-learning superstructure (docs 24, 44, 69 G1) is fully built, but on
a fresh install (or this repo's current DB state) there is **no trained defect classifier on disk** — only
the DINOv2 feature extractor. Every one of those subsystems is silently **inert** until an `ai_models` row
with `modelType='classification'` and `status='ACTIVE'` exists **and is servable**:

- `evaluateQualityGate` has nothing to compare against.
- The A/B canary (`aiABTesting`) has no candidate/production pair.
- `runInference` throws `"Model ... is not active"` for any classification request when nothing is ACTIVE —
  or, before the F1-review fix, could throw a DIFFERENT error (ONNX-parse failure) for an ACTIVE-but-wrong-shape model.

Operators had no way to **see** this, and no single action to fix it. This task adds:

1. A **health signal** (`aiModel.classifierHealth`) + a banner on `AIModelManagementPage` and
   `AIBrainDashboard` that tells operators plainly: no *servable* ACTIVE classifier, here's why, here's the
   action.
2. A **`bootstrapFirstClassifier`** admin workflow that wires the *existing* pieces end-to-end (DINOv2
   embedding-head train → eval → quality gate → register → gated activate) behind one button, honest about
   insufficient data, and producing a classifier that is genuinely dispatchable.

## 2. Step 0 findings (what already existed)

| Piece | File | Role |
|---|---|---|
| Trainer (used by this workflow) | `server/services/ai/embeddingHeadTrainer.ts` — `trainEmbeddingHead` | Pure multinomial-logistic-regression head over the base DINOv2 model's frozen embeddings. Deterministic, seeded. |
| Orchestration + serving glue | `server/services/ai/embeddingHead.ts` — `snapshotEmbeddingDataset` / `evaluateOnSplit` / `writeHeadArtifact` / `isEmbeddingHeadModel` / `isServableByInferenceEngine` | Dataset snapshot + eval + artifact persistence + the SAME shape-detection/servability predicates `runInference` and the health check both reuse. |
| Dispatch (verified) | `server/services/aiInferenceEngine.ts` — `runInference` (lines ~363-384) | Only dispatches to the embedding-head path when `isEmbeddingHeadModel(model) && AOI_DL_HEAD_ENABLED`; every other ACTIVE model falls through to a raw ONNX session, which throws on a non-ONNX file. |
| Quality gate | `server/services/aiEvalHarness.ts` — `evaluateQualityGate` | Shared by BOTH the embedding-head pipeline and the (retrain) `aiTrainingPipeline` — the gate blocks any accuracy regression (default epsilon 0). |
| Registry | `server/db/ai.ts` — `ai_models` / `model_versions` | `ai_models.status` is the field `runInference` gates on; `ai_models.format` + `metadata.headKind` is the shape `isEmbeddingHeadModel` reads. |
| Gated activation | `server/services/aiModelService.ts` — `activateModelVersionManual` (W0-2, doc 69) | The ONLY activation path that **re-checks** `evalReport.gate.pass` before flipping a version ACTIVE; used by the admin UI's `activateVersion` mutation and by this workflow. |
| Dropped from this workflow | `server/services/aiLocalTraining.ts` — `runFewShotLearning` / `predictWithLocalClassifier` | Still exists as a standalone, lower-level training API. `predictWithLocalClassifier` does NOT parse the DINOv2 embedding-head artifact shape (verified — it only recognizes its own `prototypical_network` / softmax-weights JSON), and `runInference` never dispatches to it — see §8. |

Confirmed: on a fresh/typical DB there is **no** `ai_models` row with `modelType='classification'` and
`status='ACTIVE'` — the gate really is inert, matching the original doc69 audit.

## 3. Check today whether you have a *servable* active classifier

**UI:** open `/ai-models` (AI Model Management) or `/ai-brain` (AI Brain). If no *servable* classifier is
ACTIVE, an amber banner appears: *"Chưa có model phân loại lỗi ACTIVE"* with the specific reason underneath
(no classifier at all / a head is registered but `AOI_DL_HEAD_ENABLED` is off / an ACTIVE model exists but
isn't a shape `runInference` can dispatch / a seeded head artifact exists unregistered).

**API:** `trpc.aiModel.classifierHealth` (query, any authenticated user):

```jsonc
// hasActiveClassifier: false (nothing registered yet)
{
  "hasActiveClassifier": false,
  "reason": "No ACTIVE defect-classifier model exists. The quality-gate / A-B testing / active-learning pipeline is inert (nothing to validate against) until a classifier is bootstrapped.",
  "checkedAt": "2026-07-26T08:00:00.000Z"
}
```

Fail-safe: `checkActiveClassifierHealth()` (`server/services/aiClassifierHealth.ts`) never throws and never
reports `true` on a lookup error — a DB error reports `hasActiveClassifier:false` with the error as `reason`.
It also never reports `true` just because *something* is ACTIVE — it evaluates every ACTIVE classifier row
via `embeddingHead.isServableByInferenceEngine` and only reports `true` when at least one is genuinely
dispatchable.

## 4. Provide labeled samples (the real prerequisite)

`bootstrapFirstClassifier` trains on **stored embeddings**, so the honesty pre-check counts REAL rows from
the pool the trainer actually draws from:

1. `ai_image_embeddings` rows for the base model's `code` (`modelCode` column) — captured automatically
   during normal inspection processing, but **only when `AOI_EMBEDDING_ENABLED=true`**
   (`server/services/aoiImageEmbeddingWorker.ts`, default OFF). With the flag off, no embeddings are ever
   stored, so the count is always zero and bootstrap will honestly report "insufficient labeled samples" —
   it will not fabricate a classifier.
2. A human label attached to that same image, from `ai_label_queue.humanLabel` (`status='LABELED'`) —
   written by `/ai-active-learning` when a human reviews a queued image.

**How many:** by default, **>= 5 REAL labeled+embedded samples per requested class** (`minSamplesPerClass`).
More (10-20/class) gives a materially more reliable head and a non-trivial locked test split.

**Where:** (a) turn on `AOI_EMBEDDING_ENABLED` so inspections through the **base feature-extractor model**
(its `ai_models.id`, e.g. the DINOv2 embedding model) get an `ai_image_embeddings` row, and (b) label those
images via `/ai-active-learning` (queue → review → assign a human label). The workflow counts samples
against the same `baseModelId`.

**For real (non-degraded) accuracy**, `AI_DINOV2_MODEL_PATH` should point at a real DINOv2 ONNX model —
without it, embeddings degrade to a text-of-image fallback (still round-trips, but accuracy reflects the
degraded features — see `embeddingHead.ts`'s header comment).

## 5. Run the bootstrap

**UI:** on `/ai-models`, click **"Bootstrap model đầu tiên"** on the health banner. Fill in:

- **Model gốc** — the base feature-extractor (`ai_models` row, e.g. DINOv2) whose embeddings the head trains on.
- **Mã classifier** — a new registry code for the classifier itself (e.g. `bootstrap-defect-classifier`).
- **Nhãn lỗi** — >= 2 comma-separated class labels (e.g. `OK, scratch, crack`) — must match the labels
  actually used when reviewing/labeling in §4 (case/whitespace-insensitive matching). Any OTHER labeled
  class present in the embedding pool that is NOT in this list is excluded from training — the classifier
  predicts exactly the classes requested, nothing wider.
- **Số mẫu tối thiểu / lớp** — defaults to 5.

**API:** `trpc.aiEval.bootstrapFirstClassifier` (adminProcedure mutation):

```jsonc
{
  "baseModelId": 3,
  "classifierCode": "bootstrap-defect-classifier",
  "classLabels": ["OK", "scratch", "crack"],
  "minSamplesPerClass": 5
}
```

## 6. What happens under the hood

`server/services/aiBootstrapClassifier.ts` — `bootstrapFirstClassifier()`:

1. **Honesty gate** — counts REAL labeled+embedded samples per requested class (from
   `ai_image_embeddings` ⋈ `ai_label_queue` human labels, via `embeddingHead.collectHeadTrainingPairs`). Any
   class short of `minSamplesPerClass` → throws `InsufficientLabeledSamplesError` naming exactly which
   class(es) and how many are missing. **Nothing is created** — no dataset snapshot, no registry row, no
   model file.
2. **Locked embedding-dataset snapshot** — collects + assembles + persists an immutable
   `ai_embedding_datasets` row (`embeddingHead.snapshotEmbeddingDataset`), unless an existing `datasetId` was
   supplied. The snapshot is then restricted to EXACTLY the requested `classLabels` (other labeled classes
   present in the pool are dropped, not silently trained on).
3. **Registry identity** — creates (or reuses) a dedicated `ai_models` row for the classifier
   (`format: "CUSTOM"`, `metadata.headKind` set to the embedding-head marker — the exact shape
   `isEmbeddingHeadModel()` recognizes), **separate** from the base feature-extractor's row so activation
   never overwrites the base model's `filePath`/`status`. Reusing an existing `classifierCode` that is NOT
   already an embedding-head shape is refused outright (rather than silently registering a head artifact
   under an incompatible row).
4. **Train** — `embeddingHeadTrainer.trainEmbeddingHead` (multinomial-logreg head over the locked train/val
   split of the frozen embeddings). A trainer-reported failure (e.g. too few rows survive the split) aborts
   here too — still no registry row.
5. **Eval + gate** — `embeddingHead.evaluateOnSplit` on the locked **test** split (falling back to **val**
   when test is empty) + `aiEvalHarness.evaluateQualityGate`, against the classifier's current ACTIVE
   version if one already exists (a re-bootstrap), or auto-PASS if this is genuinely the first version.
6. **Register** — `createModelVersion` — **always**, with the real accuracy/precision/recall/F1 and the full
   eval report, status `READY`, even on a gate FAIL (so the attempt is auditable).
7. **Activate — only on a gate PASS** — via `aiModelService.activateModelVersionManual` (the W0-2 gated
   path), which **independently re-checks** `evalReport.gate.pass` before flipping `ai_models.status` to
   `ACTIVE`. A gate FAIL leaves the version `READY`, untouched — never silently activated.

## 7. Tests (DB/fs mocked; real pure trainer/eval math on synthetic embeddings)

`server/services/aiBootstrapClassifier.test.ts` — DB/fs touchpoints are dependency-injected, but
`trainHead`/`evaluateHead`/`splitDataset` are left un-mocked by default so the REAL
`trainEmbeddingHead`/`evaluateOnSplit` run against small deterministic synthetic embeddings (same technique
as `embeddingHead.test.ts`). Covers: gate PASS with real training → registered **and** activated via the
gated path, AND the registered `ai_models` shape is verified `isEmbeddingHeadModel()===true` directly (the
core servability claim); gate FAIL → registered but **not** activated; insufficient labeled samples →
`InsufficientLabeledSamplesError` **before** any dataset/training/registration (no model fabricated); a
trainer-reported failure aborts before registration; re-bootstrap compares real accuracy against an existing
ACTIVE baseline; a supplied `datasetId` loads the locked snapshot instead of building a fresh one; training
is restricted to exactly the requested `classLabels` even when the embedding pool has other labeled classes.

`server/services/aiClassifierHealth.test.ts` — no classifier → `false` + reason; a real (ONNX) ACTIVE
classifier → `true`; an ACTIVE embedding-head with `AOI_DL_HEAD_ENABLED` off → `false`; an ACTIVE
`format:"CUSTOM"` artifact that is NOT an embedding-head (e.g. a leftover few-shot classifier) → `false`
("not a shape runInference can dispatch"), never a false "healthy"; **multiple** ACTIVE classifier rows,
one servable → `true`, surfacing the servable one even if it isn't first; multiple ACTIVE rows, none
servable → `false` with an aggregate reason naming all of them; a lookup error → `false` (fail-safe, never
fabricates healthy).

Run:
```
NODE_OPTIONS=--max-old-space-size=8192 npx vitest run \
  server/services/aiBootstrapClassifier.test.ts \
  server/services/aiClassifierHealth.test.ts \
  server/services/aiEvalHarness.test.ts \
  server/services/aiTrainingPipeline.tier2.test.ts \
  server/services/ai/embeddingHead.test.ts \
  server/services/ai/embeddingHeadClassBalance.test.ts \
  server/services/ai/modelStagePipeline.test.ts \
  server/services/ai/modelAutoRollback.test.ts
```
74/74 passing (8 files). `npx tsc --noEmit` clean for every file touched (only the pre-existing, unrelated
`client/src/pages/SessionManagement.tsx(194,64)` error remains).

## 8. What was dropped, and the remaining fast-follow

`aiLocalTraining.runFewShotLearning` (and `predictWithLocalClassifier`) are **no longer wired into
`bootstrapFirstClassifier`** — they remain available as a standalone, lower-level training API for
advanced/manual use, but this workflow does not call them. Verified: `predictWithLocalClassifier` does not
parse the embedding-head artifact shape either (it only recognizes its own `prototypical_network` /
softmax-weights JSON), and `aiInferenceEngine.runInference` never dispatches to it regardless — wiring it
back into this workflow, even as an opt-in, would let an admin re-create the exact "ACTIVE but throws at
inference" state the F1 review fix exists to close.

**Fast-follow** (out of this task's scope): extend `aiInferenceEngine.runInference`'s dispatch to also serve
`aiLocalTraining`-produced artifacts (`format:"CUSTOM"` + `metadata.bootstrapKind`, mirroring the
embedding-head dispatch), at which point that trainer could be re-offered here as a genuine, servable
alternative — e.g. for base models where DINOv2 embeddings aren't available. Until then, `aiLocalTraining`
should be treated as a research/manual API, not a production activation path — the health check
(`isServableByInferenceEngine`) will correctly flag anything ACTIVE in that shape as **not** servable.

## 9. Rollback

Bootstrapping a version never touches an existing production classifier's `ACTIVE` version unless the gate
passes on a genuine improvement (compared against that same classifier code's current baseline). To undo an
unwanted activation, use the existing admin flow: `activateVersion` on a prior version, or
`aiModelService.activateModelVersionManual(modelId, versionId, { force: true, reason })` to force an
explicit override (always audited via `audit_logs`).
