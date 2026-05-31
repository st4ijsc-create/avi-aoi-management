"""
Local Sidecar Trainer (WS-1 Tier 2 / B8) — SCAFFOLDING ONLY.

THIS IS NOT A DEFAULT DEPENDENCY OF THE PROJECT AND IS NOT RUN BY CI.
It is the Python side of the file-based contract driven by
`server/services/localSidecarTrainer.ts`. It runs ONLY when an operator:

  1. Installs Python + PyTorch / torchvision / onnx (and optionally
     ultralytics) themselves — see requirements.txt.
  2. Has pretrained weights available LOCALLY (offline-first: no network
     downloads at train time; set TORCH_HOME / pre-cache backbones).
  3. Sets the server env  LOCAL_TRAINER_CMD="python tools/trainer/train.py"
     (the server appends the job directory as the final argument).

The server NEVER trusts the metrics this script reports: after the sidecar
exits, the Node pipeline re-evaluates the produced ONNX on the LOCKED test
split through the quality gate. This script's job is simply: read job.json,
train, stream progress.json atomically, export model.onnx, write result.json.

────────────────────────────────────────────────────────────────────────────
FILE CONTRACT (all paths absolute; written by the server unless noted)

job.json (input):
  {
    "jobId": int,
    "modelId": int,
    "targetVersion": str,
    "task": "classification" | "detection",
    "framework": "pytorch" | "ultralytics",
    "classLabels": [str, ...],
    "manifests": { "train": path, "val": path, "test": path },   # JSONL
    "baseModelPath": path | null,                                 # pretrained ONNX
    "imageRoot": path,                                            # resolve imageUrl
    "config": { "epochs": int, "batchSize": int, "learningRate": float,
                "imgSize": int, ... },
    "output": { "dir": path, "modelPath": path, "resultPath": path },
    "progressPath": path,
    "logsDir": path
  }

manifest JSONL line: {"imageUrl": str, "label": str, "source": str}
  imageUrl may be a web path like "/uploads/x/y.jpg" → strip leading "/uploads/"
  and join under imageRoot; or already relative → join under imageRoot.

progress.json (output, rewritten atomically EVERY epoch):
  {
    "phase": "training" | "exporting" | "done" | "failed",
    "epoch": int, "totalEpochs": int,
    "loss": float, "accuracy": float,
    "valLoss": float, "valAccuracy": float,
    "progress": float,                 # 0..1 (server maps into its band)
    "metrics": { "loss": [...], "accuracy": [...],
                 "valLoss": [...], "valAccuracy": [...] }  # history (optional)
  }

result.json (output, written once on success):
  {
    "success": true,
    "modelPath": path,                 # == output.modelPath
    "durationMs": int,
    "metrics": { "accuracy": float, "precision": float, "recall": float,
                 "f1Score": float, "confusionMatrix": [[int, ...], ...] }
  }
────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import sys
import time

# ImageNet normalization — MUST match the Node preprocessing
# (aiLocalTraining.extractEmbeddings): resize to imgSize (default 224), RGB,
# NCHW, (x/255 - mean) / std.
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
DEFAULT_IMG_SIZE = 224
ONNX_OPSET = 13  # fixed opset for onnxruntime-node 1.24.x compatibility


# ── Atomic file write (progress.json must never be read half-written) ──
def _atomic_write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)  # atomic rename on the same filesystem


def load_job(job_dir):
    with open(os.path.join(job_dir, "job.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_image_path(image_url, image_root):
    """Resolve a manifest imageUrl against imageRoot (handles /uploads/ prefix)."""
    url = image_url.lstrip("/")
    if url.startswith("uploads/"):
        url = url[len("uploads/"):]
    # imageRoot already points at <cwd>/uploads, so join the remainder.
    return os.path.normpath(os.path.join(image_root, url))


def load_manifest(manifest_path, image_root, class_labels):
    """Parse a JSONL manifest into (abs_image_path, class_index) pairs."""
    label_to_idx = {lbl: i for i, lbl in enumerate(class_labels)}
    samples = []
    if not os.path.exists(manifest_path):
        return samples
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            label = rec.get("label")
            if label not in label_to_idx:
                continue
            img_path = resolve_image_path(rec["imageUrl"], image_root)
            samples.append((img_path, label_to_idx[label]))
    return samples


def build_dataset(samples, img_size):
    """
    Build a torch Dataset/DataLoader from (path, label) pairs.

    SCAFFOLDING: implement with torchvision.transforms (Resize(img_size),
    ToTensor, Normalize(IMAGENET_MEAN, IMAGENET_STD)) + a Dataset that loads
    each image via PIL. Skip / zero-fill missing files for robustness.
    """
    raise NotImplementedError(
        "build_dataset: install torch/torchvision and implement image loading "
        "(see requirements.txt). This is intentional scaffolding."
    )


def train_loop(job, train_data, val_data):
    """
    Train and stream progress.json atomically once per epoch.

    SCAFFOLDING outline:
      - Load backbone from job['baseModelPath'] (offline) or a locally cached
        torchvision model; replace the classifier head with len(classLabels).
      - For epoch in range(totalEpochs): train one epoch, evaluate on val,
        append to the metrics history, then:
            _atomic_write_json(job['progressPath'], { phase: "training",
              epoch, totalEpochs, loss, accuracy, valLoss, valAccuracy,
              progress=epoch/totalEpochs, metrics=history })
      - Return the trained torch model.
    """
    config = job.get("config", {})
    total_epochs = int(config.get("epochs", 50))
    # Demonstrate the progress contract so integrators see the exact shape.
    _atomic_write_json(job["progressPath"], {
        "phase": "training", "epoch": 0, "totalEpochs": total_epochs,
        "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
        "progress": 0.0,
        "metrics": {"loss": [], "accuracy": [], "valLoss": [], "valAccuracy": []},
    })
    raise NotImplementedError(
        "train_loop: implement the PyTorch fine-tuning loop. Scaffolding only."
    )


def export_onnx(model, job):
    """
    Export the trained model to job['output']['modelPath'] as ONNX.

    SCAFFOLDING:
      - classification (PyTorch): torch.onnx.export(model, dummy NCHW
        [1, 3, imgSize, imgSize], modelPath, opset_version=ONNX_OPSET,
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}}).
      - detection (ultralytics): YOLO(...).export(format="onnx",
        opset=ONNX_OPSET, imgsz=imgSize) then move the file to modelPath.
    """
    raise NotImplementedError("export_onnx: implement ONNX export. Scaffolding only.")


def write_result(job, metrics, duration_ms):
    _atomic_write_json(job["output"]["resultPath"], {
        "success": True,
        "modelPath": job["output"]["modelPath"],
        "durationMs": int(duration_ms),
        "metrics": {
            "accuracy": metrics.get("accuracy", 0.0),
            "precision": metrics.get("precision", 0.0),
            "recall": metrics.get("recall", 0.0),
            "f1Score": metrics.get("f1Score", 0.0),
            "confusionMatrix": metrics.get("confusionMatrix", []),
        },
    })


def main(job_dir):
    start = time.time()
    job = load_job(job_dir)
    config = job.get("config", {})
    img_size = int(config.get("imgSize", DEFAULT_IMG_SIZE))
    class_labels = job["classLabels"]

    try:
        train_samples = load_manifest(job["manifests"]["train"], job["imageRoot"], class_labels)
        val_samples = load_manifest(job["manifests"]["val"], job["imageRoot"], class_labels)

        train_data = build_dataset(train_samples, img_size)
        val_data = build_dataset(val_samples, img_size)

        model = train_loop(job, train_data, val_data)

        _atomic_write_json(job["progressPath"], {
            "phase": "exporting", "epoch": 0, "totalEpochs": 0,
            "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
            "progress": 1.0,
        })
        export_onnx(model, job)

        # Evaluate on TEST split here and fill these metrics (advisory; the
        # server re-runs the gate authoritatively).
        metrics = {"accuracy": 0.0, "precision": 0.0, "recall": 0.0,
                   "f1Score": 0.0, "confusionMatrix": []}
        write_result(job, metrics, (time.time() - start) * 1000)

        _atomic_write_json(job["progressPath"], {
            "phase": "done", "epoch": 0, "totalEpochs": 0,
            "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
            "progress": 1.0,
        })
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure to the server
        try:
            _atomic_write_json(job["progressPath"], {
                "phase": "failed", "error": str(exc), "progress": 0.0,
            })
        except Exception:
            pass
        sys.stderr.write("sidecar trainer failed: {}\n".format(exc))
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("usage: train.py <job_dir>\n")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
