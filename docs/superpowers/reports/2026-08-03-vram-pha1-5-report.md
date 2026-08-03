# Pha 1.5 điều phối VRAM — Báo cáo ĐO LẠI trên mã đã sạch (Task 5)

> **Bản chính thức, TỰ ĐỦ.** Không cần đọc `.superpowers/` (thư mục đó bị gitignore).
> Nhánh `feat/hmi-dep` · BASE Pha 1.5 = `ac702b9b` · HEAD trước task này = `341da935`.
> Nguồn đối chiếu: `docs/superpowers/reports/2026-08-02-vram-pha1-report.md` (gọi tắt **Pha 1**).
> **Task này CHỈ ĐO — không sửa một dòng mã sản xuất nào** (xác nhận ở §9.4).

---

## 0. Tóm tắt điều hành

Bốn task trước của Pha 1.5 đã sửa **ba lỗi ĐO** (một thước duy nhất · backend CUDA vào sổ · băng
dung sai phía âm cho cửa sổ chưa-commit). Task này đo lại trên mã đó và chốt ngưỡng.

| Việc | Kết quả |
|---|---|
| **(1) Cổng eval `cron:kb-eval-gate`** | ✅ **ĐẠT** — 3 lượt LIVE, mỗi lượt đúng **1 `reserve` + 1 `release`** (`releaseProof: "process-exit"`), giấy phép sống đúng bằng khoảng tiến trình con sống. Kèm số đo: hộ này thật sự dùng **1.022 / 1.036 / 1.033 MiB** so với ước lượng **1.251 MiB**. |
| **(2) Hai trainer Python** | ❌ **KHÔNG ĐO ĐƯỢC** — máy này **không có `torch`** (và không có `torchvision`/`ultralytics`/`transformers`/`peft`/`bitsandbytes`, không có checkpoint HuggingFace nào, không có bộ ảnh). 4 lượt chạy thật (2 mỗi cái) đều chết sau ~1,7 s tại `import torch`, delta VRAM = **0 MiB**. **Đó KHÔNG phải số đo của trainer** — xem §3. `VRAM_TRAINER_ESTIMATE_MB` / `VRAM_FINETUNE_ESTIMATE_MB` **giữ nguyên**. |
| **(3) Phân bố lệch mới** | ✅ Đo được, **101 mẫu** trên nền hợp lệ: p50 **15**, p90 **210**, p95 **210**, max **1.002** MiB (max ở **trạng thái ổn định** chỉ **210**), **báo động 0/101 = 0 %**. Pha 1: p50 536, p90 664, p95/max 16.335, **100 % báo động kể từ lượt `commit` đầu**. **Sàn cấu trúc đã sập từ 536-882 MiB xuống ≤ 210 MiB.** ⚠ **`p95` KHÔNG so thẳng được với Pha 1** — 10 dòng cửa sổ nạp 30B (đúng loại sinh ra `p95` của Pha 1) đã bị lọc; tính cả chúng: n=111, p50 134, **p95 17.287**, max 17.290, **báo động vẫn 0/111**. Quá độ **−17,29 GiB VẪN CÒN NGUYÊN độ lớn — thứ đổi là nó KHÔNG CÒN BÁO ĐỘNG**. Xem §4.2. |
| **(4) Ngưỡng** | **`VRAM_DRIFT_THRESHOLD_MB` giữ **512**** — lần đầu tiên con số này **nằm TRÊN sàn** (2,4× dự phòng) thay vì nằm dưới. **Sàn KHÔNG còn trên 512.** Nhịp: **giữ 60 s**, và **RÚT LẠI khuyến nghị "hạ xuống 10 s" của Pha 1 §4.1** — xem §5. |
| **(5) 24 giờ** | ❌ **CHƯA CHẠY.** Phiên này dài ~1,5 giờ. Thủ tục chính xác để người sau chạy ở §7. **KHÔNG công bố điều kiện chặn số 4 và 6 là ĐẠT.** |

### ★★ Phát hiện CHẶN mới, nghiêm trọng hơn mọi thứ Task 5 đi tìm

**`captureVramBaseline()` có thể NUỐT TRỌN model đang nạp vào NỀN — vĩnh viễn.**

Lỗi nằm ở **công thức `nền = raw − Σ actualBytes`**, **không** ở riêng một nhánh gọi. Nó có
**HAI đường vào**, và **cả hai đều còn mở**:

| Đường | Kích hoạt khi | Đã đo? |
|---|---|---|
| **(a) Lượt chụp ĐẦU đua với warm boot** | `warmUpOllamaModels()` (`setTimeout 2000`, bắn từ `index.ts:4931`) **thắng** cuộc đua tới `startBackgroundSchedulers()` (`index.ts:5229`, ~298 dòng + nhiều `await` sau đó) ⇒ 30B đang nạp lúc `startVramReconciler():660` chụp nền lần đầu. **Không đổi thước, KHÔNG resample** — hậu quả y hệt. | Chưa — suy ra từ mã (§5.2) |
| **(b) Nhánh RESAMPLE của Task 1** | nhịp đối chiếu đầu sau khi handle native gắn rơi vào cửa sổ nạp | **ĐÃ ĐO, tái hiện 2/2 lượt** |

Hệ quả đo được ở đường (b): một lệch **41,6 MiB** biến thành lệch **−16.700 MiB đứng mãi**, báo
động **100 % mọi nhịp** cho tới khi **khởi động lại tiến trình**. Đây là lỗi **tệ hơn** cả trạng
thái trước Pha 1.5. Chi tiết + bằng chứng pháp y ở **§5**.

⇒ **Mọi khuyến nghị ngưỡng ở §6 chỉ có nghĩa SAU khi khoản này được xử lý** — không ngưỡng nào
cứu được một cái nền sai 17 GiB. ⇒ **Bản vá chỉ chạm nhánh resample sẽ để nguyên đường (a).**

---

## 1. Kỷ luật đo

- **KHÔNG dùng `tasklist`** (trả rỗng khi có 8 `node.exe`). Dùng `nvidia-smi` +
  `netstat -ano | grep -E ":3000|:8081"`, kiểm **trước VÀ sau** mỗi lượt.
- **Máy sạch trong toàn bộ phiên**: cổng `:3000` và `:8081` **trống suốt** (không có app, không
  có `dev:worker`); nền GPU dao động **962 – 1.081 MiB** (desktop compositor + Edge/VS Code).
  **Sidecar thị giác ~7,8 GB NGỦ suốt** — nếu nó thức, nền đã phải ~8,8 GB; không lượt đo nào
  thấy con số đó.
- GPU: **NVIDIA GeForce RTX 5090, 32.607 MiB**.
- DB: `docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management`
  (Postgres container, cổng host **5434**).
- Mọi biến môi trường của Step 2 **ép qua CLI** (`.env` không git-track).
- Ba script đo **tạm thời** đặt trong `scripts/__tmp_t5_*.ts`, **đã xoá**; cây về đúng **245** mục
  (§9.4). Script chỉ **GỌI** hàm sản xuất: `captureVramBaseline()`, `__runReconcileTick()`,
  `reconcileOnce()`, `loadGgufModel()`, `generateText()`, `generateEmbedding()`,
  `__runEvalGateForTests()`, `flushVramEvents()`.
- Bộ test liên quan chạy lại sau khi dọn: **13 file / 130 test — PASS** (`vitest run
  server/services/vram server/services/kbSyncScheduler.evalGate.test.ts`).

---

## 2. Step 1 — nghiệm thu LIVE cổng eval `cron:kb-eval-gate` ✅ ĐẠT

### 2.1 Cách ép chạy

Gọi `__runEvalGateForTests()` (`server/services/kbSyncScheduler.ts:382`) — hàm này chạy **ĐÚNG
hai bước thật** mà `runEvalHarness()` dùng: `beginEvalGateVram()` rồi `spawnEvalGateWithVram()`,
không nhảy qua cổng nào. Tiến trình chẩn đoán ở lại sống tới khi tiến trình con thoát để nhánh
`"exit"` trả giấy phép. Tiến trình con thật: `node scripts/ai-kb/eval-rag.mjs --ci`.

### 2.2 Sổ cái — 3 lượt, đúng vòng đời

```sql
SELECT id, event, owner, "estimatedBytes"/1048576 AS est_mib, "estimateSource",
       detail->>'releaseProof' AS proof, "createdAt"
FROM vram_events WHERE owner LIKE 'cron:%' ORDER BY id;
```

| id | event | owner | est (MiB) | estimateSource | releaseProof | createdAt |
|---|---|---|---|---|---|---|
| 115 | `reserve` | `cron:kb-eval-gate` | 1251 | `config-default` | | 03:56:13.584 |
| 116 | `release` | `cron:kb-eval-gate` | 1251 | `config-default` | `process-exit` | 03:56:42.482 |
| 117 | `reserve` | `cron:kb-eval-gate` | 1251 | `config-default` | | 03:57:17.621 |
| 118 | `release` | `cron:kb-eval-gate` | 1251 | `config-default` | `process-exit` | 03:57:46.726 |
| 120 | `reserve` | `cron:kb-eval-gate` | 1251 | `config-default` | | 04:01:16.323 |
| 121 | `release` | `cron:kb-eval-gate` | 1251 | `config-default` | `process-exit` | 04:01:50.240 |

**Đúng 3 cặp `reserve`/`release`, không thừa, không treo.** Sổ trong bộ nhớ được kiểm song song:
`[]` → `["cron:kb-eval-gate"]` ngay sau spawn → `[]` ngay khi tiến trình con thoát.

### 2.3 `nvidia-smi` trước / trong / sau — và số ĐO ĐƯỢC của hộ này

