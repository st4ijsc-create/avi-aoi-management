# Wave 4 — "Đo đúng cái vừa sửa" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trả món nợ Wave 3 tạo ra — KPI báo động đang đếm thiếu và làm cảnh báo đang sống biến mất khỏi cửa sổ thời gian.

**Architecture:** Thêm nhật ký **lần-tái-diễn** (mỗi lần `routeAlert` ghi/cập nhật ⇒ một dòng có mốc thời gian riêng), rồi cho KPI đọc từ đó thay vì đếm dòng cảnh báo. Một thay đổi sửa cả ba lỗi: đếm đủ, phát hiện lại "ngập báo động", hết biến mất. Kèm: nút sinh-dự-đoán đi qua cùng cửa, cảnh báo đã đóng xem được kèm lý do, và hạn lưu cho nhật ký.

**Tech Stack:** TypeScript · Drizzle (postgres-js) · tRPC · React 19 · Vitest · PostgreSQL

**Spec:** `docs/superpowers/specs/2026-07-29-ai-wave4-alert-kpi-truth-design.md` (`6987823c`)

## Global Constraints

- Nhánh `feat/hmi-dep`. Mỗi task commit riêng, **chỉ stage file của task đó** — TUYỆT ĐỐI không `git add -A` (cây có ~112 file `knowledge/*`, `docs/*`, `tools/machine-simulator/*` chưa commit của người dùng, **không thuộc wave này**). **Không push** (controller push ở chốt cuối).
- TDD: test đỏ trước → chạy thấy đỏ → cài đặt tối thiểu → chạy thấy xanh. **Không bao giờ làm yếu assertion để test qua.**
- `npx tsc --noEmit` sạch (`NODE_OPTIONS=--max-old-space-size=8192`). Lỗi `client/src/pages/SessionManagement.tsx(194,64)` **có sẵn từ trước, không phải của bạn**.
- **KHÔNG chạy migration, KHÔNG khởi động server, KHÔNG chạy model thật.** Controller làm sau.
- ⚠ Test client PHẢI tên `*.unit.test.ts` (`vitest.config.ts:27`) — tên khác thì **không bao giờ chạy**.
- Env đọc số theo khuôn: `const raw = Number(process.env.X); return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT;`
- Bắt lỗi thiếu bảng/cột dùng cause-walker `isMissingTable`/`isMissingColumn` (`server/_core/dbErrors.ts`) — **không** so `err.code` trần.
- **KHÔNG đụng** `processAutoEscalation()`, `urgencyFromRisk`, `RISK_ALERT_THRESHOLD`, `CONFIDENCE_ALERT_THRESHOLD`, `TIMEFRAME_ALERT_HOURS`, công thức `confidenceScore`, ngưỡng ISA-18.2 trong `alarmKpiMath.ts`.
- **KHÔNG đụng `decideAlertWrite`** (hàm thuần Wave 3) — nó đã đúng và có 8 test.
- **Ghi nhật ký hỏng thì cảnh báo VẪN phải được ghi** (fail-open). Sổ sách không bao giờ được làm hỏng đường an toàn.
- **KHÔNG nạp ngược quá khứ** — không sinh mốc thời gian giả cho 52 lần tái diễn cũ.

### ⚠ Bài học Wave 3 phải tránh lặp lại

1. **Mock phải mô tả thế giới CÓ THẬT.** Wave 3 có 2 lỗi vì mock trả hình dạng mà mã thật không bao giờ nhận (`.returning()` khi không gọi `.returning()`; mảng đầy khi driver trả mảng rỗng). Nếu mock không khớp chuỗi gọi thật, **sửa mock**, không sửa mã sản xuất.
2. **Kiểm hợp đồng API thật trước khi tin trường "đã có sẵn".** Wave 3 có badge không bao giờ hiện vì router `.map()` liệt kê tay không có trường đó.
3. **Test phải kiểm được mệnh đề lọc**, không chỉ kiểm kết quả trả về. Mock trả kết quả bất kể lọc gì = test tô điểm.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
|---|---|---|
| `drizzle/0309_alert_occurrences.sql` (**mới**) | Bảng nhật ký lần-tái-diễn | 1 |
| `drizzle/schema/ai.ts` (sửa) | Khai bảng mới | 1 |
| `server/services/alerts/buildOccurrence.ts` (**mới**) | Hàm THUẦN: dựng dòng nhật ký từ sự kiện | 2 |
| `server/services/aiSmartAlertRouter.ts` (sửa, sau khối ghi cảnh báo) | Ghi nhật ký, fail-open | 2 |
| `server/services/alertExpirySweeper.ts` (sửa) | Hạn lưu nhật ký | 3 |
| `server/routers/alarmKpiRouter.ts` (sửa `:73-137`) | KPI đọc từ nhật ký | 4 |
| `server/routers/aiRouters.ts` (sửa `:690`) | `generatePredictions` đi qua `routeAlert` | 5 |
| `client/src/pages/OpsConsole.tsx` (sửa `:158`) | Xem cảnh báo vừa đóng kèm lý do | 6 |

