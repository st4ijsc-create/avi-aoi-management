# Pha 7 · Task 10 — CHẠY SCRIPT XOAY BÍ MẬT 2FA (thao tác phá huỷ trên dữ liệu thật)

- **Ngày:** 2026-08-09
- **Nhánh:** `feat/hmi-dep` · **HEAD lúc bắt đầu:** `29894b12`
- **Kịch bản:** `scripts/xoay-bi-mat-2fa.mjs` (+ `scripts/_lib/nguonBiMat.mjs`)
- **DB đích:** `aoi_management` @ `127.0.0.1:5434` (container `avi-aoi-management-postgres-1`)
- **Máy chủ đang chạy:** PID **4468** = `node dist/index.js` (khởi động 2026-08-09 09:09:45)

> ⚠⚠⚠ Đây là thao tác **phá huỷ trên dữ liệu thật**: xoay ⇒ **8/8 tài khoản mất 2FA**
> (3 trong đó là **`admin`**), **mọi phiên sống bị thu hồi**. Chủ dự án **đã duyệt tường minh**.

---

## Bước 1 — XÁC MINH ĐIỀU KIỆN VÀO + CHỤP TRẠNG THÁI TRƯỚC

### 1.1 Tự kiểm mã kịch bản (KHÔNG tin lời khai) — R2

Ràng buộc **R2** nói bản cũ chạy SQL **thô** `UPDATE users SET two_factor_secret = NULL` ⇒ **báo
thành công mà không xoay gì**. Task 9 khai đã sửa. **Tôi đọc lại mã ở HEAD thay vì tin lời khai:**

```
git show 29894b12:scripts/xoay-bi-mat-2fa.mjs
```

Xác nhận bằng chính văn bản mã — **ba** điểm, không phải một:

| # | Điều phải đúng | Bằng chứng trong mã |
|---|---|---|
| 1 | **Đọc** bí mật từ nguồn sống | `aiBiAnhHuong()`: `LEFT JOIN user_secrets s ON s."userId" = u.id`, `co_secret` = `s."twoFactorSecret" IS NOT NULL` |
| 2 | **Ghi** vào nguồn sống | `UPDATE user_secrets SET "twoFactorSecret" = NULL, "updatedAt" = now() WHERE "userId" = ANY(...)` |
| 3 | **Ảnh chụp** lấy từ nguồn sống | `SELECT u.id, s."twoFactorSecret" AS two_factor_secret … FROM users u LEFT JOIN user_secrets s` + ghi kèm `nguon: BANG_NGUON_BI_MAT` |

Cộng thêm **CỔNG NGUỒN** (`scripts/_lib/nguonBiMat.mjs`) chạy **trước mọi thứ, kể cả lượt khô**:
dừng với **mã thoát 3** nếu bảng `user_secrets` không tồn tại, **hoặc** còn hàng mang bí mật ở cột
cũ trên `users` mà **thiếu** hàng ở `user_secrets`. ⇒ Không còn đường "im lặng thành công".

Câu `UPDATE users …` duy nhất còn lại chạm **`two_factor_enabled`** (cờ công khai) và
**`passwordInvalidBefore`** (mốc thu hồi) — **không** phải cột bí mật. Đúng thiết kế.

### 1.2 Điều kiện vào (1) — lược đồ đã có `0314`

```
 bang_user_secrets | con_cot_cu_tren_users | co_passwordinvalidbefore
-------------------+-----------------------+--------------------------
 user_secrets      | t                     | t
(1 row)
```

### 1.3 Điều kiện vào (2) — build đang chạy đọc `user_secrets`

`dist/index.js` (10.645.199 B, mtime **2026-08-09 09:09**) chứa **2** lượt nhắc `user_secrets`;
PID 4468 khởi động **09:09:45** ⇒ tiến trình đang chạy **chính là** build sau Task 9.

### 1.4 Điều kiện vào (3) — NGHIỆM THU SỐNG của Task 9 Bước 8, tự đo lại

