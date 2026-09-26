/**
 * doc 80 Đợt 0 — final whole-branch review, fix wave (fleet):
 *
 *   #4 — rebalanceDeviceTasks trả task về 'pending' rồi gán lại bằng UPDATE KHÔNG điều kiện ⇒
 *        một allocateTask chen vào giữa (task đang 'pending') cũng thắng ⇒ task được gán HAI lần
 *        (hai sự kiện task.assigned, lượt sau đè lượt trước). Vá: cả hai UPDATE là CAS theo
 *        trạng thái mong đợi (như allocateTask); lượt thua đếm là `unassigned`.
 *   #8 — fleet.assign (gán tay) ghi KHÔNG điều kiện sau khi đọc ảnh chụp: task vừa 'completed'
 *        giữa lượt đọc và lượt ghi bị HỒI SINH thành 'assigned'. Vá: điều kiện trạng thái
 *        gán được; thua ⇒ CONFLICT.
 *
 * CSDL THẬT (`_test`). Đan xen TẤT ĐỊNH bằng hook ở hai hàm đọc async nằm ĐÚNG trong cửa sổ
 * tranh chấp: `traTelemetryMoiNhatTheoRobot` (allocator đọc ứng viên — sau khi rebalance đã trả
 * task về pending, trước khi gán lại), `idsTrongPhamVi` (router assign — sau lượt đọc task,
 * trước lượt ghi) và một bọc `getDb` dừng lệnh UPDATE `tasks` kế tiếp ngay trước khi thực thi
 * (rebalance — sau lượt đọc task mở, trước lượt thả về pending).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const hooks = vi.hoisted(() => ({
  onTelemetry: null as null | (() => Promise<void>),
  onScope: null as null | (() => Promise<void>),
  /** chạy MỘT lần ngay trước khi lệnh UPDATE `tasks` kế tiếp (qua getDb) thực thi */
  onTasksUpdate: null as null | (() => Promise<void>),
}));

// Bọc getDb: khi hook `onTasksUpdate` được cắm, lệnh UPDATE `tasks` kế tiếp dừng ngay TRƯỚC khi
// thực thi (lúc `await`) để test chen một thay đổi đồng thời. Không cắm ⇒ trả đúng db thật.
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  const { getTableName } = await import("drizzle-orm");
  function hookThen(obj: any, hook: () => Promise<void>): any {
    return new Proxy(obj, {
      get(t, p) {
        if (p === "then") {
          const th = t.then;
          if (typeof th !== "function") return undefined;
          return (res: any, rej: any) => hook().then(() => th.call(t, res, rej), rej);
        }
        const v = Reflect.get(t, p, t);
        if (typeof v === "function") {
          return (...a: unknown[]) => {
            const r = v.apply(t, a);
            return r && typeof r === "object" ? hookThen(r, hook) : r;
          };
        }
        return v;
      },
    });
  }
  return {
    ...actual,
    getDb: async () => {
      const d = await actual.getDb();
      if (!d || !hooks.onTasksUpdate) return d;
      return new Proxy(d, {
        get(t, p) {
          const v = Reflect.get(t, p, t);
          if (p === "update") {
            return (table: any) => {
              const b = (v as any).call(t, table);
              const h = hooks.onTasksUpdate;
              if (!h || getTableName(table) !== "tasks") return b;
              hooks.onTasksUpdate = null; // một lượt
              let fired: Promise<void> | null = null;
              return hookThen(b, () => (fired ??= h()));
            };
          }
          return typeof v === "function" ? (v as any).bind(t) : v;
        },
      });
    },
  };
});

vi.mock("../../db/telemetryMoiNhat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/telemetryMoiNhat")>();
  return {
    ...actual,
    traTelemetryMoiNhatTheoRobot: async (...args: Parameters<typeof actual.traTelemetryMoiNhatTheoRobot>) => {
      const h = hooks.onTelemetry;
      if (h) {
        hooks.onTelemetry = null; // một lượt
        await h();
      }
      return actual.traTelemetryMoiNhatTheoRobot(...args);
    },
  };
});

vi.mock("../../db/hierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/hierarchy")>();
  return {
    ...actual,
    idsTrongPhamVi: async (...args: Parameters<typeof actual.idsTrongPhamVi>) => {
      const h = hooks.onScope;
      if (h) {
        hooks.onScope = null;
        await h();
      }
      return actual.idsTrongPhamVi(...args);
    },
  };
});

import { allocateTask, rebalanceDeviceTasks } from "./taskAllocator";

