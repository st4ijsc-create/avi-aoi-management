# Lượt vá sau review TOÀN NHÁNH — Pha 3

Nhánh `feat/hmi-dep`, không nhánh mới, không worktree. Nền trước lượt vá: **692/692 (37 file)**,
`tsc --noEmit` exit 0, `i18n:check` 0 lệch.

---

## 🔴 C-1 — giết nhầm tiến trình rồi báo cáo thành công · **ĐÃ VÁ**

Commit `f6f80158` — `git show f6f80158:server/services/vram/vramReconciler.ts` xác nhận bản vá
CÓ trong commit (`:1648` `const bang = await readProcTableSafe();`, `:1650` điều kiện `ctime`).

**Ca ĐỎ trước khi vá (3):**

| ca | hình dạng | đỏ ở đâu |
|---|---|---|
| `★★★ E-10 (C-1): PID được CẤP LẠI (cùng số, KHÁC ctime) ⇒ KHÔNG giết, KHÔNG khai thành công` | `notepad.exe` nhận đúng số PID 31337 của sidecar đã chết | `expected [ 31337 ] to deeply equal []` — **SIGTERM đã bay tới một tiến trình vô can** |
| `★★ E-11 (C-1): pid VẮNG HẲN khỏi bảng tiến trình ⇒ không có gì để giết ⇒ không khai thành công` | pid biến mất hoàn toàn | `expected true to be false` — **lời khai thành công cho một lượt giết vào bóng tối** |
| `★★ E-12 (C-1): KHÔNG đọc được bảng tiến trình ⇒ KHÔNG bằng chứng ⇒ KHÔNG hành động` | `readProcTable()` trả `null` (Task 4 đo được 4 lượt liên tiếp dưới tải) | `expected true to be false` |

E-11/E-12 đỏ **đúng ở lời khai**, không chỉ ở lượt giết — tức bộ ca chạm đúng nửa nguy hiểm nhất
của C-1 ("sai **và** tự khai là đúng").

**Bản vá** (`vramReconciler.ts:1628-1663`): trước `giet(pid)`, đọc `readProcTableSafe()` và đòi
`hienTai.ctime === muc.ctime`. Ba nhánh từ chối, mỗi nhánh một câu log riêng: bảng không đọc được ·
PID biến mất · PID cấp lại. **Không** nhả giấy phép ở nhánh từ chối — người dọn `leaseNhanNuoi`
theo mốc tạo vẫn là nhịp đối chiếu (`:1441-1455`), giữ thêm một nhịp là chiều CHẶT.

