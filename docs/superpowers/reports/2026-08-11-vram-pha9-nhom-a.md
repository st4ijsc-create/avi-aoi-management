# Pha 9 — Nhóm A (nợ AN NINH): báo cáo thực thi

**Nhánh** `feat/hmi-dep` · **từ** `2ce5bbc2` → **HEAD** `f644e104` (9 commit)
**Ngày** 2026-08-12 · Sáu mục đã làm hết, mỗi mục một commit.

---

## 0. Bảng tổng — 6 mục

| Mục | Kết luận | Hash | Đột biến ⇒ tên ca ĐỎ |
|---|---|---|---|
| **A2** cache đi trước sổ ⇒ cửa sổ 45 s | **ĐÃ VÁ** (có đo tải trước/sau) | `504ad10b` + `e0e6791a` | 6 ca — xem §1 |
| **A6** bề mặt trả 500 thay 401 | **ĐÃ VÁ** — brief khai 2, **đo được 6** | `12ef8417` | 3 ca — xem §2 |
| **A4** `verify2FA` cấp 0 mã dự phòng | **ĐÃ VÁ cả hai nửa** (máy chủ + client) | `77daf15b` | 3 ca — xem §3 |
| **A5** hai người gọi cho một luật | **ĐÃ VÁ** — nhưng **đề bài sai**, xem §4 | `e72f1c5e` + `506721cf` | 3 ca (hình dạng) + 4 ca (hành vi) |
| **A3** SQL thô mù với cả hai lưới | **ĐÃ VÁ** | `5dd140cb` | 3 ca — xem §5 |
| **A1** 11 bề mặt chưa có lưới hành vi | **ĐÃ VÁ** | `cfc9be79` (+`12ef8417`) | 1 ca — xem §6 |

**Commit thứ 9** (`f644e104`) là **nợ do chính nhóm A đẻ ra**, trả trong cùng lượt — xem §7.

**Cổng ra:** `npm run check` · `check:tests` · `i18n:check` **sạch**.
Cổng kiểm chung **151/152 file · 2393/2394 test XANH**, cả lượt thường **và** lượt
`--sequence.shuffle.tests` (kết quả **giống hệt nhau**). Ca đỏ duy nhất là ca đã biết,
**KHÔNG sửa**: `server/api.test.ts › Factory Router › should reject non-admin`.
Baseline trước khi làm: 148/149 file · 2354/2355 test, cùng một ca đỏ ấy.

`CONG` **48 → 51** · `FILE_CANH` **111 → 114** (đọc từ số thật bằng cách để cổng đỏ, không đoán).
`SO_MIEN_TRU` **15 → 17 → 16**.

---

## 1. A2 — phép tra sổ đứng trước bộ nhớ đệm

### Đo trước (DB test thật, không suy luận)

Nạp cache bằng một lượt xác thực hợp lệ, rồi thu hồi phiên **ngoài đường sản phẩm**:

| Thí nghiệm | Trước vá | Sau vá |
|---|---|---|
| XOÁ hàng `user_sessions` bằng SQL thẳng | **ĐI QUA** ← LỖ | CHẶN `SESSION_NOT_IN_LEDGER` |
| lật `isActive=false` bằng SQL thẳng | **ĐI QUA** ← LỖ | CHẶN `Session has been revoked` |
| *(hiệu chuẩn)* cùng thí nghiệm với `AUTH_CACHE_TTL_S=0` | CHẶN | CHẶN |

Ô hiệu chuẩn là thứ chứng minh **cơ chế cưỡng chế có thật và đang sống**, và thứ cho qua
đúng là **bộ nhớ đệm** — không phải một thước hỏng.

### Số đo tải trước/sau (yêu cầu của brief)

2.000 lượt `authenticateRequest` **trúng cache**, cùng máy, cùng DB, **ba lượt đo mỗi bên**:

| | ms/lượt | lượt/s |
|---|---|---|
| **TRƯỚC** | 1,3516 · 1,3103 · 1,3758 | **~740** |
| **SAU** | 2,3555 · 2,4221 · 2,6302 | **~413** |

**−44% thông lượng.** Cái giá là THẬT và được nói ra.

**Đánh đổi có đáng không — có, và đây là lý do:**
1. Đây là **1 → 2** `SELECT`/lượt, **KHÔNG phải 0 → 1**. Nhánh trúng cache **đã** trả một
   `SELECT` mỗi lượt cho `chanNeuPhaiDoiMatKhau` (cố ý không cache, từ Pha 8 Task 1). Câu
   *"cache loại bỏ lưu lượng DB"* **đã sai từ trước lượt này**.
