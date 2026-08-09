# Pha 7 · Task 9 — BA MỤC DDL TRONG MỘT LƯỢT: **ĐỀ XUẤT MIGRATION** (soạn, chưa áp)

> **Trạng thái:** ⏸ **DỪNG SAU BƯỚC 3 theo brief.** Bước 1–3 xong. Bước 4–9 **CHƯA LÀM** và
> **KHÔNG ĐƯỢC LÀM** trước khi chủ dự án duyệt **nội dung** migration dưới đây.
> **KHÔNG một câu DDL nào đã chạy** trong lượt này — không `db:push`, không `drizzle-kit`, không
> `psql` ghi. Mọi lượt chạm DB là **ĐỌC**, cộng **hai** lượt `INSERT` nằm trong giao dịch **đã
> `ROLLBACK`** (đúng phép đo mà Bước 1 yêu cầu). Máy chủ **PID 36072** không bị đụng tới.

- **Nhánh:** `feat/hmi-dep` · **HEAD lúc bắt đầu:** `b67389b5`
- **Kế hoạch:** `docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md` §"Task 9 (mở rộng): BA mục DDL trong MỘT migration"
- **Khuôn:** `docs/superpowers/reports/2026-08-08-vram-pha7-task5-migration-de-xuat.md` (mig 0313)
- **Ngày:** 2026-08-09

---

## 0 · Ba mục, một câu — và **hai đính chính brief**

| | Mục | Câu bất biến bị vỡ | Vì sao cần DDL |
|---|---|---|---|
| **9a** | `backup_codes.code` = `varchar(20)`, hash bcrypt = **60** | *"∀ lượt bật 2FA: người dùng **nhận được** một bộ mã dự phòng dùng được"* | Bề rộng cột là một **hằng số của DB**, không sửa được ở tầng mã |
| **9b** | Không có chỗ nào ghi *"mật khẩu này phải đổi"* | *"∀ tài khoản bị thu hồi bí mật: lượt đăng nhập sau **buộc** đổi mật khẩu"* | Không cột ⇒ không nơi lưu ⇒ Task 10 không có cách khai |
| **9c** | Bí mật **cùng bảng** với dữ liệu công khai | *"∀ phép đọc `users`: không byte bí mật nào **rời máy chủ**"* — Task 7 đóng ở **tầng trả về**, không ở **tầng DB** | Rò *"không viết ra được"* chỉ đạt khi bí mật **không có mặt** trong hàng |

### ⚠ ĐÍNH CHÍNH 1 — brief nói **"ba cột bí mật"**, đo được **HAI**

`server/_core/publicUser.ts:68-90` phân loại **toàn phần** 19 cột của `users`; tập `server-only`
đúng **hai** phần tử: `passwordHash` · `twoFactorSecret`. Mã dự phòng **không** là cột của `users` —
nó là bảng riêng `backup_codes` **từ trước**. ⇒ Cụm *"ba cột bí mật"* trong kế hoạch đếm gộp một
thứ đã tách sẵn.

Hệ quả **không** đổi hướng của 9c, nhưng đổi **cách viết luật**: lượng từ phải **suy ra từ**
`SERVER_ONLY_USER_FIELDS`, **không** đếm tay "ba". Xem §4 (R5) — đây là chỗ lượt trả nợ này **đẻ ra
nợ mới nếu làm ẩu**.

### ⚠ ĐÍNH CHÍNH 2 — 9b **không nên** là một cột trên `users`

Chi tiết + đường không chọn: §3.4. Tóm tắt: một cột *"phải đổi mật khẩu"* trên `users` buộc
`USER_FIELD_VISIBILITY` phải phân loại nó, và phân loại đúng nghĩa của nó là **`public`** (nó không
phải bí mật) ⇒ `user.list` phát cho trình duyệt **danh sách chính xác những tài khoản đang ở trạng
thái buộc-đổi-mật-khẩu**. Đặt nó trong `user_secrets` thì điều ấy **không viết ra được**.
**⇒ Đây là một QUYẾT ĐỊNH CHỦ DỰ ÁN, xem §5.**

---

## 1 · BƯỚC 1 — ĐO TRƯỚC, **TÁI LẬP, KHÔNG TIN BRIEF**

Một file dò tạm trong repo (`scripts/__tmp_pha7_task9_probe.mjs`, gói `postgres` v3 — script **ngoài**
repo không resolve được `node_modules`), **đã xoá sau khi đo**.

⚠ Mọi lượt đo dưới đây **in ra mã lỗi thật** (`e.code`, `e.routine`), **không** `.catch(() => 0)`.
Bài học Task 8 (*"`catch` mặc áo của phép đo"*) được áp dụng: nhánh *"chèn được"* và nhánh *"chèn
không được"* ghi **hai hình dạng kết quả khác nhau**, nên không nhánh nào đọc nhầm thành nhánh kia.

### 1.1 · 9a — **`22001` TÁI LẬP ĐƯỢC**, và có **đối chứng dương**

```
### 9a.5 · thử INSERT hash dài 60 ký tự (rồi ROLLBACK)
{ "daChay": true, "chenDuoc": false,
  "code": "22001", "severity": "ERROR",
  "message": "value too long for type character varying(20)",
  "routine": "varchar" }

### 9a.6 · ĐỐI CHỨNG — mã 8 ký tự (rồi ROLLBACK)
{ "chenDuoc": true, "hang": { "id": 1, "dai": 8 } }
```

⚠ **Đối chứng 9a.6 là ô then chốt**: nó chứng minh bảng, quyền, khoá, `NOT NULL` **đều lành** —
lượt đỏ ở 9a.5 đến **đúng từ bề rộng cột**, không từ một thứ khác đang hỏng.

| đại lượng đo được | giá trị |
|---|---|
| `backup_codes.code` | `character varying(20)`, `NOT NULL` |
| chỉ mục `backup_codes` | `backup_codes_pkey(id)` · `idx_backup_codes_user("userId")` · `idx_backup_codes_code(code)` |
| **số hàng `backup_codes`** | **0** (cả `aoi_management` lẫn `aoi_management_test`) |
| tài khoản | **8 tổng · 8 bật 2FA · 8 có secret · 8 có `passwordHash`** |
| `max(length("passwordHash"))` trên `users` | **60** ⇒ bcrypt thật, đúng con số cột `code` không chứa nổi |

> ★ **Bằng chứng khớp nhau, không phải suy đoán:** 8/8 tài khoản bật 2FA, bảng mã dự phòng **rỗng**,
> và đường ghi duy nhất còn lại sau Task 8a ném `22001` khi thử. Ba số ấy chỉ đồng thời đúng nếu
> đường ghi **đang vỡ**.

### 1.2 · 9b — `users` **KHÔNG có** cột nào mang nghĩa "buộc đổi mật khẩu"

19 cột, liệt kê đầy đủ từ `information_schema`:

```
id · openId · username · passwordHash · name · email · phone · department · position ·
loginMethod · role · isActive · two_factor_secret · two_factor_enabled ·
createdAt · updatedAt · lastSignedIn · loginAttempts · lockedUntil
```

Và một lượt quét **TOÀN `public`** (395 bảng) theo tám mẫu tên (`%must%change%`, `%force%pass%`,
`%password%change%`, `%change%password%`, `%pwd%reset%`, `%requirepass%`, `%passwordChangedAt%`,
`%doi%mat%khau%`) ⇒ **0 hàng**. ⇒ Khai của brief **ĐÚNG**, và đúng ở phạm vi rộng hơn brief nói:
không chỉ `users` — **không bảng nào** trong DB có ô ấy.

⚠ Cũng **không** có `passwordChangedAt`. Nghĩa là hôm nay hệ **không biết** mật khẩu của ai được
đặt lúc nào — một sự thật cần cho 9b (xem §3.4).

### 1.3 · 9c — ba con số nền

| đại lượng | `aoi_management` | `aoi_management_test` |
|---|---|---|
| `to_regclass('public.user_secrets')` | **NULL** (chưa có) | **NULL** |
| số cột `users` | 19 | 19 |
| `backup_codes.code` | `varchar(20)` | `varchar(20)` |
| số hàng `users` | **8** | 5 |
| số hàng `backup_codes` | **0** | 0 |

⇒ **Hai DB cùng hình dạng.** (GOTCHA Wave 4 — quên DB test ⇒ lưới *"xanh rỗng"* — vẫn phải chặn ở
Bước 4, nhưng hôm nay chúng **chưa** lệch.)

### 1.4 · Nền DB (đọc, không ghi)

| đại lượng | giá trị |
|---|---|
| máy chủ | **PostgreSQL 17.10** (Ubuntu, x86_64) |
| DB · vai đang nối | `aoi_management` · **`avi_app`** ⇒ **không chạy DDL được** (đúng GOTCHA `42501`) |
| chủ sở hữu `users`/`backup_codes`/`totp_consumed`/`vram_leases` | **`aoi`** (cả bốn) |
| `pg_default_acl` | `{avi_app=arwd/aoi}` cho **mọi bảng** do `aoi` tạo · `{avi_app=rU/aoi}` cho sequence |
| migration mới nhất **đã áp** | `0313_totp_consumed_and_identity_truncated.sql` ⇒ số kế tiếp **0314** |
| bảng theo dõi | `__applied_migrations.filename` (đã kiểm ở Task 5, **không đoán**) |
| **khoá ngoại trỏ tới `users`** | **0** — trong khi `public` có **63** khoá ngoại tổng cộng |
| kích thước `users` | heap **8.192 B** · chỉ mục **114.688 B** · 8 hàng · 7 chỉ mục |
| byte thật của bí mật | `passwordHash` **408 B**/8 hàng (dài nhất **60**) · `two_factor_secret` **272 B**/8 hàng (dài nhất **52**) |

---

## 2 · BƯỚC 2 — ĐẾM BỀ MẶT

> ⚠ *"Đếm trước khi đổi một cơ chế dùng chung"* đã **lật quyết định SÁU lần**, và **hai lần** thứ
> nguy nhất **không phải** cái đang vá. Lượt này nó lật **hai lần nữa** — §2.5 và §2.6.

### 2.1 · `users.passwordHash` — **4 người ghi · 7 điểm đọc trực tiếp**

