# Task 6 — Biên lắng của bộ đếm phải là CỦA TA · BÁO CÁO

**Trạng thái: DONE.** Hằng số `VRAM_MEASURE_SETTLE_MS` đã có **tên**, có **số đo chống lưng** (8 lượt
nạp model thật), và có **ca đỏ canh** (6 đột biến, mỗi đột biến bị đúng ca dự định bắt).

**⚠ Điều người duyệt phải đọc trước mọi thứ khác: phép đo BÁC BỎ một vế của I-5.** Brief và chú
thích I-5 đều nói biên ~1,2 s của `Get-Counter` "ĐANG LÀ ĐIỀU KIỆN ĐÚNG ĐẮN CỦA PHÉP ĐO". **Không
phải.** Bộ đếm phản ánh đủ lượt cấp phát **TRƯỚC** khi lượt nạp trả về ở **8/8 lượt** (đi trước
429–7.140 ms). Yêu cầu thật tại điểm sản xuất là **0 ms**; 1,2 giây kia **luôn là chi phí thuần**.
Vế còn lại của I-5 vẫn ĐÚNG và là lý do task này đáng làm: cửa sổ đo đang tựa vào một biên **không
thuộc về ta**, không ghi ở đâu, không test nào canh.

Câu hỏi trong brief — *"nếu độ trễ VƯỢT biên 1,2 s hiện có"* — trả lời: **KHÔNG vượt, và không tới
gần.** Không cần nới gì.

---

## 0. ĐỘ NHẠY — nói trước khi phát biểu

| # | Nguồn sai số | Độ lớn | Ảnh hưởng tới kết luận |
|---|---|---|---|
| 1 | Nhịp lấy mẫu của đầu dò | trung bình **0,036–0,070 ms** (649k–921k mẫu/lượt) | phân giải thời gian ±0,07 ms trên một đại lượng cỡ 10²–10³ ms ⇒ không đáng kể |
| 2 | Chi phí một lượt lấy mẫu | trung vị **0,018 ms** (min 0,017 · max 2,8 ms ở lượt đầu, trước khi handle ấm) | không đáng kể |
| 3 | Trễ phát hiện mốc "nạp xong" | 1 vòng lặp lấy mẫu (**≤0,1 ms**) + `writeFileSync` của tiến trình con (~0,1–1 ms) | ≤ ~1 ms; **cùng một đồng hồ** (`Stopwatch` của đầu dò) đo cả mốc lẫn bộ đếm ⇒ **KHÔNG có sai lệch đồng hồ giữa hai tiến trình** |
| 4 | Hạt của `[DateTime]::UtcNow` | ~15,6 ms | **không dùng** cho phép đo — chỉ neo một lần để ghi nhật ký |
| 5 | Đầu dò chiếm 1 lõi CPU suốt lượt đo | 1/20 lõi | không đổi được đường PCIe/cudaMalloc; và mọi lượt đều chịu như nhau |

**Dấu của kết quả không nhạy với bất kỳ nguồn nào ở trên**: biên độ cần giải thích là 429–7.140 ms,
lớn hơn tổng mọi sai số ~4 bậc.

---

## 1. SỐ THÔ — 8 LƯỢT, KHÔNG LƯỢT NÀO PHẢI THỬ LẠI

**Thước:** PDH qua P/Invoke (`PdhOpenQuery`/`PdhAddEnglishCounter`/`PdhCollectQueryData`/
`PdhGetFormattedCounterArray`), **giữ handle ấm trong tiến trình**, đường dẫn
`\GPU Process Memory(*)\Dedicated Usage`. **Cùng `pdh.dll` mà `Get-Counter` dùng** — đây là điều
kiện để con số nói được về nguồn mà sản xuất thật sự đọc, không phải về một đường khác.

**Mốc t₀ = lúc `llama.loadModel()` trả về**, tức ĐÚNG điểm `commitMeasured()` được gọi trong sản
xuất. Tiến trình con ghi **file mốc**; đầu dò `Test-Path` trong cùng vòng lặp lấy mẫu ⇒ mốc và bộ
đếm dùng **một đồng hồ**.

