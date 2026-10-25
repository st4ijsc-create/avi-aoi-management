/**
 * SCADA R1b-2a T5 (kiem-dinh M7, điều phối Q5) — lượt kiểm TOTP trong giao dịch cấu hình có HẠN 3 s, trên CSDL `_test` THẬT.
 *
 * `scadaKenh.capNhat` gọi `kiemTotpCauHinh` BÊN TRONG giao dịch đang giữ khoá adapter (FOR SHARE) + tag (FOR UPDATE). Lượt kiểm chạy trên kết
 * nối THỨ HAI (bộ đếm sai phải commit kể cả khi giao dịch rollback — đầu `totpCauHinh.ts`); pool cạn ⇒ trước vá giao dịch treo vô hạn giữ khoá.
 * Sau vá: `kiemXacThucTheoMuc` giả TREO ⇒ capNhat trả CONFLICT `scadaKenhThuLai` trong < 3500 ms, hàng không đổi, khoá được nhả (một lượt
 * capNhat ngay sau đó đi qua không chờ). Thời gian thật ≈ 3 s < 10 s (phán quyết K15). `vi.mock` ở đây là của `_core/xacThucTheoMuc` (bộ kiểm
 * TOTP — điểm treo mô phỏng pool cạn), không phải hàm phạm vi cục bộ (K9).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ treo: false }));
vi.mock("../_core/xacThucTheoMuc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../_core/xacThucTheoMuc")>();
  return {
    ...real,
    kiemXacThucTheoMuc: async () => (H.treo ? new Promise<never>(() => undefined) : ({ ok: true, cach: "moi_lan" } as const)),
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { readAppErrorMeta } from "../_core/appError";

const RUN = `tth${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

let ad = 0;
let tag = 0;
let engA!: ReturnType<typeof import("./scadaKenhRouter").scadaKenhRouter.createCaller>;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`);
  const [a] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status)
    VALUES (${m.id}, ${RUN}, ${RUN}, 'stub', ${"stub://" + RUN}, 500, false, 'disabled') RETURNING id`);
  ad = Number(a.id);
  const [t] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
    VALUES (${ad}, 'sp', 'addr-sp', 'float', true, true) RETURNING id`);
  tag = Number(t.id);
  const u = await taoNguoiDungTest("ea", "engineer", { tienTo: "tth", ts: RUN, ten: "TTH ea" });
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${RUN})`);
  await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, true)`);
  const { scadaKenhRouter } = await import("./scadaKenhRouter");
  engA = scadaKenhRouter.createCaller({ user: { id: u.id, role: "engineer", name: u.name, twoFactorEnabled: true } } as never);
}, 60_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM device_tags WHERE "adapterId" = ${ad}`).catch(() => undefined);
  await dung(sql`DELETE FROM device_adapters WHERE id = ${ad}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${RUN}`).catch(() => undefined);
  for (const b of ["machines", "stations", "production_lines", "workshops", "factories"]) {
    await dung(sql`DELETE FROM ${sql.raw(b)} WHERE code = ${RUN}`).catch(() => undefined);
  }
}, 60_000);

describe("★ scadaKenh.capNhat — lượt kiểm TOTP TREO (pool cạn) ⇒ CONFLICT thử lại trong < 3500 ms, không treo, không ghi", () => {
  it("TREO ⇒ CONFLICT OPERATION_FAILED {scadaTotpCauHinh, scadaKenhThuLai} trong [2900, 3500) ms; mức tác động giữ NULL; khoá đã nhả", async () => {
    H.treo = true;
    const t0 = Date.now();
    let loi: unknown = null;
    try {
      await engA.capNhat({ tagId: tag, patch: { actuationLevel: 3 }, lyDo: "khai mức khi pool cạn" } as never);
    } catch (e) {
      loi = e;
    }
    const ms = Date.now() - t0;
    H.treo = false;
    expect(loi, "phải bị từ chối").not.toBeNull();
    expect((loi as { code?: string }).code).toBe("CONFLICT");
    expect(readAppErrorMeta(loi)).toEqual({ appCode: "OPERATION_FAILED", appParams: { operation: "scadaTotpCauHinh", reason: "scadaKenhThuLai" } });
    expect(ms).toBeGreaterThanOrEqual(2900);
    expect(ms).toBeLessThan(3500);
    const [r] = await dung(sql`SELECT actuation_level FROM device_tags WHERE id = ${tag}`);
    expect(r.actuation_level).toBeNull();
    // giao dịch đã rollback ⇒ khoá tag / adapter đã nhả: lượt sau đi qua NGAY (không chờ khoá)
    const t1 = Date.now();
    const kq = await engA.capNhat({ tagId: tag, patch: { actuationLevel: 3 }, lyDo: "khai mức sau khi pool hồi" } as never);
    expect(kq).toMatchObject({ changed: true, actuationLevel: 3 });
    expect(Date.now() - t1).toBeLessThan(2000);
  }, 8_000);
});
