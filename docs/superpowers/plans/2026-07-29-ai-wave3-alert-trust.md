# Wave 3 — "Đáng tin để hành động" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ngừng sản xuất nhiễu tại nguồn, để mỗi cảnh báo còn lại đều là một việc đáng làm.

**Architecture:** Mang khuôn **one-open-event** (đã có sẵn ở `qualityGateEvaluator`) sang đường cảnh báo máy: một tình trạng đang mở chỉ có MỘT dòng, lần sau chỉ CẬP NHẬT. Quyết định ghi-hay-cập-nhật tách thành hàm thuần để test được không cần DB. Kèm: hạn dùng gắn với "thôi tái diễn", chống trùng báo cáo, không sinh báo cáo rỗng, và đo được thứ bị bộ lọc chặn.

**Tech Stack:** TypeScript · Drizzle (postgres-js) · tRPC · React 19 + TanStack Query · Vitest · PostgreSQL

**Spec:** `docs/superpowers/specs/2026-07-29-ai-wave3-alert-trust-design.md` (`70a67cf2` → `99d49498` → `71ae186f`)

## Global Constraints

- Nhánh `feat/hmi-dep`. Mỗi task commit riêng, **chỉ stage file của task đó** — TUYỆT ĐỐI không `git add -A` (cây làm việc có thay đổi simulator/twin/knowledge chưa commit của người dùng). **Không push** (controller push ở chốt cuối).
- TDD: test đỏ trước → chạy thấy đỏ → cài đặt tối thiểu → chạy thấy xanh. **Không bao giờ làm yếu assertion để test qua.**
- `npx tsc --noEmit` sạch cho file đã chạm (`NODE_OPTIONS=--max-old-space-size=8192`). Lỗi `client/src/pages/SessionManagement.tsx(194,64)` là **có sẵn từ trước, không phải của bạn**.
- **KHÔNG chạy migration, KHÔNG khởi động server, KHÔNG chạy model thật.** Controller đo live sau.
- ⚠ Test logic phía client PHẢI đặt tên `*.unit.test.ts` — `vitest.config.ts:27` chỉ glob mẫu đó cho `client/src/**`. Tên khác thì test **không bao giờ chạy** (đỏ giả vĩnh viễn). Đã xảy ra thật ở Wave 2.
- Env đọc theo khuôn: `const raw = Number(process.env.X); return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT;` — **không** `Number(process.env.X || DEFAULT)` (chuỗi `"0"` là truthy, đã gây lỗi thật).
- Bắt lỗi thiếu bảng/cột dùng cause-walker `isMissingTable`/`isMissingColumn` trong `server/_core/dbErrors.ts` (drizzle bọc mã lỗi pg trong `err.cause`) — **không** so `err.code` trần.
- Chuỗi hiển thị qua `t(...)` mặc định tiếng Việt; khoá thêm vào **cả ba** `client/src/i18n/locales/{vi,en,zh}.json`.
- **KHÔNG đụng `processAutoEscalation()`.** Nó quét `predictive_alerts` theo `status=ACTIVE` + `acknowledgedAt IS NULL` + tuổi dòng. Một dòng được cập nhật vẫn thoả điều kiện đó.
- **KHÔNG đổi ngưỡng phát hay công thức rủi ro/tin cậy**: `urgencyFromRisk`, `RISK_ALERT_THRESHOLD`, `CONFIDENCE_ALERT_THRESHOLD`, `TIMEFRAME_ALERT_HOURS`, `confidenceScore`. Lý do ở spec §4.5(iii) — con số 50–56 là **thiên lệch chọn mẫu**, không phải bằng chứng.
- **Suy giảm phải TRUNG THỰC**: không biến lỗi thành "không có gì" trông như bình thường. Ngoại lệ có chủ ý: đường cảnh báo **fail-OPEN** (spec §3d) — không chắc thì cứ báo.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
|---|---|---|
| `drizzle/0308_alert_occurrence_and_backlog.sql` (**mới**) | Cột `occurrenceCount`/`lastOccurredAt` + gộp đống tồn | 1 |
| `drizzle/schema/ai.ts` (sửa) | Khai 2 cột mới | 1 |
| `server/services/alerts/decideAlertWrite.ts` (**mới**) | Hàm THUẦN: ghi mới hay cập nhật | 2 |
| `server/services/aiSmartAlertRouter.ts` (sửa `:195-216`) | Nối hàm thuần + ghi `machineCode` + tiêu đề + `expiresAt` | 3 |
| `server/services/alertExpirySweeper.ts` (**mới**) | Quét cảnh báo quá hạn → `EXPIRED` kèm lý do | 4 |
| `server/_core/backgroundJobs.ts` (sửa) | Đăng ký sweeper | 4 |
| `server/services/aiExecutiveReport.ts` (sửa `:593-618`) | Chống trùng + không lưu báo cáo rỗng | 5 |
| `server/services/predictiveMaintenanceService.ts` (sửa `:804-812`) | Đếm ứng viên bị chặn theo từng điều kiện | 6 |
| `client/src/lib/alertConfidence.ts` (**mới**) | Hàm THUẦN: điểm tin cậy → dải | 7 |
| `client/src/pages/OpsConsole.tsx` (sửa `:154-179`) | Hiện dải tin cậy + số lần tái diễn | 7 |

---

## Task 1: Migration 0308 — cột đếm + gộp đống tồn

**Files:**
- Create: `drizzle/0308_alert_occurrence_and_backlog.sql`
- Modify: `drizzle/schema/ai.ts` (bảng `predictiveAlerts`)

**Interfaces:**
- Produces: cột `occurrenceCount` (integer NOT NULL DEFAULT 1) và `lastOccurredAt` (timestamptz) trên `predictive_alerts`. Task 2/3/4/7 dùng lại.

- [ ] **Step 1: Viết migration**

Tạo `drizzle/0308_alert_occurrence_and_backlog.sql`:

