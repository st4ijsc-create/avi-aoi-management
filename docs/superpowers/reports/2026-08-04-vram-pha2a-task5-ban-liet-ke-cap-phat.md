# Task 5 — Bản liệt kê đầy đủ đường cấp phát VRAM (spec §5.6)

> ★★★★ **KẾT LUẬN CUỐI — đọc trước mọi con số trong file này:**
>
> **151 là số dòng mà MẪU QUÉT NGÀY 2026-08-04 nhìn thấy. Nó là cận DƯỚI.
> KHÔNG phương pháp nào trong Pha 2A biến nó thành cận TRÊN.**
>
> Bản liệt kê này **không phải bảo đảm** cho Pha 2B — nó là **tiên nghiệm best-effort**.
> Lớp an toàn thật phải là đối chiếu với **sự thật thiết bị lúc chạy**. Bằng chứng đo được:
> **N-2b** — cùng hình dạng né tránh, chỉ đổi một tên biến ⇒ **vẫn đi lọt** sau bản vá.
> Chi tiết ở "Vòng sửa 3" cuối file.

**Ngày:** 2026-08-04 · **Nhánh:** `feat/hmi-dep` · **Máy:** RTX 5090 32.607 MiB, Windows 11

**Sản phẩm:** `server/services/vram/vramAllocationSites.ts` + `vramAllocationSites.test.ts`
**Kết quả:** `npx vitest run server/services/vram/` → **219/219 xanh** (212 cũ + 7 mới) · `npx tsc --noEmit` **sạch**

---

## 0. Kết luận một dòng

> ⚠⚠ **§0 và §1 dưới đây là của VÒNG 1 và đã bị VÒNG SỬA 1 thay thế** — giữ nguyên văn để
> truy được, KHÔNG đọc như số hiện hành. Mẫu quét vòng 1 THỦNG (C-1: dạng gọi thành viên `cp.spawn(` và `execFile(` đều
> vô hình) nên con số 65 là số của một cuộc quét mù; và nhãn "14 nối / 51 chưa nối" SAI PHẠM TRÙ
> (I-2). **Số hiện hành: 120 lần xuất hiện = 14 điểm mở giấy phép + 5 không-phải-điểm-gọi +
> 28 lượt cấp phát đã phủ + 73 chưa nối.** Xem "Vòng sửa 1" ở cuối file.
>
> ⚠ Và **cả bộ số của Vòng sửa 1 cũng đã bị Vòng sửa 2 thay thế** (mẫu quét còn thiếu lớp thư
> viện GPU và thiếu `.cjs`). **SỐ HIỆN HÀNH: 151 lần xuất hiện / 41 file = 14 + 5 + 43 + 89.**

Quét hai trục độc lập tìm được **65 điểm cấp phát** trong `server/` + `scripts/` (43 trong `server/`, 22 trong `scripts/`), trong đó **14 đã nối** vào sổ cái và **51 chưa nối**; cộng thêm **5 hộ tiêu thụ KHÔNG có điểm cấp phát nào trong repo** nên không máy quét nào tìm được. Trục tiến trình phát hiện **một khoảng lệch 128,0 MiB** trong chính tiến trình API mà sổ không gọi tên, và đo trực tiếp được cơ chế sinh ra nó (**bộ đệm tính toán lười, +132,0 MiB, cấp phát SAU `commitMeasured()`**).

**Bản liệt kê này KHÔNG "sạch ngay lần đầu".** Nó sai ở bốn chỗ trong quá trình dựng, cả bốn đều bị bắt bằng máy hoặc bằng đối chứng độc lập — chi tiết ở §6.

---

## 1. Trục LỜI GỌI — bảng thô

Quét bằng `git grep`, **và** bằng một máy quét cơ học đã **bỏ chú thích VÀ bỏ nội dung chuỗi**
(`vramAllocationSites.test.ts::stripCommentsAndStrings`). Bỏ file `*.test.ts`.

### 1.1 Đếm điểm ĐÃ NỐI — hai cách độc lập, cùng ra 14

```
git grep -n "await beginVramAllocation({" -- server/ | grep -v "\.test\."   →  9
git grep -n "await beginVram({"           -- server/ | grep -v "\.test\."   →  5
                                                                    tổng   →  14
máy quét cơ học (bỏ chú thích + chuỗi)                                     →  14
```

`beginVram(` là lớp bọc nội bộ (`aiGgufEngine.ts:752`, `aiInferenceEngine.ts:22`) — đếm lời gọi
lớp bọc, KHÔNG đếm hai dòng `beginVramAllocation` bên trong chúng.

| # | File:dòng | owner | kind | priority |
|---|---|---|---|---|
| 1 | `aiGgufEngine.ts:399` | `cuda-backend` | gguf-backend | production |
| 2 | `aiGgufEngine.ts:851` | `gguf:<modelId>` | gguf-model | interactive |
| 3 | `aiGgufEngine.ts:1041` | `gguf-ctx:<modelId>` | gguf-context | interactive |
| 4 | `aiGgufEngine.ts:2824` | `gguf-embed-ctx:<modelId>` | gguf-embed-context | background |
| 5 | `aiInferenceEngine.ts:181` | `onnx:<code>` | onnx-session | production |
| 6 | `aiImageEmbedding.ts:506` | `onnx-img:<code>` | onnx-session | production |
| 7 | `ai/ocrService.ts:328` | `onnx-ocr:<path>` | onnx-session | production |
| 8 | `aiReranker.ts:393` | `cuda-backend:reranker` | gguf-backend | background |
| 9 | `aiReranker.ts:468` | `reranker:<path>` | gguf-model | background |
| 10 | `llamaVisionSidecar.ts:255` | `sidecar:vision` | external-process | interactive |
| 11 | `kbSyncScheduler.ts:264` | `cron:kb-eval-gate` | external-process | background |
| 12 | `kbSyncScheduler.ts:482` | `cron:kb-sync` | external-process | background |
| 13 | `localSidecarTrainer.ts:353` | `sidecar:local-trainer` | external-process | background |
| 14 | `aiLlmFinetuneSidecar.ts:466` | `sidecar:llm-finetune` | external-process | background |

### 1.2 Bảng thô đầy đủ — mọi lần xuất hiện của mọi mẫu quét

Cột `n` = số lần xuất hiện. `nối?` = lượt cấp phát đó có nằm trong một cửa sổ giấy phép không.

**`server/` — 43 lần xuất hiện / 14 file**

| n | symbol | file | nối? | ghi chú |
|---|---|---|---|---|
| 4 | `beginVram(` | `aiGgufEngine.ts` | — | :399 · :851 · :1041 · :2824 |
| 2 | `getLlama(` | `aiGgufEngine.ts` | ✅ | :338 khai báo · :841 lời gọi; init thật ở :376 trong cửa sổ :399 |
| 2 | `.loadModel(` | `aiGgufEngine.ts` | ✅ | :861 (`max`) · :888 (retry `auto` sau OOM) — cùng cửa sổ :851 |
| 2 | `.createContext(` | `aiGgufEngine.ts` | ✅ | :904 (trong :851) · :1046 (trong :1041) |
| 1 | `.createEmbeddingContext(` | `aiGgufEngine.ts` | ✅ | :2830, trong :2824 |
| 1 | `beginVram(` | `aiInferenceEngine.ts` | — | :181 |
| 1 | `InferenceSession.create(` | `aiInferenceEngine.ts` | ✅ | :192, EP = DirectML (`ENABLE_GPU=true`) |
| 1 | `beginVramAllocation(` | `aiImageEmbedding.ts` | — | :506 |
| 1 | `InferenceSession.create(` | `aiImageEmbedding.ts` | ✅ | :521, EP = **CPU hôm nay** (xem §4.2) |
| 1 | `beginVramAllocation(` | `ai/ocrService.ts` | — | :328 |
| 1 | `InferenceSession.create(` | `ai/ocrService.ts` | ✅ | :337, EP = DirectML |
| 2 | `beginVramAllocation(` | `aiReranker.ts` | — | :393 · :468 |
| 1 | `getLlama(` | `aiReranker.ts` | ✅ | :417, trong :393 |
| 1 | `.loadModel(` | `aiReranker.ts` | ✅ | :480, trong :468, `gpuLayers 0` vì `RAG_RERANKER_GPU=false` |
| 1 | `.createRankingContext(` | `aiReranker.ts` | ✅ | :486, trong :468 |
| 1 | `beginVramAllocation(` | `llamaVisionSidecar.ts` | — | :255 |
| 1 | `spawn(` | `llamaVisionSidecar.ts` | ✅ | :283 `llama-server.exe` CUDA, `-ngl 999` |
| 2 | `beginVramAllocation(` | `kbSyncScheduler.ts` | — | :264 · :482 |
| 2 | `spawn(` | `kbSyncScheduler.ts` | ✅ | :291 (`eval-rag --ci`) · :505 (`npm run kb:sync`) |
| 1 | `beginVramAllocation(` | `localSidecarTrainer.ts` | — | :353 |
| 1 | `spawn(` | `localSidecarTrainer.ts` | ✅ | :298 `python tools/trainer/train.py` |
| 1 | `beginVramAllocation(` | `aiLlmFinetuneSidecar.ts` | — | :466 |
| 1 | `spawn(` | `aiLlmFinetuneSidecar.ts` | ✅ | :425, `LLM_FINETUNE_CMD` chưa đặt ⇒ bất động |
| 4 | `InferenceSession.create(` | `aiLocalTraining.ts` | ❌ | :130 · :387 · :564 · :882 — EP ghim cứng `['cpu']` ⇒ 0 byte |
| 3 | `spawn(` | `plugins/sidecar/nodeSpawner.ts` | ❌ | :42 · :47 · :65 — lệnh TUỲ Ý, cổng tắt |
| 1 | `spawn(` | `apsSolver.ts` | ❌ | :276 CP-SAT/OR-Tools — **CPU, không phải hộ GPU** |
| 2 | `spawn(` | `backupService.ts` | ❌ | :397 `pg_dump` · :578 `psql` — không GPU |
| 1 | `spawn(` | `backupReplicationService.ts` | ❌ | :87 `aws` — không GPU |

**`scripts/` — 22 lần xuất hiện / 11 file**

