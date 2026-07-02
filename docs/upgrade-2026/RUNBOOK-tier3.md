# RUNBOOK — Vận hành AI 4.0 (Local GGUF + Tier 3) cho đội

> Hướng dẫn gọn để đội vận hành các năng lực AI đã triển khai (Phase 190–192 + Tier 3).
> Cập nhật 2026-05-31. Mọi tính năng **offline-first** + **degrade trung thực** (thiếu model/calibration → báo rõ, KHÔNG bịa).

## 0. Kiểm tra môi trường (chạy đầu tiên, bất cứ lúc nào)
```bash
node scripts/check-tier3-env.mjs
```
In ra: GPU, PyTorch CUDA, onnx/ultralytics, onnxruntime EP (DirectML/CUDA), + env cần set. Exit 0 = sẵn sàng.

## 1. Migration cơ sở dữ liệu (bắt buộc trước khi dùng tính năng mới)
```bash
node scripts/migrate-standalone.mjs        # --dry-run để xem trước
```
Áp các migration: `0091` (vector search), `0104–0106` (Phase 190/191), `0107–0110` (Nhánh B), `0111` (segmentation). Tất cả idempotent — chạy lại an toàn.

## 2. Cấu hình `.env` (theo nhu cầu)
```bash
# --- AI local (Phase 191) ---
USE_LEGACY_OLLAMA=false                 # GGUF in-process, không cần Ollama daemon
GGUF_EMBED_MODEL=mxbai-embed-large-v1-f16
# Vision (nếu có): GGUF_VISION_MODEL + GGUF_VISION_MMPROJ + LLAMA_SERVER_BIN (xem WS-G2)

# --- GPU ONNX inference (B9) ---
ENABLE_GPU=true                         # DirectML trên Windows (KHÔNG cần CUDA Toolkit)
# AI_INFER_EP=dml                       # override tường minh: dml|cuda|tensorrt|cpu
# AI_INFER_MAX_BATCH=4                   # VRAM 6-8GB → 2-4; RTX 4090 → 8-16

# --- Tính năng Tier 2 (degrade-safe, bật khi có model) ---
# ANOMALY_DETECTION_ENABLED=true         # B3 anomaly (cần model ONNX embedding + memory bank)
# IMAGE_EMBEDDING_DEFAULT=onnx           # B4 visual embedding (cần model ONNX + re-embed)
# ALIGN_BEFORE_DIFF=true                 # B4.2/AOI-B golden-sample SUB-PIXEL registration (affine + confidence gate)

# --- Deep training Tier-2 (B8) ---
# LOCAL_TRAINER_CMD=python tools/trainer/train.py
# LOCAL_TRAINER_TIMEOUT_MS=7200000
```

## 3. Quy trình "AI thị giác đo lường" (B7 segmentation) — end-to-end
```
(1) QC gán nhãn:  mở trang /mask-annotation → vẽ mask vùng lỗi (polygon), chọn nhãn lớp, lưu.
                  Cần vài trăm ảnh/loại lỗi để model học tốt.
(2) Build dataset: (sẽ bổ sung) aiDatasetBuilder sinh manifest seg {imageUrl, masks:[{label,points}]}
                  từ bảng defect_segmentations (points normalized 0-1).
(3) Train:        bật LOCAL_TRAINER_CMD → tạo training job task="segmentation"
                  → python tools/trainer/train.py train YOLOv8-seg → export ONNX.
                  (đăng ký model: postprocessConfig.type="segmentation", format="yolo-seg", labels đúng thứ tự)
(4) Inference:    engine runSegmentation decode mask → đo lường.
(5) Calibration:  cung cấp µm/pixel theo máy/độ phóng đại → số đo ra mm/µm.
                  Thiếu → hệ thống hiển thị "px" + cờ degraded (không bịa).
```

