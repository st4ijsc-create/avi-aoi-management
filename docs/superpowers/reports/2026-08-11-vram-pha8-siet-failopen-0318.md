# Pha 8 — SIẾT fail-open · áp mig `0318` · redeploy (2026-08-11)

> Nhánh `feat/hmi-dep` · HEAD vào lượt `4e20a963` · ba việc chủ dự án duyệt 2026-08-11.
> Commit: `da078983` (Việc 1) · `c1e7667b` (Việc 2) · commit này (Việc 3 + báo cáo).
> Máy chủ mới: **PID 24508** (`npm run start` ⇒ `cross-env` PID 33528 ⇒ con `node dist/index.js`).

---

## 0. Tóm tắt một đoạn

Nhánh *"vé không có hàng `user_sessions` ⇒ cho qua"* đã bị **siết thành fail-closed**. Lối siết
mà báo cáo review đề xuất — **một mốc `iat`** — **không dùng được**, và đó là phát hiện đắt nhất
của lượt này: cửa đúc vé **chưa bao giờ gọi `.setIssuedAt()`**, nên vé thật **không mang `iat`**.
Điều kiện đủ để siết mà không dựng nhà tù cũng chỉ lộ ra khi đếm: **5 điểm đúc vé, chỉ 1 ghi sổ** —
bốn điểm còn lại (2× OAuth · SAML · `/api/external/auth/login`) sau lượt siết sẽ cấp ra những cái vé
**chết ngay ở yêu cầu đầu tiên**. Cả bốn đã được vá trong cùng lượt, và một lượng từ mới canh điểm
thứ sáu. `0318` đã áp trên **cả hai** DB bằng bộ chạy chuẩn. `GET /` = **200**.

---

## 1. Việc 1 — SIẾT nhánh fail-open

### 1.1 Đếm THẬT trước khi siết (`aoi_management`, owner `aoi`, cổng 5434)

| phép đếm | số |
|---|---|
| tổng hàng `user_sessions` | **290** (lúc bắt đầu) → 293 (lúc áp 0318) → **296** (sau nghiệm thu) |
| hàng `isActive = true` | **39** |
| …và **chưa hết hạn** | **39** (không hàng nào sống mà quá hạn) |
| `userId` mang hàng sống | **8**: `48`:6 · `49`:4 · `50`:3 · **`51`:22** (id 241–295) · `301`:1 · `302`:1 · `1432`:1 · `1474`:1 |

> ⚠ Lần đo trước ghi *"`userId=51` còn **21** phiên id 241–276"*. Nay là **22**, id 241–**295** —
> chênh lệch là các lượt đăng nhập đã diễn ra giữa hai lần đo, không phải một phép đo sai.
> Trên `aoi_management_test`: 106 hàng / **94** `isActive=true` / 44 `userId`.

### 1.2 «Bao nhiêu vé đang lưu hành mà KHÔNG có hàng?» — **KHÔNG ĐO ĐƯỢC, và vì sao**

Vé là **JWT phi trạng thái** nằm trong trình duyệt/thiết bị của người dùng. Máy chủ **không giữ
danh sách** vé đã cấp — đó chính là toàn bộ lý do lỗ này tồn tại. Không có phép đếm nào cho con số
ấy, chỉ có **chặn trên** và **cận dưới**:

* **Cận dưới ≥ 1, đo được**: `POST /api/external/auth/login` đúc vé mà **không bao giờ** ghi sổ ⇒
  mỗi lượt gọi tuyến ấy từ trước tới nay đã sinh ra đúng một vé như thế. Đo sống trước lượt siết:
  vé C có **0 hàng** sổ, `GET /api/external/health` (Bearer) ⇒ **200**, và dán thẳng vào cookie
  `app_session_id` ⇒ `auth.me` ⇒ **id 51**.
* **Chặn trên không xác định**: mọi vé cấp trước khi `user_sessions` ra đời, cộng mọi lượt ghi sổ
  hỏng (`soPhien_ghiSoLoi_total`, bộ đếm **theo tiến trình**, hiện `0` trên tiến trình mới).

⇒ Trong báo cáo này con số ấy được ghi là **KHÔNG ĐO ĐƯỢC**, chứ không phải `0`.

### 1.3 Lựa chọn: **fail-closed thẳng**. Vì sao KHÔNG dùng mốc `iat`

