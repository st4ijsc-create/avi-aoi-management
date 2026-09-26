# Pha 9 — REVIEW TOÀN NHÁNH (lượt thứ MƯỜI MỘT)

**Nhánh** `feat/hmi-dep` · **HEAD** `7a9bba69` · **phạm vi** `2ce5bbc2..HEAD` (20 commit, 4.507 dòng diff)
**Ngày** 2026-08-12 · **Chỉ đọc và đo** — 0 commit, 0 `git add`, 0 DDL, 0 restart máy chủ.
**Cây làm việc sau lượt review**: `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` ⇒ **0 dòng**.

---

## 0. Bảng tóm tắt

| Mức | Số |
|---|---|
| **Critical** | **1** |
| **Important** | **6** |
| **Minor** | **6** |
| *(đã nghi rồi RÚT LẠI sau khi đo)* | *7* |

**Cổng đã chạy trong lượt review:**

| lệnh | kết quả |
|---|---|
| `npm run check` (đọc mã thoát bằng `PIPESTATUS`, **không** qua `tail`) | **exit 0** |
| 13 file lưới Pha 9 đụng tới (`vitest run <đường dẫn cụ thể>`) | **165/165 xanh** (13 file) |

⚠ **Bốn phát hiện dưới đây là ĐỘT BIẾN CÓ ĐO, không phải đọc mã**: mỗi cái kèm lệnh và kết xuất.
Mọi file probe đã bị xoá; cây sạch.

---

## 1. ★★★★ CRITICAL — C-1: **TÀI KHOẢN BỊ TẮT (`users.isActive = false`) VẪN XÁC THỰC ĐƯỢC TRÊN MỌI BỀ MẶT PHIÊN**

**Mức** Critical
**File** `server/_core/sdk.ts:475-560` (`xacThucTho`) · `server/db/auth.ts:278-291` (`updateUser`) · đối chứng: `server/_core/index.ts:1662`

### Cái sai

`sdk.xacThucTho` — cửa **duy nhất** cho tRPC, socket, và mọi tuyến REST — hỏi ba câu:
*vé có ký đúng không* (`verifySession`), *hàng sổ phiên còn sống không* (`chanNeuPhienDaThuHoi`, **Pha 9 A2 vừa dời lên**),
và *người này có bị buộc đổi mật khẩu không* (`chanNeuPhaiDoiMatKhau`).
Nó **không bao giờ** hỏi *"tài khoản này còn được bật không"*. `db.getUserByOpenId` (`server/db/auth.ts:191-200`)
cũng không lọc `isActive`; `server/_core/trpc.ts` và `server/_core/context.ts` **không có một lượt nhắc `isActive` nào**.

Còn `db.updateUser` — đường admin **duy nhất** để tắt một tài khoản (`userRouters.ts:88,111`) — chỉ **dọn cache**:

```ts
// server/db/auth.ts:289-290
await db.update(users).set(data).where(eq(users.id, userId));
await invalidateAuthUser(userId); // covers role change + ban (isActive:false)
```

⚠ **Bình luận ấy SAI đúng một nửa.** Dọn cache buộc lượt kế tiếp đi đường DB — điều đó **có** làm
lượt đổi **vai** ăn ngay. Nhưng đường DB trả về **đúng hàng ấy, không lọc gì**, nên với **ban** lượt
dọn cache không mua được gì cả. Và lượt tắt tài khoản **không** lật `user_sessions.isActive`.

### Bằng chứng ĐO ĐƯỢC (probe hành vi trên DB test thật, đã xoá file)

```
npx vitest run server/_core/__revProbeBan.test.ts
### KẾT QUẢ SAU KHI TẮT TÀI KHOẢN: ĐI QUA id=2087 role=user isActive=false
### hàng user_sessions sau lượt tắt: isActive = true
  × PROBE — tài khoản bị TẮT vẫn xác thực được ⇒ expected false to be true
```

Trình tự probe: dựng tài khoản → dựng phiên THẬT (JWT + hàng `user_sessions`) → `authenticateRequest` ⇒ **OK**
(cầu chì) → `db.updateUser(uid, { isActive: false })` (**đường sản phẩm**, nó tự gọi `invalidateAuthUser`)
→ khẳng định `getUserById(uid).isActive === false` (cầu chì thứ hai) → `authenticateRequest` ⇒ **ĐI QUA**.

### ⚠ ĐỐI CHỨNG CÓ ĐÁP SỐ BIẾT TRƯỚC — cơ chế ĐÃ TỒN TẠI, cách đó 30 dòng, trên đường HẸP HƠN

```
server/_core/index.ts:1662   if (user && user.isActive) {        ← validateExternalAuth (nhánh Bearer)
server/_core/authService.ts:211  if (!user.isActive) {           ← lượt ĐĂNG NHẬP
```

