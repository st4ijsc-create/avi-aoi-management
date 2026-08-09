# Pha 5 — Trả nợ Pha 4 (N8–N14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng **toàn bộ 7 mục nợ** Pha 4 để lại (N8–N14), gồm một lỗ an ninh đo được, một mặt đọc hai mức quyền, và bề mặt Agent chỉ một ngôn ngữ.

**Architecture:** Không thêm cơ chế mới. Mọi mục là **siết một vị từ đã có**, **đổi một kiểu đã có**, hoặc **cho một bề mặt đã có đủ ngôn ngữ**. Ba mục (N8, N9, N13) là quyết định của chủ dự án, đã chốt.

**Tech Stack:** TypeScript · tRPC · Drizzle · vitest · i18next · React 19

## Quyết định của chủ dự án (2026-08-06)

1. **N8** — **SIẾT ROUTER LÊN BẰNG TOOL**: `vram.state` đòi `machine_control/canView`, không còn là `protectedProcedure` trần.
2. **N9** — **THÊM `supervisor`** vào quyền ra lệnh ở tầng UI.
3. **N13** — **TỪ CHỐI `nlink > 1`**: đơn giản, kiểm bằng một lượt `stat`, hỏng theo chiều **AN TOÀN**.

## Global Constraints

Mọi task đều chịu các ràng buộc sau. Vi phạm bất kỳ điều nào = task hỏng.

- ⚠⚠⚠ **COMMIT TRƯỚC, ĐỘT BIẾN SAU.** `git checkout --` khôi phục về HEAD ⇒ chạy đột biến trước khi commit sẽ **xoá sạch** bản sửa.
- ⚠⚠⚠ **Khôi phục đột biến bằng `git checkout HEAD -- <file>`.** `git checkout <commit> -- <file>` **GHI VÀO INDEX**. Khôi phục bằng **thay chuỗi là MÙ** (từng gây 22 ca đỏ ở 7 file). **Chạy lại TOÀN BỘ sau khôi phục.**
- ⚠⚠⚠ **Cổng kiểm phải chạy theo ĐƯỜNG DẪN TƯỜNG MINH, KHÔNG dùng glob `*`.** Glob không khớp file nào thì **vitest im lặng và cổng khai XANH** — đã xảy ra thật, che **18 ca đỏ**.
- ⚠⚠⚠ **"ĐÃ SỬA" chỉ đúng khi `git show <commit>:<file>` xác nhận.** Một bản vá từng không lọt vào commit trong khi báo cáo khai đã sửa, **và test vẫn xanh**.
- ⚠⚠ **Lưới phải đi theo ĐƯỜNG THOÁT, không theo FILE.** Ca hỏi *"file có nhập X không"* trả lời về **sự hiện diện**, không nói gì về **đường đi**. Lớp lỗi này tái diễn **12 lần**. Phép thử đúng (đột biến **M3**): **dựng một điểm gọi MỚI trong một FILE MỚI** ⇒ lưới phải đỏ.
- ⚠⚠ **Khi hai bản sao của một vị từ trùng nhau dưới một bất biến, thêm ca test KHÔNG giải được — phải ĐỔI KIỂU** để phát biểu sai **không viết ra được**. Đã dùng thành công 4 lần.
- ⚠⚠ **Lưới nặn theo CHỮ KÝ của lỗi vừa rồi thì lần sau vẫn lọt.** Luật đúng nói **cái nó PHẢI LÀ**, không liệt kê cái nó không được chứa. Và **neo đúng NẤC** (neo vào *cái nút*, không vào biến trung gian), **đúng CÔNG CỤ HỎI** (AST, không so chuỗi).
- ⚠⚠ **Hỏi lại cho mọi cổng mới: "lưới DẪN người ta tới đâu?"** Một cổng có thể bắt đúng lỗi rồi **chỉ đường tới bản vá sai** và xác nhận là xong.
- ⚠ **Một hàm làm sạch DUY NHẤT, BẤT ĐỘNG `S(S(x)) === S(x)`.** Nay ở `shared/textSafety.ts`. **Đừng viết hàm thứ hai.** Regex kiểu `/<\|[^|]*\|>/g` **KHÔNG bất động** — phải xoá **lớp ký tự**.
- ⚠ **Dữ liệu KHÔNG BAO GIỜ nằm trong `defaultValue`** của i18next (`skipOnVariables` bảo vệ tham số tự do, **KHÔNG** bảo vệ khoá từ điển).
- ⚠ **`owner` là DANH TÍNH trên mặt LỆNH — KHÔNG được cắt ngắn ở đó.** Trên bề mặt PROMPT thì luật ngược lại (làm sạch + cắt + **khai đã cắt**). **Hai bề mặt, hai luật.**
- ⚠ **KHÔNG dựng người ghi/người đọc MỚI cho một bất biến ĐÃ CÓ CHỦ** — lớp lỗi này đẻ **ba Critical** trong chuỗi pha.
- ⚠ **KHÔNG** trainer, **KHÔNG** `kb:sync`, **KHÔNG** DDL/migration. **KHÔNG tự sinh sub-agent.**
- ⚠ **243+ mục bẩn của việc khác trong `git status`** — không đụng, không dọn, không stage.
- ⚠ **Nợ CÓ TRƯỚC, loại trừ tường minh, KHÔNG phải phát hiện:** `canUseAgentic({role:"engineer"})` đỏ (`AGENTIC_ROLES` không đổi) · flake `wiring.inprocess` + `visionControl.tools` (đã đóng hồ sơ: **hạ tầng**, riêng file thì xanh) · 16 file đỏ `server/routers/**` · 5 ca `server/services/programming/**` · 10 ca đỏ `server/services/ai/**` (`42501 permission denied for table product_inspections` + lệch dữ liệu seed).