```
 userId | username  | so_ma | len_min | len_max | da_dung |      lan_dung_cuoi
--------+-----------+-------+---------+---------+---------+-------------------------
     51 | engineer1 |    10 |      60 |      60 |       1 | 2026-08-09 02:13:01.962
(1 row)
```

⇒ `engineer1` (id 51): **10** hàng `backup_codes`, hash dài **60** (min = max = 60, không phải
"có một cái dài 60"), **1 mã đã dùng xác minh thành công**. **Đường vào lại THÔNG.**

### 1.5 Kiểm thêm — `passwordInvalidBefore` có KHOÁ đăng nhập không?

Kịch bản đặt `passwordInvalidBefore = now()` cho cả 8 tài khoản. Nếu mốc ấy **chặn** đăng nhập mà
chưa có đường đổi mật khẩu, lượt xoay sẽ khoá 8 người ra ngoài **theo một trục khác** với trục mà
THỨ TỰ BẮT BUỘC đã canh. **Đo:** `passwordInvalidBefore` chỉ được đọc ở **một** đường —
`server/db/auth.ts:110` `phaiDoiMatKhau()` → `server/routers.ts:249` `auth.me.mustChangePassword`.
Đó là **ô suy ra tư vấn**, **không** nằm trên đường xác thực. ⇒ Không chặn đăng nhập. An toàn.

### 1.6 TRẠNG THÁI TRƯỚC (nguyên văn)

```sql
SELECT
  (SELECT COUNT(*)::int FROM users)                                            AS tong_tai_khoan,
  (SELECT COUNT(*)::int FROM user_secrets WHERE "twoFactorSecret" IS NOT NULL) AS co_secret_NGUON_SONG,
  (SELECT COUNT(*)::int FROM users WHERE two_factor_secret IS NOT NULL)        AS co_secret_COT_CU_CHET,
  (SELECT COUNT(*)::int FROM users WHERE two_factor_enabled IS TRUE)           AS bat_2fa,
  (SELECT COUNT(*)::int FROM backup_codes)                                     AS hang_backup_codes,
  (SELECT COUNT(*)::int FROM user_sessions WHERE "isActive")                   AS phien_song,
  (SELECT COUNT(*)::int FROM users WHERE "passwordInvalidBefore" IS NOT NULL)  AS da_co_moc_thu_hoi;
```

```
 tong_tai_khoan | co_secret_nguon_song | co_secret_cot_cu_chet | bat_2fa | hang_backup_codes | phien_song | da_co_moc_thu_hoi
----------------+----------------------+-----------------------+---------+-------------------+------------+-------------------
              8 |                    8 |                     8 |       8 |                10 |        240 |                 0
(1 row)
```

```
  id  |    username    |    role     | secret_song | secret_cot_cu | bat_2fa | so_ma | phien_song
------+----------------+-------------+-------------+---------------+---------+-------+------------
    1 | admin          | admin       | t           | t             | t       |     0 |          8
   48 | operator1      | operator    | t           | t             | t       |     0 |         48
   49 | supervisor1    | supervisor  | t           | t             | t       |     0 |         46
   50 | maint1         | maintenance | t           | t             | t       |     0 |         10
   51 | engineer1      | engineer    | t           | t             | t       |    10 |         28
  167 | audit_agent    | admin       | t           | t             | t       |     0 |          3
 1545 | p1_audit_op    | operator    | t           | t             | t       |     0 |          4
 1546 | p1_audit_admin | admin       | t           | t             | t       |     0 |         89
(8 rows)
```

**Đọc ra:** 8/8 tài khoản của hệ đều bị chạm; **3 `admin`** (id 1, 167, 1546). Số phiên sống là
**240**, không phải 224 như kế hoạch ghi — phiên vẫn sinh thêm từ lúc đếm ở Task 8. Ghi lại con số
**đo được**, không dùng con số trong brief.

⇒ **Điều kiện vào ĐẠT trên cả ba trục.** Đi tiếp Bước 2.

---

## Bước 2 — LƯỢT KHÔ (không động vào dữ liệu)