⇒ Một tài khoản đã tắt **không đăng nhập lại được** và **không vào được `/api/external/*`**,
nhưng **cookie đang cầm trên tay thì vẫn dùng được toàn bộ ứng dụng web**. Đây đúng lớp lỗi
*"an toàn là HỆ QUẢ của thứ khác đang hỏng"* (đã bảy lần): người ta tin lượt ban có hiệu lực vì
**lượt đăng nhập** chặn, mà lượt đăng nhập không phải cửa mà một phiên đang sống đi qua.

### Vì sao đây là phát hiện của lượt review TOÀN NHÁNH, không phải của một task

A2 trả **−44% thông lượng** để mua bất biến *"thu hồi có hiệu lực NGAY"*, và lưới
`thuHoiPhienMoiBeMat.test.ts` phát biểu ∀ *"phiên ĐÃ THU HỒI phải bị chặn"*. Nhưng **"thu hồi"
trong toàn bộ từ vựng của lưới ấy = `user_sessions.isActive === false`**. Ý định thu hồi phổ biến
nhất của một người vận hành — *"tắt tài khoản của người vừa nghỉ việc"* — **không sinh ra một lượt
thu hồi nào**, nên lượt `SELECT` mà A2 vừa trả tiền cho **mỗi request** không chạm được nó. Không
task nào của Pha 9 nhìn thấy điều này vì mỗi task chỉ thấy diff của mình.

### Hậu quả thật nếu không vá

`expiresInMs: ONE_YEAR_MS` ở **cả ba** cửa đúc vé (`authService.ts:413`, `oauth.ts:313,517`) ⇒
một tài khoản bị tắt giữ nguyên **toàn quyền của vai cũ tới MỘT NĂM**. Với vai `admin` thì đó là
toàn quyền quản trị. Sổ `user_sessions` hiện có **297 hàng / 39 còn sống**.

### ⚠ Đo trên DB SẢN XUẤT: hôm nay **không có nạn nhân** — và đó là MAY, không phải cưỡng chế

```sql
SELECT count(*) FROM user_sessions s JOIN users u ON u.id=s."userId"
 WHERE u."isActive"=false AND s."isActive"=true AND (s."expiresAt" IS NULL OR s."expiresAt">now());
 ⇒ 0
```
Có **2** tài khoản đang tắt (`p1_audit_op` operator, `p1_audit_admin` **admin**), phiên của chúng
đều đã `isActive=f` — bị thu hồi **bằng một đường khác**, không phải bởi lượt tắt tài khoản.

### Đường vá đề xuất

Hai nửa, **cùng một lượt** (một nửa là nửa dối):
1. **Cưỡng chế tại điểm chung** — thêm vào `xacThucTho`, **ngay cạnh** `chanNeuPhienDaThuHoi` và
   **trước** lượt đọc cache: `if (user.isActive === false) throw ForbiddenError("ACCOUNT_DISABLED")`.
   ⚠ Nhánh trúng cache trả `cachedUser` nên phép kiểm phải đứng ở chỗ **cầm được hàng thật**, hoặc
   `setCachedAuthUser` phải từ chối cache một hàng đã tắt. Cách rẻ nhất và đúng khuôn A2: đọc cờ từ
   chính hàng `users` mà `chanNeuPhaiDoiMatKhau` **đã** đọc mỗi lượt (gộp một `SELECT`, không thêm).
2. **`db.updateUser` phải THU HỒI, không chỉ dọn cache** — khi `data.isActive === false` thì gọi
   `revokeAllSessions(userId)`. Và sửa bình luận dòng 290: nó đang khai một sự phủ không có.
3. **Lưới**: nới từ vựng của `thuHoiPhienMoiBeMat.test.ts` từ *"hàng sổ bị lật"* sang *"chủ thể mất
   quyền truy cập"*, kèm một ô HÀNH VI đúng hình dạng probe ở trên (dựng tài khoản → tắt → đo).

---

## 2. Important

### I-1 — §6 của A1 tự xưng *"∀ registrar TRÊN ĐĨA"* nhưng chỉ đi **HAI thư mục**; ba registrar khớp **đúng vị từ của chính nó** nằm ngoài

**Mức** Important · **File** `server/routes/xacThucBeMatRest.test.ts:352-365`

`moiRegistrar()` là thiết bị **chống N+1** của A1 — nó tồn tại để trả lời *"và ai canh chính danh
sách registrar?"*. Nhưng phạm vi của nó là một **danh sách hai phần tử viết tay**:

```ts
duyet("server/routes");
duyet("server/api");
```

**Đo được** (chạy **cùng một vị từ** `/export function register\w*\s*\(/` trên toàn `server/`):

