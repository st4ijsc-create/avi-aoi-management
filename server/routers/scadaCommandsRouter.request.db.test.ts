/**
 * SCADA R1a Task 8 — `scadaCommands.request` (K1, K5) trên CSDL `_test` THẬT.
 *
 * Phạm vi do `idsTrongPhamVi` THẬT đọc `user_factory_assignments`; quyền do `checkPermission` THẬT đọc `permissions`; người dùng qua
 * `taoNguoiDungTest`. Chế độ máy do `cheDoMay` THẬT (kênh `scada_kenh_che_do` + bộ đệm THẬT nuôi bằng `datThongTinAdapter`/`napTuOt`).
 * Khoá chọn do `giuKhoaChon` THẬT (chỉ bọc để ép ném một lần ở ca KHOA_CHON_LOI). Socket: `getIO` giả ghi lại mọi `to(room).emit`.
 *
 * Mỗi mã từ chối một ca; mỗi ca khẳng định ĐÚNG MỘT dòng `scada_command_attempts` mới của người gọi, đúng `reason_code`.
 * `scada_command_attempts` là WORM: các dòng của tệp này ở lại (đúng thiết kế).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r1a8${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  emits: [] as Array<{ room: string; ev: string; payload: Record<string, unknown> }>,
  khoaNem: 0,
}));

vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return {
    ...real,
    getIO: () =>
      ({
        to: (room: string) => ({
          emit: (ev: string, payload: Record<string, unknown>) => {
            H.emits.push({ room, ev, payload });
            return true;
          },
        }),
      }) as never,
  };
});

vi.mock("../services/scada/khoaChon", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/khoaChon")>();
  return {
    ...real,
    giuKhoaChon: async (...a: Parameters<typeof real.giuKhoaChon>) => {
      if (H.khoaNem > 0) {
        H.khoaNem -= 1;
        // cùng lớp + message như lần ném thật của giuKhoaChon sau 3 lượt
        throw new real.LoiKhoaChonTranhChap("khoaChon: khong chot duoc khoa sau 3 lan - hang bien doi lien tuc");
      }
      return real.giuKhoaChon(...a);
    },
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { otPayloadHash } from "../services/ot/otActionBinding";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaCommandsRouter").scadaCommandsRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaCommandsRouter: Router;
let boDem: typeof import("../services/scada/boDemHienTai");

interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, e: 0, n: 0 };
const ma = { a: `${RUN}-a`, b: `${RUN}-b`, e: `${RUN}-e`, n: `${RUN}-n` };
let edgeNodeId = 0;
const factories: string[] = [];
const userIds: number[] = [];

const nguoi: Record<string, { id: number; caller: Caller }> = {};

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${"May " + ten.toUpperCase()}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code };
}

async function seedAdapter(code: string, machineId: number | null): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 60000, true, 'disabled') RETURNING id`);
  return Number(r.id);
}

interface TagSeed {
  key: string;
  dataType: "float" | "int" | "bool";
  kind?: "input" | "input_output" | "output" | null;
  writable?: boolean;
  enabled?: boolean;
  level?: 1 | 3 | 4 | 5 | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
}
async function seedTag(adapterId: number, t: TagSeed): Promise<void> {
  await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", unit, writable, "isEnabled",
      channel_kind, display_name, write_min, write_max, write_step, actuation_level)
    VALUES (${adapterId}, ${t.key}, ${"addr-" + t.key}, ${t.dataType}, ${"°C"}, ${t.writable ?? true}, ${t.enabled ?? true},
      ${t.kind === undefined ? "input_output" : t.kind}::scada_channel_kind, ${"Kenh " + t.key}, ${t.min ?? null}, ${t.max ?? null},
      ${t.step ?? null}, ${t.level === undefined ? 3 : t.level})`);
}

async function seedNguoi(
  ten: string,
  role: "viewer" | "operator" | "engineer" | "admin",
  factoryCodes: string[],
  quyenDieuKhien: boolean,
  twoFactorEnabled = true,
): Promise<void> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1a8", ts: RUN, ten: `R1A8 ${ten}` });
  userIds.push(u.id);
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin" && quyenDieuKhien) {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`,
    );
  }
  nguoi[ten] = {
    id: u.id,
    caller: scadaCommandsRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled } } as never),
  };
}

type Loi = { code?: string; message?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function moc(): Promise<number> {
  const [r] = await dung(sql`SELECT COALESCE(max(id), 0)::bigint AS m FROM scada_command_attempts`);
  return Number(r.m);
}
type DongThu = {
  request_id: string | null;
  user_id: number;
  adapter_id: number | null;
  tag_key: string | null;
  requested_value: unknown;
  after_formula: unknown;
  stage: string;
  outcome: string;
  reason_code: string | null;
};
async function dongThuSau(m: number, userId: number): Promise<DongThu[]> {
  return (await dung(sql`SELECT request_id, user_id, adapter_id, tag_key, requested_value, after_formula, stage, outcome, reason_code
    FROM scada_command_attempts WHERE id > ${m} AND user_id = ${userId} ORDER BY id`)) as DongThu[];
}
async function soDongCho(userId: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE "userId" = ${userId} AND tool = 'hmi.write_tag'`);
  return Number(r.n);
}

const uuid = () => crypto.randomUUID();
const LY_DO = "chinh nhiet theo phieu";

function mauOt(tagKey: string, value: number) {
  return { tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() };
}

/** Một yêu cầu bị từ chối: đúng mã tRPC + appCode + ĐÚNG MỘT dòng attempts {request, rejected, reason}. */
async function tuChoi(
  ten: string,
  input: { adapterId: number; tagKey: string; value: unknown; lyDo?: string; clientRequestId?: string },
  mong: { code: string; appCode: string; reason: string },
): Promise<{ loi: Loi; dong: DongThu }> {
  const u = nguoi[ten];
  const m = await moc();
  const truocCho = await soDongCho(u.id);
  const loi = await loiCua(
    u.caller.request({ lyDo: LY_DO, clientRequestId: uuid(), ...input } as never),
  );
  expect(loi.code, JSON.stringify(loi)).toBe(mong.code);
  expect(loi.appCode).toBe(mong.appCode);
  const dong = await dongThuSau(m, u.id);
  expect(dong, "đúng MỘT dòng attempts").toHaveLength(1);
  expect(dong[0]).toMatchObject({ stage: "request", outcome: "rejected", reason_code: mong.reason });
  expect(await soDongCho(u.id), "không tạo dòng chờ").toBe(truocCho);
  return { loi, dong: dong[0] };
}

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "false");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "true");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaCommandsRouter } = await import("./scadaCommandsRouter"));
  boDem = await import("../services/scada/boDemHienTai");

  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(ma.a, A.mid);
  ad.b = await seedAdapter(ma.b, B.mid);
  ad.e = await seedAdapter(ma.e, A.mid);
  ad.n = await seedAdapter(ma.n, null);
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r1a8 edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.e}`);

  const sp = { dataType: "float" as const, min: 0, max: 300, step: 0.5 };
  await seedTag(ad.a, { key: "che_do", dataType: "int", kind: "input", writable: false, level: null });
  for (const key of ["sp3", "khoa", "nem", "lap", "dua", "rf4"]) await seedTag(ad.a, { key, ...sp, level: 3 });
  await seedTag(ad.a, { key: "sp4", ...sp, level: 4 });
  await seedTag(ad.a, { key: "doc", dataType: "float", kind: "input", writable: false, level: null });
  await seedTag(ad.a, { key: "tat", ...sp, enabled: false });
  // kiem-dinh P1-3 — int scale 10: một kênh ĐÃ khai (dải 0..300) và một kênh CHƯA khai (mọi cột 0431 NULL) — đường HMI kiểm CẢ HAI
  await seedTag(ad.a, { key: "sc10", dataType: "int", min: 0, max: 300, level: 3 });
  await seedTag(ad.a, { key: "sc10cu", dataType: "int", kind: null, level: 3 });
  await dung(sql`UPDATE device_tags SET scale = 10, "offset" = 0 WHERE "adapterId" = ${ad.a} AND "tagKey" IN ('sc10', 'sc10cu')`);
  // R1b-2a T2 (m5) — int scale 0.5 CHƯA khai (giá trị kỹ thuật 2.5 = thô 5) + int scale 1 CHƯA khai (đối chứng)
  await seedTag(ad.a, { key: "sc05cu", dataType: "int", kind: null, level: 3 });
  await seedTag(ad.a, { key: "sc1cu", dataType: "int", kind: null, level: 3 });
  await dung(sql`UPDATE device_tags SET scale = 0.5, "offset" = 0 WHERE "adapterId" = ${ad.a} AND "tagKey" = 'sc05cu'`);
  await seedTag(ad.b, { key: "sp3", ...sp, level: 3 });
  await seedTag(ad.e, { key: "sp3", ...sp, level: 3 });
  await seedTag(ad.n, { key: "sp3", ...sp, level: 3 });

  // K2: kênh chế độ của máy A = adapter a / "che_do", REMOTE khi giá trị 2.
  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
    VALUES (${A.mid}, ${ad.a}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(ad.a, { pollMs: 60_000, coDeadband: false, machineId: A.mid, code: ma.a });
  boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2), mauOt("sp3", 200)]);

  await seedNguoi("opA", "operator", [A.code], true);
  await seedNguoi("opA2", "operator", [A.code], true);
  await seedNguoi("opKhongQuyen", "operator", [A.code], false);
  await seedNguoi("viewerA", "viewer", [A.code], true);
  await seedNguoi("engA", "engineer", [A.code], true);
  await seedNguoi("engKhong2fa", "engineer", [A.code], true, false);
  await seedNguoi("opB", "operator", [B.code], true);
  await seedNguoi("admin", "admin", [], false);
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    boDem?.xoaAdapter(ad.a);
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    const ids = [...Object.values(ad).filter(Boolean), -1];
    const inIds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool = 'hmi.write_tag'`);
    await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id IN (${inIds})`);
    if (A?.mid) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${inIds})`);
    if (ad.e) await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.e}`);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${inIds})`);
    if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
    for (const code of factories) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
      await dung(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung(sql`DELETE FROM factories WHERE code = ${code}`);
    }
  } catch (e) {
    console.warn("[r1a8] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("cổng 1 — cờ SCADA_COMMANDS_ENABLED", () => {
  it("cờ tắt ⇒ FORBIDDEN FEATURE_DISABLED, KHÔNG chạm DB (0 dòng attempts, 0 dòng chờ)", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    try {
      const u = nguoi.opA;
      const m = await moc();
      const loi = await loiCua(u.caller.request({ adapterId: ad.a, tagKey: "sp3", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
      expect(loi).toMatchObject({ code: "FORBIDDEN", appCode: "FEATURE_DISABLED", appParams: { feature: "scadaCommands" } });
      expect(await dongThuSau(m, u.id)).toHaveLength(0);
      expect(await soDongCho(u.id)).toBe(0);
    } finally {
      vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    }
  });
});

describe("cổng 2 — phạm vi máy: ngoài phạm vi = không tồn tại = cùng NOT_FOUND", () => {
  it("operator nhà máy B gọi adapter nhà máy A ⇒ NOT_FOUND giống hệt adapter không tồn tại / adapter không gắn máy; dòng attempts KHÔNG mang adapter", async () => {
    const u = nguoi.opB;
    const ketQua: Loi[] = [];
    for (const adapterId of [2_000_000_000, ad.a, ad.n]) {
      const m = await moc();
      const loi = await loiCua(u.caller.request({ adapterId, tagKey: "sp3", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
      ketQua.push(loi);
      const dong = await dongThuSau(m, u.id);
      expect(dong).toHaveLength(1);
      expect(dong[0]).toMatchObject({
        stage: "request",
        outcome: "rejected",
        reason_code: "NOT_FOUND",
        adapter_id: null,
        tag_key: null,
        requested_value: null,
        request_id: null,
      });
    }
    expect(ketQua[0]).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect(ketQua[1]).toEqual(ketQua[0]);
    expect(ketQua[2]).toEqual(ketQua[0]);
    expect(await soDongCho(u.id)).toBe(0);
  });
});

describe("cổng 3–4 — kênh và giá trị", () => {
  it("tag tắt ⇒ NOT_FOUND (deviceTag), dòng attempts mang adapter + tag", async () => {
    const { loi, dong } = await tuChoi("opA", { adapterId: ad.a, tagKey: "tat", value: 100 }, { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", reason: "NOT_FOUND" });
    expect(loi.appParams).toMatchObject({ entity: "deviceTag" });
    expect(dong).toMatchObject({ adapter_id: ad.a, tag_key: "tat" });
  });

  it("kênh vào (input) ⇒ CHANNEL_READ_ONLY", async () => {
    const { dong } = await tuChoi(
      "opA",
      { adapterId: ad.a, tagKey: "doc", value: 1 },
      { code: "PRECONDITION_FAILED", appCode: "SCADA_CHANNEL_READ_ONLY", reason: "CHANNEL_READ_ONLY" },
    );
    expect(dong).toMatchObject({ adapter_id: ad.a, tag_key: "doc", requested_value: 1 });
  });

  it("giá trị không phải số cho kênh float ⇒ TYPE_MISMATCH", async () => {
    await tuChoi("opA", { adapterId: ad.a, tagKey: "sp3", value: "abc" }, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_TYPE_MISMATCH", reason: "TYPE_MISMATCH" });
  });

  it("ngoài dải [0, 300] ⇒ OUT_OF_RANGE", async () => {
    const { loi } = await tuChoi(
      "opA",
      { adapterId: ad.a, tagKey: "sp3", value: 301 },
      { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OUT_OF_RANGE", reason: "OUT_OF_RANGE" },
    );
    expect(loi.appParams).toMatchObject({ ma: "OUT_OF_RANGE", min: 0, max: 300 });
  });

  it("lệch bước 0.5 ⇒ OFF_STEP, appError mang goiY + bước (M5 hiện)", async () => {
    const { loi, dong } = await tuChoi(
      "opA",
      { adapterId: ad.a, tagKey: "sp3", value: "240.2" },
      { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OFF_STEP", reason: "OFF_STEP" },
    );
    expect(loi.appParams).toMatchObject({ ma: "OFF_STEP", goiY: 240, step: 0.5 });
    expect(dong.requested_value).toBe("240.2"); // giá trị THÔ người gửi
  });
});

describe("cổng 5 — vai trò + machine_control.canEdit + đăng ký 2FA", () => {
  it("operator + kênh mức 4 ⇒ ROLE_FLOOR", async () => {
    const { loi } = await tuChoi("opA", { adapterId: ad.a, tagKey: "sp4", value: 100 }, { code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", reason: "ROLE_FLOOR" });
    expect(loi.appParams).toMatchObject({ level: 4 });
  });

  it("viewer (dù có canEdit) + kênh mức 3 ⇒ ROLE_FLOOR", async () => {
    await tuChoi("viewerA", { adapterId: ad.a, tagKey: "sp3", value: 100 }, { code: "FORBIDDEN", appCode: "SCADA_ROLE_FLOOR", reason: "ROLE_FLOOR" });
  });

  it("operator KHÔNG có machine_control.canEdit ⇒ PERMISSION_DENIED", async () => {
    await tuChoi("opKhongQuyen", { adapterId: ad.a, tagKey: "sp3", value: 100 }, { code: "FORBIDDEN", appCode: "PERMISSION_DENIED", reason: "PERMISSION_DENIED" });
  });

  it("engineer CHƯA đăng ký 2FA + kênh mức 4 ⇒ TOTP_CHUA_DANG_KY ngay ở request", async () => {
    const { loi } = await tuChoi(
      "engKhong2fa",
      { adapterId: ad.a, tagKey: "sp4", value: 100 },
      { code: "PRECONDITION_FAILED", appCode: "SCADA_TOTP_NOT_ENROLLED", reason: "TOTP_CHUA_DANG_KY" },
    );
    expect(loi.appParams).toMatchObject({ level: 4 });
  });
});

describe("cổng 6–7 — edge, chế độ máy", () => {
  it("adapter do edge sở hữu ⇒ EDGE_CHUA_HO_TRO, params mang mã edge", async () => {
    const { loi } = await tuChoi(
      "engA",
      { adapterId: ad.e, tagKey: "sp3", value: 100 },
      { code: "PRECONDITION_FAILED", appCode: "SCADA_EDGE_NOT_SUPPORTED", reason: "EDGE_CHUA_HO_TRO" },
    );
    expect(loi.appParams).toMatchObject({ edgeCode: `${RUN}-en` });
  });

  it("kênh chế độ đọc giá trị khác REMOTE ⇒ MODE_LOCAL (lyDo khac_remote)", async () => {
    boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 1)]);
    try {
      const { loi } = await tuChoi(
        "opA",
        { adapterId: ad.a, tagKey: "sp3", value: 100 },
        { code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", reason: "MODE_LOCAL" },
      );
      expect(loi.appParams).toMatchObject({ lyDo: "khac_remote" });
    } finally {
      boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2)]);
    }
  });

  it("Review Focus 4 — bộ đệm TẮT ⇒ MODE_LOCAL (bo_dem_tat), không ném lỗi khác, không trả bản xem trước, không giữ khoá", async () => {
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    try {
      const { loi } = await tuChoi(
        "opA",
        { adapterId: ad.a, tagKey: "rf4", value: 100 },
        { code: "PRECONDITION_FAILED", appCode: "SCADA_MACHINE_NOT_REMOTE", reason: "MODE_LOCAL" },
      );
      expect(loi.appParams).toMatchObject({ lyDo: "bo_dem_tat" });
      const khoa = await dung(sql`SELECT 1 FROM scada_khoa_chon WHERE adapter_id = ${ad.a} AND tag_key = 'rf4'`);
      expect(khoa).toHaveLength(0);
    } finally {
      vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    }
  });
});

describe("cổng 8 — khoá chọn", () => {
  it("opA giữ kênh ⇒ opA2 nhận DANG_DUOC_CHON (boiUserId = opA)", async () => {
    await nguoi.opA.caller.request({ adapterId: ad.a, tagKey: "khoa", value: 100, lyDo: LY_DO, clientRequestId: uuid() });
    const { loi, dong } = await tuChoi("opA2", { adapterId: ad.a, tagKey: "khoa", value: 120 }, { code: "CONFLICT", appCode: "SCADA_TAG_SELECTED_BY_OTHER", reason: "DANG_DUOC_CHON" });
    expect(loi.appParams).toMatchObject({ ma: "DANG_DUOC_CHON", boiUserId: nguoi.opA.id });
    expect(dong).toMatchObject({ adapter_id: ad.a, tag_key: "khoa" });
  });

  it("giuKhoaChon NÉM (hết lượt thử) ⇒ CONFLICT có mã i18n (không 500 thô), dòng attempts KHOA_CHON_LOI, không dòng chờ", async () => {
    H.khoaNem = 1;
    try {
      const { loi } = await tuChoi("opA", { adapterId: ad.a, tagKey: "nem", value: 100 }, { code: "CONFLICT", appCode: "OPERATION_FAILED", reason: "KHOA_CHON_LOI" });
      expect(loi.appParams).toMatchObject({ operation: "scadaSelectTag", reason: "scadaSelectionLockBusy" });
    } finally {
      H.khoaNem = 0;
    }
  });
});

describe("thành công — ai_pending_actions hmi.write_tag, băm trên giá trị ĐÃ ÉP KIỂU, TTL 60 s, socket", () => {
  it("operator + mức 3, giá trị gửi dạng chuỗi \"245\" ⇒ dòng chờ đúng tool/băm/hạn, attempts proposed, scada:cmd tới đúng user", async () => {
    const u = nguoi.opA;
    const m = await moc();
    H.emits.length = 0;
    const clientRequestId = uuid();
    const t0 = Date.now();
    const kq = await u.caller.request({ adapterId: ad.a, tagKey: "sp3", value: "245", lyDo: LY_DO, clientRequestId });
    const t1 = Date.now();

    expect(kq.requestId).toEqual(expect.any(String));
    const het = new Date(kq.expiresAt).getTime();
    expect(het).toBeGreaterThanOrEqual(t0 + 60_000 - 1000);
    expect(het).toBeLessThanOrEqual(t1 + 60_000 + 1000);
    expect(kq.preview).toMatchObject({
      machine: "May A",
      channel: "Kenh sp3",
      unit: "°C",
      current: { v: 200, q: "good" },
      requested: 245,
      afterFormula: 245,
      range: { min: 0, max: 300, step: 0.5 },
      level: 3,
      needsTotp: false,
      mode: "simulated",
      route: "central",
    });
    expect(kq.preview.current.ageMs).toEqual(expect.any(Number));
    expect([...kq.preview.simulatedReasons].sort()).toEqual(["CHUA_NGHIEM_THU", "OT_CONTROL_TAT"]);
    expect(kq.preview.warnings).toContain("SAFETY_KIEM_LUC_GUI");
    expect(kq.preview.warnings).not.toContain("KHONG_CO_GIA_TRI_HIEN_TAI");

    const [row] = await dung(sql`SELECT id, tool, status, "userId", "argsJson", "previewJson", "idempotencyKey", "expiresAt"
      FROM ai_pending_actions WHERE id = ${kq.requestId}`);
    expect(row).toMatchObject({ tool: "hmi.write_tag", status: "proposed", userId: u.id, idempotencyKey: `hmi:${u.id}:${clientRequestId}` });
    expect(row.argsJson).toEqual({ adapterId: ad.a, machineId: A.mid, tagKey: "sp3", value: 245, commandType: "write_tag" });
    const hash = otPayloadHash({
      tool: "hmi.write_tag",
      adapterId: ad.a,
      machineId: A.mid,
      commandType: "write_tag",
      writes: [{ tagKey: "sp3", value: 245 }],
    });
    expect(row.previewJson.__otPayloadHash).toBe(hash);
    expect(row.previewJson.lyDo).toBe(LY_DO);
    expect(row.previewJson.preview).toEqual(kq.preview);

    const dong = await dongThuSau(m, u.id);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({
      request_id: kq.requestId,
      adapter_id: ad.a,
      tag_key: "sp3",
      requested_value: 245,
      after_formula: 245,
      stage: "request",
      outcome: "proposed",
      reason_code: null,
    });

    const [khoa] = await dung(sql`SELECT user_id, request_id FROM scada_khoa_chon WHERE adapter_id = ${ad.a} AND tag_key = 'sp3'`);
    expect(khoa).toMatchObject({ user_id: u.id, request_id: kq.requestId });

    expect(H.emits).toEqual([{ room: `user:${u.id}`, ev: "scada:cmd", payload: { requestId: kq.requestId, status: "proposed", at: expect.any(String) } }]);
  });

  it("engineer + kênh mức 4 chưa có mẫu ⇒ current {v:null,q:'bad',ageMs:null} + KHONG_CO_GIA_TRI_HIEN_TAI, needsTotp", async () => {
    const kq = await nguoi.engA.caller.request({ adapterId: ad.a, tagKey: "sp4", value: 10, lyDo: LY_DO, clientRequestId: uuid() });
    expect(kq.preview.current).toEqual({ v: null, q: "bad", ageMs: null });
    expect(kq.preview.warnings).toContain("KHONG_CO_GIA_TRI_HIEN_TAI");
    expect(kq.preview).toMatchObject({ level: 4, needsTotp: true, requested: 10 });
  });
});

describe("clientRequestId gửi lại", () => {
  it("cùng người + cùng clientRequestId ⇒ CÙNG requestId, không dòng chờ mới, không dòng attempts mới; đã xử lý ⇒ DA_XU_LY", async () => {
    const u = nguoi.opA;
    const clientRequestId = uuid();
    const lan1 = await u.caller.request({ adapterId: ad.a, tagKey: "lap", value: 100, lyDo: LY_DO, clientRequestId });
    const m = await moc();
    const cho = await soDongCho(u.id);
    const lan2 = await u.caller.request({ adapterId: ad.a, tagKey: "lap", value: 100, lyDo: LY_DO, clientRequestId });
    expect(lan2).toEqual(lan1);
    expect(await soDongCho(u.id)).toBe(cho);
    expect(await dongThuSau(m, u.id)).toHaveLength(0);

    // cùng clientRequestId nhưng lệnh KHÁC ⇒ không trả bản xem trước của lệnh cũ
    const khac = await tuChoi("opA", { adapterId: ad.a, tagKey: "lap", value: 150, clientRequestId }, { code: "CONFLICT", appCode: "SCADA_REQUEST_ALREADY_HANDLED", reason: "DA_XU_LY" });
    expect(khac.dong.request_id).toBe(lan1.requestId);

    // dòng chờ đã rời 'proposed' ⇒ DA_XU_LY, không tạo dòng thứ hai
    await dung(sql`UPDATE ai_pending_actions SET status = 'cancelled' WHERE id = ${lan1.requestId}`);
    await tuChoi("opA", { adapterId: ad.a, tagKey: "lap", value: 100, clientRequestId }, { code: "CONFLICT", appCode: "SCADA_REQUEST_ALREADY_HANDLED", reason: "DA_XU_LY" });
    const [r] = await dung(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE "idempotencyKey" = ${`hmi:${u.id}:${clientRequestId}`}`);
    expect(Number(r.n)).toBe(1);
  });

  it("hai yêu cầu GIỐNG HỆT cùng lúc ⇒ cùng requestId, đúng MỘT dòng chờ, đúng MỘT dòng attempts proposed (ràng buộc unique)", async () => {
    const u = nguoi.engA;
    const clientRequestId = uuid();
    const m = await moc();
    const goi = () => u.caller.request({ adapterId: ad.a, tagKey: "dua", value: 50, lyDo: LY_DO, clientRequestId });
    const [x, y] = await Promise.all([goi(), goi()]);
    expect(y.requestId).toBe(x.requestId);
    const [r] = await dung(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE "idempotencyKey" = ${`hmi:${u.id}:${clientRequestId}`}`);
    expect(Number(r.n)).toBe(1);
    const dong = await dongThuSau(m, u.id);
    expect(dong.filter((d) => d.outcome === "proposed")).toHaveLength(1);
    expect(dong.filter((d) => d.outcome !== "proposed")).toHaveLength(0);
  });
});

describe("kiem-dinh P1-3 — cổng giá trị biết scale/offset (int): (v − offset)/scale không nguyên ⇒ OFF_STEP + goiY", () => {
  it("kênh đã khai, scale 10, 25 ⇒ OFF_STEP {goiY 30 (hoà ⇒ Math.round lên), step 10}", async () => {
    const { loi } = await tuChoi("opA", { adapterId: ad.a, tagKey: "sc10", value: 25 }, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OFF_STEP", reason: "OFF_STEP" });
    expect(loi.appParams).toMatchObject({ ma: "OFF_STEP", tagKey: "sc10", goiY: 30, step: 10 });
  });
  it("kênh CHƯA khai (cột 0431 NULL), scale 10, 24 ⇒ VẪN OFF_STEP {goiY 20} — đường HMI luôn kiểm", async () => {
    const { loi } = await tuChoi("opA", { adapterId: ad.a, tagKey: "sc10cu", value: 24 }, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OFF_STEP", reason: "OFF_STEP" });
    expect(loi.appParams).toMatchObject({ ma: "OFF_STEP", goiY: 20, step: 10 });
  });
});

describe("R1b-2a T2 (m5) — HMI và dispatch cùng luật cho int scale lẻ", () => {
  it("★ request 2.5 trên int scale 0.5 CHƯA khai ⇒ được nhận (trước: SCADA_VALUE_TYPE_MISMATCH); dòng chờ + băm mang SỐ 2.5", async () => {
    const u = nguoi.opA;
    const kq = await u.caller.request({ adapterId: ad.a, tagKey: "sc05cu", value: "2.5", lyDo: LY_DO, clientRequestId: uuid() });
    expect(kq.requestId).toEqual(expect.any(String));
    expect(kq.preview).toMatchObject({ requested: 2.5 });
    const [row] = await dung(sql`SELECT "argsJson", "previewJson" FROM ai_pending_actions WHERE id = ${kq.requestId}`);
    expect(row.argsJson).toMatchObject({ tagKey: "sc05cu", value: 2.5 });
    expect(row.previewJson.__otPayloadHash).toBe(
      otPayloadHash({ tool: "hmi.write_tag", adapterId: ad.a, machineId: A.mid, commandType: "write_tag", writes: [{ tagKey: "sc05cu", value: 2.5 }] }),
    );
    await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${ad.a} AND tag_key = 'sc05cu'`); // nhả khoá chọn cho ca sau
  });

  it("request 2.6 trên int scale 0.5 CHƯA khai ⇒ OFF_STEP {step 0.5, goiY 2.5}; 2.5 trên int scale 1 CHƯA khai vẫn TYPE_MISMATCH", async () => {
    const { loi } = await tuChoi("opA", { adapterId: ad.a, tagKey: "sc05cu", value: 2.6 }, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_OFF_STEP", reason: "OFF_STEP" });
    expect(loi.appParams).toMatchObject({ ma: "OFF_STEP", tagKey: "sc05cu", step: 0.5, goiY: 2.5 });
    await tuChoi("opA", { adapterId: ad.a, tagKey: "sc1cu", value: 2.5 }, { code: "BAD_REQUEST", appCode: "SCADA_VALUE_TYPE_MISMATCH", reason: "TYPE_MISMATCH" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1b-1 Task 7 — cột `ly_do` (mig 0433) trên dòng `request` + bộ điều tiết mã ồn (MA_ON) theo người dùng
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function lyDoSau(m: number, userId: number): Promise<Array<{ outcome: string; reason_code: string | null; ly_do: string | null }>> {
  return (await dung(sql`SELECT outcome, reason_code, ly_do FROM scada_command_attempts WHERE id > ${m} AND user_id = ${userId} ORDER BY id`)) as never;
}

describe("R1b-1 T7 — ly_do trên dòng request", () => {
  it("proposed mang lý do người dùng gõ; rejected (OFF_STEP) cũng mang lý do đó", async () => {
    const u = nguoi.opA;
    const m = await moc();
    await u.caller.request({ adapterId: ad.a, tagKey: "rf4", value: 100, lyDo: "  can giam nhiet  ", clientRequestId: uuid() });
    await loiCua(u.caller.request({ adapterId: ad.a, tagKey: "rf4", value: 100.25, lyDo: "lech buoc", clientRequestId: uuid() }));
    expect(await lyDoSau(m, u.id)).toEqual([
      { outcome: "proposed", reason_code: null, ly_do: "can giam nhiet" },
      { outcome: "rejected", reason_code: "OFF_STEP", ly_do: "lech buoc" },
    ]);
  });

  it("ghiThuLenh cắt ly_do ở 300 ký tự (theo điểm mã, không xé cặp thay thế) và rỗng ⇒ NULL", async () => {
    const { ghiThuLenh } = await import("../services/scada/lenhHmi");
    const u = nguoi.opA;
    const m = await moc();
    await ghiThuLenh(db, { userId: u.id, stage: "request", outcome: "rejected", reasonCode: "OFF_STEP", lyDo: "😀".repeat(500) });
    await ghiThuLenh(db, { userId: u.id, stage: "request", outcome: "rejected", reasonCode: "OFF_STEP", lyDo: "   " });
    const dong = await lyDoSau(m, u.id);
    expect(Array.from(dong[0].ly_do as string)).toHaveLength(300);
    expect(dong[1].ly_do).toBeNull();
  });
});

describe("R1b-1 T7 — bộ điều tiết attempts theo người dùng (MA_ON)", () => {
  it("★ 100 lần MODE_LOCAL (mã KHÔNG ồn, cổng an toàn) ⇒ ĐÚNG 100 dòng, client luôn nhận MODE_LOCAL", async () => {
    const dt = await import("../services/scada/dieuTietThuLenh");
    dt.__datLaiDieuTiet();
    const u = nguoi.opA2;
    boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 1)]);
    try {
      const m = await moc();
      for (let i = 0; i < 100; i++) {
        const loi = await loiCua(u.caller.request({ adapterId: ad.a, tagKey: "sp3", value: 100, lyDo: LY_DO, clientRequestId: uuid() }));
        expect(loi.appCode).toBe("SCADA_MACHINE_NOT_REMOTE");
      }
      const dong = await lyDoSau(m, u.id);
      expect(dong).toHaveLength(100);
      expect(dong.every((d) => d.reason_code === "MODE_LOCAL")).toBe(true);
    } finally {
      boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2)]);
    }
  }, 120_000);

  it("★ 100 lần DA_XU_LY trong 1 phút ⇒ ≤ 31 dòng (30 + tổng kết); client nhận ĐÚNG mã cả 100 lần; sau cửa sổ ⇒ 1 dòng DIEU_TIET + dòng hiện tại", async () => {
    const dt = await import("../services/scada/dieuTietThuLenh");
    dt.__datLaiDieuTiet();
    const u = nguoi.engA;
    const clientRequestId = uuid();
    const lan1 = await u.caller.request({ adapterId: ad.a, tagKey: "nem", value: 100, lyDo: LY_DO, clientRequestId });
    await dung(sql`UPDATE ai_pending_actions SET status = 'cancelled' WHERE id = ${lan1.requestId}`);
    const m = await moc();
    const goi = async () => {
      const loi = await loiCua(u.caller.request({ adapterId: ad.a, tagKey: "nem", value: 100, lyDo: LY_DO, clientRequestId }));
      expect(loi).toMatchObject({ code: "CONFLICT", appCode: "SCADA_REQUEST_ALREADY_HANDLED" });
    };
    try {
      for (let i = 0; i < 100; i++) await goi();
      const trong = await lyDoSau(m, u.id);
      expect(trong.length).toBeLessThanOrEqual(31);
      expect(trong).toHaveLength(30);
      expect(trong.every((d) => d.reason_code === "DA_XU_LY")).toBe(true);

      // cửa sổ 60 s kết thúc ⇒ lần gọi kế tiếp ghi MỘT dòng tổng kết rồi dòng hiện tại
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
      await goi();
    } finally {
      vi.useRealTimers();
    }
    const sau = (await lyDoSau(m, u.id)).slice(30);
    expect(sau).toEqual([
      { outcome: "rejected", reason_code: "DIEU_TIET", ly_do: "70 lần DA_XU_LY bị gộp" },
      { outcome: "rejected", reason_code: "DA_XU_LY", ly_do: LY_DO },
    ]);
  }, 120_000);

  it("điều tiết theo NGƯỜI: người khác cùng mã ồn vẫn được ghi dòng đầu", async () => {
    const dt = await import("../services/scada/dieuTietThuLenh");
    dt.__datLaiDieuTiet();
    for (let i = 0; i < 40; i++) dt.nenGhiThuLenh(nguoi.engA.id, "DA_XU_LY");
    expect(dt.nenGhiThuLenh(nguoi.engA.id, "DA_XU_LY")).toEqual({ ghi: false });
    expect(dt.nenGhiThuLenh(nguoi.opA.id, "DA_XU_LY")).toEqual({ ghi: true });
    dt.__datLaiDieuTiet();
  });
});

// ── R1b-1 T7 fix round 1 (I-1): NUL / ký tự điều khiển trong lyDo ────────────────────────────────────────────────────────────
describe("R1b-1 T7 fix round 1 — NUL trong lyDo (I-1)", () => {
  const NUL = "\u0000";

  it("router: lyDo chứa NUL ⇒ BAD_REQUEST (validation zod rõ ràng), không ghi dòng attempts nào, không dòng chờ", async () => {
    const u = nguoi.opA;
    const m = await moc();
    const cho = await soDongCho(u.id);
    const loi = await loiCua(u.caller.request({ adapterId: ad.a, tagKey: "sp3", value: 100, lyDo: `abc${NUL}defgh`, clientRequestId: uuid() }));
    expect(loi.code).toBe("BAD_REQUEST");
    expect(String(loi.message)).toContain("NUL");
    expect(await lyDoSau(m, u.id)).toHaveLength(0);
    expect(await soDongCho(u.id)).toBe(cho);
  });

  it("★ service (qua mặt zod): lyDo chứa NUL trên đường từ chối MODE_LOCAL ⇒ VẪN trả từ chối có mã (không ném 500), dòng attempts ghi ly_do đã LỌC NUL", async () => {
    const { yeuCauGhiTag } = await import("../services/scada/lenhHmi");
    const u = nguoi.opA2;
    boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 1)]);
    try {
      const m = await moc();
      const kq = await yeuCauGhiTag(
        { user: { id: u.id, role: "operator", twoFactorEnabled: true } },
        { userId: u.id, userRole: "operator" },
        { adapterId: ad.a, tagKey: "sp3", value: 100, lyDo: `chinh${NUL} nhiet${"\u0001"}`, clientRequestId: uuid() },
      );
      expect(kq).toMatchObject({ ok: false, tuChoi: { ma: "MODE_LOCAL" } });
      expect(await lyDoSau(m, u.id)).toEqual([{ outcome: "rejected", reason_code: "MODE_LOCAL", ly_do: "chinh nhiet" }]);
    } finally {
      boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2)]);
    }
  });
});