```sql
-- Wave 3 §7 — một-cảnh-báo-mở cho mỗi (máy × loại).
-- Phần (i): cột đếm số lần tái diễn.
ALTER TABLE "predictive_alerts"
  ADD COLUMN IF NOT EXISTS "occurrenceCount" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lastOccurredAt" timestamptz;

-- Chỉ mục phục vụ truy vấn tìm-cảnh-báo-mở ở Task 3.
CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_open_by_machine_type"
  ON "predictive_alerts" ("machineId", "alertType")
  WHERE "status" = 'ACTIVE' AND "acknowledgedAt" IS NULL;

-- Phần (ii): GỘP đống tồn — KHÔNG XOÁ DÒNG NÀO (spec §5).
-- Mỗi (machineId, alertType) giữ dòng MỚI NHẤT; các dòng cũ chuyển DISMISSED.
WITH ranked AS (
  SELECT id, "machineId", "alertType",
         ROW_NUMBER() OVER (PARTITION BY "machineId", "alertType" ORDER BY "createdAt" DESC, id DESC) AS rn,
         COUNT(*)     OVER (PARTITION BY "machineId", "alertType") AS total
  FROM "predictive_alerts"
  WHERE "status" = 'ACTIVE' AND "machineId" IS NOT NULL
),
keepers AS (
  UPDATE "predictive_alerts" pa
  SET "occurrenceCount" = r.total,
      "lastOccurredAt"  = pa."createdAt"
  FROM ranked r
  WHERE pa.id = r.id AND r.rn = 1
  RETURNING pa.id
)
UPDATE "predictive_alerts" pa
SET "status" = 'DISMISSED',
    "resolutionNotes" = COALESCE(pa."resolutionNotes", '') ||
      'Gộp bởi Wave 3: đã thay bằng cảnh báo mở mới nhất của cùng máy và cùng loại.'
FROM ranked r
WHERE pa.id = r.id AND r.rn > 1;

-- Phần (iii): báo cáo điều hành trùng — giữ bản CŨ NHẤT mỗi tiêu đề.
UPDATE "ai_insights" ai
SET "status" = 'superseded'
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY title ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "ai_insights"
  WHERE "source" = 'exec_report'
) d
WHERE ai.id = d.id AND d.rn > 1;
```

- [ ] **Step 2: Khai 2 cột trong schema drizzle**

Trong `drizzle/schema/ai.ts`, bảng `predictiveAlerts` — thêm cạnh các cột sẵn có (giữ đúng khuôn camelCase-trong-nháy của bảng này):

```ts
  // Wave 3 §3 — số lần tình trạng này tái diễn khi cảnh báo vẫn đang mở.
  occurrenceCount: integer("occurrenceCount").notNull().default(1),
  lastOccurredAt: timestamp("lastOccurredAt", { withTimezone: true }),
```

Kiểm `integer` và `timestamp` đã nằm trong khối `import` của file; nếu chưa, thêm vào.

- [ ] **Step 3: Typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
Kỳ vọng: sạch (trừ lỗi có sẵn `SessionManagement.tsx(194,64)`).

**KHÔNG chạy migration.** Controller chạy bằng owner `aoi` (`avi_app` không có quyền DDL — lỗi `42501`).

- [ ] **Step 4: Commit**

```bash
git add drizzle/0308_alert_occurrence_and_backlog.sql drizzle/schema/ai.ts
git commit -m "feat(ai/w3-1): cột đếm tái diễn + migration gộp đống tồn (không xoá dòng nào)"
```

---

## Task 2: `decideAlertWrite` — hàm thuần quyết định ghi hay cập nhật

**Files:**
- Create: `server/services/alerts/decideAlertWrite.ts`
- Test: `server/services/alerts/decideAlertWrite.test.ts` (**mới**)

**Interfaces:**
- Produces: `decideAlertWrite(existing, incoming, lookupFailed?) → AlertWriteDecision` và `maxSeverity(a, b)`. Task 3 dùng lại.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/alerts/decideAlertWrite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideAlertWrite, maxSeverity } from "./decideAlertWrite";

const open = { id: 7, severity: "HIGH" as const, occurrenceCount: 22 };

describe("maxSeverity — mức độ chỉ đi lên", () => {
  it("CRITICAL vs MEDIUM ⇒ CRITICAL", () => {
    expect(maxSeverity("CRITICAL", "MEDIUM")).toBe("CRITICAL");
  });
  it("MEDIUM vs CRITICAL ⇒ CRITICAL (không phụ thuộc thứ tự tham số)", () => {
    expect(maxSeverity("MEDIUM", "CRITICAL")).toBe("CRITICAL");
  });
});

describe("decideAlertWrite", () => {
  it("KHÔNG có machineId ⇒ luôn INSERT, kể cả khi có cảnh báo mở", () => {
    expect(decideAlertWrite(open, { machineId: null, alertType: "PATTERN_ANOMALY", severity: "MEDIUM" }))
      .toEqual({ action: "insert", reason: "no-machine" });
  });

  it("tra cứu HỎNG ⇒ INSERT (fail-OPEN), kể cả khi có cảnh báo mở", () => {
    expect(decideAlertWrite(open, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }, true))
      .toEqual({ action: "insert", reason: "lookup-failed" });
  });

  it("không có cảnh báo mở ⇒ INSERT", () => {
    expect(decideAlertWrite(null, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }))
      .toEqual({ action: "insert", reason: "no-open-alert" });
  });

  it("có cảnh báo mở ⇒ UPDATE, tăng số lần tái diễn từ giá trị CŨ", () => {
    expect(decideAlertWrite(open, { machineId: 2, alertType: "MACHINE_FAILURE", severity: "HIGH" }))
      .toEqual({ action: "update", id: 7, severity: "HIGH", occurrenceCount: 23 });
  });

  it("mức độ KHÔNG được tụt: đang CRITICAL, vòng sau MEDIUM ⇒ vẫn CRITICAL", () => {
    expect(decideAlertWrite({ id: 9, severity: "CRITICAL", occurrenceCount: 1 },
      { machineId: 2, alertType: "MACHINE_FAILURE", severity: "MEDIUM" }))
      .toEqual({ action: "update", id: 9, severity: "CRITICAL", occurrenceCount: 2 });
  });

  it("mức độ ĐƯỢC nâng: đang MEDIUM, vòng sau CRITICAL ⇒ CRITICAL", () => {
    expect(decideAlertWrite({ id: 9, severity: "MEDIUM", occurrenceCount: 4 },
      { machineId: 2, alertType: "MACHINE_FAILURE", severity: "CRITICAL" }))
      .toEqual({ action: "update", id: 9, severity: "CRITICAL", occurrenceCount: 5 });
  });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/decideAlertWrite.test.ts`
Kỳ vọng: FAIL — không tìm thấy module `./decideAlertWrite`.

- [ ] **Step 3: Cài đặt**

Tạo `server/services/alerts/decideAlertWrite.ts`:

```ts
/**
 * Wave 3 §3 — MỘT-CẢNH-BÁO-MỞ cho mỗi (máy × loại).
 *
 * Tách khỏi routeAlert để test được KHÔNG CẦN DB. Bài học Wave 2: logic rủi ro
 * nằm lẫn trong hàm có I/O thì không test nào chạy qua nó.
 *
 * Hàm này KHÔNG quyết định có nên phát cảnh báo hay không — việc đó do
 * predictiveMaintenanceService quyết trước khi gọi. Nó chỉ quyết GHI MỚI hay
 * CẬP NHẬT dòng đang mở.
 */
