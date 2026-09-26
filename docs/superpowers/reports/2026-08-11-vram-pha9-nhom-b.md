# Pha 9 — nhóm B: nợ LƯỚI và HẠ TẦNG ĐO

**Nhánh** `feat/hmi-dep` · **HEAD vào** `83416ab8` · **ngày** 2026-08-12
**Máy chủ sau lượt này**: PID **8360**, `GET /` = **200**

---

## 0. Câu tóm tắt

Chín mục vào, **sáu vá**, **hai bác bỏ có đo**, **một hoãn có lý do** (`.DRAFT` chờ duyệt).

Điều đáng nói nhất của lượt này không nằm ở mục nào cả: **brief mô tả sai hai trong chín mục**, và
cả hai lần phép đo đều trả lời **ngược hẳn** — không phải "lệch một chút". Cộng thêm **ba lượt
thiết bị đo nói dối** bắt được tại chỗ (nâng tổng lên **26**), trong đó một lượt suýt đẻ ra một
báo động an ninh có **đúng hình dạng** một phát hiện thật.

---

## 1. Bảng từng mục

| Mục | Kết luận | Hash | Ghi chú một dòng |
|---|---|---|---|
| **B1** `vi.mock` tầng `db` | **BÁC BỎ có đo** | — | Cơ chế được mô tả là *"lưới xanh trên mã đã bị thay"*. Đo: **99,1 %** bề mặt hỏng **ỒN ÀO**. |
| **B2** rà `MIEN_TRU` + `TIEU_THU_DU_PHONG` | **rà xong, 0 mục vá được ở tầng lưới** | — | 16 + 3 mục, **không mục nào là vé trắng**. 11/16 do **một** nợ SẢN PHẨM đẻ ra. |
| **B3** `twoFactor.test.ts` lưới rỗng | **VÁ** | `16a1f025` | Xoá file; **nới ∀ `otplib` ra cả `*.test.ts`** — vi phạm duy nhất của repo nằm đúng chỗ lưới cũ mù. |
| **B4** shuffle vào cổng | **VÁ** (2 commit) | `14efc5c5` · `0c3d91c4` | Vào **khối lệnh** + một ô canh việc ấy. Lượt đầu tiên **bắt ngay X-2**. |
| **B5** `npm run check` OOM | **VÁ** | `0b9959a3` | Nguội: **exit 134** sau 73,8 s. Nóng: 6,7 s exit 0 ⇒ năm pha không ai thấy. |
| **B6** ghim script redeploy | **VÁ** | `90c4b379` | `scripts/redeploy.ps1`, **chạy thật một lượt dứt**, `GET /` = 200. |
| **B7a** `quetDiemXacThuc.ts` "đúng chỗ" | **VÁ, nhưng KHÁC đề bài** | `ccb3a7c3` | Không dời file (**4** module cùng dạng, **3** thư mục). Canh cái hại: đường tới `typescript`. |
| **B7b** `bangTraTho` 1 tầng | **VÁ** | `823b58dd` | Lan truyền tới **điểm bất động**; 2 tầng trước đó cho `traTho = []`. |
| **B7c** `getUnusedBackupCodesCount` | **VÁ** | `a30db697` | Probe DB thật: `typeof = "string"`. Ép tại **chủ**. |
| **B8** `visionControl.tools` quá hạn | **BÁC BỎ có đo** | — | File **chưa bao giờ** chạm 5000 ms. Kẻ quá hạn thật là **`aiRcaCopilot.test.ts`**. |
| **B9** `idx_user_sessions_token` trùng | **HOÃN — `.DRAFT`** | `3ebb57c5` | Xác nhận trùng hoàn toàn. Cần DDL ⇒ chờ duyệt. |

**Chín commit**, mỗi mục riêng (B4 tách hai: cổng, rồi nợ mà cổng vừa tìm ra).