```
REGISTRAR (server/routes + server/api) = 22      ← con số §6 ghim
CÙNG VỊ TỪ trên toàn bộ server/        = 55
NGOÀI TẦM, và là registrar Express THẬT:
   server/_core/oauth.ts          → registerOAuthRoutes      (6 tuyến, gồm POST /api/auth/verify-2fa)
   server/_core/samlProvider.ts   → registerSamlRoutes       (3 tuyến, gồm ACS của SAML)
   server/_core/securityHeaders.ts→ registerCspReportEndpoint(1 tuyến)
CỘNG: server/_core/index.ts gắn 87 tuyến `app.<verb>(…)` THẲNG, không qua registrar nào.
```

⚠ Ba file ấy **thoả đúng hình dạng** mà §6 đi tìm; thứ duy nhất loại chúng ra là **thư mục**.
Và một trong số đó là `POST /api/auth/verify-2fa` — chính tuyến mà **A5 vừa đổi người tiêu mã dự
phòng**. Tức Pha 9 sửa hành vi của một tuyến rồi dựng một lưới hành vi mà tuyến ấy **theo cấu tạo**
không nằm trong.

**Hậu quả**: câu *"0/12 tuyến trả 5xx"* của báo cáo nhóm A đúng **cho 12 tuyến của 3 registrar**;
10 tuyến REST phiên khác + 87 tuyến inline **chưa từng được gọi thật lần nào**. Một tuyến thứ 13 ở
`server/_core/` không làm §6 đỏ.

**Đường vá**: `duyet("server")` (một thư mục, không ba), rồi khai tên phần ngoài phạm vi — đúng
khuôn `THU_MUC_NGOAI` đã có. Cộng một ô ∀ thứ hai theo **hình dạng gắn tuyến** (`app.<verb>(`) chứ
không theo tên hàm, để `server/_core/index.ts` không tàng hình.

---

### I-2 — **B1 bị BÁC BỎ bằng một phép đo trên SAI TẬP**: 21 lượt `vi.mock` **không có factory** là **automock**, và automock **im lặng đúng như brief mô tả**

**Mức** Important · **File** báo cáo nhóm B §2 (`docs/superpowers/reports/2026-08-11-vram-pha9-nhom-b.md:51-100`)

Lý lẽ bác bỏ: *"872/880 = 99,1% bề mặt tầng `db` là **hàm**. Khoá hàm thiếu ⇒ `undefined(...)` ⇒
**TypeError** ⇒ ồn ào."* Phép hiệu chuẩn: **bỏ một khoá ra khỏi một factory** ⇒ 5/6 đỏ.

⚠ Phép ấy chỉ đúng cho `vi.mock(path, () => ({…}))` — hình dạng **factory**, nơi khoá **VẮNG MẶT**.
Repo còn một hình dạng thứ hai mà lượt đo **không chạm tới**: `vi.mock(path)` **không factory**.
Vitest khi ấy nhập module gốc rồi **automock** — mọi export thành **spy tồn tại, trả `undefined`**.
Khoá **có mặt**. Không có `TypeError` nào.

**Đo được** (probe, đã xoá):

```
grep -rn 'vi\.mock("[^"]*db[^"]*")\s*;' --include=*.ts server/ | wc -l   ⇒ 21
```
```
npx vitest run server/_core/__revProbeAutomock.test.ts     // vi.mock("../db")  — KHÔNG factory
### typeof db.phaiDoiMatKhau      = function
### db.phaiDoiMatKhau(1)          => undefined            ← KHÔNG ném
### db.getSessionByToken('x')     => undefined            ← KHÔNG ném
### biChanBoiCongDoiMatKhau('user', undefined) = false    ← CỔNG MỞ, im lặng
Test Files 1 passed
```

⇒ Con số **99,1% là HÀM** không phải lý do để yên tâm — nó **chính là cơ chế** khiến automock im
lặng: một hàm **có thật** trả `undefined`. 21 điểm ấy gồm cả các file tên là *gate*
(`aiQualityGate.inlineGate.test.ts`, `aiQualityGateCanary.test.ts`, `machineSyncGate.test.ts`).

**Hậu quả**: kết luận *"cơ chế trong brief KHÔNG tồn tại ở 99,1% bề mặt"* nay có một **giấy chứng
nhận vô can** cho một tập chưa ai đo. Nợ N-3 khai *"10 điểm mặt-module"* — con số ấy đếm sai tập.

**Đường vá**: đo lại B1 trên **đúng tập automock** (21 lượt), rồi quyết. Bản vá rẻ và đúng trục:
cấm hình dạng `vi.mock(<db>)` không factory bằng một ∀ trên đĩa (cùng khuôn `totpReplayScan`), vì
nó là hình dạng **không thể ồn ào theo cấu tạo**.

---

### I-3 — A3: nhánh **`SELECT *`** chỉ bắt dạng **trần**; `SELECT <bí danh>.*` — hình dạng tự nhiên nhất của một `JOIN` — **mù**

**Mức** Important · **File** `server/routers/deployProcedureScan.ts:842-850`

```ts
return /\bselect\s+\*/.test(s);
```

