# Pha 1 điều phối VRAM — Báo cáo đo & phán quyết cổng ra (Task 7)

**Ngày:** 2026-08-02 · **Nhánh:** `feat/hmi-dep` · **BASE:** `8d448808`
**Spec:** `docs/superpowers/specs/2026-08-02-vram-broker-design.md`
**Ràng buộc task:** KHÔNG sửa một dòng mã sản xuất nào. Toàn bộ phép đo chạy bằng script tạm (đã xoá) và biến môi trường ép qua CLI. `git status --porcelain` trước và sau = **245 mục**.

> Bản này là **bản chính thức, tự đủ**. Không cần đọc `.superpowers/` (thư mục đó bị gitignore) để hiểu hoặc kiểm chứng bất kỳ con số nào ở đây.

> **⚠ ĐÃ QUA REVIEW VÒNG 1 — HAI KHẲNG ĐỊNH BỊ RÚT LẠI.** Chỗ nào bị rút đều ghi rõ **tại chỗ**, không xoá dấu vết:
> - **I-1** (§7.4) — *"12 lượt đã loại ratchet (Ư0)"*: **SAI phạm vi**. `prior = []` chỉ nói "không có cấp phát **đã vào sổ**"; backend CUDA ~430 MiB đi trước ở **cả 12 lượt** và sổ **mù** với nó ⇒ thí nghiệm **không phân biệt được gì** về Ư0. **Ư0 trở lại §7.5 như ứng viên còn sống, hạng ★★.**
> - **I-2** (§7.5) — *"instance `Llama` thứ hai chỉ tốn ~48 MiB ⇒ backend dùng chung"*: **con số không có nguồn**, mâu thuẫn với §2.1 (mọi tiến trình reranker mới = +430/+431 MiB). **Rút; Ư2 trả về hạng ★.**
>
> Ba phán quyết chính **không đổi và đã được xác minh độc lập**: trần **không tất định** · **512 MiB dưới sàn** · **cổng ra CHƯA ĐẠT**.

---

## 0. Tóm tắt điều hành

| Câu hỏi Pha 1 phải trả lời | Trả lời |
|---|---|
| §15.4 — `aiReranker` bật GPU tốn bao nhiêu? | **~550 MiB thường trú**, trong đó **chỉ 14-23 MiB là của reranker**; ~430 MiB là **backend CUDA** của `getLlama()`. **Trọng số KHÔNG lên GPU** — `gpuLayers: -1` bị node-llama-cpp quy về **0**. |
| §15.1 — ngưỡng lệch thật là bao nhiêu? | **512 MiB nằm DƯỚI sàn cấu trúc.** Lệch ổn định đo được ở 4 cấu hình độc lập: **536 / 664 / 738,6 / 882,4 MiB**. Chuông kêu **vĩnh viễn** từ lượt nạp model đầu tiên. |
| §15.2 — nhịp đối chiếu thật là bao nhiêu? | Chi phí **không phải** ràng buộc: đường native **p50 = 0,0 ms**, đường `nvidia-smi` **p50 = 62,9 / p95 = 69,2 ms**. Ràng buộc thật là **cửa sổ nạp model** (11-43 s) sinh lệch ÂM −16.335 MiB. **Giữ 60 s** cho tới khi cửa sổ đó được xử lý. |
| §15.x — `estimateSource` còn dựa hằng số ở đâu? | `config-default`: **2 chỗ** (`sidecar:vision` 7825 MiB, `cron:kb-sync` 1251 MiB). `unknown`: **2 chỗ** (`gguf-ctx:*`, `gguf-embed-ctx:*`) — đã bắt được LIVE: ước lượng **0 MiB** trong khi thật **526 MiB**. |
| Bán kính khi bật cưỡng chế Pha 2 | **0/15** lượt `reserve` có `wouldRefuse = true`. Nhưng con số vào quyết định sai tới **±588 MiB mỗi hộ** — bán kính thật nằm ở **chất lượng số liệu**, không ở số lượt bị từ chối. |
| **Ư7** — trần `cudaMalloc` có tất định không? | **KHÔNG. Trả lời dứt điểm.** Cùng máy, cùng HEAD, cùng nền, cùng khối 16.698,37 MiB, cùng `prior=[]` **theo nghĩa của SỔ** (§7.3): **3 THÀNH CÔNG / 9 THẤT BẠI trên 12 lượt**. ⚠ Thí nghiệm này **không** nói gì về Ư0 (ratchet) — xem I-1. |
| **Cổng ra Pha 1** | ❌ **CHƯA ĐẠT** như phát biểu trong spec §10. Xem §9. |

---

## 1. Kỷ luật đo

- **KHÔNG dùng `tasklist`** (máy này trả rỗng khi có nhiều `node.exe`). Mỗi lượt kiểm bằng **`nvidia-smi` về nền** (996-1084 MiB) **và `netstat -ano | grep -E ":3000|:8081"` trống**, cả **trước lẫn sau**.
- Sidecar thị giác (`llama-server`, tiến trình RIÊNG ~7,8 GB) **không thức trong bất kỳ lượt nào** — nền luôn ≤1084 MiB.
- Tìm/dừng tiến trình bằng `Get-CimInstance Win32_Process` lọc theo `CommandLine` + `taskkill /T /F`, không dùng `tasklist`.
- Biến môi trường ép qua **CLI** (`dotenv` `override=false` ⇒ CLI thắng). **`.env` không bị chạm**: `RAG_RERANKER_GPU=false` vẫn nguyên ở `.env:416` sau toàn bộ phép đo.
- Mọi phát biểu phủ định dưới đây đều kèm **phép thử đã chạy theo CẢ HAI CHIỀU**.

---

## 2. §15.4 — Đo `aiReranker` với `RAG_RERANKER_GPU=true` (hộ tiêu thụ chưa ai từng đo)

### 2.1 Số đo — 3 lượt độc lập, mô phỏng ĐÚNG chuỗi gọi sản xuất

Chuỗi sản xuất (`aiReranker.ts:362-404`): `getLlama({gpu:"auto"})` → `loadModel({gpuLayers: -1})` → `createRankingContext({contextSize:"auto"})` → `rankAll()`.
Model: `D:/SOURCES/16.AI/bge-reranker-v2-m3-Q8_0.gguf`, **606,2 MiB trên đĩa**.

| Mốc | Lượt 1 (MiB) | Lượt 2 (MiB) | Lượt 3 (MiB) |
|---|---|---|---|
| nền trước | 1.017 | 1.018 | 1.010 |
| sau `getLlama()` — **backend CUDA** | 1.448 (**+431**) | 1.448 (**+430**) | 1.441 (**+431**) |
| sau `loadModel(gpuLayers:-1)` — **trọng số** | 1.445 (**−3**) | 1.448 (**0**) | 1.431 (**−10**) |
| sau `createRankingContext` | 1.463 (**+18**) | 1.462 (**+14**) | 1.454 (**+23**) |
| sau `rankAll(20 doc)` — buffer tính | 1.566 (**+103**) | 1.569 (**+107**) | — |
| sau `dispose()` + 1,5 s | 1.542 (còn **+525**) | 1.541 (còn **+523**) | — |
| **Delta mà `commitMeasured()` GHI** | **+15** | **+14** | **+13** |
| **Đỉnh thường trú so với nền** | **+549** | **+551** | — |

**Xác nhận qua ĐƯỜNG SẢN XUẤT THẬT** (gọi `aiReranker.rerank()` với `RAG_RERANKER_GPU=true`, log `[aiReranker] … device=gpu`): giấy phép ghi `actualBytes = **18,0 MiB**`, `estimatedBytes = 606,2 MiB` (nấc `file-size`). Khớp cột "delta commit" ở trên.

**Biên nhiễu:** ±2 MiB giữa các lượt cho mọi mốc; ±1 MiB cho backend CUDA (430/431/431/430/432 trên 5 lượt đo tách riêng).

### 2.2 Vì sao trọng số KHÔNG lên GPU — `gpuLayers: -1` bị quy về 0

`aiReranker.ts:394` gọi `llama.loadModel({ modelPath, gpuLayers: useGpu ? -1 : 0 })`.

**Nguồn (đọc mã thư viện, không suy từ hằng số)** —
`node_modules/node-llama-cpp/dist/gguf/insights/utils/resolveModelGpuLayersOption.js:22-24`:

```js
const resolvedGpuLayers = typeof gpuLayers === "number"
    ? Math.max(0, Math.min(ggufInsights.totalLayers, gpuLayers))
    : ggufInsights.totalLayers;
```

`-1` → `Math.max(0, -1)` → **0**. Trong node-llama-cpp, "tất cả các lớp" là `"max"`, **không** phải `-1` (quy ước của llama.cpp CLI).