---

## Task 1: Migration 0309 — bảng nhật ký lần-tái-diễn

**Files:**
- Create: `drizzle/0309_alert_occurrences.sql`
- Modify: `drizzle/schema/ai.ts`

**Interfaces:**
- Produces: bảng `predictive_alert_occurrences` với cột `id`, `alertId`, `occurredAt`, `severity`, `confidenceScore`. Task 2/3/4 dùng lại.

- [ ] **Step 1: Viết migration**

Tạo `drizzle/0309_alert_occurrences.sql`:

```sql
-- Wave 4 §3 — nhật ký LẦN-TÁI-DIỄN.
-- Wave 3 gộp cảnh báo trùng thành MỘT dòng, khiến KPI (đếm mỗi dòng = 1 sự kiện)
-- báo thiếu và làm cảnh báo đang sống rơi khỏi cửa sổ thời gian. Bảng này ghi
-- từng lần tái diễn kèm mốc thời gian riêng để KPI đếm đúng và phát hiện lại
-- được "ngập báo động" (>10 lượt trong 10 phút, ISA-18.2).
CREATE TABLE IF NOT EXISTS "predictive_alert_occurrences" (
  "id"              serial PRIMARY KEY,
  "alertId"         integer NOT NULL
                      REFERENCES "predictive_alerts"("id") ON DELETE CASCADE,
  "occurredAt"      timestamptz NOT NULL DEFAULT now(),
  -- Mức độ + độ tin cậy TẠI LẦN NÀY (không phải mức đã gộp của dòng cha).
  "severity"        varchar(20),
  "confidenceScore" decimal(5,2)
);

-- KPI lọc theo cửa sổ thời gian rồi gộp theo cảnh báo cha.
CREATE INDEX IF NOT EXISTS "idx_alert_occurrences_time"
  ON "predictive_alert_occurrences" ("occurredAt");
CREATE INDEX IF NOT EXISTS "idx_alert_occurrences_alert"
  ON "predictive_alert_occurrences" ("alertId");
```

`ON DELETE CASCADE` là có chủ đích: xoá cảnh báo thì nhật ký của nó không còn ý nghĩa và không được để lại dòng mồ côi.

- [ ] **Step 2: Khai bảng trong schema drizzle**

Trong `drizzle/schema/ai.ts`, thêm sau bảng `predictiveAlerts`:

```ts
/** Wave 4 §3 — mỗi lần tình trạng tái diễn = một dòng có mốc thời gian riêng. */
export const predictiveAlertOccurrences = pgTable("predictive_alert_occurrences", {
  id: serial("id").primaryKey(),
  alertId: integer("alertId").notNull().references(() => predictiveAlerts.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull().defaultNow(),
  severity: varchar("severity", { length: 20 }),
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }),
});
```

Kiểm `serial`, `integer`, `timestamp`, `varchar`, `decimal` đã có trong khối import của file; thiếu thì thêm.

- [ ] **Step 3: Typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
Kỳ vọng: sạch (trừ lỗi có sẵn `SessionManagement.tsx(194,64)`).

**KHÔNG chạy migration.**

- [ ] **Step 4: Commit**

```bash
git add drizzle/0309_alert_occurrences.sql drizzle/schema/ai.ts
git commit -m "feat(ai/w4-1): bảng nhật ký lần-tái-diễn cho KPI báo động"
```

---

## Task 2: Ghi nhật ký từ `routeAlert` — fail-open

**Files:**
- Create: `server/services/alerts/buildOccurrence.ts`
- Test: `server/services/alerts/buildOccurrence.test.ts` (**mới**)
- Modify: `server/services/aiSmartAlertRouter.ts` (ngay sau khối ghi cảnh báo, nơi `alertRecord` đã có `id`)
- Test: `server/services/aiSmartAlertRouter.occurrence.test.ts` (**mới**)

**Interfaces:**
- Consumes: bảng từ Task 1.
- Produces: `buildOccurrence(alertId, incoming, now) → OccurrenceRow | null`.

