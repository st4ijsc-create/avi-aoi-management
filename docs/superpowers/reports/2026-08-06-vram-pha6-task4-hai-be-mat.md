# Pha 6 · Task 4 — N1 + N4: hai bề mặt CHƯA TỪNG CHẠY

> Kế hoạch: `docs/superpowers/plans/2026-08-06-vram-pha6-backlog.md` §"Task 4".
> Nhánh `feat/hmi-dep`, HEAD lúc bắt đầu = `a9f155f9`.
> **Task này ĐO. Không vá mã sản xuất để lượt nghiệm thu qua.**
> Báo cáo được ghi **DẦN sau MỖI bước** (một lượt trước đã chết vì hết hạn mức và mất trắng).

---

## 0. Bối cảnh + số TRƯỚC (Bước 0 — chưa đụng gì)

**Đo lúc `2026-08-07T07:17:05Z`** (đồng hồ UTC của máy chạy lệnh).

| ô | số | nguồn đo |
|---|---|---|
| `nvidia-smi` bộ nhớ dùng | **1.603 MiB** / 32.607 MiB | `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader` |
| máy chủ đang chạy | PID **30108** (`node dist/index.js`), cha `27372` (`cross-env NODE_ENV=production`) | `Get-CimInstance Win32_Process` |
| cổng của PID 30108 | **:3000** (IPv6 `::`), thêm :1883/:8883 (MQTT) | `Get-NetTCPConnection -OwningProcess 30108` |
| cổng 3100 / 3101 | **TRỐNG** | `Get-NetTCPConnection -LocalPort 3100,3101` |
| `vram_leases` | **4 hàng**, tất cả của `all:30108:1786058062019` + `vram:baseline` | `psql` trực tiếp (`docker exec avi-aoi-management-postgres-1`) |

`vram_leases` nguyên văn lúc bắt đầu:

```
             leaseKey             |       processKey        |   bytes    |            owner
----------------------------------+-------------------------+------------+-----------------------------
 all:30108:1786058062019#lease-1  | all:30108:1786058062019 |  452595712 | cuda-backend
 all:30108:1786058062019#lease-10 | all:30108:1786058062019 |          0 | reranker:…bge-reranker-v2-m3-Q8_0.gguf
 all:30108:1786058062019#lease-9  | all:30108:1786058062019 |          0 | cuda-backend:reranker
 vram:baseline                    | all:30108:1786058062019 | 1372479488 | reconciler:baseline
(4 rows)
```

⚠ **Ghi nhận một điều KHÔNG khớp giả định của brief:** `dist/index.js` có mtime **13:16 giờ máy**
(≈ `06:16Z`), tức **mới hơn** lượt khởi động của PID 30108 (`06:14:20` giờ máy = trước đó). ⇒ Bản
mã mà PID 30108 đang **phục vụ** KHÔNG phải bản đang nằm trên đĩa. Điều này **không** làm hỏng phép
đo N1 (PID 30108 chỉ đóng vai người **ra lệnh**), nhưng nó là một biến số phải khai.

### Tài khoản dùng để ra lệnh (KHÔNG cấp quyền, chỉ ĐỌC lại)

| user | id | vai | `machine_control` | `vram_control` |
|---|---|---|---|---|
| `supervisor1` | 49 | `supervisor` | `canView=t` | `canCreate=t`, **`canDelete=t`** |
| `engineer1` | 51 | `engineer` | `canView=t` | `canCreate=t`, `canDelete=f` |

⇒ **`supervisor1` là danh tính DUY NHẤT với tới `vram.releaseStale`** (cần role-floor
`actuationProcedure` = admin/supervisor/engineer **và** `vram_control/canDelete`).
**Không cấp thêm bit nào** — bảng trên là kết quả `SELECT`, không phải một lượt `UPDATE`.

---

## 1. N1 — `releaseStale` ĐÃ CÓ LƯỢT THÀNH CÔNG ĐẦU TIÊN (Bước 1 + 2)

### 1.1 Cách dựng cảnh (và vì sao đúng cách này)

Hai tiến trình THẬT, DB thật, không stub, không sửa một dòng mã sản xuất:

| vai | tiến trình | lệnh | vì sao |
|---|---|---|---|
| **A — kẻ sẽ chết** | PID **26196**, `api:26196:1786087131316` | `ROLE=api PORT=3100 NODE_ENV=production node dist/index.js` | `ROLE=api` **có chủ ý**: không chạy cron scheduler ⇒ không đụng retention/backup |
| **B — kẻ ra lệnh** | PID **30108**, `all:30108:1786058062019` | máy chủ ĐANG CHẠY sẵn (:3000) — **không giết, không khởi động lại** | nó là chỗ duy nhất có phiên đăng nhập thật + panel |

⚠⚠ **Cửa sổ thời gian là RÀNG BUỘC CỨNG, và nó chính là lý do Pha 4 KHÔNG dựng được lượt này**
(nợ U4 của báo cáo Pha 4). `startVramReconciler()` chạy ở **MỌI** vai trò (`server/_core/index.ts:5268`,
`ring = SERVER_ROLE !== "api"` — chỉ **tiếng chuông** bị tắt cho `api`, **không** phải nhịp), và nhịp
đó **tự dọn hàng ma**. ⇒ Sau khi giết A, hàng ma chỉ sống tới nhịp kế tiếp của B.
**Lời giải: căn nhịp.** Đo `foreign.ageMs` của B qua `vram.state` cho tới khi nó **về 0** (nhịp vừa
chạy), rồi mới giết A ⇒ có gần trọn **60 giây** để ra lệnh.

