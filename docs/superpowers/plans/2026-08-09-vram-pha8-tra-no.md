# Pha 8 — Trả nợ Pha 6/7 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development để thực thi từng task. Steps dùng checkbox (`- [ ]`).

**Goal:** Đóng các nợ **ĐÃ ĐO ĐƯỢC** của Pha 6/7, xếp theo **rủi ro đo được**, không theo thứ tự phát hiện.

**Architecture:** Không thêm cơ chế mới. Mỗi task lấy một bất biến **đã có** và mở rộng **phạm vi phát biểu** của nó tới chỗ hiện đang hở, hoặc dựng lưới cho một hàng rào hiện **không ai canh**.

**Tech Stack:** TypeScript · tRPC · drizzle · PostgreSQL 17 · vitest · React 19 · i18n vi/en/zh.

---

## Global Constraints

Mọi task **đều** chịu các ràng buộc sau. Vi phạm là hỏng việc thật.

1. **KHÔNG DDL/migration/seed/`kb:sync`/cấp quyền** nếu chưa được chủ dự án duyệt **từng lượt**. DDL chạy bằng owner **`aoi`** (user `avi_app` ⇒ `42501`), áp lên **CẢ HAI** DB `aoi_management` và `aoi_management_test`.
2. **KHÔNG đổi mật khẩu/cờ/vai/hạt giống/quyền** của bất kỳ tài khoản nào nếu không được nêu đích danh trong task.
3. Repo có **~245 mục dirty ngoài phạm vi**. **KHÔNG chạm, KHÔNG dọn, KHÔNG stage. TUYỆT ĐỐI KHÔNG `git add -A`.**
4. **KHÔNG restart server** trừ khi được bảo. Nếu buộc phải: **chỉ** giết PID có `CommandLine -ceq 'node dist/index.js'`. Một lượt khớp lỏng đã **giết nhầm 12 sidecar MCP**.
5. **KHÔNG spawn sub-agent.**
6. **Commit TRƯỚC, đột biến SAU.** Khôi phục bằng `git checkout HEAD -- <file>` (KHÔNG `git checkout <commit> --` — nó ghi vào INDEX). Đột biến trên mã **chưa commit** không hoàn nguyên được — đã từng **xoá mất một bản vá**.
7. **Bước 1 của mọi task: TỰ ĐẾM, TỰ ĐO.** Brief mô tả trạng thái có thể **đã không còn đúng** — riêng Pha 7 việc này xảy ra **bốn lần**. Đo ra khác ⇒ **DỪNG và báo**, đừng vá theo brief.

### Câu kiểm bắt buộc cho mọi lưới mới

- **"TỒN TẠI hay VỚI MỌI?"** — lượng từ sai là lớp lỗi riêng của dự án này.
- **"Lưới có canh đúng thứ TÊN NÓ NÓI không?"** — Pha 7 gặp **bốn** biến thể lưới canh hẹp hơn tên gọi.
- **"Lượng từ có TỰ THOẢ không?"** — một tập giao với chính tập phủ thì **theo cấu tạo không bao giờ đỏ được**.
- **"Lưới đang đo hình dạng dữ liệu CÓ TỒN TẠI trong sản xuất không?"** — lưới xanh trên fixture `'local'` trong khi dữ liệu thật là `'password'` đã đẻ ra **một nhà tù 4/4 tài khoản**.
- **"Đây là lưới HÌNH DẠNG hay lưới HÀNH VI?"** — quét mã trả lời được *"mã có hình dạng ấy không"*, **không** trả lời được *"mã LÀM việc ấy không"*. `if (true) return <>{children}</>` đã **ship được** qua một lưới quét mã đầy đủ.

### Kỷ luật đo

