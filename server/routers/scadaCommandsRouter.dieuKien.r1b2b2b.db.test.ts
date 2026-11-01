/**
 * SCADA R1b-2b-2b A C5 (M4, hợp đồng B-T11) — `scadaCommands.dieuKienChoPhep` ("Điều kiện cho phép" CHẠY KHÔ) trên CSDL `_test` THẬT.
 *
 * Bất biến được đo:
 *   • CÙNG kết luận với `request` (cùng hàm cổng `kiemDieuKienGhiTag`): mỗi ca là MỘT CẶP — chạy khô rồi `request` thật với cùng đầu vào:
 *       request thành công      ⇒ chạy khô `{quaCongTinh:true, canTotp = preview.needsTotp, muc = preview.level, canhBao = preview.warnings}`;
 *       request NOT_FOUND       ⇒ chạy khô NÉM lỗi Y HỆT (code + appCode + appParams + message);
 *       request từ chối khác    ⇒ chạy khô `{quaCongTinh:false, tuChoi}` với `tuChoi` deepEqual `(appCode, appParams)` của lỗi request (KD-2bA 5.2).
 *   • KHÔNG GHI GÌ (KD-2bA 5.3, Review Focus 4): trước / sau MỖI lượt chạy khô, ảnh chụp `ai_pending_actions`, `scada_command_attempts`,
 *     `control_audit_log`, `command_log`, `totp_khoa_sai` (của người dùng của tệp), `device_tags` + `scada_khoa_chon` (của adapter của tệp)
 *     KHÔNG đổi; bộ đếm trong RAM (điều tiết attempts, số lần gọi dispatch / verifyTotpOnce / kiemXacThucTheoMuc / giuKhoaChon /
 *     nenGhiThuLenh / recordAuditEvent) KHÔNG đổi.
 *   • Ma trận cặp SINH TỰ ĐỘNG: cờ × mức × vai × chế độ × dải (2 × 4 × 4 × 2 × 3 = 192 cặp).
 *   • Trần Q6 (60 / 60 s / người) + KD-2bA 5.4 (30 / 60 s / (người, adapter)) ⇒ TOO_MANY_REQUESTS OPERATION_FAILED {scadaDryRun, rateLimited},
 *     log chẩn đoán MỘT dòng / khoá / cửa sổ. Đồng hồ: `Date` giả (đứng yên) — không phụ thuộc đồng hồ tường.
 *   • Với MỌI mã `TuChoiYeuCau` (bảng mẫu buộc đủ bằng kiểu `Record<TuChoiYeuCau["ma"], …>` + đẳng thức kiểu với `MaTuChoiYeuCau` (cổng `check:tests`)): `tuChoiCongBo(t)` deepEqual đúng `(appCode, params)`
 *     mà `loiTuChoiLenh(t)` dựng — không hơn (KD-2bA 5.2).
 * `scada_command_attempts` là WORM: dòng do các lượt `request` đối chứng tạo ra ở lại (đúng thiết kế, như request.db.test).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `c5dk${process.pid}${Date.now().toString(36)}`;

const H = vi.hoisted(() => ({
  dem: { dispatch: 0, verifyTotpOnce: 0, kiemXacThucTheoMuc: 0, giuKhoaChon: 0, nenGhiThuLenh: 0, recordAuditEvent: 0 },
}));

vi.mock("../_core/socket", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/socket")>();
  return { ...real, getIO: () => ({ to: () => ({ emit: () => true }) }) as never };
});
vi.mock("../services/ot/commandDispatcher", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ot/commandDispatcher")>();
  return { ...real, dispatch: (...a: Parameters<typeof real.dispatch>) => (H.dem.dispatch++, real.dispatch(...a)) };
});
vi.mock("../_core/totpOnce", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/totpOnce")>();
  return { ...real, verifyTotpOnce: (...a: Parameters<typeof real.verifyTotpOnce>) => (H.dem.verifyTotpOnce++, real.verifyTotpOnce(...a)) };
});
vi.mock("../_core/xacThucTheoMuc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/xacThucTheoMuc")>();
  return {
    ...real,
    kiemXacThucTheoMuc: (...a: Parameters<typeof real.kiemXacThucTheoMuc>) => (H.dem.kiemXacThucTheoMuc++, real.kiemXacThucTheoMuc(...a)),
  };
});
vi.mock("../services/scada/khoaChon", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/khoaChon")>();
  return { ...real, giuKhoaChon: (...a: Parameters<typeof real.giuKhoaChon>) => (H.dem.giuKhoaChon++, real.giuKhoaChon(...a)) };
});
vi.mock("../services/scada/dieuTietThuLenh", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/scada/dieuTietThuLenh")>();
  return { ...real, nenGhiThuLenh: (...a: Parameters<typeof real.nenGhiThuLenh>) => (H.dem.nenGhiThuLenh++, real.nenGhiThuLenh(...a)) };
});
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...real,
    recordAuditEvent: (...a: Parameters<typeof real.recordAuditEvent>) => (H.dem.recordAuditEvent++, real.recordAuditEvent(...a)),
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import type { MaTuChoiYeuCau, TuChoiYeuCau } from "../services/scada/lenhHmi";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type RouterMod = typeof import("./scadaCommandsRouter");
type Caller = ReturnType<RouterMod["scadaCommandsRouter"]["createCaller"]>;

let db: Db;
let R: RouterMod;
let L: typeof import("../services/scada/lenhHmi");
let boDem: typeof import("../services/scada/boDemHienTai");
let dieuTiet: typeof import("../services/scada/dieuTietThuLenh");
let loggerMod: typeof import("../logger");

interface NhaMay {
  fid: number;
  mid: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, b: 0, e: 0, n: 0, x: 0, y: 0 };
let edgeNodeId = 0;
const factories: string[] = [];
const userIds: number[] = [];
const nguoi: Record<string, { id: number; caller: Caller }> = {};
const CHUA_TINH = ["khoa-chon", "totp-xac-minh", "han-gui"];
const LY_DO = "kiem tra dieu kien c5";
const uuid = () => crypto.randomUUID();

/** Fix round 1 (review I-1) — đẳng thức kiểu lúc biên dịch: union viết tay `MaTuChoiYeuCau` phải BẰNG `TuChoiYeuCau["ma"]`. */
type BangNhau<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const MA_KHOP_KIEU: BangNhau<MaTuChoiYeuCau, TuChoiYeuCau["ma"]> = true;

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
  const u = await taoNguoiDungTest(ten, role, { tienTo: "c5dk", ts: RUN, ten: `C5DK ${ten}` });
  userIds.push(u.id);
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin" && quyenDieuKhien) {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`,
    );
  }
  nguoi[ten] = {
    id: u.id,
    caller: R.scadaCommandsRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled } } as never),
  };
}

