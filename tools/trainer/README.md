# Local Sidecar Trainer (WS-1 Tier 2 / B8)

> **Scaffolding, opt-in, default OFF.** This is the optional Python deep-training
> tier for the AI self-learning loop. The default pipeline (Tier 1 — a softmax /
> prototypical classifier on frozen ONNX embeddings, pure Node) needs none of
> this and is unchanged whether or not you enable the sidecar.

## What it is

A **file-based contract** between the Node server
(`server/services/localSidecarTrainer.ts`) and an external Python process that
does real gradient training (PyTorch / Ultralytics) and exports an ONNX model.

```
Node                                         Python sidecar
────────────────────────────────────────    ─────────────────────────────────
buildDataset(datasetId)  → JSONL manifests
write  <jobDir>/job.json
spawn  LOCAL_TRAINER_CMD <jobDir>   ───────►  read job.json
poll   <jobDir>/progress.json  ◄───────────  write progress.json (atomic / epoch)
                                              export <jobDir>/output/model.onnx
read   output/result.json + model.onnx ◄───  write result.json
copy ONNX → uploads/models/trained/sidecar_<jobId>_<version>.onnx
re-evaluate on LOCKED test split (quality gate = source of truth)
```

The server **never trusts** the sidecar's reported metrics for activation: after
the sidecar exits, Stages 3-6 of the pipeline re-evaluate the produced ONNX on
the locked test split and run the quality gate. The sidecar only has to train,
stream progress, and export a valid ONNX.

## Enabling it

1. Install Python 3.10+ and the trainer deps (operator-managed — not part of
   `pnpm install` or CI):

   ```bash
   python -m venv .venv
   . .venv/bin/activate          # Windows: .venv\Scripts\activate
   pip install -r tools/trainer/requirements.txt
   ```

   - **GPU (optional):** install the CUDA torch wheel from the official PyTorch
     index instead (see comments in `requirements.txt`). CPU works too, slower.
   - **Offline-first:** pre-cache pretrained backbones (set `TORCH_HOME`) so the
     trainer needs no network access at run time.

2. Set the server environment:

   | Env var                    | Meaning                                                                 |
   | -------------------------- | ----------------------------------------------------------------------- |
   | `LOCAL_TRAINER_CMD`        | Command to launch the sidecar, e.g. `python tools/trainer/train.py`. The server appends `<jobDir>` as the final argument. **Empty/unset → sidecar disabled (default).** |
   | `LOCAL_TRAINER_TIMEOUT_MS` | Hard timeout for one training run (ms). Default `7200000` (2 h). On timeout the process is killed and the job fails. |

   The command is split on whitespace and spawned **without a shell** (no
   injection). Use a wrapper script if you need shell features.

3. Start a pipeline with `trainingMode: "local-sidecar"` (via
   `aiEvalRouter.startPipeline`). If `LOCAL_TRAINER_CMD` is unset the dispatcher
   throws and the pipeline stays on Tier 1.

## File contract

### `job.json` (server → sidecar)

```jsonc
{
  "jobId": 42,
  "modelId": 7,
  "targetVersion": "1.3.0",
  "task": "classification",          // "classification" | "segmentation" | "detection"
  "framework": "pytorch",            // or "ultralytics"
  "classLabels": ["OK", "NG"],
  "manifests": {                     // absolute paths to JSONL
    "train": ".../uploads/datasets/12/train.jsonl",
    "val":   ".../uploads/datasets/12/val.jsonl",
    "test":  ".../uploads/datasets/12/test.jsonl"
  },
  "baseModelPath": ".../uploads/models/base.onnx",  // or null
  "imageRoot": ".../uploads",        // resolve imageUrl against this
  "config": { "epochs": 50, "batchSize": 32, "learningRate": 0.001, "imgSize": 224 },
  "output": {
    "dir":        ".../uploads/training/jobs/42/output",
    "modelPath":  ".../uploads/training/jobs/42/output/model.onnx",
    "resultPath": ".../uploads/training/jobs/42/output/result.json"
  },
  "progressPath": ".../uploads/training/jobs/42/progress.json",
  "logsDir":      ".../uploads/training/jobs/42/logs"
}
```

Manifest line (JSONL): `{"imageUrl": "/uploads/x/y.jpg", "label": "NG", "source": "label_queue"}`.
Strip a leading `/uploads/` and join the remainder under `imageRoot`.

### `progress.json` (sidecar → server, rewritten atomically every epoch)

```jsonc
{
  "phase": "training",               // training | exporting | done | failed
  "epoch": 7, "totalEpochs": 50,
  "loss": 0.21, "accuracy": 0.94,
  "valLoss": 0.30, "valAccuracy": 0.91,
  "progress": 0.14,                  // 0..1; server maps into its 30..75 band
  "metrics": { "loss": [...], "accuracy": [...], "valLoss": [...], "valAccuracy": [...] }
}
```

Write atomically (temp file + `os.replace`) so the poller never reads a
half-written file — the Node poller simply ignores any malformed/partial read.

