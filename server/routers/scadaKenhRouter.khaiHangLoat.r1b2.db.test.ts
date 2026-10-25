/**
 * SCADA R1b-2a Task 6 (P1-1) — `scadaKenh.khaiHangLoat` (khai mức HÀNG LOẠT: ≤ 200 tag của MỘT adapter, MỘT mã TOTP, tất-cả-hoặc-không) trên
 * CSDL `_test` THẬT.
 *
 * TOTP: các ca về MÃ (một mã cho 200 tag, lô bị từ chối KHÔNG tiêu mã, thiếu mã, chưa 2FA, mã sai, lô không đổi gì) chạy `kiemXacThucTheoMuc`
 * THẬT (bộ đếm T16 + sổ `totp_consumed` thật, khuôn X1 R1b-1 / khối P1-2 của scadaKenhRouter.db.test.ts): mỗi ca một secret mới, mã từ
 * `speakeasy`. Các ca về LOGIC KIỂM / KHOÁ (nhiều lượt thành công trong một ca, đua 10 vòng) đi qua bộ giả "đã xác thực" (`H.totpThat = false`)
 * vì một mã TOTP chỉ dùng được MỘT lần.
 * Phạm vi do `idsTrongPhamVi` THẬT; quyền do `checkPermission` THẬT; người dùng qua `taoNguoiDungTest`. Oracle độc lập: SELECT thô cho cột tag
 * và `control_audit_log` (WORM — lọc theo lý do của lượt).
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

import speakeasy from "speakeasy";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { readAppErrorMeta } from "../_core/appError";
import { bamDinhNghiaLuat, luatDuyetConHieuLuc } from "../services/interlock/dinhNghiaDuyet";

const RUN = `khl${process.pid}${Date.now().toString(36)}`;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type KenhCaller = ReturnType<typeof import("./scadaKenhRouter").scadaKenhRouter.createCaller>;
type AdapterCaller = ReturnType<typeof import("./deviceAdapterRouter").deviceAdapterRouter.createCaller>;

let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface NhaMay {
  mid: number;
  mid2: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const factories: string[] = [];
const adapters: number[] = [];
const ruleIds: number[] = [];
const ad = { a: 0, a2: 0 };
/** 201 tag int writable của `ad.a`, mức 5, theo id tăng dần. */
let T: number[] = [];
let tagA2 = 0;

let engA!: { kenh: KenhCaller; adapter: AdapterCaller; id: number };
let engB!: KenhCaller;
let engK!: KenhCaller; // kỹ sư nhà máy A CHƯA đăng ký 2FA
let secret = "";
const ma = () => speakeasy.totp({ secret, encoding: "base32" });
const maSai = () => String((Number(ma()) + 500_000) % 1_000_000).padStart(6, "0");

