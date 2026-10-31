/**
 * SCADA R1b-2b-2a Task 4 (mục 62) — `interlock.resolveEvent` kiểm phạm vi DƯỚI KHOÁ, thứ tự khoá dự án ADAPTER (FOR SHARE) → LUẬT (FOR SHARE) →
 * hàng sự kiện (UPDATE) → chuỗi audit, KHÔNG gọi pool (`getDb`) trong giao dịch — trên CSDL `_test` THẬT.
 *
 * Trước vá: trong giao dịch, `resolveEvent` đọc luật KHÔNG khoá rồi gọi `luatTrongPhamVi(ctx, luat)` — lượt đọc `machineId` của adapter đích
 * qua POOL (`adapterTrongPhamVi`, `idsTrongPhamVi` — ngoài giao dịch, không khoá): một `deviceAdapter.update` đổi máy của adapter đích sang nhà
 * máy B commit giữa lượt đọc ấy và lượt ghi ⇒ kỹ sư nhà máy A đóng được sự kiện của luật nay nhắm nhà máy B; và mỗi lượt gọi pool trong giao
 * dịch giữ một kết nối chờ một kết nối khác (cạn pool ⇒ treo). Sau vá: `phamVi = layPhamViGhiLuat(ctx)` TRƯỚC giao dịch; trong giao dịch
 * `khoaDichLuatTx(tx, ruleId, [], phamVi, "share")` rồi `luatTrongPhamViDuoiKhoa` trên `machineId` ĐÃ KHOÁ.
 *
 * Khuôn S1 (`interlockRouter.phamViDuoiKhoa.r1b2b.db.test.ts`): giao dịch đối thủ THẬT giữ khoá hàng; thủ tục chạy và BỊ CHẶN ở hàng ấy (đo bằng
 * `pg_blocking_pids`, không đoán theo giờ); đối thủ đổi rồi COMMIT. Người gọi: kỹ sư CHỈ gán nhà máy A (phạm vi THẬT qua
 * `user_factory_assignments`, quyền THẬT qua `checkPermission`).
 *
 * kiem-dinh KD-C1 (thắng chữ của task): ca TẤT ĐỊNH giữ chéo thay cho / bổ sung ca xác suất 10 vòng —
 *   • đối thủ theo ĐÚNG thứ tự dự án: ADAPTER FOR UPDATE → (thủ tục bị chặn ở ADAPTER) → LUẬT FOR UPDATE. Thủ tục khoá luật TRƯỚC adapter (đột
 *     biến) ⇒ đang giữ luật FOR SHARE khi chờ adapter ⇒ vòng chờ chắc chắn ⇒ Postgres huỷ một bên 40P01. (Khuôn `khuonCongAdapter` của S1 khoá
 *     luật FOR SHARE ở bước 2 — tương thích với FOR SHARE của `resolveEvent` ⇒ KHÔNG lộ thứ tự ở đây; nên đối thủ khoá luật FOR UPDATE.)
 *   • luật bị XOÁ / đổi adapter đích giữa lượt đọc KHÔNG khoá (`khoaDichLuatTx` bước 1) và lượt khoá luật ⇒ NOT_FOUND interlockEvent / CONFLICT
 *     `scadaKenhThuLai` đúng.
 *
 * Lệch so với chữ của brief (đo trên `_test`): (1) `interlock_events."ruleId"` là NOT NULL (không FK) ⇒ không có "sự kiện ruleId NULL" thật; ca
 * tương đương = sự kiện mồ côi (luật của nó đã xoá): kỹ sư có phạm vi ⇒ NOT_FOUND, admin ⇒ `resolved` (như hôm nay). (2) Không có trạng thái
 * `open` — sự kiện gieo mang mặc định `fired`; "vẫn mở" ≡ vẫn `fired`.
 *
 * Đếm `getDb`: `../db/connection` bọc bản THẬT (`importOriginal`; `server/db` = `export * from "./connection"` nên lượt gọi qua `../db` của router
 * và `_adapterPhamVi` cũng đi qua bọc này). `db.transaction` của bản bọc đánh dấu "đang trong giao dịch"; giao dịch đối thủ / truy vấn của test
 * dùng getDb THẬT (`H.getDbThat`) nên không lẫn vào số đếm.
 * Tiền tố dữ liệu riêng `ilkrvk…` (KHÔNG `r1b2…` — có script dọn khớp `^r1b2`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { resolvePermissionModule } from "@shared/permissions";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

const H = vi.hoisted(() => ({
  /** số giao dịch (mở qua getDb ĐÃ BỌC) đang chạy */
  trongGd: 0,
  /** số lượt gọi getDb khi `trongGd > 0` */
  goiTrongGd: 0,
  /** tổng lượt gọi getDb đã bọc */
  goiTong: 0,
  getDbThat: null as null | (() => Promise<unknown>),
}));

vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  H.getDbThat = real.getDb as never;
  const boc = (d: any) =>
    d &&
    new Proxy(d, {
      get(t, p) {
        if (p === "transaction") {
          return (cb: (tx: unknown) => Promise<unknown>, cfg?: unknown) =>
            t.transaction(async (tx: unknown) => {
              H.trongGd++;
              try {
                return await cb(tx);
              } finally {
                H.trongGd--;
              }
            }, cfg);
        }
        const v = Reflect.get(t, p, t);
        return typeof v === "function" && p !== "constructor" ? v.bind(t) : v;
      },
    });
  return {
    ...real,
    getDb: (async (...a: Parameters<typeof real.getDb>) => {
      H.goiTong++;
      if (H.trongGd > 0) H.goiTrongGd++;
      return boc(await real.getDb(...a));
    }) as typeof real.getDb,
  };
});

const RUN = `ilkrvk${process.pid}${Date.now().toString(36)}`;
const TAC_GIA_GIA = 990_620_001; // createdBy giả của luật gieo

type Db = NonNullable<Awaited<ReturnType<typeof import("../db/connection").getDb>>>;
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
const suKien: number[] = [];

type Callers = {
  ilk: ReturnType<typeof import("./interlockRouter").interlockRouter.createCaller>;
};
let engA!: Callers;
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
async function seedAdapter(machineId: number): Promise<number> {
  const code = `${RUN}-ad${++soAd}`;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub'::otprotocolenum, ${"stub://" + code}, 500, false, 'disabled') RETURNING id`);
  adapters.push(Number(r.id));
  return Number(r.id);
}

let soLuat = 0;
/** Luật `alert` phạm vi máy A, nhắm adapter `targetAdapterId`. */
async function seedLuat(targetAdapterId: number): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "machineId", "sourceType", "comparisonOperator", threshold, action,
      "targetAdapterId", enabled, "createdBy")
    VALUES (${`${RUN}-r${++soLuat}`}, 'machine', ${A.mid}, 'ng_rate', 'gt', '0.5', 'alert', ${targetAdapterId}, false, ${TAC_GIA_GIA}) RETURNING id`);
  return Number(r.id);
}

/** Sự kiện (trạng thái mặc định `fired`) của luật `ruleId`. id do sequence cấp. */
async function seedSuKien(ruleId: number): Promise<number> {
  const [r] = await dung(sql`INSERT INTO interlock_events ("ruleId", "sourceType", action) VALUES (${ruleId}, 'ng_rate', 'alert') RETURNING id`);
  suKien.push(Number(r.id));
  return Number(r.id);
}

async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<Callers> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "ilkrvk", ts: RUN, ten: `ILKRVK ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'interlock', ${resolvePermissionModule("interlock")}, true, true, true, true)`,
    );
  }
  const ctx = { user: { id: u.id, role, name: u.name, username: u.username, twoFactorEnabled: true } } as never;
  return { ilk: (await import("./interlockRouter")).interlockRouter.createCaller(ctx) };
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
 * Giao dịch đối thủ THẬT: `giu(tx)` lấy khoá; thủ tục chạy tới khi BỊ CHẶN bởi đối thủ (`pg_blocking_pids`); rồi đối thủ chạy `sau(tx)` và COMMIT.
 */
async function doiThuGiuRoiDoi<T>(
  giu: (tx: Db) => Promise<unknown>,
  sau: (tx: Db) => Promise<unknown>,
  goi: () => Promise<T>,
  thongDiep: string,
): Promise<{ thuTuc: KetQua<T>; doiThu: KetQua<unknown> }> {
  let diTiep!: () => void;
  const choDiTiep = new Promise<void>((r) => (diTiep = r));
  let daKhoa!: (pid: number) => void;
  const choKhoa = new Promise<number>((r) => (daKhoa = r));
  const doiThu = thuGoi(
    db.transaction(async (tx) => {
      const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
      await giu(tx as unknown as Db);
      daKhoa(Number(p.pid));
      await choDiTiep;
      await sau(tx as unknown as Db);
    }),
  );
  const pid = await choKhoa;
  const thuTuc = thuGoi(goi());
  try {
    await choBiChan(pid, thongDiep);
  } finally {
    diTiep();
  }
  return { thuTuc: await thuTuc, doiThu: await doiThu };
}

const khoaAdapterUpdate = (adapterId: number) => (tx: Db) => tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`);
const doiMay = (adapterId: number, mayMoi: number) => (tx: Db) => tx.execute(sql`UPDATE device_adapters SET "machineId" = ${mayMoi} WHERE id = ${adapterId}`);