```
0b9959a3  fix(vram/pha9-b5)   npm run check OOM
16a1f025  test(vram/pha9-b3)  xoá twoFactor.test.ts + nới ∀ otplib
a30db697  fix(vram/pha9-b7c)  sql<number> trả chuỗi
823b58dd  fix(vram/pha9-b7b)  bangTraTho điểm bất động
ccb3a7c3  test(vram/pha9-b7a) ∀ không-với-tới typescript
14efc5c5  test(vram/pha9-b4)  shuffle vào khối lệnh + ô canh
0c3d91c4  test(vram/pha9-b4)  X-2 warn.mock.calls[0]
90c4b379  chore(vram/pha9-b6) scripts/redeploy.ps1
3ebb57c5  docs(vram/pha9-b9)  .DRAFT 0320
```

---

## 2. ★★★ B1 — BÁC BỎ, và đây là số

Brief: *"Lớp TRÔI HÌNH DẠNG: bản giả thiếu khoá mà mã sản phẩm vừa cần ⇒ **lưới xanh trên mã đã bị
thay**"*, đề xuất một `Proxy` **ném khi đọc một khoá không được khai**.

### 2.1 Quy mô thật (brief nói ~624 lượt / 225+ file)

| | đo được |
|---|---|
| `vi.mock(<chuỗi>)` toàn repo | **1.526** lượt / **438** file |
| mục tiêu khác nhau | **365** |
| nhắm tầng `db` (`./db`, `../db/*`, `db/connection`, …) | **429** lượt |

### 2.2 Phép hiệu chuẩn — sự kiện có ĐÁP SỐ BIẾT TRƯỚC

Lấy đúng ca mà lời khai §4c của `hangRaoKhongAiCanh.test.ts` viện dẫn làm bằng chứng
(`sdk.authCache.test.ts` phải bổ sung `phaiDoiMatKhau` vào bản giả `./db`), **bỏ khoá ấy ra**:

```
server/sdk.authCache.test.ts  ⇒  Tests: 5 failed | 1 passed (6)
  TypeError: db.phaiDoiMatKhau is not a function
    ❯ chanNeuPhaiDoiMatKhau server/_core/sdk.ts:66:51
```

**5/6 ĐỎ, ồn ào, có vết ngăn xếp trỏ thẳng vào dòng sản phẩm.** Không hề im lặng.

### 2.3 Vì sao đó là quy luật, không phải may mắn

| `server/db/**` | số |
|---|---|
| export là **HÀM** | **872** |
| export là **DỮ LIỆU** | **8** |
| lời gọi **tuỳ chọn** `db.x?.()` trong mã sản xuất | **2** |

**872/880 = 99,1 %** bề mặt tầng `db` là hàm. Khoá hàm thiếu ⇒ `undefined(...)` ⇒ **TypeError**.
Bề mặt còn im lặng được: **8 + 2 = 10 điểm / 880**.

### 2.4 Và `Proxy` không chạm được lớp lỗi thật

Trục **thật sự** im lặng không phải khoá module mà là **hình dạng HÀNG do bản giả trả về**
(`USER_ROW` thiếu một cột ⇒ `undefined` ⇒ falsy ⇒ cổng cho qua). `Proxy` trên **mặt module** không
nhìn thấy trục ấy. Đo thử: bỏ `role` khỏi `USER_ROW` ⇒ **1/6 đỏ, 5 xanh** — tức trục ấy có thật và
mới chỉ được canh một phần.

Thêm một số kỹ thuật: hạ tầng **đọc khoá `then`** trên mọi module giả (`await import(…)`), nên một
`Proxy` ném-khi-đọc-khoá-lạ cần một danh sách cho phép hạ tầng ngay từ file đầu tiên.

> **Kết luận B1.** Cơ chế trong brief **không tồn tại ở 99,1 % bề mặt**, và bản vá đề xuất canh
> đúng cái trục **đã ồn ào sẵn**, đồng thời **không** chạm trục đang im lặng. Không xây. Không có
> file test nào bị làm đỏ. **Nợ còn lại, đã đo và thu hẹp**: 10 điểm mặt-module + trục hình-dạng-hàng.

---

## 3. ★★★ B8 — BÁC BỎ, và kẻ quá hạn thật là một file khác

| điều kiện | `visionControl.tools.test.ts` |
|---|---|
| chạy riêng | **583 ms** (7 ca) |
| dưới tải **cổng** (152 file · 2.394 ca) | **1.873 ms** — xanh |
| dưới tải **TOÀN SUITE** (883 file · 11.025 ca · 169 s) | **2.478 ms** — xanh |