**Cổng kiểm chung (đường dẫn tường minh):**
```
npx vitest run server/services/vram/ server/services/aiLocalTools/ \
  server/routers/vramRouter.test.ts server/routers/vramRouter.commands.test.ts \
  server/routers/vramRouter.retryDeferred.test.ts \
  server/routers/vramRouter.unledgered.test.ts server/routers/vramRouter.kbSyncDefer.test.ts \
  server/routers/permissions.machineControl.test.ts \
  server/routers/vramPermissionSplit.test.ts \
  server/routers/vramStepUpFreshness.test.ts \
  server/routers/deployStepUpFreshness.test.ts \
  server/routers/totpReplay.test.ts \
  server/routers/totpLedgerDurable.test.ts \
  server/routers/totpReplayScan.test.ts \
  server/routers/totpSeedWriteScan.test.ts \
  server/routers/verify2faPasswordStep.test.ts \
  server/routers/sessionGrantScan.test.ts \
  server/routers/userExposureScan.test.ts \
  server/_core/publicUser.test.ts \
  server/_core/backupCodeWriteScan.test.ts \
  server/_core/backupCodeWidth.test.ts \
  server/_core/xoayBiMatNguon.test.ts \
  server/routers/mustChangePassword.test.ts \
  server/_core/buocDoiMatKhau.test.ts \
  server/_core/xacThucNoiBo.test.ts \
  server/routers/appErrorParamsCoverage.test.ts \
  server/services/aiGgufEngine.test.ts \
  server/services/kbSyncScheduler.evalGate.test.ts \
  server/_core/authService.test.ts \
  server/api.test.ts \
  server/auth.sessionCacheLogout.test.ts \
  server/auth.setupAdmin.test.ts \
  server/db/authCacheHooks.test.ts \
  server/sdk.authCache.test.ts \
  server/services/authSessionCache.test.ts \
  server/services/aiCopilotActions.hardlinkSink.test.ts \
  server/services/aiAgentOrchestrator.authCtx.test.ts client/src/lib/
NODE_OPTIONS=--max-old-space-size=8192 npm run check
npm run check:tests
npm run i18n:check
```
Cộng một lượt `--sequence.shuffle.tests`.

⚠⚠⚠ **I-1 (review TOÀN NHÁNH 2026-08-06) — HAI ĐƯỜNG VỪA ĐƯỢC THÊM, VÀ ĐÓ KHÔNG PHẢI BẢN VÁ.**
Bản trước liệt kê **9 đường** và bỏ sót `vramPermissionSplit.test.ts` (**662 dòng — toàn bộ phép
cưỡng chế của Task 3b**) ⇒ **2/3 đột biến của reviewer SHIP ĐƯỢC** với cổng xanh 100%, `tsc` sạch,
`i18n:check` sạch. Commit `13116471` tên là *"cổng thiếu 3 file test"* và **vẫn** sót cái nặng nhất.
Lượt rà lại tìm thêm `aiCopilotActions.hardlinkSink.test.ts` (lưới **Task 1 / C-1**).
⇒ **Danh sách nào cũng có phần tử thứ N+1.** Nên bản vá thật là **`server/services/vram/vramPha5Gate.test.ts`**:
nó đọc **chính khối lệnh trên** ra khỏi file này, rồi cưỡng chế
***"MỌI `*.test.ts` tự khai `Pha 5` phải được một đường của cổng phủ"***, **ghim SỐ file**, và bắt
mọi đường không tồn tại trên đĩa. Thêm một lưới Pha 5 mới ở bất kỳ đâu ⇒ ca ấy **ĐỎ** cho tới khi
cổng được sửa. ⚠ Vẫn **KHÔNG dùng glob để CHẠY** — glob rỗng làm vitest im lặng khai XANH.

⚠⚠⚠ **Pha 7 Task 4a (2026-08-09) — DANH SÁCH BA PHẦN TỬ HOÁ RA LÀ MƯỜI, VÀ NAY CÓ LUẬT.**
Kế hoạch Pha 7 nêu **ba** file *"tự khai một pha nhưng nằm ngoài cổng"* (`appErrorParamsCoverage` ·
`aiGgufEngine` · `kbSyncScheduler.evalGate`, đo bởi reviewer Pha 6). **Phép đếm độc lập tại
`d7227094` cho MƯỜI** — bảy file `auth*`/`api` nữa **vừa gia nhập trong chính Pha 7 Task 9** (chúng
tự khai `Pha 7 Task 9`, và hai trong số đó mang **lượng từ R1** trên `SERVER_ONLY_USER_FIELDS`).
Tức danh sách ba phần tử đã có **phần tử thứ N+1** trước khi ai kịp đóng nó — lần thứ **MƯỜI BẢY**.
⇒ Mười đường đã thêm ở trên, **và** `vramPha5Gate.test.ts` nay cưỡng chế một luật **ĐẢO LƯỢNG TỪ**:
***MỌI `*.test.ts` TỰ KHAI một pha (mẫu `DAU_KHAI_PHA`) PHẢI được một đường của cổng phủ*** — suy ra
từ một lượt quét đĩa, không từ một danh sách. Phần tử thứ mười một tự làm cổng ĐỎ.

⚠⚠ **MỘT CA ĐỎ CÓ TRƯỚC ĐI KÈM `server/api.test.ts`** (đường mới thêm, **không** do Pha 7 gây ra):
`Factory Router › should reject non-admin from creating factory` chờ chuỗi **tiếng Anh**
`"Admin access required"` trong khi RBAC đã bản địa hoá từ **AI Sprint 5** (`Bạn không có quyền
create cho module "settings_factory"`). Hành vi sản phẩm **đúng** (vẫn từ chối); **kỳ vọng của ca
test đã cũ**. Cố ý **KHÔNG sửa** ở lượt này — sửa một lưới không liên quan để cổng xanh chính là
*"nắn lưới cho vừa mã"*. ⇒ Ghi vào §Nợ CÓ TRƯỚC; chủ dự án quyết định sửa hay bỏ ca ấy.

