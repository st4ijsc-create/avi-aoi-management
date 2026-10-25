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
const H = vi.hoisted(() => ({ dispatchCalls: 0, soKiemXacThuc: 0 }));

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
// Fix round 1 (c2) — helper xác thực THẬT, chỉ bọc đếm: mức ≥ 4 không được chạm tới nó (không hỏi / không tiêu TOTP).
vi.mock("../_core/xacThucTheoMuc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/xacThucTheoMuc")>();
  return {
    ...real,
    kiemXacThucTheoMuc: async (...a: Parameters<typeof real.kiemXacThucTheoMuc>) => {
      H.soKiemXacThuc += 1;
      return real.kiemXacThucTheoMuc(...a);
    },
  };
});
vi.mock("../services/ot/aiControlGate.safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/aiControlGate.safety")>();
  return { ...real, preflightSafetyChoAi: async () => "OK" as const };
});

import { getDb } from "../db/connection";
import { aiPendingActions, deviceTags } from "../../drizzle/schema";
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
let mid2 = 0;
let adapterId2 = 0;
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
/** Fix round 1 (c1) — tag lệnh bool, actuation_level CHƯA KHAI (NULL ⇒ 5); `stopValue` khác null ⇒ tag DỪNG ghim. */
/**
 * kiem-dinh R1b-1 I-A (fix round 2, 2026-10-25) — FIXTURE: tag CÓ ghim khai `actuationLevel = 1` (dừng ghim chỉ tính ghim đủ điều kiện STOP, cùng luật
 * STOP HMI); `muc` ghi đè (null = chưa khai ⇒ 5 ⇒ không phải dừng ghim).
 */
