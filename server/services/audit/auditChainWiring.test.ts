/**
 * Control-audit hash-chain wiring tests — SYNAPSE §5.11.2 (doc 33 I4).
 * Pure helpers (computeAuditHash / verifyAuditRows); the DB path is exercised by the
 * app's DB-integration suite when SEC_PLATFORM is on.
 */
import { describe, it, expect } from "vitest";

import { computeAuditHash, verifyAuditRows, type AuditHashFields, type HashedAuditRow } from "./controlAuditService";
import { GENESIS_HASH } from "../security/auditChain";

function fields(action: string, actorId: number | null = 1): AuditHashFields {
  return { entityType: "interlock_rule", entityId: "42", action, actorId, before: null, after: { enabled: true }, reason: "test" };
}

/** Build a valid hashed chain of `n` rows. */
function buildChain(n: number): HashedAuditRow[] {
  const rows: HashedAuditRow[] = [];
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const f = fields(`action_${i}`);
    const ts = 1000 + i;
    const hash = computeAuditHash(prevHash, f, ts);
    rows.push({
      id: i + 1,
      entityType: f.entityType,
      entityId: f.entityId,
      action: f.action,
      actorId: f.actorId,
      beforeJson: f.before,
      afterJson: f.after,
      reason: f.reason,
      prevHash,
      hash,
      hashTs: ts,
    });
    prevHash = hash;
  }
  return rows;
}

describe("computeAuditHash", () => {
  it("is deterministic + prevHash-sensitive", () => {
    const f = fields("approve");
    expect(computeAuditHash(GENESIS_HASH, f, 100)).toBe(computeAuditHash(GENESIS_HASH, f, 100));
    expect(computeAuditHash("aaa", f, 100)).not.toBe(computeAuditHash("bbb", f, 100));
  });
});

describe("verifyAuditRows", () => {
  it("first row links to GENESIS; intact chain verifies", () => {
    const rows = buildChain(5);
    expect(rows[0].prevHash).toBe(GENESIS_HASH);
    expect(verifyAuditRows(rows)).toEqual({ ok: true, checked: 5, brokenAtId: null });
  });
  it("editing a row's content breaks the chain (tamper-evident)", () => {
    const rows = buildChain(5);
    rows[2].action = "TAMPERED";
    const v = verifyAuditRows(rows);
    expect(v.ok).toBe(false);
    expect(v.brokenAtId).toBe(3);
  });
  it("deleting a row breaks linkage", () => {
    const rows = buildChain(5);
    rows.splice(2, 1);
    expect(verifyAuditRows(rows).ok).toBe(false);
  });
  it("legacy unhashed rows are skipped (mixed table stays verifiable)", () => {
    const legacy: HashedAuditRow = {
      id: 0, entityType: "x", entityId: "1", action: "old", actorId: null,
      beforeJson: null, afterJson: null, reason: null, prevHash: null, hash: null, hashTs: null,
    };
    const rows = [legacy, ...buildChain(3)];
    expect(verifyAuditRows(rows).ok).toBe(true);
  });
});