type Loi = { code?: string; message?: string; appCode?: string; appParams?: Record<string, unknown> };
type KetQuaGoi = { ok: true; v: any } | { ok: false; loi: Loi };
async function goi(p: Promise<unknown>): Promise<KetQuaGoi> {
  try {
    return { ok: true, v: await p };
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { ok: false, loi: { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams } };
  }
}

const inList = (ids: number[]) => sql.join([...ids, -1].map((i) => sql`${i}`), sql`, `);

/** Ảnh chụp MỌI bảng mà một lượt ghi tag có thể chạm (của người dùng / adapter của tệp). */
async function anh(): Promise<Record<string, unknown>> {
  const u = inList(userIds);
  const a = inList(Object.values(ad).filter(Boolean));
  const [r] = await dung(sql`SELECT
      (SELECT md5(COALESCE(string_agg(p.id || ':' || p.status, '|' ORDER BY p.id), '')) FROM ai_pending_actions p WHERE p."userId" IN (${u})) AS cho,
      (SELECT count(*)::int FROM scada_command_attempts WHERE user_id IN (${u})) AS thu,
      (SELECT COALESCE(max(id), 0)::bigint FROM scada_command_attempts WHERE user_id IN (${u})) AS thu_max,
      (SELECT count(*)::int FROM control_audit_log WHERE "actorId" IN (${u})) AS audit,
      (SELECT count(*)::int FROM command_log WHERE "requestedBy" IN (${u})) AS lenh,
      (SELECT md5(COALESCE(string_agg(k::text, '|' ORDER BY k::text), '')) FROM totp_khoa_sai k WHERE k.user_id IN (${u})) AS totp,
      (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM device_tags t WHERE t."adapterId" IN (${a})) AS tags,
      (SELECT md5(COALESCE(string_agg(c::text, '|' ORDER BY c.adapter_id, c.tag_key), '')) FROM scada_khoa_chon c WHERE c.adapter_id IN (${a})) AS khoa`);
  return { ...r, thu_max: String(r.thu_max) };
}
/** Bộ đếm trong RAM + số lần gọi các hàm có tác dụng phụ. */
function boNho(): Record<string, number> {
  return { soKhoaDieuTiet: dieuTiet.__soKhoaDieuTiet(), ...H.dem };
}

/** Một lượt chạy khô, khẳng định KHÔNG ghi gì / không chạm bộ đếm nào. */
async function chayKho(ten: string, input: { adapterId: number; tagKey: string; value: unknown }): Promise<KetQuaGoi> {
  const truoc = await anh();
  const truocBoNho = boNho();
  const kq = await goi(nguoi[ten].caller.dieuKienChoPhep(input as never));
  expect(await anh(), `chạy khô ${ten} ${JSON.stringify(input)} không được ghi bảng nào`).toEqual(truoc);
  expect(boNho(), `chạy khô ${ten} ${JSON.stringify(input)} không được chạm bộ đếm / hàm tác dụng phụ`).toEqual(truocBoNho);
  return kq;
}

