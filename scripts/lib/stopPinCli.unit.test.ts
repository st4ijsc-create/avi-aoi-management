/**
 * doc 81 Đợt 1D Task 1 fix round 2 — bản .mjs của CLI (scripts/lib/stopPinCli.mjs) phải KHỚP bản TS mà
 * server dùng để GỠ ghim và để KIỂM chuỗi audit. Oracle ở đây là CHÍNH bộ kiểm của server
 * (`computeAuditHash` là thứ `verifyAuditRows` dùng; `lyDoGoStopPinKhiSuaTag` là luật của router/import UI):
 * lệch một ký tự canonicalize ⇒ dòng audit của CLI bị coi là giả mạo khi SEC_PLATFORM bật.
 */
import { describe, it, expect } from "vitest";
import { canonicalize as canonMjs, computeAuditHash as hashMjs, lyDoGoStopPinCli } from "./stopPinCli.mjs";
import { canonicalize as canonTs } from "../../server/services/security/auditChain";
import { computeAuditHash as hashTs, verifyAuditRows } from "../../server/services/audit/controlAuditService";
import { lyDoGoStopPinKhiSuaTag } from "../../server/services/ot/stopPin";

describe("stopPinCli.mjs ≡ bản TS", () => {
  it("canonicalize: cùng chuỗi cho object lồng, mảng, null, số, chuỗi unicode", () => {
    const v = { z: 1, a: [3, { y: null, b: "Đ" }], m: { k: true, c: 0.5 }, s: "x" };
    expect(canonMjs(v)).toBe(canonTs(v));
    for (const x of [null, 1, "a", [1, [2]], { a: undefined, b: 1 }]) expect(canonMjs(x)).toBe(canonTs(x));
  });

  it("computeAuditHash: cùng hash — và một chuỗi 2 dòng do CLI tính qua được verifyAuditRows của server", () => {
    const f1 = { entityType: "device_tag_stop_pin", entityId: "7", action: "stop_pin_clear", actorId: null,
      before: { tagKey: "stop_cmd", adapterId: 3, dataType: "bool", stopValue: true },
      after: { tagKey: "stop_cmd", adapterId: 3, dataType: "bool", stopValue: null, commissioningRecheckRequired: false, autoClearedBy: "tag_redefined" },
      reason: "auto-clear: tag_redefined (mapping_import_cli)" };
    const g = "0".repeat(64);
    expect(hashMjs(g, f1, 1_700_000_000_000)).toBe(hashTs(g, f1, 1_700_000_000_000));
    const h1 = hashMjs(g, f1, 1);
    const f2 = { ...f1, entityId: "8" };
    const h2 = hashMjs(h1, f2, 2);
    const row = (id: number, f: typeof f1, prevHash: string, hash: string, hashTs: number) => ({
      id, entityType: f.entityType, entityId: f.entityId, action: f.action, actorId: f.actorId,
      beforeJson: f.before, afterJson: f.after, reason: f.reason, prevHash, hash, hashTs,
    });
    expect(verifyAuditRows([row(1, f1, g, h1, 1), row(2, f2, h1, h2, 2)])).toMatchObject({ ok: true, checked: 2 });
  });

  it("lyDoGoStopPinCli ≡ lyDoGoStopPinKhiSuaTag trên cùng bộ ca (hàng đang ghim × tag trong file)", () => {
    const db = { id: 1, adapterId: 3, tagKey: "stop_cmd", address: "DB1.X0", dataType: "bool", scale: "1.000000", offset: "0.000000", writable: true, isEnabled: true, stop_value: true };
    const file = { name: "stop_cmd", address: "DB1.X0", datatype: "bool", scale: 1, offset: 0, writable: true, enabled: true };
    const ca: Array<Partial<typeof file>> = [
      {}, { address: "DB9.X9" }, { datatype: "int" }, { scale: 2 }, { offset: 5 }, { writable: false }, { enabled: false },
      { scale: undefined, offset: undefined }, { scale: 0 },
    ];
    for (const doi of ca) {
      const f = { ...file, ...doi };
      const tsExisting = { ...db, stopValue: db.stop_value } as any;
      const patch = { address: f.address, dataType: f.datatype, scale: String(f.scale ?? 1), offset: String(f.offset ?? 0), writable: f.writable, isEnabled: f.enabled };
      expect(lyDoGoStopPinCli(db, f), JSON.stringify(doi)).toBe(lyDoGoStopPinKhiSuaTag(tsExisting, patch));
    }
    expect(lyDoGoStopPinCli({ ...db, stop_value: null }, { ...file, address: "X" })).toBeNull();
  });
});
