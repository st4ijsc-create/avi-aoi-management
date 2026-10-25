/**
 * SCADA R1b-2a T1 (Review Focus 3; Q-T13 b + kiem-dinh M1 / M2; phán quyết K2 / K3) — truy vấn TRƯỚC TRIỂN KHAI `TRUY_VAN_TRUOC_TRIEN_KHAI`
 * đi theo luật JS của cổng kênh `dispatch()` (`luatLenhLechLuoi` ⇒ `kiemLenhInterlockTrenKenh`).
 *
 * Thuộc tính chính (tag int CHƯA khai — phạm vi K2): mọi luật hàm JS từ chối đều có hàng SQL (idsJsTuChoi ⊆ idsSql; SQL chỉ được báo DƯ).
 * Mỗi giá trị là MỘT luật bật nhắm tag int chưa khai scale 10 VÀ một luật nhắm tag int chưa khai scale 1 (NULL).
 *
 * Giá trị đọc ra ở JS đi qua drizzle `jsonb()` (parse lại chuỗi: "\t25" / " 25 " / "30" ⇒ số) — ĐÚNG đường engine đọc luật khi gửi lệnh.
 * CSDL `_test` THẬT (cầu chì `_test`); chỉ hàng có tiền tố của tệp này được đọc / xoá.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { like } from "drizzle-orm";
import { interlockRules } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { luatLenhLechLuoi, TRUY_VAN_TRUOC_TRIEN_KHAI } from "./lenhInterlockLechLuoi";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILR1B2T1-${process.pid}-${Date.now()}`;
const TAC_GIA = 990_542_001;

let sql: ReturnType<typeof postgres>;
let adapterId = 0;

/** Giá trị Review Focus 3 + K3 (chuỗi rỗng / chỉ khoảng trắng). `nhan` là tên ngắn ghép vào tên luật. */
const GIA_TRI: Array<{ nhan: string; v: unknown }> = [
  { nhan: "hex", v: "0x19" },
  { nhan: "tab", v: "\t25" },
  { nhan: "nbsp", v: "25 " },
  { nhan: "mangSo", v: [25] },
  { nhan: "mangChuoi", v: ["25"] },
  { nhan: "doiTuong", v: { v: 25 } },
  { nhan: "abc", v: "abc" },
  { nhan: "infinity", v: "Infinity" },
  { nhan: "cach", v: " 25 " },
  { nhan: "so25", v: 25 },
  { nhan: "so2p5", v: 2.5 },
  { nhan: "so30", v: 30 },
  { nhan: "chuoi30", v: "30" },
  { nhan: "null", v: null },
  { nhan: "true", v: true },
  { nhan: "rong", v: "" },
  { nhan: "trang", v: "   " },
];

const id: Record<string, number> = {};

async function seedTag(tagKey: string, scale: string | null, cot: { channel_kind?: string; write_min?: number; write_max?: number } = {}) {
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", scale, channel_kind, write_min, write_max)
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, 'int', true, true, ${scale}, ${cot.channel_kind ?? null}, ${cot.write_min ?? null}, ${cot.write_max ?? null})`;
}

/** Luật BẬT ghi thẳng bảng (mô phỏng luật có từ trước bản build) nhắm (adapterId, tagKey). `v === null` ⇒ cột SQL NULL. */
async function seedLuat(ten: string, tagKey: string, v: unknown): Promise<number> {
  const [r] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "targetAdapterId",
      "commandTag", "commandValue", enabled, "createdBy")
    VALUES (${DAU + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, 'reduce_speed', ${adapterId}, ${tagKey},
      ${v === null ? null : sql.json(v as never)}, true, ${TAC_GIA}) RETURNING id`;
  return Number(r.id);
}

async function idsJsTuChoi(): Promise<number[]> {
  const d = await getDb();
  return (await luatLenhLechLuoi(d!, like(interlockRules.name, `${DAU}-%`))).map((r) => r.id);
}