export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface OpenAlertSnapshot {
  id: number;
  severity: AlertSeverity;
  occurrenceCount: number;
}

export interface IncomingAlert {
  machineId: number | null | undefined;
  alertType: string;
  severity: AlertSeverity;
}

export type AlertWriteDecision =
  | { action: "insert"; reason: "no-machine" | "no-open-alert" | "lookup-failed" }
  | { action: "update"; id: number; severity: AlertSeverity; occurrenceCount: number };

const RANK: Record<AlertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Mức độ chỉ đi LÊN — một tình trạng đã CRITICAL không được âm thầm tụt xuống. */
export function maxSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

export function decideAlertWrite(
  existing: OpenAlertSnapshot | null,
  incoming: IncomingAlert,
  lookupFailed = false,
): AlertWriteDecision {
  // FAIL-OPEN, ngược hướng cổng bảo mật Wave 2: bỏ sót cảnh báo hỏng máy tốn
  // một cái máy; cảnh báo trùng chỉ tốn một dòng.
  if (lookupFailed) return { action: "insert", reason: "lookup-failed" };

  // Không có máy ⇒ không có khoá gộp. Không bịa khoá từ dữ liệu không có.
  if (incoming.machineId == null) return { action: "insert", reason: "no-machine" };

  if (!existing) return { action: "insert", reason: "no-open-alert" };

  return {
    action: "update",
    id: existing.id,
    severity: maxSeverity(existing.severity, incoming.severity),
    occurrenceCount: existing.occurrenceCount + 1,
  };
}
```

- [ ] **Step 4: Chạy để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/decideAlertWrite.test.ts`
Kỳ vọng: PASS 8/8.

- [ ] **Step 5: Commit**

```bash
git add server/services/alerts/decideAlertWrite.ts server/services/alerts/decideAlertWrite.test.ts
git commit -m "feat(ai/w3-2): hàm thuần quyết định ghi-mới-hay-cập-nhật (mức độ chỉ đi lên, fail-open)"
```

---

## Task 3: Nối vào `routeAlert` — cập nhật thay vì nhân bản

**Files:**
- Modify: `server/services/aiSmartAlertRouter.ts` (khối INSERT hiện ở `:195-216`)
- Test: `server/services/aiSmartAlertRouter.oneOpen.test.ts` (**mới**)

**Interfaces:**
- Consumes: `decideAlertWrite`, `maxSeverity` (Task 2); cột `occurrenceCount`/`lastOccurredAt` (Task 1).

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/aiSmartAlertRouter.oneOpen.test.ts`. Mock `../db/connection` để `getDb()` trả một db giả ghi lại lời gọi. Ba khẳng định bắt buộc:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { kind: string; payload?: any }[] = [];

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => calls.find(c => c.kind === "seed-open")?.payload ?? [] }) }) }) }),
    insert: () => ({ values: (v: any) => { calls.push({ kind: "insert", payload: v }); return { returning: async () => [{ id: 1 }] }; } }),
    update: () => ({ set: (v: any) => { calls.push({ kind: "update", payload: v }); return { where: async () => undefined }; } }),
  }),
}));

beforeEach(() => { calls.length = 0; });

describe("routeAlert — một-cảnh-báo-mở", () => {
  it("chưa có cảnh báo mở ⇒ INSERT", async () => {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 2, severity: "HIGH", message: "x", data: {} } as any);
    expect(calls.some(c => c.kind === "insert")).toBe(true);
    expect(calls.some(c => c.kind === "update")).toBe(false);
  });

  it("đã có cảnh báo mở ⇒ UPDATE, KHÔNG insert, và KHÔNG đụng createdAt", async () => {
    calls.push({ kind: "seed-open", payload: [{ id: 7, severity: "HIGH", occurrenceCount: 22 }] });
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 2, severity: "HIGH", message: "x", data: {} } as any);
    const upd = calls.find(c => c.kind === "update");
    expect(upd).toBeTruthy();
    expect(calls.some(c => c.kind === "insert")).toBe(false);
    expect(upd!.payload.occurrenceCount).toBe(23);
    expect(upd!.payload).not.toHaveProperty("createdAt");
  });

  it("không có machineId ⇒ luôn INSERT (PATTERN_ANOMALY)", async () => {
    calls.push({ kind: "seed-open", payload: [{ id: 7, severity: "HIGH", occurrenceCount: 22 }] });
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "PATTERN_ANOMALY", severity: "MEDIUM", message: "x", data: {} } as any);
    expect(calls.some(c => c.kind === "insert")).toBe(true);
  });
});
```