Tên ca lại khai rộng hơn: *"`SELECT *` trên bảng bí mật bị bắt (**không cần nêu tên cột nào**)"*,
và docstring: *"`SELECT *` kéo MỌI cột kể cả bí mật — không bắt là để ngỏ đúng hình dạng lười nhất"*.

**Đo được** (probe qua chính `diemDocBiMatTrongNguon`, đã xoá):

```
### SELECT *  (trần)                     => 1 điểm
### SELECT s.*                           => 0 điểm   ← MÙ
### SELECT us.*, u.id (JOIN với users)   => 0 điểm   ← MÙ
### nối chuỗi: bảng ở biến               => 0 điểm   (đã khai: bắt ở tầng LITERAL)
```

**Hậu quả**: cách viết **có xác suất cao nhất** để một câu SQL thô chạm `user_secrets` là gắn nó
vào `users` bằng `JOIN` và lấy `us.*`. Đúng hình dạng ấy đi qua **cả ba** lưới (§4b drizzle, §4c
quyền truy cập, §4e SQL thô) mà không lưới nào thấy — tức lỗ A3 vừa vá **vẫn còn nguyên một nửa**,
và nay có một ca xanh mang tên *"`SELECT *` … bị bắt"* đứng cạnh.

**Đường vá**: `/\bselect\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?\*/` (một dòng), cộng ba ca dựng sẵn
(`s.*` · `us.*, u.id` · `COUNT(*)` giữ nguyên đối chứng dương). Không nới ra ngoài đó.

---

### I-4 — Nửa CLIENT của A4: hộp thoại *"hiện đúng một lần"* **ĐÓNG ĐƯỢC** bằng nút X và bằng Esc

**Mức** Important · **File** `client/src/pages/Profile.tsx:527-545` · `client/src/components/ui/dialog.tsx:92-146`

Bình luận trong chính bản vá:

```tsx
// Profile.tsx:527-529
★★★ Pha 9 A4 — HỘP THOẠI MÃ DỰ PHÒNG. Cố ý **không** đóng được bằng nút X / bấm ra ngoài
khi chưa xác nhận: đây là lần hiển thị DUY NHẤT, đóng nhầm là mất bộ mã vĩnh viễn.
```
```tsx
// Profile.tsx:530 — thứ THẬT SỰ được viết
<DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
```

**Đo được** (đọc chính component dùng chung):

* `dialog.tsx:95` — `showCloseButton = true` **là mặc định**, và `Profile.tsx:530` **không** truyền
  `showCloseButton={false}` ⇒ nút **X** (`DialogPrimitive.Close`, `dialog.tsx:135-141`) **có** render.
* `dialog.tsx:100-118` — `handleEscapeKeyDown` chỉ `preventDefault()` khi **IME đang gõ**; ngoài ra
  nó gọi tiếp `onEscapeKeyDown?.()` và để Radix đóng. `Profile.tsx` không truyền `onEscapeKeyDown`.
* `Profile.tsx:529` — `onOpenChange={(open) => { if (!open) setShowBackupCodes(false); }}` ⇒ cả hai
  đường đều đóng thật. Chỉ nút **"Xong"** (dòng 542) mới bị `disabled={!backupCodesCopied}`.

**Hậu quả** — đúng cái A4 tự khai là **tệ hơn không cấp**: người dùng bật 2FA ở màn Hồ sơ, máy chủ
**xoá bộ mã cũ và cấp 10 mã mới** (`db.quayVongMaDuPhong`), hộp thoại hiện ra, người dùng bấm X
theo phản xạ ⇒ **10 chuỗi không ai từng đọc, máy chủ chỉ giữ bản băm**. Tệ hơn nữa: `Profile.tsx`
hiển thị *"số mã còn lại"* = **10**, nên màn hình **khẳng định với họ rằng họ có lưới an toàn**.
Đường cấp lại (`twoFactor.regenerateBackupCodes`) nằm ở **màn hình KHÁC** (`TwoFactorSetup.tsx`) —
đúng nợ N-1 *"hai họ 2FA song song"*.

**Đường vá**: `showCloseButton={false}` + `onEscapeKeyDown={(e) => e.preventDefault()}` trên
`DialogContent` dòng 530, và một ca lưới client khẳng định hộp thoại chỉ đóng qua nút "Xong".

---

### I-5 — Ba phép phân giải danh tính được tin **THEO TÊN**, không theo lượt nhập; và **hình dạng thứ ba vẫn vô hình với CẢ HAI lưới ∀**

**Mức** Important · **File** `server/_core/quetDiemXacThuc.ts:53,140-155,221`

`quetDiemXacThuc` xếp một điểm là *"đi qua điểm chung"* khi tên **lời gọi** là `authenticateRequest`
hoặc (Pha 9 A6) `thuXacThucRest`. Vị từ phủ (`buocDoiMatKhauMoiBeMat.test.ts:146-150`):

