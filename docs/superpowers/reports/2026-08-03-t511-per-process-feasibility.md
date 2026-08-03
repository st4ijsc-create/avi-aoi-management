# T5-11 — Báo cáo phép thử khả thi: đo VRAM THEO TIẾN TRÌNH trên Windows WDDM

Ngày đo: 2026-08-03, ~17:26–17:38 giờ máy. Máy: Windows 11 Pro 10.0.26200, RTX 5090 32 GB,
driver 610.62 (WDDM), thêm Intel UHD 770. node v24.18.0, node-llama-cpp trong
`D:\SOURCES\avi-aoi-management\node_modules`. Nền desktop ~1.097 MiB, 21 tiến trình dùng GPU.

**Task CHỈ-ĐO. Không sửa mã sản phẩm, không commit mã sản phẩm.** Toàn bộ script nằm trong
scratchpad; sau khi chạy không còn tiến trình con nào sống (kiểm: 0 `node.exe` khớp `t511-child`).

---

## 0. KẾT LUẬN

# GỠ ĐƯỢC KÈM ĐIỀU KIỆN

Bộ đếm `\GPU Process Memory(pid_<PID>_luid_…)\Dedicated Usage` **thấy rõ ràng và chính xác** cấp
phát CUDA của llama.cpp, **tách được hai lượt nạp chồng nhau** thành hai con số riêng, mỗi con
đúng model tương ứng trong khi `nvidia-smi` cho một tổng không tách được. Đó là bằng chứng gỡ cổng
mà T5-11 cần, và nó **đạt**.

Kèm **năm điều kiện**, không điều kiện nào là suy đoán — cả năm đều đo được hoặc đọc được từ mã:

| # | Điều kiện | Vì sao |
|---|---|---|
| Đ1 | **Chỉ tách được GIỮA các tiến trình, KHÔNG tách được TRONG một tiến trình.** | `aiGgufEngine` nạp mọi model **in-process**; `inFlightLoads` khoá **theo modelId** (`aiGgufEngine.ts:199,791`) ⇒ hai model KHÁC NHAU vẫn nạp song song được trong CÙNG một PID. Bộ đếm trả **một** số cho PID đó. Lớp lỗi này KHÔNG được gỡ. |
| Đ2 | **Phải cộng theo CÂY tiến trình, không phải `child.pid`.** | `spawnKbSyncWithVram()` gọi `spawn("npm", ["run","kb:sync"], { shell: true })` (`kbSyncScheduler.ts:505`) ⇒ `child.pid` là `cmd.exe`; 5 script node chạy **nối tiếp**, mỗi script một PID. Một giấy phép ↔ nhiều PID kế tiếp nhau. (`spawnEvalGateWithVram` thì sạch: `spawn(process.execPath, …)`, PID biết chính xác.) |
| Đ3 | **Phải lọc theo LUID của NVIDIA.** | Máy có **4 LUID** trong tên instance. Hôm nay 3 LUID đọc 0 MiB nên phép cộng thô không sai, nhưng iGPU Intel UHD 770 có mặt và có thể khác đi. |
| Đ4 | **Tuyệt đối KHÔNG trộn hai thước.** | Tổng bộ đếm **luôn cao hơn** `nvidia-smi` **+505…+511 MiB**. Số **tuyệt đối** hai thước KHÔNG thay thế nhau được — đúng lớp lỗi đã tốn một task để diệt. Số **chênh lệch** thì tương đương (≤12 MiB, xem §3b). |
| Đ5 | **Chi phí đọc: `Get-Counter` VƯỢT 1 GIÂY (p50 1.016 ms) — phải dùng đường khác.** | Từ Node, spawn `powershell.exe` mỗi lượt đọc tốn **760 ms** (PDH .NET) hoặc **1.342 ms** (Get-Counter). Đường 4,3 ms chỉ có khi PDH handle **đã ấm trong tiến trình** — từ Node cần helper sống lâu hoặc native addon, **chưa dựng, chưa đo đầu-cuối**. |

