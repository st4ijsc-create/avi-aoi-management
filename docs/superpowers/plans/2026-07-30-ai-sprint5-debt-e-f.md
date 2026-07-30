# Sprint 5 — Trả nợ nhóm E + F (17 mục) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng 17 mục nợ mà review toàn cục của hai plan trước ghi lại, trong đó quan trọng nhất là biến 1061 mã lỗi máy chủ thành giá trị thật cho người dùng (hiện chỉ 15% màn hình hưởng lợi).

**Architecture:** Ba khối độc lập. (1) Đường cảnh báo — chặn `-Infinity` tại nguồn, cho nhóm không-gắn-máy một van, vá vài chỗ nhỏ. (2) Chất lượng mã lỗi — không gian từ điển `errors.reason.*` để thôi nuốt chỉ dẫn hành động, dọn hợp đồng chết, sửa bản dịch. (3) Đường giao hàng — di trú 446 handler client sang `mapTrpcError` + cổng chặn, rồi quét nốt `throw new Error` và các file ngoài `server/routers/`.

**Tech Stack:** TypeScript · Drizzle ORM · tRPC v11 · vitest · React 19 + react-i18next

## Global Constraints

- **Nguồn nợ:** `docs/superpowers/specs/2026-07-29-ai-sprint5-backlog-consolidated.md` §4b (nhóm E) và §4c (nhóm F). Mỗi mục ở đó có file:dòng cụ thể do reviewer đo — dùng làm nguồn sự thật, nhưng **tự đo lại** trước khi sửa vì mã đã đổi.
- **Câu hiện cho người vận hành phải ĐÚNG SỰ THẬT.** Lớp lỗi này đã bị bắt 5 lần ở 5 task khác nhau trong sprint. Đọc **điều kiện `if` bao quanh**, không chỉ đọc chuỗi. Nếu không mã nào nói đúng, thà để nguyên và báo lại.
- **Tham số tự-do phải là khoá camelCase** qua từ điển (`errors.entity/operation/field/feature/action/*`), KHÔNG phải câu tiếng Anh hay tiếng Việt.
- **GIỮ NGUYÊN mã tRPC** của từng chỗ trừ khi task nói rõ khác.
- Ba cổng phải luôn xanh: `appErrorCoverage.test.ts` · `appErrorParamsCoverage.test.ts` · `appError.test.ts`.
- **KHÔNG `git add -A` / `git add -u`.** Cây làm việc có nhiều việc dở của người khác (`knowledge/*`, `tools/machine-simulator/*`, ảnh chụp màn hình). Chỉ `git add` file đích thân sửa, liệt kê tên.
- Chạy test: `npx vitest run <path>`. Kiểm kiểu: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`. i18n: `npm run i18n:check`.
  Lỗi tiền tồn tại đã biết, KHÔNG phải do plan này: `client/src/pages/SessionManagement.tsx:194` · 3 file `server/db/*.db.test.ts` · ~13-19 file đỏ khi chạy cả `server/routers/` (tranh chấp DB song song).
- Test và comment viết **tiếng Việt**.
- **Không chạy hai implementer song song.**

## Quyết định của chủ dự án (đã chốt 2026-07-30)

| # | Câu hỏi | Chốt |
|---|---|---|
| E2 | Cảnh báo không có `machineId` xử lý sao? | **Gộp theo `consolidationKey`, cùng luật với cảnh báo gắn máy** — mức tăng/CRITICAL vẫn xuyên qua, còn lại cooldown 4h |
| F1 | Di trú bao nhiêu handler client? | **Toàn bộ 446** + cổng chặn |

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `server/services/predictiveMaintenanceService.ts` | **Sửa** — chặn `-Infinity` tại NGUỒN | 1 |
| `server/services/aiSmartAlertRouter.ts` | **Sửa** — cooldown nhóm không-máy · stamp sau gửi · log env · throttle warn | 2, 3 |
| `server/routers/alarmKpiRouter.ts` | **Sửa** — lọc MIN theo line/machine | 3 |
| `client/src/i18n/locales/{vi,en,zh}.json` | **Sửa** — `errors.reason.*`, sửa dịch, dọn khoá chết | 4, 5 |
| `client/src/lib/errorCodes.ts` | **Sửa** — thêm `reason` vào `localizeParams` | 5 |
| `server/_core/appErrorCodes.ts` | **Sửa** — dọn hợp đồng chết trong comment | 4 |
| `client/src/i18n/index.ts` | **Sửa** — F8 fallback ngôn ngữ | 6 |
| `client/src/lib/trpcErrors.ts` | **Sửa** — nếu cần cho cổng client | 7 |
| `client/src/**` (159 file) | **Sửa** — 446 handler `onError` | 7, 8 |
| `client/src/lib/clientErrorCoverage.unit.test.ts` | **Tạo** — cổng chặn handler | 7 |
| `server/routers/**` (20 file) | **Sửa** — 75 `throw new Error` | 9 |
| `server/_core/*`, `server/services/*`, `server/utils/*` | **Sửa** — 64 chỗ / 13 file | 10 |
| `server/services/authService.ts` | **Sửa** — F9 side-channel | 11 |

---

## Task 1 — E1: chặn `-Infinity` tại NGUỒN (ưu tiên cao nhất nhóm E)

**Files:** Modify `server/services/predictiveMaintenanceService.ts` (khoảng `:505-523`) · Test `server/services/predictiveMaintenanceService.rul.test.ts` (tạo mới nếu chưa có)

**Vì sao trước hết:** B1 đã chặn `-Infinity` ở **cổng phát**, nhưng ở **nguồn** nó vẫn được sinh ra: `Math.round(-Infinity)` giữ nguyên `-Infinity`, và `recommendedMaintenanceDate = new Date(-Infinity)` là **Invalid Date** vẫn đi vào `recordMachineHealthSnapshot`. Reviewer đánh giá Invalid Date đưa xuống drizzle/postgres-js có thể **ném `RangeError`** — tức đây có thể là đường sập, không chỉ dữ liệu bẩn.

- [ ] **Step 1: Đo trước** — đọc `:490-530`, tìm mọi phép chia có thể ra `±Infinity`/`NaN` trong ước lượng RUL. Ghi danh sách vào report.
- [ ] **Step 2: Viết test đỏ** — dựng đầu vào khiến `timeframeHours` ra `-Infinity`, assert: `predictedTimeframeHours` là `null` (không phải `-Infinity`), `recommendedMaintenanceDate` là `null` (không phải Invalid Date), và `rulMethod` phản ánh trung thực (`insufficient_data` hoặc tương đương). Chạy, xác nhận ĐỎ.
- [ ] **Step 3: Chặn tại nguồn** — bọc `Number.isFinite()` quanh phép chia RUL; giá trị không hữu hạn ⇒ coi như không ước lượng được (`null`), KHÔNG phải 0 và KHÔNG phải `-Infinity`. Ghi comment nói rõ vì sao (dẫn chiếu B1 chặn ở cổng, đây chặn ở nguồn).
- [ ] **Step 4: Kiểm `new Date(...)` không bao giờ nhận giá trị không hữu hạn** — quét cả file.
- [ ] **Step 5:** chạy test + `npx vitest run server/services/alerts/` (property test B1 phải còn xanh) + tsc. Commit.

---

## Task 2 — E2: cooldown cho cảnh báo không gắn máy (chủ dự án đã chốt)

**Files:** Modify `server/services/aiSmartAlertRouter.ts` · Test `server/services/aiSmartAlertRouter.notify.test.ts`

**Interfaces:** dùng lại `decideNotify` từ `server/services/alerts/decideNotify.ts` — KHÔNG viết luật thứ hai.

- [ ] **Step 1: Viết test đỏ** — sự kiện `YIELD_DROP` chỉ có `factoryId`, gọi `routeAlert` hai lần liên tiếp; assert lần hai KHÔNG gửi thông báo nhưng VẪN ghi nhật ký occurrence. Chạy, xác nhận ĐỎ (hiện lần hai vẫn gửi).
- [ ] **Step 2: Lưu mốc gửi gần nhất theo `consolidationKey`** — khi `event.machineId == null`, không có dòng `predictive_alerts` nào để đọc `notificationSentAt`, nên dùng Redis: khoá `smartalert:lastnotify:${consolidationKey}`, TTL = cooldown × 2. Theo đúng khuôn `getConsolidationEntry`/`setConsolidationEntry` đã có.
- [ ] **Step 3: Nối vào `decideNotify`** — khi không có `machineId`: `action` vẫn là `"insert"` theo `decideAlertWrite`, nhưng **đừng để `action:"insert"` tự động cho qua**. Truyền `lastNotifiedAt` đọc từ Redis và một cờ để `decideNotify` biết đây là nhóm không-máy.
  ⚠ **Đây là chỗ dễ sai nhất:** luật #1 của `decideNotify` là `action === "insert" ⇒ báo`. Nếu bạn chỉ truyền `lastNotifiedAt` mà không đổi gì khác thì luật #1 vẫn thắng và cooldown không có tác dụng. Đọc kỹ `decideNotify.ts` rồi quyết: hoặc thêm một trường vào `NotifyInput` (ví dụ `hasOpenAlertLookup: boolean`), hoặc map `action` cho nhóm này thành `"update"` khi Redis có mốc gửi. **Chọn cách nào cũng được, nhưng phải có test phủ luật #1 không bị ghi đè sai.**
- [ ] **Step 4:** giữ nguyên: CRITICAL và mức-tăng vẫn xuyên qua. Với nhóm không-máy không có "mức trước" nên chỉ CRITICAL xuyên qua — ghi rõ điều đó vào comment và report.
- [ ] **Step 5:** chạy 4 file test của `aiSmartAlertRouter` + `decideNotify.test.ts`, tsc. Commit.

---

## Task 3 — E3 · E4 · E5 · E6 · E7: năm mục nhỏ đường cảnh báo

**Files:** `server/services/aiSmartAlertRouter.ts` · `server/routers/alarmKpiRouter.ts` · `client/src/pages/alarmKpiEmptyState.ts` (test) · các file test liên quan

- [ ] **E3 — stamp `notificationSentAt` SAU khi gửi, không phải trước.** Hiện dấu đóng trong khối ghi còn lượt gửi thật xảy ra sau; tiến trình chết trong khe đó ⇒ cảnh báo mang dấu "đã báo" mà không ai được báo ⇒ im 4 giờ về một máy sắp hỏng. Đổi thành: gửi xong mới `UPDATE ... SET notificationSentAt` (một truy vấn nhỏ thêm, chấp nhận được). Test: mock `sendAlertNotification` ném ⇒ không stamp.
- [ ] **E4 — log một lần lúc khởi động ba giá trị env đang hiệu lực.** `Number("abc")`→NaN⇒240 và `-1`⇒240 đều im lặng; người vận hành gõ nhầm khi định TẮT sẽ nhận đúng 4 giờ im lặng, không một dòng log. In `console.log` một lần khi module nạp, nêu cả giá trị thô lẫn giá trị hiệu lực khi chúng khác nhau.
- [ ] **E5 — throttle log của van an toàn.** Chạm trần hiện kêu MỖI lượt ⇒ vòng lặp hỏng 1000 lượt/phút sinh 1000 dòng warn/phút. Chỉ warn lần đầu chạm trần trong mỗi cửa sổ (dùng chính entry Redis để nhớ đã warn chưa).
- [ ] **E6 — `MIN(occurredAt)` lọc theo `lineId`/`machineId`.** Hiện là toàn bảng, nhất quán với `sourceCounts.predictive` (cũng chưa lọc) nên câu giải thích không sai — nhưng ở màn đã lọc theo máy, một máy im lặng vẫn không được giải thích nếu nhà máy có dữ liệu. Lọc cả hai cho khớp nhau.
- [ ] **E7 — ba khoảng trống test:** (a) khối `try/catch` quanh truy vấn MIN chưa cô lập test được — thêm cờ mock ném RIÊNG ở truy vấn MIN; (b) nhánh `!input.generatedAt` trong `alarmKpiEmptyState.ts`; (c) assert nội dung `console.warn` của van có nêu khoá + số đếm.
- [ ] Mỗi mục một commit. Chạy test liên quan sau mỗi mục.

---

## Task 4 — F5 · F6 · F7: hợp đồng chết, nhất quán, chất lượng dịch

- [ ] **F5 — dọn hợp đồng chết trong registry.** `server/_core/appErrorCodes.ts` quảng cáo `ENTITY_DUPLICATE // params: { entity, field? }` và `INVALID_VALUE // params: { field, reason? }` trong khi không template nào render `field`/`reason`. Hai lựa chọn: (a) sửa comment cho khớp thực tế; (b) thêm `{{field}}` vào template. **Chọn (a) cho `field`** (12 chỗ đang truyền vô ích — bỏ luôn tham số thừa đó), và `reason` để Task 5 xử lý.
- [ ] **F6 — nhất quán chéo.** Chốt MỘT quy ước rồi áp một lượt:
  - "Bảng chưa migrate" đang có **4** cách (`FEATURE_DISABLED` / `OPERATION_FAILED` / `PRECONDITION_FAILED` / `throw new Error` thô). Chốt một mã (đề xuất `FEATURE_NOT_CONFIGURED` — bảng chưa migrate là cấu hình chưa xong, không phải tính năng bị tắt) và áp cho `aiModelRouter.ts:71`, `kbStudioRouter.ts:197/232`, `productVariantRouter.ts:50`. Chỗ `qualityGateTemplateRouter` ném `new Error` thô để Task 9 xử.
  - `product` ↔ `productModel` cùng trỏ `product_models`: chọn `productModel`, đổi 12 chỗ dùng `product`.
  - `report` ↔ `reportTemplate` cùng trỏ `report_templates`: chọn `reportTemplate`.
  - `TWO_FACTOR_NOT_SET_UP` mang cả `FORBIDDEN` lẫn `BAD_REQUEST` cho cùng điều kiện: chốt một mã tRPC.
- [ ] **F7 — chất lượng dịch.** (a) en: **336/384** câu bắt đầu chữ thường vì `"{{entity}} not found."` × entity viết thường ⇒ *"user not found."* — sửa bằng cách viết hoa đầu câu ở template (`"{{entity}} not found."` → đặt entity ở giữa, ví dụ `"Could not find {{entity}}."`) hoặc viết hoa giá trị entity trong `localizeParams` cho locale en. **Chọn cách đổi template** — an toàn hơn, không đụng dữ liệu. (b) zh lệch thuật ngữ: `entity.machine`=设备 vs `operation.registerMachine`=机台 · `entity.fleetTask`=车队任务 vs `operation.assignFleetTask`=机队 · `entity.panelDefinition`=拼板 vs `operation.createPanelDefinition`=面板 · `entity.mask`=掩码 vs `field.maskData`=掩膜 — thống nhất. (c) `errors.feature.web_ingest` → camelCase `webIngest`. (d) xoá khoá chết `errors.entity.factory`.
- [ ] Cả ba cổng phải xanh sau mỗi thay đổi. `npm run i18n:check` sạch.

---

## Task 5 — F4: `errors.reason.*` — thôi nuốt chỉ dẫn hành động

**Đây là mục có giá trị người dùng cao nhất trong nhóm F sau F1.**

**Bối cảnh:** **184 chỗ** `fallbackMessage` vốn ĐÃ là tiếng Việt (di trú ở đó là thuần lỗ) và **76 nhóm** trong đó ≥2 nguyên nhân khác nhau nay render một câu y hệt. Nặng nhất — người dùng **kẹt hoàn toàn**:
- `productionRouters.ts:201/224/238` — mất danh sách lệnh trùng lịch, số năng lực chuyền, chỉ dẫn `forceOverride=true`
- `productRouters.ts:1855` — mất readiness score + `force=true`
- `aoiOnboardingRouter.ts:448` — mất "chạy bước 3 Dry-run trước, hoặc nhờ admin ký"
- `deviceAdapterRouter.ts:188` — mất "hãy tắt (isEnabled=false) trước khi xoá"
- `defectDispositionRouter.ts:167` — mất "Vào **Cài đặt > Bảo mật** để thiết lập"
- `readinessRouter.ts:448` — mất tên quyền cần có
- 4 file × 3 chỗ ảnh: "base64 hỏng" / "ảnh rỗng" / **"ảnh vượt N byte"** → cùng một câu. Đúng bệnh `20971520 bytes` mà Task 3 đã chữa cho KB, tái phát ở luồng ảnh và **tệ hơn** (KB còn có `{{limitMb}}`).

- [ ] **Step 1: Thêm không gian từ điển `errors.reason.*`** — `client/src/lib/errorCodes.ts`, thêm `reason` vào danh sách tham số được tra từ điển (hiện có 6: entity/parent/operation/field/feature/action).
- [ ] **Step 2: Thêm `{{reason}}` vào template** của `OPERATION_FAILED` và `INVALID_VALUE` ở vi/en/zh, dạng **tuỳ chọn** — câu phải đọc được cả khi không có `reason`.
  ⚠ i18next không có "chỉ nội suy nếu có". Cách an toàn: dùng **hai khoá** (`OPERATION_FAILED` và `OPERATION_FAILED_WITH_REASON`), `translateAppError` chọn khoá theo việc `params.reason` có mặt hay không. Ghi rõ cách chọn vào comment.
- [ ] **Step 3: Áp cho các chỗ mất mát nặng nhất** (danh sách trên + 4 file ảnh). Với luồng ảnh, **tái dùng `KB_FILE_TOO_LARGE{limitMb}`** cho ca vượt dung lượng thay vì gộp vào `INVALID_VALUE`.
- [ ] **Step 4:** thêm test khẳng định câu có `reason` và câu không có `reason` đều đọc được ở cả ba locale. Cổng từ điển phải bao được không gian `errors.reason.*`.
- [ ] Chia lô, mỗi lô một commit.

---

## Task 6 — F8: i18n lười trả tiếng Việt cho người dùng en/zh

**Files:** `client/src/i18n/index.ts` · `client/src/lib/errorCodes.ts` · test

**Bối cảnh:** en/zh nạp bằng `import()` động, và `fallbackLng: 'vi'`. Trong cửa sổ chờ hoặc khi chunk hỏng (offline), `i18n.t` trả **chuỗi tiếng Việt** — không phải sentinel — nên `translateAppError` tưởng đã dịch thành công và không bao giờ rơi về `fallbackMessage` tiếng Anh. **Người dùng en đọc "Không tìm thấy sản phẩm."** Đường này **mới có** sau di trú.

- [ ] **Step 1: Viết test đỏ** — mô phỏng locale `en` chưa nạp xong, gọi `translateAppError`, assert KHÔNG trả chuỗi tiếng Việt.
- [ ] **Step 2: Sửa** — `translateAppError` kiểm ngôn ngữ đang hoạt động đã nạp xong chưa (`i18n.hasResourceBundle(lng, ns)`); chưa nạp ⇒ trả `fallback` thay vì gọi `t()`. Đây đúng tinh thần quy tắc bất biến "thiếu khoá ⇒ rơi về message máy chủ".
- [ ] **Step 3:** chạy `trpcErrors.unit.test.ts` + test mới. Commit.

---

## Task 7 — F1 phần A: cổng chặn + di trú lô đầu (màn operator)

**Files:** Create `client/src/lib/clientErrorCoverage.unit.test.ts` · Modify handler ở `client/src/pages/*` và `client/src/components/*`

**Bối cảnh:** **446 handler `onError` ở 159 file** hiện `toast.error(err.message)` thay vì `mapTrpcError(err)`. Chỉ 82/535 (15%) đi qua đường dịch. Đây là chỗ người dùng thật sự nhận giá trị của cả sprint A4.

- [ ] **Step 1: Đo lại và sinh danh sách** — quét `client/src` tìm mọi `onError` dùng `.message` trực tiếp. Ghi bảng file × số handler vào report. Con số trong backlog là 446/159, tự đo lại.
- [ ] **Step 2: Xây cổng chặn** — `clientErrorCoverage.unit.test.ts` đếm handler chưa qua `mapTrpcError`/`toastTrpcError`, so với `ALLOWED_RAW_MESSAGE_HANDLERS` đặt bằng số đo được, hai assert (`<=` và `===`) như cổng router. **Chứng minh cổng đỏ được** bằng tiêm thử rồi hoàn nguyên.
  ⚠ Tên file phải khớp `include` của `vitest.config.ts` — client cần `.unit.test.ts`.
- [ ] **Step 3: Di trú lô đầu — màn operator chạm hàng ngày** (sản xuất, kiểm tra, cảnh báo, thiết bị, andon). Khuôn: `onError: (e) => toast.error(e.message)` → `onError: (e) => toastTrpcError(e)`. Thêm import.
  ⚠ **Không đổi bừa:** một số handler làm nhiều việc hơn là hiện toast (set state, đóng dialog). Chỉ đổi phần lấy chuỗi lỗi, giữ nguyên phần còn lại.
- [ ] **Step 4:** mỗi lô ~15 file → chạy test client liên quan → hạ hằng cổng → commit lô.

---

## Task 8 — F1 phần B: di trú nốt handler còn lại

- [ ] Tiếp tục đúng khuôn Task 7 cho các màn admin/engineer/AI/báo cáo còn lại, chia lô ~15 file.
- [ ] Hạ `ALLOWED_RAW_MESSAGE_HANDLERS` về **0** ở lô cuối.
- [ ] Chạy `npm run i18n:check` + tsc + toàn bộ test client. Commit.

---

## Task 9 — F2: 75 chỗ `throw new Error` trong `server/routers/**`

**Bối cảnh:** trong đó **31 chỗ** là `"Database not available"` — đúng chuỗi mà sprint tuyên bố đã xoá sổ. tRPC v11 đặt `message = cause?.message` nên chúng đi nguyên vẹn tới client.

- [ ] **Step 1:** sinh danh sách 75 chỗ / 20 file. File nặng nhất: `dataRouters.ts` 16 · `masterDataRouter.ts` 9 · `componentLibraryRouter.ts` 9 · `qualityGateTemplateRouter.ts` 7.
- [ ] **Step 2:** di trú sang `appError` với mã đúng ngữ cảnh. 31 chỗ DB ⇒ `DB_UNAVAILABLE`. `qualityGateTemplateRouter` "table not found. Please run migration 0067" ⇒ mã đã chốt ở Task 4 F6.
- [ ] **Step 3:** hạ `ALLOWED_RAW_ERROR_THROWS` về **0** ở lô cuối. Chia lô ~7 file.

---

## Task 10 — F3: 64 chỗ / 13 file ngoài `server/routers/**`

**Bối cảnh:** `machineAuthService.ts` 17 · `aiAnalyticsScope.ts` 13 · `_core/trpc.ts` 12 (**mọi chối-quyền RBAC, mọi gọi chưa đăng nhập**) · `securityIdentityRouter.ts` 5 · `thresholdGovernanceService.ts` 5 · `notification.ts` 4 · `safeImagePath.ts` 2 · sáu file 1 chỗ.

⚠ Đây là **hạ tầng lõi + security-critical**. Đọc kỹ từng chỗ, đừng vội.

- [ ] **Step 1:** `_core/trpc.ts` trước (12 chỗ, giá trị cao nhất — mọi người dùng đều gặp). Cẩn thận: file này CHÍNH LÀ nơi định nghĩa `errorFormatter`; kiểm không tạo vòng import với `appError.ts`.
- [ ] **Step 2:** `accessControl.ts`, `moduleGate.ts`, `notification.ts` — cùng nhóm cổng quyền.
- [ ] **Step 3:** `machineAuthService.ts`, `securityIdentityRouter.ts`, `thresholdGovernanceService.ts` — security-critical, review kỹ.
- [ ] **Step 4:** phần còn lại. Mở rộng cổng đếm để bao các file này.

---

## Task 11 — F9: side-channel đăng nhập (tiền tồn tại)

⚠ **Security-sensitive. Thay đổi hành vi xác thực — đọc kỹ, test kỹ.**

**Bối cảnh:** kiểm `isActive`/`lockedUntil` chạy TRƯỚC `bcrypt.compare`, nên chỉ cần username là phân biệt được "tồn tại + vô hiệu/khoá" với "không tồn tại". Nhánh unknown-user bỏ qua bcrypt ⇒ side-channel thời gian.

- [ ] **Step 1: Viết test đo** — đo thời gian phản hồi cho username tồn tại vs không tồn tại; assert chênh lệch dưới ngưỡng.
- [ ] **Step 2: Sửa** — luôn chạy `bcrypt.compare` (với hash giả cho user không tồn tại) trước khi kiểm `isActive`/`lockedUntil`. Giữ nguyên `INVALID_CREDENTIALS` gộp chung.
- [ ] **Step 3:** chạy toàn bộ test auth. **Không được làm hỏng luồng đăng nhập** — đây là đường người dùng gặp đầu tiên. Nếu có nghi ngờ, dừng và báo lại.

---

## Task 12 — F10: kiểm bằng mắt trên trình duyệt

**Chủ dự án đã nói sẽ tự kiểm bằng mắt.** Task này chuẩn bị cho việc đó.

- [ ] **Step 1:** rebuild + restart `:3000` (chủ dự án đã uỷ quyền).
- [ ] **Step 2:** kiểm **một ca mỗi họ mã lỗi** trên trình duyệt, chụp lại: `ENTITY_NOT_FOUND` · `DB_UNAVAILABLE` · `PERMISSION_DENIED` (có `{{action}}`) · `OPERATION_FAILED` (có và không có `reason`) · `FEATURE_DISABLED` vs `FEATURE_NOT_CONFIGURED` · `AUTH_REQUIRED` · `KB_FILE_TOO_LARGE` (có `{{limitMb}}`).
- [ ] **Step 3:** đổi ngôn ngữ sang en và zh, kiểm lại 3 ca — đặc biệt xác nhận **không còn tiếng Việt lọt sang** (F8).
- [ ] **Step 4:** ghi kết quả + ảnh vào report để chủ dự án đối chiếu.

---

## Self-Review

**Spec coverage:** 17 mục nợ → E1 (T1) · E2 (T2) · E3-E7 (T3) · F5-F7 (T4) · F4 (T5) · F8 (T6) · F1 (T7-T8) · F2 (T9) · F3 (T10) · F9 (T11) · F10 (T12). Đủ 17.

**Placeholder scan:** không có TBD. Các con số (446/159, 75/20, 64/13, 184, 76) là số đo của reviewer — plan yêu cầu **tự đo lại** trước khi sửa, đó là chủ ý chứ không phải placeholder.

**Type consistency:** `decideNotify`/`NotifyInput` (T2) khớp file hiện có. `errors.reason.*` (T5) khớp cơ chế `localizeParams` 6-tham-số của T6 plan trước. Hằng cổng: `ALLOWED_LEGACY_THROWS` (đã 0), `ALLOWED_RAW_ERROR_THROWS` (T9 → 0), `ALLOWED_RAW_MESSAGE_HANDLERS` (T7-T8 → 0).

**Điểm cần review chú ý nhất:** Task 2 Step 3 — luật #1 của `decideNotify` (`action === "insert" ⇒ báo`) sẽ ghi đè cooldown nếu nối ẩu; và Task 11 — đổi hành vi xác thực.