⚠⚠⚠ **NỢ MỚI DO CHÍNH LƯỢT TRẢ NỢ NÀY ĐẺ RA — VÀ ĐÃ TRUY ĐƯỢC GỐC RỄ.**
Thêm `server/auth.setupAdmin.test.ts` vào cổng làm **cả cổng dùng chung một DB test với một file
XOÁ SẠCH BẢNG `users`**:
```
server/auth.setupAdmin.test.ts:7-11   beforeEach:
    const allUsers = await db.getAllUsers();
    for (const user of allUsers) await db.deleteUser(user.id);   // ← XOÁ MỌI tài khoản
```
vitest chạy các file **song song**, nên nó xoá cả tài khoản mà file khác **vừa tạo và đang dùng**.
Đo được: hai lượt chạy cổng liên tiếp cho **hai nạn nhân KHÁC NHAU** —
`server/routers/totpReplay.test.ts` (lượt 1) và
`server/routers/mustChangePassword.test.ts › ĐỐI CHỨNG DƯƠNG …` (lượt 2, thông điệp
*"hash mới không được ghi vào `user_secrets`"*, `layBiMatNguoiDung()` trả `null` vì **hàng đã bị
xoá giữa chừng**). Cả hai **XANH khi chạy riêng**.
⇒ Đây **cùng một gốc** với nợ *"`totpReplay` — ca đỏ đổi mỗi lượt"* đã khai từ Pha 6: **không phải
`totp_consumed`**, mà là **một `beforeEach` xoá sạch `users`**.
⇒ **Đường sửa đề xuất (chưa làm — nằm ngoài phạm vi Task 4):** cho `setupAdmin` **chỉ xoá tài khoản
CHÍNH NÓ tạo** (lọc theo `username` tiền tố), hoặc cho file ấy chạy **cách ly**
(`describe.sequential` + một DB/schema riêng). **Không** nới cổng để né.

---

### Task 1: N13 — chặn NTFS hard link ở `read_project_file`

**Nợ:** 🟠 an ninh, **đo được**: đọc được **57 byte** bí mật ngoài workspace. Junction **thư mục** đã bị chặn (`PATH_REJECTED`); hard link lọt vì nó **không đổi realpath**, nên `realpathStillContained` thấy đường dẫn vẫn nằm trong workspace.

**Quyết định đã chốt:** **từ chối `nlink > 1`**. Đây là tool **ĐỌC mã nguồn** — file nguồn hầu như không bao giờ có hard link, nên tỉ lệ chặn nhầm rất thấp, và chặn nhầm thì hỏng theo chiều **AN TOÀN**.

**Files:**
- Modify: tìm bằng `git grep -n "PATH_REJECTED"` — hàm chứa `realpathStillContained` (thuộc nhóm `readToolsProgramming`)
- Test: file test cạnh nó; nếu chưa có thì tạo

- [ ] **Bước 1: đọc vị từ chứa-trong-workspace hiện tại.** Ghi lại nó kiểm những gì (junction thư mục **đã** bị chặn — đừng phá phần đó).
- [ ] **Bước 2: viết ca ĐỎ trước.** Dựng một hard link thật tới một file ngoài workspace, gọi `read_project_file` **từ đầu đường**, khẳng định **bị từ chối** và **0 byte nội dung** trả về.
  ⚠ Nếu môi trường không dựng được hard link thì **ghi rõ vì sao** và dùng cách khác chứng minh vị từ chạy — **không** được bỏ qua im lặng.
- [ ] **Bước 3: chạy để xác nhận ca ĐỎ.** Nếu nó xanh ngay thì hoặc lỗ đã đóng, hoặc ca không chạm đúng đường — **điều tra, đừng đi tiếp**.
- [ ] **Bước 4: cài phép chặn.** Một lượt `stat`, `nlink > 1` ⇒ từ chối với **cùng mã từ chối đã có** (đừng đẻ mã mới nếu mã cũ đúng nghĩa). Câu từ chối phải nói **vì sao**, không chỉ "bị chặn".
- [ ] **Bước 5: chạy ca xanh + đối chứng DƯƠNG.** Một file nguồn **bình thường** trong workspace phải **vẫn đọc được** — nếu không có đối chứng dương thì "chặn hết" cũng là xanh.
- [ ] **Bước 6: đột biến.** Gỡ phép chặn ⇒ ca đỏ. Và **đổi vị từ thành `nlink >= 1`** (chặn mọi file) ⇒ **đối chứng dương phải đỏ**.
- [ ] **Bước 7: commit.**

**Cổng ra:** hard link **bị chặn**, file thường **vẫn đọc được**, hai đột biến đều đỏ.

---

### Task 2: N8 — siết `vram.state` lên `machine_control/canView`

**Nợ:** 🟡 hai mặt đọc trả lời **khác nhau** cho cùng một câu hỏi: `vram.state` là `protectedProcedure` (mọi user đăng nhập) trong khi `get_vram_state` đòi `machine_control/canView`.

**Quyết định đã chốt:** **siết ROUTER lên bằng TOOL.** Lý do: mặt đọc phơi `processKey`, `owner`, tên model — **thông tin hạ tầng**, và từ Pha 3 thì `owner` có thể do **một tiến trình khác** ghi vào.

**Files:**
- Modify: `server/routers/vramRouter.ts`
- Test: `server/routers/vramRouter.test.ts`

