# Sprint 5 — Thiết kế: hết làm phiền người thật, và số liệu nói thật

**Ngày:** 2026-07-29 · **Nhánh:** `feat/hmi-dep` · **HEAD khi lập:** `6ad3e57d`
**Nguồn:** `docs/superpowers/specs/2026-07-29-ai-sprint5-backlog-consolidated.md` (§6 phạm vi khuyến nghị)
**Phạm vi đã chốt:** nhóm A (A1–A4) + B1. B2, B3, nhóm C, nhóm D **để mở**.

---

## 0. Đo lại tại `6ad3e57d` — trước khi thi công

Backlog chụp tại `208301dc`. Đo lại tại HEAD hiện tại: cả 5 mục vẫn đúng, và **A2 nặng hơn backlog mô tả**.

| Mục | Xác nhận |
|---|---|
| A1 | `aiSmartAlertRouter.ts:159-162` — `sendSmartNotification` chạy cho mọi target **trước** khi quyết insert/update (`:245-325`). Mỗi lần tái diễn = 1 dòng notification/người + 1 email nếu HIGH/CRITICAL. |
| A2 | `:130-147` — cửa sổ gộp 5 phút neo vào lần ĐẦU (`timestamp: existing.timestamp`, không làm mới) ⇒ đúng 3 lượt lọt/5 phút = **6/10 phút**, dưới ngưỡng ISA-18.2 (>10/10 phút). |
| A2 (mới) | `return` sớm ở `:136` nằm **trước cả** đường ghi DB lẫn `predictiveAlertOccurrences` (`:330-345`) ⇒ lần tái diễn thứ 4+ trong 5 phút **không được ghi nhật ký**. KPI Wave 4 đang đếm thiếu **ngay tại cửa**, không chỉ "flood không kích hoạt được". |
| A3 | `alarmKpiRouter.ts:212-216` trả `sourceCounts.predictive` nhưng không có tín hiệu nào phân biệt "0 vì yên tĩnh" với "0 vì sổ chưa có dòng nào". `panels.tsx:408` còn **ẩn hẳn** dòng nguồn khi cả hai bằng 0. |
| A4 | `kbStudioRouter.ts:89`, `kbIngestRouter.ts:87`, `kbDocParser.ts:45`/`:206` — chuỗi tiếng Anh, **không mã máy-đọc-được**. `trpcErrors.ts:147-148` chỉ pass-through nguyên văn. |
| B1 | `classifySuppression.ts:21-28` vs `predictiveMaintenanceService.ts:832-838` — hai bản sao, không test nào so chúng. |

**Số đo cho A4** (`server/routers`, loại file `.test.ts`): **1056** chỗ `new TRPCError` trong **117** file. Trong các chuỗi `message:`, chỉ ~19% là tiếng Việt. Nhưng ~210 chỗ chỉ là **một** câu duy nhất (`"Database not available"` và biến thể) ⇒ khối lượng thật nhỏ hơn con số 1056 gợi ra nhiều (bảng họ lỗi ở §4).

**Xác nhận không cần migration cho A1:** cột `notificationSentAt` đã có sẵn trên `predictive_alerts` (`drizzle/schema/ai.ts:130`), hiện chỉ được set lúc INSERT rồi không bao giờ cập nhật.

---

## 1. Quyết định của chủ dự án (đã chốt trong phiên brainstorm)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | A1 — luật báo lại khi cảnh báo đang mở tái diễn | Báo lần đầu + chỉ báo lại khi **có tin mới**: mức tăng, hoặc hết cooldown, hoặc CRITICAL |
| 2 | A1 — cooldown mặc định | **4 giờ** (22 lượt/ngày → ≤6) |
| 3 | A2 — trần gộp | **Bỏ trần**, thêm đường ghi-nhanh + van an toàn |
| 4 | A4 — phạm vi | **Hạ tầng chung toàn ứng dụng**, không chỉ KB |
| 5 | A4 — rollout | **Di trú toàn bộ router** |

Về #4/#5: tôi đã nêu rõ đây là phần lớn hơn A1+A2+A3+B1 cộng lại; chủ dự án chốt vẫn làm. Ghi lại ở đây để sprint sau không tưởng nhầm là phạm vi trượt.

---

## 2. A1 + A2 — tách ba quyết định đang dính vào nhau

### 2.1 Nguyên nhân gốc

`routeAlert` đang trộn ba việc vào một dòng chảy: *có gộp không* · *có báo không* · *ghi gì*. Cửa sổ Redis 5 phút gánh cả ba — nên A1 (muốn gộp NHIỀU hơn) và A2 (muốn ghi ĐỦ hơn) mới kéo ngược nhau. Tách ra thì hết mâu thuẫn.

