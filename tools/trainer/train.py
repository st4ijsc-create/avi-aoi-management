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

# ── Offline-first: never reach out to the network at train time ──
# torchvision weight downloads, HF hub, etc. are all disabled. We train from
# scratch (pretrained=False) unless local cached weights are present.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TORCHVISION_OFFLINE", "1")

# Windows consoles default to cp1252; torch/onnx exporters print unicode that
# crashes encoding. Force UTF-8 on stdio so library logging never aborts a run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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
    """Resolve a manifest imageUrl against imageRoot (handles /uploads/ prefix).

    Defense-in-depth: resolved path MUST stay inside image_root; a malicious
    ``../../`` imageUrl that escapes the root returns "" → skipped by the loader.
    """
    url = image_url.lstrip("/")
    if url.startswith("uploads/"):
        url = url[len("uploads/"):]
    # imageRoot already points at <cwd>/uploads, so join the remainder.
    resolved = os.path.normpath(os.path.join(image_root, url))
    root_norm = os.path.normpath(image_root)
    try:
        if os.path.commonpath([root_norm, resolved]) != root_norm:
            print(f"[trainer] skip out-of-root imageUrl: {image_url}", flush=True)
            return ""
    except ValueError:
        return ""  # different drive (Windows) → outside root
    return resolved


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
    Build a torch Dataset from (abs_path, class_index) pairs.

    Transform pipeline MUST match the Node inference preprocessing
    (aiInferenceEngine.preprocessImage / aiLocalTraining.extractEmbeddings):
      Resize(img_size, img_size) → RGB → ToTensor (x/255) → Normalize(ImageNet).
    Missing / unreadable files are skipped (logged once) so a stray bad path
    never aborts a run.
    """
    import torch
    from torch.utils.data import Dataset
    import torchvision.transforms as T
    from PIL import Image

    transform = T.Compose([
        T.Resize((img_size, img_size)),
        T.ToTensor(),  # HWC[0,255] → CHW[0,1] float32
        T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])

    # Pre-filter to existing files (skip + log missing).
    usable = []
    for img_path, label_idx in samples:
        if os.path.exists(img_path):
            usable.append((img_path, label_idx))
        else:
            sys.stderr.write("skip missing image: {}\n".format(img_path))

    class ImageDataset(Dataset):
        def __init__(self, items):
            self.items = items

        def __len__(self):
            return len(self.items)

        def __getitem__(self, idx):
            img_path, label_idx = self.items[idx]
            try:
                with Image.open(img_path) as im:
                    img = transform(im.convert("RGB"))
            except Exception as exc:  # corrupt image → black tensor, keep label
                sys.stderr.write("skip unreadable image {}: {}\n".format(img_path, exc))
                img = torch.zeros(3, img_size, img_size, dtype=torch.float32)
            return img, label_idx

    return ImageDataset(usable)


def _build_model(num_classes):
    """
    Build a small transfer-learning backbone sized for ~6GB VRAM.

    Offline-first: torchvision pretrained weights are downloaded over the
    network, which we forbid at train time. We therefore use weights=None
    (train from scratch). If an operator pre-caches weights under TORCH_HOME
    (e.g. mobilenet_v3_small / resnet18), set _USE_PRETRAINED=1 and we attempt
    to load them; any failure falls back to scratch and is logged.

    NOTE: with only weights=None the model trains from random init, so tiny
    smoke-test datasets will show near-chance accuracy — that is expected and
    fine for verifying the pipeline. Real production training needs either a
    real labeled dataset or pre-cached pretrained weights for transfer learning.
    """
    import torchvision.models as models

    use_pretrained = os.environ.get("_USE_PRETRAINED", "") == "1"
    weights = None
    if use_pretrained:
        try:
            weights = models.MobileNet_V3_Small_Weights.DEFAULT
        except Exception as exc:  # offline / no cache → scratch
            sys.stderr.write("pretrained weights unavailable, training from scratch: {}\n".format(exc))
            weights = None

    model = models.mobilenet_v3_small(weights=weights)
    # Replace the classifier head with one matching num_classes.
    import torch.nn as nn
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, num_classes)
    return model


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
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader

    config = job.get("config", {})
    total_epochs = max(1, int(config.get("epochs", 50)))
    batch_size = max(1, int(config.get("batchSize", 32)))
    lr = float(config.get("learningRate", 0.001))
    num_classes = len(job["classLabels"])

    device_req = str(config.get("device", "")).lower()
    use_cuda = torch.cuda.is_available() and device_req != "cpu"
    device = torch.device("cuda" if use_cuda else "cpu")
    sys.stderr.write("training on device: {}\n".format(device))

    model = _build_model(num_classes)
    model.to(device)

    train_loader = DataLoader(train_data, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_data, batch_size=batch_size, shuffle=False, num_workers=0) \
        if val_data is not None and len(val_data) > 0 else None

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    history = {"loss": [], "accuracy": [], "valLoss": [], "valAccuracy": []}
    early_stopping = bool(config.get("earlyStopping", False))
    patience = int(config.get("patience", 5))
    best_val_acc = -1.0
    best_state = None
    no_improve = 0

    def _run_epoch(loader, train_mode):
        model.train(train_mode)
        running_loss, correct, total = 0.0, 0, 0
        if loader is None:
            return 0.0, 0.0
        for imgs, labels in loader:
            imgs = imgs.to(device)
            labels = labels.to(device)
            with torch.set_grad_enabled(train_mode):
                logits = model(imgs)
                loss = criterion(logits, labels)
                if train_mode:
                    optimizer.zero_grad()
                    loss.backward()
                    optimizer.step()
            running_loss += loss.item() * imgs.size(0)
            preds = logits.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += imgs.size(0)
        avg_loss = running_loss / total if total else 0.0
        acc = correct / total if total else 0.0
        return avg_loss, acc

    for epoch in range(1, total_epochs + 1):
        train_loss, train_acc = _run_epoch(train_loader, True)
        val_loss, val_acc = _run_epoch(val_loader, False)

        history["loss"].append(round(train_loss, 4))
        history["accuracy"].append(round(train_acc, 4))
        history["valLoss"].append(round(val_loss, 4))
        history["valAccuracy"].append(round(val_acc, 4))

        _atomic_write_json(job["progressPath"], {
            "phase": "training", "epoch": epoch, "totalEpochs": total_epochs,
            "loss": round(train_loss, 4), "accuracy": round(train_acc, 4),
            "valLoss": round(val_loss, 4), "valAccuracy": round(val_acc, 4),
            "progress": epoch / total_epochs,
            "metrics": history,
        })
        sys.stderr.write(
            "epoch {}/{}: loss={:.4f} acc={:.4f} valLoss={:.4f} valAcc={:.4f}\n".format(
                epoch, total_epochs, train_loss, train_acc, val_loss, val_acc))

        if val_loader is not None and val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
        if early_stopping and val_loader is not None and no_improve >= patience:
            sys.stderr.write("early stopping at epoch {}\n".format(epoch))
            break

    # Restore best weights (by val accuracy) if we tracked them.
    if best_state is not None:
        model.load_state_dict(best_state)

    model.eval()
    return model


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

    Classification export I/O is fixed to match the Node engine:
      input  "input"  NCHW [N, 3, imgSize, imgSize], dynamic batch axis
      output "logits"                                (engine applies softmax)
    """
    import torch

    config = job.get("config", {})
    img_size = int(config.get("imgSize", DEFAULT_IMG_SIZE))
    model_path = job["output"]["modelPath"]
    os.makedirs(os.path.dirname(model_path), exist_ok=True)

    # Export on CPU for a deterministic, EP-agnostic ONNX graph.
    model = model.to("cpu").eval()
    dummy = torch.randn(1, 3, img_size, img_size, dtype=torch.float32)

    export_kwargs = dict(
        opset_version=ONNX_OPSET,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        do_constant_folding=True,
    )
    # torch>=2.5 defaults to the dynamo exporter, which (a) ignores opset 13 and
    # keeps a higher opset, and (b) prints unicode the Windows cp1252 console
    # can't encode. Use the legacy TorchScript exporter (dynamo=False) so we get
    # a true opset-13 graph matching the onnxruntime-node 1.24.x contract. Fall
    # back to the default exporter only if the legacy path is unavailable.
    try:
        torch.onnx.export(model, dummy, model_path, dynamo=False, **export_kwargs)
    except TypeError:
        # Older torch without the `dynamo` kwarg — default export honors opset.
        torch.onnx.export(model, dummy, model_path, **export_kwargs)

    if not os.path.exists(model_path) or os.path.getsize(model_path) == 0:
        raise RuntimeError("ONNX export produced no file at {}".format(model_path))
    sys.stderr.write("exported ONNX: {} ({} bytes)\n".format(model_path, os.path.getsize(model_path)))


