/**
 * doc 81 Đợt 1B Task 3 — `simTargets` KHÔNG còn là đường vòng URScript (BE2 §L3b, §3 S2).
 *
 * Lỗ đo được: `validateUrscript`/`ursimPing` nhận `host`/cổng do người gọi điền
 * (`simTargetsRouter.ts:39-49` cũ) ⇒ trỏ vào IP một UR thật là `power on` + `brake release` +
 * script tuỳ ý, không qua dispatcher/interlock/commissioning/HITL. `ursimPing` chỉ cần quyền
 * XEM và không gác cờ.
 *
 * Khẳng định:
 *   • host/cổng tuỳ ý trong input ⇒ Zod từ chối (BAD_REQUEST), KHÔNG một byte nào ra mạng;
 *   • targetId không tồn tại ⇒ PRECONDITION_FAILED;
 *   • URSIM_HOST trùng host robot/adapter thật trong CSDL ⇒ PRECONDITION_FAILED, không gửi gì;
 *   • `ursimPing` khi URSIM_ENABLED tắt ⇒ bị từ chối; quyền = machine_control/canCreate
 *     (giống validateUrscript), quyền XEM không đủ;
 *   • đường hợp lệ (targetId "default" → bộ điều khiển UR giả 127.0.0.1 cổng 0) vẫn chạy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Root middleware (server/_core/trpc.ts) đọc `phaiDoiMatKhau` từ ../db.
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  phaiDoiMatKhau: vi.fn(async () => false),
  createAuditLog: vi.fn(async () => undefined),
}));

// CSDL giả CHỈ cho truy vấn đọc-chỉ của sổ đích giả lập.
const dbRows = vi.hoisted(() => ({ robots: [] as any[], adapters: [] as any[], unavailable: false }));
vi.mock("../db/connection", async () => {
  const schema = await import("../../drizzle/schema");
  return {
    getDb: async () =>
      dbRows.unavailable
        ? null
        : {
            select: () => ({
              from: (t: unknown) =>
                Promise.resolve(t === schema.robots ? dbRows.robots : t === schema.deviceAdapters ? dbRows.adapters : []),
            }),
          },
  };
});

// DNS giả (fix round 1, R9): CHỈ một tên sim được phân giải, về 127.0.0.1; tên khác ⇒ ENOTFOUND.
// `net.connect` dùng `node:dns` (callback) — KHÔNG bị mock này chạm tới ⇒ nếu harness còn nối bằng
// TÊN ".invalid" thay vì IP đã kiểm, kết nối sẽ hỏng (RFC 6761: .invalid không bao giờ phân giải).
const dnsCalls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) => {
    dnsCalls.list.push(host);
    if (host === "ursim-sim.example.invalid") return [{ address: "127.0.0.1", family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  };
  return { lookup, default: { lookup } };
});

// RBAC: cấp theo cặp module/action để chứng minh ursimPing đòi machine_control/canCreate.
const granted = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("../_core/accessControl", () => ({
  requirePermission: (module: string, action: string) =>
    async ({ ctx, next }: any) => {
      if (!granted.set.has(`${module}/${action}`)) {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: `no ${module}/${action}` });
      }
      return next({ ctx });
    },
}));

import { simTargetsRouter } from "./simTargetsRouter";
import { FakeUrController } from "../services/robot/ursim/__fakeUrController";

const caller = simTargetsRouter.createCaller({ user: { id: 9, role: "engineer", name: "Eng" } } as any);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`bounded timeout ${ms}ms`)), ms).unref?.()),
  ]);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await withTimeout(p, 8000);
  } catch (e) {
    if (e instanceof TRPCError) return e.code;
    throw e;
  }
  return "RESOLVED";
}

const GOOD = "def prog():\n  set_standard_digital_out(1, True)\n  sleep(0.5)\nend";

const fakes: FakeUrController[] = [];
async function fakeAsDefaultTarget(): Promise<FakeUrController> {
  const f = new FakeUrController();
  await f.start();
  fakes.push(f);
  process.env.URSIM_HOST = "127.0.0.1";
  process.env.URSIM_PRIMARY_PORT = String(f.primaryPort);
  process.env.URSIM_DASHBOARD_PORT = String(f.dashboardPort);
  process.env.URSIM_TIMEOUT_MS = "2000";
  return f;
}

beforeEach(() => {
  granted.set = new Set(["machine_monitoring/canView", "machine_control/canCreate"]);
  dbRows.robots = [];
  dbRows.adapters = [];
  dbRows.unavailable = false;
  for (const k of ["URSIM_HOST", "URSIM_PRIMARY_PORT", "URSIM_DASHBOARD_PORT", "URSIM_TIMEOUT_MS"]) delete process.env[k];
  process.env.URSIM_ENABLED = "true";
});
afterEach(async () => {
  while (fakes.length) await fakes.pop()!.close();
  for (const k of ["URSIM_ENABLED", "URSIM_HOST", "URSIM_PRIMARY_PORT", "URSIM_DASHBOARD_PORT", "URSIM_TIMEOUT_MS"]) delete process.env[k];
});

describe("validateUrscript — không nhận host/cổng tuỳ ý", () => {
  it("input mang endpoint/host tuỳ ý ⇒ Zod từ chối (BAD_REQUEST), bộ điều khiển không nhận lệnh nào", async () => {
    const fake = await fakeAsDefaultTarget();
    const bad = { targetId: "default", urscript: GOOD, endpoint: { host: "127.0.0.1", dashboardPort: fake.dashboardPort, scriptPort: fake.primaryPort } };
    expect(await codeOf(caller.validateUrscript(bad as any))).toBe("BAD_REQUEST");
    const bad2 = { targetId: "default", urscript: GOOD, host: "192.0.2.10" };
    expect(await codeOf(caller.validateUrscript(bad2 as any))).toBe("BAD_REQUEST");
    // Kiểu cũ (không targetId, chỉ endpoint) cũng bị từ chối.
    const legacy = { urscript: GOOD, endpoint: { host: "192.0.2.10" } };
    expect(await codeOf(caller.validateUrscript(legacy as any))).toBe("BAD_REQUEST");
    expect(fake.dashboardLog).toEqual([]);
  });

  it("targetId không tồn tại ⇒ PRECONDITION_FAILED", async () => {
    const fake = await fakeAsDefaultTarget();
    expect(await codeOf(caller.validateUrscript({ targetId: "ur-cell-3", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
    expect(fake.dashboardLog).toEqual([]);
  });

  it("máy chủ chưa cấu hình URSIM_HOST ⇒ PRECONDITION_FAILED", async () => {
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
  });

  it("URSIM_HOST trùng host một ROBOT thật ⇒ PRECONDITION_FAILED, không power on/brake release", async () => {
    const fake = await fakeAsDefaultTarget();
    dbRows.robots = [{ endpoint: "127.0.0.1:30002", connectionOptions: null }];
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
    expect(fake.dashboardLog).toEqual([]);
    expect(fake.programs).toEqual([]);
  });

  it("URSIM_HOST trùng host dự phòng HA của một ADAPTER thiết bị ⇒ PRECONDITION_FAILED", async () => {
    const fake = await fakeAsDefaultTarget();
    dbRows.adapters = [{ endpoint: "opc.tcp://192.0.2.99:4840", connectionOptions: { ha: { secondaryEndpoint: "tcp://127.0.0.1:502" } } }];
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
    expect(fake.dashboardLog).toEqual([]);
  });

  it("CSDL không sẵn sàng ⇒ PRECONDITION_FAILED (fail-closed, không gửi gì)", async () => {
    const fake = await fakeAsDefaultTarget();
    dbRows.unavailable = true;
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
    expect(fake.dashboardLog).toEqual([]);
  });

  it("cờ URSIM_ENABLED tắt ⇒ bị từ chối (CONFLICT FEATURE_DISABLED) như trước", async () => {
    await fakeAsDefaultTarget();
    delete process.env.URSIM_ENABLED;
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("CONFLICT");
  });

  it("đường HỢP LỆ: targetId 'default' → bộ điều khiển UR giả, script chạy thật ⇒ accepted", async () => {
    const fake = await fakeAsDefaultTarget();
    dbRows.robots = [{ endpoint: "192.0.2.40:30002", connectionOptions: null }];
    const r = await withTimeout(caller.validateUrscript({ targetId: "default", urscript: GOOD }), 10000);
    expect(r.sent).toBe(true);
    expect(r.running).toBe(true);
    expect(r.accepted).toBe(true);
    expect(fake.dashboardLog.slice(0, 2)).toEqual(["power on", "brake release"]);
    expect(fake.programs.length).toBe(1);
  });
});

describe("fix round 1 (R9) — KIỂM = DÙNG: harness nối tới IP đã phân giải, không phải tên", () => {
  it("URSIM_HOST là TÊN (chỉ mock DNS phân giải được) ⇒ validateUrscript chạy trên 127.0.0.1, tên được phân giải đúng MỘT lần", async () => {
    const fake = await fakeAsDefaultTarget();
    process.env.URSIM_HOST = "ursim-sim.example.invalid";
    dnsCalls.list = [];
    const r = await withTimeout(caller.validateUrscript({ targetId: "default", urscript: GOOD }), 10000);
    expect(r.error).toBeUndefined();
    expect(r.sent).toBe(true);
    expect(r.accepted).toBe(true);
    expect(fake.programs.length).toBe(1);
    expect(dnsCalls.list.filter((h) => h === "ursim-sim.example.invalid")).toHaveLength(1);
  });

  it("URSIM_HOST không phân giải được ⇒ PRECONDITION_FAILED, không lệnh nào tới bộ điều khiển", async () => {
    const fake = await fakeAsDefaultTarget();
    process.env.URSIM_HOST = "no-such-ursim.example.invalid";
    expect(await codeOf(caller.validateUrscript({ targetId: "default", urscript: GOOD }))).toBe("PRECONDITION_FAILED");
    expect(fake.dashboardLog).toEqual([]);
  });
});

describe("ursimPing — gác cờ + quyền giống validateUrscript, không host tuỳ ý", () => {
  it("cờ URSIM_ENABLED tắt ⇒ bị từ chối, không mở socket", async () => {
    const fake = await fakeAsDefaultTarget();
    delete process.env.URSIM_ENABLED;
    expect(await codeOf(caller.ursimPing({ targetId: "default" }))).toBe("CONFLICT");
    expect(fake.dashboardLog).toEqual([]);
  });

  it("chỉ có quyền XEM (machine_monitoring/canView) ⇒ FORBIDDEN", async () => {
    await fakeAsDefaultTarget();
    granted.set = new Set(["machine_monitoring/canView"]);
    expect(await codeOf(caller.ursimPing({ targetId: "default" }))).toBe("FORBIDDEN");
  });

  it("host/endpoint tuỳ ý ⇒ Zod từ chối", async () => {
    await fakeAsDefaultTarget();
    expect(await codeOf(caller.ursimPing({ targetId: "default", endpoint: { host: "192.0.2.10" } } as any))).toBe("BAD_REQUEST");
    expect(await codeOf(caller.ursimPing({ endpoint: { host: "192.0.2.10" } } as any))).toBe("BAD_REQUEST");
  });

  it("targetId không tồn tại ⇒ PRECONDITION_FAILED", async () => {
    await fakeAsDefaultTarget();
    expect(await codeOf(caller.ursimPing({ targetId: "nope" }))).toBe("PRECONDITION_FAILED");
  });

  it("URSIM_HOST trùng robot thật ⇒ PRECONDITION_FAILED", async () => {
    await fakeAsDefaultTarget();
    dbRows.robots = [{ endpoint: "tcp://127.0.0.1:29999", connectionOptions: null }];
    expect(await codeOf(caller.ursimPing({ targetId: "default" }))).toBe("PRECONDITION_FAILED");
  });

  it("đường hợp lệ: đích 'default' trả reachable:true", async () => {
    await fakeAsDefaultTarget();
    const r = await withTimeout(caller.ursimPing({ targetId: "default" }), 8000);
    expect(r.reachable).toBe(true);
  });
});