**Phép đo bác bỏ chính đề xuất.** Giải mã một vé THẬT do máy chủ đang chạy ký:

```
PAYLOAD keys = openId,appId,name,jti,exp        CÓ iat? false
exp = 1817918017 = 2027-08-10T17:13:37Z
```

`sdk.signSession` gọi `.setProtectedHeader()` · `.setJti()` · `.setExpirationTime()` — **không**
`.setIssuedAt()`. Nên vị từ *"tha vé có `iat` cũ hơn mốc M"* **không đánh giá được** trên đúng
những vé cần được tha: với chúng `iat` là `undefined`. Suy ngược `iat = exp − TTL` thì TTL do
`SESSION_TTL_DAYS` **cấu hình được** ⇒ một **trần đoán trên dữ liệu ngoài tầm kiểm soát**, đúng lớp
lỗi mà `0317`/`0318` sinh ra để giết. Ô **§5f** của `thuHoiPhienMoiBeMat.test.ts` ghim phép đo này:
ai thêm `.setIssuedAt()` thì ô ĐỎ — và **đó** mới là lúc bàn lại lối siết theo mốc.

### 1.4 AI CHẾT VÌ NÓ

* **Chết:** mọi vé đang lưu hành **không có hàng sổ** — vé đúc trước khi cơ chế ra đời · vé của một
  lượt ghi sổ hỏng · vé bị xoá hàng · **mọi Bearer token đã cấp qua `/api/external/auth/login`**
  (30 ngày; client thật trong repo: `FactoryAlertSystem`). Họ nhận `403 SESSION_NOT_IN_LEDGER`.
* **Sống:** 39 hàng `isActive=true` của 8 `userId` ở trên — nghiệm thu đo trực tiếp (§4 mục 3).
* **Vé OAuth / SAML cũ:** chết. Nhưng ba đường ấy **chưa cấu hình** (đo: `OAUTH_SERVER_URL` bị
  comment · `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET` **rỗng** · SAML ném
  `SAML_NOT_CONFIGURED`) ⇒ **0 người dùng thật** hôm nay.
* **KHÔNG vĩnh viễn:** ai mất phiên **đăng nhập lại được bình thường** — đo ở §4 mục 3.

### 1.5 Điều kiện đủ để siết mà không dựng nhà tù — **"có vé ⇒ có hàng" ở MỌI cửa đúc**

Phép đếm trước lượt siết (bộ suy AST của `sessionGrantScan.test.ts`): **5** điểm gọi
`createSessionToken`, **1** ghi sổ. Bốn điểm hở, nay đều ghi:

| đường | trước | sau |
|---|---|---|
| `_core/authService.ts` `establishSession` | `ghiSoPhien` ✔ | giữ nguyên |
| `_core/oauth.ts` callback nhà cung cấp | **không ghi** | `ghiSoPhienChoOpenId` |
| `_core/oauth.ts` callback portal | **không ghi** | `ghiSoPhienChoOpenId` |
| `_core/samlProvider.ts` ACS | **không ghi** | `ghiSoPhienChoOpenId` |
| `_core/index.ts` `POST /api/external/auth/login` | **không ghi** | `ghiSoPhien` |

Nếu chỉ siết mà không vá bốn điểm ấy: đăng nhập OAuth/SAML ⇒ 302 về `/` rồi **403 mọi thứ** (nhà tù
im lặng), và **58 tuyến `/api/external/*`** đứt hẳn với client thật.

**Chống "N+1" (đã 18 lần)** — `server/routers/sessionGrantScan.test.ts` **§4**, dùng **LẠI** nguyên
bộ suy của §2/§3 (bài học C-2: hai bộ suy độc lập canh hai nửa một câu thì cái yếu canh nửa nguy
hiểm hơn):

> ***∀ điểm đúc thẻ phiên trong mã sản xuất `server/**`: hàm bao phải chứa ≥1 lượt GHI SỔ*** —
> `ghiSoPhien` · `ghiSoPhienChoOpenId` · `createUserSession` · `establishSession`, đọc **trên CÂY**
> (một CHÚ THÍCH mang đúng tên **không** tính — ca hiệu chuẩn ghim cả hai chiều).

Kèm một đối chứng dương đọc lại **thân** `establishSession` trên cây: nếu nó thôi ghi sổ thì mọi
đường uỷ quyền cho nó cấp ra vé chết — ô ấy ĐỎ, không tin cái tên trong danh sách.