```
node scripts/xoay-bi-mat-2fa.mjs --db="postgresql://aoi:***@127.0.0.1:5434/aoi_management"
```

```
Nguồn bí mật đang dùng: `user_secrets`  (đã kiểm, không giả định)

=== AI BỊ ẢNH HƯỞNG ===
Tổng tài khoản trong hệ: 8
Tài khoản bị chạm      : 8
  #1 admin [admin] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=8
  #48 operator1 [operator] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=48
  #49 supervisor1 [supervisor] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=46
  #50 maint1 [maintenance] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=10
  #51 engineer1 [engineer] secret=true bật2FA=true mã_dự_phòng=10 phiên_sống=28
  #167 audit_agent [admin] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=3
  #1545 p1_audit_op [operator] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=4
  #1546 p1_audit_admin [admin] secret=true bật2FA=true mã_dự_phòng=0 phiên_sống=89

=== LƯỢT KHÔ — KHÔNG ĐỘNG VÀO DỮ LIỆU ===
Nếu chạy thật, script sẽ:
  1. UPDATE user_secrets SET "twoFactorSecret"=NULL                (8 hàng)
  2. UPDATE users SET two_factor_enabled=false, "passwordInvalidBefore"=now() (8 hàng)
  3. DELETE FROM backup_codes WHERE "userId" IN (…)                     (10 hàng)
  4. UPDATE user_sessions SET "isActive"=false WHERE "userId" IN (…)     (236 hàng)

Thêm --that --toi-hieu-rui-ro --anh=<file> để chạy thật.
EXIT=0
```

### ⚠ MỘT CON SỐ KHÔNG KHỚP — và vì sao nó **KHÔNG** phải chữ ký R2

Lượt khô nói **236** phiên; Bước 1 đếm **240**. Kế hoạch dặn: *"con số không khớp ⇒ DỪNG VÀ HỎI"*.
⇒ **Tôi không đoán, tôi phân rã con số:**

```
 tong_phien_active | phien_active_co_chu | phien_active_userid_null | phien_active_mo_coi
-------------------+---------------------+--------------------------+---------------------
               240 |                 236 |                        0 |                   4
```

**240 = 236 + 4.** Bốn phiên dư là phiên **MỒ CÔI**: `userId` ∈ {301, 302, 1432, 1474} — những
hàng **không còn tồn tại** trong `users`. Câu đếm của tôi ở Bước 1 quét **toàn bảng** phiên; câu
của kịch bản `JOIN users` nên loại chúng ra — **đúng theo thiết kế**, vì kịch bản chỉ xoay bí mật
của tài khoản **đang tồn tại**.

**Chữ ký R2 trông thế nào, để đối chiếu:** nếu kịch bản đọc nhầm bảng thì `secret=` sẽ là `false`
cho **cả 8**, hoặc danh sách sẽ **rỗng**. Ở đây kịch bản khai `secret=true` **8/8** — khớp **chính
xác** `SELECT COUNT(*) FROM user_secrets WHERE "twoFactorSecret" IS NOT NULL` = 8; mã dự phòng
**10 = 10**. Trên **mọi trục đo được từ nguồn sống, con số khớp tuyệt đối**. ⇒ **Không phải R2.**

### 🔎 Phát hiện phụ (NGOÀI phạm vi Task 10 — chỉ báo cáo, KHÔNG đụng)

4 phiên mồ côi ấy **`isActive = true` và chưa hết hạn** (hết hạn **2027-07**), thuộc về những tài
khoản **đã bị xoá**:

```
 id | userId |        expiresAt        | da_het_han |         createdAt
----+--------+-------------------------+------------+----------------------------
  4 |    301 | 2027-07-11 03:27:26.563 | f          | 2026-07-11 03:27:26.564338
  5 |    302 | 2027-07-11 03:27:31.175 | f          | 2026-07-11 03:27:31.176099
 59 |   1432 | 2027-07-18 03:52:33.338 | f          | 2026-07-18 03:52:33.338697
 60 |   1474 | 2027-07-18 04:58:52.277 | f          | 2026-07-18 04:58:52.278907
```

