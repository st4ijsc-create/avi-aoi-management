# Review TOÀN NHÁNH — Pha 3 (sổ chung xuyên tiến trình)

Nhánh `feat/hmi-dep` · 13 commit `2f72bdc4..49af5c00` · 38 file · +7.835/−192.
Người review: một mình, tuần tự, KHÔNG sub-agent.

## KẾT LUẬN: **CHƯA SẴN SÀNG MERGE** — 1 Critical (C-1), 2 Important (I-1, I-2), 5 Minor.

C-1 là đúng chiều nguy hiểm MỚI mà Pha 3 vừa mở ra (`preempt()` giết được tiến trình của người
khác) và nó có một **bằng chứng đã nằm sẵn trong cấu trúc dữ liệu nhưng không ai hỏi tới**
(`leaseNhanNuoi[pid].ctime`). Vá là một dòng + một ca. Mọi thứ còn lại của pha này chắc.

---

## (2) `reserve()` CÒN ĐỒNG BỘ THẬT KHÔNG — **CÒN. Xác nhận bằng mã, ba lớp.** ✅

**Lớp 1 — chữ ký + thân hàm.** `vramBroker.ts:704` `export function reserve(…): VramReserveOutcome`
— KHÔNG `async`. `grep "await |async "` trên toàn `vramBroker.ts` = **0 khớp trong mã** (2 khớp duy
nhất nằm trong docstring `:700` và `:821`). Hàm không `async` thì không `await` được — bảo đảm CẤU
TRÚC, không phải quy ước.

**Lớp 2 — đồ thị nhập của đường quyết định.**

| module | nhập |
|---|---|
| `vramBroker.ts` | `types`(type) · `vramCaps` · `vramHeadroom` · `vramRefusal` · `vramEnforcement` · `vramTickCell`(type) · `vramSharedLedger` |
| `vramSharedLedger.ts` | **CHỈ** `import type … "./types"` — 0 giá trị, 0 I/O, và `grep "async \|await "` = **0** |
| `vramCaps` · `vramHeadroom` · `vramTickCell` · `vramRefusalSignal` · `vramAllocationSites` · `_core/appErrorCodes` | **0 import** |
| `vramEnforcement` | 3 dòng `import type` |
| `vramRefusal` | 2 type + 2 hằng số thuần |

Không module nào trên đường `reserve()` chạm `fs`/`net`/`pg`/`drizzle`/`child_process`.

**Lớp 3 — "hàm trông đồng bộ mà bên trong `await`"** (chiều tấn công câu hỏi nhắm tới). Kiểm từng
lời gọi `reserve()` phát ra: `deviceUsableBytes` · `safetyReserveBytes` · `ggufMaxLoadedModels` ·
`headroomInputFromTick` · `computeHeadroom` · `applyEnforcement` · `refusalFactsFor` →
`buildVramRefusal`/`preemptCandidates`/`ledgerHolders`/`holderFactFromSharedRow` — tất cả thuần
trên `Map` bộ nhớ. `congBoRaSoChung()` (`vramBroker.ts:830`) → `enqueueSharedLedgerWrite()`
(`vramSharedLedger.ts:508`) chỉ `findIndex` + `push`: **không sinh một promise nào**, kể cả một
promise bị bỏ rơi.

**DB vào kiến trúc ở đâu:** `vramSharedLedgerStore.layGateway()` (`:252`), sau
`await import("../../db/connection")` **bên trong** `chayMotLuot()`. `vramBroker` **không** nhập
`vramSharedLedgerStore`; chiều nhập là ngược lại và còn là `await import` muộn (`:238`).

⇒ **ĐẠT.** Lá chắn cấu trúc Pha 1 còn nguyên sau khi DB vào kiến trúc.

---

## (1) TASK SAU CÓ PHÁ BẢO ĐẢM CỦA TASK TRƯỚC KHÔNG — **CÓ MỘT (I-1). Bảy vị từ còn lại: sạch.**

Truy từng vị từ dùng chung qua cả năm task cùng lúc:

