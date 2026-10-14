# Khảo sát AI Local — tầng 1–4 (Phần cứng · Mô hình · Engine · API/cổng)

Ngày đo: 2026-10-14 ~22:00 (+07). Repo `D:\SOURCES\avi-aoi-management`, nhánh `feat/ai-local-L7-hang-rao`.
Khảo sát CHỈ ĐỌC: không sửa tệp, không git ghi, không dừng/khởi động tiến trình, không nạp model.

Ký hiệu cột trạng thái: **M** = có mã · **N** = nối dây tới đường thật · **T** = có lưới test · **Đ** = đã đo sống (hôm nay, trừ khi ghi ngày khác).
**[ĐO]** = số đo của chính lượt khảo sát này. **[ĐO-cũ]** = số đo lịch sử ghi trong repo (baseline/log/chú thích). **[SUY]** = suy ra từ đọc mã, chưa đo.

---

## 0. Phát hiện quan trọng nhất (đo sống)

**llama-server :8091 KHÔNG chạy lúc khảo sát.** [ĐO]
- `curl http://127.0.0.1:8091/health` → không kết nối (HTTP 000); không tiến trình `llama-server` nào; `netstat` không có cổng 8091.
- `nvidia-smi`: VRAM dùng 2.054 / 32.607 MiB ⇒ **không model nào đang nạp trên card**.
- `GET :3000/api/health/ai` (đường thật của app) trả `status:"down"`, `llamaServer: down`, `textGeneration: degraded — "đang chạy in-process, MẤT PREFIX-CACHE ... fallback: silent"`.
- Task Scheduler `\AVI-AOI llama-server` có (chạy `scripts\ai\start-llama-server.cmd`), kiểu **"At logon time"**, lần chạy cuối 10/9/2026 06:21 kết quả 0. Log `logs/llama-server-20261009-062144.err.log` kết thúc ở "server is listening" — không có dòng lỗi/thoát ⇒ tiến trình chết/bị dừng sau đó mà **không gì khởi động lại** (không có supervisor; `server/` không có mã spawn lại llama-server chữ — chỉ `aiReadiness.ts:353` nhắc người chạy script tay).
- Hệ quả [SUY từ mã `aiGgufEngine.ts:2000-2045`, `aiLlamaServerClient.ts` header]: lượt sinh chữ kế tiếp sẽ preflight 2 s thất bại → lùi in-process → **nạp Qwen3.6-35B (21,3 GB) vào tiến trình node** (cold-load ~51–68 s), mất prefix-cache (TTFT 5.304 ms thay vì 71 ms — số [ĐO-cũ] chép trong `start-llama-server.ps1`).

Đây là lỗ "hỏng trong im lặng" mà chính repo đã đặt tên — và nó đang xảy ra thật.

---

## Tầng 1 — Phần cứng

### Bảng tính năng / thực trạng

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| GPU NVIDIA RTX 5090, 32.607 MiB, compute 12.0, driver 610.62, 575 W | Đ | [ĐO] `nvidia-smi --query-gpu=...` |
| VRAM hiện dùng 2.054 MiB (chỉ desktop/trình duyệt) | Đ | [ĐO] — không model nào trên card |
| CPU i9-12900K 16 nhân / 24 luồng | Đ | [ĐO] `Win32_Processor` |
| RAM 64 GB (32+16+16, chạy **2133 MHz**), trống ~30 GB | Đ | [ĐO] `Win32_PhysicalMemory`, `FreePhysicalMemory` |
| Đĩa model D: = **SATA SSD** WD WDS100T2B0A 1 TB (trống 635 GB); C: = NVMe 512 GB **chỉ còn 3,9 GB trống** | Đ | [ĐO] `Get-PhysicalDisk`, `Get-PSDrive` |
| Cold-load Qwen3.6-35B (21,3 GB) từ SATA: **51,3 s** (02,84 s → 54,15 s trong log) | Đ (log 10/9) | [ĐO-cũ] `logs/llama-server-20261009-062144.err.log`; chú thích router ghi 68,1 s (`aiModelRouter.ts:404`) |
| Pagefile 68 GB trên D: | Đ | [ĐO] `Win32_PageFileUsage` |
| Bộ điều phối VRAM (broker, sổ chung, chống nạp trùng, preempt, reconciler) | M N T | `server/services/vram/` 30 tệp ~16.700 dòng + 51 tệp test; `aiGgufEngine.ts:2000` chặn nạp bản thứ hai; tRPC `vramRouter.ts:180` (state/preempt/releaseStale) |
| Readiness phần cứng/engine cho người vận hành | M N Đ | `server/_core/index.ts:499` `/api/health/ai` → [ĐO] trả JSON chẩn đoán đúng |
| Ngân sách VRAM 35B + KV 64k | Đ-cũ | `ggufCtxCap.ts:31-33`: còn 6,1 GiB sau nạp; log 10/9 nạp 65.536 thành công |
| Song song 2 slot | ✗ | `start-llama-server.ps1`: 2 slot cần ctx tổng 131072 (+~5 GiB KV) — không vừa cùng sidecar vision 8B |