```
2026-08-07T07:20:16.310Z ageMs 47020 holders 2
2026-08-07T07:20:24.375Z ageMs 55087 holders 2
2026-08-07T07:20:29.110Z ageMs     0 holders 3   ← CỬA SỔ MỞ
```

### 1.2 Bảng đo — cảnh → kỳ vọng → ĐO ĐƯỢC → ĐẠT/HỎNG

| # | cảnh | kỳ vọng | **ĐO ĐƯỢC** (nguyên văn từ HTTP 200) | chấm |
|---|---|---|---|---|
| **N1-1** | hàng ma `…#lease-6` (`gguf:Qwen3-Embedding-0.6B-f16`) | `outcome:"released"` | `released` · `freedBytes` **1.193.291.776** · `rowKind:"sibling-lease"` · `foreignBytesBefore` 2.197.463.040 → `After` **1.004.171.264** · `durability:"queued-for-shared-ledger"` · `unsyncedWritesAfter:1` | ✅ **ĐẠT** |
| **N1-2** | hàng ma `…#lease-1` (`cuda-backend`) | `released` | `released` · `freedBytes` **452.595.712** · 1.004.171.264 → **551.575.552** · `unsyncedWritesAfter:2` | ✅ **ĐẠT** |
| **N1-3** | hàng ma `…#lease-7` (`gguf-embed-ctx:…`) | `released` | `released` · `freedBytes` **551.575.552** · 551.575.552 → **0** · `unsyncedWritesAfter:3` | ✅ **ĐẠT** |
| **N1-4** | ĐỐI CHỨNG ÂM — hàng của **chính** B (`all:30108…#lease-1`) | **refused** | `refused` / **`own-row-local-ledger-is-authority`** · `freedBytes:0` · `durability:null` | ✅ **ĐẠT** |
| **N1-5** | ĐỐI CHỨNG — hàng **NỀN** `vram:baseline` | refused (B đứng tên nền) | `refused` / **`own-row-local-ledger-is-authority`** | ✅ ĐẠT (⚠ xem "đường CHƯA đi" — nhánh `rowKind:"shared-baseline"` **không** chạm được từ đây) |
| **N1-6** | ĐỐI CHỨNG — khoá bịa `…#lease-99` | refused | `refused` / **`row-not-in-shared-ledger-replica"`** · `processKey:null` | ✅ **ĐẠT** |
| **N1-7** | **BỀN** — hàng có RỜI DB không | 3 hàng biến mất ở lượt `syncSharedLedger()` kế tiếp | `07:21:19` 7 hàng/3 ma → `07:21:27` 7/3 → **`07:21:35` 4 hàng / 0 ma** | ✅ **ĐẠT** |

⇒ **Cổng ra N1 ĐẠT: `releaseStale` có ba lượt `released` đo được, và câu chữ trả về nói ĐÚNG chuyện
đã xảy ra** — nó khai `queued-for-shared-ledger` (chưa vào DB) **đúng lúc hàng thật sự chưa vào DB**,
và hàng rời DB **16 giây sau**, đúng ở nhịp kế tiếp.

### 1.3 `nvidia-smi` TRƯỚC / SAU cho lượt thu hồi

| mốc | `nvidia-smi memory.used` | ghi chú |
|---|---|---|
| trước khi giết A | **3.807 MiB** | A đã nạp `cuda-backend` + ngữ cảnh nhúng |
| **ngay sau `taskkill /F /PID 26196 /T`**, TRƯỚC lệnh `releaseStale` | **1.584 MiB** | **−2.223 MiB** |
| sau cả ba lệnh `releaseStale` | **1.580 MiB** | **−4 MiB** (nhiễu desktop) |

⚠⚠ **PHẢI ĐỌC ĐÚNG, ĐỪNG GỘP HAI CON SỐ NÀY:** `releaseStale` **KHÔNG giải phóng một byte thiết bị
nào** và **không được** khai như vậy. Byte thiết bị rời card là do **cú giết tiến trình**; `releaseStale`
dọn **hàng trong SỔ CHUNG** — thứ đang làm mọi tiến trình anh em **trừ dư địa cho một khối byte không
tồn tại**. Hai thước, hai đại lượng:

- **sổ**: `1.193.291.776 + 452.595.712 + 551.575.552 = 2.197.463.040 B = 2.095,7 MiB` giành lại **trong sổ**;
- **thiết bị**: `2.223 MiB` rời card **do cú giết**.
- Lệch **127,3 MiB** — chính là phần A chiếm trên card mà **không** có giấy phép trong sổ (nền/ngữ
  cảnh CUDA của A). Đây là số **ủng hộ** kết luận Đợt 0/Pha 2A: sổ là **cận dưới**, không phải bằng nhau.

### 1.4 ★★ Một quan sát PHỤ, và nó là lớp lỗi Pha 3 đã trả giá

`taskkill` in **`SUCCESS: The process with PID 26196 … has been terminated.`** lúc `07:20:34.1`, và
lượt `Get-Process -Id 26196` chạy **NGAY SAU ĐÓ** vẫn trả **`True`**. Lượt `releaseStale` **0,4 giây
sau** thì bảng tiến trình đã sạch (`released`, tức `trangThaiTienTrinh` khai *"đã chết"*).
⇒ Đúng bài học Pha 3: ***"`kill(pid,0)` KHÔNG phải quan sát cái chết"*** — nay đo lại được ở đầu
`taskkill` + `Get-Process`, độ trễ **≲ 400 ms** (⚠ có lẫn ~300 ms chi phí khởi động PowerShell, nên
đây là **cận trên**, không phải phép đo sạch).