Kèm trong cùng commit: **m-3** (dòng nhận nuôi `:1536` hứa *"tắt ĐÚNG pid N"* — nay nói rõ điều
kiện mốc tạo) và **m-5** (chú thích `:1697` *"MỘT NGƯỜI GHI"* → *"HAI NGƯỜI GHI, cả hai trong file
này"*).

Kết quả: **695/695 (37 file)**, `tsc --noEmit` exit 0.

---

## 🔴 (4) — đột biến của reviewer sống sót 692/692 · **ĐÃ KHOÁ**

Commit `2b2034f1` — `git show 2b2034f1:server/services/vram/adoption.test.ts` xác nhận nhóm `G.` có
trong commit (`:830` describe, `:847` ca, `:873` phép khẳng định).

**Ca đỏ:** `★★★ G-1: hàng của ANH EM nhàn rỗi + CÓ người thi hành vẫn KHÔNG được vào kế hoạch thi
hành` (`adoption.test.ts`, nhóm `G. RANH GIỚI THI HÀNH`).

**Đã tự chạy lại ĐÚNG đột biến của người review** (thêm `readSharedLedgerReplica` vào import
`vramBroker.ts`, nối `foreignLeases` lọc bằng **chính** `nguoiThiHanhThuHoiTu` vào kết quả
`preemptPlan`):

```
Tests  695 passed | 1 failed (696)     ← ĐỎ ĐÚNG MỘT CA
FAIL   adoption.test.ts > G. RANH GIỚI THI HÀNH … > ★★★ G-1
AssertionError: bước "gguf:cua-anh-em" (leaseId lease-9, reclaimer gguf-idle-model) trỏ tới một
giấy phép KHÔNG có trong sổ cục bộ — người thi hành chạy TRONG tiến trình này, nên nó sẽ dọn hộ CỦA TA
```
Khôi phục bằng `git checkout -- server/services/vram/vramBroker.ts`; cây sạch trở lại trước khi commit.

**Khuôn của ca** cố ý **không biết `foreignLeases` là gì**: nó chỉ khẳng định bất biến *mỗi bước
của `preemptPlan()` phải trỏ tới một `leaseId` có trong `snapshot().leases`* ⇒ mọi đường đưa hàng
của người khác vào kế hoạch đều đỏ, kể cả đường chưa ai nghĩ ra. Hai dòng tiền đề (hàng anh em CÓ
trong bản sao **và** vị từ chung nói nó thu hồi được) chặn đúng hình dạng "xanh RỖNG".

---

## 🟠 I-1 — hộ của ANH EM nuốt câu M-4 của `kb:sync` · **ĐÃ VÁ**

Commit `34ae2318` — `git show` xác nhận `:762` `readonly processKey: string | null;`, `:830`/`:874`
`processKeyOrNull(o.processKey)`, `:957` `const cucBo = note.holders.filter(…)`.

Ba thay đổi, một gốc: `KbSyncDeferHolder.processKey` (**bắt buộc**, `string | null`, một bản dịch
`processKeyOrNull` — không phải chuỗi / rỗng / toàn khoảng trắng ⇒ `null` = *của ta*); `holderLine()`
in `@role:pid:boot` và nhãn *"TIẾN TRÌNH KHÁC giữ — preempt() của ta KHÔNG với tới"*;
`trienVongText()` chỉ xét hộ có `processKey === null`.

⚠ Mọi hộ đều của anh em ⇒ `cucBo` RỖNG ⇒ câu **VẪN NỔ** — và đó là đúng: ta không thu hồi được gì cả.
⚠ Câu chữ giữ nguyên chuỗi `"KHÔNG hộ nào thu hồi được"` (thêm `BỞI TIẾN TRÌNH NÀY`) để hai ca M-4
cũ vẫn canh đúng thứ chúng được viết ra để canh.

**Ca đỏ trước khi vá (2/3):**
- `★★★ (I-1) hộ THU HỒI ĐƯỢC của ANH EM KHÔNG được nuốt câu 'cần người can thiệp'`
- `★★ (I-1) readKbSyncRefusalNote() mang processKey qua — chuỗi rỗng/rác ⇒ null (CỦA TA)`
- `★★ (I-1) hộ CỤC BỘ thu hồi được thì vẫn KHÔNG nổ câu đó` — **lưới chống đảo chiều**, xanh cả
  hai phía (đúng vai của nó).

---

## 🟠 I-2 — ghi ràng buộc, KHÔNG sửa mã · **ĐÃ GHI**

Commit `df65f885`. Ba chỗ mang cùng một khối chữ, `git show` xác nhận cả ba:
`drizzle/0312_vram_leases.sql:29` · `drizzle/schema/vram.ts:80` · `vramSharedLedgerStore.ts:422`
(đặt cạnh ràng buộc M-7, cùng hạng).

Nội dung ràng buộc: **một DB = một thiết bị GPU.** Bảng không có cột host/device; `vram:baseline`
là MỘT hàng cho cả DB; `foreignBytes` cộng thẳng byte của mọi hàng không phải của mình, **không hỏi
chúng nằm trên card nào**. Hai máy chung một Postgres ⇒ nền card A bị đọc làm nền card B, và
**không cơ chế nào của Pha 3 phát hiện được** — đó không phải một lệch ĐO ĐƯỢC, đó là một phép cộng
sai **DÂN SỐ**. Lối ra đã ghi sẵn: cột `deviceKey` (host + UUID GPU) vào khoá chính, vào hàng nền,
và vào phép lọc `dungBanSao()` — **trước** khi nối, không vá sau.

Kèm: kế hoạch §5 (`docs/superpowers/plans/2026-08-05-vram-pha3-so-chung.md:5`) nay có khối đính
chính — `edge` là dịch vụ **C#** (`tools/machine-simulator/src/St4i.EdgeService`), sidecar là
**tiến trình con không có broker**; dân số đọc sổ chung chỉ là tiến trình Node gọi
`startVramReconciler()`.

**Không sửa một dòng mã nào** — đúng brief.

---

## 🔵 Năm Minor — **sửa cả năm**

| # | chỗ | làm gì |
|---|---|---|
| m-1 | `vramSharedLedger.ts` `demYDinhDoiByte()` | xoá `daCongBo` (dựng rồi không bao giờ đọc) **và** sửa docstring đang mô tả một biến không tồn tại (`daCongBo === undefined` → `cu === undefined`); thêm câu nói rõ phép đếm chỉ đọc `byteDaGui` |
| m-2 | `.env.example` | thêm **5** núm Pha 3 (`VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS` · `VRAM_SHARED_BASELINE_STALE_MS` · `VRAM_RECLAIM_WAIT_MS` · `VRAM_DEFER_BUDGET_HOURS` · `VRAM_DEFER_REQUEST_BUDGET_MS`) kèm khối ràng buộc topo |
| m-3 | `vramReconciler.ts` dòng nhận nuôi | câu hứa *"tắt ĐÚNG pid N"* → nêu rõ điều kiện mốc tạo (đi cùng commit C-1) |
| m-4 | `threeOutcomes.test.ts` | TS2493 cuối cùng — ép qua `unknown` đúng khuôn đã dùng ở ca 6 |
| m-5 | `vramReconciler.ts` chú thích | *"MỘT NGƯỜI GHI"* → *"HAI NGƯỜI GHI, cả hai trong file này"* (chỗ kia: `chayLuotNhanNuoi`) |

**★ Hệ quả đo được của m-4:** `tsc` trên một config phụ **CÓ** `server/services/vram/**/*.test.ts`
\+ `kbSyncScheduler.ts` nay **exit 0, 0 lỗi**. Và lưới ấy đã được kiểm là THẬT: khôi phục đúng dòng
cũ ⇒ `TS2493` quay lại ngay (`threeOutcomes.test.ts(1277,39)`), vá lại ⇒ exit 0. Config phụ đã xoá
(`rm -f wb-tsconfig.tmp.json`).

---

## Câu phải ghi cho đúng — ô 100,7 % của Đợt 2

Đã ghi vào **kế hoạch, ngay dưới bảng Điều kiện ra**: ***"cơ chế ĐÃ DỰNG, ô CHƯA ĐO LẠI"***, và
**không** ghi *"đã giải"*. Kèm hai lỗ phải nói cùng lúc (cửa sổ 60 s với phụ phí tối đa 2.048 MiB
đứng trước một khả năng 17 GB; cửa ĐẾM giữ mỗi-tiến-trình ⇒ 8 model/card vẫn qua cửa byte) và một
câu gọi tên lớp lỗi: *"hứa nhiều hơn dữ liệu"*, đã bắt **chín lần**.

---

## Nghiệm thu cuối

```
npx vitest run server/services/vram/        →  37 file, 699/699 xanh   (nền 692)
tsc --noEmit                                →  exit 0
tsc -p <config phụ CÓ file test> --noEmit   →  exit 0   (m-4 đóng nốt)
npm run i18n:check                          →  0 key
git status --porcelain -- server/ client/ drizzle/ shared/  →  0 dòng
```

Bốn commit: `f6f80158` (C-1) · `2b2034f1` ((4)) · `34ae2318` (I-1) · `df65f885` (I-2 + Minor).
243 mục bẩn của việc KHÁC: **không đụng, không dọn, không stage.** Không `kb:sync`, không DDL,
không trainer.

## Không sửa — có địa chỉ

1. **`readProcTable()` hỏng thoáng qua dưới tải** (nợ Task 4). Sau C-1 nó về lại mức Minor đúng như
   người review nói: một nhịp lỡ nay chỉ làm lượt thu hồi **từ chối trung thực**, không còn khuếch
   đại thành một lượt giết nhầm. ⚠ Đổi lại có một cái giá phải khai: dưới tải, một lượt `preempt()`
   hợp lệ lên hộ mồ côi **cũng** bị từ chối cho tới khi bảng tiến trình đọc lại được — chiều CHẶT,
   và là chiều đúng.
2. **`tsconfig.json` loại trừ `**/*.test.ts`** — nợ TOÀN REPO, ngoài phạm vi nhánh. Module VRAM +
   `kbSyncScheduler` nay **sạch dưới config phụ**, nên một bước CI cho *riêng phạm vi này* đã khả
   thi; bật nó cho cả repo thì chưa.
3. **`preempt()` vẫn KHÔNG nhường được chỗ của một tiến trình anh em CÒN SỐNG** — giữ nguyên có chủ
   ý, và nay có **G-1** khoá để không ai vô tình mở ra. Muốn mở phải là một cơ chế xuyên tiến trình
   (yêu cầu gửi sang chủ sở hữu), không phải một dòng nối danh sách.
4. **Ô 100,7 % chưa đo lại** — cần chạy lại bảng roster Đợt 2 dưới Pha 3; là một phép ĐO, không
   phải một lượt sửa mã.