**Phép thử HAI CHIỀU đã chạy** (mỗi chiều một tiến trình riêng, cùng model, cùng nền):

| `gpuLayers` yêu cầu | `model.gpuLayers` THỰC TẾ | delta `loadModel` | delta ranking ctx | tổng |
|---|---|---|---|---|
| **`-1`** (chính là sản xuất khi `RAG_RERANKER_GPU=true`) | **0** | −10 MiB | +23 MiB | **+13 MiB** |
| **`"max"`** (ý định của cờ) | **25** (đủ lớp) | **+315 MiB** | +14 MiB | **+329 MiB** |
| **`0`** (đường CPU mặc định) | 0 | 0 MiB | +18 MiB | **+18 MiB** |

⇒ `-1` và `0` **cho ra cùng một kết quả**. Cờ `RAG_RERANKER_GPU=true` hôm nay **không** đưa trọng số reranker lên GPU; nó chỉ đổi `getLlama({gpu: false})` thành `getLlama({gpu:"auto"})`, tức **mua 430 MiB backend CUDA mà không nhận được gì**.

⚠ **Khiếm khuyết này đã được biết ở nơi khác trong repo nhưng chưa được sửa ở đây:**
- `aiGgufEngine.ts:750-751` ghi rõ: *"Never pass -1 here: node-llama-cpp 3.x interprets -1 as 0 layers → silent CPU inference."*
- `scripts/ai-kb/embed-programming.mjs:10` ghi rõ: *"the shared helper `_gguf-embed.mjs` uses `gpuLayers:-1` which node-llama-cpp interprets as 0"*.
- Vẫn còn truyền `-1`: **`server/services/aiReranker.ts:394`** (sản xuất) · `scripts/ai-kb/_gguf-embed.mjs:75` · `scripts/ai-kb/eval-rag.mjs:221`.

**KHÔNG VÁ trong task này** (đúng ràng buộc). Xem §10.

### 2.3 Hệ quả cho chính sách (dữ liệu để Pha 2 quyết, không phải quyết định của Pha 1)

⚠ **Hai cột dưới đây dùng HAI cách tính khác nhau — phải nói rõ, nếu không là so táo với cam (review vòng 1, M-4):**
- **(Đ) = ĐO ĐƯỢC** — lấy từ mốc `nvidia-smi` thật ở §2.1, nên **đã gồm** mọi thứ llama.cpp cấp phát mà bảng thành phần không liệt kê.
- **(T) = TỔNG THÀNH PHẦN** — cộng các delta đã đo của từng bước, nên **loại trừ** phần llama.cpp giữ lại mà không thuộc bước nào (đo được: sau `dispose()` vẫn còn 523-525 MiB trên nền, tức **~80-95 MiB** không quy được về bước nào).

| Kịch bản | Thường trú | Đỉnh (gồm buffer `rankAll`) |
|---|---|---|
| Hôm nay, `RAG_RERANKER_GPU=false` | 0 MiB GPU | 0 MiB GPU |
| Hôm nay, `RAG_RERANKER_GPU=true` (còn lỗi `-1`) | **~550 MiB (Đ)** — đỉnh đo được 1.566/1.569 trừ nền 1.017/1.018 | **~550 MiB (Đ)** |
| Nếu sửa `-1` → `"max"` | **~761 MiB (T)** = 432 backend + 315 trọng số + 14 ranking ctx | **~866 MiB (T)** = 761 + ~105 buffer `rankAll` |

⚠ Hàng thứ ba **chưa từng được chạy trọn vẹn** (chỉ đo tới `createRankingContext`, không đo `rankAll` ở `"max"`) ⇒ nó là **phép cộng, không phải phép đo**. Theo chênh lệch (Đ)−(T) quan sát ở hàng thứ hai, số thật nhiều khả năng **cao hơn** ~80-95 MiB. Pha 2 muốn dùng con số này để đặt chính sách thì **phải đo lại trọn vòng**.

Trong cả ba kịch bản, **~430 MiB là backend CUDA**, không phải của riêng reranker (xem §3.4). ⚠ Cho tới khi có phép đo ở Ư2 (§7.5), **không** giả định backend đó được dùng chung với `aiGgufEngine` — mọi tiến trình reranker mới đo được đều là **+430/+431 MiB**.

---

## 3. §15.1 — Phân bố `|lệch|` ⇒ chốt ngưỡng thật (thay 512 MiB khởi điểm)

### 3.1 ⚠ Bảng `vram_events` KHÔNG cho được phân bố này — và đó là một khiếm khuyết cấu trúc

`vramReconciler.reconcileOnce()` chỉ gọi `logVramEvent({event:"drift"})` **bên trong nhánh `if (alarm)`** (`vramReconciler.ts:238-281`), tức **chỉ khi `|lệch| > ngưỡng hiện hành`**.
⇒ Mẫu trong DB bị **kiểm duyệt đúng tại con số ta đang cần chốt**. Nghĩa vụ Pha 1 ở spec §15.1 (*"báo cáo phân bố |lệch|"*) **không thực hiện được bằng chính công cụ Pha 1 vừa dựng**.

**Cách vòng đã dùng (không sửa mã):** lấy mẫu `reconcileOnce()` **mỗi 1 giây** từ một tiến trình chẩn đoán, chạy trọn một vòng đời cấp phát thật (nền → `getLlama` → `reserve` 30B → `loadModel` → `commit` → nhúng → ổn định). `reconcileOnce()` là **hàm sản xuất**, chỉ đổi người gọi và nhịp gọi.

### 3.2 Phân bố `|lệch|` — 35 mẫu, 1 giây/mẫu, một vòng đời trọn vẹn

```
sổ rỗng, chưa chạm CUDA :   5,   5,   5,  10,  14            (n=5)
sau getLlama, sổ vẫn rỗng:  426                              (n=1)   ← backend CUDA đứng MỘT MÌNH
đang nạp (chưa commit)  : 16335, 16335                       (n=2)   ← lệch ÂM, BÁO ĐỘNG GIẢ
đã nạp, chưa commit     :  365 ×9                            (n=9)
30B vừa commit          :  536 ×4                            (n=4)   ← BÁO ĐỘNG, vĩnh viễn
embedder đang reserve   :  607                               (n=1)   ← lệch ÂM
embedder vừa commit     :  531                               (n=1)
30B+embedder+embed-ctx  :  664 ×12                           (n=12)  ← BÁO ĐỘNG, vĩnh viễn
```

| Thống kê | Giá trị |
|---|---|
| min | **5 MiB** |
| p50 | **536 MiB** |
| p90 | **664 MiB** |
| p95 | **16.335 MiB** |
| max | **16.335 MiB** |
| tỉ lệ mẫu có `alarm=true` | **20/35 = 57%** — và **18/18 = 100%** kể từ lượt `commit` đầu tiên |

### 3.3 Lệch Ở TRẠNG THÁI ỔN ĐỊNH — bốn cấu hình độc lập, tất cả đều vượt 512 MiB

| Cấu hình | Sổ (MiB) | Thiết bị quy được (MiB) | **Lệch (MiB)** |
|---|---|---|---|
| `dev:worker`, 30B + buffer suy luận đầu (lượt dài, 3 nhịp liên tiếp) | 18.538 | 19.277 | **+738,6** |
| chẩn đoán, 30B ngay sau `commit` | 18.538 | 19.074 | **+536** |
| chẩn đoán, 30B + embedder + embed-ctx | 20.202 | 20.866 | **+664** |
| chẩn đoán, embedder + embed-ctx + reranker(GPU) + ONNX DML | 1.781 | 2.664 | **+882,4** |

**Không có cấu hình nào lệch < 512 MiB khi có bất kỳ model GGUF nào thường trú.**

### 3.4 Lệch dương đến từ đâu — bóc tách bằng số đo, không suy đoán

| Thành phần | MiB | Bằng chứng |
|---|---|---|
| **Backend CUDA của `getLlama()`** | **~430** | Đo trực tiếp 5 lượt: 430/431/430/431/432. Và đo cô lập ở mẫu t=6,2 s: sổ **rỗng**, thiết bị−nền = **426 MiB**. Nó được cấp phát **TRƯỚC** `reserve()` đầu tiên nên **không đường nào đưa nó vào sổ được** ở kiến trúc hiện tại. |
| **Hai cái thước khác nhau** | **+165 … +178** | `vramProbe.probeOnce()` **ưu tiên `llama.getVramState()`** khi handle đã nối, chỉ lùi về `nvidia-smi` khi chưa. Nền được chụp lúc **chưa** có handle (⇒ thước `nvidia-smi`); mọi phép so sau đó chạy khi **đã** có handle (⇒ thước native). Đo song song: `getVramState` = 1.613 MiB trong khi `nvidia-smi` = 1.448 MiB (**+165**); và ở lượt worker dài, sự kiện ghi 20.284,6 MiB trong khi dòng thời gian `nvidia-smi` cùng lúc ghi 20.106-20.111 MiB (**+174…+178**). |
| **Buffer tính LƯỜI của llama.cpp** | ~100-200 | Cấp phát ở lượt suy luận ĐẦU, tức **sau** `commitMeasured()` (đúng như `aiGgufEngine.ts:798-801` đã cảnh báo). Lệch worker 738,6 vs lệch ngay-sau-commit 536 = **+202,6**. |
| **Thiết bị ONNX DirectML** | ~183 | Delta thiết bị 282 MiB khi tạo session ONNX trong khi giấy phép chỉ ghi 99,2 MiB. |