Nếu hình dạng mock không khớp chuỗi gọi drizzle thật, **sửa mock cho khớp mã thật** — không sửa mã sản xuất cho vừa mock, và **không nới assertion**. Ba khẳng định trên là bắt buộc giữ nguyên ý nghĩa.

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiSmartAlertRouter.oneOpen.test.ts`
Kỳ vọng: FAIL — hiện tại luôn INSERT, không bao giờ UPDATE.

- [ ] **Step 3: Thêm import + hằng số TTL**

Đầu `server/services/aiSmartAlertRouter.ts`: thêm `machines` vào khối import từ `../../drizzle/schema` (bảng khai ở `drizzle/schema/hierarchy.ts:259`, có cột `code`), thêm `desc` vào import `drizzle-orm`, và:

```ts
import { decideAlertWrite, type AlertSeverity } from "./alerts/decideAlertWrite";

/** Wave 3 §4.2 — hạn dùng cảnh báo. Gia hạn mỗi lần tái diễn, nên hết hạn
 *  nghĩa là "tình trạng đã THÔI tái diễn", không phải "đã quá N ngày". */
function alertTtlMs(): number {
  const raw = Number(process.env.ALERT_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 72;
  return hours * 3600_000;
}
```

- [ ] **Step 4: Thay khối INSERT bằng tra-cứu + cập-nhật-hoặc-ghi**

Thay khối `// Step 5: Record in predictive_alerts table` (`:195-216`) bằng:

```ts
  // Wave 3 §3 — MỘT-CẢNH-BÁO-MỞ cho mỗi (machineId, alertType).
  let existingOpen: { id: number; severity: AlertSeverity; occurrenceCount: number } | null = null;
  let lookupFailed = false;
  if (event.machineId != null) {
    try {
      const rows = await db
        .select({
          id: predictiveAlerts.id,
          severity: predictiveAlerts.severity,
          occurrenceCount: predictiveAlerts.occurrenceCount,
        })
        .from(predictiveAlerts)
        .where(and(
          eq(predictiveAlerts.machineId, event.machineId),
          eq(predictiveAlerts.alertType, event.type),
          eq(predictiveAlerts.status, "ACTIVE" as any),
          isNull(predictiveAlerts.acknowledgedAt),
        ))
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(1);
      existingOpen = rows[0]
        ? { id: rows[0].id, severity: String(rows[0].severity) as AlertSeverity, occurrenceCount: Number(rows[0].occurrenceCount ?? 1) }
        : null;
    } catch (err) {
      // FAIL-OPEN có chủ ý (spec §3d): thà một dòng trùng còn hơn mất một cảnh báo hỏng máy.
      lookupFailed = true;
      console.error("[SmartAlert] tra cứu cảnh báo mở THẤT BẠI — ghi mới để không bỏ sót:", (err as Error)?.message ?? err);
    }
  }

  // Mã máy: cột phi chuẩn hoá trước đây KHÔNG BAO GIỜ được ghi (spec §2 nguyên nhân 3).
  let machineCode: string | null = null;
  if (event.machineId != null) {
    try {
      const m = await db.select({ code: machines.code }).from(machines).where(eq(machines.id, event.machineId)).limit(1);
      machineCode = m[0]?.code ?? null;
    } catch { machineCode = null; }
  }

  const decision = decideAlertWrite(
    existingOpen,
    { machineId: event.machineId ?? null, alertType: event.type, severity: event.severity as AlertSeverity },
    lookupFailed,
  );

  const expiresAt = new Date(Date.now() + alertTtlMs());
  const confidence = event.data.confidence != null ? String(event.data.confidence) : null;
  const timeframe = event.data.predictedTimeframe ? String(event.data.predictedTimeframe) : null;

  // Tiêu đề: trước đây là "MACHINE FAILURE: HIGH" lặp y hệt trên 49 dòng.
  // Có máy ⇒ nêu máy + rủi ro + khung thời gian. Không có máy ⇒ giữ khuôn cũ,
  // KHÔNG bịa mã máy rỗng vào chuỗi (spec §4.1).
  const readableTitle = machineCode
    ? `${event.type.replace(/_/g, " ")} · ${machineCode}` +
      (event.data.currentValue != null ? ` · ${event.data.currentValue}%` : "") +
      (timeframe ? ` · ${timeframe}` : "")
    : `${event.type.replace(/_/g, " ")}: ${event.severity}`;

  let alertRecord: { id: number } | undefined;

  if (decision.action === "update") {
    await db
      .update(predictiveAlerts)
      .set({
        severity: decision.severity as any,
        occurrenceCount: decision.occurrenceCount,
        lastOccurredAt: new Date(),
        title: readableTitle.slice(0, 255),
        description: event.message,
        machineCode,
        currentValue: event.data.currentValue != null ? String(event.data.currentValue) : null,
        threshold: event.data.threshold != null ? String(event.data.threshold) : null,
        confidenceScore: confidence,
        predictedTimeframe: timeframe,
        aiAnalysis: aiAnalysisPayload,
        expiresAt,
        updatedAt: new Date(),
        // KHÔNG đụng createdAt: processAutoEscalation() đo tuổi dòng để leo thang.
        // Reset createdAt ⇒ tình trạng kéo dài VĨNH VIỄN không bao giờ leo thang.
      } as any)
      .where(eq(predictiveAlerts.id, decision.id));
    alertRecord = { id: decision.id };
  } else {
    const [row] = await db
      .insert(predictiveAlerts)
      .values({
        alertType: event.type,
        severity: event.severity,
        title: readableTitle.slice(0, 255),
        description: event.message,
        machineId: event.machineId ?? null,
        machineCode,
        factoryId: event.factoryId ?? null,
        productModelId: event.productModelId ?? null,
        currentValue: event.data.currentValue ? String(event.data.currentValue) : null,
        threshold: event.data.threshold ? String(event.data.threshold) : null,
        confidenceScore: confidence,
        predictedTimeframe: timeframe,
        aiAnalysis: aiAnalysisPayload,
        status: "ACTIVE",
        notificationSent: true,
        notificationSentAt: new Date(),
        occurrenceCount: 1,
        lastOccurredAt: new Date(),
        expiresAt,
        ...(runbookRef ? { runbookRef } : {}),
        ...(recommendationRef ? { recommendationRef } : {}),
      } as any)
      .returning({ id: predictiveAlerts.id });
    alertRecord = row;
  }
```

Nếu phần mã phía sau dùng `alertRecord`, giữ nguyên cách dùng — biến vẫn tồn tại với cùng hình dạng.

- [ ] **Step 5: Chạy test + typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiSmartAlertRouter.oneOpen.test.ts server/services/alerts/decideAlertWrite.test.ts`
Kỳ vọng: PASS toàn bộ.

Chạy thêm quét hồi quy: `npx vitest run server/services/aiSmartAlertRouter` và `npx vitest run server/routers/aiRcaAlertSql.test.ts` (file này chèn thẳng vào `predictiveAlerts` — phải không hồi quy).

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — sạch.

- [ ] **Step 6: Commit**

```bash
git add server/services/aiSmartAlertRouter.ts server/services/aiSmartAlertRouter.oneOpen.test.ts
git commit -m "feat(ai/w3-3): cập nhật cảnh báo đang mở thay vì nhân bản; ghi machineCode + tiêu đề nêu máy + hạn dùng"
```

---

## Task 4: Quét cảnh báo quá hạn → `EXPIRED` kèm lý do

**Files:**
- Create: `server/services/alertExpirySweeper.ts`
- Modify: `server/_core/backgroundJobs.ts` (thêm khối đăng ký cạnh `initDeepModelWarmup`, `:123-130`)
- Test: `server/services/alertExpirySweeper.test.ts` (**mới**)

**Interfaces:**
- Consumes: cột `expiresAt` do Task 3 ghi.
- Produces: `initAlertExpirySweeper()` và `sweepExpiredAlerts()` (trả `{ expired: number }`).

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/alertExpirySweeper.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    update: () => ({ set: (v: any) => { updates.push(v); return { where: async () => [{ id: 1 }, { id: 2 }] }; } }),
  }),
}));

beforeEach(() => { updates.length = 0; });

describe("sweepExpiredAlerts", () => {
  it("chuyển sang EXPIRED và GHI RÕ LÝ DO (không biến mất im lặng)", async () => {
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await sweepExpiredAlerts();
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("EXPIRED");
    expect(String(updates[0].resolutionNotes ?? "")).toMatch(/thôi tái diễn|hết hạn/i);
  });

  it("lỗi DB ⇒ KHÔNG ném ra ngoài (best-effort, không làm sập tiến trình nền)", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await expect(sweepExpiredAlerts()).resolves.toBeDefined();
  });
});
```

Nếu đường dẫn mock không khớp cách file thật import, sửa mock cho khớp — **không** sửa mã sản xuất cho vừa mock.

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alertExpirySweeper.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Cài đặt sweeper**

Tạo `server/services/alertExpirySweeper.ts`:

```ts
import { getDb } from "../db/connection";
import { predictiveAlerts } from "../../drizzle/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { isMissingColumn, isMissingTable } from "../_core/dbErrors";

/**
 * Wave 3 §4.2 — cảnh báo được GIA HẠN mỗi lần tái diễn (Task 3). Nên hết hạn
 * KHÔNG có nghĩa "đã quá N ngày" mà là "tình trạng đã THÔI tái diễn".
 * Không bao giờ để cảnh báo biến mất im lặng: mỗi dòng đóng đều ghi lý do.
 */
export async function sweepExpiredAlerts(): Promise<{ expired: number }> {
  try {
    const db = await getDb();
    if (!db) return { expired: 0 };
    const rows: any = await db
      .update(predictiveAlerts)
      .set({
        status: "EXPIRED" as any,
        // Chuỗi THUẦN, không phải sql`` — để test khẳng định được nội dung.
        // Dòng bị đóng ở đây luôn là ACTIVE + chưa ghi nhận, nên resolutionNotes
        // gần như chắc chắn đang rỗng; không cần nối thêm.
        resolutionNotes: "Tự đóng: tình trạng đã thôi tái diễn trước khi hết hạn cảnh báo.",
        updatedAt: new Date(),
      } as any)
      .where(and(
        eq(predictiveAlerts.status, "ACTIVE" as any),
        isNull(predictiveAlerts.acknowledgedAt),
        lt(predictiveAlerts.expiresAt, new Date()),
      ));
    const expired = Array.isArray(rows) ? rows.length : Number(rows?.rowCount ?? 0);
    if (expired > 0) console.log(`[alertExpiry] đã đóng ${expired} cảnh báo hết hạn (kèm lý do).`);
    return { expired };
  } catch (err) {
    if (isMissingTable(err) || isMissingColumn(err)) {
      console.warn("[alertExpiry] bảng/cột chưa có (migration 0308 chưa chạy?) — bỏ qua lượt quét.");
    } else {
      console.error("[alertExpiry] lượt quét THẤT BẠI:", err);
    }
    return { expired: 0 };
  }
}

let timer: NodeJS.Timeout | null = null;

/** Đăng ký quét định kỳ. Không bao giờ ném. Tắt bằng ALERT_EXPIRY_SWEEP_ENABLED=false. */
export function initAlertExpirySweeper(): void {
  if (process.env.ALERT_EXPIRY_SWEEP_ENABLED === "false") return;
  if (timer) return;
  const raw = Number(process.env.ALERT_EXPIRY_SWEEP_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 30;
  timer = setInterval(() => { void sweepExpiredAlerts(); }, minutes * 60_000);
  timer.unref?.();
}
```

- [ ] **Step 4: Đăng ký vào tiến trình nền**

Trong `server/_core/backgroundJobs.ts`, thêm khối ngay sau khối `initDeepModelWarmup` (`:123-130`), theo đúng khuôn try/catch của các khối anh em:

```ts
  // Wave 3 §4.2 — đóng cảnh báo đã thôi tái diễn, kèm lý do. Best-effort.
  try {
    const { initAlertExpirySweeper } = await import("../services/alertExpirySweeper");
    initAlertExpirySweeper();
  } catch (err) {
    console.error("[alertExpiry] khởi tạo thất bại:", (err as any)?.message || err);
  }
```

- [ ] **Step 5: Chạy test + typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alertExpirySweeper.test.ts` — PASS.
Chạy: `npx tsc --noEmit` — sạch.

- [ ] **Step 6: Commit**

```bash
git add server/services/alertExpirySweeper.ts server/services/alertExpirySweeper.test.ts server/_core/backgroundJobs.ts
git commit -m "feat(ai/w3-4): đóng cảnh báo đã thôi tái diễn, ghi rõ lý do (không biến mất im lặng)"
```

---

## Task 5: Báo cáo điều hành — chống trùng + không lưu báo cáo rỗng

**Files:**
- Modify: `server/services/aiExecutiveReport.ts` (`persistExecutiveSummary` ở `:593-618`)
- Test: `server/services/aiExecutiveReport.persist.test.ts` (**mới**)

**Interfaces:**
- Produces: `hasReportableContent(s) → boolean` (xuất khẩu để test).

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/aiExecutiveReport.persist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasReportableContent } from "./aiExecutiveReport";

const base = {
  headline: "", highlights: [] as string[], risks: [] as string[], recommendations: [] as string[],
  kpis: { fpy: 0, ngRate: 0 } as any,
};

describe("hasReportableContent — không sinh báo cáo rỗng", () => {
  it("KPI toàn 0, không rủi ro, không điểm nhấn ⇒ KHÔNG đáng lưu", () => {
    expect(hasReportableContent(base as any)).toBe(false);
  });
  it("có điểm nhấn ⇒ đáng lưu", () => {
    expect(hasReportableContent({ ...base, highlights: ["FPY tăng 3%"] } as any)).toBe(true);
  });
  it("có rủi ro ⇒ đáng lưu", () => {
    expect(hasReportableContent({ ...base, risks: ["Máy L1-AOI nguy cơ hỏng"] } as any)).toBe(true);
  });
  it("KPI khác 0 ⇒ đáng lưu dù không có điểm nhấn", () => {
    expect(hasReportableContent({ ...base, kpis: { fpy: 96.2, ngRate: 3.8 } } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiExecutiveReport.persist.test.ts`
Kỳ vọng: FAIL — `hasReportableContent` chưa được xuất khẩu.

- [ ] **Step 3: Cài đặt vị từ + chống trùng**

Trong `server/services/aiExecutiveReport.ts`, thêm trước `persistExecutiveSummary`:

```ts
/**
 * Wave 3 §4.4 — một báo cáo không nói gì mà vẫn chiếm chỗ trong hòm chờ đọc
 * chính là thứ dạy người ta bỏ qua cả hòm. Đo được: 111 dòng chỉ mang 36 nội
 * dung khác nhau, nhiều bản `fpy: 0, ngRate: 0`, thân bài 129 ký tự.
 */
export function hasReportableContent(s: ExecutiveSummaryStructured): boolean {
  if (s.highlights?.length) return true;
  if (s.risks?.length) return true;
  if (s.recommendations?.length) return true;
  const k = s.kpis as unknown as Record<string, unknown>;
  return Object.values(k ?? {}).some((v) => typeof v === "number" && Number.isFinite(v) && v !== 0);
}
```

Rồi trong `persistExecutiveSummary`, ngay sau `if (!db) return null;`:

```ts
    // Wave 3 §4.4 — không lưu báo cáo rỗng; nói rõ lý do thay vì im lặng.
    if (!hasReportableContent(s)) {
      console.log(`[aiExecutiveReport] bỏ qua báo cáo rỗng (${s.period}) — không có KPI khác 0, rủi ro hay điểm nhấn.`);
      return null;
    }

    // Wave 3 §4.3 — chống trùng theo (source, title). Tiêu đề đã chứa sẵn kỳ và
    // mốc thời gian, nên trùng tiêu đề = chạy lặp cùng một kỳ.
    const title = summaryTitle(s);
    const existing = await db
      .select({ id: aiInsights.id })
      .from(aiInsights)
      .where(and(eq(aiInsights.source, EXEC_REPORT_SOURCE), eq(aiInsights.title, title)))
      .limit(1);
    if (existing[0]) {
      console.log(`[aiExecutiveReport] đã có báo cáo cùng tiêu đề (#${existing[0].id}) — không tạo bản trùng.`);
      return existing[0].id;
    }
```

Và đổi `title: summaryTitle(s),` trong `.values({...})` thành `title,` để dùng lại biến vừa tính.

Kiểm `and`/`eq` đã nằm trong import `drizzle-orm` của file; nếu chưa, thêm vào.

- [ ] **Step 4: Chạy để thấy XANH + typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/aiExecutiveReport.persist.test.ts` — PASS 4/4.
Chạy quét hồi quy: `npx vitest run server/routers/executiveReportScope.test.ts server/routers/executiveReportFactoryIsolation.db.test.ts`.
Chạy: `npx tsc --noEmit` — sạch.

- [ ] **Step 5: Commit**

```bash
git add server/services/aiExecutiveReport.ts server/services/aiExecutiveReport.persist.test.ts
git commit -m "feat(ai/w3-5): chống trùng báo cáo điều hành theo (source,title) + không lưu báo cáo rỗng"
```

---

## Task 6: Đo được thứ bị bộ lọc chặn

**Files:**
- Modify: `server/services/predictiveMaintenanceService.ts` (khối cổng phát cảnh báo `:804-812`)
- Create: `server/services/alerts/classifySuppression.ts`
- Test: `server/services/alerts/classifySuppression.test.ts` (**mới**)

**Interfaces:**
- Produces: `classifySuppression(input, thresholds) → "emit" | "low-risk" | "low-confidence" | "out-of-timeframe"`.

**Bối cảnh bắt buộc đọc:** spec §4.5(iii). Ứng viên bị loại hiện **biến mất không để lại dấu vết**, nên không ai biết ngưỡng đang chặn 3 hay 3000 cảnh báo. Task này **CHỈ ĐẾM VÀ LOG** — **không đổi ngưỡng, không đổi công thức, không tạo dòng cảnh báo nào**.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/alerts/classifySuppression.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifySuppression } from "./classifySuppression";

