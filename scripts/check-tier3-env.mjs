#!/usr/bin/env node
/**
 * check-tier3-env.mjs — Kiểm tra mức sẵn sàng môi trường cho Nhánh B Tier 3.
 *
 *   node scripts/check-tier3-env.mjs
 *
 * Dò và in ra trạng thái + việc còn thiếu cho:
 *   1. GPU NVIDIA (nvidia-smi: tên, VRAM, driver, CUDA)
 *   2. Python + PyTorch + torch.cuda (B8 deep training) + onnx/ultralytics
 *   3. onnxruntime-node + thử nạp CUDA Execution Provider (B9 GPU inference)
 *   4. Tóm tắt + gợi ý env cần set, kèm lưu ý VRAM 8GB.
 *
 * KHÔNG sửa gì, chỉ đọc/chạy lệnh chẩn đoán. An toàn chạy lại nhiều lần.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m",
};
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const bad = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.dim}·${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}`);

const results = { gpu: false, torchCuda: false, ortCuda: false, ortCpu: false, ortDml: false };

function run(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000, ...opts });
    return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), failed: r.error != null };
  } catch (e) {
    return { code: -1, out: "", err: String(e?.message || e), failed: true };
  }
}

// Tìm lệnh python khả dụng
function findPython() {
  for (const c of ["python", "python3", "py"]) {
    const r = run(c, ["--version"]);
    if (!r.failed && r.code === 0) return c;
  }
  return null;
}

/** Dựng 1 ONNX ModelProto tí hon (Identity, float[1]) bằng tay — không cần torch/onnx. */
function buildMinimalOnnx() {
  const varint = (n) => {
    const b = []; let x = n;
    do { let byte = x & 0x7f; x = Math.floor(x / 128); if (x > 0) byte |= 0x80; b.push(byte); } while (x > 0);
    return Buffer.from(b);
  };
  const tag = (num, wt) => varint((num << 3) | wt);
  const lenDelim = (num, buf) => Buffer.concat([tag(num, 2), varint(buf.length), buf]);
  const vfield = (num, val) => Buffer.concat([tag(num, 0), varint(val)]);
  const sfield = (num, str) => lenDelim(num, Buffer.from(str, "utf8"));
  const dim = vfield(1, 1);                                  // Dimension.dim_value = 1
  const shape = lenDelim(1, dim);                            // TensorShapeProto.dim
  const tensorType = Buffer.concat([vfield(1, 1), lenDelim(2, shape)]); // Tensor: elem_type=FLOAT, shape
  const typeProto = lenDelim(1, tensorType);                 // TypeProto.tensor_type
  const vinfo = (name) => Buffer.concat([sfield(1, name), lenDelim(2, typeProto)]);
  const node = Buffer.concat([sfield(1, "x"), sfield(2, "y"), sfield(4, "Identity")]); // NodeProto
  const graph = Buffer.concat([lenDelim(1, node), sfield(2, "g"), lenDelim(11, vinfo("x")), lenDelim(12, vinfo("y"))]);
  const opset = vfield(2, 13);                               // OperatorSetIdProto.version = 13
  return Buffer.concat([vfield(1, 7), lenDelim(8, opset), lenDelim(7, graph)]); // ModelProto
}

console.log(`${C.bold}=== Kiểm tra môi trường Tier 3 (B7 segmentation · B8 training · B9 GPU) ===${C.reset}`);