| vị từ | người ghi | người đọc | kết luận |
|---|---|---|---|
| `daChet`/`MocCaiChet` | `llamaVisionSidecar` `:436/:454` | `stopSidecar` `:584` | **sạch** — ranh giới với Task 4 giữ bằng CẤU TRÚC: sidecar của ta mang `owner="sidecar:vision"` ⇒ `pidTuOwnerNhanNuoi()` trả `null` ⇒ không lọt vào `leaseNhanNuoi` |
| `coThiHanhThuHoi`/`reclaimer` | điểm gọi (`aiGgufEngine:848`, `llamaVisionSidecar:196`, `vramReconciler:1524`) | 4 nơi, tất cả qua `nguoiThiHanhThuHoiTu` (`vramBroker:253`) | **sạch trong module VRAM · VỠ ở `kbSyncScheduler` → I-1** |
| `baselineVerified` + `baselineUnverifiedReasons` | `lyDoNenKhongTin()` (`vramReconciler:611`) — MỘT bản, hai người ghi gọi chung | `nenDaXacMinh()` → `computeHeadroom` → `applyEnforcement` | **sạch** — cờ là hệ quả dẫn xuất (`:570`), Quyết định 2 đã thay vế `peers` chứ không bỏ |
| `processKey`/`bootMs` | `sharedLedgerSelfKey()` (`vramSharedLedger:230`) | `dungBanSao` `:355` · `trangThaiTienTrinh` `:85` · `nguoiChupNen` `:750` | **sạch** — `trangThaiTienTrinh` đòi đủ 3 phần (`vramAdoption:93`), đúng đột biến từng sống sót 590/590 ở Task 2 |
| `foreignBytes`/`foreignLeases` | `publishSharedLedgerReplica` (một chỗ) | `reserve` `:720` · `applyEnforcement` `:305` · `captureVramBaseline` `:1011` · `reconcileOnce` `:2369` · `chayLuotNhanNuoi` `:1464` · `nguoiChupNen` `:754` | **sạch** — hai vế nền/sổ ghép bằng `nenDaTruAnhEm()` (`:703`), một bản cài đặt |
| `census.peers` | `readGpuHolders` | chỉ `lyDoNenKhongTin` `:656` | **sạch** — chỉ còn vai "CÓ MẶT", không suy ra byte |
| chốt `running`/hoãn | `runKbSyncNow` | `beginEvalGateVram` | **sạch SAU khi vá** — Task 5 tự bắt được (cổng eval dùng ngân sách "đường có người đợi" = 0, `kbSyncScheduler:311-315`); đây đúng lần thứ TƯ của lớp lỗi và **họ tự tìm ra trước tôi** |
| `refCount` | `setLeaseRefCount` (`vramBroker:918`) · `adoptLease`=0 (`:897`) | `nguoiThiHanhThuHoiTu` · `coTheNhuong` · `xepThuTuNhuong` · `holderFactFromSharedRow` | **sạch trong tiến trình**; xem (4) cho cửa đang mở |

**Cái vỡ (I-1)** nằm ngoài module VRAM, ở người tiêu thụ thứ tám mà không bảng vị từ nào của Task 5
liệt kê — chi tiết ở phần phát hiện.

---

## (3) TỪ CHỐI SAI / THU HỒI NHẦM — **CÓ MỘT ĐƯỜNG THU HỒI NHẦM (C-1).**

**Từ chối sai:** không tìm thấy đường nào. Đã truy:
- `ledgerTotalBytes = local + foreignBytes` (`vramBroker:720`) — hàng MA của tiến trình `kill -9`
  bị dọn trong CÙNG nhịp phát hiện (`vramReconciler:1485` `loaiHangDaChungMinhLaMa`), và cổng chi
  phí `canQuet` (`:1786`) **tự bật** khi sổ chung có hàng của ai khác ⇒ không có trạng thái "ghost
  vĩnh viễn" khi quét đang bật (mặc định BẬT, `vramGpuHolders:451`).
- Nền `"local"` (không có sổ chung) ⇒ `foreignBytes = 0` nhưng nền đã nuốt byte anh em ⇒ dư địa
  PHÓNG ĐẠI chứ không phải hụt — sai chiều NỚI, đã khai và có phụ phí 2 đơn vị. Không phải "từ
  chối sai".
- `dungBanSao` lọc `r.processKey !== selfKey` (`vramSharedLedger:355`) ⇒ không đếm hai lần hàng
  của chính ta.

**Thu hồi nhầm: CÓ — xem C-1.** `bootMs`/`ctime` được lưu đúng nhưng **đường phá huỷ không hỏi tới**.