const th = { risk: 60, confidence: 50, timeframeHours: 168 };

describe("classifySuppression — vì sao ứng viên bị chặn", () => {
  it("đủ mọi điều kiện ⇒ emit", () => {
    expect(classifySuppression({ failureRisk: 70, confidenceScore: 55, predictedTimeframeHours: 24 }, th)).toBe("emit");
  });
  it("rủi ro thấp ⇒ low-risk", () => {
    expect(classifySuppression({ failureRisk: 40, confidenceScore: 90, predictedTimeframeHours: 24 }, th)).toBe("low-risk");
  });
  it("tin cậy thấp ⇒ low-confidence", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 20, predictedTimeframeHours: 24 }, th)).toBe("low-confidence");
  });
  it("ngoài khung thời gian ⇒ out-of-timeframe", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: 999 }, th)).toBe("out-of-timeframe");
  });
  it("thiếu khung thời gian (null) ⇒ out-of-timeframe, KHÔNG coi là đạt", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: null }, th)).toBe("out-of-timeframe");
  });
  it("rủi ro thấp được báo TRƯỚC tin cậy thấp (thứ tự ổn định để đếm không nhập nhằng)", () => {
    expect(classifySuppression({ failureRisk: 10, confidenceScore: 10, predictedTimeframeHours: 24 }, th)).toBe("low-risk");
  });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/classifySuppression.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Cài đặt**