**Kỷ luật đã giữ:** con ghi log ra FILE, `stdio` redirect ra FILE (không nối ống); dọn theo **đúng
PID** bằng `Stop-Process -Id`; xác nhận GPU rảnh trước mỗi lượt (nền 1.079–1.180 MiB).

| # | model | file (byte) | nạp (ms) | nền backend (byte) | **Δ cuối (byte)** | **Δ tại mốc (byte)** | **% thấy được tại mốc** | **ĐỘ TRỄ (ms)** |
|---|---|---|---|---|---|---|---|---|
| s1 | Qwen3-Embedding-0.6B-f16 | 1.197.629.632 | 1.238,4 | 452.595.712 | 1.193.291.776 | 1.193.291.776 | **100,0000 %** | **−480,2** |
| s2 | Qwen3-Embedding-0.6B-f16 | 1.197.629.632 | 1.280,4 | 452.595.712 | 1.193.291.776 | 1.193.291.776 | **100,0000 %** | **−429,5** |
| s3 | Qwen3-Embedding-0.6B-f16 | 1.197.629.632 | 1.201,2 | 452.595.712 | 1.193.291.776 | 1.193.291.776 | **100,0000 %** | **−460,6** |
| m1 | Qwen3-4B-Instruct-Q4_K_XL | 2.546.340.960 | 6.832,5 | 452.595.712 | 2.541.768.704 | 2.541.768.704 | **100,0000 %** | **−1.017,5** |
| m2 | Qwen3-4B-Instruct-Q4_K_XL | 2.546.340.960 | 2.033,4 | 452.595.712 | 2.541.768.704 | 2.541.768.704 | **100,0000 %** | **−962,2** |
| L1 | Qwen3-30B-A3B-Q4_K_XL | 17.690.497.440 | 40.909,2 | 452.595.712 | 17.511.354.368 | 17.511.354.368 | **100,0000 %** | **−7.140,3** |
| L2 | Qwen3-30B-A3B-Q4_K_XL | 17.690.497.440 | 9.918,7 | 452.595.712 | 17.511.354.368 | 17.511.354.368 | **100,0000 %** | **−6.881,1** |
| L3 | Qwen3-30B-A3B-Q4_K_XL | 17.690.497.440 | 9.142,0 | 452.595.712 | 17.511.354.368 | 17.511.354.368 | **100,0000 %** | **−6.571,8** |

**ĐỘ TRỄ: n = 8 · min = −7.140,3 · trung vị = −962,2 · max = −429,5 ms.**
Dấu **ÂM = bộ đếm ĐI TRƯỚC**. **Không một lượt nào dương.** ⇒ **Yêu cầu đo được = 0 ms.**

**Số lần thử lại của model 30B: 0** (3/3 lượt nạp thành công ngay). Trần bất định mà Pha 1.5 đo
được (3 OK / 9 hỏng) **không tái hiện** trong đợt này — nói ra vì đó là dữ liệu, không phải vì nó
thay đổi kết luận nào ở đây.

### 1b. Ba đối chứng độc lập rơi trúng, không hề được chỉnh cho khớp

1. **`Δ cuối` trùng TỚI TỪNG BYTE với nghiệm thu sống Task 3** — 1.193.291.776 và 17.511.354.368 —
   dù Task 3 đo bằng `Get-Counter` qua `powershell.exe` còn đợt này đo bằng PDH P/Invoke handle ấm.
   Hai thiết bị đo khác hẳn nhau, cùng một con số.
2. **Nền backend = 452.595.712 B ở 8/8 lượt**, đúng bằng `CUDA_BACKEND_FALLBACK_BYTES` mà Task 4
   ghim. Đây là lần xác nhận thứ **ba** cho hằng số đó (PDH T5-11 · `nvidia-smi` Pha 1 · đợt này).
3. Ba lượt lặp lại của cùng một model cho `Δ cuối` **giống hệt nhau tới từng byte** ⇒ bộ đếm ổn
   định, không phải số nhiễu.

### 1c. Độ trễ của CHÍNH bộ đếm — đo bằng một sự kiện có thời điểm biết TỪ BÊN NGOÀI