async function seedNhaMay(ten: string): Promise<NhaMay> {
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

/** `n` tag int writable mức 5 (`t000`…) trên một adapter; trả id tăng dần. */
async function seedTags(adapterId: number, n: number, tienTo = "t"): Promise<number[]> {
  const rows = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", actuation_level)
    SELECT ${adapterId}, ${tienTo} || lpad(g::text, 3, '0'), ${"addr-" + tienTo} || g::text, 'int', true, true, 5 FROM generate_series(0, ${n - 1}) g
    RETURNING id`);
  return rows.map((r) => Number(r.id)).sort((x, y) => x - y);
}

async function seedNguoi(ten: string, factoryCodes: string[], hai2fa = true) {
  const u = await taoNguoiDungTest(ten, "engineer", { tienTo: "khl", ts: RUN, ten: `KHL ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  await dung(
    sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`,
  );
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
  const ctx = { user: { id: u.id, role: "engineer", name: u.name, username: u.username, twoFactorEnabled: hai2fa } } as never;
  return {
    id: u.id,
    kenh: (await import("./scadaKenhRouter")).scadaKenhRouter.createCaller(ctx),
    adapter: (await import("./deviceAdapterRouter")).deviceAdapterRouter.createCaller(ctx),
  };
}

type MoTaLoi = { code?: string; appCode?: string; appParams?: Record<string, unknown>; message?: string };
function moTa(loi: unknown): MoTaLoi {
  const meta = readAppErrorMeta(loi);
  return {
    code: (loi as { code?: string }).code,
    appCode: meta?.appCode,
    appParams: meta?.appParams as Record<string, unknown> | undefined,
    message: String((loi as Error).message ?? loi).slice(0, 300),
  };
}
async function loiCua(p: Promise<unknown>): Promise<MoTaLoi> {
  try {
    await p;
  } catch (e) {
    return moTa(e);
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

function laDeadlock(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === "object" && i < 6; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "40P01") return true;
  }
  return false;
}

const inIds = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
async function mucCua(ids: number[]): Promise<Map<number, number | null>> {
  const rows = await dung(sql`SELECT id, actuation_level AS m FROM device_tags WHERE id IN (${inIds(ids)})`);
  return new Map(rows.map((r) => [Number(r.id), r.m === null ? null : Number(r.m)] as const));
}
async function cotTag(id: number) {
  const [r] = await dung(sql`SELECT write_min AS "writeMin", write_max AS "writeMax", write_step AS "writeStep", actuation_level AS "actuationLevel",
      address, "updatedAt" FROM device_tags WHERE id = ${id}`);
  return r;
}
async function auditTheoLyDo(lyDo: string) {
  return dung(sql`SELECT "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
    WHERE reason = ${lyDo} ORDER BY id`);
}
let dem = 0;
const lyDo = (nhan: string) => `${RUN} ${nhan} ${++dem}`;
const items = (ids: number[], patch: Record<string, unknown>) => ids.map((tagId) => ({ tagId, patch }));
const ghim = (id: number, v: unknown, muc: number | null = null) =>
  dung(sql`UPDATE device_tags SET stop_value = ${JSON.stringify(v)}::jsonb, stop_pinned_by = 'test', stop_pinned_at = now(), actuation_level = ${muc}
    WHERE id = ${id}`);

async function luat(o: { tag: string; commandValue: unknown; enabled: boolean; approved?: boolean }): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action,
      "targetAdapterId", "commandTag", "commandValue", enabled, "approvedBy", "requiresHumanConfirm")
    VALUES (${RUN + "-" + o.tag + "-" + ruleIds.length}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${ad.a}, ${o.tag},
      ${JSON.stringify(o.commandValue)}::jsonb, ${o.enabled}, ${o.approved === false ? null : 1}, false) RETURNING id`);
  ruleIds.push(Number(r.id));
  return Number(r.id);
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(A.mid);
  ad.a2 = await seedAdapter(A.mid2); // adapter KHÁC trong cùng nhà máy A
  T = await seedTags(ad.a, 201);
  [tagA2] = await seedTags(ad.a2, 1, "x");
  engA = await seedNguoi("ea", [A.code]);
  engB = (await seedNguoi("eb", [B.code])).kenh;
  engK = (await seedNguoi("ek", [A.code], false)).kenh;
}, 120_000);

