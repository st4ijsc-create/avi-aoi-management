/**
 * Doc 44 W3-B3 (G3.10) — decomposition ĐA BƯỚC gated cờ FLEET_MULTISTEP_DECOMP_ENABLED:
 *   • cờ OFF (default) → hành vi G1 cũ (1 task/order) GIỮ NGUYÊN.
 *   • cờ ON → pick → transport → dock_handoff, dependency tuyến tính bằng TRẠNG THÁI
 *     (task đầu 'pending', sau 'blocked' + payload.dependsOnTaskId), idempotent replay.
 *   • promoteBlockedSuccessors: predecessor completed → successor pending (+allocate);
 *     predecessor failed → successor cancelled (saga — không chạy bước kế mù).
 * Fake-db in-memory pattern fleet.g1.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

type Row = Record<string, any>;
const store: Record<string, Row[]> = { tasks: [], production_orders: [], robots: [], robot_telemetry: [] };
const seq: Record<string, number> = {};
function nextId(table: string): number {
  seq[table] = (seq[table] ?? 0) + 1;
  return seq[table];
}
function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.__ps.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "inArray") return pred.__vals.includes(row[pred.__k]);
  return true;
}
const fakeDb: any = {
  select: () => ({
    from: (t: any) => {
      const name = tableName(t);
      let pred: any = null;
      const q: any = {
        where: (p: any) => {
          pred = p;
          return q;
        },
        orderBy: () => q,
        limit: async (n: number) => (store[name] ?? []).filter((r) => matches(r, pred)).slice(0, n),
        then: (resolve: any) => resolve((store[name] ?? []).filter((r) => matches(r, pred))),
      };
      return q;
    },
  }),
  insert: (t: any) => ({
    values: (vals: Row | Row[]) => {
      const name = tableName(t);
      const arr = Array.isArray(vals) ? vals : [vals];
      const inserted = arr.map((v) => {
        const row = { id: nextId(name), ...v };
        (store[name] ??= []).push(row);
        return row;
      });
      const ret: any = { returning: async () => inserted };
      ret.then = (resolve: any) => resolve(inserted);
      return ret;
    },
  }),
  update: (t: any) => ({
    set: (vals: Row) => ({
      where: async (pred: any) => {
        const name = tableName(t);
        for (const r of (store[name] ?? []).filter((row) => matches(row, pred))) Object.assign(r, vals);
      },
    }),
  }),
};
vi.mock("../../db/connection", () => ({ getDb: async () => fakeDb }));

import { decomposeOrderToTasks, promoteBlockedSuccessors, fleetMultistepDecompEnabled } from "./fleetOrchestrator";
import { _clearProfileCache } from "./taskAllocator";

const ENV_KEYS = ["FLEET_ORCH_ENABLED", "FLEET_MULTISTEP_DECOMP_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = [];
  for (const k of Object.keys(seq)) seq[k] = 0;
  _clearProfileCache();
  delete process.env.FLEET_ORCH_ENABLED;
  delete process.env.FLEET_MULTISTEP_DECOMP_ENABLED;
  store.production_orders.push({ id: 9, orderCode: "WO-9", companyCode: "C1", factoryId: 1, priority: 4, productModelId: 3 });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("decomposeOrderToTasks — gated FLEET_MULTISTEP_DECOMP_ENABLED", () => {
  it("cờ OFF (default) → hành vi G1 cũ: đúng 1 task order:<id>:t1", async () => {
    expect(fleetMultistepDecompEnabled()).toBe(false);
    const r = await decomposeOrderToTasks(9);
    expect(r.created).toBe(1);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].taskKey).toBe("order:9:t1");
    expect(store.tasks[0].status).toBe("pending");
  });

  it("cờ ON → 3 task pick→transport→dock, dependency tuyến tính bằng trạng thái", async () => {
    process.env.FLEET_MULTISTEP_DECOMP_ENABLED = "true";
    const r = await decomposeOrderToTasks(9);
    expect(r.created).toBe(3);
    expect(store.tasks).toHaveLength(3);

    const [pick, transport, dock] = store.tasks;
    expect(pick.taskKey).toBe("order:9:pick");
    expect(transport.taskKey).toBe("order:9:transport");
    expect(dock.taskKey).toBe("order:9:dock");
    expect([pick.payload.operation, transport.payload.operation, dock.payload.operation]).toEqual([
      "pick",
      "transport",
      "dock_handoff",
    ]);
    // Chỉ task đầu chạy được ngay; các task sau 'blocked' chờ predecessor.
    expect([pick.status, transport.status, dock.status]).toEqual(["pending", "blocked", "blocked"]);
    expect(pick.payload.dependsOnTaskId).toBeNull();
    expect(transport.payload.dependsOnTaskId).toBe(pick.id);
    expect(dock.payload.dependsOnTaskId).toBe(transport.id);
    // Kế thừa priority/tenant từ order như G1.
    expect(pick.priority).toBe(4);
    expect(pick.requiredCapability).toBe("run_job");

    // Idempotent replay: không tạo thêm.
    const again = await decomposeOrderToTasks(9);
    expect(again.created).toBe(0);
    expect(again.taskIds).toEqual([pick.id, transport.id, dock.id]);
    expect(store.tasks).toHaveLength(3);
  });

  it("order đã decompose kiểu G1 trước khi flip cờ → giữ task cũ, KHÔNG double-decompose", async () => {
    const g1 = await decomposeOrderToTasks(9); // cờ off → t1
    process.env.FLEET_MULTISTEP_DECOMP_ENABLED = "true";
    const r = await decomposeOrderToTasks(9);
    expect(r.created).toBe(0);
    expect(r.taskIds).toEqual(g1.taskIds);
    expect(store.tasks).toHaveLength(1);
  });
});

describe("promoteBlockedSuccessors — tuần tự hóa + saga hủy bước kế", () => {
  async function seedChain() {
    process.env.FLEET_MULTISTEP_DECOMP_ENABLED = "true";
    await decomposeOrderToTasks(9);
    return store.tasks as [Row, Row, Row];
  }

  it("cờ off → no-op honest (enabled:false)", async () => {
    const r = await promoteBlockedSuccessors();
    expect(r.enabled).toBe(false);
    expect(r.promoted).toBe(0);
  });

  it("predecessor completed → successor pending; chuỗi tiến từng bước một", async () => {
    const [pick, transport, dock] = await seedChain();
    process.env.FLEET_ORCH_ENABLED = "true";

    pick.status = "completed";
    const r1 = await promoteBlockedSuccessors();
    expect(r1.promoted).toBe(1);
    expect(transport.status).toBe("pending"); // không AMR trong fake → allocate để pending (drain nhặt sau)
    expect(dock.status).toBe("blocked"); // dock vẫn chờ transport

    transport.status = "completed";
    const r2 = await promoteBlockedSuccessors();
    expect(r2.promoted).toBe(1);
    expect(dock.status).toBe("pending");
  });

  it("predecessor failed → successors bị cancel (không chạy bước kế mù)", async () => {
    const [pick, transport, dock] = await seedChain();
    process.env.FLEET_ORCH_ENABLED = "true";

    pick.status = "failed";
    // Một pass: transport cancel vì pick failed; dock cancel lan truyền vì predecessor
    // (transport) được đọc LIVE trong cùng pass và đã 'cancelled'.
    const r1 = await promoteBlockedSuccessors();
    expect(r1.cancelled).toBe(2);
    expect(transport.status).toBe("cancelled");
    expect(transport.lastError).toMatch(/predecessor .* failed/);
    expect(dock.status).toBe("cancelled");
    expect(dock.lastError).toMatch(/predecessor .* cancelled/);

    const r2 = await promoteBlockedSuccessors();
    expect(r2.cancelled).toBe(0);
    expect(r2.promoted).toBe(0);
  });
});
