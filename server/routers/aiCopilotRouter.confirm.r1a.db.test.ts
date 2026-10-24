/**
 * SCADA R1a Task 10 (K11 + K5) — `copilot.confirmAction` trên CSDL `_test` THẬT, tool máy THẬT (`set_machine_param`).
 *
 *   · sàn vai + xác thực theo mức cho tool ghi OT: mức = max(phanLoaiMuc(tool, tag), actuation_level của kênh đích), kênh NULL / không
 *     có ⇒ 5. Từ chối ⇒ appError (mã T8: SCADA_ROLE_FLOOR / SCADA_TOTP_REQUIRED …), hàng giữ `proposed`.
 *   · `kiemCongAi` ở `execute` dùng cùng mức kênh (đọc DB thật qua `mucKenhChoAi`): kênh 4 + tool 3 ⇒ MUC_QUA_CAO, dispatch 0 lần.
 *   · hàng `hmi.*` ⇒ confirmAction not_found, getAction null.
 *   · bản xem trước `set_machine_param`: `oldValue` lấy từ bộ đệm hiện tại (good + không cũ), không thì null + cảnh báo.
 *
 * Không chạm thiết bị: `dispatch` bọc đếm (trả kết quả giả); safety-PLC giả "OK"; `AI_OT_CONTROL_ENABLED` chỉ bật trong tiến trình.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

const RUN = `r1a10${process.pid}${Date.now().toString(36)}`;
const H = vi.hoisted(() => ({ dispatchCalls: 0 }));

vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return {
    ...real,
    dispatch: async () => {
      H.dispatchCalls += 1;
      return { ok: true, simulated: true, status: "simulated", reason: null, results: [], commandLogIds: [] };
    },
  };
});
vi.mock("../services/ot/aiControlGate.safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/aiControlGate.safety")>();
  return { ...real, preflightSafetyChoAi: async () => "OK" as const };
});

import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./aiCopilotRouter").aiCopilotRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let aiCopilotRouter: Router;
let actions: typeof import("../services/aiCopilotActions");
let registry: typeof import("../services/aiLocalTools/toolRegistry");
let boDem: typeof import("../services/scada/boDemHienTai");
let mid = 0;
let adapterId = 0;
const factories: string[] = [];
const actionIds: string[] = [];
const nguoi: Record<string, { id: number; role: string; name: string | null; caller: Caller }> = {};

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedTag(key: string, level: number | null) {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level)
    VALUES (${adapterId}, ${key}, ${"DB1." + key}, 'float', '°C', true, true,
      'input_output'::scada_channel_kind, ${"Kenh " + key}, 0, 300, 0.5, ${level})`);
}

async function seedNguoi(ten: string, role: "viewer" | "operator" | "engineer", twoFactorEnabled = false) {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1a10", ts: RUN, ten: `R1A10 ${ten}` });
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit", "canCreate") VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true)`,
  );
  nguoi[ten] = {
    id: u.id,
    role,
    name: u.name,
    caller: aiCopilotRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled }, sessionToken: `${RUN}-${ten}` } as never),
  };
}

type Loi = { code?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function deXuat(ten: string, tagKey: string, value = 120): Promise<string> {
  const tool = registry.getTool("set_machine_param")!;
  const u = nguoi[ten];
  const r = await actions.proposeAction(tool, { machineId: mid, tagKey, value }, { user: { id: u.id, role: u.role, name: u.name }, lang: "vi" });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  actionIds.push(r.pendingAction!.actionId);
  return r.pendingAction!.actionId;
}
async function trangThai(id: string) {
  return (await db.select({ s: aiPendingActions.status }).from(aiPendingActions).where(eq(aiPendingActions.id, id)))[0]?.s;
}

beforeAll(async () => {
  vi.stubEnv("OT_CONTROL_ENABLED", "false");
  vi.stubEnv("AI_OT_CONTROL_ENABLED", "false");
  vi.stubEnv("PARAM_GUARDRAIL_ENABLED", "false");
  vi.stubEnv("ADVICE_CONTRACT_ENABLED", "false");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ aiCopilotRouter } = await import("./aiCopilotRouter"));
  actions = await import("../services/aiCopilotActions");
  registry = await import("../services/aiLocalTools/toolRegistry");
  await import("../services/aiLocalTools/writeHandlers");
  boDem = await import("../services/scada/boDemHienTai");

  const code = RUN;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, 'May R1A10', 'AOI', true) RETURNING id`);
  factories.push(code);
  mid = Number(m.id);
  const [a] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid}, ${code + "-a"}, ${code + "-a"}, 'stub', ${"stub://" + code}, 60000, true, 'disabled') RETURNING id`);
  adapterId = Number(a.id);
  await seedTag("sp3", 3);
  await seedTag("sp4", 4);
  await seedTag("spnull", null);

  await seedNguoi("viewer", "viewer");
  await seedNguoi("op", "operator");
  await seedNguoi("eng", "engineer", true);
});

beforeEach(() => {
  H.dispatchCalls = 0;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  boDem?.__datLaiBoDemHienTai();
  if (!db) return;
  if (actionIds.length) await db.delete(aiPendingActions).where(inArray(aiPendingActions.id, actionIds));
  if (adapterId) {
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`);
    await dung(sql`DELETE FROM device_adapters WHERE id = ${adapterId}`);
  }
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code}`);
    await dung(sql`DELETE FROM stations WHERE code = ${code}`);
    await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
    await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
    await dung(sql`DELETE FROM factories WHERE code = ${code}`);
  }
});

describe("copilot.confirmAction — sàn vai + xác thực theo mức cho tool ghi OT", () => {
  it("viewer xác nhận set_machine_param trên kênh mức 3 ⇒ FORBIDDEN SCADA_ROLE_FLOOR {ma, level 3}; hàng giữ proposed", async () => {
    const id = await deXuat("viewer", "sp3");
    const loi = await loiCua(nguoi.viewer.caller.confirmAction({ actionId: id, token: id }));
    expect(loi).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", appParams: { ma: "ROLE_FLOOR", level: 3 } });
    expect(await trangThai(id)).toBe("proposed");
    expect(H.dispatchCalls).toBe(0);
  });

  it("kênh mức 4 nâng tool mức 3: operator ⇒ ROLE_FLOOR level 4; kênh NULL ⇒ level 5", async () => {
    const a = await deXuat("op", "sp4");
    expect(await loiCua(nguoi.op.caller.confirmAction({ actionId: a, token: a }))).toMatchObject({ appCode: "SCADA_ROLE_FLOOR", appParams: { level: 4 } });
    const b = await deXuat("op", "spnull");
    expect(await loiCua(nguoi.op.caller.confirmAction({ actionId: b, token: b }))).toMatchObject({ appCode: "SCADA_ROLE_FLOOR", appParams: { level: 5 } });
    expect(await trangThai(a)).toBe("proposed");
    expect(await trangThai(b)).toBe("proposed");
  });

  it("engineer (2FA) trên kênh mức 4: không mã ⇒ SCADA_TOTP_REQUIRED; mã sai ⇒ SCADA_TOTP_INVALID; hàng giữ proposed", async () => {
    const id = await deXuat("eng", "sp4");
    expect(await loiCua(nguoi.eng.caller.confirmAction({ actionId: id, token: id }))).toMatchObject({
      code: "PRECONDITION_FAILED",
      appCode: "SCADA_TOTP_REQUIRED",
      appParams: { ma: "TOTP_CAN", level: 4 },
    });
    expect(await loiCua(nguoi.eng.caller.confirmAction({ actionId: id, token: id, totpCode: "000000" }))).toMatchObject({
      code: "PRECONDITION_FAILED",
      appCode: "SCADA_TOTP_INVALID",
      appParams: { ma: "TOTP_SAI", level: 4 },
    });
    expect(await trangThai(id)).toBe("proposed");
  });

  it("totpCode phải đúng 6 ký tự (zod)", async () => {
    const id = await deXuat("eng", "sp4");
    expect((await loiCua(nguoi.eng.caller.confirmAction({ actionId: id, token: id, totpCode: "123" }))).code).toBe("BAD_REQUEST");
  });

  it("operator trên kênh mức 3 ⇒ qua sàn; execute tới cổng AI (cờ AI tắt ⇒ CO_TAT), dispatch 0 lần", async () => {
    const id = await deXuat("op", "sp3");
    const kq = await nguoi.op.caller.confirmAction({ actionId: id, token: id });
    expect(kq).toMatchObject({ ok: true, status: "bi_tu_choi_ghi" });
    expect((kq.result as { data?: { ma?: string; muc?: number } }).data).toMatchObject({ ma: "CO_TAT", muc: 3 });
    expect(H.dispatchCalls).toBe(0);
  });
});

describe("kiemCongAi ở execute — mức kênh đọc từ DB thật", () => {
  const ctx = () => ({ user: { id: nguoi.op.id, role: "operator", name: null }, lang: "vi" as const });
  it("AI_OT_CONTROL_ENABLED bật (trong tiến trình): kênh 4 + tool 3 ⇒ MUC_QUA_CAO, dispatch 0; kênh 3 ⇒ tới dispatch; tag không có ⇒ 5", async () => {
    vi.stubEnv("AI_OT_CONTROL_ENABLED", "true");
    try {
      const tool = registry.getTool("set_machine_param")!;
      const r4 = (await tool.execute!({ machineId: mid, tagKey: "sp4", value: 1 }, ctx())) as { data: { ma: string; muc: number } };
      expect(r4.data).toMatchObject({ ma: "MUC_QUA_CAO", muc: 4 });
      const rKhong = (await tool.execute!({ machineId: mid, tagKey: "khong_co_tag", value: 1 }, ctx())) as { data: { ma: string; muc: number } };
      expect(rKhong.data).toMatchObject({ ma: "MUC_QUA_CAO", muc: 5 });
      expect(H.dispatchCalls).toBe(0);
      await tool.execute!({ machineId: mid, tagKey: "sp3", value: 1 }, ctx());
      expect(H.dispatchCalls).toBe(1);
    } finally {
      vi.stubEnv("AI_OT_CONTROL_ENABLED", "false");
    }
  });
});

describe("hàng hmi.* qua copilot router", () => {
  it("confirmAction ⇒ not_found (không ném, không đổi trạng thái); getAction ⇒ null", async () => {
    const id = crypto.randomUUID();
    actionIds.push(id);
    await db.insert(aiPendingActions).values({
      id,
      tool: "hmi.write_tag",
      argsJson: { adapterId, tagKey: "sp3", value: 1 },
      userId: nguoi.eng.id,
      userRole: "engineer",
      summary: `${RUN} hmi`,
      status: "proposed",
      idempotencyKey: `${RUN}:${id}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await nguoi.eng.caller.confirmAction({ actionId: id, token: id, totpCode: "123456" })).toMatchObject({ ok: false, status: "not_found" });
    expect(await trangThai(id)).toBe("proposed");
    expect(await nguoi.eng.caller.getAction({ actionId: id })).toBeNull();
  });
});

describe("bản xem trước set_machine_param — oldValue từ bộ đệm hiện tại", () => {
  const ctx = () => ({ user: { id: nguoi.op.id, role: "operator", name: null }, lang: "vi" as const });
  const xemTruoc = async (tagKey: string) => registry.getTool("set_machine_param")!.preview!({ machineId: mid, tagKey, value: 150 }, ctx());
  const mau = (tagKey: string, value: number, quality: "good" | "bad", ts: Date) => ({ tagKey, raw: value, value, quality, timestamp: ts });

  it("bộ đệm bật + mẫu good còn tươi ⇒ oldValue = giá trị đọc được, không cảnh báo bộ đệm", async () => {
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    try {
      boDem.datThongTinAdapter(adapterId, { pollMs: 60_000, coDeadband: false, machineId: mid, code: `${RUN}-a` });
      boDem.napTuOt({ adapterId, machineId: mid }, [mau("sp3", 182.5, "good", new Date())]);
      const p = await xemTruoc("sp3");
      expect(p.changes[0]).toMatchObject({ field: "sp3", oldValue: 182.5, newValue: "150" });
      expect(p.warnings.join("\n")).not.toMatch(/bộ đệm/i);
    } finally {
      vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
      boDem.__datLaiBoDemHienTai();
    }
  });

  it("chất lượng bad / mẫu cũ / chưa có mẫu / bộ đệm tắt ⇒ oldValue null + cảnh báo, không ném", async () => {
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    try {
      boDem.datThongTinAdapter(adapterId, { pollMs: 1000, coDeadband: false, machineId: mid, code: `${RUN}-a` });
      const cu = Date.now() - 60_000;
      boDem.napTuOt({ adapterId, machineId: mid }, [mau("sp4", 77, "good", new Date(cu))], cu); // rx cũ 60 s > 3 × 1 s ⇒ stale
      boDem.napTuOt({ adapterId, machineId: mid }, [mau("sp3", 90, "bad", new Date())]);
      for (const tag of ["sp3", "sp4", "spnull"]) {
        const p = await xemTruoc(tag);
        expect(p.changes[0].oldValue, tag).toBeNull();
        expect(p.warnings.join("\n"), tag).toMatch(/bộ đệm/i);
      }
    } finally {
      vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
      boDem.__datLaiBoDemHienTai();
    }
    const tat = await xemTruoc("sp3");
    expect(tat.changes[0].oldValue).toBeNull();
    expect(tat.warnings.join("\n")).toMatch(/bộ đệm/i);
  });
});
