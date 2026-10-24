/**
 * CỔNG CSDL THẬT — rà bảo mật 2026-10-24: tRPC `genealogy.*` theo PHẠM VI NGƯỜI DÙNG (tiếp `ordersGenealogyLinesPhamViKhoa.db.test.ts` của tuyến REST).
 *
 * Luật (cùng REST): một đơn vị (serial) chỉ thấy khi có ÍT NHẤT MỘT bản ghi bước/linh kiện/kiểm tra ở máy TRONG phạm vi (và chỉ các bản ghi đó); sự kiện chuỗi không mang máy
 * không tự cấp quyền thấy — NGOẠI LỆ: người đã GHI sự kiện chuỗi (recordedBy) thấy đơn vị mình ghi. Ghi sự kiện (appendEvent) vào đơn vị ĐÃ TỒN TẠI nhưng ngoài phạm vi ≡ NOT_FOUND.
 * Admin (phạm vi toàn quyền) không đổi; người dùng không gán nhà máy ⇒ rỗng.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `gnp${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

interface Nm { fid: number; mid: number; code: string }
let A!: Nm;
let B!: Nm;
const factories: string[] = [];
let userA: any;
let userRong: any;
let admin: any;
const serial = { a: `${RUN}-A`, b: `${RUN}-B`, ab: `${RUN}-AB`, chB: `${RUN}-CHB`, chA: `${RUN}-CHA`, con: `${RUN}-CON` };
const LOT = `${RUN}-LOT`;

async function seedNhaMay(ten: string): Promise<Nm> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code };
}
async function seedNguoi(ten: string, role: "engineer" | "admin", codes: string[]) {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "gnp", ts: RUN, ten: `GNP ${ten}` });
  for (const code of codes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  const { genealogyRouter } = await import("./genealogyRouter");
  return { id: u.id as number, c: genealogyRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never) };
}
async function maLoi(chay: () => Promise<unknown>): Promise<string | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}
async function buoc(c: any, s: string) {
  const r = await c.getFullHistory({ serialNumber: s });
  return r.found ? (r.record.steps as Array<{ station: string }>).map((x) => x.station) : null;
}
const pr = (s: string, mid: number, step: string) =>
  dung(sql`INSERT INTO process_results ("serialNumber", "machineId", "stepType", result, "measuredAt", "lotCode") VALUES (${s}, ${mid}, ${step}, 'pass', now(), ${LOT})`);

let uA!: { id: number; c: any };
beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  uA = await seedNguoi("ua", "engineer", [A.code]);
  userA = uA.c;
  userRong = (await seedNguoi("ur", "engineer", [])).c;
  admin = (await seedNguoi("ad", "admin", [])).c;
  await pr(serial.a, A.mid, "a");
  await pr(serial.b, B.mid, "b");
  await pr(serial.ab, A.mid, "ab-a");
  await pr(serial.ab, B.mid, "ab-b");
  // đơn vị CHỈ có sự kiện chuỗi: chB do admin ghi (không mang máy), chA do userA ghi
  await admin.appendEvent({ serialNumber: serial.chB, eventType: "born" });
  await userA.appendEvent({ serialNumber: serial.chA, eventType: "born" });
  // quan hệ cha-con: con (của A) có cha là đơn vị B
  await dung(sql`INSERT INTO component_installations ("serialNumber", "componentCode", "machineId") VALUES (${serial.con}, ${RUN + "-P"}, ${A.mid})`);
  await admin.appendEvent({ serialNumber: serial.con, parentSerial: serial.b, eventType: "station", lotCode: LOT });
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await dung(sql`DELETE FROM component_installations WHERE "serialNumber" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM process_results WHERE "serialNumber" LIKE ${RUN + "%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" IN (${sql.join(factories.map((c) => sql`${c}`), sql`, `)})`).catch(() => undefined);
  for (const t of ["machines", "stations", "production_lines", "workshops", "factories"]) {
    await dung(sql`DELETE FROM ${sql.raw(t)} WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
  // genealogy_chain là chuỗi băm NỐI ĐUÔI toàn cục (appendEvent móc prevHash vào đuôi thật): xoá hàng thử có thể ĐỨT chuỗi của test khác chạy xen ⇒ CỐ Ý để lại (hàng mang tiền tố gnp… vô hại, chuỗi vẫn hợp lệ).
});

describe("★★★ genealogy.getFullHistory", () => {
  it("userA: đơn vị A ⇒ thấy; đơn vị B ⇒ found:false; đơn vị AB ⇒ chỉ bước ở máy A", async () => {
    expect(await buoc(userA, serial.a)).toContain(A.code);
    expect(await buoc(userA, serial.b)).toBeNull();
    const ab = await buoc(userA, serial.ab);
    expect(ab).toContain(A.code);
    expect(ab).not.toContain(B.code);
  });
  it("chỉ-có-chuỗi: người GHI thấy đơn vị mình (chA); không thấy đơn vị admin ghi (chB)", async () => {
    expect((await userA.getFullHistory({ serialNumber: serial.chA })).found).toBe(true);
    expect((await userA.getFullHistory({ serialNumber: serial.chB })).found).toBe(false);
  });
  it("người không gán nhà máy ⇒ không thấy gì; admin thấy tất cả (đối chứng dương)", async () => {
    expect(await buoc(userRong, serial.a)).toBeNull();
    for (const s of [serial.a, serial.b, serial.chB]) expect((await admin.getFullHistory({ serialNumber: s })).found, s).toBe(true);
    expect(await buoc(admin, serial.ab)).toEqual(expect.arrayContaining([A.code, B.code]));
  });
});

describe("★★★ genealogy.getBySerial / getByLot / verify / getLineage", () => {
  it("getBySerial — đơn vị B ⇒ rỗng; đơn vị A / chA ⇒ có; admin thấy B", async () => {
    expect(await userA.getBySerial({ serialNumber: serial.chB })).toEqual([]);
    expect((await userA.getBySerial({ serialNumber: serial.chA })).length).toBeGreaterThan(0);
    expect((await admin.getBySerial({ serialNumber: serial.chB })).length).toBeGreaterThan(0);
  });
  it("getByLot — chỉ sự kiện của đơn vị thấy được (con của A), không lộ đơn vị B/chB", async () => {
    const rows = await userA.getByLot({ lotCode: LOT });
    const ss = rows.map((r: { serialNumber: string }) => r.serialNumber);
    expect(ss).toContain(serial.con);
    for (const s of [serial.b, serial.chB]) expect(ss).not.toContain(s);
    expect((await userRong.getByLot({ lotCode: LOT })).length).toBe(0);
  });
  it("verify scope=serial — đơn vị ngoài phạm vi ⇒ total 0 (không lộ hàng của B)", async () => {
    expect((await userA.verify({ scope: "serial", serialNumber: serial.chB })).total).toBe(0);
    expect((await admin.verify({ scope: "serial", serialNumber: serial.chB })).total).toBeGreaterThan(0);
  });
  it("getLineage — gốc ngoài phạm vi ⇒ found:false; gốc của A có cha là đơn vị B ⇒ cha bị cắt khỏi cây", async () => {
    const ngoai = await userA.getLineage({ serialNumber: serial.b, direction: "descendants" });
    expect(ngoai.found).toBe(false);
    const cay = await userA.getLineage({ serialNumber: serial.con, direction: "ancestors" });
    expect(JSON.stringify(cay)).not.toContain(serial.b);
    const adm = await admin.getLineage({ serialNumber: serial.con, direction: "ancestors" });
    expect(JSON.stringify(adm)).toContain(serial.b);
  });
});

describe("★★★ genealogy.appendEvent — ghi vào đơn vị ngoài phạm vi", () => {
  it("userA ghi vào đơn vị B (đã tồn tại) ⇒ NOT_FOUND và KHÔNG thêm hàng; cha là đơn vị B ⇒ NOT_FOUND", async () => {
    const dem = async () => Number((await dung(sql`SELECT count(*)::int AS n FROM genealogy_chain WHERE "serialNumber" = ${serial.b} OR "parentSerial" = ${serial.b}`))[0].n);
    const truoc = await dem();
    expect(await maLoi(() => userA.appendEvent({ serialNumber: serial.b, eventType: "station" }))).toBe("NOT_FOUND");
    expect(await maLoi(() => userA.appendEvent({ serialNumber: `${RUN}-MOI1`, parentSerial: serial.b, eventType: "split" }))).toBe("NOT_FOUND");
    expect(await dem()).toBe(truoc);
  });
  it("đối chứng DƯƠNG: userA ghi đơn vị MỚI (chưa tồn tại) và đơn vị của A; admin ghi vào B", async () => {
    expect(await maLoi(() => userA.appendEvent({ serialNumber: `${RUN}-MOI2`, eventType: "born" }))).toBeNull();
    expect(await maLoi(() => userA.appendEvent({ serialNumber: serial.a, eventType: "station" }))).toBeNull();
    expect(await maLoi(() => admin.appendEvent({ serialNumber: serial.b, eventType: "station" }))).toBeNull();
  });
});