Chưa bao giờ chạm gần 5000 ms. **Không nới trần.**

Quét toàn suite tìm chuỗi `Test timed out in 5000ms` ⇒ đúng **một** ca:

```
server/services/aiRcaCopilot.test.ts
  › runRca — flag gate + fail-safe
  › never throws; flag ON with no DB → degrades to 'need investigation'      5.456 ms
```

⚠ Và mục này **đã được đóng hồ sơ từ trước**: `docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md`
dòng 35 ghi *"flake `wiring.inprocess` + `visionControl.tools` (đã đóng hồ sơ: **hạ tầng**, riêng
file thì xanh)"*. Brief nhóm B mở lại một mục đã đóng, và gán nhầm sang một file khác.
`aiRcaCopilot.test.ts` **không** nằm trong §Cổng kiểm chung ⇒ **ghi §Nợ mới**, không tự nới trần
của một file ngoài phạm vi.

---

## 4. B2 — nội dung rà hai tập miễn trừ

### 4.1 `MIEN_TRU` — **16** cặp (tự đếm từ mã, khớp `SO_MIEN_TRU`)

Không mục nào là vé trắng, và điều đó **được máy canh**, không phải do tôi đọc thấy:

* mỗi mục ghim một **chữ ký chênh lệch chính xác**; chữ ký lệch một phần tử ⇒ **ĐỎ** (§2);
* §6 ô 1: thêm một chênh lệch **MỚI** vào một cặp **đã khai** ⇒ vẫn phải bị bắt (chống so-theo-tên);
* §6 ô 2: một lời khai **không ứng với bất đồng nào đang tồn tại** ⇒ **ĐỎ** (chống khai trước).

**Phán quyết theo trục:**

| # | trục | mục | lý do còn đúng? |
|---|---|---|---|
| 1–11 | **hai họ 2FA song song** | 11 | **CÒN ĐÚNG** — nhưng xem 4.2 |
| 12–14 | **ghi mật khẩu** | 3 | **CÒN ĐÚNG, kiểm được**: `setupAdmin` chưa có tài khoản nào để đòi mật khẩu cũ; `user.create` / `updatePassword` là `adminProcedure` (đặt hộ người khác, không có mật khẩu cũ). Chữ ký đúng bằng `dung:compare` + `o:passwordHash`. |
| 15–16 | **phân công tổ chức** | 2 | **CÒN ĐÚNG, kiểm được**: `reassign` = gỡ **RỒI** gán, `remove` chỉ gỡ. Chữ ký đúng bằng một `:insert`. |

### 4.2 ★★ Phát hiện của lượt rà: **11/16 mục là MỘT nợ, không phải mười một**

Mười một mục đầu đều sinh ra từ **cùng một sự thật**: hệ có **HAI họ thủ tục 2FA song song, và cả
hai đều SỐNG**.

```
client/src/pages/Profile.tsx          → user.setup2FA · user.verify2FA · user.disable2FA · user.get2FAStatus
client/src/components/TwoFactorSetup  → twoFactor.enable · twoFactor.disable · twoFactor.regenerateBackupCodes
```

Hai màn hình khác nhau, hai bộ thủ tục khác nhau, **một** khái niệm. Số cặp chéo giữa hai họ là
nguồn của 11 lời khai. Tức `MIEN_TRU` **không phải 16 quyết định** — nó là **5 quyết định + 1 nợ
sản phẩm đang được khai 11 lần**.

⇒ Đây là nợ ở **tầng SẢN PHẨM** (hợp nhất hai họ về một chủ), không phải tầng lưới. Nó **không vá
được ở lượt này**: cả hai đường đang được client gọi thật, nên gộp là một quyết định về hành vi
người dùng cần chủ dự án duyệt. **Không tự làm.** Ghi §Nợ mới.

⚠ Điều **đã** kiểm và **đúng**: câu nặng nhất của tập — mục #11, *"`twoFactor.disable` nay ĐÒI MẬT
KHẨU"* — được xác nhận bằng mã: `server/routers/twoFactorRouter.ts` có `password: z.string().min(1)`
và `bcrypt.compare(input.password, biMat.passwordHash)`. Lời khai **không** cũ.