| Lượt | trước | đỉnh (trong) | sau | **đỉnh − trước** |
|---|---|---|---|---|
| 1 | 986 MiB | 2.008 MiB | 977 MiB | **1.022 MiB** |
| 2 | 962 MiB | 1.998 MiB | 965 MiB | **1.036 MiB** |
| 3 | 1.081 MiB | 2.114 MiB | 1.078 MiB | **1.033 MiB** |

⇒ **Hộ `cron:kb-eval-gate` thật sự dùng ~1.030 MiB**, ước lượng `config-default` **1.251 MiB**
⇒ **thừa ~221 MiB (+21 %)**. Ước lượng này là **trần trên**, không phải số bịa — nhưng nay đã
có số đo để siết. Đề xuất (CHƯA áp dụng, chờ chủ dự án):
`VRAM_KB_EVAL_ESTIMATE_MB=1100` (đo 1.036 + ~6 % biên).
⚠ **Không tự sửa `.env`** vì `.env` không git-track ⇒ một thay đổi ở đó là **vô hình với review**.

### 2.4 Lượt 3 — đo thêm `reconcileOnce()` trong suốt vòng đời tiến trình con

Nền chụp trước khi spawn = **1.081 MiB** (thước `smi`, sổ rỗng ⇒ không có đổi thước trong lượt này).

```
t=0s   smi=1081  giữ=YES  sổ=1251  pending=1251  drift=-1251  alarm=0
t=4s   smi=2110  giữ=YES  sổ=1251  pending=1251  drift=-1251  alarm=0
t=7s   smi=2105  giữ=YES  sổ=1251  pending=1251  drift= -227  alarm=0
…      (ổn định −219 … −228 suốt 30 s)
t=36s  smi=2114  giữ=YES  sổ=1251  pending=1251  drift= -219  alarm=0
t=39s  smi=1079  giữ=no   sổ=0     pending=0     drift=   -2  alarm=0
```

Ba điều đọc được:

1. **Lệch −219…−228 MiB CHÍNH LÀ sai số ước lượng** (1.033 thật − 1.251 khai) — không phải rò rỉ.
2. **`pendingBytes` = 1.251 MiB suốt cả 39 giây.** Đúng như mã, nhưng khác **giả định trong
   docstring Task 3** (*"đang cấp phát dở, số thật sắp tới — tự lành trong vài giây"*): hộ
   `external-process` **CỐ Ý không bao giờ `commitMeasured()`** (`kbSyncScheduler.ts:467-470`,
   `localSidecarTrainer.ts:347`), nên `actualBytes` **không bao giờ tới**. ⇒ **băng dung sai phía
   ÂM bị nới bằng TOÀN BỘ ước lượng của hộ đó, suốt cả job** — 39 s cho cổng eval, tới **30 phút**
   cho `cron:kb-sync`, và tới `sidecarTimeoutMs()` cho trainer. Hệ quả ở §6.3.
3. Sau khi nhả: drift về **−2 MiB**. Không giấy phép treo.

---

## 3. Step 2 — hai tiến trình Python: **KHÔNG ĐO ĐƯỢC**

> ⚠ **Đây là lời khai, không phải số đo.** Brief nói rõ: nếu môi trường không chạy nổi thì nói
> thẳng và ghi thiếu gì — **đừng suy ra một con số rồi gắn nhãn "đã đo"**. Không có con số nào
> trong mục này được nâng cấp thành "đã đo".

### 3.1 Đã chạy thật, ép biến qua CLI, 2 lượt mỗi cái

Spawn theo **đúng khuôn server dùng**: tách biến môi trường theo khoảng trắng, nối `jobDir` vào
cuối, `shell: false` — cùng phép tách của `resolveSidecarCommand()`
(`server/services/localSidecarTrainer.ts:63`) và `resolveFinetuneCommand()`
(`server/services/aiLlmFinetuneSidecar.ts:148`). Job dir tối thiểu hợp lệ (job.json + manifest
JSONL + thư mục out/logs) dựng trong scratchpad.

```
LOCAL_TRAINER_CMD="python tools/trainer/train.py"
LLM_FINETUNE_CMD="python tools/trainer/finetune_lora.py"
```

| Lệnh | lượt | exit | thời lượng | smi TRƯỚC | smi ĐỈNH | smi SAU | **ĐỈNH−TRƯỚC** | stderr |
|---|---|---|---|---|---|---|---|---|
| `train.py` | 1 | 1 | 1.735 ms | 970 | 970 | 969 | **0 MiB** | `sidecar trainer failed: No module named 'torch'` |
| `train.py` | 2 | 1 | 1.704 ms | 969 | 969 | 970 | **0 MiB** | idem |
| `finetune_lora.py` | 1 | 1 | 1.765 ms | 970 | 970 | 966 | **0 MiB** | `lora finetune sidecar failed: No module named 'torch'` |
| `finetune_lora.py` | 2 | 1 | 1.718 ms | 966 | 966 | 962 | **0 MiB** | idem |

**0 MiB ở đây KHÔNG có nghĩa "trainer dùng 0 MiB".** Nó có nghĩa **tiến trình chết trước khi
chạm CUDA**. Đúng lớp nguỵ biện mà chính hai docstring trong mã đã cảnh báo
(`localSidecarTrainer.ts:338`, `aiLlmFinetuneSidecar.ts:452`): *"hôm nay hộ này đo 0 MiB CHỈ VÌ
biến env chưa đặt"*. Nay biến ĐÃ đặt, và 0 MiB vẫn là **0 giả** — chỉ đổi lý do.

### 3.2 Thiếu gì — danh sách kiểm chứng được

**Môi trường Python:**
- Trình thông dịch **duy nhất** trên máy: **Python 3.14.6**
  (`C:\Users\Admin\AppData\Local\Python\pythoncore-3.14-64`). Không conda, không venv dùng được.
- Venv của repo `.venv` **HỎNG**: `pyvenv.cfg` trỏ tới một Python 3.13 Windows-Store **đã bị gỡ**
  (`…PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0`), và `command =` cho thấy nó được tạo ở
  máy khác (`c:\Apps\avi-aoi-management\.venv`). Mọi lệnh qua `.venv\Scripts\python.exe` báo
  *"did not find executable"*.
- `pip list` cho môi trường 3.14: **không có** `torch`, `torchvision`, `onnx`, `ultralytics`,
  `transformers`, `peft`, `accelerate`, `bitsandbytes`, `sentencepiece`.

**`LOCAL_TRAINER_CMD` → `tools/trainer/train.py` còn thiếu:**
1. `torch` (`:162`, `:249`, `:358`, `:398`, `:621`), `torchvision` (`:164`, `:216`).
2. `ultralytics` — **nhánh segmentation**, tức đúng nhánh mà docstring `train_seg()` (`:616`) nói
   *"mô hình được chọn cỡ ~6 GB VRAM"*, tức **nguồn duy nhất của con số 6.144 MiB**.
3. **Trọng số pretrained CỤC BỘ.** Script offline-first: `:205-227` dùng `weights=None` (huấn
   luyện từ số ngẫu nhiên) trừ khi operator pre-cache dưới `TORCH_HOME` và đặt `_USE_PRETRAINED=1`.
   Không có cache nào trên máy.
4. **Bộ ảnh thật** (`manifests` + `imageRoot` có file ảnh). Không có.

**`LLM_FINETUNE_CMD` → `tools/trainer/finetune_lora.py` còn thiếu:**
1. `torch`, `transformers`, `peft`, `accelerate`, `sentencepiece`, `protobuf`
   (`tools/trainer/requirements-lora.txt`).
2. `bitsandbytes` cho QLoRA 4-bit/8-bit — chính file requirements của repo ghi *"Linux/CUDA-first
   — trên Windows phải chạy sidecar dưới WSL2"*. Máy này là Windows 11.
3. **Checkpoint HuggingFace dạng THƯ MỤC** (`baseModelPath`, `:37-56` nói rõ **không phải** `.gguf`).
   Quét `D:/SOURCES` (độ sâu 4): **0 file `*.safetensors`, 0 `config.json`**. Cả kho model
   `D:/SOURCES/16.AI` **chỉ có `.gguf` + 2 `.onnx`**. Script tự đặt `HF_HUB_OFFLINE=1` và
   `TRANSFORMERS_OFFLINE=1` ở `:104-105` ⇒ **nó sẽ không tải về**.
4. `LLAMA_CPP_CONVERT_SCRIPT` (checkout llama.cpp cục bộ có `convert_hf_to_gguf.py`) cho bước
   xuất GGUF — **không đặt**.

**Trạng thái cấu hình đáng báo động (phát hiện phụ, ngoài phạm vi sửa):**
- `.env:259` **`LOCAL_TRAINER_CMD=python tools/trainer/train.py` ĐANG BẬT** ⇒ `isSidecarEnabled()`
  trả `true` ⇒ `dispatchTier2()` sẽ **spawn thật** một tiến trình chết sau 1,7 s. Tức đường
  **Tier-2 đang được quảng cáo là BẬT trong khi nó không chạy nổi trên máy này**.
- `.env:730` `LLM_FINETUNE_CMD` **đang bị comment** ⇒ hệ con LoRA **TẮT** đúng như thiết kế.
- `VRAM_TRAINER_ESTIMATE_MB` và `VRAM_FINETUNE_ESTIMATE_MB` **không có trong `.env`** ⇒ mặc định
  **6.144 MiB** (`config-default`) và **kích-thước-file `baseModelPath`** vẫn đang có hiệu lực.

### 3.3 Kết luận Step 2

- **Hai ước lượng GIỮ NGUYÊN**, vì không có số đo để thay. `6.144 MiB` vẫn là **mục tiêu thiết kế
  chép từ docstring**; ước lượng QLoRA vẫn là **kích thước file**. Nhãn `estimateSource` trong sổ
  (`config-default` / `file-size`) **đang khai đúng sự thật đó** — không có gì phải sửa ở nhãn.