**⚠ Cái bẫy chính của task này:** trên nhánh cập nhật, `decideAlertWrite` trả `severity` là **mức đã GỘP** (max của cũ và mới). Nhật ký phải ghi **mức của CHÍNH LẦN NÀY** — tức `event.severity`, không phải `decision.severity`. Ghi nhầm sẽ làm phân bố ưu tiên trong KPI (mục tiêu ~80/15/5 của ISA-18.2) sai vĩnh viễn, và không ai phát hiện được vì con số vẫn "trông hợp lý".

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/alerts/buildOccurrence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOccurrence } from "./buildOccurrence";

const now = new Date("2026-07-29T10:00:00.000Z");

describe("buildOccurrence", () => {
  it("dựng đủ trường từ sự kiện của LẦN NÀY", () => {
    expect(buildOccurrence(7, { severity: "HIGH", confidence: 63.5 }, now)).toEqual({
      alertId: 7, occurredAt: now, severity: "HIGH", confidenceScore: "63.50",
    });
  });

  it("không có độ tin cậy ⇒ null, KHÔNG bịa số", () => {
    expect(buildOccurrence(7, { severity: "MEDIUM", confidence: null }, now))
      .toEqual({ alertId: 7, occurredAt: now, severity: "MEDIUM", confidenceScore: null });
  });

  it("độ tin cậy là chuỗi (decimal từ pg) vẫn chuẩn hoá đúng", () => {
    // Hàm trả `OccurrenceRow | null` ⇒ phải khẳng định khác null TRƯỚC khi đọc trường,
    // nếu không `tsc` sẽ vỡ ("possibly null").
    const row = buildOccurrence(7, { severity: "LOW", confidence: "50" }, now);
    expect(row).not.toBeNull();
    expect(row!.confidenceScore).toBe("50.00");
  });

  it("độ tin cậy rác ⇒ null, không ném", () => {
    const row = buildOccurrence(7, { severity: "LOW", confidence: "abc" }, now);
    expect(row).not.toBeNull();
    expect(row!.confidenceScore).toBeNull();
  });

  it("KHÔNG có alertId ⇒ null (không ghi dòng mồ côi)", () => {
    expect(buildOccurrence(undefined as any, { severity: "HIGH", confidence: 1 }, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/buildOccurrence.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Cài đặt hàm thuần**

Tạo `server/services/alerts/buildOccurrence.ts`:

```ts
/**
 * Wave 4 §3 — dựng một dòng nhật ký lần-tái-diễn.
 *
 * Tách khỏi routeAlert để test được KHÔNG CẦN DB. Bài học Wave 3: mọi lỗi lọt
 * lưới đều nằm trong mã trộn lẫn I/O.
 *
 * ⚠ `severity` ở đây là mức của CHÍNH LẦN NÀY, KHÔNG phải mức đã gộp của dòng
 * cha. Ghi nhầm sẽ làm phân bố ưu tiên ISA-18.2 sai vĩnh viễn mà con số vẫn
 * "trông hợp lý" nên không ai phát hiện.
 */
export interface OccurrenceInput {
  severity: string;
  confidence: number | string | null | undefined;
}

export interface OccurrenceRow {
  alertId: number;
  occurredAt: Date;
  severity: string;
  confidenceScore: string | null;
}

export function buildOccurrence(
  alertId: number | undefined | null,
  incoming: OccurrenceInput,
  now: Date,
): OccurrenceRow | null {
  if (alertId == null) return null;
  const raw = incoming.confidence;
  const n = raw == null ? NaN : typeof raw === "number" ? raw : Number(raw);
  return {
    alertId,
    occurredAt: now,
    severity: incoming.severity,
    confidenceScore: Number.isFinite(n) ? n.toFixed(2) : null,
  };
}
```

- [ ] **Step 4: Chạy để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/buildOccurrence.test.ts`
Kỳ vọng: PASS 5/5.

- [ ] **Step 5: Viết test đỏ cho phần nối dây**

Tạo `server/services/aiSmartAlertRouter.occurrence.test.ts`. Ba khẳng định **bắt buộc**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock phải khớp chuỗi gọi drizzle THẬT. Nếu không khớp, sửa MOCK — không sửa
// mã sản xuất, không nới assertion. (Bài học Wave 3.)
const calls: { kind: string; payload?: any }[] = [];
let occurrenceInsertThrows = false;

beforeEach(() => { calls.length = 0; occurrenceInsertThrows = false; });

describe("routeAlert — ghi nhật ký lần-tái-diễn", () => {
  it("ghi MỚI cảnh báo ⇒ cũng ghi MỘT dòng nhật ký (lần đầu không được bỏ sót)", async () => {
    // Dựng mock theo khuôn `aiSmartAlertRouter.oneOpen.test.ts`, ghi lại lời gọi
    // insert vào bảng nhật ký dưới nhãn "insert-occurrence"; gọi routeAlert với
    // một machineId CHƯA có cảnh báo mở (⇒ đi nhánh ghi mới).
    const occ = calls.find(c => c.kind === "insert-occurrence");
    expect(occ).toBeTruthy();
    expect(occ!.payload.alertId).toBeTruthy();
  });

  it("CẬP NHẬT cảnh báo ⇒ ghi nhật ký với mức độ của LẦN NÀY, không phải mức đã gộp", async () => {
    // dòng đang mở severity=CRITICAL, sự kiện mới severity=MEDIUM
    // ⇒ dòng cha giữ CRITICAL (mức chỉ đi lên), nhưng NHẬT KÝ phải là MEDIUM
    const occ = calls.find(c => c.kind === "insert-occurrence");
    expect(occ!.payload.severity).toBe("MEDIUM");
  });

  it("ghi nhật ký NÉM LỖI ⇒ cảnh báo VẪN được ghi (fail-open)", async () => {
    occurrenceInsertThrows = true;
    // Cho mock insert vào bảng nhật ký NÉM lỗi; gọi routeAlert như ca đầu.
    expect(calls.some(c => c.kind === "insert" || c.kind === "update")).toBe(true);
    // và không ném ra ngoài
  });
});
```

**Đừng bịa mock từ đầu.** File `server/services/aiSmartAlertRouter.oneOpen.test.ts` (Wave 3) đã có khuôn mock **đang chạy xanh** cho đúng chuỗi gọi drizzle của `routeAlert` — phân biệt theo tham chiếu bảng thật, thenable chịu được mọi thứ tự `.where/.orderBy/.limit`, kèm mock `aiGgufEngine` để không nạp model thật. **Dùng lại khuôn đó**, chỉ thêm nhánh cho bảng nhật ký. Wave 3 mất hai vòng sửa vì mock trong kế hoạch mô tả một thế giới không tồn tại — đừng lặp lại.

⚠ Lưu ý test-isolation đã biết: bộ đếm gộp trong `routeAlert` dùng chung giữa các test cùng `machineId`. Cấp `machineId` RIÊNG cho test mới của bạn.

**Ba khẳng định trên giữ nguyên ý nghĩa.**

- [ ] **Step 6: Chạy để thấy ĐỎ**

Kỳ vọng: FAIL — chưa có lời gọi ghi nhật ký nào.

- [ ] **Step 7: Nối vào `routeAlert`**

Trong `server/services/aiSmartAlertRouter.ts`, **ngay sau** khối `if (decision.action === "update") { … } else { … }` (nơi `alertRecord` đã có `id`), thêm:

```ts
  // Wave 4 §3 — nhật ký LẦN-TÁI-DIỄN. Ghi cho CẢ hai nhánh (ghi mới và cập nhật):
  // lần đầu tiên cũng là một lần tái diễn, không được bỏ sót.
  // FAIL-OPEN: sổ sách hỏng KHÔNG được làm hỏng đường cảnh báo.
  try {
    const { buildOccurrence } = await import("./alerts/buildOccurrence");
    // ⚠ event.severity = mức của LẦN NÀY. KHÔNG dùng decision.severity (đã gộp).
    const occ = buildOccurrence(alertRecord?.id, { severity: event.severity, confidence: event.data.confidence }, new Date());
    if (occ) {
      await db.insert(predictiveAlertOccurrences).values(occ as any);
    }
  } catch (err) {
    // Log to ERROR, không phải warn: mất một dòng nhật ký nghĩa là KPI đếm
    // thiếu một lần — im lặng ở đây chính là bệnh Wave 4 sinh ra để chữa.
    console.error(`[SmartAlert] ghi nhật ký lần-tái-diễn THẤT BẠI cho cảnh báo #${alertRecord?.id} — KPI sẽ đếm thiếu lần này:`, err);
  }
```

Thêm `predictiveAlertOccurrences` vào khối import từ `../../drizzle/schema`.

- [ ] **Step 8: Chạy test + typecheck**

Chạy: `npx vitest run server/services/aiSmartAlertRouter.occurrence.test.ts server/services/alerts/buildOccurrence.test.ts` — PASS.
Quét hồi quy: `npx vitest run server/services/aiSmartAlertRouter` (các test Wave 3 phải còn xanh).
Chạy: `npx tsc --noEmit` — sạch.

- [ ] **Step 9: Commit**

```bash
git add server/services/alerts/buildOccurrence.ts server/services/alerts/buildOccurrence.test.ts server/services/aiSmartAlertRouter.ts server/services/aiSmartAlertRouter.occurrence.test.ts
git commit -m "feat(ai/w4-2): ghi nhật ký lần-tái-diễn từ routeAlert (fail-open, mức độ của từng lần)"
```

---

## Task 3: Hạn lưu cho nhật ký

**Files:**
- Modify: `server/services/alertExpirySweeper.ts`
- Test: `server/services/alertExpirySweeper.test.ts` (thêm ca mới, **không sửa 4 ca cũ**)

**Interfaces:**
- Produces: `pruneOldOccurrences() → { deleted: number }`, gọi từ cùng lượt quét đã có.

**Bối cảnh:** 22 dòng/máy/ngày ⇒ bảng sẽ phình. Đây là **số liệu đo**, không phải cảnh báo — nên **được phép xoá**, khác luật "gộp không xoá" của Wave 3 (luật đó dành cho cảnh báo, thứ người ta cần truy vết).

- [ ] **Step 1: Viết test đỏ**

Thêm vào `server/services/alertExpirySweeper.test.ts`:

```ts
describe("pruneOldOccurrences", () => {
  it("xoá theo occurredAt và trả về ĐÚNG số dòng đã xoá", async () => {
    const { pruneOldOccurrences } = await import("./alertExpirySweeper");
    const res = await pruneOldOccurrences();
    expect(res.deleted).toBe(2); // mock trả 2 dòng
  });

  it("mệnh đề WHERE phải lọc theo cột occurredAt", async () => {
    // duyệt điều kiện drizzle thật (giống ca đã có cho expiresAt ở Wave 3)
    // và khẳng định nó tham chiếu 'occurredAt'
  });

  it("lỗi DB ⇒ KHÔNG ném ra ngoài, và KHÔNG làm ngừng việc đóng cảnh báo", async () => {
    // dọn hỏng nhưng sweepExpiredAlerts vẫn chạy được
  });
});
```

Ca thứ hai dùng lại đúng kỹ thuật duyệt điều kiện SQL mà Wave 3 đã dựng trong chính file này — đọc ca `expiresAt` sẵn có và làm theo.

- [ ] **Step 2: Chạy để thấy ĐỎ**

Kỳ vọng: FAIL — chưa có `pruneOldOccurrences`.

- [ ] **Step 3: Cài đặt**

Trong `server/services/alertExpirySweeper.ts`:

```ts
/** Wave 4 §3c — hạn lưu nhật ký lần-tái-diễn. Đây là SỐ LIỆU ĐO, được phép xoá. */
function occurrenceRetentionMs(): number {
  const raw = Number(process.env.ALERT_OCCURRENCE_RETENTION_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? raw : 90;
  return days * 86_400_000;
}

export async function pruneOldOccurrences(): Promise<{ deleted: number }> {
  try {
    const db = await getDb();
    if (!db) return { deleted: 0 };
    const cutoff = new Date(Date.now() - occurrenceRetentionMs());
    const rows: any = await db
      .delete(predictiveAlertOccurrences)
      .where(lt(predictiveAlertOccurrences.occurredAt, cutoff))
      .returning({ id: predictiveAlertOccurrences.id });
    const deleted = Array.isArray(rows) ? rows.length : 0;
    if (deleted > 0) console.log(`[alertExpiry] đã dọn ${deleted} dòng nhật ký lần-tái-diễn cũ hơn hạn lưu.`);
    return { deleted };
  } catch (err) {
    if (isMissingTable(err) || isMissingColumn(err)) {
      console.warn("[alertExpiry] bảng nhật ký chưa có (migration 0309 chưa chạy?) — bỏ qua lượt dọn.");
    } else {
      console.error("[alertExpiry] dọn nhật ký THẤT BẠI:", err);
    }
    return { deleted: 0 };
  }
}
```

⚠ Dùng `.returning()` để đếm — **không** dựa `rows.length` khi không có `.returning()`. Bài học Wave 3: `Result` của postgres.js kế thừa `Array`, và không `.returning()` thì mảng luôn rỗng ⇒ đếm luôn ra 0.

Trong hàm quét định kỳ đã có, gọi **độc lập** để một bên hỏng không làm bên kia ngừng:

```ts
    void sweepExpiredAlerts();
    void pruneOldOccurrences();
```

Thêm `predictiveAlertOccurrences` vào import schema.

- [ ] **Step 4: Chạy test + typecheck** — PASS; `tsc` sạch.

- [ ] **Step 5: Commit**

```bash
git add server/services/alertExpirySweeper.ts server/services/alertExpirySweeper.test.ts
git commit -m "feat(ai/w4-3): hạn lưu nhật ký lần-tái-diễn (số liệu đo, được phép xoá)"
```

---

## Task 4: KPI đọc từ nhật ký

**Files:**
- Modify: `server/routers/alarmKpiRouter.ts` (khối `predRows` ở `:73-89` và vòng lặp dựng sự kiện ở `:122-137`)
- Test: `server/routers/alarmKpiOccurrence.test.ts` (**mới**)

**Interfaces:**
- Consumes: bảng Task 1, dữ liệu do Task 2 ghi.
- `AlarmEventLite` (đã có, `server/services/alarmKpiMath.ts:16`): `{ id: string; source: "andon"|"predictive"|string; priority: AlarmPriority; raisedAt: number; acknowledgedAt: number|null; resolvedAt: number|null; actorKey; actorLabel; title }`.

**Đây là task sửa cả ba lỗi.** Thay vì một sự kiện mỗi **dòng cảnh báo**, dựng một sự kiện mỗi **lần tái diễn**, với `raisedAt` = `occurredAt` của lần đó.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/routers/alarmKpiOccurrence.test.ts`. Ba khẳng định **bắt buộc**, mỗi cái ứng với một lỗi:

```ts
describe("alarmKpi — đọc từ nhật ký lần-tái-diễn", () => {
  it("ĐẾM ĐỦ: một cảnh báo tái diễn 22 lần ⇒ 22 sự kiện, không phải 1", async () => {
    // mock nhật ký trả 22 dòng cùng alertId
    // khẳng định sourceCounts.predictive === 22
  });

  it("KHÔNG BIẾN MẤT: cảnh báo tạo 4 ngày trước, tái diễn HÔM NAY ⇒ vẫn trong cửa sổ 24h", async () => {
    // dòng cha createdAt = now-4d; nhật ký có occurredAt = now-1h
    // khẳng định sự kiện đó CÓ mặt
  });

  it("mệnh đề lọc cửa sổ phải theo occurredAt, KHÔNG theo createdAt", async () => {
    // duyệt điều kiện drizzle thật; phải ĐỎ nếu ai đổi về createdAt
  });
});
```

Ca thứ ba là quan trọng nhất — đó chính là chỗ Wave 3 để lọt lỗi, và mock cũ **không hề kiểm điều kiện lọc**.

- [ ] **Step 2: Chạy để thấy ĐỎ**

Kỳ vọng: FAIL — KPI hiện vẫn đếm theo dòng.

- [ ] **Step 3: Đổi truy vấn**

Trong `server/routers/alarmKpiRouter.ts`, thay khối `predRows` (`:73-89`) bằng truy vấn nối nhật ký với cảnh báo cha, **lọc cửa sổ theo `occurredAt`**:

```ts
      // Wave 4 §4 — KPI đếm theo LẦN TÁI DIỄN, không theo dòng cảnh báo.
      // Wave 3 gộp trùng ⇒ đếm theo dòng làm KPI báo thiếu và làm cảnh báo
      // đang sống rơi khỏi cửa sổ (vì createdAt được cố ý giữ nguyên).
      const predRows = await db
        .select({
          occurrenceId: predictiveAlertOccurrences.id,
          occurredAt: predictiveAlertOccurrences.occurredAt,
          occurrenceSeverity: predictiveAlertOccurrences.severity,
          id: predictiveAlerts.id,
          severity: predictiveAlerts.severity,
          acknowledgedAt: predictiveAlerts.acknowledgedAt,
          resolvedAt: predictiveAlerts.resolvedAt,
          status: predictiveAlerts.status,
          machineId: predictiveAlerts.machineId,
          machineCode: predictiveAlerts.machineCode,
          title: predictiveAlerts.title,
        })
        .from(predictiveAlertOccurrences)
        .innerJoin(predictiveAlerts, eq(predictiveAlerts.id, predictiveAlertOccurrences.alertId))
        .where(gte(predictiveAlertOccurrences.occurredAt, since));
```

Thêm `predictiveAlertOccurrences` vào import schema, và `innerJoin` nếu chưa có.

- [ ] **Step 4: Đổi vòng lặp dựng sự kiện**

Thay vòng lặp ở `:122-137`:

```ts
      for (const r of predRows) {
        if (input?.machineId && r.machineId !== input.machineId) continue;
        const label = r.machineId != null ? machineMap.get(r.machineId) ?? r.machineCode ?? `#${r.machineId}` : (r.machineCode ?? null);
        const isResolved = r.resolvedAt != null || r.status === "RESOLVED" || r.status === "DISMISSED";
        events.push({
          // id phải DUY NHẤT mỗi lần tái diễn, nếu không summarize sẽ gộp nhầm.
          id: `pred:${r.id}:${r.occurrenceId}`,
          source: "predictive",
          // Mức độ của CHÍNH LẦN NÀY; thiếu thì lùi về mức của dòng cha.
          priority: normalizePredictiveSeverity(r.occurrenceSeverity ?? r.severity),
          // raisedAt = thời điểm LẦN NÀY xảy ra — đây là thứ sửa cả 3 lỗi.
          raisedAt: ms(r.occurredAt) ?? now,
          acknowledgedAt: ms(r.acknowledgedAt),
          resolvedAt: isResolved ? ms(r.resolvedAt) ?? now : null,
          actorKey: r.machineId != null ? `machine:${r.machineId}` : label ? `code:${label}` : null,
          actorLabel: label,
          title: r.title,
        });
      }
```

`sourceCounts.predictive` giữ nguyên `predRows.length` — nay là **số lần tái diễn**, đúng ý.

⚠ Đoạn tra `machineMap` phía trên dùng `predRows.map(r => r.machineId)` — vẫn đúng vì trường đó còn tồn tại. Kiểm lại sau khi sửa.

- [ ] **Step 5: Chạy test + typecheck**

Chạy test mới — PASS. Quét hồi quy: `npx vitest run server/routers/alarmKpi` và `npx vitest run server/services/alarmKpiMath`.
`npx tsc --noEmit` — sạch.

- [ ] **Step 6: Commit**

```bash
git add server/routers/alarmKpiRouter.ts server/routers/alarmKpiOccurrence.test.ts
git commit -m "feat(ai/w4-4): KPI đếm theo lần-tái-diễn — sửa đếm thiếu, ngập báo động, và biến mất khỏi cửa sổ"
```

---

## Task 5: `generatePredictions` đi qua `routeAlert`

**Files:**
- Modify: `server/routers/aiRouters.ts` (`:690`, khối `db.insert(predictiveAlerts).values({...})`)
- Test: `server/routers/generatePredictionsRoute.test.ts` (**mới**)

**Bối cảnh:** nút người dùng bấm hiện `INSERT` thẳng ⇒ không gộp trùng, không đặt `expiresAt`, và sau Task 2 sẽ **không ghi nhật ký** ⇒ tạo lỗ đen trong KPI. Bấm vài lần là dựng lại đúng đống tồn Wave 3 vừa dọn.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/routers/generatePredictionsRoute.test.ts`:

```ts
describe("generatePredictions — đi qua routeAlert", () => {
  it("gọi routeAlert thay vì INSERT thẳng", async () => {
    // mock routeAlert, khẳng định nó ĐƯỢC gọi và db.insert(predictiveAlerts) KHÔNG được gọi
  });

  it("truyền đủ machineId + mức độ + độ tin cậy cho routeAlert", async () => {
    // khẳng định payload có machineId, severity, data.confidence
  });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ** — FAIL, hiện vẫn INSERT thẳng.

- [ ] **Step 3: Đổi sang gọi `routeAlert`**

Thay khối `await db.insert(predictiveAlerts).values({...})` bằng:

```ts
          // Wave 4 §5 — đi qua CÙNG MỘT CỬA với đường tự động: gộp trùng,
          // đặt hạn dùng, ghi nhật ký lần-tái-diễn. INSERT thẳng bỏ qua cả ba.
          const { routeAlert } = await import("../services/aiSmartAlertRouter");
          await routeAlert({
            type: signal.alertType,
            machineId,
            factoryId: lastRow.factory_id ?? null,
            productModelId: lastRow.product_model_id ?? null,
            severity: signal.severity,
            message: `Analysis shows defect rate trending upward. Current rate: ${signal.currentValue.toFixed(1)}%, Predicted: ${signal.predictedValue.toFixed(1)}%`,
            data: {
              confidence: signal.confidenceScore,
              predictedTimeframe: signal.predictedTimeframe,
              currentValue: signal.currentValue,
              threshold: signal.alertThreshold,
              factors: signal.factors,
              recommendations: signal.recommendations,
            },
          } as any);
```

Đọc kiểu `SmartAlertEvent` thật trong `aiSmartAlertRouter.ts` và khớp đúng tên trường — **đừng đoán**. Nếu `routeAlert` không nhận trường nào trong số trên, nói rõ trong báo cáo thay vì bỏ im lặng.

- [ ] **Step 4: Chạy test + hồi quy**

Chạy test mới — PASS. Quét: `npx vitest run server/routers/aiRcaAlertSql.test.ts` (file này đụng `predictiveAlerts`).
`npx tsc --noEmit` — sạch.

- [ ] **Step 5: Commit**

```bash
git add server/routers/aiRouters.ts server/routers/generatePredictionsRoute.test.ts
git commit -m "feat(ai/w4-5): nút sinh dự đoán đi qua routeAlert (gộp trùng + hạn dùng + nhật ký)"
```

---

## Task 6: Xem cảnh báo vừa đóng, kèm lý do

**Files:**
- Modify: `client/src/pages/OpsConsole.tsx` (`:158` — `trpc.predictiveAlert.list.useQuery({ status: "ACTIVE", limit: 100 })`)
- Modify: `client/src/i18n/locales/{vi,en,zh}.json`

**Bối cảnh:** khi bộ quét đóng một cảnh báo vì đã thôi tái diễn, nó **bốc hơi khỏi màn hình**, và lý do Wave 3 cẩn thận ghi vào `resolutionNotes` **không ai đọc được**.

- [ ] **Step 1: Kiểm hợp đồng API TRƯỚC khi viết UI**

⚠ Bài học Wave 3: badge không bao giờ hiện vì router `.map()` liệt kê tay không có trường cần. **Đọc `predictiveAlertRouter.list` trong `server/routers/aiRouters.ts`** và xác nhận nó trả về `resolutionNotes` và `status`. Nếu thiếu, **thêm vào `.map()`** — và nói rõ trong báo cáo.

- [ ] **Step 2: Cho phép xem cảnh báo vừa đóng**

Thêm một công tắc/bộ lọc trên màn Alert Center để hiện thêm cảnh báo `EXPIRED` gần đây (mặc định TẮT để không làm ồn danh sách đang mở). Khi bật:
- hiện các dòng `EXPIRED` gần đây cùng **lý do đóng** lấy từ `resolutionNotes`;
- phân biệt rõ về mặt thị giác với dòng đang mở (mờ hơn / nhãn "đã đóng"), **không** trộn lẫn khiến người ta tưởng còn đang mở.

Khoá i18n mới, đủ **cả ba** `vi/en/zh`: `alerts.showRecentlyClosed` ("Hiện cảnh báo vừa đóng"), `alerts.closedBadge` ("đã đóng"), `alerts.closedReason` ("Lý do: {{reason}}").

⚠ `resolutionNotes` có thể **rỗng** với dòng đóng bằng đường khác ⇒ khi rỗng thì **không hiện dòng lý do**, tuyệt đối không hiện "Lý do: undefined".

- [ ] **Step 3: Typecheck + commit**

`npx tsc --noEmit` — sạch.

```bash
git add client/src/pages/OpsConsole.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w4-6): xem cảnh báo vừa đóng kèm lý do (không còn biến mất im lặng)"
```

---

## Nghiệm thu (controller làm, không phải người thi công)

**Thứ tự bắt buộc:** chạy migration 0309 **TRƯỚC**, xoá `predictive_alerts` **SAU** (spec §7). Lý do: drizzle liệt kê toàn bộ cột từ schema ⇒ thao tác khi schema và DB lệch nhau sẽ ném `42703` (đúng bài học triển khai Wave 3).

| Kiểm | Đạt khi |
|---|---|
| Đếm | KPI đếm **đúng số lần tái diễn thật**, không phải số dòng |
| Ngập báo động | >10 lượt trong 10 phút ⇒ **phát hiện được** |
| Không biến mất | Cảnh báo tạo nhiều ngày trước, tái diễn hôm nay ⇒ **vẫn trong cửa sổ 24h** |
| Nút sinh dự đoán | Bấm nhiều lần ⇒ **không** đẻ dòng trùng, **có** ghi nhật ký |
| Cảnh báo đã đóng | Xem được, **kèm lý do** |
| `machineCode` | **0 rỗng** trên cảnh báo có `machineId` (ô Wave 3 không đạt) |

**Bắt buộc đi CẢ HAI nhánh** (bài học Wave 2): máy có `machineId` **và** `PATTERN_ANOMALY` không có.