beforeEach(async () => {
  H.totpThat = true;
  secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(engA.id, secret);
  await enable2FA(engA.id);
  await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${engA.id}`);
  await dung(sql`UPDATE device_tags SET channel_kind = NULL, display_name = NULL, display_format = NULL, write_min = NULL, write_max = NULL,
      write_step = NULL, actuation_level = 5, stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL, address = 'addr-' || "tagKey"
    WHERE "adapterId" IN (${ad.a}, ${ad.a2})`);
});

afterEach(async () => {
  if (ruleIds.length) await dung(sql`DELETE FROM interlock_rules WHERE id IN (${inIds(ruleIds)})`);
  ruleIds.length = 0;
});

afterAll(async () => {
  if (!db) return;
  try {
    await dung(sql`DELETE FROM totp_khoa_sai WHERE user_id = ${engA.id}`);
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
    console.warn("[khl] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ khaiHangLoat — MỘT mã TOTP thật cho ≤ 200 tag, audit từng tag + một dòng tổng", () => {
  it("200 tag mức 5 → 3, một mã ⇒ soDoi 200, mucHieuLuc 3; audit +201 (200 `scada_kenh_cap_nhat` cùng loId + 1 tổng); mã đã tiêu ⇒ lần hai TOTP_INVALID", async () => {
    const ids = T.slice(0, 200);
    const ld = lyDo("200");
    const m = ma();
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids, { actuationLevel: 3 }), lyDo: ld, totpCode: m });
    expect(kq.soDoi).toBe(200);
    expect(kq.soGiuNguyen).toBe(0);
    expect(kq.ketQua).toHaveLength(200);
    expect(kq.ketQua.every((r) => r.changed && r.mucHieuLuc === 3)).toBe(true);
    expect(kq.ketQua.map((r) => r.tagId)).toEqual(ids);
    const muc = await mucCua(ids);
    expect([...muc.values()].every((v) => v === 3)).toBe(true);
    expect((await mucCua([T[200]])).get(T[200]), "tag ngoài lô không đổi").toBe(5);

    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(201);
    const tung = au.filter((r) => r.action === "scada_kenh_cap_nhat");
    expect(tung).toHaveLength(200);
    expect(new Set(tung.map((r) => r.afterJson.loId))).toEqual(new Set([kq.loId]));
    expect(tung.every((r) => r.entityType === "device_tag" && r.actorId === engA.id && r.beforeJson.actuationLevel === 5 && r.afterJson.actuationLevel === 3)).toBe(true);
    expect(tung.map((r) => Number(r.entityId)).sort((x, y) => x - y)).toEqual(ids);
    const tong = au.filter((r) => r.action === "scada_kenh_khai_hang_loat");
    expect(tong).toHaveLength(1);
    expect(tong[0]).toMatchObject({ entityType: "device_adapter", entityId: String(ad.a), actorId: engA.id });
    expect(tong[0].afterJson).toEqual({ loId: kq.loId, soTag: 200, tagIds: ids });

    // MỘT mã dùng MỘT lần: lô kế tiếp cùng mã ⇒ TOTP_INVALID, không đổi gì
    const lai = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids.slice(0, 3), { actuationLevel: 4 }), lyDo: lyDo("lai"), totpCode: m }));
    expect(lai).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID" });
    expect([...(await mucCua(ids.slice(0, 3))).values()]).toEqual([3, 3, 3]);
  }, 60_000);

  it("201 tag ⇒ QUA_NHIEU_KENH_DA_KHAI {soTag 201, toiDa 200}, 0 đổi, mã CHƯA tiêu (dùng được cho lượt hợp lệ kế tiếp)", async () => {
    const m = ma();
    const ld = lyDo("201");
    const e = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(T, { actuationLevel: 3 }), lyDo: ld, totpCode: m }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "QUA_NHIEU_KENH_DA_KHAI", appParams: { soTag: 201, toiDa: 200 } });
    expect([...(await mucCua(T)).values()].every((v) => v === 5)).toBe(true);
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(T.slice(0, 3), { actuationLevel: 3 }), lyDo: lyDo("201-ok"), totpCode: m });
    expect(kq.soDoi).toBe(3);
  }, 60_000);

  it("★ Review Focus 1 — lô 200 có #137 đang ghim DỪNG 0 + patch writeMin 5 ⇒ STOP_PIN_NGOAI_DAI {tagId #137}; 0 đổi; 0 audit; CÙNG mã dùng được cho lượt hợp lệ kế tiếp", async () => {
    const ids = T.slice(0, 200);
    const t137 = ids[137];
    await ghim(t137, 0, 5);
    const lo = ids.map((tagId) => ({ tagId, patch: tagId === t137 ? { writeMin: 5 } : { actuationLevel: 3 as const } }));
    const m = ma();
    const ld = lyDo("rf1");
    const e = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: lo, lyDo: ld, totpCode: m }));
    expect(e).toMatchObject({
      code: "BAD_REQUEST",
      appCode: "STOP_PIN_NGOAI_DAI",
      appParams: expect.objectContaining({ tagId: t137, tagKey: "t137", stopValue: "0", lyDo: "OUT_OF_RANGE" }),
    });
    expect([...(await mucCua(ids)).values()].every((v) => v === 5), "tất-cả-hoặc-không: 136 tag ĐỨNG TRƯỚC #137 cũng không đổi").toBe(true);
    expect((await cotTag(t137)).writeMin).toBeNull();
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids.slice(0, 2), { actuationLevel: 3 }), lyDo: lyDo("rf1-ok"), totpCode: m });
    expect(kq.soDoi).toBe(2);
  }, 60_000);

  it("thiếu mã ⇒ SCADA_CONFIG_TOTP_REQUIRED; mã sai ⇒ SCADA_CONFIG_TOTP_INVALID — 0 đổi, 0 audit", async () => {
    const ids = T.slice(0, 5);
    const ld1 = lyDo("can");
    expect(await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids, { actuationLevel: 3 }), lyDo: ld1 }))).toMatchObject({
      code: "PRECONDITION_FAILED",
      appCode: "SCADA_CONFIG_TOTP_REQUIRED",
    });
    const ld2 = lyDo("sai");
    expect(
      await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids, { actuationLevel: 3 }), lyDo: ld2, totpCode: maSai() })),
    ).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID" });
    expect([...(await mucCua(ids)).values()].every((v) => v === 5)).toBe(true);
    expect(await auditTheoLyDo(ld1)).toHaveLength(0);
    expect(await auditTheoLyDo(ld2)).toHaveLength(0);
  });

  it("người CHƯA đăng ký 2FA ⇒ SCADA_CONFIG_TOTP_NOT_ENROLLED (không phụ thuộc cờ env), 0 đổi", async () => {
    const goc = { b: process.env.AUTH_2FA_BAT_BUOC, s: process.env.ACTUATION_STEPUP_2FA };
    vi.stubEnv("AUTH_2FA_BAT_BUOC", "0");
    vi.stubEnv("ACTUATION_STEPUP_2FA", "false");
    try {
      const e = await loiCua(engK.khaiHangLoat({ adapterId: ad.a, items: items(T.slice(0, 3), { actuationLevel: 3 }), lyDo: lyDo("k2fa"), totpCode: "123456" }));
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_NOT_ENROLLED" });
      expect([...(await mucCua(T.slice(0, 3))).values()]).toEqual([5, 5, 5]);
    } finally {
      vi.stubEnv("AUTH_2FA_BAT_BUOC", goc.b ?? "");
      vi.stubEnv("ACTUATION_STEPUP_2FA", goc.s ?? "");
    }
  });

  it("lô KHÔNG đổi gì (mức 5 → 5) ⇒ không đòi mã, soDoi 0, không audit", async () => {
    const ids = T.slice(0, 10);
    const ld = lyDo("noop");
    const kq = await engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids, { actuationLevel: 5 }), lyDo: ld });
    expect(kq).toMatchObject({ soDoi: 0, soGiuNguyen: 10 });
    expect(kq.ketQua.every((r) => !r.changed && r.mucHieuLuc === 5)).toBe(true);
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ khaiHangLoat — kiểm nhất quán TỪNG tag (hàm chung với capNhat), tất-cả-hoặc-không", () => {
  beforeEach(() => {
    H.totpThat = false; // nhiều lượt thành công / ca — TOTP không phải đối tượng của khối này
  });

  it("★ Review Focus 1 — lô có #42 đang ghim DỪNG ở mức 1, nâng lên 3 (hoặc bỏ khai ⇒ 5) ⇒ STOP_PIN_GO_TRUOC {tagId #42}; 0 đổi; capNhat CÙNG patch ⇒ CÙNG mã", async () => {
    const ids = T.slice(0, 60);
    const t42 = ids[42];
    await ghim(t42, 0, 1);
    for (const actuationLevel of [3, null] as const) {
      const ld = lyDo("go-truoc");
      const e = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(ids, { actuationLevel }), lyDo: ld }));
      expect(e, `mức ${actuationLevel}`).toMatchObject({
        code: "BAD_REQUEST",
        appCode: "STOP_PIN_GO_TRUOC",
        appParams: { ma: "STOP_PIN_GO_TRUOC", tagKey: "t042", stopValue: "0", tagId: t42 },
      });
      const muc = await mucCua(ids);
      expect(muc.get(t42)).toBe(1);
      expect([...muc.entries()].filter(([id]) => id !== t42).every(([, v]) => v === 5), "0 đổi").toBe(true);
      expect(await auditTheoLyDo(ld)).toHaveLength(0);
    }
    const c = await loiCua(engA.kenh.capNhat({ tagId: t42, patch: { actuationLevel: 3 }, lyDo: lyDo("go-truoc-capnhat") }));
    expect(c).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_GO_TRUOC", appParams: { tagKey: "t042", tagId: t42 } });
    expect((await mucCua([t42])).get(t42)).toBe(1);
  });

  it("đối chứng DƯƠNG của gỡ-ghim-trước: tag ghim mức 1 chỉ đổi tên hiển thị / giữ mức 1 ⇒ OK; tag ghim mức 3 hạ về 1 ⇒ OK; tag KHÔNG ghim mức 1 → 3 ⇒ OK", async () => {
    const [g1, g3, k1] = T.slice(0, 3);
    await ghim(g1, 0, 1);
    await ghim(g3, 0, 3);
    await dung(sql`UPDATE device_tags SET actuation_level = 1 WHERE id = ${k1}`);
    const kq = await engA.kenh.khaiHangLoat({
      adapterId: ad.a,
      items: [
        { tagId: g1, patch: { displayName: "Dừng băng tải", actuationLevel: 1 } },
        { tagId: g3, patch: { actuationLevel: 1 } },
        { tagId: k1, patch: { actuationLevel: 3 } },
      ],
      lyDo: lyDo("go-truoc-duong"),
    });
    expect(kq.soDoi).toBe(3);
    expect([...(await mucCua([g1, g3, k1])).values()]).toEqual([1, 1, 3]);
  });

  it("luật interlock BẬT nhắm tag X `commandValue 50`, patch writeMax 10 ⇒ INTERLOCK_NGOAI_DAI {ruleId, tagId X}; 0 đổi", async () => {
    const ids = T.slice(0, 20);
    const x = ids[11];
    const ruleId = await luat({ tag: "t011", commandValue: 50, enabled: true });
    const lo = ids.map((tagId) => ({ tagId, patch: tagId === x ? { writeMax: 10 } : { actuationLevel: 3 as const } }));
    const e = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: lo, lyDo: lyDo("ilk") }));
    expect(e).toMatchObject({
      code: "BAD_REQUEST",
      appCode: "INTERLOCK_NGOAI_DAI",
      appParams: expect.objectContaining({ ruleId, tagId: x, tagKey: "t011", lyDo: "OUT_OF_RANGE" }),
    });
    expect([...(await mucCua(ids)).values()].every((v) => v === 5)).toBe(true);
    expect((await cotTag(x)).writeMax).toBeNull();
  });

  it("kiểm hợp lệ (min > max) trên một tag ⇒ INVALID_VALUE mang tagId; 0 đổi", async () => {
    const ids = T.slice(0, 5);
    const lo = ids.map((tagId, i) => ({ tagId, patch: i === 3 ? { writeMin: 10, writeMax: 1 } : { actuationLevel: 3 as const } }));
    const e = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: lo, lyDo: lyDo("hl") }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "writeMin", reason: "scadaDaiMinLonHonMax", tagId: ids[3] } });
    expect([...(await mucCua(ids)).values()].every((v) => v === 5)).toBe(true);
  });

  it("kiểm RẺ đúng thứ tự (trước DB): trần 200 → tagId trùng → patch rỗng", async () => {
    const tren = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: [...items(T, {}), { tagId: T[0], patch: {} }], lyDo: lyDo("re") }));
    expect(tren).toMatchObject({ appCode: "QUA_NHIEU_KENH_DA_KHAI", appParams: { soTag: 202 } });
    const trung = await loiCua(
      engA.kenh.khaiHangLoat({
        adapterId: ad.a,
        items: [{ tagId: T[0], patch: {} }, { tagId: T[1], patch: { actuationLevel: 3 } }, { tagId: T[1], patch: { actuationLevel: 4 } }],
        lyDo: lyDo("re"),
      }),
    );
    expect(trung).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "items", reason: "scadaKenhTagTrung", tagId: T[1] } });
    const rong = await loiCua(
      engA.kenh.khaiHangLoat({ adapterId: ad.a, items: [{ tagId: T[0], patch: { actuationLevel: 3 } }, { tagId: T[2], patch: {} }], lyDo: lyDo("re") }),
    );
    expect(rong).toMatchObject({ code: "BAD_REQUEST", appCode: "FIELD_REQUIRED", appParams: { field: "patch", tagId: T[2] } });
    expect([...(await mucCua(T.slice(0, 3))).values()]).toEqual([5, 5, 5]);
  });

  it("★ luật ĐÃ DUYỆT nhắm tag trong lô VẪN còn duyệt sau khai mức + dải (bám định nghĩa không đổi); đối chứng: đổi address ⇒ hết duyệt", async () => {
    const y = T[7];
    const ruleId = await luat({ tag: "t007", commandValue: 2, enabled: false });
    const r = { id: ruleId, sourceType: "ng_rate", machineId: null, sourceKey: null, targetAdapterId: ad.a, commandTag: "t007" } as const;
    const bam = await bamDinhNghiaLuat(db as never, r as never);
    await dung(sql`UPDATE interlock_rules SET "approvedDefHash" = ${bam} WHERE id = ${ruleId}`);
    const truoc = await luatDuyetConHieuLuc(db as never, { ...r, approvedBy: 1, approvedDefHash: bam } as never);
    expect(truoc, "bộ dựng: luật phải ĐANG còn duyệt trước lô").toBe(true);
    const kq = await engA.kenh.khaiHangLoat({
      adapterId: ad.a,
      items: [{ tagId: y, patch: { actuationLevel: 3, channelKind: "output", writeMin: 0, writeMax: 100, writeStep: 1, displayName: "SP" } }, ...items(T.slice(8, 12), { actuationLevel: 4 })],
      lyDo: lyDo("duyet"),
    });
    expect(kq.soDoi).toBe(5);
    expect(await bamDinhNghiaLuat(db as never, r as never)).toBe(bam);
    expect(await luatDuyetConHieuLuc(db as never, { ...r, approvedBy: 1, approvedDefHash: bam } as never)).toBe(true);
    await dung(sql`UPDATE device_tags SET address = 'addr-khac' WHERE id = ${y}`);
    expect(await luatDuyetConHieuLuc(db as never, { ...r, approvedBy: 1, approvedDefHash: bam } as never), "oracle phải nhạy: đổi address ⇒ hết duyệt").toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ khaiHangLoat — phạm vi + adapter (Q6: một adapter mỗi lô)", () => {
  beforeEach(() => {
    H.totpThat = false;
  });

  it("tag của adapter KHÁC (cùng nhà máy) trong lô ⇒ NOT_FOUND deviceTag cho CẢ lô; tag không tồn tại ⇒ cùng lỗi", async () => {
    const ids = T.slice(0, 4);
    const khac = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items([...ids, tagA2], { actuationLevel: 3 }), lyDo: lyDo("khac") }));
    expect(khac).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    const khong = await loiCua(engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items([...ids, 2_000_000_000], { actuationLevel: 3 }), lyDo: lyDo("khong") }));
    expect({ code: khong.code, appCode: khong.appCode, appParams: khong.appParams }).toEqual({ code: khac.code, appCode: khac.appCode, appParams: khac.appParams });
    expect([...(await mucCua([...ids, tagA2])).values()].every((v) => v === 5)).toBe(true);
  });

  it("kỹ sư nhà máy B trên adapter của A ⇒ NOT_FOUND adapter, GIỐNG HỆT adapter không tồn tại; 0 đổi", async () => {
    const ngoai = await loiCua(engB.khaiHangLoat({ adapterId: ad.a, items: items(T.slice(0, 3), { actuationLevel: 3 }), lyDo: lyDo("eb") }));
    const khong = await loiCua(engB.khaiHangLoat({ adapterId: 2_000_000_000, items: items(T.slice(0, 3), { actuationLevel: 3 }), lyDo: lyDo("eb") }));
    expect(ngoai).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect({ ...ngoai, message: undefined }).toEqual({ ...khong, message: undefined });
    expect([...(await mucCua(T.slice(0, 3))).values()]).toEqual([5, 5, 5]);
  });

  it("★ phạm vi kiểm LẠI dưới khoá adapter: adapter bị đổi sang máy nhà máy B (giao dịch khác giữ FOR UPDATE rồi commit) ⇒ khaiHangLoat CHỜ rồi NOT_FOUND, 0 đổi", async () => {
    const adM = await seedAdapter(A.mid);
    const tM = await seedTags(adM, 3, "m");
    let moKhoa!: () => void;
    const choMo = new Promise<void>((r) => (moKhoa = r));
    let daKhoa!: (pid: number) => void;
    const choKhoa = new Promise<number>((r) => (daKhoa = r));
    const giu = db.transaction(async (tx) => {
      const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
      await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adM} FOR UPDATE`);
      daKhoa(Number(p.pid));
      await choMo;
      await tx.execute(sql`UPDATE device_adapters SET "machineId" = ${B.mid} WHERE id = ${adM}`);
    });
    const pid = await choKhoa;
    const p = engA.kenh.khaiHangLoat({ adapterId: adM, items: items(tM, { actuationLevel: 3 }), lyDo: lyDo("duoi-khoa") }).then(
      (kq) => ({ kq, loi: null as unknown }),
      (loi) => ({ kq: null, loi }),
    );
    try {
      await vi.waitFor(
        async () => {
          const [r] = await dung(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`);
          expect(Number(r.n), "khaiHangLoat phải BỊ CHẶN ở lượt khoá hàng adapter").toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 20 },
      );
    } finally {
      moKhoa();
      await giu;
    }
    const r = await p;
    expect(r.loi ? moTa(r.loi) : r.kq).toMatchObject({ code: "NOT_FOUND", appParams: { entity: "adapter" } });
    expect([...(await mucCua(tM)).values()]).toEqual([5, 5, 5]);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ khaiHangLoat — khoá: đua với tags.update, thứ tự LUẬT → TAG", () => {
  beforeEach(() => {
    H.totpThat = false;
  });

  it("đua: `deviceAdapter.tags.update` trỏ lại #5 song song với lô chứa #5, 10 lượt ⇒ không 40P01 / INTERNAL lọt ra, cả hai bên thành công", async () => {
    const t5 = T[5];
    const lo = [T[3], t5, T[7], T[150]];
    const loi: string[] = [];
    for (let i = 0; i < 10; i++) {
      const [u, k] = await Promise.allSettled([
        engA.adapter.tags.update({ id: t5, address: `addr-dua-${i}` }),
        engA.kenh.khaiHangLoat({ adapterId: ad.a, items: items(lo, { actuationLevel: i % 2 === 0 ? 3 : 4 }), lyDo: lyDo(`dua${i}`) }),
      ]);
      for (const [ten, r] of [["tags.update", u], ["khaiHangLoat", k]] as const) {
        if (r.status === "rejected") loi.push(`${i} ${ten}: ${laDeadlock(r.reason) ? "40P01 " : ""}${JSON.stringify(moTa(r.reason))}`);
      }
    }
    expect(loi).toEqual([]);
    expect((await cotTag(t5)).address).toBe("addr-dua-9");
    expect((await mucCua([t5])).get(t5)).toBe(4);
  }, 60_000);

  it("thứ tự khoá LUẬT → TAG: giao dịch giữ luật FOR UPDATE rồi xin tag FOR SHARE (khuôn interlockRouter) KHÔNG tạo vòng chờ với khaiHangLoat", async () => {
    const ruleId = await luat({ tag: "t020", commandValue: 50, enabled: true });
    const postgres = (await import("postgres")).default;
    const raw = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      let tagLock = "";
      let xong: unknown;
      await raw
        .begin(async (t) => {
          await t`SET LOCAL lock_timeout = '5s'`;
          await t`SELECT id FROM interlock_rules WHERE id = ${ruleId} FOR UPDATE`;
          void engA.kenh
            .khaiHangLoat({ adapterId: ad.a, items: items([T[19], T[20], T[21]], { writeMin: 0, writeMax: 100 }), lyDo: lyDo("khoa") })
            .then(
              (v) => (xong = v),
              (e) => (xong = e),
            );
          await new Promise((res) => setTimeout(res, 600)); // khaiHangLoat đã chạy tới chỗ chờ khoá luật
          try {
            await t`SELECT id FROM device_tags WHERE id = ${T[20]} FOR SHARE`;
            tagLock = "ok";
          } catch (e) {
            tagLock = String((e as { code?: string }).code ?? e);
          }
        })
        .catch(() => undefined);
      await vi.waitFor(() => expect(xong).toBeDefined(), { timeout: 10_000 });
      expect(tagLock).toBe("ok");
      expect(xong).toMatchObject({ soDoi: 3 });
      expect(await cotTag(T[20])).toMatchObject({ writeMin: 0, writeMax: 100 });
    } finally {
      await raw.end({ timeout: 5 });
    }
  }, 30_000);
});