- **Chưa nghiệm thu được vòng đời giấy phép** của `sidecar:local-trainer` và
  `sidecar:llm-finetune` bằng đường LIVE: khác `kbSyncScheduler`, hai module này **không có hook
  `__run…ForTests()`**, và đường thật (`runSidecarTraining` / `startLoraFinetune`) đòi
  `buildDataset(datasetId)` + `getAiModelById()` tức **phải có bản ghi DB thật**. Lưới canh hiện
  chỉ là `server/services/vram/wiring.trainers.test.ts` (đơn vị, **PASS**). **Khoảng trống về khả
  năng kiểm thử này nên được ghi vào backlog**: hộ thứ hai và thứ ba trong "ba hộ mới" **chưa từng
  chạy LIVE lần nào**.
- Thủ tục để người sau **biến nó thành số đo** ở **§7.3**.

---

## 4. Step 3 — phân bố lệch trên mã ĐÃ SẠCH

### 4.1 ⚠ Hạn chế CHƯA GỠ: sổ **vẫn** không tự sinh nổi phân bố này

`reconcileOnce()` chỉ gọi `logVramEvent({event:"drift"})` **bên trong nhánh `if (alarm)`**
(`vramReconciler.ts:578-638`) — y như Pha 1 §3.1. ⇒ Mẫu trong DB vẫn bị **kiểm duyệt đúng tại con
số ta cần chốt**: chạy sạch, 0 báo động ⇒ **0 dòng `drift`** ⇒ không có phân bố nào để đọc.
**Bằng chứng trực tiếp từ chính lượt đo hôm nay**: lượt "nền hợp lệ" ghi **68 mẫu tốt** và để lại
**0 dòng `drift`** trong `vram_events`. **Ba task sửa lỗi đo KHÔNG đụng tới khiếm khuyết này** —
nó vẫn nguyên vẹn và vẫn phải đo **ngoài** sổ, đúng cách Pha 1 đã làm.

**Cách vòng đã dùng (không sửa mã):** một tiến trình chẩn đoán gọi hàm sản xuất
`__runReconcileTick()` **mỗi 1 giây** trọn một vòng đời cấp phát thật.

### 4.2 BỘ A — **nền hợp lệ** (101 mẫu): sàn cấu trúc đã sập

**Tiêu chí lọc — nói ĐÚNG cái đã làm** (bản đầu khai một tiêu chí rộng hơn tiêu chí thực sự áp
dụng; xem khung *"MƯỜI mẫu bị loại"* dưới bảng): giữ mẫu khi nền **cùng thước** với phép so **VÀ**
`(sổ rỗng **hoặc** thuộc lượt clean)`. Vế thứ hai loại **10 dòng cửa sổ nạp 30B tuy nền vẫn hợp
lệ** — đó là một lựa chọn, không phải hệ quả của tiêu chí đầu, và nó **làm `p95`/`max` không so
thẳng được với Pha 1**. Bảng dưới trả lời câu *"ba task sửa lỗi đo để lại bao nhiêu lệch tồn dư ở
TRẠNG THÁI ỔN ĐỊNH?"* — và **chỉ** câu đó.

| Trạng thái | n | min | p50 | p90 | p95 | max | báo động |
|---|---|---|---|---|---|---|---|
| **A1 — NGHỈ** (sổ rỗng, chưa chạm CUDA) | 33 | 0 | **4** | 15 | 15 | **15** | 0/33 |
| **A2 — 30B thường trú** (trước suy luận) | 20 | 0 | **0** | 0 | 0 | **0** | 0/20 |
| **A3 — 30B + buffer suy luận** | 21 | 134 | **140** | 140 | 140 | **140** | 0/21 |
| **A4 — 30B + embedder + embed-ctx** | 25 | 210 | **210** | 386 | 386 | **386** | 0/25 |
| **A5 — cửa sổ nạp embedder (chưa commit)** | 2 | 136 | 136 | 1002 | 1002 | **1.002** | 0/2 |
| **BỘ A TỔNG** | **101** | **0** | **15** | **210** | **210** | **1.002** | **0/101 = 0 %** |

Toàn bộ giá trị `drift` phân biệt quan sát được trong Bộ A (MiB, giữ dấu):

```
-1002×1   -386×4   -15×5   -8×6   -4×6   0×34   +3×1   +14×1   +134×6   +136×1   +140×15   +210×21
```

Bóc tách (mỗi khoản là một mức ổn định, không phải bảng cân đối):

| Khoản | MiB | Bằng chứng |
|---|---|---|
| Nhiễu nền lúc nghỉ | **0 … ±15** | 33 mẫu, sổ rỗng, thước `smi` cả hai đầu. |
| **Backend CUDA + trọng số 30B** | **0** | 20 mẫu liên tiếp `drift = 0` **chằn chặn**. Task 2 đã đưa `cuda-backend` (đo 431 MiB) vào sổ; Task 1 đã bỏ lệch thước. **Hai nguồn cấu trúc lớn nhất của Pha 1 (≈430 + ≈170) nay bằng 0.** |
| **Buffer tính LƯỜI của llama.cpp** | **+134 … +140** | Xuất hiện **đúng ở lượt suy luận đầu** (`generateText`, 16 token), không tồn tại ở 20 nhịp trước đó. Pha 1 ước ~200 (suy ra từ 738,6 − 536); nay đo trực tiếp ở lượt sinh ngắn. |
| **Buffer lười của embed-context** | **+70** (210 − 140) | Xuất hiện sau `generateEmbedding`; giấy phép `gguf-embed-ctx` khai 526 MiB, thiết bị tăng nhiều hơn thế. |
| Quá độ khi nạp embedder | **−386, −1.002** | Chỉ tồn tại trong cửa sổ chưa-commit; **`alarm=0` nhờ băng dung sai âm của Task 3**. |

> ⚠ **Buffer lười của embed-context (+70 MiB) là SUY LUẬN, không phải bằng chứng.** Điều **đo
> được** là bậc `+140 → +210` xuất hiện sau `generateEmbedding()`, và giấy phép
> `gguf-embed-ctx` khai `actualBytes = 526 MiB`. Việc quy toàn bộ 70 MiB đó cho "buffer lười của
> embed-context" là **giả thuyết hợp lý nhất**, chưa cô lập. Nó có thể lẫn phần buffer lười của
> chính 30B tăng thêm khi bộ nhớ bị phân mảnh. **Không dùng con số 70 này làm đầu vào cho bất kỳ
> quyết định nào.**

#### ⚠ MƯỜI mẫu bị loại khỏi Bộ A — và vì sao p95 KHÔNG so được thẳng với Pha 1

Tiêu chí **khai** ở đầu §4.2 (*"nền cùng thước, không rơi cửa sổ chưa-commit"*) **rộng hơn** tiêu
chí **thực sự áp dụng** khi lọc (*"sổ rỗng, hoặc thuộc lượt clean"*). Mười dòng sau đây **thoả
tiêu chí khai** — nền `smi` **978/968 MiB hợp lệ**, phép so cũng `smi`, **chưa** đổi thước, **chưa**
nhiễm — nhưng đã bị lọc bỏ:

```
lượt B1  idx 18-22 : drift = -17.287 ×5   (nền 968, sổ 17.301, pending 16.871, alarm 0)
lượt B2  idx 17-21 : drift = -17.290 ×5   (nền 978, sổ 17.293, pending 16.871, alarm 0)
```

| Tập | n | p50 | p90 | p95 | max | báo động |
|---|---|---|---|---|---|---|
| Bộ A **như bảng trên** | 101 | 15 | 210 | **210** | **1.002** | **0/101** |
| Bộ A **+ 10 dòng bị loại** | 111 | **134** | 386 | **17.287** | **17.290** | **0/111** |

Ba điều phải nói thẳng:

1. **`p95 = 16.335 → 210` KHÔNG cùng loại.** `p95`/`max` của Pha 1 đến từ **đúng loại dòng này**
   (cửa sổ nạp 30B, `−16.335 MiB`). Tính trên tập **đã loại** chúng thì `p95` Bộ A đo một thứ
   khác. Tính **đúng cùng loại** thì `p95 = 17.287`, `max = 17.290`.
2. **Quá độ −17,29 GiB VẪN CÒN NGUYÊN ĐỘ LỚN.** Task 3 **không thu nhỏ** nó và chưa bao giờ hứa
   thế. **Thứ đã đổi là: nó KHÔNG CÒN BÁO ĐỘNG** — `alarm = 0/10` ở đây, trong khi Pha 1 cùng ca
   này `alarm = true`. Đó mới là điều Task 3 hứa và đã trả.
3. Cách lọc còn **bất đối xứng**: cửa sổ nạp **embedder** (1,1 GB, A5) **được giữ**, cửa sổ nạp
   **30B** (17 GB) **bị loại** — cùng một hiện tượng, khác mỗi độ lớn.

**Kết luận chịu tải KHÔNG đổi dù tính kiểu nào:** báo động **0/101** hay **0/111**; và ngưỡng ở
§6 được chốt trên **mức lệch Ở TRẠNG THÁI ỔN ĐỊNH** (`0 / 140 / 210`), **không** trên `p95`.

### 4.3 So với Pha 1 — bảng đối chiếu thẳng

| | **Pha 1** (2026-08-02) | **Pha 1.5, Bộ A** (hôm nay) |
|---|---|---|
| n | 35 | **101** |
| min | 5 | **0** |
| **p50** | **536** | **15** |
| **p90** | **664** | **210** |
| **p95** | **16.335** | **210** ⚠ **KHÔNG cùng loại** — xem khung §4.2; cùng loại thì **17.287** |
| **max** | **16.335** | **1.002** ⚠ cùng loại thì **17.290** · max ở trạng thái **ổn định**: **210** |
| tỉ lệ báo động | **20/35 = 57 %**, và **18/18 = 100 %** kể từ lượt `commit` đầu | **0/101 = 0 %** (và **0/111** nếu tính cả 10 dòng cửa sổ nạp 30B) |
| Lệch ổn định 4 cấu hình | **536 · 664 · 738,6 · 882,4** | **0 · 140 · 210** (và **0…15** lúc nghỉ) |
| *"Không cấu hình nào lệch < 512 khi có model GGUF thường trú"* | ĐÚNG | **SAI — mọi cấu hình đều ≤ 210** |