Chiều cấp phát cho ra số ÂM nên **không** đo được độ trễ nội tại của bộ đếm. Để có một số **dương**
thật sự về bộ đếm, đầu dò giết tiến trình con (đang giữ 17,5 GB) bằng `Stop-Process -Id` rồi tiếp
tục lấy mẫu 3 giây:

| lượt | s1 | s2 | s3 | m1 | m2 | L1 | L2 | L3 |
|---|---|---|---|---|---|---|---|---|
| bắt đầu tụt (ms) | 9,5 | 7,3 | 8,1 | 7,1 | 7,6 | 7,2 | 8,4 | 8,0 |
| về 0 (ms) | 49,2 | 27,3 | 28,8 | 33,1 | 34,4 | **120,9** | 102,3 | 113,6 |

⇒ **Quan sát lớn nhất về độ trễ của chính bộ đếm: 121 ms** (nhả 17,5 GB). **Đây — không phải số 0 ở
§1 — là số chống lưng cho biên an toàn.**

### 1d. Bộ đếm KHÔNG được làm mới theo nhịp đồng hồ thô

Hai giá trị **khác nhau** quan sát được cách nhau **0,127 ms** (min qua 8 lượt; trung vị khoảng cách
giữa các lần đổi trong lúc cấp phát: 0,5–1,6 ms). Một bộ đếm làm mới theo chu kỳ T **không thể** cho
hai giá trị khác nhau cách nhau < T ⇒ **chu kỳ làm mới của nguồn < 0,13 ms**. Đây là lý do "bộ đếm
trễ" không phải là chế độ hỏng của đường này trên máy này.

### 1e. VÌ SAO độ trễ âm — cơ chế, không phải may

Trích nguyên văn nhật ký thay đổi của lượt nạp 0,6B (đơn vị byte, mốc `loadModel()` trả về = 0):

```
rel_marker = −781,9 …  −778,4     452.599.808 → 452.595.712   (nhiễu 4 KiB của nền backend)
rel_marker = −463,5              519.704.576   ← bắt đầu cấp phát trọng số, bước 67.108.864 B
rel_marker = −462,7 … −456,3     653.926.400 … 1.526.345.728  (18 bước, cách nhau 0,4–0,5 ms)
rel_marker = −455,5            1.645.887.488   ← ĐẠT MỨC CUỐI
rel_marker =    0,0            1.645.887.488   ← loadModel() TRẢ VỀ
```

`\GPU Process Memory\Dedicated Usage` đếm **lượt CẤP PHÁT** (`cudaMalloc`), không đếm lượt **chép
xong**. llama.cpp cấp phát buffer trước rồi mới chép host→device; toàn bộ 20 bước cấp phát 1,19 GB
xong trong **8,1 ms**, phần 455 ms còn lại của `loadModel()` là chép. Với 30B: **328 bước**, và mốc
cuối vẫn nằm **6,6–7,1 giây TRƯỚC** lúc API trả về.

⇒ Kết luận này **có cơ chế giải thích**, không phải một quan sát trần trụi — và cơ chế đó dự đoán
đúng rằng model càng lớn thì độ trễ càng ÂM SÂU (chép lâu hơn), điều mà bảng §1 xác nhận (0,6B ≈
−460 · 4B ≈ −990 · 30B ≈ −6.860).

---

## 2. HẰNG SỐ ĐÃ GHIM

`server/services/vram/vramProcessProbe.ts`:

```ts
export const VRAM_COUNTER_SETTLE_MEASURED_MS = 0;    // yêu cầu ĐO ĐƯỢC tại điểm sản xuất (§1)
export const VRAM_MEASURE_SETTLE_SAFETY_MS   = 250;  // = 2,07 × quan sát 121 ms (§1c)
export const VRAM_MEASURE_SETTLE_MS = VRAM_COUNTER_SETTLE_MEASURED_MS + VRAM_MEASURE_SETTLE_SAFETY_MS;
export function awaitCounterSettle(ms = VRAM_MEASURE_SETTLE_MS): Promise<void>
```

