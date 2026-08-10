# Pha 7 — Review TOÀN NHÁNH (lượt thứ CHÍN)

**Phạm vi:** `d3c448ed..HEAD` (32 commit · 89 file · +12.268/−603) trên `feat/hmi-dep`.
**Ngày:** 2026-08-09 · **Chế độ:** CHỈ ĐỌC VÀ ĐO. Không sửa mã, không commit, không DDL.
**Cây làm việc cuối lượt:** `git status --porcelain -- server/ client/ shared/ scripts/ drizzle/` ⇒ **RỖNG** (mọi đột biến đã hoàn nguyên; xác nhận sau mỗi lượt).

---

## 0 · Bảng tóm tắt

| Mức | Số | Mã |
|---|---|---|
| **Critical** | **2** | C-1 · C-2 |
| **Important** | **5** | I-1 · I-2 · I-3 · I-4 · I-5 |
| **Minor** | **3** | M-1 · M-2 · M-3 |

**Đo được, không suy ra:** 6/10 finding có đột biến kèm ca đỏ/xanh hoặc kết xuất lệnh. 2 finding là phép đếm trực tiếp (`git grep`). 2 finding (M-1, M-2) là quan sát tĩnh và được ghi rõ là **GIẢ THUYẾT về hậu quả**.

### Câu một dòng của lượt này

> **Pha 7 dời hai bí mật ra khỏi `users` (9c) — và **cả ba tầng phòng vệ của Task 7 đều neo vào `users`**. Sau lượt dời, không tầng nào còn chạm được tới `passwordHash`/`twoFactorSecret`. R1 nhìn thấy đúng nguy cơ ấy, nhưng bản vá của R1 chỉ dựng lại **một cầu chì về tập rỗng**, không dựng lại **cổng KIỂU** và cũng không mở rộng **bộ quét BỀ MẶT**. Đo được: một thủ tục tRPC trả thẳng `twoFactorSecret` ra trình duyệt đi qua `tsc` sạch và **58/58 XANH** trên **sáu** lưới của Task 7/8/9.**

Và ở tầng dưới nó: **đường GHI của cùng hai bí mật ấy chưa bao giờ được đếm.** Task 8a dựng lượng từ `∀ NGƯỜI GHI` cho `backup_codes.code` — bí mật **ít nguy hiểm nhất**. Không lượng từ nào được dựng cho `user_secrets.twoFactorSecret` — **hạt giống sinh mọi mã OTP**. Hệ quả là C-1: một thủ tục `protectedProcedure` **ghi đè hạt giống TOTP** mà không đòi mật khẩu, không đòi OTP, không kiểm cờ 2FA.

---

## 1 · CRITICAL

### C-1 · `user.setup2FA` ghi đè HẠT GIỐNG TOTP mà không đòi bằng chứng nào — mọi cổng step-up 2FA thành trang trí

**File:** `server/routers/userRouters.ts:222-249` (thủ tục `setup2FA`) · người ghi: `server/db/auth.ts:384-386` (`setup2FA` → `ghiBiMatNguoiDung`).

**Cái sai.** `user.setup2FA` là `protectedProcedure` — nó chỉ đòi **một phiên hợp lệ**. Nó **không** đòi mật khẩu, **không** đòi OTP, **không** đi qua `requirePerCallFreshTotp`, và — khác hẳn tuyến song song `twoFactor.generateSecret` (`server/routers/twoFactorRouter.ts:80-82`, `if (user[0].twoFactorEnabled) throw …`) — nó **không kiểm cờ `twoFactorEnabled`**. Nó sinh một secret mới, **ghi đè** `user_secrets.twoFactorSecret`, và **trả secret ấy về cho người gọi**. Cờ `users.two_factor_enabled` **giữ nguyên `true`**.

Đây đúng lớp *"hai bản sao của một vị từ dưới một bất biến"* mà chính Pha 7 đi diệt — và `server/_core/totpOnce.ts:20-24` **đã đếm** các cặp tuyến song song, đúng nguyên văn:

> *"trong đó **hai cặp tuyến SONG SONG** làm cùng một việc (`twoFactor.enable` ≡ `user.verify2FA`, `twoFactor.disable` ≡ `user.disable2FA`)"*

Phép đếm ấy **sót cặp thứ BA** — `twoFactor.generateSecret` ≡ `user.setup2FA` — và đó **chính là cặp mà hai bản sao BẤT ĐỒNG**: một bản có hàng rào, một bản không. Phần tử thứ N+1, lần thứ mười tám.

**Bằng chứng ĐO ĐƯỢC.** Đột biến-đo (`server/routers/__reviewProbe2fa.test.ts`, đã xoá; DB test thật):

```
[PROBE] 2FA đang bật=true · secret ĐỔI=true · cờ 2FA sau=true
[PROBE] secret mới == secret trả về client: true
[PROBE] mã do KẺ TẤN CÔNG sinh qua verifyTotpOnce: hopLe=true
 ✓ server/routers/__reviewProbe2fa.test.ts (1 test) 75ms
```

Kịch bản đo: tạo tài khoản → `setup2FA` + `enable2FA` (2FA BẬT) → gọi `appRouter.createCaller(ctx).user.setup2FA()` với **duy nhất một `ctx.user`** (mô hình một phiên bị chiếm) → đọc lại `db.get2FAStatus`.
⇒ Hạt giống **đã đổi**, cờ 2FA **vẫn bật**, và một mã sinh từ secret **do người gọi nhận được** đi qua `verifyTotpOnce` với `hopLe=true`.