- **Đột biến là bằng chứng DUY NHẤT lưới tồn tại.** Mỗi lưới mới: một đột biến ⇒ **ĐỎ** (dán tên ca), một đối chứng dương ⇒ **XANH**. File CRLF ⇒ **đột biến THEO DÒNG**.
- ⚠⚠ **Glob rỗng ⇒ vitest IM LẶNG, cổng khai XANH** — đã **sáu** lần. `ls` xác nhận đường dẫn TRƯỚC khi tin bất kỳ kết xuất xanh nào.
- ⚠ **Thiết bị đo nói dối — sáu lần trong hai ngày**: `pg_stat_user_tables` trễ ~4,7 s + `stats_fetch_consistency=cache` · `postgres` v3 in `timestamp` **lùi 7 giờ** · `grep` trên `dist/index.js` mù vì esbuild thoát `\uXXXX` **chữ HOA** · `sed`/`od` khai LF trong khi Node đọc **CRLF** (`core.autocrlf=true`) · **`nvidia-smi` trôi 70 MiB trong khi sổ đứng im tuyệt đối**.
  ⇒ **Kết quả gây sốc ⇒ NGHI THIẾT BỊ TRƯỚC KHI NGHI HỆ.** Và **hiệu chuẩn bằng một sự kiện có đáp số biết trước** rồi mới tin thước.
- **Đừng để `catch` mặc áo của phép đo** — một `.catch()` trả 0 cứng đã từng bị đọc thành kết quả.
- Phân biệt rõ **"tôi đo được"** với **"tôi suy ra"**. Rút lại một đề xuất của chính mình sau khi đo là hành vi **ĐÚNG**.

### Cổng kiểm chung

`npm run check` · `npm run check:tests` · `npm run i18n:check` **sạch**, cộng khối lệnh §"Cổng kiểm chung" trong `docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md`. Thêm file lưới ⇒ thêm đường vào khối đó **và** cập nhật `CONG`/`FILE_CANH` trong `server/services/vram/vramPha5Gate.test.ts` — **tự đếm bằng cách để cổng đỏ rồi đọc số thật**.

**Ca đỏ đã biết, KHÔNG sửa** (chờ chủ dự án): `server/api.test.ts › Factory Router › should reject non-admin` — kỳ vọng chuỗi **tiếng Anh** trong khi RBAC đã bản địa hoá từ AI Sprint 5. **Hành vi sản phẩm ĐÚNG, kỳ vọng test cũ.**

---

## Xếp hạng theo RỦI RO ĐO ĐƯỢC

| # | Nợ | Bằng chứng đo được | Hậu quả nếu để nguyên |
|---|---|---|---|
| **1** | Cưỡng chế `mustChangePassword` **chỉ phủ tRPC** | **11** điểm `sdk.authenticateRequest` ngoài `_core/context.ts` + `socket.ts:126` | Người bị buộc đổi mật khẩu **vẫn dùng được** 12 bề mặt |
| **2** | `auth.logout` **không thu hồi phiên máy chủ** | Sau `200`, cookie ấy vẫn cho `auth.me` trả đủ hồ sơ; hàng phiên vẫn `isActive=true` | "Đăng xuất" là lời hứa suông; mọi cơ chế thu hồi phiên nhẹ đi |
| **3** | `auth.setupAdmin.test.ts:7-11` `beforeEach` **xoá SẠCH bảng `users`** | Ba lượt cổng cho **ba nạn nhân khác nhau**, tất cả **xanh khi chạy riêng** | Không lưới nào dựng được admin bền vững; ca đỏ đổi mỗi lượt |
| **4** | `tieuMaTrongSo` **lái bằng đồng hồ người gọi** | Cùng lớp với `donSo()` đã vá ở `03ad466c` | Nửa còn lại của lỗ I-3 vẫn mở |
| **5** | `user_sessions` thiếu `ON DELETE CASCADE` | 4 phiên mồ côi `isActive=true` tới **2027** | Xoá người dùng để lại phiên sống |
| **6** | Cổng KIỂU C-2 **chỉ chặn nơi được khai** | Chưa có luật buộc thủ tục thứ hai phải khai | Thủ tục mới rò `user_secrets` mà không lưới nào đỏ |
| **7** | `MAU_DANH_TINH` · `TIEU_THU` còn là **danh sách viết tay** | — | "N+1" thứ mười tám |
| **8** | Không lưới nào canh lớp **`vi.mock` đổi hành vi mã sản phẩm** | `vi.mock("drizzle-orm")` ⇒ `DELETE` khớp 0 hàng, **không ném không kêu** | Lưới xanh trên mã đã bị thay |
| **9** | `totpSeedWriteScan.test.ts` §3 **phụ thuộc thứ tự** | Chạy một mình + shuffle ⇒ hỏng **1/3** lượt | Ca đỏ giả, bào mòn lòng tin vào cổng |
| **10** | 4 tài khoản demo dùng **mật khẩu hạt giống trong repo** | `bcrypt.compare` xác nhận (chỉ đọc) | Mật khẩu công khai trên tài khoản thật |
| **11** | `VACUUM FULL "users"` chưa chạy | `DROP COLUMN` để byte lại trong heap | Bí mật **đã lộ** còn nằm trong heap |
| **12** | Ba tuyến REST deploy **không OTP** (nợ Pha 6) | Đã đếm ở Pha 6; **cần đo lại** | Step-up đi vòng được qua REST |