**Vì sao TÁCH làm hai số thay vì viết `= 250`.** Nếu chỉ có một hằng số thì người sau không có cách
nào biết phần nào có thước chống lưng và phần nào là phán đoán — và mọi lượt tranh luận về việc hạ
nó sẽ lại bắt đầu từ đầu. Tách ra, câu trả lời nằm sẵn trong tên: **0 ms là số ĐO ĐƯỢC** (chiều cấp
phát, 8/8 lượt), **250 ms là PHÁN ĐOÁN được ghi tên**, neo vào quan sát dương duy nhất về bộ đếm
(121 ms) với hệ số 2, để phủ những đường cấp phát mà Task 6 **không đo** (§4).

**Nơi áp — `vramWiring.commitMeasured()`, NGAY TRƯỚC đầu đo SAU, BÊN TRONG cửa sổ đo:**

```ts
await awaitMeasureSettle();
const afterReading = await readScopeBytes(scope);
```

Ba lựa chọn vị trí, đã cân nhắc:
- **trước đầu đo TRƯỚC**: vô ích. Đầu đo TRƯỚC đọc trạng thái đã đứng yên (khoá nối tiếp đang giữ,
  chưa ai cấp phát). Trả tiền mà không mua được gì.
- **NGOÀI cửa sổ đo** (đóng cửa sổ rồi mới chờ): **mở đúng 250 ms cho một lượt cấp phát khác chen
  vào giữa hai đầu đo** — tự tay tái tạo lớp lỗi cộng-trùng mà `withMeasureWindow` sinh ra để diệt.
  Ca 6 của bộ test canh đúng chỗ này.
- **bên trong cửa sổ, trước đầu đo SAU** ← đã chọn.

**CỐ Ý KHÔNG cho ép bằng biến môi trường**, khác `VRAM_MEASURE_WAIT_MS` của Task 3. Ngân sách chờ
khoá là câu hỏi VẬN HÀNH, hạ nó chỉ **mất** phép đo và có nhánh `measure-window-not-exclusive` khai
ra. Biên lắng là câu hỏi VẬT LÝ, và hạ nó làm phép đo **SAI mà vẫn tự khai là đúng**. Một công tắc
cho phép đặt `0` chính là cái bẫy của task này, ở dạng được tài liệu chống lưng.

**Nhánh `before-probe-null` KHÔNG trả tiền biên lắng** (thoát trước đầu đo SAU) ⇒ máy không có bộ
đếm / công tắc `VRAM_PROCESS_PROBE=off` không phải chịu 250 ms nào. Ca 6b canh điều này.

---

## 3. TEST CANH BIÊN — 6 ĐỘT BIẾN, MỖI CÁI BỊ ĐÚNG CA DỰ ĐỊNH BẮT

File mới `server/services/vram/wiring.settle.test.ts`, **9 ca**. Bộ test vram: **224 → 233, xanh**.

| đột biến | ca đỏ |
|---|---|
| **M1** xoá hẳn `await awaitMeasureSettle();` *(đúng cái bẫy: "cắt biên lắng trong một dòng")* | **3 đỏ** — ca 4, 5, 6 |
| **M2** `await` → `void` *(thứ tự gọi vẫn đúng, chờ hết tác dụng)* | **3 đỏ** — ca 4, 5, 7 |
| **M3** `closeWindow()` lên TRƯỚC biên lắng *("nhả khoá sớm cho rẻ")* | **1 đỏ** — ca 6 |
| **M4** hạ `VRAM_MEASURE_SETTLE_SAFETY_MS` 250 → 100 | **1 đỏ** — ca 1 |
| **M5** `awaitCounterSettle()` thành `Promise.resolve()` đội lốt | **1 đỏ** — ca 3 |
| **M6** hằng số rời khỏi hệ thức đo-được + phán-đoán (`= 300`) | **1 đỏ** — ca 2 |

**Trước file này, cả sáu đột biến đi qua với 224/224 xanh.** Đó là toàn bộ lý do task tồn tại.

