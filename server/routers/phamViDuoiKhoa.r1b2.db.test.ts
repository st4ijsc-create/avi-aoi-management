/**
 * SCADA R1b-2a Task 5 (kiem-dinh M5 + M7) — PHẠM VI NHÀ MÁY KIỂM LẠI DƯỚI KHOÁ ADAPTER + THỨ TỰ KHOÁ TAG, trên CSDL `_test` THẬT.
 *
 * M5 — kiểm phạm vi TRƯỚC giao dịch đọc `machineId` của adapter KHÔNG khoá; một `deviceAdapter.update` đổi máy (sang nhà máy B) commit giữa
 * kiểm-trước và lượt khoá trong giao dịch ⇒ trước vá thủ tục ghi lên adapter đã thuộc nhà máy B. Sau vá: ngay sau khi khoá hàng adapter, kiểm
 * LẠI phạm vi trên `machineId` ĐÃ KHOÁ (`kiemPhamViDuoiKhoa`) ⇒ cùng NOT_FOUND của kiểm-trước, hàng không đổi, không audit.
 *
 * Phán quyết K9: KHÔNG `vi.mock` hàm cục bộ nào. Đổi máy đồng thời được dựng bằng HAI GIAO DỊCH THẬT: giao dịch "người đổi máy" khoá hàng
 * adapter FOR UPDATE TRƯỚC; thủ tục chạy (kiểm-trước thấy máy A — đọc không khoá không bị chặn), vào giao dịch và BỊ CHẶN ở lượt khoá adapter
 * (đo bằng `pg_blocking_pids` — không đoán theo giờ); người đổi máy đặt `machineId` = máy nhà máy B rồi COMMIT; thủ tục nhận khoá và đọc
 * hàng MỚI (READ COMMITTED: FOR SHARE/UPDATE đọc lại phiên bản đã commit). Hai nhà máy A/B, người gọi KHÔNG phải admin (kỹ sư nhà máy A),
 * phạm vi do `idsTrongPhamVi` THẬT đọc `user_factory_assignments`, quyền do `checkPermission` THẬT.
 * Đường người không phải admin đi: deviceAdapter (update / delete / tags.create / tags.update cũ + mới / tags.delete), scadaDiag.tamTat,
 * scadaKenh.capNhat (đã đúng từ R1b-1 T10 — ghim hồi quy). Đối chứng DƯƠNG: đổi sang máy KHÁC CÙNG nhà máy A ⇒ thủ tục THÀNH CÔNG (bộ dựng
 * không tự sinh NOT_FOUND).
 *
 * M7 — `mappingAsCode.applyImport` (adminProcedure: phạm vi luôn toàn quyền ⇒ test phạm vi vô nghĩa, K9) được test THỨ TỰ KHOÁ: hai tag mà
 * thứ tự vật lý (TID) VÀ thứ tự tagKey đều NGƯỢC thứ tự id; một giao dịch theo đúng thứ tự khoá dự án (adapter FOR SHARE → tag ORDER BY id
 * FOR UPDATE, khuôn `khaiHangLoat` T6) giữ tag id NHỎ trước. Import không ORDER BY id ⇒ giữ tag id LỚN rồi chờ tag id nhỏ, giao dịch kia chờ
 * tag id lớn ⇒ 40P01. Import ORDER BY id ⇒ chờ ngay từ tag đầu, không giữ gì ⇒ không vòng chờ. Cộng stress 10 vòng applyImport ∥ tamTat
 * trên cùng adapter có tag ĐƯỢC BẢO VỆ ⇒ 0 lỗi 40P01 / INTERNAL lọt ra.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `pvk${process.pid}${Date.now().toString(36)}`;

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
  deviceAdapter: ReturnType<typeof import("./deviceAdapterRouter").deviceAdapterRouter.createCaller>;
  scadaDiag: ReturnType<typeof import("./scadaDiagRouter").scadaDiagRouter.createCaller>;
  scadaKenh: ReturnType<typeof import("./scadaKenhRouter").scadaKenhRouter.createCaller>;
  mappingAsCode: ReturnType<typeof import("./mappingAsCodeRouter").mappingAsCodeRouter.createCaller>;
};
let engA!: Callers;
let engAId = 0;
let admin!: Callers;
let adminId = 0;

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
async function seedAdapter(machineId: number, isEnabled = false): Promise<{ id: number; code: string }> {
  const code = `${RUN}-ad${++soAd}`;
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, 500, ${isEnabled}, 'disabled') RETURNING id`);
  adapters.push(Number(r.id));
  return { id: Number(r.id), code };
}

async function seedTag(adapterId: number, tagKey: string): Promise<number> {
  const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, 'float', false, true) RETURNING id`);
  return Number(t.id);
}

async function seedNguoi(ten: string, role: "engineer" | "admin", factoryCodes: string[]): Promise<{ c: Callers; id: number }> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "pvk", ts: RUN, ten: `PVK ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin") {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, 'machine_control', 'machine_control', true, true, true, true)`,
    );
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
  }
  const ctx = { user: { id: u.id, role, name: u.name, username: u.username, twoFactorEnabled: true } } as never;
  const r = {
    deviceAdapter: (await import("./deviceAdapterRouter")).deviceAdapterRouter.createCaller(ctx),
    scadaDiag: (await import("./scadaDiagRouter")).scadaDiagRouter.createCaller(ctx),
    scadaKenh: (await import("./scadaKenhRouter")).scadaKenhRouter.createCaller(ctx),
    mappingAsCode: (await import("./mappingAsCodeRouter")).mappingAsCodeRouter.createCaller(ctx),
  };
  return { c: r, id: u.id };
}

type KetQua<T> = { kq?: T; loi: unknown };
const thuGoi = <T>(p: Promise<T>): Promise<KetQua<T>> => p.then((kq) => ({ kq, loi: null }), (loi) => ({ loi }));

/** Mã tRPC + appCode + params của lỗi; `null` khi thành công. */
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
  }
  return false;
}