### 4.3 `TIEU_THU_DU_PHONG` — **3** "lời cho phép chờ sẵn"

| tên | lý do khai | kiểm |
|---|---|---|
| `compare` | `bcrypt.compare(mk, hash)` trả **boolean**, hash không rời hàm | **ĐÚNG** (hợp đồng của bcrypt) |
| `khopMaDuPhong` | so mã dự phòng đã băm, trả **kết quả khớp** | **ĐÚNG** — `server/_core/backupCodeSecret.ts:61` `(maTho, daBam): Promise<boolean>` |
| `Boolean` | ép về boolean; **cũng nằm trong bộ giảm** | **ĐÚNG** — `Boolean(x)` có ở bộ giảm (dòng 498), nên đây thật sự là đường thứ hai tới cùng kết luận |

**Cả ba vẫn KHÔNG đỡ điểm nào**, và điều đó **được máy đo mỗi lượt chạy**, không phải do tôi tin:

* §CHIỀU 2 ghim `SO_DU_PHONG = 3` ⇒ tên thứ tư phải là một quyết định **nói ra**;
* §CHIỀU 2 còn chạy `ganhTai(e)` cho **từng** tên: cái nào **bắt đầu** đỡ điểm ⇒ **ĐỎ**, buộc thăng
  hạng sang `TIEU_THU_CO_CHO` để bị phép thử gánh-tải canh;
* đối chứng dương `ganhTai("verifyTotpOnce") === true` chống chính phép đo chết.

⇒ Giữ cả ba. Chiều hỏng của tập là **fail-closed** (tên vắng ⇒ ĐỎ, không bao giờ tha nhầm), và lý
do giữ là **cụ thể + kiểm được**, không phải "có chủ ý". **Không mục nào vá được, không mục nào là
vé trắng.**

---

## 5. Đột biến bắt buộc — tên ca ĐỎ

| mục | đột biến | ca ĐỎ | đối chứng dương |
|---|---|---|---|
| **B3** | **FILE MỚI** `server/services/__dotBienB3.test.ts` (thư mục khác, là `*.test.ts`) `import { OTP } from "otplib"` | `★★★★ B3 — ∀ file .ts dưới server/** KỂ CẢ *.test.ts: KHÔNG nhập otplib …` | xoá file ⇒ **8/8 xanh** |
| **B7b** | cắt cạnh bắc cầu trong `hoXacThucScan.ts` | `★★★★ §3c B7b — BẮC CẦU: biến nhiễm đi qua NHIỀU lần gán trung gian vẫn bị BẮT` | hoàn nguyên ⇒ **17/17 xanh** |
| **B7c** | `Number(...)` → ép kiểu suông tại chủ | `★★★ còn mã: typeof phải là number …` **và** `★★★ HẾT mã: phải là số 0 …` | hoàn nguyên ⇒ **10/10 xanh** |
| **B7a** | **FILE MỚI** `server/services/__dotBienB7a.ts` nhập `typescript`, được `server/_core/index.ts` nhập | `★★★★ typescript là devDependency ⇒ … máy chủ KHÔNG BOOT ĐƯỢC` **và** `★★★★ bốn module quét AST hôm nay đều KHÔNG VỚI TỚI` | hoàn nguyên ⇒ **7/7 xanh** |
| **B4** | (không cần đột biến nhân tạo) | thước **tự** bắt `vramReconciler.test.ts › cảnh báo lệch ÂM …` | sau vá: **45/45** qua **3** hoán vị |

Cả bốn đột biến **kiểm lượng từ ∀** đều đặt ở **FILE MỚI** — ca duy nhất phân biệt *"lưới theo
ĐƯỜNG THOÁT"* với *"lưới theo FILE"*. Mọi lượt chèn đi qua **Node theo chỉ số dòng**, không `sed`.
**Commit TRƯỚC, đột biến SAU**, và mọi lượt đều hoàn nguyên (`git status` sạch sau mỗi lượt).

---

## 6. ★★ Thiết bị đo nói dối — **ba lần nữa hôm nay** (tổng **26**)