**Thu hồi một hộ đang bận:** không — `nguoiThiHanhThuHoiTu` đòi `refCount === 0` và `refCount`
không hữu hạn ⇒ `!== 0` ⇒ không thu hồi được (chiều chặt, `vramBroker:258`).

**`preempt()` chạm hàng của anh em CÒN SỐNG:** không — `preemptPlan` chỉ duyệt `ledger` CỤC BỘ
(`xepThuTuNhuong:387`), `preemptableBytes` chỉ cộng `input.preemptable` (`vramRefusal:361`), và
câu từ chối nói thẳng điều đó (`vramRefusal:558-560`). **Đúng cho tới khi ai đó làm đột biến (4).**

---

## (4) NỢ CÓ ĐỊA CHỈ CỦA TASK 5 — **THẬT. ĐỘT BIẾN SỐNG SÓT 692/692.**

Task 5 khai: race `0→1` của `refCount` không tồn tại trên dân số người thi hành chạm tới (lý do là
CẤU TRÚC), *"nhưng ai đưa `foreignLeases` vào `preemptPlan()` thì race quay lại NGAY và không ca
nào đỏ"*.

**Đã tự chạy đúng đột biến đó** (`vramBroker.ts` — thêm `readSharedLedgerReplica()` vào import,
nối `foreignLeases` đã lọc bằng CHÍNH `nguoiThiHanhThuHoiTu` vào kết quả `preemptPlan`):

```
Test Files  37 passed (37)
Tests      692 passed (692)      ← ĐỘT BIẾN SỐNG SÓT, 0 ĐỎ
```
Khôi phục bằng `git checkout -- server/services/vram/vramBroker.ts`; cây sạch trở lại.

**Và hậu quả NẶNG HƠN lời khai của Task 5.** Không chỉ race `refCount` quay lại (con số `refCount`
của anh em đến từ bản sao cũ tới 60 s ⇒ `0` có thể đã thành `1` ở bên kia). Nghiêm trọng hơn:
`NGUOI_THI_HANH[step.reclaimer]` (`vramPreempt:57`) chạy **trong tiến trình NÀY**, nên một hàng anh
em mang `reclaimer: "gguf-idle-model"` sẽ gọi `unloadGgufModel(modelId)` trên **engine của ta** cho
một model mà **anh em** đang nạp, và `"vision-sidecar"` sẽ gọi `stopSidecar()` giết **sidecar của
ta**. Tức đột biến đó không "mở lại một race" — nó **quy trách nhiệm sai hộ**, và `freedBytes` đo
bằng chênh lệch sổ CỤC BỘ nên hệ quả im lặng.

⇒ Nợ này **PHẢI được khoá bằng một ca**, không phải bằng một câu trong báo cáo. Khuôn rẻ nhất: một
ca khẳng định `preemptPlan()` **không bao giờ** trả về một step có `leaseId` không nằm trong
`snapshot().leases` — nó giết đột biến trên mà không cần biết `foreignLeases` là gì.

---

## (5) CHUỖI NĂM TẦNG CÓ NHẤT QUÁN KHÔNG — **SỐ: khớp. CÂU CHỮ: hai chỗ hứa quá.**

**Số khớp qua cả năm tầng** (nghiệm thu sống, đối chiếu chéo giữa các báo cáo):
`8.210.137.088 B` (T1 sổ) → `8.205.107.200 B` (T4 nhận nuôi) → `freedBytes = 8.205.107.200`
(T5 preempt) → `nvidia-smi 8.947 → 1.118 MiB = 7.829 MiB thật` (lệch 4 MiB = nhiễu desktop giữa hai
lượt đọc). Nền: `1.234.386.944 B` ở cả người chụp lẫn người đọc (T3). `drift = 0`, `alarm = false`.
Ba tầng khai cùng một con số, và tầng thứ tư là THIẾT BỊ. Đây là chuỗi số sạch nhất của cả 7 pha.