⚠ **Bảng trên xác định NGUYÊN NHÂN, KHÔNG phải một bảng cân đối theo từng hàng (review vòng 1, M-1).** Bốn thành phần được đo **độc lập, ở những lượt khác nhau**; tổng hai khoản lớn nhất (430 + ~170 ≈ 600) đã **vượt** lệch ổn định nhỏ nhất trong §3.3 (**536 MiB**) ⇒ chúng **không cộng thẳng được** trong mọi cấu hình, và bảng này **không nói hàng §3.3 nào mang bao nhiêu lệch-thước**. Bản đầu viết *"ít nhất ~600 MiB là cấu trúc"* — **con số đó rút lại**; cái đứng vững là **danh sách nguyên nhân**, không phải một cận dưới.

⇒ Phát biểu đúng phạm vi: **lệch dương có ít nhất hai nguồn CẤU TRÚC đã định danh** (backend CUDA `getLlama()` ~430 MiB, đo cô lập với sổ rỗng; và lệch thước 165-178 MiB, đo song song hai lần độc lập), **cộng buffer tính lười và thiết bị ONNX DML**. Phán quyết **"512 MiB nằm dưới sàn" KHÔNG dựa vào phép bóc tách này** — nó dựa thẳng vào **bốn lệch ổn định đo được ở §3.3: 536 / 664 / 738,6 / 882,4 MiB**, tất cả đều > 512.

### 3.5 Lệch ÂM −16.335 MiB — báo động giả có xác suất cao, KHÔNG chữa được bằng ngưỡng

`reserve()` cộng **ước lượng** vào sổ (`aiGgufEngine.ts:737`) **trước** `llama.loadModel()` (`:747`); `commitMeasured()` mãi `:802`. Cửa sổ đó với model 30B kéo dài **11.194 → 42.763 ms** (đo được, xem §7.2).

Trong cửa sổ đó: sổ = 16.871 MiB, thiết bị quy được = 536 MiB ⇒ **lệch = −16.335 MiB, `alarm = true`**.

Với nhịp 60 s và cửa sổ nạp 11-43 s, xác suất một nhịp rơi trúng cửa sổ là **18% – 72%** mỗi lượt boot. **Nâng ngưỡng không cứu được ca này** (phải nâng lên >16 GiB, tức tắt hẳn báo động). Câu cảnh báo hiện tại **chẩn đoán đúng hướng** (*"Sổ đang giữ NHIỀU HƠN thực tế … Ứng viên số một (chưa commit): gguf:Qwen3-30B…"*) — đó là điểm cộng của Task 4 — nhưng nó vẫn là một dòng DB + một cảnh báo mỗi lượt boot.

### 3.6 Khuyến nghị cho §15.1 (Pha 2 quyết, Pha 1 chỉ đưa số)

⚠ **"Chốt ngưỡng" và "chốt nhịp" ở đây là ĐỔI BIẾN MÔI TRƯỜNG, không phải sửa mã** (review vòng 1, M-5): `vramReconciler.ts:5` đọc `VRAM_DRIFT_THRESHOLD_MB ?? 512`, `:6` đọc `VRAM_RECONCILE_INTERVAL_MS ?? 60_000`. Cả hai chỉnh được từ `.env` mà không đụng một dòng mã nào. Chỉ các mục 2-4 dưới đây mới là sửa mã (⇒ đã ghi vào §10 cho Pha 2).

1. **Không chốt ngưỡng trước khi bóc hai khoản cấu trúc** (backend CUDA ~430 MiB + lệch thước 165-178 MiB). Nâng `VRAM_DRIFT_THRESHOLD_MB` lên ≥1.024 khi số liệu còn hai lỗi hệ thống là **hợp thức hoá hai lỗi đó** — chuông sẽ im, nhưng im vì ta đã dạy nó bỏ qua đúng thứ nó phải bắt.
2. **Ưu tiên 1 — một thước duy nhất:** hoặc luôn `nvidia-smi`, hoặc chụp lại nền ngay khi handle native được nối. Đây là sửa rẻ nhất và bỏ được ~170 MiB lệch giả.
3. **Ưu tiên 2 — đưa backend CUDA vào sổ:** một giấy phép `llama-backend` xin ngay trong `getLlama()`. Bỏ nốt ~430 MiB.
4. **Ưu tiên 3 — cửa sổ chưa-commit:** so sổ dùng `Σ actualBytes` (như `captureVramBaseline` đã làm đúng) thay vì `leaseBytes()`, **hoặc** im lặng khi còn giấy phép `pending`. Bỏ được lệch −16 GiB.
5. Sau ba khoản trên, lệch còn lại dự kiến ở mức **buffer tính lười (~200 MiB) + nhiễu (±25 MiB)** ⇒ ngưỡng **384-512 MiB** mới có nghĩa. **Trước đó, mọi ngưỡng đều là số bịa.**

---

## 4. §15.2 — `p50/p95` chi phí một lượt đầu dò ⇒ chốt nhịp thật (thay 60 s khởi điểm)

`vramProbe.probeOnce()` có **hai đường**, và nó tự chuyển đường khi `setLlamaInstanceHandle()` được nối (`aiGgufEngine.ts:359-360`). **Phải đo cả hai.**

| Đường | Khi nào chạy | n | min | p50 | p90 | p95 | max |
|---|---|---|---|---|---|---|---|
| `nvidia-smi` (`execFile`) | trước khi có instance llama nào | **40** | 54,1 | **62,9** | 66,4 | **69,2** | 91,0 ms |
| `nvidia-smi`, lô độc lập thứ hai | như trên | 60 | 47,1 | ~62,5 | — | ~81 | 622 ms¹ |
| `llama.getVramState()` (native) | sau khi có model GGUF | **40** | 0,00 | **0,00** | 0,00 | **0,00** | **0,12 ms** |
| **`reconcileOnce()` TRỌN VẸN** (đầu dò + so sổ + ảnh chụp) | mỗi nhịp thật | **20** | 0,01 | **0,02** | 0,10 | **0,50** | 0,50 ms |

¹ **một** mẫu 622 ms trên 100 — tranh chấp tiến trình, **không** phải trần `timeout: 3000`.

**Xác nhận lại số của Task 5:** `~3 s` trong tài liệu cũ đúng là **trần `timeout`**, không phải chi phí thường. Chi phí thường ≈ **63 ms**, khớp 5 lượt đo của Task 5 (72/80/74/75/78 ms) trong biên nhiễu của máy.

### 4.1 Khuyến nghị cho §15.2

- **Chi phí KHÔNG phải ràng buộc.** Nhịp 60 s trên đường native tốn **0,00003%** một luồng; trên đường `nvidia-smi` tốn **0,1%**. Hạ xuống **10 s** vẫn chỉ **0,63%** ở đường tệ nhất, và **~0%** ở trạng thái thực tế quan trọng (đã có model GGUF ⇒ đường native).
- **Ràng buộc thật là cửa sổ nạp model (§3.5): nhịp NHANH HƠN sinh NHIỀU báo động giả HƠN.**
- ⇒ **Giữ 60 s ở Pha 1.** Sau khi §3.6 mục 4 được xử lý, hạ xuống **10 s** — thu hẹp cửa sổ "một hộ cấp phát chui mà chưa ai thấy" **6 lần**, với chi phí đo được là không đáng kể.
- Ghi chú phụ: `VRAM_PROBE_CACHE_MS` mặc định 5.000 ms **không giúp gì** cho reconciler ở nhịp 60 s; nó chỉ có tác dụng nếu xuất hiện người gọi `readDeviceVram()` thứ hai.

---

## 5. `estimateSource` — chỗ nào còn dựa hằng số, chỗ nào không có căn cứ nào

### 5.1 Số liệu LIVE trong `vram_events` (15 lượt `reserve`)

| `estimateSource` | Số lượt | Ghi chú |
|---|---|---|
| `file-size` | **14** | `gguf:*`, `reranker:*`, `onnx:*` |
| `unknown` | **1** | `gguf-embed-ctx:Qwen3-Embedding-0.6B-f16` |
| `config-default` | **0** | (hai chỗ dùng nấc này không được kích hoạt trong phiên đo — xem 5.3) |
| `learned` | **0** | **xem 5.4 — đây là phát hiện quan trọng** |