### 1.6 Hai nhánh **KHÔNG** bị siết, có chủ ý

1. **Lỗi TRA CỨU** (DB nấc) vẫn fail-open. *"Không có hàng"* ≠ *"không hỏi được"*; một lượt hỏng
   thoáng qua không được khoá cả nhà máy ra ngoài.
2. **Token RỖNG** vẫn im lặng (§5e). Ở đó không có gì để tra, và `validateExternalAuth` gọi phép
   chặn với một token có thể rỗng ở nhánh `x-master-key`.

### 1.7 Quan sát được

Bộ đếm **THỨ HAI**, tách khỏi bộ đếm cũ, có bề mặt Prometheus:
`soPhien_chanKhongCoHang_total` (`GET /api/observability/metrics`). Hai con số trả lời hai câu khác
nhau: `chanDaThuHoi` = *"cơ chế thu hồi đang chạy đúng"*; `chanKhongCoHang` = **đồng hồ đo cơn đau
của lượt siết** — nó nhích mỗi lần một người bị đá ra.

---

## 2. Việc 2 — áp `0318`

### 2.1 Ba con số để trống trong header (đo rồi dán)

| | `aoi_management` | `aoi_management_test` |
|---|---|---|
| phụ thuộc khung nhìn / rule trên `deviceName` | **0** | **0** |
| chỉ số chạm `deviceName` | **0** | **0** |
| số hàng `user_sessions` | **293** | **107** |

6 chỉ số trên bảng (pkey · `userId` · `isActive` · `expiresAt` · UNIQUE `sessionToken` ·
idx `sessionToken`) — không cái nào chạm `deviceName`. `pg_rules` trên bảng: 0 · 0.

### 2.2 Lượt áp

Bỏ đuôi `.DRAFT` (theo quy ước `0313`–`0317`), áp bằng **bộ chạy thật**
`scripts/migrate-standalone.mjs`, owner `aoi`, `MIGRATE_STRICT=1`, **exit 0** cả hai lượt.
`RAISE NOTICE` của khối `DO` kêu đúng số hàng: *"293 hàng giữ nguyên"* · *"107 hàng giữ nguyên"*.

> ⚠ **Lượt áp được thu hẹp về ĐÚNG `0318`.** Repo còn **6** migration *pending* là **nợ CÓ TRƯỚC**:
> `0057` · `0066` · `0125` · `0234` mang `success=false` từ 2026-07-19; `0308` · `0309` **không có
> hàng sổ nào** (đúng lớp nợ mà `0317` vừa để lại). Brief cấm mọi DDL ngoài `0318`, nên bộ chạy
> THẬT được gọi qua một lớp mỏng **chỉ lọc `readdirSync` của thư mục `drizzle`** — không chép lại
> một dòng nào của `splitStatements`/`simpleHash` (bài học "script tạm sao chép hai hàm ấy").
> Sáu file kia **vẫn là nợ đang mở**.

### 2.3 Xác nhận sau lượt áp (đọc `information_schema` + sổ mig, cast `::text`)

| DB | `deviceName` | `__applied_migrations` | hàng |
|---|---|---|---|
| `aoi_management` | `text`, trần `NULL` | `0318_session_device_name_text.sql` · `applied_at` **2026-08-10 17:33:45 UTC** · `success=true` · checksum `567218ec` | 293 |
| `aoi_management_test` | `text`, trần `NULL` | cùng `filename` · `applied_at` **2026-08-10 17:33:50 UTC** · `success=true` · checksum `567218ec` | 107 |

> `applied_at` là giờ **UTC** của máy chủ DB (giờ máy là UTC+7) — đã cast `::text` để tránh lệch
> 7 giờ của driver `postgres` v3.

### 2.4 Hệ quả — và nó chứng minh chính lý lẽ của C-2

Phép cắt suy trần **từ schema**, nên `deviceName` **tự rời** tập bị cắt: **không một dòng mã sản
xuất nào phải sửa**. Thứ duy nhất đổi là hai ô ghim SỐ của lưới, và khai báo TS cho khớp DB:

