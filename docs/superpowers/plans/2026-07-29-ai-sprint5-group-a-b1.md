# Sprint 5 — Nhóm A + B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hệ thôi làm phiền người vận hành mỗi lần cảnh báo tái diễn, nhật ký lần-tái-diễn hết đếm thiếu tại cửa, số 0 trên bảng KPI tự giải thích, và hai bản sao logic chặn-cảnh-báo hợp nhất thành một.

**Architecture:** `routeAlert` đang trộn ba quyết định (*có gộp không* · *có báo không* · *ghi gì*) vào một dòng chảy, với cửa sổ Redis 5 phút gánh cả ba. Kế hoạch tách chúng ra: một hàm thuần `decideNotify` quyết việc gửi, đường ghi luôn chạy không trần, cửa sổ Redis tụt xuống làm van an toàn. `alarmKpi.summary` trả thêm mốc đầu tiên của sổ nhật ký để giao diện phân biệt "0 vì yên tĩnh" với "0 vì chưa có dữ liệu". Cuối cùng `predictiveMaintenanceService` gọi thẳng `classifySuppression` thay vì giữ bản sao.

**Tech Stack:** TypeScript · Drizzle ORM (postgres-js) · tRPC v11 · vitest · React 19 + react-i18next

## Global Constraints

- **Spec nguồn:** `docs/superpowers/specs/2026-07-29-ai-sprint5-design.md` (commit `bf2e0841`). Khi plan và spec lệch nhau, spec thắng — và **báo lại**, đừng tự quyết.
- **Không migration trong plan này.** Cột `notificationSentAt` đã có sẵn (`drizzle/schema/ai.ts:130`). Nếu bạn thấy mình cần thêm cột — dừng lại, brief sai, báo lại.
- **Mock phải mô tả thế giới CÓ THẬT.** Không mock `.returning()` khi mã không gọi nó; không trả mảng đầy khi driver trả rỗng; không cho chuỗi query bỏ qua điều kiện. Wave 3+4 đã có 4 lỗi vì đúng chuyện này.
- **Kiểm hợp đồng API TRƯỚC khi viết giao diện.** Hai lần trước tính năng chết im lặng vì `.map()` liệt kê tay thiếu trường (`occurrenceCount`, `resolutionNotes`).
- Chạy test: `npx vitest run <đường dẫn file>`. Kiểm kiểu: `npm run check` (cần heap 8GB).
- Test và comment viết **tiếng Việt**, theo đúng khuôn các file `server/services/alerts/*.test.ts` hiện có.
- **Không chạy hai implementer song song**, kể cả khác file — tranh chấp git index.
- Commit sau mỗi task. Prefix: `feat(ai/s5-…)`, `fix(ai/s5-…)`, `test(ai/s5-…)`.

---

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `server/services/alerts/decideAlertWrite.ts` | **Sửa** — export thêm `severityRank` | 1 |
| `server/services/alerts/decideNotify.ts` | **Tạo** — hàm thuần: có gửi thông báo không | 1 |
| `server/services/alerts/decideNotify.test.ts` | **Tạo** — bảng chân lý 6 nhánh | 1 |
| `server/services/aiSmartAlertRouter.ts` | **Sửa** — đảo trật tự, nối `decideNotify`, bỏ trần, thêm van | 2, 3 |
| `server/services/aiSmartAlertRouter.notify.test.ts` | **Tạo** — tích hợp: im lặng vẫn ghi sổ | 2 |
| `server/services/aiSmartAlertRouter.valve.test.ts` | **Tạo** — lần thứ 4+ vẫn ghi; van kêu | 3 |
| `.env.example` | **Sửa** — 3 khoá mới | 3 |
| `server/routers/alarmKpiRouter.ts` | **Sửa** — trả `occurrenceLog` | 4 |
| `server/routers/alarmKpiMissingTable.test.ts` | **Sửa** — mock phải đỡ được truy vấn MIN mới | 4 |
| `server/routers/alarmKpiOccurrenceLog.test.ts` | **Tạo** — 3 trạng thái của `occurrenceLog` | 4 |
| `client/src/pages/AlarmKpiDashboard.tsx` | **Sửa** — câu giải thích số 0 | 5 |
| `client/src/components/controlTower/panels.tsx` | **Sửa** — bỏ ẩn dòng nguồn khi cả hai bằng 0 | 5 |
| `client/src/i18n/locales/{vi,en,zh}.json` | **Sửa** — 3 khoá mới | 5 |
| `server/services/alerts/classifySuppression.equivalence.test.ts` | **Tạo** — property test đối chiếu | 6 |
| `server/services/predictiveMaintenanceService.ts` | **Sửa** — gọi thẳng `classifySuppression`, xoá bản sao | 6 |

---

## Task 1: `decideNotify` — hàm thuần quyết định có gửi thông báo

**Files:**
- Modify: `server/services/alerts/decideAlertWrite.ts:29-34`
- Create: `server/services/alerts/decideNotify.ts`
- Test: `server/services/alerts/decideNotify.test.ts`

**Interfaces:**
- Consumes: `AlertSeverity` từ `./decideAlertWrite`
- Produces:
  - `severityRank(s: AlertSeverity): number` — export mới từ `decideAlertWrite.ts`
  - `decideNotify(input: NotifyInput): NotifyDecision` — Task 2 gọi
  - `NotifyReason = "first" | "critical" | "severity-raised" | "never-notified" | "cooldown-elapsed" | "suppressed-cooldown"`

- [ ] **Step 1: Viết test đỏ** — tạo `server/services/alerts/decideNotify.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { decideNotify } from "./decideNotify";

const HOUR = 3600_000;
const base = {
  action: "update" as const,
  incomingSeverity: "HIGH" as const,
  previousSeverity: "HIGH" as const,
  lastNotifiedAt: 1_000_000,
  now: 1_000_000 + 5 * 60_000, // mới báo 5 phút trước
  cooldownMs: 4 * HOUR,
  criticalCooldownMs: 0,
};

describe("decideNotify — có gửi thông báo không", () => {
  it("cảnh báo MỚI (insert) ⇒ luôn báo", () => {
    expect(decideNotify({ ...base, action: "insert", previousSeverity: null, lastNotifiedAt: null }))
      .toEqual({ notify: true, reason: "first" });
  });

  it("CRITICAL với cooldown-critical = 0 ⇒ luôn báo, kể cả vừa báo 5 phút trước", () => {
    expect(decideNotify({ ...base, incomingSeverity: "CRITICAL", previousSeverity: "CRITICAL" }))
      .toEqual({ notify: true, reason: "critical" });
  });

  it("CRITICAL nhưng khách đặt cooldown-critical 60 phút, mới báo 5 phút ⇒ IM LẶNG", () => {
    expect(decideNotify({
      ...base, incomingSeverity: "CRITICAL", previousSeverity: "CRITICAL",
      criticalCooldownMs: 60 * 60_000,
    })).toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("mức TĂNG (MEDIUM → HIGH) ⇒ báo ngay, không chờ cooldown", () => {
    expect(decideNotify({ ...base, previousSeverity: "MEDIUM" }))
      .toEqual({ notify: true, reason: "severity-raised" });
  });

  // ⚠ BẪY CHÍNH — maxSeverity() KHÔNG dùng được cho luật này.
  it("mức KHÔNG đổi (HIGH → HIGH) KHÔNG phải 'mức tăng' ⇒ im lặng", () => {
    expect(decideNotify(base)).toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("mức TỤT (HIGH → MEDIUM) không phải 'mức tăng' ⇒ im lặng", () => {
    expect(decideNotify({ ...base, incomingSeverity: "MEDIUM", previousSeverity: "HIGH" }))
      .toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("chưa từng báo (lastNotifiedAt null) ⇒ báo, fail-open", () => {
    expect(decideNotify({ ...base, lastNotifiedAt: null }))
      .toEqual({ notify: true, reason: "never-notified" });
  });

  it("hết cooldown ⇒ báo lại", () => {
    expect(decideNotify({ ...base, now: base.lastNotifiedAt + 5 * HOUR }))
      .toEqual({ notify: true, reason: "cooldown-elapsed" });
  });

  it("đúng BIÊN cooldown (>= chứ không phải >) ⇒ báo lại", () => {
    expect(decideNotify({ ...base, now: base.lastNotifiedAt + 4 * HOUR }))
      .toEqual({ notify: true, reason: "cooldown-elapsed" });
  });

  it("previousSeverity null trên nhánh update (dữ liệu lỗi) ⇒ không sập, rơi về luật cooldown", () => {
    expect(decideNotify({ ...base, previousSeverity: null }))
      .toEqual({ notify: false, reason: "suppressed-cooldown" });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run server/services/alerts/decideNotify.test.ts`