### 5.2 Sai số ước lượng thật — cặp `estimated` vs `actual` đo được

| Owner | Nấc | Ước lượng | **Thật** | Lệch | % |
|---|---|---|---|---|---|
| `gguf:Qwen3-Embedding-0.6B-f16` | file-size | 1.142,1 | 1.138,0 | −4,1 | −0,4% |
| `onnx:dinov2-small` | file-size | 84,4 | 99,2 | +14,8 | +17,5% |
| `gguf-embed-ctx:Qwen3-Embedding-0.6B-f16` | **unknown** | **0,0** | **526,0** | **+526,0** | **∞** |
| `reranker:bge-reranker-v2-m3-Q8_0` (GPU=true) | file-size | 606,2 | **18,0** | **−588,2** | **−97%** |
| `gguf:Qwen3-30B-A3B-Instruct-2507` | file-size | 16.871,0 | **18.538,0** | **+1.667,0** | **+9,9%** |

Nấc `file-size` **tốt cho trọng số thuần** (−0,4%) nhưng **sai nặng khi lượt cấp phát kèm context** (30B: +9,9% = +1,7 GiB) và **sai thảm khi model không thật sự lên GPU** (reranker: −97%).

### 5.3 Hai chỗ CÒN dựa hằng số (`config-default`) — xác định bằng mã, không kích hoạt được LIVE

| Owner | Hằng số | Vị trí | Vì sao không đo được ở phiên này |
|---|---|---|---|
| `sidecar:vision` | `VRAM_SIDECAR_ESTIMATE_MB` mặc định **7825** MiB | `server/services/llamaVisionSidecar.ts:263` | Đánh thức sidecar 7,8 GB sẽ **phá hỏng mọi phép đo khác** của phiên (kỷ luật đo §1). |
| `cron:kb-sync` | `VRAM_KB_SYNC_ESTIMATE_MB` mặc định **1251** MiB | `server/services/kbSyncScheduler.ts:385` | Chạy `npm run kb:sync` là một job dài, ngoài phạm vi phiên đo. |

Cả hai đều truyền qua `configDefaultBytes` **có chủ đích**, để sự kiện ghi `estimateSource: "config-default"` — dấu vết truy được. Thiết kế này **hoạt động đúng**: nấc `config-default` là **duy nhất** ở hai chỗ này, không lan ra chỗ khác (grep toàn `server/`).

### 5.4 ⚠ Hai chỗ KHÔNG CÓ CĂN CỨ NÀO (`unknown`) — và một chỗ ước lượng bằng **0**

| Owner | Vị trí | Ước lượng lượt đầu |
|---|---|---|
| `gguf-ctx:{modelId}` | `aiGgufEngine.ts:927-931` (đường context lười) | **0 MiB** |
| `gguf-embed-ctx:{modelId}` | `aiGgufEngine.ts:2710-2714` | **0 MiB** — **đo được thật: 526 MiB** |

Cả hai **cố ý** không truyền `configDefaultBytes` (comment tại chỗ: *"thà nhận 'không biết' rồi ĐO, còn hơn nhận nhầm một con số"*). Lập luận đó đúng **với điều kiện số đã học sống sót**. Nó **không** sống sót:

### 5.5 ★ `learned` KHÔNG BAO GIỜ sống qua một lượt khởi động lại

- `vramEstimator.ts:4` — `const learned = new Map<string, number>()` — **chỉ trong bộ nhớ tiến trình**.
- `vram_events` là **chỉ-ghi**: grep toàn repo, **không có một lời gọi `select` nào** trên bảng này (`vramEventLog.ts:59` chỉ `insert`; không router/service/script nào đọc lại).

⇒ **Mỗi lượt boot, mọi owner đều bắt đầu lại từ `file-size` / `config-default` / `unknown`.** Nấc `learned` chỉ áp dụng cho lượt cấp phát **thứ hai trở đi trong CÙNG một tiến trình** — mà phần lớn hộ tiêu thụ chỉ cấp phát **một lần** rồi cache (model, session). Điều này đúng với dữ liệu: **0/15** lượt `reserve` dùng nấc `learned`.

⇒ Lời hứa spec §7 (*"sau vài ngày, hệ có số đo thật của chính nó, do sản xuất sinh ra"*) **chưa được thực hiện**: số thật được ghi vào DB nhưng **không ai đọc lại**. Đây là việc của Pha 2, không phải lỗi của Pha 1 — nhưng phải ghi rõ, vì lập luận "không bịa hằng số vì sẽ học được" đang **dựa vào một vòng phản hồi chưa khép kín**.

---

## 6. `wouldRefuse` — bán kính ảnh hưởng khi bật cưỡng chế ở Pha 2

### 6.1 Số liệu thô

**`wouldRefuse = true`: 0 lượt / 15 lượt `reserve`.** Không có owner nào bị phán quyết bóng từ chối.

### 6.2 Vì sao con số 0 này **không** có nghĩa "Pha 2 an toàn"

`vramBroker.reserve()` (`vramBroker.ts:43-45`):
`headroom = 32.607 − 1.024 (VRAM_SAFETY_RESERVE_MB) − Σ leaseBytes`.

| Trạng thái sổ | Headroom | Ai sẽ bị từ chối nếu Pha 2 cưỡng chế |
|---|---|---|
| rỗng | 31.583 MiB | không ai |
| 30B đã commit (18.538) | **13.045 MiB** | model 30B **thứ hai** (coder, est 16.847) ⇒ **TỪ CHỐI**. sidecar 7.825 ⇒ qua. kb-sync 1.251 ⇒ qua. |
| 30B + embedder + embed-ctx (20.202) | **11.381 MiB** | sidecar 7.825 + kb-sync 1.251 = 9.076 ⇒ vẫn qua. |

**Bán kính thật nằm ở CHẤT LƯỢNG SỐ, không ở số lượt bị từ chối.** Với các sai số đo được ở §5.2, mỗi quyết định `wouldRefuse` của Pha 2 sẽ chạy trên số sai tới:

- **−588 MiB** (reranker: sổ giữ 606, thật 18) — **giữ chỗ thừa**, từ chối oan người khác;
- **+526 MiB** (embed-ctx: sổ giữ 0, thật 526) — **giữ chỗ thiếu**, cho qua rồi OOM;
- **+1.667 MiB** (30B: sổ giữ 16.871 lúc `reserve`, thật 18.538) — **thiếu 1,7 GiB trong suốt cửa sổ nạp**, đúng lúc nguy hiểm nhất;
- **+430 MiB** (backend CUDA) — **không bao giờ nằm trong sổ**;
- **+165…+178 MiB** (lệch thước) — sai số hệ thống một chiều.

**Cộng dồn — nêu KHOẢNG, không nêu một số giả chính xác (review vòng 1, M-2).** Bản đầu viết *"~2,5 GiB đã đo"*; con số đó **không suy ra được từ năm khoản trên** theo bất kỳ quy ước nào. Ba cách cộng hợp lệ, tuỳ nghĩa của "sai số tổng":

| Quy ước | Phép tính (MiB) | Kết quả |
|---|---|---|
| **Tổng có dấu** (sai số bù nhau) | −588 + 526 + 1.667 + 430 + 170 | **2.205 MiB ≈ 2,15 GiB** |
| **Chỉ khoản CÙNG CHIỀU thiếu chỗ** (bỏ khoản âm) | 526 + 1.667 + 430 + 170 | **2.793 MiB ≈ 2,73 GiB** |
| **Tổng trị tuyệt đối** (xấu nhất, không bù) | 588 + 526 + 1.667 + 430 + 170 | **3.381 MiB ≈ 3,30 GiB** |

⇒ **Sai số của sổ nằm trong khoảng 2,15 – 3,30 GiB** trên cấu hình 4 hộ tiêu thụ đã đo, tuỳ quy ước. **Kết luận không phụ thuộc vào việc chọn quy ước nào**: cả ba đều lớn hơn `VRAM_SAFETY_RESERVE_MB = 1024` **gấp hơn hai lần** ⇒ **dự trữ an toàn nhỏ hơn sai số của chính sổ**.

⇒ **Khuyến nghị: KHÔNG bật cưỡng chế Pha 2 trước khi khép ba khoản ở §3.6 (thước, backend CUDA, cửa sổ chưa-commit) và §5.5 (đọc lại `learned` từ DB).** Ngược lại là cưỡng chế bằng một con số mà ta đã biết là sai.

---

## 7. Ư7 — *"trần một khối `cudaMalloc` đơn lẻ KHÔNG ổn định giữa các lượt — có phải do trạng thái NGOÀI tiến trình?"*