/** Mã máy chủ (`ma`) của một kết quả chạy khô ĐÃ đối chiếu với request (`cap`): qua ⇒ "QUA_CONG_TINH"; từ chối ⇒ params.ma; ném ⇒ appParams.ma. */
function maCua(dk: KetQuaGoi): string {
  if (!dk.ok) return String(dk.loi.appParams?.ma);
  return dk.v.quaCongTinh ? "QUA_CONG_TINH" : String(dk.v.tuChoi.params.ma);
}

/** MỘT CẶP: chạy khô rồi request thật (cùng đầu vào) ⇒ cùng kết luận / cùng (code, params). Trả kết quả chạy khô. */
async function cap(ten: string, input: { adapterId: number; tagKey: string; value: unknown }): Promise<KetQuaGoi> {
  const dk = await chayKho(ten, input);
  const rq = await goi(nguoi[ten].caller.request({ ...input, lyDo: LY_DO, clientRequestId: uuid() } as never));
  const nhan = `${ten} ${JSON.stringify(input)}`;
  if (rq.ok) {
    expect(dk, nhan).toEqual({
      ok: true,
      v: { quaCongTinh: true, canTotp: rq.v.preview.needsTotp, muc: rq.v.preview.level, canhBao: rq.v.preview.warnings, chuaTinh: CHUA_TINH },
    });
    const h = await goi(nguoi[ten].caller.huy({ requestId: rq.v.requestId }));
    expect(h.ok, `huỷ yêu cầu đối chứng ${nhan}`).toBe(true);
  } else if (rq.loi.appCode === "ENTITY_NOT_FOUND") {
    expect(dk, nhan).toEqual({ ok: false, loi: rq.loi });
  } else {
    expect(dk, nhan).toEqual({
      ok: true,
      v: { quaCongTinh: false, tuChoi: { code: rq.loi.appCode, params: rq.loi.appParams }, chuaTinh: CHUA_TINH },
    });
  }
  return dk;
}

function mauOt(tagKey: string, value: number) {
  return { tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() };
}
const datCheDo = (giaTri: number) => boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", giaTri)]);

