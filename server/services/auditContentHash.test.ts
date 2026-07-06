/**
 * D4 CRUD-audit content-hash tests — SYNAPSE §5.11.2 (doc 33 D4).
 * Per-row tamper-evidence for the high-frequency CRUD audit (no chain; perf-safe).
 */
import { describe, it, expect } from "vitest";

import { computeCrudContentHash, verifyCrudContentHash } from "./auditTrailService";

const base = { userId: 1, action: "update", entityType: "product", entityId: 42, entityName: "P1", details: { field: "x", timestamp: "t0" } };
const hashTs = 1000;

function hashed() {
  const hash = computeCrudContentHash(base, hashTs);
  return { ...base, details: { ...base.details, hashTs, contentHash: hash } };
}

describe("computeCrudContentHash", () => {
  it("is deterministic and ignores the injected hash fields", () => {
    const h1 = computeCrudContentHash(base, hashTs);
    const h2 = computeCrudContentHash({ ...base, details: { ...base.details, contentHash: "x", hashTs } }, hashTs);
    expect(h1).toBe(h2); // stableDetails strips contentHash/hashTs before hashing
  });
});

describe("verifyCrudContentHash", () => {
  it("verifies an intact row", () => {
    expect(verifyCrudContentHash(hashed()).ok).toBe(true);
  });
  it("detects a tampered core field (action / entityId)", () => {
    expect(verifyCrudContentHash({ ...hashed(), action: "delete" }).ok).toBe(false);
    expect(verifyCrudContentHash({ ...hashed(), entityId: 99 }).ok).toBe(false);
  });
  it("detects a tampered details payload", () => {
    const row = hashed();
    expect(verifyCrudContentHash({ ...row, details: { ...row.details, field: "y" } }).ok).toBe(false);
  });
  it("legacy/unhashed rows pass (no contentHash)", () => {
    expect(verifyCrudContentHash(base).ok).toBe(true);
  });
});
