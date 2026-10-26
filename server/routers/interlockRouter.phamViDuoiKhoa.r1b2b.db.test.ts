/**
 * SCADA R1b-2b-1 Task 10 (mục 47, T5 m-6) — PHẠM VI ADAPTER ĐÍCH của luật interlock kiểm DƯỚI KHOÁ adapter, thứ tự khoá ADAPTER (FOR SHARE) →
 * LUẬT (FOR UPDATE) cho MỌI đường ghi luật (create / update / delete / approve / enable / disable), trên CSDL `_test` THẬT.
 *
 * Trước vá: `luatTrongPhamVi` đọc `machineId` của adapter đích KHÔNG khoá (qua pool, NGOÀI giao dịch) ⇒ một `deviceAdapter.update` đổi máy
 * (sang nhà máy B) commit giữa lượt đọc ấy và lượt ghi ⇒ luật được tạo / sửa / bật … nhắm adapter đã thuộc nhà máy B. Sau vá: `khoaDichLuatTx`
 * khoá adapter đích (cũ + mới, id tăng dần) FOR SHARE TRƯỚC, rồi luật FOR UPDATE (đích đổi giữa chừng ⇒ CONFLICT `scadaKenhThuLai`, hoặc
 * NOT_FOUND nếu luật nay ngoài phạm vi), rồi `luatTrongPhamViDuoiKhoa` trên `machineId` ĐÃ KHOÁ.
 *
 * Khuôn S1 (`phamViDuoiKhoa.r1b2.db.test.ts`, phán quyết K9 — không `vi.mock`): giao dịch "người đổi máy" THẬT khoá hàng adapter FOR UPDATE; thủ
 * tục chạy và BỊ CHẶN ở lượt khoá adapter (đo bằng `pg_blocking_pids`, không đoán theo giờ); người đổi máy đặt `machineId` = máy nhà máy B rồi
 * COMMIT. Người gọi: kỹ sư CHỈ gán nhà máy A (phạm vi THẬT qua `user_factory_assignments`, quyền THẬT qua `checkPermission`).
 *
 * Thứ tự khoá (phán quyết KD-T10 2 + 4): khuôn của `congAdapterTx` (deviceAdapter.update / delete, scadaDiag.tamTat — adapter FOR UPDATE →
 * mọi luật nhắm adapter FOR SHARE) chạy NGƯỢC với một thủ tục interlock khoá luật trước adapter ⇒ 40P01. Ca tất định + stress 10 vòng.
 * Phán quyết 5: protocol của adapter (luật địa chỉ bit `kiemGiaTriDiaChiBit`) đọc khi adapter đã bị KHOÁ.
 * Tiền tố dữ liệu riêng `ilkpvk…` (KHÔNG `r1b2…` — có script dọn khớp `^r1b2`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";
import { dongDauDuyetLuat } from "../testing/dauDuyetInterlock";

const RUN = `ilkpvk${process.pid}${Date.now().toString(36)}`;
const TAC_GIA_GIA = 990_610_001; // createdBy giả của luật gieo (SoD của approve)
const DUYET_GIA = 990_610_002; // approvedBy giả của luật gieo "đã duyệt"

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
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

type Callers = {
  ilk: ReturnType<typeof import("./interlockRouter").interlockRouter.createCaller>;
  deviceAdapter: ReturnType<typeof import("./deviceAdapterRouter").deviceAdapterRouter.createCaller>;
};
let engA!: Callers;
let engAId = 0;
let admin!: Callers;

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
async function seedAdapter(machineId: number, protocol = "stub"): Promise<number> {
  const code = `${RUN}-ad${++soAd}`;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, ${protocol}::otprotocolenum, ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  adapters.push(Number(r.id));
  return Number(r.id);
}

let soLuat = 0;
/** Luật `alert` phạm vi máy A, nhắm adapter `targetAdapterId` (tuỳ chọn: bật / đã duyệt, đóng dấu bám định nghĩa). */
async function seedLuat(targetAdapterId: number, o: { enabled?: boolean; duyet?: boolean } = {}): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", threshold, action,
      "targetAdapterId", enabled, "approvedBy", "createdBy")
    VALUES (${`${RUN}-r${++soLuat}`}, 'machine', ${A.mid}, 'ng_rate', 'gt', '0.5', 'alert', ${targetAdapterId}, ${o.enabled ?? false},
      ${o.duyet ? DUYET_GIA : null}, ${TAC_GIA_GIA}) RETURNING id`);
  if (o.duyet) await dongDauDuyetLuat(Number(r.id));
  return Number(r.id);
}

async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<{ c: Callers; id: number }> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "ilkpvk", ts: RUN, ten: `ILKPVK ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    for (const [cat, mod] of [
      ["interlock", resolvePermissionModule("interlock")],
      ["machine_control", resolvePermissionModule("machine_control")],
    ] as const) {
      await dung(
        sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${cat}, ${mod}, true, true, true, true)`,
      );
    }
  }
  const ctx = { user: { id: u.id, role, name: u.name, username: u.username, twoFactorEnabled: true } } as never;
  return {
    c: {
      ilk: (await import("./interlockRouter")).interlockRouter.createCaller(ctx),
      deviceAdapter: (await import("./deviceAdapterRouter")).deviceAdapterRouter.createCaller(ctx),
    },
    id: u.id,
  };
}

type KetQua<T> = { kq?: T; loi: unknown };
const thuGoi = <T>(p: Promise<T>): Promise<KetQua<T>> => p.then((kq) => ({ kq, loi: null }), (loi) => ({ loi }));

function moTa(loi: unknown): { code?: string; appCode?: string; appParams?: Record<string, unknown>; message?: string } | null {
  if (!loi) return null;
  const meta = readAppErrorMeta(loi);
  return {
    code: (loi as { code?: string }).code,
    appCode: meta?.appCode,
    appParams: meta?.appParams as Record<string, unknown> | undefined,
    message: String((loi as Error).message ?? loi).slice(0, 200),
  };
}

/** Có lỗi postgres 40P01 nằm trong chuỗi `cause` không. */
function laDeadlock(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && typeof e === "object" && i < 6; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "40P01") return true;
    if (/deadlock detected/i.test(String((e as { message?: unknown }).message ?? ""))) return true;
  }
  return false;
}

/** Số tiến trình đang bị `pid` chặn (chờ khoá của `pid`). */
async function soBiChanBoi(pid: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`);
  return Number(r.n);
}