def evaluate_metrics(model, eval_data, num_classes):
    """
    Run the trained model over eval_data and compute macro-averaged
    accuracy / precision / recall / f1 + confusion matrix[actual][pred].
    Shape MUST match LocalTrainingResult.finalMetrics (Stage 3-6 reuse).
    """
    import torch
    from torch.utils.data import DataLoader

    cm = [[0 for _ in range(num_classes)] for _ in range(num_classes)]
    if eval_data is None or len(eval_data) == 0:
        return {"accuracy": 0.0, "precision": 0.0, "recall": 0.0,
                "f1Score": 0.0, "confusionMatrix": cm}

    device = next(model.parameters()).device
    model.eval()
    loader = DataLoader(eval_data, batch_size=8, shuffle=False, num_workers=0)
    correct, total = 0, 0
    with torch.no_grad():
        for imgs, labels in loader:
            imgs = imgs.to(device)
            preds = model(imgs).argmax(dim=1).cpu().tolist()
            labels = labels.tolist()
            for actual, pred in zip(labels, preds):
                cm[actual][pred] += 1
                total += 1
                if actual == pred:
                    correct += 1

    accuracy = correct / total if total else 0.0

    # Macro precision/recall/f1 over classes.
    precisions, recalls, f1s = [], [], []
    for c in range(num_classes):
        tp = cm[c][c]
        fp = sum(cm[r][c] for r in range(num_classes)) - tp
        fn = sum(cm[c][p] for p in range(num_classes)) - tp
        p = tp / (tp + fp) if (tp + fp) else 0.0
        r = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * p * r / (p + r) if (p + r) else 0.0
        precisions.append(p)
        recalls.append(r)
        f1s.append(f1)

    n = num_classes if num_classes else 1
    return {
        "accuracy": round(accuracy, 4),
        "precision": round(sum(precisions) / n, 4),
        "recall": round(sum(recalls) / n, 4),
        "f1Score": round(sum(f1s) / n, 4),
        "confusionMatrix": cm,
    }


