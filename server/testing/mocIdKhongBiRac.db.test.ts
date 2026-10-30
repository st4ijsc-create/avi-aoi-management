/**
 * Mốc `id` trước–sau của các test DB (kiem-dinh 2026-10-30).
 *
 * Bẫy: bảng WORM (`command_log`, `control_audit_log`, `scada_command_attempts`, …) dùng chuỗi `id`; một bản nháp test từng chèn 480 hàng với id
 * TƯỜNG MINH ~1e9 (không xoá được vì WORM) ⇒ `max(id)` làm mốc nhảy lên trên mọi id mới ⇒ `WHERE id > mốc` luôn rỗng ⇒ các khẳng định
 * "không có hàng mới" XANH RỖNG (otMoPhong.db.test.ts). Mốc đúng = max(id) CHỈ trong phạm vi chuỗi đã cấp (`id <= last_value`).
 *
 * Bảng TẠM (giao dịch hoàn tác) mô phỏng đúng hình dạng: không chạm bảng WORM thật, không để lại rác.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

const MOC_CU = `max(id)`;
const MOC_MOI = `max(id) FILTER (WHERE id <= COALESCE(pg_sequence_last_value(pg_get_serial_sequence('pg_temp.kd_moc', 'id')::regclass), 0))`;

async function chayTrongGiaoDichHoanTac<T>(f: (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("không có DB");
  let ra: T | undefined;
  try {
    await db.transaction(async (tx) => {
      ra = await f(tx as never);
      throw new Error("HOAN_TAC");
    });
  } catch (e) {
    if ((e as Error).message !== "HOAN_TAC") throw e;
  }
  return ra as T;
}

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

describe("mốc id không bị hàng id tường minh (rác) đẩy lên", () => {
  it("max(id) cũ BỊ rác đẩy lên (id mới ≤ mốc ⇒ truy vấn rỗng); mốc mới thì không", async () => {
    const kq = await chayTrongGiaoDichHoanTac(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE kd_moc (id bigserial PRIMARY KEY, v text)`);
      await tx.execute(sql`INSERT INTO kd_moc (v) VALUES ('thuc-1'), ('thuc-2')`);
      await tx.execute(sql`INSERT INTO kd_moc (id, v) VALUES (1000000000, 'rac')`);
      const moCu = Number(hang(await tx.execute(sql.raw(`SELECT ${MOC_CU}::bigint AS m FROM kd_moc`)))[0]!.m);
      const moMoi = Number(hang(await tx.execute(sql.raw(`SELECT ${MOC_MOI}::bigint AS m FROM kd_moc`)))[0]!.m);
      await tx.execute(sql`INSERT INTO kd_moc (v) VALUES ('moi-sau-moc')`);
      const thayCu = hang(await tx.execute(sql`SELECT v FROM kd_moc WHERE id > ${moCu} AND v <> 'rac'`));
      const thayMoi = hang(await tx.execute(sql`SELECT v FROM kd_moc WHERE id > ${moMoi} AND v <> 'rac'`));
      return { moCu, moMoi, thayCu: thayCu.length, thayMoi: thayMoi.map((r) => r.v) };
    });
    expect(kq.moCu).toBe(1_000_000_000); // bẫy: mốc cũ nhảy lên rác
    expect(kq.thayCu).toBe(0); // ⇒ xanh RỖNG: hàng mới KHÔNG nhìn thấy được
    expect(kq.moMoi).toBe(2); // mốc mới = id thật cuối cùng đã cấp
    expect(kq.thayMoi).toEqual(["moi-sau-moc"]); // hàng mới thấy đúng
  });

  it("chuỗi chưa dùng (bảng rỗng): mốc mới = 0, không NULL", async () => {
    const m = await chayTrongGiaoDichHoanTac(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE kd_moc (id bigserial PRIMARY KEY, v text)`);
      return Number(hang(await tx.execute(sql.raw(`SELECT COALESCE(${MOC_MOI}, 0)::bigint AS m FROM kd_moc`)))[0]!.m);
    });
    expect(m).toBe(0);
  });

  it("các test DB không còn mốc `max(id)` trần trên bảng nhật ký/WORM (census văn bản)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const goc = path.resolve(__dirname, "..");
    const BANG = ["scada_command_attempts", "control_audit_log", "command_log", "audit_logs", "ai_external_calls", "orchestration_runs"];
    const vi_pham: string[] = [];
    const duyet = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules") duyet(p);
        } else if (/\.test\.ts$/.test(e.name) && p !== __filename) {
          fs.readFileSync(p, "utf8")
            .split("\n")
            .forEach((l, i) => {
              const m = /FROM\s+([a-z_]+)/i.exec(l);
              if (m && BANG.includes(m[1]!.toLowerCase()) && /\bmax\(\s*id\s*\)/i.test(l) && !/pg_sequence_last_value/.test(l)) vi_pham.push(`${path.relative(goc, p)}:${i + 1}`);
            });
        }
      }
    };
    duyet(goc);
    expect(vi_pham, "mốc max(id) trần trên bảng log — dùng max(id) FILTER (WHERE id <= pg_sequence_last_value(...))").toEqual([]);
  });
});