**Hậu quả thật nếu không vá.**
Mọi cơ chế mà Pha 6 và Pha 7 dựng lên quanh TOTP đứng trên tiền đề *"hạt giống là thứ kẻ chiếm phiên KHÔNG có"*:
`requirePerCallFreshTotp` (7 `deployProcedure`) · vé một-lần `pendingTwoFactor` (Task 6) · sổ chống phát lại `totp_consumed` (Task 5, mig 0313) · step-up `vram.preempt`/`releaseStale`.
Với C-1, **một phiên bị chiếm là đủ để tự cấp hạt giống mới**, rồi **tự sinh mã hợp lệ** cho mọi cổng ấy — không cần mật khẩu, không cần điện thoại của nạn nhân, không cần đọc trộm secret cũ. Đây là **cùng một hậu quả** mà `server/_core/publicUser.ts:15-18` mô tả cho lượt rò `auth.me`:

> *"ai đọc được nó thì tự sinh mã hợp lệ **mãi mãi** ⇒ vé một-lần · sổ chống phát lại · step-up mỗi lượt **đều thành trang trí**"*

— chỉ khác là ở đây kẻ tấn công **không cần ĐỌC**, nó **GHI**.
Hậu quả phụ, cũng thật: người dùng hợp lệ **mất 2FA im lặng** (app authenticator của họ ngừng khớp) mà cờ vẫn báo *"đã bật"* ⇒ họ chỉ phát hiện ở lần đăng nhập sau.

**Đường vá đề xuất** (chỉ THU HẸP, không DDL):
1. `user.setup2FA` phải **từ chối khi `twoFactorEnabled === true`** — sao chép đúng hàng rào đã có ở `twoFactorRouter.generateSecret:80-82`. Đây là bản vá **nhỏ nhất đóng được lỗ**.
2. Nhưng bản vá 1 vẫn để lại **hai bản sao**. Đường đúng theo kỷ luật của chính nhánh này: **xoá `user.setup2FA` / `user.verify2FA` / `user.disable2FA`** và để `twoFactorRouter` là **chủ duy nhất** — hoặc cho `userRouters` uỷ quyền thẳng sang nó. `client/src/pages/Profile.tsx:60,69,101` là người gọi **duy nhất** của tuyến `user.*`; `client/src/components/TwoFactorSetup.tsx` đã dùng tuyến `twoFactor.*`.
3. **Đảo lượng từ, đừng vá hai điểm.** Dựng lưới song sinh với `backupCodeWriteScan.test.ts`, trên trục NGƯỜI GHI của bí mật **nguy hiểm hơn**:
   ***∀ điểm gọi `ghiBiMatNguoiDung(…, { twoFactorSecret })` / `setup2FA()` trong `server/**`: hàm bao phải chứa một BẰNG CHỨNG (mật khẩu vừa xác minh, hoặc `verifyTotpOnce`, hoặc hàng rào `twoFactorEnabled`).***
   Dùng lại `moiFileDuoi`/`laFileTest` của `deployProcedureScan.ts` — đừng viết bộ suy thứ N+1.

---

### C-2 · Sau 9c, **KHÔNG lưới nào** còn canh được lượt rò `twoFactorSecret` — cả ba tầng của Task 7 đều neo vào `users`

**File:** `server/_core/publicUser.ts:104-122` (cổng KIỂU) · `server/routers/userExposureScan.test.ts:119-142` (bộ suy `DOC_THO`) · `drizzle/schema/auth.ts:39-116` (9c).

**Cái sai.** Task 7 khai **ba** tính chất chồng nhau (`publicUser.ts:35-45`): (1) mặc định đóng, (2) phân loại toàn phần, (3) **đổi kiểu** — *"nhét một ô bí mật trở lại vào giá trị trả về là **LỖI BIÊN DỊCH**"*. Cả ba đều phát biểu trên **cột của `users`**.

9c dời `passwordHash` + `twoFactorSecret` sang `user_secrets`. Hệ quả **theo cấu tạo**:

* `keyof User` **không còn** hai tên ấy ⇒ `ServerOnlyUserField` = `"passwordChangedAt" | "passwordInvalidBefore"` ⇒ phần giao `{ [K in ServerOnlyUserField]?: never }` của `PublicUser` **không còn nhắc tới hai bí mật** ⇒ tính chất (3) **không còn chặn thứ nó được dựng ra để chặn**. Cổng KIỂU nay chỉ canh **hai dấu thời gian**.
* `userExposureScan` suy tập *"người đọc thô"* bằng cách tìm `.select()` **không phép chiếu** nối `.from(users)` **trong `server/db/auth.ts`** (`nguoiDocTho()`, dòng 119-140). Hai người đọc **duy nhất** còn chạm bí mật sau 9c — `layBiMatNguoiDung()` (`select({passwordHash, twoFactorSecret}).from(userSecrets)`) và `get2FAStatus()` (`leftJoin(userSecrets)`) — **đều có phép chiếu** và **đều không đọc `users` thô** ⇒ **cả hai nằm ngoài lượng từ theo cấu tạo**.

R1 (`Task 9`, `publicUser.ts:194-227`) nhìn đúng nguy cơ này và viết ra nó. Nhưng bản vá của R1 là `moiCotBiMatCuaUserSecrets()` — một hàm **chỉ được dùng trong `publicUser.test.ts`** để khẳng định *"tập cột bí mật KHÁC RỖNG"* và *"không cột nào của `user_secrets` lọt vào `PUBLIC_USER_FIELDS`"*. Vế thứ hai **đúng nhưng trống nghĩa**: `PUBLIC_USER_FIELDS` suy từ `keyof User`, mà cột của `user_secrets` **không thể** nằm trong đó. Báo cáo Task 9 §7.3 ghi *"R1 đã ĐÓNG — không chỉ khai"* với ô R1(a) = *"∀ cột bí mật của `user_secrets` ⇒ KHÔNG ra được **qua `toPublicUser()`**"* — phạm vi ấy đúng, và nó **hẹp hơn hẳn** câu mà Task 7 hứa.