**Ba lỗi đo đã trả đúng thứ chúng hứa:**

| Sửa ở | Hứa trừ | Đo được hôm nay |
|---|---|---|
| Task 1 — một thước duy nhất | ~170 MiB lệch giả | ✅ Khoảng cách hai thước nay đo được **p50 +213 MiB, max +221** (Pha 1: 165-178 — **gap còn RỘNG HƠN**), nhưng nó **triệt tiêu hoàn toàn** khi nền và phép so cùng thước ⇒ đóng góp **0** vào drift. |
| Task 2 — backend CUDA vào sổ | ~430 MiB | ✅ `cuda-backend` `commit` = **431 MiB** trong sổ (`vram_events` id 81); drift ở A2 = **0**. |
| Task 3 — băng dung sai chỉ phía âm | tới −16.335 MiB | ✅ Cửa sổ nạp 30B: `drift = −17.290 MiB` với `pendingBytes = 16.871` ⇒ ngưỡng âm = −(512+16.871) = **−17.383** ⇒ **`alarm = 0`**. Pha 1 cùng ca này **báo động**. Xác nhận ở **21 mẫu** liên tiếp qua 2 lượt. ⚠ Task 3 **KHÔNG thu nhỏ độ lớn** của lệch âm (vẫn −17,29 GiB) — nó **tắt tiếng chuông** cho ca đó. |

### 4.4 BỘ B — thứ tự boot sản xuất, nhịp 1 s (133 mẫu): thảm hoạ

Cùng mã, cùng máy, khác **duy nhất** một điều: nền được chụp **trước** khi chạm CUDA (đúng thứ tự
boot sản xuất), nên **có một lần đổi thước `smi → native`** trong lượt đo.

| | n | min | p50 | p90 | p95 | max | báo động |
|---|---|---|---|---|---|---|---|
| B1 — lượt 1 | 76 | 0 | 16.568 | 18.364 | 18.538 | 18.538 | 48/76 = 63 % |
| B2 — lượt 2 | 57 | 0 | 16.700 | 17.290 | 18.538 | 18.538 | 30/57 = 53 % |
| **BỘ B TỔNG** | **133** | 0 | **16.700** | **17.842** | **18.538** | **18.538** | **78/133 = 59 %** |
| B3 — chỉ các nhịp SAU khi nền bị nhiễm | 90 | 16.568 | 16.700 | 18.538 | 18.538 | 18.538 | 78/90 = 87 % — và **78/78 = 100 % kể từ lượt `commit` đầu** |

Đây **không phải** "lệch tồn dư". Đây là hệ quả của một lỗi mới. Xem §5.

---

## 5. ★★ PHÁT HIỆN CHẶN — `captureVramBaseline()` nuốt model đang nạp vào NỀN, VĨNH VIỄN

### 5.0 Phạm vi: lỗi thuộc về CÔNG THỨC, không thuộc riêng một nhánh gọi

Lỗi nằm ở **`captureVramBaseline()` nói chung**, tại `vramReconciler.ts:193-208`:

```ts
const committedBytes = snap.leases.reduce((sum, l) => sum + (l.actualBytes ?? 0), 0);  // :193
…
baselineUsedBytes = raw - committedBytes;   // :207
baselineCaptured  = true;                   // :208  ← ĐÓNG BĂNG VĨNH VIỄN
```

Giấy phép đang `pending` đóng góp **0** vào `committedBytes`, **trong khi byte của nó ĐÃ nằm trong
`raw`**. Hàm này có **HAI đường gọi, và CẢ HAI đều dính**:

| | Đường gọi | Trạng thái |
|---|---|---|
| **(a)** | `startVramReconciler():660` → `captureVramBaseline()` — **lượt chụp ĐẦU lúc boot** | **CÒN MỞ.** Điều kiện kích hoạt có thật — chứng minh bằng mã ở §5.2. Chưa dựng lại được LIVE trong phiên này. |
| **(b)** | `reconcileOnce():513` và `:439` → `captureVramBaseline(prior)` — **nhánh RESAMPLE** (Task 1) | **CÒN MỞ. ĐÃ ĐO, tái hiện 2/2 lượt** — §5.3-§5.6. |

⇒ ⚠ **Bản vá chỉ chạm nhánh (b) sẽ để nguyên (a) — cùng hậu quả, cùng độ lớn, cùng "không tự
lành".** Bản đầu của báo cáo này đề xuất *"dùng `raw − Σ leaseBytes()` cho RIÊNG nhánh resample"*;
đề xuất đó **SAI PHẠM VI** và đã bị thay ở §8/T5-1.

### 5.1 Đường (b) — nhánh RESAMPLE (đã đo)

1. `startVramReconciler()` chụp nền lúc boot. Handle native chưa gắn ⇒ **thước = `smi`**, nền
   đúng (đo được 968 / 978 MiB).
2. `loadGgufModel()` gọi `getLlama()`; `getLlama()` gọi `setLlamaInstanceHandle()`
   ⇒ **từ nhịp sau, `probeOnce()` đổi sang `getVramState()` native**.
3. `llama.loadModel()` bắt đầu đẩy **~17 GB lên GPU**. Giấy phép 30B đã `reserve()` nhưng
   **chưa `commitMeasured()`** ⇒ `actualBytes = null`.
4. Nhịp `reconcileOnce()` **đầu tiên sau khi handle gắn** thấy `device.source !== baselineSource`
   ⇒ vào **nhánh RESAMPLE** (`vramReconciler.ts:493-528`) ⇒ gọi `captureVramBaseline()`.
5. `captureVramBaseline()` tính `nền = raw − committedBytes`, trong đó
   `committedBytes = Σ (actualBytes ?? 0)` (`:193`) ⇒ **giấy phép 30B đang pending đóng góp 0**.
6. ⇒ **`nền = 18.313 − 422 = 17.891 MiB`**, `baselineCaptured = true` **vĩnh viễn**.

### 5.2 Tiền đề SAI — và nó SAI cho CẢ HAI đường, kể cả lượt chụp đầu

Docstring `:90-93` viết:

> *"Giấy phép CHƯA commit nghĩa là 'đã xin nhưng chưa cấp phát xong' ⇒ nó **CHƯA nằm trong
> `deviceUsed`** ⇒ trừ nó đi là trừ một thứ CHƯA TỒN TẠI."*

**Đo được rằng câu đó SAI trong cửa sổ nạp.** Chuỗi mẫu của lượt B2, cột `smiMiB`, khi giấy phép
30B vẫn `pending`:

```
t=18,1 s  smi=1.416 MiB   ledger=17.293  pending=16.871   ← mới bắt đầu đẩy
t=21,1 s  smi=18.115 MiB  ledger=17.293  pending=16.871   ← ~17 GB ĐÃ nằm trên thiết bị
t=23,1 s  ĐỔI THƯỚC smi → native  ⇒  RESAMPLE  ⇒  nền = 17.891 MiB
```

`llama.loadModel()` đẩy trọng số lên GPU **dần dần**; *"chưa commit"* chỉ nói **sổ sách chưa theo
kịp**, **không** nói thiết bị còn trống. Lá chắn `if (raw < committedBytes)` (`:199`) **không bắt
được** ca này vì nó canh **chiều ngược lại**.

#### ⚠ RÚT LẠI hai tuyên bố của docstring — cho CẢ HAI đường

Bản đầu của báo cáo này viết *"tiền đề đúng cho lượt chụp đầu lúc boot (khi thật sự chưa nạp
gì)"* mà **không nói điều kiện trong ngoặc có thể không thoả**. **Nó có thể không thoả.** Hai
tuyên bố sau, cả hai đều nằm trong docstring `captureVramBaseline()` và cả hai đều được viết ra
để phòng **đúng cửa này**, nay **bị số liệu bác bỏ**:

| Dòng | Nguyên văn | Phán quyết |
|---|---|---|
| `:76-79` | *"**ĐỪNG SỬA BẰNG CÁCH ĐUA VỚI ĐỒNG HỒ.** … Task 5 đã nối `loadGgufModel` vào `reserve()`, nên MỌI thứ do CHÍNH TA cấp phát đều đã nằm trong SỔ tại thời điểm chụp — trừ phần đó ra là xong, **ĐÚNG với mọi thứ tự boot**."* | **SAI.** "Nằm trong SỔ" ≠ "bị trừ": mã trừ `Σ actualBytes`, **không** trừ sổ. Lease `pending` nằm trong sổ nhưng **bị trừ 0**. Câu này chỉ đúng nếu công thức là `raw − ledgerTotal` — mà review vòng 3 đã **cố ý đổi khác đi**, vì lý do chính đáng. |
| `:92-93` | *"Chỉ trừ phần đã commit thì **cửa sổ đua biến mất về mặt CẤU TRÚC, không phải nhờ may**."* | **SAI.** Cửa sổ đua **không biến mất** — nó **đổi dấu**. Trước: chụp trúng cửa sổ ⇒ nền bị **kẹp về 0** (thiếu nền). Sau: chụp trúng cửa sổ ⇒ nền **nuốt trọn model** (thừa nền ~17 GiB). **Vẫn là may rủi, chỉ khác hướng hỏng — và hướng mới TỆ HƠN**, vì hướng cũ cho lệch **+941 MiB** còn hướng mới cho lệch **−16.700 MiB**. |

⇒ **Rút lại cho cả (a) lẫn (b).** Không có "diệt bằng cấu trúc" ở đây; có một cuộc đua chưa
được giải.

