/**
 * ★ Pha 0 T0-3 (2026-11-06) — `drizzle/0490_*.sql` là NGUỒN DUY NHẤT của chính sách Timescale: catalog _test phải khớp ĐÚNG bảng VALUES
 * của migration (mỗi bảng 1 job nén + 1 job giữ). Chỉ đọc catalog; không ghi hàng nào.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL = readFileSync(join(__dirname, "..", "..", "drizzle", "0490_timescale_mot_nguon_chinh_sach.sql"), "utf8");
const HANG = /\('(\w+)',\s*ARRAY\[([^\]]+)\],\s*'(\w+)',\s*INTERVAL '([^']+)',\s*INTERVAL '([^']+)'\)/g;
const CHUAN = [...SQL.matchAll(HANG)].map((m) => ({
  bang: m[1]!,
  seg: m[2]!.split(",").map((x) => x.trim().replace(/'/g, "")),
  ord: m[3]!,
  nen: m[4]!,
  giu: m[5]!,
}));

const DB_URL = process.env.DATABASE_URL ?? "";
const sql = postgres(DB_URL, { max: 1, onnotice: () => undefined });
afterAll(() => sql.end());

describe.skipIf(!/_test\b/.test(DB_URL))("T0-3 — catalog Timescale khớp 0490", () => {
  it("★★★ VALUES của 0490 đọc được đủ 7 bảng (cầu chì cho biểu thức đọc)", () => {
    expect(CHUAN.map((c) => c.bang).sort()).toEqual(["machine_heartbeats", "measurement_results", "oee_metrics", "ot_telemetry", "process_results", "product_inspections", "robot_telemetry"]);
  });
  it("★★★ mỗi hypertable đúng MỘT job nén + MỘT job giữ, đúng giá trị của 0490", async () => {
    const [{ d }] = await sql`SELECT current_database() AS d`;
    expect(d).toMatch(/_test$/);
    const jobs = await sql`SELECT hypertable_name AS b, proc_name AS p, config->>'compress_after' AS nen, config->>'drop_after' AS giu
      FROM timescaledb_information.jobs WHERE proc_name IN ('policy_compression', 'policy_retention') AND hypertable_schema = 'public'`;
    for (const c of CHUAN) {
      expect(jobs.filter((j) => j.b === c.bang && j.p === "policy_compression").map((j) => j.nen), c.bang).toEqual([c.nen]);
      expect(jobs.filter((j) => j.b === c.bang && j.p === "policy_retention").map((j) => j.giu), c.bang).toEqual([c.giu]);
    }
    // không bảng nào ngoài 0490 có job nén (audit_logs chỉ có job giữ, thuộc 90)
    expect([...new Set(jobs.filter((j) => j.p === "policy_compression").map((j) => j.b as string))].sort()).toEqual(CHUAN.map((c) => c.bang).sort());
  });
  it("★★★ segmentby / orderby khớp 0490", async () => {
    const dong = await sql`SELECT hypertable_name AS b, attname AS c, segmentby_column_index AS s, orderby_column_index AS o, orderby_asc AS a
      FROM timescaledb_information.compression_settings WHERE hypertable_schema = 'public'`;
    for (const c of CHUAN) {
      const cua = dong.filter((x) => x.b === c.bang);
      expect(cua.filter((x) => x.s != null).sort((p, q) => Number(p.s) - Number(q.s)).map((x) => x.c), c.bang).toEqual(c.seg);
      expect(cua.filter((x) => x.o != null).map((x) => `${x.c}${x.a ? "+" : "-"}`), c.bang).toEqual([`${c.ord}-`]);
    }
  });
});