Expected: FAIL — `Failed to resolve import "./decideNotify"`

- [ ] **Step 3: Export `severityRank`** — sửa `server/services/alerts/decideAlertWrite.ts`, ngay dưới dòng 29

Thay khối:
```ts
const RANK: Record<AlertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
```
thành:
```ts
const RANK: Record<AlertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Sprint 5 §2.3 — thứ hạng mức độ, export riêng vì câu hỏi "mức có TĂNG không"
 * KHÔNG dùng được `maxSeverity()`: khi hai mức BẰNG nhau nó trả về tham số đầu,
 * mà so chuỗi thì `maxSeverity(prev, incoming) === incoming` hoá thành true ⇒
 * "đã tăng" sai. Phải so bằng SỐ.
 */
export function severityRank(s: AlertSeverity): number {
  return RANK[s];
}
```

- [ ] **Step 4: Viết `decideNotify`** — tạo `server/services/alerts/decideNotify.ts`

```ts
/**
 * Sprint 5 §2.3 — CÓ GỬI THÔNG BÁO KHÔNG.
 *
 * Tách khỏi routeAlert vì hai lý do:
 *  1. Test được KHÔNG CẦN DB (bài học Wave 2: logic rủi ro nằm lẫn trong hàm có
 *     I/O thì không test nào chạy qua nó).
 *  2. Tách bạch "ghi nhật ký" (LUÔN đủ) khỏi "gửi thông báo" (được phép gộp) —
 *     hai hướng ngược nhau mà Wave 3/4 để dính chung vào cửa sổ Redis 5 phút,
 *     nên A1 (muốn gộp nhiều hơn) và A2 (muốn ghi đủ hơn) mới triệt tiêu nhau.
 *
 * Hàm này KHÔNG quyết định ghi mới hay cập nhật (decideAlertWrite lo việc đó),
 * và KHÔNG quyết định có phát cảnh báo hay không (predictiveMaintenanceService).
 */
import { severityRank, type AlertSeverity } from "./decideAlertWrite";

export type NotifyReason =
  | "first"
  | "critical"
  | "severity-raised"
  | "never-notified"
  | "cooldown-elapsed"
  | "suppressed-cooldown";

export interface NotifyInput {
  action: "insert" | "update";
  /** Mức của LẦN NÀY. */
  incomingSeverity: AlertSeverity;
  /** Mức của dòng ĐANG MỞ TRƯỚC khi update — KHÔNG phải mức đã gộp
   *  (decision.severity). Cùng loại bẫy với buildOccurrence ở Wave 4. */
  previousSeverity: AlertSeverity | null;
  /** ms epoch của lượt gửi gần nhất; null = chưa từng gửi. */
  lastNotifiedAt: number | null;
  now: number;
  cooldownMs: number;
  /** 0 = CRITICAL luôn báo ngay (mặc định sản phẩm). */
  criticalCooldownMs: number;
}

export interface NotifyDecision {
  notify: boolean;
  reason: NotifyReason;
}

export function decideNotify(input: NotifyInput): NotifyDecision {
  // Cảnh báo mới thì không có gì để gộp.
  if (input.action === "insert") return { notify: true, reason: "first" };

  const elapsed = input.lastNotifiedAt == null ? null : input.now - input.lastNotifiedAt;

  // CRITICAL xuyên qua cooldown thường. Van riêng mặc định 0 ⇒ luôn báo.
  if (
    input.incomingSeverity === "CRITICAL" &&
    (elapsed == null || elapsed >= input.criticalCooldownMs)
  ) {
    return { notify: true, reason: "critical" };
  }

  // Tình trạng xấu ĐI ⇒ tin mới, báo ngay bất kể cooldown.
  if (
    input.previousSeverity != null &&
    severityRank(input.incomingSeverity) > severityRank(input.previousSeverity)
  ) {
    return { notify: true, reason: "severity-raised" };
  }

  // FAIL-OPEN: chưa từng gửi thì gửi. Thà báo trùng còn hơn im lặng.
  if (elapsed == null) return { notify: true, reason: "never-notified" };
  if (elapsed >= input.cooldownMs) return { notify: true, reason: "cooldown-elapsed" };

  return { notify: false, reason: "suppressed-cooldown" };
}
```

- [ ] **Step 5: Chạy test, xác nhận XANH**

Run: `npx vitest run server/services/alerts/decideNotify.test.ts server/services/alerts/decideAlertWrite.test.ts`
Expected: PASS — 10 test mới + 6 test cũ vẫn xanh.

- [ ] **Step 6: Commit**

```bash
git add server/services/alerts/decideNotify.ts server/services/alerts/decideNotify.test.ts server/services/alerts/decideAlertWrite.ts
git commit -m "feat(ai/s5-A1): decideNotify — tách quyết định gửi thông báo khỏi routeAlert

Hàm thuần, bảng chân lý 6 nhánh. severityRank export riêng vì maxSeverity()
trả về tham số đầu khi hai mức bằng nhau ⇒ so chuỗi hoá thành 'đã tăng' sai."
```

---

## Task 2: Nối `decideNotify` vào `routeAlert` + đảo trật tự ghi/báo

**Files:**
- Modify: `server/services/aiSmartAlertRouter.ts:149-345`
- Test: `server/services/aiSmartAlertRouter.notify.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `decideNotify`, `NotifyDecision` (Task 1)
- Produces: `routeAlert()` giữ nguyên chữ ký `(event: SmartAlertEvent) => Promise<RoutingResult>`. **Đổi hành vi:** không còn ném ra ngoài khi INSERT/UPDATE hỏng.

**Trật tự mới (thay cho Step 2/3/3.5/4 hiện tại):**

```
tra cứu cảnh báo mở  →  decideAlertWrite  →  decideNotify
   →  nếu notify: determineTargets + checkPatterns + enrichRoutingWithAI
   →  GHI (insert/update, bọc try/catch fail-open) + INSERT occurrence
   →  nếu notify: gửi