async function hangSql(): Promise<Map<number, { ket_luan: string; gia_tri_gui: unknown; diem_luoi_gan_nhat: unknown }>> {
  const q = await sql.unsafe(
    `SELECT id::int AS id, ket_luan, gia_tri_gui, diem_luoi_gan_nhat FROM (${TRUY_VAN_TRUOC_TRIEN_KHAI}) q WHERE q.name LIKE $1 ORDER BY id`,
    [`${DAU}-%`],
  );
  return new Map(q.map((r) => [Number(r.id), { ket_luan: String(r.ket_luan), gia_tri_gui: r.gia_tri_gui, diem_luoi_gan_nhat: r.diem_luoi_gan_nhat }]));
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-2a T1 — SQL trước triển khai theo luật JS (tag int CHƯA khai: JS từ chối ⊆ SQL)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [{ db }] = await sql`SELECT current_database() AS db`;
    expect(String(db)).toMatch(/_test$/); // cầu chì: không bao giờ chạy trên DB dev
    const [a] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled")
      VALUES (${DAU}, ${DAU}, 'stub', 'stub://ilr1b2t1', false) RETURNING id`;
    adapterId = Number(a.id);
    await seedTag("i10", "10"); // int CHƯA khai, scale 10
    await seedTag("i1", null); // int CHƯA khai, scale NULL ⇒ 1
    await seedTag("nho", "0.000001"); // scale nhỏ nhất cột numeric(18,6) lưu được
    await seedTag("sieuNho", "0.0000000001"); // numeric(18,6) làm tròn thành 0.000000 ⇒ cả JS lẫn SQL coi là scale 1
    await seedTag("khai", null, { channel_kind: "output", write_min: 0, write_max: 10 }); // ĐÃ khai (phạm vi K2)
    for (const g of GIA_TRI) {
      id[`i10-${g.nhan}`] = await seedLuat(`i10-${g.nhan}`, "i10", g.v);
      id[`i1-${g.nhan}`] = await seedLuat(`i1-${g.nhan}`, "i1", g.v);
    }
    id["nho-1p5"] = await seedLuat("nho-1p5", "nho", 1.5e-6); // thô 1.5 ⇒ lệch
    id["nho-2"] = await seedLuat("nho-2", "nho", 2e-6); // thô 2 ⇒ đúng lưới
    id["nho-1e10"] = await seedLuat("nho-1e10", "nho", 1e10); // thô 1e16 ≥ 2^53 ⇒ vượt miền an toàn
    id["sieuNho-1p5e-10"] = await seedLuat("sieuNho-1p5e-10", "sieuNho", 1.5e-10);
    id["khai-20"] = await seedLuat("khai-20", "khai", 20); // ngoài dải 0..10 của tag ĐÃ khai
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("★ Review Focus 3 — trên tag int CHƯA khai (scale 10 và scale 1): idsJsTuChoi ⊆ idsSql, và JS từ chối ĐÚNG tập mong đợi", async () => {
    const js = await idsJsTuChoi();
    const q = await hangSql();
    const chuaKhai = js.filter((x) => x !== id["khai-20"]);
    for (const x of chuaKhai) expect(q.has(x), `JS từ chối luật #${x} nhưng SQL bỏ sót`).toBe(true);

    const tuChoi10 = ["hex", "tab", "nbsp", "mangSo", "mangChuoi", "doiTuong", "abc", "infinity", "cach", "so25", "so2p5", "null", "true", "rong", "trang"];
    const tuChoi1 = ["mangSo", "mangChuoi", "doiTuong", "abc", "infinity", "so2p5", "rong", "trang"];
    const mong = [...tuChoi10.map((n) => id[`i10-${n}`]), ...tuChoi1.map((n) => id[`i1-${n}`]), id["nho-1p5"], id["nho-1e10"], id["khai-20"]].sort((a, b) => a - b);
    expect(js).toEqual(mong);
  });

  it("★ tường minh: {\"v\":25} / \"abc\" CÓ trong cả hai (M2); 2.5 trên scale 1 CÓ trong cả hai; 30 / \"30\" không ai (cả hai tag)", async () => {
    const js = new Set(await idsJsTuChoi());
    const q = await hangSql();
    for (const t of ["i10", "i1"]) {
      for (const n of ["doiTuong", "abc"]) {
        expect(js.has(id[`${t}-${n}`]), `${t}-${n} JS`).toBe(true);
        expect(q.get(id[`${t}-${n}`])?.ket_luan, `${t}-${n} SQL`).toBe("KHONG_PARSE_DUOC");
      }
      for (const n of ["so30", "chuoi30"]) {
        expect(js.has(id[`${t}-${n}`]), `${t}-${n} JS`).toBe(false);
        expect(q.has(id[`${t}-${n}`]), `${t}-${n} SQL`).toBe(false);
      }
    }
    expect(js.has(id["i1-so2p5"])).toBe(true);
    expect(q.get(id["i1-so2p5"])).toMatchObject({ ket_luan: "LECH_LUOI" });
    expect(Number(q.get(id["i1-so2p5"])!.diem_luoi_gan_nhat)).toBe(3); // round(2.5) numeric = 3 (= goiY của JS)
    // K3: chuỗi rỗng / chỉ khoảng trắng — JS TYPE_MISMATCH, SQL KHONG_PARSE_DUOC (trước: SQL đọc là 0 ⇒ không có hàng trên scale 1)
    for (const n of ["rong", "trang"]) expect(q.get(id[`i1-${n}`])?.ket_luan, n).toBe("KHONG_PARSE_DUOC");
    // scale 1: null / true ⇒ 1, " 25 " ⇒ 25 — đúng lưới số nguyên ⇒ không ai
    for (const n of ["null", "true", "cach", "so25"]) {
      expect(js.has(id[`i1-${n}`]), `i1-${n} JS`).toBe(false);
      expect(q.has(id[`i1-${n}`]), `i1-${n} SQL`).toBe(false);
    }
    // scale 1: "0x19" / TAB / NBSP — JS đọc ra 25 (đúng lưới) ⇒ không từ chối; SQL không đọc được ⇒ báo DƯ (đúng chiều cho phép)
    for (const n of ["hex", "tab", "nbsp"]) {
      expect(js.has(id[`i1-${n}`]), `i1-${n} JS`).toBe(false);
      expect(q.get(id[`i1-${n}`])?.ket_luan, `i1-${n} SQL`).toBe("KHONG_PARSE_DUOC");
    }
  });

  it("★ M1 — scale 0.000001 (nhỏ nhất DB lưu được): 1.5e-6 ⇒ cả hai (thô 1.5); 2e-6 ⇒ không ai; 1e10 ⇒ JS OUT_OF_RANGE + SQL VUOT_MIEN_AN_TOAN (thô 1e16 ≥ 2^53)", async () => {
    const d = await getDb();
    const ds = await luatLenhLechLuoi(d!, like(interlockRules.name, `${DAU}-nho-%`));
    expect(ds.map((r) => [r.id, r.ma])).toEqual([
      [id["nho-1p5"], "OFF_STEP"],
      [id["nho-1e10"], "OUT_OF_RANGE"],
    ]);
    const q = await hangSql();
    expect(q.get(id["nho-1p5"])).toMatchObject({ ket_luan: "LECH_LUOI" });
    expect(q.get(id["nho-1e10"])).toMatchObject({ ket_luan: "VUOT_MIEN_AN_TOAN", diem_luoi_gan_nhat: null });
    expect(q.has(id["nho-2"])).toBe(false);
  });

  it("M1 — scale 1e-10 KHÔNG lưu được (numeric(18,6) ⇒ 0 ⇒ scale 1 như driver): JS và SQL cùng KHÔNG báo 1.5e-10 (lỗ M1 chỉ tồn tại ngoài DB — ca thuần ở kenhScada.test.ts)", async () => {
    const [{ s }] = await sql`SELECT scale::text AS s FROM device_tags WHERE "adapterId" = ${adapterId} AND "tagKey" = 'sieuNho'`;
    expect(s).toBe("0.000000");
    expect((await idsJsTuChoi()).includes(id["sieuNho-1p5e-10"])).toBe(false);
    expect((await hangSql()).has(id["sieuNho-1p5e-10"])).toBe(false);
  });

  it("phạm vi K2 — tag ĐÃ khai, giá trị ngoài dải: JS đếm (OUT_OF_RANGE, posture) nhưng SQL KHÔNG có hàng — dải / bước / kiểu được cưỡng chế lúc cấu hình, không ở SQL", async () => {
    const d = await getDb();
    const ds = await luatLenhLechLuoi(d!, like(interlockRules.name, `${DAU}-khai-%`));
    expect(ds.map((r) => [r.id, r.ma])).toEqual([[id["khai-20"], "OUT_OF_RANGE"]]);
    expect((await hangSql()).has(id["khai-20"])).toBe(false);
  });
});