async function choBiChan(pid: number, thongDiep: string): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await soBiChanBoi(pid), thongDiep).toBeGreaterThan(0);
    },
    { timeout: 10_000, interval: 20 },
  );
}

/**
 * Giao dịch "người sửa adapter" THẬT: khoá hàng adapter FOR UPDATE; thủ tục chạy tới khi BỊ CHẶN ở hàng ấy (đã qua kiểm-trước), rồi người sửa
 * chạy `doi` (đổi máy / protocol) và COMMIT.
 */
async function doiAdapterGiuaKiemVaKhoa<T>(adapterId: number, doi: ReturnType<typeof sql>, goi: () => Promise<T>): Promise<KetQua<T>> {
  let moKhoa!: () => void;
  const choMo = new Promise<void>((r) => (moKhoa = r));
  let daKhoa!: (pid: number) => void;
  const choKhoa = new Promise<number>((r) => (daKhoa = r));
  const giu = db.transaction(async (tx) => {
    const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
    await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`);
    daKhoa(Number(p.pid));
    await choMo;
    await tx.execute(doi);
  });
  const pidGiu = await choKhoa;
  const p = thuGoi(goi());
  try {
    await choBiChan(pidGiu, "thủ tục phải BỊ CHẶN ở lượt khoá hàng adapter đích (đã qua kiểm-trước)");
  } finally {
    moKhoa();
    await giu;
  }
  return p;
}
const doiMay = (adapterId: number, mayMoi: number) => sql`UPDATE device_adapters SET "machineId" = ${mayMoi} WHERE id = ${adapterId}`;

/**
 * Giao dịch giữ LUẬT FOR UPDATE và đã đổi `targetAdapterId` của nó (chưa commit); thủ tục chạy, đọc đích CŨ (không khoá), khoá adapter cũ + mới,
 * rồi BỊ CHẶN ở lượt khoá luật; người giữ COMMIT.
 */
async function doiDichLuatGiuaDocVaKhoa<T>(ruleId: number, dichMoi: number, goi: () => Promise<T>): Promise<KetQua<T>> {
  let moKhoa!: () => void;
  const choMo = new Promise<void>((r) => (moKhoa = r));
  let daKhoa!: (pid: number) => void;
  const choKhoa = new Promise<number>((r) => (daKhoa = r));
  const giu = db.transaction(async (tx) => {
    const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
    await tx.execute(sql`UPDATE interlock_rules SET "targetAdapterId" = ${dichMoi} WHERE id = ${ruleId}`);
    daKhoa(Number(p.pid));
    await choMo;
  });
  const pidGiu = await choKhoa;
  const p = thuGoi(goi());
  try {
    await choBiChan(pidGiu, "thủ tục phải BỊ CHẶN ở lượt khoá luật (đã đọc đích cũ, đã khoá adapter)");
  } finally {
    moKhoa();
    await giu;
  }
  return p;
}

/**
 * Khuôn `congAdapterTx` (deviceAdapter.update / delete, scadaDiag.tamTat): ADAPTER FOR UPDATE → (thủ tục interlock bị chặn) → mọi LUẬT nhắm
 * adapter FOR SHARE theo id → COMMIT. Thủ tục khoá luật TRƯỚC adapter ⇒ vòng chờ ⇒ một bên 40P01.
 */
async function khuonCongAdapter<T>(adapterId: number, goi: () => Promise<T>): Promise<{ thuTuc: KetQua<T>; benAdapter: KetQua<void> }> {
  let diTiep!: () => void;
  const choDiTiep = new Promise<void>((r) => (diTiep = r));
  let daKhoa!: (pid: number) => void;
  const choKhoa = new Promise<number>((r) => (daKhoa = r));
  const benAdapter = thuGoi(
    db.transaction(async (tx) => {
      const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
      await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`); // ADAPTER
      daKhoa(Number(p.pid));
      await choDiTiep;
      await tx.execute(sql`SELECT id FROM interlock_rules WHERE "targetAdapterId" = ${adapterId} ORDER BY id FOR SHARE`); // LUẬT
    }),
  );
  const pid = await choKhoa;
  const thuTuc = thuGoi(goi());
  try {
    await choBiChan(pid, "thủ tục interlock phải chờ ở hàng ADAPTER (khoá adapter trước luật)");
  } finally {
    diTiep();
  }
  return { thuTuc: await thuTuc, benAdapter: await benAdapter };
}