```

- [ ] **Step 1: Viết test đỏ** — tạo `server/services/aiSmartAlertRouter.notify.test.ts`

```ts
/**
 * Sprint 5 §2 — routeAlert phải TÁCH "ghi nhật ký" (luôn đủ) khỏi "gửi thông
 * báo" (được phép gộp). Trước đây thông báo gửi ở Step 4, TRƯỚC cả quyết định
 * insert/update ⇒ máy tái diễn 22 lần/ngày vẫn tới 22 lượt push dù bảng cảnh
 * báo chỉ còn 1 dòng.
 *
 * Mock dùng lại đúng khuôn aiSmartAlertRouter.occurrence.test.ts (Wave 4), thêm
 * nhánh `users` seed được (determineTargets) — bản cũ luôn trả rỗng nên không
 * test nào chạy qua đường gửi thật.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { predictiveAlerts, machines, predictiveAlertOccurrences, users } from "../../drizzle/schema";

const calls: { kind: "insert" | "update" | "insert-occurrence"; payload?: any }[] = [];
const notified: { userId: number }[] = [];

let seedOpenAlertRows: any[] = [];
let seedUserRows: any[] = [];
let patternQueried = false;

function chain(getRows: () => any[]) {
  const node: any = {
    where: () => node,
    orderBy: () => node,
    limit: async () => getRows(),
    then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(getRows()).catch(reject),
  };
  return node;
}

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === predictiveAlerts) return chain(() => seedOpenAlertRows);
        if (table === machines) return chain(() => [{ code: "M-01" }]);
        if (table === users) return chain(() => seedUserRows);
        return chain(() => []);
      },
    }),
    insert: (table: any) => {
      if (table === predictiveAlertOccurrences) {
        return {
          values: (v: any) => {
            calls.push({ kind: "insert-occurrence", payload: v });
            return Promise.resolve(undefined);
          },
        };
      }
      return {
        values: (v: any) => {
          calls.push({ kind: "insert", payload: v });
          return { returning: async () => [{ id: 1 }] };
        },
      };
    },
    update: (_table: any) => ({
      set: (v: any) => {
        calls.push({ kind: "update", payload: v });
        return { where: (_cond: any) => Promise.resolve(undefined) };
      },
    }),
    // checkPatterns() gọi db.execute — dùng để khẳng định nó KHÔNG chạy khi im lặng.
    execute: async (_q: any) => {
      patternQueried = true;
      return { rows: [] };
    },
  }),
}));

const generateText = vi.fn(async () => ({ text: "" }));
vi.mock("./aiGgufEngine", () => ({
  generateText,
  isGgufAvailable: vi.fn(async () => false),
}));
vi.mock("./notificationService", () => ({
  sendAlertNotification: vi.fn(async (userId: number) => { notified.push({ userId }); }),
}));
vi.mock("./emailService", () => ({ sendAlertEmail: vi.fn(async () => undefined) }));

beforeEach(() => {
  calls.length = 0;
  notified.length = 0;
  seedOpenAlertRows = [];
  seedUserRows = [];
  patternQueried = false;
  generateText.mockClear();
  process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES = "240";
  process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES = "0";
});
afterEach(() => {
  delete process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES;
  delete process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES;
});

const MAINTENANCE = [{ userId: 7, username: "kt1", role: "maintenance", email: null }];

describe("routeAlert — tách gửi thông báo khỏi ghi nhật ký", () => {
  it("cảnh báo MỚI ⇒ gửi thông báo + stamp notificationSentAt", async () => {
    seedUserRows = MAINTENANCE;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8101, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(1);
    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(true);
    expect(ins.payload.notificationSentAt).toBeInstanceOf(Date);
  });

  it("tái diễn trong cooldown, mức KHÔNG đổi ⇒ IM LẶNG nhưng VẪN ghi nhật ký", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{
      id: 55, severity: "HIGH", occurrenceCount: 3,
      notificationSentAt: new Date(Date.now() - 5 * 60_000), // báo 5 phút trước
    }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8102, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(0);                                   // KHÔNG làm phiền
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(true); // NHƯNG vẫn ghi sổ
    const upd = calls.find((c) => c.kind === "update")!;
    expect(upd.payload.occurrenceCount).toBe(4);
    expect(upd.payload.notificationSentAt).toBeUndefined();              // không stamp lượt không gửi
    expect(upd.payload.aiAnalysis).toBeUndefined();                      // không đè lý giải cũ
  });

  it("im lặng ⇒ KHÔNG gọi LLM và KHÔNG chạy truy vấn pattern 30 ngày", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{ id: 56, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8103, severity: "HIGH", message: "x", data: {} } as any);

    expect(generateText).not.toHaveBeenCalled();
    expect(patternQueried).toBe(false);
  });

  it("mức TĂNG (HIGH → CRITICAL) ⇒ báo ngay dù còn trong cooldown", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{ id: 57, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8104, severity: "CRITICAL", message: "x", data: {} } as any);

    expect(notified).toHaveLength(1);
    const upd = calls.find((c) => c.kind === "update")!;
    expect(upd.payload.notificationSentAt).toBeInstanceOf(Date);
  });

  it("không có người nhận (targets rỗng) ⇒ KHÔNG stamp — nếu không cảnh báo im 4 giờ vì một lượt gửi không tồn tại", async () => {
    seedUserRows = [];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8105, severity: "HIGH", message: "x", data: {} } as any);

    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(false);
    expect(ins.payload.notificationSentAt).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run server/services/aiSmartAlertRouter.notify.test.ts`
Expected: FAIL — hiện `notified` có phần tử ở ca "im lặng" (thông báo gửi trước khi quyết), và `notificationSentAt` không có trong payload update.

- [ ] **Step 3: Thêm hai hàm đọc env** — `server/services/aiSmartAlertRouter.ts`, ngay dưới `alertTtlMs()` (dòng 25)

Theo đúng khuôn `alertTtlMs()` (đọc trong hàm, KHÔNG hằng module) để test đặt được env từng ca.

```ts
/** Sprint 5 §2.7 — cooldown im lặng cho cảnh báo ĐANG MỞ tái diễn. Mặc định 4h:
 *  với nhịp đo được 22 lần/ngày ⇒ ≤6 lượt báo/ngày thay vì 22. */
