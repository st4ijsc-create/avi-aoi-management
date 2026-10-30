/**
 * SCADA R1b-2b-1 Task 11 (mục 48, T6 m-1) — `scadaKenh.khaiHangLoat` ghi audit THEO LÔ: MỘT `UPDATE device_tags … FROM (VALUES …)` + MỘT
 * `recordAuditEvents` (một INSERT nhiều hàng) giữ chuỗi băm WORM đúng — trên CSDL `_test` THẬT.
 *
 * TOTP THẬT (khuôn T6 R1b-2a): mỗi ca một secret mới cho mỗi kỹ sư, mã từ `speakeasy`. `SEC_PLATFORM` chỉ đặt TRONG TIẾN TRÌNH (`vi.stubEnv`).
 * Spy `controlAuditService` bọc BẢN THẬT (`importOriginal`) — đếm lượt gọi; móc `truocLo` bắn lượt đơn lẻ ĐÚNG LÚC lô vào bước audit (để ca song
 * song thật sự chồng lên cửa sổ đọc-hash → INSERT của lô, không phụ thuộc may rủi thời gian); móc `suaEs` làm hỏng MỘT phần tử để thử
 * tất-cả-hoặc-không. Lượt đơn lẻ của chính test gọi bản THẬT qua `vi.importActual` (không bị đếm).
 * Oracle độc lập: SELECT thô `control_audit_log` + `kiemDoan` (tính lại `computeAuditHash` từng hàng, nối `prevHash` theo id).
 * `_test` dùng chung với phiên khác: đoạn kiểm chỉ xét hàng `hash IS NOT NULL` — mọi bên ghi hàng băm đều đi qua khoá chuỗi audit nên đoạn vẫn
 * phải liền dù phiên khác ghi xen.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ totpThat: true }));
vi.mock("../_core/xacThucTheoMuc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/xacThucTheoMuc")>();
  return {
    ...real,
    kiemXacThucTheoMuc: async (...args: Parameters<typeof real.kiemXacThucTheoMuc>) =>
      H.totpThat ? real.kiemXacThucTheoMuc(...args) : ({ ok: true, cach: "moi_lan" } as const),
  };
});

type Es = ReadonlyArray<import("../services/audit/controlAuditService").AuditEventInput>;
const S = vi.hoisted(() => ({
  /** gọi (không await) ngay khi `recordAuditEvents` của router được gọi — trước bản thật. */
  truocLo: null as null | (() => void),
  /** thay `es` trước khi chuyển cho bản thật. */
  suaEs: null as null | ((es: any[]) => any[]),
}));
const spy = vi.hoisted(() => ({ don: undefined as any, lo: undefined as any }));
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  spy.don = vi.fn((...a: Parameters<typeof real.recordAuditEvent>) => real.recordAuditEvent(...a));
  spy.lo = vi.fn(async (db: Parameters<typeof real.recordAuditEvent>[0], es: Es) => {
    const truoc = S.truocLo;
    S.truocLo = null;
    truoc?.();
    return (real as any).recordAuditEvents(db, S.suaEs ? S.suaEs([...es]) : es);
  });
  return { ...real, recordAuditEvent: spy.don, recordAuditEvents: spy.lo };
});

import speakeasy from "speakeasy";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { GENESIS_HASH } from "../services/security/auditChain";

const RUN = `t11al${process.pid}${Date.now().toString(36)}`;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type KenhCaller = ReturnType<typeof import("./scadaKenhRouter").scadaKenhRouter.createCaller>;
type ThatAudit = typeof import("../services/audit/controlAuditService");

let db: Db;
let that!: ThatAudit;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

const factories: string[] = [];
const adapters: number[] = [];
const ad = { a: 0, c: 0 };
/** 200 tag int writable mức 5 của `ad.a` / 100 tag của `ad.c`, id tăng dần. */
let TA: number[] = [];
let TC: number[] = [];

interface Ky {
  kenh: KenhCaller;
  id: number;
  secret: string;
}
let engA!: Ky;
let engC!: Ky;
const ma = (k: Ky) => speakeasy.totp({ secret: k.secret, encoding: "base32" });

async function seedNhaMay(ten: string): Promise<{ mid: number; mid2: number; code: string }> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  const [m2] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code + "-2"}, ${code + " m2"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { mid: Number(m.id), mid2: Number(m2.id), code };
}

let soAd = 0;
async function seedAdapter(machineId: number): Promise<number> {
  const code = `${RUN}-ad${++soAd}`;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  adapters.push(Number(r.id));
  return Number(r.id);
}