**Bằng chứng ĐO ĐƯỢC.** Đột biến (đã hoàn nguyên bằng `git checkout HEAD -- server/routers/userRouters.ts`): đổi `user.get2FAStatus` để **giữ nguyên hợp đồng cũ** và **cộng thêm** hạt giống —

```ts
// server/routers/userRouters.ts:337-345
      return {
        enabled: status?.twoFactorEnabled || false,
        hasSecret: !!status?.twoFactorSecret,
        twoFactorSecret: status?.twoFactorSecret ?? null,   // ← ĐỘT BIẾN
      };
```

Kết quả:

```
$ npm run check
> tsc --noEmit
(0 lỗi)

$ npx vitest run server/_core/publicUser.test.ts server/routers/userExposureScan.test.ts \
    server/routers/mustChangePassword.test.ts server/routers/sessionGrantScan.test.ts \
    server/_core/backupCodeWriteScan.test.ts server/routers/totpReplayScan.test.ts
 Test Files  6 passed (6)
      Tests  58 passed (58)
```

⇒ **Hạt giống TOTP của người dùng đi thẳng ra trình duyệt, `tsc` sạch, 58/58 XANH.** Đây **chính là** lỗ mà Task 7 tồn tại để đóng, tái sinh cách chỗ vá **một bảng**.

*(Đối chứng: lượt đột biến đầu tiên — `return status;` trần — làm `tsc` ĐỎ, nhưng **vì lý do sai**: `client/src/pages/Profile.tsx` mất thuộc tính `.enabled`. Đó là một **tai nạn kiểu**, không phải một phép canh; đột biến giữ hợp đồng ở trên xoá tai nạn ấy và cho thấy hệ **không có** phép canh nào.)*

**Hậu quả thật nếu không vá.** Tách bảng được bán như *"làm rò **không viết ra được ở tầng DB**"* (`drizzle/schema/auth.ts:86-91`). Đo được thì ngược lại: nó **gỡ mất** tầng cưỡng chế duy nhất chạy lúc biên dịch và làm bộ quét bề mặt mù đúng hai người đọc còn lại. Nợ **thấp hơn** hôm qua về mặt "SELECT * vô tình", nhưng **cao hơn** về mặt "một thủ tục mới rò có được ai chặn không" — câu trả lời hôm nay là **không ai**. Đúng khuôn *"trả nợ đẻ nợ"* (lần thứ tư) và *"an toàn là HỆ QUẢ của thứ khác"*: hôm nay hệ sạch **chỉ vì** hai người đọc hiện có tình cờ không phát bí mật đi, không vì có gì ngăn họ.

**Đường vá đề xuất.**
1. **Dựng lại tầng KIỂU trên chính bí mật.** Cho `userSecrets.twoFactorSecret` / `.passwordHash` một **nhãn danh nghĩa** đúng khuôn `MaDuPhongDaBam` đã dùng thành công ở Task 8a (`server/_core/backupCodeSecret.ts`): `.$type<HatGiongTotp>()`, và một hàm **tiêu thụ** duy nhất (`verifyTotpOnce`/`comparePasswordConstantTime`) nhận nhãn ấy. Khi đó **đưa nhãn vào một giá trị trả về của tRPC là lỗi biên dịch** — đúng câu Task 7 hứa, nay neo vào đúng bảng.
2. **Mở rộng `userExposureScan` sang `user_secrets`.** `DOC_THO` phải là **hợp** của: hàm đọc `users` thô **và** mọi hàm xuất khẩu của `server/db/auth.ts` mà phép chiếu của nó **chạm một cột bí mật của `user_secrets`** — suy ra bằng `moiCotBiMatCuaUserSecrets()` (đã có sẵn, R1 đã viết). Đúng chỗ nó phải được dùng.
3. Thêm ca **đột biến ở trên** làm ca đỏ thường trực.

---

## 2 · IMPORTANT

### I-1 · `sessionGrantScan` miễn trừ theo **TÊN HÀM** — một endpoint cấp phiên KHÔNG xác thực trong FILE MỚI ship với cổng 9/9 XANH (phép thử M3 THẤT BẠI)

**File:** `server/routers/sessionGrantScan.test.ts:79-101, 174-177, 203-210`.

**Cái sai — đúng lăng kính "ÁNH XẠ vs TẬP".** Lưới miễn trừ một điểm đúc phiên khi **tên hàm bao** thuộc `{ "establishSession", "createSessionToken", "signSession" }` (`LA_HAM_UY_QUYEN`). Ô canh đi kèm khẳng định `[...new Set(uyQuyen.map(d => d.ham))]` **BẰNG** `"createSessionToken · establishSession"` — tức nó canh **TẬP TÊN**, không canh **ÁNH XẠ file→vai trò**. Hai hàm ở **hai file khác nhau** mang **cùng một tên** làm tập không đổi ⇒ cổng xanh. Và `SO_HAM_UY_QUYEN = 2` cũng đếm trên tập đã dedup ⇒ cũng không nhúc nhích.

Cộng thêm: `app.post("/x", handler)` truyền handler bằng **định danh**, không phải `CallExpression` ⇒ nó **không** vào `goiUyQuyen` ⇒ không ai phải chứng minh bằng chứng danh tính cho người gọi.

**Bằng chứng ĐO ĐƯỢC.** Tạo `server/routers/__reviewProbeSession.ts` (đã xoá):