⇒ **Lượt xoay KHÔNG thu hồi 4 phiên này** và chúng còn "sống" tới 2027. Xoá tài khoản **không**
thu hồi phiên của nó ⇒ `user_sessions` **thiếu FK `ON DELETE CASCADE`** (hoặc đường xoá người dùng
không dọn phiên). Đây là **một mục backlog riêng**, không phải việc của Task 10; ràng buộc task
cấm *"xoá dữ liệu người dùng ngoài phạm vi script"* nên **tôi không đụng vào**.

⇒ Lượt khô **ĐẠT**, con số **đã giải thích được đến từng hàng**. Đi tiếp Bước 3.

---

## Bước 3 — CHẠY THẬT

```
node scripts/xoay-bi-mat-2fa.mjs --db=… --that --toi-hieu-rui-ro --anh=<scratchpad>/xoay-2fa-anh.json
```

```
Nguồn bí mật đang dùng: `user_secrets`  (đã kiểm, không giả định)
… (danh sách 8 tài khoản — giống hệt lượt khô) …
Đã ghi ảnh chụp hoàn tác: …/xoay-2fa-anh.json  (nguồn: user_secrets)
✔ Đã xoay 8 tài khoản. MỌI phiên của họ đã bị thu hồi.
⚠ Người dùng phải: đăng nhập lại bằng MẬT KHẨU → ĐỔI MẬT KHẨU (bị buộc) → vào
  Hồ sơ/Bảo mật → BẬT LẠI 2FA (quét QR mới) → LƯU bộ mã dự phòng mới.
  Mã cũ và app authenticator cũ VÔ HIỆU.
EXIT=0
```

⚠ **Dòng `✔ Đã xoay 8 tài khoản` CHÍNH LÀ câu mà R2 cảnh báo có thể là một lời nói dối.**
Nên nó **không** được tính là bằng chứng. Bằng chứng nằm ở Bước 4 và Bước 6.

---

## Bước 4 — TRẠNG THÁI SAU (cùng câu `SELECT` của Bước 1)

```
 tong_tai_khoan | co_secret_nguon_song | co_secret_cot_cu_chet | bat_2fa | hang_backup_codes | phien_song | da_co_moc_thu_hoi
----------------+----------------------+-----------------------+---------+-------------------+------------+-------------------
              8 |                    0 |                     8 |       0 |                 0 |          4 |                 8
(1 row)
```

### Số TRƯỚC / số SAU — không lời khai

| Đại lượng | TRƯỚC | SAU | Ghi chú |
|---|---:|---:|---|
| Bí mật 2FA ở **`user_secrets`** (nguồn **SỐNG**) | **8** | **0** | ★★★ **Đây là ô quyết định.** Nguồn đang dùng đã bị xoay THẬT |
| Bí mật ở **`users.two_factor_secret`** (cột **CHẾT**) | 8 | **8** | **Không đổi — ĐÚNG.** Kịch bản **không** chạm cột chết; `0315` sẽ bỏ nó |
| `two_factor_enabled = true` | 8 | **0** | |
| Hàng `backup_codes` | 10 | **0** | |
| Phiên `isActive` | 240 | **4** | 236 bị thu hồi; **4 còn lại là phiên MỒ CÔI** ngoài phạm vi (xem Bước 2) |
| `passwordInvalidBefore` khác NULL | 0 | **8** | mốc buộc đổi mật khẩu đã đặt cho cả 8 |

```
  id  |    username    |    role     | secret_song | secret_cot_cu | bat_2fa | so_ma | phien_song | moc_thu_hoi
------+----------------+-------------+-------------+---------------+---------+-------+------------+-------------
    1 | admin          | admin       | f           | t             | f       |     0 |          0 | t
   48 | operator1      | operator    | f           | t             | f       |     0 |          0 | t
   49 | supervisor1    | supervisor  | f           | t             | f       |     0 |          0 | t
   50 | maint1         | maintenance | f           | t             | f       |     0 |          0 | t
   51 | engineer1      | engineer    | f           | t             | f       |     0 |          0 | t
  167 | audit_agent    | admin       | f           | t             | f       |     0 |          0 | t
 1545 | p1_audit_op    | operator    | f           | t             | f       |     0 |          0 | t
 1546 | p1_audit_admin | admin       | f           | t             | f       |     0 |          0 | t
(8 rows)
```