Nếu Pha 2 nhận Đ1 là "ngoài phạm vi T5-11" (T5-11 sinh ra từ ca `cron:kb-sync` — mà `kb:sync`
**đúng là tiến trình riêng**, đã kiểm ở mã), thì cổng **gỡ được**. Nếu Pha 2 muốn diệt luôn chồng
lấn in-process thì bộ đếm này **không đủ** và cần cơ chế thứ hai.

---

## 1. ĐỘ NHẠY — nói TRƯỚC khi phát biểu

**Phép đo này phân biệt được:**
- Khối byte VRAM ≥ vài chục MiB, **quy về đúng PID**, tại đúng thời điểm lấy mẫu.
- Hai khối cùng tồn tại thuộc **hai PID khác nhau**, kể cả khi cửa sổ nạp lồng nhau hoàn toàn.
- Ba đường cấp phát khác nhau của llama.cpp: **backend CUDA** (`getLlama`), **trọng số**
  (`loadModel`), **KV-cache** (`createContext`) — cả ba đều hiện.
- Thời điểm **nhả**: tiến trình thoát ⇒ instance biến mất, PID đọc 0, thiết bị về nền.
- Độ lặp lại: backend CUDA đọc được **431,6 MiB byte-y-hệt ở 5/5 tiến trình**; 30B đọc
  **17.131,8 MiB y hệt ở 3/3 lượt**. Bộ đếm KHÔNG nhiễu.

**Phép đo này KHÔNG phân biệt được:**
- Hai khối **trong cùng một PID** (xem Đ1) — không biết ai là ai.
- Model nào / context nào bên trong một tiến trình.
- Khoản cấp phát **chưa xảy ra** (compute buffer lười ở lượt suy luận đầu — tôi **không chạy suy
  luận lần nào**).
- Độ trễ cập nhật của bộ đếm: tôi luôn chờ ≥800 ms trước khi lấy mẫu. Chuỗi thời gian cho thấy giá
  trị đầy đủ xuất hiện trong **cùng một nhịp lấy mẫu ~460 ms** với lượt cấp phát, nhưng tôi
  **không đo trực tiếp** độ trễ này.

---

## 2. CÂU 1 — bộ đếm có THẤY cấp phát CUDA không? → **CÓ, DƯƠNG MẠNH**