Chín ca: **1** sàn hằng số · **2** hệ thức hai phần · **3** biên lắng thật sự chờ đủ · **3b** tham số
0/âm/NaN không treo · **4** thứ tự `probe → settle → probe` · **5** chờ được `await` thật (dựng bằng
một cổng treo được — ca 4 KHÔNG bắt được M2 nếu thiếu ca này) · **6** chờ nằm TRONG cửa sổ đo · **6b**
nhánh `before-probe-null` không trả tiền · **7** ca chứng minh hậu quả.

**Ca 7 là ca chứng minh, không phải test cho một lỗi cần vá.** Nó diễn lại nguyên vẹn thế giới mà
bộ đếm trễ hoàn toàn tạo ra: hai đầu đo giống hệt, khoá của ta VẪN CÓ ⇒ **không một nhánh nào trong
sáu nhánh đo-hỏng nổ** ⇒ `commit(0)` + `measureSource: "process-delta"` + `measureFailed: false`, và
`estimateBytesFor()` sau đó trả về `{ bytes: 0, source: "learned" }`. Nấc `learned = 0`, y như I-5
dự báo. Ca này đặt cái giá của việc gỡ biên lắng **vào bộ test** thay vì vào một đoạn văn.

**M2 làm ca 7 đỏ — đã truy nguyên nhân, không đoán.** Với `void`, lời gọi `import("./vramProcessProbe")`
của `awaitMeasureSettle()` còn đang bay khi `readScopeBytes()` gọi `import()` cùng module; lượt
`import()` thứ hai **rơi ra ngoài mock và trả về module THẬT** (kiểm bằng log: `readScopeBytes` chạy
hai lần, lượt hai `typeof readProcessVram === "function"` nhưng trả `null` mà **không** ghi vào nhật
ký thứ tự của bản giả — chính là đường `probeDisabled()` của module thật, vì `vitest.setup.ts` đặt
`VRAM_PROCESS_PROBE=off`). Đây là hiện tượng của **riêng bản đột biến** (nó mới là thứ tạo ra lượt
`import` đồng thời), không phải tính chất của mã sản xuất; và M2 vẫn bị **hai lưới dự định** (ca 4,
ca 5) bắt.

**Tám bộ test đang giả `./vramProcessProbe` đều phải khai một bản giả cho `awaitCounterSettle`.**
Đó là hệ quả CÓ CHỦ Ý của việc đặt hàm ở module đầu dò: phụ thuộc "đường đo có chờ lắng" trở nên
**nhìn thấy được** trong từng bộ test thay vì ẩn. `awaitMeasureSettle()` trong `vramWiring` **cố ý
không nuốt lỗi** — thiếu bản giả ⇒ ném ⇒ không commit (hướng an toàn), thay vì im lặng bỏ qua biên
lắng.

---

## 4. ⚠ NHỮNG ĐIỀU PHÉP ĐO NÀY **KHÔNG** NÓI ĐƯỢC

Liệt kê tường minh, vì đây là chỗ dễ đọc rộng hơn số liệu nhất.

1. **KHÔNG đo được độ trễ thô "`cudaMalloc` xong → bộ đếm phản ánh".** Không quan sát được
   `cudaMalloc` từ bên ngoài. Cái đo được là đại lượng **đúng cho quyết định đang cần**: khoảng từ
   **điểm sản xuất gọi `commitMeasured()`** tới lúc bộ đếm đạt mức cuối. Một độ trễ nội tại cố định
   L > 0 vẫn có thể tồn tại và bị che khuất — nhưng §1c chặn nó ở **≤121 ms** và §1d chặn chu kỳ làm
   mới ở **<0,13 ms**.
2. **Chỉ đo đường `node-llama-cpp` / GGUF.** **KHÔNG đo**: ONNX Runtime (DirectML/CUDA,
   `aiInferenceEngine`/`aiImageEmbedding`), `spawn()` sidecar `llama-server.exe`
   (`llamaVisionSidecar`), `localSidecarTrainer`, `aiLlmFinetuneSidecar`. Đây chính là lý do tồn tại
   của `VRAM_MEASURE_SETTLE_SAFETY_MS` — và cũng là lý do **không được** hạ nó về 0 chỉ vì §1 cho
   số 0.
