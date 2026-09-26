# Nghiệm thu SỐNG — "mục 4": cưỡng chế `mustChangePassword` trên bề mặt NGOÀI tRPC

- **Ngày:** 2026-08-13 (brief đề 2026-08-11)
- **Nhánh / HEAD:** `feat/hmi-dep` · `53456541`
- **Máy chủ:** PID **15052**, cổng **3000** (nhận diện theo cổng: `Get-NetTCPConnection -LocalPort 3000 -State Listen → OwningProcess 15052`; dòng lệnh `node dist/index.js`, khởi 10:17). Build `dist/index.js` 10:02 — chứa `thuXacThucRest`/`chanNeuPhaiDoiMatKhau`.
- **Loại việc:** CHỈ ĐO. Không sửa một dòng mã sản xuất. Không DDL/migration/seed. Không stage/commit gì ngoài chính báo cáo này.
- **DB:** `avi_app@127.0.0.1:5434/aoi_management`, `TimeZone=Etc/UTC` (mọi mốc dưới là UTC).

---

## TL;DR — phán quyết từng bước

| Bước | Nội dung | Phán quyết | Số đo THẬT |
|---|---|---|---|
| **2** | Tài khoản MANG CỜ gọi ≥2 bề mặt khác họ ⇒ bị chặn | **ĐẠT** | SSE `/api/ai/stream/generate` ⇒ **403 + `code:MUST_CHANGE_PASSWORD`**; Export `/api/export/inspections.csv` ⇒ **401** (chặn). Xác nhận trên **2** tài khoản mang cờ (sup1 #49, maint1 #50). |
| **3** | Đối chứng DƯƠNG: `engineer1` (không cờ) gọi ĐÚNG hai bề mặt ⇒ chạy | **ĐẠT** | Cùng SSE ⇒ **200** (dòng token GGUF thật); cùng Export ⇒ **200** (CSV có hàng dữ liệu thật). |
| **4** | Đối chứng ÂM: `admin` mang cờ (lỗ CỐ Ý) ⇒ KHÔNG bị chặn | **KHÔNG ĐO ĐƯỢC** (live) | Không có mật khẩu `admin`/`audit_agent`, cấm dò ⇒ không đăng nhập được. Có **bằng chứng OFFLINE** (đo vị từ, KHÔNG phải đo sống) — xem §4. |

**Dấu vết DB:** tạo **3** phiên (id 316·317·318 cho #49·#50·#51), **thu hồi cả 3** bằng `auth.logout` ⇒ `isActive=false`. Live-count trở về đúng mốc trước (49→4, 50→3, 51→23). Không đổi mật khẩu/cờ/vai/quyền/khoá của ai; `loginAttempts=0`, `lockedUntil=null` toàn bộ.

---

## 0. Tự đếm lại các bề mặt (không tin số của brief)

Đếm bằng `git grep` trên mã sản xuất `server/**` (loại `*.test.ts`), rồi đọc từng chỗ. Cưỡng chế `mustChangePassword` nằm ở **`chanNeuPhaiDoiMatKhau`** bên trong `sdk.authenticateRequest` (`server/_core/sdk.ts:525-529`). Mọi điểm phân giải danh tính đi qua đó (trừ nhánh tRPC cố ý `boQuaCongDoiMatKhau:true`, và nhánh Bearer `validateExternalAuth` vòng qua) đều được cưỡng chế.

**Điểm gọi `authenticateRequest` / uỷ quyền, NGOÀI tRPC** (đo được, không suy):

| # | Bề mặt | File · dòng | Đường tới cổng | Tín hiệu khi bị chặn |
|---|---|---|---|---|
| 1 | tRPC `context` | `_core/context.ts:67` | `boQuaCongDoiMatKhau:true` → chặn lại ở `thuTucGoc` (trong tRPC) | *(không phải "ngoài tRPC")* |
| 2 | APK download | `_core/index.ts:1251` | `authenticateRequest` trực tiếp, `catch`→fall-through | 401 (gộp) |
| 3 | **Socket handshake** | `_core/socket.ts:126` | `authenticateRequest` trực tiếp | handshake fail |
| 4 | **Export/BI** | `api/export/exportRouter.ts:124` (`authenticateExportRequest`) | `authenticateRequest`, `catch`→**401 gộp** | **401 (gộp, KHÔNG mang code)** |
| 5 | Loopback/Observability | `routes/_congLoopback.ts:49` (`doiVaiDacQuyen`) | `authenticateRequest`, `catch`→401 | 401 (gộp) |
| 6 | **7 tuyến REST** qua `thuXacThucRest` | `routes/_xacThucRest.ts:128` | phân loại lỗi → **mã máy-đọc** | **403 + `code:MUST_CHANGE_PASSWORD`** |

Bảy tuyến của (6): SSE `/api/ai/stream/{generate,chat,narrative}` (`aiStreamingApi.ts`) + `local-kb/{reload,retrieve,ask,stream}` (`aiLocalKnowledgeApi.ts`).

**Kết luận đếm:** brief nói "13 điểm, 12 qua điểm chung". Con số ấy đúng với ảnh chụp Pha 8; **sau Pha 9 A6**, bảy điểm REST đã gộp về **một** chủ `thuXacThucRest` — nên "điểm gọi thô" nay khác, nhưng **bất biến vẫn nguyên**: mọi bề mặt ngoài tRPC đi qua `authenticateRequest` ⇒ fail-closed. Điều tôi CHỌN đo là hai **họ khác nhau về đường mã**, không chỉ hai URL cùng họ.

### Hai bề mặt được chọn — và VÌ SAO

- **Bề mặt A — SSE `POST /api/ai/stream/generate`** (họ `thuXacThucRest`, `aiStreamingApi.ts:22-28`).
  *Vì sao:* đây là bề mặt cho **tín hiệu PHÂN BIỆT ĐƯỢC trong THÂN** — `thanTuChoiRest` trả `code` máy-đọc-được. Must-change ⇒ **403 + `code:MUST_CHANGE_PASSWORD`**, khác hẳn chưa-đăng-nhập ⇒ **401 + `code:AUTH_REQUIRED`**. Đây là thước không nói dối: mã trong thân, không phải mã trạng thái.
- **Bề mặt B — Export `GET /api/export/inspections.csv`** (họ **KHÁC**: `authenticateExportRequest`, `exportRouter.ts:98-139` — **không** đi qua `thuXacThucRest`).
  *Vì sao:* đúng yêu cầu "khác họ" (một SSE, một exportRouter). Nó là đường mã **độc lập**, có `catch` riêng **gộp** mọi lượt ném về **401** (kể cả `MUST_CHANGE_PASSWORD`). Chính vì nó KHÔNG phân biệt được trong thân, nó là phép thử cho **kỷ luật đo**: chỉ đối chứng dương (engineer1 = 200) mới tách được "401 vì must-change" khỏi "401 vì chưa auth".

---

## 1. Hiệu chuẩn bằng sự kiện có đáp số biết trước (trước khi tin thước)

| Sự kiện (đáp số biết trước) | Đo được | Khớp? |
|---|---|---|
| `auth.me` **không cookie** ⇒ phải 200 + `null` (thước "200+null" brief cảnh báo) | **200**, `data=null` | ✅ |
| SSE **không cookie** ⇒ chưa auth | **401**, thân `{"error":"Unauthorized","code":"AUTH_REQUIRED"}` | ✅ |
| Export **không cookie** ⇒ chưa auth | **401**, `{"error":"Authentication required: session cookie or API key ..."}` | ✅ |

⇒ Thước đã hiệu chuẩn: `auth.me` phân biệt "đã đăng nhập" (trả hồ sơ) với "chưa" (`null`); SSE mang `code` phân biệt được `AUTH_REQUIRED` với `MUST_CHANGE_PASSWORD`.

---

## 2. ĐẠT — tài khoản mang cờ bị chặn thật

**Chủ thể chính: `supervisor1` #49** (mang cờ, `isActive=true`, không 2FA, mật khẩu `Test@1234`).

1. `POST /api/auth/login {supervisor1/Test@1234}` ⇒ **200** `{"success":true,"user":{"id":49,"role":"supervisor"}}`, `Set-Cookie: app_session_id=…` → **đã đăng nhập thật**, không lockout.
2. `auth.me` **với cookie** ⇒ **200**, `id=49`, `role=supervisor`, **`mustChangePassword=true`**. → thước xác nhận: phiên thật VÀ cờ đang bật (không phải một 200+null trá hình).
3. **Bề mặt A** SSE `/api/ai/stream/generate` (cookie) ⇒ **403**, thân `{"error":"Password change required","code":"MUST_CHANGE_PASSWORD"}`. → **chặn thật, phân biệt được** với `AUTH_REQUIRED` của lượt hiệu chuẩn.
4. **Bề mặt B** Export `/api/export/inspections.csv?from=2026-08-01&to=2026-08-07` (cookie) ⇒ **401** (chặn — `catch` của export gộp `MUST_CHANGE_PASSWORD`→401).

**Chủ thể xác nhận: `maint1` #50** (mang cờ, `Test@1234`): login ⇒ 200 (`role=maintenance`); SSE ⇒ **403 + `code:MUST_CHANGE_PASSWORD`**. → bất biến giữ trên **hai** vai/tài khoản khác nhau.

---

## 3. ĐẠT — đối chứng DƯƠNG (engineer1 không cờ, ĐÚNG hai bề mặt ấy)

**`engineer1` #51** (KHÔNG cờ — `passwordChangedAt` 2026-08-10T10:04 **sau** `passwordInvalidBefore` 2026-08-10T08:23 ⇒ vị từ = false; 2FA bật, mật khẩu `User@123`).

1. `POST /api/auth/login` ⇒ **200** `{"requires2FA":true,"userId":51}` (đặt vé `pending_2fa`).
2. `POST /api/auth/verify-2fa {userId:51, token:<TOTP tính từ secret DB bằng speakeasy>}` ⇒ **200** `{"success":true,...}`, xoá `pending_2fa`, đặt `app_session_id`.
3. `auth.me` ⇒ **200**, `id=51`, `role=engineer`, **`mustChangePassword=false`**.
4. **Bề mặt A** SSE (cùng URL) ⇒ **200**, dòng token GGUF thật: `data: {"type":"token","token":"The"} …`.
5. **Bề mặt B** Export (cùng URL) ⇒ **200**, CSV thật: hàng tiêu đề `id,serialNumber,overallResult,…`.

**Vì sao bước này là bắt buộc:** trên Export, must-change (sup1)=401 **trùng** hình dạng với chưa-auth (hiệu chuẩn)=401 — đúng "thước hỏng cho ra đúng hình dạng kết luận thật". Nhưng engineer1 (cookie hợp lệ, **cùng bề mặt**) = **200**. Biến DUY NHẤT khác giữa sup1 và engineer1 là **cờ must-change** ⇒ 401 của sup1 **chỉ có thể** do cưỡng chế must-change, và bề mặt **thật sự chạy** (engineer1 lấy được CSV). Trên SSE thì không cần suy: `code` trong thân đã tự phân biệt.

---

## 4. KHÔNG ĐO ĐƯỢC (live) — đối chứng ÂM cho vai miễn trừ

Lỗ CỐ Ý (chủ dự án duyệt 2026-08-09, `shared/buocDoiMatKhau.ts:26-48`): vai `admin` **không** bị cổng chặn kể cả khi cờ bật. Hai tài khoản đủ điều kiện: `admin` #1 và `audit_agent` #167 — **cả hai vai `admin`, cờ đang bật**.

**Đường KHÔNG đi được:** tôi **không có** mật khẩu của cả hai và **bị cấm dò** (sai nhiều lần bật `lockedUntil`). Không có tài khoản **không-admin** nào được miễn trừ để thay thế. ⇒ **Không đăng nhập được ⇒ không đo sống được** việc "admin mang cờ vượt cổng".

**Bằng chứng OFFLINE (đây là SUY LUẬN/đo vị từ, KHÔNG phải đo sống):** đánh giá đúng vị từ sản xuất `biChanBoiCongDoiMatKhau(role, phaiDoiMatKhau)` trên mốc DB thật của từng tài khoản:

| id | user | role | `mustChangePassword` (suy từ 2 mốc DB) | miễn trừ? | `biChanBoiCongDoiMatKhau` |
|---|---|---|---|---|---|
| 1 | admin | admin | **true** | **có** | **false** (KHÔNG chặn) |
| 167 | audit_agent | admin | **true** | **có** | **false** (KHÔNG chặn) |
| 49 | supervisor1 | supervisor | true | không | **true** (chặn) |
| 50 | maint1 | maintenance | true | không | **true** (chặn) |
| 51 | engineer1 | engineer | false | không | false |

Bảng này **nhất quán** với lỗ cố ý, nhưng nó chứng minh **cái vị từ**, không chứng minh **một lượt gọi thật của admin vượt cổng**. Phân biệt rõ: mục 4 **live = KHÔNG ĐO ĐƯỢC**; chỉ có xác nhận vị-từ offline.

---

## 5. Phát hiện phụ (đo được, ngoài kế hoạch)

1. **Brief lệch chủ thể (lần thứ 15):** brief nói "cả ba #48/#49/#50 đang mang cờ, mật khẩu `Test@1234`". **Đo được:** `operator1` #48 **KHÔNG còn mang cờ** — `passwordChangedAt` = **2026-08-12T21:21** (sau `passwordInvalidBefore` 2026-08-08) ⇒ vị từ=false; và `bcrypt.compare('Test@1234', hash)` = **NO-MATCH**. Ai đó đã đổi mật khẩu operator1 sau khi brief viết (đúng điều brief tự cảnh báo: "đổi mật khẩu ⇒ cờ hạ"). ⇒ Tôi **không** dùng #48; dùng #49 và #50 (đều `Test@1234` MATCH, cờ còn bật — xác nhận offline bằng `bcrypt.compare` **trước** khi đăng nhập, tránh đẩy `loginAttempts`).

2. **Export nuốt mã phân biệt (chất lượng đo, không phải lỗ an ninh):** `authenticateExportRequest` bắt `ForbiddenError("MUST_CHANGE_PASSWORD:…")` trong `catch` rồi trả **401 "Authentication required…"** — **fail-closed đúng chiều**, nhưng thân **không** mang `code`, nên must-change và chưa-auth **không phân biệt được** chỉ bằng một lượt gọi Export. (SSE thì phân biệt được.) Không đề xuất sửa — đây là quan sát, không phải khiếm khuyết cưỡng chế.

---

## 6. Dấu vết DB — tạo & dọn

| Phiên | user | id | Sau `auth.logout` |
|---|---|---|---|
| supervisor1 | 49 | **316** | `isActive=false` ✅ |
| maint1 | 50 | **317** | `isActive=false` ✅ |
| engineer1 | 51 | **318** | `isActive=false` ✅ |

- Số phiên **tạo = 3**, **thu = 3** (qua `auth.logout` — thu hồi đúng token của chính phiên, tương đương `session.revoke`).
- Live-count trước/sau **không đổi**: 49→4, 50→3, 51→23.
- Toàn bộ #1/#48/#49/#50/#51/#167 sau lượt đo: `loginAttempts=0`, `lockedUntil=null`, `passwordChangedAt`/`passwordInvalidBefore`/`role`/`isActive` **y nguyên**. Không đổi mật khẩu/cờ/vai/quyền của bất kỳ ai. Chủ thể must-change (#49/#50) **được bảo toàn** cho lượt sau.

---

## 7. "Tôi đo được" vs "tôi suy ra"

- **Đo được (sống):** SSE chặn must-change (403 + `code`, hai tài khoản) · Export chặn (401) · đối chứng dương engineer1 (SSE 200 token thật + Export 200 CSV thật) · hiệu chuẩn ba sự kiện đáp-số-biết-trước · tạo/thu 3 phiên.
- **Suy ra / đo offline (KHÔNG phải sống):** admin miễn trừ (chỉ đánh giá vị từ trên mốc DB, không đăng nhập được) · phép đếm "mọi bề mặt ngoài tRPC qua `authenticateRequest`" (đọc mã + git grep, không gọi thử từng cái) · Export gộp mã 401 (đọc `catch` + suy, tuy 401 sống đã quan sát).

## 8. Ràng buộc đã tuân
Không sửa mã sản xuất · không DDL/migration/seed/`kb:sync`/cấp quyền · không restart server · không spawn sub-agent · không `git add -A` (chỉ stage đúng báo cáo này) · nhận diện server theo cổng.