### 1.5 Một trạng thái SUY GIẢM tự hiện ra giữa lượt N1 (bắc cầu sang N4)

Ngay sau lượt `released` đầu tiên, `vram.state` của B đổi:

```
trước:  {"basis":"ledger","blind":false,"trusted":true,  "degradedReasons":[]}
sau:    {"basis":"ledger","blind":false,"trusted":false, "degradedReasons":["shared-ledger-unsynced"]}
```

⚠ **`"shared-ledger-unsynced"` KHÔNG có trong `HeadroomDegradation`** của `vramHeadroom.ts`
(`"invalid-input" | "no-tick" | "probe-blind" | "unverified-baseline"`). ⇒ **Từ vựng suy giảm của mặt
đọc RỘNG HƠN từ vựng của `computeHeadroom`.** Đây là bằng chứng đầu tiên trong task này cho câu
*"cái gì liệt kê thì luôn có phần tử thứ N+1"* — và nó đổi cách N4 phải được làm: **không** đi theo
danh sách 5 trạng thái của brief, mà phải **liệt kê từ MÃ** rồi phủ **VỚI MỌI** phần tử.

---

## 2. 🔴 PHÁT HIỆN NGOÀI KẾ HOẠCH, BẮT ĐƯỢC Ở BƯỚC ĐẦU CỦA N4 — **`/ai-brain` ĐANG CHẾT TRÊN BẢN ĐANG PHỤC VỤ**

Lượt đầu tiên mở màn để chụp mặt suy giảm **không chụp được gì**, vì trang không render.

**Ảnh (đã TỰ CHỤP + TỰ ĐỌC bằng `Read`):**
`docs/superpowers/reports/assets/2026-08-06-vram-pha6-task4/n4-00-panel-crash-version-skew.png`
— khung nội dung chỉ có **"Đã xảy ra lỗi / Không thể hiển thị nội dung / [Thử lại]"**.
⚠ **KHÔNG phải ảnh trắng** (ảnh trắng = thất bại khởi động): khung điều hướng, breadcrumb
`AI › Vận hành Agent › AI Brain`, và người dùng đang đăng nhập đều render đủ — **đúng một** cây
component chết vào `ErrorBoundary`.

**Nguyên văn console của trình duyệt:**

```
TypeError: Cannot read properties of undefined (reading 'bytesAtReadMs')
    at We (http://localhost:3000/assets/AIBrainDashboard-BiEgHVZJ.js:1:7005)
ErrorBoundary caught an error: …
```

### Chẩn đoán (đo, không đoán)

| ô | đo được | cách đo |
|---|---|---|
| `dist/index.js` **trên đĩa** có `bytesAtReadMs` | **CÓ** | đọc file, `includes()` |
| `dist/public/assets/AIBrainDashboard-*.js` có `bytesAtReadMs` | **CÓ** | như trên |
| `vram.state` do **PID 30108** trả về | `{"rawBytes":…,"effectiveBytes":30516637696,…}` — **KHÔNG có `effective`** | HTTP thật, phiên `supervisor1` |
| mã nguồn `a9f155f9` | `headroom.effective.bytesAtReadMs` (`vramReadModel.ts:1295`) | `git`/đọc mã |

⇒ **LỆCH PHIÊN BẢN**: PID 30108 nạp `dist/index.js` vào bộ nhớ lúc `06:14` và **giữ mã cũ**
(`ebfec4a5`, trước Pha 6 Task 2), trong khi `dist/public/` được đọc **từ đĩa theo từng request** nên
trình duyệt nhận **client MỚI** (`a9f155f9`). Client mới đọc `s.headroom.effective.bytesAtReadMs`
**không một lớp bảo vệ nào**; server cũ trả `effectiveBytes` **phẳng** ⇒ `undefined.bytesAtReadMs` ⇒ nổ.

### Vì sao đây là một phát hiện, không phải một tai nạn của phòng thí nghiệm

Pha 6 **Task 2 ĐỔI KIỂU `effectiveBytes` → `effective.{…}` một cách PHÁ VỠ** (đó chính là mục tiêu
của task: làm cho nó **không dùng được** như một bất biến trước/sau). Nhưng hệ quả triển khai chưa ai
khai: **thứ tự deploy client-trước-server làm CHẾT CẢ TRANG `/ai-brain`**, không phải suy giảm một ô.
Panel VRAM là **nhà DUY NHẤT** của mặt lệnh VRAM (`navigation.tsx:1383`) ⇒ mất trang này là **mất
toàn bộ mặt lệnh VRAM** cho người vận hành.

⚠ **KHÔNG VÁ** (task này ĐO, và ràng buộc cấm vá mã sản xuất để lượt nghiệm thu qua). **Khai như một
mục nợ MỚI SINH RA TỪ CHÍNH PHA 6** — xem §6.

**Hệ quả với chính lượt đo này:** không thể làm N4 trên PID 30108. Phải dựng **tiến trình RIÊNG**
(`ROLE=api PORT=3100`) từ **cùng** `dist/` để server và client khớp phiên bản. Đã làm — xem §3.

---