### Khoảng trống tầng 1
- **P1 — Một GPU duy nhất, ngân sách VRAM đã kín** (35B ~21 GB + KV 64k ~2,5–5 GB + in-process embed/rerank/FIM/4B + sidecar vision 8B ~6 GB). *Vì sao chặn mục tiêu:* không thể phục vụ hai người/hai agent song song (agent quản lý dự án + ghost-text + chat vận hành cùng lúc) mà không hạ ctx hoặc đuổi model.
- **P2 — Model nằm trên SATA SSD** (51–68 s cold-load). *Vì sao:* mỗi lần llama-server chết/đổi model là một phút "AI không trả lời"; với việc không có supervisor (tầng 3) thì đây là thời gian chết thật.
- **P2 — Ổ C: còn 3,9 GB.** *Vì sao:* npm/vite/node temp, log, cache build trên C: có thể đầy giữa chừng làm chết app/server (không trực tiếp chặn AI nhưng là rủi ro vận hành).
- P2 (nhỏ) — RAM chạy 2133 MHz (bộ nhớ trộn): chỉ quan trọng nếu offload CPU; hiện mọi lớp lên GPU (`-ngl 999`).

### Điểm tầng 1: **≈ 70 %**
Tiêu chí (mỗi cái 1 điểm, 0,5 = một phần): (1) GPU đủ cho model mặc định + ctx 64k ✓; (2) RAM đủ ✓; (3) lưu trữ model nhanh ✗ (SATA, 0,5 vì vẫn chạy được); (4) quản lý VRAM có mã + lưới ✓; (5) giám sát sức khỏe đo được ✓; (6) dư địa cho song song/đa model ✗ (0); (7) đĩa hệ thống an toàn ✗ (0,5). ⇒ 5/7 ≈ 70 %.

---

## Tầng 2 — Mô hình

### Model trên đĩa `D:\SOURCES\16.AI` [ĐO `ls`]

| Tệp | Kích thước | Vai trò cấu hình (`.env`) |
|---|---|---|
| Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf | 21.325 MB | **GGUF_DEFAULT_MODEL = GGUF_CODE_MODEL = LLAMA_SERVER_MODEL** (dòng 120, 735, 808) |
| Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf | 2.429 MB | GGUF_FAST_MODEL (122) — planner Tier 1, câu KB ngắn |
| Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf | 941 MB | GGUF_FIM_MODEL (738) — ghost-text |
| Qwen3-Embedding-0.6B-f16.gguf | 1.143 MB | GGUF_EMBED(DING)_MODEL, dim 1024 (189–193) |
| bge-reranker-v2-m3-Q8_0.gguf | 607 MB | GGUF_RERANKER_MODEL (464) |
| Qwen3-VL-8B-Instruct-UD-Q4_K_XL + mmproj-F16 | 4.911 + 1.106 MB | GGUF_VISION_MODEL/MMPROJ (187–188), sidecar :8081 |
| Qwen3.6-35B-A3B-MTP-UD-Q4_K_XL | 21.795 MB | KHÔNG dùng (B5: MTP nhanh 9 % nhưng tụt 4 bài) |
| Qwen3-30B-A3B-Instruct-2507 · Qwen3-Coder-30B-A3B · Qwen3.6-27B · Qwen3.8-27B | ~16,3–16,9 GB mỗi tệp | KHÔNG dùng (roster cũ / A/B) |
| Qwen3-Reranker-0.6B · mxbai-embed-large-v1 | 610 · 639 MB | KHÔNG dùng (mxbai = đường Ollama cũ) |