async function seedTags(adapterId: number, n: number, tienTo = "t"): Promise<number[]> {
  const rows = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
    SELECT ${adapterId}, ${tienTo} || lpad(g::text, 3, '0'), ${"addr-" + tienTo} || g::text, 'int', true, true, 5 FROM generate_series(0, ${n - 1}) g
    RETURNING id`);
  return rows.map((r) => Number(r.id)).sort((x, y) => x - y);
}

async function seedKySu(ten: string, factoryCode: string): Promise<Ky> {
  const u = await taoNguoiDungTest(ten, "engineer", { tienTo: "t11al", ts: RUN, ten: `T11AL ${ten}` });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${factoryCode})`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`,
  );
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, username: u.username, twoFactorEnabled: true } } as never;
  return { id: u.id, kenh: (await import("./scadaKenhRouter")).scadaKenhRouter.createCaller(ctx), secret: "" };
}

async function moiSecret(k: Ky) {
  k.secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(k.id, k.secret);
  await enable2FA(k.id);
  await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${k.id}`);
}

const inIds = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
async function mucCua(ids: number[]): Promise<number[]> {
  const rows = await dung(sql`SELECT actuation_level AS m FROM device_tags WHERE id IN (${inIds(ids)}) ORDER BY id`);
  return rows.map((r) => (r.m === null ? -1 : Number(r.m)));
}
async function auditTheoLyDo(ld: string) {
  return dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs"
    FROM control_audit_log WHERE reason = ${ld} ORDER BY id`);
}
let dem = 0;
const lyDo = (nhan: string) => `${RUN} ${nhan} ${++dem}`;
const items = (ids: number[], patch: Record<string, unknown>) => ids.map((tagId) => ({ tagId, patch }));

/**
 * Hàm kiểm ĐOẠN: mọi hàng `hash IS NOT NULL` có id ∈ [lo, hi] theo id tăng phải là một đoạn chuỗi LIỀN — `row[i].prevHash === row[i−1].hash`
 * (hàng đầu nối vào hàng băm gần nhất có id < lo) và `hash` tính lại khớp `computeAuditHash`. Trả các vi phạm (rỗng = liền).
 */
async function kiemDoan(lo: number, hi: number): Promise<{ soHang: number; loi: string[]; ids: number[] }> {
  const rows = await dung(sql`SELECT id, "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason, "prevHash", hash, "hashTs"
    FROM control_audit_log WHERE hash IS NOT NULL AND id BETWEEN ${lo} AND ${hi} ORDER BY id`);
  const [truoc] = await dung(sql`SELECT hash FROM control_audit_log WHERE hash IS NOT NULL AND id < ${lo} ORDER BY id DESC LIMIT 1`);
  const loi: string[] = [];
  let prev: string = truoc?.hash ?? GENESIS_HASH;
  for (const r of rows) {
    if (r.prevHash !== prev) loi.push(`#${r.id} prevHash ≠ hash hàng trước (rẽ nhánh)`);
    const h = that.computeAuditHash(
      r.prevHash,
      {
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        actorId: r.actorId === null ? null : Number(r.actorId),
        before: r.beforeJson ?? null,
        after: r.afterJson ?? null,
        reason: r.reason,
      },
      Number(r.hashTs),
    );
    if (h !== r.hash) loi.push(`#${r.id} hash tính lại không khớp`);
    prev = r.hash;
  }
  return { soHang: rows.length, loi, ids: rows.map((r) => Number(r.id)) };
}

/** 20 lượt `recordAuditEvent` ĐƠN LẺ (bản thật, SEC_PLATFORM đang bật) — mỗi lượt một giao dịch riêng trên pool (kết nối khác với giao dịch của lô). */
function banDon(nhan: string, n = 20): Promise<Array<{ id: number }>> {
  return Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const r = await that.recordAuditEvent(db, {
        entityType: "t11al_don",
        entityId: i,
        action: "t11al_don",
        actorId: null,
        before: null,
        after: { i, nhan },
        reason: `${RUN} ${nhan} don`,
      });
      return { id: Number(r!.id) };
    }),
  );
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  that = await vi.importActual<ThatAudit>("../services/audit/controlAuditService");
  const A = await seedNhaMay("a");
  ad.a = await seedAdapter(A.mid);
  ad.c = await seedAdapter(A.mid2);
  TA = await seedTags(ad.a, 200);
  TC = await seedTags(ad.c, 100, "c");
  engA = await seedKySu("ea", A.code);
  engC = await seedKySu("ec", A.code);
}, 120_000);