1. **`git grep` đọc BÌNH LUẬN thành LƯỢT NHẬP.** Dò B7a thấy `deployProcedureScan` trong
   `server/_core/trpc.ts` và `server/routers/vramRouter.ts` — **hai file chạy thật, ở lõi tRPC**.
   Kết luận suýt viết: *"lõi tRPC kéo `typescript` vào bản sản xuất"* — **một phát hiện an ninh sai
   có ĐÚNG hình dạng một phát hiện thật**. Sự thật: cả hai chỉ **nhắc tên trong bình luận**. Đã
   chuyển sang AST, và ghim một ô neo đích danh hai file ấy để lỗi không mọc lại.

2. **`grep` trên `dist/index.js` rơi vào BẢNG XUẤT, không phải THÂN HÀM.** Đối chứng "bản vá B7c có
   trong tiến trình đang chạy chưa" lần đầu trả **`co Number( = false`** — vì nó khớp
   `getUnusedBackupCodesCount: () => getUnusedBackupCodesCount` trong bảng re-export. Neo lại vào
   `async function <tên>` ⇒ đọc đúng thân hàm ⇒ `return Number(result[0]?.count ?? 0)` **có**.

3. **`EXIT=$?` sau một đường ống đọc mã của `tail`.** Lượt đo B5 đầu tiên khai `EXIT=0` cho một
   lượt chạy **đã chết vì heap**. Chạy lại không ống ⇒ **134**.

⚠ Cộng thêm một lỗi hạ tầng mới, thuộc cùng họ *"triệu chứng không trỏ về nguyên nhân"*:
**file `.ps1` không BOM** bị Windows PowerShell 5.1 đọc bằng codepage ANSI ⇒ mọi `—`/`⚠`/`⇒` thành
rác ⇒ **parser vỡ** với 6 lỗi `Unexpected token` trỏ vào những dòng **không có gì sai**. Đã ghim
thành BAI HOC 5 trong chính `scripts/redeploy.ps1`.

---

## 7. Cổng ra

| lệnh | kết quả |
|---|---|
| §Cổng kiểm chung (**52** đường), thứ tự cố định | `2 failed \| 2404 passed (2406)` · 153 file · 44,6 s |
| §Cổng kiểm chung + `--sequence.shuffle.tests` | `1 failed \| 2405 passed (2406)` · 153 file |
| `npm run check` (lượt chạy **NGUỘI**) | **exit 0**, 0 lỗi *(trước B5: exit **134**)* |
| `npm run check:tests` | **exit 0**, 0 lỗi |
| `npm run i18n:check` | **exit 0** — `0 placeholder mismatch · 0 NEW missing · 0 stale · 0 baseline-integrity` |

**Hai ca đỏ, cả hai đều CÓ TRƯỚC và không do nhóm B gây ra:**

1. `server/api.test.ts › Factory Router › should reject non-admin from creating factory` — ca đỏ
   **đã biết**, brief chỉ định **KHÔNG sửa**. Đỏ ở cả hai lượt.