> ⚠ **Con số duy nhất được trích từ §5 báo cáo Đợt 2 là `16.698,37 MiB`.** Mọi ngưỡng trung gian của báo cáo đó đã bị RÚT và **không** được trích lại ở đây. Mọi con số khác trong mục này là **đo mới trong phiên này**.

### 7.1 Phép thử theo đúng chỉ định của Ư7

*"Lặp **cùng một** lượt thử (cùng nền, cùng `prior`, cùng T+, cùng khối) 5 lần liên tiếp, ghi baseline `nvidia-smi` trước mỗi lượt."*

Nền: `npm run dev:worker` (HEAD `8d448808`, `.env` nguyên trạng). Khối: `Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL` `gpuLayers:"max"` ⇒ **đúng `16.698,37 MiB`**. T+: đường warm mặc định (`GGUF_WARM_DELAY_MS` 3.000 ms sau `startBackgroundSchedulers()`).

| Lượt | nvidia-smi TRƯỚC | Kết quả | Chi tiết | nvidia-smi SAU |
|---|---|---|---|---|
| 0 (lượt dài, chạy trước loạt) | 1.011 | ✅ **OK** | `Model loaded in 42763ms` | 1.002 |
| A-1 | 1.007 | ❌ FAIL | `allocating 16698.37 MiB … cudaMalloc failed`, đỉnh 1.443 | 999 |
| A-2 | 999 | ❌ FAIL | y hệt, đỉnh 1.439 | 1.008 |
| A-3 | 1.008 | ❌ FAIL | y hệt, đỉnh 1.442 | 998 |
| A-4 | 998 | ❌ FAIL | y hệt, đỉnh 1.442 | 1.008 |
| A-5 | 1.008 | ✅ **OK** | `Model loaded in 11194ms`, đỉnh 20.111 | 1.007 |
| B-1 | 1.012 | ❌ FAIL | y hệt, đỉnh 1.438 | 1.006 |
| B-2 | 1.007 | ❌ FAIL | y hệt, đỉnh 1.438 | 1.007 |
| B-3 | 1.007 | ❌ FAIL | y hệt, đỉnh 1.438 | 1.009 |
| B-4 | 1.009 | ✅ **OK** | `Model loaded in 12233ms`, đỉnh 20.112 | 1.007 |
| B-5 | 1.007 | ❌ FAIL | y hệt, đỉnh 1.438 | 1.006 |
| C (app, `ROLE=api`) | 1.007 | ❌ FAIL | `allocating 16698.37 MiB … cudaMalloc failed` | — |

**12 lượt: 3 THÀNH CÔNG / 9 THẤT BẠI.**

Log của cả 5 lượt loạt A **giống nhau từng dòng cho tới dòng `Loading model:`**; nền `nvidia-smi` trước mỗi lượt nằm trong dải **998-1.012 MiB**, **không phân biệt được** giữa nhóm OK và nhóm FAIL.

### 7.2 ⇒ **Ư7 TRẢ LỜI: KHÔNG TẤT ĐỊNH.**

Trần **không** là một hàm của tiến trình. Cùng máy, cùng HEAD, cùng nền đo, cùng khối, cùng T+, cùng `prior` — kết quả **lật**.

**Hệ quả bắt buộc, kể cả với con số vẫn còn được trích:**
Phát biểu *"16.698,37 MiB hỏng ổn định trên cả app lẫn worker"* của Đợt 2 (6/6 lượt) **cũng là quan sát THEO PHIÊN, không phải bất biến** — phiên này nó hỏng **9/12** chứ không phải 12/12.
⚠ Hai phiên (0/6 và 3/12) **không phân biệt được về mặt thống kê**: **Fisher exact p = 0,51**. **Không được** kết luận "Pha 1 làm nó tốt lên" hay "máy đã đổi". Cách phát biểu đúng: **cùng một lượt thử thành công khoảng 1/4 số lần**.

⚠ Để đối chiếu, phép so **có** ý nghĩa duy nhất của phiên này là **tiến trình sạch 5/5 OK vs worker 3/11 OK** (**Fisher exact p = 0,026**) — xem hàng cuối §7.4. Mọi so sánh khác trong mục này đều dưới ngưỡng phân biệt được.

**Hệ quả thiết kế:** *"mọi bản vá dựa trên một con số ngưỡng đều vô nghĩa"* — Ư7 đã dự đoán đúng điều này và nay nó **được chứng minh**.

### 7.3 Khuôn quan sát MỚI mà Pha 1 mở ra — `prior` trả lời bằng DỮ LIỆU, không suy đoán

Đây là thứ **ba lần điều tra trước không làm được**. `vram_events` của từng lượt (đọc trực tiếp từ DB):

```
 id  giờ       event     owner                                          src        est MiB
  8  15:36:46  baseline  reconciler                                                  (dev 1007)
  9  15:36:51  reserve   gguf:Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL    file-size    16871
 10  15:36:51  release   gguf:Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL    file-size    16871   ← FAIL
 11  15:37:09  baseline  reconciler                                                  (dev 1008)
 12  15:37:14  reserve   gguf:Qwen3-30B-…                               file-size    16871
 13  15:37:14  release   gguf:Qwen3-30B-…                               file-size    16871   ← FAIL
 …
 20  15:38:25  baseline  reconciler                                                  (dev 1003)
 21  15:38:30  reserve   gguf:Qwen3-30B-…                               file-size    16871
 22  15:38:40  commit    gguf:Qwen3-30B-…                               file-size  act 18538  ← OK
```

- Sự kiện `baseline` ghi `ledgerTotalBytes = 0` ở **mọi** lượt ⇒ **sổ RỖNG lúc chụp nền**.
- Giữa `baseline` và `reserve` **không có sự kiện nào khác** ⇒ **`prior = []`**.

⚠⚠ **`prior = []` NGHĨA LÀ GÌ — đọc kỹ, vì bản đầu của báo cáo này đã đọc nó RỘNG HƠN thứ nó nói (review vòng 1, I-1):**

> **`prior = []` chứng minh "không có cấp phát nào ĐÃ VÀO SỔ", KHÔNG chứng minh "không có cấp phát CUDA nào đi trước".**

Hai câu đó khác nhau, và chính §3.4 của báo cáo này đã nói vì sao: backend CUDA của `getLlama()` **"không đường nào đưa nó vào sổ được"**. `aiGgufEngine.ts:727` gọi `getLlama()` **TRƯỚC** `beginVram()` (`:737`) và trước `loadModel()` (`:747`) ⇒ **một cấp phát ~430 MiB đi trước khối 16,7 GB ở CẢ 12 LƯỢT**, và **sổ mù với nó theo đúng thiết kế hiện tại**.

**Chính §7.1 đo được nó:** đỉnh VRAM ở mọi lượt HỎNG là **1.438-1.443 MiB** trên nền **998-1.012 MiB** ⇒ **+430 MiB đã được cấp phát và vẫn đứng đó vào đúng lúc khối 16,7 GB bị từ chối**.

⇒ Sổ cái **mở ra** khuôn quan sát "ai đang giữ gì" cho mọi hộ tiêu thụ **đã đăng ký**, nhưng ở câu hỏi Ư0 nó **mù đúng lớp cấp phát mà giả thuyết nói tới**. Đó là giới hạn của thiết bị đo, phải nêu tên chứ không được bước qua.
- Đây chính xác là điều kiện mà Đợt 2 yêu cầu phải dựng được (*"phải in danh sách model đang thường trú ngay trước khi thử — không có dòng đó thì kết quả không dùng được"*). Nay nó là **sản phẩm phụ của sản xuất**, không phải một thăm dò gắn tạm.

### 7.4 Điều Ư7 loại được — mỗi mục kèm phép thử ĐÃ CHẠY, CẢ HAI CHIỀU