* `drizzle/schema/auth.ts` — `varchar("deviceName",{length:255})` → `text("deviceName")`.
* `tranCotSoPhien.test.ts` §1a — `TRAN.deviceName` **255 → `undefined`** (và phải rời tập).
* `tranCotSoPhien.test.ts` §2a — UA 3.770 ký tự nay vào DB **NGUYÊN VĂN** (trước: cắt còn 255);
  cầu chì chuyển sang `TRAN.ipAddress = 45`, cột **CÒN** trần của cùng câu `INSERT`.

### 2.5 `ipAddress` — **`.DRAFT` riêng, KHÔNG áp**

`drizzle/0319_session_ip_address_text.sql.DRAFT`. Phán quyết: **cùng lớp lỗi, NHƯNG CÓ ĐIỀU KIỆN**.

* Hôm nay `req.ip` **không** do header lái — đo được: **không** lời gọi `trust proxy` nào trong
  `server/**`, **không** biến `TRUST_PROXY` trong `.env` ⇒ Express mặc định `false`.
* Nhưng trần 45 an toàn **nhờ một cấu hình không ai ghim**: đặt reverse proxy rồi bật `trust proxy`
  — việc bình thường khi lên sản xuất — là `X-Forwarded-For` **lập tức** lái cột ấy, **không đổi
  một dòng mã**. Đó là lớp lỗi *"an toàn là HỆ QUẢ của thứ khác đang tắt"* (Pha 4).
* **Không gấp**, vì `catTheoTranCot` đã chặn `22001`. Thiệt hại còn lại: **một IP bị cắt cụt vẫn
  trông như một IP hợp lệ** trong sổ điều tra — sai mà trông đúng.
* Đo kèm: dài nhất đang có **16 · 16** ký tự · **0** chỉ số · **0** phụ thuộc · 293 · 107 hàng.
* ⚠ Cột `ipAddress varchar(45)` còn ở **12 bảng khác** (`audit_logs`, `machines`, `mqtt_clients`, …)
  — **nợ ĐƯỢC KHAI**, ngoài phạm vi file đó.

---

## 3. Việc 3 — redeploy, và cửa trước

**Sự cố hôm qua không lặp lại.** Trình tự đã đi:

1. `npm run build` ⇒ **exit 0** (`dist/index.js` 10.2 MB).
2. Xác nhận PID **34072** có `CommandLine -ceq 'node dist/index.js'` ⇒ **True** rồi mới giết.
3. `npm run start` (⇒ `cross-env NODE_ENV=production node dist/index.js`). Tiến trình **con**
   PID **24508** có `CommandLine -ceq 'node dist/index.js'` ⇒ **True** ⇒ ràng buộc giết-theo-PID
   của lượt sau vẫn thoả.
4. **`GET /` ⇒ 200**, thân **369.398** byte, mở đầu `<!doctype html> <html lang="vi">`.

> **Bản vá CÓ TRONG TIẾN TRÌNH — chứng minh bằng HÀNH VI, không bằng `mtime`:** bộ đếm
> `soPhien_chanKhongCoHang_total` **chỉ tồn tại trong bản dựng mới**, và nó xuất hiện ở
> `GET /api/observability/metrics` rồi **nhích 0 → 2** đúng vào hai lượt bị chặn.

### ⚠ Phát hiện ngoài kế hoạch — **một máy chủ THỨ HAI đang chạy trên cổng 3001**

| PID | cha | khởi động | cổng | dựng từ |
|---|---|---|---|---|
| **24508** | 33528 (`cross-env`, `npm run start` của lượt này) | 00:42:48 | **3000** · 8883 · 1883 | **bản mới** |
| **30356** | 29988 (`cross-env`) ← `pnpm start` (PID 29684) | **00:02:54** | **3001** | **bản CŨ (trước siết)** |

Nó khởi động **trước** lượt làm việc này, không giành được cổng 3000 (khi ấy 34072 đang giữ) nên
**tự lùi sang 3001**, và vẫn đang chạy **mã trước lượt siết** trên **cùng một DB**.
⇒ **Cổng 3001 hiện là một bề mặt còn nguyên lỗ fail-open.** Lượt này **KHÔNG giết nó**: brief chỉ
uỷ quyền giết PID 34072, và nó là tiến trình của người khác. **CHỜ CHỦ DỰ ÁN quyết.**

---

## 4. Nghiệm thu sống — số đo