```ts
const phuTheoHinhDang = (d, diemChungBat) => (d.loai === "xt" && diemChungBat && !d.boQua) || d.tuCanh;
```

`uyQuyenRestDiQuaDiemChung()` chỉ đọc **một** file (`FILE_UY_QUYEN_REST`), nên nó ghim rằng *bản
gốc* uỷ quyền đúng — nó **không** ghim rằng mọi lời gọi mang tên ấy là bản gốc.

**Đo được** (đột biến, đã hoàn nguyên): thêm `server/services/__revProbeUyQuyen.ts` — một bề mặt
HTTP **tự phân giải danh tính** bằng `db.getSessionByToken` + `db.getUserById`, **không** kiểm
`hang.isActive`, **không** kiểm cờ buộc-đổi-mật-khẩu, và đặt tên hàm giúp việc là `thuXacThucRest`:

```
npx vitest run buocDoiMatKhauMoiBeMat.test.ts thuHoiPhienMoiBeMat.test.ts xacThucBeMatRest.test.ts
Test Files 3 passed · Tests 48 passed        ← KHÔNG một ô nào đỏ
```

Đổi tên hàm ấy thành `phanGiaiDanhTinhRieng` (không còn trùng tên):

```
Test Files 2 passed · Tests 33 passed        ← VẪN KHÔNG một ô nào đỏ
```