beforeAll(async () => {
  vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("OT_CONTROL_ENABLED", "false");
  vi.stubEnv("OT_COMMISSIONING_REQUIRED", "true");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  R = await import("./scadaCommandsRouter");
  L = await import("../services/scada/lenhHmi");
  boDem = await import("../services/scada/boDemHienTai");
  dieuTiet = await import("../services/scada/dieuTietThuLenh");
  loggerMod = await import("../logger");

  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(`${RUN}-a`, A.mid);
  ad.b = await seedAdapter(`${RUN}-b`, B.mid);
  ad.e = await seedAdapter(`${RUN}-e`, A.mid);
  ad.n = await seedAdapter(`${RUN}-n`, null);
  ad.x = await seedAdapter(`${RUN}-x`, A.mid);
  ad.y = await seedAdapter(`${RUN}-y`, A.mid);
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'c5dk edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.e}`);

  const sp = { dataType: "float" as const, min: 0, max: 300, step: 0.5 };
  await seedTag(ad.a, { key: "che_do", dataType: "int", kind: "input", writable: false, level: null });
  await seedTag(ad.a, { key: "m1", ...sp, level: 1 });
  await seedTag(ad.a, { key: "m3", ...sp, level: 3 });
  await seedTag(ad.a, { key: "m4", ...sp, level: 4 });
  await seedTag(ad.a, { key: "m5", ...sp, level: 5 });
  await seedTag(ad.a, { key: "doc", dataType: "float", kind: "input", writable: false, level: null });
  await seedTag(ad.a, { key: "tat", ...sp, enabled: false });
  // kênh CHƯA khai (mọi cột 0431 NULL) — int scale 10: cổng giá trị vẫn kiểm lưới scale (kiem-dinh P1-3)
  await seedTag(ad.a, { key: "sc10cu", dataType: "int", kind: null, level: 3 });
  await dung(sql`UPDATE device_tags SET scale = 10, "offset" = 0 WHERE "adapterId" = ${ad.a} AND "tagKey" = 'sc10cu'`);
  await seedTag(ad.b, { key: "m3", ...sp, level: 3 });
  await seedTag(ad.e, { key: "m3", ...sp, level: 3 });
  await seedTag(ad.n, { key: "m3", ...sp, level: 3 });

  await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
    VALUES (${A.mid}, ${ad.a}, 'che_do', '2'::jsonb, 1)`);
  boDem.datThongTinAdapter(ad.a, { pollMs: 60_000, coDeadband: false, machineId: A.mid, code: `${RUN}-a` });
  boDem.napTuOt({ adapterId: ad.a, machineId: A.mid }, [mauOt("che_do", 2), mauOt("m3", 200)]);

  await seedNguoi("opA", "operator", [A.code], true);
  await seedNguoi("opKhongQuyen", "operator", [A.code], false);
  await seedNguoi("viewerA", "viewer", [A.code], true);
  await seedNguoi("engA", "engineer", [A.code], true);
  await seedNguoi("engKhong2fa", "engineer", [A.code], true, false);
  await seedNguoi("opB", "operator", [B.code], true);
}, 60_000);

beforeEach(() => {
  L._datLaiTranDieuKienChoTest();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  try {
    boDem?.xoaAdapter(ad.a);
  } catch {
    /* bỏ qua */
  }
  if (!db) return;
  try {
    const ids = inList(Object.values(ad).filter(Boolean));
    for (const id of userIds) await dung(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${id} AND tool = 'hmi.write_tag'`);
    await dung(sql`DELETE FROM scada_khoa_chon WHERE adapter_id IN (${ids})`);
    if (A?.mid) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${A.mid}`);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids})`);
    if (ad.e) await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.e}`);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ids})`);
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
    console.warn("[c5dk] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

describe("C5 — 8 tình huống của brief: chạy khô cho CÙNG kết luận / mã với request, không ghi gì", () => {
  it("1. tag chưa khai (không tồn tại) ⇒ NÉM NOT_FOUND deviceTag y hệt request; kênh chưa khai cột 0431 (scale 10) ⇒ lệch lưới y hệt", async () => {
    const r = await cap("opA", { adapterId: ad.a, tagKey: "khong_co", value: 1 });
    expect(r).toMatchObject({ ok: false, loi: { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } } });
    const r2 = await cap("opA", { adapterId: ad.a, tagKey: "sc10cu", value: 15 });
    expect(r2).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { params: { ma: "OFF_STEP" } } } });
    await cap("opA", { adapterId: ad.a, tagKey: "tat", value: 1 }); // tag tắt = không tồn tại
  });

  it("2. ngoài dải ⇒ OUT_OF_RANGE {min, max}", async () => {
    const r = await cap("opA", { adapterId: ad.a, tagKey: "m3", value: 301 });
    expect(r).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_VALUE_OUT_OF_RANGE", params: { min: 0, max: 300 } } } });
  });

  it("3. lệch bước ⇒ OFF_STEP {step, goiY}; sai kiểu ⇒ TYPE_MISMATCH; kênh vào ⇒ CHANNEL_READ_ONLY", async () => {
    const r = await cap("opA", { adapterId: ad.a, tagKey: "m3", value: "240.2" });
    expect(r).toMatchObject({ ok: true, v: { tuChoi: { code: "SCADA_VALUE_OFF_STEP", params: { step: 0.5, goiY: 240 } } } });
    await cap("opA", { adapterId: ad.a, tagKey: "m3", value: "abc" });
    await cap("opA", { adapterId: ad.a, tagKey: "doc", value: 1 });
  });

  it("4. mức cao cần TOTP (4 / 5, engineer có 2FA) ⇒ quaCongTinh + canTotp:true, KHÔNG xác minh / tiêu mã; mức 3 ⇒ canTotp:false", async () => {
    for (const tagKey of ["m4", "m5"]) {
      const r = await cap("engA", { adapterId: ad.a, tagKey, value: 100 });
      expect(r).toMatchObject({ ok: true, v: { quaCongTinh: true, canTotp: true, chuaTinh: CHUA_TINH } });
    }
    const r3 = await cap("engA", { adapterId: ad.a, tagKey: "m3", value: 100 });
    expect(r3).toMatchObject({ ok: true, v: { quaCongTinh: true, canTotp: false, muc: 3 } });
    const r4 = await cap("engKhong2fa", { adapterId: ad.a, tagKey: "m4", value: 100 });
    expect(r4).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_TOTP_NOT_ENROLLED", params: { level: 4 } } } });
  });

  it("5. mức 5 vai thấp (operator) ⇒ ROLE_FLOOR; thiếu machine_control.canEdit ⇒ PERMISSION_DENIED", async () => {
    const r = await cap("opA", { adapterId: ad.a, tagKey: "m5", value: 100 });
    expect(r).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_ROLE_FLOOR", params: { level: 5 } } } });
    await cap("opKhongQuyen", { adapterId: ad.a, tagKey: "m3", value: 100 });
  });

  it("6. chế độ LOCAL ⇒ MODE_LOCAL {lyDo}", async () => {
    datCheDo(1);
    try {
      const r = await cap("engA", { adapterId: ad.a, tagKey: "m5", value: 100 });
      expect(r).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_MACHINE_NOT_REMOTE", params: { lyDo: "khac_remote" } } } });
    } finally {
      datCheDo(2);
    }
  });

  it("7. adapter do edge sở hữu ⇒ EDGE_CHUA_HO_TRO {edgeCode} — KHÔNG lộ edgeNodeId / chiTiet (KD-2bA 5.2)", async () => {
    const r = await cap("engA", { adapterId: ad.e, tagKey: "m3", value: 100 });
    expect(r).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_EDGE_NOT_SUPPORTED" } } });
    if (!r.ok) throw new Error("không tới");
    expect(r.v.tuChoi.params).toEqual({ ma: "EDGE_CHUA_HO_TRO", edgeCode: `${RUN}-en` });
    expect(Object.keys(r.v.tuChoi).sort()).toEqual(["code", "params"]);
  });

  it("8. adapter nhà máy B ⇒ NÉM NOT_FOUND adapter Y HỆT id không tồn tại / adapter không gắn máy / request (không là cửa dò)", async () => {
    const loi: Loi[] = [];
    for (const adapterId of [ad.b, 2_000_000_000, ad.n]) {
      const r = await cap("opA", { adapterId, tagKey: "m3", value: 100 });
      if (r.ok) throw new Error("mong đợi NOT_FOUND");
      loi.push(r.loi);
    }
    expect(loi[0]).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter", ma: "NOT_FOUND" } });
    expect(loi[1]).toEqual(loi[0]);
    expect(loi[2]).toEqual(loi[0]);
    // và chiều ngược: người nhà máy B thấy adapter của B
    await cap("opB", { adapterId: ad.b, tagKey: "m3", value: 100 });
  });

  it("★ 8 lượt chạy khô LIÊN TIẾP ⇒ đếm ai_pending_actions / scada_command_attempts / control_audit_log / totp_khoa_sai của người đó KHÔNG đổi", async () => {
    const truoc = await anh();
    const truocBoNho = boNho();
    const luot: Array<[string, { adapterId: number; tagKey: string; value: unknown }]> = [
      ["opA", { adapterId: ad.a, tagKey: "khong_co", value: 1 }],
      ["opA", { adapterId: ad.a, tagKey: "m3", value: 301 }],
      ["opA", { adapterId: ad.a, tagKey: "m3", value: 240.2 }],
      ["engA", { adapterId: ad.a, tagKey: "m5", value: 100 }],
      ["opA", { adapterId: ad.a, tagKey: "m5", value: 100 }],
      ["engA", { adapterId: ad.e, tagKey: "m3", value: 100 }],
      ["opA", { adapterId: ad.b, tagKey: "m3", value: 100 }],
      ["engA", { adapterId: ad.a, tagKey: "m4", value: 100 }],
    ];
    datCheDo(1);
    try {
      for (const [ten, input] of luot) await goi(nguoi[ten].caller.dieuKienChoPhep(input as never));
    } finally {
      datCheDo(2);
    }
    expect(await anh()).toEqual(truoc);
    expect(boNho()).toEqual(truocBoNho);
    expect(H.dem.dispatch, "chạy khô không bao giờ dispatch (request đối chứng cũng không — chưa confirm)").toBe(0);
    expect(H.dem.verifyTotpOnce, "không xác minh / tiêu TOTP").toBe(0);
  });

  it("cờ tắt ⇒ tuChoi FEATURE_DISABLED (trả, không ném); thiếu 0433 ⇒ tuChoi SCADA_SCHEMA_MISSING — cả hai không chạm DB", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    try {
      const r = await cap("opA", { adapterId: ad.a, tagKey: "m3", value: 100 });
      expect(r).toEqual({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "FEATURE_DISABLED", params: { feature: "scadaCommands", ma: "FEATURE_DISABLED" } }, chuaTinh: CHUA_TINH } });
    } finally {
      vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    }
    const { __datTrangThaiSchemaR1a, trangThaiSchemaR1a } = await import("../_core/kiemSchemaR1a");
    const truoc = trangThaiSchemaR1a();
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: new Date().toISOString(), thieu0431: [], thieu0432: [], thieu0433: ["scada_command_attempts.ly_do"], thieu0434: [], thieu0433Fk: [] });
    try {
      const r = await cap("opA", { adapterId: ad.a, tagKey: "m3", value: 100 });
      expect(r).toMatchObject({ ok: true, v: { quaCongTinh: false, tuChoi: { code: "SCADA_SCHEMA_MISSING", params: { migration: "0433" } } } });
    } finally {
      __datTrangThaiSchemaR1a(truoc);
    }
  });

  it("đầu vào thừa khoá (strict) ⇒ BAD_REQUEST trước mọi cổng; lyDo / clientRequestId không thuộc hợp đồng", async () => {
    const r = await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.a, tagKey: "m3", value: 100, lyDo: "x" } as never));
    expect(r).toMatchObject({ ok: false, loi: { code: "BAD_REQUEST" } });
  });
});

