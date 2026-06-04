# Hướng dẫn tạo model Segmentation cho `/mask-annotation`

> Mục tiêu: có 1 model segmentation ONNX để nút **"Chạy segmentation"** trên `/mask-annotation` hoạt động (decode mask + đo metrology).

## Hiểu đúng trước
- **Trang `/mask-annotation` vẽ nhãn mask CHẠY ĐƯỢC NGAY, KHÔNG cần model** — đây là công cụ để QC tô vùng lỗi (tạo nhãn). Lưu mask qua `saveMask`.
- Cái **cần model** là nút **chạy segmentation**: nó gọi `runSegmentation(modelId, ảnh)` → bạn **nhập modelId** của một model đã đăng ký vào ô "Model ID".
- Engine tự nhận YOLOv8-seg qua output (`output0 [1,4+nc+32,N]` + `output1 [1,32,h,w]`).

Có **2 cách** tạo model. Dùng **Cách A** để có model chạy ngay (test pipeline), **Cách B** để có model defect thật.

---

## CÁCH A — Nhanh: dùng YOLOv8-seg pretrained (KHÔNG cần gán nhãn)
Dùng để **bật nút chạy ngay + kiểm chứng decode YOLO-seg với .onnx thật** (gỡ cờ `experimental` X5). Lưu ý: model COCO nhận lớp đời thường (person/car…), KHÔNG phải defect — chỉ để chứng minh pipeline.

```bash
# 1) Export YOLOv8-seg (Ultralytics đã cài) → ONNX. Lần đầu tự tải yolov8n-seg.pt (cần mạng 1 lần),
#    hoặc đặt sẵn yolov8n-seg.pt cục bộ.
yolo export model=yolov8n-seg.pt format=onnx opset=13 imgsz=640
#    → sinh file yolov8n-seg.onnx

# 2) Đăng ký vào hệ thống (lấy modelId)
SEG_MODEL_PATH=D:/16.AI/yolov8n-seg.onnx \
SEG_MODEL_CODE=yolov8n-seg-coco \
SEG_LABELS="person,bicycle,car,motorcycle,airplane,bus,train,truck,boat,traffic_light" \
SEG_IMGSZ=640 \
node scripts/ai-kb/register-seg-model.mjs
#    → in ra modelId (vd 4)
```
3) Mở `/mask-annotation` → nhập **modelId** vào ô "Model ID" → tải 1 ảnh → bấm **chạy** → thấy mask + số đo (px). Xác nhận decode thật chạy được.

> (SEG_LABELS COCO đầy đủ 80 lớp; ở trên rút gọn để minh hoạ — thiếu thì decode hiển thị `class_<i>`.)

---

## CÁCH B — Model defect THẬT (quy trình production)
### Bước 1 — Gán nhãn mask (QC)
- Mở `/mask-annotation`, tải ảnh defect, **vẽ polygon** quanh vùng lỗi, chọn **nhãn lớp** (vd scratch/dent/stain), Lưu.
- Cần đủ dữ liệu để model học: **vài trăm ảnh/loại lỗi** (tối thiểu vài chục để thử).

### Bước 2 — Build dataset segmentation
```bash
# Tạo dataset rỗng trước (qua AI Data Processing / API) để có datasetId, rồi:
# endpoint: aiSegmentation.buildDataset({ datasetId, seed? })  (admin)
#   → sinh manifest YOLO-seg JSONL từ defect_segmentations (nhãn QC), trả classLabels
```
(Hoặc gọi qua UI Data Processing. `buildSegmentationDataset` chuẩn hoá điểm theo width/height → manifest `{imageUrl, masks:[{label, points}]}`.)

### Bước 3 — Train (Tier-2 sidecar, đã bật `LOCAL_TRAINER_CMD`)
```bash
# endpoint: aiEval.startPipeline({ modelId?, datasetId, classLabels, task:"segmentation",
#                                  trainingMode:"local-sidecar", framework:"ultralytics", config:{epochs,imgsz,batch} })
# → server chạy tools/trainer/train.py (YOLOv8-seg) trên GPU/CPU → export ONNX vào output/model.onnx
```
⚠️ VRAM 6GB: dùng `yolov8n-seg`, `imgsz=512–640`, `batch=2`. Chậm trên CPU build, nhanh hơn nếu có CUDA.

### Bước 4 — Đăng ký model vừa train
```bash
SEG_MODEL_PATH=<đường .onnx output từ train> \
SEG_MODEL_CODE=defect-seg-v1 \
SEG_LABELS="scratch,dent,stain"   # ĐÚNG thứ tự classLabels lúc train \
SEG_IMGSZ=640 \
node scripts/ai-kb/register-seg-model.mjs
```
### Bước 5 — Chạy trên `/mask-annotation`
Nhập **modelId** → tải ảnh → chạy → mask + metrology. Cấp **µm/pixel** (calibration) để số đo ra mm/µm, thiếu thì hiển thị px.

---

## Lưu ý kỹ thuật quan trọng
- **Preprocessing YOLOv8 = resize + /255** (KHÔNG ImageNet mean/std). Script `register-seg-model.mjs` đã set `normalize mean=[0,0,0] std=[1,1,1]` đúng. Nếu tự đăng ký kiểu khác → sai kết quả.
- **imgsz lúc register PHẢI khớp imgsz lúc export ONNX** (mặc định 640).
- **labels đúng thứ tự index** của lúc train → tên lớp hiển thị đúng.
- Mask trả ở lưới proto (vd 160×160) — UI/metrology tự scale về ảnh gốc.
- Sau khi validate decode với model thật → có thể gỡ cờ `experimental` (X5) trong `aiSegmentation`/`aiInferenceEngine`.

## Khuyến nghị
1. Làm **Cách A** trước (5 phút) → xác nhận nút chạy + decode OK trên máy.
2. Song song cho QC **gán nhãn** (Cách B Bước 1) — đây là phần tốn thời gian nhất, không phụ thuộc GPU.
3. Khi đủ nhãn → train + đăng ký model defect thật.