| n | symbol | file | nối? | ghi chú |
|---|---|---|---|---|
| 3 | `getLlama(`/`.loadModel(`/`.createEmbeddingContext(` | `ai-kb/_gguf-embed.mjs` | ✅ gián tiếp | :73/:75/:87 — chỉ khi chạy dưới `cron:kb-sync` hoặc `cron:kb-eval-gate` |
| 3 | `getLlama(`/`.loadModel(`/`.createContext(` | `ai-kb/eval-rag.mjs` | ✅ gián tiếp | :211/:221/:222 — chỉ với `--ci` do scheduler spawn |
| 3 | `getLlama(`/`.loadModel(`/`.createEmbeddingContext(` | `ai-kb/embed-programming.mjs` | ❌ | :101/:102/:103 — **`contextSize:"auto"`**, xem §4.1 |
| 4 | `getLlama(`/`.loadModel(`/`.createContext(`/`.createEmbeddingContext(` | `ai-bench/bench.mjs` | ❌ | :584/:618/:329/:420 — `npm run ai:bench`, chạy tay |
| 1 | `InferenceSession.create(` | `ai-kb/reembed-images-onnx.mjs` | ❌ | :184 — chạy tay, không có mục package.json |
| 3 | `InferenceSession.create(` | `check-tier3-env.mjs` | ❌ | :171 cpu · :181 **dml** · :193 **cuda** — chẩn đoán, chạy tay |
| 1 | `InferenceSession.create(` | `validate-models.mjs` | ❌ | :38 EP `['cpu']` |
| 1 | `spawn(` | `ai-kb/run-phase1.mjs` | ❌ | spawn các bước kb khác |
| 3 | `spawn(` | `plugin-scaffold.mjs`, `sim/sim-devices.mjs`, `verify/worker-leader-proof.run.mjs` | ❌ | không GPU |

**Đường vào KHÔNG phải điểm cấp phát** (gọi lại các site trên; liệt kê để trả lời "ai khởi động được"):
`ai-kb/generate-embeddings.mjs:96`, `ai-kb/embed-incremental.mjs:112`, `ai-kb/backfill-image-embeddings.mjs:146`,
`ai-kb/verify-embedding-cosine.mjs:18` (đều qua `_gguf-embed.mjs`);
`ai-survey/vi-quality-ab.mjs:365`, `ai-survey/embed-space-probe.mjs:98` (import THẲNG `aiGgufEngine.ts` ⇒
đi đúng đường đã nối, nhưng trong tiến trình RIÊNG ⇒ **sổ riêng**).

---

## 2. Trục TIẾN TRÌNH — bảng thô

### 2.0 ⚠ `nvidia-smi` MÙ trên máy này — phải nói trước khi đọc bảng

`nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv` trả
**`used_gpu_memory = [N/A]` cho MỌI tiến trình** (giới hạn WDDM trên Windows tiêu dùng), và trả
`[Insufficient Permissions]` cho `dwm.exe`. Nó **liệt kê được PID, KHÔNG đo được byte**.

⇒ Trục tiến trình phải dùng bộ đếm PDH `\GPU Process Memory(*)\Dedicated Usage` — đúng bộ đếm mà
`vramProcessProbe.ts` dùng. Cột byte dưới đây là PDH; `nvidia-smi` chỉ dùng để đối chiếu PID và
tổng thiết bị (`--query-gpu=memory.used`).

**Sai lệch hệ thống của PDH, ĐO ĐƯỢC, phải trừ khi đọc số TUYỆT ĐỐI:** lúc rảnh, Σ PDH toàn máy
= **1.707,9 MiB** trong khi `nvidia-smi memory.used` = **1.188 MiB** ⇒ PDH **thừa 519,9 MiB
(+43,8 %)**, phần thừa nằm gần hết ở các tiến trình desktop (dwm aliasing). **Hiệu số** (delta)
thì đáng tin — Task 3 đã kiểm với sai lệch 1,013 % / 0,362 %. Nói vậy để không ai lấy một con số
PDH tuyệt đối rồi trừ thẳng vào sổ.

### 2.1 Tám mẫu

| # | Nhãn | Thời điểm (UTC) | thiết bị (nvidia-smi) | Tiến trình có VRAM (PDH, > 8 MiB) |
|---|---|---|---|---|
| S1 | rảnh, chưa chạy app | 18:11:16 | 1.188 MiB | dwm 865,9 · msedgewebview2 217,2 · Code 206,7 · explorer 100,7 · Docker 65,9 · csrss 47,6 · Display Driver 45,1 · + 9 tiến trình vỏ Windows ≤ 25,2 |
| S2 | app đang nạp 30B | 18:12:12 | 1.617 MiB | **PDH NÉM** — xem §2.2 |
| S3 | app đang nạp 30B | 18:12:31 | 1.612 MiB | **node.exe pid 29088 = 1.569,6** (`server/_core/index.ts`) |
| S4 | app đã ổn định | 18:13:33 | 3.395 MiB | **node.exe 29088 = 2.223,7** + nền desktop y như S1 |
| S5 | **cửa sổ cron** (`kb:sync` chạy) | 18:14:36 | 4.429 MiB | node 29088 = 2.223,7 · **node 38492 = 1.167,7** (`node scripts/ai-kb/embed-incremental.mjs`) |
| S6.1 | cửa sổ cron | 18:14:52 | 4.662 MiB | node 29088 = 2.223,7 · **node 38492 = 1.269,7** |
| S6.2 | cửa sổ cron | 18:15:00 | 4.758 MiB | node 29088 = 2.223,7 · **node 38492 = 1.363,7** |
| S6.3 | cửa sổ cron (đỉnh) | 18:15:07 | 4.762 MiB | node 29088 = 2.223,7 · **node 38492 = 1.367,7** |
| S7 | `kb:sync` xong | 18:19:55 | 3.393 MiB | node 29088 = 2.223,7 — **tiến trình con biến mất, VRAM trả HẾT** |
| S8 | đã dừng app | 18:33:33 | 1.201 MiB | không còn `node.exe` nào |

### 2.2 Mẫu cửa sổ cron — ĐÃ LẤY ĐƯỢC, và lấy bằng cách nào

Kế hoạch đòi mẫu trong cửa sổ cron 03:00. **Không chờ tới 03:00**: chạy `npm run kb:sync` bằng tay
(đúng chuỗi lệnh mà `kbSyncScheduler.ts:505` spawn) và lấy mẫu trong lúc nó chạy — S5/S6.1-3 ở trên.

- Kẻ cấp phát THẬT là `node scripts/ai-kb/embed-incremental.mjs`, tức tiến trình **CHÁU** của
  `npm run kb:sync` ⇒ xác nhận bằng quan sát rằng phạm vi `descendants` **phải cộng theo CÂY**
  (điều kiện Đ2 của Task 3), không thể chỉ nhìn con trực tiếp.
- Đỉnh đo được **1.367,7 MiB**; ước lượng khai trong sổ `VRAM_KB_SYNC_ESTIMATE_MB = 1251` ⇒
  **thấp hơn thực ~8,5 %**. Đúng bậc, nhưng thấp — Pha 2B nếu dùng con số này làm trần thì thiếu.
- Sau khi tiến trình con thoát (S7), VRAM trả **hết** — hộ `external-process` này nhả sạch.

⚠ **Điều mẫu này KHÔNG chứng minh:** tôi chạy `kb:sync` từ shell của mình, nên `ppid` là shell chứ
không phải tiến trình API. Cây tiến trình lúc 03:00 THẬT có thêm một tầng (`node` → `npm` → `cmd`
→ `node`). Kích thước và hành vi nhả là số THẬT; hình dạng cây thì tôi suy từ mã, không phải đo.

### 2.3 Hai sự cố quan sát được, không phải nhiễu

**(a) Bộ đếm PDH NÉM đúng lúc đang nạp model (S2).** Thông báo:
`"The data in one of the performance counter samples is not valid"`.
`vramProcessProbe.ts` chạy `PS_SCRIPT` với `$ErrorActionPreference='Stop'` ⇒ **lượt đọc đó trả
`null` ⇒ `measureFailed`**. Nó xảy ra **đúng trong cửa sổ cấp phát**, tức đúng lúc phép đo quan
trọng nhất. Máy quét của tôi phải thêm vòng thử lại + lọc `Status -eq 0` mới đọc được. Đây là một
nguồn `measureFailed` **chưa được ghi ở đâu** trong tài liệu Pha 1/2A.

**(b) Nạp 30B THẤT BẠI vì OOM khi thiết bị còn ~29 GB trống.**
`ggml_backend_cuda_buffer_type_alloc_buffer: allocating 16698.37 MiB on device 0: cudaMalloc failed:
out of memory`. Đây chính là "trần KHÔNG tất định" mà Pha 1 Ư7 đã kết luận (3 OK / 9 FAIL cùng một
khối) — **không phải phát hiện mới**, nhưng nó có hệ quả cho báo cáo này: **trục tiến trình phiên
này KHÔNG quan sát được hộ trong-tiến-trình LỚN NHẤT (30B, ~17-19 GB).** Nói thẳng: bảng §2.1
không chứa nó vì nó không nạp được, không phải vì nó không tồn tại.

---

## 3. Đối chiếu hai trục

| Quan sát ở trục TIẾN TRÌNH | Giải thích ở trục LỜI GỌI | Khớp? |
|---|---|---|
| `node.exe` (app) giữ 2.223,7 MiB | sổ ghi 3 giấy phép: `cuda-backend` 431,6 + `gguf:Qwen3-Embedding-0.6B` 1.138,0 + `gguf-embed-ctx` 526,0 = **2.095,7 MiB** | ⚠ **lệch 128,0 MiB** → §3.1 |
| `node scripts/ai-kb/embed-incremental.mjs` giữ tới 1.367,7 MiB | giấy phép `cron:kb-sync` (`kbSyncScheduler.ts:482`) → `spawn` :505 → `_gguf-embed.mjs:73/75/87` | ✅ |
| Không có tiến trình `python*` giữ VRAM | `localSidecarTrainer` / `aiLlmFinetuneSidecar` chỉ chạy khi có job; `apsSolver` là CP-SAT CPU | ✅ |
| Không có `llama-server.exe` | `sidecar:vision` chỉ spawn khi có yêu cầu ảnh; `LLAMA_SERVER_ENABLED` đang tắt | ✅ |
| Không có `whisper*`/`ffmpeg*` | `WHISPER_BIN`/`FFMPEG_BIN` còn bị chú thích trong `.env` | ✅ |
| dwm/Code/Edge/Docker ≈ 1.700 MiB | **không có** điểm cấp phát nào trong repo | ⚠ nền, §5 mục 5 |