describe("C5 — ma trận cặp SINH TỰ ĐỘNG (KD-2bA 5.3): cờ × mức × vai × chế độ × dải", () => {
  const CO = ["bat", "tat"] as const;
  const MUC = [
    ["m1", 1],
    ["m3", 3],
    ["m4", 4],
    ["m5", 5],
  ] as const;
  const VAI = ["opA", "engA", "engKhong2fa", "viewerA"] as const;
  const CHE_DO = ["REMOTE", "LOCAL"] as const;
  const DAI = [
    ["trong", 100],
    ["ngoai", 301],
    ["lechBuoc", 100.2],
  ] as const;
  const MA_TRAN = CO.flatMap((co) =>
    MUC.flatMap(([tagKey, muc]) => VAI.flatMap((vai) => CHE_DO.flatMap((cheDo) => DAI.map(([dai, value]) => ({ co, tagKey, muc, vai, cheDo, dai, value }))))),
  );

  it(`đủ ${2 * 4 * 4 * 2 * 3} cặp, mỗi cặp: chạy khô không ghi gì + cùng kết luận với request`, async () => {
    expect(MA_TRAN).toHaveLength(192);
    const ketLuan = new Map<string, number>();
    for (const o of MA_TRAN) {
      L._datLaiTranDieuKienChoTest();
      vi.stubEnv("SCADA_COMMANDS_ENABLED", o.co === "bat" ? "true" : "false");
      datCheDo(o.cheDo === "REMOTE" ? 2 : 1);
      try {
        const r = await cap(o.vai, { adapterId: ad.a, tagKey: o.tagKey, value: o.value });
        const k = r.ok ? (r.v.quaCongTinh ? `qua:${r.v.canTotp}` : String(r.v.tuChoi.params.ma)) : `nem:${r.loi.appParams?.ma}`;
        ketLuan.set(k, (ketLuan.get(k) ?? 0) + 1);
      } finally {
        vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
        datCheDo(2);
      }
    }
    // ma trận phải thật sự phủ cả hai phía (không "xanh vì mọi cặp cùng một kết cục")
    expect([...ketLuan.keys()].sort()).toEqual(
      ["FEATURE_DISABLED", "MODE_LOCAL", "OFF_STEP", "OUT_OF_RANGE", "ROLE_FLOOR", "TOTP_CHUA_DANG_KY", "qua:false", "qua:true"].sort(),
    );
  }, 240_000);
});