## 3. N4 — MẶT SUY GIẢM ĐÃ RENDER (Bước 3 + 4)

### 3.1 ⚠ ĐẢO LƯỢNG TỪ TRƯỚC ĐÃ — brief liệt kê **NĂM**, mã có **NHIỀU HƠN**

Brief nêu `blind` · `ledger-only` · `trusted:false` · tick cũ · `-Infinity`. **Không đi theo danh sách
ấy.** Liệt kê **TỪ MÃ** (`vramRefusal.ts:102` `VramDegradationReason`) cho **MƯỜI MỘT** lý do, và
`VramBrokerPanel.tsx` còn **mười lăm** ô suy giảm **KHÔNG** nằm trong `degradedReasons`.
Bất biến đúng là ***"VỚI MỌI phần tử của `VramDegradationReason` VÀ MỌI nhánh suy giảm của panel,
tồn tại một khung hình đã render và đã đọc được bằng mắt"*** — không phải *"tồn tại một trạng thái
suy giảm đã render"*.

⚠ Bằng chứng thực nghiệm rằng danh sách của brief thiếu: `"shared-ledger-unsynced"` **tự hiện ra**
giữa lượt N1 (§1.5) và nó **không có** trong `HeadroomDegradation`.

### 3.2 Cách dựng — hai TẦNG, và phải phân biệt cho rõ

| tầng | dữ liệu | dựng thế nào | ảnh |
|---|---|---|---|
| **A · THẬT** | 100 % payload của máy chủ, **không sửa một bit** | máy chủ vừa khởi động ⇒ nền **chưa xác minh** trong ~90 s đầu; **đóng băng** khung hình đầu bằng `page.route` (nhại lại chính response vừa nhận cho mọi lượt poll sau) | `n4-01` |
| **B · ÉP** | payload thật, **sửa đúng những ô cần** rồi đóng băng | `page.route` chặn `vram.state` trong **lô** tRPC, tìm chỉ số của `vram.state` theo đường dẫn URL, thay `result.data.json` | `n4-02`…`n4-07` |

⚠⚠ **VÌ SAO PHẢI CÓ TẦNG B, khai thẳng:** năm trong mười một lý do **không dựng được từ môi trường**
mà không sửa mã hoặc phá cấu hình sản xuất — `invalid-input` bị `assertHeadroomPolicy()` chặn ở boot,
`probe-blind`/`tick-failing` cần `nvidia-smi` hỏng, `no-tick` là *"gần như bất khả đạt trong sản xuất"*
(nguyên văn docstring `vramEnforcement.ts:181`), `stale-tick`/`shared-ledger-stale` cần bỏ đói nhịp
> 2 chu kỳ. **Ràng buộc "không vá mã sản xuất" được giữ**: không một dòng `server/**` hay `client/**`
nào bị sửa (chứng minh bằng `git status --porcelain -- server/ client/` = rỗng, §5).

⚠⚠⚠ **MỘT BẪY ĐO ĐÃ SẬP NGAY TRONG LƯỢT NÀY, ghi lại vì nó là bài học GOTCHA cũ tái diễn:** lượt
chụp đầu tiên của `n4-01` **đọc chữ thấy `ĐANG SUY GIẢM` nhưng ẢNH lại in `tin cậy`** — panel poll
mỗi 5 giây và trạng thái đã tự lành **giữa** lượt đọc `innerText` và lượt bấm máy ảnh. ⇒ *"tự chụp,
tự đọc"* **chưa đủ**; phải **ĐÓNG BĂNG khung hình** rồi mới chụp, nếu không hai bằng chứng nói hai
chuyện khác nhau về **hai thời điểm khác nhau**. Đó chính là lý do tầng A cũng phải đi qua `page.route`.

### 3.3 Bảng phủ — cảnh → kỳ vọng → ĐO ĐƯỢC → ĐẠT/HỎNG

**11/11 `VramDegradationReason`:**

| # | lý do | khung | **ĐO ĐƯỢC trên màn (đọc bằng mắt từ ảnh)** | chấm |
|---|---|---|---|---|
| 1 | `invalid-input` | B/`n4-03` | badge `invalid-input`; `KHÔNG BIẾT / 32,607 MiB` | ✅ |
| 2 | `no-tick` | B/`n4-02` | badge `no-tick` | ✅ |
| 3 | `probe-blind` | B/`n4-03` | badge `probe-blind` | ✅ |
| 4 | `unverified-baseline` | **A/`n4-01`** + B/`n4-02` | badge + `nền CHƯA xác minh · anh-em-tren-card-chua-duoc-tinh` | ✅ **THẬT** |
| 5 | `stale-tick` | B/`n4-04` | badge `stale-tick` | ✅ |
| 6 | `tick-failing` | B/`n4-03` | badge `tick-failing` | ✅ |
| 7 | `unledgered-unasked` | B/`n4-02` | badge `unledgered-unasked` | ✅ |
| 8 | `unledgered-unknown` | B/`n4-04`,`n4-05` | badge `unledgered-unknown` | ✅ |
| 9 | `shared-ledger-unasked` | B/`n4-02` | badge `shared-ledger-unasked` | ✅ |
| 10 | `shared-ledger-stale` | B/`n4-04` | badge `shared-ledger-stale` | ✅ |
| 11 | `shared-ledger-unsynced` | B/`n4-04` (+ **THẬT ở tầng API**, §1.5) | badge `shared-ledger-unsynced` | ✅ |