Tạo `server/services/alerts/classifySuppression.ts`:

```ts
/**
 * Wave 3 §4.5 — CHỈ QUAN SÁT. Không đổi ngưỡng, không đổi công thức.
 * Phân loại vì sao một ứng viên KHÔNG được phát, để lần sau hiệu chỉnh ngưỡng
 * bằng bằng chứng thay vì cảm tính. Trước đây ứng viên bị loại biến mất không
 * dấu vết, nên không ai biết ngưỡng đang chặn 3 hay 3000 cảnh báo.
 */
export type SuppressionReason = "emit" | "low-risk" | "low-confidence" | "out-of-timeframe";

export interface SuppressionInput {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null | undefined;
}

export interface SuppressionThresholds {
  risk: number;
  confidence: number;
  timeframeHours: number;
}

export function classifySuppression(input: SuppressionInput, th: SuppressionThresholds): SuppressionReason {
  // Thứ tự cố định để số đếm không nhập nhằng khi nhiều điều kiện cùng trượt.
  if (!(input.failureRisk >= th.risk)) return "low-risk";
  if (!(input.confidenceScore >= th.confidence)) return "low-confidence";
  const hours = input.predictedTimeframeHours;
  if (hours == null || !Number.isFinite(hours) || hours > th.timeframeHours) return "out-of-timeframe";
  return "emit";
}
```