async function soAuditCua(actorId: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "actorId" = ${actorId}`);
  return Number(r.n);
}
const hangLuat = async (id: number) =>
  (await dung(sql`SELECT id, description, enabled, "targetAdapterId", "approvedBy" FROM interlock_rules WHERE id = ${id}`))[0];
const soLuatTen = async (ten: string) => Number((await dung(sql`SELECT count(*)::int AS n FROM interlock_rules WHERE name = ${ten}`))[0].n);

const NF_LUAT = { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "interlockRule" } };
const luatMoi = (ten: string, targetAdapterId: number) => ({
  name: `${RUN}-${ten}`,
  scope: "machine" as const,
  machineId: A.mid,
  sourceType: "ng_rate" as const,
  comparisonOperator: "gt" as const,
  threshold: 0.5,
  action: "alert" as const,
  targetAdapterId,
});

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ({ c: engA, id: engAId } = await seedNguoi("ea", "engineer", [A.code]));
  ({ c: admin } = await seedNguoi("ad", "admin", []));
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  await dung(sql`DELETE FROM interlock_events WHERE "ruleId" IN (SELECT id FROM interlock_rules WHERE name LIKE ${like})`).catch(() => undefined);
  await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${like}`).catch(() => undefined);
  if (adapters.length) {
    const ds = sql.join(adapters.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("★★★ mục 47 — adapter đích sang nhà máy B commit giữa kiểm-trước và khoá ⇒ NOT_FOUND interlockRule, không ghi", () => {
  it("create luật nhắm adapter ấy ⇒ NOT_FOUND, 0 luật tạo, 0 audit", async () => {
    const x = await seedAdapter(A.mid);
    const audit0 = await soAuditCua(engAId);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, B.mid), () => engA.ilk.create(luatMoi("c-ngoai", x)));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect(await soLuatTen(`${RUN}-c-ngoai`)).toBe(0);
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("đối chứng DƯƠNG: create khi adapter sang máy KHÁC CÙNG nhà máy A ⇒ tạo được", async () => {
    const x = await seedAdapter(A.mid);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, A.mid2), () => engA.ilk.create(luatMoi("c-trong", x)));
    expect(moTa(r.loi)).toBeNull();
    expect(await soLuatTen(`${RUN}-c-trong`)).toBe(1);
  }, 30_000);

  it("update luật đang nhắm adapter ấy ⇒ NOT_FOUND, hàng không đổi, 0 audit", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const audit0 = await soAuditCua(engAId);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, B.mid), () => engA.ilk.update({ id, description: "sua-ngoai-pham-vi" }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect(await hangLuat(id)).toMatchObject({ description: null, targetAdapterId: x });
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("update ĐỔI đích sang adapter MỚI vừa sang nhà máy B ⇒ NOT_FOUND, đích giữ adapter cũ", async () => {
    const x1 = await seedAdapter(A.mid);
    const x2 = await seedAdapter(A.mid);
    const id = await seedLuat(x1);
    const r = await doiAdapterGiuaKiemVaKhoa(x2, doiMay(x2, B.mid), () => engA.ilk.update({ id, targetAdapterId: x2 }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect((await hangLuat(id)).targetAdapterId).toBe(x1);
  }, 30_000);

  it("đối chứng DƯƠNG: update khi adapter sang máy khác CÙNG nhà máy A ⇒ thành công", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, A.mid2), () => engA.ilk.update({ id, description: "sua-trong-pham-vi" }));
    expect(moTa(r.loi)).toBeNull();
    expect((await hangLuat(id)).description).toBe("sua-trong-pham-vi");
  }, 30_000);

  it("delete ⇒ NOT_FOUND, luật còn, 0 audit", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const audit0 = await soAuditCua(engAId);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, B.mid), () => engA.ilk.delete({ id, reason: "xoa ngoai pham vi" }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect(await hangLuat(id)).toBeTruthy();
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("enable (luật đã duyệt, đang tắt) ⇒ NOT_FOUND, luật vẫn tắt", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x, { duyet: true });
    const token = (await engA.ilk.get({ id })).versionToken;
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, B.mid), () => engA.ilk.enable({ id, expectedVersion: token }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect((await hangLuat(id)).enabled).toBe(false);
  }, 30_000);

  it("disable (luật đang bật) ⇒ NOT_FOUND, luật vẫn bật, 0 audit", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x, { enabled: true, duyet: true });
    const audit0 = await soAuditCua(engAId);
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, B.mid), () => engA.ilk.disable({ id, reason: "tat ngoai pham vi" }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect((await hangLuat(id)).enabled).toBe(true);
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("đối chứng DƯƠNG: disable khi adapter sang máy khác CÙNG nhà máy A ⇒ tắt được", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x, { enabled: true, duyet: true });
    const r = await doiAdapterGiuaKiemVaKhoa(x, doiMay(x, A.mid2), () => engA.ilk.disable({ id, reason: "tat trong pham vi" }));
    expect(moTa(r.loi)).toBeNull();
    expect((await hangLuat(id)).enabled).toBe(false);
  }, 30_000);
});

