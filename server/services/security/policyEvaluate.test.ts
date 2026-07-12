/**
 * evaluatePolicy — standardized SYNAPSE §11.2 decision tests (doc 44 W3-A1,
 * gaps G3.11 + G3.12 + G3.16).
 *
 *  • standard shape: PERMIT/DENY + obligations[] + reason_code + policy_ref + latency_ms
 *  • legacy mapping: deny → DENY/POLICY_DENIED; require_approval → PERMIT +
 *    obligations ["require_approval"]; no match → PERMIT/DEFAULT_ALLOW
 *  • default-deny groups (POLICY_DEFAULT_DENY_ACTIONS): in-group without an
 *    explicit allow → DENY/NO_MATCHING_ALLOW_POLICY; out-of-group keeps legacy
 *    default-allow; explicit allow rule PERMITs; deny still wins inside the group
 *  • fail-safe: evaluator throw → in-group DENY/EVALUATOR_ERROR (never fail-open),
 *    out-of-group legacy pass-through PERMIT
 *  • wrapper bit-compat: evaluateCommandPolicy returns the EXACT legacy shape
 *    (policyGate.test.ts continues to pass untouched — additional proof here)
 *  • append-only decision log gating (mocked db): DENY + require-approval always,
 *    PERMIT only in-group or with POLICY_AUDIT_PERMIT_ALL, secrets redacted
 *  • G3.16: policy-eval-p95 observation provider returns real numbers
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── mocked persistence (captures policy_decision_log inserts) ────────────────
const logRows: Array<Record<string, unknown>> = [];

vi.mock("../../db/connection", async () => {
  const { policyDecisionLog } = await import("../../../drizzle/schema");
  return {
    getDb: vi.fn(async () => ({
      select: () => ({ from: async () => [] }),
      insert: (tbl: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (tbl === policyDecisionLog) logRows.push(v);
          return Promise.resolve();
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    })),
  };
});

import { evaluatePolicy } from "./policyEvaluate";
import { evaluateCommandPolicy } from "./policyGate";
import { DEFAULT_POLICIES, POLICY_REASON_CODES, type PolicyRule } from "./policyEngine";
import { flushPolicyDecisionLog, _resetPolicyStoreForTests } from "./policyStore";
import { policyEvalSloObservation, currentP95Ms, _resetPolicyEvalSloForTests } from "./policyLatency";

const ALLOW_OT_RULE: PolicyRule = {
  id: "allow-ot-command-engineer-fat",
  effect: "allow",
  version: "1",
  actionPattern: "ot.command.*",
  priority: 10,
  reason: "OT allow for engineer with FAT passed",
  conditions: [
    { path: "context.role", op: "in", value: ["engineer", "admin"] },
    { path: "context.fat_passed", op: "eq", value: true },
  ],
};

beforeEach(() => {
  logRows.length = 0;
  _resetPolicyStoreForTests();
  _resetPolicyEvalSloForTests();
});
afterEach(() => {
  delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
  delete process.env.POLICY_AUDIT_PERMIT_ALL;
  delete process.env.POLICY_STORE_ENABLED;
});

describe("evaluatePolicy — standardized §11.2 shape (G3.12)", () => {
  it("deny policy → DENY + POLICY_DENIED + policy_ref + latency_ms", () => {
    const d = evaluatePolicy("test", "skip_step", null, { step: { type: "AOI" }, product: { class: 3 } });
    expect(d.decision).toBe("DENY");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.POLICY_DENIED);
    expect(d.policy_ref).toBe("deny-skip-aoi-class3");
    expect(d.obligations).toEqual([]);
    expect(typeof d.latency_ms).toBe("number");
    expect(d.latency_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_ms).toBeLessThan(20); // spec SLO ≤ 20ms — pure in-process
  });

  it("require_approval → PERMIT + obligations ['require_approval'] (caller enforces)", () => {
    const d = evaluatePolicy("test", "manual_override", null, { zone: { density: 0.9 } });
    expect(d.decision).toBe("PERMIT");
    expect(d.obligations).toEqual(["require_approval"]);
    expect(d.reason_code).toBe(POLICY_REASON_CODES.APPROVAL_REQUIRED);
    expect(d.policy_ref).toBe("approve-override-crowded-zone");
  });

  it("no matching policy, no default-deny group → PERMIT + DEFAULT_ALLOW (legacy)", () => {
    const d = evaluatePolicy("test", "device_write", null, {});
    expect(d.decision).toBe("PERMIT");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.DEFAULT_ALLOW);
    expect(d.policy_ref).toBeNull();
    expect(d.reason).toBe("no matching policy");
  });
});

describe("default-deny action groups (G3.11)", () => {
  beforeEach(() => {
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*,robot.*,deploy.*";
  });

  it("in-group action with NO explicit allow → DENY + NO_MATCHING_ALLOW_POLICY", () => {
    const d = evaluatePolicy("orchestration", "ot.command.start", "HANOI/ASSY/LINE1", { role: "engineer" });
    expect(d.decision).toBe("DENY");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.NO_MATCHING_ALLOW_POLICY);
    expect(d.policy_ref).toBeNull();
  });

  it("out-of-group action keeps legacy default-allow (transition phase)", () => {
    const d = evaluatePolicy("test", "device_write", null, {});
    expect(d.decision).toBe("PERMIT");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.DEFAULT_ALLOW);
  });

  it("explicit allow rule match inside the group → PERMIT + POLICY_ALLOWED", () => {
    const d = evaluatePolicy(
      "orchestration",
      "ot.command.start",
      "HANOI/ASSY/LINE1",
      { role: "engineer", fat_passed: true },
      { policies: [...DEFAULT_POLICIES, ALLOW_OT_RULE] },
    );
    expect(d.decision).toBe("PERMIT");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.POLICY_ALLOWED);
    expect(d.policy_ref).toBe("allow-ot-command-engineer-fat");
  });

  it("allow rule does NOT match when its conditions fail (fat_passed false) → DENY", () => {
    const d = evaluatePolicy(
      "orchestration",
      "ot.command.start",
      null,
      { role: "engineer", fat_passed: false },
      { policies: [...DEFAULT_POLICIES, ALLOW_OT_RULE] },
    );
    expect(d.decision).toBe("DENY");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.NO_MATCHING_ALLOW_POLICY);
  });

  it("deny rule still wins over an allow rule inside the group", () => {
    const denyRule: PolicyRule = {
      id: "deny-ot-during-estop",
      effect: "deny",
      version: "1",
      actionPattern: "ot.command.*",
      priority: 100,
      reason: "e-stop active",
      conditions: [{ path: "context.safety", op: "neq", value: "OK" }],
    };
    const d = evaluatePolicy(
      "orchestration",
      "ot.command.start",
      null,
      { role: "engineer", fat_passed: true, safety: "ESTOP" },
      { policies: [denyRule, ALLOW_OT_RULE] },
    );
    expect(d.decision).toBe("DENY");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.POLICY_DENIED);
    expect(d.policy_ref).toBe("deny-ot-during-estop");
  });
});

describe("fail-safe on evaluator error (G3.11 — never fail-open in-group)", () => {
  const poisoned = new Proxy([] as PolicyRule[], {
    get() {
      throw new Error("boom — poisoned rule source");
    },
  });

  it("throw + action IN the default-deny group → DENY + EVALUATOR_ERROR", () => {
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = evaluatePolicy("test", "ot.command.start", null, {}, { policies: poisoned });
    expect(d.decision).toBe("DENY");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.EVALUATOR_ERROR);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throw + action OUTSIDE the group → legacy pass-through PERMIT + log", () => {
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = evaluatePolicy("test", "device_write", null, {}, { policies: poisoned });
    expect(d.decision).toBe("PERMIT");
    expect(d.reason_code).toBe(POLICY_REASON_CODES.EVALUATOR_ERROR);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("evaluateCommandPolicy wrapper — legacy bit-compat (G3.12)", () => {
  it("flags OFF → the four legacy verdicts are byte-identical to the old adapter", () => {
    // 1) disabled → allow-all
    expect(
      evaluateCommandPolicy({ action: "skip_step", step: { type: "AOI" }, product: { class: 3 } }, { enabled: false }),
    ).toEqual({ allow: true, effect: "allow", reason: "SEC_PLATFORM off", policyId: null });
    // 2) deny
    expect(
      evaluateCommandPolicy({ action: "skip_step", step: { type: "AOI" }, product: { class: 3 } }, { enabled: true }),
    ).toEqual({
      allow: false,
      effect: "deny",
      reason: "Cấm bỏ bước kiểm AOI với sản phẩm class-3 (không thương lượng).",
      policyId: "deny-skip-aoi-class3",
    });
    // 3) require_approval without/with approval
    const ctx = { action: "manual_override", zone: { density: 0.9 } };
    expect(evaluateCommandPolicy(ctx, { enabled: true })).toEqual({
      allow: false,
      effect: "require_approval",
      reason: "Ghi đè khi robot đang ở zone đông người → cần phê duyệt quản lý (four-eyes).",
      policyId: "approve-override-crowded-zone",
    });
    expect(evaluateCommandPolicy(ctx, { enabled: true, approved: true })).toEqual({
      allow: true,
      effect: "require_approval",
      reason: "approved: Ghi đè khi robot đang ở zone đông người → cần phê duyệt quản lý (four-eyes).",
      policyId: "approve-override-crowded-zone",
    });
    // 4) default allow
    expect(evaluateCommandPolicy({ action: "device_write" }, { enabled: true })).toEqual({
      allow: true,
      effect: "allow",
      reason: "no matching policy",
      policyId: null,
    });
  });
});

describe("append-only decision log (G3.13)", () => {
  it("DENY is always logged (with redacted context)", async () => {
    evaluatePolicy("test", "skip_step", "LINE1", {
      step: { type: "AOI" },
      product: { class: 3 },
      password: "s3cret",
    });
    await flushPolicyDecisionLog();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      action: "skip_step",
      resource: "LINE1",
      decision: "DENY",
      reasonCode: POLICY_REASON_CODES.POLICY_DENIED,
      policyRef: "deny-skip-aoi-class3",
    });
    const summary = logRows[0].contextSummary as Record<string, unknown>;
    expect(summary.password).toBe("[redacted]"); // NEVER a secret in the log
  });

  it("require-approval PERMIT is always logged with its obligation", async () => {
    evaluatePolicy("test", "manual_override", null, { zone: { density: 0.9 } });
    await flushPolicyDecisionLog();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ decision: "PERMIT", obligations: ["require_approval"] });
  });

  it("plain PERMIT outside the group is NOT logged (volume guard)", async () => {
    evaluatePolicy("test", "device_write", null, {});
    await flushPolicyDecisionLog();
    expect(logRows).toHaveLength(0);
  });

  it("PERMIT of an in-group action IS logged", async () => {
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*";
    evaluatePolicy(
      "orchestration",
      "ot.command.start",
      null,
      { role: "engineer", fat_passed: true },
      { policies: [ALLOW_OT_RULE] },
    );
    await flushPolicyDecisionLog();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      decision: "PERMIT",
      reasonCode: POLICY_REASON_CODES.POLICY_ALLOWED,
      policyRef: "allow-ot-command-engineer-fat",
    });
  });

  it("POLICY_AUDIT_PERMIT_ALL=true logs every PERMIT (full spec mode)", async () => {
    process.env.POLICY_AUDIT_PERMIT_ALL = "true";
    evaluatePolicy("test", "device_write", null, {});
    await flushPolicyDecisionLog();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ decision: "PERMIT", reasonCode: POLICY_REASON_CODES.DEFAULT_ALLOW });
  });
});

describe("policy-eval-p95 SLO feed (G3.16)", () => {
  it("observation provider returns real numbers after evaluations", () => {
    expect(policyEvalSloObservation()).toBeNull(); // honest: no data yet
    for (let i = 0; i < 5; i++) evaluatePolicy("test", "device_write", null, {});
    const obs = policyEvalSloObservation();
    expect(obs).not.toBeNull();
    expect(obs!.long.total).toBeGreaterThanOrEqual(5);
    expect(obs!.long.good).toBeGreaterThanOrEqual(1); // pure in-process ≪ 20ms
    expect(obs!.short.total).toBeGreaterThanOrEqual(5);
    const p95 = currentP95Ms();
    expect(typeof p95).toBe("number");
    expect(p95!).toBeGreaterThanOrEqual(0);
  });
});