> ⚠ **Hiệu chuẩn thước trước:** `auth.me` trả **HTTP 200 + `json: null`** khi KHÔNG xác thực ⇒
> **mã trạng thái là thước HỎNG** cho tuyến này. Con số đếm được là **`id`**. Ba lượt có đáp số
> biết trước: không cookie ⇒ `id=null` · cookie RÁC ⇒ `id=null` · Bearer trống trên
> `/api/external/health` ⇒ **401**. Cả ba đúng như kỳ vọng trước khi đo bất cứ thứ gì.

| # | mục | số đo | phán quyết |
|---|---|---|---|
| 1 | **`GET /`** | **200**, 369.398 byte | ✅ |
| 2 | **Siết có hiệu lực** | vé B (thật, máy chủ tự ký) sau khi **XOÁ hàng sổ**: `auth.me` ⇒ **`id = null`** *(trước siết: **51**)* · `/api/external/health` Bearer ⇒ **401** *(trước siết: **200**)* · `soPhien_chanKhongCoHang_total` **0 → 2** (đúng 2: một tRPC + một Bearer). Đối chứng dương cùng lượt: vé A (CÓ hàng) ⇒ **`id = 51`** | ✅ |
| 3 | **Không khoá ai** | `engineer1` đăng nhập lại ⇒ **200**, hàng sổ **id 300** được tạo, `auth.me` ⇒ **`id = 51`**, gọi lần hai (đường **cache** phiên) ⇒ **`id = 51`** | ✅ |
| 4 | **`0318` có hiệu lực** | login với UA **3.770** ký tự ⇒ 200 · hàng sổ **id 303 ĐƯỢC TẠO** · `length(deviceName)` = **3.770** *(trước `0318`: **255**)* · so khớp **nguyên văn** với chuỗi đã gửi = **true** · `auth.me` ⇒ **`id = 51`** | ✅ |
| 2b | *(kèm)* vé `/api/external/auth/login` | hàng sổ **id 302 ĐƯỢC TẠO** *(trước lượt vá: **0 hàng**)* · Bearer ⇒ 200 · lật `isActive=false` ⇒ **401** ⇒ vé 30 ngày ấy **nay thu hồi được**, thứ nó chưa từng có | ✅ |

**Cách đúc cảnh "vé không có hàng sổ"**: đăng nhập THẬT để máy chủ tự ký vé B, rồi **`DELETE`** hàng
`user_sessions` của nó bằng SQL, và **chưa gọi `auth.me` lần nào với B** — nên bộ nhớ đệm phiên
(TTL 45 s) **chưa có mục nào** cho B và không che mất phán quyết. Đây đúng hình dạng *"vé lưu hành
mà sổ không biết"*, và nó **không** cần bất kỳ mã thử nghiệm nào trong sản phẩm.

**Dọn dấu vết**: `session.revoke` (đường sản phẩm) ⇒ 2 lượt **200**; các hàng còn lại của lượt đo
được lật `isActive=false`. Trạng thái cuối **trùng khít mốc ban đầu**: `isActive=true` = **39**,
`userId=51` = **22** (id 241–295). Tổng hàng 290 → **296** (6 hàng mới, đều đã thu hồi).
**Không đổi mật khẩu / cờ / vai / quyền của ai**; bit `vram_control`/`canDelete` của `engineer1`
**không bị chạm**.

---

## 5. Đột biến bắt buộc

Đột biến bằng **Node**, chèn **theo chỉ số dòng** (repo TRỘN LF/CRLF ⇒ `cat -A` nói dối; ký tự
xuống dòng gốc của từng dòng được giữ nguyên). Mỗi ca: `apply` → chạy lưới → `revert`.

| ca | đột biến | lưới ĐỎ |
|---|---|---|
| **M-A** | `sdk.ts:136` `khongCoHang = true` → `false` (**hoàn nguyên phép siết**) | `thuHoiPhienMoiBeMat.test.ts` › **§5d ĐÃ SIẾT — token KHÔNG có hàng sổ ⇒ BỊ TỪ CHỐI** (1 failed / 15 passed) |
| **M-B** | `samlProvider.ts:375` — **gỡ** `ghiSoPhienChoOpenId` ở ACS của SAML | `sessionGrantScan.test.ts` › **§4 ∀ điểm đúc thẻ phiên: hàm bao có ≥1 lượt GHI SỔ** — chỉ đúng **hai** điểm của file bị gỡ (`:368 createSessionToken` · `:377 res.cookie(COOKIE_NAME)`), không bắt vạ file khác (1 failed / 13 passed) |
| **M-C** | `drizzle/schema/auth.ts:248` `text` → `varchar(255)` (**kéo lùi `0318`** ở khai báo TS) | `tranCotSoPhien.test.ts` › **§1a** (`expected 255 to be undefined`) **và §2a** (`expected 255 to be 3770`) — 2 failed / 10 passed |

