"""
LoRA/QLoRA Fine-Tune Sidecar — doc69 Giai đoạn 5 / Wave E3, task E3-6.

THIS IS NOT A DEFAULT DEPENDENCY OF THE PROJECT AND IS NOT RUN BY CI, exactly like
tools/trainer/train.py (the existing vision sidecar this script sits ALONGSIDE — train.py is
NOT modified by this task). It is the Python side of the file-based contract driven by
`server/services/aiLlmFinetuneSidecar.ts`. It runs ONLY when an operator:

  1. Installs Python + the LoRA fine-tune deps themselves — see requirements-lora.txt
     (transformers / peft / accelerate / bitsandbytes / torch / sentencepiece).
  2. Has a LOCAL HuggingFace-format checkpoint of the BASE model available OFFLINE — see the
     "base model shape" warning below, this is NOT the .gguf file the chat/RAG engine serves.
  3. Has a local checkout of `llama.cpp` (for `convert_hf_to_gguf.py`) to convert the merged,
     fine-tuned model to GGUF — see docs/ECOSYSTEM/75_AI_LORA_FINETUNE_RUNBOOK_*.md.
  4. Sets the server env  LLM_FINETUNE_CMD="python tools/trainer/finetune_lora.py"
     (the server appends the job directory as the final argument, exactly like
     LOCAL_TRAINER_CMD does for train.py).

The server NEVER trusts the metrics this script reports: after this sidecar exits,
`server/services/aiLlmFinetuneSidecar.ts` independently evaluates the produced GGUF against a
LOCKED held-out test split and applies the SAME quality gate every model version goes through.
This script's job is simply: read job.json, LoRA-train, stream progress.json atomically, merge +
export a GGUF, write result.json. It NEVER decides activation — that is a separate, human-driven
step on the Node side (`aiModelService.activateModelVersionManual`), regardless of what this
script reports.

────────────────────────────────────────────────────────────────────────────────────────────
HONEST FRAMING — read this before enabling the subsystem

LoRA teaches the base model STYLE / FORMAT / domain phrasing — it does NOT teach it new FACTS.
Facts stay in RAG (the KB corpus is retrieved at answer time regardless of which adapter trained
this model). Do not expect a LoRA fine-tune to "know" anything the base model didn't already
know or that wasn't in its training text; expect it to phrase/format answers more like the
corpus it was tuned on. Combine LoRA (style) with RAG (facts) — never as a substitute for it.

────────────────────────────────────────────────────────────────────────────────────────────
IMPORTANT — "baseModelPath" is a HuggingFace checkpoint DIRECTORY, not a .gguf file

The local chat/RAG engine (`server/services/aiGgufEngine.ts`) only ever loads `.gguf` files —
GGUF is a quantized, inference-only format that `transformers`/`peft` CANNOT load or fine-tune
directly. `job.json`'s `baseModelPath` must point at the ORIGINAL HuggingFace-format checkpoint
(the directory containing `config.json`, tokenizer files, and `*.safetensors`/`pytorch_model.bin`)
that the operator's `.gguf` was quantized FROM — typically the same local HF cache used to
produce that GGUF in the first place. If only the `.gguf` is available locally, the operator
needs to fetch/keep the HF checkpoint too before enabling this subsystem — this is called out
explicitly in the runbook so it is not a surprise the first time someone tries this.

────────────────────────────────────────────────────────────────────────────────────────────
FILE CONTRACT (all paths absolute; written by the server unless noted)

job.json (input):
  {
    "jobId": str,
    "baseModelId": int,
    "targetVersion": str,
    "baseModelPath": path,               # HF checkpoint DIRECTORY — see warning above
    "corpus": str,                        # informational only
    "manifests": { "train": path, "test": path },   # JSONL, one {"text": "..."} per line
    "hyperparams": {
      "rank": int, "alpha": int, "epochs": int, "learningRate": float,
      "quantization": "none" | "4bit" | "8bit",     # QLoRA when != "none"
      "maxSeqLen": int, "batchSize": int
    },
    "output": {
      "dir": path, "adapterDir": path, "ggufPath": path, "resultPath": path
    },
    "progressPath": path,
    "logsDir": path
  }

manifest JSONL line: {"text": str}   — a plain corpus chunk, NOT a synthesized Q&A pair (this
  script never fabricates instructions/answers that weren't in the source corpus).

progress.json (output, rewritten atomically EVERY epoch — same atomic-write discipline as
train.py, see _atomic_write_json below):
  {
    "phase": "training" | "merging" | "converting" | "evaluating" | "done" | "failed",
    "epoch": int, "totalEpochs": int,
    "loss": float,
    "progress": float,                 # 0..1
    "metrics": { "loss": [...] }       # history (optional)
  }

result.json (output, written once on success — ADVISORY ONLY, the Node side independently
re-evaluates the produced GGUF and never trusts these numbers for the activation gate):
  {
    "success": true,
    "ggufPath": path,                  # == output.ggufPath
    "durationMs": int,
    "metrics": { "trainLoss": float, "evalLoss": float, "perplexity": float, "samples": int,
                 "epochs": int }
  }
────────────────────────────────────────────────────────────────────────────────────────────
"""