- [ ] **Step 4: Nối vào cổng phát, KHÔNG đổi hành vi phát**

Trong `server/services/predictiveMaintenanceService.ts`, thay khối điều kiện ở `:804-812`. Giữ **nguyên** biểu thức quyết định phát; chỉ thêm phân loại + đếm:

```ts
      // Wave 3 §4.5 — CHỈ QUAN SÁT: phân loại vì sao ứng viên bị chặn.
      // KHÔNG đổi ngưỡng, KHÔNG đổi điều kiện phát bên dưới.
      const { classifySuppression } = await import("./alerts/classifySuppression");
      const suppression = classifySuppression(
        {
          failureRisk: risk.failureRisk,
          confidenceScore: risk.confidenceScore,
          predictedTimeframeHours: risk.predictedTimeframeHours,
        },
        { risk: RISK_ALERT_THRESHOLD, confidence: CONFIDENCE_ALERT_THRESHOLD, timeframeHours: TIMEFRAME_ALERT_HOURS },
      );
      suppressionTally[suppression] = (suppressionTally[suppression] ?? 0) + 1;
```

Khai `suppressionTally` ngay trước vòng lặp quét máy (cùng chỗ khai `alertsEmitted`):

```ts
  const suppressionTally: Record<string, number> = {};
```

Và sau vòng lặp, cạnh chỗ báo cáo `alertsEmitted`:

```ts
  console.log(`[PredictiveMaintenance] ứng viên theo kết cục: ${JSON.stringify(suppressionTally)} (ngưỡng: rủi ro ${RISK_ALERT_THRESHOLD}, tin cậy ${CONFIDENCE_ALERT_THRESHOLD}, khung ${TIMEFRAME_ALERT_HOURS}h)`);
```

⚠ **Không sửa** biểu thức `if (risk.failureRisk >= RISK_ALERT_THRESHOLD && ...)` hiện có. Số đếm phải là quan sát viên độc lập; nếu bạn thay nó bằng `suppression === "emit"` thì một sai lệch giữa hai đường sẽ không bao giờ bị phát hiện.

- [ ] **Step 5: Chạy test + typecheck**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run server/services/alerts/classifySuppression.test.ts` — PASS 6/6.
Chạy quét hồi quy: `npx vitest run server/services/predictiveMaintenance`.
Chạy: `npx tsc --noEmit` — sạch.

- [ ] **Step 6: Commit**

```bash
git add server/services/alerts/classifySuppression.ts server/services/alerts/classifySuppression.test.ts server/services/predictiveMaintenanceService.ts
git commit -m "feat(ai/w3-6): đếm ứng viên bị chặn theo từng điều kiện (chỉ quan sát, không đổi ngưỡng)"
```

---

## Task 7: Hiện độ tin cậy và số lần tái diễn trên màn cảnh báo

**Files:**
- Create: `client/src/lib/alertConfidence.ts`
- Test: `client/src/lib/alertConfidence.unit.test.ts` (**mới** — ⚠ đuôi `.unit.test.ts` bắt buộc)
- Modify: `client/src/pages/OpsConsole.tsx` (khối hiển thị cảnh báo dự đoán)
- Modify: `client/src/i18n/locales/{vi,en,zh}.json`

**Interfaces:**
- Consumes: `occurrenceCount` (Task 1), `confidenceScore` (đã có sẵn trong bảng).
- Produces: `confidenceBand(score) → "low" | "medium" | "high" | "unknown"`.

- [ ] **Step 1: Viết test đỏ**

Tạo `client/src/lib/alertConfidence.unit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { confidenceBand } from "./alertConfidence";