describe("★★ phán quyết 1 — đích của luật đổi giữa lượt đọc (không khoá) và lượt khoá luật ⇒ CONFLICT thử lại, hoặc NOT_FOUND nếu nay ngoài phạm vi", () => {
  it("đích đổi sang adapter CÙNG nhà máy ⇒ CONFLICT scadaKenhThuLai, hàng giữ đích do bên kia ghi", async () => {
    const x1 = await seedAdapter(A.mid);
    const x2 = await seedAdapter(A.mid);
    const x3 = await seedAdapter(A.mid);
    const id = await seedLuat(x1);
    const r = await doiDichLuatGiuaDocVaKhoa(id, x2, () => engA.ilk.update({ id, targetAdapterId: x3 }));
    expect(moTa(r.loi)).toMatchObject({ code: "CONFLICT", appCode: "OPERATION_FAILED", appParams: { operation: "interlockRule", reason: "scadaKenhThuLai" } });
    expect((await hangLuat(id)).targetAdapterId).toBe(x2);
  }, 30_000);

  it("đích đổi sang adapter nhà máy B (luật nay ngoài phạm vi) ⇒ NOT_FOUND interlockRule (không lộ bằng CONFLICT)", async () => {
    const x1 = await seedAdapter(A.mid);
    const xb = await seedAdapter(B.mid);
    const id = await seedLuat(x1);
    const r = await doiDichLuatGiuaDocVaKhoa(id, xb, () => engA.ilk.disable({ id, reason: "tat khi dich doi" }));
    expect(moTa(r.loi)).toMatchObject(NF_LUAT);
    expect((await hangLuat(id)).targetAdapterId).toBe(xb);
  }, 30_000);
});