```ts
const establishSession = async (req: Request, res: Response): Promise<void> => {
  const token = await sdk.createSessionToken(String(req.query.openId ?? ""), { name: "" });
  res.cookie(COOKIE_NAME, token, getSessionCookieOptions(req));
  res.json({ ok: true });
};
export function dangKyCuaHau(app) { app.post("/api/backdoor", establishSession); }
```

```
$ npx vitest run server/routers/sessionGrantScan.test.ts
 ✓ server/routers/sessionGrantScan.test.ts (9 tests) 132ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

⇒ Một tuyến **cấp phiên đầy đủ cho bất kỳ ai**, trong một **file mới**, **không mật khẩu, không vé, không IdP** — và lưới ∀ được dựng riêng để bắt *"một endpoint cấp phiên thứ tám sinh ra ở bất kỳ đâu"* khai **XANH 9/9**.

**Hậu quả thật.** Lưới này là **thứ DUY NHẤT** canh trục *"đường cấp phiên mới"* (không có lưới hành vi cho tuyến chưa tồn tại). Nó vừa **thất bại đúng phép thử M3** mà docstring của chính nó viện dẫn (dòng 22-24: *"Một endpoint cấp phiên **thứ tám** sinh ra ở bất kỳ đâu — file mới, thư mục mới, tên khác — tự đưa mình vào lượng từ và làm ô này **ĐỎ**"*).

**Đường vá.** Miễn trừ phải là một **ÁNH XẠ**, không phải một tập tên: ghim `duong:ham` (`server/_core/authService.ts:establishSession` · `server/_core/sdk.ts:createSessionToken`), và đối chiếu **cả file lẫn tên**. Cộng: coi một hàm được **truyền làm handler** (`app.post(p, X)` với `X` là định danh) là một điểm cấp phiên phải chứng minh bằng chứng.

---

### I-2 · `sessionGrantScan` nhận **CHÚ THÍCH** làm bằng chứng danh tính — gỡ hẳn bản vá Critical của Task 6 vẫn 9/9 XANH

**File:** `server/routers/sessionGrantScan.test.ts:189` (`coBangChung` = `d.than.includes(\`${b}(\`)`) và `:227-237` (ô "ĐỐI CHỨNG DƯƠNG" dùng `than.toContain("kiemVe2FA(")` trên **lát cắt văn bản thô**).

**Cái sai.** Cả luật ∀ lẫn ô đối chứng dương hỏi *"văn bản của hàm bao **có chứa chuỗi** `kiemVe2FA(` không"* — **không** hỏi trên CÂY. Chú thích tính là bằng chứng. (Repo **đã biết** tính chất này theo chiều ngược: `server/_core/authService.ts:265-267` phải **cố ý không viết** `capVe2FA(` trong một chú thích vì *"ô ấy ĐỎ"*.)

**Bằng chứng ĐO ĐƯỢC.** Đột biến ở `server/_core/oauth.ts` (đã hoàn nguyên): gỡ **lời gọi thật** `kiemVe2FA(req, Number(userId))` (thay bằng `{ hopLe: true }`) và gỡ `tieuVe2FA(req, res)`, **giữ tên trong chú thích**:

```
$ npx vitest run server/routers/sessionGrantScan.test.ts
 ✓ (9 tests)  Test Files 1 passed · Tests 9 passed
```

**Hiệu chỉnh trung thực — lưới HÀNH VI thì bắt được.** Cùng đột biến:

```
$ npx vitest run server/routers/verify2faPasswordStep.test.ts
 × §1 mật khẩu SAI ⇒ 401, rồi verify-2fa ngay sau đó ⇒ 401, KHÔNG set-cookie
 × §2 ĐỐI CHỨNG DƯƠNG … (và 7 ô nữa)
 Failed Tests 9
```

⇒ Với tuyến **đã có**, nợ dừng ở "một trong hai lưới là trang trí". Nhưng ghép với **I-1**, câu đúng là: **với tuyến MỚI, `sessionGrantScan` là lưới duy nhất, và nó canh bằng `String.includes`.**

**Đường vá.** `coBangChung` phải chạy trên **AST** — tìm một `CallExpression` có `tenLoiGoi(n) ∈ BANG_CHUNG` **bên trong thân hàm bao**, không phải `includes` trên `getText()`. Cùng phép sửa cho ô đối chứng dương của `verify-2fa`.

---

### I-3 · §Cổng kiểm chung ĐANG ĐỎ, và ĐỎ **KHÔNG TẤT ĐỊNH** — gốc rễ: `donSo()` là một `DELETE` TOÀN BẢNG lái bằng đồng hồ của NGƯỜI GỌI

**File:** `server/_core/totpOnce.ts:207-220` (`donSo`) · `:310` (`donSo(nowMs)` với `nowMs` là tham số của `verifyTotpOnce`).

**Cái sai.** `donSo(nowMs)` chạy `DELETE FROM totp_consumed WHERE expiresAt <= <nowMs>` — **không giới hạn theo `userId`**, và `nowMs` do **người gọi** cấp. Pha 7 đã đóng đúng nửa này cho `__soTotpSize`/`__resetSoTotpChoTest` (`totpOnce.ts:351-392`, docstring dài về vitest song song) và **bỏ quên `donSo`** — cái duy nhất chạy trên **đường sản phẩm**.

**Bằng chứng ĐO ĐƯỢC (1) — cổng đỏ, ba lượt ba kết quả khác nhau.** Chạy nguyên khối lệnh §Cổng kiểm chung ba lần:

| lượt | file đỏ | ca đỏ | ca đỏ là |
|---|---|---|---|
| 1 | 2/135 | 4/2175 | `api.test.ts` ×1 · **`totpReplay.test.ts` ×3** |
| 2 | 3/135 | 4/2175 | `api.test.ts` ×1 · **`mustChangePassword.test.ts` ×2** · **`totpReplay.test.ts` ×1** |
| 3 | 2/135 | 2/2175 | `api.test.ts` ×1 · **`totpReplay.test.ts` ×1** |