**15 ô suy giảm KHÔNG thuộc `degradedReasons`:**

| # | ô | khung | **ĐO ĐƯỢC** | chấm |
|---|---|---|---|---|
| 12 | `blind` | `n4-02`, `n4-03` | badge ĐỎ `MÙ — con số này là CHẶN TRÊN, không phải trạng thái an toàn` | ✅ |
| 13 | `basis: "ledger-only"` | `n4-02`, `n4-03` | `basis: ledger-only` | ✅ |
| 14 | `trusted: false` | **A/`n4-01`** + mọi khung B | `ĐANG SUY GIẢM` | ✅ **THẬT** |
| 15 | `-Infinity` ⇒ dư địa `null` | `n4-02` (cả **trần** cũng `null`), `n4-03` | `KHÔNG BIẾT / KHÔNG BIẾT` | ✅ |
| 16 | `nonFiniteFields` **KHÔNG rỗng** | `n4-02` (3 ô), `n4-03` (2 ô) | *"3 numeric field(s) were BLOCKED for being non-finite … headroom.rawBytes=-Infinity, headroom.effective.bytesAtReadMs=-Infinity, headroom.ceilingBytes=NaN"* | ✅ **đóng nợ U10 Pha 4** |
| 17 | `baseline.unverifiedReasons === null` | `n4-02` | `nền CHƯA xác minh · chưa có nhịp nào` | ✅ |
| 18 | `baseline.unverifiedReasons === []` | `n4-03` | `nền CHƯA xác minh` (KHÔNG hậu tố) | ✅ |
| 19 | `baseline.unverifiedReasons` **có phần tử** | **A/`n4-01`**, `n4-04` | `· anh-em-tren-card-chua-duoc-tinh` / `· nen-nhan-nuoi-qua-cu` | ✅ **THẬT** |
| 20 | `foreign.known === false` | `n4-02` | `anh em ĐANG MÙ (chưa làm mới sổ chung lần nào)` | ✅ |
| 21 | `estimateUsable === false` (n>0) | `n4-02` (3), `n4-04` (2) | *"…3 off-ledger allocation(s) could NOT be estimated, so this estimate is UNRELIABLE. Don't use it in calculations."* | ✅ **đóng nợ U10 Pha 4** |
| 22 | `estimateBytes === null` | `n4-02` | `Chạy NGOÀI sổ (ước lượng): KHÔNG BIẾT` | ✅ |
| 23 | `lastReason.truncated === true` | `n4-03` | `cudaMalloc failed: … [TRUNCATED AT THE SOURCE — 144/548 characters kept. The full value is NOT anywhere in this payload…]` | ✅ |
| 24 | hộ `ttlExpired` | `n4-04` | badge ĐỎ `quá TTL — KHÔNG có nhịp nào tự gặt, phải ra lệnh` | ✅ |
| 25 | hộ `measured === false` | `n4-04` | badge `ước lượng` | ✅ |
| 26 | `unattributed.*` `null` | `n4-02` | `Độ phủ của sổ: ?/? điểm cấp phát đã nối · ngoài sổ KHÔNG BIẾT` | ✅ |
| 27 | hộ nền `exceeded` / `deferring` / `not-observable-here` | `n4-05` | `đã quá đáy hoãn` (đỏ) · `đang hoãn` · *"It is UNDETERMINED whether this process hosts the holder"* | ✅ |
| 28 | mặt đọc **`denied`** | `n4-06` | *"You do not have permission to view VRAM state — the VIEW permission of the Machine Control module (machine_control) is required."* — **cả thẻ VRAM ở trên cũng đổi**, không khung xương giả | ✅ |
| 29 | mặt đọc **`unreadable`** | `n4-07` | *"VRAM state could not be read right now."* | ✅ |
| 30 | `reclaim: declared-by-owner-process` | **A/`n4-01`** | *"chỉ tiến trình chủ thu hồi được — lệnh từ đây sẽ bị từ chối"* | ✅ **THẬT** |

⇒ **Cổng ra N4 ĐẠT: 30/30 nhánh suy giảm có MỘT ảnh đọc được bằng mắt.**

### 3.4 Ảnh — TỰ CHỤP · TỰ ĐỌC bằng `Read` (không nhờ ai xác nhận hộ)

Thư mục `docs/superpowers/reports/assets/2026-08-06-vram-pha6-task4/`:

| ảnh | tầng | nội dung đã đọc bằng mắt |
|---|---|---|
| `n4-00-panel-crash-version-skew.png` | THẬT | `/ai-brain` trên **:3000** — cả trang vào `ErrorBoundary` (§2) |
| `n4-01-real-unverified-baseline.png` | **A · THẬT** | `ĐANG SUY GIẢM` · `unverified-baseline` · `nền CHƯA xác minh · anh-em-tren-card-chua-duoc-tinh` · hộ anh em + nút `Kiểm rồi dọn nếu đã chết` · nhánh *"chỉ tiến trình chủ thu hồi được"* |
| `n4-02-forced-blind-no-tick.png` | B | `KHÔNG BIẾT / KHÔNG BIẾT` · `ledger-only` · `MÙ` · `no-tick` `unverified-baseline` `shared-ledger-unasked` `unledgered-unasked` · `chưa có nhịp nào` · 3 ô bị chặn · `anh em ĐANG MÙ` · `?/?` |
| `n4-03-forced-invalid-input-neg-infinity.png` | B | `invalid-input` `probe-blind` `tick-failing` · `KHÔNG BIẾT / 32,607 MiB` · 2 ô `-Infinity` bị chặn · câu `cudaMalloc` **đã cắt và khai đã cắt (144/548)** |
| `n4-04-forced-stale-tick-shared-stale-unsynced.png` | B | `basis: attributable` · `stale-tick` `shared-ledger-stale` `shared-ledger-unsynced` `unledgered-unknown` · hộ `ước lượng` + `quá TTL` |
| `n4-05-forced-defer-exceeded.png` | B | `đã quá đáy hoãn` · `đang hoãn` · 2/6 nút `Thử lại ngay` bấm được, 4/6 khoá · *"UNDETERMINED whether this process hosts"* |
| `n4-06-forced-denied.png` | B | câu **từ chối quyền** ở CẢ thẻ VRAM lẫn panel |
| `n4-07-forced-unreadable.png` | B | *"VRAM state could not be read right now."* |