describe("C5 — trần chạy khô (Q6 60 / phút / người + KD-2bA 5.4 30 / phút / (người, adapter)); Date giả đứng yên", () => {
  const tran = (loi: Loi) => ({ code: loi.code, appCode: loi.appCode, appParams: loi.appParams });
  const RATE = { code: "TOO_MANY_REQUESTS", appCode: "OPERATION_FAILED", appParams: { operation: "scadaDryRun", reason: "rateLimited" } };

  it("kiem-dinh — ghim LITERAL hai trần đã duyệt (Q6 60 / phút / người; KD-2bA 5.4 30 / phút / (người, adapter)): đổi hằng ⇒ đỏ", () => {
    expect(L.TRAN_DIEU_KIEN_MOI_PHUT).toBe(60);
    expect(L.TRAN_DIEU_KIEN_MOI_ADAPTER_PHUT).toBe(30);
  });

  it("lượt 61 trong 60 s (rải 3 adapter, dưới trần adapter) ⇒ rateLimited; người khác không bị ảnh hưởng; qua cửa sổ ⇒ lại được", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T03:00:00Z") });
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false"); // không chạm DB: trần đứng TRƯỚC mọi cổng
    try {
      const ids = [ad.a, ad.x, ad.y];
      for (let i = 0; i < L.TRAN_DIEU_KIEN_MOI_PHUT; i++) {
        const r = await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ids[i % 3], tagKey: "m3", value: 100 }));
        expect(r.ok, `lượt ${i + 1}`).toBe(true);
      }
      const r61 = await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.a, tagKey: "m3", value: 100 }));
      if (r61.ok) throw new Error("lượt 61 phải bị chặn");
      expect(tran(r61.loi)).toEqual(RATE);
      expect((await goi(nguoi.engA.caller.dieuKienChoPhep({ adapterId: ad.a, tagKey: "m3", value: 100 }))).ok).toBe(true);
      vi.setSystemTime(new Date(Date.now() + L.CUA_SO_TRAN_DIEU_KIEN_MS + 1));
      expect((await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.a, tagKey: "m3", value: 100 }))).ok).toBe(true);
    } finally {
      vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
      vi.useRealTimers();
    }
  });

  it("5.4 — lượt 31 trên CÙNG adapter ⇒ rateLimited, adapter khác vẫn được; log chẩn đoán MỘT dòng / khoá / cửa sổ; lượt bị chặn không đếm", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T04:00:00Z") });
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    const warn = vi.spyOn(loggerMod.logger, "warn");
    try {
      for (let i = 0; i < L.TRAN_DIEU_KIEN_MOI_ADAPTER_PHUT; i++) {
        expect((await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.x, tagKey: "m3", value: 100 }))).ok, `lượt ${i + 1}`).toBe(true);
      }
      warn.mockClear();
      for (let i = 0; i < 3; i++) {
        const r = await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.x, tagKey: "m3", value: 100 }));
        if (r.ok) throw new Error("lượt 31+ trên cùng adapter phải bị chặn");
        expect(tran(r.loi)).toEqual(RATE);
      }
      const logChan = warn.mock.calls.filter((c) => String(c[1] ?? "").includes("Điều kiện cho phép"));
      expect(logChan).toHaveLength(1);
      expect(logChan[0][0]).toMatchObject({ userId: nguoi.opA.id, adapterId: ad.x, theo: "nguoi_adapter", tran: L.TRAN_DIEU_KIEN_MOI_ADAPTER_PHUT });
      // adapter khác: còn 60 − 30 = 30 lượt của trần người (3 lượt bị chặn KHÔNG đếm)
      for (let i = 0; i < L.TRAN_DIEU_KIEN_MOI_PHUT - L.TRAN_DIEU_KIEN_MOI_ADAPTER_PHUT; i++) {
        expect((await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.y, tagKey: "m3", value: 100 }))).ok, `adapter y lượt ${i + 1}`).toBe(true);
      }
      const het = await goi(nguoi.opA.caller.dieuKienChoPhep({ adapterId: ad.a, tagKey: "m3", value: 100 }));
      if (het.ok) throw new Error("đủ 60 lượt được nhận ⇒ trần người");
      expect(tran(het.loi)).toEqual(RATE);
    } finally {
      warn.mockRestore();
      vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
      vi.useRealTimers();
    }
  });
});