beforeEach(async () => {
  H.totpThat = true;
  S.truocLo = null;
  S.suaEs = null;
  spy.don.mockClear();
  spy.lo.mockClear();
  await moiSecret(engA);
  await moiSecret(engC);
  await dung(sql`UPDATE device_tags SET channel_kind = NULL, display_name = NULL, display_format = NULL, write_min = NULL, write_max = NULL,
      write_step = NULL, actuation_level = 5 WHERE "adapterId" IN (${ad.a}, ${ad.c})`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (!db) return;
  try {
    await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id IN (${engA?.id ?? 0}, ${engC?.id ?? 0})`);
    if (adapters.length) {
      await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${inIds(adapters)})`);
      await dung(sql`DELETE FROM device_adapters WHERE id IN (${inIds(adapters)})`);
    }
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`);
    await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`);
    await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`);
    await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`);
    await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`);
    await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`);
  } catch (e) {
    console.warn("[t11al] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ T11 — khaiHangLoat: MỘT UPDATE FROM VALUES + MỘT INSERT audit nhiều hàng, chuỗi băm đúng", () => {
  it("SEC_PLATFORM bật — lô 200 mức 5→3: soDoi 200, mức 200/200 = 3, audit +201 (đủ hash); recordAuditEvents ĐÚNG 1 lần × 201, recordAuditEvent 0 lần; thứ tự id = thứ tự chuỗi; đoạn liền (đo thời gian)", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    const ld = lyDo("200");
    const t0 = performance.now();
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(TA, { actuationLevel: 3 }), lyDo: ld, totpCode: ma(engA) });
    const ms = performance.now() - t0;
    console.log(`[t11al] lô 200 tag, SEC_PLATFORM bật: ${ms.toFixed(0)} ms`);
    expect(kq.soDoi).toBe(200);
    expect(await mucCua(TA)).toEqual(TA.map(() => 3));

    expect(spy.lo).toHaveBeenCalledTimes(1);
    expect((spy.lo.mock.calls[0][1] as Es).length).toBe(201);
    expect(spy.don).toHaveBeenCalledTimes(0);

    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(201);
    expect(au.every((r) => r.hash !== null && r.prevHash !== null && r.hashTs !== null)).toBe(true);
    // MỘT hashTs cho cả lô
    expect(new Set(au.map((r) => String(r.hashTs))).size).toBe(1);
    // thứ tự id TƯỜNG MINH = thứ tự phần tử: 200 `scada_kenh_cap_nhat` theo tag id tăng, rồi dòng tổng CUỐI; trong lô prevHash nối liền
    expect(au.slice(0, 200).map((r) => [r.action, Number(r.entityId)])).toEqual(TA.map((id) => ["scada_kenh_cap_nhat", id]));
    expect(au[200]).toMatchObject({ action: "scada_kenh_khai_hang_loat", entityType: "device_adapter", entityId: String(ad.a) });
    for (let i = 1; i < au.length; i++) expect(au[i].prevHash, `#${au[i].id}`).toBe(au[i - 1].hash);
    // nội dung từng dòng như trước T11
    expect(au[0]).toMatchObject({ entityType: "device_tag", actorId: engA.id });
    expect(au[0].beforeJson).toEqual({
      adapterId: ad.a, tagKey: "t000", channelKind: null, displayName: null, displayFormat: null, writeMin: null, writeMax: null, writeStep: null, actuationLevel: 5,
    });
    expect(au[0].afterJson).toEqual({
      adapterId: ad.a, tagKey: "t000", channelKind: null, displayName: null, displayFormat: null, writeMin: null, writeMax: null, writeStep: null, actuationLevel: 3, loId: kq.loId,
    });
    expect(au[200].beforeJson).toBeNull();
    expect(au[200].afterJson).toEqual({ loId: kq.loId, soTag: 200, tagIds: TA });

    const d = await kiemDoan(Number(au[0].id), Number(au[200].id));
    expect(d.loi).toEqual([]);
    // khoá chuỗi giữ tới commit ⇒ KHÔNG hàng băm nào của phiên khác chen vào giữa id của lô
    expect(d.ids).toEqual(au.map((r) => Number(r.id)));
  }, 60_000);

  it("SEC_PLATFORM bật — đủ mọi cột kênh qua UPDATE FROM VALUES (enum / chuỗi / số thực / NULL) và cột không đổi giữ nguyên", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    await dung(sql`UPDATE device_tags SET display_name = 'giu', write_step = 0.5 WHERE id = ${TA[1]}`);
    const lo = [
      { tagId: TA[0], patch: { channelKind: "input_output", displayName: "Tốc độ", displayFormat: "0.00", writeMin: -1.25, writeMax: 1e6, writeStep: 0.1, actuationLevel: 4 } },
      { tagId: TA[1], patch: { writeMin: 0.1 } },
      { tagId: TA[2], patch: { actuationLevel: null } },
    ];
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: lo as never, lyDo: lyDo("cot"), totpCode: ma(engA) });
    expect(kq.soDoi).toBe(3);
    const rows = await dung(sql`SELECT id, channel_kind AS ck, display_name AS dn, display_format AS df, write_min AS wmin, write_max AS wmax, write_step AS ws,
        actuation_level AS al FROM device_tags WHERE id IN (${TA[0]}, ${TA[1]}, ${TA[2]}) ORDER BY id`);
    expect(rows.map((r) => ({ ...r, id: Number(r.id), al: r.al === null ? null : Number(r.al) }))).toEqual([
      { id: TA[0], ck: "input_output", dn: "Tốc độ", df: "0.00", wmin: -1.25, wmax: 1e6, ws: 0.1, al: 4 },
      { id: TA[1], ck: null, dn: "giu", df: null, wmin: 0.1, wmax: null, ws: 0.5, al: 5 },
      { id: TA[2], ck: null, dn: null, df: null, wmin: null, wmax: null, ws: null, al: null },
    ]);
  }, 60_000);

  it("SEC_PLATFORM bật — SONG SONG: lô 200 + 20 recordAuditEvent đơn lẻ từ kết nối khác ⇒ đoạn [min, max] liền, không rẽ nhánh", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    let don!: Promise<Array<{ id: number }>>;
    S.truocLo = () => {
      don = banDon("ss1");
    };
    const ld = lyDo("ss1");
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(TA, { actuationLevel: 3 }), lyDo: ld, totpCode: ma(engA) });
    const dons = await don;
    expect(kq.soDoi).toBe(200);
    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(201);
    const tatCa = [...au.map((r) => Number(r.id)), ...dons.map((r) => r.id)];
    const lo = Math.min(...tatCa);
    const hi = Math.max(...tatCa);
    const d = await kiemDoan(lo, hi);
    expect(d.loi).toEqual([]);
    expect(d.soHang).toBeGreaterThanOrEqual(221);
    // lô là MỘT khối id liền trong chuỗi (không đơn lẻ nào chen giữa)
    const loIds = au.map((r) => Number(r.id));
    expect(d.ids.filter((id) => id >= loIds[0] && id <= loIds[200])).toEqual(loIds);
  }, 60_000);

  it("SEC_PLATFORM bật — HAI lô song song (2 adapter, 2 kỹ sư) + 20 đơn lẻ trên CÙNG chuỗi ⇒ không rẽ nhánh; mỗi lô một khối id liền", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    let don!: Promise<Array<{ id: number }>>;
    S.truocLo = () => {
      don = banDon("ss2");
    };
    const ldA = lyDo("ss2a");
    const ldC = lyDo("ss2c");
    const [kA, kC] = await Promise.all([
      engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(TA, { actuationLevel: 3 }), lyDo: ldA, totpCode: ma(engA) }),
      engC.kenh.khaiHangLoat({ adapterId: ad.c, items: items(TC, { actuationLevel: 4 }), lyDo: ldC, totpCode: ma(engC) }),
    ]);
    const dons = await don;
    expect([kA.soDoi, kC.soDoi]).toEqual([200, 100]);
    expect(spy.lo).toHaveBeenCalledTimes(2);
    expect(spy.don).toHaveBeenCalledTimes(0);
    const auA = await auditTheoLyDo(ldA);
    const auC = await auditTheoLyDo(ldC);
    expect([auA.length, auC.length]).toEqual([201, 101]);
    const tatCa = [...auA, ...auC].map((r) => Number(r.id)).concat(dons.map((r) => r.id));
    const d = await kiemDoan(Math.min(...tatCa), Math.max(...tatCa));
    expect(d.loi).toEqual([]);
    expect(d.soHang).toBeGreaterThanOrEqual(322);
    for (const au of [auA, auC]) {
      const ids = au.map((r) => Number(r.id));
      expect(d.ids.filter((id) => id >= ids[0] && id <= ids[ids.length - 1])).toEqual(ids);
    }
  }, 60_000);

  it("SEC_PLATFORM bật — TẤT-CẢ-HOẶC-KHÔNG: INSERT audit hỏng giữa lô (phần tử #150) ⇒ lỗi; 0 tag đổi, 0 dòng audit, chuỗi vẫn liền (lượt đơn kế tiếp nối đúng)", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    const [dau] = await dung(sql`SELECT coalesce(max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('control_audit_log', 'id')::regclass), 0)), 0) AS id FROM control_audit_log`);
    S.suaEs = (es) => {
      es[150] = { ...es[150], entityType: "x".repeat(65) }; // varchar(64) ⇒ 22001 trên INSERT nhiều hàng
      return es;
    };
    const ld = lyDo("hong");
    const loi = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(TA, { actuationLevel: 3 }), lyDo: ld, totpCode: ma(engA) }).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(Error);
    expect(await mucCua(TA)).toEqual(TA.map(() => 5));
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
    S.suaEs = null;
    const [sau] = await banDon("hong-sau", 1);
    const d = await kiemDoan(Number(dau.id) + 1, sau.id);
    expect(d.loi).toEqual([]);
    expect(d.ids).toContain(sau.id);
  }, 60_000);

  it("SEC_PLATFORM tắt — lô 200 ⇒ audit +201, hash / prevHash / hashTs NULL; recordAuditEvents 1 lần × 201", async () => {
    vi.stubEnv("SEC_PLATFORM", "false");
    const ld = lyDo("tat");
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(TA, { actuationLevel: 3 }), lyDo: ld, totpCode: ma(engA) });
    expect(kq.soDoi).toBe(200);
    expect(await mucCua(TA)).toEqual(TA.map(() => 3));
    expect(spy.lo).toHaveBeenCalledTimes(1);
    expect(spy.don).toHaveBeenCalledTimes(0);
    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(201);
    expect(au.every((r) => r.hash === null && r.prevHash === null && r.hashTs === null)).toBe(true);
    expect(au.filter((r) => r.action === "scada_kenh_cap_nhat")).toHaveLength(200);
  }, 60_000);
});