### 2.2 Trật tự mới của `routeAlert`

```
1. tra cứu cảnh báo mở      (+1 cột: notificationSentAt; severity đã select sẵn)
2. decideAlertWrite         insert | update            ĐÃ CÓ, không đụng
3. decideNotify             notify? + reason           MỚI, hàm thuần
4. nếu notify → enrichRoutingWithAI + checkPatterns
5. GHI: insert/update + INSERT occurrence              LUÔN chạy, không trần
6. nếu notify → determineTargets + gửi + stamp notificationSentAt
```

Đảo so với hiện tại (đang notify ở bước 4 rồi mới ghi ở bước 6).

### 2.3 `server/services/alerts/decideNotify.ts` — mới, thuần, không I/O

```ts
export type NotifyReason =
  | "first" | "critical" | "severity-raised"
  | "never-notified" | "cooldown-elapsed" | "suppressed-cooldown";

export interface NotifyInput {
  action: "insert" | "update";
  incomingSeverity: AlertSeverity;
  /** Mức của DÒNG ĐANG MỞ TRƯỚC khi update — KHÔNG phải decision.severity (đã gộp). */
  previousSeverity: AlertSeverity | null;
  lastNotifiedAt: number | null;   // ms epoch
  now: number;                     // ms epoch
  cooldownMs: number;
  criticalCooldownMs: number;      // 0 = CRITICAL luôn báo
}

export function decideNotify(input: NotifyInput): { notify: boolean; reason: NotifyReason };
```

Bảng chân lý, xét theo đúng thứ tự này:

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | `action === "insert"` | báo · `first` |
| 2 | `incomingSeverity === "CRITICAL"` **và** (`lastNotifiedAt == null` **hoặc** `now - lastNotifiedAt >= criticalCooldownMs`) — với mặc định 0 thì vế sau luôn đúng | báo · `critical` |
| 3 | `severityRank(incoming) > severityRank(previous)` | báo · `severity-raised` |
| 4 | `lastNotifiedAt == null` | báo · `never-notified` (fail-open) |
| 5 | `now - lastNotifiedAt >= cooldownMs` | báo · `cooldown-elapsed` |
| 6 | còn lại | **im lặng** · `suppressed-cooldown` |

**Bẫy đã lường trước:** `maxSeverity()` trong `decideAlertWrite.ts:32` **không dùng được** cho luật #3 — khi `prev === incoming` nó trả về `prev`, mà so sánh chuỗi thì `prev === incoming` ⇒ hoá thành "mức tăng" sai. Phải **export thêm `severityRank(s): number`** từ `decideAlertWrite.ts` (biến `RANK` hiện là module-private) và so bằng số.

### 2.4 `lastNotifiedAt` lưu ở đâu

Dùng lại cột `notificationSentAt` sẵn có. **Không migration.**

- Thêm `notificationSentAt` vào truy vấn tra-cứu-cảnh-báo-mở (`:211-225`, hiện select 3 cột).
- Nhánh `update`: chỉ set `notificationSentAt: new Date()` **khi thật sự gửi**.
- **Chỉ stamp khi `targets.length > 0`.** Nếu nhà máy chưa cấu hình role nào nhận (ví dụ không có user `maintenance`), không có gì được gửi thật — stamp sẽ khiến cảnh báo im lặng 4 giờ vì một lượt gửi không tồn tại.

### 2.5 A2 — bỏ trần, giữ van

- **Xoá** `return` sớm ở `:135-144`.
- Cửa sổ Redis đổi vai: từ **cổng chặn** thành **van an toàn + đồng hồ đếm**. Chạm `ROUTE_ALERT_MAX_PER_WINDOW` (mặc định **200**) mới bỏ, kèm `console.warn` nêu khoá + số đếm — không bao giờ mất im lặng nữa.
- Giữ nguyên cửa sổ neo-vào-lần-đầu 5 phút. Đổi sang sliding window là thay đổi khác, không cần cho sprint này.
- Trường trả về `consolidated` / `consolidationGroup` giữ nguyên ý nghĩa (đang trong cửa sổ), chỉ không còn chặn gì.

Hệ quả: flood ISA-18.2 (>10/10 phút) từ nay phát hiện được cho **một** máy, và nhật ký lần-tái-diễn hết đếm thiếu tại cửa.

### 2.6 Ba đánh đổi — ghi rõ, không giấu