#### Điều kiện kích hoạt của đường (a) — truy bằng mã, có thật

1. `registerAiLocalKnowledgeRoutes(app)` được gọi **ĐỒNG BỘ** ở `index.ts:4931`; ngay dòng đầu
   thân hàm (`aiLocalKnowledgeApi.ts:268`) nó gọi `warmUpOllamaModels()`.
2. `warmUpOllamaModels()` (`aiLocalKnowledgeService.ts:2392`) đặt **`setTimeout(2000)`** → warm
   model SÂU trước (30B, ~17 GB).
3. `startBackgroundSchedulers()` mãi `index.ts:5229` — **~298 dòng sau**, và trong khoảng đó có
   `initializeLicenseSystem()`, `initializeRuntimeSecurity()` (băm file), `initializeSocket()`,
   `startStreamProcessor()`, `await import("../api/v1/router")` — **nhiều `await` thật**.
4. `startVramReconciler()` (`backgroundJobs.ts:141`) gọi `captureVramBaseline()` **NGAY LẬP TỨC**
   (`:660`, không `await`).
5. `warmUpOllamaModels` **KHÔNG có cổng `GGUF_WARM_DEEP_MODEL_ON_BOOT`** (cổng đó chỉ gác
   `initDeepModelWarmup`); nó chỉ gác `USE_LEGACY_OLLAMA`, mà `.env:166` = **`false`**
   ⇒ **warm CHẠY**.

⇒ **Nếu đoạn boot `:4931 → :5229` mất hơn 2 giây**, warm đã bắt đầu khi reconciler chụp nền
**lần đầu**. Khi đó:
- handle native **đã gắn** ⇒ lượt chụp đầu đọc bằng thước `native` ⇒ **thước không bao giờ đổi**
  ⇒ **KHÔNG có resample nào cả**;
- nhưng `raw − Σ actualBytes` **vẫn** cho nền ≈ **17.891 MiB**.

**Hậu quả y hệt đường (b), và không có một dòng `baseline` "resample" nào để truy ngược** — sự
kiện `baseline` của lượt chụp đầu **không có** `priorBaselineUsedBytes`/`driftIfNotResampled`
(theo đúng thiết kế: lượt đầu không bịa field). ⇒ **Đường (a) còn KHÓ CHẨN ĐOÁN HƠN đường (b).**

⚠ **Chưa dựng lại được LIVE trong phiên này** (phải làm chậm boot có kiểm soát, tức phải sửa mã
hoặc chèn công cụ vào đường boot — ngoài phạm vi "chỉ đo"). Đây là **kết luận từ mã**, và nó phải
được **kiểm chứng LIVE** trong task vá — xem T5-1.

### 5.3 Bằng chứng pháp y trong sổ — chính field mà Task 1 vòng 1 (EXP-2) thêm vào

```sql
SELECT id, jsonb_pretty(detail::jsonb) FROM vram_events WHERE event='baseline' ORDER BY id;
```

`id = 83` (`createdAt 2026-08-03 03:54:38`):

```json
{
  "source": "native",
  "newSource": "native",
  "priorSource": "smi",
  "committedBytes":        442499072,     //    422 MiB  ← CHỈ cuda-backend
  "ledgerTotalBytes":    18132996512,     // 17.292 MiB  ← 30B đang pending
  "deviceUsedRawBytes":  19202113536,     // 18.312 MiB
  "baselineUsedBytes":   18759614464,     // 17.891 MiB  ← NỀN MỚI, ĐÃ NHIỄM
  "priorBaselineUsedBytes": 1025507328,   //    978 MiB  ← nền ĐÚNG, vừa bị huỷ
  "driftIfNotResampled":     43609696     //   41,6 MiB  ← nếu KHÔNG resample
}
```

**Đọc thẳng ra kết luận: nhánh sinh ra để bỏ một sai số đo ~170-213 MiB đã đổi một lệch 41,6 MiB
lấy một lệch −16.700 MiB đứng vĩnh viễn.**

### 5.4 Hệ quả đo được

| | trước resample | sau resample |
|---|---|---|
| nền | 978 MiB (đúng) | **17.891 MiB** (sai ~17 GiB) |
| drift lúc 30B thường trú | (sẽ là) **+41,6 MiB** | **−16.700 MiB** |
| báo động | 0 | **100 % mọi nhịp** |
| tự lành sau bao lâu | — | **KHÔNG BAO GIỜ** — `baselineCaptured = true` và `captureVramBaseline()` return sớm ở `:172`; chỉ **khởi động lại tiến trình** mới gỡ được |
| tái hiện | **2/2 lượt** | |

Câu cảnh báo in ra còn **chẩn đoán sai hướng** cho người trực (nó đúng theo logic, nhưng nguyên
nhân thật không nằm trong danh sách):

```
[vram] LỆCH -16700 MiB — sổ 18960, thiết bị 2268 (đã trừ nền 17891 MiB).
Sổ đang giữ NHIỀU HƠN thực tế — giấy phép treo, đo hỏng, hoặc số commit sai,
KHÔNG PHẢI cấp phát chui. Ứng viên số một (chưa commit): (không có).
```

Sổ **không** treo, **không** đo hỏng, **không** commit sai. **NỀN sai.** Người trực sẽ đi mổ đúng
ba thứ đang lành lặn.

### 5.5 Xác suất trong sản xuất — đường (b) phụ thuộc NHỊP, đường (a) thì KHÔNG

Cửa sổ rủi ro = `[byte model bắt đầu lên thiết bị → commit]`. Đo hôm nay cho 30B (cache file
nóng): **~10,5 s**; Pha 1 §3.5 đo **11 – 43 s** (cache lạnh).

- **Đường (b)** nổ **một lần duy nhất mỗi tiến trình** — ở nhịp đối chiếu **đầu tiên sau khi
  handle gắn** ⇒ xác suất **tỉ lệ nghịch với nhịp**.
- **Đường (a)** nổ ở **lượt chụp ĐẦU** ⇒ **hoàn toàn không phụ thuộc nhịp**; hạ nhịp không làm
  nó tệ hơn, mà **nâng nhịp cũng không cứu được nó**.

| Kịch bản | Xác suất nhiễm nền |
|---|---|
| **★ Đường (a) — boot `:4931 → :5229` mất > 2 giây** (warm `setTimeout(2000)` thắng cuộc đua tới `startVramReconciler()`) | **KHÔNG phụ thuộc nhịp.** Xảy ra ở **lượt chụp ĐẦU**, và **không** sinh sự kiện resample nào để truy ngược. Chưa đo được xác suất — phụ thuộc thời gian boot của từng máy/từng lần. |
| **All-in-one boot chuẩn, nhịp 60 s** — `startVramReconciler()` ở `backgroundJobs.ts:141` chạy **ngay trước** `initDeepModelWarmup()` (`:155`, `setTimeout 3000`) ⇒ handle gắn ~T0+3 s, commit ~T0+14…46 s, nhịp đầu ở **T0+60 s** | **thấp** cho đường (b) — nhịp đầu rơi **sau** commit. **Đây là lý do Pha 1 quan sát được +738,6 chứ không phải −16,7 GiB.** ⚠ **Không** che được đường (a). |
| **Handle gắn ở thời điểm BẤT KỲ khác boot-warm** (warm hỏng rồi nạp lại · `GGUF_WARM_DEEP_MODEL_ON_BOOT=false` — cổng có thật ở `aiGgufEngine.ts:1484` · model thứ hai nạp trong một tiến trình chưa từng gắn handle) ⇒ nhịp đầu sau khi gắn phân bố đều trong `[0, 60 s)` | **L/60 = 17 % – 72 % mỗi lần** |
| **Hạ nhịp xuống 10 s** (khuyến nghị Pha 1 §4.1) ⇒ nhịp rơi vào cửa sổ 10-43 s gần như chắc chắn, **kể cả ở boot chuẩn** | **≈ 100 %** |
| Nhịp 1 s (lượt đo hôm nay) | **2/2** |

⇒ **Khuyến nghị "hạ nhịp xuống 10 s" của Pha 1 §4.1 phải bị RÚT LẠI cho tới khi khoản này được
xử lý.** Áp dụng nó hôm nay sẽ biến một rủi ro theo xác suất thành một **hỏng gần như chắc chắn ở
mọi lượt boot**.

### 5.6 Đây đúng là mẫu lỗi mà Task 1 đã tự ghi ra — lần thứ ba

Sổ tiến độ Task 1 ghi: *"mỗi bản vá đẻ ra lỗi CÙNG LỚP ở hệ quả của chính nó"* (hai thước → chuông
câm → ngắt mạch kẹt), và đặt luật *"mỗi nhánh phòng vệ mới phải hỏi NGAY: nếu chính nhánh này kích
hoạt SAI thì bao lâu nó tự lành?"*. Với nhánh resample, câu trả lời là **KHÔNG BAO GIỜ**.
Task 1 vòng 1 (EXP-2) **đã nhìn thấy đúng cái cửa này** và ghi *"kẻ chui grab đúng lúc đổi thước
bị nuốt vào nền vĩnh viễn"* — nhưng đánh giá khả năng xảy ra là **thấp**, vì mô hình hoá nó như
một **trùng hợp hiếm** với một **kẻ lạ**. Đo được hôm nay: **thứ bị nuốt không phải kẻ lạ, mà là
CHÍNH MODEL CỦA TA**, và **chính lượt nạp đó là thứ GÂY RA đổi thước** — hai sự kiện **không độc
lập**, chúng là **cùng một chuỗi gọi**: `loadGgufModel → getLlama → setLlamaInstanceHandle` (đổi
thước) rồi `llama.loadModel` (đẩy 17 GB). Ước lượng "khả năng thấp" vì thế **sai về bản chất**,
không chỉ sai về độ lớn. Forensic mà chính vòng review đó bắt thêm vào (`driftIfNotResampled`) là
thứ **chứng minh** được điều này — lưới đó **đã trả công**.