### 3.5 🔴 PHÁT HIỆN THỨ HAI — **26/29 nhãn của panel KHÔNG CÓ BẢN DỊCH NÀO, và `i18n:check` KHÔNG THẤY**

Mọi ảnh trên chụp với giao diện đang ở **`us English`**. Đọc bằng mắt: cùng một thẻ có
`ĐANG SUY GIẢM`, `MÙ — con số này là CHẶN TRÊN…`, `nền CHƯA xác minh`, `quá TTL — KHÔNG có nhịp nào
tự gặt, phải ra lệnh`, `đã quá đáy hoãn`, `ước lượng`, `Kiểm rồi dọn nếu đã chết`, `Hộ nền (background)`
**bằng TIẾNG VIỆT**, đứng cạnh các câu của `translateVram*` **bằng TIẾNG ANH**.

Đo được:

| ô | số |
|---|---|
| `t("vramBroker.*")` khác nhau trong `VramBrokerPanel.tsx` | **29** |
| khoá thật có trong `vramBroker` của `en.json` / `vi.json` / `zh.json` | **3 / 3 / 3** (`commandError`, `readDenied`, `readUnreadable` — do Pha 5 Task 3 thêm) |
| ⇒ khoá **không có bản dịch ở BẤT KỲ locale nào** | **26 / 29** |

⚠⚠ **Đây đúng lăng kính "hàng rào KHÔNG AI CANH":** `i18n:check` so **lệch giữa các locale**. 26 khoá
này **vắng ở cả ba** ⇒ **không lệch** ⇒ **cổng XANH**, trong khi bề mặt người vận hành đọc lúc hệ
đang hỏng là một mớ **hai thứ tiếng**. Cơ chế `t(key, fallback)` biến chuỗi tiếng Việt viết cứng
thành **giá trị mặc định cho MỌI ngôn ngữ**, và không cổng nào phát hiện được.
⚠ Nợ **CÓ TRƯỚC** Task 4 (panel viết từ Pha 4) — task này chỉ **ĐO** được nó, vì đây là lượt đầu
tiên bề mặt ấy được nhìn bằng mắt trên một giao diện **không phải tiếng Việt**.

---

## 4. ĐƯỜNG NÀO ĐÃ ĐI · ĐƯỜNG NÀO **CHƯA**

> *"Nghiệm thu sống chỉ chứng minh **ĐÚNG ĐƯỜNG MÌNH VỪA ĐI**"* — Wave 2 để lọt **40 %** đề xuất vô
> hình qua lượt live đầu. Mục này liệt kê **cả hai vế**, và vế dưới quan trọng hơn.

### ĐÃ ĐI

1. `POST /api/auth/login` + `/verify-2fa` — phiên THẬT `supervisor1`, TOTP sinh từ `two_factor_secret`.
2. `POST /api/trpc/vram.releaseStale` — **6 lượt** (3 `released` + 3 `refused`), qua role-floor +
   2FA + `requirePermission(vram_control, canDelete)` + step-up.
3. `GET /api/trpc/vram.state` — hàng chục lượt, hai tiến trình khác nhau, hai **phiên bản mã** khác nhau.
4. **Topology hai tiến trình THẬT** (`all:30108` + `api:{26196,31176,28468,6828}`), DB thật, sổ chung thật.
5. **Vòng đời hàng ma trọn vẹn**: sinh (anh em cấp lease) → chết (`taskkill /F /PID … /T`) → thấy
   (bản sao đọc của tiến trình khác) → **dọn bằng lệnh** → **rời DB** ở nhịp kế tiếp.
6. Màn `/ai-brain` render **THẬT** trong Chromium, **8 khung hình**, mỗi khung **tự chụp + tự `Read`**.

### CHƯA ĐI — và đây là phần quan trọng hơn