| | file:dòng | vai |
|---|---|---|
| **G1** | `server/db/auth.ts:159-162` `createLocalUser` | GHI (INSERT) |
| **G2** | `server/db/auth.ts:235-238` `createUser` | GHI (INSERT) |
| **G3** | `server/db/auth.ts:190-193` `updateUserPassword` | GHI (UPDATE) — **đường đổi mật khẩu DUY NHẤT** |
| **G4** | `scripts/audit/audit-account.mjs:12,15` · `scripts/seed-admin.mjs:33-38` · `scripts/seed-test-data.mjs:46` · `scripts/seed-all-modules.ts:111` | GHI (script, SQL thô) |
| **Đ1** | `server/_core/authService.ts:196` `comparePasswordConstantTime(…, user?.passwordHash)` | ĐỌC — đăng nhập tRPC/web |
| **Đ2** | `server/_core/authService.ts:220` `if (!user.passwordHash)` | ĐỌC |
| **Đ3** | `server/_core/index.ts:1856` | ĐỌC — **`POST /api/external/auth/login`** (REST, quyết định #2: **không** cổng 2FA, chấp nhận có chủ ý) |
| **Đ4** | `server/_core/index.ts:1858` | ĐỌC |
| **Đ5** | `server/routers/userRouters.ts:196` | ĐỌC — `changePassword` |
| **Đ6** | `server/routers/userRouters.ts:202` `bcrypt.compare` | ĐỌC |
| **Đ7** | `server/routers/userRouters.ts:302-303` | ĐỌC — `disable2FA` (xác nhận mật khẩu) |

⚠ **BẪY TÊN TRÙNG, phải khai:** `mqtt_clients.passwordHash` (`drizzle/schema/mqtt.ts:52`) là **một
cột KHÁC, bảng KHÁC**, có người đọc/ghi riêng (`mqttService.ts:328/1380`, `db/hierarchy.ts:783`).
**Mọi lưới quét theo tên `passwordHash` sẽ bắt nhầm nó.** Bộ suy ở Bước 5 phải hỏi *"cột của bảng
nào"*, không hỏi *"chuỗi nào"* — đúng khuôn `__totpDbHybrid.ts:13` (*"định tuyến theo TÊN BẢNG,
không theo tên phương thức"*).

### 2.2 · `users.twoFactorSecret` — **4 người ghi (mã) + 4 (script) · 12 điểm đọc**

| | file:dòng | vai |
|---|---|---|
| **G1** | `server/db/auth.ts:269-270` `setup2FA` | GHI |
| **G2** | `server/db/auth.ts:286-287` `disable2FA` | GHI (→ NULL) |
| **G3** | `server/routers/twoFactorRouter.ts:90` `setup` | GHI |
| **G4** | `server/routers/twoFactorRouter.ts:252` `disable` | GHI (→ NULL) |
| **G5–G8** | `scripts/xoay-bi-mat-2fa.mjs:105,122` · `scripts/audit/audit-account.mjs:12` · `scripts/seed-test-data.mjs:43,46` | GHI (script SQL thô) — ★★ xem §2.6 |
| **Đ1** | `server/_core/oauth.ts:426,438` | ĐỌC — **2FA lúc đăng nhập** |
| **Đ2** | `server/_core/trpc.ts:342` | ĐỌC — **step-up cho `deployProcedure`** |
| **Đ3** | `server/db/auth.ts:295-297` `get2FAStatus` | ĐỌC (phép chiếu 2 cột) |
| **Đ4–Đ7** | `twoFactorRouter.ts:115/130/137` · `191/213` · `278/289/300` · `351/362/372` | ĐỌC — `enable`·`disable`·`verify`·`regenerateBackupCodes` |
| **Đ8–Đ10** | `userRouters.ts:260/270` · `311/318` · `338` | ĐỌC — `verify2FA`·`disable2FA`·`hasSecret` |
| **Đ11** | `server/_core/publicUser.ts:83` | phân loại (`"server-only"`) |
| **Đ12** | `scripts/print-otp.mjs:9` | ĐỌC (script vận hành) |

### 2.3 · Người đọc **NGUYÊN HÀNG** `users` — **8 hàm, 1 file**

`.select().from(users)` **không phép chiếu** ⇒ kéo về **cả hai** bí mật:

| file:dòng | hàm |
|---|---|
| `server/db/auth.ts:105` | `getUserByOpenId` |
| `server/db/auth.ts:112` | `getAllUsers` |
| `server/db/auth.ts:132` | `getUserById` — ★ **đường nóng**: `sdk.authenticateRequest` gọi mỗi request |
| `server/db/auth.ts:139` | `getUserByUsername` — ★ đường đăng nhập |
| `server/db/auth.ts:200` | `getActiveUsers` |
| `server/db/auth.ts:206` | `getUsersByRole` |
| `server/db/auth.ts:212` | `getUsers` |
| `server/db/auth.ts:254` | `searchUsers` |

**8 hàm** — khớp **chính xác** con số mà `server/routers/userExposureScan.test.ts:20` đã ghim
(*"Hôm nay ra **8** hàm"*). ✅ Phép đếm độc lập, cùng kết quả.

Tổng **`.from(users)`** trong mã sản xuất: **55 lần / 16 file** (đa số **có** phép chiếu).

### 2.4 · `backup_codes` — **2 người ghi · 5 điểm đọc**, và **0 truy vấn theo `code`**

| | file:dòng | vai |
|---|---|---|
| **G1** | `twoFactorRouter.ts:153-166` `enable` | XOÁ hết + GHI 10 mã băm ⇒ **đường đang vỡ vì `22001`** |
| **G2** | `twoFactorRouter.ts:388-401` `regenerateBackupCodes` | idem |
| **X1/X2** | `twoFactorRouter.ts:258`, `db/auth.ts` (qua `disable`) | XOÁ |
| **Đ1** | `db/auth.ts:321-328` `verifyBackupCode` | ĐỌC theo `userId` + `isUsed` |
| **Đ2** | `db/auth.ts:349-356` `getUnusedBackupCodesCount` | ĐẾM |
| **Đ3–Đ5** | `twoFactorRouter.ts:40`, `:222`, `:309` | ĐỌC theo `userId` + `isUsed` |

★ **Phép đếm sinh một quan sát:** **không một điểm nào** lọc theo `code`
(`eq(backupCodes.code, …)` = **0 lần** trong toàn repo) — vì phép đối chiếu là `bcrypt.compare`
**trên từng hàng**, theo cấu tạo. ⇒ Chỉ mục **`idx_backup_codes_code`** phục vụ **0 truy vấn** và
trả **chi phí ghi cho mỗi mã sinh ra** (10 mã × mỗi lượt bật 2FA). Đề xuất xoá — **§3.2, mục tuỳ
chọn, chủ dự án gạch được**.

### 2.5 · ★★★ PHÉP ĐẾM LẬT LẦN THỨ NHẤT — **9c làm RỖNG chính lưới của Task 7**

`server/_core/publicUser.ts` dựng bất biến trên **`Record<keyof User, …>`**:

```ts
export type ServerOnlyUserField = { [K in keyof Visibility]: Visibility[K] extends "server-only" ? K : never }[keyof Visibility];
export type PublicUser = Pick<User, PublicUserField> & { [K in ServerOnlyUserField]?: never };
```

Bỏ **hai** cột bí mật khỏi `users` ⇒ `ServerOnlyUserField` = **`never`** ⇒
`{ [K in never]?: never }` = **`{}`** ⇒ **phần giao biến mất**, và `redactServerOnlyUserFields()`
lặp trên một mảng **rỗng**. Toàn bộ cơ chế *"nhét bí mật trở lại là LỖI BIÊN DỊCH"* — thứ Task 7
dựng ra và đã dùng thành công — **thành trang trí**.

⚠ **Nó KHÔNG hỏng im lặng** — và điều này phải nói cho đúng, không tô đậm hơn sự thật:
`publicUser.test.ts:76-79` **gọi đích danh** cả hai tên:

```ts
expect(USER_FIELD_VISIBILITY.passwordHash).toBe("server-only");
expect(SERVER_ONLY_USER_FIELDS).toContain("twoFactorSecret");
```

⇒ bỏ cột ⇒ `tsc` **ĐỎ** + 4 ô test **ĐỎ**. **Nguy hiểm nằm ở LƯỢT SỬA HIỂN NHIÊN:** xoá bốn dòng
ấy thì **mọi thứ xanh trở lại** với `SERVER_ONLY_USER_FIELDS = []` — một hàng rào xanh **canh
không cái gì**. Đúng lăng kính *"an toàn là HỆ QUẢ của một thứ khác đang hỏng"* (đã **bảy** lần).

⇒ **RÀNG BUỘC CHO BƯỚC 5, không phải gợi ý:** khi hai cột rời `users`, luật phải được **NEO LẠI**,
không được xoá:
1. `∀ cột của user_secrets`: **server-only theo CẤU TẠO** — không cần phân loại, vì **không bề mặt
   nào** trả một hàng `user_secrets` (mở rộng `userExposureScan.test.ts` sang bảng mới);
2. một ô canh **chính lượng từ**: `SERVER_ONLY_USER_FIELDS.length === 0` **⇒ ĐỎ** kèm câu
   *"phân loại đã rỗng — luật này còn canh gì?"*, để lượt sửa hiển nhiên **không** đi qua được;
3. `publicUser.test.ts:50` ghim `cot.length >= 15`; sau khi bỏ 2 cột còn **17** ⇒ **vẫn qua**, nên
   ô ấy **không** thay được ô (2).

### 2.6 · ★★★ PHÉP ĐẾM LẬT LẦN THỨ HAI — **script XOAY của Task 10 sẽ BÁO THÀNH CÔNG mà KHÔNG XOAY GÌ**

`scripts/xoay-bi-mat-2fa.mjs` viết **SQL thô** vào **`users`**:

```js
// :105
await tx`UPDATE users SET two_factor_secret = NULL, two_factor_enabled = false WHERE id = ANY(${ids}::int[])`;
// :122 (hoàn tác)
await tx`UPDATE users SET two_factor_secret = ${u.two_factor_secret}, … WHERE id = ${u.id}`;
```

Sau khi mã đọc/ghi bí mật ở **`user_secrets`** mà cột cũ trên `users` **vẫn còn** (đúng cửa sổ giữa
hai migration — §3.5), câu trên **chạy THÀNH CÔNG**, in ra *"N hàng đã đổi"*, và **không xoay một
bí mật nào đang được dùng**. Ảnh chụp hoàn tác cũng chụp **bản chết**.

⚠⚠ Đây là **đúng lớp Critical của Pha 3** — *"GIẾT NHẦM tiến trình rồi BÁO CÁO THÀNH CÔNG"* — lần
này ở đường **thu hồi bí mật**, và nó **đe doạ trực tiếp THỨ TỰ BẮT BUỘC** mà chủ dự án vừa duyệt:
lượt xoay ở ④ sẽ *"đạt"* trong khi bí mật đã lộ **vẫn còn nguyên giá trị**.

⇒ **ĐIỀU KIỆN VÀO CỦA TASK 10 phải cộng thêm một dòng:** script xoay đã trỏ vào `user_secrets`, và
lượt **khô** phải in ra **đúng bảng** nó sẽ đụng. Bốn script khác cùng lớp:
`scripts/print-otp.mjs:9` · `scripts/seed-test-data.mjs:43,46` · `scripts/audit/audit-account.mjs:12`
· `scripts/seed-admin.mjs:33`.

### 2.7 · Bề mặt TEST bị kéo theo — biết trước để Bước 5 không bất ngờ

| cơ chế | file | vì sao vướng |
|---|---|---|
| `soHonHop()` định tuyến **theo tên bảng** | `server/routers/__totpDbHybrid.ts:22` | `BANG_THAT = {"totp_consumed"}`. `users` đi **`FakeDb`**. Bí mật dời sang `user_secrets` ⇒ mọi ca đăng nhập/2FA dùng `FakeDb` **không biết bảng mới** ⇒ hoặc dạy `FakeDb`, hoặc thêm `"user_secrets"` vào `BANG_THAT` (và khi đó ca ấy cần DB test **thật**) |
| lưới ∀ hai chiều | `server/_core/publicUser.test.ts` (13 ca) | §2.5 |
| lưới ∀ bề mặt (quét AST toàn `server/**`) | `server/routers/userExposureScan.test.ts` (ghim **8** hàm đọc thô) | tập người-đọc-thô suy từ `server/db/auth.ts`; bảng mới phải vào lượng từ |
| cổng kiểu mã dự phòng | `server/_core/backupCodeSecret.ts:77` · `backupCodeWriteScan.test.ts` | 9a **không** đụng, nhưng Bước 5 phải thêm ô ∀ *"bề rộng cột ≥ bề rộng `bamMaDuPhong()` sinh ra"* — xem §3.2 |

### 2.8 · Nợ **đã có sẵn**, phát hiện khi đếm — **KHAI, KHÔNG VÁ ở lượt này**

**`deleteUser` để lại mã dự phòng MỒ CÔI.** `server/db/auth.ts:122-126` chạy
`db.delete(users).where(eq(users.id, userId))`, và DB có **0 khoá ngoại trỏ tới `users`** (đo được;
`public` có 63 FK, không cái nào trỏ `users`). ⇒ Xoá một tài khoản **không** xoá hàng
`backup_codes` của họ: **hash mã dự phòng sống lâu hơn chính tài khoản**. Hôm nay bảng rỗng nên
chưa có hàng nào mồ côi — nhưng cơ chế thì đang mở, và **9c sẽ nhân nó lên** nếu `user_secrets`
cũng không có khoá ngoại. Xem §3.3 (`ON DELETE CASCADE`).


---

## 3 · BƯỚC 3 — **SQL ĐỀ XUẤT** (soạn, CHƯA CHẠY)

> ⚠⚠⚠ **KHÔNG file `.sql` nào được tạo trong `drizzle/` ở lượt này** — cố ý. `npm run db:push`
> (`scripts/migrate-standalone.mjs`) **áp mọi file mới** trong thư mục ấy; đặt sẵn file là dựng một
> cái bẫy chờ lượt `db:push` kế tiếp. Nguyên văn nằm **ở đây**, và chỉ được ghi thành file ở **Bước
> 4, sau khi chủ dự án duyệt**.

### 3.0 · ★★★ VÌ SAO **HAI** MIGRATION CHỨ KHÔNG PHẢI MỘT

Kế hoạch viết *"MỘT migration cho cả ba"*. Phép đếm ở §2.3 **bác** điều đó, và đây là lý do đo được,
không phải khẩu vị:

> `users` có **8 hàm đọc NGUYÊN HÀNG** (`.select().from(users)` không phép chiếu). Drizzle **liệt kê
> TOÀN BỘ cột** của schema vào câu `SELECT`. Máy chủ đang chạy là **`dist/index.js` (PID 36072)** —
> một **bản build cũ**, và nó sẽ tiếp tục liệt kê `"passwordHash"` + `two_factor_secret` cho tới khi
> có lượt redeploy.
> ⇒ `DROP COLUMN` **cùng lượt** với `CREATE TABLE` ⇒ **`42703` ở mọi lượt đọc `users`** ⇒ đăng nhập,
> `auth.me`, mọi phép kiểm quyền **chết toàn phần**, ngay lập tức, cho tới khi build mới lên.

⇒ Tách theo khuôn **NỞ / CO** (expand / contract):

| | file | nội dung | áp khi nào |
|---|---|---|---|
| **NỞ** | `0314_backup_code_widen_and_user_secrets.sql` | 9a + 9c (tạo bảng, chép) + 9b (hai cột trong bảng mới) | **ngay** sau khi duyệt — **thuần THÊM**, mã cũ chạy tiếp không biết gì |
| **CO** | `0315_users_drop_secret_columns.sql` | chỉ `DROP COLUMN` ×2 | **CHỈ SAU KHI** mã mới đã deploy **và** nghiệm thu sống Bước 8 **ĐẠT** |

⚠ Hai file, **một lượt duyệt**. Nguyên văn cả hai ở dưới để chủ dự án đọc **cả đường ra**, không chỉ
đường vào.

### 3.1 · Nguyên văn — `drizzle/0314_backup_code_widen_and_user_secrets.sql`

```sql
-- ============================================================================
-- Migration 0314 (NỞ):
--   (9a) backup_codes.code  varchar(20) -> varchar(255)   ⚠ MỤC CHẶN
--   (9b) cột "buộc đổi mật khẩu" — nằm TRONG bảng 9c, xem khối (9b) dưới
--   (9c) user_secrets — tách bí mật khỏi bảng dữ liệu công khai (CHỈ TẠO + CHÉP)
-- (Pha 7 Task 9, docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md)
--
-- ⚠⚠⚠ MIGRATION NÀY **THUẦN THÊM**. Nó KHÔNG bỏ một cột nào. Lượt bỏ cột nằm ở
--     0315 và CHỈ được áp sau khi mã mới đã deploy + nghiệm thu sống ĐẠT.
--     Lý do: 8 hàm ở server/db/auth.ts đọc NGUYÊN HÀNG `users`; drizzle liệt kê
--     TOÀN BỘ cột ⇒ bỏ cột trước khi deploy = `42703` ở mọi lượt đọc `users`
--     = NGỪNG DỊCH VỤ toàn phần (GOTCHA Wave 3, lần thứ BA cùng một lớp lỗi).
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9a) VÌ SAO: `bamMaDuPhong()` (server/_core/backupCodeSecret.ts:56) trả một
--      chuỗi bcrypt PHC dài **60**; cột nhận nó rộng **20**. Đo được hôm nay
--      trên `aoi_management`, trong một giao dịch đã ROLLBACK:
--          22001  value too long for type character varying(20)   (routine: varchar)
--      và ĐỐI CHỨNG: một chuỗi 8 ký tự chèn ĐƯỢC ⇒ bảng/quyền/ràng buộc lành,
--      lỗi đến ĐÚNG từ bề rộng.
--      Sau Task 8a, đường băm là đường ghi **DUY NHẤT** còn lại ⇒ hôm nay
--      **không ai** nhận được mã dự phòng. Bằng chứng khớp: 8/8 tài khoản bật
--      2FA, bảng `backup_codes` có **0 hàng**.
--
-- ⚠ VÌ SAO 255 CHỨ KHÔNG 60: 60 là bề rộng của **bcrypt hôm nay**. Đổi sang
--   argon2id (~97) hay scrypt (~101) sẽ đẻ đúng lượt `22001` này lần thứ hai.
--   255 khớp **tiền lệ trong CHÍNH DB NÀY** cho **CÙNG LOẠI GIÁ TRỊ**:
--   `users."passwordHash"` là varchar(255) và đang chứa đúng một hash bcrypt 60.
--   ⚠⚠ NHƯNG: một BỀ RỘNG vẫn là một lời hứa hình DANH SÁCH. Thứ làm `22001`
--      thành điều KHÔNG THỂ là một LƯỢNG TỪ, không phải con số:
--        ∀ giá trị `bamMaDuPhong()` sinh ra: length <= bề rộng khai ở drizzle
--      SUY RA cả hai vế (một vế từ `getTableColumns`, một vế từ lượt băm thật),
--      KHÔNG viết tay số 60. Đó là ràng buộc của Bước 5, không phải của SQL này.
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9c) VÌ SAO: Task 7 đóng lượt rò ở **tầng TRẢ VỀ** (danh sách CHO PHÉP +
--      đổi kiểu). Đúng và đủ cho hôm nay — nhưng bí mật vẫn nằm **cùng hàng**
--      với dữ liệu công khai, nên **8 hàm** đọc nguyên hàng `users` vẫn kéo
--      `passwordHash` + `two_factor_secret` vào bộ nhớ tiến trình ở MỌI lượt,
--      kể cả `getUserById` — thứ `sdk.authenticateRequest` gọi mỗi request.
--      Mỗi `SELECT` mới viết ngày mai là một lỗ TIỀM NĂNG mới.
--      Tách bảng làm lượt rò **không viết ra được ở tầng DB**: một hàng `users`
--      KHÔNG CÒN CHỨA bí mật để mà rò.
--
-- ⚠ KHOÁ NGOẠI **CÓ**, và đây là chỗ khác Task 5 (`totp_consumed` cố ý KHÔNG
--   có FK). Lý do đảo ngược: hàng ở đây KHÔNG tự chết. `deleteUser()`
--   (server/db/auth.ts:122) chạy một `DELETE FROM users` trần, và DB hiện có
--   **0 khoá ngoại trỏ tới `users`** (đo được; 63 FK trong `public`, không cái
--   nào trỏ `users`) ⇒ không có FK thì xoá một tài khoản để lại **hash mật khẩu
--   và hạt giống TOTP sống lâu hơn chính tài khoản**. `ON DELETE CASCADE` biến
--   phép dọn ấy thành **cấu trúc**, không thành một dòng mã ai đó phải nhớ.
--   ⚠ Đây sẽ là khoá ngoại ĐẦU TIÊN trỏ tới `users` trong DB này — nói ra để
--     lượt sau không tưởng là tai nạn. (Nợ CÙNG LỚP đã có sẵn ở `backup_codes`,
--     KHÔNG vá ở lượt này — xem §2.8.)
--
-- ══════════════════════════════════════════════════════════════════════════
-- (9b) VÌ SAO HAI CỘT CHỨ KHÔNG MỘT CỜ `boolean`:
--   Một cờ `mustChangePassword boolean` cần **ai đó nhớ XOÁ nó** sau lượt đổi
--   mật khẩu. Quên đặt ⇒ hỏng IM LẶNG theo chiều MỞ (không ai bị buộc).
--   Hai mốc thời gian cho phép **SUY RA** vị từ, và tự dọn theo cấu tạo:
--       PHAI_DOI  <=>  "passwordInvalidBefore" IS NOT NULL
--                      AND ("passwordChangedAt" IS NULL
--                           OR "passwordChangedAt" <= "passwordInvalidBefore")
--   · lượt đổi mật khẩu ghi `passwordChangedAt = now()` ⇒ vị từ TỰ thành false;
--   · lượt xoay thứ hai chỉ đẩy `passwordInvalidBefore` tới ⇒ không có trạng
--     thái "cờ đã bật sẵn nên lần này không ăn";
--   · quên ghi `passwordChangedAt` ⇒ hỏng theo chiều **ĐÓNG** (bị buộc đổi dù
--     vừa đổi) — phiền, nhưng KHÔNG mở cửa.
--   BA giá trị, cùng kỷ luật `TrangThaiTienTrinh` (vramAdoption.ts:70) và cột
--   `vram_leases."identityTruncated"` của mig 0313:
--       passwordChangedAt = NULL      -> KHÔNG BIẾT mật khẩu đặt lúc nào.
--                                        Với một lượt thu hồi đang hiệu lực,
--                                        NGƯỜI ĐỌC PHẢI coi là PHẢI ĐỔI.
--       passwordInvalidBefore = NULL  -> CHƯA TỪNG thu hồi -> không buộc ai.
--   ⚠ KHÔNG đặt DEFAULT cho cả hai: một DEFAULT now() sẽ biến "chưa biết"
--     thành "vừa đổi xong" — đúng lời nói dối mà cặp cột này sinh ra để diệt.
--
-- ⚠ VÌ SAO ĐẶT TRONG `user_secrets` CHỨ KHÔNG TRÊN `users` — xem §3.4 báo cáo.
--   Tóm tắt: trên `users` thì `USER_FIELD_VISIBILITY` phải phân loại nó, và
--   phân loại ĐÚNG NGHĨA là `"public"` ⇒ `user.list` phát cho trình duyệt danh
--   sách chính xác các tài khoản đang ở trạng thái buộc-đổi-mật-khẩu.
--   ⚠⚠ ĐÂY LÀ MỘT QUYẾT ĐỊNH CHỦ DỰ ÁN (§5, QĐ-1).
--
-- ══════════════════════════════════════════════════════════════════════════
-- ADDITIVE + IDEMPOTENT. Chạy bằng owner `aoi` (đã đo hôm nay: current_user =
-- avi_app ⇒ sẽ 42501). Áp lên CẢ `aoi_management` LẪN `aoi_management_test`.
-- ⚠⚠ THỨ TỰ BẮT BUỘC: 0314 -> deploy mã -> nghiệm thu sống -> 0315. Xem §3.5.
-- ROLLBACK: §3.6 của
--   docs/superpowers/reports/2026-08-09-vram-pha7-task9-migration-de-xuat.md
-- ============================================================================

-- ── (9a) nới cột mã dự phòng ────────────────────────────────────────────────
-- `ALTER COLUMN ... TYPE` không có `IF NOT EXISTS` ⇒ tự canh bằng catalog.
-- (Bề rộng NULL — cột không tồn tại — cho vị từ NULL ⇒ khối không chạy: an toàn.)
DO $$
BEGIN
  IF (SELECT character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'backup_codes'
         AND column_name  = 'code') < 255 THEN
    ALTER TABLE "backup_codes" ALTER COLUMN "code" TYPE varchar(255);
  END IF;
END $$;

-- ── (9c + 9b) bảng bí mật ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_secrets" (
  -- 1:1 với `users`. PK trên `userId` ⇒ "một người một hàng" là CẤU TRÚC,
  -- không phải một quy ước. `users.id` là `integer` (đã kiểm information_schema).
  "userId"                integer PRIMARY KEY
                          REFERENCES "users"("id") ON DELETE CASCADE,

  -- bcrypt PHC. NULL được: tài khoản OAuth/SSO không có mật khẩu cục bộ —
  -- đúng như `users."passwordHash"` hôm nay (nullable), giữ nguyên ngữ nghĩa.
  "passwordHash"          varchar(255),

  -- hạt giống TOTP base32 (đo được: dài nhất 52). 255 = giữ nguyên bề rộng cũ,
  -- KHÔNG thu hẹp: một lượt migrate không phải chỗ để đổi thêm một bất biến.
  "twoFactorSecret"       varchar(255),

  -- (9b) hai mốc — xem khối lý do ở header. KHÔNG DEFAULT, cả hai.
  "passwordChangedAt"     timestamp,
  "passwordInvalidBefore" timestamp,

  -- cùng khuôn `vram_leases`/`totp_consumed`: `timestamp` KHÔNG múi giờ,
  -- máy chủ chạy timezone = Etc/UTC.
  "updatedAt"             timestamp NOT NULL DEFAULT now()
);

-- ⚠ KHÔNG chỉ mục nào ngoài PK: đường đọc DUY NHẤT là theo `userId`, và PK đã
--   phục vụ nó. Một chỉ mục trên `passwordHash`/`twoFactorSecret` sẽ trả chi phí
--   ghi cho 0 truy vấn — và đặt một bí mật vào một cấu trúc sắp thứ tự.

-- Chép dữ liệu. `DO NOTHING` (KHÔNG `DO UPDATE`): nếu file này chạy lại trong
-- một lượt khôi phục, hàng ở `user_secrets` là bản MỚI HƠN — đè nó bằng bản trên
-- `users` sẽ HỒI SINH một mật khẩu cũ. Im lặng, và không hoàn tác được.
INSERT INTO "user_secrets" ("userId", "passwordHash", "twoFactorSecret", "updatedAt")
SELECT u."id", u."passwordHash", u."two_factor_secret", now()
  FROM "users" u
ON CONFLICT ("userId") DO NOTHING;

-- ⚠ `pg_default_acl` của DB này ĐÃ có `{avi_app=arwd/aoi}` cho mọi bảng do `aoi`
--   tạo (đo được hôm nay) ⇒ dòng dưới là dòng LÀM RÕ, KHÔNG phải dòng cứu mạng.
--   Giữ lại vì một vai khác `aoi` chạy lượt này sẽ tạo ra một bảng `avi_app`
--   không đọc nổi. (Câu này đã suýt bị viết sai ở mig 0313; phép đo sửa nó.)
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_secrets" TO "avi_app";
```

**Mục TUỲ CHỌN — chủ dự án gạch được, không ảnh hưởng mục nào khác:**

```sql
-- Chỉ mục `idx_backup_codes_code` phục vụ 0 truy vấn: phép đối chiếu là
-- `bcrypt.compare` TRÊN TỪNG HÀNG (server/db/auth.ts:331, twoFactorRouter.ts:231/318),
-- và `eq(backupCodes.code, …)` xuất hiện 0 lần trong toàn repo (đã đếm).
-- Nó trả chi phí ghi cho mỗi mã sinh ra (10 mã/lượt bật 2FA) và đặt một hash
-- bí mật vào một cấu trúc sắp thứ tự.
DROP INDEX IF EXISTS "idx_backup_codes_code";
```

### 3.2 · Nguyên văn — `drizzle/0315_users_drop_secret_columns.sql` (**CHỈ SAU NGHIỆM THU SỐNG**)

```sql
-- ============================================================================
-- Migration 0315 (CO): bỏ hai cột bí mật khỏi `users`.
--
-- ⛔⛔⛔ ĐIỀU KIỆN VÀO — BA ĐIỀU, KHÔNG PHẢI MỘT:
--   (1) 0314 đã áp trên CẢ HAI DB;
--   (2) build mới ĐÃ CHẠY (`users` trong drizzle KHÔNG CÒN hai cột ấy; mọi
--       đường đọc/ghi bí mật đã trỏ `user_secrets`) — kiểm bằng
--       `git show <commit>:drizzle/schema/auth.ts`, KHÔNG bằng trí nhớ;
--   (3) NGHIỆM THU SỐNG Bước 8 ĐẠT: một tài khoản đăng ký lại 2FA và NHẬN
--       ĐƯỢC mã dự phòng trên hệ thật.
-- Áp khi (2) chưa xong ⇒ `42703` ở 8 hàm đọc nguyên hàng `users` ⇒ NGỪNG DỊCH VỤ.
--
-- ⚠ ĐÂY LÀ CÂU KHÔNG HOÀN TÁC ĐƯỢC BẰNG DDL ĐƠN THUẦN: dữ liệu đi theo cột.
--   Hoàn tác được CHỈ VÌ `user_secrets` giữ bản sao — xem §3.6.
-- Chạy bằng owner `aoi`. Áp lên CẢ hai DB.
-- ============================================================================

-- Lưới chặn cuối, chạy TRƯỚC khi bỏ.
DO $$
DECLARE thieu int; lech int;
BEGIN
  SELECT count(*) INTO thieu
    FROM "users" u LEFT JOIN "user_secrets" s ON s."userId" = u."id"
   WHERE s."userId" IS NULL;
  IF thieu > 0 THEN
    RAISE EXCEPTION 'DUNG: % hang users KHONG co hang user_secrets — chep lai truoc khi bo cot', thieu;
  END IF;

  SELECT count(*) INTO lech
    FROM "users" u JOIN "user_secrets" s ON s."userId" = u."id"
   WHERE u."passwordHash"      IS DISTINCT FROM s."passwordHash"
      OR u."two_factor_secret" IS DISTINCT FROM s."twoFactorSecret";
  -- ⚠ `lech > 0` là ĐIỀU BÌNH THƯỜNG sau khi mã mới chạy (mã mới chỉ ghi
  --   `user_secrets`; cột cũ đứng yên và HOÁ CŨ). Nên đây là CẢNH BÁO, không
  --   phải EXCEPTION — nhưng nó phải được IN RA, vì nó là con số duy nhất nói
  --   "cột cũ đã chết bao lâu rồi".
  RAISE NOTICE 'so hang co cot cu LECH voi user_secrets: % (0 = ma moi chua ghi lan nao)', lech;
END $$;

ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_secret";
```

### 3.3 · Bảng: **cột → kiểu → vì sao kiểu ấy → chỉ mục nào, vì sao**

| bảng.cột | kiểu | vì sao **kiểu ấy** | chỉ mục |
|---|---|---|---|
| `backup_codes.code` | `varchar(20)` → **`varchar(255)`** | phải chứa bcrypt PHC **60** (đo được `22001` ở 20). **255** = tiền lệ **cùng DB, cùng loại giá trị** (`users."passwordHash"`), và phủ argon2id ≈97 / scrypt ≈101 ⇒ không đẻ lượt migrate thứ hai khi đổi thuật toán băm. Bề rộng khai **không tốn byte nào** ở PG | giữ `backup_codes_pkey` + `idx_backup_codes_user`; **đề xuất XOÁ** `idx_backup_codes_code` (0 truy vấn — §2.4) |
| `user_secrets."userId"` | `integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` | khớp `users.id` = `integer`. PK ⇒ *"một người một hàng"* là **cấu trúc**. **CÓ** khoá ngoại — **ngược** Task 5 — vì hàng này **không tự chết**, và `deleteUser()` là một `DELETE` trần trên một bảng **không FK nào trỏ tới** ⇒ không cascade thì bí mật **sống lâu hơn tài khoản** | `user_secrets_pkey` — và là **chỉ mục DUY NHẤT** |
| `user_secrets."passwordHash"` | `varchar(255)` **NULL được** | **giữ nguyên** kiểu + tính nullable của `users."passwordHash"` (tài khoản SSO không có mật khẩu cục bộ). Một lượt migrate **không phải chỗ** đổi thêm một bất biến | — |
| `user_secrets."twoFactorSecret"` | `varchar(255)` **NULL được** | giữ nguyên `users.two_factor_secret` (đo được: dài nhất **52**). NULL = **chưa bật 2FA** — ngữ nghĩa đang có, không đổi | — |
| `user_secrets."passwordChangedAt"` | `timestamp` **NULL được**, **KHÔNG DEFAULT** | NULL = **KHÔNG BIẾT** — đúng cho 8 hàng hiện có: hệ **chưa từng** ghi mốc này. Một DEFAULT `now()` sẽ khai *"vừa đổi xong"* cho 8 mật khẩu **đã lộ** ⇒ tự tay dựng lại lời nói dối | — (vị từ luôn đi kèm `userId`; PK đã phục vụ) |
| `user_secrets."passwordInvalidBefore"` | `timestamp` **NULL được**, **KHÔNG DEFAULT** | NULL = **chưa từng thu hồi** ⇒ **không ai bị buộc** ⇒ migration **trung tính về hành vi** ngay lúc áp. Là **MỐC**, không phải **CỜ**: lượt xoay thứ hai chỉ đẩy nó tới, không có trạng thái *"cờ bật sẵn nên lần này không ăn"* | — |
| `user_secrets."updatedAt"` | `timestamp NOT NULL DEFAULT now()` | cùng khuôn mọi bảng khác (`users`, `backup_codes`); trả lời *"hàng bí mật này đổi lần cuối bao giờ"* — câu hai mốc kia **không** trả lời, vì chúng chỉ nói về **mật khẩu**, không về `twoFactorSecret` | — |
| `users."passwordHash"` · `users.two_factor_secret` | **BỎ** (0315) | sau khi `user_secrets` là chủ duy nhất, giữ lại = giữ **hai bản sao của một bí mật**, và bản cũ **hoá cũ trong im lặng** — đúng lớp lỗi mà §2.6 vừa bắt được ở script xoay | (đã kiểm 7 chỉ mục của `users`: **không** chỉ mục nào trên hai cột này) |

### 3.4 · Đường **KHÔNG CHỌN**, và vì sao

| đường | vì sao **không** |
|---|---|
| 9a: `varchar(60)` | 60 là bề rộng của **bcrypt hôm nay**. Đúng lớp *"chọn đủ rộng rồi một ngày phát hiện chưa đủ"* — chính là lỗi đang vá |
| 9a: `text` (bỏ trần) | *"22001 là điều KHÔNG THỂ"* thành đúng **theo cấu tạo** — mạnh hơn mọi con số. **Nhưng** khi ấy **không còn con số nào** để lượng từ ∀ của Bước 5 so vào, và luật *"bề rộng cột ≥ bề rộng hàm băm sinh ra"* thành **rỗng**. Pha này đã có **một** lưới rỗng vì mất vế so sánh rồi. ⇒ **Chủ dự án lật được** (§5, QĐ-2) |
| 9b: `users.mustChangePassword boolean` | (a) cần **ai đó nhớ xoá** ⇒ hỏng im lặng theo chiều **MỞ**; (b) trên `users` thì `USER_FIELD_VISIBILITY` phải phân loại nó, và phân loại **đúng nghĩa** là `"public"` ⇒ `user.list` phát cho trình duyệt **danh sách tài khoản đang bị buộc đổi mật khẩu** |
| 9b: đặt hai mốc trên `users` | cùng lý do (b). Cộng: mốc *"mật khẩu đổi lúc nào"* là một **sự thật VỀ mật khẩu** ⇒ chỗ của nó là **cạnh mật khẩu** |
| 9c: giữ bí mật ở `users`, chỉ thêm lưới | đúng thứ Task 7 **đã làm**, và nó **đủ cho hôm nay**. Cái nó **không** đóng: mỗi `.select().from(users)` viết ngày mai là một lỗ tiềm năng mới, và **8 hàm hiện có** vẫn kéo bí mật vào bộ nhớ tiến trình ở **đường nóng** |
| 9c: `user_secrets` **không** khoá ngoại (theo lệ repo: 0 FK trỏ `users`) | `deleteUser()` để lại bí mật **mồ côi**. Lệ của repo ở đây là **một nợ**, không phải một tiêu chuẩn (§2.8) |
| 9c: bỏ cột **cùng** migration | **NGỪNG DỊCH VỤ** — §3.0, §3.5 |
| 9c: mã **ghi cả hai chỗ** trong cửa sổ chuyển | *"hai người ghi dưới một bất biến"* — lớp lỗi đã phải **đổi kiểu 5 lần** để diệt, và Task 8a vừa diệt nó **cho đúng bảng này**. Không dựng lại nó vì tiện |

### 3.5 · **THỨ TỰ ÁP** — và **GÃY GÌ NẾU ĐẢO**

**THỨ TỰ ĐÚNG, DUY NHẤT:**

```
① 0314 (NỞ) trên cả hai DB, owner `aoi`
② deploy mã mới   ── ⚠ CÙNG CỬA SỔ BẢO TRÌ với ① (xem "cửa sổ trôi" dưới)
③ nghiệm thu sống: một tài khoản ĐĂNG KÝ LẠI 2FA và NHẬN ĐƯỢC mã dự phòng
④ 0315 (CO) trên cả hai DB
⑤ ── chỉ tới đây Task 10 (xoay) mới có điều kiện vào ──
```

| đảo cái gì | cái gãy | mức |
|---|---|---|
| **④ trước ②** — đường ĐỌC | drizzle liệt kê **toàn bộ** cột ⇒ **8 hàm** đọc nguyên hàng sinh `SELECT … "passwordHash", two_factor_secret …` → **`42703`**. Trong đó có `getUserById` (**mọi request đã xác thực**) và `getUserByUsername` (**mọi lượt đăng nhập**) | ⛔ **NGỪNG DỊCH VỤ TOÀN PHẦN** |
| **④ trước ②** — đường GHI | `insert(users).values()` cũng liệt kê cột ⇒ `createLocalUser`/`createUser` → `42703` | ⛔ |
| **② trước ①** | mã mới trỏ `user_secrets` chưa tồn tại → **`42P01`** ở đăng nhập + 2FA | ⛔ |
| **⑤ trước ③** | 8/8 mất 2FA, đăng ký lại **ghi mã dự phòng qua đường đang vỡ** ⇒ **khoá 8 người ra khỏi hệ, không có đường vào lại** (đúng khối *"THỨ TỰ BẮT BUỘC"* của kế hoạch) | ⛔ |
| **⑤ trước ④**, script chưa sửa | ★★ `xoay-bi-mat-2fa.mjs` chạy `UPDATE users SET two_factor_secret = NULL` **trên một cột đã chết**, in *"N hàng đã đổi"*, và **không xoay gì** — §2.6 | ⛔ **báo cáo thành công mà không làm gì** |

> ★ GOTCHA Wave 3, nguyên văn trong memory: *"drizzle liệt kê TOÀN BỘ cột ⇒ thêm cột chưa migrate thì
> **cả INSERT cũng vỡ**, chạy migration TRƯỚC deploy SAU."* Lượt này là **lần thứ BA** cùng lớp lỗi,
> và lần này nó ở **chiều ngược** (bỏ cột trước khi deploy), nên câu ghi nhớ cũ **không đủ** — phải
> đọc là: ***lược đồ drizzle và lược đồ DB phải khớp ở MỌI thời điểm; lượt nào lệch trước thì lượt ấy
> phải là lượt KHÔNG ai đọc tới.***

**★ CỬA SỔ TRÔI giữa ① và ② — nói ra, không để nó là tác dụng phụ im lặng.**
Câu `INSERT … SELECT` ở 0314 là **một ảnh chụp**. Nếu ai đó đổi mật khẩu (hoặc bật/tắt 2FA) **sau**
① và **trước** ②, thay đổi ấy vào **`users`** và **không** vào `user_secrets`; tới ② mã mới đọc
`user_secrets` ⇒ **mật khẩu vừa đổi biến mất**, mật khẩu cũ sống lại.

Hai cách chặn — chọn một:
1. **Chạy ① và ② trong CÙNG cửa sổ bảo trì** (khuyến nghị — hệ có **8** tài khoản, cửa sổ tính bằng phút);
2. hoặc chạy câu **ĐỒNG BỘ LẠI** dưới đây **ngay trước** khi khởi động build mới:

```sql
-- ⚠⚠ CHỈ ĐƯỢC CHẠY TRƯỚC KHI BUILD MỚI KHỞI ĐỘNG.
-- Chạy nó SAU đó sẽ ĐÈ bí mật MỚI bằng bản CŨ trên `users` — không hoàn tác được.
INSERT INTO "user_secrets" ("userId", "passwordHash", "twoFactorSecret", "updatedAt")
SELECT u."id", u."passwordHash", u."two_factor_secret", now() FROM "users" u
ON CONFLICT ("userId") DO UPDATE
   SET "passwordHash"    = EXCLUDED."passwordHash",
       "twoFactorSecret" = EXCLUDED."twoFactorSecret",
       "updatedAt"       = EXCLUDED."updatedAt";
```

### 3.6 · Lượt **HOÀN TÁC**

```sql
-- ============================================================================
-- ROLLBACK. ⚠⚠ ĐỌC THỨ TỰ TRƯỚC KHI CHẠY: hoàn tác đi NGƯỢC chiều áp, và
-- 0315 phải được hoàn tác TRƯỚC 0314 (0314 cần hai cột trên `users` để chép về).
-- Chạy bằng owner `aoi`, trên CẢ hai DB.
-- ============================================================================

-- ── HOÀN TÁC 0315 (nếu đã áp) ──────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash"      varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" varchar(255);
-- Chép NGƯỢC: `user_secrets` là bản MỚI HƠN kể từ khi mã mới chạy.
UPDATE "users" u
   SET "passwordHash"      = s."passwordHash",
       "two_factor_secret" = s."twoFactorSecret"
  FROM "user_secrets" s
 WHERE s."userId" = u."id";
-- Kiểm ngay, đừng tin: phải = 0
--   SELECT count(*) FROM users u JOIN user_secrets s ON s."userId" = u.id
--    WHERE u."passwordHash" IS DISTINCT FROM s."passwordHash"
--       OR u."two_factor_secret" IS DISTINCT FROM s."twoFactorSecret";
DELETE FROM "__applied_migrations" WHERE "filename" = '0315_users_drop_secret_columns.sql';

-- ── HOÀN TÁC 0314 ──────────────────────────────────────────────────────────
-- ⚠⚠ CHẠY SAU KHI ĐÃ HOÀN NGUYÊN MÃ, KHÔNG TRƯỚC.
DROP TABLE IF EXISTS "user_secrets";

-- (tuỳ chọn, nếu đã xoá ở 0314) dựng lại chỉ mục
CREATE INDEX IF NOT EXISTS "idx_backup_codes_code" ON "backup_codes" ("code");

-- ⚠⚠⚠ THU HẸP LẠI `backup_codes.code` LÀ MỘT LƯỢT **MẤT DỮ LIỆU CÓ CHỦ Ý**:
--     mọi hash bcrypt (60) ghi từ lúc 0314 áp sẽ KHÔNG vừa varchar(20). Câu
--     `ALTER … TYPE` sẽ ném 22001 và DỪNG nếu còn hàng như thế — đó là hành vi
--     ĐÚNG. Đi tiếp thì phải XOÁ chúng, tức TỰ TAY vô hiệu mã dự phòng của mọi
--     người đã đăng ký lại 2FA — chính lỗ mà 0314 sinh ra để đóng.
--     ⇒ ĐỌC SỐ TRƯỚC KHI QUYẾT:
--        SELECT count(*) FROM backup_codes WHERE length(code) > 20;
-- DELETE FROM "backup_codes" WHERE length("code") > 20;
-- ALTER TABLE "backup_codes" ALTER COLUMN "code" TYPE varchar(20);

DELETE FROM "__applied_migrations" WHERE "filename" = '0314_backup_code_widen_and_user_secrets.sql';
```

⚠ Tên cột bảng theo dõi — **`__applied_migrations.filename`** — đã kiểm ở Task 5, **không đoán**.

### 3.7 · CHI PHÍ — **byte/hàng** và **lượt truy vấn thêm**

**(a) Byte.** Nền **đo được**: `users` heap **8.192 B** + chỉ mục **114.688 B** cho **8 hàng**;
`backup_codes` (0 hàng, 3 chỉ mục) **57.344 B**; nội dung bí mật thật: `passwordHash` **408 B** /
`two_factor_secret` **272 B** trên 8 hàng.

| mục | byte/hàng | tổng hôm nay |
|---|---|---|
| `backup_codes.code`: **khai** `varchar(255)` thay `varchar(20)` | **0** — PG lưu **độ dài thật + 1..4 B header**; trần khai **không tốn byte** | **0** |
| `backup_codes.code`: **giá trị** đổi từ mã 8 ký tự → hash 60 | **+52** | 10 mã × 8 người = 80 hàng ⇒ **≈ +4,2 KB** (một trang) |
| `user_secrets` — một hàng | **≈ 175** (24 header/căn + 4 `userId` + 61 hash + 53 secret + 3×8 mốc) | 8 hàng ≈ **1,4 KB** |
| `user_secrets` — bảng + PK | — | ≈ **24–32 KB** (1 trang heap + btree tối thiểu) |
| (9b) hai mốc | **+16** | **+128 B** |
| `users` sau 0315 | **−85** (đo thật: 680 B / 8 hàng) | ⚠ heap **KHÔNG co lại** cho tới `VACUUM FULL`/rewrite — nói ra, đừng hứa |

⇒ Tổng dưới **40 KB** trên một DB **395 bảng**. **Chi phí byte không phải một biến số của quyết định này.**

**(b) Lượt truy vấn** — đây **mới** là chi phí thật, và nó **âm** ở đường đông nhất:

| đường | tần suất | hôm nay | sau khi tách | thêm |
|---|---|---|---|---|
| `getUserById` ← `sdk.authenticateRequest` | **mỗi request đã xác thực** (có cache) | 1 `SELECT` 19 cột **kèm bí mật** | 1 `SELECT` 17 cột **không bí mật** | **0 câu · −85 B/hàng · bí mật KHÔNG vào bộ nhớ tiến trình** |
| `getAllUsers` · `searchUsers` · `getUsersByRole` · `getActiveUsers` · `getUserByOpenId` | trang quản trị | 1, kèm bí mật của **MỌI** người dùng | 1, **không** bí mật | **0** |
| đăng nhập tRPC/web (`getUserByUsername` + so mật khẩu) | mỗi lượt đăng nhập | 1 | 1 + **1 đọc `user_secrets`** (hoặc một `LEFT JOIN`) | **+1** |
| `POST /api/external/auth/login` (REST) | app RN | 1 | 1 + **1** | **+1** |
| 2FA lúc đăng nhập · step-up · `get2FAStatus` · 6 thủ tục `twoFactorRouter`/`userRouters` | lượt bấm nút | 1 `SELECT` **chiếu 2 cột** trên `users` | 1 `SELECT` chiếu trên `user_secrets` | **0** |
| `setup2FA` · `disable2FA` · `updateUserPassword` | hiếm | 1 `UPDATE users` | 1 upsert `user_secrets` | **0** |
| `createLocalUser` · `createUser` | hiếm | 1 `INSERT` | 2 `INSERT`, **trong MỘT giao dịch** | **+1** |
| `deleteUser` | hiếm | 1 `DELETE` | 1 `DELETE` (**cascade** dọn hộ) | **0** |

⚠ **Ràng buộc cho Bước 5, không phải gợi ý:** hai câu `INSERT` của lượt tạo người dùng phải nằm
trong **MỘT giao dịch**. Một tài khoản có hàng `users` mà **không** có hàng `user_secrets` là một
tài khoản **không đăng nhập được**, và nó sẽ được tạo ra **im lặng**.

⇒ **Đúng hai** đường trả **+1 câu**, cả hai **hiếm**; đường **đông nhất** (mỗi request) **rẻ đi**
và thôi mang bí mật.

### 3.8 · RỦI RO

| # | rủi ro | mức | chặn bằng |
|---|---|---|---|
| **R1** | ★★★ Task 7 **HOÁ RỖNG**: bỏ 2 cột ⇒ `SERVER_ONLY_USER_FIELDS = []` ⇒ cổng kiểu thành `{}` | ⛔ | §2.5 — **NEO LẠI** luật sang `user_secrets` + một ô canh *"phân loại rỗng ⇒ ĐỎ"*. **KHÔNG** xoá 4 dòng test sẽ đỏ |
| **R2** | ★★★ script xoay (Task 10) **báo thành công mà không xoay** | ⛔ | §2.6 — điều kiện vào Task 10 cộng: script đã trỏ `user_secrets`, và lượt **khô** in ra **đúng tên bảng** nó sẽ đụng |
| **R3** | áp 0315 trước khi deploy mã | ⛔ ngừng dịch vụ | §3.5 — ba điều kiện vào ghi **ngay trong header** 0315 |
| **R4** | cửa sổ trôi ①→② nuốt một lượt đổi mật khẩu | ⚠ mất **im lặng** | §3.5 — cùng cửa sổ bảo trì, **hoặc** câu đồng bộ lại |
| **R5** | `42501` vì chạy DDL bằng `avi_app` (đo được: `current_user` = `avi_app`) | ⚠ | owner **`aoi`**, ghi trong header |
| **R6** | quên `aoi_management_test` ⇒ lưới *"xanh rỗng"* (GOTCHA Wave 4) | ⚠ | áp **cả hai**; hôm nay hai DB **cùng hình dạng** (đã đo) ⇒ lệch sau này sẽ là lỗi **mới** |
| **R7** | `FakeDb` không biết `user_secrets` ⇒ ca đăng nhập/2FA đỏ vì **một lý do sai** | ⚠ | §2.7 — quyết **trước** ở Bước 5: dạy `FakeDb`, **hoặc** thêm `"user_secrets"` vào `BANG_THAT` của `soHonHop()` |
| **R8** | lưới quét theo tên bắt nhầm **`mqtt_clients.passwordHash`** | ⚠ | §2.1 — bộ suy hỏi *"cột của BẢNG nào"*, khuôn `__totpDbHybrid.ts:13` |
| **R9** | tạo người dùng xong nhưng thiếu hàng bí mật ⇒ tài khoản **không đăng nhập được**, im lặng | ⚠ | §3.7(b) — **một giao dịch**; cộng một ô ∀ *"mọi hàng `users` có đúng một hàng `user_secrets`"* (0315 đã có bản DDL của phép kiểm này) |
| **R10** | `ALTER COLUMN TYPE` cần **rewrite**/**reindex** ⇒ khoá bảng lâu | ✔ không đáng kể | PG ≥ 9.2 **kỳ vọng** không rewrite khi **nới** `varchar` và không đổi collation. ⚠ **CHƯA ĐO ĐƯỢC** ở lượt này (cấm chạy DDL) — nhưng bảng có **0 hàng** trên **cả hai** DB, nên **kể cả khi có** rewrite thì chi phí vẫn ~0. Bước 4 xác nhận bằng đồng hồ, **đừng suy** |
| **R11** | khoá ngoại **đầu tiên** trỏ `users` đổi hành vi một đường xoá/dọn | ✔ thấp | `ON DELETE CASCADE` chỉ **thêm** một lượt dọn; `TRUNCATE users` sẽ đòi `CASCADE` — đã đếm: **0** chỗ `TRUNCATE users` trong repo |
| **R12** | hoàn tác 9a **mất mã dự phòng** | ⚠ có chủ ý | §3.6 — câu `DELETE` để **ngoài** khối chạy, kèm câu đếm phải đọc trước |

---

## 4 · ⏸ DỪNG — CHỜ CHỦ DỰ ÁN DUYỆT

| bước | trạng thái |
|---|---|
| 1 · ĐO trước (tái lập `22001` · `users` không có cột · đếm 3 bí mật) | ✅ **xong** — §1 |
| 2 · ĐẾM bề mặt | ✅ **xong** — §2; phép đếm **lật hai lần** (§2.5, §2.6) |
| 3 · SOẠN SQL rồi DỪNG | ✅ **xong** — §3 |
| 4 · áp migration (cả 2 DB, owner `aoi`) | ⏸ **CHỜ DUYỆT** |
| 5 · cài mã | ⏸ |
| 6 · đối chứng dương | ⏸ |
| 7 · đột biến | ⏸ |
| 8 · nghiệm thu sống (**điều kiện vào của Task 10**) | ⏸ |
| 9 · commit | ⏸ |

**Lượt này KHÔNG chạy một câu DDL nào** — không `db:push`, không `drizzle-kit`, không `psql` ghi,
không tạo file trong `drizzle/`. Hai lượt `INSERT` duy nhất nằm trong giao dịch **đã `ROLLBACK`**
(đúng phép đo Bước 1 yêu cầu). Không cấp quyền, không `kb:sync`, không chạy script xoay.
Máy chủ **PID 36072** không bị đụng tới. File dò tạm **đã xoá**.

### Nhắc cho lượt sau (Bước 4–5) — **đọc trước khi gõ lệnh**

1. DDL bằng owner **`aoi`**. Đã đo hôm nay: `current_user` = **`avi_app`** ⇒ sẽ **`42501`**.
2. Áp lên **cả** `aoi_management` **và** `aoi_management_test` (hôm nay hai DB **cùng hình dạng**).
3. **0314 → deploy mã → nghiệm thu sống → 0315.** Đảo là ngừng dịch vụ (§3.5).
4. Sau 0314, cập nhật `drizzle/schema/auth.ts`: thêm bảng `userSecrets`; **CHỈ SAU 0315** mới bỏ hai
   cột khỏi `users` trong drizzle. ⚠ Bỏ trong drizzle **trước** khi bỏ trong DB thì không sao (drizzle
   chỉ thôi liệt kê); bỏ trong DB **trước** khi bỏ trong drizzle thì **`42703`**.
5. **NEO LẠI luật Task 7** (§2.5) — đây là mục dễ bị bỏ nhất, vì lượt sửa hiển nhiên (xoá 4 dòng
   test đang đỏ) **làm mọi thứ xanh**.
6. **SỬA `scripts/xoay-bi-mat-2fa.mjs` trỏ `user_secrets`** trước khi Task 10 có điều kiện vào (§2.6).
   Bốn script cùng lớp: `print-otp.mjs` · `seed-test-data.mjs` · `audit/audit-account.mjs` · `seed-admin.mjs`.
7. Repo dùng gói **`postgres`** (v3), **không** `pg`; script **ngoài** repo không resolve được
   `node_modules` — đặt script tạm **trong** repo rồi xoá.
8. `tsconfig.json` **loại trừ** `*.test.ts` ⇒ một `@ts-expect-error` viết trong file test thì
   **không ai kiểm** (khuôn `backupCodeSecret.ts:77` — cổng kiểu phải nằm ở file **sản xuất**).

---

## 5 · **BA QUYẾT ĐỊNH CẦN CHỦ DỰ ÁN**

| # | câu hỏi | đề xuất | đường thay thế |
|---|---|---|---|
| **QĐ-1** | 9b đặt ở đâu — **`user_secrets`** hay **`users`**? | **`user_secrets`** — trên `users` thì phân loại đúng nghĩa là `"public"` ⇒ `user.list` phát ra danh sách tài khoản đang bị buộc đổi mật khẩu | `users.mustChangePassword boolean` (đơn giản hơn, nhưng hỏng im lặng **theo chiều MỞ** và lộ trạng thái) |
| **QĐ-2** | 9a: **`varchar(255)`** hay **`text`**? | **`varchar(255)`** — giữ được một **con số** để lượng từ ∀ ở Bước 5 so vào, và khớp tiền lệ `users."passwordHash"` | `text` ⇒ `22001` **không thể** theo cấu tạo, nhưng luật ∀ mất vế so sánh ⇒ thành **rỗng** |
| **QĐ-3** | Xoá **`idx_backup_codes_code`** (0 truy vấn, trả chi phí ghi cho 10 mã mỗi lượt bật 2FA)? | **xoá** | giữ — vô hại, chỉ tốn ghi |

⚠ **Không mục nào trong ba mục trên chặn lượt duyệt**: gạch/đổi bất kỳ mục nào cũng chỉ sửa vài dòng
SQL, **không** đổi thứ tự áp và **không** đổi kết luận của §2.5/§2.6.

---
---

# PHẦN II — THỰC THI (Bước 4–9), sau khi chủ dự án DUYỆT

> Chủ dự án duyệt nội dung migration + **ba câu QĐ-1/2/3** (2026-08-09). Khối quyết định nằm ở
> **cuối** `docs/superpowers/plans/2026-08-07-vram-pha7-backlog.md`.
> **Phần này ghi DẦN sau mỗi bước** — không viết sau khi xong hết.

## 6 · BƯỚC 4 — ÁP `0314` (thuần thêm) — ✅ **XONG**

### 6.1 · Ba quyết định đã đổi gì so với §3.1

| # | quyết định | thay đổi trong SQL |
|---|---|---|
| **QĐ-1** | hai mốc đặt trên **`users`** (ngược đề xuất) | hai `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS` thay vì hai cột trong `user_secrets`. `user_secrets` còn **4** cột (`userId` · `passwordHash` · `twoFactorSecret` · `updatedAt`) |
| **QĐ-2** | `varchar(255)` | **không đổi** — §3.1 đã là 255 |
| **QĐ-3** | XOÁ `idx_backup_codes_code` | mục "tuỳ chọn" ở §3.1 **vào thân** migration (`DROP INDEX IF EXISTS`) |

⚠ **QĐ-1 KHÔNG được để thành lỗ.** Rủi ro đã nêu (phân loại `"public"` ⇒ `user.list` phát danh sách
tài khoản đang bị buộc đổi mật khẩu) được đóng **ở tầng mã, theo cấu tạo** — xem §7.

### 6.2 · Đã áp — **CẢ HAI DB, owner `aoi`**

File: **`drizzle/0314_backup_code_widen_and_user_secrets.sql`** · **7 câu lệnh**.
⚠ **KHÔNG** dùng `npm run db:push`: `DATABASE_URL` của app là `avi_app` ⇒ `42501` (R5). Áp bằng một
script tạm chạy với `postgresql://aoi:aoi@…` (đã xoá sau khi dùng).

**Nền TRƯỚC khi áp (đo, không đoán):**

| | `aoi_management` | `aoi_management_test` |
|---|---|---|
| `backup_codes.code` | `varchar(20)` | `varchar(20)` |
| `to_regclass('public.user_secrets')` | **`null`** | **`null`** |
| `users` số cột | 19 | 19 |
| chỉ mục `backup_codes` | `_pkey` · **`idx_backup_codes_code`** · `idx_backup_codes_user` | như trái |
| hàng | 8 users · 0 backup_codes · 8 có `passwordHash` · 8 có `two_factor_secret` | 5 users · 0 · 1 · 0 |
| mig cuối | `0313` | `0313` |

**Đồng hồ mỗi câu (R10 — đo, KHÔNG suy):**

```
===== aoi_management (current_user=aoi) =====        ===== aoi_management_test =====
  [1/7] 14.36 ms  DO $$  (ALTER … TYPE varchar(255))   [1/7] 16.34 ms
  [2/7]  2.42 ms  DROP INDEX IF EXISTS "idx_backup_codes_code";      [2/7]  4.54 ms
  [3/7]  3.50 ms  ALTER TABLE "users" ADD COLUMN … "passwordChangedAt"      [3/7] 2.25 ms
  [4/7]  1.54 ms  ALTER TABLE "users" ADD COLUMN … "passwordInvalidBefore"  [4/7] 1.16 ms
  [5/7] 12.04 ms  CREATE TABLE IF NOT EXISTS "user_secrets"          [5/7] 10.82 ms
  [6/7]  3.13 ms  INSERT INTO "user_secrets" … SELECT … FROM "users" [6/7]  3.20 ms
  [7/7]  1.26 ms  GRANT … ON "user_secrets" TO "avi_app";            [7/7]  0.99 ms
  ✔ ghi __applied_migrations                                          ✔ ghi __applied_migrations
```

**★ R10 trả lời DỨT ĐIỂM — bằng một thí nghiệm CÓ ĐỐI CHỨNG, không bằng con số 14 ms.**
14 ms trên một bảng **0 hàng** không chứng minh được gì (0 hàng thì rewrite cũng nhanh). Nên đo thêm
trên **1.000 hàng thật**, trong một giao dịch tạm, ở **cả hai** DB:

```
CREATE TEMP TABLE __r10 (c varchar(20)); INSERT 1000 hàng;
ALTER TABLE __r10 ALTER COLUMN c TYPE varchar(255);
⇒ aoi_management       relfilenode 205983 -> 205983   KHÔNG rewrite
⇒ aoi_management_test  relfilenode 205986 -> 205986   KHÔNG rewrite
```

⇒ **PG 17.10 KHÔNG rewrite khi NỚI `varchar` không đổi collation.** Kỳ vọng ở §3.8 R10 nay là một
**phép đo**, không còn là một kỳ vọng. (Chiều ngược — **thu hẹp** — vẫn rewrite và vẫn `22001`; đó
đúng là hành vi §3.6 mô tả.)

### 6.3 · XÁC NHẬN bằng `information_schema` — **CẢ HAI DB**

```
===== aoi_management =====                       ===== aoi_management_test =====
information_schema: backup_codes.code varchar(255)   backup_codes.code varchar(255)
users mốc mới: passwordChangedAt:timestamp null=YES def=NULL
               passwordInvalidBefore:timestamp null=YES def=NULL      (giống hệt)
to_regclass('public.user_secrets') = user_secrets                     = user_secrets
user_secrets: userId:integer null=NO · passwordHash:varchar(255) null=YES
              · twoFactorSecret:varchar(255) null=YES · updatedAt:timestamp null=NO
FK: user_secrets_userId_fkey(userId) ON DELETE CASCADE                (giống hệt)
chỉ mục: backup_codes_pkey · idx_backup_codes_user · user_secrets_pkey  ⇒ idx_backup_codes_code ĐÃ MẤT
chép: {nu:8, ns:8, lech:0, thieu:0, buoc_doi:0}      chép: {nu:5, ns:5, lech:0, thieu:0, buoc_doi:0}
quyền avi_app: {s:true, i:true, u:true, d:true}      (giống hệt)
mig: 0314…=true · 0313…=true                         mig: 0314…=true · 0313…=true
```

- `thieu = 0` ⇒ **∀ hàng `users` có đúng một hàng `user_secrets`** (điều kiện R9 và điều kiện vào 0315).
- `lech = 0` ⇒ ảnh chụp khớp **tại thời điểm áp**. ⚠ Nó sẽ **KHÁC 0** ngay khi mã mới ghi lần đầu — đó
  là **điều bình thường** (0315 in ra như một `NOTICE`, không phải `EXCEPTION`).
- `buoc_doi = 0` ⇒ migration **TRUNG TÍNH VỀ HÀNH VI**: chưa ai bị buộc đổi mật khẩu.
- `quyền avi_app` đủ 4 ⇒ **R5 đóng**: app (chạy bằng `avi_app`) đọc/ghi được bảng mới.

### 6.4 · ⚠ `0315` **CHƯA ĐƯỢC TẠO THÀNH FILE** — có chủ ý

`npm run db:push` áp **mọi** file mới trong `drizzle/`. Đặt sẵn `0315_users_drop_secret_columns.sql`
là dựng một cái bẫy chờ lượt `db:push` kế tiếp — và câu nó chạy là câu **NGỪNG DỊCH VỤ** nếu build
cũ còn sống. Nguyên văn 0315 giữ ở **§3.2**; nó chỉ được ghi thành file ở lượt sau, khi ba điều kiện
vào của §3.2 đã đủ.

---

## 7 · BƯỚC 5 — CÀI MÃ — ✅ **XONG**

### 7.1 · ★★★ MỘT SAI LỆCH CÓ CHỦ Ý so với "Nhắc cho lượt sau" #4 — **nói ra, không làm lặng**

Mục #4 của §4 viết: *"**CHỈ SAU 0315** mới bỏ hai cột khỏi `users` trong drizzle"*. **Lượt này bỏ
NGAY**, và đây là lý do:

> Giữ hai cột trong lược đồ drizzle nghĩa là **mọi** `.select().from(users)` vẫn liệt kê chúng ⇒
> **8 hàm** đọc nguyên hàng — trong đó `getUserById`, thứ `sdk.authenticateRequest` gọi **mỗi
> request đã xác thực** — **vẫn kéo `passwordHash` + hạt giống TOTP vào bộ nhớ tiến trình**.
> ⇒ 9c sẽ **không đổi gì đo được** cho tới lượt deploy *sau* 0315. Nợ nằm im, và lớp R1 nằm im
> **cùng nó** — chờ nổ ở một lượt mà không ai còn nhớ vì sao.

Câu ngay sau mục #4 đã nói điều làm việc này an toàn, và nó vẫn đúng:
*"Bỏ trong drizzle **trước** khi bỏ trong DB thì không sao (drizzle chỉ thôi liệt kê); bỏ trong DB
**trước** khi bỏ trong drizzle thì `42703`."*

**Hệ quả đã tính, không phải bất ngờ:** từ lượt deploy này, `users."passwordHash"` và
`users.two_factor_secret` **HOÁ CŨ** — mã mới không đọc, không ghi chúng nữa. Đó chính là con số
`lech` mà lưới chặn của 0315 in ra dưới dạng `NOTICE` (§3.2), và là lý do câu ấy **cố ý không phải**
`EXCEPTION`. ⚠ Hệ quả thứ hai: hoàn nguyên **mã** về build cũ sau lượt này sẽ đọc bí mật **CŨ** —
đường hoàn tác đúng là §3.6, không phải "checkout rồi chạy".

### 7.2 · Bảng thay đổi

| tệp | đổi gì |
|---|---|
| `drizzle/schema/auth.ts` | `users` **bỏ** `passwordHash`/`twoFactorSecret`, **thêm** `passwordChangedAt`/`passwordInvalidBefore`; `backupCodes.code` **20 → 255**, **bỏ** `idx_backup_codes_code`; **thêm** bảng `userSecrets` (FK `ON DELETE CASCADE`) |
| `server/db/auth.ts` | **CỬA DUY NHẤT** tới bí mật: `layBiMatNguoiDung` · `ghiBiMatNguoiDung` · `layMocMatKhau` · `phaiDoiMatKhau`. `createLocalUser`/`createUser`/`updateUserPassword`/`disable2FA` chạy trong **MỘT giao dịch**; `get2FAStatus` thành `LEFT JOIN` |
| `server/_core/publicUser.ts` | phân loại hai mốc `"server-only"`; **neo R1**: `moiCotBiMatCuaUserSecrets()` (phần bù, suy ra); vị từ `suyRaPhaiDoiMatKhau()`; kiểu `MeUser` |
| `server/routers.ts` | `auth.me` trả `PublicUser` **+ ô SUY RA** `mustChangePassword`, đọc **DB MỚI** |
| `server/_core/authService.ts` · `server/_core/index.ts` | hash đọc từ `user_secrets`; lượt đọc chạy **VÔ ĐIỀU KIỆN** (giữ bản vá side-channel F9) |
| `server/_core/trpc.ts` · `server/routers/twoFactorRouter.ts` · `server/routers/userRouters.ts` | thôi tự truy vấn bí mật; gọi lại **người đọc/ghi duy nhất** (`get2FAStatus`/`setup2FA`/`disable2FA`/`layBiMatNguoiDung`). Riêng `twoFactorRouter` bỏ **5** bản sao của cùng một câu `select({twoFactorSecret})` |
| `scripts/xoay-bi-mat-2fa.mjs` | **R2** — đọc/ghi `user_secrets`, đặt `passwordInvalidBefore = now()`, **CỔNG NGUỒN** chạy trước mọi thứ (kể cả lượt khô), file thành **vừa kịch bản vừa module** |
| `scripts/print-otp.mjs` · `seed-test-data.mjs` · `audit/audit-account.mjs` | cùng lớp R2 — trỏ `user_secrets` |

⚠ **KHÔNG viết bộ suy thứ N+1**: vị từ *"phải đổi mật khẩu"* có **một** chủ (`publicUser.ts`), và
`server/db/auth.ts` **gọi lại** nó thay vì chép câu SQL tương đương.

### 7.3 · R1 đã ĐÓNG — không chỉ khai

Phép đếm §2.5 dự báo: bỏ hai cột ⇒ `SERVER_ONLY_USER_FIELDS` rỗng ⇒ cổng kiểu `PublicUser` thành
`{}` ⇒ **trang trí**; và lượt sửa hiển nhiên (xoá 4 dòng `publicUser.test.ts:76-79`) làm **mọi thứ
xanh với danh sách rỗng**. Bản vá **không** xoá bốn dòng ấy — nó **đảo lượng từ**, trên **hai bảng**:

| ô | luật | cầu chì |
|---|---|---|
| **R1 (a)** | ∀ cột bí mật của **`user_secrets`** ⇒ KHÔNG ra được qua `toPublicUser()` | — |
| **R1 (c)** | — | tập bí mật của `user_secrets` **KHÁC RỖNG** ⇒ rỗng là **ĐỎ** |
| **QĐ-1 (b)** | ∀ cột `users` có tên chứa `password` ⇒ **phải** `"server-only"` | tập `password*` khác rỗng · `SERVER_ONLY_USER_FIELDS` khác rỗng |

*"Cột bí mật của `user_secrets`"* là **phần bù** của hai cột hạ tầng (`userId`, `updatedAt`), nên
một cột **thứ ba** thêm vào bảng ấy ngày mai **mặc định là bí mật** và tự vào lượng từ.
Ba lưới cùng lớp trong các file khác (`authSessionCache.test.ts` · `sdk.authCache.test.ts` ·
`publicUser.test.ts §3`) cũng đã **đổi từ hai TÊN sang tập SUY RA**, mỗi chỗ kèm cầu chì rỗng.

### 7.4 · R2 đã ĐÓNG — và cổng chạy **trước cả lượt khô**

`loiCuaNguonBiMat()` từ chối khi (1) `user_secrets` không tồn tại, hoặc (2) còn tài khoản mang bí
mật ở cột cũ mà **thiếu** hàng ở bảng nguồn. Nó chạy **trước** cả lượt khô — một lượt khô đọc nhầm
bảng sẽ in ra một **bản kế hoạch SAI**, và người đọc sẽ duyệt nó. Lượt hoàn tác cũng qua cổng ấy, và
thêm một phép so *"ảnh chụp lấy từ nguồn nào"*.

Đo được (chạy tay, không phải suy):

```
$ node scripts/xoay-bi-mat-2fa.mjs --db=…/postgres          # DB KHONG co user_secrets
DỪNG: không thấy bảng `user_secrets` trong DB này. …        EXIT=3
$ node scripts/xoay-bi-mat-2fa.mjs --db=…/aoi_management_test
Nguồn bí mật đang dùng: `user_secrets`  (đã kiểm, không giả định)   EXIT=0
```

### 7.5 · Lưới mới + cổng

**3 file mới**, tất cả tự khai `Pha 5` và **đều có đường riêng** ở §Cổng kiểm chung
(`docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md`) — `CONG` **22 → 25**, `FILE_CANH` **83 → 86**:

| file | trục |
|---|---|
| `server/_core/backupCodeWidth.test.ts` | **9a** — ∀ giá trị `bamMaDuPhong()` sinh ra vừa bề rộng khai; **cả hai vế SUY RA**, không viết tay 60 cũng không viết tay 255. Cộng một ô **ghi THẬT xuống DB** (drizzle khai 255 mà DB còn 20 thì `tsc` vẫn xanh) |
| `server/_core/xoayBiMatNguon.test.ts` | **R2** — vị từ + **hành vi đầu-cuối** (chạy chính script như tiến trình con) + ∀ SQL thô trong `scripts/**` |
| `server/routers/mustChangePassword.test.ts` | **QĐ-1** — bảng chân trị của vị từ · `user.list` sạch · `auth.me` có ô suy ra · **§4: ô suy ra KHÔNG đến từ `ctx.user`** |

---

## 8 · BƯỚC 6 — ĐỐI CHỨNG DƯƠNG **TRÊN HỆ THẬT** — ✅ **ĐẠT**

### 8.1 · Redeploy (nói rõ, theo yêu cầu)

```
npm run build            => dist/index.js 10.2 MB · worker 4.6 MB · edgeGateway 3.6 MB
Stop-Process -Id 36072   => CHI SAU khi Win32_Process.CommandLine khop NGUYEN VAN 'node dist/index.js'
                            (khop long da tung giet nham 12 sidecar MCP — 12 tien trinh playwright
                             KHONG bi dung, da kiem lai sau khi tat)
node scripts/__tmp-task9-dongbo.mjs   => CUA SO TROI §3.5, chay khi may chu DA TAT:
        aoi_management      : lech TRUOC=0 · hang cham=8 · lech SAU=0 · thieu=0
        aoi_management_test : lech TRUOC=1 · hang cham=1 · lech SAU=0 · thieu=0
khoi dong lai            => PID 4468 (`node dist/index.js`), "Server running on http://localhost:3000/"
```

⚠ `lệch TRƯỚC=1` trên DB **test** là một lượt ghi của chính bộ test giữa hai thời điểm — đúng thứ
"cửa sổ trôi" mô tả, và là lý do câu đồng bộ lại tồn tại. Trên DB **thật** lệch = 0.

### 8.2 · Kết quả (nguyên văn)

```
✔ POST /api/auth/login => 200   {"requires2FA":true,"userId":51,…}
✔ máy chủ đòi bước 2FA (requires2FA)
✔ POST /api/auth/verify-2fa => 200   {"id":51,"name":"Anh Minh (Kỹ sư TĐH)","role":"engineer"}
✔ đã nhận cookie phiên  — cookie: pending_2fa, app_session_id
auth.me => 200
{"id":51,"openId":"seed-engineer1","username":"engineer1","name":"Anh Minh (Kỹ sư TĐH)","email":null,
 "phone":null,"department":null,"position":null,"loginMethod":"password","role":"engineer",
 "isActive":true,"twoFactorEnabled":true,"loginAttempts":0,"lockedUntil":null,
 "createdAt":"2026-07-10T22:40:57.616Z","updatedAt":"2026-07-10T22:40:57.616Z",
 "lastSignedIn":"2026-08-09T02:12:28.079Z","mustChangePassword":false}
✔ auth.me KHÔNG có `passwordHash`
✔ auth.me KHÔNG có `twoFactorSecret`
✔ auth.me KHÔNG có `passwordChangedAt`/`passwordInvalidBefore`
✔ auth.me CÓ ô suy ra `mustChangePassword`  — giá trị = false
```

⇒ **Task 7 KHÔNG hồi quy** · **9c không làm hỏng đăng nhập/2FA** · **QĐ-1 phơi đúng một ô SUY RA**.

---

## 9 · BƯỚC 8 — ★★★ NGHIỆM THU SỐNG (CỔNG CHẶN của Task 10) — ✅ **ĐẠT**

Tài khoản **`engineer1` (id 51)** trên hệ thật, ảnh chụp hoàn tác ghi trước khi chạm:
`twoFactorSecret` cũ = `O5BSUJKJLVADUOKOFR3SS23WJ4XWGXKG`.

```
   … chờ 3s cho cửa sổ TOTP mới (sổ chống phát lại đang làm đúng việc)
✔ twoFactor.disable => 200
✔ twoFactor.generateSecret => 200
✔ secret MỚI đã được ghi vào `user_secrets` (KHÔNG phải cột cũ trên `users`) — db=MF3X22ZVK5… api=MF3X22ZVK5…
✔ cột CŨ `users.two_factor_secret` KHÔNG đổi (nó đã chết, 0315 sẽ bỏ)
   … chờ 30s cho cửa sổ TOTP mới
✔ twoFactor.enable => 200
✔ ★★★ NHẬN ĐƯỢC MÃ DỰ PHÒNG  — 10 mã: AF604161 E7D9DE6B E21ED1D3 …
✔ ★★★ 10 hàng THẬT trong `backup_codes` (trước 0314: 0 hàng vì 22001) — độ dài hash = 60
✔ mọi hàng là hash bcrypt (không plaintext)
✔ ★★★ mã dự phòng ĐẦU TIÊN xác minh ĐƯỢC (đường vào lại có thật)
✔ mã đã dùng bị đánh dấu (còn 9)
   … chờ 29s cho cửa sổ TOTP mới
✔ login+verify-2fa với secret MỚI => 200/200
```

**★★★ CÂU TRẢ LỜI CHO CỔNG CHẶN: CÓ — một tài khoản đăng ký lại 2FA trên hệ thật và NHẬN ĐƯỢC 10 mã
dự phòng; hash dài 60 nằm THẬT trong bảng; một mã đã được dùng để xác minh THÀNH CÔNG.**
Trước lượt này, `backup_codes` có **0 hàng** cho **8/8** tài khoản bật 2FA. Nay `engineer1` có **10**.

### 9.1 · ★ Hai điều lượt nghiệm thu này dạy, mà lưới không dạy được

1. **Lượt chạy ĐẦU của kịch bản THẤT BẠI ở `twoFactor.disable` (400 "Invalid code") — và đó là hệ
   thống ĐANG ĐÚNG.** Kịch bản tái dùng mã OTP của bước `verify-2fa` ngay trước đó; sổ
   `totp_consumed` (Pha 7 Task 5) đã **TIÊU** nó. Phải chờ **cửa sổ 30 s mới**, đúng như một người
   thật nhìn app authenticator đổi số. ⚠ Nếu tôi "sửa" bằng cách nới sổ, tôi đã phá Task 5 để làm
   xanh Task 9 — đúng lớp *"trả nợ đẻ nợ nặng hơn"*.
2. **`cột CŨ users.two_factor_secret KHÔNG đổi`** — bằng chứng ĐO ĐƯỢC rằng mã mới thật sự thôi ghi
   cột cũ, và vì thế **điều kiện vào của Task 10 phải kèm bản script đã sửa** (R2): script cũ sẽ
   `UPDATE` đúng cái cột vừa được chứng minh là đã chết.

### 9.2 · Trạng thái dữ liệu sau lượt nghiệm thu (khai đủ, không giấu)

| tài khoản | đổi gì | hoàn tác |
|---|---|---|
| `engineer1` (51) | `twoFactorSecret` **mới** (`MF3X22ZVK5…`) · 10 mã dự phòng mới, **1 đã dùng** · phiên cũ vẫn nguyên | secret cũ ghi ở §9 trên; `node scripts/print-otp.mjs engineer1` vẫn in OTP đúng từ DB ⇒ **không ai bị khoá ra ngoài** |
| 7 tài khoản còn lại | **không đụng** | — |

⚠ **KHÔNG chạy script xoay. KHÔNG áp 0315. KHÔNG xoá dữ liệu người dùng nào.**

---

## 10 · BƯỚC 7 — ĐỘT BIẾN — ✅ **XONG (7 lượt · và MỘT lượt bắt được lưới giả)**

Quy trình: **commit trước** (`74d927c0`), đột biến **theo DÒNG**, khôi phục bằng
`git checkout HEAD -- <file>`, chạy lại **toàn bộ** lưới liên quan sau mỗi lượt.

| # | đột biến (một dòng) | ca ĐỎ — **tên nguyên văn** |
|---|---|---|
| **1** | `drizzle/schema/auth.ts` — `backupCodes.code` `varchar(255)` → **`varchar(20)`** | `★★★ Task 9 §1 (9a) — ∀ mã đã băm phải VỪA bề rộng khai của backup_codes.code › ★★★ ∀ — 32 lượt băm THẬT đều vừa bề rộng khai (không viết tay 60, không viết tay 255)` — *"hash dài 60 ký tự > bề rộng khai varchar(20)"* |
| **2** | `publicUser.ts` — `passwordInvalidBefore: "server-only"` → **`"public"`** | **BỐN** ca, **HAI** file: `★★★ QĐ-1 (b) — ∀ cột users mang chữ "password" phải là server-only` · `★★★ cả hai mốc được phân loại server-only (đây là rủi ro QĐ-1, đóng theo cấu tạo)` · `★★★ user.list — hình dạng trả về KHÔNG mang mốc nào…` · `★★★ §3 — auth.me mang ô mustChangePassword…` |
| **3** | `publicUser.ts` — nhét `passwordHash`,`twoFactorSecret` vào `COT_HA_TANG_USER_SECRETS` ⇒ **tập bí mật RỖNG** | `★★★ R1 (c) — CẦU CHÌ: tập cột bí mật của user_secrets KHÁC RỖNG (rỗng ⇒ ô trên là chân lý rỗng)` — *"0 cột bí mật ở `user_secrets` ⇒ luật R1 không canh gì cả"* |
| **4** | `scripts/xoay-bi-mat-2fa.mjs` — **gỡ toàn bộ CỔNG NGUỒN** khỏi `xoay()` | `★★★★ chạy thật script với DB KHÔNG có user_secrets ⇒ mã thoát ≠ 0 và KHÔNG in 'đã xoay'` — ⚠ **xem §10.1: lượt đầu ô này KHÔNG đỏ** |
| **5 (M3)** | **file MỚI** `scripts/__dotbien-m3-ghi-cot-cu.mjs` chứa `UPDATE users SET two_factor_secret = NULL` | `★★★ ∀ — KHÔNG câu SQL nào GHI vào cột bí mật CŨ trên users` — *"một script GHI bí mật vào cột CŨ trên `users`"*. **Đường mới, file mới, không ai khai báo nó ở đâu** ⇒ lưới theo **ĐƯỜNG THOÁT**, không theo FILE |
| **6** | `server/routers.ts` — `auth.me` suy `mustChangePassword` từ **`ctx.user`** thay vì `db.phaiDoiMatKhau` | **HAI** ca: `★★★★ §4 — ô suy ra đọc DB MỚI: ctx.user rỗng hai mốc mà auth.me VẪN nói PHẢI ĐỔI` · `★★★ ĐỐI CHỨNG DƯƠNG — người dùng đổi mật khẩu ⇒ vị từ TỰ tắt` |
| **7** | `server/db/auth.ts` — `updateUserPassword` **bỏ** câu ghi `passwordChangedAt` | `★★★ ĐỐI CHỨNG DƯƠNG — người dùng đổi mật khẩu ⇒ vị từ TỰ tắt (không ai phải nhớ xoá cờ)` — *"đổi mật khẩu xong mà vẫn bị buộc đổi"* |

**KHÔNG BẮT NHẦM** — sau khi khôi phục cả bảy: §Cổng kiểm chung **25 đường** ⇒ **2.068/2.069**
(một ca đỏ **duy nhất** là flake hạ tầng, xem §10.2) · `npm run check` **0 lỗi** ·
`npm run check:tests` **0 lỗi** · `npm run i18n:check` **0 vi phạm mới** · một lượt
`--sequence.shuffle.tests` trên 6 lưới liên quan ⇒ **53/53**.

### 10.1 · ★★★ ĐỘT BIẾN 4 KHÔNG ĐỎ Ở LƯỢT ĐẦU — và **hai** thứ đứng sau nó

**(a) Lưới XANH VÌ LÝ DO SAI.** Gỡ **toàn bộ** cổng nguồn mà ô §2 vẫn **8/8 XANH**. Nguyên do: câu
truy vấn ngay sau đó (`aiBiAnhHuong`) **tự nổ** với `relation "user_secrets" does not exist` ⇒ mã
thoát **1**, và chuỗi ngoại lệ ấy **cũng chứa `user_secrets`** ⇒ **cả hai** khẳng định cũ
(`≠ 0` và `toContain(BANG_NGUON_BI_MAT)`) đúng, trong khi **thứ chúng được dựng ra để canh đã bị
xoá**.

> ⇒ *"script THẤT BẠI"* **không** đồng nghĩa *"CỔNG đã từ chối"*. Vị từ phải phân biệt hai điều ấy.
> Bản vá: ghim **mã thoát 3** (do cổng đặt; một ngoại lệ chưa bắt cho **1**) **và** câu **`DỪNG:`**
> (do cổng in; thông điệp của postgres không có). Đột biến 4 chạy lại ⇒ **ĐỎ**, với đúng câu
> *"1 ⇒ một truy vấn NỔ, KHÔNG phải cổng từ chối ⇒ cổng đã bị gỡ (đột biến 4)"*.

**(b) ★★ LỚP LỖI Ở TẦNG CÔNG CỤ: vitest KHÔNG NẠP NỔI một `.mjs` có SHEBANG — và lượt đầu vẫn XANH
nhờ CACHE.** Khi khôi phục đột biến 4, lưới bỗng đổ với `SyntaxError: Invalid or unexpected token`
**tại điểm import**, trỏ vào… dòng 7 của **file test** (một dòng kẻ khung trong khối chú thích).
Chuỗi phép đo, có đối chứng hai chiều:

| phép đo | kết quả |
|---|---|
| `node --check scripts/xoay-bi-mat-2fa.mjs` | **OK** |
| `import()` bằng Node thuần | **OK** — in ra `user_secrets` |
| `npx esbuild` trên chính file test | **OK** |
| quét byte: BOM · CR đơn lẻ · UTF-8 hợp lệ | sạch (**0** CR đơn lẻ) |
| lưới tối giản chỉ có đúng một câu `import` từ `.mjs` ấy | **ĐỔ** — cùng lỗi, cột trỏ đúng chuỗi đường dẫn |
| **bỏ đúng một dòng** `#!/usr/bin/env node` | **XANH ngay** |
| trả lại dòng shebang | **ĐỔ lại** |

⇒ Nguyên nhân là **shebang**, và điều làm nó nguy hiểm là **nó không đỏ ngay**: những lượt chạy đầu
XANH nhờ bản dịch còn trong cache của vite. Một lưới *"xanh vì một lý do không liên quan tới thứ nó
canh"*, ở **tầng công cụ** — cùng họ với `Glob không khớp file nào ⇒ vitest IM LẶNG` (Pha 4) và
`đổi tên `.unit.test.ts` ⇒ 12 ca biến mất mà không con số nào nhúc nhích` (Pha 7 §4.1).

**Bản vá:** luật *"bí mật đang nằm ở bảng nào"* dời sang **`scripts/_lib/nguonBiMat.mjs`** — file
**không shebang**, **một chủ**, và **cả kịch bản lẫn lưới** đều `import` từ đó. Không còn bản sao
nào để trôi, và không còn phụ thuộc vào việc vitest có nạp nổi một kịch bản hay không.
(`scripts/xoay-bi-mat-2fa.d.mts` bị thay bằng `scripts/_lib/nguonBiMat.d.mts`.)

### 10.2 · Nợ CÓ TRƯỚC gặp lại trong lượt này — **khai, không vá**

| mục | trạng thái |
|---|---|
| `server/services/vram/sharedLedgerIdentityCrossProcess.test.ts` — 1 ca `Test timed out in 5000ms` | **flake hạ tầng**: chạy riêng file ⇒ **15/15 XANH** (1.114 ms); chỉ đỏ khi 124 file chạy song song. Không liên quan Task 9 (nó canh sổ chung xuyên tiến trình) |
| `server/api.test.ts › Factory Router › should reject non-admin from creating factory` | **nợ CÓ TRƯỚC**: chờ `'Admin access required'`, nhận `'Bạn không có quyền create cho module …'`. Hai file sinh ra câu ấy (`routers/_shared.ts:207`, `routers/hierarchyRouters.ts:76`) **KHÔNG nằm trong lượt sửa này** (`git diff HEAD` trên chúng = rỗng). File này cũng nằm trong danh sách cách ly của `tsconfig.tests.json` |
| `scripts/seed-admin.mjs` | **kịch bản CHẾT** (dùng `mysql2` + `connection.execute("… ?")` trên một repo Postgres) ⇒ nằm ngoài bộ quét §3 của `xoayBiMatNguon.test.ts`, **có khai trong docstring** |

---

## 11 · TRẠNG THÁI CUỐI — và **ĐIỀU KIỆN VÀO của Task 10**

| bước | trạng thái |
|---|---|
| 1 · ĐO trước | ✅ §1 |
| 2 · ĐẾM bề mặt | ✅ §2 — phép đếm **lật hai lần** (§2.5 R1, §2.6 R2) |
| 3 · SOẠN SQL rồi DỪNG | ✅ §3 |
| 4 · áp `0314` (cả 2 DB, owner `aoi`) | ✅ **§6** — `information_schema` xác nhận cả hai; R10 đo bằng đối chứng |
| 5 · cài mã | ✅ **§7** — QĐ-1 · QĐ-3 · **R1 đóng** · **R2 đóng** |
| 6 · đối chứng dương | ✅ **§8** — trên hệ THẬT sau redeploy |
| 7 · đột biến | ✅ **§10** — 7 lượt, mỗi lượt một ca đỏ có tên; **KHÔNG bắt nhầm** |
| 8 · **nghiệm thu sống** | ✅ **§9 — ĐẠT** |
| 9 · commit | ✅ `74d927c0` + lượt vá sau đột biến |

### 11.1 · ⛔ Điều kiện vào **Task 10** (chạy script xoay) — **BỐN điều, không phải một**

1. **Task 9 Bước 8 ĐẠT** — ✅ `engineer1` đăng ký lại 2FA và **nhận được** 10 mã dự phòng (§9).
2. **Script đã trỏ đúng nguồn** — ✅ R2 (§7.4): `user_secrets`, cổng nguồn chạy **trước cả lượt khô**,
   và có ca chứng minh nó **THẤT BẠI (exit 3) khi trỏ sai bảng** — không im lặng thành công.
3. **Chạy lượt KHÔ trước, dán kết quả** — ⏸ thuộc Task 10.
4. ⚠ **`0315` VẪN CHƯA ÁP, và KHÔNG chặn Task 10.** Sau lượt deploy này, `users."passwordHash"` và
   `users.two_factor_secret` là **cột chết**; xoay bây giờ vẫn **đúng** vì script đọc/ghi
   `user_secrets`. `0315` chỉ là lượt **dọn**.

### 11.2 · Việc CÒN LẠI, xếp theo thứ tự bắt buộc

```
① 0314        ✅ đã áp (cả hai DB)
② deploy mã   ✅ PID 4468 đang chạy bản mới
③ nghiệm thu  ✅ ĐẠT (§9)
④ Task 10 — chạy script xoay (8 tài khoản · 3 admin · thu hồi phiên)   ⏸ CHỜ CHỦ DỰ ÁN
⑤ 0315 (CO) — bỏ 2 cột chết khỏi `users`, cả hai DB, owner `aoi`       ⏸ nguyên văn ở §3.2
```

⚠ **④ và ⑤ đổi chỗ được** (script không còn đọc cột cũ), nhưng **③ phải đứng trước ④** — đó là lý
do cả Task 9 tồn tại.

### 11.3 · Nói rõ những gì lượt này ĐÃ CHẠM trên hệ thật

| | |
|---|---|
| DDL | `0314` trên `aoi_management` **và** `aoi_management_test`, owner `aoi` |
| dữ liệu | 8 hàng `user_secrets` (bản sao) trên DB thật · 5 trên DB test · `engineer1` có secret 2FA **mới** + 10 mã dự phòng (1 đã dùng ở lượt nghiệm thu) |
| tiến trình | máy chủ **PID 36072 → PID 4468** (tắt theo PID, khớp **nguyên văn** `node dist/index.js`; **12 sidecar MCP không bị đụng**) |
| **KHÔNG** làm | không áp `0315` · không chạy script xoay · không xoá dữ liệu người dùng · không cấp quyền · không `kb:sync` · không trainer · không sinh sub-agent |
| script tạm | 6 file `scripts/__tmp-task9-*.mjs` + 1 file đột biến M3 — **đã xoá hết** |