const hangSuKien = async (id: number) => (await dung(sql`SELECT status, "resolvedBy" FROM interlock_events WHERE id = ${id}`))[0];
async function soAuditResolve(eventId: number): Promise<number> {
  const [r] = await dung(
    sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "entityType" = 'interlock_event' AND "entityId" = ${String(eventId)} AND action = 'resolve'`,
  );
  return Number(r.n);
}

const NF_SU_KIEN = { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "interlockEvent" } };
const CONFLICT_THU_LAI = { code: "CONFLICT", appCode: "OPERATION_FAILED", appParams: { operation: "interlockRule", reason: "scadaKenhThuLai" } };

async function chuaDong(eventId: number): Promise<void> {
  expect((await hangSuKien(eventId)).status, "sự kiện phải VẪN mở (fired)").toBe("fired");
  expect(await soAuditResolve(eventId), "0 dòng audit 'resolve'").toBe(0);
}
async function daDong(eventId: number): Promise<void> {
  expect((await hangSuKien(eventId)).status).toBe("resolved");
  expect(await soAuditResolve(eventId)).toBe(1);
}

beforeAll(async () => {
  const d = (await H.getDbThat?.()) as Db | null | undefined;
  expect(d, "test cần CSDL _test").toBeTruthy();
  db = d as Db;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  engA = await seedNguoi("ea", "engineer", [A.code]);
  admin = await seedNguoi("ad", "admin", []);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  const like = RUN + "%";
  if (suKien.length) await dung(sql`DELETE FROM interlock_events WHERE id IN (${sql.join(suKien.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM interlock_rules WHERE name LIKE ${like}`).catch(() => undefined);
  if (adapters.length) {
    const ds = sql.join(adapters.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${like}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${like}`).catch(() => undefined);
}, 60_000);

describe("★★★ mục 62 — adapter đích của luật sang nhà máy B commit khi resolveEvent đang chờ khoá adapter ⇒ NOT_FOUND interlockEvent, không đóng", () => {
  it("kỹ sư A: sự kiện của luật nhắm adapter ấy ⇒ NOT_FOUND interlockEvent, sự kiện vẫn mở, 0 audit resolve", async () => {
    const x = await seedAdapter(A.mid);
    const ev = await seedSuKien(await seedLuat(x));
    const { thuTuc, doiThu } = await doiThuGiuRoiDoi(
      khoaAdapterUpdate(x),
      doiMay(x, B.mid),
      () => engA.ilk.resolveEvent({ id: ev, reason: "dong ngoai pham vi" }),
      "resolveEvent phải BỊ CHẶN ở lượt khoá hàng adapter đích",
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toMatchObject(NF_SU_KIEN);
    await chuaDong(ev);
  }, 30_000);

  it("đối chứng DƯƠNG: adapter sang máy KHÁC CÙNG nhà máy A ⇒ resolved + 1 audit", async () => {
    const x = await seedAdapter(A.mid);
    const ev = await seedSuKien(await seedLuat(x));
    const { thuTuc, doiThu } = await doiThuGiuRoiDoi(
      khoaAdapterUpdate(x),
      doiMay(x, A.mid2),
      () => engA.ilk.resolveEvent({ id: ev, reason: "dong trong pham vi" }),
      "resolveEvent phải BỊ CHẶN ở lượt khoá hàng adapter đích",
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toBeNull();
    await daDong(ev);
  }, 30_000);
});

describe("★★★ không gọi pool trong giao dịch", () => {
  it("resolveEvent (kỹ sư A, luật có adapter đích): getDb được gọi 0 lần trong khoảng mở giao dịch → commit", async () => {
    const x = await seedAdapter(A.mid);
    const ev = await seedSuKien(await seedLuat(x));
    H.goiTrongGd = 0;
    const tong0 = H.goiTong;
    const r = await thuGoi(engA.ilk.resolveEvent({ id: ev, reason: "dem getDb" }));
    expect(moTa(r.loi)).toBeNull();
    expect(H.goiTong - tong0, "getDb của bản bọc phải THẬT SỰ được gọi (thiết bị đo không mù)").toBeGreaterThan(0);
    expect(H.trongGd).toBe(0);
    expect(H.goiTrongGd, "getDb (pool) gọi TRONG giao dịch của resolveEvent").toBe(0);
    await daDong(ev);
  }, 30_000);
});

describe("★★★ KD-C1 — giữ chéo TẤT ĐỊNH: đối thủ theo thứ tự ADAPTER (FOR UPDATE) → LUẬT (FOR UPDATE)", () => {
  it("resolveEvent chờ ở hàng ADAPTER (chưa giữ luật) ⇒ đối thủ lấy được luật, cả hai thành công, 0 lỗi 40P01", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const ev = await seedSuKien(id);
    const { thuTuc, doiThu } = await doiThuGiuRoiDoi(
      khoaAdapterUpdate(x),
      (tx) => tx.execute(sql`SELECT id FROM interlock_rules WHERE id = ${id} FOR UPDATE`),
      () => engA.ilk.resolveEvent({ id: ev, reason: "giu cheo" }),
      "resolveEvent phải chờ ở hàng ADAPTER (khoá adapter trước luật)",
    );
    expect({ doiThuDeadlock: laDeadlock(doiThu.loi), thuTucDeadlock: laDeadlock(thuTuc.loi) }).toEqual({ doiThuDeadlock: false, thuTucDeadlock: false });
    expect(doiThu.loi ? String(doiThu.loi).slice(0, 200) : null).toBeNull();
    expect(moTa(thuTuc.loi)).toBeNull();
    await daDong(ev);
  }, 60_000);
});

describe("★★ KD-C1 — luật đổi giữa lượt đọc KHÔNG khoá và lượt khoá luật", () => {
  /** Đối thủ giữ LUẬT (đã sửa / xoá, chưa commit); resolveEvent đọc đích CŨ, khoá adapter cũ, rồi BỊ CHẶN ở lượt khoá luật; đối thủ COMMIT. */
  const luatDoiGiuaDocVaKhoa = <T>(doi: (tx: Db) => Promise<unknown>, goi: () => Promise<T>) =>
    doiThuGiuRoiDoi(doi, async () => undefined, goi, "resolveEvent phải BỊ CHẶN ở lượt khoá luật (đã đọc đích cũ, đã khoá adapter)");

  it("đích đổi sang adapter CÙNG nhà máy A ⇒ CONFLICT scadaKenhThuLai đi nguyên, sự kiện vẫn mở", async () => {
    const x1 = await seedAdapter(A.mid);
    const x2 = await seedAdapter(A.mid);
    const id = await seedLuat(x1);
    const ev = await seedSuKien(id);
    const { thuTuc, doiThu } = await luatDoiGiuaDocVaKhoa(
      (tx) => tx.execute(sql`UPDATE interlock_rules SET "targetAdapterId" = ${x2} WHERE id = ${id}`),
      () => engA.ilk.resolveEvent({ id: ev, reason: "dich doi cung nha may" }),
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toMatchObject(CONFLICT_THU_LAI);
    await chuaDong(ev);
  }, 30_000);

  it("đích đổi sang adapter nhà máy B (luật nay ngoài phạm vi) ⇒ NOT_FOUND interlockEvent (không lộ luật / không lộ bằng CONFLICT)", async () => {
    const x1 = await seedAdapter(A.mid);
    const xb = await seedAdapter(B.mid);
    const id = await seedLuat(x1);
    const ev = await seedSuKien(id);
    const { thuTuc, doiThu } = await luatDoiGiuaDocVaKhoa(
      (tx) => tx.execute(sql`UPDATE interlock_rules SET "targetAdapterId" = ${xb} WHERE id = ${id}`),
      () => engA.ilk.resolveEvent({ id: ev, reason: "dich doi sang B" }),
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toMatchObject(NF_SU_KIEN);
    await chuaDong(ev);
  }, 30_000);

  it("luật bị XOÁ: kỹ sư A ⇒ NOT_FOUND interlockEvent, sự kiện vẫn mở", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const ev = await seedSuKien(id);
    const { thuTuc, doiThu } = await luatDoiGiuaDocVaKhoa(
      (tx) => tx.execute(sql`DELETE FROM interlock_rules WHERE id = ${id}`),
      () => engA.ilk.resolveEvent({ id: ev, reason: "luat bi xoa" }),
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toMatchObject(NF_SU_KIEN);
    await chuaDong(ev);
  }, 30_000);

  it("luật bị XOÁ: admin (toàn quyền) ⇒ resolved + 1 audit (như hôm nay với sự kiện mồ côi)", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const ev = await seedSuKien(id);
    const { thuTuc, doiThu } = await luatDoiGiuaDocVaKhoa(
      (tx) => tx.execute(sql`DELETE FROM interlock_rules WHERE id = ${id}`),
      () => admin.ilk.resolveEvent({ id: ev, reason: "luat bi xoa admin" }),
    );
    expect(doiThu.loi).toBeNull();
    expect(moTa(thuTuc.loi)).toBeNull();
    await daDong(ev);
  }, 30_000);
});

describe("★★ sự kiện không gắn luật thấy được (\"ruleId NULL\" — cột NOT NULL ⇒ ca tương đương: luật đã xoá từ trước)", () => {
  it("kỹ sư có phạm vi ⇒ NOT_FOUND interlockEvent; admin ⇒ resolved", async () => {
    const x = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const ev = await seedSuKien(id);
    await dung(sql`DELETE FROM interlock_rules WHERE id = ${id}`);
    expect(moTa((await thuGoi(engA.ilk.resolveEvent({ id: ev, reason: "mo coi ky su" }))).loi)).toMatchObject(NF_SU_KIEN);
    await chuaDong(ev);
    expect(moTa((await thuGoi(admin.ilk.resolveEvent({ id: ev, reason: "mo coi admin" }))).loi)).toBeNull();
    await daDong(ev);
  }, 30_000);

  it("sự kiện không tồn tại ⇒ NOT_FOUND interlockEvent", async () => {
    const [r] = await dung(sql`SELECT coalesce(max(id), 0)::int + 1000000 AS id FROM interlock_events`);
    expect(moTa((await thuGoi(engA.ilk.resolveEvent({ id: Number(r.id), reason: "khong ton tai" }))).loi)).toMatchObject(NF_SU_KIEN);
  }, 30_000);
});

describe("★ bổ sung (xác suất) — resolveEvent ∥ update đổi targetAdapterId của CÙNG luật, 10 vòng", () => {
  it("0 lỗi 40P01 lọt ra; resolveEvent thành công / CONFLICT scadaKenhThuLai / NOT_FOUND; update thành công / CONFLICT", async () => {
    const x = await seedAdapter(A.mid);
    const y = await seedAdapter(A.mid);
    const id = await seedLuat(x);
    const loiLa: string[] = [];
    const dem = { resolveOk: 0, resolveConflict: 0, updateOk: 0 };
    for (let v = 0; v < 10; v++) {
      const ev = await seedSuKien(id);
      const [rs, up] = await Promise.all([
        thuGoi(engA.ilk.resolveEvent({ id: ev, reason: `vong ${v}` })),
        thuGoi(engA.ilk.update({ id, targetAdapterId: v % 2 === 0 ? y : x })),
      ]);
      for (const [ten, r] of [["resolve", rs], ["update", up]] as const) {
        if (!r.loi) continue;
        const m = moTa(r.loi);
        const choPhep =
          (m?.code === "CONFLICT" && m.appParams?.reason === "scadaKenhThuLai") || (ten === "resolve" && m?.code === "NOT_FOUND" && m.appParams?.entity === "interlockEvent");
        if (laDeadlock(r.loi) || !choPhep) loiLa.push(`vòng ${v} ${ten}: ${JSON.stringify(m)}`);
      }
      if (!rs.loi) dem.resolveOk++;
      else if (moTa(rs.loi)?.code === "CONFLICT") dem.resolveConflict++;
      if (!up.loi) dem.updateOk++;
      const st = (await hangSuKien(ev)).status;
      if (!rs.loi && st !== "resolved") loiLa.push(`vòng ${v}: resolve thành công nhưng trạng thái ${st}`);
      if (rs.loi && st !== "fired") loiLa.push(`vòng ${v}: resolve lỗi nhưng trạng thái ${st}`);
    }
    expect(loiLa).toEqual([]);
    console.info(`[T4] 10 vòng resolveEvent ∥ update đổi đích: ${JSON.stringify(dem)}`);
    expect(dem.resolveOk + dem.resolveConflict, "mỗi vòng resolveEvent phải chạy tới kết cục").toBeGreaterThan(0);
  }, 120_000);
});
