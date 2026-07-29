/**
 * Wave 3 §3 (task-3-brief.md) — routeAlert phải CẬP NHẬT một dòng cảnh báo đang
 * mở thay vì chèn dòng mới mỗi vòng quét. Bài học từ máy #3: 22 cảnh báo trong
 * MỘT ngày cho cùng một tình trạng, vì routeAlert cũ luôn INSERT.
 *
 * decideAlertWrite()/maxSeverity() (Task 2) đã có test thuần riêng
 * (decideAlertWrite.test.ts) — ở đây chỉ kiểm tra routeAlert NỐI đúng vào hàm
 * đó: tra cứu cảnh báo mở, gọi decideAlertWrite, rồi UPDATE hoặc INSERT theo
 * quyết định trả về.
 *
 * Mock hình dạng chuỗi gọi drizzle KHÔNG giống hệt brief gốc — brief chỉ mock
 * một chuỗi select().from().where().orderBy().limit() dùng chung cho MỌI
 * bảng, nhưng routeAlert thật còn gọi:
 *   - determineTargets(): db.select().from(users).where(...)  (KHÔNG orderBy/limit)
 *   - checkPatterns():    db.execute(sql`...`)                (không qua select)
 *   - tra machineCode:    db.select().from(machines).where(...).limit(1) (KHÔNG orderBy)
 * nên mock ở đây phân biệt theo BẢNG truyền vào .from(...) và dùng một chuỗi
 * "chainable + thenable" chịu được .where()/.orderBy()/.limit() theo BẤT KỲ
 * thứ tự/số lượng nào — khớp mã thật thay vì ép mã thật khớp mock.
 *
 * aiGgufEngine bị mock để KHÔNG chạy model thật (routeAlert gọi
 * enrichRoutingWithAI() vô điều kiện, dynamic-import "./aiGgufEngine").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { predictiveAlerts, machines } from "../../drizzle/schema";

// ─── Ghi lại các lệnh insert/update thật sự gửi tới db giả ─────────────────
const calls: { kind: "insert" | "update"; payload?: any }[] = [];

// Dữ liệu seed cho từng bảng — test set lại trong beforeEach/từng case.
let seedOpenAlertRows: any[] = [];
let seedMachineRows: any[] = [];
// Vòng sửa 1 — [Important]: cho tra-cứu-cảnh-báo-mở NÉM lỗi thật, để test chạm
// đúng nhánh try/catch nối dây ở aiSmartAlertRouter.ts (không chỉ ở decideAlertWrite thuần).
let existingOpenLookupThrows = false;

/** Một "chuỗi" chịu được .where()/.orderBy()/.limit() theo bất kỳ thứ tự nào,
 *  và tự resolve khi await ở BẤT KỲ điểm nào trong chuỗi (giống drizzle thật:
 *  mỗi query builder cũng là một thenable). */
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
        if (table === predictiveAlerts) {
          if (existingOpenLookupThrows) {
            // async () => getRows() bên trong chain() bọc throw này thành Promise
            // REJECT thật — đúng thứ mà await trong production code gặp khi Postgres lỗi.
            return chain(() => {
              throw new Error("tra cứu cảnh báo mở LỖI (giả lập Postgres tra cứu hỏng)");
            });
          }
          return chain(() => seedOpenAlertRows);
        }
        if (table === machines) return chain(() => seedMachineRows);
        // determineTargets() truy vấn users — không quan tâm nội dung, luôn rỗng
        // để routeAlert không cố gửi thông báo/email thật.
        return chain(() => []);
      },
    }),
    insert: (_table: any) => ({
      values: (v: any) => {
        calls.push({ kind: "insert", payload: v });
        return { returning: async () => [{ id: 1 }] };
      },
    }),
    update: (_table: any) => ({
      set: (v: any) => {
        calls.push({ kind: "update", payload: v });
        return { where: async () => undefined };
      },
    }),
    // checkPatterns() dùng db.execute(sql`...`) trực tiếp, không qua select().
    execute: async (_q: any) => ({ rows: [] }),
  }),
}));

// Không chạy model thật: routeAlert gọi enrichRoutingWithAI() vô điều kiện.
vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(async () => ({ text: "" })), // không khớp /\{[\s\S]*\}/ ⇒ enrichRoutingWithAI trả null
  isGgufAvailable: vi.fn(async () => false),
}));

beforeEach(() => {
  calls.length = 0;
  seedOpenAlertRows = [];
  seedMachineRows = [];
  existingOpenLookupThrows = false;
});

