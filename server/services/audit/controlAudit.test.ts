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

import { recordAuditEvent } from "./controlAuditService";

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