⚠ **Mục 4, 5, 11, 12 cần chủ dự án duyệt** trước khi động (đổi ngữ nghĩa `nowMs` toàn dàn Task 5 · DDL · DDL/khoá bảng · đổi hợp đồng REST).

---

## Task 1 — Cưỡng chế `mustChangePassword` ra khỏi tRPC

**Rủi ro #1.** Cổng hiện đặt ở `thuTucGoc` của tRPC nên **theo cấu tạo** không thấy các bề mặt HTTP/socket khác.

**Files:**
- Đọc trước: `server/_core/context.ts`, `server/_core/sdk.ts`, `server/_core/trpc.ts`, `shared/buocDoiMatKhau.ts`
- Sửa: điểm **chung** mà mọi bề mặt cùng đi qua (tự tìm — **đừng vá 12 chỗ**)
- Test: `server/_core/buocDoiMatKhauMoiBeMat.test.ts` (mới)

- [ ] **Bước 1: TỰ ĐẾM.** `git grep -n "authenticateRequest"` trên toàn `server/`. Brief khai **11 + `socket.ts:126`** — xác nhận hoặc bác bỏ, dán số thật. Với mỗi điểm, ghi rõ nó **có** hay **không** đi qua một hàm dựng ngữ cảnh chung.
- [ ] **Bước 2: Viết lưới ∀ TRƯỚC.** Phát biểu: *"VỚI MỌI điểm xác thực yêu cầu HTTP/socket trong `server/**`, cờ buộc-đổi-mật-khẩu phải được kiểm."* Lượng từ suy từ **AST**, không từ danh sách. Chạy ⇒ phải **ĐỎ** với số điểm hở đúng bằng số đếm ở bước 1.
- [ ] **Bước 3: Vá tại điểm CHUNG.** Nếu không tồn tại điểm chung, **DỪNG và báo** — dựng một điểm chung là quyết định kiến trúc, không phải việc của task này.
- [ ] **Bước 4: Lưới XANH.** Cộng ca miễn trừ (`admin`) vẫn giữ nguyên hành vi.
- [ ] **Bước 5: Đột biến.** Gỡ phép kiểm khỏi điểm chung ⇒ ĐỎ. Thêm một điểm xác thực MỚI trong **FILE MỚI** không kiểm cờ ⇒ **ĐỎ** (đây là ca phân biệt "lưới theo ĐƯỜNG THOÁT" với "lưới theo FILE"). Đối chứng dương: điểm mới có kiểm ⇒ XANH.
- [ ] **Bước 6: Commit.**

---

## Task 2 — `auth.logout` phải thu hồi phiên thật

**Rủi ro #2.** Đo được: sau `200`, cookie ấy vẫn cho `auth.me` trả **đủ hồ sơ**, hàng `user_sessions` vẫn `isActive=true`.

**Files:** `server/routers/authRouters.ts` (tự xác nhận đường dẫn) · `server/services/authSessionCache.ts` · Test: `server/auth.logoutThuHoi.test.ts` (mới)