1. **CRITICAL luôn báo ⇒ máy CRITICAL tái diễn 22 lần/ngày vẫn 22 lượt.** Đúng như đã chốt. Van `ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES` **mặc định 0** ⇒ hành vi y hệt lựa chọn, nhưng khách chỉnh được nếu CRITICAL hoá ra mới là nguồn nhiễu thật.
2. **Thông báo nay đi SAU khi ghi.** Nếu ghi ném lỗi: giữ đúng tinh thần fail-open đã chốt ở Wave 3 (`:230`) — bọc `try/catch` quanh đường ghi, log ERROR, rồi **vẫn gửi thông báo**. Thà báo trùng còn hơn im lặng về một máy sắp hỏng.
   Nói rõ hệ quả: `routeAlert` hiện **ném ra ngoài** khi INSERT/UPDATE hỏng; sau đổi thì **không ném nữa**. An toàn vì cả hai caller (`predictiveMaintenanceService`, `raiseQualityGateAlert`) đã tự bọc `try/catch`. Khi ghi hỏng thì không có `alertRecord.id` ⇒ **bỏ qua INSERT occurrence** (không có gì để nối vào) và log ERROR đúng theo khuôn `:341-345` — KPI mất đúng một lần, có dấu vết, không im lặng.
3. **Khi im lặng thì không ghi đè `aiAnalysis`.** Hiện mỗi lần update đều đè cột này; nếu LLM lỗi thì lý giải cũ biến mất. Nhánh update im lặng sẽ **bỏ `aiAnalysis` khỏi mệnh đề SET**, giữ nguyên lý giải có từ lần báo trước.

### 2.7 Env mới

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `ALERT_RENOTIFY_COOLDOWN_MINUTES` | `240` | Cooldown im lặng cho cảnh báo đang mở |
| `ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES` | `0` | 0 = CRITICAL luôn báo ngay |
| `ROUTE_ALERT_MAX_PER_WINDOW` | `200` | Van an toàn chống vòng lặp hỏng phía phát |

Cả ba vào `.env.example`. (D1 — bốn khoá `ALERT_TTL_HOURS` / `ALERT_EXPIRY_SWEEP_*` / `ALERT_OCCURRENCE_RETENTION_DAYS` — **vẫn để mở**, không tiện tay làm kèm.)

### 2.8 Lợi ích phụ đo được

LLM (`enrichRoutingWithAI`) hiện gọi mỗi lượt lọt (≤3/5 phút). Sau đổi chỉ gọi khi thật sự báo ⇒ với cooldown 4h là **≤6 lần/ngày/cảnh báo**.

---

## 3. A3 — số 0 phải tự giải thích

### 3.1 Server

`alarmKpi.summary` trả thêm, lấy bằng **một** truy vấn `SELECT MIN("occurredAt")` (index-backed qua `idx_alert_occurrences_time`, không `COUNT(*)` quét bảng):

```ts
occurrenceLog: {
  available: boolean;            // false khi bảng chưa có (42P01)
  firstOccurredAt: string | null // ISO; null = sổ rỗng
}
```

Bọc trong đúng khuôn `isMissingTable` đã dùng ở `:103-108`. Không cần trường `totalRows` riêng: `available && firstOccurredAt === null` đã là "sổ rỗng".

⚠ `isMissingTable` phải walk `err.cause` (DrizzleQueryError bọc lỗi gốc) — bẫy đã trả giá ở doc 69.

### 3.2 Client — hai nơi

`client/src/pages/AlarmKpiDashboard.tsx` và `client/src/components/controlTower/panels.tsx:408` (chỗ đang **ẩn hẳn** dòng nguồn khi cả hai nguồn bằng 0).

Hiện đúng một câu khi `sourceCounts.predictive === 0`:

| Trạng thái | Câu |
|---|---|
| `!available` | Nhật ký lần-tái-diễn chưa sẵn sàng (migration chưa chạy) — phần cảnh báo AI không được tính vào KPI. |
| `firstOccurredAt === null` | Chưa ghi lần-tái-diễn nào kể từ khi bật tính năng. Số 0 nghĩa là **chưa có dữ liệu**, không phải nhà máy im lặng. |
| `firstOccurredAt > since` | Nhật ký bắt đầu ghi từ {ngày} — cửa sổ {N}h này bắt đầu trước mốc đó, phần trước không tồn tại. |

`since` **không** thêm trường mới: client tự tính `since = generatedAt − windowHours × 3600_000`, cả hai đều đã có trong phản hồi/đầu vào.

3 khoá i18n × vi/en/zh.

---

## 4. A4 — hạ tầng mã lỗi + di trú toàn bộ router

### 4.1 Họ lỗi (đo tại `6ad3e57d`)

