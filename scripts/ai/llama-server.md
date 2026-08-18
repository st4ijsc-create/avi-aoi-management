# Persistent llama-server for the deep model (doc 48 R5)

**Goal:** run the deep generative model (exec-summary, ops-chat, RCA) in a
separate, always-warm `llama-server` process that owns its own VRAM, instead of
loading it in-process where it fights the resident embedder for the GPU. This
makes **live generation** work again (no more "offline template" degradation)
**without buying more VRAM** — the deep model + the small embedder are sized to
co-reside on the existing 32 GB card.

## Why

The API process keeps the embedder (`GGUF_EMBED_MODEL`, ~1–2 GB) resident for
RAG. Loading the ~17 GB deep model in the *same* process on demand routinely
loses the VRAM race → `getOrLoadModel` fails → exec-summary/chat fall back to the
honest offline template. Moving the deep model to a dedicated server that loads
it **once** and holds it removes the contention: the API only ever holds the
embedder; the deep model lives in llama-server.

```
┌────────────── API process (node) ─────────────┐        ┌──── llama-server ────┐
│  embedder (mxbai, in-process, ~1.5 GB VRAM)    │  HTTP  │  deep model (Qwen3,  │
│  aiGgufEngine.generateText/JSON  ───────────────┼──────▶│  ~17 GB, always warm)│
│    └─ routes deep model → server (this doc)    │ /v1/…  │  OpenAI-compatible   │
└────────────────────────────────────────────────┘        └──────────────────────┘
```

## 1. Build / get `llama-server` (llama.cpp, CUDA)

Use a CUDA build of llama.cpp so the model runs on the GPU. Either download a
CUDA release of llama.cpp or build it:

```bash
# build (needs CUDA toolkit + cmake)
git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j
# → build/bin/llama-server
```

## 2. Launch the server with the deep model

> **⚠ G1-E (2026-08-16) — ĐỪNG GÕ TAY NỮA.** Dùng `scripts/ai/start-llama-server.ps1`
> (mục 2b). Script đọc mọi tham số từ `.env`, idempotent, và không bao giờ spawn
> bản thứ hai. Khối `bash` dưới đây chỉ để hiểu tham số nghĩa là gì.
>
> **Hai cảnh báo phải đọc trước khi tự chế lệnh:**
> * **Cổng 8080 đang bị một Apache (`httpd`) khác chiếm trên máy này** — dùng **8091**
>   (`LLAMA_SERVER_URL` trong `.env`). Gõ 8080 = gửi toàn bộ lưu lượng AI sang nhầm dịch vụ.
> * **KHÔNG lượng tử hoá KV.** Đo thật trên build b9814 / RTX 5090 sm_120, đổi ĐÚNG một biến:
>   `-ctk f16 -ctv f16` → prefill **6.485 tok/s**; `-ctk q8_0 -ctv f16` → **105 tok/s (62× chậm)**;
>   `-ctk q8_0 -ctv q4_0` → **100 tok/s (85× chậm)**. Tiết kiệm ~1.939 MiB đổi bằng 15–85× thông lượng.

Cấu hình **đã nghiệm thu** (khớp đúng tiến trình đang chạy):

```bash
llama-server.exe \
  -m D:/SOURCES/16.AI/<GGUF_DEFAULT_MODEL>.gguf \
  --host 127.0.0.1 --port 8091 \
  -c 65536 -np 2 \
  -fa on -ngl 999 \
  -ctk f16 -ctv f16 \
  --slots --metrics --no-webui
```

`-c` là **TỔNG**, llama-server chia cho `-np` ⇒ 65536/2 = **32.768/slot**. Con số này
phải **≥ `GGUF_MAX_CTX` (=32768)**: nếu ctx/slot nhỏ hơn, một request 32k bị server từ
chối ⇒ mã lùi về in-process ⇒ **nạp bản thứ hai của model 30B** ⇒ vỡ VRAM.

**VRAM (card 32.607 MiB), đo sống sau khi bật:** 26.530 MiB dùng / 5.661 MiB trống
(llama-server trọng số+compute ≈20.275 · KV f16 2×32.768 = 6.144 · embedding đã nạp).
Còn phải nạp FIM 1.811 + reranker 803 + ONNX 339 ⇒ đỉnh dự kiến ≈29.483, dư ≈3.124 MiB.
⇒ **Không** nâng lên 4 slot × 32.768 (KV thành 12.288 MiB ⇒ vượt trần).