def write_result(job, metrics, duration_ms):
    out_metrics = {
        "accuracy": metrics.get("accuracy", 0.0),
        "precision": metrics.get("precision", 0.0),
        "recall": metrics.get("recall", 0.0),
        "f1Score": metrics.get("f1Score", 0.0),
        "confusionMatrix": metrics.get("confusionMatrix", []),
    }
    # Pass through any segmentation-specific extras (advisory; server re-gates).
    for extra in ("maskMAP50", "maskMAP5095"):
        if extra in metrics:
            out_metrics[extra] = metrics[extra]
    _atomic_write_json(job["output"]["resultPath"], {
        "success": True,
        "modelPath": job["output"]["modelPath"],
        "durationMs": int(duration_ms),
        "metrics": out_metrics,
    })


# ════════════════════════════════════════════════════════════════════════════
# SEGMENTATION MODE (job["task"] == "segmentation") — Ultralytics YOLOv8-seg.
#
# Manifest JSONL line (segmentation):
#   {"imageUrl": "/uploads/x/y.jpg",
#    "masks": [ {"label": "scratch", "points": [[x,y],[x,y],...]}, ... ],
#    "source": "qc_segmentation"}
#   • points are NORMALIZED 0..1 (x = px/imgW, y = px/imgH) — chosen so the
#     manifest is resolution-independent and maps 1:1 to the YOLO label format.
#     (aiDatasetBuilder will divide defect_segmentations.maskData.points by
#     maskData.width/height when it emits this manifest.)
#   • Each mask is one polygon (one instance) of one class.
#
# YOLO-seg on-disk layout we generate under <jobDir>/yolo_seg/:
#   images/train/*.jpg, images/val/*.jpg, images/test/*.jpg
#   labels/train/*.txt, ...   each line: "class_idx x1 y1 x2 y2 ... xn yn"
#                              (all normalized 0..1; >=3 points per polygon)
#   data.yaml: { path, train, val, test, names: {0: lbl0, 1: lbl1, ...} }
#
# YOLOv8-seg ONNX OUTPUTS (documented for the Node decoder aiSegmentation.ts):
#   output0  "output0"  [1, 4 + nc + 32, num_anchors]
#            rows 0..3        = box (cx, cy, w, h) in PIXELS of imgsz
#            rows 4..4+nc-1   = per-class scores (already sigmoid-activated)
#            rows 4+nc..+32   = 32 mask coefficients per anchor
#   output1  "output1"  [1, 32, mh, mw]   = mask prototypes
#   Mask for an instance = sigmoid( coeff[32] · proto[32, mh*mw] ) reshaped
#   [mh, mw], cropped to the box, thresholded at 0.5.
# ════════════════════════════════════════════════════════════════════════════