async function seedTagDung(adId: number, key: string, stopValue: boolean | null, muc?: number | null) {
  const actuationLevel = muc !== undefined ? muc : stopValue === null ? null : 1;
  await db.insert(deviceTags).values({ adapterId: adId, tagKey: key, address: `M.${key}`, dataType: "bool", writable: true, isEnabled: true, stopValue, actuationLevel });
}
async function soTotpConsumed(userId: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM totp_consumed WHERE "userId" = ${userId}`);
  return Number(r.n);
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
  return deXuatTool(ten, "set_machine_param", { machineId: mid, tagKey, value });
}
async function deXuatTool(ten: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const tool = registry.getTool(toolName)!;
  const u = nguoi[ten];
  const r = await actions.proposeAction(tool, args, { user: { id: u.id, role: u.role, name: u.name }, lang: "vi" });
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
  // c1 — tag DỪNG ghim trên kênh chưa khai mức (machine_stop của máy 1 ghi đúng ghim này).
  await seedTagDung(adapterId, "dung_ghim", true);
  // c1 — máy 2: không ghim ⇒ machine_stop ghi cmd_stop=true (kênh chưa khai = 5).
  const [m2] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code + "b"}, 'May R1A10 B', 'AOI', true) RETURNING id`);
  mid2 = Number(m2.id);
  const [a2] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${mid2}, ${code + "-b"}, ${code + "-b"}, 'stub', ${"stub://" + code + "b"}, 60000, true, 'disabled') RETURNING id`);
  adapterId2 = Number(a2.id);
  await seedTagDung(adapterId2, "cmd_stop", null);

  await seedNguoi("viewer", "viewer");
  await seedNguoi("op", "operator");
  await seedNguoi("eng", "engineer", true);
});

beforeEach(() => {
  H.dispatchCalls = 0;
  H.soKiemXacThuc = 0;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  boDem?.__datLaiBoDemHienTai();
  if (!db) return;
  if (actionIds.length) await db.delete(aiPendingActions).where(inArray(aiPendingActions.id, actionIds));
  for (const id of [adapterId, adapterId2]) {
    if (!id) continue;
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`);
    await dung(sql`DELETE FROM device_adapters WHERE id = ${id}`);
  }
  for (const code of factories) {
    await dung(sql`DELETE FROM machines WHERE code = ${code + "b"}`);
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

  it("c2 — kênh mức 4 nâng tool mức 3 ⇒ MUC_QUA_CAO ngay lúc confirm (operator; engineer 2FA + mã): không kiểm/tiêu TOTP, sổ totp_consumed không đổi, hàng không đổi; kênh NULL ⇒ level 5", async () => {
    const a = await deXuat("op", "sp4");
    // R1b-1 T10 — MUC_QUA_CAO là appError có khoá i18n (vi/en/zh), cùng khuôn các từ chối sàn vai / TOTP.
    expect(await loiCua(nguoi.op.caller.confirmAction({ actionId: a, token: a }))).toMatchObject({ code: "FORBIDDEN", appCode: "SCADA_AI_LEVEL_TOO_HIGH", appParams: { ma: "MUC_QUA_CAO", level: 4 } });
    const b = await deXuat("op", "spnull");
    expect(await loiCua(nguoi.op.caller.confirmAction({ actionId: b, token: b }))).toMatchObject({ appCode: "SCADA_AI_LEVEL_TOO_HIGH", appParams: { ma: "MUC_QUA_CAO", level: 5 } });
    const c = await deXuat("eng", "sp4");
    const truoc = await soTotpConsumed(nguoi.eng.id);
    const kq = await loiCua(nguoi.eng.caller.confirmAction({ actionId: c, token: c, totpCode: "123456" }));
    expect(kq).toMatchObject({ appCode: "SCADA_AI_LEVEL_TOO_HIGH", appParams: { ma: "MUC_QUA_CAO", level: 4 } });
    expect(H.soKiemXacThuc, "kiemXacThucTheoMuc không được gọi").toBe(0);
    expect(await soTotpConsumed(nguoi.eng.id), "không tiêu mã").toBe(truoc);
    for (const id of [a, b, c]) expect(await trangThai(id)).toBe("proposed");
    expect(H.dispatchCalls).toBe(0);
  });

  it("totpCode phải đúng 6 ký tự (zod)", async () => {
    const id = await deXuat("eng", "sp3");
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

  it("c1 — machine_stop, kênh khai mức 1 (kiem-dinh I-A: ghim chỉ tính khi tag mức ≤ 1; trước đây kênh chưa khai), ghi đúng stop_value ghim ⇒ qua cổng mức ở confirm (mức 1, không 2FA) VÀ ở execute ⇒ dispatch", async () => {
    vi.stubEnv("AI_OT_CONTROL_ENABLED", "true");
    try {
      const id = await deXuatTool("op", "machine_stop", { machineId: mid });
      const kq = await nguoi.op.caller.confirmAction({ actionId: id, token: id });
      expect(kq, JSON.stringify(kq)).toMatchObject({ ok: true, status: "executed" });
      expect(H.dispatchCalls).toBe(1);
      expect(H.soKiemXacThuc).toBe(1); // mức 1 ⇒ sàn vai, không TOTP
    } finally {
      vi.stubEnv("AI_OT_CONTROL_ENABLED", "false");
    }
  });

  it("c1 — cùng tool, KHÔNG phải dừng ghim (máy không ghim ⇒ cmd_stop=true trên kênh chưa khai) ⇒ mức 5 ⇒ MUC_QUA_CAO ở confirm và ở execute", async () => {
    vi.stubEnv("AI_OT_CONTROL_ENABLED", "true");
    try {
      const id = await deXuatTool("op", "machine_stop", { machineId: mid2 });
      expect(await loiCua(nguoi.op.caller.confirmAction({ actionId: id, token: id }))).toMatchObject({ appCode: "SCADA_AI_LEVEL_TOO_HIGH", appParams: { ma: "MUC_QUA_CAO", level: 5 } });
      expect(await trangThai(id)).toBe("proposed");
      const r = (await registry.getTool("machine_stop")!.execute!({ machineId: mid2 }, ctx())) as { data: { ma: string; muc: number } };
      expect(r.data).toMatchObject({ ma: "MUC_QUA_CAO", muc: 5 });
      expect(H.dispatchCalls).toBe(0);
    } finally {
      vi.stubEnv("AI_OT_CONTROL_ENABLED", "false");
    }
  });

  it("c1 — mucKenhChoAi: chỉ CẢ-lệnh dừng khớp ghim mới là dừng ghim (sai giá trị / trộn write khác / lệnh không phải dừng ⇒ mức kênh)", async () => {
    const { mucKenhChoAi } = await import("../services/ot/aiControlGate.safety");
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: true }], "stop")).toEqual({ dungGhim: true });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: 1 }], "e_stop")).toEqual({ dungGhim: true });
    // kiem-dinh I-A (fix round 2): tag dung_ghim nay khai mức 1 (điều kiện để là dừng ghim) ⇒ nhánh "không phải dừng ghim" trả mức THẬT của kênh (1; trộn sp3 ⇒ 3) thay vì 5 của kênh chưa khai.
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: false }], "stop")).toEqual({ dungGhim: false, muc: 1 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: true }, { tagKey: "sp3", value: 1 }], "stop")).toEqual({ dungGhim: false, muc: 3 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: true }], "start")).toEqual({ dungGhim: false, muc: 1 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "dung_ghim", value: true }])).toEqual({ dungGhim: false, muc: 1 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "sp3", value: 1 }], "set_param")).toEqual({ dungGhim: false, muc: 3 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "khong_co", value: 1 }], "stop")).toEqual({ dungGhim: false, muc: 5 });
  });

  it("★ kiem-dinh I-A — ghim trên tag CHƯA khai mức / mức 4 KHÔNG phải dừng ghim (cùng luật STOP HMI) ⇒ mức kênh (5 / 4); machine_stop chỉ có ghim như vậy ⇒ từ chối, 0 dispatch", async () => {
    const { mucKenhChoAi } = await import("../services/ot/aiControlGate.safety");
    await seedTagDung(adapterId, "ghim_cu_null", true, null);
    await seedTagDung(adapterId, "ghim_cu_m4", true, 4);
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "ghim_cu_null", value: true }], "stop")).toEqual({ dungGhim: false, muc: 5 });
    expect(await mucKenhChoAi(adapterId, [{ tagKey: "ghim_cu_m4", value: true }], "stop")).toEqual({ dungGhim: false, muc: 4 });
    // máy thứ hai: chỉ ghim cũ trên tag chưa khai mức ⇒ tool từ chối (không rơi về cmd_stop)
    await dung(sql`UPDATE device_tags SET stop_value = 'true'::jsonb WHERE "adapterId" = ${adapterId2} AND "tagKey" = 'cmd_stop'`);
    vi.stubEnv("AI_OT_CONTROL_ENABLED", "true");
    try {
      await expect(registry.getTool("machine_stop")!.execute!({ machineId: mid2 }, ctx())).rejects.toThrow(/actuation level > 1|mức tác động > 1/);
      expect(H.dispatchCalls).toBe(0);
    } finally {
      vi.stubEnv("AI_OT_CONTROL_ENABLED", "false");
      await dung(sql`UPDATE device_tags SET stop_value = NULL WHERE "adapterId" = ${adapterId2} AND "tagKey" = 'cmd_stop'`);
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId} AND "tagKey" IN ('ghim_cu_null', 'ghim_cu_m4')`);
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

// W11c: cổng phạm vi tool GHI có test riêng (aiLocalTools/phamViGhi*.test.ts); ở đây user giả / CSDL giả ⇒ cho qua để test đúng điều nó kiểm.
vi.mock("../services/aiLocalTools/phamViGhi", () => ({ kiemPhamViGhiTool: async () => ({ ok: true }) }));
