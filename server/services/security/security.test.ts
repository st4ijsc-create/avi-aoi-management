/**
 * Security platform-grade tests — SYNAPSE §5.11 (doc 33 F5 · H1).
 * Policy-as-code evaluator + hash-chain WORM audit.
 */
import { describe, it, expect } from "vitest";

import {
  evaluatePolicies,
  evalCondition,
  resolvePath,
  policyMatches,
  DEFAULT_POLICIES,
  type Policy,
} from "./policyEngine";
import { appendRecord, verifyChain, GENESIS_HASH, canonicalize, type AuditRecord } from "./auditChain";

describe("policyEngine — conditions", () => {
  it("resolvePath reads nested + safely misses", () => {
    expect(resolvePath({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(resolvePath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(resolvePath(null, "a")).toBeUndefined();
  });
  it("operators incl. numeric comparisons fail-safe on missing", () => {
    expect(evalCondition({ x: 5 }, { path: "x", op: "gt", value: 3 })).toBe(true);
    expect(evalCondition({ x: 5 }, { path: "x", op: "lte", value: 5 })).toBe(true);
    expect(evalCondition({}, { path: "x", op: "gt", value: 3 })).toBe(false); // missing → no match
    expect(evalCondition({ c: 3 }, { path: "c", op: "eq", value: 3 })).toBe(true);
    expect(evalCondition({ t: ["a"] }, { path: "t", op: "exists" })).toBe(true);
  });
});

describe("policyEngine — evaluation precedence", () => {
  it("denies skip AOI on class-3 product (SDD §5.11.2)", () => {
    const d = evaluatePolicies(
      { action: "skip_step", step: { type: "AOI" }, product: { class: 3 } },
      DEFAULT_POLICIES,
    );
    expect(d.effect).toBe("deny");
    expect(d.policyId).toBe("deny-skip-aoi-class3");
  });
  it("allows skip AOI on class-1 product", () => {
    const d = evaluatePolicies(
      { action: "skip_step", step: { type: "AOI" }, product: { class: 1 } },
      DEFAULT_POLICIES,
    );
    expect(d.effect).toBe("allow");
  });
  it("requires approval for override in a crowded zone", () => {
    const d = evaluatePolicies(
      { action: "manual_override", zone: { density: 0.9 } },
      DEFAULT_POLICIES,
    );
    expect(d.effect).toBe("require_approval");
  });
  it("deny wins over require_approval", () => {
    const policies: Policy[] = [
      { id: "a", effect: "require_approval", version: "1", reason: "r", conditions: [{ path: "x", op: "exists" }] },
      { id: "b", effect: "deny", version: "1", reason: "r", conditions: [{ path: "x", op: "exists" }] },
    ];
    expect(evaluatePolicies({ x: 1 }, policies).effect).toBe("deny");
  });
  it("an action-filtered policy ignores other actions; empty policy never matches", () => {
    const p: Policy = { id: "z", effect: "deny", version: "1", reason: "r", actions: ["foo"], conditions: [{ path: "x", op: "exists" }] };
    expect(policyMatches({ action: "bar", x: 1 }, p)).toBe(false);
    const empty: Policy = { id: "e", effect: "deny", version: "1", reason: "r", conditions: [] };
    expect(policyMatches({ x: 1 }, empty)).toBe(false);
  });
});

describe("auditChain — hash-chain WORM", () => {
  const build = (): AuditRecord[] => {
    const recs: AuditRecord[] = [];
    let prev: AuditRecord | null = null;
    for (let i = 0; i < 5; i++) {
      const r = appendRecord({ seq: i, ts: 1000 + i, event: "e", actor: "u1", payload: { i } }, prev);
      recs.push(r);
      prev = r;
    }
    return recs;
  };

  it("genesis prevHash + intact chain verifies", () => {
    const recs = build();
    expect(recs[0].prevHash).toBe(GENESIS_HASH);
    expect(verifyChain(recs)).toEqual({ ok: true, brokenAt: -1 });
  });
  it("editing a record payload breaks the chain (tamper-evident)", () => {
    const recs = build();
    (recs[2] as { payload: unknown }).payload = { i: 999 }; // tamper
    const v = verifyChain(recs);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
  it("deleting a record breaks linkage", () => {
    const recs = build();
    recs.splice(2, 1);
    expect(verifyChain(recs).ok).toBe(false);
  });
  it("canonicalize is key-order stable", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
});