### 2b. Khởi động bền vững (Windows) — `scripts/ai/start-llama-server.ps1`

```powershell
# chạy tay (idempotent — đã chạy rồi thì thoát 0, KHÔNG spawn cái thứ hai)
scripts\ai\start-llama-server.cmd

# khởi động lại có chủ ý
scripts\ai\start-llama-server.cmd -Force
```

Script làm đúng 4 việc: (1) đọc `LLAMA_SERVER_BIN` / `LLAMA_SERVER_MODEL` (rơi về
`GGUF_DEFAULT_MODEL`) / `GGUF_MODELS_DIR` / `LLAMA_SERVER_URL` / `LLAMA_SERVER_API_KEY`
**từ `.env`** — đổi roster ở G5 chỉ sửa một chỗ; (2) hỏi `/health` trước, đã xanh thì
thoát 0; (3) nếu cổng bị người khác chiếm (đúng ca Apache:8080) thì **báo tên tiến trình
và từ chối spawn đè**; (4) spawn tách rời, ghi log vào `logs/llama-server-<stamp>.{out,err}.log`,
chờ `/health` xanh mới báo thành công.

Mã thoát: `0` sẵn sàng · `2` cấu hình sai · `3` cổng bị chiếm · `4` tiến trình chết ngay ·
`5` hết giờ chờ `/health`.

### 2c. ⚠ VIỆC CỦA CHỦ DỰ ÁN — đăng ký Task Scheduler

Đây là **thay đổi hệ thống ngoài repo** nên agent KHÔNG tự chạy. Mở PowerShell/CMD
**Administrator** và chạy **một** trong hai:

```bat
:: (A) Chạy lúc ĐĂNG NHẬP của chính người dùng hiện tại — KHUYẾN NGHỊ.
::     GPU + đường D:\ + biến môi trường người dùng đều sẵn sàng ở phiên này.
schtasks /Create /TN "AVI-AOI llama-server" /SC ONLOGON /RL HIGHEST /F ^
  /TR "\"D:\SOURCES\avi-aoi-management\scripts\ai\start-llama-server.cmd\""
```

```bat
:: (B) Chạy lúc KHỞI ĐỘNG MÁY, không cần ai đăng nhập (tài khoản SYSTEM).
::     Trễ 1 phút cho driver GPU + ổ đĩa sẵn sàng.
schtasks /Create /TN "AVI-AOI llama-server" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /DELAY 0001:00 ^
  /TR "\"D:\SOURCES\avi-aoi-management\scripts\ai\start-llama-server.cmd\""
```

Kiểm chứng / vận hành:

```bat
schtasks /Query /TN "AVI-AOI llama-server" /V /FO LIST
schtasks /Run   /TN "AVI-AOI llama-server"        :: chạy thử ngay (an toàn: idempotent)
schtasks /Delete /TN "AVI-AOI llama-server" /F     :: gỡ
```

> Vì script **idempotent**, đăng ký cả (A) lẫn (B) cũng không sinh ra hai tiến trình —
> cái chạy sau thấy `/health` xanh và thoát 0. Nhưng chỉ nên giữ **một** tác vụ.
>
> Sau khi đăng ký, đo bằng endpoint sẵn sàng (mục 5) chứ đừng tin `schtasks` báo "Ready":
> `schtasks` chỉ biết tiến trình đã ĐƯỢC KHỞI ĐỘNG, không biết model đã NẠP XONG.

## 3. Point the API at it

In the API process env (`.env`):

```ini
LLAMA_SERVER_ENABLED=true
LLAMA_SERVER_URL=http://127.0.0.1:8091   # ⚠ 8091, KHÔNG 8080 (8080 = Apache trên máy này)
LLAMA_SERVER_MODEL=<GGUF_DEFAULT_MODEL>.gguf
# LLAMA_SERVER_API_KEY=...       # only if you started the server with --api-key
# LLAMA_SERVER_STRICT=false      # true → no in-process fallback (honest offline template instead)
```

⚠ `LLAMA_SERVER_MODEL` phải khớp `GGUF_DEFAULT_MODEL` — mã định tuyến
(`aiLlamaServerClient.shouldUseServerForText`) so khớp **hai basename này với nhau**;
lệch một chữ ⇒ **không** route sang server, sinh chữ lặng lẽ chạy in-process. Endpoint ở
mục 5 phát hiện đúng ca đó (`textGeneration: degraded`, lý do "KHÔNG khớp").