// ── 1. GPU NVIDIA ────────────────────────────────────────────────────────────
head("1) GPU NVIDIA (nvidia-smi)");
{
  const r = run("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]);
  if (r.failed || r.code !== 0) {
    bad("nvidia-smi không chạy được → chưa thấy GPU NVIDIA hoặc driver chưa cài.");
    info("Nếu máy này không có GPU: training/inference sẽ chạy CPU (chậm). B9 cần GPU.");
  } else {
    results.gpu = true;
    for (const line of r.out.split("\n")) {
      const [name, mem, driver] = line.split(",").map((s) => s.trim());
      ok(`${name} · VRAM ${mem} · driver ${driver}`);
      const gb = parseFloat(mem) / 1024;
      if (gb && gb < 10) warn(`VRAM ~${gb.toFixed(0)}GB: KHÔNG chạy song song vision (Qwen2-VL ~4.4GB) + train segmentation. Làm luân phiên, model nhỏ, batch 2-4.`);
    }
    const cu = run("nvidia-smi", []);
    const m = cu.out.match(/CUDA Version:\s*([\d.]+)/);
    if (m) info(`CUDA (driver hỗ trợ tối đa): ${m[1]}`);
  }
}

// ── 2. Python + PyTorch (B8) ──────────────────────────────────────────────────
head("2) Python + PyTorch (B8 deep training)");
const py = findPython();
if (!py) {
  bad("Không tìm thấy python trên PATH.");
} else {
  const ver = run(py, ["--version"]);
  ok(`Python: ${ver.out || ver.err}`);
  const probe = `
import json, importlib.util
res = {}
def has(m):
    return importlib.util.find_spec(m) is not None
try:
    import torch
    res['torch'] = torch.__version__
    res['cuda_available'] = bool(torch.cuda.is_available())
    res['cuda_version'] = getattr(torch.version, 'cuda', None)
    res['device'] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
except Exception as e:
    res['torch_error'] = str(e)
res['onnx'] = has('onnx')
res['torchvision'] = has('torchvision')
res['ultralytics'] = has('ultralytics')
print(json.dumps(res))
`;
  const r = run(py, ["-c", probe]);
  let parsed = null;
  try { parsed = JSON.parse(r.out.split("\n").filter(Boolean).pop()); } catch { /* ignore */ }
  if (!parsed) {
    bad(`Không đọc được thông tin PyTorch. stderr: ${r.err.slice(0, 200)}`);
  } else if (parsed.torch_error) {
    bad(`PyTorch chưa cài / lỗi import: ${parsed.torch_error}`);
  } else {
    ok(`PyTorch ${parsed.torch} (CUDA build: ${parsed.cuda_version || "CPU-only"})`);
    if (parsed.cuda_available) {
      results.torchCuda = true;
      ok(`torch.cuda.is_available() = TRUE → thấy GPU: ${parsed.device}`);
    } else {
      bad("torch.cuda.is_available() = FALSE → PyTorch KHÔNG thấy GPU.");
      info("Thường do cài bản torch CPU-only. Cài lại bản CUDA: xem pytorch.org (chọn đúng CUDA).");
    }
    (parsed.torchvision ? ok : warn)(`torchvision: ${parsed.torchvision ? "có" : "thiếu (cần cho dataset ảnh)"}`);
    (parsed.onnx ? ok : warn)(`onnx: ${parsed.onnx ? "có" : "thiếu (cần để export ONNX)"}`);
    (parsed.ultralytics ? ok : info)(`ultralytics (YOLO-seg): ${parsed.ultralytics ? "có" : "chưa (tùy chọn, cho segmentation)"}`);
  }
}

// ── 3. onnxruntime-node + CUDA EP (B9) ────────────────────────────────────────
head("3) onnxruntime-node + CUDA Execution Provider (B9 GPU inference)");
let ort = null;
try {
  ort = require("onnxruntime-node");
  ok(`onnxruntime-node ${require("onnxruntime-node/package.json").version}`);
} catch (e) {
  bad(`Không nạp được onnxruntime-node: ${String(e?.message || e).slice(0, 160)}`);
}

if (ort) {
  // Nhúng sẵn 1 model ONNX tí hon (Identity) — KHÔNG phụ thuộc torch/onnx — để test nạp EP.
  const dir = mkdtempSync(join(tmpdir(), "tier3-"));
  const onnxPath = join(dir, "tiny.onnx");
  let exported = false;
  try {
    writeFileSync(onnxPath, buildMinimalOnnx());
    exported = existsSync(onnxPath);
  } catch (e) {
    warn(`Không tạo được ONNX mẫu nội bộ: ${String(e?.message || e).slice(0, 120)}`);
  }
  if (!exported) {
    warn("Bỏ qua test EP: không tạo được ONNX mẫu.");
  } else {
    // Test CPU EP (baseline)
    try {
      const s = await ort.InferenceSession.create(onnxPath, { executionProviders: ["cpu"] });
      results.ortCpu = true;
      ok("CPU EP: nạp session OK (baseline luôn chạy được).");
      await s.release?.();
    } catch (e) {
      bad(`CPU EP lỗi: ${String(e?.message || e).slice(0, 160)}`);
    }
    // Test DirectML EP (Windows GPU — không cần CUDA Toolkit, chạy được trên NVIDIA/AMD/Intel)
    try {
      const t0 = Date.now();
      const s = await ort.InferenceSession.create(onnxPath, { executionProviders: ["dml"] });
      results.ortDml = true;
      ok(`DirectML EP: nạp session OK (${Date.now() - t0}ms) → onnxruntime-node sẽ chạy GPU qua DirectX 12.`);
      info("DirectML KHÔNG cần CUDA Toolkit/cuDNN; chạy được trên RTX 4050. Đây là cách bật GPU khuyến nghị trên Windows + Node.js.");
      await s.release?.();
    } catch (e) {
      const msg = String(e?.message || e);
      bad(`DirectML EP KHÔNG nạp được: ${msg.slice(0, 200)}`);
    }
    // Test CUDA EP (chỉ có trong build native tự đóng — npm package KHÔNG kèm)
    try {
      const t0 = Date.now();
      const s = await ort.InferenceSession.create(onnxPath, { executionProviders: ["cuda"] });
      results.ortCuda = true;
      ok(`CUDA EP: nạp session OK (${Date.now() - t0}ms).`);
      await s.release?.();
    } catch (e) {
      const msg = String(e?.message || e);
      info(`CUDA EP không có: ${msg.slice(0, 140)}`);
      info("npm 'onnxruntime-node' chính thức KHÔNG bundle CUDA EP trên Windows. Dùng DirectML EP ở trên để bật GPU, hoặc build native từ nguồn nếu cần CUDA.");
    }
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── 4. Tóm tắt + gợi ý ────────────────────────────────────────────────────────
head("4) Tóm tắt mức sẵn sàng");
const row = (label, good, note) =>
  console.log(`  ${good ? C.green + "ĐẠT " : C.yellow + "CHƯA"}${C.reset}  ${label}${note ? C.dim + " — " + note + C.reset : ""}`);
row("GPU NVIDIA nhận diện (B9)", results.gpu);
row("PyTorch thấy GPU (B8 training)", results.torchCuda, results.torchCuda ? "" : "cài torch bản CUDA");
row("onnxruntime-node CPU (baseline)", results.ortCpu);
row("onnxruntime-node DirectML EP (GPU Windows)", results.ortDml, results.ortDml ? "khuyến nghị trên Windows" : "cần npm onnxruntime-node >= 1.16");
row("onnxruntime-node CUDA EP (tùy chọn)", results.ortCuda, results.ortCuda ? "" : "npm chính thức không kèm CUDA; bỏ qua nếu đã có DirectML");

head("Gợi ý env (.env) khi đã ĐẠT");
if (results.ortDml || results.ortCuda) {
  const ep = results.ortCuda ? "cuda" : "dml";
  console.log(`  ${C.green}AI_INFER_EP=${ep}${C.reset}                # ưu tiên EP GPU; fallback CPU tự động`);
  console.log(`  ${C.green}ENABLE_GPU=true${C.reset}                 # bật GPU cho ONNX inference`);
  if (results.ortCuda) console.log(`  ${C.dim}# ENABLE_TENSORRT=true${C.reset}         # chỉ nếu đã cài TensorRT runtime`);
  console.log(`  ${C.dim}# AI_INFER_MAX_BATCH=4${C.reset}          # 6-8GB VRAM nên để 2-4; 4090 (24GB) thì 8-16`);
} else {
  console.log(`  ${C.dim}# Chưa bật GPU cho tới khi có ít nhất 1 EP GPU (DirectML hoặc CUDA) test ĐẠT.${C.reset}`);
}
if (results.torchCuda) {
  console.log(`  ${C.green}LOCAL_TRAINER_CMD=python tools/trainer/train.py${C.reset}   # bật B8 training sidecar`);
}
console.log(`\n${C.dim}Lưu ý VRAM nhỏ (6-8GB): chạy luân phiên vision/train, model segmentation nhỏ (YOLOv8-seg n/s), ảnh 512px, batch 2-4. Lên RTX 4090 (24GB) sẽ thoải mái.${C.reset}`);

const allCore = results.gpu && results.ortCpu && (results.ortDml || results.ortCuda);
process.exit(allCore ? 0 : 1);