**Câu chữ hứa quá — 2 chỗ:**
1. Kế hoạch §5 (`docs/.../2026-08-05-vram-pha3-so-chung.md:5`): *"`api` · `worker` · **`edge`** ·
   **sidecar** · cron đọc một sổ dùng chung"*. Cơ chế **không** làm thế: chỉ tiến trình Node gọi
   `startVramReconciler()` mới công bố/đọc (ràng buộc M-7, khai đúng ở
   `vramSharedLedgerStore.ts:409-421`). `edge` là dịch vụ **C#** (`tools/machine-simulator/src/St4i.EdgeService`),
   sidecar là **tiến trình con không có broker**. Mã nói đúng, kế hoạch nói quá — sửa kế hoạch.
2. `vramReconciler.ts:1536-1537` — dòng nhận nuôi hứa *"một lượt `preempt()` sẽ tắt **ĐÚNG** pid
   N"*. Đó chính là câu mà C-1 làm sai.

**Bất biến "Σ holders ≈ ledgerTotalBytes"** (Task 2 làm vỡ, Task 5 (C) vá): đã khớp lại —
`holders = [...ledgerHolders(), ...anhEmHo]` (`vramBroker:523`) và
`ledgerTotalBytes = local + foreignBytes` (`:720`) đến từ **cùng một** `SharedLedgerFact`.

---

## (6) ĐIỀU KIỆN RA CỦA PHA 3 — **4 ĐẠT · 1 ĐẠT-CÓ-LỖ · 1 KHÔNG ĐỀU.**

| # | Điều kiện | Kết luận |
|---|---|---|
| 1 | người thi hành chỉ khai thành công khi byte THẬT SỰ đã nhả | **ĐẠT CÓ LỖ.** Cổng bằng chứng THIẾT BỊ đúng (`vramReconciler:1657`, `null` ⇒ `false` ở `:1602`). Nhưng dưới **PID cấp lại**, bằng chứng thoả **rỗng tuếch**: PID mới không phải compute-app ⇒ điều kiện đúng ngay lập tức ⇒ khai `true` cho một lượt giết NHẦM (C-1). |
| 2 | hai tiến trình thấy cùng một sổ; độ trễ cưỡng chế được KHAI | **ĐẠT.** Nghiệm thu sống hai tiến trình thật (api 39072 ⟷ worker 30836). 60 s khai ở 3 chỗ (`vramSharedLedger:18`, `vramEnforcement:230`, câu từ chối `vramRefusal:531`). |
| 3 | nền chỉ do MỘT tiến trình chụp; không nuốt byte anh em | **ĐẠT.** Live: nền `1.234.386.944` thay vì `9.444.524.032` — không nuốt 7.830 MiB. Bảng có ĐÚNG MỘT hàng `vram:baseline`. |
| 4 | giấy phép mồ côi dựng lại đúng số byte sau khởi động lại | **ĐẠT.** Live: `8.205.107.200 B` (7.825 MiB), `baselineVerified=TRUE`, `drift=0`. |
| 5 | cả 6 hộ `background` hoãn-không-chặn; trainer không còn bị đánh thất bại | **KHÔNG ĐỀU (tự khai, và lời tự khai ĐÚNG).** 3/6 chờ thật (`cron:kb-sync`, 2 trainer, ngân sách 6 h); 3/6 ngân sách **0** (`cron:kb-eval-gate`, reranker ×2, `gguf-embed-ctx`) — không chờ nhưng **không chặn** (suy giảm tại chỗ) và nay **CÓ VẾT**. Vế thứ hai (*"trainer không còn bị đánh thất bại"*) **ĐẠT**, có ca đi qua `runSidecarTraining()` thật. |
| 6 | vitest xanh kể cả shuffle · `tsc` sạch · `i18n:check` 0 lệch | **ĐẠT — tôi tự chạy lại toàn bộ.** `692/692 (37 file)` thường + `692/692` `--sequence.shuffle.tests`; `tsc --noEmit` **exit 0**; `i18n:check` **0 key**. |