2. Bộ nhớ đệm vẫn giữ phần đắt nhất: `getUserByOpenId` **và lượt GHI** `upsertUser(lastSignedIn)`
   — 5 lượt → 1 trong cửa sổ TTL. Thứ bị trả lại là đúng **một lượt ĐỌC theo khoá duy nhất**.
3. Tải xác thực thật của một nhà máy cách ngưỡng 413 lượt/s **hai bậc độ lớn**.
4. Cái được mua là bất biến *"thu hồi có hiệu lực NGAY"* — thứ mà một cửa sổ 45 giây làm sai
   **theo chiều MỞ**.

**Phương án thay thế đã cân nhắc và KHÔNG chọn:** "nhịp vô hiệu hoá cache khi có lượt thu hồi".
Nó **không đóng được** đúng lớp lỗi đo được ở đây: hai thí nghiệm trên là thu hồi **ngoài mã**
(SQL thẳng / một tiến trình khác), nên không có sự kiện nào để bắt nhịp. Nó cũng phụ thuộc
`keysByUserId` — một chỉ mục **trong tiến trình**, bị chặn trần ở `MAX_TRACKED_KEYS_PER_USER = 32`
và rỗng ở tiến trình không tự tay thu hồi.

### Bản vá

`chanNeuPhienDaThuHoi` **DỜI LÊN** trước `getCachedAuthUser` trong `sdk.xacThucTho` — **MỘT**
call site. Cố ý **không** chép một lượt gọi thứ hai vào nhánh trúng cache: hai bản sao dưới một
bất biến là lớp lỗi đã đẻ ba Critical, và đúng thứ Pha 7 đo được ở **chính phương thức này**
(*"1/6 lượt rò, 5/6 lượt sạch"*).

`sdk.authCache.test.ts` ghim **3 → 7** lượt DB / 5 request. **Con số xấu đi chính là bản vá**:
nghĩa thật của số 3 cũ là *"phép tra sổ bị cache nuốt trọn một cửa sổ TTL"*.

### Đột biến ⇒ ĐỎ

Bình luận-hoá lượt gọi `chanNeuPhienDaThuHoi(sessionCookie)` (qua Node, theo chỉ số dòng):

- `§2 — HÀNH VI: hàng sổ bị XOÁ ngoài đường sản phẩm › ★★★ xoá hàng user_sessions bằng SQL thẳng ⇒ lượt kế tiếp BỊ CHẶN dù cache còn nóng`
- `§3 — HÀNH VI: hàng sổ bị LẬT CỜ ngoài đường sản phẩm › ★★★ lật isActive=false bằng SQL thẳng ⇒ lượt kế tiếp BỊ CHẶN dù cache còn nóng`
- `§4 — ĐỐI CHỨNG DƯƠNG › ★★ thu hồi MỘT phiên không được đá văng phiên KHÁC của cùng người`
- `§5 — HÌNH DẠNG › ★★★ chanNeuPhienDaThuHoi được gọi ĐÚNG MỘT lần trong sdk.ts (AST)`
- `§5 — HÌNH DẠNG › ★★★ lượt tra sổ đứng TRƯỚC getCachedAuthUser`
- `§6 — ĐỐI CHỨNG ÂM › ★★ với AUTH_CACHE_TTL_S=0 phiên bị xoá cũng bị chặn`

**Đối chứng dương ⇒ XANH:** `§4 ★★★ phiên HỢP LỆ + cache nóng ⇒ vẫn đi qua, nhiều lượt liên tiếp`
(9/9 xanh ở trạng thái không đột biến).

### ⚠ Lượt đột biến bắt được một thước hỏng của chính tôi

Bản đầu của §5 dùng `indexOf`. Đột biến (bình luận-hoá) làm §2/§3/§4/§6 đỏ **đúng thiết kế**,
nhưng **§5 VẪN XANH**: chuỗi cần tìm còn nguyên **trong chính cái bình luận vừa tạo ra lỗ**.
Đúng lớp *"thước hỏng cho ra ĐÚNG CÂU mà mã lành sẽ cho ra"*.
⇒ `e0e6791a` đổi §5 sang đếm `CallExpression` trên AST, và thêm ca cầu chì thứ ba — **chính ca đã
lừa được bản đầu**. Đo lại: cùng đột biến ⇒ **6 ca đỏ** (trước: 4).