def load_seg_manifest(manifest_path):
    """Parse a segmentation JSONL manifest → list of {imageUrl, masks:[...]}."""
    records = []
    if not manifest_path or not os.path.exists(manifest_path):
        return records
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if not rec.get("masks"):
                continue
            records.append(rec)
    return records


def _write_yolo_split(records, split, images_dir, labels_dir, image_root, label_to_idx):
    """Copy/resize images + write YOLO-seg polygon label files for one split."""
    from PIL import Image
    import shutil

    out_img = os.path.join(images_dir, split)
    out_lbl = os.path.join(labels_dir, split)
    os.makedirs(out_img, exist_ok=True)
    os.makedirs(out_lbl, exist_ok=True)

    written = 0
    for i, rec in enumerate(records):
        src = resolve_image_path(rec["imageUrl"], image_root)
        if not os.path.exists(src):
            sys.stderr.write("seg: skip missing image: {}\n".format(src))
            continue
        # Build polygon label lines (normalized; clamp to [0,1]; need >=3 pts).
        lines = []
        for m in rec.get("masks", []):
            label = m.get("label")
            if label not in label_to_idx:
                sys.stderr.write("seg: skip mask, unknown label '{}'\n".format(label))
                continue
            pts = m.get("points") or []
            if len(pts) < 3:
                sys.stderr.write("seg: skip polygon with <3 points\n")
                continue
            flat = []
            for xy in pts:
                x = min(1.0, max(0.0, float(xy[0])))
                y = min(1.0, max(0.0, float(xy[1])))
                flat.append("{:.6f}".format(x))
                flat.append("{:.6f}".format(y))
            lines.append("{} {}".format(label_to_idx[label], " ".join(flat)))
        if not lines:
            sys.stderr.write("seg: skip image with no usable masks: {}\n".format(src))
            continue
        # Copy image with a flat, collision-free name.
        base = "{}_{}.jpg".format(split, i)
        try:
            with Image.open(src) as im:
                im.convert("RGB").save(os.path.join(out_img, base), "JPEG")
        except Exception as exc:
            sys.stderr.write("seg: skip unreadable image {}: {}\n".format(src, exc))
            continue
        with open(os.path.join(out_lbl, os.path.splitext(base)[0] + ".txt"),
                  "w", encoding="utf-8") as lf:
            lf.write("\n".join(lines) + "\n")
        written += 1
    sys.stderr.write("seg: split '{}' wrote {} images\n".format(split, written))
    return written


def build_seg_dataset(job):
    """Convert seg manifests → YOLO-seg layout under <jobDir>/yolo_seg/.

    Returns (data_yaml_path, counts) where counts = {train, val, test}.
    """
    class_labels = job["classLabels"]
    label_to_idx = {lbl: i for i, lbl in enumerate(class_labels)}
    image_root = job["imageRoot"]

    # Place yolo_seg inside the job dir (parent of the output dir).
    job_dir = os.path.dirname(job["output"]["dir"])
    seg_root = os.path.join(job_dir, "yolo_seg")
    images_dir = os.path.join(seg_root, "images")
    labels_dir = os.path.join(seg_root, "labels")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    counts = {}
    for split, key in (("train", "train"), ("val", "val"), ("test", "test")):
        recs = load_seg_manifest(job["manifests"].get(key, ""))
        counts[split] = _write_yolo_split(
            recs, split, images_dir, labels_dir, image_root, label_to_idx)

    # YOLO needs a val set; if none, reuse train for val.
    if counts["val"] == 0 and counts["train"] > 0:
        import shutil
        shutil.copytree(os.path.join(images_dir, "train"),
                        os.path.join(images_dir, "val"), dirs_exist_ok=True)
        shutil.copytree(os.path.join(labels_dir, "train"),
                        os.path.join(labels_dir, "val"), dirs_exist_ok=True)
        counts["val"] = counts["train"]
        sys.stderr.write("seg: no val split — reusing train as val\n")

    names = {i: lbl for i, lbl in enumerate(class_labels)}
    data_yaml = os.path.join(seg_root, "data.yaml")
    # Minimal YAML by hand (no pyyaml dependency required at write time).
    with open(data_yaml, "w", encoding="utf-8") as f:
        f.write("path: {}\n".format(seg_root.replace("\\", "/")))
        f.write("train: images/train\n")
        f.write("val: images/val\n")
        if counts["test"] > 0:
            f.write("test: images/test\n")
        f.write("names:\n")
        for i, lbl in names.items():
            f.write("  {}: {}\n".format(i, lbl))
    sys.stderr.write("seg: data.yaml -> {} counts={}\n".format(data_yaml, counts))
    return data_yaml, counts, seg_root