**Spec §10 — *"ô 100,7 % của Đợt 2 phải được giải BẰNG CƠ CHẾ"*: CƠ CHẾ CÓ, NHƯNG CHƯA AI ĐO LẠI.**
Cửa **BYTE** nay là cục bộ + chung (`vramBroker:720`) và vế nền đã trừ anh em (`vramReconciler:1081`),
nên một roster 100,7 % sẽ bị **TỪ CHỐI** ở tiến trình xin sau thay vì tràn — đó đúng là "giải bằng
cơ chế". Hai lỗ phải nói cùng lúc: (a) cửa sổ 60 s bản sao cũ, trong đó phụ phí tối đa **2.048 MiB**
đứng trước một khả năng **17 GB** (khai đúng ở `vramEnforcement:~305`); (b) cửa **ĐẾM** giữ
mỗi-tiến-trình theo quyết định chủ dự án ⇒ **8 model/card** vẫn qua được cửa byte. Và quan trọng
nhất: **không báo cáo nào chạy lại bảng roster của Đợt 2 dưới Pha 3** để cho thấy ô đó lật. ⇒ Nên
ghi là *"cơ chế đã dựng, ô chưa đo lại"*, không ghi là "đã giải".

---

## (7) TRIAGE NỢ — chỉ nêu cái ĐỔI KẾT LUẬN

**PHẢI đóng trước merge**
- **C-1** — một dòng + một ca. Không đóng thì Pha 3 giao một đường `process.kill()` vào PID tuỳ ý.
- **Ca khoá cho (4)** — nợ Task 5 tự khai là thật và **không ca nào đỏ**; một ca một dòng
  (`preemptPlan` chỉ trả `leaseId` có trong `snapshot().leases`) đóng vĩnh viễn.

**NÊN đóng trước merge (đổi kết luận của người trực lúc 3 giờ sáng)**
- **I-1** — câu M-4 của `kb:sync` bị nuốt.

**Để lại được**
- I-2 (câu chữ kế hoạch §5 + bảng không có cột host) — hôm nay topo một máy, vô hại; ghi lại.
- `tsconfig.json` loại trừ `**/*.test.ts` (nợ TOÀN REPO, chưa trả) — đề xuất một bước CI chạy `tsc`
  trên config phụ file test. Đây là **cơ chế** đứng sau lớp "lưới xanh vì lý do sai" đã tái diễn 12
  lần; nhưng nó ngoài phạm vi nhánh này.
- `readProcTable()` hỏng thoáng qua dưới tải (nợ Task 4) — **nay nó khuếch đại C-1** (mỗi nhịp lỡ
  là một nhịp nữa `leaseNhanNuoi` mang PID cũ). Sau khi vá C-1 nó về lại mức Minor.
- 5 biến `.env` mới chưa vào `.env.example`.

---

## PHÁT HIỆN

### 🔴 C-1 (Critical) — `preempt()` giết một PID ĐÃ ĐƯỢC CẤP LẠI, rồi khai thành công

`server/services/vram/vramReconciler.ts:1618-1684` (`thuHoiHoNhanNuoi`), cụ thể `:1622-1623` và
`:1643`.

`leaseNhanNuoi` lưu `ctime` **đúng vì lý do này** (`:677-682`, ghi ở `:1529`), và docstring gọi tên
nó: *"không có mốc tạo thì một `notepad.exe` vừa nhận đúng số PID của sidecar đã chết sẽ kế thừa
giấy phép 7,8 GB"*. Nhưng `ctime` **chỉ được đọc ở MỘT chỗ**: nhịp 60 s (`:1441`). Đường **PHÁ
HUỶ** thì không:

```
thuHoiHoNhanNuoi(pid):
  muc = leaseNhanNuoi.get(pid)      // :1622  — chỉ kiểm CÓ MẶT
  ...
  giet(pid)                          // :1643  — process.kill(pid,"SIGTERM"), KHÔNG so muc.ctime
```

**Chuỗi thật:** sidecar mồ côi đã nhận nuôi chết (crash / người vận hành tắt) → HĐH cấp lại PID cho
một tiến trình khác → **trước** nhịp chứng minh cái chết, một `reserve()` bị từ chối gọi `preempt()`
→ `preemptPlan` luôn đưa hộ này vào (`priority: "interactive"`, `refCount = 0` **vĩnh viễn** ⇒
`coTheNhuong` `:306` trả `true` cho MỌI mức người xin) → `NGUOI_THI_HANH["orphan-pid"]`
(`vramPreempt:114`) → `thuHoiHoNhanNuoi` → **giết tiến trình vô can**.

Rồi lượt kiểm bằng chứng thoả **rỗng tuếch**: tiến trình mới không phải compute-app ⇒
`!pids.includes(pid)` đúng ngay lượt đầu ⇒ `:1673 return true` + một dòng log khẳng định
*"nvidia-smi XÁC NHẬN"*. Nếu PID mới lại là một tiến trình GPU (llama-server khác, job torch), ta
giết một tải GPU thật của người khác.