| # | Ứng viên | Phép thử đã chạy | Kết quả |
|---|---|---|---|
| ~~**Ư0 (ratchet) như ĐIỀU KIỆN CẦN**~~ | — | — | 🔴 **RÚT LẠI (review vòng 1, I-1). Thí nghiệm 12 lượt KHÔNG phân biệt được gì về Ư0** — nó **không xác nhận cũng không bác bỏ**. Xem khối 🔴 ngay dưới bảng. **Ư0 trở lại §7.5 như ứng viên CÒN SỐNG.** |
| **Ư3 (một bước trong lõi worker: DB pool)** | Tiến trình **trống + CHỈ postgres pool 25 kết nối** (`SELECT 1` × 25 song song) + chờ T+20 s rồi nạp 30B `"max"`. **3/3 OK** (loadMs 10.964 / 11.186 / 11.496). Chiều ngược: **không DB**, cùng T+20 s: **2/2 OK**. | ⚠ **THIẾU LỰC — không được tính là "loại" (review vòng 1, M-3).** Cả hai nhánh chạy trên nền tiến trình sạch **vốn đã 5/5 OK** ⇒ **không nhánh nào CÓ THỂ phát hiện hiệu ứng**, dù hiệu ứng có thật. Kết luận đúng phạm vi: *"DB pool một mình không đủ để dựng lại hiện tượng trong tiến trình sạch"* — **không** phải *"DB không liên quan"*. Phép thử đúng phải chạy trên nền **worker** (nơi tỉ lệ là 3/11), tắt DB bằng cờ, N≥12/nhánh. |
| **"Thời gian trôi một mình"** | Tiến trình trống, chạm CUDA ở T+1,3 s: **5/5 OK**. Cùng tiến trình, chạm CUDA ở T+20 s: **2/2 OK**. | ⚠ **THIẾU LỰC — cùng lý do (M-3).** Nền 5/5 OK không có chỗ để tụt xuống theo hướng phát hiện được. Phát biểu đúng phạm vi: *"muộn một mình không dựng lại được hiện tượng trong tiến trình sạch"*, khớp **hướng** của L11 (Đợt 2) nhưng **không** mạnh hơn nó. |
| **"Nền GPU cao lúc thử"** | `nvidia-smi` trước mỗi lượt: OK ở 1.003/1.008/1.009/1.011; FAIL ở 998/999/1.007/1.007/1.007/1.008/1.008/1.012. **Hai nhóm chồng lên nhau hoàn toàn.** | ❌ **Loại.** |
| **"Chỉ hỏng ở app/worker, tiến trình sạch luôn được"** | Tiến trình sạch `prior=[]`: **5/5 OK** (loadMs 10.910-11.275, `gpuLayers=49`, vram 18.138-18.200 MiB). Worker: **3/11 OK**. | ⚠ **KHÔNG loại — đây là chiều CÒN SỐNG.** Nền worker **dịch xác suất** mạnh (5/5 so với 3/11; **Fisher exact p = 0,026**), nhưng **không quyết định** kết quả. Mô hình đúng: worker đẩy lượt cấp phát tới sát một biên, còn **thứ gì đó ngoài tiến trình** quyết định rơi bên nào. |

---

#### 🔴 RÚT LẠI (review vòng 1, I-1) — "12 lượt đã loại ratchet" là SAI. Ư0 CÒN SỐNG.

Bản đầu của báo cáo này viết: *"Sổ cái chứng minh `prior = []` ở cả 3 lượt THÀNH CÔNG ⇒ ratchet-cần dự đoán 0/12 thành công; thực tế 3/12 ⇒ Loại."*

**Câu đó không hợp lệ, và lý do nằm ngay trong §3.4 của chính báo cáo này.**

1. `prior = []` là một sự kiện **của SỔ**, không phải một sự kiện **của GPU** (xem khối ⚠⚠ ở §7.3).
2. Backend CUDA của `getLlama()` **~430 MiB** được cấp phát ở `aiGgufEngine.ts:727`, tức **TRƯỚC** `beginVram()` (`:737`) và trước `loadModel()` (`:747`). §3.4 đã ghi rõ nó *"không đường nào đưa nó vào sổ được"*.
3. §7.1 **đo thấy nó ở mọi lượt hỏng**: đỉnh 1.438-1.443 MiB trên nền 998-1.012 MiB.

⇒ **Điều kiện của ratchet ("có một cấp phát CUDA nhỏ đi trước") được THOẢ MÃN ở CẢ 12 LƯỢT.** Một thí nghiệm trong đó biến độc lập **không đổi** thì **không phân biệt được gì**: nó không xác nhận và không bác bỏ Ư0. Tỉ lệ 3/12 nói về **cái khác**, không nói về ratchet.

⚠ Tệ hơn: `aiGgufEngine.ts:1398-1400` đã ghi một phép đo **3/3 đúng chiều ratchet-như-điều-kiện-ĐỦ** (*"nếu CUDA context đã tồn tại TRƯỚC khi app boot — chỉ cần chạm `getLlama()` … thì chính đường warm này nạp 30B THÀNH CÔNG (đo 3/3 nhánh)"*). Tức bằng chứng hiện có nghiêng **ủng hộ** Ư0, không phải chống lại.

⚠⚠ **Đây là lần thứ NĂM lớp lỗi "phát biểu rộng hơn thứ phép thử nói" xuất hiện ở đúng câu hỏi Ư7 — và là lần tinh vi nhất: thiết bị đo MÙ đúng thứ nó được dựng ra để đo.** Bốn lần trước là thử một chiều rồi phát biểu hai chiều, hoặc suy cơ chế từ hằng số. Lần này phép đo đúng, dữ liệu đúng, chỉ có **phạm vi của dấu hiệu** bị đọc rộng ra. Bài học mang sang Pha 2: **trước khi dùng sổ cái để bác bỏ một giả thuyết về cấp phát, hỏi trước "sổ có NHÌN THẤY lớp cấp phát mà giả thuyết đó nói tới không?"**

**Không cần đo thêm để sửa mục này** — đây là sửa **phạm vi phát biểu**. Ư0 trả về §7.5 kèm phép thử đúng.

---

### 7.5 Ứng viên còn lại — mỗi cái kèm phép thử RẺ (Pha 2 chạy, **không** vá trước)

| # | Ứng viên | Phép thử rẻ |
|---|---|---|
| **Ư0 ★★ (TRỞ LẠI)** | **Ratchet — "một cấp phát CUDA nhỏ đi trước mới mở được cấp phát lớn".** Vẫn là ứng viên hạng nhất; thí nghiệm 12 lượt của phiên này **không chạm tới nó** (xem khối 🔴 §7.4), và `aiGgufEngine.ts:1398-1400` ghi một phép đo **3/3 nghiêng ỦNG HỘ** nó | Phép thử phải **quan sát được lớp cấp phát mà sổ hiện KHÔNG thấy** — đó là điều kiện mới so với mọi đợt trước. Cụ thể: script tạm in `nvidia-smi` **ngay trước và ngay sau `getLlama()`** (dấu vết của backend ~430 MiB) **và** ảnh chụp sổ, rồi so hai nhánh trên **cùng nền worker**: (a) đường hiện tại — `getLlama()` rồi ngay lập tức khối 16,7 GB; (b) `getLlama()` → một cấp phát nhỏ **thật sự có trọng số** (0,6B) → **rồi** khối 16,7 GB. **N ≥ 12 mỗi nhánh** (tỉ lệ nền là 3/11 ⇒ N nhỏ không phân biệt được gì — xem M-3). Chỉ khi hai tỉ lệ khác nhau có ý nghĩa mới được phát biểu. ⚠ Bản sửa "chạm backend sớm" ở §7.6 chỉ là **một trường hợp riêng** của Ư0 — nếu Ư0 đúng thì bản sửa phải viết khác hẳn. |
| **Ư7a ★★** | **Ngân sách VRAM của WDDM/driver** — trạng thái ngoài tiến trình duy nhất còn giải thích được việc kết quả lật với cùng đầu vào | Ngay TRƯỚC lượt thử, ghi `llama.getVramState().free` **và** `nvidia-smi --query-gpu=memory.reserved,memory.used` **và** số tiến trình đồ hoạ đang giữ VRAM. Chạy 20 lượt worker, đối chiếu OK/FAIL với ba cột đó. Nếu `free` (native) khác nhau giữa hai nhóm ⇒ trúng. Rẻ vì chỉ thêm 3 dòng vào **script tạm**, không đụng sản xuất. |
| **Ư7b ★** | **Bộ nhớ host đã commit / không gian địa chỉ ảo của worker** đẩy allocation tới sát biên | Trong tiến trình sạch, **cộng dồn** các đặc trưng của worker (commit 4 GiB host + mở 25 kết nối DB + nạp `onnxruntime-node` và `sharp`), rồi nạp 30B **10 lượt**. Nếu tỉ lệ thành công tụt từ 5/5 xuống ~1/4 ⇒ dựng lại được hiện tượng **ngoài** worker ⇒ bisect được. |
| **Ư2 ★** | **Trạng thái per-`Llama`-instance của node-llama-cpp** | Trong worker đã hỏng, tạo **thêm** một `Llama` bằng `getLlama()` rồi nạp 30B qua instance mới. Được ⇒ thủ phạm là trạng thái **per-instance**; hỏng ⇒ là trạng thái **native/driver toàn tiến trình**. Kèm in `llama.getVramState()` ở cả hai thứ tự.<br>🔴 **RÚT LẠI (review vòng 1, I-2):** bản đầu hạ hạng ứng viên này bằng câu *"instance thứ hai KHÔNG tốn thêm 430 MiB (đo ở §3.4: … ~48 MiB)"*. **§3.4 không có phép đo nào như vậy** — con số 48 đó là một phép trừ tôi làm trong đầu từ hai mốc VRAM của một lượt chẩn đoán, **không** phải một phép đo có thiết kế, và nó **mâu thuẫn** với §2.1 nơi **mọi** tiến trình reranker mới đều đo được **+430/+431 MiB**. **Rút toàn bộ khẳng định "backend native dùng chung"** và **trả Ư2 về hạng cũ (★)**. Muốn hạ hạng thì phải đo thật: trong **một** tiến trình, gọi `getLlama()` lần hai với **bộ tuỳ chọn khác**, đo `nvidia-smi` trước/sau **lần hai** riêng biệt, ≥3 lượt. |
| **Ư4** | `gpuLayers:"auto"` có "nhìn thấy" trần hạ không | Trong worker đã hỏng, nạp 30B với `gpuLayers:"auto"`. Nếu nó tự chọn ít lớp và **nạp được** ⇒ bản sửa thật có thể chỉ là **làm hai lớp im lặng sống lại** (`isOom` không khớp `"Failed to load model"` · `warmModel` `catch {}` trống). |
| **Ư5** | Thiết bị DirectML/D3D12 do ORT tạo | Tiến trình sạch → tạo `InferenceSession` ONNX với `executionProviders:["dml"]` → **rồi** nạp 30B, 5 lượt. (Phiên này đã tạo session DML nhưng **SAU** GGUF, nên chưa trả lời được thứ tự ngược.) |
| **Ư8 (mới)** | **Pha 1 telemetry có làm đổi tỉ lệ không?** | Clone tạm repo ở HEAD Đợt 2 (`5a412678`), junction `node_modules`, chép `.env`, chạy **12 lượt** cùng giao thức §7.1. Chỉ khi hai tỉ lệ khác nhau **có ý nghĩa** ở N≥12/bên mới được phát biểu. ⚠ Đừng chạy N nhỏ rồi kết luận — đó chính là lỗi đã mắc bốn lần. |