| # | đường CHƯA đi | vì sao nó có thể giấu lỗi |
|---|---|---|
| **V1** | `releaseStale` nhánh **`rowKind: "shared-baseline"`** (`freedBytes` ép về `0`) | Hàng `vram:baseline` **luôn** do một tiến trình đứng tên; nếu tiến trình ấy là chính người ra lệnh thì rơi vào `own-row-local-ledger-is-authority` **trước**. Cần một cảnh mà **chủ hàng nền đã chết** — không dựng được trong lượt này. |
| **V2** | `releaseStale` nhánh **`shared-ledger-never-refreshed`** | Mọi tiến trình phục vụ HTTP đều chạy `startVramReconciler()` ⇒ bản sao luôn được làm mới trong ≤ 60 s. Nhánh này chỉ tới được ở tiến trình **không** gọi hàm đó (khai ở `vramSharedLedgerStore.ts` M-7 là dân số **RỖNG hôm nay**). |
| **V3** | `releaseStale` khi bảng tiến trình **KHÔNG ĐỌC ĐƯỢC** (`"khong-biet"` ⇒ không xoá hàng của ai) | Đây là nhánh **an toàn nhất và cũng dễ hỏng nhất**; Pha 3 đã đo được `readProcTable()` hỏng thoáng qua dưới tải (4 lượt null trong ~500 ms). **Chưa chạm** trên đường lệnh. |
| **V4** | **`releaseStale` qua NÚT trên panel** (`stepUp.guard` → `StepUpOtpDialog` → `totpCode`) | Lượt này gọi **thẳng** tRPC. Nút đã render và **bấm được** (thấy ở `n4-01`), nhưng đường **UI → OTP → mutation** chưa chạy trong Task 4. |
| **V5** | **`requirePerCallFreshTotp` của Task 1/1b** trên đường `releaseStale` | PID 30108 đang chạy bản **`ebfec4a5`** (§2) ⇒ 6 lượt lệnh của N1 đi qua **`requireFreshTotp` cũ (cache 10 phút)**, KHÔNG qua phép siết mới. ⚠ **Phép siết của Task 1/1b vì thế VẪN CHƯA có một lượt sống nào trên đường VRAM.** |
| **V6** | `releaseStale` **đồng thời** với nhịp đối chiếu đang dọn cùng hàng | Mọi lượt đo đều **căn nhịp để tránh** tranh chấp. Cửa sổ đua (nhịp và lệnh cùng gọi `donHangMa`) **chưa chạm**. |
| **V7** | Mặt suy giảm ở locale **`vi`** và **`zh`** trên màn thật | Chỉ chụp ở `us English`. §3.5 cho thấy 26/29 nhãn **không có bản dịch**, nên `vi` sẽ trông "đúng" một cách **giả tạo** và `zh` sẽ **cũng ra tiếng Việt** — chưa chụp để chứng minh. |
| **V8** | Mặt suy giảm **THẬT** cho 10/11 lý do | Chỉ `unverified-baseline` render từ payload **không sửa**. Mười lý do còn lại đi qua tầng B ⇒ lượt này chứng minh **panel dịch đúng dữ liệu**, **không** chứng minh *"máy chủ SẼ phát ra dữ liệu ấy khi hệ hỏng thật"*. |
| **V9** | Hai lệnh chạy **CÙNG LÚC** (hai người, hoặc Agent + người) | Mọi lượt đo đều tuần tự. |
| **V10** | Đường **Agent NL** (`aiLocalTools/vramTools.releaseStale`) | Lượt này chỉ đi tRPC + UI. Đường Agent của Pha 4 **không** được đo lại ở đây. |

---

## 5. Trạng thái hệ sau khi đo — ĐÃ TRẢ VỀ NGUYÊN TRẠNG

| việc | trạng thái | bằng chứng |
|---|---|---|
| Máy chủ **PID 30108** (:3000) | **CÒN SỐNG, không đụng** | `Get-Process -Id 30108` ⇒ `True` |
| Tiến trình phụ đã dựng | **4 cái, ĐÃ TẮT THEO ĐÚNG PID**: `26196` (`taskkill /F /PID 26196 /T`), `31176`, `28468`, `6828` (`Stop-Process -Id … -Force`) | `Get-NetTCPConnection -LocalPort 3100,3101` ⇒ **rỗng**; liệt kê `node.exe` khớp `*dist*index.js*` ⇒ **chỉ còn `30108` + cha `27372`** |
| Nền VRAM (bài học Pha 4: hai server dev bỏ quên) | **SẠCH** — `nvidia-smi` `1.603 → 1.475 MiB` (đầu → cuối) | `nvidia-smi --query-gpu=memory.used` |
| `vram_leases` | **về đúng 4 hàng ban đầu**, 0 hàng ma | `SELECT` trực tiếp DB |
| Quyền | **KHÔNG cấp, KHÔNG thu hồi bit nào** — chỉ `SELECT` | §0 |
| DDL / migration / seed / `kb:sync` / trainer | **KHÔNG chạy cái nào** | — |
| Mã sản xuất | **KHÔNG SỬA MỘT DÒNG** | `git status --porcelain -- server/ client/ shared/ drizzle/` ⇒ **chỉ 2 dòng của AGENT KHÁC** (`deployStepUpFreshness.test.ts` M · `__deployProcedureScan.ts` ??) — **không đụng, không stage** |
| Script tạm | **ĐÃ XOÁ** (`vramcall.mjs`, `n1-run.mjs`, `state.json`, 4 file log) khỏi scratchpad | `ls` sau khi xoá |
| Artefact Playwright | `.playwright-mcp/` — **đã có trong `.gitignore:194`** | `git check-ignore -v` |

---

## 6. NỢ — cái ĐÓNG, cái CÒN, cái **MỚI SINH RA TỪ CHÍNH PHA 6**

### Đóng được