⚠ **Và bản thân báo cáo này đã suýt lặp lại đúng mẫu lỗi đó ở một tầng nữa**: vòng đầu quy lỗi
vào **riêng nhánh resample** — tức mô tả đúng cái mình vừa ĐO được và bỏ qua đường mình chưa đo —
rồi đề xuất một bản vá **chỉ khớp với đường đã đo**. Review vòng 1 bắt được (§5.0, §5.2). **Bài
học giữ nguyên hình dạng: đo một đường rồi phát biểu cho cả hàm.**

⚠ **Task 5 KHÔNG sửa** (chỉ đo). Khoản này phải vào backlog Pha 1.5/Pha 2 với ưu tiên cao nhất.

---

## 6. Step 4 — chốt ngưỡng và nhịp

### 6.1 `VRAM_DRIFT_THRESHOLD_MB` — **GIỮ 512 MiB**

**Sàn KHÔNG còn trên 512.** Trả lời thẳng câu hỏi của brief.

| | Pha 1 | Nay |
|---|---|---|
| Lệch ổn định lớn nhất đo được | **882,4 MiB** | **210 MiB** |
| 512 nằm ở đâu so với sàn | **DƯỚI sàn** ⇒ ngưỡng vô dụng | **TRÊN sàn, dự phòng 2,4×** |

Lý do giữ **512** thay vì siết xuống 384 (cũng nằm trong khuyến nghị Pha 1 §3.6.5):

1. Khoản dương duy nhất còn lại là **buffer tính LƯỜI của llama.cpp**, và **cận trên của nó chưa
   được đo**. Hôm nay đo **+134…+140** cho một lượt sinh **16 token**; Pha 1 suy ra **+202,6** cho
   một lượt worker dài. Với `GGUF_MAX_CTX=32768` một phiên dài có thể còn cao hơn. **Siết ngưỡng
   dựa trên một lượt sinh 16 token là lặp lại đúng lỗi "đo một chiều rồi phát biểu hai chiều"** đã
   xảy ra bốn lần trong chương trình này.
2. Hộ nhỏ nhất từng gây sự cố trong lịch sử dự án là **ONNX DML ~183-339 MiB** và **cron
   +1.251 MiB**; sidecar thị giác **7.800 MiB**. Ngưỡng 512 vẫn bắt được cả ba. Siết xuống 384 chỉ
   thêm được các kẻ chui trong dải **384-512 MiB** — **chưa có hộ nào đã biết nằm trong dải đó**.
3. Đổi ngưỡng là **đổi biến môi trường**, không phải sửa mã (`vramReconciler.ts:5` đọc
   `VRAM_DRIFT_THRESHOLD_MB ?? 512`). Giữ nguyên = **không cần làm gì**, và không có "thay đổi
   thầm lặng trong `.env` không ai review được".

⚠ **Điều kiện kèm theo, không thương lượng:** con số 512 chỉ có nghĩa khi **nền đúng**. Với nền bị
nhiễm (§5) thì mọi ngưỡng từ 384 tới 16.000 đều cho ra **100 % báo động**. **Xử lý §5 trước, rồi
mới nói tới ngưỡng.**

### 6.2 `VRAM_RECONCILE_INTERVAL_MS` — **GIỮ 60.000 ms**, và RÚT LẠI khuyến nghị 10 s của Pha 1

- **Chi phí KHÔNG phải ràng buộc** (Pha 1 §4: đầu dò p50 **62,9 ms** đường `nvidia-smi`, **0,00 ms**
  đường native; một nhịp `reconcileOnce()` trọn vẹn p50 **0,02 ms**). Đề xuất dưới đây thuần tuý
  theo **nhu cầu phát hiện**, đúng chỉ đạo của brief.
- **Nhu cầu phát hiện** nói: nhanh hơn thì tốt hơn. 60 s nghĩa là một kẻ chui có thể sống tới 60 s
  mà không ai biết; sidecar thị giác tự ngủ sau **10 phút** nên 60 s vẫn bắt được nó trong ≤ 1/10
  đời của nó. **Không có hộ đã biết nào sống ngắn hơn 60 s** ngoài cổng eval (39 s — nhưng hộ đó
  **có giấy phép**, không cần đối chiếu để phát hiện).
- **Ràng buộc thật hôm nay là §5**: nhịp càng nhanh, xác suất nhánh resample rơi trúng cửa sổ nạp
  càng cao, và hệ quả là **mù vĩnh viễn**, không phải một báo động giả tự lành. Ở 10 s xác suất
  ≈ **100 %**.
- ⇒ **Giữ 60 s.** Sau khi §5 được vá (và **chỉ** khi ấy), hạ xuống **10 s** là hợp lý — thu hẹp
  cửa sổ "kẻ chui chưa ai thấy" **6 lần** với chi phí đo được ≈ 0.

### 6.3 Hai khoản còn lại — và mỗi khoản là lỗi ĐO hay lỗi HỆ

| Khoản còn lại | MiB | **Lỗi đo hay lỗi hệ?** |
|---|---|---|
| Buffer tính LƯỜI của llama.cpp | **+134 … +140** (có thể tới ~200 ở phiên dài) | **LỖI HỆ, hợp pháp.** llama.cpp cấp phát ở lượt suy luận **đầu**, tức **sau** `commitMeasured()` — chính `aiGgufEngine.ts:798-801` đã cảnh báo. Sổ không thể biết trước. Chữa được bằng **đo lại sau lượt suy luận đầu** (Pha 2), không phải bằng ngưỡng. |
| Buffer lười của `embed-context` | **+70** | Cùng bản chất. Ghi chú thêm: giấy phép `gguf-embed-ctx` khai `estimateSource: "unknown"`, **ước lượng 0 byte** — đúng như Pha 1 §5.4 đã nêu, vẫn chưa gỡ. |
| Sai số ước lượng hộ `external-process` không bao giờ commit | **−219 … −228** (cổng eval) | **LỖI ĐO còn lại**, nhưng **đã có số để sửa**: hạ `VRAM_KB_EVAL_ESTIMATE_MB` 1251 → ~1100. Với `sidecar:local-trainer` (6.144 MiB) thì **chưa đo được** (§3) ⇒ **sai số vẫn là ẩn số**. |
| **Băng dung sai âm bị nới suốt cả job** | tới **−(512 + 1.251)** khi cron chạy, **−(512 + 6.144)** khi trainer chạy | **LỖI THIẾT KẾ đã lộ ra ở lượt đo này.** `pendingBytes` được thiết kế cho cửa sổ *"vài giây rồi tự lành"*; hộ `external-process` **cố ý không bao giờ commit** ⇒ nới **suốt vòng đời job**. Trong khoảng đó, một giấy phép treo thật cỡ vài GiB **sẽ bị che**. Không phải hồi quy do Task 3 (mã đúng như viết) nhưng **giả định trong docstring không đúng cho lớp hộ này** — phải ghi lại. |
| Khoảng cách hai thước | **+213 (p50), +221 (max)** | **LỖI ĐO — đã trung hoà** bởi Task 1 khi nền và phép so cùng thước. Đóng góp vào drift = **0**. Nhưng **gap đã RỘNG HƠN Pha 1** (165-178 → 213-221) ⇒ **cái giá của một lần nhiễm nền cũng lớn hơn**. |

---

## 7. Step 5 — 24 giờ: **CHƯA CHẠY**

> ⚠ **KHÔNG công bố điều kiện chặn số 4 và số 6 là ĐẠT.** Phiên này kéo dài ~1,5 giờ; không có
> lượt cron 03:00 nào chạy dưới quan sát. Mục 2 (§2) đã nghiệm thu cổng eval bằng cách **ép chạy**,
> nhưng **ép chạy ≠ lượt cron thật lúc 03:00 sau 24 giờ vận hành**.

### 7.1 Thủ tục chính xác

**Bước 0 — mốc thời gian và trạng thái sạch.**
```bash
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader   # kỳ vọng ~1.000 MiB
netstat -ano | grep -E ":3000|:8081"                                     # kỳ vọng: TRỐNG
docker exec avi-aoi-management-postgres-1 psql -U aoi -d aoi_management -c \
  "SELECT max(id), now() FROM vram_events;"                              # ghi lại  <ID0>  và  <T0>
```
⚠ **TOÀN BỘ `vram_events` id 48 – 121 (2026-08-03 03:07 → 04:01) là dữ liệu CHẨN ĐOÁN/DEV của
ngày hôm nay, KHÔNG phải một lượt sản xuất liên tục** (không có một dòng `cron:kb-sync` nào trong
dải đó). Phân rã chính xác:

| Dải id | n | Nguồn |
|---|---|---|
| ≤ 47 | — | 2026-08-02 trở về trước (Pha 1 + Task 4) |
| **48 – 69** | **22** | các lượt chẩn đoán **TRƯỚC Task 5** cùng ngày (03:07 · 03:25 · 03:27 · baseline 03:28) |
| **70 – 121** | **52** | **tiến trình chẩn đoán của Task 5** (03:52 → 04:01) — trong đó **30 dòng `drift`** đến từ lượt tái hiện §5, và 6 dòng là 3 cặp `reserve`/`release` của §2.2 |

**Phải lọc bằng `id > <ID0>` hoặc `"createdAt" >= <T0>`** — cơ chế lọc đúng bất kể phân rã trên,
nhưng đừng đọc bất kỳ thống kê nào trên dải 48-121 như thể nó là sản xuất.

