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