### ★★★ Xác nhận: **đổi ĐÚNG nguồn đang dùng**, không phải cột cũ

Hai cột đi **ngược chiều nhau** trong cùng một lượt chạy — `user_secrets` **8 → 0** trong khi
`users.two_factor_secret` **8 → 8**. Nếu kịch bản chạy bản cũ (SQL thô trên `users`), hình dạng sẽ
**đảo lại**: cột cũ về 0, nguồn sống giữ nguyên 8, và 2FA của mọi người **vẫn chạy**. ⇒ Chính cặp
số ngược chiều này là bằng chứng **phân biệt được** hai khả năng, chứ không phải dòng log.

---

## Bước 6 — ẢNH CHỤP HOÀN TÁC CHỤP **BẢN SỐNG** (chữ ký R2 chiều ngược)

```
nguon ghi trong anh : user_secrets
luc                 : 2026-08-09T02:41:28.386Z
so hang anhUser     : 8 | anhMa: 10 | anhPhien: 236
```

Khai `nguon: user_secrets` **chưa đủ** — một chuỗi tự khai thì kịch bản nào cũng viết được. Cần một
**phép phân biệt ĐO ĐƯỢC**. Và có sẵn một cái **hoàn hảo**:

> `engineer1` (id 51) **đăng ký lại 2FA sau khi `0314` áp** (Task 9 Bước 8). Lượt ấy ghi bí mật mới
> vào `user_secrets` **mà KHÔNG ghi cột cũ**. ⇒ Với **riêng id 51**, hai bảng mang **hai giá trị
> KHÁC NHAU** — nên id 51 là **hòn đá thử** phân biệt được ảnh chụp sống với ảnh chụp chết.

| Nguồn | Giá trị cho **id 51** | Dài |
|---|---|---:|
| `users.two_factor_secret` (cột **CHẾT**) | `O5BSUJKJLVAD…` | 32 |
| **Ảnh chụp hoàn tác vừa ghi** | **`MF3X22ZVK5MC…`** | **52** |

⇒ Ảnh chụp mang **`MF3X22ZVK5MC…`**, **khác cả tiền tố lẫn độ dài** so với cột chết. **Đó là giá
trị SỐNG.** Đối chứng độc lập: báo cáo Task 9 §9 ghi bí mật mới của `engineer1` là `MF3X22ZVK5…` và
bí mật cũ là `O5BSUJKJLVADUOKOFR3SS23WJ4XWGXKG` — **khớp chính xác**.

⇒ **✅ Ảnh chụp hoàn tác là BẢN SỐNG.** 7 tài khoản còn lại trùng giá trị ở cả hai bảng (vì `0314`
chép sang và họ chưa đăng ký lại) nên **không** phân biệt được — đúng lý do phải tìm ra id 51.

> ⚠⚠ **Ảnh chụp chứa BÍ MẬT 2FA ĐÃ LỘ ở dạng plaintext.** Nó nằm **ngoài repo**, trong scratchpad
> phiên: `…/scratchpad/xoay-2fa-anh.json`. **KHÔNG commit.** Giữ tới khi chủ dự án xác nhận lượt
> xoay được chấp nhận, rồi **XOÁ**. Còn giữ = còn một bản sao của thứ vừa bỏ công vô hiệu hoá.

---

## Bước 5 — ★★★ NGHIỆM THU SỐNG (đăng ký lại bằng bí mật MỚI + đăng nhập được)

Tài khoản `engineer1` (id 51) trên **hệ thật**, máy chủ PID 4468. Nguyên văn:

```
POST /api/auth/login => 200  {"success":true,"user":{"id":51,…,"role":"engineer"}}
✔ đăng nhập bằng MẬT KHẨU: 200, KHÔNG đòi 2FA (đúng — xoay đã tắt 2FA)
✔ đã nhận cookie phiên (app_session_id)
auth.me => 200  mustChangePassword=true twoFactorEnabled=false
✔ ★ auth.me khai mustChangePassword=true — mốc thu hồi ĂN THẬT
✔ auth.me KHÔNG rò twoFactorSecret (Task 7 không hồi quy)
twoFactor.generateSecret => 200
✔ sinh bí mật MỚI: ME3FWPSPLYRU… (dài 52)
✔ ★ bí mật MỚI KHÁC bí mật trước xoay (MF3X22ZVK5MC…) — lượt xoay có tác dụng thật
✔ ★ bí mật MỚI nằm trong `user_secrets` (nguồn SỐNG), khớp API
✔ cột CŨ `users.two_factor_secret` KHÔNG bị ghi (đã chết, 0315 sẽ bỏ)
   … chờ 27s cho cửa sổ TOTP mới (bật 2FA)
twoFactor.enable => 200
✔ ★★★ BẬT 2FA bằng bí mật MỚI OK — nhận 10 mã dự phòng: 2B6B9D0E 5F806DEF 16317BCF …
✔ ★ 10 hàng THẬT trong backup_codes, hash dài 60 (9a còn sống sau xoay)

[phiên SẠCH] POST /api/auth/login => 200  {"requires2FA":true,"userId":51,…}
✔ máy chủ đòi bước 2FA (requires2FA=true)
   … chờ 29s cho cửa sổ TOTP mới (verify-2fa)
POST /api/auth/verify-2fa => 200  {"success":true,"user":{"id":51,…,"role":"engineer"}}
✔ ★★★ ĐĂNG NHẬP ĐƯỢC bằng bí mật MỚI — 200 + cookie phiên
auth.me (phiên mới) => 200  id=51 2FA=true mustChangePassword=true
✔ ★★★ phiên mới dùng được — vòng đăng ký lại + đăng nhập ĐÓNG KÍN
EXIT=0
```

**⇒ ✅ NGHIỆM THU SỐNG ĐẠT. KHÔNG cần `--hoan-tac`.**

Bốn điều lượt này chứng minh mà bảng số **không** chứng minh được:

1. **Đường vào lại có thật** — mật khẩu vẫn đăng nhập được sau khi mất 2FA. Không ai bị khoá ngoài.
2. **Lượt xoay có tác dụng thật** — bí mật mới `ME3FWPSPLYRU…` **khác** bí mật trước xoay
   `MF3X22ZVK5MC…`. Nếu xoay là giả, `generateSecret` sẽ vẫn trả về bí mật cũ **hoặc** `enable`
   sẽ báo *"2FA is already enabled"* (vì `two_factor_enabled` chưa tắt).
3. **`passwordInvalidBefore` ĂN THẬT** — `mustChangePassword=true` trên `auth.me`, **và** nó
   **không** chặn đăng nhập (đúng như phép đo ở §1.5). Buộc đổi mật khẩu là **tư vấn**, không phải
   **rào**.
4. **9a còn sống sau lượt xoay** — 10 mã dự phòng, hash dài **60**, ghi được vào bảng.
   ⇒ Người thứ 2..8 đi lại đúng con đường này sẽ **không** vấp `22001`.

### Trạng thái CUỐI (sau nghiệm thu sống)

```
  id  |    username    |    role     | secret_song | bat_2fa | so_ma | phien_song | moc_thu_hoi
------+----------------+-------------+-------------+---------+-------+------------+-------------
    1 | admin          | admin       | f           | f       |     0 |          0 | t
   48 | operator1      | operator    | f           | f       |     0 |          0 | t
   49 | supervisor1    | supervisor  | f           | f       |     0 |          0 | t
   50 | maint1         | maintenance | f           | f       |     0 |          0 | t
   51 | engineer1      | engineer    | t           | t       |    10 |          2 | t
  167 | audit_agent    | admin       | f           | f       |     0 |          0 | t
 1545 | p1_audit_op    | operator    | f           | f       |     0 |          0 | t
 1546 | p1_audit_admin | admin       | f           | f       |     0 |          0 | t
```