---

## 2. A6 — bề mặt trả 500 thay vì 401

**Brief khai 2. Phép đếm thật: 6** (gọi THẬT từng tuyến, không cookie).

```
500 ⇒ POST /api/ai/stream/generate · /chat · /narrative
500 ⇒ POST /api/ai/local-kb/reload · /retrieve · /ask
```

`/api/ai/local-kb/stream` **không** dính (nó đã dùng `.catch(() => null)`).
`observabilityRoutes` ×3 và `exportRouter` **không** dính (`catch` của chúng trả 401).

Gốc rễ đúng như brief mô tả: `sdk.authenticateRequest` **NÉM**, nên nhánh
`if (!user) res.status(401)` viết sẵn là **mã chết**; lượt ném rơi vào `catch` ⇒ 500 **và rò
`err.message` ra ngoài**.

**Bản vá:** chủ duy nhất `server/routes/_xacThucRest.ts::thuXacThucRest(req)` trả `null` thay vì
ném ⇒ nhánh 401 thành mã **SỐNG**. Chủ ấy **không ghim đường dẫn nào** (bài học `xacThucNoiBo` /
I-1). Thân phản hồi **giữ nguyên** hai hợp đồng đang có — gộp thân là đổi hợp đồng API, một quyết
định sản phẩm. `/local-kb/stream` cũng chuyển về chủ này: **7 điểm gọi, một luật**.

Đo lại: **0/12** tuyến trả 5xx.

**Đột biến** (bỏ lớp chuyển NÉM→`null`) ⇒ ĐỎ:
- `§2 › ★★★ ∀ tuyến không-auth-free: mã trạng thái là 401 hoặc 403`
- `§2 › ★★★ ∀ tuyến không-auth-free: KHÔNG tuyến nào để lọt ngoại lệ ra ngoài handler`
- `§3 › ★★★ POST /api/ai/local-kb/retrieve + cookie thật + thân thiếu tham số ⇒ 400 (KHÔNG 401)`

### ⚠ Thiết bị đo nói dối (lần thứ 21)

`res` giả thiếu `.type()` ⇒ `GET /api/observability/metrics` (tuyến **duy nhất** dùng
`res.status(...).type("text/plain").send(...)`) ném `TypeError` **bên trong** handler và bị lưới
xếp là *"để lọt ngoại lệ ⇒ 500"*. **Một phát hiện an ninh hoàn toàn SAI, có đúng hình dạng của
một phát hiện thật.** Đã vá thiết bị, **không** vá sản phẩm.

---

## 3. A4 — `user.verify2FA` cấp 0 mã dự phòng

Xác nhận đúng: tuyến này gọi `enable2FA()` rồi **DỪNG**. Ai bật 2FA qua màn **Hồ sơ** có **0 mã** —
mất điện thoại là mất tài khoản.

**⚠ KHÔNG vá được bằng một dòng ở máy chủ.** `hoTuyenSongSong.test.ts` đã **KHAI đúng lý do** khi
miễn trừ cặp này: `Profile.tsx` không có màn hiện mã, nên *"cấp mã rồi không hiện"* **tệ hơn**
không cấp. ⇒ Bản vá gồm **cả nửa client**.

- **Máy chủ:** `db.quayVongMaDuPhong` — NGƯỜI CẤP DUY NHẤT, thay **HAI bản sao viết tại chỗ** đã có
  (`twoFactor.enable`, `twoFactor.regenerateBackupCodes`); `verify2FA` là người gọi thứ ba.
- **Client:** `Profile.tsx` hiện bộ mã **đúng một lần**, không đóng được khi chưa sao chép, không
  đóng bằng bấm ra ngoài. **0 khoá i18n mới.**

### `SO_MIEN_TRU` — phép đo bác bỏ dự đoán, lần thứ hai liên tiếp

**15 → 17** (kỳ vọng: GIẢM).
- **−1**: `enable ≡ verify2FA` nay **KHỚP THẬT** (chữ ký `[]`) ⇒ rời tập khai;
- **+3**: `verify2FA` nay **chạm `backup_codes`** nên ghép cặp với ba đơn vị nó chưa từng ghép
  (tổng cặp song song **29 → 32**).

⇒ *"Vá cho khớp"* đổi **HÌNH DẠNG** của tập cặp, không chỉ kích thước.