Giao thức: tiến trình `node` con, **không nối ống stdio** (cạm bẫy #1 — dùng `Start-Process
-WindowStyle Hidden`, con ghi log bằng `fs.appendFileSync`, bắt tay hoàn toàn bằng FILE). Ba cổng
chặn: `booted` → `getLlama()` → `backend` → `loadModel()` → `loaded`. Lấy mẫu bộ đếm **cho đúng PID
đó**.

### Bảng từng lượt

| Lượt | Model | PID | F (file, MiB) | Trước nạp N (MiB) | Sau nạp M (MiB) | **D = M−N** | **D/F** | Δ `nvidia-smi` cùng cửa sổ |
|---|---|---|---|---|---|---|---|---|
| `emb1` | Qwen3-Embedding-0.6B-f16 | 19212 | 1.142,1 | 431,6 | 1.569,6 | **1.138,0** | **0,996** | 1.138,0 |
| `big1` | Qwen3-30B-A3B-Instruct-2507-UD-Q4_K_XL | 17876 | 16.871,0 | 431,6 | 17.131,8 | **16.700,2** | **0,990** | 16.700,0 |
| `ctx1` | Qwen3-4B-Instruct-2507-UD-Q4_K_XL | 35976 | 2.428,4 | 431,6 | 2.855,6 | **2.424,0** | **0,998** | 2.412,0 |
| `o2A` | 30B (trong lượt chồng lấn) | 16612 | 16.871,0 | 431,6 | 17.131,8 | **16.700,2** | **0,990** | (chồng lấn — xem §4) |
| `o2B` | 4B (trong lượt chồng lấn) | 30356 | 2.428,4 | 431,6 | 2.855,6 | **2.424,0** | **0,998** | (chồng lấn — xem §4) |
| `ovA` | 30B (lượt chồng lấn 1) | 33088 | 16.871,0 | 431,6 | 17.131,8 | **16.700,2** | **0,990** | (chồng lấn) |
| `ovB` | Qwen3-Embedding-0.6B-f16 (lượt chồng lấn 1) | 38612 | 1.142,1 | 431,6 | 1.569,6 | **1.138,0** | **0,996** | 1.136,0 |

**Phát biểu:** *PID 17876, trước nạp 431,6 MiB, sau nạp 17.131,8 MiB, chênh 16.700,2 MiB; kích thước
file model trên đĩa 16.871,0 MiB; tỉ lệ D/F = 0,990.*
*PID 19212, trước nạp 431,6 MiB, sau nạp 1.569,6 MiB, chênh 1.138,0 MiB; file 1.142,1 MiB;
D/F = 0,996.*

D/F nằm trong **0,990–0,998** trên dải kích thước **gấp 15 lần** (1,1 GB → 16,9 MiB… → 16,9 GB).
Phần thiếu vài MiB là metadata GGUF không lên GPU. Đây **không thể là nhiễu**: nhiễu không bám theo
kích thước file với sai số dưới 1%.

### Ba khoản phụ, cùng đo được

- **Backend CUDA** (`getLlama({gpu:"auto"})`, chưa nạp model gì): **+431,6 MiB**, đọc được ở
  **5/5** tiến trình, byte-y-hệt. Khớp con số `+431/+430/+431 MiB` mà Pha 1 đo bằng thước khác
  (`aiGgufEngine.ts:378-379`) — **kiểm chứng chéo độc lập**.
- **KV-cache** (`createContext({contextSize:4096, sequences:4, flashAttention:true})` trên 4B):
  bộ đếm **+2.606,1 MiB**, `nvidia-smi` **+2.606,0 MiB** — lệch **0,1 MiB**.
- **Nhả**: tiến trình thoát ⇒ instance biến mất khỏi danh sách (22 → 21), PID đọc 0, thiết bị về
  1.096–1.099 MiB (nền 1.097–1.100).

### Số lần thử nạp (cạm bẫy #4)

**7 lượt nạp model, 7 thành công, 0 hỏng.** Riêng 30B: **3 lượt thử / 3 thành công**.
⚠ Điều này **KHÔNG bác bỏ** hành vi "3 OK / 9 HỎNG" đã ghi nhận — n=3 quá nhỏ. Chỉ ghi nhận rằng
trong phiên này tôi không gặp lượt hỏng nào và **không phải thử lại lần nào**.

---

## 3. CÂU 2 — bộ đếm có phải THƯỚC KHÁC không, lệch bao nhiêu?

### 3a. Lệch TUYỆT ĐỐI — ổn định, KHÔNG trôi

`tổng mọi PID (bộ đếm) − nvidia-smi toàn thiết bị`:

| Thời điểm | Bối cảnh | Tổng bộ đếm (MiB) | nvidia-smi (MiB) | **Lệch (MiB)** |
|---|---|---|---|---|
| 8 mẫu liên tiếp, cách 1,8 s | GPU rảnh | 1.606,4 (×8) | 1.101 (×8) | **505,4** (×8) |
| `emb1` S0 / S1 / S2c / S3 | 0 → 1,5 GB → 0 | 1.611,7 / 2.041,5 / 3.179,5 / 1.604,9 | 1.103 / 1.533 / 2.671 / 1.099 | 508,7 / 508,5 / 508,5 / 505,9 |
| `big1` S0 / S1 / S2c / S3 | 0 → 17,1 GB → 0 | 1.608,0 / 2.038,4 / 18.738,5 / 1.601,7 | 1.100 / 1.530 / 18.230 / 1.096 | 508,0 / 508,4 / 508,5 / 505,7 |
| `overlap` A0 / B1 / A1 / Z | 2 tiến trình, → 19,8 GB | 2.472,0 / 3.607,9 / 20.302,1 / 20.302,1 | 1.961 / 3.097 / 19.791 / 19.791 | 511,0 / 510,9 / 511,1 / 511,1 |
| `overlap2` A0 / B0 / B1 / A1 | 2 tiến trình, → 21,1 GB | (xem CSV) | 1.965 / 1.960 / 21.077 / 21.077 | 511,0 / 510,7 / 510,9 / 510,9 |
| Mẫu cuối, sau dọn dẹp | GPU rảnh | 1.602,2 | 1.097 | **505,2** |

**Biên độ toàn phiên: 505,2 – 511,1 MiB, tức trải rộng 5,9 MiB — trong khi mức dùng thiết bị dao
động từ 1.097 lên 21.077 MiB (gần 20 GB).** Lệch là **hằng số cộng**, không tỉ lệ với tải, không
trôi. (Brief ghi ~300 MiB ở lần thử sơ bộ; hôm nay ~506 MiB — khác vì tập tiến trình desktop khác,
không phải vì thước trôi.)

**Hai kiểm chứng loại trừ nguyên nhân giả:**
1. **Không phải do trộn adapter.** Máy có 4 LUID (`0x16D43`, `0x18182`, `0x181D4`, `0x181D4#1`).
   Toàn bộ 1.603,2 MiB nằm trên **một** LUID `0x00000000_0x00016D43_phys_0`; ba LUID kia đọc **0
   MiB**. Vậy phép cộng của tôi không phình vì iGPU.
2. **Không phải do chọn API.** Cùng thời điểm: `Get-Counter` = 1.603,2 MiB (21 PID);
   `System.Diagnostics.PerformanceCounter` (.NET/PDH) = 1.603,2 MiB (21 PID); **mọi PID khớp trong
   1 MiB**. Lệch là tính chất của **bộ đếm WDDM**, không phải của cách đọc.

**Nguyên nhân lệch: KHÔNG TRẢ LỜI ĐƯỢC.** Tôi định lượng được và chứng minh được nó hằng số trong
phiên này; tôi không có bằng chứng nào về cơ chế, nên không đoán.

### 3b. Lệch theo CHÊNH LỆCH — cái thật sự quan trọng

Trong **cùng một cửa sổ**, chỉ tính các cửa sổ **không có tiến trình khác cấp phát**:

| Cửa sổ | Δ bộ đếm của PID ta (MiB) | Δ nvidia-smi toàn thiết bị (MiB) | **\|lệch\|** |
|---|---|---|---|
| `emb1` backend | 431,6 | 430,0 | 1,6 |
| `big1` backend | 431,6 | 430,0 | 1,6 |
| `emb1` loadModel | 1.138,0 | 1.138,0 | **0,0** |
| `big1` loadModel | 16.700,2 | 16.700,0 | **0,2** |
| `overlap` cửa sổ B (không chồng) | 1.138,0 | 1.136,0 | 2,0 |
| `ctx1` loadModel | 2.424,0 | 2.412,0 | **12,0** |
| `ctx1` createContext | 2.606,1 | 2.606,0 | **0,1** |

**Lệch theo chênh lệch: 0,0 – 12,0 MiB (trung vị 1,6 MiB)** trên các delta từ 430 đến 16.700 MiB.

Ô 12,0 MiB đáng nói: `nvidia-smi` báo **THẤP hơn** (2.412 < 2.424), tức trong cửa sổ đó một tiến
trình desktop khác **nhả** ~12 MiB. Nói cách khác ô này là bằng chứng **ủng hộ** bộ đếm: thước
toàn-thiết-bị bị nhiễm bởi mọi tiến trình khác, thước theo-PID thì không.

**Kết luận 3b:** lệch hằng số 506 MiB ở §3a **KHÔNG ảnh hưởng** tới broker, vì broker chỉ dùng
chênh lệch. Sai số tệ nhất 12 MiB = **2,3%** ngưỡng báo động 512 MiB.

---

## 4. CÂU 3 — có sống sót khi CHỒNG NHAU không? → **CÓ. Đây là bằng chứng gỡ cổng.**

### Lượt 1 (`overlap`) — hai cửa sổ mở CÙNG LÚC

A = 30B (PID 33088), B = Embedding-0.6B (PID 38612), `go2` bắn đồng thời.

| Mốc | t | smi (MiB) | tổng bộ đếm | **A (MiB)** | **B (MiB)** |
|---|---|---|---|---|---|
| A0 hai backend đã lên, chưa model | 17:31:22.426 | 1.961 | 2.472,0 | 431,6 | 431,6 |
| B1 B nạp xong | 17:31:24.138 | 3.097 | 3.607,9 | 431,6 | 1.569,6 |
| A1 A nạp xong | 17:31:33.513 | 19.791 | 20.302,1 | 17.131,8 | 1.569,6 |

- Cửa sổ **A** (11,1 s) **bao trọn** cửa sổ B ⇒ `nvidia-smi` cho A = **17.830 MiB**, sai
  **+1.130 MiB** (đúng bằng khối của B). Bộ đếm cho A = **16.700,2 MiB**, đúng.
- Tổng hai bộ đếm 17.838,2 vs Δsmi toàn thiết bị 17.830 ⇒ khớp trong **8,2 MiB (0,05%)**: sổ theo
  PID **cộng lại đúng bằng** sự thật thiết bị.
- Quan sát phụ quan trọng: **30B cấp phát trong MỘT CỤM ~275 ms** ở cuối lượt nạp (17:31:25.194 →
  17:31:25.469); phần lớn 11 s là đọc file. Nên ở lượt 1, cụm đó rơi **ngoài** cửa sổ B ⇒ Δsmi của
  B tình cờ vẫn đúng (1.136 vs 1.138). Vì vậy phải chạy lượt 2.

### Lượt 2 (`overlap2`) — cửa sổ nhỏ **LỒNG TRONG** cụm cấp phát của model lớn

A = 30B (PID 16612), B = 4B (PID 30356), `go2` của B trễ 1,5 s.

| Mốc | t | smi (MiB) | **A (MiB)** | **B (MiB)** |
|---|---|---|---|---|
| A0 mở cửa sổ A | 17:33:04.430 | 1.965 | 431,6 | 431,6 |
| B0 mở cửa sổ B | 17:33:06.109 | 1.960 | 431,6 | 431,6 |
| B1 đóng cửa sổ B | 17:33:13.500 | 21.077 | 17.131,8 | 2.855,6 |
| A1 đóng cửa sổ A | 17:33:15.723 | 21.077 | 17.131,8 | 2.855,6 |

Chồng lấn **THẬT**: trong cửa sổ B, PID A cấp phát **16.700,2 MiB**.

| | Bộ đếm theo PID | Sai so file | `nvidia-smi` toàn thiết bị | Sai so file |
|---|---|---|---|---|
| **Cửa sổ B** (7,39 s), file 2.428,4 MiB | **2.424,0 MiB** | **−4,4 MiB (−0,18%)** | **19.117 MiB** | **+16.688,6 MiB (+687%)** |
| **Cửa sổ A** (11,29 s), file 16.871,0 MiB | **16.700,2 MiB** | **−170,8 MiB (−1,01%)** | **19.112 MiB** | **+2.241 MiB (+13,3%)** |

**Đây chính là kỳ vọng phải kiểm, và nó đạt:** hai con số riêng biệt, mỗi con gần đúng model tương
ứng (sai −0,18% và −1,01%), trong khi `nvidia-smi` cho **một tổng** gán cho **cả hai** giấy phép —
sai 687% cho model nhỏ.

Đây đúng cơ chế sinh `measureFailed` hôm nay, và bộ đếm theo PID **giải quyết được nó**, với điều
kiện hai lượt nạp nằm ở **hai tiến trình khác nhau** (Đ1).

---

## 5. CÂU 4 — chi phí đọc

### Đo từ PowerShell đã ấm (n=12 mỗi đường)

| Đường | p50 | min | max | Ghi chú |
|---|---|---|---|---|
| `Get-Counter` (wildcard, mọi instance) | **1.016,4 ms** | 1.005,1 | 1.212,7 | **VƯỢT 1 GIÂY** |
| `typeperf … -sc 1` | 1.183,8 ms | — | — | 1 mẫu, **không rẻ hơn** |
| **.NET `PerformanceCounter` (PDH)**, 32 instance | **4,3 ms** | 3,9 | 4,8 | lượt đầu 615,2 ms (khởi tạo category, một lần) |
| `nvidia-smi --query-gpu=memory.used` (đối chiếu) | 47,2 ms | 44,5 | 58,4 | |

`Get-Counter` p50 = **1.016 ms** — **vượt 1 giây, phải nói rõ**. Nguyên nhân là hành vi lấy mẫu của
chính cmdlet, không phải của PDH: cùng dữ liệu, cùng máy, cùng thời điểm, đường .NET đọc trong
**4,3 ms** — **rẻ hơn 236 lần** — và cho **giá trị y hệt** (§3a).

### Đo TỪ NODE — con số thật cho broker (n=10)

Broker chạy trong Node, không chạy trong PowerShell. Spawn tiến trình mỗi lượt đọc:

| Đường thực thi từ Node | p50 | min | max |
|---|---|---|---|
| `powershell.exe` + PDH (.NET) | **759,6 ms** | 687,3 | 852,4 |
| `powershell.exe` + `Get-Counter` | **1.341,9 ms** | 1.310,4 | 1.373,7 |
| `nvidia-smi` (đối chiếu) | 57,1 ms | 47,4 | 65,2 |
| `powershell.exe` **rỗng** (chỉ chi phí khởi tạo tiến trình) | 123,0 ms | 114,7 | 129,7 |

Broker đọc **2 lần mỗi lượt nạp** ⇒ chi phí thêm mỗi lượt nạp:
- spawn PowerShell + PDH: **~1,52 s**
- spawn PowerShell + `Get-Counter`: **~2,68 s**
- (hiện tại với `nvidia-smi`: ~0,11 s)

### Đường rẻ hơn — GHI NHẬN, KHÔNG triển khai (theo brief)

1. **Helper sống lâu**: một tiến trình PowerShell/.NET giữ PDH handle ấm, Node nói chuyện qua
   stdin/stdout. Đọc thật 4,3 ms + IPC. **Chưa dựng, chưa đo đầu-cuối.** Rẻ nhất về chi phí đọc,
   đắt nhất về vòng đời (thêm một tiến trình phải trông).
2. **Native addon gọi thẳng `pdh.dll`** (`PdhOpenQuery`/`PdhAddCounter`/`PdhCollectQueryData`) qua
   koffi/node-ffi. Không thêm tiến trình. **Chưa thử.**
3. `typeperf` — **đã đo, 1.183,8 ms, loại**.

⚠ **Con số 4,3 ms KHÔNG dùng được để lập kế hoạch nếu Pha 2 định spawn tiến trình mỗi lượt đọc.**
Con số phải dùng khi đó là **760 ms**.

---

## 6. NHỮNG ĐIỀU PHÉP THỬ NÀY **KHÔNG NÓI ĐƯỢC**

1. **Chồng lấn TRONG CÙNG một tiến trình.** Tôi chỉ thử tiến trình riêng. `aiGgufEngine` nạp model
   in-process và `inFlightLoads` khoá theo modelId ⇒ hai model khác nhau nạp song song trong một
   PID vẫn **không tách được**. Đây là lỗ hổng lớn nhất còn lại.
2. **Compute buffer cấp phát LƯỜI** ở lượt suy luận đầu tiên (`vramWiring` đã ghi rõ `actualBytes`
   chưa gồm khoản này). Tôi **không chạy suy luận lần nào**.
3. **Tiến trình `npm run kb:sync` THẬT.** Tôi dựng tiến trình node của riêng mình. Không biết cây
   `npm → cmd → node` thực tế sinh mấy PID, mỗi PID giữ bao nhiêu, và giấy phép phải bám PID nào.
4. **Sidecar thị giác `llama-server.exe`** (khoản 7,8 GB từng vắng mặt khỏi mọi phép cộng). Cấu
   trúc gợi ý nó sẽ hiện dưới PID riêng — nhưng **CHƯA KIỂM**.
5. **Chi phí đọc khi số instance lớn hơn.** 32 instance là mức desktop rảnh. Không biết chi phí
   tăng thế nào theo số instance / dưới tải GPU nặng.
6. **Nguyên nhân lệch 505–511 MiB.** Định lượng được, không giải thích được. Không biết nó có đổi
   sau reboot / đổi driver không.
7. **Độ trễ cập nhật của bộ đếm sau `cudaMalloc`.** Tôi luôn chờ ≥800 ms. Chuỗi thời gian gợi ý
   <460 ms nhưng **không đo trực tiếp**. Nếu broker đọc NGAY sau `loadModel()` mà bộ đếm trễ, số sẽ
   hụt.
8. **Tái sử dụng PID.** Windows tái dùng số PID. Nếu một PID chết và một PID mới trùng số ra đời
   giữa hai đầu đo, số sẽ sai âm thầm. **Chưa kiểm.**
9. **Quyền đọc bộ đếm** khi app chạy dưới tài khoản service / user khác. Tôi chạy cùng user với
   các tiến trình đo.
10. **Một máy, một driver (610.62), một GPU, một phiên, 5 lượt chạy.** Không nói được gì về TCC
    mode, đa GPU, driver khác, hay máy khác.
11. **Hành vi hỏng ngẫu nhiên của 30B.** 3/3 thành công ở đây **không** bác bỏ "3 OK / 9 HỎNG";
    n=3 quá nhỏ.
12. **`Shared Usage` / `Non Local Usage` / `Total Committed`.** Tôi chỉ đọc `Dedicated Usage`.
    Nếu model tràn sang system memory (`gpuLayers:"auto"` khi hết VRAM), khoản tràn đó **có thể**
    không nằm trong `Dedicated Usage` — **CHƯA KIỂM**.

---

## 7. PHỤ LỤC

### Script (scratchpad, không thuộc repo)
| File | Vai trò |
|---|---|
| `t511-child.mjs` | Tiến trình con nạp model. Bắt tay bằng FILE, **không ống stdio**. Ba/bốn cổng: `booted → backend → loaded → ctxdone`. |
| `t511-lib.ps1` | `Read-GpuProcMem` (PDH .NET, ~4 ms), `Read-GpuProcMemSlow` (Get-Counter), `Read-SmiUsedMiB`, `Wait-Phase`. |
| `t511-run.ps1` | Một model, một tiến trình (Câu 1 + 2b). |
| `t511-overlap.ps1` | Hai tiến trình, `go2` đồng thời (Câu 3, lượt 1). |
| `t511-overlap2.ps1` | Hai tiến trình, cửa sổ nhỏ lồng trong cụm cấp phát của model lớn (Câu 3, lượt 2 — quyết định). |
| `t511-ctx.ps1` | Kiểm đường cấp phát KV-cache. |
| `t511-nodecost.mjs` | Chi phí đọc **từ Node** (Câu 4). |
| `t511run/*.csv`, `t511run/*.log` | Chuỗi thời gian thô + log của từng tiến trình con. |

### Cạm bẫy — đã né được cả bốn
1. **Ống stdio**: dùng `Start-Process -WindowStyle Hidden` (không redirect ⇒ không pipe), con tự ghi
   log bằng `fs.appendFileSync`. **Không lượt nào treo.**
2. **Dọn tiến trình**: chỉ `Stop-Process` theo **PID lấy từ `Start-Process -PassThru`**, không quét
   theo tên. Kiểm cuối: 0 `node.exe` khớp `t511-child`, `nvidia-smi` về 1.097 MiB.
3. Không dùng `tasklist`; dùng `Get-Process` / `Get-CimInstance Win32_Process`.
4. 30B: 3 lượt thử, 3 thành công, 0 lần phải thử lại.

### Hai lỗi kỹ thuật gặp trong lúc dựng (không phải phát hiện sản phẩm)
- Script trong scratchpad **không resolve được** `import("node-llama-cpp")` — ESM resolve theo vị
  trí FILE chứ không theo cwd. Sửa: trỏ tuyệt đối `pathToFileURL(<repo>/node_modules/node-llama-cpp/dist/index.js)`.
- `PerformanceCounter(category, counter, instance, readOnly)` — thứ tự tham số là
  (category, **counterName**, **instanceName**), dễ đảo.