- [ ] **Bước 1: đọc `server/_core/trpc.ts` và một tiền lệ.** `fleetRouter` chain `requirePermission` ở **19/19** thủ tục actuation; `trpc.ts` viết thẳng role-floor *"composes ON TOP of (never replaces)"*. Dùng **đúng khuôn đó**.
- [ ] **Bước 2: viết ca ĐỎ.** Một vai **không có** `machine_control/canView` gọi `vram.state` ⇒ phải **bị từ chối**. Và ca đối chứng: vai **có** quyền ⇒ **nhận dữ liệu thật khác rỗng**, nêu **một giá trị cụ thể**.
  ⚠ **Nếu cả hai lượt cùng rỗng thì không phân biệt được** — đúng lớp lỗi đã để tool chết mà 215/215 vẫn xanh.
- [ ] **Bước 3: chạy để xác nhận ca ĐỎ.**
- [ ] **Bước 4: chain `requirePermission`.** Không xoá role-floor đang có — **cộng lên trên**.
- [ ] **Bước 5: chạy toàn bộ `vramRouter.test.ts`.** ⚠ Siết quyền sẽ làm **các ca cũ dựng cảnh bằng vai thấp** đỏ — sửa **cảnh của ca**, **đừng** nới lại cổng.
- [ ] **Bước 6: đối chiếu mọi người đọc phía client.** `git grep "vram.state"` — nếu một màn đang gọi nó bằng vai không đủ quyền thì màn đó **sẽ vỡ**. Ghi rõ màn nào, vai nào.
- [ ] **Bước 7: đột biến.** Gỡ `requirePermission` ⇒ ca đỏ.
- [ ] **Bước 8: commit.**

**Cổng ra:** hai mặt đọc **cùng một mức quyền**; vai đủ quyền **nhận dữ liệu thật khác rỗng**; đột biến đỏ.

---

### Task 3: N9 — `vramCommandReach` cho hai nút phá huỷ (thêm `supervisor`)

**Nợ:** 🟡 `canCommand = admin || engineer` ở `client/src/components/ai/AIBrainDashboard.tsx:108` — **thiếu `supervisor`**, **thừa `engineer`**.

**Quyết định đã chốt:** **thêm `supervisor`.**

⚠ **Hệ quả tất yếu, nêu rõ để không ai tưởng là vượt phạm vi:** máy chủ chặn `engineer` **độc lập** (role-floor + `canDelete` + step-up — đã nghiệm thu sống ở lượt **C3**: engineer **có OTP tươi** vẫn 403). Nên áp kỷ luật *"một ô DUY NHẤT quyết định nút, và nó là một LỜI GỌI"* thì **`engineer` biến mất theo** — đó **không phải** một quyết định thêm, mà là **hệ quả của việc thôi nói dối**. Nếu chủ dự án muốn giữ `engineer` thì phải **nới máy chủ**, và đó là một quyết định khác.

⚠ Đây **đúng lớp lỗi "mặt đọc hứa nhiều hơn mặt lệnh"** đã đóng ở tầng kiểu (`reclaimable`) rồi **hở lại ở tầng UI** (`canRetry` với một dấu `||`).

---

#### 🔴 CHẶN TRƯỚC KHI TASK 3 CHẠY — I-2 (phát hiện ở review Task 2, ghi vào đây vì `.superpowers/` bị **gitignore** ⇒ không có địa chỉ bền)

**`supervisor` KHÔNG MỞ ĐƯỢC MÀN, VÀ KHÔNG ĐỌC ĐƯỢC MỘT SỐ NÀO.** Bật hai nút phá huỷ cho một vai
không vào được màn là dựng một cái nút **không ai bấm được** — và tệ hơn, là **khai rằng đã trao
quyền** trong khi chưa.

**NĂM lớp** phải chốt **MỘT LƯỢT**, không lớp nào một mình đủ. (Bản đầu của khối này đếm **bốn** —
lớp 3 do re-review tìm thêm, và nó là lớp **âm thầm nhất**.)

1. **nav-role** — `client/src/lib/navigation.tsx:1374-1383`: `/ai-brain` khai
   `requiredRole: ['admin','engineer']` ⇒ **`supervisor` không thấy, không vào được**.
   Đối chứng đã có: `client/src/lib/navigation.unit.test.ts:54,61`.
2. **grant ĐỌC** — sau Task 2, `vram.state` đòi `machine_control/canView`. Module `machine_control`
   **chưa từng được seed cho bất kỳ vai nào** (`scripts/seed-all-modules.ts:158-185`); `admin` qua
   được **chỉ nhờ short-circuit** (`server/_core/accessControl.ts:135-137`). ⇒ `supervisor` (và
   `engineer`) **đọc không được một số nào** trên chính panel chứa hai nút đó.
3. ⚠⚠ **`isOpsRole` — LỚP THỨ NĂM, và nó vô hiệu hoá Task 3 một cách hoàn toàn im lặng.**
   `client/src/pages/AIBrainDashboard.tsx:114` `const isOpsRole = user?.role === "admin" || user?.role === "engineer"`
   → `:311` `<VramBrokerPanel canCommand={isOpsRole} …>` → nuôi **CẢ BA nút**
   (`VramBrokerPanel.tsx:332`, `:358`, `:409`).
   ⇒ Task 3 có viết `vramCommandReach` hoàn hảo đến đâu thì **`supervisor` vẫn KHÔNG BAO GIỜ nhận
   `canCommand === true`** — vị từ mới sẽ được gọi với một tham số đã bị một biểu thức **ở màn cha**
   khoá chết. Đây đúng lớp lỗi *"neo sai một nấc"*: sửa vị từ mà không sửa **cái nuôi nó**.