**Đột biến** (thôi cấp mã) ⇒ ĐỎ:
- `§2 › ★★★★ không cặp bất đồng nào nằm ngoài tập KHAI`
- `§2 › ★★★ SỐ cặp bất đồng được GHIM` (`expected 15 to be 17`)
- `§6 › ★★★★ tập KHAI không được rộng hơn tập bất đồng`

### ⚠ Nợ đẻ nợ, đã trả trong cùng commit

Cầu chì của `backupCodeWriteScan.test.ts` **ghim cứng** `server/routers/twoFactorRouter.ts` là
*"đường ghi thật"* ⇒ ĐỎ khi lượt ghi dời sang chủ mới — một màu đỏ nói về **ĐƯỜNG DẪN**, không về
bất biến (lớp lỗi I-1). Nay cầu chì suy từ **ĐĨA**. Sàn **2 → 1** vì kho mã nay chỉ còn **một**
điểm ghi thật — sàn 2 cũ chính là *"số bản sao"*, tức **nó thưởng cho sự trùng lặp**.

---

## 4. A5 — hợp nhất người tiêu mã dự phòng

### ⚠ Phép đo sửa lại đề bài

Brief nói *"hai người gọi cho MỘT luật đối chiếu"* (`verifyBackupCode` vs `khopMaDuPhong`).
**Không đúng hẳn:** luật **đối chiếu** đã có một chủ từ Pha 7 Task 8a, và `db.verifyBackupCode`
gọi đúng chủ ấy — **không có bản sao vị từ nào**.

Thứ **thật sự** bị nhân bản là cả một **THỦ TỤC**: *"đọc mã chưa dùng → tìm mã khớp → ĐÁNH DẤU ĐÃ
DÙNG"*, **ba bản sao**: `db.verifyBackupCode` · `twoFactorRouter.disable` · `twoFactorRouter.verify`.

**Vì sao ba bản sao của lượt TIÊU nguy hơn ba bản sao của lượt SO:** phần dễ trôi không phải phép
so, mà là *"đã khớp thì phải TIÊU"*. Một bản sao quên `isUsed = true` biến mã dự phòng từ
**dùng-một-lần** thành **mật khẩu vĩnh viễn**, và `tsc` không nói gì cả.

Sau vá: `twoFactorRouter.ts` **không còn** nhập `khopMaDuPhong`/`bamMaDuPhong`/`sinhMaDuPhong`.

**Đo được:** cặp `/api/auth/verify-2fa ≡ twoFactor.verify` nay **KHỚP** ⇒ `SO_MIEN_TRU` **17 → 16**;
**NĂM** cặp khác đổi chữ ký (`A+dung:verifyBackupCode` thay chỗ vòng lặp cũ).

### ⚠ Đột biến chỉ ra một vùng mù, và nó được trả ngay (`506721cf`)

Đột biến của A5 (bỏ đúng lượt `UPDATE isUsed`, **giữ** `return true`) làm `hoTuyenSongSong` đỏ
3 ca — nhưng **cả ba đỏ vì HÌNH DẠNG**; **0 ca hành vi** đỏ, `twoFactor.test.ts` xanh.

⇒ Bất biến *"dùng một lần"* — thứ **duy nhất** phân biệt một mã dự phòng với một mật khẩu vĩnh
viễn — trước đó **chỉ được canh bằng một lưới đọc mã**. Một bản vá giữ đúng hình dạng mà sai hiệu
lực (lọc nhầm `where`, transaction bị cuộn lại) **ship được**.

`server/db/tieuMaDuPhong.test.ts` (DB thật, 8 ca) đóng khe ấy. Nghiệm lại bằng **chính đột biến
ấy**: **4 ca hành vi ĐỎ** (trước: 0), gồm
`§2 › ★★★ mã ĐÚNG: lượt thứ nhất true, lượt thứ HAI của CÙNG mã false`.

---

## 5. A3 — SQL thô đọc `user_secrets`

**Đo trước** (ba hình dạng dựng sẵn; đối chứng là hình dạng drizzle tương đương):

| Hình dạng | Điểm |
|---|---|
| drizzle có phép chiếu | **1** |
| ``sql`SELECT "twoFactorSecret" FROM user_secrets …` `` | **0** ← MÙ |
| ``sql`SELECT * FROM user_secrets` `` | **0** ← MÙ |

### ⚠⚠⚠ Phép đo bác bỏ một tiền đề của chính bản vá

Lượt đo đầu dùng `two_factor_secret`/`password_hash` — tức **giả định** quy ước camelCase →
snake_case — và cho 0 điểm; tôi **suýt kết luận bộ dò còn hỏng**. Sự thật của kho mã này:

