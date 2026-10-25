/**
 * ★★★ W18 — CENSUS: không còn `.rows` TRẦN trên kết quả `db.execute(...)` (postgres-js trả MẢNG, không có `.rows`). Xem `execRowsScan.ts`.
 * Đã gặp ≥ 6 lần: processInspection, getEmbeddingStats, getQualityGateStats, runDiversitySampling, alertEvaluation, aiImageEmbedding (tầng HNSW/exact), aiSmartAlertRouter.checkPatterns…
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { quetServer, quetTep } from "./execRowsScan";
import { hangKetQua } from "../db/hangKetQua";

const SERVER = join(__dirname, "..");

describe("§1 toàn server: không `.rows` trần trên kết quả execute", () => {
  it("quét `server/` (trừ test) ⇒ 0 vi phạm", () => {
    expect(quetServer(SERVER)).toEqual([]);
  });
});

describe("§2 vị từ bắt đúng hình dạng lỗi (tệp ảo)", () => {
  const q = (src: string) => quetTep("ao.ts", src).map((v) => v.mau);
  it("★ `R.rows || []` / `R.rows ?? []` / `R.rows?.[0]` / `(await x.execute()).rows` ⇒ VI PHẠM", () => {
    expect(q("async function f(db:any){ const r = await db.execute(1); const rows = r.rows || []; }").length).toBe(1);
    expect(q("async function f(db:any){ const r = (await db.execute(1)) as any; return r.rows ?? []; }").length).toBe(1);
    expect(q("async function f(db:any){ const r = await db.execute(1); return r.rows?.[0]; }").length).toBe(1);
    expect(q("async function f(db:any){ return (await db.execute(1)).rows; }").length).toBe(1);
  });
  it("đường lùi về chính kết quả ⇒ KHÔNG vi phạm: `R.rows || R` · `R.rows ?? R` · Array.isArray · hangKetQua", () => {
    expect(q("async function f(db:any){ const r = await db.execute(1); const rows = (r as any).rows || r; }").length).toBe(0);
    expect(q("async function f(db:any){ const r = await db.execute(1); const rows = (r as any).rows ?? r; }").length).toBe(0);
    expect(q("async function f(db:any){ const r = await db.execute(1); const rows = Array.isArray(r) ? r : (r as any).rows || []; }").length).toBe(0);
    expect(q("async function f(db:any){ const r = await db.execute(1); if (Array.isArray(r)) return r; return (r as any)?.rows ?? []; }").length).toBe(0);
    expect(q("async function f(db:any){ const r = await db.execute(1); return hangKetQua(r); }").length).toBe(0);
  });
  it(".rows trên thứ KHÔNG phải kết quả execute (input.rows, grid.rows) ⇒ không bị tính", () => {
    expect(q("function f(input:any){ return input.rows.length; }").length).toBe(0);
    expect(q("function f(grid:any){ const n = grid.rows * 2; return n; }").length).toBe(0);
  });
});

describe("§3 hangKetQua", () => {
  it("nhận mảng (postgres-js) và { rows } (node-pg); null / lạ ⇒ []", () => {
    expect(hangKetQua([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(hangKetQua({ rows: [{ a: 2 }] })).toEqual([{ a: 2 }]);
    expect(hangKetQua(null)).toEqual([]);
    expect(hangKetQua({ rows: "x" })).toEqual([]);
  });
});

describe("§4 callback .then", () => {
  it("`x.execute(..).then((r) => r.rows ?? [])` ⇒ VI PHẠM; có đường lùi ⇒ không", () => {
    expect(quetTep("ao.ts", "async function f(tx:any){ return tx.execute(1).then((r:any) => r.rows ?? []); }").length).toBe(1);
    expect(quetTep("ao.ts", "async function f(tx:any){ return tx.execute(1).then((r:any) => (Array.isArray(r) ? r : r.rows ?? [])); }").length).toBe(0);
  });
});