4. **`vramCommandReach`** — vị từ UI của Task 3.
5. **grant LỆNH** — `preempt`/`releaseStale` đứng trên `deployProcedure` +
   `requirePermission("machine_control","canDelete")` (`server/routers/vramRouter.ts:67`).
   `supervisor` **có** trong `ACTUATION_ROLES` nhưng **không có bit `canDelete`** ⇒ vẫn 403.

#### QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (2026-08-06)

1. **Làm CẢ NĂM lớp** — `supervisor` phải **dùng được thật**, không chỉ "thấy nút":
   mở nav `/ai-brain` · cấp `machine_control/canView` · sửa `isOpsRole` · `vramCommandReach` ·
   cấp `machine_control/canDelete`.
2. **Cấp `machine_control/canView` cho `engineer`** (⇒ đọc được trạng thái VRAM), **KHÔNG** cấp
   `canDelete` (⇒ engineer **không** ra lệnh phá huỷ). Điều này đồng thời đóng hồi quy mà Task 2
   tạo ra ở tầng trải nghiệm: sau khi siết `vram.state`, engineer đang thấy câu
   *"Không đủ quyền xem trạng thái VRAM"* trên `/ai-brain`.

⚠⚠ **HAI MỤC QUYỀN LÀ *DỮ LIỆU*, KHÔNG PHẢI MÃ** — chúng là hàng trong bảng `permissions` (hoặc một
lượt sửa seed). **Task 3 KHÔNG được tự chạy DDL/migration/seed.** Chúng cần **một lượt RIÊNG có chủ
dự án duyệt**, và lượt ấy phải chạy **trước** khi nghiệm thu sống Task 3 — nếu không, nút bật lên
rồi vẫn 403, tức lại **hứa nhiều hơn làm được**.

**Files:**
- Create: một module vị từ thuần (đặt cạnh `client/src/lib/vramPanelStepUp.unit.test.ts` — theo đúng khuôn `vramRetryButtonEnabled()` đã có)
- Modify: `client/src/components/ai/AIBrainDashboard.tsx` · `client/src/components/ai/VramBrokerPanel.tsx`
- Test: file test cạnh module vị từ

- [ ] **Bước 1: đọc `vramRetryButtonEnabled()` và lưới của nó.** Đó là khuôn **đã được reviewer chấm "luật đúng"** — vét cạn theo **KIỂU**, `unknown ⇒ false` chiều chặt, tách module **thuần**. Làm y hệt.
- [ ] **Bước 2: viết ca ĐỎ.** `supervisor` ⇒ nút **bật**; `engineer` ⇒ nút **tắt**; `operator` ⇒ **tắt**; `admin` ⇒ **bật**.
- [ ] **Bước 3: chạy để xác nhận ĐỎ.**
- [ ] **Bước 4: cài vị từ + nối vào cả hai nút phá huỷ.**
- [ ] **Bước 5: lưới neo ĐÚNG NẤC.** Bất biến: ***"`disabled` của mỗi nút phá huỷ PHẢI LÀ một lời gọi vị từ này"*** — trên **AST**, neo vào **cái nút**, **không** vào biến trung gian, **không** liệt kê toán tử bị cấm.
- [ ] **Bước 6: đột biến — SÁU hình dạng lách.** biến trung gian · `?:` · `&&` · `??` · hằng · hàm khác. **Và một hình dạng thứ bảy do bạn tự nghĩ ra**, khác hẳn sáu cái trên. Tất cả phải đỏ.
- [ ] **Bước 7: đột biến ngược.** Bọc nút trong một điều kiện render ⇒ phải đỏ. ⚠ Coi chừng lưới **quá rộng** bắt nhầm cổng nạp — thu phạm vi về từ `ArrowFunction` gần nhất trở xuống.
- [ ] **Bước 8: commit.**

**Cổng ra:** `supervisor` bấm được, `engineer` **không**; bảy hình dạng lách đều đỏ; lưới không bắt nhầm cổng nạp.

---

### Task 4: N10 — bề mặt Agent đủ BA ngôn ngữ

**Nợ:** 🟡 `tomTat()` trong `server/services/aiLocalTools/vramTools.ts` **chỉ tiếng Việt** (~25 câu). `lang` hiện **chỉ** điều khiển câu `DENY`.

**Files:**
- Modify: `server/services/aiLocalTools/vramTools.ts` · ba file locale
- Test: `server/services/aiLocalTools/vramTools.promptSafety.test.ts` (mở rộng) + file mới nếu cần

- [ ] **Bước 1: đếm và liệt kê.** `git grep` mọi chuỗi tiếng Việt trong `tomTat()`. **Ghi con số** vào báo cáo — một danh sách không có số là một danh sách không ai kiểm được.
- [ ] **Bước 2: đọc khuôn i18n phía máy chủ.** ⚠ Task 3 của Pha 4 dựng 8 hàm `translateVram*` ở `client/src/lib/errorCodes.ts`; hàm làm sạch đã dời xuống `shared/textSafety.ts`. **Kiểm xem máy chủ dịch bằng đường nào** trước khi viết — **đừng đẻ đường thứ hai**.
- [ ] **Bước 3: viết ca ĐỎ.** Cùng một trạng thái VRAM, ba `lang` ⇒ **ba câu khác nhau**, và **không câu nào còn ký tự tiếng Việt** khi `lang` là `en`/`zh`.
- [ ] **Bước 4: chạy để xác nhận ĐỎ.**
- [ ] **Bước 5: dịch.** ⚠ **Câu đúng mà VÔ DỤNG vẫn là hỏng** — đây là bề mặt cho **Agent**, nên mỗi câu phải nói **hành động tiếp theo**, không lặp lại mã bằng ngôn ngữ khác.
- [ ] **Bước 6: cổng vét cạn.** Thêm mã kết cục / thêm câu mà **quên dịch một ngôn ngữ** ⇒ **phải đỏ**. ⚠ Dùng `i18n.exists(..., { lng, fallbackLng: false })` — **thiếu `fallbackLng: false` thì `zh` mượn `vi` rồi khai "tồn tại"**.
  ⚠ **Hỏi lại:** cổng này **DẪN người ta tới đâu**? Nếu phản ứng tự nhiên với nó là *"khai một khoá rỗng"* thì nó chưa đóng.
