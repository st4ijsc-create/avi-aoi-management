# 71 — Bootstrap-First-Classifier Runbook + "No Active Classifier" Health Signal

**doc69 Wave 6 (F1), 2026-07-26.** Scope: CODE + RUNBOOK. No live GPU training was run to produce this
doc — the workflow is unit-tested with the trainer/eval **mocked** (see §7). Actually running it against
real labeled images is the ops step this runbook documents.

---

## 1. What this solves

The quality-gate / A-B testing / active-learning superstructure (docs 24, 44, 69 G1) is fully built, but on
a fresh install (or this repo's current DB state) there is **no trained defect classifier on disk** — only
the DINOv2 feature extractor. Every one of those subsystems is silently **inert** until an `ai_models` row
with `modelType='classification'` and `status='ACTIVE'` exists:

- `evaluateQualityGate` has nothing to compare against.
- The A/B canary (`aiABTesting`) has no candidate/production pair.
- `runInference` throws `"Model ... is not active"` for any classification request.

Operators had no way to **see** this, and no single action to fix it. This task adds:

1. A **health signal** (`aiModel.classifierHealth`) + a banner on `AIModelManagementPage` and
   `AIBrainDashboard` that tells operators plainly: no ACTIVE classifier, here's why, here's the action.
2. A **`bootstrapFirstClassifier`** admin workflow that wires the *existing* pieces end-to-end (few-shot
   train → eval → quality gate → register → gated activate) behind one button, honest about insufficient
   data.

## 2. Step 0 findings (what already existed)

| Piece | File | Role |
|---|---|---|
| Trainer | `server/services/aiLocalTraining.ts` — `runFewShotLearning` | Prototypical-network head over the base ONNX model's frozen embeddings. Needs >= 5 labeled samples/class by convention (`getTrainingCapabilities`). |
| Eval harness | `server/services/aiEvalHarness.ts` — `evaluateModelVersion` / `evaluateQualityGate` / `compareBeforeAfter` | Runs candidate (+ baseline, if any) over a **locked** dataset split; the gate blocks any accuracy regression (default epsilon 0). |
| Dataset builder | `server/services/aiDatasetBuilder.ts` — `collectDatasetSamples` / `buildDataset` | Materializes a stratified train/val/test split from `ai_label_queue` + `ai_feedback` into `uploads/datasets/<id>/*.jsonl`. |
| Registry | `server/db/ai.ts` — `ai_models` / `model_versions` | `ai_models.status` is the field `runInference` gates on. |
| Gated activation | `server/services/aiModelService.ts` — `activateModelVersionManual` (W0-2, doc 69) | The ONLY activation path that **re-checks** `evalReport.gate.pass` before flipping a version ACTIVE; used by the admin UI's `activateVersion` mutation and now by this workflow. |
| Reference pipeline | `server/services/aiTrainingPipeline.ts` — `runTrainingPipeline` | The existing **retrain** pipeline for an already-registered model; `bootstrapFirstClassifier` follows the same stage order (prepare data → train → eval → gate → register → activate) for the **first-time** case, with an added honesty pre-check. |
| Alternative trainer | `server/services/ai/embeddingHead.ts` — `trainAndRegisterHead` | The DINOv2-embedding-head pipeline (doc 24). This is the **only** classifier shape `aiInferenceEngine.runInference` actually dispatches to at serve time today (when `AOI_DL_HEAD_ENABLED=true`) — see §8. |

Confirmed: on a fresh/typical DB there is **no** `ai_models` row with `modelType='classification'` and
`status='ACTIVE'` — the gate is inert exactly as the doc69 audit found.

## 3. Check today whether you have an active classifier

**UI:** open `/ai-models` (AI Model Management) or `/ai-brain` (AI Brain). If no classifier is ACTIVE, an
amber banner appears: *"Chưa có model phân loại lỗi ACTIVE"* with the specific reason underneath (no
classifier at all / a head is registered but the flag is off / a seeded head artifact exists unregistered).

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

## 4. Provide labeled samples (the real prerequisite)

`bootstrapFirstClassifier` reads labeled samples from the **same two sources** the rest of the AI lifecycle
uses — no new labeling UI, no new table:

1. `ai_label_queue` rows with `status IN ('LABELED','AUTO_LABELED')`, scoped to the base model's id
   (`ai_label_queue.modelId`). This is what the Active-Learning page (`/ai-active-learning`) writes when a
   human reviews a queued image.
2. `ai_feedback` ⋈ `ai_suggestions` ⋈ `measurement_results`, scoped to the base model's `code` via
   `ai_suggestions.modelName`. This is what "correct/incorrect" feedback on an AI suggestion writes.

**How many:** by default, **>= 5 REAL labeled samples per requested class** (`minSamplesPerClass`, matches
`aiLocalTraining.getTrainingCapabilities`'s few-shot floor). More (10-20/class) gives a materially more
reliable prototype and a non-trivial locked test split — few-shot with exactly 5/class leaves very few
samples for val/test after the stratified split.

**Where:** label images via `/ai-active-learning` (queue → review → assign a human label) against the
**base feature-extractor model** you intend to bootstrap on top of (its `ai_models.id`, e.g. the DINOv2
embedding model). The workflow counts samples against that same `baseModelId`.

## 5. Run the bootstrap

**UI:** on `/ai-models`, click **"Bootstrap model đầu tiên"** on the health banner. Fill in:

- **Model gốc** — the base feature-extractor (`ai_models` row) to few-shot on top of.
- **Mã classifier** — a new registry code for the classifier itself (e.g. `bootstrap-defect-classifier`).
- **Nhãn lỗi** — >= 2 comma-separated class labels (e.g. `OK, scratch, crack`) — must match the labels
  actually used when reviewing/labeling in §4 (case/whitespace-insensitive matching).
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

1. **Honesty gate** — counts REAL labeled samples per requested class (reusing
   `aiDatasetBuilder.collectDatasetSamples`). Any class short of `minSamplesPerClass` → throws
   `InsufficientLabeledSamplesError` naming exactly which class(es) and how many are missing. **Nothing is
   created** — no dataset, no registry row, no model file.
2. **Registry identity** — creates (or reuses) a dedicated `ai_models` row for the classifier
   (`format: "CUSTOM"`, `modelType: "classification"`, `metadata.bootstrapKind`), **separate** from the base
   feature-extractor's row so activation never overwrites the base model's `filePath`/`status`.
3. **Locked dataset** — builds a fresh stratified train/val/test split (`aiDatasetBuilder.buildDataset`)
   unless an existing `datasetId` was supplied.
4. **Train** — `aiLocalTraining.runFewShotLearning` (prototypical network over the base model's embeddings).
   A trainer-reported failure (e.g. its own internal data-sufficiency check) aborts here too — still no
   registry row.
5. **Eval + gate** — `aiEvalHarness.compareBeforeAfter` (= `evaluateModelVersion` + `evaluateQualityGate`) on
   the locked **test** split, against the classifier's current ACTIVE version if one already exists (a
   re-bootstrap), or auto-PASS if this is genuinely the first version.
6. **Register** — `createModelVersion` — **always**, with the real accuracy/precision/recall/F1 and the full
   `evalReport`, status `READY`, even on a gate FAIL (so the attempt is auditable).
7. **Activate — only on a gate PASS** — via `aiModelService.activateModelVersionManual` (the W0-2 gated
   path), which **independently re-checks** `evalReport.gate.pass` before flipping `ai_models.status` to
   `ACTIVE`. A gate FAIL leaves the version `READY`, untouched — never silently activated.

## 7. Tests (trainer/eval mocked — no GPU, no live DB)

`server/services/aiBootstrapClassifier.test.ts` — every DB/trainer/eval touchpoint is dependency-injected;
covers: few-shot invoked → eval → gate PASS → registered **and** activated via the gated path; gate FAIL →
registered but **not** activated; insufficient labeled samples → `InsufficientLabeledSamplesError` **before**
training/registration (no model fabricated); a trainer-reported failure aborts before registration;
re-bootstrap compares against an existing ACTIVE baseline.

`server/services/aiClassifierHealth.test.ts` — no classifier → `false` + reason; a real ACTIVE classifier →
`true`; an ACTIVE head with `AOI_DL_HEAD_ENABLED` off → `false` (registry ≠ serving, see §8); a lookup error
→ `false` (fail-safe, never fabricates healthy).

Run: `npx vitest run server/services/aiBootstrapClassifier.test.ts server/services/aiClassifierHealth.test.ts`

## 8. Known limitation — registered ≠ served (be aware before relying on this in production)

`bootstrapFirstClassifier` registers the trained few-shot classifier as its own `ai_models` row
(`format: "CUSTOM"`, no `metadata.headKind`). **`aiInferenceEngine.runInference` does not yet dispatch this
artifact shape** — today it only special-cases the DINOv2 **embedding-head** shape
(`isEmbeddingHeadModel()` + `AOI_DL_HEAD_ENABLED=true`, see `server/services/ai/embeddingHead.ts`); every
other `ACTIVE` model falls through to the plain ONNX session path, which cannot load a JSON classifier
artifact. This is a **pre-existing gap** in `aiLocalTraining`-produced classifiers generally (the existing
`aiTrainingPipeline.runTrainingPipeline` retrain path has the exact same property), not something this task
introduced or attempted to silently paper over.

Practically:

- The health signal, registry, gate, and audit trail this task adds are **all real** — accuracy/F1 are
  computed from actual predictions on a locked test split, and activation genuinely requires passing the
  gate.
- A model bootstrapped this way is a real, auditable **registry** milestone (and unblocks anything that
  reads the registry, e.g. model cards, A/B experiment setup once a second version exists) — but calling
  `runInference` against it for a live inspection today would fail (ONNX session creation on a non-ONNX
  file), not silently return a wrong answer.
- **For a classifier that is genuinely LIVE-served today**, bootstrap via the DINOv2 head path instead:
  enable `AOI_DL_HEAD_ENABLED=true`, ensure DINOv2 embeddings exist (`ai_image_embeddings`, requires a real
  DINOv2 ONNX at `AI_DINOV2_MODEL_PATH` — see doc 24), and use
  `server/services/ai/embeddingHead.ts`'s `snapshotEmbeddingDataset` + `trainAndRegisterHead`. That pipeline
  IS dispatched by `runInference` today.
- **Fast-follow** (out of this task's scope): wire `aiInferenceEngine.runInference` to dispatch
  `format="CUSTOM"` + `metadata.bootstrapKind` models to `aiLocalTraining.predictWithLocalClassifier`,
  mirroring the embedding-head dispatch. Until then, treat a bootstrapped few-shot classifier as
  **validated-and-registered**, not yet **production-serving**.

## 9. Rollback

Bootstrapping a version never touches an existing production classifier's `ACTIVE` version unless the gate
passes on a genuine improvement (compared against that same classifier code's current baseline). To undo an
unwanted activation, use the existing admin flow: `activateVersion` on a prior version, or
`aiModelService.activateModelVersionManual(modelId, versionId, { force: true, reason })` to force an
explicit override (always audited via `audit_logs`).