function renotifyCooldownMs(): number {
  const raw = Number(process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 240;
  return minutes * 60_000;
}

/** 0 (mặc định) = CRITICAL luôn báo ngay, không bao giờ gộp. Van để khách chỉnh
 *  nếu CRITICAL hoá ra mới là nguồn nhiễu thật ở nhà máy của họ. */
function criticalCooldownMs(): number {
  const raw = Number(process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  return minutes * 60_000;
}
```

- [ ] **Step 4: Thêm import `decideNotify`** — sửa dòng 17

```ts
import { decideAlertWrite, type AlertSeverity } from "./alerts/decideAlertWrite";
import { decideNotify } from "./alerts/decideNotify";
```

- [ ] **Step 5: Xoá khối Step 2/3/3.5/4 cũ** — xoá **nguyên vẹn** các dòng 149-162 hiện tại

```ts
  // Step 2: Determine targets based on alert type
  const targets = await determineTargets(db, event);

  // Step 3: Check patterns for recurring alerts
  const suggestedAction = await checkPatterns(db, event);

  // Step 3.5: AI reasoning enrichment (non-blocking)
  const aiReasoning = await enrichRoutingWithAI(event, targets, suggestedAction)
    .catch(() => null);

  // Step 4: Send notifications
  for (const target of targets) {
    await sendSmartNotification(target, event);
  }
```

- [ ] **Step 6: Thêm `notificationSentAt` vào truy vấn tra-cứu-cảnh-báo-mở**

Trong khối `:206-234` (nay đã dịch lên): thêm cột vào `.select({...})` và vào phép dựng `existingOpen`.

```ts
  let existingOpen: {
    id: number;
    severity: AlertSeverity;
    occurrenceCount: number;
    notificationSentAt: Date | null;
  } | null = null;
  let lookupFailed = false;
  if (event.machineId != null) {
    try {
      const rows = await db
        .select({
          id: predictiveAlerts.id,
          severity: predictiveAlerts.severity,
          occurrenceCount: predictiveAlerts.occurrenceCount,
          // Sprint 5 §2.4 — mốc gửi gần nhất. Cột đã có sẵn từ trước, chỉ chưa
          // ai đọc và chưa ai cập nhật sau lần INSERT đầu tiên.
          notificationSentAt: predictiveAlerts.notificationSentAt,
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
        ? {
            id: rows[0].id,
            severity: String(rows[0].severity) as AlertSeverity,
            occurrenceCount: Number(rows[0].occurrenceCount ?? 1),
            notificationSentAt: rows[0].notificationSentAt ? new Date(rows[0].notificationSentAt) : null,
          }
        : null;
    } catch (err) {
      // FAIL-OPEN có chủ ý (spec §3d): thà một dòng trùng còn hơn mất một cảnh báo hỏng máy.
      lookupFailed = true;
      console.error("[SmartAlert] tra cứu cảnh báo mở THẤT BẠI — ghi mới để không bỏ sót:", (err as Error)?.message ?? err);
    }
  }
```

⚠ `decideAlertWrite(existingOpen, …)` nhận `OpenAlertSnapshot` chỉ có 3 trường — trường thứ tư thừa là hợp lệ trong TypeScript structural typing, **không** cần đổi `OpenAlertSnapshot`.

- [ ] **Step 7: Chèn `decideNotify` + làm giàu có điều kiện, ngay SAU `decideAlertWrite`** (sau dòng `:249` hiện tại)

```ts
  // Sprint 5 §2.2 — GỬI hay không là quyết định RIÊNG với GHI hay không.
  const notifyDecision = decideNotify({
    action: decision.action,
    incomingSeverity: event.severity as AlertSeverity,
    // ⚠ Mức của dòng ĐANG MỞ TRƯỚC update — KHÔNG dùng decision.severity (đã gộp).
    previousSeverity: existingOpen?.severity ?? null,
    lastNotifiedAt: existingOpen?.notificationSentAt?.getTime() ?? null,
    now: Date.now(),
    cooldownMs: renotifyCooldownMs(),
    criticalCooldownMs: criticalCooldownMs(),
  });

  // Chỉ trả giá cho những thứ ĐẮT khi thật sự sắp làm phiền ai đó: một truy vấn
  // pattern 30 ngày + một lượt gọi LLM. Trước đây chạy MỌI lượt lọt (≤3/5 phút).
  const targets = notifyDecision.notify ? await determineTargets(db, event) : [];
  const suggestedAction = notifyDecision.notify ? await checkPatterns(db, event) : null;
  const aiReasoning = notifyDecision.notify
    ? await enrichRoutingWithAI(event, targets, suggestedAction).catch(() => null)
    : null;

  // Chỉ đóng dấu "đã gửi" khi thật sự có người nhận. Nhà máy chưa cấu hình role
  // nhận (không có user `maintenance`) mà vẫn stamp ⇒ cảnh báo im 4 giờ vì một
  // lượt gửi không tồn tại.
  const willStamp = notifyDecision.notify && targets.length > 0;
```

⚠ Khối dựng `aiAnalysisPayload` (`:167-189` cũ) phải **chuyển xuống sau** đoạn này, vì nó dùng `suggestedAction` và `aiReasoning`. Giữ nguyên nội dung, chỉ đổi vị trí.

- [ ] **Step 8: Sửa hai nhánh ghi** — nhánh `update` (`:266-296`) và nhánh `insert` (`:297-325`)

Nhánh `update` — thêm `notificationSentAt` có điều kiện, và **bỏ `aiAnalysis` khỏi SET khi im lặng**:

```ts
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
        // Sprint 5 §2.6(3) — lượt IM LẶNG không gọi LLM, nên payload lúc này
        // không có phần lý giải. Ghi đè sẽ XOÁ lý giải có từ lần báo trước.
        ...(notifyDecision.notify ? { aiAnalysis: aiAnalysisPayload } : {}),
        ...(willStamp ? { notificationSent: true, notificationSentAt: new Date() } : {}),
        expiresAt,
        updatedAt: new Date(),
        // KHÔNG đụng createdAt: processAutoEscalation() đo tuổi dòng để leo thang.
      } as any)
      .where(and(eq(predictiveAlerts.id, decision.id), eq(predictiveAlerts.status, "ACTIVE" as any)));
    alertRecord = { id: decision.id };
  } else {
```

Nhánh `insert` — thay hai dòng `notificationSent: true` / `notificationSentAt: new Date()` (`:315-316`) bằng:

```ts
        notificationSent: willStamp,
        notificationSentAt: willStamp ? new Date() : null,
```

- [ ] **Step 9: Bọc đường ghi bằng try/catch fail-open**

Bọc **toàn bộ** khối `if (decision.action === "update") { … } else { … }` (`:266-325`):

```ts
  let writeFailed = false;
  try {
    if (decision.action === "update") {
      // … nguyên khối update ở Step 8 …
    } else {
      // … nguyên khối insert ở Step 8 …
    }
  } catch (err) {
    // Sprint 5 §2.6(2) — FAIL-OPEN, cùng tinh thần với tra-cứu-hỏng ở trên: thà
    // báo trùng còn hơn im lặng về một máy sắp hỏng. Trước đây thông báo gửi
    // TRƯỚC khi ghi nên lỗi ghi không ảnh hưởng; nay thông báo đi sau, nên phải
    // nói rõ ra ở đây thay vì để hành vi thay đổi lặng lẽ.
    writeFailed = true;
    console.error("[SmartAlert] GHI cảnh báo THẤT BẠI — vẫn gửi thông báo để không bỏ sót:", (err as Error)?.message ?? err);
  }
```

Khối ghi nhật ký occurrence (`:330-345`) giữ **nguyên vẹn**: khi `writeFailed` thì `alertRecord` là `undefined`, `buildOccurrence(undefined, …)` trả `null` nên không INSERT gì — đúng ý (không có `alertId` để nối vào), và ERROR ở trên đã để lại dấu vết.

- [ ] **Step 10: Gửi thông báo — đặt SAU khối ghi nhật ký occurrence, trước `return`**

```ts
  // Sprint 5 §2.2 — Gửi SAU cùng: tới đây dòng cảnh báo và dòng nhật ký đã yên vị.
  if (notifyDecision.notify) {
    for (const target of targets) {
      await sendSmartNotification(target, event);
    }
  }
```

- [ ] **Step 11: Chạy test, xác nhận XANH (cả test cũ)**

Run: `npx vitest run server/services/aiSmartAlertRouter.notify.test.ts server/services/aiSmartAlertRouter.occurrence.test.ts server/services/aiSmartAlertRouter.oneOpen.test.ts`
Expected: PASS toàn bộ.

⚠ Nếu `occurrence.test.ts` đỏ ở ca "ghi nhật ký NÉM LỖI": mock của nó không seed `users` nên `targets` rỗng ⇒ `notificationSent` nay là `false` thay vì `true`. Test đó **không** assert trường này nên phải xanh — nếu đỏ vì lý do khác, **dừng và báo lại**, đừng sửa test cho vừa mã.

- [ ] **Step 12: Kiểm kiểu**

Run: `npm run check`
Expected: không lỗi mới trong `aiSmartAlertRouter.ts`.

- [ ] **Step 13: Commit**

```bash
git add server/services/aiSmartAlertRouter.ts server/services/aiSmartAlertRouter.notify.test.ts
git commit -m "feat(ai/s5-A1): thôi bắn thông báo mỗi lần tái diễn — gộp theo cooldown, ghi sổ vẫn đủ

Đảo trật tự: tra cứu → quyết ghi → quyết gửi → (nếu gửi) LLM+pattern → GHI → gửi.
Dùng lại cột notificationSentAt sẵn có, không migration. LLM+truy vấn pattern
30 ngày nay chỉ chạy khi thật sự làm phiền ai đó. Lượt im lặng không đè aiAnalysis.
Ghi hỏng ⇒ fail-open, vẫn gửi, có ERROR."
```

---

## Task 3: Bỏ trần gộp — lần tái diễn thứ 4+ phải được ghi sổ

**Files:**
- Modify: `server/services/aiSmartAlertRouter.ts:130-147`
- Modify: `.env.example`
- Test: `server/services/aiSmartAlertRouter.valve.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `routeAlert` sau Task 2
- Produces: không có API mới. Env mới: `ROUTE_ALERT_MAX_PER_WINDOW`.

- [ ] **Step 1: Viết test đỏ** — tạo `server/services/aiSmartAlertRouter.valve.test.ts`

```ts
/**
 * Sprint 5 §2.5 — cửa sổ gộp Redis KHÔNG còn là cổng chặn.
 *
 * Trần cũ `nextCount > 3` return sớm TRƯỚC cả đường ghi DB lẫn nhật ký
 * predictive_alert_occurrences ⇒ lần tái diễn thứ 4+ trong 5 phút biến mất
 * KHÔNG dấu vết. Hai hệ quả: KPI Wave 4 đếm thiếu NGAY TẠI CỬA, và flood
 * ISA-18.2 (>10/10 phút) không bao giờ kích hoạt được cho MỘT máy — trần cứng
 * 3/5 phút = 6/10 phút, dưới ngưỡng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { predictiveAlerts, machines, predictiveAlertOccurrences, users } from "../../drizzle/schema";

const calls: { kind: string }[] = [];
let seedOpenAlertRows: any[] = [];

function chain(getRows: () => any[]) {
  const node: any = {
    where: () => node,
    orderBy: () => node,
    limit: async () => getRows(),
    then: (r: any, j: any) => Promise.resolve(getRows()).then(r, j),
    catch: (j: any) => Promise.resolve(getRows()).catch(j),
  };
  return node;
}

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_c?: any) => ({
      from: (table: any) => {
        if (table === predictiveAlerts) return chain(() => seedOpenAlertRows);
        if (table === machines) return chain(() => [{ code: "M-01" }]);
        if (table === users) return chain(() => []);
        return chain(() => []);
      },
    }),
    insert: (table: any) => ({
      values: (_v: any) => {
        calls.push({ kind: table === predictiveAlertOccurrences ? "occ" : "insert" });
        return table === predictiveAlertOccurrences
          ? Promise.resolve(undefined)
          : { returning: async () => [{ id: 1 }] };
      },
    }),
    update: (_t: any) => ({ set: (_v: any) => ({ where: () => Promise.resolve(undefined) }) }),
    execute: async () => ({ rows: [] }),
  }),
}));
vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(async () => ({ text: "" })),
  isGgufAvailable: vi.fn(async () => false),
}));
vi.mock("./notificationService", () => ({ sendAlertNotification: vi.fn(async () => undefined) }));
vi.mock("./emailService", () => ({ sendAlertEmail: vi.fn(async () => undefined) }));

beforeEach(() => {
  calls.length = 0;
  seedOpenAlertRows = [];
});
afterEach(() => { delete process.env.ROUTE_ALERT_MAX_PER_WINDOW; });

describe("routeAlert — cửa sổ gộp không còn nuốt lần tái diễn", () => {
  it("gọi 12 lần liên tiếp trong cùng cửa sổ ⇒ 12 dòng nhật ký (đủ để flood >10/10ph kích hoạt)", async () => {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    // Dòng cha "đang mở" để mọi lượt sau lượt đầu đi nhánh update.
    seedOpenAlertRows = [{ id: 77, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    for (let i = 0; i < 12; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8201, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(calls.filter((c) => c.kind === "occ")).toHaveLength(12); // trước đây: 3
  });

  it("chạm van an toàn ⇒ CẢNH BÁO ra log và bỏ lượt, không im lặng", async () => {
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "2";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeAlert } = await import("./aiSmartAlertRouter");
    seedOpenAlertRows = [{ id: 78, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    for (let i = 0; i < 4; i++) {
      await routeAlert({ type: "MACHINE_FAILURE", machineId: 8202, severity: "HIGH", message: "x", data: {} } as any);
    }
    expect(calls.filter((c) => c.kind === "occ").length).toBeLessThan(4);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("VAN AN TOÀN");
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run server/services/aiSmartAlertRouter.valve.test.ts`
Expected: FAIL — ca 1 chỉ đếm được 3 dòng nhật ký thay vì 12.

- [ ] **Step 3: Thêm hàm đọc trần** — `server/services/aiSmartAlertRouter.ts`, cạnh `criticalCooldownMs()`

```ts
/** Sprint 5 §2.5 — VAN AN TOÀN, không phải cổng chặn. Chỉ để một vòng lặp hỏng
 *  phía phát (detector chạy mỗi giây) không bơm vô hạn vào bảng nhật ký. */
function maxPerWindow(): number {
  const raw = Number(process.env.ROUTE_ALERT_MAX_PER_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
}
```

- [ ] **Step 4: Thay khối trần cũ** — `:130-147`

```ts
  if (existing && now - existing.timestamp < CONSOLIDATION_WINDOW_MS) {
    const nextCount = existing.count + 1;
    await setConsolidationEntry(consolidationKey, { timestamp: existing.timestamp, count: nextCount });
    consolidated = true;
    // Sprint 5 §2.5 — trần cũ là `nextCount > 3` và return sớm TRƯỚC cả đường
    // ghi DB lẫn nhật ký ⇒ lần tái diễn thứ 4+ biến mất không dấu vết: KPI đếm
    // thiếu ngay tại cửa, và flood ISA-18.2 (>10/10 phút) không kích hoạt được
    // cho MỘT máy (3/5 phút = 6/10 phút, dưới ngưỡng).
    // Việc gộp THÔNG BÁO nay do decideNotify lo — đây chỉ còn là van an toàn.
    const cap = maxPerWindow();
    if (nextCount > cap) {
      console.warn(
        `[SmartAlert] VAN AN TOÀN: khoá ${consolidationKey} đã ${nextCount} lượt trong ` +
          `${CONSOLIDATION_WINDOW_MS / 1000}s (trần ROUTE_ALERT_MAX_PER_WINDOW=${cap}) — bỏ lượt này. ` +
          `Nghi vấn vòng lặp hỏng ở phía phát cảnh báo.`,
      );
      return {
        alertType: event.type,
        targets: [],
        consolidated: true,
        consolidationGroup: consolidationKey,
        escalationLevel: "L1",
        suggestedAction: `Vượt trần ${cap} lượt/cửa sổ — nghi vấn vòng lặp hỏng ở phía phát.`,
      };
    }
  } else {
    await setConsolidationEntry(consolidationKey, { timestamp: now, count: 1 });
  }
```

- [ ] **Step 5: Chạy test, xác nhận XANH**

Run: `npx vitest run server/services/aiSmartAlertRouter.valve.test.ts server/services/aiSmartAlertRouter.notify.test.ts server/services/aiSmartAlertRouter.occurrence.test.ts server/services/aiSmartAlertRouter.oneOpen.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 6: Thêm 3 khoá vào `.env.example`**

Đặt cạnh `ALERT_TTL_HOURS` nếu có, không thì cuối khối cảnh báo:

```bash
# Sprint 5 §2.7 — gộp THÔNG BÁO cảnh báo đang mở (không ảnh hưởng nhật ký/KPI).
# Cảnh báo tái diễn chỉ báo lại khi: mức tăng, hoặc CRITICAL, hoặc hết cooldown.
ALERT_RENOTIFY_COOLDOWN_MINUTES=240
# 0 = CRITICAL luôn báo ngay, không bao giờ gộp.
ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES=0
# Van an toàn chống vòng lặp hỏng phía phát. KHÔNG phải cổng chống nhiễu.
ROUTE_ALERT_MAX_PER_WINDOW=200
```

- [ ] **Step 7: Commit**

```bash
git add server/services/aiSmartAlertRouter.ts server/services/aiSmartAlertRouter.valve.test.ts .env.example
git commit -m "fix(ai/s5-A2): lần tái diễn thứ 4+ thôi biến mất — cửa sổ gộp thành van an toàn

Trần cũ 3/5 phút return TRƯỚC đường ghi ⇒ mất luôn dòng nhật ký: KPI Wave 4 đếm
thiếu ngay tại cửa, flood ISA-18.2 (>10/10 phút) không kích hoạt được cho một máy.
Van mới 200/cửa sổ chỉ chặn vòng lặp hỏng, và kêu WARN thay vì im lặng."
```

---

## Task 4: `alarmKpi.summary` trả mốc đầu tiên của sổ nhật ký

**Files:**
- Modify: `server/routers/alarmKpiRouter.ts:13` (import), `:102-108`, `:212-216`
- Modify: `server/routers/alarmKpiMissingTable.test.ts:32-41` (mock phải đỡ được truy vấn mới)
- Test: `server/routers/alarmKpiOccurrenceLog.test.ts` (tạo mới)

**Interfaces:**
- Produces: `alarmKpi.summary` trả thêm
  `occurrenceLog: { available: boolean; firstOccurredAt: string | null }`
  Task 5 (client) đọc trường này.

- [ ] **Step 1: Viết test đỏ** — tạo `server/routers/alarmKpiOccurrenceLog.test.ts`

```ts
/**
 * Sprint 5 §3 — bảng KPI hiện "0 cảnh báo AI" mà không nói vì sao. Sổ nhật ký
 * lần-tái-diễn rỗng lúc bắt đầu (cấm nạp ngược quá khứ — quyết định đúng), nên
 * người dùng sẽ kết luận "AI hỏng rồi". Server phải trả mốc đầu tiên của sổ để
 * giao diện phân biệt được "0 vì yên tĩnh" với "0 vì chưa có dữ liệu".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTRPC } from "@trpc/server";
import { andonEvents, predictiveAlertOccurrences } from "../../drizzle/schema";

let firstOccurredRow: any[] = [];
let throwOnOccurrenceQuery: (() => never) | null = null;

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === andonEvents) return { where: async () => [] };
        if (table === predictiveAlertOccurrences) {
          // Cùng một .from() phục vụ HAI truy vấn khác nhau:
          //  • có .innerJoin(...) → danh sách lần-tái-diễn trong cửa sổ
          //  • await thẳng        → MIN(occurredAt) toàn bảng (Sprint 5 §3.1)
          const node: any = {
            innerJoin: (_t: any, _on: any) => ({
              where: (_c: any) => {
                if (throwOnOccurrenceQuery) throwOnOccurrenceQuery();
                return Promise.resolve([]);
              },
            }),
            then: (resolve: any, reject: any) => {
              if (throwOnOccurrenceQuery) {
                try { throwOnOccurrenceQuery(); } catch (e) { return Promise.reject(e).catch(reject); }
              }
              return Promise.resolve(firstOccurredRow).then(resolve, reject);
            },
          };
          return node;
        }
        return { where: async () => [] };
      },
    }),
  }),
}));

import { alarmKpiRouter } from "./alarmKpiRouter";
const t = initTRPC.context<any>().create();
const caller = t.createCallerFactory(alarmKpiRouter)({ user: { id: 1, role: "admin" } });

beforeEach(() => {
  firstOccurredRow = [];
  throwOnOccurrenceQuery = null;
});

describe("alarmKpi.summary — occurrenceLog", () => {
  it("sổ RỖNG ⇒ available=true, firstOccurredAt=null (số 0 là 'chưa có dữ liệu')", async () => {
    firstOccurredRow = [{ first: null }];
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog).toEqual({ available: true, firstOccurredAt: null });
  });

  it("sổ CÓ dòng ⇒ trả mốc đầu tiên dạng ISO", async () => {
    const d = new Date("2026-07-20T03:00:00.000Z");
    firstOccurredRow = [{ first: d }];
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog.available).toBe(true);
    expect(res.occurrenceLog.firstOccurredAt).toBe(d.toISOString());
  });

  it("bảng CHƯA tồn tại (42P01) ⇒ available=false, không ném", async () => {
    throwOnOccurrenceQuery = () => {
      const err: any = new Error('relation "predictive_alert_occurrences" does not exist');
      err.code = "42P01";
      throw err;
    };
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog).toEqual({ available: false, firstOccurredAt: null });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx vitest run server/routers/alarmKpiOccurrenceLog.test.ts`
Expected: FAIL — `res.occurrenceLog` là `undefined`.

- [ ] **Step 3: Thêm `sql` vào import drizzle** — `server/routers/alarmKpiRouter.ts:13`

```ts
import { and, eq, gte, inArray, sql } from "drizzle-orm";
```

- [ ] **Step 4: Ghi lại trạng thái bảng ở khối catch sẵn có** — `:102-108`

```ts
      let predRows: Awaited<ReturnType<typeof loadPredRows>> = [];
      let occurrenceTableAvailable = true;
      try {
        predRows = await loadPredRows();
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        occurrenceTableAvailable = false;
        console.warn("[alarmKpi] bảng nhật ký lần-tái-diễn chưa có (migration 0309 chưa chạy?) — coi predictive alerts là rỗng.");
      }
```

- [ ] **Step 5: Truy vấn mốc đầu tiên** — chèn ngay dưới khối vừa sửa

```ts
      // Sprint 5 §3.1 — mốc ĐẦU TIÊN của sổ nhật ký, để giao diện phân biệt
      // "0 vì nhà máy yên tĩnh" với "0 vì sổ chưa có dòng nào". Dùng MIN (đi
      // qua idx_alert_occurrences_time) chứ KHÔNG COUNT(*) quét bảng.
      let firstOccurredAt: string | null = null;
      if (occurrenceTableAvailable) {
        try {
          const [row] = await db
            .select({ first: sql<Date | null>`MIN(${predictiveAlertOccurrences.occurredAt})` })
            .from(predictiveAlertOccurrences);
          firstOccurredAt = row?.first ? new Date(row.first).toISOString() : null;
        } catch (err) {
          if (!isMissingTable(err)) throw err;
          occurrenceTableAvailable = false;
        }
      }
```

- [ ] **Step 6: Trả thêm trường** — `:212-216`

```ts
      return {
        ...summarizeAlarmKpi(events, { windowMs: windowHours * 3600_000, now, operatorCount }),
        sourceCounts: { andon: andonRows.length, predictive: predRows.length },
        // Sprint 5 §3.1 — available=false ⇒ bảng chưa có; available && !firstOccurredAt ⇒ sổ rỗng.
        occurrenceLog: { available: occurrenceTableAvailable, firstOccurredAt },
        generatedAt: new Date(now).toISOString(),
      };
```

- [ ] **Step 7: Sửa mock của test cũ** — `server/routers/alarmKpiMissingTable.test.ts:32-41`

Mock hiện trả object **chỉ có `innerJoin`**. Truy vấn MIN mới `await` thẳng object đó ⇒ `const [row] = <object>` ném `TypeError: not iterable`. Đây đúng là bệnh "mock mô tả thế giới không có thật". Thay bằng:

```ts
        if (table === predictiveAlertOccurrences) {
          const node: any = {
            innerJoin: (_joinTable: any, _on: any) => ({
              where: (_cond: any) => {
                if (throwOnOccurrenceQuery) throwOnOccurrenceQuery();
                return Promise.resolve([]);
              },
            }),
            // Sprint 5 §3.1 — cùng .from() nay còn phục vụ MIN(occurredAt).
            then: (resolve: any, reject: any) => {
              if (throwOnOccurrenceQuery) {
                try { throwOnOccurrenceQuery(); } catch (e) { return Promise.reject(e).catch(reject); }
              }
              return Promise.resolve([{ first: null }]).then(resolve, reject);
            },
          };
          return node;
        }
```

- [ ] **Step 8: Chạy test, xác nhận XANH**

Run: `npx vitest run server/routers/alarmKpiOccurrenceLog.test.ts server/routers/alarmKpiMissingTable.test.ts server/routers/alarmKpiOccurrence.test.ts`
Expected: PASS toàn bộ. Đặc biệt ca "lỗi DB KHÁC vẫn phải ném" phải còn đỏ-khi-cần (tức vẫn ném) — nếu nó bỗng xanh nhờ nuốt lỗi, **dừng và báo lại**.

- [ ] **Step 9: Commit**

```bash
git add server/routers/alarmKpiRouter.ts server/routers/alarmKpiOccurrenceLog.test.ts server/routers/alarmKpiMissingTable.test.ts
git commit -m "feat(ai/s5-A3): alarmKpi trả mốc đầu tiên của sổ nhật ký lần-tái-diễn

MIN(occurredAt) đi qua index, không COUNT(*) quét bảng. Ba trạng thái phân biệt
được: bảng chưa có · sổ rỗng · sổ trẻ hơn cửa sổ. Mock của test cũ phải đỡ thêm
truy vấn mới — nó chỉ có .innerJoin nên await thẳng sẽ ném TypeError."
```

---

## Task 5: Giao diện — số 0 tự giải thích

**Files:**
- Modify: `client/src/pages/AlarmKpiDashboard.tsx:248-253`
- Modify: `client/src/components/controlTower/panels.tsx:408-415`
- Modify: `client/src/i18n/locales/vi.json`, `en.json`, `zh.json` (khối `alarmKpi.*`)

**Interfaces:**
- Consumes: `data.occurrenceLog: { available: boolean; firstOccurredAt: string | null }` và `data.generatedAt: string` (Task 4)

- [ ] **Step 1: Viết hàm thuần chọn câu + test đỏ** — tạo `client/src/pages/alarmKpiEmptyState.ts`

Tách khỏi JSX để test được không cần render.

```ts
/**
 * Sprint 5 §3.2 — chọn câu giải thích cho số 0 trên bảng KPI báo động.
 * Trả null khi không cần giải thích gì (có dữ liệu, hoặc đang có cảnh báo).
 */
export type OccurrenceLogNotice =
  | { kind: "table-missing" }
  | { kind: "log-empty" }
  | { kind: "log-younger-than-window"; firstOccurredAt: string }
  | null;

export function pickOccurrenceLogNotice(input: {
  predictiveCount: number;
  occurrenceLog: { available: boolean; firstOccurredAt: string | null } | undefined;
  generatedAt: string | undefined;
  windowHours: number;
}): OccurrenceLogNotice {
  if (input.predictiveCount > 0) return null;
  const log = input.occurrenceLog;
  if (!log) return null; // server cũ chưa trả trường này — không bịa
  if (!log.available) return { kind: "table-missing" };
  if (log.firstOccurredAt == null) return { kind: "log-empty" };
  if (!input.generatedAt) return null;
  const since = new Date(input.generatedAt).getTime() - input.windowHours * 3600_000;
  const first = new Date(log.firstOccurredAt).getTime();
  if (Number.isFinite(first) && first > since) {
    return { kind: "log-younger-than-window", firstOccurredAt: log.firstOccurredAt };
  }
  return null;
}
```

Test — tạo `client/src/pages/alarmKpiEmptyState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickOccurrenceLogNotice } from "./alarmKpiEmptyState";

const generatedAt = "2026-07-29T12:00:00.000Z";

describe("pickOccurrenceLogNotice", () => {
  it("đang có cảnh báo ⇒ không giải thích gì", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 3, occurrenceLog: { available: true, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toBeNull();
  });

  it("bảng chưa có ⇒ table-missing", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: { available: false, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toEqual({ kind: "table-missing" });
  });

  it("sổ rỗng ⇒ log-empty", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: { available: true, firstOccurredAt: null }, generatedAt, windowHours: 8,
    })).toEqual({ kind: "log-empty" });
  });

  it("sổ bắt đầu SAU mốc cửa sổ ⇒ log-younger-than-window", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0,
      occurrenceLog: { available: true, firstOccurredAt: "2026-07-29T09:00:00.000Z" }, // 3h trước
      generatedAt, windowHours: 8,
    })).toEqual({ kind: "log-younger-than-window", firstOccurredAt: "2026-07-29T09:00:00.000Z" });
  });

  it("sổ cũ hơn cửa sổ, 0 là thật ⇒ không giải thích", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0,
      occurrenceLog: { available: true, firstOccurredAt: "2026-07-01T00:00:00.000Z" },
      generatedAt, windowHours: 8,
    })).toBeNull();
  });

  it("server cũ chưa trả occurrenceLog ⇒ im lặng, KHÔNG bịa lý do", () => {
    expect(pickOccurrenceLogNotice({
      predictiveCount: 0, occurrenceLog: undefined, generatedAt, windowHours: 8,
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ rồi XANH**

Run: `npx vitest run client/src/pages/alarmKpiEmptyState.test.ts`
Expected: đỏ trước khi tạo `alarmKpiEmptyState.ts`, xanh sau.

- [ ] **Step 3: Thêm 3 khoá i18n vào `vi.json`** — trong khối `alarmKpi`, cạnh `"sourceCounts"`

```json
    "emptyLog": {
      "tableMissing": "Nhật ký lần-tái-diễn chưa sẵn sàng (migration chưa chạy) — phần cảnh báo AI không được tính vào KPI.",
      "empty": "Chưa ghi lần-tái-diễn nào kể từ khi bật tính năng. Số 0 nghĩa là chưa có dữ liệu, không phải nhà máy im lặng.",
      "younger": "Nhật ký bắt đầu ghi từ {{date}} — cửa sổ {{h}} giờ này bắt đầu trước mốc đó, phần trước không tồn tại."
    },
```

`en.json`:
```json
    "emptyLog": {
      "tableMissing": "Recurrence log is not ready (migration has not run) — AI alerts are excluded from this KPI.",
      "empty": "No recurrences have been logged since the feature was enabled. Zero here means no data yet, not a quiet factory.",
      "younger": "The log starts at {{date}} — this {{h}}-hour window begins before that point, and the earlier part does not exist."
    },
```

`zh.json`:
```json
    "emptyLog": {
      "tableMissing": "复发记录尚未就绪（迁移未执行）——AI 预警未计入本 KPI。",
      "empty": "自功能启用以来尚未记录任何复发。此处的 0 表示暂无数据，而非工厂无异常。",
      "younger": "记录自 {{date}} 开始——本 {{h}} 小时窗口早于该时点，之前的数据并不存在。"
    },
```

- [ ] **Step 4: Nối vào `AlarmKpiDashboard.tsx`**

Thêm import ở đầu file:
```ts
import { pickOccurrenceLogNotice } from "./alarmKpiEmptyState";
```

Thay khối `:248-253`:
```tsx
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("alarmKpi.sourceCounts", "Nguồn: {{andon}} Andon · {{pred}} cảnh báo AI", {
                    andon: data.sourceCounts.andon,
                    pred: data.sourceCounts.predictive,
                  })}
                </p>
                {(() => {
                  // Sprint 5 §3 — số 0 phải tự giải thích, nếu không người dùng
                  // kết luận "AI hỏng rồi" (đúng thứ Wave 3 §6 đã cảnh báo).
                  const notice = pickOccurrenceLogNotice({
                    predictiveCount: data.sourceCounts.predictive,
                    occurrenceLog: data.occurrenceLog,
                    generatedAt: data.generatedAt,
                    windowHours,
                  });
                  if (!notice) return null;
                  const text =
                    notice.kind === "table-missing"
                      ? t("alarmKpi.emptyLog.tableMissing", "Nhật ký lần-tái-diễn chưa sẵn sàng (migration chưa chạy) — phần cảnh báo AI không được tính vào KPI.")
                      : notice.kind === "log-empty"
                        ? t("alarmKpi.emptyLog.empty", "Chưa ghi lần-tái-diễn nào kể từ khi bật tính năng. Số 0 nghĩa là chưa có dữ liệu, không phải nhà máy im lặng.")
                        : t("alarmKpi.emptyLog.younger", "Nhật ký bắt đầu ghi từ {{date}} — cửa sổ {{h}} giờ này bắt đầu trước mốc đó, phần trước không tồn tại.", {
                            date: new Date(notice.firstOccurredAt).toLocaleString(),
                            h: windowHours,
                          });
                  return <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{text}</p>;
                })()}
```

- [ ] **Step 5: Nối vào `panels.tsx`** — thay khối `:408-415`

Khối hiện **ẩn hẳn** dòng nguồn khi cả hai bằng 0 — đúng lúc cần giải thích nhất thì không nói gì.

```tsx
      {d && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {(d.sourceCounts.andon > 0 || d.sourceCounts.predictive > 0) && (
            <span>
              {t("controlTower.alarmHealth.sources", "Sources: {{andon}} Andon · {{pred}} AI predictive", {
                andon: d.sourceCounts.andon,
                pred: d.sourceCounts.predictive,
              })}
            </span>
          )}
          {(() => {
            const notice = pickOccurrenceLogNotice({
              predictiveCount: d.sourceCounts.predictive,
              occurrenceLog: d.occurrenceLog,
              generatedAt: d.generatedAt,
              windowHours: 24, // panel này gọi summary({ windowHours: 24 })
            });
            if (!notice) return null;
            return (
              <span className="block text-amber-600 dark:text-amber-400">
                {notice.kind === "table-missing"
                  ? t("alarmKpi.emptyLog.tableMissing", "Nhật ký lần-tái-diễn chưa sẵn sàng (migration chưa chạy) — phần cảnh báo AI không được tính vào KPI.")
                  : notice.kind === "log-empty"
                    ? t("alarmKpi.emptyLog.empty", "Chưa ghi lần-tái-diễn nào kể từ khi bật tính năng. Số 0 nghĩa là chưa có dữ liệu, không phải nhà máy im lặng.")
                    : t("alarmKpi.emptyLog.younger", "Nhật ký bắt đầu ghi từ {{date}} — cửa sổ {{h}} giờ này bắt đầu trước mốc đó, phần trước không tồn tại.", {
                        date: new Date(notice.firstOccurredAt).toLocaleString(),
                        h: 24,
                      })}
              </span>
            );
          })()}
        </div>
      )}
```

Thêm import tương ứng ở đầu `panels.tsx`:
```ts
import { pickOccurrenceLogNotice } from "@/pages/alarmKpiEmptyState";
```

- [ ] **Step 6: Kiểm kiểu + i18n**

Run: `npm run check` rồi `npm run i18n:check`
Expected: không lỗi mới; ba khoá `alarmKpi.emptyLog.*` có đủ ở vi/en/zh.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/alarmKpiEmptyState.ts client/src/pages/alarmKpiEmptyState.test.ts client/src/pages/AlarmKpiDashboard.tsx client/src/components/controlTower/panels.tsx client/src/i18n/locales/vi.json client/src/i18n/locales/en.json client/src/i18n/locales/zh.json
git commit -m "feat(ai/s5-A3): số 0 trên bảng KPI báo động tự giải thích

Ba trạng thái: bảng chưa có · sổ rỗng · sổ trẻ hơn cửa sổ. Logic chọn câu tách
thành hàm thuần để test không cần render. Panel Control Tower thôi ẩn hẳn dòng
nguồn khi cả hai nguồn bằng 0 — đúng lúc cần giải thích nhất."
```

---

## Task 6: B1 — chứng minh sai lệch, sửa, rồi hợp nhất

**Files:**
- Test: `server/services/alerts/classifySuppression.equivalence.test.ts` (tạo mới)
- Modify: `server/services/predictiveMaintenanceService.ts:818-838`

**Interfaces:**
- Consumes: `classifySuppression`, `SuppressionThresholds` từ `server/services/alerts/classifySuppression.ts`
- Produces: không có API mới. **Đổi hành vi tại đúng một điểm:** `predictedTimeframeHours === -Infinity` từ nay bị chặn thay vì phát.

- [ ] **Step 1: Viết property test đối chiếu** — tạo `server/services/alerts/classifySuppression.equivalence.test.ts`

```ts
/**
 * Sprint 5 §5 (backlog B1) — `classifySuppression` và biểu thức phát cảnh báo ở
 * predictiveMaintenanceService là HAI BẢN SAO logic mà KHÔNG test nào so khớp.
 * Đổi ngưỡng ở một nơi thì SỐ ĐẾM nói dối mà không ai biết — mà độ tin của số
 * đếm chính là toàn bộ giá trị của tính năng đó (Wave 4 vừa dùng chính số này
 * để kết luận "độ tin cậy mới là ràng buộc thật, không phải rủi ro").
 *
 * Test này dựng lại biểu thức phát NGUYÊN VĂN như nó đang nằm trong
 * predictiveMaintenanceService.ts:832-837 rồi quét toàn bộ tổ hợp giá trị biên.
 */
import { describe, it, expect } from "vitest";
import { classifySuppression, type SuppressionThresholds } from "./classifySuppression";

const th: SuppressionThresholds = { risk: 60, confidence: 50, timeframeHours: 168 };

/** BẢN SAO NGUYÊN VĂN của biểu thức phát (predictiveMaintenanceService.ts:832-837).
 *  Nếu bạn sửa bên kia mà quên bên này, test sẽ đỏ — đó chính là mục đích. */
function emitsByLegacyExpression(r: {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null;
}): boolean {
  const timeframeOk =
    r.predictedTimeframeHours != null && r.predictedTimeframeHours <= th.timeframeHours;
  return r.failureRisk >= th.risk && r.confidenceScore >= th.confidence && timeframeOk;
}

const RISKS = [0, 59, 60, 61, 100, NaN];
const CONFS = [0, 49, 50, 51, 100, NaN];
const HOURS = [null, 0, 1, 167, 168, 169, -5, NaN, Infinity, -Infinity];

describe("classifySuppression ⟺ biểu thức phát — không được phép lệch", () => {
  it("mọi tổ hợp biên: classify === 'emit' đúng khi và chỉ khi biểu thức phát cho phép", () => {
    const lech: string[] = [];
    for (const failureRisk of RISKS) {
      for (const confidenceScore of CONFS) {
        for (const predictedTimeframeHours of HOURS) {
          const input = { failureRisk, confidenceScore, predictedTimeframeHours };
          const classified = classifySuppression(input, th) === "emit";
          const emitted = emitsByLegacyExpression(input);
          if (classified !== emitted) {
            lech.push(`risk=${failureRisk} conf=${confidenceScore} hours=${String(predictedTimeframeHours)} → classify=${classified} emit=${emitted}`);
          }
        }
      }
    }
    expect(lech).toEqual([]);
  });

  it("ca cụ thể đã tìm ra: -Infinity — classify CHẶN nhưng biểu thức phát lại PHÁT", () => {
    const input = { failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: -Infinity };
    expect(classifySuppression(input, th)).toBe("out-of-timeframe");
    expect(emitsByLegacyExpression(input)).toBe(false); // sau khi sửa
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ đúng chỗ dự đoán**

Run: `npx vitest run server/services/alerts/classifySuppression.equivalence.test.ts`
Expected: FAIL. Danh sách `lech` chứa các dòng `hours=-Infinity … classify=false emit=true`.

⚠ Nếu nó **xanh ngay**, brief này sai — **dừng và báo lại**, đừng sửa test cho vừa.

- [ ] **Step 3: Hợp nhất — biểu thức phát gọi thẳng `classifySuppression`**

Sửa `server/services/predictiveMaintenanceService.ts`, thay khối `:818-838`:

```ts
      // Sprint 5 §5 (backlog B1) — HỢP NHẤT. Trước đây đây là hai bản sao: một
      // để ĐẾM (classifySuppression, Wave 3 §4.5 chỉ-quan-sát), một để PHÁT
      // (biểu thức inline). Không test nào so chúng, và chúng ĐÃ lệch thật:
      // predictedTimeframeHours = -Infinity thì classify trả "out-of-timeframe"
      // (đếm là đã chặn) trong khi `-Inf <= T` là true nên biểu thức vẫn PHÁT.
      // Nay chỉ còn MỘT nguồn sự thật ⇒ số đếm không thể nói dối về việc phát.
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

      // Alert gating: avoid false positives on sparse/low-confidence data.
      if (suppression === "emit") {
```

Xoá hai dòng `const timeframeOk = …` và điều kiện `if (risk.failureRisk >= … && … && timeframeOk) {` cũ. **Giữ nguyên** thân khối `try { … }` bên trong.

⚠ **Không đụng** `if (risk.failureRisk >= RISK_ALERT_THRESHOLD)` ở `:867` (đường tạo work-order tự động) — đó là điều kiện khác, có chủ ý.

- [ ] **Step 4: Chuyển test từ "đối chiếu hai bản sao" sang "canh ngữ nghĩa + canh drift"**

Sau Step 3 chỉ còn MỘT bản cài đặt, nên một test "so hai bản sao" không còn nghĩa gì — nó sẽ mãi đỏ vì bản sao trong test cố tình giữ biểu thức CŨ. Đây **không** phải "sửa test cho vừa mã": mục tiêu của test đổi vì cấu trúc mã đổi. Làm đúng hai việc sau.

**(a)** Trong `classifySuppression.equivalence.test.ts`, đổi `emitsByLegacyExpression` thành **ngữ nghĩa ĐÚNG** (thêm `Number.isFinite`, chính là chỗ bản gốc thiếu) và đổi tên cho khớp vai trò mới:

```ts
/** Ngữ nghĩa MONG MUỐN của "được phát", viết độc lập với classifySuppression.
 *  Bản gốc trong predictiveMaintenanceService thiếu đúng `Number.isFinite` —
 *  nên `-Infinity` lọt qua `hours <= T` và được PHÁT trong khi bị ĐẾM là đã
 *  chặn. Giữ hàm này tách rời để bảng chân lý còn chỗ đối chiếu. */
function shouldEmit(r: {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null;
}): boolean {
  const h = r.predictedTimeframeHours;
  const timeframeOk = h != null && Number.isFinite(h) && h <= th.timeframeHours;
  return r.failureRisk >= th.risk && r.confidenceScore >= th.confidence && timeframeOk;
}
```

Thay mọi lời gọi `emitsByLegacyExpression` bằng `shouldEmit`, và đổi ca thứ hai thành:

```ts
  it("ca đã tìm ra: -Infinity phải BỊ CHẶN ở cả hai phía (bản gốc thiếu Number.isFinite)", () => {
    const input = { failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: -Infinity };
    expect(classifySuppression(input, th)).toBe("out-of-timeframe");
    expect(shouldEmit(input)).toBe(false);
  });
```

**(b)** Thêm một test canh drift ở cuối cùng file — khẳng định bản sao KHÔNG mọc lại:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

it("predictiveMaintenanceService KHÔNG được dựng lại biểu thức phát của riêng nó", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../predictiveMaintenanceService.ts"), "utf8");
  // Bản sao cũ nhận diện bằng biến `timeframeOk` + phép so ngưỡng inline.
  expect(src).not.toMatch(/const\s+timeframeOk\s*=/);
  expect(src).toMatch(/classifySuppression\(/);
  expect(src).toMatch(/suppression\s*===\s*["']emit["']/);
});
```

- [ ] **Step 5: Chạy test, xác nhận XANH**

Run: `npx vitest run server/services/alerts/classifySuppression.equivalence.test.ts server/services/alerts/classifySuppression.test.ts`
Expected: PASS toàn bộ — bảng chân lý khớp `shouldEmit` ở mọi tổ hợp biên, và test canh drift xác nhận bản sao đã biến mất.

- [ ] **Step 6: Kiểm kiểu + chạy test liên quan**

Run: `npm run check` rồi `npx vitest run server/services/alerts/`
Expected: PASS, không lỗi kiểu mới.

- [ ] **Step 7: Commit**

```bash
git add server/services/alerts/classifySuppression.equivalence.test.ts server/services/predictiveMaintenanceService.ts
git commit -m "fix(ai/s5-B1): hợp nhất hai bản sao logic chặn cảnh báo — sai lệch -Infinity

Property test quét tổ hợp biên chứng minh hai đường KHÔNG tương đương:
predictedTimeframeHours=-Infinity thì classifySuppression đếm là 'đã chặn'
nhưng biểu thức phát lại PHÁT (thiếu Number.isFinite). Nay biểu thức phát gọi
thẳng classifySuppression ⇒ số đếm không thể nói dối về việc phát.
Đổi hành vi tại đúng một điểm: -Infinity từ nay bị chặn."
```

---

## Self-Review

**1. Spec coverage**

| Spec | Task |
|---|---|
| §2.3 `decideNotify` + `severityRank` | 1 |
| §2.2 trật tự mới · §2.4 `notificationSentAt` · §2.6(2) fail-open · §2.6(3) không đè `aiAnalysis` · §2.8 giảm gọi LLM | 2 |
| §2.5 bỏ trần + van · §2.6(1) van CRITICAL · §2.7 env | 3 (van CRITICAL đọc ở Task 2 Step 3) |
| §3.1 server `occurrenceLog` | 4 |
| §3.2 client 2 nơi + i18n | 5 |
| §5.1 sai lệch · §5.2 ba bước | 6 |
| §6 chiến lược kiểm thử | trải đều: mock thật (Task 2/4), hợp đồng API (Task 4 Step 1, Task 5 Step 1) |

Không có mục nào của spec thiếu task.

**2. Placeholder scan** — không có TBD/TODO; mọi step có mã thật.

**3. Type consistency** — `NotifyInput`/`NotifyDecision` (Task 1) khớp lời gọi ở Task 2 Step 7. `occurrenceLog: { available, firstOccurredAt }` khớp giữa Task 4 Step 6 và Task 5 Step 1/4/5. `severityRank` khai ở Task 1 Step 3, dùng ở Task 1 Step 4. `pickOccurrenceLogNotice` khai Task 5 Step 1, dùng Step 4 + 5.

**Điểm cần người review chú ý nhất:** Task 6 Step 4 — chỗ duy nhất trong plan mà test đổi sau khi mã đổi. Hợp lệ vì cấu trúc mã đổi (hai bản sao → một), không phải "sửa test cho vừa mã": bằng chứng là test canh drift ở (b) khiến bản sao không mọc lại được, và `shouldEmit` vẫn là phép so viết ĐỘC LẬP với `classifySuppression`. Dù vậy đây là chỗ dễ bị lạm dụng nhất — review kỹ, và nếu Step 2 xanh ngay từ đầu thì brief sai, dừng lại.