- [ ] **Bước 7: đột biến.** Xoá một khoá khỏi **một** locale ⇒ đỏ · xoá khỏi **cả ba** ⇒ đỏ · thêm một câu mới không dịch ⇒ đỏ.
- [ ] **Bước 8: `npm run i18n:check` 0 lệch. Commit.**

**Cổng ra:** ba ngôn ngữ, không rớt về `vi`, cổng vét cạn đỏ đúng ba đột biến.

---

### Task 5: N11 + N12 + N14 — mặt đọc: cắt tại nguồn · `owner` thật · lưới canh TÊN

Ba mục **cùng đụng `server/services/vram/vramReadModel.ts`**, nên đi chung một task để không giẫm chân.

**Files:**
- Modify: `server/services/vram/vramReadModel.ts` · `client/src/components/ai/VramBrokerPanel.tsx` (cho N12)
- Test: `server/services/vram/vramReadModel.roster.test.ts` (đã có từ Pha 4)

**N11 — cắt tại nguồn, KHÔNG phá mặt danh tính**
- [ ] **Bước 1:** đọc lại luật **hai bề mặt, hai luật**. Phần **nguy hiểm đã trả** ở Pha 4 (bề mặt câu chữ). Còn lại là cắt **tại nguồn** — ⚠ làm ngây thơ sẽ **phá mặt DANH TÍNH** (`owner` Agent lấy từ mặt đọc rồi truyền thẳng vào lệnh).
- [ ] **Bước 2:** viết ca ĐỎ khoá **cả hai chiều**: trường **danh tính** phải **nguyên vẹn**; trường **hiển thị** phải **bị cắt và KHAI đã cắt**.
- [ ] **Bước 3:** cài. Dùng `catChuoi()` đã có ở `shared/`, **không** viết hàm thứ hai.
- [ ] **Bước 4:** đột biến — cắt cả trường danh tính ⇒ ca đỏ; bỏ cờ khai-đã-cắt ⇒ ca đỏ.

**N12 — `owner` THẬT trong `defer.hosts` (đổi kiểu)**
- [ ] **Bước 5:** panel đang gửi `h.host` làm `owner` cho `retryDeferred` ⇒ **4/6 hộ** trả `unknown-background-host`. Gốc: `ownerPattern` là một **MẪU**, không phải một **danh tính**.
- [ ] **Bước 6:** **ĐỔI KIỂU** để phát biểu sai **không viết ra được** — thêm ô `owner` thật, và làm cho việc truyền một *mẫu* vào chỗ đòi *danh tính* bị `tsc` chặn.
- [ ] **Bước 7:** đột biến — truyền `ownerPattern` vào chỗ đòi `owner` ⇒ **`tsc` phải ĐỎ** (đây là phép thử của "đổi kiểu", không phải "thêm test").

**N14 — lưới roster canh TÊN, không chỉ canh DÂN SỐ**
- [ ] **Bước 8:** đo được ở Pha 4: đột biến **đổi TÊN** một hộ ⇒ **4/4 vẫn XANH**, vì **cả hai vế suy ra từ CÙNG MỘT BẢNG**.
  ⚠ Đây **đúng lớp "hai bản sao của một vị từ trùng nhau dưới một bất biến"** — thêm ca **không giải được**. Vế đối chiếu phải đến từ **một nguồn ĐỘC LẬP** (quét mã sản xuất), không từ chính bảng khai.
- [ ] **Bước 9:** đột biến — **đổi tên** một hộ ⇒ ca đỏ · **xoá** một hộ ⇒ ca đỏ · **thêm** một hộ chỉ ở một vế ⇒ ca đỏ.
- [ ] **Bước 10: commit.**

**Cổng ra:** danh tính nguyên vẹn + hiển thị cắt-có-khai · `tsc` chặn mẫu-vào-chỗ-danh-tính · lưới roster đỏ khi **đổi tên**.

---

## 🔴 THỨ TỰ PHÁT HÀNH — **BA NHỊP**, RÀNG BUỘC CỦA TASK 3 (N9) + TASK 3b, KHÔNG PHẢI MỘT LỜI KHUYÊN

> ⚠⚠⚠ **I-5 (review TOÀN NHÁNH 2026-08-06) — CÂU LỆNH HAI NHỊP DƯỚI ĐÂY ĐÃ LỖI THỜI TỪ TASK 3b.**
> Nó được viết ở review Task 2/Task 3, khi bit còn là `machine_control` — một module **đã có sẵn**
> trong danh mục. **Task 3b đổi tiền đề** mà không ai sửa lại câu lệnh:
> 1. `vram_control` chỉ xuất hiện trong danh mục quyền qua **một hàng MÃ MÁY CHỦ**
>    (`server/routers/permissionsRouter.ts:825`), trả về bởi `permissions.getAvailableModules`.
> 2. `client/src/components/PermissionsManagement.tsx:123` lấy danh sách module **CHỈ** từ thủ tục ấy.
> ⇒ **Chưa deploy máy chủ thì màn Phân quyền KHÔNG hiện `vram_control`, và admin KHÔNG CẤP ĐƯỢC**
> (trừ khi gọi tay `permissions.upsertPermission` — nó nhận `moduleName` là chuỗi tự do, `:574`).

### ⇒ THỨ TỰ ĐÚNG LÀ **BA NHỊP**: **deploy MÁY CHỦ → CẤP QUYỀN → deploy CLIENT.**