Ollama 0.40.1 đang chạy :11434 [ĐO], chỉ có `devstral-small-2:latest` (24B Q4_K_M, 15,2 GB), không model nào nạp (`/api/ps` rỗng). Mã còn đường lùi Ollama (`aiLocalKnowledgeService.ts:472-474,1851`) trỏ `qwen2.5:7b-instruct`/`mxbai-embed-large` — **không có trên Ollama** ⇒ đường lùi chết [ĐO + SUY].

Tổng GGUF không dùng ≈ 89 GB + 15 GB Ollama.

### Bảng tính năng

| Tính năng | Trạng thái | Bằng chứng |
|---|---|---|
| Model chính biết nghĩ, MoE 3B active, ctx native 262k (dùng 65k), tool-calling gốc | M N T Đ-cũ | log 10/9: `n_ctx_train 262144`, `thinking = 1`; hồ sơ `aiModelRouter.ts:395-430` decode 187,9 t/s [ĐO-cũ 09-22]; trục H 86 % / M 78–83 % (memory, scripts/ai-eval) |
| Model riêng cho code | ✗ thực chất | `code` = `chat` = cùng Qwen3.6-35B (`/v1/models` [ĐO] trả root giống nhau) |
| Model FIM nhỏ cho ghost-text | M N Đ-cũ | Qwen2.5-Coder-1.5B **Instruct**; [ĐO-cũ 08-16] `/v1/completions` p50 149,5 ms / p95 185 ms, 48 token (`scripts/ai-bench/baselines/ghosttext-altpath-v1completions-2026-08-16.json`) — chỉ đo TRỄ, không đo ĐÚNG |
| Embedding + reranker | M N T | `generateEmbedding`, `aiReranker.ts`; `/api/health/ai` [ĐO] embedding ok, reranker ok (gguf) |
| Vision | M N T | `llamaVisionSidecar.ts` spawn on-demand :8081 (`LLAMA_VISION_*`); không chạy lúc đo |
| Hồ sơ đặc tính model đo tại chỗ (ngưỡng router theo model) | M N T | `ROUTER_MODEL_PROFILES` `aiModelRouter.ts:395+`, cảnh báo khi thừa kế |
| Hồ sơ sampling / chế độ nghĩ theo lớp lượt / ngân sách nghĩ theo yêu cầu | M N T | `ai/hoSoSampling.ts`, `ai/loaiLuot.ts`, `ai/nghiSau.ts`, `--reasoning-budget 12000` (.env:1026) |
| Bộ đo chất lượng (codegen, tool-call, RAG, bench tốc độ) | M Đ-cũ | `scripts/ai-eval/*` (eval-codegen, eval-toolcall, eval-rag-*, toolcall-roundtrip), `scripts/ai-bench/bench.mjs` + 19 baseline |
| Hồ sơ model cho Training Studio (model đang phục vụ, lệch cấu hình) | M N | `ai/hoSoModelStudio.ts` → `kbStudioRouter.ts` |
| Tinh chỉnh (LoRA/fine-tune) theo miền | ✗ | memory G9 "LoRA KHÔNG làm"; chỉ có cơ chế few-shot/KB |
| Registry model LLM (checksum, phiên bản) | ✗ | `models/manifest.json` chỉ cho dinov2/ONNX OCR |