- [ ] **Bước 1: Tái hiện bằng phép đo**, dán kết xuất: gọi `auth.logout` ⇒ `200`; **cùng cookie ấy** gọi `auth.me` ⇒ hiện trả gì; hàng phiên `isActive` bằng gì.
- [ ] **Bước 2: Lưới đỏ trước.** Bất biến: *"sau `auth.logout`, phiên ấy KHÔNG dùng được nữa VÀ hàng `user_sessions` không còn `isActive`."* Hai vế, **cả hai** phải đỏ trước khi vá.
- [ ] **Bước 3: Vá** — thu hồi cả **sổ DB** lẫn **cache phiên**. ⚠ Có `authSessionCache`; quên một trong hai ⇒ lỗ vẫn còn ở nửa kia.
- [ ] **Bước 4: XANH cả hai vế.**
- [ ] **Bước 5: Đột biến.** Bỏ thu hồi DB ⇒ ĐỏA. Bỏ xoá cache ⇒ ĐỏB. **Hai đột biến phải đỏ ở HAI ca khác nhau** — nếu cùng một ca đỏ cho cả hai thì lưới đang canh một vế và ăn may vế kia.
- [ ] **Bước 6: Commit.**

---

## Task 3 — `setupAdmin.test.ts` thôi xoá sạch bảng `users`

**Rủi ro #3.** Đây là **hạ tầng đo**: chừng nào nó còn, mọi phán quyết "đỏ/xanh" của cổng đều có nhiễu, và **ba pha liên tiếp** đã chẩn đoán sai vì nó.

**Files:** `server/auth.setupAdmin.test.ts:7-11` · Test: chính nó + một lưới cấm tái diễn

- [ ] **Bước 1: Đo mức nhiễu.** Chạy cổng 3 lượt, ghi tập ca đỏ mỗi lượt. Dán. (Lượt trước: ba nạn nhân khác nhau, tất cả xanh khi chạy riêng.)
- [ ] **Bước 2: Sửa `beforeEach`** — chỉ dọn **đúng hàng nó tạo ra**, không xoá theo `role` hay xoá sạch bảng. Nếu test cần "không có admin nào", cô lập bằng dữ liệu riêng chứ **đừng** xoá của người khác.
- [ ] **Bước 3: Lưới cấm tái diễn.** *"KHÔNG file `*.test.ts` nào được `DELETE`/`truncate` bảng `users` không kèm giới hạn theo hàng nó tạo."* Suy bằng **AST**, không so chuỗi (regex trên văn bản đã **bắt nhầm chú thích** một lần).
- [ ] **Bước 4: Đo lại nhiễu** — 3 lượt cổng phải cho **CÙNG một tập ca đỏ**. Đây là cổng ra thật của task này.
- [ ] **Bước 5: Đột biến.** Thêm một `beforeEach` xoá sạch ở file test khác ⇒ ĐỎ. Đối chứng dương: dọn có giới hạn ⇒ XANH.
- [ ] **Bước 6: Commit.**

---

## Task 4 — Ba lưới cho ba hàng rào hiện KHÔNG AI CANH

**Rủi ro #6, #8, #9.** Gộp một task vì cùng một hình dạng: hàng rào có thật, **không cơ chế nào canh**.

**Files:** `server/_core/publicUser.ts` (mở rộng) · `server/_core/xacThucNoiBo.test.ts` · `server/services/vram/totpSeedWriteScan.test.ts` · Test: `server/_core/hangRaoKhongAiCanh.test.ts` (mới)