def train_seg(job, data_yaml):
    """Train a small YOLOv8-seg model (offline / from-scratch) sized for ~6GB VRAM.

    Streams progress.json atomically via the ultralytics on_train_epoch_end
    callback. Returns the trained ultralytics YOLO object + its results dir.
    """
    import torch
    from ultralytics import YOLO

    config = job.get("config", {})
    total_epochs = max(1, int(config.get("epochs", 50)))
    img_size = int(config.get("imgSize", DEFAULT_IMG_SIZE))
    batch = max(1, int(config.get("batchSize", 2)))
    device_req = str(config.get("device", "")).lower()
    use_cuda = torch.cuda.is_available() and device_req != "cpu"
    device = "cuda" if use_cuda else "cpu"
    sys.stderr.write("seg: training on device: {}\n".format(device))

    # Offline-first model selection:
    #   1. A locally cached pretrained .pt next to this script (best transfer).
    #   2. Otherwise from-scratch from the architecture YAML 'yolov8n-seg.yaml'
    #      (ultralytics ships these YAMLs in the package — no network needed).
    here = os.path.dirname(os.path.abspath(__file__))
    local_pt = os.path.join(here, "yolov8n-seg.pt")
    if os.path.exists(local_pt):
        sys.stderr.write("seg: using local pretrained weights {}\n".format(local_pt))
        model = YOLO(local_pt)
    else:
        sys.stderr.write("seg: no local .pt — training from scratch (yolov8n-seg.yaml)\n")
        model = YOLO("yolov8n-seg.yaml")

    job_dir = os.path.dirname(job["output"]["dir"])
    run_project = os.path.join(job_dir, "yolo_runs")

    _atomic_write_json(job["progressPath"], {
        "phase": "training", "epoch": 0, "totalEpochs": total_epochs,
        "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
        "progress": 0.0, "metrics": {"loss": [], "accuracy": [],
                                     "valLoss": [], "valAccuracy": []},
    })

    history = {"loss": [], "accuracy": [], "valLoss": [], "valAccuracy": []}

    def _on_epoch_end(trainer):
        try:
            ep = int(getattr(trainer, "epoch", 0)) + 1
            loss = 0.0
            tl = getattr(trainer, "tloss", None)
            if tl is not None:
                try:
                    loss = float(tl.sum().item())
                except Exception:
                    loss = float(tl) if isinstance(tl, (int, float)) else 0.0
            metrics = getattr(trainer, "metrics", {}) or {}
            map50 = float(metrics.get("metrics/mAP50(M)",
                          metrics.get("metrics/mAP50(B)", 0.0)) or 0.0)
            history["loss"].append(round(loss, 4))
            history["accuracy"].append(round(map50, 4))
            history["valLoss"].append(0.0)
            history["valAccuracy"].append(round(map50, 4))
            _atomic_write_json(job["progressPath"], {
                "phase": "training", "epoch": ep, "totalEpochs": total_epochs,
                "loss": round(loss, 4), "accuracy": round(map50, 4),
                "valLoss": 0.0, "valAccuracy": round(map50, 4),
                "progress": ep / total_epochs, "metrics": history,
            })
            sys.stderr.write("seg: epoch {}/{} loss={:.4f} mAP50={:.4f}\n".format(
                ep, total_epochs, loss, map50))
        except Exception as exc:  # never let progress writing abort training
            sys.stderr.write("seg: progress callback error: {}\n".format(exc))

    model.add_callback("on_train_epoch_end", _on_epoch_end)

    model.train(
        data=data_yaml,
        epochs=total_epochs,
        imgsz=img_size,
        batch=batch,
        device=0 if use_cuda else "cpu",
        project=run_project,
        name="seg",
        exist_ok=True,
        verbose=True,
        plots=False,
        # 6GB-friendly defaults; caching off to avoid extra VRAM/RAM spikes.
        cache=False,
        workers=0,
        pretrained=os.path.exists(local_pt),
    )
    results_dir = os.path.join(run_project, "seg")
    return model, results_dir