| Họ | Số chỗ ước lượng | Cách di trú |
|---|---:|---|
| `DB_UNAVAILABLE` | ~210 | Một mã, một chuỗi — cơ học |
| `ENTITY_NOT_FOUND` | ~328 | Một mã + `{entity}` từ từ điển thực thể |
| `INVALID_VALUE` | ~83 | |
| `FEATURE_DISABLED` | ~62 | "chưa bật / chưa cấu hình" |
| `OPERATION_FAILED` | ~23 | |
| `FIELD_REQUIRED` | ~22 | |
| `ENTITY_DUPLICATE` | ~14 | |
| `SCOPE_MISMATCH` | ~12 | "không thuộc về…" |
| `PERMISSION_DENIED` | ~11 | đã có `mapForbidden` |
| **9 mã họ** | **~765 (≈72%)** | |
| Đuôi dài bespoke | ~250–290 | đọc từng chỗ |

Con số là **ước lượng từ grep**, không phải kiểm đếm chính xác — dùng để chia đợt, không dùng làm tiêu chí nghiệm thu. Tiêu chí nghiệm thu là bộ đếm ở §4.4.

### 4.2 Hạ tầng máy chủ — `server/_core/appError.ts`

Bám đúng khuôn `mpConflict` đã có ở `server/_core/trpc.ts:16-24`, không phát minh cơ chế mới.

```ts
appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found")
//        ↑ mã tRPC    ↑ mã ứng dụng        ↑ tham số            ↑ fallback (log/API ngoài)
```

Trả về `TRPCError` mang `{ appCode, params }` trên `cause`. `errorFormatter` nâng lên `shape.data.appCode` / `shape.data.appParams`.

Mã ứng dụng khai trong một registry có kiểu (`AppErrorCode`) để tsc bắt được mã sai chính tả.

### 4.3 Hạ tầng client

- `client/src/lib/errorCodes.ts` — bảng `appCode` → khoá i18n + hình dạng tham số.
- `mapTrpcError` đọc `data.appCode` **trước**; **thiếu khoá i18n thì rơi về message máy chủ y như hôm nay** ⇒ cộng-thêm, không gãy gì.
- Từ điển thực thể `errors.entity.*` (`product` → "sản phẩm", `machine` → "máy", …) để `ENTITY_NOT_FOUND` vẫn cụ thể, không generic.
- Khoá i18n đủ vi/en/zh.

### 4.4 Cổng chặn hồi quy — thứ biến "toàn bộ" thành đích kiểm chứng được

Một test quét `server/routers/**/*.ts` (loại `.test.ts`), đếm `new TRPCError` **chưa** đi qua `appError`, so với hằng `ALLOWED_LEGACY_THROWS`.

- Di trú xong một đợt ⇒ hạ hằng số.
- Test **FAIL nếu số tăng** ⇒ router mới không thể thêm nợ.
- Đợt cuối hạ về **0**.

### 4.5 Bốn đợt quét, rủi ro tăng dần

1. `DB_UNAVAILABLE` (~210) — thuần cơ học, kèm test khẳng định không còn chuỗi thô nào.
2. `ENTITY_NOT_FOUND` + từ điển thực thể (~328).
3. Bảy họ còn lại (~227).
4. Đuôi dài bespoke (~250–290), chia theo router, ưu tiên router người dùng chạm nhiều.

### 4.6 Thứ tự trong sprint

**Nhóm A + B1 làm trước, A4 sau.** Nếu phải cắt thì cắt đuôi dài của A4, không cắt thứ người dùng đang đau.

---

## 5. B1 — và một sai lệch có thật đã tìm ra

### 5.1 Sai lệch

Đọc đối chiếu `classifySuppression.ts:21-28` với biểu thức phát `predictiveMaintenanceService.ts:832-837`:

| `predictedTimeframeHours` | `classifySuppression` | biểu thức phát | |
|---|---|---|---|
| `NaN` | `out-of-timeframe` | không phát | khớp |
| `+Infinity` | `out-of-timeframe` | không phát | khớp |
| **`-Infinity`** | **`out-of-timeframe`** (bị chặn) | `-Inf <= T` → true → **PHÁT** | **LỆCH** |

`Math.round(-Infinity) === -Infinity` (`:523`) nên giá trị này tới được đây qua một phép chia cho 0 ở ước lượng RUL. Đúng lớp lỗi B1 sinh ra để bắt: cảnh báo được **phát** nhưng bị **đếm là đã chặn**.

Ghi chú ngoài phạm vi: cả hai đường đều **phát** khi `hours` âm hữu hạn (ví dụ `-5`). Có thể là bug riêng ("dự đoán 5 giờ trước"?) — **không sửa ở sprint này**, chỉ ghi lại.