import json
import os
import sys
import time
import subprocess
import tempfile

# ── Offline-first: never reach out to the network at train time ──
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

# Windows consoles default to cp1252; transformers/peft print unicode that crashes encoding.
# Force UTF-8 on stdio so library logging never aborts a run (mirrors train.py).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Sensible default LoRA target modules for Llama/Qwen-family causal LMs (attention + MLP
# projections). Some architectures use different names — an operator fine-tuning a very
# different base model family may need to override this list; kept as a module constant
# (rather than a job.json field) to keep the contract small — a documented fast-follow if a
# non-Llama-family base model needs a different set.
DEFAULT_TARGET_MODULES = [
    "q_proj", "k_proj", "v_proj", "o_proj",
    "gate_proj", "up_proj", "down_proj",
]


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


def load_text_manifest(manifest_path):
    """Parse a JSONL manifest of {"text": "..."} records into a list of strings."""
    texts = []
    if not manifest_path or not os.path.exists(manifest_path):
        return texts
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            text = rec.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text)
    return texts


def load_base_model_and_tokenizer(base_model_path, quantization):
    """
    Load the base HuggingFace causal-LM checkpoint + tokenizer, OFFLINE (local_files_only).

    quantization:
      "none" -> full/half precision load (bfloat16 if CUDA available, else float32).
      "4bit" | "8bit" -> QLoRA: quantized load via bitsandbytes BitsAndBytesConfig, then
        prepared for k-bit training (gradient checkpointing friendly, layer norms upcast).
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(base_model_path, local_files_only=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    use_cuda = torch.cuda.is_available()
    dtype = torch.bfloat16 if use_cuda else torch.float32

    quant_config = None
    if quantization in ("4bit", "8bit"):
        from transformers import BitsAndBytesConfig

        if quantization == "4bit":
            quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=dtype,
                bnb_4bit_use_double_quant=True,
            )
        else:
            quant_config = BitsAndBytesConfig(load_in_8bit=True)

    model = AutoModelForCausalLM.from_pretrained(
        base_model_path,
        local_files_only=True,
        torch_dtype=dtype,
        quantization_config=quant_config,
        device_map="auto" if use_cuda else None,
    )

    if quant_config is not None:
        from peft import prepare_model_for_kbit_training

        model = prepare_model_for_kbit_training(model)

    return model, tokenizer


def apply_lora(model, hyperparams):
    """Wrap the base model with a PEFT LoRA adapter per job.json's hyperparams."""
    from peft import LoraConfig, get_peft_model, TaskType

    config = LoraConfig(
        r=int(hyperparams.get("rank", 16)),
        lora_alpha=int(hyperparams.get("alpha", 32)),
        target_modules=DEFAULT_TARGET_MODULES,
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    peft_model = get_peft_model(model, config)
    peft_model.print_trainable_parameters()
    return peft_model


class _CausalLmTextDataset:
    """Minimal torch Dataset: tokenizes each corpus chunk into a fixed-length, causal-LM-ready
    (input_ids, attention_mask, labels) triple. labels == input_ids (standard causal-LM
    next-token objective) with padding positions masked to -100 so they don't contribute loss."""

    def __init__(self, texts, tokenizer, max_seq_len):
        self.texts = texts
        self.tokenizer = tokenizer
        self.max_seq_len = max_seq_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        import torch

        enc = self.tokenizer(
            self.texts[idx],
            truncation=True,
            max_length=self.max_seq_len,
            padding="max_length",
            return_tensors="pt",
        )
        input_ids = enc["input_ids"][0]
        attention_mask = enc["attention_mask"][0]
        labels = input_ids.clone()
        labels[attention_mask == 0] = -100
        return {"input_ids": input_ids, "attention_mask": attention_mask, "labels": labels}


def train_loop(job, model, tokenizer, train_texts):
    """
    Manual training loop (mirrors train.py's train_loop style: plain torch, atomic
    progress.json once per epoch, honest stderr logging) rather than transformers.Trainer, to
    keep the same "no hidden framework magic" shape as the vision sidecar.
    """
    import torch
    from torch.utils.data import DataLoader

    config = job.get("hyperparams", {})
    total_epochs = max(1, int(config.get("epochs", 3)))
    batch_size = max(1, int(config.get("batchSize", 4)))
    lr = float(config.get("learningRate", 0.0002))
    max_seq_len = int(config.get("maxSeqLen", 2048))

    dataset = _CausalLmTextDataset(train_texts, tokenizer, max_seq_len)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)

    trainable_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable_params, lr=lr)

    history = {"loss": []}
    model.train()

    for epoch in range(1, total_epochs + 1):
        running_loss, steps = 0.0, 0
        for batch in loader:
            batch = {k: v.to(model.device) for k, v in batch.items()}
            outputs = model(**batch)
            loss = outputs.loss
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            running_loss += float(loss.item())
            steps += 1

        avg_loss = running_loss / steps if steps else 0.0
        history["loss"].append(round(avg_loss, 4))

        _atomic_write_json(job["progressPath"], {
            "phase": "training", "epoch": epoch, "totalEpochs": total_epochs,
            "loss": round(avg_loss, 4), "progress": epoch / total_epochs,
            "metrics": history,
        })
        sys.stderr.write("lora epoch {}/{}: loss={:.4f}\n".format(epoch, total_epochs, avg_loss))

    model.eval()
    return history