| nhịp | việc | kiểm ĐO ĐƯỢC trước khi sang nhịp sau |
|---|---|---|
| **1** | **Deploy MÁY CHỦ** (chưa deploy client) | `permissions.getAvailableModules` trả về một hàng `moduleName='vram_control'` |
| **2** | **Cấp quyền per-USER** (xem bảng dưới) | `SELECT * FROM permissions WHERE "moduleName"='vram_control'` ⇒ đúng số hàng đã duyệt |
| **3** | **Deploy CLIENT** | `supervisor` vào `/ai-brain` thấy SỐ THẬT, hai nút bấm được, lệnh chạy |

⚠⚠⚠ **BA ĐƯỜNG XOÁ SẠCH GRANT — `vram_control` CỐ Ý KHÔNG VÀO KHUÔN VAI nên KHÔNG đường nào tự
dựng lại nó:**
1. `permissions.applyRolePermissions` / nút **"Áp dụng quyền mặc định"** (đã ghi ở sổ nợ Task 3b);
2. `permissions.applyBuiltInRoleToUser`;
3. ⚠ **MỚI (I-5) — nút *Lưu* của chính màn Phân quyền.** `PermissionsManagement.tsx:126` gọi
   `permissions.batchUpdateUserPermissions`, và thủ tục đó **`DELETE` TOÀN BỘ hàng quyền của user**
   rồi chèn lại đúng những gì màn hình đang giữ (`permissionsRouter.ts:663-686`). ⇒ **Bất kỳ lượt
   lưu nào từ một màn không liệt kê `vram_control`** — một tab mở từ TRƯỚC nhịp 1, hoặc một phiên
   admin cũ — sẽ **âm thầm gỡ** grant vừa cấp, **không một cảnh báo nào**.
⇒ Sau **mỗi lượt bảo trì vai / mỗi lượt lưu ở màn Phân quyền**, chạy lại câu kiểm của nhịp 2.

---

**(nguyên văn ràng buộc cũ, giữ lại vì phần dưới vẫn đúng)** — **LƯỢT CẤP QUYỀN CHẠY TRƯỚC ·
CLIENT DEPLOY SAU.** (I-2, review Task 3, 2026-08-06.)

Task 3 (commit `d4083386`+) làm **ba** lớp ở tầng mã — nav `/ai-brain` · `vramCommandReach` · nối
vào ba nút — nhưng **hai** lớp còn lại là **DỮ LIỆU** và **chưa cấp**:

| lớp | hàng cần vật chất hoá | tình trạng |
|---|---|---|
| 2 — đọc | `machine_control.canView` cho **user** vai `supervisor` **và** `engineer` | ❌ chưa |
| 5 — lệnh | `machine_control.canDelete` cho **user** vai `supervisor` | ❌ chưa |

⚠⚠ **`DEFAULT_ROLE_PERMISSIONS` (`server/routers/permissionsRouter.ts`) chỉ là KHUÔN ĐỂ ÁP — sửa nó
KHÔNG tự mở quyền cho ai.** Cưỡng chế đọc bảng `permissions`, và bảng ấy là **per-USER**
(`accessControl.checkPermission` khớp `permissions.userId` + `moduleName`). ⇒ Đường đúng là **cấp
per-user** (`permissions.applyBuiltInRoleToUser` hoặc INSERT có duyệt). Nếu đổi **khuôn** thì phải
đổi cả lưới khoá `server/routers/permissions.machineControl.test.ts:32`
(`supervisor → canDelete:false`) — đó là một **quyết định RBAC toàn hệ**, không riêng VRAM.

**Vì sao thứ tự này là bắt buộc, không phải khẩu vị:** deploy client trước lượt cấp quyền thì
`supervisor` vào `/ai-brain` và thấy **hai nút phá huỷ bấm được mà lệnh chắc chắn 403** — tức
**chính lớp lỗi "mặt đọc hứa nhiều hơn mặt lệnh" mà cả Pha 5 đang đóng**, do chính bản vá đóng nó
tạo ra. Cửa sổ ấy phải bằng **không**.