```ts
pgTable("user_secrets", { twoFactorSecret: varchar("twoFactorSecret", …) })
//        ^ snake_case                      ^ camelCase
```

**BẢNG snake_case, CỘT camelCase.** Một hàm `camelToSnake` viết tay sẽ sinh tên **không tồn tại
trong DB này**, và lưới sẽ **XANH VĨNH VIỄN vì đi tìm thứ không có**.
⇒ `tenSqlCuaBangBiMat()` / `moiTenSqlCotBiMat()` lấy từ `getTableName()` + `.name` của cột.

**Bản vá:** bộ dò nhận literal chữ (chuỗi thường · template · template có nội suy), xếp là điểm đọc
khi chạm **tên bảng** ∧ (**một cột bí mật** ∨ `SELECT *`). Bắt ở tầng **LITERAL**, không ở tầng
`` sql`` `` / `db.execute` — ghim vào một cửa là dựng lại đúng vùng mù vừa vá.
`TenSqlBiMat` là tham số **BẮT BUỘC** ⇒ người gọi thứ ba quên truyền là **lỗi biên dịch**.

**Vùng mù thứ hai, cùng lượt:** tiền lọc `if (!ma.includes("userSecrets")) continue` loại thẳng
file chỉ dùng SQL thô **trước khi bộ dò kịp nhìn** — vùng mù nằm ở **lượt SÀNG**, không ở phép đo.

**Đột biến** (gỡ nhánh SQL thô) ⇒ ĐỎ:
- `§4e › ★★★★ M3 — SQL THÔ trong một FILE CHƯA TỒN TẠI bị BẮT`
- `§4e › ★★★ SELECT * trên bảng bí mật bị bắt`
- `§4e › ★★★ chuỗi THƯỜNG (không phải sql tag) cũng bị bắt`

**Đối chứng dương ⇒ XANH:** `§4e › ★★★★ câu SQL KHÔNG chạm bí mật KHÔNG bị bắt` — `SELECT COUNT(*)`
không bị nhận nhầm (dấu `*` ≠ `SELECT *`), và bảng `user_secrets_backup_2024` không bị nhận nhầm
(vị từ có **biên từ**).

---

## 6. A1 — lưới HÀNH VI cho bề mặt ngoài tRPC

`12ef8417` dựng lưới hành vi (gọi THẬT, đọc mã trạng thái THẬT) — thay cho **suy luận cấu tạo**
*"có `try/catch` ⇒ suy ra là từ chối"*, thứ đã bị phép đo bác bỏ (6 tuyến trả 500).

`cfc9be79` **đảo lượng từ lên chính danh sách registrar**: bản đầu nhập **ba** registrar bằng tay
⇒ mù với registrar **thứ tư** theo cấu tạo. Phép đếm thật trên đĩa: **22** hàm `register…`.

§6 nay: ***∀ registrar TRÊN ĐĨA: hoặc được GỌI THẬT, hoặc được KHAI TÊN ngoài phạm vi kèm lý do.***
- 3 được gọi thật · 4 khai riêng (trục khoá máy/token ký)
- 15 dưới `server/api/v1/` gộp bằng **một luật thư mục** + **SỐ FILE ĐƯỢC GHIM** (một luật thư mục
  không ghim số là tấm vé trắng cho mọi file tương lai đặt vào đó)
- neo hai chiều: mục **ma** ⇒ ĐỎ

§7 thêm hành vi cho `authenticateExportRequest` (không qua registrar nhưng **có** nhánh phiên):
không cookie ⇒ **401** · cookie thật ⇒ **200** + `principal.kind === "session"` + đúng `userId`.

**Đột biến ở FILE MỚI** (registrar thứ 23 `server/routes/__dotBienA1N1.ts`) ⇒ ĐỎ:
`§6 › ★★★★ ∀ registrar: được GỌI THẬT, hoặc được KHAI TÊN là ngoài phạm vi`
(`expected '  · server/routes/__dotBienA1N1.ts' to be ''`) — ca phân biệt *"lưới theo ĐƯỜNG THOÁT"*
với *"lưới theo FILE"*.

⚠ Lượt dựng §6 **tự bắt một mục MA của chính tôi**: tôi khai `exportRouter.ts` là "ngoài phạm vi"
trong khi nó không khai `export function register…`. Neo-hai-chiều bắt ngay.

---