- [ ] **Bước 1 (#6): Luật KHAI BẮT BUỘC.** Cổng KIỂU của C-2 chỉ chặn nơi được khai. Phát biểu ∀: *"VỚI MỌI thủ tục đọc `user_secrets`, phải khai phân loại; không khai ⇒ ĐỎ."* Đột biến: thêm thủ tục đọc `user_secrets` không khai ⇒ ĐỎ.
- [ ] **Bước 2 (#9): Gỡ phụ thuộc thứ tự** ở `totpSeedWriteScan.test.ts` §3 (hai ca dùng chung trạng thái `twoFactorEnabled`). Cổng ra: chạy **một mình + shuffle 5 lượt** ⇒ 5/5 xanh (hiện hỏng 1/3).
- [ ] **Bước 3 (#8): Lưới cho lớp `vi.mock` đổi hành vi mã sản phẩm.** `vi.mock("drizzle-orm")` từng làm `DELETE` khớp 0 hàng **không ném không kêu**. Phát biểu: *"KHÔNG file test nào được `vi.mock` một module hạ tầng DB mà không `importOriginal`."* ⚠ Nếu có ngoại lệ chính đáng, cho phép **khai tên** — nhưng tập ngoại lệ phải **ghim số** và mọi mục phải có lý do một dòng.
- [ ] **Bước 4: Đột biến cho cả ba**, mỗi cái một ca đỏ có tên riêng + một đối chứng dương.
- [ ] **Bước 5: Commit** (ba commit riêng, mỗi hàng rào một commit).

---

## Task 5 — `MAU_DANH_TINH` và `TIEU_THU` thôi là danh sách viết tay

**Rủi ro #7.** "N+1" đã xảy ra **mười bảy** lần; đây là hai chỗ còn lại đã biết tên.

⚠ **Cạm bẫy đã đo được, ĐỪNG lặp lại:** đề xuất *"suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS`"* **hỏng theo chiều MỞ** — tập ấy chứa `name`, nên **mọi đối tượng nghiệp vụ `{id,name}`** (máy/sản phẩm/dây chuyền) bị **xoá nhầm** khỏi `localStorage`. Đột biến áp đúng đề xuất ấy cho **2 ca đỏ**.

- [ ] **Bước 1:** Tìm **nguồn có đo** đúng cho từng tập — không phải nguồn *tiện tay*. Nói rõ vì sao nguồn ấy đúng **và** nó **không** kéo theo phần tử ngoài ý muốn.
- [ ] **Bước 2:** Nếu không tồn tại nguồn suy an toàn ⇒ **giữ danh sách tay** nhưng **neo hai chiều** vào chỗ tiêu thụ, và **nói thẳng trong báo cáo** rằng đây là danh sách tay có canh, không phải tập suy ra. *Một danh sách tay ĐƯỢC CANH tốt hơn một phép suy SAI.*
- [ ] **Bước 3:** Đột biến hai chiều (thiếu phần tử ⇒ đỏ · thừa phần tử ⇒ đỏ).
- [ ] **Bước 4: Commit.**

---

## Task 6 — Vệ sinh, cần chủ dự án duyệt từng mục

**KHÔNG tự làm.** Trình bày cho chủ dự án, kèm số đo, rồi chờ:

- [ ] **#4 `tieuMaTrongSo`** — đổi sang đồng hồ máy chủ. ⚠ **Đổi ngữ nghĩa `nowMs` trên TOÀN dàn chứng minh Task 5 Pha 7.** Trình bày phạm vi ảnh hưởng trước.
- [ ] **#5 `user_sessions` `ON DELETE CASCADE`** — DDL. Kèm số phiên mồ côi hiện tại.
- [ ] **#10 mật khẩu demo** — 4 tài khoản. Đề xuất: buộc đổi qua chính cơ chế I-4 vừa dựng (nay đã chứng minh **có lối ra**).
- [ ] **#11 `VACUUM FULL "users"`** — khoá bảng. Cần cửa sổ bảo trì.
- [ ] **#12 ba tuyến REST deploy không OTP** — **đo lại trước** (số từ Pha 6, có thể đã cũ), rồi trình bày.
- [ ] **Bit đang ngủ của `engineer1`** — `vram_control/canDelete` còn bật sau khi 2FA bị tắt. Cùng tình trạng `supervisor1` vừa bị thu.

---

## Self-Review

- **Phủ spec:** 12 mục nợ → Task 1–5 xử 8 mục (#1,#2,#3,#6,#7,#8,#9 + hạ tầng đo), Task 6 trình 5 mục cần duyệt (#4,#5,#10,#11,#12). Mục #13 (`deployBuild` 500) chủ dự án đã quyết **không vá**.
- **Không placeholder:** mỗi task có file, bất biến phát biểu thành câu, đột biến cụ thể, cổng ra đo được.
- **Nhất quán kiểu:** không task nào tham chiếu hàm/kiểu chưa được định nghĩa ở task trước.