3. **Chỉ đo phạm vi tương đương `self`.** Ba lượt của phạm vi `descendants` (một tiến trình quan sát
   PID của tiến trình khác) *về cơ chế* dùng đúng bộ đếm toàn máy — và thực tế **toàn bộ đợt đo này
   là quan sát chéo tiến trình**, nên số liệu áp cho cả hai. Nhưng **không** có lượt nào đo một
   sidecar thật đang `spawn`.
4. **Một máy, một GPU, một driver.** RTX 5090 / Windows 11 / driver hiện hành. Không nói gì về máy
   khác, GPU khác, hay máy đang tải nặng.
5. **KHÔNG chứng minh bộ đếm không bao giờ trễ.** Chứng minh nó **không trễ trong 8 lượt này**, và
   trong 8 lượt đó nó **đi trước** điểm đo của sản xuất.
6. **KHÔNG đóng lỗ gốc của I-5.** `seen` vẫn đo **sự tồn tại của khoá**, không đo **độ tươi**. Task 6
   làm cho khoảng chờ trở thành **của ta, đo được, test được** — nó **không** thêm tín hiệu độ tươi.
   Xem §6.
7. **KHÔNG nói gì về chiều nhả** ngoài §1c. Một `before` đọc trước khi bộ đếm phản ánh xong một lượt
   nhả vẫn có thể sinh delta âm — nhánh `actual < 0` đã phủ, không đổi.

---

## 5. ĐIỀU KIỆN ĐẠT & TRẠNG THÁI

| Yêu cầu brief | Trạng thái |
|---|---|
| (1) ĐO TRỰC TIẾP độ trễ thật, ≥5 lượt, model lớn lẫn nhỏ | **ĐẠT** — 8 lượt (0,6B ×3 · 4B ×2 · 30B ×3), lấy mẫu liên tiếp 0,036–0,070 ms bằng PDH handle ấm |
| (2) Ghim `VRAM_MEASURE_SETTLE_MS`, `await` trước đầu đo SAU | **ĐẠT** — 250 ms, biên rõ ràng (§2), không ép được bằng env |
| (3) Test canh biên, ca đỏ khi hạ hằng số | **ĐẠT** — ca 1 đỏ ở M4; thêm 5 đột biến khác đều bị bắt |
| (4) Chỉ sau (1)–(3) mới được đụng `Get-Counter` | **CỔNG ĐÃ MỞ** — ghi thẳng vào chú thích `PS_SCRIPT`, kèm hai điều kiện |
| Độ trễ có VƯỢT biên 1,2 s không? | **KHÔNG.** Âm ở 8/8 lượt. Không nới gì. |

**Kiểm chứng:**
- `npx vitest run server/services/vram/` → **233/233 xanh** (224 trước + 9 mới); xanh cả với
  `--sequence.shuffle.tests` và `--sequence.shuffle.tests --sequence.shuffle.files`.
