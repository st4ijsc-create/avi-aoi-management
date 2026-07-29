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
// I-1 (vòng sửa cuối) — cho checkPatterns() (db.execute) NÉM lỗi thật, để test chạm
// đúng đường I/O không bọc giữa quyết-định và đường-ghi.
let patternExecuteThrows = false;
// Finding 1 (review round 1) — driver THẬT ném lỗi ở đúng điểm await cuối chuỗi
// (.returning() thật thi hành query). Không push vào `calls` khi hỏng — dòng
// chưa từng thực sự được ghi, giữ đúng quy ước đã dùng cho occurrence ở
// aiSmartAlertRouter.occurrence.test.ts (case "ghi nhật ký NÉM LỖI").
let alertInsertThrows = false;

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
          // Finding 1 — hỏng ở .returning(), điểm await thật của drizzle
          // postgres-js. KHÔNG push vào `calls`: dòng chưa từng ghi được.
          if (alertInsertThrows) {
            return { returning: async () => { throw new Error("ghi predictive_alerts (INSERT) LỖI (giả lập Postgres hỏng)"); } };
          }
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
      if (patternExecuteThrows) {
        throw new Error("truy vấn pattern 30 ngày LỖI (giả lập Postgres time-out tải cao)");
      }
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
  patternExecuteThrows = false;
  alertInsertThrows = false;
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

  // Review round 1, Finding 1 — §2.6(2): sau khi đảo trật tự, thông báo gửi
  // SAU khi ghi. Nếu GHI predictive_alerts hỏng, try/catch fail-open (:369-380)
  // là tuyến duy nhất giữ máy sắp hỏng không bị im lặng. Trước đây (thông báo
  // gửi TRƯỚC ghi) lỗi ghi vô hại với người nhận; nay nếu try/catch này bị gỡ,
  // routeAlert() sẽ NÉM ra ngoài và không ai được báo — chỉ tsc/mắt người canh,
  // không có test nào. Test này lấp đúng khoảng trống đó.
  it("GHI predictive_alerts (INSERT) hỏng ⇒ fail-open: KHÔNG ném ra ngoài, VẪN gửi thông báo", async () => {
    seedUserRows = MAINTENANCE;
    alertInsertThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");

    await expect(
      routeAlert({ type: "MACHINE_FAILURE", machineId: 8106, severity: "HIGH", message: "x", data: {} } as any),
    ).resolves.toBeTruthy();

    expect(notified).toHaveLength(1); // vẫn báo dù dòng cảnh báo chưa từng được ghi
    expect(calls.some((c) => c.kind === "insert")).toBe(false); // ghi hỏng ⇒ không có gì được ghi thật
    // Không có alertRecord.id để nối vào ⇒ buildOccurrence trả null, không INSERT
    // nhật ký occurrence (đúng ý — không phải bỏ sót, không có gì để nối vào).
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(false);
  });

  // Review round 1, Finding 2 — nhánh insert đã có test "targets rỗng ⇒ không
  // stamp"; nhánh UPDATE thì chưa. Tổ hợp có thật: cảnh báo CRITICAL tái diễn
  // trên một dòng đang mở (⇒ notifyDecision.notify = true, xuyên cooldown)
  // nhưng nhà máy CHƯA cấu hình role `maintenance` (⇒ targets = [], willStamp
  // = false). `...(willStamp ? {...} : {})` phải bỏ hẳn hai trường khỏi SET.
  it("UPDATE + notify=true (CRITICAL xuyên cooldown) + targets rỗng ⇒ KHÔNG stamp", async () => {
    seedUserRows = [];
    seedOpenAlertRows = [{
      id: 58, severity: "HIGH", occurrenceCount: 2,
      notificationSentAt: new Date(), // vừa báo — nếu không phải CRITICAL sẽ bị cooldown chặn
    }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8107, severity: "CRITICAL", message: "x", data: {} } as any);

    expect(notified).toHaveLength(0); // không có ai để gửi thật
    const upd = calls.find((c) => c.kind === "update")!;
    expect(upd).toBeTruthy();
    expect(upd.payload.notificationSentAt).toBeUndefined();
    expect(upd.payload.notificationSent).toBeUndefined();
  });

  // Vòng sửa cuối, I-1 — `determineTargets`/`checkPatterns` (:270-271) là I/O DB
  // KHÔNG bọc lỗi, nằm GIỮA quyết-định và đường-ghi. checkPatterns chạy GROUP BY
  // 30 ngày trên predictive_alerts — dễ time-out nhất trong hàm, đúng lúc tải cao
  // là đúng lúc KPI cần đếm nhất. Trước khi sửa: lỗi ở đây ném thẳng ra ngoài
  // routeAlert() ⇒ KHÔNG dòng cảnh báo, KHÔNG dòng nhật ký, KPI mất một lần, không
  // dấu vết — đúng luận điểm cốt lõi của sprint bị thủng ngay tại đây.
  it("checkPatterns (truy vấn pattern 30 ngày) NÉM lỗi ⇒ fail-open: KHÔNG ném ra ngoài, VẪN ghi cảnh báo + nhật ký", async () => {
    seedUserRows = MAINTENANCE;
    patternExecuteThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");

    await expect(
      routeAlert({ type: "MACHINE_FAILURE", machineId: 8108, severity: "HIGH", message: "x", data: {} } as any),
    ).resolves.toBeTruthy();

    expect(calls.some((c) => c.kind === "insert")).toBe(true); // dòng cảnh báo vẫn được ghi
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(true); // nhật ký lần-tái-diễn vẫn được ghi
  });
});