/** Có tiến trình nào đang bị `pid` chặn (chờ khoá của `pid`) không. */
async function soBiChanBoi(pid: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`);
  return Number(r.n);
}

/**
 * Đổi máy của adapter GIỮA kiểm-trước và lượt khoá của thủ tục: giao dịch "người đổi máy" khoá hàng adapter FOR UPDATE, thủ tục chạy tới khi
 * BỊ CHẶN ở hàng ấy (đã qua kiểm-trước), rồi người đổi máy đặt `machineId = mayMoi` và COMMIT.
 */
async function doiMayGiuaKiemVaKhoa<T>(adapterId: number, mayMoi: number, goi: () => Promise<T>, tuyChon?: { khoaTag?: number }): Promise<KetQua<T>> {
  let moKhoa!: () => void;
  const choMo = new Promise<void>((r) => (moKhoa = r));
  let daKhoa!: (pid: number) => void;
  const choKhoa = new Promise<number>((r) => (daKhoa = r));
  const giu = db.transaction(async (tx) => {
    const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
    await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${adapterId} FOR UPDATE`);
    // fix round 1 (I-1) — người đổi máy THẬT (`deviceAdapter.update` đổi đích ⇒ `goMoiStopPinCuaAdapterTx`) khoá cả tag của adapter sau adapter:
    // thủ tục đọc adapter KHÔNG khoá (trước vá) sẽ bị chặn ở tag thay vì ở adapter — vẫn là "đã qua kiểm, chưa ghi".
    if (tuyChon?.khoaTag !== undefined) await tx.execute(sql`SELECT id FROM device_tags WHERE id = ${tuyChon.khoaTag} FOR UPDATE`);
    daKhoa(Number(p.pid));
    await choMo;
    await tx.execute(sql`UPDATE device_adapters SET "machineId" = ${mayMoi} WHERE id = ${adapterId}`);
  });
  const pidGiu = await choKhoa;
  const p = thuGoi(goi());
  try {
    await vi.waitFor(
      async () => {
        expect(await soBiChanBoi(pidGiu), "thủ tục phải BỊ CHẶN ở lượt khoá hàng adapter (đã qua kiểm-trước)").toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 20 },
    );
  } finally {
    moKhoa();
    await giu;
  }
  return p;
}

async function soAuditCua(actorId: number): Promise<number> {
  const [r] = await dung(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE "actorId" = ${actorId}`);
  return Number(r.n);
}

const hangAdapter = async (id: number) => (await dung(sql`SELECT id, name, "machineId", "isEnabled" FROM device_adapters WHERE id = ${id}`))[0];
const hangTag = async (id: number) => (await dung(sql`SELECT id, "adapterId", "tagKey", address, actuation_level FROM device_tags WHERE id = ${id}`))[0];

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ({ c: engA, id: engAId } = await seedNguoi("ea", "engineer", [A.code]));
  ({ c: admin, id: adminId } = await seedNguoi("ad", "admin", []));
}, 120_000);

afterAll(async () => {
  if (!db) return;
  if (adapters.length) {
    const ds = sql.join(adapters.map((i) => sql`${i}`), sql`, `);
    await dung(sql`DELETE FROM uns_tag_mappings WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM config_snapshots WHERE entity_type = 'mapping_file' AND entity_id IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ds})`).catch(() => undefined);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${ds})`).catch(() => undefined);
  }
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM stations WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM production_lines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM workshops WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
}, 60_000);