⇒ `engineer1` đã **vào lại trọn vẹn**. **7 tài khoản còn lại** đang chờ chủ của chúng làm cùng
việc ấy.

---

## AI BỊ ẢNH HƯỞNG — và họ phải làm gì để vào lại

**8/8 tài khoản**, trong đó **3 `admin`** (`admin` id 1 · `audit_agent` id 167 · `p1_audit_admin`
id 1546). Mỗi người:

1. **Đăng nhập bằng MẬT KHẨU** (mật khẩu **KHÔNG đổi**, vẫn dùng được). Hệ **sẽ không** hỏi 2FA nữa
   — 2FA đã bị tắt trong lượt xoay.
2. **Đổi mật khẩu** — `auth.me` khai `mustChangePassword=true`. ⚠ Đây là **tư vấn, không phải rào**:
   hệ **không** chặn ai bỏ qua bước này. Nếu muốn nó thành rào thì cần một task riêng.
3. Vào **Hồ sơ / Bảo mật → BẬT LẠI 2FA**, quét **QR mới**, **LƯU bộ 10 mã dự phòng** hiện ra
   **một lần duy nhất**.
4. **App authenticator cũ và mọi mã dự phòng cũ đã VÔ HIỆU** — xoá mục cũ khỏi app.

⚠ **Mọi phiên đăng nhập đều đã bị thu hồi** (236 phiên) — mọi thiết bị đều rơi ra màn hình đăng nhập.

⚠ **Rủi ro vận hành còn lại:** cả **3 `admin`** đều mất 2FA cùng lúc. Đường vào lại là **mật khẩu**
— đã nghiệm thu sống là thông. Nếu một `admin` **không nhớ mật khẩu**, đường cứu là
`--hoan-tac=<ảnh chụp>` (còn dùng được **chừng nào ảnh chụp chưa bị xoá**).

---

## Ràng buộc — tự kiểm

| Ràng buộc | Trạng thái |
|---|---|
| **KHÔNG áp `0315`** | ✅ không chạy. Cột cũ `users.two_factor_secret` vẫn còn (SAU = 8) |
| **KHÔNG xoá dữ liệu ngoài phạm vi script** | ✅ 4 phiên mồ côi **phát hiện nhưng KHÔNG đụng** |
| **KHÔNG restart máy chủ** | ✅ PID **4468** chạy suốt, không tắt tiến trình nào |
| **KHÔNG DDL · KHÔNG cấp quyền · KHÔNG `kb:sync` · KHÔNG trainer** | ✅ |
| **KHÔNG `git add -A`** (243+ mục bẩn) | ✅ chỉ `git add` **một** file báo cáo |
| **Script tạm xoá sau** | ✅ `scripts/__tmp-task10-nghiemthu.mjs` đã xoá |
| **KHÔNG tự sinh sub-agent** | ✅ |

---

## Việc còn lại (KHÔNG làm trong task này)

1. **`0315`** bỏ `users.passwordHash` + `users.two_factor_secret`. ⚠ Cột chết đang giữ **8 bí mật
   ĐÃ LỘ** — nay vô hại vì **không mã nào đọc nó**, nhưng nó là **dữ liệu tồn dư của một lượt rò**.
2. **XOÁ ảnh chụp hoàn tác** sau khi chủ dự án chấp nhận lượt xoay (chứa bí mật plaintext).
3. **4 phiên mồ côi** `isActive` tới **2027** của tài khoản **đã xoá** — `user_sessions` thiếu
   `ON DELETE CASCADE` (hoặc đường xoá người dùng không dọn phiên). **Mục backlog mới.**
4. **`mustChangePassword` chưa được cưỡng chế** — chỉ là ô tư vấn trên `auth.me`.