| mục | trạng thái |
|---|---|
| **N1** (`releaseStale` chưa từng thành công qua HAI pha) · nợ **U4** Pha 4 | ✅ **ĐÓNG** — 3 lượt `released`, có `nvidia-smi` hai đầu, có bằng chứng hàng rời DB |
| **N4** (mặt suy giảm chưa từng render) · nợ **U9** Pha 4 | ✅ **ĐÓNG** — 30/30 nhánh có ảnh đọc được bằng mắt |
| **U10** Pha 4 (`translateVramNonFiniteFields` mảng KHÔNG rỗng · `translateVramEstimateUsable(false, n)`) | ✅ **ĐÓNG** — `n4-02`, `n4-03`, `n4-04` |

### MỚI SINH RA từ Pha 6 (⚠ Pha 5 đã đẻ nợ nặng hơn **hai** lần — đây là lần thứ ba của chuỗi)

| # | nợ mới | hạng | ghi chú |
|---|---|---|---|
| **P6-1** | **Task 2 đổi kiểu `effectiveBytes` → `effective.{…}` là một thay đổi PHÁ VỠ hợp đồng API, và client KHÔNG có lớp bảo vệ** ⇒ deploy client trước server làm **CHẾT CẢ TRANG `/ai-brain`** (§2), tức mất **toàn bộ mặt lệnh VRAM** | 🔴 **Critical (đang SỐNG trên deployment này)** | Vá đúng: hoặc client đọc phòng thủ, hoặc thứ tự deploy được ràng buộc, hoặc giữ `effectiveBytes` một nhịp làm cầu. **KHÔNG vá ở task này** (task ĐO). |
| **P6-2** | **V5 ở §4** — `requirePerCallFreshTotp` (Task 1 + 1b) **chưa có một lượt sống nào** trên đường VRAM, vì bản đang phục vụ là `ebfec4a5` | ⚠ Important | Cần một lượt nghiệm thu sống **sau khi khởi động lại máy chủ ở `a9f155f9`**. |

### Nợ CÓ TRƯỚC mà lượt này ĐO ĐƯỢC lần đầu

| # | nợ | hạng | ghi chú |
|---|---|---|---|
| **T4-1** | **26/29 nhãn `vramBroker.*` không có bản dịch ở BẤT KỲ locale nào**, và **`i18n:check` XANH** vì "vắng ở cả ba ⇒ không lệch" (§3.5) | ⚠ Important · **"hàng rào KHÔNG AI CANH"** | Bề mặt hai thứ tiếng đúng lúc người trực cần đọc. Cổng hiện tại **theo cấu trúc** không thể bắt. |
| **T4-2** | `taskkill` khai `SUCCESS` trong khi tiến trình **vẫn còn trong bảng** (§1.4) | ghi nhận | Lớp lỗi Pha 3 (*"`kill(pid,0)` không phải quan sát cái chết"*), nay đo được ở đầu Windows. |

---

## 7. Cổng kiểm — chạy gì, KHÔNG chạy gì, và vì sao

⚠ **Task này KHÔNG sửa một dòng mã nào** (§5) ⇒ một lượt cổng đầy đủ chỉ đo **nợ có trước** và
**việc đang sửa dở của AGENT KHÁC** trong cùng cây (`server/routers/deployStepUpFreshness.test.ts`
đang `M`, `server/routers/__deployProcedureScan.ts` đang `??`). Khai thẳng cái đã chạy:

| lệnh | kết quả |
|---|---|
| `ls` **14/14 đường** của §"Cổng kiểm chung" Pha 5 | **14/14 CÓ THẬT** trên đĩa (glob rỗng ⇒ vitest im lặng — đã kiểm trước khi tin) |
| `npx vitest run server/services/vram/` | **44 file · 778/778 XANH** (12,39 s) |
| `npm run i18n:check` | **0 lệch** — và §3.5 giải thích vì sao con số 0 này **KHÔNG** có nghĩa là mặt suy giảm đã được dịch |
| `git status --porcelain -- server/ client/ shared/ drizzle/` | **2 dòng, CẢ HAI của agent khác** — không đụng, không stage |
| ❌ **KHÔNG chạy**: `server/routers/**`, `npm run check`, `npm run check:tests`, `--sequence.shuffle.tests` | Lý do: cây đang có **việc sửa dở của agent khác** ở đúng thư mục ấy; chạy vào sẽ đo lẫn công của họ và có nguy cơ đụng DB test đang dùng chung. **Khai là CHƯA CHẠY, không khai là XANH.** |

---

## 8. Tóm tắt cho người đọc vội

- **N1 ĐẠT.** `releaseStale` có **ba** lượt `released` đo được, lần đầu qua **ba pha**. Câu chữ trả về
  **không hứa nhiều hơn dữ liệu**: nó khai `queued-for-shared-ledger` đúng lúc hàng chưa vào DB, và
  hàng rời DB **16 giây sau**. `nvidia-smi` **3.807 → 1.584 MiB** — nhưng đó là công của **cú giết**,
  **không phải** của `releaseStale`, và báo cáo này **không gộp hai con số ấy**.
- **N4 ĐẠT.** **30/30** nhánh suy giảm đã render và đã được đọc bằng mắt; **1** nhánh từ payload
  **thật không sửa**, **29** nhánh từ payload thật **có sửa đúng ô cần** — và ranh giới ấy được khai
  rõ ở từng dòng, không gộp.
- **Hai phát hiện ngoài kế hoạch**, cả hai nằm đúng trên bề mặt mà N4 sinh ra để soi:
  **`/ai-brain` đang CHẾT** trên bản đang phục vụ (§2), và **26/29 nhãn không có bản dịch** trong khi
  cổng i18n vẫn xanh (§3.5).