### 3.1 Khoảng lệch 128,0 MiB — truy tới file:dòng

**Nó CÓ THẬT, hai nhiệt kế cùng chỉ:**
- PDH: app 2.223,7 − sổ 2.095,7 = **+128,0 MiB**
- `nvidia-smi` (thước độc lập): S4 3.395 − nền rảnh S1 1.188 = 2.207 MiB cho app; − sổ 2.095,7 = **+111 MiB**

**Cơ chế — đo trực tiếp trong một tiến trình SẠCH** (`scratchpad/embed-ctx-cost.mjs`, cùng bộ đếm PDH):

```
getLlama()                      →   431,6 MiB      (khớp CUDA_BACKEND_FALLBACK_BYTES)
loadModel(Qwen3-Embedding-0.6B) → 1.569,6 MiB      (+1.138,0 — khớp TỪNG BYTE với sổ)
createEmbeddingContext()        → 5.485,7 MiB
  (đứng yên sau 3 s)            → 5.485,7 MiB
LƯỢT NHÚNG ĐẦU TIÊN             → 5.617,8 MiB      ← +132,0 MiB
  (đứng yên sau 3 s nữa)        → 5.617,8 MiB
```

**+132,0 MiB được cấp phát ở lượt SUY LUẬN ĐẦU TIÊN, tức SAU khi `commitMeasured()` đã đóng cửa sổ.**
Không cửa sổ đo nào phủ nó ⇒ nó **không bao giờ vào sổ**.