describe("★★ T11 — recordAuditEvents trực tiếp (bản thật)", () => {
  const mau = (nhan: string, i: number) => ({
    entityType: "t11al_lo",
    entityId: i,
    action: `t11al_${i}`,
    actorId: i % 2 === 0 ? 7 : undefined,
    before: i === 0 ? undefined : { i, long: { a: [1, "b", null] } },
    after: { nhan, i, s: "chữ Việt ✓" },
    reason: i === 3 ? undefined : `${RUN} ${nhan}`,
  });

  it("SEC bật: trả hàng theo id TĂNG, id[i] ↔ es[i] (thứ tự tường minh), MỘT hashTs, prevHash nối liền; nội dung từng cột = recordAuditEvent", async () => {
    vi.stubEnv("SEC_PLATFORM", "true");
    const es = Array.from({ length: 7 }, (_, i) => mau("truc", i));
    const rows = await that.recordAuditEvents(db, es);
    expect(rows.map((r) => r.action)).toEqual(es.map((e) => e.action));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].id).toBeGreaterThan(rows[i - 1].id);
      expect(rows[i].prevHash).toBe(rows[i - 1].hash);
    }
    expect(new Set(rows.map((r) => r.hashTs)).size).toBe(1);
    expect((await kiemDoan(rows[0].id, rows[6].id)).loi).toEqual([]);

    // cùng đầu vào qua recordAuditEvent ⇒ cùng nội dung cột
    const don = await that.recordAuditEvent(db, es[0]);
    const cot = (r: any) => ({ entityType: r.entityType, entityId: r.entityId, action: r.action, actorId: r.actorId, beforeJson: r.beforeJson, afterJson: r.afterJson, reason: r.reason });
    expect(cot(rows[0])).toEqual(cot(don));
    const [dbLo] = await dung(sql`SELECT "beforeJson", "afterJson", reason, "actorId" FROM control_audit_log WHERE id = ${rows[0].id}`);
    const [dbDon] = await dung(sql`SELECT "beforeJson", "afterJson", reason, "actorId" FROM control_audit_log WHERE id = ${don!.id}`);
    expect(dbLo).toEqual(dbDon);
  });

  it("SEC tắt: MỘT INSERT nhiều hàng, hash NULL, trả theo id tăng", async () => {
    vi.stubEnv("SEC_PLATFORM", "false");
    const es = Array.from({ length: 4 }, (_, i) => mau("tat-truc", i));
    const rows = await that.recordAuditEvents(db, es);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.hash === null && r.prevHash === null && r.hashTs === null)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i].id).toBeGreaterThan(rows[i - 1].id);
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(es.map((e) => e.action)));
  });
});
