# WS-G2 — Vision local thật

## 🔴 CHẶN: tiền đề "nâng node-llama-cpp in-process" không khả thi
Đã xác minh:
- `npm` dist-tags: `latest=3.18.1` (không có bản vision). Vision = roadmap **v4.0.0** (issue #88 OPEN, chưa phát hành).
- `LlamaChatSession.prompt()` 3.18.1 không có option `image/images/mmproj`; `dist` không có `mtmd/mmproj/llava/tokenizeImage`.
- mtmd có trong lõi llama.cpp nhưng **chưa được node-llama-cpp bind ra JS**.

→ Không thể bật vision in-process bằng nâng version ngay bây giờ.

## Hiện trạng (file:line)
- `aiGgufEngine.ts:549-619` `describeImage` truyền `{images}`/`{image}` → option không hợp lệ → throw → fallback text.
- `aiGgufEngine.ts:500-543` `loadLlavaModel` truyền `mmproj` (bị bỏ qua).
- `uploads/gguf-models/llava-v1.6-mistral-7b-q4_k_m.gguf` = **~70MB (HỎNG**, bản thật ~4.4GB); `mmproj-model-f16.gguf` ~595MB (của LLaVA).
- Call sites: `aiAdvancedVision.ts:183,319,441,474` (qua router, sẵn sàng); `aiVisionLanguage.ts:108 describeDefect` (local), `:140 compareImages`/`:220 generateQAReport` (GPT-4o cloud); `inspectionRouters.ts:416`, `annotationRouters.ts:602` (invokeLLM cloud).

## 3 đường đi
- **A — Sidecar `llama-mtmd-cli`/`llama-server` local (KHUYẾN NGHỊ, khả thi ngay, vẫn offline 100%).** Engine spawn tiến trình con llama.cpp trên 127.0.0.1, gọi qua HTTP localhost. Mâu thuẫn ràng buộc "in-process" → cần chủ dự án nới ràng buộc.
- **B — Chờ v4.0.0 in-process (đúng ràng buộc, vô thời hạn).** Ẩn vision sau feature-flag, nối API khi v4 ra.
- **C — Tự viết native binding libmtmd (chi phí rất cao, không khuyến nghị).**

## Bước làm NGAY (bất kể đường nào — dọn nợ + trung thực)
1. **Bỏ "vision giả":** `describeImage` báo lỗi rõ `VISION_NOT_AVAILABLE` thay vì silent-fail thành mô tả bịa; router trả `fallbackUsed:true`+lý do để UI trung thực.
2. **Validate model file:** kiểm magic header GGUF (`0x47475546`) + kích thước tối thiểu → bắt file 70MB hỏng.
3. **Tải lại model vision hợp lệ:** khuyến nghị **Qwen2-VL-7B-Instruct** hoặc **MiniCPM-V-2.6** + mmproj KHỚP (mmproj hiện là của LLaVA, không dùng chéo). Đặt vào `uploads/gguf-models/`, set `GGUF_VISION_MODEL`/`GGUF_VISION_MMPROJ`.

## Bước theo Đường A (sau khi nới ràng buộc)
4. Module quản lý tiến trình `llama-server`/`mtmd-cli`: spawn lazy, healthcheck localhost, gửi ảnh+prompt, parse; giữ chữ ký `describeImage` không đổi → router/call site không sửa.
5. Quản lý vòng đời + bộ nhớ (phối hợp G1): idle-timeout kill.
6. Nối call site: `aiAdvancedVision` (tự hưởng); chuyển `compareImages`/`generateQAReport`/inspection/annotation từ cloud → router vision; cloud làm fallback sau cờ env.
7. Hồi quy toàn bộ API engine text/JSON/embedding/stream.
8. Cấu hình & tài liệu env + đường dẫn binary llama.cpp.

## Tests
Regression engine (không cần vision); vision describe trả nội dung THẬT từ ảnh (OCR đúng chuỗi / khác biệt OK-NG), en+vi; validate model hỏng báo lỗi; fallback trung thực (`fallbackUsed:true`).

## Nghiệm thu
Không còn vision giả; describe phản ánh đúng ảnh; 100% offline (Đường A: tiến trình con localhost); API engine không hồi quy; model vision hợp lệ + mmproj khớp.

## Rủi ro & rollback
R1 in-process chưa tồn tại → Đường A/B (cần quyết định). R2 mmproj không khớp → tải đúng cặp. R3 RAM/VRAM → LRU G1. R4 v4 major breaking → pin + hồi quy. Rollback: vision sau cờ env, tắt cờ → quay về hành vi cũ; không đổi schema DB.

## Hướng dẫn cài đặt (Đường A — sidecar llama-server mtmd, 100% offline)

### 1. Tải model vision Qwen2-VL-7B-Instruct GGUF + mmproj KHỚP
- Model + mmproj phải cùng một họ. KHÔNG dùng mmproj của LLaVA cho Qwen2-VL.
- Nguồn khuyến nghị (Hugging Face, tải về máy chạy offline):
  - `Qwen/Qwen2-VL-7B-Instruct-GGUF` — lấy file model lượng tử (vd `qwen2-vl-7b-instruct-q4_k_m.gguf`, ~4.4GB) **và** file `mmproj-*.gguf` (projector, f16) trong CÙNG repo.
  - (Thay thế) `MiniCPM-V-2.6 GGUF` + mmproj tương ứng nếu cần model nhẹ hơn.
- Đặt cả 2 file vào thư mục `GGUF_MODELS_DIR` (mặc định `./uploads/gguf-models`).
- Xoá/đừng dùng file LLaVA cũ `llava-v1.6-mistral-7b-q4_k_m.gguf` (~70MB) — đây là file HỎNG; engine sẽ chặn nó qua `validateGgufFile` (magic header `GGUF` + kích thước tối thiểu).

### 2. Cài/biên dịch `llama-server` có mtmd
- Tải bản build sẵn từ Releases của `ggml-org/llama.cpp` (asset có `llama-server`), hoặc tự build:
  ```bash
  git clone https://github.com/ggml-org/llama.cpp
  cd llama.cpp
  cmake -B build -DGGML_CUDA=ON      # bỏ -DGGML_CUDA nếu chạy CPU
  cmake --build build --config Release -j --target llama-server
  # binary: build/bin/llama-server (multimodal/mtmd đã có sẵn trong server)
  ```
- Kiểm thử thủ công (tuỳ chọn):
  ```bash
  ./build/bin/llama-server -m <model>.gguf --mmproj <mmproj>.gguf --host 127.0.0.1 --port 8081 -ngl 999
  # rồi GET http://127.0.0.1:8081/health phải trả {"status":"ok"} khi nạp xong
  ```

### 3. Cấu hình env (xem `.env.example`)
```
GGUF_MODELS_DIR=./uploads/gguf-models
GGUF_VISION_MODEL=qwen2-vl-7b-instruct-q4_k_m.gguf
GGUF_VISION_MMPROJ=mmproj-qwen2-vl-7b-instruct-f16.gguf
LLAMA_SERVER_BIN=/opt/llama.cpp/build/bin/llama-server   # Windows: C:\llama.cpp\build\bin\llama-server.exe
LLAMA_VISION_HOST=127.0.0.1
LLAMA_VISION_PORT=8081
# tuỳ chọn: LLAMA_VISION_READY_TIMEOUT_MS, LLAMA_VISION_IDLE_TIMEOUT_MS, LLAMA_VISION_GPU_LAYERS
```

### 4. Hành vi
- Khi đủ 3 thứ (binary + model + mmproj tồn tại trên đĩa) → `isVisionSidecarAvailable()` = true → engine spawn lazy `llama-server` trên 127.0.0.1, chờ `/health`, gọi `POST /v1/chat/completions` (OpenAI-compatible) với `image_url: { url: "data:image/...;base64,..." }`. Idle 10 phút → tự kill (`stopSidecar`).
- Khi THIẾU → `describeImage` ném `VISION_NOT_AVAILABLE`; `aiProviderRouter.describeImage` trả `fallbackUsed:true` + lý do; `aiVisionLanguage` dùng fallback tĩnh/GGUF-text. KHÔNG bịa mô tả. Hệ thống vẫn chạy.

### Format API llama.cpp mtmd (đã xác minh)
- Multimodal nằm ở endpoint OAI-compatible `/v1/chat/completions`; ảnh gửi qua content part `image_url` với `url` là data URI base64 (`data:image/<mime>;base64,...`). Client nên kiểm `/health` hoặc `/v1/models` trước. Nguồn: `tools/server/README.md` của llama.cpp.

## Nguồn
node-llama-cpp issues #88/#562/#585; releases; llama.cpp multimodal.md; mtmd README; llama.cpp `tools/server/README.md` (https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## Critical files
`server/services/aiGgufEngine.ts` · `aiProviderRouter.ts` · `aiVisionLanguage.ts` · `inspectionRouters.ts` · `annotationRouters.ts`