### 7.6 Vì sao **KHÔNG** biến đường vòng "chạm backend sớm" thành mã (nhắc lại, nay có thêm bằng chứng)

Đường vòng đã biết: gọi `getLlama()` thật sớm. Giá **đo lại ở phiên này: 430-432 MiB, 826-1.429 ms** (5 lượt, ±2 MiB).
**Vẫn không làm**, và nay có lý do mạnh hơn trước:

1. **Trần không tất định (§7.2).** Vá theo một ngưỡng là vá theo một con số **không tồn tại**.
2. **Nó xoá đúng tín hiệu ồn ào duy nhất đang có.** Hôm nay mỗi lượt boot in `cudaMalloc failed`. Đã có **hai lớp im lặng** sẵn (`isOom` không khớp · `warmModel` `catch {}` trống); thêm lớp thứ ba là **đổi một lỗi ồn ào lấy một lỗi im lặng**.
3. **Nó không giải thích 3/12 lượt thành công.** Cả 12 lượt **đều** đã chạm backend (`getLlama()` ở `aiGgufEngine.ts:727`, dấu vết +430 MiB đo được ở §7.1) — kể cả 9 lượt hỏng. Nên "chạm backend sớm" **không phải** là biến phân biệt hai nhóm ở phiên này. Một bản vá không giải thích được dữ liệu của chính nó thì không phải bản vá.
4. **Ư0 còn sống (I-1) ⇒ bản vá này có thể chỉ là một TRƯỜNG HỢP RIÊNG viết sai.** Nếu ratchet đúng, thứ có tác dụng là *"cấp phát nhỏ trước cấp phát lớn"*, và *"chạm `getLlama()` sớm"* chỉ là một cách tình cờ thoả mãn nó — kém hiệu quả và kém rõ ràng hơn hẳn so với việc nói thẳng điều kiện thật. **Chạy Ư0 (§7.5) trước, rồi mới viết bản vá.**

---

## 8. ⚠ `ROLE=api` — lỗ hổng ảnh hưởng trực tiếp cổng ra Pha 1

### 8.1 Cơ chế (mã)

`server/_core/index.ts:5198-5205`:

```
if (SERVER_ROLE === "api") {  → in "[Role] ROLE=api — cron schedulers skipped"
} else {                      → await startBackgroundSchedulers()
```

Toàn bộ khối bật Pha 1 (`startVramReconciler()` + `__setVramLogTimerEnabled(true)`) nằm **bên trong** `startBackgroundSchedulers()` (`backgroundJobs.ts:132-140`). ⇒ Với `ROLE=api`: **không** reconciler, **không** bộ đếm giờ xả nhật ký, **không** chụp nền.
Nhưng `beginVramAllocation()` ở bảy hộ tiêu thụ **vẫn chạy** (nó không gác cờ nào) ⇒ **sổ vẫn ghi trong bộ nhớ, hàng đợi nhật ký vẫn phình**, và `logVramEvent()` **âm thầm bỏ** khi hàng đợi chạm `VRAM_LOG_QUEUE_MAX = 5000` (`vramEventLog.ts:45`).

### 8.2 Xác nhận LIVE (không suy đoán)

Chạy `ROLE=api npm run dev`, 314 dòng log:

| Bằng chứng | Quan sát |
|---|---|
| `[Role] ROLE=api — cron schedulers skipped` | dòng 52 ✓ |
| `[vram] sổ cái + đối chiếu đã bật …` | **VẮNG MẶT** ⇒ reconciler + timer nhật ký không chạy |
| `[vram] nền thiết bị: … MiB` | **VẮNG MẶT** ⇒ nền chưa bao giờ được chụp |
| `[vram] "gguf-embed-ctx:Qwen3-Embedding-0.6B-f16" KHÔNG CÓ CĂN CỨ NÀO…` | dòng 230 ✓ ⇒ **đường cấp phát VẪN xin giấy phép, sổ VẪN được ghi** |
| Số dòng mới trong `vram_events` sau lượt boot | **0** (max id trước = 47, sau = 47) ⇒ **mọi sự kiện kẹt trong bộ nhớ** |
| Tiến trình vẫn warm model 30B | ✓ `Loading model: …Qwen3-30B…` → `cudaMalloc failed` — vì đường warm này là `warmUpOllamaModels` (`index.ts:4931`), **ngoài** `startBackgroundSchedulers()` |

⇒ Ở tầng `ROLE=api`, Pha 1 **có mọi chi phí, không có một lợi ích nào**: nó vẫn đo thiết bị hai lượt mỗi lần cấp phát (~126 ms), vẫn giữ sổ, vẫn xếp hàng sự kiện — nhưng **không ai đối chiếu, không ai ghi, không ai báo động**, và tiến trình này **vẫn nạp model 30B** (tức vẫn là hộ tiêu thụ VRAM lớn nhất trong tiến trình).

### 8.3 Ảnh hưởng tới cổng ra

Spec §10 đòi *"sổ khớp thiết bị trong ±512 MiB suốt 24 h"*. Trong **topology `ROLE=api` + `ROLE=worker`** (đúng topology mà `backgroundJobs.ts` và `worker.ts` được viết ra để phục vụ):

- tiến trình **worker** đối chiếu sổ **của worker** với **VRAM của cả thiết bị**;
- tiến trình **api** cấp phát VRAM thật (embedder, embed-ctx, 30B, ONNX, reranker) mà **không** vào sổ của worker;
- ⇒ mọi thứ tiến trình api cấp phát sẽ hiện ra ở worker dưới dạng **"hộ tiêu thụ cấp phát KHÔNG XIN PHÉP"**, hoặc bị **nuốt vào nền** nếu api khởi động trước worker.

**Đây không phải lỗi mới của Task 7 phát hiện ra ở mã Pha 1 — đây là giới hạn phạm vi chưa được nói ra: Pha 1 là sổ cái MỘT TIẾN TRÌNH, còn hệ có thể chạy HAI.** Cùng họ với ca "sidecar mồ côi" mà spec §6 giao cho Pha 3.

**Khuyến nghị (Pha 2 quyết):** hoặc (a) bật khối Pha 1 **ngoài** `startBackgroundSchedulers()` để mọi tiến trình đều có sổ + nhật ký riêng, ghi thêm cột định danh tiến trình vào `vram_events`; hoặc (b) tuyên bố tường minh **Pha 1 chỉ có giá trị ở topology all-in-one / worker**, và gác cổng ra theo đúng tuyên bố đó.

---

## 9. Phán quyết cổng ra Pha 1

Spec §10, cổng ra Pha 1 gồm **ba** điều kiện:

| Điều kiện | Phán quyết | Bằng chứng |
|---|---|---|
| **1. Sổ khớp thiết bị trong ±512 MiB suốt 24 h** | ❌ **KHÔNG ĐẠT** | Lệch ổn định **536 / 664 / 738,6 / 882,4 MiB** ở 4 cấu hình độc lập; **100% mẫu** báo động kể từ lượt `commit` đầu tiên. Thêm lệch ÂM **−16.335 MiB** trong cửa sổ nạp. Không cấu hình nào < 512 MiB khi có model GGUF thường trú. **24 h chưa chạy được** — và ở `ROLE=api` thì **không bao giờ** chạy. |
| **2. Báo cáo phân bố `|lệch|` + `p50/p95` chi phí đầu dò để chốt §15.1/§15.2** | ⚠ **ĐẠT VỀ SỐ LIỆU, KHÔNG ĐẠT VỀ CÔNG CỤ** (mục §3, §4) | Bản đầu chấm ✅; **review vòng 1 gọi đúng đó là RỘNG LƯỢNG**. Số liệu thì có (§3.2, §4), nhưng **sổ tự nó không sinh nổi phân bố mà chính nó cần**: `drift` chỉ được ghi khi `|lệch|` **đã vượt** ngưỡng đang cần chốt (`vramReconciler.ts:238`) ⇒ mẫu bị kiểm duyệt tại đúng con số phải quyết. Phân bố ở §3.2 lấy được **nhờ một tiến trình chẩn đoán ngoài**, không nhờ Pha 1. Lần chốt ngưỡng sau vẫn phải đo ngoài, trừ khi §10 mục 7 được làm. |
| **3. Ư7 có câu trả lời** | ✅ **ĐẠT — dứt điểm** (mục §7) | 12 lượt, 3 OK / 9 FAIL, `prior=[]` chứng minh bằng sổ cái. **Trần KHÔNG tất định.** |

### Kết luận

> **Pha 1 đã hoàn thành mục tiêu TRI THỨC của nó và trượt cổng ĐỊNH LƯỢNG của nó — và cái trượt đó chính là phát hiện.**
>
> Sổ cái hoạt động: nó **đo được** ba thứ mà trước đây không ai đo được (backend CUDA 430 MiB vô hình · hai cái thước lệch nhau 170 MiB · `gguf-embed-ctx` ước lượng 0 trong khi thật 526 MiB), và nó **trả lời được Ư7** bằng dữ liệu thay vì suy đoán.
> Nhưng ngưỡng 512 MiB nằm **dưới sàn cấu trúc** của chính hệ đang đo, nên cái chuông kêu liên tục — đúng thất bại mà `vramReconciler.ts:20-26` viết ra để tránh, chỉ khác là nguồn không phải nền desktop mà là **backend CUDA + lệch thước**.

**Cổng ra Pha 1: CHƯA ĐẠT. Không được bắt đầu Pha 2 (cưỡng chế) trước khi:**

1. **Một thước duy nhất** (bỏ ~170 MiB lệch giả) — §3.6 mục 2;
2. **Backend CUDA vào sổ** (bỏ ~430 MiB) — §3.6 mục 3;
3. **Cửa sổ chưa-commit không sinh báo động** (bỏ lệch −16 GiB) — §3.6 mục 4;
4. **Chốt lại ngưỡng trên số liệu đã sạch**, rồi **mới** chạy 24 h;
5. **Quyết tường minh về `ROLE=api`** — §8.3.

⚠ **Cổng chặn Ư7 của spec §10 thì ĐÃ MỞ**, nhưng mở theo hướng ngược với kỳ vọng: Ư7 trả lời *"trần không tất định"*, nên **mọi thiết kế Pha 2/3 dựa vào một con số trần đều bị loại từ đầu**. Broker phải xử lý **thất bại cấp phát như một sự kiện bình thường** (thử lại / hạ `gpuLayers` / từ chối trung thực), **không** như một điều kiện tránh được bằng cách tính đủ chỗ.

---

## 10. Việc để lại cho Pha 2 — KHÔNG sửa ở task này

| # | Việc | Vị trí | Vì sao không sửa ở đây |
|---|---|---|---|
| 1 | `gpuLayers: -1` → `"max"` ở reranker | `server/services/aiReranker.ts:394` | Đổi hành vi cấp phát: sẽ **thêm 315 MiB** trọng số lên GPU. Đúng chỗ Ư7 nói ta chưa hiểu. |
| 2 | `gpuLayers: -1` ở hai script KB | `scripts/ai-kb/_gguf-embed.mjs:75` · `scripts/ai-kb/eval-rag.mjs:221` | Cùng lý do; đây là đường nhúng KB, đổi là đổi thời gian + VRAM của `kb:sync`. |
| 3 | Một thước duy nhất cho đầu dò | `server/services/vram/vramProbe.ts:50-59` | §3.6 mục 2 |
| 4 | Giấy phép cho backend CUDA của `getLlama()` | `server/services/aiGgufEngine.ts:355-360` | §3.6 mục 3 |
| 5 | So sổ dùng `Σ actualBytes` hoặc im lặng khi còn `pending` | `server/services/vram/vramReconciler.ts:235` | §3.6 mục 4 |
| 6 | Đọc lại `learned` từ `vram_events` lúc khởi động | `server/services/vram/vramEstimator.ts:4` | §5.5 — khép vòng phản hồi mà spec §7 đã hứa |
| 7 | Ghi `drift` **mọi nhịp** (hoặc lấy mẫu thưa), không chỉ khi vượt ngưỡng | `server/services/vram/vramReconciler.ts:238` | §3.1 — nếu không, lần chốt ngưỡng sau lại phải đo ngoài |
| 8 | Quyết định về `ROLE=api` | `server/_core/index.ts:5198` · `backgroundJobs.ts:132` | §8.3 |
| 9 | Hai lớp im lặng của đường OOM | `aiGgufEngine.ts:760-766` (`isOom` không khớp `"Failed to load model"`) · `:1369` (`warmModel` `catch {}` trống) | Ư4 — có thể là bản sửa **rẻ và trung thực hơn** cả việc đụng thứ tự CUDA |

---

## Phụ lục A — Dữ liệu thô

### A.1 Chi phí đầu dò (ms)

`nvidia-smi`, n=40: `90.99, 60.22, 66.42, 58.63, 60.03, 62.54, 63.27, 62.98, 61.38, 62.11, 62.18, 63.99, 60.66, 61.4, 62.97, 63.06, 64.38, 64.31, 68.59, 54.1, 63.54, 60.39, 62.89, 64.77, 62, 58.72, 62.71, 63.61, 63.3, 63.13, 61.78, 61.34, 60.9, 63.88, 62.6, 61.15, 62.89, 64.16, 69.2, 63.2`

`llama.getVramState()`, n=40: `0.12, 0.01, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`

`reconcileOnce()` trọn vẹn, n=20: `0.47, 0.08, 0.02, 0.03, 0.02, 0.02, 0.01, 0.01, 0.02, 0.02, 0.02, 0.06, 0.1, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01`

### A.2 Lệch reconciler, 35 mẫu 1 giây (MiB, dấu giữ nguyên)

`-5, -5, -10, -14, -5, +426, -16335, -16335, +365 ×9, +536 ×4, -607, +531, +664 ×12`

### A.3 Truy vấn kiểm chứng

```sql
SELECT event, owner, "estimateSource", "estimatedBytes", "actualBytes",
       "driftBytes", "wouldRefuse", "createdAt"
FROM vram_events ORDER BY "createdAt" DESC LIMIT 300;

SELECT "estimateSource", count(*) FROM vram_events WHERE event='reserve' GROUP BY 1;
-- file-size 14 · unknown 1 · config-default 0 · learned 0

SELECT "wouldRefuse", count(*) FROM vram_events WHERE event='reserve' GROUP BY 1;
-- false 15 · true 0
```

DB: `postgres://aoi:aoi@127.0.0.1:5434/aoi_management`.

### A.4 Kỷ luật đo — trạng thái sạch giữa các lượt

`nvidia-smi` về nền ở **mọi** ranh giới lượt: 996 / 998 / 999 / 1002 / 1003 / 1006 / 1007 / 1008 / 1009 / 1010 / 1011 / 1012 / 1063 / 1064 / 1071 / 1072 / 1073 / 1076 / 1081 / 1084 MiB.
`netstat -ano | grep -E ":3000|:8081"` **trống** trước mỗi lượt (kiểm bằng `grep -c` = 0).
Sidecar thị giác **không thức lần nào** (nền không bao giờ vượt 1.084 MiB).

### A.5 Xác nhận không đụng mã sản xuất

```
git status --porcelain | wc -l   →  245   (trước và sau, không kể file báo cáo này)
```
Ba script đo tạm (`_t7probe.mts`, `_t7probe2.mts`, `_t7probe3.mts`) đã **xoá**. Các script còn lại chạy hoàn toàn ngoài repo. `.env` **không bị chạm** (`RAG_RERANKER_GPU=false` vẫn ở `.env:416`); mọi biến ép qua CLI.