2. `server/_core/authService.test.ts › F9-Minor … cuộc gọi verifyCredentials ĐẦU TIÊN …` — chỉ đỏ ở
   **lượt cố định**, XANH ở lượt shuffle. Đây là một ô so **ĐỒNG HỒ TƯỜNG**:
   `expect(firstCallMs).toBeLessThan(secondCallMs * 1.8 + 15)` ⇒ `175,31 < 159,33` sai **16 ms**.
   Đo lại: **3/3 xanh** khi chạy riêng, xanh ở lượt shuffle, xanh ở lượt chạy nền trước mọi commit
   của nhóm B, và xanh ở lượt chạy lại trên tập 8 file vừa đụng (`134/135`, chỉ còn ca #1 đỏ).
   ⇒ **Nhiễu tải song song**, cùng họ với dòng 35 của kế hoạch (*"flake … hạ tầng, riêng file thì
   xanh"*). **Không nới ngưỡng** — nới một ô đo thời gian để cổng thôi đỏ là đúng cái B8 vừa bị bác
   bỏ. Ghi §Nợ mới **N-8**.

**`CONG` 51 → 52** · **`FILE_CANH` 114 → 115** — cả hai **đọc từ cổng đỏ**, không đoán
(`vramPha5Gate.test.ts` đỏ 3 ô với thông điệp `expected 115 to be 114`).
`vramPha5Gate.test.ts` **14 → 15 ca** (thêm ô B4).

**Ca đỏ CÓ TRƯỚC, cố ý KHÔNG sửa**: `server/api.test.ts › Factory Router › should reject non-admin
from creating factory` (chờ chuỗi tiếng Anh `"Admin access required"`; RBAC đã bản địa hoá từ AI
Sprint 5 — hành vi sản phẩm **đúng**, kỳ vọng của ca test đã cũ).

---

## 8. Nợ mới (không tự làm — cần chủ dự án)

| # | nợ | số đo | vì sao không tự làm |
|---|---|---|---|
| **N-1** | **Hai họ thủ tục 2FA song song, cả hai đều SỐNG** (`user.*` ← `Profile.tsx` · `twoFactor.*` ← `TwoFactorSetup.tsx`) | đẻ ra **11/16** mục `MIEN_TRU` | Gộp về một chủ là quyết định về **hành vi người dùng** (hai màn hình đang chạy thật). |
| **N-2** | `server/services/aiRcaCopilot.test.ts › never throws; flag ON with no DB` **quá hạn 5000 ms** dưới tải toàn suite | **5.456 ms**; toàn suite: 65 file / 159 ca đỏ | Ngoài §Cổng kiểm chung. Nới trần một file ngoài phạm vi ở lượt này là làm đúng cái B8 vừa bị bác bỏ. |
| **N-3** | Vùng mù còn lại của B1 | **10** điểm mặt-module (8 export dữ liệu + 2 lời gọi `?.`) + trục **hình dạng HÀNG** | Trục hình-dạng-hàng cần phân tích liên module; không quyết định được tĩnh. |
| **N-4** | `.DRAFT` **0320** (gỡ `idx_user_sessions_token`) | trùng hoàn toàn `user_sessions_sessionToken_unique`; 139.264 byte; ràng buộc = 0 | **Cần DDL.** Áp phải đi **kèm** xoá `drizzle/schema/auth.ts:260`, nếu không `db:push` tạo lại. |
| **N-5** | `.DRAFT` **0319** (`ipAddress` → `text`) | — | **Đã chờ từ trước.** Không đụng, không đổi tên. |
| **N-6** | Ba gói `devDependencies` bị nhập từ vùng với-tới sản xuất | `vite` · `ws` · `pdf-parse` | Cả ba qua `await import(…)` có điều kiện hoặc `import type` ⇒ **không** phải điều kiện boot. Nới ô B7a ra cả `devDependencies` sẽ **bắt nhầm** ba chỗ ấy. |
| **N-7** | `duongCuaCong()` còn một nhánh cắt tại `\nNODE_OPTIONS` nay là **mã chết** | — | Vô hại (bộ lọc `t.includes("/")` đã đủ). Dọn ở lượt khác để không trộn thay đổi vào cổng. |
| **N-8** | `authService.test.ts › F9-Minor` là một ô so **ĐỒNG HỒ TƯỜNG** ⇒ nhiễu dưới tải song song | `175,31 < 159,33` sai **16 ms**; 3/3 xanh khi chạy riêng | Nới ngưỡng để cổng thôi đỏ là **đúng cái B8 vừa bị bác bỏ**. Bản vá đúng là đổi trục đo (đếm lượt sinh hash, không đếm ms) — một quyết định về lưới an ninh side-channel, cần duyệt. |

---

## 9. Ràng buộc cứng — đã giữ

* **0** DDL / migration / seed / `kb:sync` / cấp quyền. Hai `.DRAFT` **chưa áp**.
* **0** lượt đổi mật khẩu / cờ / vai / quyền.
* **0** sub-agent.
* `git diff --cached --name-only` kiểm **mỗi lượt**; **không** `git add -A`. ~245 mục bẩn ngoài
  phạm vi **không bị chạm**.
* Máy chủ khởi động lại **một lần**, có lý do sản phẩm (B7c sửa `server/db/auth.ts` ⇒ `dist/` cũ),
  bằng **đúng** script B6, và `GET /` = **200** sau đó. Đối chứng **HÀNH VI** (không tin `mtime`):
  thân hàm trong `dist/index.js` đang chạy đọc `return Number(result[0]?.count ?? 0);`.