### `result.json` (sidecar → server, once on success)

```jsonc
{
  "success": true,
  "modelPath": ".../output/model.onnx",
  "durationMs": 812345,
  "metrics": {                       // ADVISORY — server re-evaluates via gate
    "accuracy": 0.94, "precision": 0.93, "recall": 0.95, "f1Score": 0.94,
    "confusionMatrix": [[120, 5], [3, 98]]
  }
}
```

Exit code `0` **and** `output/model.onnx` present ⇒ success. Anything else (non-zero
exit, missing model, timeout) ⇒ the job is marked `FAILED` and **no** model
version is created.

## Segmentation mode (`task: "segmentation"`, Ultralytics YOLOv8-seg)

When `job.task == "segmentation"` the sidecar trains an **Ultralytics YOLOv8-seg**
instance model instead of the classification backbone. Classification is
unchanged (default task).

### Segmentation manifest line (JSONL)

```jsonc
{
  "imageUrl": "/uploads/x/y.jpg",
  "masks": [
    { "label": "scratch", "points": [[0.10, 0.12], [0.40, 0.12], [0.40, 0.55]] },
    { "label": "dent",    "points": [[0.60, 0.60], [0.80, 0.62], [0.78, 0.90]] }
  ],
  "source": "qc_segmentation"
}
```

- **`points` are NORMALIZED `0..1`** (`x = px / imageWidth`, `y = px / imageHeight`).
  Chosen so the manifest is resolution-independent and maps 1:1 to YOLO labels.
  `aiDatasetBuilder` produces this from `defect_segmentations` by dividing
  `maskData.points` by `maskData.width` / `maskData.height`.
- Each mask = one polygon (one instance) of one class. `label` must be in
  `job.classLabels`; polygons with `<3` points or unknown labels are skipped + logged.
- Images with no usable mask are skipped + logged.

### What the sidecar generates (under `<jobDir>/yolo_seg/`)

```
images/{train,val,test}/*.jpg
labels/{train,val,test}/*.txt    # each line: "class_idx x1 y1 x2 y2 ... xn yn" (normalized)
data.yaml                        # { path, train, val, test, names: {0: lbl, ...} }
```

YOLO training runs land under `<jobDir>/yolo_runs/seg/`. If no `val` split is
present it reuses `train` for `val` (so ultralytics validation can run).

### Offline-first model selection

- If `tools/trainer/yolov8n-seg.pt` exists locally → used as pretrained weights
  (best transfer learning).
- Otherwise → **from scratch** from the architecture YAML `yolov8n-seg.yaml`
  (ships inside the `ultralytics` package — no network needed). `yolov8n-seg`
  is the smallest variant, chosen for ~6GB VRAM. Keep `imgSize ≤ 320`,
  `batchSize ≤ 2` on 6GB; drop to `imgSize 256` / CPU on OOM.

### YOLOv8-seg ONNX output format (decoded by `aiSegmentation.decodeYoloSeg`)

```
output0  [1, 4 + nc + 32, N]      N anchors
           rows 0..3        = box (cx, cy, w, h) in PIXELS of imgsz
           rows 4..4+nc-1   = per-class scores (sigmoid-activated)
           rows 4+nc..+32   = 32 mask coefficients per anchor
output1  [1, 32, mh, mw]          32 mask prototypes
```

Per-instance mask = `sigmoid( coeff[32] · proto[32, mh*mw] )` reshaped `[mh,mw]`,
cropped to the box, thresholded at 0.5. The Node engine (`runSegmentation`)
detects the two-output YOLO-seg shape automatically (or via
`postprocessConfig.format == "yolo-seg"`) and routes to `decodeYoloSeg`; the
single-output semantic `[1,C,H,W]` / binary `[1,1,H,W]` paths are untouched.

### `result.json` metrics (segmentation)

`finalMetrics.accuracy` ≈ mask **mAP50** (also `precision/recall/f1Score` mirrored
to mAP50 as an advisory placeholder), plus extra fields `maskMAP50` and
`maskMAP5095`. As always these are **advisory** — the server re-evaluates the
exported ONNX through its own gate.

## Preprocessing must match Node

ONNX export must assume the same preprocessing the Node embedding path uses
(`aiLocalTraining.extractEmbeddings`):

- Resize to `imgSize` (default **224**), RGB, **NCHW** layout `[1, 3, H, W]`.
- Normalize `(x/255 - mean) / std` with ImageNet `mean=[0.485,0.456,0.406]`,
  `std=[0.229,0.224,0.225]`.
- Fixed **opset 13** for onnxruntime-node 1.24.x compatibility.

## Status

`train.py` is **scaffolding**: the contract I/O, manifest parsing, atomic
progress writes, and the function skeleton are implemented; the actual
`build_dataset` / `train_loop` / `export_onnx` bodies raise `NotImplementedError`
and must be completed by whoever enables this tier. This is intentional — the
project ships offline Tier-1 by default and does not depend on PyTorch.
