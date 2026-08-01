/**
 * Doc 44 W3-B3 (G3.9) — QT-3 watcher: phát hiện low-material (feeder reorder + Andon
 * 'material') → tạo transport task IDEMPOTENT (khóa material+station, không trùng
 * task đang mở) → không AMR ⇒ pending + Andon thủ công (honest) → task done ⇒
 * thông báo delivered đúng MỘT lần. Kèm gate cờ scheduler + compensation cancel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────────────
const deps = vi.hoisted(() => ({
  listFeedersBelowReorder: vi.fn(async () => [] as any[]),
  allocateTask: vi.fn(async (_id: number) => ({ ok: true, enabled: true, assignedDeviceId: 9 })),
  routeAlert: vi.fn(async () => ({ alertType: "PATTERN_ANOMALY", targets: [], consolidated: false, escalationLevel: "L1" })),
  publish: vi.fn(),
}));
vi.mock("../../db/bom", () => ({ listFeedersBelowReorder: deps.listFeedersBelowReorder }));
vi.mock("../fleet/taskAllocator", () => ({ allocateTask: deps.allocateTask }));
vi.mock("../aiSmartAlertRouter", () => ({ routeAlert: deps.routeAlert }));
vi.mock("../../_core/eventBus", () => ({
  eventBus: { publish: deps.publish, subscribe: vi.fn(() => () => undefined) },
}));

// drizzle predicate mock (capture real column .name — pattern fleet.g1.test.ts)
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col?.name, __v: val }),
  and: (...ps: any[]) => ({ __op: "and", __ps: ps.filter(Boolean) }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", __k: col?.name, __vals: vals }),
  gte: (col: any, val: any) => ({ __op: "gte", __k: col?.name, __v: val }),
  desc: (col: any) => ({ __desc: col?.name }),
  asc: (col: any) => ({ __asc: col?.name }),
  sql: () => ({}),
}));

// in-memory tables keyed theo tên bảng drizzle
type Row = Record<string, any>;
const store: Record<string, Row[]> = { tasks: [], andon_events: [] };
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
  if (pred.__op === "gte") {
    const a = row[pred.__k] instanceof Date ? row[pred.__k].getTime() : row[pred.__k];
    const b = pred.__v instanceof Date ? pred.__v.getTime() : pred.__v;
    return a >= b;
  }
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

import {
  ensureTransportTask,
  cancelOpenTransportTask,
  sweepMaterialReplenishmentOnce,
  replenishKeyOf,
  startMaterialReplenishment,
  getMaterialReplenishmentStatus,
  materialReplenishEnabled,
  _resetMaterialReplenishmentForTests,
  MATERIAL_TASK_KIND,
} from "./materialReplenishment";

const ENV_KEYS = ["MATERIAL_REPLENISH_ENABLED", "MATERIAL_REPLENISH_SWEEP_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = [];
  for (const k of Object.keys(seq)) seq[k] = 0;
  deps.listFeedersBelowReorder.mockReset().mockResolvedValue([]);
  deps.allocateTask.mockReset().mockResolvedValue({ ok: true, enabled: true, assignedDeviceId: 9 });
  deps.routeAlert.mockReset().mockResolvedValue({ alertType: "PATTERN_ANOMALY", targets: [], consolidated: false, escalationLevel: "L1" });
  deps.publish.mockReset();
  _resetMaterialReplenishmentForTests();
  delete process.env.MATERIAL_REPLENISH_ENABLED;
});
afterEach(() => {
  _resetMaterialReplenishmentForTests();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("ensureTransportTask — idempotent theo cặp material+station", () => {
  it("tạo task mức nhiệm vụ (run_job + payload material_transport) và gán AMR qua allocator", async () => {
    const res = await ensureTransportTask({ machineId: 5, componentCode: "R-0402-10K", feederId: 3 });
    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(res.allocated).toBe(true);
    expect(store.tasks).toHaveLength(1);
    const t = store.tasks[0];
    expect(t.requiredCapability).toBe("run_job");
    expect(t.status).toBe("pending");
    expect(t.payload.kind).toBe(MATERIAL_TASK_KIND);
    expect(t.payload.replenishKey).toBe(replenishKeyOf(5, "R-0402-10K"));
    expect(deps.allocateTask).toHaveBeenCalledWith(t.id);
    expect(deps.publish).toHaveBeenCalledWith(
      "material.replenish.requested",
      expect.objectContaining({ machineId: 5, componentCode: "R-0402-10K" }),
      "materialReplenishment",
    );
  });

  it("còn task MỞ cùng khóa → KHÔNG tạo trùng (existing reuse)", async () => {
    const first = await ensureTransportTask({ machineId: 5, componentCode: "R-0402-10K" });
    const second = await ensureTransportTask({ machineId: 5, componentCode: "r-0402-10k" }); // khóa case-insensitive
    expect(second.created).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.taskId).toBe(first.taskId);
    expect(store.tasks).toHaveLength(1);
    // Task cũ ĐÃ ĐÓNG → chu kỳ cấp liệu mới tạo được task mới.
    store.tasks[0].status = "completed";
    const third = await ensureTransportTask({ machineId: 5, componentCode: "R-0402-10K" });
    expect(third.created).toBe(true);
    expect(store.tasks).toHaveLength(2);
  });

  it("không AMR nhận (allocate fail) → task vẫn pending + Andon thủ công (honest)", async () => {
    deps.allocateTask.mockResolvedValue({ ok: false, enabled: true, message: "no eligible device" });
    const res = await ensureTransportTask({ machineId: 7, componentCode: "C-0603-104" });
    expect(res.ok).toBe(true);
    expect(res.allocated).toBe(false);
    expect(store.tasks[0].status).toBe("pending");
    expect(deps.routeAlert).toHaveBeenCalledTimes(1);
    expect(deps.routeAlert.mock.calls[0][0].message).toMatch(/thủ công/);
  });
});

describe("cancelOpenTransportTask — bù trừ §18.2 (hủy nhiệm vụ AMR)", () => {
  it("hủy task MỞ đúng khóa; không đụng task đã đóng/khóa khác", async () => {
    await ensureTransportTask({ machineId: 5, componentCode: "A" });
    await ensureTransportTask({ machineId: 5, componentCode: "B" });
    store.tasks[1].status = "assigned"; // vẫn là MỞ
    const res = await cancelOpenTransportTask(5, "B", "qt3 compensation test");
    expect(res).toEqual({ ok: true, cancelled: 1 });
    expect(store.tasks[0].status).toBe("pending"); // khóa A không đụng
    expect(store.tasks[1].status).toBe("cancelled");
    expect(store.tasks[1].lastError).toBe("qt3 compensation test");
  });
});

describe("sweepMaterialReplenishmentOnce — nguồn (a) feeder + (b) Andon + delivered", () => {
  it("feeder dưới reorder → tạo task; sweep lại → duplicatesSkipped, không tạo trùng", async () => {
    deps.listFeedersBelowReorder.mockResolvedValue([
      { id: 31, machineId: 5, componentCode: "R-0402-10K", status: "active" },
      { id: 32, machineId: 5, componentCode: "GONE", status: "removed" }, // feeder đã tháo — bỏ qua
    ]);
    const s1 = await sweepMaterialReplenishmentOnce();
    expect(s1.feedersLow).toBe(1);
    expect(s1.tasksCreated).toBe(1);
    expect(store.tasks).toHaveLength(1);

    const s2 = await sweepMaterialReplenishmentOnce();
    expect(s2.tasksCreated).toBe(0);
    expect(s2.duplicatesSkipped).toBe(1);
    expect(store.tasks).toHaveLength(1);
  });

  it("Andon 'material' đang mở → tạo task khóa theo andon; resolved andon không tạo", async () => {
    store.andon_events.push(
      { id: 41, reason: "material", status: "raised", machineId: 6, stationId: null, lineId: 2 },
      { id: 42, reason: "material", status: "resolved", machineId: 6 }, // đã đóng — bỏ qua
      { id: 43, reason: "quality", status: "raised", machineId: 6 }, // sai category — bỏ qua
    );
    const s = await sweepMaterialReplenishmentOnce();
    expect(s.andonMaterial).toBe(1);
    expect(s.tasksCreated).toBe(1);
    expect(store.tasks[0].payload.replenishKey).toBe("mat-andon:41");
    expect(store.tasks[0].payload.andonId).toBe(41);

    const s2 = await sweepMaterialReplenishmentOnce();
    expect(s2.duplicatesSkipped).toBe(1);
    expect(store.tasks).toHaveLength(1);
  });

  it("task material completed → phát 'material.replenish.delivered' đúng MỘT lần", async () => {
    await ensureTransportTask({ machineId: 5, componentCode: "R-0402-10K" });
    store.tasks[0].status = "completed";
    store.tasks[0].updatedAt = new Date();
    deps.publish.mockClear();

    const s1 = await sweepMaterialReplenishmentOnce();
    expect(s1.delivered).toBe(1);
    expect(deps.publish).toHaveBeenCalledWith(
      "material.replenish.delivered",
      expect.objectContaining({ taskId: store.tasks[0].id, machineId: 5 }),
      "materialReplenishment",
    );
    expect(store.tasks[0].payload.deliveredNotifiedAt).toBeTruthy();

    deps.publish.mockClear();
    const s2 = await sweepMaterialReplenishmentOnce();
    expect(s2.delivered).toBe(0); // đã thông báo — không lặp
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

describe("scheduler gate — MATERIAL_REPLENISH_ENABLED (default OFF)", () => {
  it("flag off → không start timer", () => {
    expect(materialReplenishEnabled()).toBe(false);
    startMaterialReplenishment();
    expect(getMaterialReplenishmentStatus().running).toBe(false);
  });

  it("flag on → start (unref'd) + stop qua reset", () => {
    process.env.MATERIAL_REPLENISH_ENABLED = "true";
    startMaterialReplenishment();
    expect(getMaterialReplenishmentStatus().running).toBe(true);
    _resetMaterialReplenishmentForTests();
    expect(getMaterialReplenishmentStatus().running).toBe(false);
  });
});