**Bước 1 — chạy all-in-one, để yên ≥ 24 giờ, có ít nhất một mốc 03:00.**
```bash
cd D:\SOURCES\avi-aoi-management
npm run dev 2>&1 | tee vram-24h.log        # ⚠ PHẢI GIỮ stdout — xem lý do ngay dưới
```
Yêu cầu cấu hình (`.env`, đã đúng ở máy này):
`KB_AUTOSYNC_ENABLED=true` · `KB_AUTOSYNC_EVAL_GATE=true` · `KB_AUTOSYNC_CRON="0 3 * * *"`
· **KHÔNG** đặt `VRAM_DRIFT_THRESHOLD_MB`/`VRAM_RECONCILE_INTERVAL_MS` (để mặc định 512 / 60 s).

⚠ **BẮT BUỘC giữ stdout.** Một lượt **resample** chỉ để lại **một dòng `console.warn`**:

```
[vram] ĐỔI THƯỚC smi → native — huỷ nền cũ và chụp lại, không so hai thước với nhau.
[vram] nền thiết bị: … MiB (thiết bị … − đã commit …, thước "native") …
```

**Không có sự kiện riêng nào cho nó trong DB** — chỉ có một dòng `baseline` thứ hai, mà muốn phân
biệt với lượt chụp đầu thì phải đọc `detail->>'priorSource'`. Mất stdout là mất tín hiệu
thời-gian-thực duy nhất. Nhớ `grep -n "ĐỔI THƯỚC\|nền thiết bị\|LỆCH" vram-24h.log` khi kết.

**Bước 2 — sau ≥ 24 giờ, ba truy vấn.**

```sql
-- (a) Vòng đời cron 03:00 — điều kiện chặn số 6
SELECT id, event, owner, "estimatedBytes"/1048576 AS est_mib, "estimateSource",
       detail->>'releaseProof' AS proof, "createdAt"
FROM vram_events WHERE owner LIKE 'cron:%' AND id > <ID0> ORDER BY id;

-- (b) Phân bố drift THẬT — điều kiện chặn số 4
SELECT count(*) AS n,
       min("driftBytes")/1048576  AS min_mib,
       max("driftBytes")/1048576  AS max_mib,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY abs("driftBytes"))/1048576 AS p50_mib,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY abs("driftBytes"))/1048576 AS p95_mib
FROM vram_events WHERE event='drift' AND id > <ID0>;

-- (c) ★ NỀN CÓ BỊ NHIỄM KHÔNG — kiểm §5, BẮT BUỘC
SELECT id, detail->>'source' AS src, detail->>'priorSource' AS prior_src,
       (detail->>'baselineUsedBytes')::bigint/1048576      AS base_mib,
       (detail->>'priorBaselineUsedBytes')::bigint/1048576 AS prior_base_mib,
       (detail->>'driftIfNotResampled')::bigint/1048576    AS drift_if_not_mib,
       "createdAt"
FROM vram_events WHERE event='baseline' AND id > <ID0> ORDER BY id;
```

**Bước 3 — đo lại trạng thái máy lúc KẾT (đối xứng với Bước 0, đừng bỏ).**
```bash
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # app CÒN chạy — ghi lại
netstat -ano | grep -E ":3000|:8081"                       # xác nhận app vẫn là tiến trình đó
# … rồi TẮT app …
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # phải về ~1.000 MiB
grep -n "ĐỔI THƯỚC\|nền thiết bị\|LỆCH\|THƯỚC ĐO KHÔNG ỔN ĐỊNH" vram-24h.log
```

**Bước 4 — tiêu chí ĐẠT.**
1. **(a)** đúng **1 `reserve` + 1 `release`** cho `cron:kb-sync` **và** cho `cron:kb-eval-gate`
   trên mỗi lượt cron; mọi `release` có `releaseProof`; **không cặp lệch**.
2. **(c) ★ ĐIỀU KIỆN MỚI, do §5**: **không** dòng `baseline` nào có `base_mib` > **2.048** (nền
   hợp lệ ~1.000 MiB) — **áp cho CẢ dòng `baseline` ĐẦU TIÊN**, vì đường (a) nhiễm nền **ngay ở
   lượt chụp đầu** và **không** để lại `priorSource`/`driftIfNotResampled`. Một dòng vượt ngưỡng
   đó = **§5 đã nổ ⇒ FAIL, và mọi số ở (b) sau thời điểm đó là RÁC**.
3. **(b)** số dòng `drift` **nhỏ**, và mỗi dòng giải thích được bằng `detail.leases`.
4. `vram-24h.log` **không** chứa dòng `ĐỔI THƯỚC` nào đi kèm một `nền thiết bị: …` > 2.048 MiB.
5. `nvidia-smi` cuối kỳ trở về nền (~1.000 MiB) sau khi tắt app; không giấy phép treo.

### 7.2 ⚠ Điều mà 24 giờ **KHÔNG** trả lời được

**Phân bố `|lệch|` vẫn không đọc được từ sổ** (§4.1): `drift` chỉ ghi khi **đã vượt ngưỡng**.
Truy vấn (b) trả lời *"có bao nhiêu báo động và chúng lớn cỡ nào"*, **không** trả lời *"phân bố
lệch là gì"*. Nếu 24 giờ chạy sạch, (b) sẽ trả **0 dòng** — và đó là **kết quả TỐT**, không phải
kết quả thiếu. Muốn có phân bố thì vẫn phải đo NGOÀI sổ như §4. **Khiếm khuyết cấu trúc này chưa
được gỡ ở Pha 1.5.**

### 7.3 Thủ tục để biến hai trainer thành SỐ ĐO (việc còn nợ của §3)

1. Tạo môi trường Python dùng được (venv hiện tại **hỏng**):
   `py -m venv .venv-t2 && .venv-t2\Scripts\activate`
2. **Vision trainer**: `pip install torch --index-url https://download.pytorch.org/whl/cu128`
   (bánh xe CUDA khớp RTX 5090), rồi `pip install -r tools/trainer/requirements.txt`, rồi
   `pip install ultralytics` nếu muốn đo **nhánh segmentation** — **đó mới là nhánh sinh ra con
   số 6.144 MiB**; nhánh classification cho một con số **khác hẳn** và **không được phép dán nhãn
   6.144**. Cần thêm: bộ ảnh thật + trọng số pretrained pre-cache dưới `TORCH_HOME`.
3. **LoRA**: `pip install -r tools/trainer/requirements-lora.txt`; QLoRA 4/8-bit **phải chạy dưới
   WSL2** (bitsandbytes). Cần **một checkpoint HuggingFace dạng thư mục** đặt sẵn trên đĩa
   (`config.json` + `*.safetensors`) — máy này **không có cái nào**; `.gguf` **không dùng được**.
4. Chạy bằng đường **thật** (`dispatchTier2` / `startLoraFinetune`) để đồng thời nghiệm thu vòng
   đời giấy phép, hoặc tối thiểu spawn đúng khuôn `cmd + args + jobDir`, `shell:false`.
5. Đo `nvidia-smi` trước / đỉnh (lấy mẫu ≤ 500 ms) / sau, **≥ 2 lượt mỗi cái**, rồi đặt
   `VRAM_TRAINER_ESTIMATE_MB` / `VRAM_FINETUNE_ESTIMATE_MB` theo **số đo**.

---

## 8. Việc để lại — không sửa ở task này

| # | Mục | Mức |
|---|---|---|
| **T5-1** | **§5 — `captureVramBaseline()` nuốt model đang nạp vào nền, không tự lành.** ⚠ **Phạm vi là CẢ HÀM, không phải riêng nhánh resample**: đường (a) *lượt chụp đầu đua với `warmUpOllamaModels`* và đường (b) *resample* đều dính, và (a) **không** sinh dấu vết resample nào để truy ngược. **Bản vá chỉ chạm (b) là KHÔNG ĐẠT.** Chi tiết dưới bảng. | **CHẶN** |
| **T5-2** | Rút lại khuyến nghị nhịp 10 s của Pha 1 §4.1 khỏi mọi tài liệu kế tiếp cho tới khi T5-1 xong. | **Cao** |
| **T5-3** | `pendingBytes` nới băng âm **suốt vòng đời job** cho hộ `external-process` không bao giờ commit (1.251 MiB cron, 6.144 MiB trainer). Sửa docstring Task 3 hoặc tách hai lớp hộ. | Cao |
| **T5-4** | `sidecar:local-trainer` và `sidecar:llm-finetune` **chưa từng nghiệm thu LIVE**; không có hook `__run…ForTests()` như `kbSyncScheduler`. | Cao |
| **T5-5** | `.env:259` bật `LOCAL_TRAINER_CMD` trong khi máy **không chạy nổi** ⇒ Tier-2 "bật mà chết". | Trung bình |
| **T5-6** | `vram_events."createdAt"` = `defaultNow()` ⇒ **thời điểm XẢ (flush), không phải thời điểm sự kiện**. Cả lô 5 giây dùng chung một dấu thời gian (quan sát: 5 dòng cùng `03:54:48.410614`). **Chỉ `id` giữ được thứ tự.** Ai dựng lại dòng thời gian từ `createdAt` sẽ sai tới `VRAM_LOG_FLUSH_MS` = 5 s. | Trung bình |
| **T5-7** | Sổ **vẫn** không sinh nổi phân bố `|lệch|` (§4.1, §7.2) — nguyên vẹn từ Pha 1 §3.1. | Trung bình |
| **T5-8** | `VRAM_KB_EVAL_ESTIMATE_MB` 1251 → ~1100 theo 3 lượt đo (1.022/1.036/1.033). Chưa áp dụng. | Thấp |
| **T5-9** | `gguf-embed-ctx` vẫn `estimateSource: "unknown"`, ước lượng **0 byte** (Pha 1 §5.4, chưa gỡ). | Thấp |
| **T5-10** | `.venv` của repo **hỏng** (trỏ Python 3.13 Store đã gỡ, tạo ở máy khác). | Thấp |

### 8.1 T5-1 — ghi chú cho người vá (KHÔNG phải chỉ đạo; Task 5 chỉ đo)

