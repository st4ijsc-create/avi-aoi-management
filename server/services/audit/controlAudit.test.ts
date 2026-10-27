/**
 * W2-7 (audit doc 25 · T6) — control audit helper tests.
 *
 * recordAuditEvent phải INSERT ĐÚNG MỘT dòng bất biến với actor/before/after/reason,
 * coerce entityId số → chuỗi. Dùng fake in-memory db theo mẫu workforce.s1.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";

type Row = Record<string, any>;
const store: Record<string, Row[]> = { control_audit_log: [] };
let seq = 0;

function tableName(t: any): string {
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  return sym ? (t as any)[sym] : t?._?.name;
}
function makeFakeDb() {
  return {
    insert: (t: any) => ({
      values: (vals: Row) => {
        const name = tableName(t);
        const row = { id: ++seq, ...vals };
        (store[name] ??= []).push(row);
        return { returning: async () => [row] };
      },
    }),
  } as any;
}

beforeEach(() => { store.control_audit_log = []; seq = 0; });

import { recordAuditEvent, computeAuditHash, verifyAuditRows, type AuditHashFields, type HashedAuditRow } from "./controlAuditService";
import { GENESIS_HASH } from "../security/auditChain";

describe("recordAuditEvent", () => {
  it("ghi đúng 1 dòng với actor/before/after/reason + coerce entityId số → chuỗi", async () => {
    const db = makeFakeDb();
    const row = await recordAuditEvent(db, {
      entityType: "interlock_rule",
      entityId: 42,
      action: "update",
      actorId: 7,
      before: { enabled: false },
      after: { enabled: true },
      reason: "duyệt xong",
    });
    expect(store.control_audit_log).toHaveLength(1);
    const rec = store.control_audit_log[0];
    expect(rec.entityType).toBe("interlock_rule");
    expect(rec.entityId).toBe("42"); // varchar
    expect(rec.action).toBe("update");
    expect(rec.actorId).toBe(7);
    expect(rec.beforeJson).toEqual({ enabled: false });
    expect(rec.afterJson).toEqual({ enabled: true });
    expect(rec.reason).toBe("duyệt xong");
    expect(row?.entityId).toBe("42");
  });

  it("mặc định actor/before/after/reason về null khi không cấp", async () => {
    const db = makeFakeDb();
    await recordAuditEvent(db, { entityType: "device_type_cr", entityId: "CR-abc", action: "submit" });
    const rec = store.control_audit_log[0];
    expect(rec.entityId).toBe("CR-abc");
    expect(rec.actorId).toBeNull();
    expect(rec.beforeJson).toBeNull();
    expect(rec.afterJson).toBeNull();
    expect(rec.reason).toBeNull();
  });
});

// doc 33 §11 fix — I4 hash-chain tail-null anchoring.
describe("verifyAuditRows — tamper-evidence anchoring", () => {
  const mkFields = (n: number): AuditHashFields => ({
    entityType: "rule", entityId: String(n), action: "update", actorId: 1, before: null, after: { v: n }, reason: null,
  });
  const mkRow = (id: number, prevHash: string, ts: number): HashedAuditRow => {
    const f = mkFields(id);
    return { id, entityType: f.entityType, entityId: f.entityId, action: f.action, actorId: f.actorId, beforeJson: f.before, afterJson: f.after, reason: f.reason, prevHash, hash: computeAuditHash(prevHash, f, ts), hashTs: ts };
  };
  const legacy = (id: number): HashedAuditRow => ({ id, entityType: "rule", entityId: String(id), action: "update", actorId: 1, beforeJson: null, afterJson: { v: id }, reason: null, prevHash: null, hash: null, hashTs: null });

  const r1 = mkRow(1, GENESIS_HASH, 100);
  const r2 = mkRow(2, r1.hash!, 200);

  it("an intact chain verifies", () => {
    expect(verifyAuditRows([r1, r2])).toMatchObject({ ok: true, checked: 2 });
  });
  it("allows a LEADING legacy (pre-flag) unhashed prefix", () => {
    expect(verifyAuditRows([legacy(-1), r1, r2]).ok).toBe(true);
  });
  it("detects an in-place content edit of a still-hashed row (hash mismatch)", () => {
    expect(verifyAuditRows([r1, { ...r2, afterJson: { v: 999 } }])).toMatchObject({ ok: false, brokenAtId: 2 });
  });
  it("detects a STRIPPED tail hash (the reported bypass): unhashed row after chain start fails", () => {
    const stripped = { ...r2, afterJson: { v: 999 }, prevHash: null, hash: null, hashTs: null };
    const res = verifyAuditRows([r1, stripped]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/stripped|after chain start/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1b-2b-1 T11 (mục 48) — audit theo LÔ: `xauChuoiAudit` thuần + biên của `recordAuditEvents` (không chạm DB). Ca DB:
// `server/routers/scadaKenhRouter.khaiHangLoat.auditLo.r1b2b.db.test.ts`.
import { xauChuoiAudit, recordAuditEvents, TRAN_HANG_AUDIT_MOT_LO, LoGhiQuaTranError } from "./controlAuditService";

describe("R1b-2b-1 T11 — xauChuoiAudit / recordAuditEvents (thuần)", () => {
  it("xauChuoiAudit nối đúng chuỗi và verifyAuditRows xác nhận", () => {
    const es = Array.from({ length: 5 }, (_, i) => ({ entityType: "device_tag", entityId: i, action: "x", actorId: 1, before: null, after: { i }, reason: "r" }));
    const c = xauChuoiAudit(GENESIS_HASH, es, 1700000000000);
    expect(c[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < 5; i++) expect(c[i].prevHash).toBe(c[i - 1].hash);
    const rows = es.map((e, i) => ({ id: i + 1, entityType: e.entityType, entityId: String(e.entityId), action: e.action, actorId: 1, beforeJson: null, afterJson: e.after, reason: "r", prevHash: c[i].prevHash, hash: c[i].hash, hashTs: 1700000000000 }));
    expect(verifyAuditRows(rows).ok).toBe(true);
  });

  it("xauChuoiAudit băm CÙNG trường với recordAuditEvent (mặc định actor/before/after/reason ⇒ null, entityId số ⇒ chuỗi)", () => {
    const [a] = xauChuoiAudit("p0", [{ entityType: "t", entityId: 7, action: "a" }], 42);
    expect(a).toEqual({
      prevHash: "p0",
      hash: computeAuditHash("p0", { entityType: "t", entityId: "7", action: "a", actorId: null, before: null, after: null, reason: null }, 42),
    });
    expect(xauChuoiAudit("p0", [], 42)).toEqual([]);
  });

  it("recordAuditEvents([]) ⇒ [] và KHÔNG chạm DB", async () => {
    const dbNo = new Proxy({}, { get: (_t, k) => { throw new Error(`chạm DB: ${String(k)}`); } }) as never;
    await expect(recordAuditEvents(dbNo, [])).resolves.toEqual([]);
  });

  it(`TRAN_HANG_AUDIT_MOT_LO = 500; vượt ⇒ LoGhiQuaTranError có kiểu (KHÔNG Error trần), trước khi chạm DB`, async () => {
    expect(TRAN_HANG_AUDIT_MOT_LO).toBe(500);
    const dbNo = new Proxy({}, { get: (_t, k) => { throw new Error(`chạm DB: ${String(k)}`); } }) as never;
    const es = Array.from({ length: 501 }, (_, i) => ({ entityType: "x", entityId: i, action: "a" }));
    const loi = await recordAuditEvents(dbNo, es).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(LoGhiQuaTranError);
    expect(loi).toMatchObject({ name: "LoGhiQuaTranError", reasonCode: "audit_lo_qua_tran_hang", soHang: 501, toiDa: 500 });
  });
});

describe("R1b-2b-1 T11 — cổng số tham số bind (< 65535 của giao thức postgres)", () => {
  it("kiemThamSoLo: 65534 qua; 65535 ⇒ LoGhiQuaTranError lo_qua_tran_tham_so; lô audit trần 500 nằm xa dưới cổng", async () => {
    const { kiemThamSoLo, SO_THAM_SO_MOT_HANG_AUDIT } = await import("./controlAuditService");
    expect(() => kiemThamSoLo(65_534, 1)).not.toThrow();
    const loi = (() => { try { kiemThamSoLo(13_107, 5); } catch (e) { return e; } })(); // 65535
    expect(loi).toBeInstanceOf(LoGhiQuaTranError);
    expect(loi).toMatchObject({ reasonCode: "lo_qua_tran_tham_so", soThamSo: 65_535 });
    expect(TRAN_HANG_AUDIT_MOT_LO * SO_THAM_SO_MOT_HANG_AUDIT).toBeLessThan(65_535);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// kiem-dinh R1b-2b-1 (T11a / T11c). T11a — id cấp trước phải được SẮP TĂNG trước khi gán cho phần tử chuỗi: Postgres hôm nay trả nextval
// trên generate_series theo thứ tự tăng nên DB thật không lộ việc bỏ `.sort` ⇒ ép qua SEAM: db giả trả các id NGƯỢC thứ tự. T11c — xem
// báo cáo: với trần 500 dòng, cổng tham số trong `recordAuditEvents` không thể là cổng chặn đầu tiên (500 × 11 = 5500 < 65535).
import { PgDialect } from "drizzle-orm/pg-core";

describe("kiem-dinh T11a — recordAuditEvents (SEC_PLATFORM bật) sắp id cấp trước TĂNG dù sequence trả NGƯỢC (seam)", () => {
  it("id trả về [105..101] ⇒ phần tử chuỗi i nhận id tăng thứ i; hàng theo id ⇒ verifyAuditRows ok, nối từ hash cuối", async () => {
    const dialect = new PgDialect();
    const cuSec = process.env.SEC_PLATFORM;
    process.env.SEC_PLATFORM = "true";
    const giaTriChen: Row[][] = [];
    const cauLenh: string[] = [];
    const HASH_CUOI = computeAuditHash(GENESIS_HASH, { entityType: "goc", entityId: "0", action: "x", actorId: null, before: null, after: null, reason: null }, 1);
    const tx = {
      execute: async (q: any) => {
        const s = dialect.sqlToQuery(q).sql;
        cauLenh.push(s);
        if (/nextval/i.test(s)) return [105, 104, 103, 102, 101].map((id) => ({ id })); // NGƯỢC
        return [];
      },
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ hash: HASH_CUOI }] }) }) }) }),
      insert: () => ({
        values: (vals: Row[]) => {
          giaTriChen.push(vals);
          return { returning: async () => vals.map((v) => ({ ...v })) };
        },
      }),
    };
    const dbGia = { transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) } as never;
    try {
      const es = Array.from({ length: 5 }, (_, i) => ({ entityType: "device_tag", entityId: 10 + i, action: "khai", actorId: 7, after: { i }, reason: `r${i}` }));
      const rows = (await recordAuditEvents(dbGia, es)) as unknown as HashedAuditRow[];
      expect(cauLenh.some((s) => /nextval/i.test(s)), "phải cấp id qua nextval").toBe(true);
      expect(giaTriChen).toHaveLength(1);
      // phần tử chuỗi i (thứ tự `es`) ⇔ id tăng thứ i
      expect(giaTriChen[0].map((v) => [v.id, v.entityId])).toEqual([
        [101, "10"],
        [102, "11"],
        [103, "12"],
        [104, "13"],
        [105, "14"],
      ]);
      expect(rows.map((r) => r.id)).toEqual([101, 102, 103, 104, 105]);
      expect(rows[0].prevHash).toBe(HASH_CUOI);
      const goc: HashedAuditRow = { id: 100, entityType: "goc", entityId: "0", action: "x", actorId: null, beforeJson: null, afterJson: null, reason: null, prevHash: GENESIS_HASH, hash: HASH_CUOI, hashTs: 1 };
      expect(verifyAuditRows([goc, ...rows])).toMatchObject({ ok: true, checked: 6, brokenAtId: null });
    } finally {
      if (cuSec === undefined) delete process.env.SEC_PLATFORM;
      else process.env.SEC_PLATFORM = cuSec;
    }
  });
});

describe("kiem-dinh T11c — lô có số tham số bind > 65535 ⇒ ném lỗi có kiểu TRƯỚC khi chạm DB (không chia lô)", () => {
  it("5958 dòng × 11 = 65538 tham số ⇒ LoGhiQuaTranError (trần dòng chặn trước — cổng tham số không bao giờ là cổng đầu tiên)", async () => {
    const { SO_THAM_SO_MOT_HANG_AUDIT } = await import("./controlAuditService");
    const n = Math.ceil(65_535 / SO_THAM_SO_MOT_HANG_AUDIT) + 1;
    expect(n * SO_THAM_SO_MOT_HANG_AUDIT).toBeGreaterThan(65_535);
    const dbNo = new Proxy({}, { get: (_t, k) => { throw new Error(`chạm DB: ${String(k)}`); } }) as never;
    const loi = await recordAuditEvents(dbNo, Array.from({ length: n }, (_, i) => ({ entityType: "x", entityId: i, action: "a" }))).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(LoGhiQuaTranError);
    expect(loi).toMatchObject({ reasonCode: "audit_lo_qua_tran_hang", soHang: n, toiDa: TRAN_HANG_AUDIT_MOT_LO });
  });
});