const DB_URL = process.env.DATABASE_URL;
const RUN = `ffx_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC = `FFX_${RUN}`.slice(0, 50);
const U_ADMIN = 951_201;

let sql: ReturnType<typeof postgres>;
const ids = { fac: 0, ws: 0, line: 0, robotA: 0, robotB: 0 };

async function mkTask(key: string, status = "pending", assignedDeviceId: number | null = null): Promise<number> {
  const r = await sql`
    INSERT INTO tasks ("taskKey", "requiredCapability", status, priority, "factoryId", "assignedDeviceId", "assignedDeviceKind")
    VALUES (${key}, 'run_job', ${status}, 3, ${ids.fac}, ${assignedDeviceId}, ${assignedDeviceId ? "robot" : null}) RETURNING id`;
  return Number((r[0] as { id: number }).id);
}
async function taskRow(id: number) {
  return (await sql`SELECT status, "assignedDeviceId" FROM tasks WHERE id = ${id}`)[0] as any;
}

describe.skipIf(!DB_URL)("fleet — final review fix wave (#4 rebalance CAS, #8 assign có điều kiện) — CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    process.env.FLEET_ORCH_ENABLED = "true";
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.fac = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC}, ${"FFX " + FAC}, true) RETURNING id`);
    ids.ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.fac}, ${FAC + "_WS"}, 'ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.ws}, ${FAC + "_L1"}, 'line') RETURNING id`);
    ids.robotA = await one(sql`
      INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId")
      VALUES (${RUN + "_RA"}, 'robotA', 'sim', 'arm', 'tcp://127.0.0.1:1', true, 'idle', ${ids.line}) RETURNING id`);
    ids.robotB = await one(sql`
      INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId")
      VALUES (${RUN + "_RB"}, 'robotB', 'sim', 'arm', 'tcp://127.0.0.1:1', true, 'idle', ${ids.line}) RETURNING id`);
  });

  afterAll(async () => {
    hooks.onTelemetry = null;
    hooks.onScope = null;
    hooks.onTasksUpdate = null;
    if (!sql) return;
    await sql`DELETE FROM tasks WHERE "taskKey" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM robots WHERE id IN ${sql([ids.robotA, ids.robotB])}`;
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    await sql`DELETE FROM workshops WHERE id = ${ids.ws}`;
    await sql`DELETE FROM factories WHERE id = ${ids.fac}`;
    delete process.env.FLEET_ORCH_ENABLED;
    await sql.end({ timeout: 5 });
  });

  it("★★★ #4: allocateTask chen vào GIỮA lúc rebalance trả task về pending và lúc gán lại ⇒ task được gán ĐÚNG MỘT lần", async () => {
    const taskId = await mkTask(`${RUN}_REBAL_RACE`, "assigned", ids.robotA);
    let alloc: Awaited<ReturnType<typeof allocateTask>> | null = null;
    hooks.onTelemetry = async () => {
      // Lúc này rebalance đã thả task về 'pending' và đang đọc ứng viên để gán lại.
      expect((await taskRow(taskId)).status).toBe("pending");
      alloc = await allocateTask(taskId);
    };
    const reb = await rebalanceDeviceTasks(ids.robotA, "test_offline");
    expect(alloc).not.toBeNull();
    expect(alloc!.ok).toBe(true);

    // Đúng MỘT lượt gán: allocate thắng ⇒ rebalance thua CAS ⇒ đếm unassigned, không reassigned.
    expect(reb.reassigned).toBe(0);
    expect(reb.unassigned).toBe(1);
    const row = await taskRow(taskId);
    expect(row.status).toBe("assigned");
    expect(row.assignedDeviceId).toBe(alloc!.assignedDeviceId);
  });

  it("★★★ #4: task 'completed' giữa lượt đọc của rebalance và lượt thả về pending ⇒ KHÔNG bị hồi sinh / gán lại", async () => {
    const taskId = await mkTask(`${RUN}_REBAL_DONE`, "assigned", ids.robotA);
    hooks.onTasksUpdate = async () => {
      await sql`UPDATE tasks SET status = 'completed', "completedAt" = now() WHERE id = ${taskId}`;
    };
    const reb = await rebalanceDeviceTasks(ids.robotA, "test_offline");
    expect(reb.reassigned).toBe(0);
    const row = await taskRow(taskId);
    expect(row.status).toBe("completed");
    expect(row.assignedDeviceId).toBe(ids.robotA);
  });

  it("#4: rebalance không có ai chen ⇒ vẫn gán lại sang thiết bị KHÁC như cũ", async () => {
    const taskId = await mkTask(`${RUN}_REBAL_PLAIN`, "assigned", ids.robotA);
    const reb = await rebalanceDeviceTasks(ids.robotA, "test_offline");
    expect(reb.reassigned).toBe(1);
    const row = await taskRow(taskId);
    expect(row.status).toBe("assigned");
    expect(row.assignedDeviceId).not.toBe(ids.robotA);
  });

  it("★★★ #8: task 'completed' GIỮA lượt đọc và lượt ghi của assign ⇒ CONFLICT, KHÔNG hồi sinh thành 'assigned'", async () => {
    const taskId = await mkTask(`${RUN}_ASSIGN_REVIVE`, "pending");
    hooks.onScope = async () => {
      await sql`UPDATE tasks SET status = 'completed', "completedAt" = now() WHERE id = ${taskId}`;
    };
    const { fleetRouter } = await import("../../routers/fleetRouter");
    const c = fleetRouter.createCaller({ user: { id: U_ADMIN, role: "admin", name: "adm", twoFactorEnabled: true } } as any);
    const err = await c.assign({ taskId, deviceId: ids.robotB }).catch((e) => e);
    expect((err as { code?: string })?.code).toBe("CONFLICT");
    const row = await taskRow(taskId);
    expect(row.status).toBe("completed");
  });

  it("#8: assign bình thường (pending) vẫn đi như cũ", async () => {
    const taskId = await mkTask(`${RUN}_ASSIGN_OK`, "pending");
    const { fleetRouter } = await import("../../routers/fleetRouter");
    const c = fleetRouter.createCaller({ user: { id: U_ADMIN, role: "admin", name: "adm", twoFactorEnabled: true } } as any);
    const r = await c.assign({ taskId, deviceId: ids.robotB });
    expect(r.ok).toBe(true);
    const row = await taskRow(taskId);
    expect(row.status).toBe("assigned");
    expect(row.assignedDeviceId).toBe(ids.robotB);
  });
});