`api.test.ts` là **ca đỏ CÓ TRƯỚC** đã khai trong kế hoạch. `totpReplay.test.ts` **và** `mustChangePassword.test.ts` thì **không** được khai ở đâu cả. Chạy riêng: `totpReplay` **13/13 XANH**, `mustChangePassword` **10/10 XANH**.

**Bằng chứng ĐO ĐƯỢC (2) — cơ chế, tất định.** Đột biến-đo `server/routers/__reviewProbeDonSo.test.ts` (đã xoá) mô phỏng đúng khuôn `totpLedgerDurable.test.ts:43` (`NOW = Date.now() + 3_600_000`):

```
[PROBE] sau khi A tiêu mã: sổ của A = 1
[PROBE] sau khi B verify ở +1h : sổ của A = 0   <-- 0 nghĩa là bị XOÁ
[PROBE] A PHÁT LẠI mã đã tiêu: hopLe=true phatLai=false
```

⇒ **Một lượt xác minh của người dùng B với đồng hồ đi trước xoá sạch mục của người dùng A, và ngay sau đó A phát lại được CHÍNH mã đã tiêu** (`hopLe=true`, `phatLai=false`). Đây đúng lỗ **A2/A3** mà bảng `totp_consumed` (mig 0313) được sinh ra để đóng.

**Hậu quả thật.**
1. **Chắc chắn, hôm nay:** cổng ra của Pha 7 **không xanh**, và ba lượt chạy cho ba tập ca đỏ khác nhau ⇒ **không lượt chạy nào của cổng này còn là bằng chứng**. Người sau nhìn một lượt xanh may mắn sẽ kết luận sai; người nhìn một lượt đỏ sẽ đi tìm nhầm chỗ. Lớp *"đồng hồ không kim"*.
2. **GIẢ THUYẾT có điều kiện (chưa đo trên hệ thật):** trên đường sản phẩm `nowMs` luôn là `Date.now()`, nên lỗ không mở cho một tiến trình đơn. Nhưng `donSo` **toàn bảng** làm bất biến chống-phát-lại phụ thuộc **lệch đồng hồ giữa các tiến trình**: hai bản sao `ROLE=api` lệch > 120 s ⇒ bản đi trước xoá sổ của bản đi sau ⇒ **A3 mở lại**. Kế hoạch Task 5 nói thẳng lỗ A3 chỉ mở *"khi nhân bản để chịu tải"* — nhưng bảng chung được dựng **chính vì** ngày ấy. Điều kiện *"không lệch đồng hồ"* hiện **không được viết ra và không được canh**. Lăng kính *"an toàn là HỆ QUẢ của thứ khác"*, lần thứ bảy.

**Đường vá.**
1. `donSo` phải **giới hạn theo `userId` của lượt vừa ghi** (`AND "userId" = $1`): tính chất *"bảng không lớn lên nếu không có lượt ghi"* vẫn giữ nguyên, còn lượt dọn thôi chạm hàng của người khác. Đây là bản vá **duy nhất** đóng cả nợ test lẫn nợ đồng hồ.
2. Nếu muốn giữ dọn toàn cục: dùng `now()` **của Postgres** thay vì `nowMs` của người gọi (một đồng hồ, không N đồng hồ), và tách hẳn `nowMs` khỏi đường dọn.
3. Khai `totpReplay`/`mustChangePassword` vào §Nợ CÓ TRƯỚC **hoặc** vá — nhưng đừng để cổng ở trạng thái đỏ-không-tất-định mà không ai nói ra.

---

### I-4 · `mustChangePassword` — **0 người đọc, 0 phép cưỡng chế**: Pha 7 tự đẻ lại đúng lớp lỗi mà Task 2 dựng cổng để diệt, ở nơi cổng ấy không nhìn tới

**File:** `server/routers.ts:245-250` (người ghi) · `server/db/auth.ts:110-112` · `scripts/xoay-bi-mat-2fa.mjs:165` (đã CHẠY THẬT trên 8/8 tài khoản).

**Bằng chứng ĐO ĐƯỢC (phép đếm, toàn repo):**

```
$ git grep -n "mustChangePassword\|phaiDoiMatKhau\|passwordInvalidBefore" -- client/ server/ shared/ scripts/ | grep -v "\.test\.ts"
scripts/xoay-bi-mat-2fa.mjs:139,153,165,200,241,242
server/_core/publicUser.ts:89,95,236,242,243,246,257,265
server/db/auth.ts:97,101,106,110
server/routers.ts:238,239,249
```

⇒ **`client/**` : 0 dòng.** Không màn nào hiển thị `mustChangePassword`, không route nào chặn, không middleware nào từ chối. Ô này **được ghi ở mỗi lượt `auth.me`** (một truy vấn DB thêm/lượt) và **không ai đọc**.

**Cái sai — nó nằm GIỮA các task, không trong task nào.**
* Task 2 dựng `vramReadModel.readers.test.ts` cưỡng chế ***"0 ô có-người-ghi-không-ai-đọc"*** — **phạm vi: mặt đọc VRAM**. Theo cấu tạo nó **không thể** thấy `auth.me`.
* Task 9/QĐ-1 dựng ô suy ra `mustChangePassword` và **bốn** ô canh (`mustChangePassword.test.ts`) — nhưng cả bốn canh *"ô có tồn tại, không rò, và suy từ DB mới"*. **Không ô nào hỏi có ai ĐỌC nó không.**
* Task 10 **đã chạy thật**: 8/8 tài khoản `passwordInvalidBefore = now()`, và bản in của script hứa *"Người dùng phải: đăng nhập lại bằng MẬT KHẨU → **ĐỔI MẬT KHẨU (bị buộc)**"* (`xoay-bi-mat-2fa.mjs:196-198`).