describe("confidenceBand", () => {
  it("dưới 60 ⇒ thấp", () => { expect(confidenceBand(52)).toBe("low"); });
  it("60–79 ⇒ trung bình", () => { expect(confidenceBand(70)).toBe("medium"); });
  it("từ 80 ⇒ cao", () => { expect(confidenceBand(88)).toBe("high"); });
  it("null ⇒ unknown, KHÔNG mặc định thành 'cao'", () => { expect(confidenceBand(null)).toBe("unknown"); });
  it("chuỗi số (decimal từ pg) vẫn phân dải đúng", () => { expect(confidenceBand("52.00")).toBe("low"); });
  it("giá trị rác ⇒ unknown, không ném", () => { expect(confidenceBand("abc" as any)).toBe("unknown"); });
});
```

- [ ] **Step 2: Chạy để thấy ĐỎ**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/lib/alertConfidence.unit.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Cài đặt hàm thuần**

Tạo `client/src/lib/alertConfidence.ts`:

```ts
/**
 * Wave 3 §4.5 — độ tin cậy là TRỤC RIÊNG, không phải mức độ.
 * `HIGH · bằng chứng vừa đủ (52%)` phải khác `HIGH · bằng chứng vững (88%)`;
 * hiện tại hai cái nhìn giống hệt nhau trên màn hình.
 *
 * Cột `confidenceScore` là decimal của pg ⇒ tRPC trả về CHUỖI, không phải số.
 * Không rõ ⇒ "unknown", tuyệt đối không mặc định thành "cao".
 */
export type ConfidenceBand = "low" | "medium" | "high" | "unknown";

export function confidenceBand(score: number | string | null | undefined): ConfidenceBand {
  if (score == null) return "unknown";
  const n = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 80) return "high";
  if (n >= 60) return "medium";
  return "low";
}
```

- [ ] **Step 4: Chạy để thấy XANH**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run client/src/lib/alertConfidence.unit.test.ts` — PASS 6/6.

- [ ] **Step 5: Hiện trên `OpsConsole.tsx`**

Trong khối render danh sách cảnh báo dự đoán (`predictiveQuery.data`, hook ở `:154`), cạnh nhãn mức độ hiện có, thêm hai chỉ báo:

- **Dải tin cậy**: `t("alerts.confidenceLow", "bằng chứng vừa đủ ({{n}}%)")` / `alerts.confidenceMedium` "bằng chứng khá ({{n}}%)" / `alerts.confidenceHigh` "bằng chứng vững ({{n}}%)" / `alerts.confidenceUnknown` "chưa rõ độ tin cậy". Dùng `confidenceBand(alert.confidenceScore)`.
- **Số lần tái diễn**, chỉ hiện khi `occurrenceCount > 1`: `t("alerts.recurrence", "đã tái diễn {{n}} lần")`.

Yêu cầu bắt buộc:
- Số lần tái diễn phải hiện **cạnh mức độ**, không giấu trong chi tiết — spec §6: sau khi gộp, số cảnh báo tụt từ 52 xuống 6, và số-lần-tái-diễn là thứ chứng minh hệ vẫn đang làm việc.
- `occurrenceCount` có thể **thiếu** nếu migration 0308 chưa chạy ⇒ coi như 1 và **không hiện gì**, không hiện `NaN` hay `undefined`.
- Thêm cả 5 khoá vào **cả ba** `vi/en/zh`.
- **Không đụng** `ackPredictive` hay bất kỳ mutation nào.

Khung cho phần dễ sai nhất (`occurrenceCount` thiếu khi migration chưa chạy — tuyệt đối không để lọt `NaN`/`undefined` ra màn hình):

```tsx
{(() => {
  const band = confidenceBand(alert.confidenceScore);
  const times = Number(alert.occurrenceCount ?? 1);
  const label =
    band === "high"   ? t("alerts.confidenceHigh",   "bằng chứng vững ({{n}}%)",   { n: alert.confidenceScore }) :
    band === "medium" ? t("alerts.confidenceMedium", "bằng chứng khá ({{n}}%)",    { n: alert.confidenceScore }) :
    band === "low"    ? t("alerts.confidenceLow",    "bằng chứng vừa đủ ({{n}}%)", { n: alert.confidenceScore }) :
                        t("alerts.confidenceUnknown","chưa rõ độ tin cậy");
  return (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      {Number.isFinite(times) && times > 1 && (
        <Badge variant="secondary">{t("alerts.recurrence", "đã tái diễn {{n}} lần", { n: times })}</Badge>
      )}
    </>
  );
})()}
```

- [ ] **Step 6: Typecheck + commit**

Chạy: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — sạch.

```bash
git add client/src/lib/alertConfidence.ts client/src/lib/alertConfidence.unit.test.ts client/src/pages/OpsConsole.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/w3-7): hiện dải tin cậy + số lần tái diễn cạnh mức độ cảnh báo"
```

---

## Nghiệm thu (controller làm, không phải người thi công)

Chạy **chính những truy vấn đã dùng để chẩn đoán** (spec §8):

| Kiểm | Trước | Đạt khi |
|---|---|---|
| Cảnh báo mở mỗi (máy × loại) | 22 cái/máy/ngày | **≤ 1** |
| Tổng `ACTIVE` | 52 | **6** (3 gộp + 3 `PATTERN_ANOMALY`) |
| `machineCode` rỗng | 52/52 | 0 trên cảnh báo có `machineId` |
| Dòng báo cáo / nội dung khác nhau | 111 / 36 | **1 : 1** với báo cáo mới |
| Cảnh báo quá hạn còn `ACTIVE` | 52 | **0**, mỗi cái `EXPIRED` có lý do |
| Ứng viên bị loại | **không đo được** | đếm được theo từng điều kiện |

**Nghiệm thu live bắt buộc — phải đi CẢ HAI nhánh** (bài học Wave 2: F4 lọt qua lượt live đầu vì tôi chỉ mở một loại điểm đo):
1. Máy **có** `machineId` ⇒ gộp, `occurrenceCount` tăng, `createdAt` **không đổi**.
2. `PATTERN_ANOMALY` **không có** `machineId` ⇒ **không** gộp, vẫn tạo dòng mới.

Chạy migration 0308 bằng owner `aoi`.
