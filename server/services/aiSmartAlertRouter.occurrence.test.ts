/**
 * Wave 4 §3 (task-2-brief.md) — routeAlert phải ghi MỘT dòng nhật ký lần-tái-diễn
 * (predictive_alert_occurrences) cho MỖI lần được gọi, dù đi nhánh INSERT (dòng
 * cảnh báo mới) hay UPDATE (dòng cảnh báo đang mở tái diễn).
 *
 * ⚠ Cái bẫy chính: dòng cha (predictive_alerts) lưu severity ĐÃ GỘP (max của cũ
 * và mới — decideAlertWrite, Wave 3). Nhật ký occurrence phải lưu severity của
 * CHÍNH LẦN NÀY — tức event.severity — KHÔNG phải decision.severity đã gộp.
 *
 * Mock dùng lại đúng khuôn của aiSmartAlertRouter.oneOpen.test.ts (Wave 3):
 * chuỗi "chainable + thenable" phân biệt theo bảng truyền vào .from(...), chịu
 * được .where()/.orderBy()/.limit() theo bất kỳ thứ tự nào; mock aiGgufEngine để
 * không nạp model thật. Thêm nhánh mock cho predictiveAlertOccurrences.insert().
 *
 * machineId dùng RIÊNG cho từng test (4242 dùng rồi ở oneOpen.test.ts nhưng đó
 * là file khác — module state (Redis in-memory fallback) là singleton toàn tiến
 * trình vitest, các file test chạy trong worker riêng nên không đụng nhau; trong
 * CHÍNH file này mỗi test vẫn dùng machineId riêng để không cộng dồn bộ đếm
 * consolidation giữa các case, đúng bài học Wave 3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { predictiveAlerts, machines, predictiveAlertOccurrences } from "../../drizzle/schema";

const calls: { kind: "insert" | "update" | "insert-occurrence"; payload?: any }[] = [];

let seedOpenAlertRows: any[] = [];
let seedMachineRows: any[] = [];
let occurrenceInsertThrows = false;

/** Một "chuỗi" chịu được .where()/.orderBy()/.limit() theo bất kỳ thứ tự nào,
 *  và tự resolve khi await ở BẤT KỲ điểm nào trong chuỗi. Y hệt oneOpen.test.ts. */
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
        if (table === machines) return chain(() => seedMachineRows);
        // determineTargets() truy vấn users — luôn rỗng, không quan tâm nội dung.
        return chain(() => []);
      },
    }),
    insert: (table: any) => {
      if (table === predictiveAlertOccurrences) {
        return {
          values: (v: any) => {
            if (occurrenceInsertThrows) {
              return Promise.reject(new Error("ghi nhật ký lần-tái-diễn LỖI (giả lập)"));
            }
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
        return {
          where: (_cond: any) => Promise.resolve(undefined),
        };
      },
    }),
    execute: async (_q: any) => ({ rows: [] }),
  }),
}));

vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(async () => ({ text: "" })),
  isGgufAvailable: vi.fn(async () => false),
}));

beforeEach(() => {
  calls.length = 0;
  seedOpenAlertRows = [];
  seedMachineRows = [];
  occurrenceInsertThrows = false;
});

describe("routeAlert — ghi nhật ký lần-tái-diễn", () => {
  it("ghi MỚI cảnh báo ⇒ cũng ghi MỘT dòng nhật ký (lần đầu không được bỏ sót)", async () => {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "MACHINE_FAILURE",
      machineId: 9001,
      severity: "HIGH",
      message: "x",
      data: { confidence: 77 },
    } as any);

    expect(calls.some((c) => c.kind === "insert")).toBe(true);
    const occ = calls.find((c) => c.kind === "insert-occurrence");
    expect(occ).toBeTruthy();
    expect(occ!.payload.alertId).toBeTruthy();
    expect(occ!.payload.severity).toBe("HIGH");
  });

  it("CẬP NHẬT cảnh báo ⇒ ghi nhật ký với mức độ của LẦN NÀY, không phải mức đã gộp", async () => {
    // dòng đang mở severity=CRITICAL, sự kiện mới severity=MEDIUM
    // ⇒ dòng cha giữ CRITICAL (mức chỉ đi lên, decideAlertWrite), nhưng NHẬT KÝ
    // phải ghi MEDIUM — mức của chính lần gọi này.
    seedOpenAlertRows = [{ id: 55, severity: "CRITICAL", occurrenceCount: 3 }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "MACHINE_FAILURE",
      machineId: 9002,
      severity: "MEDIUM",
      message: "x",
      data: {},
    } as any);

    const upd = calls.find((c) => c.kind === "update");
    expect(upd).toBeTruthy();
    expect(upd!.payload.severity).toBe("CRITICAL"); // dòng cha: mức đã gộp (Wave 3, không đổi)

    const occ = calls.find((c) => c.kind === "insert-occurrence");
    expect(occ).toBeTruthy();
    expect(occ!.payload.severity).toBe("MEDIUM"); // nhật ký: mức của LẦN NÀY
    expect(occ!.payload.alertId).toBe(55);
  });

  it("ghi nhật ký NÉM LỖI ⇒ cảnh báo VẪN được ghi (fail-open), không ném ra ngoài", async () => {
    occurrenceInsertThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await expect(
      routeAlert({
        type: "MACHINE_FAILURE",
        machineId: 9003,
        severity: "HIGH",
        message: "x",
        data: {},
      } as any),
    ).resolves.toBeTruthy();

    expect(calls.some((c) => c.kind === "insert")).toBe(true);
    // ghi nhật ký thất bại ⇒ không có dòng insert-occurrence, nhưng KHÔNG ném lỗi
    // ra ngoài routeAlert() và cảnh báo chính vẫn được ghi.
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(false);
  });
});