Báo cáo Task 10 **có** khai *"`mustChangePassword` chưa được cưỡng chế — chỉ là ô tư vấn"* (dòng 397). Phép đếm ở trên cho thấy nó **thậm chí chưa phải tư vấn**: không có bề mặt nào tư vấn cho ai cả.

**Hậu quả thật.** Một biện pháp an ninh **đã thực thi trên dữ liệu sản phẩm** (8/8 tài khoản, 3 `admin`) mà **cơ chế thực hiện nó không tồn tại**. Sổ sách nói *"đã buộc đổi mật khẩu sau lượt lộ bí mật"*; hệ thống thì không buộc ai cả, và cũng không nói với ai. Nếu vụ lộ `auth.me` từng bị khai thác, mật khẩu cũ **vẫn dùng được vô thời hạn**. Cộng: một cột `users` được ghi và một truy vấn DB được chạy ở **mọi** lượt `auth.me` cho **0 người đọc** — đúng ô mà Task 2 gọi là *"424 B/lượt, 0 lượt đọc"*.

**Đường vá.**
1. **Chọn một trong hai, đừng để lửng:** (a) người đọc THẬT — chặn ở client (điều hướng bắt buộc tới màn đổi mật khẩu khi `mustChangePassword`) **và/hoặc** ở server (middleware tRPC từ chối mọi mutation trừ `user.changePassword` khi `phaiDoiMatKhau(ctx.user.id)`); hoặc (b) **XOÁ** ô suy ra + hai cột + lượt đọc DB. Không có lựa chọn thứ ba — đúng luật Task 4 Pha 4 mà Task 2 viện dẫn.
2. **Nới lượng từ của Task 2 ra khỏi VRAM.** Luật *"∀ ô trên một mặt đọc phải có NGƯỜI ĐỌC THẬT"* nay đã có bộ suy dùng chung (`vramStateFieldPaths.ts`); áp nó cho hình dạng trả về của `auth.me` là chi phí nhỏ và đóng đúng lớp lỗi vừa tái diễn.

---

### I-5 · Vùng mù của lưới I-3 xuyên file được **KHAI** nhưng **KHÔNG ĐƯỢC ĐẾM** — khác kỷ luật của chính Pha 7 ở hai lưới khác

**File:** `client/src/lib/vramCommandReach.role.unit.test.ts:839-851` (khối "VÙNG MÙ CÒN LẠI") · `:922-960` (`chuyenDisabledXuong`).

**Cái sai.** Task 4b đóng đúng lỗ P1/P2 (prop-drill **một chặng**) và khai ba vùng mù. Vùng mù **số 2** là vùng nguy hiểm:

> *"Luật đi **ĐÚNG MỘT chặng**. Một component con **lại** prop-drill xuống cháu thì chỉ chặng đầu được chứng minh. (Hôm nay: **0** ca như vậy — cả ba nút dùng `<Button>` một chặng.)"*

*"Hôm nay 0 ca"* là một **quan sát theo thời điểm**, và **không có con số nào ghim nó**. So sánh với kỷ luật mà chính nhánh này áp ở nơi khác trong cùng lượt: `sessionGrantScan.test.ts:106` ghim `SO_VUNG_MU_2FA = 1`; `userExposureScan.test.ts:64` ghim `SO_MIEN = 0`. Hai chỗ ấy biến *"hôm nay bằng 0"* thành **một ca đỏ khi nó thành 1**; chỗ này thì không.

Cộng: bằng chứng mà `chuyenDisabledXuong` chấp nhận là *"có **một** thuộc tính `disabled=` trên **một** phần tử JSX bất kỳ trong component"* — nó không ràng buộc phần tử ấy là phần tử mang `onClick`, đúng như vùng mù số 1 tự khai.

**Bằng chứng.** Đây là **quan sát tĩnh có đối chiếu**, không phải đột biến: tôi **không** dựng lại P2 hai chặng (chi phí vượt giá trị cho lượt review này) ⇒ ghi rõ hậu quả dưới đây là **GIẢ THUYẾT**. Cái **đo được** là sự **bất đối xứng kỷ luật**: 2 lưới ghim số vùng mù, 1 lưới không.

**Hậu quả (GIẢ THUYẾT, dựa trên P2 đã được implementer đo ở một chặng).** Ngày ai đó bọc nút lệnh VRAM qua **hai** chặng component, đột biến P2 — *"nút GIẾT tiến trình mở cho MỌI vai đăng nhập"*, `client/src/lib/` **529/529 XANH** — **ship lại được**, im lặng.

**Đường vá.** Ghim **số component con phải giải** và **độ sâu chặng tối đa gặp được** (hôm nay: 1). Chặng thứ hai xuất hiện ⇒ ĐỎ ⇒ người ta phải **hoặc** mở rộng luật **hoặc** nói ra vùng mù mới — đúng khuôn `SO_VUNG_MU_2FA`.

---

## 3 · MINOR

### M-1 · `scripts/seed-admin.mjs` còn `INSERT INTO users (… passwordHash …)` — cột đã bị `0315` BỎ