### Khoảng trống tầng 2
- **P1 — Không có model code chuyên biệt / phân vai thật**: chat, code, agent dùng chung 35B; chỉ có "35B hoặc 4B". *Vì sao:* không tối ưu được "agent quản lý dự án" (cần model ổn định cho tool-call dài) khác "sinh mã" — nhưng điểm đo hiện tại (H 86 %) cho thấy đây là chấp nhận được; mức P1 vì chưa có lựa chọn thứ hai được đo cho agentic.
- **P1 — FIM chỉ đo độ trễ, không đo độ ĐÚNG; dùng bản Instruct thay vì base** (FIM tốt nhất trên bản base). *Vì sao:* ghost-text kiểu Copilot sống bằng tỉ lệ chấp nhận gợi ý; không có số đo ⇒ không biết nó giúp hay làm phiền.
- **P2 — Không fine-tune theo miền** (ST/IEC 61131, C# của repo). *Vì sao:* mức "thông minh hơn" dừng ở RAG; với code PLC đặc thù, model 3B-active tự sai API mà RAG không sửa hết.
- **P2 — ~104 GB model chết trên đĩa + đường lùi Ollama trỏ model không tồn tại.** *Vì sao:* nhiễu khi đổi roster, và đường lùi Ollama "có trong mã" nhưng sẽ 404.

### Điểm tầng 2: **≈ 70 %**
Tiêu chí: (1) model chính đủ mạnh cho code+tool+ctx dài, có số đo ✓; (2) có model FIM nhỏ ✓ (0,5: Instruct, không đo đúng); (3) embed + rerank ✓; (4) vision ✓; (5) fast tier ✓; (6) hồ sơ/sampling/nghĩ theo lượt ✓; (7) bộ đo chất lượng ✓; (8) model code/agent riêng được đo ✗; (9) thích nghi miền (LoRA) ✗; (10) registry/vệ sinh kho ✗ (0,5 vì có hoSoModelStudio). ⇒ 7,0/10 = 70 %.

---

## Tầng 3 — Inference engine

### Hai đường chạy
1. **llama-server persistent** (`LLAMA_SERVER_ENABLED=true`, `.env:806-808`): build **b9814** (`llama-server.exe --version` [ĐO]), CUDA 13 (`cudart64_13.dll`), tham số từ `scripts/ai/start-llama-server.ps1`: `-c 65536 -np 1 -fa on -ngl 999 -ctk f16 -ctv f16 --slots --metrics --no-webui --reasoning-budget 12000`; prompt cache RAM 8 GiB + context checkpoints (log 10/9).
2. **In-process node-llama-cpp** (lùi khi server chết; luôn dùng cho embed/rerank/FIM/fast 4B): `node-llama-cpp` **3.19.0** (llama.cpp b9842) nhưng gói CUDA prebuilt `@node-llama-cpp/win-x64-cuda(-ext)` **ghim 3.18.1** (`package.json:214-215`) [ĐO].
   [SUY] `node_modules/node-llama-cpp/dist/bindings/utils/compileLLamaCpp.js:409-411` loại gói prebuilt khi `packageVersion !== currentModuleVersion` ⇒ gói CUDA 3.18.1 có thể bị bỏ qua, rơi về `win-x64-vulkan` 3.19.0. Doc 77 (`docs/ECOSYSTEM/77_...:43`) lại khẳng định binary CUDA 3.18.1 (b8390) đang nạp — **mâu thuẫn chưa giải**; bench 07-31 ghi `gpuMode "auto (CUDA/Vulkan)"` (không nói rõ backend). Cần một phép đo `getLlama().gpu`.
3. Ollama :11434 — chỉ đường lùi cũ, model không có (xem tầng 2).

### Bảng tính năng

| Tính năng | Trạng thái | Bằng chứng |
|---|---|---|
| llama-server sống, phục vụ model mặc định | **✗ lúc đo** | [ĐO] :8091 không kết nối; `/api/health/ai` down |
| Tự khởi động khi đăng nhập | M N Đ | Task Scheduler "At logon", last run 10/9 result 0 [ĐO] |
| Tự khởi động lại khi chết (supervisor/watchdog) | ✗ | không có trong `server/` (grep spawn/start-llama-server); task chỉ chạy lúc logon |
| Script khởi động idempotent đọc `.env` | M Đ-cũ | `scripts/ai/start-llama-server.ps1` (kiểm ctx/slot ≥ GGUF_MAX_CTX, không spawn trùng) |
| Lùi in-process khi server chết + preflight 2 s | M N T | `aiGgufEngine.ts:2281-2295`, `thuDuongServer`; `LLAMA_SERVER_STRICT` tắt ⇒ lùi im lặng |
| Chặn nạp BẢN THỨ HAI khi server còn sống | M N T | `aiGgufEngine.ts:2000-2045` (`chanNapTrungModelServer`), `aiLlamaServerClient.napTrung.test.ts` |
| Tách `reasoning_content`, cắt `<think>` theo luồng | M N T | `aiLlamaServerClient.ts:63-110`, `ai/thinkingStrip.ts`, test `suyLuan`, `thinkingLeak` |
| Bật/tắt nghĩ theo lớp lượt, ngân sách nghĩ theo yêu cầu (`thinking_budget_tokens`) | M N T | `ai/loaiLuot.ts:43-95`, `ai/nghiSau.ts` |
| Tool-calling gốc (grammar, gom tool_call từ văn bản) | M N T | `ai/nativeToolCalls.ts`, `aiLlamaServerClient.toolcalls.test.ts`; `.env:951` bật |
| Trần ctx một nguồn + cổng ngân sách ngữ cảnh | M N T | `ai/ggufCtxCap.ts:46-63`, `nganSachTuHoiThoai` `aiGgufEngine.ts:2052` |
| Trần token sinh mã tự nới theo model | M N T | `ai/tranTokenSinhMa.ts` |
| Huỷ khi client bỏ đi (abort signal xuống llama-server) | M N T | `aiCodingAgent.ts:346-349`, `routes/_huyKhiClientBoDi.ts` |
| FIM qua `/infill` của llama-server | M (không dùng) | `aiLlamaServerClient.ts:30-50`; `LLAMA_FIM_SERVER_URL` không đặt + model FIM ≠ model server ⇒ FIM luôn in-process |
| Hàng đợi suy luận | M N T | in-process: semaphore FIFO `ggufConcurrency.ts` (GGUF_MAX_CONCURRENCY=4, queue 8, timeout 180 s); đường server: KHÔNG qua semaphore, xếp hàng FIFO bên trong 1 slot của llama-server |
| Ưu tiên (interactive > background), preempt lượt dài | ✗ | `ggufConcurrency.ts` FIFO thuần; `aiLlamaServerClient.ts` không có `id_slot`/priority (grep 0 kết quả) |
| Đổi model nóng không restart | ✗ | `aiGgufRouter.loadModel` (admin) chỉ nạp in-process; model của llama-server cố định theo tiến trình |
| Speculative/MTP | Đ-cũ, bác | B5: nhanh 9 % nhưng tụt 4 bài (memory) |
| Sidecar vision on-demand + idle timeout | M N T | `llamaVisionSidecar.ts` (spawn `LLAMA_SERVER_BIN`, :8081, idle 600 s) |

Lưới chạy trong lượt này: xem tầng 4 (221 test xanh, gồm `aiLlamaServerClient*.test.ts`, `ggufConcurrency.test.ts`).

### Khoảng trống tầng 3
- **P0 — llama-server chết, không supervisor, lùi im lặng.** *Vì sao chặn mục tiêu:* "AI tự sinh code trên trình duyệt" và "extension như Claude Code" đều đi qua model này; khi nó chết, lượt đầu chờ ~1 phút nạp 21 GB vào tiến trình node, mất prefix-cache (44–74× TTFT), và nếu VRAM đang bị chiếm thì lỗi — người dùng thấy AI chậm/hỏng mà không có gì đỏ ngoài `/api/health/ai`.
- **P1 — Một slot, FIFO, không ưu tiên.** *Vì sao:* một lượt agent/sinh mã dài (nghĩ tới 12k token + sinh 16–32k) chặn mọi lượt khác — câu vận hành đã đo xếp hàng 20–24 s (memory vòng 7); agent "quản lý dự án" chạy nền sẽ khoá luôn chat và ghost-text dùng model chính.
- **P1 — Backend in-process có thể không phải CUDA** (lệch phiên bản 3.19.0 vs 3.18.1, [SUY]). *Vì sao:* embed/rerank/FIM/4B và toàn bộ đường lùi chạy trên backend này; nếu là Vulkan/CPU thì ghost-text và RAG chậm hơn số đã đo, và đường lùi 35B có thể không vừa/không chạy.
- **P2 — Không đổi model nóng**: muốn thử model khác phải sửa `.env` + restart 2 tiến trình (xem tầng 4).

### Điểm tầng 3: **≈ 60 %**
Tiêu chí: (1) engine persistent cấu hình đúng, đo được ✓ (Đ-cũ); (2) đang phục vụ lúc đo ✗; (3) tự phục hồi ✗ (0,5: có task logon); (4) đường lùi an toàn + chặn nạp trùng ✓; (5) tool-call gốc ✓; (6) điều khiển suy luận/ctx/trần token ✓; (7) huỷ lượt ✓; (8) song song/ưu tiên ✗; (9) đổi model nóng ✗; (10) backend in-process xác minh ✗ (0,5). ⇒ 6/10 = 60 %.

---

## Tầng 4 — API / cổng kết nối

### Bảng tính năng

| Tính năng | Trạng thái | Bằng chứng |
|---|---|---|
| **Endpoint tương thích OpenAI `/v1`** gắn vào app :3000 | M N T **Đ** | `routes/openaiGateway.ts` (1.112 dòng), `registerOpenAiGateway` `_core/index.ts:5566`; `.env:740-742` bật + có khoá. [ĐO] `GET :3000/v1/models` không khoá → 401; có Bearer → 200 |
| `GET /v1/models` (logical: chat, code, fast, fim, embed) | M N T Đ | [ĐO] roots: chat/code → Qwen3.6-35B-A3B, fast → Qwen3-4B, fim → Qwen2.5-Coder-1.5B, embed → Qwen3-Embedding-0.6B |
| `POST /v1/chat/completions` stream + non-stream, `reasoning_content`, `tools`/`tool_calls` (BYOT), vai `tool` | M N T | `openaiGateway.ts:559-876`; `AI_NATIVE_TOOLCALLS_ENABLED=true` (.env:951) |
| `POST /v1/completions` + FIM (`suffix`) | M N T Đ-cũ | `openaiGateway.ts:879-1010`; [ĐO-cũ 08-16] p50 149,5 ms; ⚠ stream chỉ phát **MỘT chunk** (`:920-960` — generateFim không stream) |
| `POST /v1/embeddings` | M N T Đ-cũ | `:1013-1054`; [ĐO-cũ] 200, dim 1024 |
| Auth Bearer so khớp hằng thời gian, fail-closed khi thiếu khoá | M N T Đ | `:519-533`, `:1071-1084`; [ĐO] 401 |
| An toàn (che bí mật vào/ra, kể cả luồng), đo lường `ai_gateway_metrics`, rate-limit fail-open, quota/giấy phép opt-in | M N T | `:336-351`, `:650-660`; `aiGatewayQuota.ts` (`AI_QUOTA_ENFORCE` mặc định tắt) |
| Router theo tác vụ | M N T | `/v1`: caller chọn logical model (không tự định tuyến, cố ý); nội bộ: `aiModelRouter.route()` `:581-690` (embed/vision/code/fim/độ khó → tier 1/2/4), `AI_CODE_ROUTER_ENABLED=true` |
| Bộ chọn model theo lượt (UI/API) | M N T | `ai/chonTacVuModel.ts` (auto/fast/code), dùng ở `aiCodingAgent.ts:182,315`, `AICodingWorkspace.tsx`, `useKbChatStream.ts`; chế độ nghĩ `sau/can-bang/nhanh` (`loaiLuot.ts:59`) |
| Đổi model phục vụ qua UI/API | ✗ | phải sửa 3 khoá `.env` (GGUF_DEFAULT_MODEL, GGUF_CODE_MODEL, LLAMA_SERVER_MODEL) + restart llama-server + restart :3000 |
| `doi-model.ps1` | M (công cụ đo) | `scripts/ai-eval/codegen-chay-duoc/doi-model.ps1`: `Get-Process llama-server | Stop-Process` (giết CẢ sidecar vision), đường dẫn viết cứng, **không sửa `.env`, không restart app** ⇒ dùng nó cho sản phẩm sẽ tạo lệch `LLAMA_SERVER_MODEL` ⇒ app nạp bản thứ hai in-process |
| Hàng đợi/ưu tiên | ✗ ưu tiên | xem tầng 3; câu vận hành chờ 20–24 s sau lượt lập trình (memory, vòng 7; `AI_KB_MODEL_TRA_LOI` opt-in ở `aiLocalKnowledgeService.ts:1142-1155` là cách né bằng cách dùng 4B) |
| Ghost-text: đường trình duyệt | M N Đ-cũ | tRPC `programming.copilotComplete` → `generateFim`; client `components/engineering/inlineCopilotController.ts`, `inlineCopilotExtension.ts` |
| Ghost-text: extension VSCode | ✗ | `vscode-extension/src` không có `InlineCompletionItemProvider`; extension gọi `/api/ai/local-kb/stream` + `/api/trpc` (phiên đăng nhập), **không dùng `/v1`** |
| Anthropic Messages `/v1/messages`, OpenAI `/v1/responses` | ✗ ở app | gateway chỉ 4 tuyến; [SUY] chuỗi `/v1/messages`, `/v1/responses` có trong `llama-server-impl.dll` b9814 nhưng :8091 chỉ nghe loopback và không qua cổng an toàn |
| Ảnh trong `/v1/chat/completions` | ✗ | `contentToString` `openaiGateway.ts:369-383` bỏ mọi phần không phải text |
| Rerank endpoint | ✗ | không có |
| Danh tính theo người dùng trên `/v1` | ✗ | một khoá tĩnh dùng chung (`:322-335` tự ghi nhận) ⇒ quota/metering không theo người |
| CORS trên `/v1` | Đ | [ĐO] header `Access-Control-Allow-Origin: *` (khoá vẫn bắt buộc) |
| Readiness | M N Đ | `/api/health/ai` [ĐO] |
| Cấu hình chết | — | `LLAMA_CODER_PORT=8090`, `LLAMA_CODER_CTX` (.env:743-744) không mã nào đọc (`vramAllocationSites.ts:531-532` tự ghi nhận) |
| Chú thích lỗi thời | — | `aiModelRouter.ts:406-407` "65536 KHÔNG nạp nổi" ngược với `ggufCtxCap.ts:46` + log 10/9 (nạp 65.536 thành công) |

### Lưới chạy trong lượt này [ĐO]
```
npx vitest run server/routes/openaiGateway.test.ts server/routes/openaiGateway.nativeTools.test.ts \
  server/routes/openaiGateway.thinkingLeak.test.ts server/routes/openaiGatewayEnforcement.test.ts \
  server/routes/openaiGatewaySafety.test.ts server/routes/openaiGateway.modelResolver.equivalence.test.ts \
  server/services/ai/chonTacVuModel.test.ts server/services/ai/modelResolver.test.ts \
  server/services/aiLlamaServerClient.fim.test.ts server/services/aiLlamaServerClient.test.ts \
  server/services/aiLlamaServerClient.stream.test.ts server/services/aiLlamaServerClient.toolcalls.test.ts \
  server/services/ggufConcurrency.test.ts
→ Test Files 13 passed (13) · Tests 221 passed (221) · 5,5 s
```
(Lưới mock engine — xanh không chứng minh model thật trả lời; đường thật đang down.)

### Khoảng trống tầng 4
- **P1 — Không ưu tiên/không song song ở cổng**: mọi bề mặt (trình duyệt, extension, `/v1`, cron AI nội bộ) dồn vào 1 slot FIFO. *Vì sao:* agent nền "quản lý dự án" và người đang gõ (ghost-text, chat) tranh nhau; không có lớp `interactive` vượt `background`.
- **P1 — Đổi model = sửa `.env` ×3 + restart hai tiến trình; công cụ `doi-model.ps1` gây lệch.** *Vì sao:* người dùng không thể chọn model mạnh hơn/nhanh hơn cho một dự án; thử model mới đòi người vận hành và dễ gây nạp trùng 21 GB.
- **P1 — Extension VSCode không dùng `/v1` và không có ghost-text.** *Vì sao:* mục tiêu (2) "như Copilot" cần inline completion trong editor; `/v1/completions` FIM đã có nhưng extension không nối tới (mức tầng 7, nhưng cổng tầng 4 đang bỏ không cho đúng ca dùng này).
- **P2 — `/v1/completions` stream giả (một chunk); `/v1` bỏ ảnh; không `/v1/messages`/`/v1/responses`/rerank; một khoá chung + CORS `*`.** *Vì sao:* công cụ bên ngoài (Continue, Cline, Claude-Code-tương-thích qua Messages API) chạy được phần chữ nhưng mất đa phương thức, quota theo người và một số client đòi Messages/Responses API.

### Điểm tầng 4: **≈ 65 %**
Tiêu chí: (1) `/v1` OpenAI-compatible gắn + sống ✓; (2) chat stream + tool-calls + reasoning ✓; (3) FIM/completions ✓ (0,5: stream giả); (4) embeddings ✓; (5) auth + an toàn + metering ✓; (6) router theo tác vụ ✓; (7) chọn model theo lượt ✓ (0,5: chỉ 35B/4B); (8) đổi model phục vụ không restart ✗; (9) hàng đợi có ưu tiên ✗; (10) danh tính theo người dùng ✗; (11) Messages/Responses/đa phương thức ✗ (0); (12) readiness ✓. ⇒ 8/12 ≈ 65 %.

---

## Tổng hợp

| Tầng | Điểm | Lỗ lớn nhất |
|---|---|---|
| 1 Phần cứng | ~70 % | một GPU đã kín VRAM, model trên SATA |
| 2 Mô hình | ~70 % | không model code/agent riêng; FIM không đo độ đúng; không thích nghi miền |
| 3 Engine | ~60 % | **llama-server chết lúc đo, không supervisor (P0)**; 1 slot không ưu tiên |
| 4 API | ~65 % | không ưu tiên, đổi model đòi restart, extension không dùng `/v1`/không ghost-text |

Việc nên làm trước (theo thứ tự): (1) supervisor cho llama-server (dịch vụ Windows/NSSM hoặc vòng giám sát trong app gọi `start-llama-server.ps1` khi `/health` chết, + cảnh báo nổi trên UI); (2) đo backend in-process thật (`getLlama().gpu`) và ghim `node-llama-cpp` = 3.18.1 hoặc nâng gói CUDA lên 3.19.0; (3) hàng đợi ưu tiên ở app trước llama-server (interactive > agent nền > cron), hoặc server FIM/fast riêng (`LLAMA_FIM_SERVER_URL`) để ghost-text không xếp sau agent; (4) API đổi model có kiểm (`/props` xác nhận, đồng bộ `.env`) thay cho `doi-model.ps1`; (5) bổ sung bộ đo độ đúng FIM.