## 4. Bảng năng lực & trạng thái
| Năng lực | Bật bằng | Cần gì để có "kết quả thật" |
|---|---|---|
| AI văn bản/chat/RCA/report local | (mặc định GGUF) | model GGUF chat trong `uploads/gguf-models` |
| Embeddings KB + ảnh local | `USE_LEGACY_OLLAMA=false` | model mxbai GGUF |
| Vision (mô tả/OCR/so sánh) | `GGUF_VISION_MODEL` + `LLAMA_SERVER_BIN` | Qwen2-VL GGUF + mmproj + llama-server (xem WS-G2) |
| GPU ONNX inference | `ENABLE_GPU=true` | (đã verify DirectML trên RTX 4050) |
| Anomaly không nhãn (B3) | `ANOMALY_DETECTION_ENABLED=true` | model ONNX embedding + build memory bank |
| Visual embedding (B4) | `IMAGE_EMBEDDING_DEFAULT=onnx` | model ONNX embedding + re-embed lịch sử |
| Golden alignment (B4.2 → AOI-B) | `ALIGN_BEFORE_DIFF=true` | (thuần JS/sharp, dùng ngay) — nay là **sub-pixel affine** (LK/ECC pyramid) + **confidence/residual gate**; low-confidence → aligned:false (không diff bừa). Golden reference lưu ở bảng `golden_sample_references` (mig 0158, service `goldenSampleService`). |
| XAI heatmap (B5) | (tự động) | model expose feature-map → Score-CAM; không thì occlusion/pixel-diff |
| Calibration confidence (B2) | (tab Calibration) | đủ mẫu Quality Gate đã review |
| A/B canary (B6) | gán `activeExperimentId` cho config | 2 model + đủ feedback review |
| Deep training (B8) | `LOCAL_TRAINER_CMD` | Python+PyTorch/ultralytics (đã cài) + dataset nhãn |
| Segmentation đo lường (B7) | model seg + `type=segmentation` | quy trình mục 3 |

## 5. Lưu ý phần cứng (RTX 4050 6GB hiện tại)
- KHÔNG chạy song song vision (Qwen2-VL ~4.4GB) + train. Làm **luân phiên**.
- Train: model nhỏ (mobilenet/resnet18 classification; YOLOv8-seg **n/s** segmentation), ảnh 224–320px, batch 2–4.
- Lên **RTX 4090 (24GB)**: train production + vision + inference đồng thời thoải mái.

## 6. ⚠️ Caveat từ audit độc lập (cần biết)
- **Decode YOLOv8-seg đúng thuật toán nhưng MỚI smoke-test tensor giả** — **chưa validate end-to-end với .onnx YOLOv8-seg thật**. Trước khi tin số đo metrology trên nhánh YOLO-seg production, hãy chạy 1 lần kiểm chứng với model + ảnh thật (so mask decode vs Ultralytics gốc).
- Mask YOLO-seg trả ở lưới proto (vd 80×80) → caller phải scale về kích thước ảnh gốc khi đo.
- onnxruntime-node npm **không có CUDA EP** trên Windows → dùng **DirectML** (đã wire). CUDA EP cần build native riêng.
- B3/B4 anomaly/visual-embedding cần model ONNX embedding (chưa có) → hiện degrade về text-of-image/heuristic (báo cờ rõ).

## 7. Sự cố thường gặp
| Triệu chứng | Nguyên nhân & xử lý |
|---|---|
| Log `ECONNREFUSED 127.0.0.1:11434` | Còn gọi Ollama → đặt `USE_LEGACY_OLLAMA=false` |
| ONNX inference vẫn chạy CPU dù `ENABLE_GPU=true` | Kiểm `node scripts/check-tier3-env.mjs` (DirectML EP phải ĐẠT); xem server log `Execution providers: dml → cpu` |
| `torch.cuda.is_available()=FALSE` | Cài lại torch bản CUDA: `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124` |
| Train OOM (6GB) | Giảm batch=1, imgsz=160–256, model nhỏ hơn |
| `MODEL_NOT_AVAILABLE` khi gọi segmentation | Chưa đăng ký/active model seg → train qua mục 3 |
| Số đo hiển thị "px" thay vì mm | Chưa cấu hình µm/pixel — đúng hành vi (không bịa) |
| Push GitHub lỗi HTTP 500 | File >100MB (GGUF/APK) — đã `.gitignore`; commit không kèm model |

## 8. Tài liệu liên quan
- [BRANCH-A-local-gguf.md](BRANCH-A-local-gguf.md) — AI local GGUF (G1–G4).
- [BRANCH-B-professional-parity.md](BRANCH-B-professional-parity.md) — Tier 1+2+3 (B1–B9).
- [WS-G2-vision-local.md](WS-G2-vision-local.md) — cài vision sidecar (Qwen2-VL + llama-server).
- `tools/trainer/README.md` — hợp đồng training sidecar (job.json/progress.json/result.json) + manifest classification & segmentation.