## 7. Nợ do chính nhóm A đẻ ra — đã trả trong cùng lượt (`f644e104`)

**"Task sau KHÔNG phá lưới — nó DỜI CÁI ĐƯỢC CANH ra khỏi tầm phát biểu của lưới."**
Đúng lớp lỗi C-2 của Pha 7, tái diễn **trong chính nhóm A này**.

A6 gộp bảy điểm gọi `authenticateRequest` về `thuXacThucRest`. Bất biến an ninh **mạnh lên**,
nhưng `quetDiemXacThuc.ts` chỉ biết **hai** cái tên ⇒ phép đếm điểm xác thực **13 → 6**, và §3 của
**cả hai** lưới ∀ ĐỎ.

**Màu đỏ ấy nói đúng**: bảy bề mặt REST thật sự nằm ngoài tầm phát biểu của lượng từ. Chúng vẫn
được cưỡng chế, nhưng **lưới không còn nói được điều đó**.

⚠ Nới sàn 12 → 6 là **"nắn LƯỚI cho vừa MÃ"** — đúng thứ §Kỷ luật đo cấm.
⇒ Dạy bộ nhận diện **hình dạng thứ ba**, **GIỮ NGUYÊN** sàn 12. Tổng trở lại **13**.
Kèm `uyQuyenRestDiQuaDiemChung()` — ghim rằng chủ ấy **thật sự uỷ quyền**; không có nó, hình dạng
thứ ba chỉ là một cái tên **được tin theo lời khai**.

---

## 8. Nợ MỚI (chưa làm — cần chủ dự án quyết)

1. **`POST /api/ai/local-kb/feedback` ghi tệp mà KHÔNG xác thực và KHÔNG bị buộc loopback.**
   Được khai auth-free với lý do *"máy-sang-máy trong localhost"* — nhưng **không có cơ chế nào
   cưỡng chế điều kiện localhost ấy**. Đề xuất: thêm `isLoopback` guard (đã có sẵn hàm ở
   `observabilityRoutes.ts`). Cần chủ dự án duyệt vì có thể ảnh hưởng client đang chạy.
2. **Hai `SELECT` của mỗi lượt xác thực gộp được thành một `JOIN`** (`user_sessions` theo token ·
   `users` theo id). Không làm trong lượt này vì gộp là dựng một **chủ thứ ba** cho hai bất biến
   đang có chủ riêng — một quyết định phải nói ra. Sẽ hoàn lại phần lớn −44% của A2.
3. **`hoXacThucScan` (trục cặp tuyến song song) vẫn mù với SQL thô.** A3 chỉ mở lượng từ ở trục
   `user_secrets` (`deployProcedureScan`). Đã ghi vào khối "vùng mù được khai" của
   `hoTuyenSongSong.test.ts`.
4. **`invalidateAuthUser` phụ thuộc `keysByUserId` — chỉ mục TRONG TIẾN TRÌNH**, chặn trần
   `MAX_TRACKED_KEYS_PER_USER = 32`. Người có >32 phiên được cache trong một tiến trình: các khoá
   cũ nhất rơi khỏi chỉ mục và `revokeAllSessions` **không** đuổi được chúng. A2 làm lỗ này **hết
   nguy hiểm** (sổ được tra mỗi lượt) nhưng cơ chế vẫn sai như đã khai.
5. **`cleanupExpiredSessions()` không dọn cache** (`server/db/auth.ts`). Cùng lý do (4): nay vô hại
   nhờ A2, nhưng nó là người thu hồi **duy nhất** không đi qua lượt dọn.

## 9. Ràng buộc đã tuân thủ

- **0** DDL/migration/seed/`kb:sync`/cấp quyền. `drizzle/0319_…DRAFT` **không** đụng tới.
- **0** thay đổi mật khẩu/cờ/vai/quyền. `engineer1` #51 giữ nguyên `vram_control`/`canDelete`.
- **KHÔNG restart máy chủ** — không mục nào cần nghiệm thu sống trên tiến trình đang chạy; mọi
  phép đo chạy trên DB test (`aoi_management_test`). PID 30360 **không bị đụng**.
- **0** sub-agent.
- `git diff --cached --name-only` xác nhận **rỗng** sau mỗi commit; ~245 mục dirty ngoài phạm vi
  **không bị chạm, không bị stage**. Không dùng `git add -A` lần nào.
- Mọi đột biến làm **SAU** commit, qua **Node theo chỉ số dòng**, và **đã hoàn nguyên** (`git checkout`).