🔴 ⚠⚠⚠ **I-4 (review TOÀN NHÁNH 2026-08-06) — CHẶN NHỊP 2: NỬA "BIT ĐỌC" CỦA LƯỢT CẤP QUYỀN CHƯA
AI ĐẾM, VÀ NÓ MỞ 30 THỦ TỤC NGOÀI VRAM.**
Task 3b đếm bit **GHI** rất kỹ (`machine_control/canDelete` = 10 thủ tục / 8 router ⇒ tách bit) và
**không đếm bit ĐỌC**, dù mặt đọc là **nửa còn lại của cùng một lượt cấp quyền**. Đếm lại bằng AST:
`machine_control/canView` = **31 thủ tục / 9 router**, **31/31 đứng trên `protectedProcedure` trần**
(không role-floor, không 2FA). VRAM chiếm **1**; **30 cái còn lại** là công thức máy, trạng thái
robot, **nhật ký lệnh máy**, cấu hình device adapter, ánh xạ UNS, điều phối AI.
⇒ **KHÔNG TỰ QUYẾT.** Bảng đầy đủ 31 dòng (router · thủ tục · sàn · hậu quả) ở
`docs/superpowers/reports/2026-08-06-vram-pha5-wholebranch-fix-report.md` §I-4 — **phải tới tay chủ
dự án TRƯỚC nhịp 2**. Câu biện hộ của N8 (*"`canView` là bit chỉ đọc, bề mặt dùng chung của nó không
có thủ tục phá huỷ nào"*) **đúng về `canDelete`** nhưng **không trả lời** câu mà chính Task 2 dùng để
siết `vram.state`: *"mặt đọc phơi thông tin hạ tầng"* — `commandLogRouter` phơi **nhật ký lệnh máy**.
⚠ Nếu chủ dự án chọn **tách nốt bit đọc** thì phải đổi **CÙNG LÚC** `requiredPermission` của tool
`get_vram_state` (`server/services/aiLocalTools/vramTools.ts:455`), nếu không **khe N8 mở lại**.
Lưới `server/services/vram/vramReadModel.guard.test.ts:223` sẽ **ĐỎ đúng lúc** nếu chỉ đổi một bên —
lưới ấy **có răng** và **nằm trong** cổng.

⚠ **Trước khi bấm nút cấp `canDelete`, đọc §2 của `task-3-review.md`:** `machine_control/canDelete`
là bit **DÙNG CHUNG** — có **10 thủ tục ở 8 router** đứng trên nó (nguy hiểm nhất:
`programming.deleteProject`). Cấp cho `supervisor` để thu hồi VRAM **cũng** mở cả tập ấy. Đây là một
quyết định phải nói ra, không phải một hệ quả tình cờ.

---

## Sau khi xong 5 task

- **Review TOÀN NHÁNH** trên model mạnh nhất. ⚠ **Bảy pha liên tiếp, lượt này bắt được thứ review-theo-task KHÔNG THỂ bắt** — đừng bỏ.
- Lăng kính cho lượt đó: **"an toàn là HỆ QUẢ của một thứ khác đang hỏng"** (đã xuất hiện **ba** lần ở Pha 4 — tìm lần thứ tư) · **"lưới xanh vì lý do sai"** (12 lần) · **"mặt đọc hứa nhiều hơn mặt lệnh"**.
- Push · ghi memory · đối chiếu lại danh sách nợ: mục nào **đóng**, mục nào **còn**, mục nào **mới sinh ra từ chính lượt trả nợ này**.

---

### Task 3b: TÁCH BIT QUYỀN RIÊNG CHO VRAM (quyết định chủ dự án 2026-08-06)

**Vì sao có task này.** Review Task 3 **đếm được**: `machine_control/canDelete` là bit **DÙNG CHUNG cho 10 thủ tục ở 8 router**, và **8/10 KHÔNG có 2FA/role-floor** (`protectedProcedure` trần). Hai nút VRAM lại là **hai cái CHẶT NHẤT** (`deployProcedure` = role-floor + 2FA + OTP tươi).

⚠ **Nguy hiểm nhất, đích danh:** `programming.deleteProject` (`server/routers/programmingRouter.ts:261`) — xoá **cascade** `programSimRuns → programBuilds → programArtifacts (mã nguồn có phiên bản) → programSymbols → programProjects`, **không chốt an toàn, không OTP**. Cộng **5 bề mặt UI** sẽ hiện nút xoá **ngay khi cấp**.

⇒ Cấp bit dùng chung cho `supervisor` để mở **hai nút VRAM** sẽ mở **chín thủ tục khác** — trong đó có xoá mã nguồn. **Chủ dự án chốt: TÁCH BIT RIÊNG.**

**Cổng ra:** `supervisor` thu hồi được VRAM **mà KHÔNG** với tới `programming.deleteProject` hay 8 thủ tục còn lại.

- [ ] **Bước 1: đếm lại và ghi bảng.** `git grep` mọi thủ tục đứng trên `machine_control/canDelete` — **ghi đủ 10**, mỗi dòng: router, thủ tục, có 2FA không, hậu quả nếu vai sai chạm tới. ⚠ **Đừng tin con số trong tài liệu này** — tự đếm.
- [ ] **Bước 2: chọn hình dạng bit mới và VIẾT LÝ DO.** Hai đường: (a) một `action` mới trong `machine_control`; (b) một module quyền riêng. ⚠ Đọc `server/_core/trpc.ts` + `permissionsRouter.ts` **trước khi chọn** — khuôn hiện có quyết định đường nào rẻ hơn. Nêu đường **không chọn** và vì sao.
- [ ] **Bước 3: ca ĐỎ trước.** `supervisor` **có** bit VRAM mới ⇒ `preempt`/`releaseStale` **QUA cổng quyền**; **cùng** `supervisor` đó ⇒ `programming.deleteProject` **VẪN BỊ TỪ CHỐI**. ⚠ Ca thứ hai là **cổng ra thật sự** của task — không có nó thì "tách bit" chưa chứng minh được gì.
- [ ] **Bước 4: cài bit mới**, đổi `vramRouter.ts:66-70` sang nó. ⚠ **Giữ nguyên** `deployProcedure` + step-up 2FA — task này **thu hẹp** quyền, **không nới** cái gì.
- [ ] **Bước 5: `vramCommandReach` đọc bit MỚI**, không đọc `canDelete` nữa. Lưới của Task 3 phải **vẫn xanh**.
- [ ] **Bước 6: đột biến.** Trả `vramRouter` về `canDelete` ⇒ ca đỏ · cấp bit VRAM rồi thử `programming.deleteProject` ⇒ **phải TỪ CHỐI**, ca đỏ nếu qua · gỡ step-up ⇒ ca đỏ.
- [ ] **Bước 7:** khai **chính xác** hàng quyền cần cấp (per-user, **không** đổi khuôn — bảng `permissions` là per-USER nên đổi khuôn cũng không tự mở quyền). **KHÔNG chạy DDL/seed trong task.**
- [ ] **Bước 8: commit.**

⚠ **THỨ TỰ PHÁT HÀNH (I-2):** lượt **cấp quyền chạy TRƯỚC**, **client deploy SAU**. Ngược lại thì supervisor thấy hai nút **chắc chắn 403** — đúng lớp lỗi *"mặt đọc hứa nhiều hơn mặt lệnh"* mà cả Pha 5 đang đóng.