**Đối chứng dương**: sau cả ba lượt `revert`, `git status -- server/ drizzle/` **rỗng** và toàn bộ
cổng xanh trở lại (§6).

---

## 6. Cổng ra

| cổng | kết quả |
|---|---|
| `npm run check` (`tsc --noEmit`, `NODE_OPTIONS=--max-old-space-size=8192`) | **exit 0** |
| `npm run check:tests` | **exit 0** |
| `npm run i18n:check` | **exit 0** — 0 placeholder mismatch · 0 NEW missing · 0 stale · 0 baseline-integrity |
| §Cổng kiểm chung (48 đường) | **148 file / 2.354 ca XANH**, 1 ĐỎ |
| …**+ một lượt `--sequence.shuffle.tests`** | **cùng kết quả**: 148/1 · 2.354/1 |

Ca ĐỎ duy nhất là ca **đã biết, KHÔNG sửa**:
`server/api.test.ts › Factory Router › should reject non-admin from creating factory`.

### `CONG` / `FILE_CANH` — **tự đếm bằng cách để cổng ĐỎ rồi đọc số thật**

Đặt hai ô ghim thành `-1` rồi chạy `vramPha5Gate.test.ts`, đọc số trong thông điệp lỗi:

```
expected 48  to be -1     ⇒ CONG      = 48
expected 111 to be -1     ⇒ FILE_CANH = 111
```

⇒ **CONG = 48 · FILE_CANH = 111, KHÔNG ĐỔI** — đúng, vì lượt này **không thêm file lưới nào**, chỉ
thêm §/ô vào các file đã nằm trong cổng (`sessionGrantScan.test.ts` · `thuHoiPhienMoiBeMat.test.ts`
· `tranCotSoPhien.test.ts` · `sdk.authCache.test.ts`). Hai ô ghim đã được hoàn nguyên nguyên trạng.

---

## 7. Nợ mới / nợ được khai

1. ⚠⚠ **Máy chủ thứ hai trên cổng 3001** (PID 30356, `pnpm start` từ 00:02:54) đang chạy **mã trước
   lượt siết** trên **cùng DB** ⇒ một bề mặt còn nguyên lỗ fail-open. **CHỜ CHỦ DỰ ÁN.**
2. ⚠ **6 migration pending là nợ CÓ TRƯỚC**: `0057` · `0066` · `0125` · `0234` (`success=false` từ
   2026-07-19) · `0308` · `0309` (**không có hàng sổ nào**). Lượt này cố ý không đụng.
3. ⚠ `drizzle/0319_session_ip_address_text.sql.DRAFT` — soạn xong, **CHỜ DUYỆT**, chưa áp.
4. ⚠ Cột `ipAddress varchar(45)` ở **12 bảng khác** vẫn mang cùng một trần đoán; `audit_logs` là
   bảng đáng bàn tiếp theo.
5. ⚠ **Bộ nhớ đệm phiên đi TRƯỚC phép tra sổ.** `xacThucTho` trả về ngay ở nhánh trúng cache, nên
   một hàng sổ vừa bị **xoá thẳng bằng SQL** vẫn được cho qua tới **45 s**. `thuHoiPhienTheoToken`
   (đường sản phẩm) tự dọn cache nên đường **thu hồi** không hở; đường **xoá hàng** thì hở. Lượt
   nghiệm thu né bằng cách không chạm cache trước khi đo — **vùng mù được khai**, chưa vá.
6. ⚠ `/api/external/auth/login` vẫn mang dấu `@KHONG-CONG-2FA` (nợ Pha 7, chờ chủ dự án). Lượt này
   chỉ làm nó **ghi sổ**, **không** đổi cổng 2FA của nó.
7. ⚠ Vé của `/api/external/auth/login` nay hiện trong `session.list` của người dùng — một **thay đổi
   hành vi nhìn thấy được**: người dùng sẽ thấy thêm mục "thiết bị" cho mỗi lượt gọi API ấy.