describe("C5 — KD-2bA 5.2: với MỌI mã TuChoiYeuCau, tuChoiCongBo = đúng (appCode, params) của lỗi request, không hơn", () => {
  // Fix round 1 (review I-1): khoá theo `TuChoiYeuCau["ma"]` (union THẬT của các biến thể) ⇒ thêm một biến thể từ chối vào lenhHmi mà không thêm
  // mẫu ở đây ⇒ `npm run check:tests` (tsconfig.tests.json — cổng CI chặn) ĐỎ. Thêm: `MaTuChoiYeuCau` (union viết tay) phải BẰNG `TuChoiYeuCau["ma"]`.
  // 25 mã (đo 2026-11-01).
  const MAU: Record<TuChoiYeuCau["ma"], TuChoiYeuCau[]> = {
    FEATURE_DISABLED: [{ ma: "FEATURE_DISABLED", chiTiet: "c" }],
    NOT_FOUND: (["adapter", "deviceTag", "scadaRequest", "machine"] as const).map((entity) => ({ ma: "NOT_FOUND" as const, entity, chiTiet: "c" })),
    CHANNEL_READ_ONLY: [{ ma: "CHANNEL_READ_ONLY", tagKey: "t", chiTiet: "c" }],
    TYPE_MISMATCH: [{ ma: "TYPE_MISMATCH", tagKey: "t", dataType: "float", chiTiet: "c" }],
    OUT_OF_RANGE: [
      { ma: "OUT_OF_RANGE", tagKey: "t", min: 0, max: 300, chiTiet: "c" },
      { ma: "OUT_OF_RANGE", tagKey: "t", min: null, max: 10, chiTiet: "c" },
    ],
    OFF_STEP: [
      { ma: "OFF_STEP", tagKey: "t", step: 0.5, goiY: 240, chiTiet: "c" },
      { ma: "OFF_STEP", tagKey: "t", step: 0.5, chiTiet: "c" },
    ],
    ROLE_FLOOR: [{ ma: "ROLE_FLOOR", level: 5, chiTiet: "c" }],
    PERMISSION_DENIED: [{ ma: "PERMISSION_DENIED", chiTiet: "c" }],
    TOTP_CHUA_DANG_KY: [{ ma: "TOTP_CHUA_DANG_KY", level: 4, chiTiet: "c" }],
    EDGE_CHUA_HO_TRO: [{ ma: "EDGE_CHUA_HO_TRO", edgeCode: "en-1", edgeNodeId: 77, chiTiet: "c" }],
    MODE_LOCAL: [{ ma: "MODE_LOCAL", lyDo: "khac_remote", chiTiet: "c" }],
    DANG_DUOC_CHON: [{ ma: "DANG_DUOC_CHON", boiUserId: 9, boiTen: "X", hetHanLuc: "2026-11-01T00:00:00.000Z", chiTiet: "c" }],
    KHOA_CHON_LOI: [{ ma: "KHOA_CHON_LOI", chiTiet: "c" }],
    DA_XU_LY: [{ ma: "DA_XU_LY", chiTiet: "c" }],
    HET_HAN: [{ ma: "HET_HAN", chiTiet: "c" }],
    KHOA_MAT: [{ ma: "KHOA_MAT", chiTiet: "c" }],
    TOTP_CAN: [{ ma: "TOTP_CAN", level: 4, chiTiet: "c" }],
    TOTP_SAI: [{ ma: "TOTP_SAI", level: 5, chiTiet: "c" }],
    MAY_DA_DOI: [{ ma: "MAY_DA_DOI", chiTiet: "c" }],
    TOTP_TAM_KHOA: [{ ma: "TOTP_TAM_KHOA", level: 4, conLaiMs: 125_000, chiTiet: "c" }],
    TOTP_KHONG_KIEM_DUOC: [{ ma: "TOTP_KHONG_KIEM_DUOC", level: 4, chiTiet: "c" }],
    CHUA_GHIM_STOP: [{ ma: "CHUA_GHIM_STOP", chiTiet: "c" }],
    GHIM_MUC_CAO: [{ ma: "GHIM_MUC_CAO", soTag: 2, tagKeys: "a, b", chiTiet: "c" }],
    STOP_QUA_HAN: [{ ma: "STOP_QUA_HAN", pha: "truoc_gui", chiTiet: "c" }],
    THIEU_MIGRATION: [{ ma: "THIEU_MIGRATION", migration: "0433", chiTiet: "c" }],
  };

  it("mỗi mẫu: tuChoiCongBo(t) toStrictEqual {code: appCode, params: appParams} của loiTuChoiLenh(t); khoá đúng {code, params}; không chiTiet", () => {
    let so = 0;
    for (const [ma, ds] of Object.entries(MAU)) {
      expect(ds.length, ma).toBeGreaterThan(0);
      for (const t of ds) {
        expect(t.ma).toBe(ma);
        const e = R.loiTuChoiLenh(t) as unknown as { cause?: { appCode?: string; appParams?: Record<string, unknown> } };
        const cb = R.tuChoiCongBo(t);
        expect(cb, ma).toStrictEqual({ code: e.cause?.appCode, params: e.cause?.appParams });
        expect(Object.keys(cb).sort()).toEqual(["code", "params"]);
        expect(JSON.stringify(cb)).not.toContain('"chiTiet"');
        so++;
      }
    }
    expect(Object.keys(MAU).length, "số mã").toBeGreaterThanOrEqual(25);
    expect(so, "số mẫu").toBeGreaterThanOrEqual(30);
  });

  it("MaTuChoiYeuCau (union viết tay) BẰNG TuChoiYeuCau['ma'] — kiểm lúc biên dịch (check:tests)", () => {
    expect(MA_KHOP_KIEU).toBe(true);
  });

  it("mọi mã mà CỔNG TĨNH sinh ra được phủ bằng một CẶP thật (chạy khô ↔ request) — TỰ CHỨA, không dựa ca trước (fix round 1, review M-2)", async () => {
    const { __datTrangThaiSchemaR1a, trangThaiSchemaR1a } = await import("../_core/kiemSchemaR1a");
    type CaPhu = { ten: string; input: { adapterId: number; tagKey: string; value: unknown }; dat?: () => () => void };
    const CA: CaPhu[] = [
      {
        ten: "opA",
        input: { adapterId: ad.a, tagKey: "m3", value: 100 },
        dat: () => (vi.stubEnv("SCADA_COMMANDS_ENABLED", "false"), () => vi.stubEnv("SCADA_COMMANDS_ENABLED", "true")),
      },
      {
        ten: "opA",
        input: { adapterId: ad.a, tagKey: "m3", value: 100 },
        dat: () => {
          const truoc = trangThaiSchemaR1a();
          __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: new Date().toISOString(), thieu0431: [], thieu0432: [], thieu0433: ["scada_command_attempts.ly_do"], thieu0434: [], thieu0433Fk: [] });
          return () => __datTrangThaiSchemaR1a(truoc);
        },
      },
      { ten: "opA", input: { adapterId: ad.b, tagKey: "m3", value: 100 } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "khong_co", value: 1 } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "doc", value: 1 } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "m3", value: "abc" } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "m3", value: 301 } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "m3", value: 240.2 } },
      { ten: "opA", input: { adapterId: ad.a, tagKey: "m5", value: 100 } },
      { ten: "opKhongQuyen", input: { adapterId: ad.a, tagKey: "m3", value: 100 } },
      { ten: "engKhong2fa", input: { adapterId: ad.a, tagKey: "m4", value: 100 } },
      { ten: "engA", input: { adapterId: ad.e, tagKey: "m3", value: 100 } },
      { ten: "engA", input: { adapterId: ad.a, tagKey: "m5", value: 100 }, dat: () => (datCheDo(1), () => datCheDo(2)) },
      { ten: "engA", input: { adapterId: ad.a, tagKey: "m3", value: 100 } },
    ];
    const daPhu = new Set<string>();
    for (const ca of CA) {
      const traLai = ca.dat?.();
      try {
        daPhu.add(maCua(await cap(ca.ten, ca.input)));
      } finally {
        traLai?.();
      }
    }
    const MA_CONG_TINH = [
      "FEATURE_DISABLED",
      "THIEU_MIGRATION",
      "NOT_FOUND",
      "CHANNEL_READ_ONLY",
      "TYPE_MISMATCH",
      "OUT_OF_RANGE",
      "OFF_STEP",
      "ROLE_FLOOR",
      "PERMISSION_DENIED",
      "TOTP_CHUA_DANG_KY",
      "EDGE_CHUA_HO_TRO",
      "MODE_LOCAL",
      "QUA_CONG_TINH",
    ];
    expect([...daPhu].sort()).toEqual([...MA_CONG_TINH].sort());
  });
});