- `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → **sạch**.
- Hồi quy diện rộng `npx vitest run server/services/` (507 file): **nền 20 đỏ / 6.203 · sau khi vá
  18 đỏ / 6.212**. Tập ca đỏ **dao động giữa các lượt chạy** ở cả hai phía (18/20/21). Ca duy nhất
  "chỉ có ở bản vá" là `aiProviderGatewayRouting.test.ts` — chạy riêng **3/3 xanh**, và **hai ca
  KHÁC của chính file đó đỏ ở NỀN**. File này không chạm `vramProcessProbe` (kiểm bằng grep toàn
  repo: module chỉ được nhắc trong `server/services/vram/**` + `vitest.setup.ts`). ⇒ nhiễu của bộ
  test đầy đủ, **không phải hồi quy**.

---

## 6. MỐI LO — bàn giao thẳng, không gói

1. **⚠⚠ LỖ GỐC CỦA I-5 VẪN MỞ VỀ CẤU TRÚC, chỉ là không với tới được trên máy này.** `seen` đo sự
   tồn tại của khoá. Nếu một ngày bộ đếm trễ thật (driver khác, máy tải nặng, đường cấp phát khác),
   250 ms có thể không đủ và **không nhánh nào nổ** — ca 7 mô tả chính xác điều xảy ra khi đó.
   **Lối vá đúng đã nhìn thấy và RẺ:** `PS_SCRIPT` bỏ qua `$_.Timestamp` của mẫu PDH, còn
   `VramProcessSample.sampledAtMs` đang là `Date.now()` **lúc parse**, không phải lúc PDH lấy mẫu.
   Đưa dấu thời gian THẬT của PDH vào là có **tín hiệu độ tươi đo được**, và khi đó `readScopeBytes`
   từ chối được một mẫu quá cũ thay vì tin nó. **CỐ Ý KHÔNG làm trong Task 6**: nó đổi hợp đồng
   `parseProcessCounters` (bề mặt Task 1 đã khoá bằng test) và vượt bốn việc brief giao. **Đề nghị
   đưa vào Pha 2B như điều kiện vào cưỡng chế.**
2. **Chi phí tăng +250 ms mỗi lượt cấp phát đo được** (~3,1 s → ~3,35 s, **+8 %**). Nặng nhất ở
   `onnx-session` (đường AOI production). Task 3 đã xác nhận session được cache ⇒ mỗi lượt **TẠO**
   session, không phải mỗi ảnh. Ba điều kiện làm chi phí quay lại (trần LRU=5 · deploy model · cụm
   lạnh K lượt song song) vẫn nguyên như Task 3 ghi. **Bù lại**: cổng tối ưu `Get-Counter` nay đã
   mở, và số đo cho thấy 1,2 s ở đó là chi phí thuần ⇒ **gỡ nó rút ~2,4 s/cửa sổ**, lớn gấp ~10 lần
   khoản 250 ms vừa thêm. Ròng: **rẻ hơn đáng kể so với hôm nay**, nếu ai đó cầm mục tối ưu.
3. **250 ms là PHÁN ĐOÁN, không phải số đo** — đã ghi tên tường minh
   (`VRAM_MEASURE_SETTLE_SAFETY_MS`) đúng để không ai nhầm nó là số đo. Nó được neo vào 121 ms của
   §1c với hệ số 2. Nếu Pha 2B đo được một đường cấp phát ONNX/sidecar, **hãy đo lại và sửa CẢ ba
   nơi** (hằng số · `SAN_DO_DUOC_MS` trong `wiring.settle.test.ts` · khối số đo ở
   `vramProcessProbe.ts`) trong cùng một lượt vá.
4. **Trần bất định của 30B không tái hiện** (0/3 hỏng, trong khi Pha 1.5 đo 3 OK/9 hỏng). Không rút
   ra kết luận gì — chỉ ghi lại để lần sau ai đó thấy 9 lượt hỏng thì biết là đã có một đợt 3/3 sạch.

---

## 7. TỆP ĐÃ ĐỔI

| File | Nội dung |
|---|---|
| `server/services/vram/vramProcessProbe.ts` | +3 hằng số + `awaitCounterSettle()`; khối số đo Task 6; **mở cổng tối ưu `Get-Counter`** kèm hai điều kiện (thay khối "ĐỪNG… cho tới Task 6" đã hết hạn) |
| `server/services/vram/vramWiring.ts` | `awaitMeasureSettle()` + `await` trước đầu đo SAU; cập nhật khối I-5 ở `ScopeReading` (ghi rõ phần nào của I-5 bị **bác bỏ**) |
| `server/services/vram/wiring.settle.test.ts` | **MỚI** — 9 ca |
| 8 × `wiring.*.test.ts` | thêm bản giả `awaitCounterSettle` vào factory mock |

Script tạm (ngoài repo, KHÔNG commit): `…/scratchpad/sampler.ps1` (PDH P/Invoke) · `loader.mjs` ·
`runall.ps1` · `t6-analyze.mjs` · `t6-mutate.sh`; số thô ở `…/scratchpad/runs/*.csv|meta.json`.

**KHÔNG chạm** `knowledge/**`, không `kb:sync`, không DDL, không sửa DB, không chạy trainer.