describe("★★ phán quyết 5 — protocol của adapter đích (luật địa chỉ bit) đọc DƯỚI khoá adapter", () => {
  it("create reduce_speed 2 lên coil:3 (int): adapter đổi stub → modbus giữa kiểm-trước và khoá ⇒ INTERLOCK_NGOAI_DAI TYPE_MISMATCH, 0 luật", async () => {
    const x = await seedAdapter(A.mid, "stub");
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled") VALUES (${x}, 'icoil', 'coil:3', 'int', true, true)`);
    const r = await doiAdapterGiuaKiemVaKhoa(x, sql`UPDATE device_adapters SET protocol = 'modbus' WHERE id = ${x}`, () =>
      engA.ilk.create({ ...luatMoi("c-bit", x), action: "reduce_speed", commandTag: "icoil", commandValue: 2 } as never),
    );
    expect(moTa(r.loi)).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI", appParams: { lyDo: "TYPE_MISMATCH", tagKey: "icoil" } });
    expect(await soLuatTen(`${RUN}-c-bit`)).toBe(0);
  }, 30_000);
});

describe("★★★ phán quyết 2 + 4 — thứ tự khoá ADAPTER → LUẬT ở mọi đường: không vòng chờ với khuôn congAdapterTx (adapter FOR UPDATE → luật FOR SHARE)", () => {
  it("update / delete / enable / disable / approve: chờ ở hàng ADAPTER, KHÔNG bên nào 40P01, cả hai thành công", async () => {
    const lam: Array<[string, (x: number) => Promise<{ goi: () => Promise<unknown>; kiem: () => Promise<void> }>]> = [
      [
        "update",
        async (x) => {
          const id = await seedLuat(x);
          return { goi: () => engA.ilk.update({ id, description: "khuon-cong" }), kiem: async () => expect((await hangLuat(id)).description).toBe("khuon-cong") };
        },
      ],
      [
        "delete",
        async (x) => {
          const id = await seedLuat(x);
          return { goi: () => engA.ilk.delete({ id, reason: "khuon cong adapter" }), kiem: async () => expect(await hangLuat(id)).toBeUndefined() };
        },
      ],
      [
        "enable",
        async (x) => {
          const id = await seedLuat(x, { duyet: true });
          const token = (await engA.ilk.get({ id })).versionToken;
          return { goi: () => engA.ilk.enable({ id, expectedVersion: token }), kiem: async () => expect((await hangLuat(id)).enabled).toBe(true) };
        },
      ],
      [
        "disable",
        async (x) => {
          const id = await seedLuat(x, { enabled: true, duyet: true });
          return { goi: () => engA.ilk.disable({ id, reason: "khuon cong adapter" }), kiem: async () => expect((await hangLuat(id)).enabled).toBe(false) };
        },
      ],
      [
        "approve",
        async (x) => {
          const id = await seedLuat(x);
          const token = (await admin.ilk.get({ id })).versionToken;
          return { goi: () => admin.ilk.approve({ id, expectedVersion: token }), kiem: async () => expect((await hangLuat(id)).approvedBy).not.toBeNull() };
        },
      ],
    ];
    const sai: string[] = [];
    for (const [ten, dung1] of lam) {
      const x = await seedAdapter(A.mid);
      const { goi, kiem } = await dung1(x);
      const { thuTuc, benAdapter } = await khuonCongAdapter(x, goi);
      if (laDeadlock(benAdapter.loi) || benAdapter.loi) sai.push(`${ten}: bên adapter lỗi ${String(benAdapter.loi).slice(0, 120)}`);
      if (laDeadlock(thuTuc.loi) || thuTuc.loi) sai.push(`${ten}: thủ tục lỗi ${JSON.stringify(moTa(thuTuc.loi))}`);
      if (!thuTuc.loi) await kiem();
    }
    expect(sai).toEqual([]);
  }, 120_000);

  it("stress 10 vòng: interlock.update (sửa mô tả) ∥ interlock.update (đổi đích X↔Y) ∥ deviceAdapter.update (đổi máy X trong nhà máy A) ⇒ 0 lỗi 40P01 / INTERNAL", async () => {
    const x = await seedAdapter(A.mid);
    const y = await seedAdapter(A.mid);
    const r1 = await seedLuat(x);
    const r2 = await seedLuat(x);
    const loiLa: string[] = [];
    const soThanhCong = [0, 0, 0, 0];
    for (let v = 0; v < 10; v++) {
      const kq = await Promise.all([
        thuGoi(engA.ilk.update({ id: r1, description: `vong-${v}` })),
        thuGoi(engA.ilk.update({ id: r2, targetAdapterId: v % 2 === 0 ? y : x })),
        thuGoi(admin.deviceAdapter.update({ id: x, machineId: v % 2 === 0 ? A.mid2 : A.mid })),
        thuGoi(engA.ilk.update({ id: r1, targetAdapterId: v % 2 === 0 ? y : x })),
      ]);
      for (const [i, r] of kq.entries()) {
        if (!r.loi) {
          soThanhCong[i]++;
          continue;
        }
        const m = moTa(r.loi);
        const choPhep = m?.code === "CONFLICT" && m.appParams?.reason === "scadaKenhThuLai";
        if (laDeadlock(r.loi) || !choPhep) loiLa.push(`vòng ${v} #${i}: ${m?.code}/${m?.appCode} ${m?.message}`);
      }
    }
    expect(loiLa).toEqual([]);
    console.info(`[T10] stress 10 vòng — số lần thành công [mô tả r1, đổi đích r2, đổi máy adapter, đổi đích r1] = ${JSON.stringify(soThanhCong)}`);
    expect(soThanhCong[2], "deviceAdapter.update đổi máy phải thật sự chạy (không phải stress rỗng)").toBe(10);
    expect(soThanhCong[1], "đổi đích r2 (không ai tranh đích của r2) ⇒ luôn thành công").toBe(10);
  }, 120_000);

  it("10 vòng: HAI update cùng đổi targetAdapterId của CÙNG luật ⇒ một bên thành công, bên kia CONFLICT scadaKenhThuLai hoặc thành công tuần tự; 0 lỗi 40P01", async () => {
    const x1 = await seedAdapter(A.mid);
    const x2 = await seedAdapter(A.mid);
    const x3 = await seedAdapter(A.mid);
    const id = await seedLuat(x1);
    const loiLa: string[] = [];
    let soConflict = 0;
    for (let v = 0; v < 10; v++) {
      await dung(sql`UPDATE interlock_rules SET "targetAdapterId" = ${x1} WHERE id = ${id}`);
      const [a, b] = await Promise.all([thuGoi(engA.ilk.update({ id, targetAdapterId: x2 })), thuGoi(engA.ilk.update({ id, targetAdapterId: x3 }))]);
      if (a.loi && b.loi) loiLa.push(`vòng ${v}: cả hai lỗi ${JSON.stringify(moTa(a.loi))} / ${JSON.stringify(moTa(b.loi))}`);
      for (const r of [a, b]) {
        if (!r.loi) continue;
        const m = moTa(r.loi);
        if (laDeadlock(r.loi) || !(m?.code === "CONFLICT" && m.appParams?.reason === "scadaKenhThuLai")) loiLa.push(`vòng ${v}: ${JSON.stringify(m)}`);
        else soConflict++;
      }
      const dich = (await hangLuat(id)).targetAdapterId;
      const thang = !a.loi && b.loi ? x2 : a.loi && !b.loi ? x3 : null;
      if (thang !== null && dich !== thang) loiLa.push(`vòng ${v}: đích ${dich} ≠ bên thắng ${thang}`);
      if (thang === null && dich !== x2 && dich !== x3) loiLa.push(`vòng ${v}: đích ${dich} lạ`);
    }
    expect(loiLa).toEqual([]);
    console.info(`[T10] 10 vòng hai update đổi đích: ${soConflict} CONFLICT scadaKenhThuLai, ${10 - soConflict} vòng tuần tự cả hai thành công`);
  }, 120_000);
});