def export_seg_onnx(model, job):
    """Export YOLOv8-seg to ONNX and copy to output/model.onnx.

    YOLOv8-seg ONNX exposes TWO outputs (see module docstring):
      output0 [1, 4+nc+32, N]  (boxes+scores+coeffs),  output1 [1,32,mh,mw] (proto)
    """
    import shutil

    config = job.get("config", {})
    img_size = int(config.get("imgSize", DEFAULT_IMG_SIZE))
    model_path = job["output"]["modelPath"]
    os.makedirs(os.path.dirname(model_path), exist_ok=True)

    onnx_path = model.export(format="onnx", imgsz=img_size, opset=ONNX_OPSET,
                             simplify=False, dynamic=False)
    onnx_path = str(onnx_path)
    if not os.path.exists(onnx_path):
        raise RuntimeError("YOLO seg ONNX export produced no file")
    shutil.copyfile(onnx_path, model_path)
    if not os.path.exists(model_path) or os.path.getsize(model_path) == 0:
        raise RuntimeError("ONNX copy produced no file at {}".format(model_path))
    sys.stderr.write("seg: exported ONNX -> {} ({} bytes)\n".format(
        model_path, os.path.getsize(model_path)))


def _seg_metrics_from_results(model, results_dir):
    """Pull seg mAP from the trained model's validator metrics → finalMetrics."""
    map50 = 0.0
    map5095 = 0.0
    try:
        m = getattr(model, "metrics", None)
        if m is not None:
            seg = getattr(m, "seg", None)
            if seg is not None:
                map50 = float(getattr(seg, "map50", 0.0) or 0.0)
                map5095 = float(getattr(seg, "map", 0.0) or 0.0)
    except Exception as exc:
        sys.stderr.write("seg: metrics extraction error: {}\n".format(exc))
    return {
        # Map mask mAP50 into the generic accuracy slot the server expects.
        "accuracy": round(map50, 4),
        "precision": round(map50, 4),
        "recall": round(map50, 4),
        "f1Score": round(map50, 4),
        "confusionMatrix": [],
        # Segmentation-specific extras (advisory; server re-runs the gate).
        "maskMAP50": round(map50, 4),
        "maskMAP5095": round(map5095, 4),
    }


def run_segmentation(job, start):
    """Full segmentation pipeline: dataset → train → export → result."""
    _atomic_write_json(job["progressPath"], {
        "phase": "training", "epoch": 0, "totalEpochs": 0,
        "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
        "progress": 0.0,
    })
    data_yaml, counts, _seg_root = build_seg_dataset(job)
    if counts.get("train", 0) == 0:
        raise RuntimeError("segmentation: no usable training images after build_seg_dataset")

    model, results_dir = train_seg(job, data_yaml)

    _atomic_write_json(job["progressPath"], {
        "phase": "exporting", "epoch": 0, "totalEpochs": 0,
        "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
        "progress": 1.0,
    })
    export_seg_onnx(model, job)

    metrics = _seg_metrics_from_results(model, results_dir)
    write_result(job, metrics, (time.time() - start) * 1000)

    _atomic_write_json(job["progressPath"], {
        "phase": "done", "epoch": 0, "totalEpochs": 0,
        "loss": 0.0, "accuracy": 0.0, "valLoss": 0.0, "valAccuracy": 0.0,
        "progress": 1.0,
    })
    return 0


def main(job_dir):
    start = time.time()
    job = load_job(job_dir)
    config = job.get("config", {})
    img_size = int(config.get("imgSize", DEFAULT_IMG_SIZE))
    class_labels = job["classLabels"]

    # ── Branch on task; default to classification for backward-compatibility. ──
    task = str(job.get("task", "classification")).lower()
    if task == "segmentation":
        try:
            return run_segmentation(job, start)
        except Exception as exc:  # noqa: BLE001
            try:
                _atomic_write_json(job["progressPath"], {
                    "phase": "failed", "error": str(exc), "progress": 0.0,
                })
            except Exception:
                pass
            sys.stderr.write("sidecar trainer (segmentation) failed: {}\n".format(exc))
            return 1

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
        # Evaluate BEFORE the export moves the model to CPU is fine either way;
        # evaluate_metrics handles device. Use the TEST split when present, else
        # fall back to the VAL split (advisory only — the server re-runs the gate).
        test_samples = load_manifest(job["manifests"].get("test", ""), job["imageRoot"], class_labels)
        eval_samples = test_samples if test_samples else val_samples
        eval_data = build_dataset(eval_samples, img_size)
        metrics = evaluate_metrics(model, eval_data, len(class_labels))

        export_onnx(model, job)

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