⇒ Hai kết luận, cả hai đo được:
1. **Hình dạng thứ ba** (`getSessionByToken` + `getUserById`) nằm ngoài **cả hai** lượng từ ∀ — đây
   là vùng mù được khai ở `buocDoiMatKhauMoiBeMat.test.ts:56-58, "không tồn tại hình dạng thứ ba
   trong server/** — nhưng đó là một **quan sát**, không phải bất biến"*. Nó **rẻ** để chạm tới, và
   nó là **đúng hình dạng lỗ C-1** đã tốn 58 tuyến `/api/external/*`.
2. Với cái tên `thuXacThucRest`, điểm ấy còn được xếp là **ĐƯỢC PHỦ** (khẳng định dương) và **cộng
   vào cầu chì §3 ≥12** — tức một bề mặt hở làm cho cầu chì *"bộ nhận diện còn thấy kho mã"* **khoẻ
   lên**.

⚠ Repo **đã có** khuôn vá đúng, cho một cái tên khác: `totpReplayScan.test.ts:220+` — *"∀ file gọi
`verifyTotpOnce`: nó PHẢI nhập hàm ấy từ chính `_core/totpOnce`"*, nhận diện module bằng **phép nối
đường dẫn** (bài học R1b). Ba cái tên xác thực chưa có ô ấy.

**Đường vá**: sao khuôn `totpReplayScan` cho `authenticateRequest` / `thuXacThucRest` (phải nhập từ
`_core/sdk` / `routes/_xacThucRest`), và thêm hình dạng thứ ba vào bộ nhận diện
(`getSessionByToken(...)` theo sau bởi một lượt lấy hàng `users` trong cùng đơn vị) — không phải
một danh sách file.

---

### I-6 — `POST /api/ai/local-kb/feedback`: **ghi tệp, không xác thực, không cưỡng chế loopback** — và tập miễn trừ của lưới cấp cho nó một tấm vé **vĩnh viễn**

**Mức** Important · **File** `server/routes/aiLocalKnowledgeApi.ts:532-570` · miễn trừ ở `server/routes/xacThucBeMatRest.test.ts:174-175`

**Đo sống trên máy chủ đang chạy (PID 8360), KHÔNG cookie:**

```
curl -X POST -d '{}' http://127.0.0.1:3000/api/ai/local-kb/feedback
{"success":false,"error":"messageId and question are required"}   HTTP=400
```

**400, không phải 401** ⇒ thân handler chạy **trước** mọi phép xác thực. Không có `isLoopback`,
không có API key, không có giới hạn tần suất. Mỗi lượt gọi hợp lệ **append một dòng** vào
`knowledge/feedback.jsonl` (`aiLocalKnowledgeApi.ts:26`), mỗi dòng tới ~10 KB
(`question` 2.000 + `answer` 8.000 ký tự).

Lời khai miễn trừ nói: *"Lượt gọi máy-sang-máy trong localhost … tầng tRPC đã cưỡng chế phiên"*.
⚠ **Không có cơ chế nào cưỡng chế mệnh đề "trong localhost"** — nó là một **mô tả về người gọi có
thiện chí**, không phải một điều kiện được kiểm. Nhóm A đã ghi đúng nợ này (§8 mục 1); điều review
này thêm là: tập `AUTH_FREE` biến nó thành **một dòng xanh mỗi lượt chạy cổng**, và §4 chỉ kiểm
*"mục khai có tồn tại như một tuyến thật"* + *"lý do dài > 30 ký tự"* — không kiểm **cơ chế thay thế
có tồn tại không**. Đây đúng khuôn `MIEN_TRU` của `hoTuyenSongSong` **thiếu** phần mạnh nhất: ở đó
mỗi miễn trừ ghim một **chữ ký chênh lệch chính xác**; ở đây chỉ ghim một câu văn.

**Hậu quả**: bất kỳ ai với tới cổng 3000 đều ghi được không giới hạn vào một tệp trong repo (đầy
đĩa), và bơm nội dung tuỳ ý vào đúng cái kho được mô tả là *"để tái nạp vào KB curation"*.

**Đường vá**: (a) thêm `isLoopback` guard (hàm đã có sẵn ở `observabilityRoutes.ts`) — đây là nợ
nhóm A đã đề xuất, cần chủ dự án duyệt; (b) **ngay bây giờ, không cần duyệt**: đổi `AUTH_FREE` từ
`Record<string, string>` sang `Record<string, { lyDo: string; coCheThayThe: string }>` và bắt lưới
khẳng định cơ chế ấy **có thật trong mã của tuyến** — để một lời khai không thay được một cơ chế.

---

## 3. Minor

| # | Mức | File:dòng | Cái sai | Bằng chứng | Đường vá |
|---|---|---|---|---|---|
| **M-1** | Minor | `server/routers/hoTuyenSongSong.test.ts:212` và `:289` | Docstring ghim *"cặp bất đồng **thứ mười tám**"*, tên ca ghim *"cặp thứ **mười sáu**"*, trong khi tập có **16** mục ⇒ cặp mới là thứ **17**. Hai con số sai khác nhau trong cùng một file, cả hai là tàn dư của lượt `15 → 17 → 16`. | Đếm khoá của `MIEN_TRU` bằng AST ⇒ **16**; `SO_MIEN_TRU = 16` (`:223`) khớp mã, lệch **lời khai**. | Sửa cả hai câu về "thứ mười bảy". Lời khai lệch số là đúng thứ mà `SO_MIEN_TRU` được dựng ra để chống. |
| **M-2** | Minor | `package.json` (`dependencies.otplib = ^13.4.0`) · `server/routers/totpReplayScan.test.ts:207-224` | B3 xoá người nhập `otplib` cuối cùng và nới ∀ ra `*.test.ts`, nhưng gói vẫn ở **`dependencies`** ⇒ **vẫn được cài ở máy sản xuất** (`npm ci --omit=dev` giữ nó). ∀ chỉ phủ `server/**`; `client/`, `shared/`, `scripts/` ngoài tầm. | `node -e "console.log(require('./package.json').dependencies.otplib)"` ⇒ `^13.4.0`. Đối chiếu: B7a lập luận đúng cùng trục cho `typescript` **vì** nó ở `devDependencies`. | Chuyển `otplib` khỏi `dependencies` (nay 0 người nhập) — lượt gỡ khiến ∀ trở thành bất biến của **cả cây phụ thuộc**, không chỉ của `server/**`. |
| **M-3** | Minor | `server/_core/sdk.ts:519-523` | A2 viết lại bình luận cache và **bỏ** cảnh báo cũ *"Staleness window (**role change / ban** / revocation …) is bounded by the TTL"*, thay bằng *"cache hit means the user lookup and the lastSignedIn touch completed…"*. A2 chỉ vá nhánh **revocation**; hai nhánh kia **không đổi** — và nhánh `ban` thì tệ hơn thế (xem **C-1**). | So diff `504ad10b` (dòng −/+ của khối bình luận). | Trả lại câu cảnh báo, thu hẹp đúng phần đã vá. Bình luận nói **ít hơn** sự thật cũng là tài liệu sai. |
| **M-4** | Minor | `server/routes/_xacThucRest.ts:51-55` | `catch { return null }` gộp **mọi** nguyên nhân về 401, gồm `MUST_CHANGE_PASSWORD` (vốn là 403-class) và *"DB không với tới"*. 7 tuyến REST nay không phân biệt được *"đăng nhập lại"* với *"phải đổi mật khẩu"*. | Đọc mã; đối chiếu `sdk.ts:65-71` ném `ForbiddenError` có mang chuỗi `MUST_CHANGE_PASSWORD` **cố ý để phân biệt được**. | Trả `{ user: null, lyDo: "…" }` hoặc để người gọi ánh xạ `MUST_CHANGE_PASSWORD → 403`. Fail-closed giữ nguyên; chỉ mã trạng thái mịn hơn. |
| **M-5** | Minor | `server/db/auth.ts:337-352` (`quayVongMaDuPhong`) | Không có giao dịch: `xoaMoiMaDuPhong(userId)` **rồi** 10 lượt `insert` rời. Một lượt hỏng giữa chừng ⇒ người dùng còn 0–9 mã, bộ cũ **đã mất**. A4 làm hàm này thành **NGƯỜI CẤP DUY NHẤT** với **ba** người gọi, nên bề mặt rộng gấp ba. | Đọc mã: `xoaMoiMaDuPhong` nhận `tx?` nhưng được gọi **không có** `tx`; đối chiếu `disable2FA` được mô tả là *"MỘT giao dịch, hai bảng"*. Docstring A4 (`userRouters.ts:350-353`) **thừa nhận** trạng thái *"2FA bật + 0 mã"* và coi là hồi phục được. | Bọc trong `db.transaction(tx => …)` và truyền `tx` xuống `xoaMoiMaDuPhong`. Cùng khuôn đã dùng ở `disable2FA`. |
| **M-6** | Minor | `server/_core/quetKhongVoiToiSanXuat.test.ts:196-203` (`phanGiai`) | Phép với-tới chỉ đi theo **đường dẫn tương đối**; alias `@shared/*` bị bỏ. Cầu chì `VOI_TOI.size > 500` **không thể** phát hiện mất mát này (đo được 1041 ≫ 500). | Probe: bao đóng **1041** file; đi theo alias tsconfig ⇒ **1051**; **10** file bị bỏ sót, **toàn bộ** là `shared/**`; **0** trong số đó nhập `typescript`. | Thêm phân giải alias từ `tsconfig.paths` (10 dòng). Vô hại **hôm nay** — nhưng một module quét AST đặt ở `shared/` sẽ vô hình. |

---

## 4. ★ Những gì tôi đã NGHI rồi **RÚT LẠI sau khi đo**

Mười lượt trước đã có reviewer tự rút lại đề xuất của chính mình sau khi đo; dưới đây là bảy lượt
của tôi. **Không mục nào trong số này là finding.**

| # | Nghi ngờ ban đầu | Phép đo | Phán quyết |
|---|---|---|---|
| **R-1** | B7a mù nặng vì `phanGiai` bỏ alias ⇒ bao đóng thiếu cả một cây con, ô ∀ *"không module với-tới nào nhập `typescript`"* xanh giả. | Bao đóng 1041 → 1051 khi đi theo alias; **10** file, tất cả `shared/**`, **0** file nhập `typescript`. | **RÚT** khỏi Important; hạ xuống **M-6**. Phép đo bác bỏ quy mô tôi giả định. |
| **R-2** | `moiFileTs()` dùng `require("node:fs")` trong một file `.ts` chạy dưới ESM ⇒ `require is not defined` ⇒ file test vỡ hoặc bị bỏ qua. | `npx vitest run server/_core/quetKhongVoiToiSanXuat.test.ts` ⇒ **7/7 xanh**, ô §1 chạy 1.483 ms trên bao đóng thật. | **RÚT.** Vitest có interop CJS; lời nghi sai. |
| **R-3** | A5 gỡ `sinhMaDuPhong`/`bamMaDuPhong`/`khopMaDuPhong` khỏi `twoFactorRouter.ts` nhưng để lại `backupCodes`/`and` thành import chết. | `grep` ⇒ cả hai còn dùng ở `getStatus` (`:49-53`). `npm run check` ⇒ **exit 0**. | **RÚT.** |
| **R-4** | `.DRAFT` 0320 dựa trên số đo cũ; chỉ số có thể không trùng hoàn toàn (khác `opclass`/`WHERE`). | `psql` trên `aoi_management`: **6** chỉ số; `idx_user_sessions_token` `uniq=f` `ràng buộc=0` **139.264 B**; `user_sessions_sessionToken_unique` `uniq=t` `ràng buộc=1` **147.456 B**; `pg_get_indexdef` cho thấy **cùng cột, cùng btree, không `WHERE`**. | **RÚT.** Mọi con số của `.DRAFT` khớp **từng chữ**. Bản nháp đúng; vẫn **KHÔNG áp** (chờ duyệt). |
| **R-5** | A6/A2 chưa có hiệu lực trên tiến trình đang chạy (`mtime` không suy được điều đó). | **Đối chứng âm HÀNH VI**, không cookie, trên PID **8360**: 7/7 tuyến ⇒ **401** (trước bản vá: 6 tuyến ⇒ 500). Cộng đối chứng thân hàm trong `dist/index.js` (neo vào `async xacThucTho(` — **không** vào bảng xuất): `chanNeuPhienDaThuHoi(sessionCookie)` đứng **TRƯỚC** `getCachedAuthUser(...)`; `thuXacThucRest`, `quayVongMaDuPhong`, `Number(result[0]?.count ?? 0)` đều có mặt. | **RÚT.** Toàn bộ mã sản phẩm của Pha 9 **đang sống**. |
| **R-6** | `server/_core/index.ts:1251` là bề mặt REST thứ 7 trả 500 mà A6 bỏ sót. | Đọc `:1249-1288`: lượt gọi nằm trong `try { … } catch { /* fall through */ }` **riêng**, rồi rẽ về `res.status(401)`. | **RÚT.** A6 đếm đúng 6 trong phạm vi nó đo. |
| **R-7** | C-1 đang bị khai thác trên hệ sản xuất (tài khoản `p1_audit_admin` vai `admin` đã tắt). | `psql`: **0** phiên còn sống thuộc tài khoản đã tắt; mọi hàng của hai tài khoản ấy `isActive=f`. | **RÚT phần "đang bị khai thác"**; **GIỮ** phần *"cơ chế không tồn tại"* — nó được chứng minh bằng probe hành vi, không bằng trạng thái DB hôm nay. |

---

## 5. Những gì tôi ĐÃ SOI và thấy ĐÚNG (không thành finding)

* **Trục 2 — A2 dời thứ tự.** `chanNeuPhienDaThuHoi` đứng **sau** `verifySession` (nhánh sớm duy
  nhất) và **trước** lượt đọc cache; §5 đếm bằng AST và ghim **đúng một** call site. Không có đường
  nào chạy hai lần, không có nhánh `return`/`throw` nào chen vào giữa. Lượt dời **chỉ thêm** phép
  kiểm cho nhánh trúng cache ⇒ nghiêm ngặt hơn theo cả hai chiều. `sdk.authCache.test.ts` ghim
  **7** (không phải 3) và nói rõ *"về 1 là mở lại cửa sổ 45 s"*.
* **Trục 3 — lượng từ tự thoả.** Soi từng lưới ∀ mới: `soPhienTruocCache` §5 (AST, ba đáp số biết
  trước gồm **chính ca đã lừa bản đầu**), `quetKhongVoiToiSanXuat` §0 (ba cầu chì) + §2 (M3 trên bao
  đóng giả), `tieuMaDuPhong` §3 (đối chứng *"không đốt nhầm mã"*), `xacThucBeMatRest` §5 (ba handler
  dựng sẵn). **Không** cái nào giao với chính tập phủ của nó.
* **Trục 5 — lưới neo vào fixture.** Ba lưới hành vi mới (`soPhienTruocCache`, `tieuMaDuPhong`,
  `xacThucBeMatRest`) đều **tự dựng tài khoản + phiên thật** trên `aoi_management_test` qua
  `db.createLocalUser` / `db.createUserSession` — nguồn sinh dữ liệu **thật**, không fixture.
  `A3` lấy tên SQL từ `getTableName()` + `.name`, đúng bài học *"BẢNG snake_case, CỘT camelCase"*.
* **Trục 9 — B8 bị bác bỏ.** Lý lẽ đứng vững: file `visionControl.tools.test.ts` được đo ở **ba**
  mức tải, xa 5000 ms; kẻ quá hạn thật (`aiRcaCopilot.test.ts`) được nêu tên và **không** bị tự nới
  trần vì nằm ngoài §Cổng kiểm chung. *(B1 thì không — xem **I-2**.)*
* **Trục 10 — `MIEN_TRU`.** Xác nhận số: **16** khoá, khớp `SO_MIEN_TRU`. Xác nhận phán quyết
  *"11/16 sinh từ MỘT gốc"* — hai họ thủ tục 2FA song song, cả hai **đều đang được client gọi thật**
  (`Profile.tsx` ← `user.*` · `TwoFactorSetup.tsx` ← `twoFactor.*`). Nợ N-1 là nợ SẢN PHẨM, đúng như
  khai. ⚠ Nó **đang gây hại đo được**: **I-4** tồn tại chính vì đường cấp lại mã nằm ở họ kia.
* **B5.** `npm run check` ⇒ **exit 0**, đọc bằng `PIPESTATUS` (không qua `tail`, đúng bài học thiết
  bị nói dối lần 3 của nhóm B).

---

## 6. Ràng buộc cứng — đã giữ

* **0** commit · **0** `git add` · **0** DDL/migration/seed/`kb:sync` · **0** cấp quyền · **0** đổi
  mật khẩu/cờ/vai/quyền của bất kỳ tài khoản có thật nào.
* **0** restart máy chủ. Tiến trình phục vụ cổng 3000 nhận diện **THEO CỔNG**
  (`Get-NetTCPConnection -LocalPort 3000 -State Listen` ⇒ `OwningProcess` = **8360**, dòng lệnh
  `node␣␣dist/index.js`, độ dài **19**) — không bằng chính tả.
* Ba `.DRAFT` trong `drizzle/` **không đụng, không đổi tên**. ~245 mục dirty ngoài phạm vi **không
  chạm, không stage**.
* **0** sub-agent.
* Bốn file probe (`__revProbeBan.test.ts`, `__revProbeAutomock.test.ts`, `__revProbeA3.test.ts`,
  `__revProbeUyQuyen.ts`) đã **xoá**. Kiểm cuối:
  `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` ⇒ **0 dòng**.
* Hai ca đỏ có trước (`api.test.ts › Factory Router` · `authService.test.ts › F9-Minor`) **không
  chạm tới**.