def evaluate_held_out_loss(model, tokenizer, test_texts, max_seq_len):
    """Advisory-only held-out loss/perplexity — the Node side independently re-evaluates the
    exported GGUF and never trusts this number for the activation gate (see module doc comment).
    Kept simple (average next-token cross-entropy) — an honest STYLE-fit signal, not a claim of
    factual correctness."""
    import math
    import torch

    if not test_texts:
        return {"evalLoss": 0.0, "perplexity": 0.0, "samples": 0}

    dataset = _CausalLmTextDataset(test_texts, tokenizer, max_seq_len)
    total_loss, n = 0.0, 0
    model.eval()
    with torch.no_grad():
        for i in range(len(dataset)):
            item = dataset[i]
            batch = {k: v.unsqueeze(0).to(model.device) for k, v in item.items()}
            out = model(**batch)
            total_loss += float(out.loss.item())
            n += 1
    avg_loss = total_loss / n if n else 0.0
    perplexity = math.exp(avg_loss) if avg_loss < 20 else float("inf")  # guard exp overflow
    return {"evalLoss": round(avg_loss, 4), "perplexity": round(perplexity, 4), "samples": n}


def save_adapter(model, adapter_dir):
    os.makedirs(adapter_dir, exist_ok=True)
    model.save_pretrained(adapter_dir)
    sys.stderr.write("lora: adapter saved -> {}\n".format(adapter_dir))