`scripts/seed-admin.mjs:33`. Đã tính là **`42703` lúc chạy** nếu ai gọi nó.
⚠ **Đối chứng đã làm, và nó hạ mức xuống Minor:** file dùng `mysql2/promise` (`:1`) trên một hệ **PostgreSQL**, và **không** có mục nào trong `package.json` gọi tới nó ⇒ nó **đã hỏng từ trước**, không do Pha 7. Nhưng nó vẫn là một cái bẫy đọc-được: người sau mở ra thấy một đường tạo admin trông hợp lệ.
*(Đối chứng dương: `scripts/seed-all-modules.ts:111` đi qua `createLocalUser()` ⇒ **đúng**, hai câu `INSERT` trong một giao dịch; `scripts/seed-test-data.mjs` và `scripts/audit/audit-account.mjs` **đã** được Pha 7 chuyển sang `user_secrets`.)*
**Vá:** xoá file, hoặc thay bằng một dòng `throw` chỉ sang `seed-all-modules.ts`.

### M-2 · `donKhoaNguoiDung.MAU_DANH_TINH` là một **danh sách sáu tên viết tay**, và hai trong sáu tên không còn tồn tại trên bất kỳ đối tượng người dùng nào

`client/src/lib/donKhoaNguoiDung.ts:23` — `["username","email","passwordHash","twoFactorSecret","openId","loginMethod"]`. Docstring hứa *"dọn theo **HÌNH DẠNG**, không theo TÊN"*, nhưng chính hình dạng ấy là một danh sách tên. `passwordHash`/`twoFactorSecret` **không bao giờ** còn xuất hiện trong `auth.me` sau Task 7+9 ⇒ hai phần tử chết.
⚠ **Đối chứng đã làm:** **lưới** đi kèm (`localStorageUserScan.unit.test.ts`) **KHÔNG** dùng danh sách này — nó suy nguồn từ AST (`auth.me.useQuery`), nên **cổng vẫn đúng**. Danh sách chỉ lái phép **dọn lúc chạy** của dữ liệu cũ.
**Hậu quả (GIẢ THUYẾT):** một bản ghi cũ có `{id, name, role}` mà không có ô nào trong sáu tên sẽ **không bị dọn**. Ảnh hưởng: dữ liệu tồn dư trên đĩa trình duyệt, không phải một lỗ mới.
**Vá:** suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS` (chia sẻ qua `shared/`) thay vì chép tay.

### M-3 · Hai docstring còn trỏ vào cột đã BỎ

`server/_core/totpOnce.ts:259` (*"secret 2FA (base32) **đã đọc từ `users.two_factor_secret`**"*) và `drizzle/schema/auth.ts:300` (*"secret 2FA nằm ngay `users.two_factor_secret` cùng DB"*). Cả hai sai từ `0315`. Không ảnh hưởng hành vi; nhưng đây đúng lớp *"giữ một lý do đã chết"* mà `totpOnce.ts:234-243` vừa nêu tên và sửa cho một hàng rào khác trong cùng file.
**Vá:** đổi thành `user_secrets.twoFactorSecret`.

---

## 4 · Những thứ tôi ĐÃ NGHI, ĐO, RỒI RÚT LẠI

Ghi ra để lượt sau không đi lại.

| Nghi | Phép đo | Kết luận |
|---|---|---|
| `i18n-check` `_ghim` chỉ đếm **độ dài** ⇒ **hoán vị** tên trong nền lọt qua | Đọc `scripts/i18n-check.mjs:200-215, 330-340`: một tên bị bỏ khỏi nền mà **vẫn thiếu** rơi vào `moiThieuAll` ⇒ ĐỎ; một tên **đã dịch** còn trong nền rơi vào `nenCu` ⇒ `BASELINE STALE` ⇒ ĐỎ | **RÚT LẠI** — cặp (`_ghim` + `BASELINE STALE`) đã là một phép canh ÁNH XẠ, không phải TẬP |
| `PASS A` `present.length === 0` là một phép canh giả | Chính bản vá đã **tự đính chính** ở `i18n-check.mjs:161-168` kèm phép đo (`< 2` ⇒ 0 ca đỏ) | **KHÔNG PHẢI FINDING** — đã được khai, và khai đúng |
| Hai file test TOTP tranh nhau vì **trùng `userId`** | `totpReplay` dùng 42/43, `totpLedgerDurable` dùng 90.001/90.002 — **rời nhau** | **RÚT LẠI** — nguyên nhân thật là `donSo` toàn bảng (I-3) |
| `user.get2FAStatus` đang rò `twoFactorSecret` ra client | Đọc `server/routers/userRouters.ts:337-345`: trả `{enabled, hasSecret}` | **RÚT LẠI về hành vi** — hệ **hôm nay sạch**. Nhưng phép đo dẫn thẳng tới **C-2**: không có gì **giữ** cho nó sạch |
| `userExposureScan` bỏ sót đường ghi | Nó tự khai vùng mù, ghim `SO_MIEN = 0`, và ô "KHÔNG BẮT NHẦM" có đối chứng | **KHÔNG PHẢI FINDING** — lưới này là một trong những cái chặt nhất của nhánh; nợ nằm ở **phạm vi** (C-2), không ở **chất lượng** |
| `deleteUser` để lại `user_secrets` mồ côi | `drizzle/schema/auth.ts:110` — `onDelete: "cascade"`, khoá ngoại đầu tiên trỏ `users` | **KHÔNG PHẢI FINDING** — đúng |

---

## 5 · Khuôn chung của lượt này (thứ chỉ ghép cả nhánh mới thấy)

1. **Ba task chạm đường đăng nhập, và không task nào sở hữu câu "đường GHI bí mật phải đòi bằng chứng".**
   T6 đóng *"cấp phiên"*. T7 đóng *"đường ĐỌC"*. T9 gom *"cửa đọc/ghi"* về một chỗ — nhưng gom cửa **không phải** gác cửa. Không ai hỏi **ai được phép GHI hạt giống TOTP** ⇒ C-1.
   Đây đúng bài học Pha 5 (*"vá lỗ ĐỌC làm lộ 2 Critical đường GHI"*) — **tái diễn**, và lần này nó tái diễn **sau khi bài học ấy đã được viết vào memory**.

2. **Lượt gia cố "thêm một tầng" GỠ MẤT tầng cũ.** 9c được bán là *"đóng THÊM một tầng"* (`drizzle/schema/auth.ts:36-37`). Đo được: nó **gỡ** tầng KIỂU và làm mù bộ quét BỀ MẶT ⇒ C-2. Lớp *"trả nợ đẻ nợ"*, lần **thứ tư** — và lần này nợ mới **nặng hơn** nợ cũ ở đúng một trục: nợ cũ là *"một lỗ đã biết"*, nợ mới là *"không còn ai canh trục ấy"*.

3. **Cổng ra là VĂN BẢN, không phải CÂY — ba lần trong một nhánh.**
   `sessionGrantScan.coBangChung` (`includes`), ô đối chứng dương của `verify-2fa` (`toContain` trên lát cắt chuỗi), và `LA_HAM_UY_QUYEN` (so **tên**). Cả ba đều là *"canh chính tả thay vì canh sự thật"* — đúng lớp mà `vramPha5Gate.test.ts:44-54` đã sửa cho **chính nó** ở Pha 6 (*"NHẬN DIỆN BẰNG VỊ TRÍ, KHÔNG BẰNG CHÍNH TẢ"*), và bài học ấy **không lan** sang ba lưới mới của Pha 7.

4. **Kỷ luật "ghim SỐ vùng mù" áp không đều.** `SO_VUNG_MU_2FA=1`, `SO_MIEN=0`, `SO_HAM_UY_QUYEN=2`, `CONG=35`, `FILE_CANH=97` — nhưng vùng mù nguy nhất của Task 4b (prop-drill nhiều chặng) **không có số**. Một kỷ luật áp không đều là một kỷ luật **có phần tử thứ N+1**.

5. **"Cổng ra ĐẠT" chưa bao giờ được đo hai lần.** Ba lượt chạy §Cổng kiểm chung cho **ba** kết quả. Đề nghị bổ sung vào Global Constraints của pha sau: ***một cổng chỉ được khai ĐẠT sau HAI lượt chạy độc lập cho CÙNG một tập ca đỏ.***

---

## 6 · Đề xuất thứ tự vá

| # | Mục | Vì sao trước |
|---|---|---|
| 1 | **C-1** hàng rào `twoFactorEnabled` cho `user.setup2FA` | Lỗ **đang mở trên hệ thật**; bản vá là **ba dòng**, sao chép từ tuyến song song đã đúng |
| 2 | **I-3** `donSo` giới hạn theo `userId` | Cho tới khi vá, **không lượt chạy cổng nào là bằng chứng** ⇒ mọi mục dưới không nghiệm thu được |
| 3 | **C-2** nhãn kiểu cho `user_secrets` + mở `DOC_THO` sang `user_secrets` | Đóng **trục**, không đóng một điểm |
| 4 | **I-1 + I-2** `sessionGrantScan` sang AST + miễn trừ theo `duong:ham` | Cùng một file, cùng một lượt |
| 5 | **C-1** bước 2-3: xoá tuyến `user.*` trùng + lượng từ ∀-NGƯỜI-GHI cho hạt giống TOTP | Đóng lớp, không đóng ca |
| 6 | **I-4** quyết định: cưỡng chế `mustChangePassword` **hoặc** xoá nó | Phải là một **quyết định của chủ dự án**, không phải một lượt vá lặng lẽ |
| 7 | **I-5 · M-1 · M-2 · M-3** | Rẻ, không chặn |

---

## 7 · Phụ lục — lệnh đã chạy

```
npm run check                                          # sạch tại HEAD
npx vitest run <35 đường §Cổng kiểm chung>              # ×3 lượt — xem bảng I-3
npx vitest run server/routers/totpReplay.test.ts        # 13/13 XANH khi chạy RIÊNG
npx vitest run server/routers/mustChangePassword.test.ts# 10/10 XANH khi chạy RIÊNG
npx vitest run server/routers/verify2faPasswordStep.test.ts   # 9 ĐỎ dưới đột biến I-2
git grep -n "mustChangePassword\|phaiDoiMatKhau\|passwordInvalidBefore" -- client/ …  # I-4
git grep -n "passwordHash\|two_factor_secret\|twoFactorSecret" -- server/ client/ shared/ scripts/ drizzle/
```

**Đột biến đã dựng và đã hoàn nguyên (4):**

| # | Đối tượng | Cách hoàn nguyên | Kết quả |
|---|---|---|---|
| A | `server/routers/__reviewProbeSession.ts` (file MỚI) | `rm` | `sessionGrantScan` **9/9 XANH** ⇒ I-1 |
| B | `server/_core/oauth.ts` — gỡ `kiemVe2FA`/`tieuVe2FA`, giữ chú thích | `git checkout HEAD --` | `sessionGrantScan` **9/9 XANH**, `verify2faPasswordStep` **9 ĐỎ** ⇒ I-2 |
| C | `server/routers/userRouters.ts` — `get2FAStatus` trả thêm `twoFactorSecret` | `git checkout HEAD --` | `tsc` **sạch**, 6 lưới **58/58 XANH** ⇒ C-2 |
| D | `server/routers/__reviewProbe2fa.test.ts` · `__reviewProbeDonSo.test.ts` (file MỚI) | `rm` | ⇒ C-1 · I-3 |

**Xác nhận cuối:**

```
$ git status --porcelain -- server/ client/ shared/ scripts/ drizzle/
(rỗng)
```
