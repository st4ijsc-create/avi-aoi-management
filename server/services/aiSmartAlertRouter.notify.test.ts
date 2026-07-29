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