describe("★★★ M5 — phạm vi kiểm LẠI dưới khoá adapter (đổi máy sang nhà máy B commit giữa kiểm-trước và khoá ⇒ NOT_FOUND, không ghi)", () => {
  it("deviceAdapter.update (chỉ đổi tên — trước vá KHÔNG khoá hàng adapter nào) ⇒ NOT_FOUND adapter, tên giữ, không audit", async () => {
    const a = await seedAdapter(A.mid);
    const audit0 = await soAuditCua(engAId);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.deviceAdapter.update({ id: a.id, name: "ten-moi-ngoai-pham-vi" }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect(await hangAdapter(a.id)).toMatchObject({ name: a.code, machineId: B.mid });
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("đối chứng DƯƠNG: deviceAdapter.update khi máy đổi sang máy KHÁC CÙNG nhà máy A ⇒ thành công (bộ dựng không tự sinh NOT_FOUND)", async () => {
    const a = await seedAdapter(A.mid);
    const r = await doiMayGiuaKiemVaKhoa(a.id, A.mid2, () => engA.deviceAdapter.update({ id: a.id, name: "ten-moi-trong-pham-vi" }));
    expect(moTa(r.loi)).toBeNull();
    expect(await hangAdapter(a.id)).toMatchObject({ name: "ten-moi-trong-pham-vi", machineId: A.mid2 });
  }, 30_000);

  it("deviceAdapter.update tắt adapter (đường cổng adapter) ⇒ NOT_FOUND adapter, adapter vẫn bật", async () => {
    const a = await seedAdapter(A.mid, true);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.deviceAdapter.update({ id: a.id, isEnabled: false }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appParams: { entity: "adapter" } });
    expect((await hangAdapter(a.id)).isEnabled).toBe(true);
  }, 30_000);

  it("deviceAdapter.delete ⇒ NOT_FOUND adapter, adapter + tag còn nguyên, không audit", async () => {
    const a = await seedAdapter(A.mid);
    const t = await seedTag(a.id, "t-del-ad");
    const audit0 = await soAuditCua(engAId);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.deviceAdapter.delete({ id: a.id }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect(await hangAdapter(a.id)).toBeTruthy();
    expect(await hangTag(t)).toBeTruthy();
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("deviceAdapter.tags.create ⇒ NOT_FOUND adapter, KHÔNG chèn tag", async () => {
    const a = await seedAdapter(A.mid);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () =>
      engA.deviceAdapter.tags.create({ adapterId: a.id, tagKey: "t-moi", address: "40001", dataType: "float" } as never),
    );
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    const [n] = await dung(sql`SELECT count(*)::int AS n FROM device_tags WHERE "adapterId" = ${a.id}`);
    expect(Number(n.n)).toBe(0);
  }, 30_000);

  it("deviceAdapter.tags.update (adapter CŨ của tag sang nhà máy B) ⇒ NOT_FOUND deviceTag (cùng lỗi của adapterCuaTag — M6), địa chỉ giữ", async () => {
    const a = await seedAdapter(A.mid);
    const t = await seedTag(a.id, "t-upd");
    const audit0 = await soAuditCua(engAId);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.deviceAdapter.tags.update({ id: t, address: "40999" }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    expect((await hangTag(t)).address).toBe("addr-t-upd");
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("deviceAdapter.tags.update chuyển tag sang adapter MỚI vừa sang nhà máy B ⇒ NOT_FOUND adapter (lỗi kiểm-trước của adapter mới), tag ở lại", async () => {
    const a1 = await seedAdapter(A.mid);
    const a2 = await seedAdapter(A.mid);
    const t = await seedTag(a1.id, "t-chuyen");
    const r = await doiMayGiuaKiemVaKhoa(a2.id, B.mid, () => engA.deviceAdapter.tags.update({ id: t, adapterId: a2.id }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect((await hangTag(t)).adapterId).toBe(a1.id);
  }, 30_000);

  it("đối chứng DƯƠNG: deviceAdapter.tags.update khi adapter đổi sang máy khác CÙNG nhà máy A ⇒ thành công", async () => {
    const a = await seedAdapter(A.mid);
    const t = await seedTag(a.id, "t-upd-ok");
    const r = await doiMayGiuaKiemVaKhoa(a.id, A.mid2, () => engA.deviceAdapter.tags.update({ id: t, address: "40998" }));
    expect(moTa(r.loi)).toBeNull();
    expect((await hangTag(t)).address).toBe("40998");
  }, 30_000);

  it("deviceAdapter.tags.delete ⇒ NOT_FOUND deviceTag, tag còn", async () => {
    const a = await seedAdapter(A.mid);
    const t = await seedTag(a.id, "t-xoa");
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.deviceAdapter.tags.delete({ id: t }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    expect(await hangTag(t)).toBeTruthy();
  }, 30_000);

  it("scadaDiag.tamTat ⇒ NOT_FOUND adapter, adapter vẫn bật, không audit `scada_tam_tat`", async () => {
    const a = await seedAdapter(A.mid, true);
    await seedTag(a.id, "t-tt");
    const audit0 = await soAuditCua(engAId);
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () => engA.scadaDiag.tamTat({ adapterId: a.id, lyDo: "tạm tắt kiểm phạm vi" }));
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect((await hangAdapter(a.id)).isEnabled).toBe(true);
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  /** Tag ghi được + bật (đặt ghim DỪNG được). */
  async function tagGhiDuoc(adapterId: number, tagKey: string): Promise<number> {
    const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, 'float', true, true) RETURNING id`);
    return Number(t.id);
  }

  it("fix round 1 (I-1) — deviceAdapter.tags.setStopPin: adapter sang nhà máy B khi đang đặt ghim ⇒ NOT_FOUND adapter, ghim KHÔNG đặt", async () => {
    const a = await seedAdapter(A.mid);
    const t = await tagGhiDuoc(a.id, "t-ghim");
    const audit0 = await soAuditCua(engAId);
    const r = await doiMayGiuaKiemVaKhoa(
      a.id,
      B.mid,
      () => engA.deviceAdapter.tags.setStopPin({ adapterId: a.id, tagKey: "t-ghim", stopValue: 0, reason: "ghim dừng kiểm phạm vi" }),
      { khoaTag: t },
    );
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    const [h] = await dung(sql`SELECT stop_value FROM device_tags WHERE id = ${t}`);
    expect(h.stop_value).toBeNull();
    expect(await soAuditCua(engAId)).toBe(audit0);
  }, 30_000);

  it("đối chứng DƯƠNG (I-1): setStopPin khi adapter đổi sang máy khác CÙNG nhà máy A ⇒ qua phạm vi, tới kiểm TOTP cuối (không có mã ⇒ SCADA_CONFIG_TOTP_*)", async () => {
    const a = await seedAdapter(A.mid);
    const t = await tagGhiDuoc(a.id, "t-ghim-ok");
    const r = await doiMayGiuaKiemVaKhoa(
      a.id,
      A.mid2,
      () => engA.deviceAdapter.tags.setStopPin({ adapterId: a.id, tagKey: "t-ghim-ok", stopValue: 0, reason: "ghim dừng kiểm phạm vi" }),
      { khoaTag: t },
    );
    const m = moTa(r.loi);
    expect(m?.code).toBe("PRECONDITION_FAILED");
    expect(m?.appCode).toMatch(/^SCADA_CONFIG_TOTP_/);
  }, 30_000);

  it("scadaKenh.capNhat (đã đúng từ R1b-1 T10 — ghim hồi quy) ⇒ NOT_FOUND deviceTag, mức tác động giữ NULL", async () => {
    const a = await seedAdapter(A.mid);
    const t = await seedTag(a.id, "t-kenh");
    const r = await doiMayGiuaKiemVaKhoa(a.id, B.mid, () =>
      engA.scadaKenh.capNhat({ tagId: t, patch: { actuationLevel: 3 }, lyDo: "khai mức kiểm phạm vi" } as never),
    );
    expect(moTa(r.loi)).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "deviceTag" } });
    expect((await hangTag(t)).actuation_level).toBeNull();
  }, 30_000);
});

describe("phán quyết T1 c8 — adapterIdForMachine tất định (ORDER BY id)", () => {
  it("máy có HAI adapter, hàng id LỚN nằm trước trong heap ⇒ vẫn chọn adapter id NHỎ", async () => {
    const ids = (await dung(sql`SELECT nextval(pg_get_serial_sequence('device_adapters', 'id'))::int AS id FROM generate_series(1, 2)`))
      .map((r) => Number(r.id))
      .sort((x, y) => x - y);
    await dung(sql`INSERT INTO device_adapters (id, "machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
      VALUES (${ids[1]}, ${B.mid2}, ${RUN + "-c8a"}, 'c8a', 'stub', 'stub://c8a', 500, false, 'disabled'),
             (${ids[0]}, ${B.mid2}, ${RUN + "-c8b"}, 'c8b', 'stub', 'stub://c8b', 500, false, 'disabled')`);
    adapters.push(ids[0], ids[1]);
    const theoTid = (await dung(sql`SELECT id FROM device_adapters WHERE "machineId" = ${B.mid2} ORDER BY ctid`)).map((r) => Number(r.id));
    expect(theoTid, "tiên quyết: hàng id lớn đứng trước trong heap").toEqual([ids[1], ids[0]]);
    const { adapterIdForMachine } = await import("../services/aiLocalTools/writeHandlers/visionControl");
    expect(await adapterIdForMachine(B.mid2)).toBe(ids[0]);
    // fix round 1 (review m-1) — bản sao riêng của machineControl.ts: execute VÀ preview chọn cùng adapter id nhỏ nhất
    const mc = await import("../services/aiLocalTools/writeHandlers/machineControl");
    expect(await mc.adapterIdForMachine(B.mid2), "machineControl.adapterIdForMachine").toBe(ids[0]);
    expect((await mc.resolveTarget(B.mid2, null, "vi")).adapterId, "machineControl.resolveTarget (preview)").toBe(ids[0]);
  }, 30_000);
});

describe("★★★ M7 — mappingAsCode.applyImport khoá tag ORDER BY id (thứ tự khoá dự án) — không vòng chờ 40P01", () => {
  /** Hai id lấy TỪ sequence (không va chạm phiên khác), chèn id LỚN trước ⇒ TID của nó nhỏ hơn; tagKey cũng đặt ngược ("k1" cho id lớn). */
  async function adapterHaiTagNguoc(): Promise<{ a: { id: number; code: string }; lon: number; nho: number }> {
    const a = await seedAdapter(A.mid);
    const ids = (await dung(sql`SELECT nextval(pg_get_serial_sequence('device_tags', 'id'))::int AS id FROM generate_series(1, 2)`))
      .map((r) => Number(r.id))
      .sort((x, y) => x - y);
    // MỘT câu lệnh (một backend, cùng trang đích) — hàng id LỚN được ghi vào heap TRƯỚC
    await dung(sql`INSERT INTO device_tags (id, "adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${ids[1]}, ${a.id}, 'k1', 'addr-k1', 'float', false, true), (${ids[0]}, ${a.id}, 'k2', 'addr-k2', 'float', false, true)`);
    const [lon, nho] = [ids[1], ids[0]];
    // điều kiện tiên quyết ĐO được (không giả định): thứ tự vật lý VÀ thứ tự tagKey đều ngược thứ tự id
    const theoTid = (await dung(sql`SELECT id FROM device_tags WHERE "adapterId" = ${a.id} ORDER BY ctid`)).map((r) => Number(r.id));
    const theoKey = (await dung(sql`SELECT id FROM device_tags WHERE "adapterId" = ${a.id} ORDER BY "tagKey"`)).map((r) => Number(r.id));
    expect(theoTid, "tiên quyết: TID của tag id lớn đứng trước").toEqual([lon, nho]);
    expect(theoKey).toEqual([lon, nho]);
    return { a, lon, nho };
  }

  async function yamlDoiDiaChi(code: string, tagKey: string, diaChi: string): Promise<string> {
    const m = await import("../services/ot/mappingAsCode");
    const { file } = await m.exportAdapterMapping(code);
    const f = { ...file, tags: file.tags.map((t) => (t.name === tagKey ? { ...t, address: diaChi } : t)) };
    return m.mappingFileToYaml(f);
  }

  it("★ giao dịch theo thứ tự dự án giữ tag id NHỎ; import chạy đồng thời ⇒ KHÔNG bên nào 40P01, import ghi xong sau khi bên kia commit", async () => {
    const { a, lon, nho } = await adapterHaiTagNguoc();
    const y = await yamlDoiDiaChi(a.code, "k1", "addr-k1-moi");

    let daGiuNho!: (pid: number) => void;
    const choGiuNho = new Promise<number>((r) => (daGiuNho = r));
    let diTiep!: () => void;
    const choDiTiep = new Promise<void>((r) => (diTiep = r));
    const benKia = thuGoi(
      db.transaction(async (tx) => {
        const [p] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
        await tx.execute(sql`SELECT id FROM device_adapters WHERE id = ${a.id} FOR SHARE`); // ADAPTER
        await tx.execute(sql`SELECT id FROM device_tags WHERE id = ${nho} FOR UPDATE`); // TAG id nhỏ trước (ORDER BY id)
        daGiuNho(Number(p.pid));
        await choDiTiep;
        // phần còn lại của lô theo ORDER BY id ⇒ tag id lớn
        await tx.execute(sql`SELECT id FROM device_tags WHERE "adapterId" = ${a.id} ORDER BY id FOR UPDATE`);
      }),
    );
    const pid = await choGiuNho;
    const imp = thuGoi(admin.mappingAsCode.applyImport({ yaml: y, prune: false }));
    try {
      await vi.waitFor(
        async () => {
          expect(await soBiChanBoi(pid), "import phải chờ tag id nhỏ mà bên kia đang giữ").toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 20 },
      );
    } finally {
      diTiep();
    }
    const [rk, ri] = await Promise.all([benKia, imp]);
    expect(laDeadlock(rk.loi), `bên theo thứ tự dự án bị 40P01: ${String(rk.loi)}`).toBe(false);
    expect(rk.loi).toBeNull();
    expect(moTa(ri.loi), "import không được lỗi (40P01 bị toTrpcError bọc thành INTERNAL_SERVER_ERROR)").toBeNull();
    expect((await hangTag(lon)).address).toBe("addr-k1-moi");
  }, 30_000);

  it("stress — 10 vòng applyImport ∥ scadaDiag.tamTat trên CÙNG adapter có tag ĐƯỢC BẢO VỆ ⇒ 0 lỗi 40P01 / INTERNAL lọt ra", async () => {
    const a = await seedAdapter(A.mid, true);
    const ids = (await dung(sql`SELECT nextval(pg_get_serial_sequence('device_tags', 'id'))::int AS id FROM generate_series(1, 3)`))
      .map((r) => Number(r.id))
      .sort((x, y) => x - y);
    await dung(sql`INSERT INTO device_tags (id, "adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${ids[2]}, ${a.id}, 'k1', 'addr-k1', 'float', false, true), (${ids[1]}, ${a.id}, 'k2', 'addr-k2', 'float', false, true),
             (${ids[0]}, ${a.id}, 'k3', 'addr-k3', 'float', false, true)`);
    const bv = ids[0];
    await dung(sql`UPDATE device_tags SET actuation_level = 3 WHERE id = ${bv}`); // ĐÃ KHAI ⇒ được bảo vệ ⇒ tamTat cần TOTP (sau khi khoá)
    const loiLa: string[] = [];
    for (let v = 0; v < 10; v++) {
      const y = await yamlDoiDiaChi(a.code, v % 2 === 0 ? "k1" : "k2", `addr-v${v}`);
      const kq = await Promise.all([
        thuGoi(admin.mappingAsCode.applyImport({ yaml: y, prune: false })),
        thuGoi(admin.scadaDiag.tamTat({ adapterId: a.id, lyDo: `stress vòng ${v}` })),
        thuGoi(admin.mappingAsCode.applyImport({ yaml: y, prune: false })),
      ]);
      for (const [i, r] of kq.entries()) {
        if (!r.loi) continue;
        const m = moTa(r.loi);
        const choPhep = m?.code === "CONFLICT" || (i === 1 && m?.code === "PRECONDITION_FAILED"); // tamTat: thiếu TOTP cho tag được bảo vệ
        if (laDeadlock(r.loi) || !choPhep) loiLa.push(`vòng ${v} #${i}: ${m?.code}/${m?.appCode} ${String((r.loi as Error).message).slice(0, 120)}`);
      }
    }
    expect(loiLa).toEqual([]);
    expect((await hangAdapter(a.id)).isEnabled, "tag được bảo vệ, không mã ⇒ tamTat không bao giờ tắt được").toBe(true);
  }, 60_000);
});