Truy tới mã:
- `server/services/aiGgufEngine.ts:915-919` — chú thích đã GỌI TÊN đúng hiện tượng này cho
  `gguf-model` ("llama.cpp cấp phát compute buffer LƯỜI, ở lượt suy luận ĐẦU TIÊN — tức là SAU
  điểm này"). Nó được **ghi ra nhưng không được cộng vào đâu cả**, và chưa từng được đo lại.
- Lượt cấp phát thật nằm trong llama.cpp, kích hoạt tại các điểm SUY LUẬN
  (`loaded.context.getSequence()` ở `aiGgufEngine.ts:1826/2244/2368/…`, `ctx.getEmbeddingFor(...)`)
  — **những điểm này KHÔNG có giấy phép nào, và cũng không nên có** (chúng không phải lượt cấp
  phát, chúng chỉ *kích hoạt* một lượt cấp phát bên trong thư viện).

⚠ **CÁI TÔI CHƯA CHỨNG MINH ĐƯỢC, nói thẳng:** 132,0 MiB là số đo của **cơ chế**; 128,0 MiB là số
đo của **khoảng lệch**. Nhật ký phiên app đó **không ghi lượt nhúng nào**, nên tôi **không chứng
minh được hai con số này là CÙNG một khối byte** — chỉ chứng minh được (i) cơ chế tồn tại và lớn
đúng bậc đó, (ii) khoảng lệch tồn tại và lớn đúng bậc đó. Ứng viên còn lại chưa loại trừ: dư lượng
của lượt nạp 30B THẤT BẠI (§3.2).

### 3.2 Ứng viên thứ hai đã KIỂM và KHÔNG dựng được — dư lượng của lượt cấp phát hỏng

Giả thuyết: bốn nhánh `catch` gọi `releaseVramTicketQuietly()` (`aiGgufEngine.ts:417, :944, :1066,
:2839`) trả chỗ trong sổ với `releaseProof` **mặc định `"device-disposed"`**, trong khi ở nhánh đó
**không có `dispose()` nào chạy** — model chưa từng tồn tại. Nếu llama.cpp giữ lại phần đã cấp phát
dở, sổ sẽ tin là trống.

**Thí nghiệm** (`scratchpad/failed-load-residue.mjs`): ba lượt `createContext` OOM liên tiếp.
**Kết quả: dư lượng 0,0 MiB ở cả ba lượt.**

**Nhưng thí nghiệm này KHÔNG kết luận được**, và phải nói ra: node-llama-cpp **chặn TRƯỚC** khi tới
`cudaMalloc` (`"A context size of 6000000 is too large for the available VRAM"`), tức nó chưa hề
thử cấp phát. Ca thật ở boot (`cudaMalloc failed` từ chính ggml, sau khi đã cấp phát một phần) **là
một đường khác** và tôi chưa dựng lại được — nó cần đúng điều kiện trần bất định của Ư7.

⇒ **Để mở, không kết luận.** Điểm chắc chắn: `releaseProof` mặc định ở bốn nhánh đó **là một khẳng
định mà mã không chứng minh được**, độc lập với việc dư lượng có thật hay không.

---

## 4. Bốn phát hiện có hệ quả trực tiếp cho Pha 2B

### 4.1 ★★★ Một điểm cấp phát KHÔNG CÓ KÍCH THƯỚC — nó ăn đúng bằng dư địa bạn chừa ra

`scripts/ai-kb/embed-programming.mjs:103` gọi `createEmbeddingContext({ contextSize: "auto" })`.
node-llama-cpp co giãn context theo **VRAM CÒN TRỐNG tại thời điểm gọi**.

**Đo được, cùng model 0,6B, cùng máy, 2026-08-04:**

| contextSize | VRAM chiếm |
|---|---|
| `EMBED_CTX` (chốt bằng env — đường của app) | **526,0 MiB** |
| `"auto"` (đường của script) | **3.916,1 MiB** |

**Gấp 7,4 lần.** Với một broker cưỡng chế trên `headroom`, lớp hộ này là lớp nguy hiểm nhất: nó
không có kích thước để ước lượng, và mọi dư địa broker chừa ra đều bị nó ăn hết. Nó **chưa nối**.
(`eval-rag.mjs:222` dùng `{min:2048,max:8192}` — CÓ chặn trên. `_gguf-embed.mjs:87` dùng
`min(GGUF_EMBED_CTX, GGUF_MAX_CTX)` — CÓ chặn trên. Chỉ `embed-programming.mjs` là `"auto"`.)

### 4.2 ★★ Ba hộ ONNX, HAI cách quyết định EP khác nhau — và `.env` hôm nay làm chúng lệch nhau

| Hộ | Cách chọn EP | Với `.env` hôm nay (`ENABLE_GPU=true`, `ENABLE_CUDA` **không đặt**) |
|---|---|---|
| `onnx:*` (`aiInferenceEngine.ts:125`) | `getExecutionProviders()` → `dml` khi `ENABLE_GPU=true` | **GPU (DirectML)** |
| `onnx-ocr:*` (`ocrService.ts:309-318`) | lặp lại cùng logic inline | **GPU (DirectML)** |
| `onnx-img:*` (`aiImageEmbedding.ts:493-495`) | **CHỈ** `if (ENABLE_CUDA==='true') push('cuda')` — không gọi `getExecutionProviders()`, **không bao giờ đẩy `dml`** | **CPU — 0 byte** |

Docstring `aiImageEmbedding.ts:439` đã cảnh báo đúng điều này ("Hôm nay 0 MiB CHỈ VÌ `ENABLE_CUDA`
không có trong `.env`"). Hệ quả cho Pha 2B: **một giấy phép `onnx-session` đang commit 0 byte
không có nghĩa hộ đó nhẹ** — đổi một cờ là nó thành hộ thật, và nó là đường của dinov2-small
(`AOI_EMBEDDING_ENABLED=true`, `ANOMALY_BANK_MODEL_CODE=dinov2-small`), tức đường AOI.

### 4.3 ★★ `cron:kb-sync` khai `releaseProof` SAI — hộ duy nhất trong bốn hộ `external-process`

`kbSyncScheduler.ts:482-489` **không truyền `releaseProof`** ⇒ rơi về mặc định `"device-disposed"`.
Nhưng nó nhả ở nhánh `"exit"`/`"error"` của tiến trình con — đúng ngữ nghĩa `"process-exit"`, thứ mà
**ba hộ `external-process` còn lại đều khai tường minh**: `kbSyncScheduler.ts:270`,
`llamaVisionSidecar.ts:269`, `localSidecarTrainer.ts:361`, `aiLlmFinetuneSidecar.ts:473`.

Đây là một ô **truy vấn được bằng SQL** trong `vram_events.detail.releaseProof` đang nói sai về hộ
này. Không đổi hành vi cấp phát; nhưng Pha 2B đọc sổ.

### 4.4 ★ Một câu trong `vramWiring.ts:49` sai như đang viết

Nguyên văn: *"reviewer grep toàn repo — **không MỘT lời gọi `.release()` nào lên
`ort.InferenceSession`**"*. Thực tế `aiLocalTraining.ts` có **năm**: `:332, :504, :765, :889, :954`.

Câu đó chống lưng cho quyết định `releaseProof: "unverified"` của ba hộ ONNX — và **quyết định đó
vẫn ĐÚNG**, vì cả năm lời gọi kia đều nằm trên session EP `['cpu']`, còn ba session CÓ KHẢ NĂNG
GPU thì thật sự không bao giờ được `.release()`. Chỉ **câu chữ** là quá rộng. Ghi lại để lần sau
không ai dựa vào nó rồi kết luận rộng hơn dữ liệu.

---

## 5. Năm hộ tiêu thụ KHÔNG CÓ điểm cấp phát nào trong repo

Máy quét **không thể** tìm ra chúng. Đây là phần phải viết bằng tay, và là phần đã gây ra cả bốn
lần sót trước.

1. **Bộ đệm tính toán lười của llama.cpp** — +132,0 MiB đo được, cấp phát SAU `commitMeasured()`. §3.1.
2. **Tiến trình `worker`** (`server/worker.ts` → `runWorkerProcess`). Sổ cái là **biến trong bộ nhớ
   của MỘT tiến trình**. `ROLE=worker` ⇒ hai sổ độc lập trên MỘT thiết bị, mỗi sổ thấy nửa của mình.
   Pha 1 đã ghi nhận ("`ROLE=api` ⇒ sổ MỘT tiến trình trong khi hệ chạy NĂM"); **vẫn chưa giải**.
   Cùng lớp: `vi-quality-ab.mjs` / `embed-space-probe.mjs` import thẳng `aiGgufEngine.ts` ⇒ chạy
   đúng mã đã nối, trong tiến trình riêng, sổ riêng.
3. **`llama-server` bền bỉ khởi động BẰNG TAY** — `LLAMA_SERVER_ENABLED` + runbook
   `scripts/ai/llama-server.md`. Thêm: `.env:660-661` có `LLAMA_CODER_PORT=8090` / `LLAMA_CODER_CTX`
   nhưng **không một dòng mã nào trong repo đọc `LLAMA_CODER_PORT`/`LLAMA_CODER_BIN`** (kiểm bằng
   `git grep` toàn repo — chỉ có trong `.env.example` và tài liệu doc 34). Cấu hình cho một tiến
   trình mà mã không biết tới.
4. **whisper.cpp** qua `kbVideoTranscriber.ts:361` (`runSidecar(cfg.whisperBin, …)`). **Không có
   giấy phép.** `VIDEO_INGEST_ENABLED=true` trong `.env`, nhưng `WHISPER_BIN` còn bị chú thích ⇒
   bất động hôm nay. Bản whisper.cpp dựng với CUDA là hộ thật. (Không lọt vào bảng §1 vì file này
   dùng `execFile`, không dùng `spawn`; `ffmpeg` cùng file **không** có `-hwaccel` ⇒ giải mã CPU.)
5. **Nền desktop Windows** — 1.707,9 MiB lúc rảnh (dwm 865,9 là khoản lớn nhất). Không phải của ta,
   nhưng ăn cùng 32.607 MiB.

**Đính chính một suy đoán dễ mắc:** ba cron cùng nổ lúc 03:00 (`KB_AUTOSYNC_CRON`,
`ANOMALY_BANK_REBUILD_CRON`, `AI_SELF_LEARNING_CRON` — cả ba đều BẬT trong `.env`). Đã kiểm:
**chỉ `kbSyncScheduler` là đường GPU.** `aiAnomalyBankScheduler` đọc vector ĐÃ LƯU trong
`ai_image_embeddings` (docstring :4), `aiSelfLearningScheduler` thuần DB/thống kê. "Ba cron 03:00"
≠ "ba hộ tiêu thụ 03:00".

---

## 6. Bản liệt kê này ĐÃ SAI bốn lần trong lúc dựng

Ghi lại vì brief yêu cầu nghi ngờ chính mình, và vì cả bốn đều là lớp lỗi sẽ tái diễn.

| # | Sai gì | Ai bắt |
|---|---|---|
| 1 | Máy quét đầu tiên đếm `"… refusing to spawn (tampered …)"` (`pluginSignature.ts:51`, **trong một chuỗi**) thành một điểm `spawn(` ⇒ một **hộ tiêu thụ MA** | Tôi, khi đọc lại từng dòng kết quả quét thay vì tin con số |
| 2 | Tôi khai `aiGgufEngine.ts` có 1 `.loadModel(`, 1 `.createContext(`, 1 `getLlama(` — thực tế **2 mỗi loại** (tôi gộp hai lần xuất hiện vào một dòng ghi chú) | **Chính ca test vừa viết**, ngay lượt chạy đầu |
| 3 | Tôi ghi `onnx-img:*` (dinov2) là đường GPU của cron 03:00. **Sai hai lần trong một câu**: nó chạy **CPU** hôm nay (§4.2), và cron 03:00 anomaly-bank **không suy luận** (§5) | Lượt quét đối chứng ĐỘC LẬP |
| 4 | Tôi định kết luận 128 MiB là dư lượng của lượt nạp hỏng | Thí nghiệm của chính tôi trả **0,0 MiB** ⇒ phải hạ xuống "để mở" (§3.2) |

Lỗi #2 là lý do bản liệt kê được viết thành **lưới** chứ không phải tài liệu: một bảng do người
viết sẽ sai đúng kiểu đó, lặng lẽ.

---

## 7. Đột biến bắt buộc (bước 6)

Thêm vào `server/services/apsSolver.ts` một điểm cấp phát giả:

```ts
export function __mutationProbe(): void {
  const c = spawn("python", ["gpu_hog.py"], { cwd: process.cwd(), shell: false });
  c.unref();
}
```

**Ca ĐỎ:** `★★★ 1. KHÔNG có điểm cấp phát nào trong server/ hoặc scripts/ mà bản liệt kê chưa khai`
→ `server/services/apsSolver.ts  →  spawn( — quét thấy 2, bản liệt kê khai 1` (1 fail / 6 pass).

Khôi phục bằng `git checkout -- server/services/apsSolver.ts`;
`git status --porcelain server/` chỉ còn **hai file MỚI** của task này, không file theo dõi nào bị đổi.

---

## 8. Những điều bản liệt kê này KHÔNG nói được

1. **Nó không thấy được hộ tiêu thụ dùng API mà máy quét chưa biết tên.** `SCAN_PATTERNS` có 9 mẫu.
   Một thư viện GPU mới (WebGPU, TensorRT trực tiếp, một binding CUDA khác) đi qua **hoàn toàn im
   lặng**. Đây đúng là lớp lỗi đã cho lọt sidecar 7,8 GB ở Đợt 0 — nó **chưa đóng**, chỉ thu hẹp.
2. **Nó không thấy được tiến trình do người vận hành khởi động.** `llama-server` bền bỉ, một
   `python train.py` chạy tay, một job Docker dùng GPU — không có `spawn()` nào trong repo tạo ra
   chúng.
3. **Nó không nói kích thước.** Bảng trả lời "cấp phát ở đâu", không trả lời "bao nhiêu byte". Ba
   con số kích thước duy nhất được ĐO trong task này là 431,6 (backend) · 1.138,0 (model 0,6B) ·
   1.367,7 (cửa sổ cron). Mọi hộ khác **chưa có số**. Hộ lớn nhất hệ (`sidecar:vision` 7,8 GB) và
   hộ lớn nhì (30B ~17-19 GB) **không quan sát được trong phiên này**.
4. **Nó không nói khi nào.** Không có mô hình thời gian: hộ nào chồng hộ nào, giữ bao lâu, đỉnh khi
   nào. Pha 2B từ chối/thu hồi theo THỜI ĐIỂM, mà bảng này là ảnh tĩnh.
5. **`wired: true` chỉ nói "có giấy phép", KHÔNG nói "số đúng".** Ví dụ sống: `gguf-embed-ctx` có
   giấy phép, commit 526,0 MiB, và vẫn thiếu ~128 MiB bộ đệm lười. Một hộ đã nối vẫn có thể báo
   thiếu.
6. **Ranh giới "nối gián tiếp" của `scripts/` mong manh hơn ô `wired` trông có vẻ.** `_gguf-embed.mjs`
   và `eval-rag.mjs` được ghi `wired: true`, nhưng chỉ ĐÚNG khi tiến trình API spawn chúng. Chạy tay
   (`npm run kb:embed`, `npm run kb:eval`) là **cùng mã đó, không giấy phép nào**. Một ô boolean
   không diễn tả được "phụ thuộc vào ai khởi động".
7. **Số dòng sẽ trôi.** Khoá đối chiếu là `file` + `symbol`; số dòng trong `note` đúng ở
   **2026-08-04** và không có gì canh chúng.
8. **Trục tiến trình chỉ mạnh bằng bộ đếm.** `nvidia-smi` mù về byte trên máy này (§2.0); PDH thừa
   +43,8 % ở số tuyệt đối và **ném** đúng lúc đang nạp model (§2.3a). Cả hai nhiệt kế đều có lỗi
   đã biết, và bảng §3 dựng trên chúng.
9. **Một phiên đo, một máy, một cấu hình `.env`.** Trần nạp 30B là **bất định** (Ư7). Cùng bản mã,
   cùng máy, phiên khác sẽ cho bảng §2.1 khác.

---
---

# Vòng sửa 1 — sau review (1 Critical · 7 Important · 6 Minor)

**Kết quả:** `npx vitest run server/services/vram/` → **221/221 xanh** (+ một lượt
`--sequence.shuffle.tests`) · `npx tsc --noEmit` sạch.

**Con số cuối cùng sau khi ĐẾM LẠI TỪ ĐẦU** (mẫu quét đã nới, nên bảng rộng hơn hẳn vòng 1):

| | |
|---|---|
| lần xuất hiện được khai báo | **120** (40 file: `server/` 64 · `scripts/` 56) |
| — ký hiệu giấy phép, thô | 19 |
| — trong đó **KHÔNG phải điểm gọi** | 5 (2 khai báo lớp bọc · 2 pass-through · 1 khai báo hàm gốc) |
| — ⇒ **ĐIỂM GỌI `beginVramAllocation` = 14** | không đổi, nhưng nay đếm lại bằng mẫu mới |
| — lượt cấp phát / sinh tiến trình | 101 → **28 đã nối · 73 chưa nối** |

Vòng 1 báo "65 điểm / 14 nối / 51 chưa nối". Cả ba con số đó **đều đã chết**: 65 là hệ quả của
mẫu quét thủng (C-1), và "14 nối / 51 chưa nối" là **sai phạm trù** (I-2) — nó xếp 14 *điểm mở
giấy phép* cùng hàng với các *lượt cấp phát*, tức đếm giấy phép như thể chúng là hộ tiêu thụ.

---

## C-1 (Critical) — lưới để một sidecar GPU lọt qua. ĐÃ VÁ.

**Tự chạy lại đúng đột biến của reviewer trước khi sửa:** thêm
`cp.spawn("llama-server.exe", ["-ngl","999"])` **và** `execFile("whisper-cuda.exe", …)` vào
`server/services/aiExplainability.ts` ⇒ **7/7 XANH**. Xác nhận: lưới im lặng.

Hai lỗ, và cả hai là lỗi của tôi chứ không phải giới hạn của phương pháp:

1. mẫu `spawn(` viết `(?<![.\w])spawn\s*\(`. Tôi thêm `(?<![.\w])` để né `re.exec(` rồi **áp
   nhầm nó cho `spawn`** — nơi dạng gọi THÀNH VIÊN (`cp.spawn`, `this.deps.spawn`) mới là dạng
   phổ biến. Bằng chứng nó đã che thứ có thật: `plugins/sidecar/pluginSupervisor.ts:110`
   (`this.deps.spawn(...)`) **không hề xuất hiện** trong bảng vòng 1.
2. `execFile(` vắng mặt hoàn toàn — dù whisper.cpp đã được tôi **gọi tên trong chính báo cáo
   vòng 1** (mục §5.4). Tôi viết ra hộ đó rồi không đưa API của nó vào máy quét.

**Vá — đổi CẤU TRÚC quét, không chỉ thêm mẫu.** Nay quét HAI LỚP:

- **mẫu LỜI GỌI** trên nguồn đã bỏ chú thích + chuỗi: thêm `spawnSync(`, `execFile(`,
  `execFileSync(`, `execSync(`, `fork(`, và đổi mọi mẫu sinh-tiến-trình sang `\b…` để bắt CẢ dạng
  thành viên;
- **mẫu MODULE** `child_process` trên nguồn đã bỏ chú thích **nhưng còn giữ chuỗi** (module
  specifier nằm trong một chuỗi).

Lớp thứ hai là lớp **duy nhất** bắt được `promisify(execFile)` rồi `execFileAsync(...)` — đúng cách
`kbVideoTranscriber.ts:212` (whisper) và `kbPdfOcr.ts:181` gọi. **Không mẫu tên-hàm nào bắt được
chúng, dù thêm bao nhiêu tên.** Bằng chứng vá đúng: cả hai file đó **lần đầu tiên xuất hiện**
trong bảng ở vòng này. Cùng lớp được đóng theo: alias, destructure đổi tên,
`await import("child_process")`.

⚠ **Không thêm mẫu `exec(` trần**: `.exec(` là API RegExp, ~40 lần trong `server/`. Đưa vào là
nhấn chìm bảng bằng nhiễu tới mức không ai duy trì — mà bảng không ai duy trì thì không phải lưới.
`child_process.exec` được phủ bằng mẫu MODULE thay thế.

⚠ **Gỡ lời tuyên bố sai.** Docstring vòng 1 nói lưới này đóng lớp lỗi sidecar 7,8 GB của Đợt 0.
Nó không đóng, và bản mới **không tuyên bố như vậy nữa** — thay bằng danh sách tường minh những
gì lưới KHÔNG bắt được (thư viện GPU lạ · `client/**` và `tools/**` ngoài phạm vi · tiến trình do
người vận hành khởi động).

**Tự loại trừ có kiểm soát:** artifact nhắc `child_process` 28 lần trong ô `note` nên nó tự khớp
chính mình. Nó bị loại khỏi lượt quét, và ca **8** mới canh điều kiện làm việc đó an toàn:
artifact phải là module **CHỈ DỮ LIỆU** (không `import`, không `require(`, không lời gọi nào).

---

## I-7 — mẫu đòi `\(\s*\{` làm một điểm nối THẬT trở nên vô hình. ĐÃ VÁ.

Bỏ ràng buộc `{`. Hệ quả: mẫu nay cũng khớp **khai báo hàm** và **pass-through của lớp bọc** —
đúng hai cái bẫy đếm-hai-lần. Chúng được khai TƯỜNG MINH trong
`PERMIT_SYMBOL_OCCURRENCES_THAT_ARE_NOT_CALL_SITES` (5 mục) thay vì lọc ngầm bằng regex, vì một
bộ lọc ngầm sẽ có ngày nuốt một điểm gọi thật. Ca **3b** mới bắt buộc mỗi mục loại trừ phải còn
tồn tại trong mã — nếu không, nó đang trừ khống và con số 14 sẽ THẤP hơn sự thật.

Đếm lại: quét thô **19** trừ loại trừ **5** = **14**.

---

## Hai đột biến đã chạy lại (bước 6, lần hai)

| Đột biến | Ca ĐỎ |
|---|---|
| **A (C-1 của reviewer)** — `cp.spawn("llama-server.exe", ["-ngl","999"])` + `execFile("whisper-cuda.exe", …)` vào `aiExplainability.ts` | `★★★ 1. KHÔNG có điểm cấp phát nào … chưa khai` → bắt CẢ BA: `spawn( — quét thấy 1, khai 0` · `execFile( — quét thấy 1, khai 0` · `child_process — quét thấy 2, khai 0` |
| **B (I-7)** — một điểm nối THẬT truyền BIẾN: `const t = await beginVramAllocation(o)` | **hai ca**: `★★★ 1. …chưa khai` (`beginVramAllocation( — quét thấy 1, khai 0`) **và** `★★★ 3. WIRED_ALLOCATION_SITE_COUNT…` (`Quét thô thấy 20 … trừ 5` ⇒ 15 khác 14) |

Khôi phục bằng `git checkout -- server/services/aiExplainability.ts`;
`git status --porcelain server/` chỉ còn hai file của task này.

---

## I-2 — nhãn sai phạm trù. ĐÃ SỬA.

`vramAllocationSites.ts` và §0 nay phân bốn loại thay vì hai: **14 điểm mở giấy phép** · **5 lần
xuất hiện không phải điểm gọi** · **28 lượt cấp phát ĐÃ được giấy phép phủ** · **73 chưa nối**
(cộng lại = 120).

---

## I-1 — điểm `contextSize:"auto"` THỨ HAI, và nó nằm trong MÃ SẢN XUẤT. ĐÃ SỬA.

`aiReranker.ts:486` — `model.createRankingContext({ contextSize: "auto" })`, mở khoá bằng
`RAG_RERANKER_GPU` (=`false` trong `.env` hôm nay ⇒ `gpuLayers 0` ⇒ 0 byte). Câu vòng 1 của tôi —
*"Chỉ `embed-programming.mjs` là `auto`"* — **sai**, và sai ở hướng dễ ru ngủ nhất: nó xếp lớp hộ
nguy hiểm nhất vào ô "chỉ có trong script chạy tay".

**Và "đã nối" KHÔNG cứu được lớp này** — đây mới là điều phải viết ra cho Pha 2B: giấy phép
`reranker:*` ĐO SAU khi cấp phát xong (`commitMeasured()` ở `:488`), còn cưỡng chế phải quyết định
**TRƯỚC**. Với `contextSize:"auto"` thì tại thời điểm quyết định **không tồn tại con số nào** để
từ chối dựa vào — kích thước chỉ được biết sau khi nó đã ăn xong dư địa.

---

## I-3 / I-4 / I-5 — ba lỗ hổng trong lập luận §3.1 về 128 MiB. ĐÃ SỬA, VÀ KẾT LUẬN ĐỔI.

**I-3 (khai đúng điều kiện đo).** Con số **+132,0 MiB** ở §3.1 được đo bằng
`createEmbeddingContext({ contextSize: "auto" })` (`scratchpad/embed-ctx-cost.mjs:55`) — context
**3.916,1 MiB**. Đường sản xuất dùng `EMBED_CTX` + `batchSize 512` (`aiGgufEngine.ts:2830-2832`) —
context **526,0 MiB**. **Chênh 7,4 lần, và vòng 1 không khai.** Vậy +132,0 MiB **không chuyển
thẳng** sang đường sản xuất; nó chỉ chứng minh *cơ chế tồn tại*, không chứng minh *độ lớn ở quy mô
thật*.

**I-4 (đọc đúng chiều bằng chứng).** Vòng 1 viết "nhật ký phiên app không ghi lượt nhúng nào" như
một câu trung tính. Nó không trung tính: nếu không lượt suy luận nào chạy thì **bộ đệm lười chưa
được kích hoạt**, tức đó là **bằng chứng NGƯỢC** với chính giả thuyết tôi đang đề xuất. Phải nói
đúng như vậy.

**I-5 (ứng viên khớp CHÍNH XÁC, do chính tôi ghi rồi bỏ mất).** Docstring ở đầu dụng cụ đo của tôi
(`scratchpad/embed-ctx-cost.mjs`) có ghi: `aiGgufEngine.ts:2801` ghi context nhúng thật là
**654 MiB**, và **654 trừ 526 = 128**. Con số đó **khớp chính xác** khoảng lệch quan sát được, và
tôi **bỏ nó khỏi báo cáo** trong khi giữ lại ứng viên khớp kém hơn (132,0). Khôi phục và đánh giá
lại:

> Kích thước thật của context nhúng ở quy mô sản xuất là **654 MiB** (số của chính repo, hai chỗ);
> sổ chốt **526,0 MiB**; thiếu **đúng 128,0 MiB** — bằng đúng khoảng lệch đo được ở tiến trình API.
> Độ lớn nay được ghim bởi **hai nguồn độc lập**.

**Cơ chế thì vẫn còn HAI ứng viên, và tôi không tách được chúng bằng dữ liệu đang có:**
(a) bộ đệm tính toán lười cấp phát ở lượt suy luận đầu tiên — I-4 tính điểm TRỪ cho nó;
(b) cửa sổ đo **đóng trước khi lượt cấp phát lắng xong** (độ trễ PDH / thời điểm đầu dò "sau"),
tức phép đo bị CẮT NGỌN chứ không phải byte đến muộn.
Cả hai cho cùng một dấu vết `sổ 526 / thiết bị 654`. Để mở, và ghi rõ là để mở.

**HỆ QUẢ CHO PHA 2B — viết thẳng, vì đây mới là thứ quan trọng:**

- ~~**Mọi lease GGUF đều BÁO THIẾU.**~~ ⛔ **BỊ VÒNG SỬA 2 BÁC — ĐỪNG MANG CÂU NÀY ĐI.**
  Phạm vi "GGUF" bị chốt sớm: nếu cơ chế là *cửa sổ đo bị cắt ngọn* thì MỌI lease dùng
  `commitMeasured()` đều báo thiếu (gồm `onnx:*` và bốn sidecar); và "hai nguồn độc lập"
  chống lưng cho nó thật ra **cùng phụ thuộc một tập giả định**. Xem N-3/N-4/N-5 ở Vòng sửa 2.
- ~~**Khoản thiếu KHÔNG phải hằng số**~~ ⛔ **BỊ CHÍNH DỮ LIỆU BÁC** (128 MiB @ ctx 526 so với
  132 MiB @ ctx 3.916 = lệch 3 % qua thay đổi 7,4 lần, CÙNG một model ⇒ gần như ĐỘC LẬP với
  context). Nguyên văn của câu bị bác: *"nó co giãn theo model và theo context… không có một
  hằng số nào để cộng bù"*. ⚠ Câu đó đẩy Pha 2B RỜI XA phương án biên-cố-định-theo-`kind`, trong
  khi dữ liệu hiện có hơi ỦNG HỘ phương án đó. Vế "co giãn theo MODEL" vẫn chưa có điểm đo nào.
- **Hộ 30B (~17-19 GB) CHƯA TỪNG quan sát được** — nạp OOM ở phiên này (trần bất định Ư7). Khoản
  thiếu của nó chưa ai biết, và nó là hộ lớn nhất.
- **`vramReconciler` chỉ PHÁT HIỆN lệch dương, KHÔNG bù sổ.** Nên `headroom = trần − Σ leaseBytes`
  bị **phóng đại** theo đúng chiều nguy hiểm: **cho phép cấp phát khi thiết bị đã đầy**.

---

## I-6 — §2.3(a) nói sai về sổ. ĐÃ SỬA.

Câu vòng 1: *"đây là một nguồn `measureFailed` chưa được ghi ở đâu"* — **sai**. Sổ **đã có** nhánh
`measure_failed` với `reason: "before-probe-null" / "after-probe-null"` (`vramWiring.ts` ~:585-600),
và một lượt PDH ném rơi đúng vào đó.

Thiếu thật là **hai thứ khác**:

1. **NGUYÊN NHÂN bị gộp.** `readProcessVram()` trả `null` cho *mọi* lý do — PDH ném (mẫu không hợp
   lệ), đầu dò bị TẮT bằng `VRAM_PROCESS_PROBE`, bộ đếm vắng mặt, `execFile` hết giờ — nên
   `before/after-probe-null` không phân biệt được "bộ đếm chập chờn đúng lúc nạp model" với "người
   vận hành đã tắt đầu dò". Hai thứ đó đòi hai hành động khác hẳn nhau.
2. **TẦN SUẤT bị nuốt.** `vramProcessProbe.ts:106` (`let warnedUnavailable = false`) cùng
   `:157-158` chốt cảnh báo **một-lần-cho-cả-đời-tiến-trình**. Lượt hỏng thứ hai trở đi im lặng
   hoàn toàn ở console; muốn biết bao nhiêu lượt hỏng thì phải đi đếm sự kiện trong DB.

**Khuyến nghị (KHÔNG thuộc bản liệt kê, không làm trong task này):** thêm
`detail.probeFailureCause` vào sự kiện `measure_failed` — `execfile-error` · `probe-disabled` ·
`counter-absent` · `parse-empty`. Không đổi ngưỡng, không đổi nhịp, không đổi công thức.

---

## Sáu Minor — đã sửa hết

| # | Sửa |
|---|---|
| 1 | **whisper xếp sai chỗ.** Nó CÓ điểm cấp phát (`kbVideoTranscriber.ts:361` rồi `:212`); nó chỉ từng vô hình vì máy quét thiếu `execFile`. Sau khi vá C-1 nó **đã vào bảng chính** (`wired: false`) và bị gỡ khỏi danh sách "không có điểm cấp phát". |
| 2 | **Thêm hộ thứ 4: `ollama serve`.** SÁU file đọc `OLLAMA_BASE_URL` (`aiImageEmbedding.ts`, `aiLocalKnowledgeService.ts`, `aiLocalTools/intentClassifier.ts`, cùng ba `scripts/ai-kb/*embed*.mjs`). Daemon GPU riêng, repo không spawn. Bất động hôm nay **đúng bằng mức** của llama-server thủ công vốn vẫn được liệt kê, nên tiêu chí nay được ghi thành câu và áp nhất quán. |
| 3 | **§4.3 "ba hộ" thành BỐN.** Bốn giấy phép `external-process` khai `releaseProof: "process-exit"` (`kbSyncScheduler:270`, `llamaVisionSidecar:269`, `localSidecarTrainer:361`, `aiLlmFinetuneSidecar:473`); hộ thứ năm — `cron:kb-sync` (`kbSyncScheduler:482`) — **không khai**, nên rơi về `"device-disposed"`. Phát hiện gốc đứng nguyên. |
| 4 | `run-phase1.mjs`: `:1` là dòng **import**, lời gọi `spawn(` ở **`:14`**. Nay là hai dòng riêng, đúng số. |
| 5 | **Nền desktop không phải hằng số, và không hoàn toàn "của người khác"** — nó chứa **client của chính sản phẩm này**. `client/**` nằm NGOÀI `SCAN_ROOTS`, nên một tab mở dashboard hay twin 3D `@react-three` là VRAM **do mã của ta** mà bảng này không quét. Giới hạn đã ghi vào artifact. |
| 6 | `aiModelRouter.ts:350` — chú thích ghi *"embedding context tự dùng `auto` trong engine"*: **sai**, engine chốt bằng `EMBED_CTX` (`aiGgufEngine.ts:288` rồi `:2831`). Đã sửa, kèm con số 7,4 lần để người sau không tính nhầm hạn mức. |

---

## Bổ sung cho §8 "những điều bản liệt kê này KHÔNG nói được"

10. **Lưới này đã từng thủng đúng ở chỗ nó tự nhận là mạnh nhất.** Vòng 1 tuyên bố đóng được lớp
    lỗi sidecar 7,8 GB; reviewer chứng minh ngược lại bằng hai dòng. Bài học không phải "mẫu quét
    còn thiếu" mà là: **một lưới chỉ đáng tin tới mức nó ĐÃ ĐƯỢC ĐỘT BIẾN THỬ**. Vòng 1 chạy đúng
    một đột biến (`spawn(` dạng trần) rồi kết luận cho cả lớp.
11. **Mẫu MODULE `child_process` phủ được "file nào CÓ THỂ sinh tiến trình", KHÔNG phủ được
    "tiến trình đó có chạm GPU không".** Ranh giới đó vẫn do người phân loại bằng tay trong `note`,
    và không có gì kiểm chứng lời phân loại ấy.

---
---

# Vòng sửa 2 — sau re-review (2 Critical + 3 Important + vùng mù)

**Kết quả:** `npx vitest run server/services/vram/` → **222/222 xanh** (+ một lượt
`--sequence.shuffle.tests`) · `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` sạch.

**Con số cuối cùng sau khi ĐẾM LẠI TỪ ĐẦU** (mẫu quét nới lần hai + thêm đuôi file):

| | |
|---|---|
| lần xuất hiện được khai báo | **151** (41 file: `server/` 86 · `scripts/` 65) |
| — ký hiệu giấy phép, thô | 19 |
| — trong đó KHÔNG phải điểm gọi | 5 (3 khai báo hàm · 2 pass-through) |
| — ⇒ **ĐIỂM GỌI = 14** | không đổi qua ba lần nới mẫu |
| — lượt cấp phát / sinh tiến trình / nạp thư viện | 132 → **43 đã phủ · 89 chưa nối** |

Kiểm chéo con số 14 bằng hai đường độc lập, cùng ra 14:
`git grep -nE "await beginVram(Allocation)?\s*\(" -- server/ | grep -v "\.test\."` → **16** dòng
= 14 điểm gọi + 2 pass-through; máy quét (khớp MỌI dạng, kể cả khai báo hàm) → **19** − 5 = 14.
⚠ Đừng đếm bằng `git grep` không có `await` và không lọc test: ra 126 + 31 vì gộp cả test lẫn
hàng chục lần nhắc trong chú thích. (Con số 120 của vòng sửa 1 nay đã chết — nó thiếu lớp mẫu
thư viện GPU và thiếu `.cjs`.)

---

## N-1 (Critical) — ALIAS thư viện GPU vẫn vô hình. ĐÃ VÁ.

Tự chạy lại trước khi sửa:

```ts
import { InferenceSession as ORT } from "onnxruntime-node";
const mk = ORT.create;
mk("m.onnx", { executionProviders: ["dml"] });
```

⇒ **9/9 XANH.** Phiên ONNX DirectML thật, không tiến trình con nào.

Reviewer gọi đúng tên bệnh: **bất đối xứng trong chính bản vá của tôi.** Vòng sửa 1 tôi dựng lớp
`MODULE_PATTERNS` **vì đã nhận ra alias đánh bại mẫu tên-hàm** — rồi chỉ áp cho `child_process`,
không áp cho `onnxruntime-node` và `node-llama-cpp`. Có sẵn insight đúng mà dùng một nửa thì lỗ
còn nguyên ở nửa kia.

**Vá:** thêm hai mẫu module. Nhưng **không** dùng định danh trần — đo được là nó sinh **212** lần
xuất hiện (câu lỗi, mảng `techStack` của `aiSpecialistAgentService.ts`, đường dẫn đóng gói trong
`build-offline-package.mjs`, văn xuôi tài liệu) so với **23** khi siết theo **dạng nhập**
(`from`/`import(`/`require(` + chuỗi specifier, có nhánh `node:` và `/sub-path`). Một bảng 212
dòng nhiễu sẽ bị người sau tắt đi — đúng lý do tôi đã từ chối mẫu `exec(` trần. Ca **7b** mới
canh cả hai chiều: alias phải BỊ BẮT, và `techStack: ["node-llama-cpp"]` phải KHÔNG bị đếm.

---

## N-2 (Critical) — `.cjs` ngoài `SCAN_EXTS`. ĐÃ VÁ, và cách vá phải ĐỔI so với chỉ dẫn.

`server/license/sdk/index.cjs` — 1.543 dòng, nằm ngay trong `server/`, chưa từng được quét.

**⚠ Đo được, và nó đổi cả bản vá: mở rộng `SCAN_EXTS` là KHÔNG ĐỦ.** Với mẫu cũ
`\bchild_process\b`, file này khớp **0 lần** dù đã được đọc — vì nó không chứa định danh
`child_process` ở dạng trần:

| đo trên `index.cjs` | |
|---|---|
| chuỗi con `child_process` | **8** |
| `\bchild_process\b` (mẫu vòng sửa 1) | **0** |
| dạng `child_process_1` | **8** |
| `\bexecSync\s*\(` | **0** (tên hàm nằm trong chuỗi: `child_process_1['execSync'](…)`) |

Nó né **cả hai** lớp: specifier bị cắt đôi (`require('child_pr' + <hàm>)`) nên mẫu dạng-nhập vô
dụng; tên hàm nằm trong CHUỖI nên mẫu lời gọi vô dụng (lượt quét lời gọi đã xoá nội dung chuỗi).

**Vá đầy đủ = `SCAN_EXTS` + bỏ `\b` ĐUÔI của mẫu định danh** (`/\bchild_process/`) ⇒ hiện ra **8
lần**. Đã ghi 8 dòng đó vào bảng chính kèm phân loại: `wmic`/`dmidecode`/`sysctl` lấy vân tay
phần cứng cho license — **CPU, KHÔNG phải hộ VRAM** — nhưng là **bằng chứng sống** của đúng hình
dạng né tránh mà lưới từng tự nhận đã phủ.

Rà toàn bộ đuôi file thật trong `SCAN_ROOTS`: `.ts` 1.753 · `.mjs` 137 · **`.py` 13** · `.ps1` 3 ·
`.mts` 3 · `.js` 2 · **`.cjs` 1**. Thêm `.cjs`, và `.cts`/`.jsx` phòng trước (hôm nay 0 file).

**Thu hẹp lời biện minh cho việc loại `exec(` trần** (reviewer giữ nguyên quyết định đó, và tôi
giữ): câu cũ *"file nào dùng `exec` cũng phải có `child_process` trước"* chỉ đúng khi file **được
đọc** và specifier **viết liền** — `index.cjs` phá cả hai. Nay nói đúng phạm vi đó.

---

## Bốn đột biến đã chạy lại

| Đột biến | Ca ĐỎ |
|---|---|
| **N-1** — alias `InferenceSession as ORT` + `const mk = ORT.create` | `★★★ 1. …chưa khai` → `import onnxruntime-node — quét thấy 1, khai 0` |
| **N-2** — file `.cjs` mới dùng `require('child_pr'+'ocess')` rồi `child_process_1['execSync']('llama-server.exe --ngl 999')` | `★★★ 1. …chưa khai` → `child_process — quét thấy 2, khai 0` |
| **A (thêm)** — `cp.spawn("llama-server.exe",["-ngl","999"])` + `execFile("whisper-cuda.exe", …)` | `★★★ 1. …chưa khai` → bắt CẢ BA: `spawn( 1/0` · `execFile( 1/0` · `child_process 2/0` |
| **B (xoá)** — gỡ một điểm nối THẬT (`aiReranker.ts:468`) | **hai ca**: `★★ 2. KHÔNG có dòng nào đã chết` (`beginVramAllocation( — khai 2, quét chỉ thấy 1`) **và** `★★★ 3. WIRED_…` (`Quét thô thấy 18 … trừ 5` ⇒ 13 ≠ 14) |

Khôi phục xong: `git status --porcelain server/` chỉ còn hai file của task này.

---

## N-3 / N-4 / N-5 — lập luận 128 MiB tự chọi ở ba chỗ. ĐÃ SỬA.

Hai kết luận được reviewer **xác nhận bằng mã** và giữ nguyên: `vramReconciler` **chỉ phát hiện,
không bù sổ** (không một phép gán `actualBytes` nào trong `vramReconciler.ts`), và **chiều sai số
đúng dấu** — `headroom` bị phóng đại về phía **cho phép cấp phát khi thiết bị đã đầy**.

Ba chỗ sai đã sửa:

1. **"Hai nguồn ĐỘC LẬP" là sai.** Cả hai dùng chung số hạng 526 và đều phải GIẢ ĐỊNH hai lease
   kia (431,6 + 1.138,0) chính xác — **mâu thuẫn trực tiếp với chính câu "mọi lease GGUF đều báo
   thiếu"** của tôi. Nếu lease model cũng thiếu X thì X + Y = 128 chứ không phải Y = 128. Nói
   đúng: hai lượt đọc **cùng phụ thuộc một tập giả định**, chúng củng cố nhau chứ không xác nhận
   chéo nhau.

2. **"Khoản thiếu KHÔNG phải hằng số" bị chính dữ liệu của tôi bác.** 128 MiB ở context 526 MiB
   so với 132 MiB ở context 3.916 MiB = lệch **3 %** qua một thay đổi **7,4 lần**, **cùng một
   model**. Đó là bằng chứng khoản thiếu **gần như độc lập với context** (khớp vật lý compute
   buffer của llama.cpp). Vế "co giãn theo MODEL" thì **chưa có một điểm đo nào**.
   ⚠ Hệ quả nghiêm trọng đã được ghi vào artifact: câu cũ đang đẩy Pha 2B **RỜI XA** phương án
   biên-cố-định-theo-`kind`, trong khi dữ liệu hiện có thật ra hơi **ỦNG HỘ** phương án đó.

3. **Phạm vi bị chốt sớm.** Nếu cơ chế là (b) *cửa sổ đo bị cắt ngọn* thì **mọi** lease dùng
   `commitMeasured()` đều báo thiếu — gồm `onnx:*` và bốn sidecar — chứ không riêng GGUF. Vòng
   trước để mở **cơ chế** nhưng lại chốt **phạm vi**; không được làm vậy khi cơ chế còn hai ứng viên.

**Thêm, về trích dẫn:** `aiGgufEngine.ts:2801` viết **"4 lượt tuần tự = 654 MiB"**, không phải
"context nhúng thật là 654 MiB" — tôi đã làm mất định ngữ. Và cách đọc khiến phép trừ
`654 − 526 = 128` có nghĩa **chính là ứng viên (a)**, nên nguồn đó **không trung lập** giữa hai
ứng viên và không được dùng làm trọng tài. Đã sửa cả hai.

---

## N-6b (Important) — một hộ CUDA đang SỐNG hôm nay mà sổ không có số cho nó

`.env:259 LOCAL_TRAINER_CMD=python tools/trainer/train.py` — **không bị chú thích**, khác hẳn
`LLM_FINETUNE_CMD` / `WHISPER_BIN` / `PDFTOPPM_BIN`. Kiểm `tools/trainer/train.py`: PyTorch +
(tuỳ chọn) ultralytics YOLO.

Giấy phép `localSidecarTrainer.ts:353` **không truyền `filePath`, `fileBytes` hay
`configDefaultBytes`** ⇒ ước lượng **0**; và nó **cố ý không bao giờ `commitMeasured()`**
(`external-process`) ⇒ **sổ không bao giờ có một con số nào cho hộ này**, trong khi `ttlMs` = 2 GIỜ.
Trọng số chỉ là phần nhỏ: activation + optimizer state (Adam giữ 2 bản sao moment) co giãn theo
batch size / độ phân giải — **không suy được từ kích thước file model**.

⇒ Có thể **lớn hơn** sidecar thị giác 7,8 GB của Đợt 0, và **Pha 2A không có một điểm đo nào cho
nó**. Cùng lớp đang ngủ: `tools/trainer/finetune_lora.py` (QLoRA 4-bit).
⇒ **Pha 2B không được coi `external-process` là "đã nối nên đã biết".**

⚠ Đã đặt nó vào **phạm trù riêng**, KHÔNG cộng vào `CONSUMERS_WITHOUT_A_CODE_SITE`: nó **có**
điểm cấp phát và **đã nối** — vấn đề là *sổ không có SỐ*, không phải *sổ không biết nó tồn tại*.
Nếu nhét nó vào danh sách kia thì tiêu chí của danh sách đó lại bị nới, đúng lỗi M-2 vừa sửa.

---

## Vùng mù (E) — bốn thứ câu tự khai cũ NGỤ Ý SAI là đã phủ

Câu "client/** và tools/** ngoài SCAN_ROOTS" ngụ ý *bên trong đã phủ*. Không đúng:

| | |
|---|---|
| **E1** | **`.py` HOÀN TOÀN vô hình — ngay TRONG `SCAN_ROOTS`.** `scripts/` có **13 file Python** (gồm `aps_solver.py`), `tools/trainer/` có `train.py` + `finetune_lora.py`. Máy quét mù **theo NGÔN NGỮ**, không chỉ theo thư mục — mọi mẫu đều là cú pháp JS/TS. Đúng những file dễ chạm CUDA nhất lại là những file không mẫu nào đọc được. (`.ps1` ×3 cùng lớp.) |
| **E2** | **`apps/` là GỐC THỨ BA, chưa từng được kể tên.** `apps/machine-shell` (vỏ desktop WebView2, `frontendDist` → `client/dist`). Không nằm trong `SCAN_ROOTS`, cũng không nằm trong câu tự khai cũ. |
| **E3** | **`client/**` lượng hoá quá nhẹ.** Kiểm 2026-08-04: **13 file** trong `client/src` chạm lớp WebGL/three qua `<Canvas>` của `@react-three/fiber`; **0** lời gọi `new WebGLRenderer` trực tiếp — nên một máy quét tìm tên lớp đó sẽ báo "sạch" và **sai**. Thêm: Playwright chạy Chromium **không** `--disable-gpu`. VRAM này do **mã của chính sản phẩm** sinh ra nhưng đang bị đếm vào "nền". |
| **E4** | **`tools/machine-simulator/**` (.NET/C#) — reviewer đã quét: gần như KHÔNG có đường cấp phát GPU.** Zero hit cho `Process.Start`/SharpDX/Vortice/Silk.NET/D3D/WebView2/OnnxRuntime/CUDA, không web UI. Thứ duy nhất chạm GPU là **WPF** (MilCore hợp thành qua D3D9, vài chục MiB nền). Ghi ra vì nó là **phần mềm của chính sản phẩm đang bị đếm vào "nền desktop"** — cùng lớp lỗi với E3, chỉ nhỏ hơn nhiều. |

---

## Hai lưu ý về ô `wired` — đã ghi vào artifact

1. **5 dòng "KHÔNG phải điểm gọi"** (3 khai báo hàm + 2 pass-through) mang `wired: true` chỉ vì
   chúng thuộc bộ máy giấy phép. Chúng không phải lượt cấp phát và cũng không phải điểm nối — ở
   những dòng đó ô `wired` **vô nghĩa**, không được cộng vào bất cứ tổng nào.
2. **`wired: true` ở `scripts/` là CÓ ĐIỀU KIỆN, không phải tính chất.** `_gguf-embed.mjs` có
   **5 đường vào, chỉ 2 đi qua giấy phép**; `eval-rag.mjs` chỉ được phủ với cờ `--ci` do
   scheduler truyền — mà `npm run kb:eval` là lệnh **có thật** trong `package.json`. Cùng dòng
   mã đó, chạy tay, là **không giấy phép nào**. Một ô boolean không diễn tả được "phụ thuộc vào
   ai khởi động".

---

## Bổ sung cho §8 "những điều bản liệt kê này KHÔNG nói được"

12. **Ba lần nới mẫu, ba lần bảng rộng ra: 65 → 120 → 151.** Con số điểm gọi (14) không đổi, nhưng
    **bề mặt quét thì đổi mỗi vòng** — nghĩa là "151" không phải sự thật về hệ thống, nó là sự thật
    về *mẫu quét hiện tại*. Vòng nào cũng có người tìm ra một hình dạng mới đi lọt.
13. **Lớp MODULE trả lời "file nào NẠP thư viện", không trả lời "lượt nạp đó có cấp phát không".**
    8 trong 14 dòng `import node-llama-cpp` của `aiGgufEngine.ts` là đường SUY LUẬN, không phải
    đường cấp phát — nhưng chính chúng là nơi **kích hoạt** bộ đệm tính toán lười (§ ứng viên (a)).
    Ranh giới đó do người phân loại bằng tay, không có gì kiểm chứng.
14. **`index.cjs` chứng minh mọi mẫu văn bản đều né được.** Nó bị làm rối có chủ đích cho mục đích
    khác (chống bẻ khoá license), nhưng hình dạng đó — nối chuỗi specifier, gọi hàm qua chỉ số
    chuỗi — là thứ **bất kỳ mã sinh tự động nào cũng có thể tạo ra**. Một lưới dựa trên văn bản
    không đóng được lớp này; chỉ phân tích cú pháp/đồ thị mô-đun mới đóng được, và Pha 2A không
    làm điều đó.

---
---

# Vòng sửa 3 — vòng CUỐI của Task 5 (P-1…P-5, không đổi mã quét)

**Kết quả:** `npx vitest run server/services/vram/` → **224/224 xanh** (+ một lượt
`--sequence.shuffle.tests`) · `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` sạch.
**Con số không đổi: 151 dòng / 41 file = 14 + 5 + 43 + 89.**

---

## ★★★★ KẾT LUẬN CUỐI CỦA TASK 5

> **151 là số dòng mà MẪU QUÉT NGÀY 2026-08-04 nhìn thấy. Nó là cận DƯỚI.
> KHÔNG phương pháp nào trong Pha 2A biến nó thành cận TRÊN.**

Đây là kết luận **cấu trúc**, không phải khiêm tốn theo phép lịch sự. Tập hình dạng cấp phát
**đóng dưới phép ghép**: alias khi nhập · destructure đổi tên · `await import()` · `require()`
ghép chuỗi · gọi hàm qua khoá tính toán · `Reflect.get` · `globalThis[name]` · bảng tra cứu ·
proxy… Quyết định thành viên của một tập như thế bằng biểu thức chính quy là bài toán **không
quyết định được** — không phải một danh sách chưa liệt kê xong. "Vòng nào cũng có hình dạng mới
đi lọt" vì thế là **hệ quả tất yếu**, không phải rủi ro thống kê.

**HỆ QUẢ CHO PHA 2B:** bản liệt kê này **KHÔNG phải bảo đảm**. Nó là một **tiên nghiệm
best-effort** — tốt cho việc biết *phải đi hỏi ở đâu*, vô dụng nếu bị dùng như bằng chứng đã đủ.
Lớp an toàn thật phải là **đối chiếu với SỰ THẬT THIẾT BỊ lúc chạy**, không phải một danh sách
tĩnh dù dài bao nhiêu. (Chủ dự án đã nhận và sẽ sửa spec §5.6 theo hướng này.)

Câu trên đã được ghi vào **đầu `vramAllocationSites.ts`** — chỗ người thiết kế Pha 2B chắc chắn
đọc — chứ không chỉ nằm trong báo cáo.

---

## P-4 — N-2b: bằng chứng ĐO ĐƯỢC cho kết luận trên

Reviewer lấy **đúng** hình dạng né tránh của `index.cjs` và **chỉ đổi tên một biến**:

```
child_process_1  →  _0xcp
```

⇒ **10/10 XANH, ĐI LỌT** — sau khi bản vá N-2 đã vào.

Nghĩa là: mẫu `\bchild_process` **không bắt hình dạng né tránh; nó bắt một QUY ƯỚC ĐẶT TÊN của
bundler.** `index.cjs` bị bắt chỉ vì trình làm rối **tình cờ** giữ nguyên tên biến do TypeScript
sinh ra — trong khi chính file đó đã đổi tên HÀM thành `_0x3a14ef`. Bản vá N-2 của tôi vì thế
đúng về *kết quả trên file cụ thể đó* và sai về *điều nó ngụ ý phủ được*.

⚠ **KHÔNG vá N-2b bằng cách thêm mẫu** (quyết định của chủ dự án, và tôi đồng ý): mỗi mẫu mới chỉ
đóng **một thể hiện**, đồng thời làm lưới **trông** mạnh hơn thực chất — đúng cơ chế đã khiến
vòng 1 tuyên bố sai về lớp lỗi sidecar 7,8 GB. N-2b được ghi lại **làm bằng chứng**, không phải
làm việc-cần-làm.

---

## P-1 — số cũ sót lại, và không có gì canh nó

`vramAllocationSites.ts:71` còn ghi **"120 dòng"** khi bảng đã lên **151** — một con số cũ sót
lại nằm ĐÚNG trong file có docstring cảnh báo về việc cộng dồn số cũ, và **không ca test nào ràng
buộc `KNOWN_ALLOCATION_SITES.length`** nên không có gì đỏ.

Sửa số, **và khoá lại**: thêm `KNOWN_ALLOCATION_SITE_ROW_COUNT = 151` cùng ca **3c** khẳng định
hai điều — độ dài bảng bằng hằng số đó, **và** bằng tổng lần xuất hiện quét được. Ca 1 và ca 2 đã
canh từng khoá; ca 3c canh con số mà **con người sẽ đi trích dẫn**.

---

## P-2 — con số 212 sai phạm vi

**212** được đo trong phạm vi **kể cả file test và artifact** — hai thứ máy quét loại trừ theo cấu
trúc. Đo lại trong phạm vi thật: định danh trần **61**, dạng nhập **23**, **nhiễu thuần 38**.

**Quyết định không đổi** (vẫn dùng mẫu dạng-nhập; nhiễu gấp 1,65 lần tín hiệu vẫn là lý do đủ) —
nhưng một con số sai phạm vi dùng để biện minh cho một quyết định đúng thì vẫn là **một lập luận
hỏng**, và nó sẽ được trích dẫn lại. Đã sửa tại chỗ trong docstring `MODULE_PATTERNS`.

---

## P-3 — câu đã bị bác vẫn đứng không nhãn ở dòng 548

"Mọi lease GGUF đều BÁO THIẾU" chỉ bị bác ở dòng 710 — **cách 162 dòng**. Người đọc dừng ở §
"HỆ QUẢ CHO PHA 2B" sẽ mang đi một kết luận đã bị bác. Nay **gắn nhãn tại chỗ** (gạch ngang + ⛔ +
trỏ tới N-3/N-4/N-5), cho cả hai câu bị bác.

---

## P-5 / E1 / E2 — hai câu chữ phân bổ sai chú ý, sửa bằng SỐ ĐO

**E1 — `.py`.** Bản trước đặt "13 file Python" cạnh câu *"đúng những file dễ chạm CUDA nhất"*.
Đo lại (`torch|cuda|onnxruntime|ultralytics|tensorflow|cupy`): **0/13 file có điểm cấp phát GPU**.
Nội dung thật: 1 solver CP-SAT (`aps_solver.py` — đã phân loại đúng là CPU trong bảng), 1 mô phỏng
MQTT, 1 migration, 1 test websocket, **9 codemod dùng một lần**. Câu cũ làm 13 file vô hại trông
như 13 rủi ro.

**Toàn bộ GPU-Python của repo = ĐÚNG HAI file, cả hai NGOÀI `SCAN_ROOTS`:**
`tools/trainer/train.py` (5 lần chạm `cuda`; `:260`
`use_cuda = torch.cuda.is_available() and device_req != "cpu"` ⇒ **mặc định là CUDA**) và
`tools/trainer/finetune_lora.py` (3 lần). **Cả hai đã được gọi đích danh ở N-6b.** Đối chiếu cờ:
`.env:259 LOCAL_TRAINER_CMD=…` **không** bị chú thích, trong khi `:730 LLM_FINETUNE_CMD` và
`:738 WHISPER_BIN` **đều** bị — xác nhận hộ trainer là hộ ĐANG SỐNG, không phải hộ ngủ.

**E2 — `apps/`.** Bản trước gọi nó là "GỐC THỨ BA". Đo: **4 file, 0 file mã nguồn** (2 `README.md`,
1 `Cargo.toml`, 1 `tauri.conf.json`). Quét nó hôm nay trả về **0 dòng**. VRAM thật của vỏ desktop
đó là VRAM của `client/dist` mà nó nạp — tức đã nằm ở (E3). Gọi là "gốc thứ ba" là **thổi phồng**.

**QUYẾT ĐỊNH: KHÔNG thêm vòng quét `.py`/`apps/`.** Sản lượng đo được là **0 dòng** cho cả hai;
chi phí là một bộ mẫu Python phải nuôi mãi mãi — đúng lớp lỗi đã hai lần bị từ chối (`exec(` trần,
định danh thư viện trần). Thay vào đó: khai vùng mù **tường minh kèm ba con số trên**, cộng một
**dây bẫy 3 dòng** (ca **7c**): hai file `tools/trainer/*.py` phải còn tồn tại và còn chứa `cuda`
— mất một trong hai thì mục N-6b của bản liệt kê đã cũ và phải đọc lại.

---

## Bổ sung cuối cho §8 "những điều bản liệt kê này KHÔNG nói được"

15. **N-2b: hình dạng né tránh VẪN đi lọt sau bản vá, chỉ cần đổi một tên biến.** Đây là bằng
    chứng mạnh nhất trong cả Task 5 cho mục 12 (bảng rộng ra mỗi vòng): không phải "mẫu còn
    thiếu", mà là **phương pháp không thể đủ**. Ba lần nới mẫu (65 → 120 → 151) không đưa lưới
    tiến gần "đủ" hơn chút nào về mặt cấu trúc — chỉ làm nó bắt thêm vài thể hiện đã biết.
16. **Bảng này mạnh nhất ở chỗ nó KHÔNG được dùng làm bảo đảm.** Giá trị thật của 151 dòng là
    danh sách **nơi phải đi hỏi**: 14 điểm nối để biết sổ nhìn thấy gì, 89 dòng chưa nối để biết
    sổ KHÔNG nhìn thấy gì, và 6 hộ không có điểm cấp phát để biết máy quét **không thể** nhìn.
    Dùng nó thay cho một phép đo thiết bị lúc chạy là lặp lại đúng sai lầm đã bị bác ba vòng liền.