**Cửa sổ không phải 60 s mà rộng hơn:** `chayLuotNhanNuoi` `continue` khi `procs === null`
(`:1440`), và Task 4 đo được `readProcTable()` **trả `null` 4 lượt liên tiếp dưới tải**.

**Không ca nào canh.** `adoption.test.ts` E-1…E-9 có E-5 (*"pid KHÔNG phải hộ nhận nuôi ⇒ không gửi
tín hiệu nào"*) nhưng **không có ca PID cấp lại** — cửa giả `cua()` (`:579`) không mô hình hoá bảng
tiến trình.

**Vá:** trong `thuHoiHoNhanNuoi`, trước `giet(pid)`, đọc bảng tiến trình và đòi
`row?.ctime === muc.ctime`; `procs === null` ⇒ **KHÔNG có bằng chứng** ⇒ `return false` (đúng kỷ
luật `:1602` đã áp cho `docPidGiuGpu()`). Ca: PID cùng số, `ctime` khác ⇒ `giet` **không được gọi**
và hàm trả `false`.

### 🟠 I-1 (Important) — hộ của ANH EM làm câu *"không ai thu hồi được, cần người can thiệp"* của `kb:sync` bị nuốt

`server/services/kbSyncScheduler.ts:906-912` (`trienVongText`), nguồn dữ liệu `:795-812`
(`readKbSyncRefusalNote`), nguồn gốc `server/services/vram/vramBroker.ts:523` + `:193`.

Task 5 (C) đưa hộ của anh em vào `VramRefusalFacts.holders`, mang `reclaimable` tính bằng **CHÍNH**
vị từ dùng chung. `readKbSyncRefusalNote()` chép nguyên `facts.holders`, và `trienVongText()` tắt
câu M-4 khi **BẤT KỲ** hộ nào `reclaimable`. Một model GGUF **nhàn rỗi của tiến trình anh em**
(`reclaimer:"gguf-idle-model"`, `refCount 0`) cho `reclaimable: true` — nhưng nó thu hồi được
**bởi anh em**, không phải bởi ta; chính câu từ chối nói thế (`vramRefusal.ts:558-560`).

Hậu quả đúng ở hộ nhạy nhất: `cron:kb-sync` chạy `background` = mức THẤP NHẤT ⇒ `preemptable`
**RỖNG THEO ĐỊNH NGHĨA, VĨNH VIỄN** (docstring `:889-897` tự khai). Câu M-4 là **tín hiệu DUY NHẤT**
nói với người trực rằng chờ thêm 6 giờ nữa cũng vô ích — và nay nó tắt vì một sự thật về **tiến
trình khác**. Đúng lớp *"cơ chế phòng vệ MỚI vô hiệu hoá cơ chế CŨ qua VỊ TỪ DÙNG CHUNG"*, lần thứ
NĂM.

Kèm một mất mát nhỏ hơn cùng gốc: `KbSyncDeferHolder` (`:741-750`) **không có ô `processKey`**, nên
`holderLine()` in hộ của anh em **y như hộ cục bộ** — mất đúng cái dấu `@role:pid:boot` mà
`vramRefusal.holderText()` (`:324-326`) vừa được thêm để người trực khỏi đi tìm nhầm tiến trình.

**Không ca nào canh:** `deferNotBlock.test.ts:1109` và `:1131` đều dùng hộ **cục bộ** (không
`processKey`).

**Vá:** mang `processKey` qua `KbSyncDeferHolder`, và cho `trienVongText()` chỉ xét hộ **cục bộ**
(`processKey == null`).

### 🟠 I-2 (Important) — dân số của "sổ dùng chung" trong kế hoạch RỘNG HƠN cơ chế; bảng không có chiều THIẾT BỊ

- Kế hoạch §5 kể `edge` + `sidecar` là người đọc sổ chung; cả hai **không phải** (chi tiết ở (5)).
  Mã khai đúng ở `vramSharedLedgerStore.ts:409-421`; kế hoạch chưa sửa.
- `drizzle/0312_vram_leases.sql:35-50` — bảng **không có cột host/device**, và `vram:baseline` là
  **MỘT hàng cho cả DB**. Hôm nay `ROLE` chỉ có `api`/`worker`/all-in-one trên cùng một máy nên vô
  hại; nhưng ngày nào có hai máy dùng chung một Postgres thì `foreignBytes` và hàng nền đi xuyên
  máy — nền của card A được đọc làm nền của card B. Phải ghi ràng buộc *"một DB = một thiết bị"*
  ngay trong migration + docstring, trước khi ai đó nối `edge`/site thứ hai.

### 🔵 Minor

- **m-1** `server/services/vram/vramSharedLedger.ts:294-295` — `daCongBo` được dựng và **KHÔNG BAO
  GIỜ đọc** (phép đếm dùng `byteDaGui`). Mã chết còn sót của bản trước `demYDinhDoiByte()`; người
  đọc sẽ tưởng byte đã công bố của **anh em** tham gia phép đếm.
- **m-2** `.env.example` — **5** núm mới của Pha 3 không có mặt: `VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS`,
  `VRAM_SHARED_BASELINE_STALE_MS`, `VRAM_RECLAIM_WAIT_MS`, `VRAM_DEFER_BUDGET_HOURS`,
  `VRAM_DEFER_REQUEST_BUDGET_MS`. Task 5 tự khai 2/5; 3 cái kia chưa ai khai.
- **m-3** `vramReconciler.ts:1536-1537` — câu hứa *"tắt ĐÚNG pid N"*; sửa cùng C-1.
- **m-4** `threeOutcomes.test.ts:1274` — lỗi kiểu duy nhất còn lại dưới config phụ (artefact kiểu
  của mock, đã khai "không sửa"). Giữ nguyên là được, nhưng nó là dòng cuối cùng chặn việc bật một
  bước CI `tsc` cho file test.
- **m-5** `vramReconciler.ts:1658` — chú thích *"MỘT NGƯỜI GHI cho `leaseNhanNuoi`"* không đúng chữ:
  `chayLuotNhanNuoi:1443` cũng `delete`. Ý (không có người ghi thứ hai ở `vramPreempt`) thì đúng;
  câu chữ nên nói *"hai người ghi, cả hai trong file này"* để người sau không dựng giả định lên.

---

## LƯỚI GIẢ — quét độc lập

`tsc --noEmit` trên một config phụ **CÓ** `server/services/vram/**/*.test.ts` (`tsconfig.json` của
repo loại trừ `**/*.test.ts`):

- **0 lưới giả MỚI.** Kết quả duy nhất là `threeOutcomes.test.ts(1274,39) TS2493` — artefact kiểu
  của mock, đã được Task 3 và Task 5 khai và cố ý không sửa.
- **Hai lưới giả của Task 3/Task 5 đã XÁC MINH BẰNG `git show` là CÓ TRONG COMMIT** (đúng bài học
  *"ĐÃ SỬA chỉ đúng khi `git show <commit>:<file>` xác nhận"*):
  - D-2 `sharedBaseline.test.ts` — `git show dfa11683:…` cho thấy tên ô đã đúng
    (`ledgerTotalBytes`/`attributableBytes`/`baselineVerified`) **và** có thêm hàng rào chặn một dư
    địa không hữu hạn bị coi là phép đo (`:561-566`);
  - `sharedLedger.test.ts:525` — `git show 49af5c00:…` cho thấy đã dựng từ
    `__freshSharedLedgerFactForTests()` thay cho object viết tay thiếu `foreignHolders`.
- **Không phải lưới giả mà là LƯỚI THIẾU — 2 chỗ**, và cả hai là phát hiện của lượt này: đột biến
  (4) và ca PID-cấp-lại của C-1.

---

## XÁC NHẬN CÂY SẠCH

```
git status --porcelain -- server/ client/ drizzle/ shared/   →  0 dòng
```
Đột biến (4) đã khôi phục bằng `git checkout -- server/services/vram/vramBroker.ts`; lượt `grep`
còn lại của `readSharedLedgerReplica` trong `vramBroker.ts` là **một dòng docstring có sẵn** (`:612`),
không phải tàn dư. `tsconfig` phụ dùng để quét lưới giả đã xoá (`rm -f wb-tsconfig.tmp.json`).
243 mục bẩn của việc KHÁC: **không đụng, không dọn, không stage**.