Only **text generation for the served model** is routed to the server. Embeddings,
vision, and the code/fast models stay in-process. With `LLAMA_SERVER_STRICT=false`
(default) a server outage silently falls back to the in-process path; with
`=true` the engine throws and the caller shows its honest offline template rather
than risk a slow/contended in-process load.

## 4. Verify

```bash
# server health + model ĐANG NẠP THẬT (không phải model cấu hình KHAI)
curl -s http://127.0.0.1:8091/health
curl -s http://127.0.0.1:8091/props        # → .model_path, .total_slots, .default_generation_settings.n_ctx

# a direct generation
curl -s http://127.0.0.1:8091/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":8}'

# end-to-end wiring (routing/parse/strict/scope) — mock server, no GPU needed:
npx tsx scripts/verify/llama-server-proof.mts
```

When live, exec-summary / ops-chat produce real narratives instead of the offline
template, and the API's VRAM footprint stays flat (embedder only) because the deep
model no longer loads in-process.

## 5. Endpoint SẴN SÀNG THẬT — `GET /api/health/ai` (G1-E)

> ⚠ **`/api/health` KHÔNG PHẢI một route.** Nó rơi vào SPA catch-all (`server/_core/vite.ts`,
> `app.use("*")`) nên trả **200 + `text/html` 369 KB** kể cả khi mọi hệ con AI đã chết. Mọi câu
> "health 200 ⇒ hệ thống sống" từng viết chỉ chứng minh **index.html tải được**. Ngữ nghĩa của
> `/health`, `/livez`, `/readyz` **cố ý KHÔNG đổi** (chúng là cổng HEALTHCHECK/canary — một
> instance vẫn phục vụ tốt không được bị kéo khỏi rotation chỉ vì llama-server chết).

```bash
curl -s -o - -w '\nHTTP %{http_code}\n' http://127.0.0.1:3000/api/health/ai
```

| Mã HTTP | Nghĩa | Vì sao |
|---|---|---|
| `200` | mọi hệ con `ok`/`disabled` | |
| `207` | có hệ con `degraded` | **cố ý không phải 200**: phép kiểm `== 200` ĐỎ (mất prefix-cache phải nhìn thấy), phép kiểm `2xx` vẫn xanh (instance vẫn trả lời được) |
| `503` | có hệ con `down` | |

Hệ con được đo: `db` (ping `select 1` thật, **không** chỉ "đối tượng kết nối tồn tại" như
`/readyz`) · `llamaServer` (`/health` + `/props` ⇒ model **đang nạp thật**) · `textGeneration`
(**đi server hay in-process** — hệ con quan trọng nhất) · `embedding` · `reranker` ·
`tierFlags` (dùng lại `TIER_FLAG_SPECS`).

Ca đáng giá nhất — llama-server chết:

```json
{ "status": "down", "httpStatus": 503,
  "checks": {
    "llamaServer":    { "status": "down",     "reason": "llama-server (cổng 8091, loopback) KHÔNG với tới được…" },
    "textGeneration": { "status": "degraded", "reason": "llama-server chết ⇒ hệ đang chạy in-process, MẤT PREFIX-CACHE…",
                        "detail": { "path": "in-process", "fallback": "silent" } } } }
```

**Không rò bí mật:** chỉ basename model (KHÔNG bao giờ `model_path` tuyệt đối mà `/props` trả về),
không API key, không hostname (chỉ `loopback`/`remote` + cổng). Endpoint **công khai** cho tiện
giám sát; deployment coi roster model là nhạy cảm thì đặt `HEALTH_AI_REQUIRE_LOOPBACK=true` ⇒ chỉ
caller loopback đọc được, còn lại 403. Trần thời gian mỗi phép kiểm: `HEALTH_AI_TIMEOUT_MS`
(mặc định 2000 ms, các phép kiểm chạy **song song**).

## Notes

- **Streaming:** `generateText`/`generateJSON` (exec-summary, insight JSON, chat)
  route to the server. The token-streaming narrative path is unchanged in this
  wave (still in-process) — enable server streaming in a follow-up if needed.
- **Multiple tiers:** one llama-server serves ONE model. To also serve the
  code/fast/thinking tiers out-of-process, run additional servers and extend
  `LLAMA_SERVER_MODEL` routing — out of scope here.
- **Rollback:** unset `LLAMA_SERVER_ENABLED` → the engine reverts to the exact
  in-process behaviour, no redeploy needed.