**Yêu cầu tối thiểu của một bản vá ĐẠT:**
1. Đóng **cả (a) lẫn (b)** — nghiệm thu phải chứng minh **cả hai**, không chỉ đường đã có số.
2. Rút lại **hai** câu docstring ở §5.2 (`vramReconciler.ts:76-79` và `:92-93`); để nguyên một
   tuyên bố mà chính bản vá bác bỏ là **mìn cho người sau** — đúng bài học đã ghi ở
   `vramProbe.ts:35-36`.
3. **Trả lời trước khi viết mã**: *"nếu chính nhánh này kích hoạt SAI thì bao lâu nó tự lành?"*

**Một hướng đóng được CẢ HAI cửa cùng lúc** (gợi ý, chưa thẩm định): **từ chối chụp nền khi còn
bất kỳ giấy phép nào `pending`** — cùng khuôn với lá chắn `if (raw < committedBytes)` đã có
(`:199`): **không ghim, không kết luận, thử lại ở nhịp sau**. Nó nằm **bên trong** hàm nên phủ
**cả hai** đường gọi theo cấu trúc, không phải nhờ chặn ở từng chỗ gọi.

⚠ **Nhưng phải trả lời được câu hỏi của chính nó:** *nếu LUÔN có lease `pending` thì nền **không
bao giờ** chụp được.* Khi đó `baselineRequired && baselineUsedBytes === null` (`:541-552`) khiến
`reconcileOnce()` **IM LẶNG vĩnh viễn** — đổi *"chuông kêu oan mãi mãi"* lấy *"chuông câm mãi
mãi"*, tức **đúng lớp lỗi mà EXP-1 đã phải dựng bộ ngắt mạch để diệt**. Ba câu hỏi con bắt buộc:
- Có kịch bản thật nào giữ `pending` vô hạn không? (**CÓ** — §6.3: hộ `external-process` **cố ý
  không bao giờ commit**; `cron:kb-sync` giữ `pending` tới **30 phút**, trainer tới
  `sidecarTimeoutMs()`.) ⇒ **điều kiện "còn pending" quá rộng, gần như chắc chắn cần thu hẹp**
  (ví dụ chỉ tính `pending` của `kind: "gguf-model"`), và **phần thu hẹp đó phải được đo, không
  suy đoán**.
- Sau bao nhiêu lượt hoãn thì phải **kêu** (một sự kiện riêng, khác `drift`, khác
  `source_unstable`) thay vì im?
- Đường (a) có cần thêm gì **ngoài** hàm không — ví dụ lượt chụp đầu nên ghi `pendingBytes` +
  `ledgerTotalBytes` vào `detail` để **đường (a) cũng truy ngược được**, giống cách
  `driftIfNotResampled` đã cứu đường (b)?

**Nghiệm thu LIVE bắt buộc cho đường (a):** làm chậm đoạn boot `index.ts:4931 → :5229` quá 2 giây
(hoặc hạ `GGUF_WARM_DELAY_MS`) rồi kiểm dòng `baseline` đầu tiên có `baselineUsedBytes` > 2 GiB
hay không — **trước** khi vá, để có ca ĐỎ thật; và **sau** khi vá, để chứng minh đã đóng.

---

## 9. Phụ lục

### 9.1 Ba lượt đo — cấu hình

| Bộ | Thứ tự | Model | n |
|---|---|---|---|
| B1 | prod (nền `smi` trước, rồi nạp) | Qwen3-30B-A3B UD-Q4_K_XL | 76 |
| B2 | prod, **có ghi DB** | idem | 57 |
| A | clean (nạp trước, chụp nền sau khi mọi lease đã commit) | idem + Qwen3-Embedding-0.6B | 68 |

⚠ **Ba file CSV thô (`t5-drift-30b.csv`, `t5-drift-prod2.csv`, `t5-drift-clean.csv`) nằm trong
thư mục scratchpad phù du của phiên và KHÔNG được commit** (chúng nằm ngoài repo; commit chúng sẽ
làm cây lệch khỏi 245). ⇒ **Toàn bộ histogram của cả ba lượt được nhúng nguyên vẹn ở §9.2 và
§9.2b để báo cáo này tự tái tạo được mọi con số thống kê mà không cần file gốc.**

Cột: `idx,t_s,phase,source,smiMiB,deviceMiB,baselineMiB,ledgerMiB,pendingMiB,driftMiB,alarm,resampled,unstable`.
Nhịp lấy mẫu **1 s**; mỗi mẫu = một lượt `__runReconcileTick()` (hàm SẢN XUẤT) + một lượt
`nvidia-smi` độc lập để đối chứng.

### 9.2 Bộ A — chuỗi drift, rút gọn theo trạng thái (MiB, giữ dấu)

```
A1 NGHỈ, sổ rỗng, thước smi       :  0×14, -4×6, -8×6, -15×5, +3×1, +14×1     (n=33)
A2 30B thường trú, trước suy luận :  0×20                                     (n=20)
A3 30B + buffer suy luận          : +134×6, +140×15                           (n=21)
A5 nạp embedder (chưa commit)     : +136×1, -1002×1                           (n= 2)
A4 30B + embedder + embed-ctx     : +210×21, -386×4                           (n=25)
                                    ───────────────────────────────────────────────
                                    TỔNG n=101 · alarm 0/101 · max ổn định +210
```

Kiểm chéo tổng theo lượt: **NGHỈ (n=33)** = B1 idx1-17 (17) + B2 idx1-16 (16);
**lượt clean (n=68)** = `-1002×1, -386×4, 0×20, +134×6, +136×1, +140×15, +210×21`. 33 + 68 = 101 ✓.

### 9.2b Mười dòng bị loại + BỘ B — histogram đầy đủ (để tái tạo mọi thống kê §4.4)

```
10 dòng cửa sổ nạp 30B, nền HỢP LỆ (§4.2, bị loại khỏi Bộ A):
    -17.290×5   (B2 idx 17-21, nền 978)      -17.287×5   (B1 idx 18-22, nền 968)
    ⇒ n=10 · p50 17.287 · max 17.290 · alarm 0/10

BỘ B1 (n=76, alarm 48/76):
    -18.538×5  -18.364×3  -17.842×3  -17.287×5  -16.871×5  -16.700×15
    -16.568×22  -4×6  0×10  +14×1                       (1 mẫu resample: drift = null)

BỘ B2 (n=57, alarm 30/57):
    -18.538×4  -17.290×5  -16.871×5  -16.700×26
    -15×5  -8×6  0×4  +3×1                              (1 mẫu resample: drift = null)
```

### 9.3 Bộ B — chuỗi drift lượt B2 (trích, cho thấy đúng thời điểm nhiễm nền)

```
idx  t_s   phase        src    smi    device  baseline  ledger  pending  drift   alarm resample
  1   1,1  A-nghi       smi     981      978       978       0        0       0      0        0
 …    …                                              (nền ĐÚNG 978 MiB)
 16  17,1  B-dang-nap   smi     981      981       978       0        0      +3      0        0
 17  18,1  B-dang-nap   smi   1.407      981       978  17.293   16.871 -17.290      0        0   ← reserve 30B
 20  21,1  B-dang-nap   smi  18.115      981       978  17.293   16.871 -17.290      0        0   ← 17 GB ĐÃ trên thiết bị
 22  23,1  B-dang-nap  native 18.101   18.313   17.891  17.293   16.871       —      0        1   ← ★ RESAMPLE, NỀN NHIỄM
 23  24,1  B-dang-nap  native 18.094   18.313   17.891  17.293   16.871 -16.871      0        0
 28  29,1  C-thuong-tru native 19.936  18.313   17.891  18.960        0 -18.538      1        0   ← commit ⇒ BÁO ĐỘNG
 …                                                                                    (…tới hết…)
 57  58,3  C-thuong-tru native 19.937  20.151   17.891  18.960        0 -16.700      1        0
                                                            ⇒ 30/57 báo động, 100 % kể từ commit
```

### 9.4 Xác nhận KHÔNG đụng mã sản xuất

```bash
git status --porcelain | wc -l      # 245   ← ĐÚNG con số yêu cầu (trước khi thêm file báo cáo)
git status --porcelain | grep __tmp # (rỗng) — ba script đo tạm đã xoá
```

- Ba script tạm (`scripts/__tmp_t5_drift.ts`, `__tmp_t5_evalgate.ts`, `__tmp_t5_trainers.ts`,
  và một file smoke) chỉ **import và gọi** hàm sản xuất; **đã xoá**.
- Không sửa `.env`, không sửa migration, không chạy DDL. Không `git add -A`/`-u`. **Không push.**
- Ghi vào DB: **52 dòng** `vram_events` — **id 70 – 121** (id 69 là dòng `baseline` của một lượt
  chẩn đoán TRƯỚC Task 5, không phải của tôi), trong đó **30 dòng `drift`**. **Đã đánh dấu ở
  §7.1** cùng dải 48-69 để lượt 24 giờ lọc ra.
- Bộ test sau khi dọn: `vitest run server/services/vram server/services/kbSyncScheduler.evalGate.test.ts`
  ⇒ **13 file / 130 test PASS**.

### 9.5 Truy vấn kiểm chứng nhanh

```sql
-- vòng đời cổng eval (§2.2)
SELECT id, event, owner, detail->>'releaseProof' FROM vram_events
WHERE owner='cron:kb-eval-gate' ORDER BY id;

-- bằng chứng pháp y nhiễm nền (§5.3)
SELECT id, jsonb_pretty(detail::jsonb) FROM vram_events
WHERE event='baseline' AND detail ? 'driftIfNotResampled' ORDER BY id;

-- backend CUDA đã vào sổ (Task 2)
SELECT id, event, owner, "actualBytes"/1048576 AS act_mib FROM vram_events
WHERE owner='cuda-backend' ORDER BY id DESC LIMIT 4;   --  commit = 431 MiB
```