def merge_and_export_gguf(model, tokenizer, base_model_path, output_gguf_path):
    """
    MERGE-then-CONVERT (the only path this script implements, deliberately):

    `server/services/aiGgufEngine.ts` (the engine that actually SERVES local chat/RAG
    inference) only ever loads a single standalone `.gguf` file — it has no "base + LoRA
    adapter" loading mode. So a LoRA-only GGUF adapter (llama.cpp's alternate
    `convert_lora_to_gguf.py` path, which produces a small adapter file meant to be loaded
    ALONGSIDE a base gguf via `--lora`) would NOT be servable by the existing engine without
    first extending it. Merging the LoRA weights into the base model and converting the
    MERGED model to a normal, standalone GGUF is therefore the only fine-tune output shape
    this codebase's serving stack can use today — hence "merge then convert", not "convert the
    adapter". A LoRA-adapter-only GGUF path is a documented, NOT-implemented-here fast-follow
    for whoever extends the engine to support `--lora` at load time.

    Requires a local `llama.cpp` checkout with `convert_hf_to_gguf.py` — path via env
    LLAMA_CPP_CONVERT_SCRIPT (see docs/ECOSYSTEM/75_AI_LORA_FINETUNE_RUNBOOK_*.md). Invoked as
    a subprocess with an ARGUMENT LIST (no shell=True) — same injection discipline as the
    Node→Python boundary, even though this call is Python-internal.
    """
    convert_script = os.environ.get("LLAMA_CPP_CONVERT_SCRIPT")
    if not convert_script or not os.path.exists(convert_script):
        raise RuntimeError(
            "LLAMA_CPP_CONVERT_SCRIPT is not set or does not exist — cannot convert the merged "
            "model to GGUF. Point it at <your llama.cpp checkout>/convert_hf_to_gguf.py "
            "(see the runbook)."
        )

    merged_model = model.merge_and_unload()  # bakes the LoRA delta into the base weights

    with tempfile.TemporaryDirectory(prefix="lora_merged_") as merged_dir:
        sys.stderr.write("lora: saving merged model -> {}\n".format(merged_dir))
        merged_model.save_pretrained(merged_dir, safe_serialization=True)
        tokenizer.save_pretrained(merged_dir)

        os.makedirs(os.path.dirname(output_gguf_path), exist_ok=True)
        cmd = [
            sys.executable, convert_script, merged_dir,
            "--outfile", output_gguf_path,
            "--outtype", "f16",
        ]
        sys.stderr.write("lora: converting to GGUF: {}\n".format(" ".join(cmd)))
        subprocess.run(cmd, check=True)

    if not os.path.exists(output_gguf_path) or os.path.getsize(output_gguf_path) == 0:
        raise RuntimeError("GGUF conversion produced no file at {}".format(output_gguf_path))
    sys.stderr.write("lora: exported GGUF -> {} ({} bytes)\n".format(
        output_gguf_path, os.path.getsize(output_gguf_path)))


def write_result(job, metrics, duration_ms):
    _atomic_write_json(job["output"]["resultPath"], {
        "success": True,
        "ggufPath": job["output"]["ggufPath"],
        "durationMs": int(duration_ms),
        "metrics": metrics,
    })


def main(job_dir):
    start = time.time()
    job = load_job(job_dir)
    hyperparams = job.get("hyperparams", {})
    quantization = str(hyperparams.get("quantization", "none")).lower()
    max_seq_len = int(hyperparams.get("maxSeqLen", 2048))

    try:
        train_texts = load_text_manifest(job["manifests"]["train"])
        test_texts = load_text_manifest(job["manifests"].get("test", ""))
        if not train_texts:
            raise RuntimeError("no usable training text in {}".format(job["manifests"]["train"]))

        base_model, tokenizer = load_base_model_and_tokenizer(job["baseModelPath"], quantization)
        peft_model = apply_lora(base_model, hyperparams)

        history = train_loop(job, peft_model, tokenizer, train_texts)

        _atomic_write_json(job["progressPath"], {
            "phase": "merging", "epoch": 0, "totalEpochs": 0,
            "loss": history["loss"][-1] if history["loss"] else 0.0, "progress": 0.9,
        })
        save_adapter(peft_model, job["output"]["adapterDir"])

        _atomic_write_json(job["progressPath"], {
            "phase": "converting", "epoch": 0, "totalEpochs": 0,
            "loss": 0.0, "progress": 0.95,
        })
        merge_and_export_gguf(peft_model, tokenizer, job["baseModelPath"], job["output"]["ggufPath"])

        _atomic_write_json(job["progressPath"], {
            "phase": "evaluating", "epoch": 0, "totalEpochs": 0, "loss": 0.0, "progress": 0.98,
        })
        eval_metrics = evaluate_held_out_loss(peft_model, tokenizer, test_texts, max_seq_len)

        metrics = {
            "trainLoss": history["loss"][-1] if history["loss"] else 0.0,
            "evalLoss": eval_metrics["evalLoss"],
            "perplexity": eval_metrics["perplexity"],
            "samples": len(train_texts),
            "epochs": int(hyperparams.get("epochs", 3)),
        }
        write_result(job, metrics, (time.time() - start) * 1000)

        _atomic_write_json(job["progressPath"], {
            "phase": "done", "epoch": 0, "totalEpochs": 0, "loss": 0.0, "progress": 1.0,
        })
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure to the server
        try:
            _atomic_write_json(job["progressPath"], {
                "phase": "failed", "error": str(exc), "progress": 0.0,
            })
        except Exception:
            pass
        sys.stderr.write("lora finetune sidecar failed: {}\n".format(exc))
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("usage: finetune_lora.py <job_dir>\n")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