### 5.2 Ba bước, theo đúng TDD

1. **Property test đối chiếu** — sinh tổ hợp `(risk, confidence, timeframe)` gồm cả `NaN` / `±Infinity` / `null` / âm / biên đúng-bằng-ngưỡng, assert `classifySuppression(...) === "emit"` ⟺ biểu thức phát. Test này **phải ĐỎ trước** ở ca `-Infinity`.
2. **Sửa sai lệch.**
3. **Hợp nhất** — biểu thức phát gọi thẳng `classifySuppression(...) === "emit"`, xoá bản sao ⇒ không còn cách nào drift. Property test ở lại làm bảng-chân-lý canh ngữ nghĩa của chính `classifySuppression`.

Bước 3 vượt điều backlog yêu cầu (chỉ xin "một test so khớp") nhưng xoá hẳn lớp lỗi thay vì canh nó. **Hệ quả hành vi: đổi tại đúng một điểm — `-Infinity` từ nay bị chặn.**

---

## 6. Chiến lược kiểm thử

Ba bài học đã trả giá ở Wave 3+4, áp vào mọi task của sprint này:

1. **Mock phải mô tả thế giới CÓ THẬT.** Không mock `.returning()` khi mã không gọi nó; không trả mảng đầy khi driver trả rỗng; không cho `.innerJoin()` bỏ qua điều kiện nối.
2. **Kiểm hợp đồng API TRƯỚC khi viết giao diện.** `occurrenceLog` (A3) và `appCode`/`appParams` (A4) đều đi qua `.map()`/`errorFormatter` liệt kê tay — hai lần trước tính năng chết im lặng đúng vì chỗ này. Phải có test khẳng định trường tới được client.
3. **Nói thẳng brief có thể sai** + chỉ đích danh cần kiểm gì.

Test theo mục:

| Mục | Test |
|---|---|
| A1 | `decideNotify.test.ts` — kín 6 nhánh bảng chân lý §2.3, kể cả bẫy `prev === incoming` không được tính là "mức tăng" |
| A1 | Test tích hợp `routeAlert`: update im lặng **vẫn** INSERT occurrence, **không** stamp `notificationSentAt`, **không** đè `aiAnalysis` |
| A1 | `targets.length === 0` ⇒ không stamp |
| A2 | Lần tái diễn thứ 4..N trong cửa sổ **vẫn ghi occurrence**; chạm van 200 ⇒ có `console.warn` |
| A2 | Không notify ⇒ `enrichRoutingWithAI` và `checkPatterns` **không được gọi** |
| A3 | Router trả `occurrenceLog` đúng 3 trạng thái, kể cả nhánh `isMissingTable` |
| A3 | Test hợp đồng: `occurrenceLog` sống sót qua đường trả về tới client |
| A4 | `appError` → `errorFormatter` → `mapTrpcError` end-to-end; thiếu khoá i18n ⇒ rơi về message máy chủ |
| A4 | Cổng đếm `ALLOWED_LEGACY_THROWS` |
| B1 | Property test đối chiếu (đỏ trước, xanh sau) |

---

## 7. Ngoài phạm vi — ghi để không ai "sửa giúp"

- **B2** (test chứng minh `occurrenceCount` tới client), **B3** (3 test rẻ còn thiếu), **nhóm C** (C1 `aiQualityGate` INSERT thẳng · C2 ba trường bị bỏ · C3 sắp xếp "vừa đóng"), **nhóm D** (D1 `.env.example` · D2 khoá `manualHelp.*` · D3 `.limit()` · D4 cột `confidenceScore` chết).
- Ba ngoại lệ **có chủ ý** ở §5 backlog: RCA rò tên tệp kho Studio · cổng kho Studio role-only không đòi 2FA · không nạp ngược quá khứ cho nhật ký.
- `hours` âm hữu hạn vẫn phát (§5.1).
- Cửa sổ gộp vẫn neo-vào-lần-đầu, không đổi sang sliding window.

---

## 8. Gotcha vận hành mang theo từ các wave trước

- **Không chạy hai implementer song song**, kể cả khác file — tranh chấp git index. Review (chỉ đọc) thì song song được.
- Sprint này **không có migration** (A1 dùng cột sẵn có; A3/A4/B1 không đụng schema). Nếu phát sinh: chạy **ngay sau task tạo bảng**, và **DB test `aoi_management_test` phải áp riêng**.
- `db.execute` với postgres-js trả rows trực tiếp.
- `isMissingTable` phải walk `err.cause` (DrizzleQueryError bọc lỗi gốc).
- tsc cần heap 8GB.