describe("routeAlert — một-cảnh-báo-mở", () => {
  it("chưa có cảnh báo mở ⇒ INSERT", async () => {
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 2, severity: "HIGH", message: "x", data: {} } as any);
    expect(calls.some((c) => c.kind === "insert")).toBe(true);
    expect(calls.some((c) => c.kind === "update")).toBe(false);
    // Vòng sửa 1 — [Minor]: expiresAt phải có mặt ở nhánh INSERT (nếu ai xoá, dòng mới
    // không bao giờ tự dọn dù tình trạng đã hết tái diễn).
    const ins = calls.find((c) => c.kind === "insert");
    expect(ins!.payload.expiresAt).toBeInstanceOf(Date);
  });

  it("đã có cảnh báo mở ⇒ UPDATE, KHÔNG insert, và KHÔNG đụng createdAt", async () => {
    seedOpenAlertRows = [{ id: 7, severity: "HIGH", occurrenceCount: 22 }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 2, severity: "HIGH", message: "x", data: {} } as any);
    const upd = calls.find((c) => c.kind === "update");
    expect(upd).toBeTruthy();
    expect(calls.some((c) => c.kind === "insert")).toBe(false);
    expect(upd!.payload.occurrenceCount).toBe(23);
    expect(upd!.payload).not.toHaveProperty("createdAt");
    // Vòng sửa 1 — [Minor]: expiresAt phải ĐƯỢC GIA HẠN ở nhánh UPDATE. Nếu ai xoá,
    // một cảnh báo vẫn đang tái diễn sẽ tự hết hạn — ngược ý đồ "hết hạn = đã thôi tái diễn".
    expect(upd!.payload.expiresAt).toBeInstanceOf(Date);
  });

  it("tra cứu cảnh báo mở NÉM lỗi thật ⇒ fail-OPEN: vẫn INSERT, KHÔNG UPDATE (spec §3d)", async () => {
    // Vòng sửa 1 — [Important]: khác 2 case decideAlertWrite.test.ts (hàm thuần, tự
    // truyền lookupFailed=true) — case này chạm ĐÚNG dây try/catch nối trong routeAlert
    // (aiSmartAlertRouter.ts:208-233). Nếu ai lỡ xoá try/catch đó, test này phải đỏ vì
    // routeAlert() sẽ throw thẳng thay vì trả về.
    existingOpenLookupThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 2, severity: "HIGH", message: "x", data: {} } as any);
    expect(calls.some((c) => c.kind === "insert")).toBe(true);
    expect(calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("không có machineId ⇒ luôn INSERT (PATTERN_ANOMALY), tiêu đề giữ khuôn cũ, không bịa mã máy", async () => {
    seedOpenAlertRows = [{ id: 7, severity: "HIGH", occurrenceCount: 22 }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "PATTERN_ANOMALY", severity: "MEDIUM", message: "x", data: {} } as any);
    expect(calls.some((c) => c.kind === "insert")).toBe(true);
    // Vòng sửa 1 — [Minor]: không machineId ⇒ không tra machineCode ⇒ readableTitle
    // phải rơi vào nhánh khuôn cũ "TYPE: SEVERITY", không chèn mã máy rỗng vào chuỗi.
    const ins = calls.find((c) => c.kind === "insert");
    expect(ins!.payload.title).toBe("PATTERN ANOMALY: MEDIUM");
    expect(ins!.payload.machineCode).toBeNull();
  });

  it("có máy + có mã máy ⇒ tiêu đề nêu mã máy, KHÔNG dùng khuôn cũ 'TYPE: SEVERITY'", async () => {
    seedMachineRows = [{ code: "AOI-07" }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({
      type: "MACHINE_FAILURE",
      machineId: 7,
      severity: "HIGH",
      message: "x",
      data: { currentValue: 82, predictedTimeframe: "next 24 hours" },
    } as any);
    const ins = calls.find((c) => c.kind === "insert");
    expect(ins).toBeTruthy();
    expect(ins!.payload.title).toBe("MACHINE FAILURE · AOI-07 · 82% · next 24 hours");
    expect(ins!.payload.machineCode).toBe("AOI-07");
  });

  it("có máy nhưng KHÔNG tra được mã máy ⇒ giữ khuôn tiêu đề cũ, không bịa mã máy", async () => {
    seedMachineRows = []; // tra cứu machines không ra hàng nào
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 999, severity: "HIGH", message: "x", data: {} } as any);
    const ins = calls.find((c) => c.kind === "insert");
    expect(ins).toBeTruthy();
    expect(ins!.payload.title).toBe("MACHINE FAILURE: HIGH");
    expect(ins!.payload.machineCode).toBeNull();
  });
});
