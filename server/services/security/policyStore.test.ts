/**
 * Policy store tests — doc 44 W3-A1 (gap G3.13).
 *
 *  • as-code parsing/validation (contracts/policies/*.policy.yaml format)
 *  • the SHIPPED files parse and preserve DEFAULT_POLICIES semantics
 *  • Git→DB sync against a mocked db (pattern: vi.mock ../../db/connection,
 *    mirrors schemaRegistryPersistence.test.ts): insert / unchanged / content
 *    upsert / VERSION GUARD (file version < DB → skip + warn) / new version
 *  • rowsToRules: active-only + highest version per policy_id
 *  • initPolicyStore: flag OFF → total no-op
 *  • snapshot: store ON → evaluatePolicy consumes the DB rules synchronously
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── mocked persistence (in-memory row store standing in for policy_definitions) ──
interface FakeDefRow {
  id: number;
  policyId: string;
  version: number;
  effect: string;
  actionPattern: string | null;
  resourcePattern: string | null;
  conditions: Array<{ path: string; op: string; value?: unknown }>;
  priority: number;
  status: string;
  source: string;
  description: string | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}
const defRows: FakeDefRow[] = [];
const updateCalls: Array<Record<string, unknown>> = [];
const logRows: Array<Record<string, unknown>> = [];

vi.mock("../../db/connection", async () => {
  const { policyDefinitions } = await import("../../../drizzle/schema");
  return {
    getDb: vi.fn(async () => ({
      select: () => ({
        from: async (tbl: unknown) => (tbl === policyDefinitions ? [...defRows] : [...logRows]),
      }),
      insert: (tbl: unknown) => ({
        values: (v: Record<string, unknown>) => {
          if (tbl === policyDefinitions) {
            defRows.push({
              id: defRows.length + 1,
              policyId: v.policyId as string,
              version: v.version as number,
              effect: v.effect as string,
              actionPattern: (v.actionPattern as string | null) ?? null,
              resourcePattern: (v.resourcePattern as string | null) ?? null,
              conditions: (v.conditions as FakeDefRow["conditions"]) ?? [],
              priority: (v.priority as number) ?? 0,
              status: (v.status as string) ?? "active",
              source: (v.source as string) ?? "git",
              description: (v.description as string | null) ?? null,
              updatedBy: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            logRows.push(v);
          }
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: () => {
            updateCalls.push(s);
            return Promise.resolve();
          },
        }),
      }),
    })),
  };
});

import {
  parsePolicyDefinitionsYaml,
  loadPolicyFiles,
  syncPoliciesFromFiles,
  rowsToRules,
  initPolicyStore,
  policyStoreEnabled,
  refreshPolicySnapshot,
  getPolicySnapshotSync,
  POLICY_CONTRACTS_DIR,
  _resetPolicyStoreForTests,
} from "./policyStore";
import { evaluatePolicy } from "./policyEvaluate";
import { POLICY_REASON_CODES } from "./policyEngine";
import type { PolicyDefinition } from "../../../drizzle/schema";

const OT_ALLOW_YAML = `
policy_id: allow-ot-command-engineer-fat
version: 1
effect: allow
action_pattern: "ot.command.*"
priority: 10
status: active
description: "allow OT for engineer with FAT"
conditions:
  - path: context.role
    op: in
    value: [engineer, admin]
  - path: context.fat_passed
    op: eq
    value: true
`;

function writeTmpPolicies(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policies-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

beforeEach(() => {
  defRows.length = 0;
  updateCalls.length = 0;
  logRows.length = 0;
  _resetPolicyStoreForTests();
});
afterEach(() => {
  delete process.env.POLICY_STORE_ENABLED;
  delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
});

describe("parsePolicyDefinitionsYaml — as-code validation", () => {
  it("parses a valid definition", () => {
    const defs = parsePolicyDefinitionsYaml(OT_ALLOW_YAML, "x.policy.yaml");
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      policyId: "allow-ot-command-engineer-fat",
      version: 1,
      effect: "allow",
      actionPattern: "ot.command.*",
      priority: 10,
      status: "active",
    });
    expect(defs[0].conditions).toHaveLength(2);
  });

  it("rejects missing policy_id / bad effect / bad op", () => {
    expect(() => parsePolicyDefinitionsYaml("version: 1\neffect: deny", "f.policy.yaml")).toThrow(/policy_id/);
    expect(() =>
      parsePolicyDefinitionsYaml("policy_id: p\nversion: 1\neffect: block", "f.policy.yaml"),
    ).toThrow(/effect/);
    expect(() =>
      parsePolicyDefinitionsYaml(
        "policy_id: p\nversion: 1\neffect: deny\nconditions:\n  - path: a\n    op: matches",
        "f.policy.yaml",
      ),
    ).toThrow(/op/);
  });

  it("rejects an unconditioned deny (empty conditions never match) and an unscoped allow", () => {
    expect(() =>
      parsePolicyDefinitionsYaml("policy_id: p\nversion: 1\neffect: deny\naction_pattern: x", "f.policy.yaml"),
    ).toThrow(/requires at least one condition/);
    expect(() => parsePolicyDefinitionsYaml("policy_id: p\nversion: 1\neffect: allow", "f.policy.yaml")).toThrow(
      /action-scoped/,
    );
  });
});

describe("shipped contracts/policies files", () => {
  it("all 9 as-code files parse; the 3 legacy conversions keep DEFAULT_POLICIES semantics", () => {
    const defs = loadPolicyFiles(POLICY_CONTRACTS_DIR);
    expect(defs.map((d) => d.policyId).sort()).toEqual([
      "allow-fleet-vda5050-order-confirmed", // W3-B2 G3.14 (fleet.vda5050.*)
      "allow-foe-command-engineer", // W3-B2 G3.14 (foe.command.*)
      "allow-line-command-fsm", // doc 48 R1 T3 (line.command.*)
      "allow-order-command-lifecycle", // doc 48 R1 T3 (order.command.*)
      "allow-ot-command-engineer-fat",
      "allow-robot-job-engineer-fat",
      "approve-override-crowded-zone",
      "approve-recipe-write-production",
      "deny-skip-aoi-class3",
    ]);
    // Semantics parity: evaluate through the file-derived rules — same verdicts
    // as DEFAULT_POLICIES for the three legacy scenarios.
    const rules = rowsToRules(
      defs.map((d, i) => ({
        id: i + 1,
        policyId: d.policyId,
        version: d.version,
        effect: d.effect,
        actionPattern: d.actionPattern,
        resourcePattern: d.resourcePattern,
        conditions: d.conditions,
        priority: d.priority,
        status: d.status,
        source: "git",
        description: d.description,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as unknown as PolicyDefinition[],
    );
    const deny = evaluatePolicy("t", "skip_step", null, { step: { type: "AOI" }, product: { class: 3 } }, { policies: rules, skipAudit: true });
    expect(deny.decision).toBe("DENY");
    expect(deny.policy_ref).toBe("deny-skip-aoi-class3");
    const approval = evaluatePolicy("t", "manual_override", null, { zone: { density: 0.9 } }, { policies: rules, skipAudit: true });
    expect(approval.obligations).toEqual(["require_approval"]);
    expect(approval.policy_ref).toBe("approve-override-crowded-zone");
    const recipe = evaluatePolicy("t", "recipe_write", null, { line: { state: "running" } }, { policies: rules, skipAudit: true });
    expect(recipe.obligations).toEqual(["require_approval"]);
    expect(recipe.policy_ref).toBe("approve-recipe-write-production");

    // doc 48 R1 (T3): under default-deny for line/order namespaces, the new allow
    // policies PERMIT legitimate FSM/lifecycle transitions (so flipping default-deny
    // won't break the Line Controller / order lifecycle), while malformed commands DENY.
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "line.command.*,order.command.*";
    try {
      const lineOk = evaluatePolicy("command", "line.command.producing", null, { actor: "u42", lineId: 1, from: "ready", to: "producing" }, { policies: rules, skipAudit: true });
      expect(lineOk.decision).toBe("PERMIT");
      expect(lineOk.policy_ref).toBe("allow-line-command-fsm");
      // auto pre-check (line.command.hold, no `to`) is still PERMITted → autohold survives default-deny.
      const lineHold = evaluatePolicy("command", "line.command.hold", null, { actor: "system:autohold", lineId: 1, auto: true }, { policies: rules, skipAudit: true });
      expect(lineHold.decision).toBe("PERMIT");
      const orderOk = evaluatePolicy("command", "order.command.running", null, { actor: "u42", orderId: 9, fromState: "allocated", toState: "running" }, { policies: rules, skipAudit: true });
      expect(orderOk.decision).toBe("PERMIT");
      expect(orderOk.policy_ref).toBe("allow-order-command-lifecycle");
      // malformed line command (no actor) → NO_MATCHING_ALLOW_POLICY → DENY.
      const lineBad = evaluatePolicy("command", "line.command.producing", null, { lineId: 1 }, { policies: rules, skipAudit: true });
      expect(lineBad.decision).toBe("DENY");
    } finally {
      delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
    }
  });
});

describe("syncPoliciesFromFiles — Git→DB (mocked db)", () => {
  it("fresh DB → inserts all definitions with source git; re-run → unchanged", async () => {
    const dir = writeTmpPolicies({ "ot.policy.yaml": OT_ALLOW_YAML });
    const first = await syncPoliciesFromFiles({ dir });
    expect(first).toEqual([{ policyId: "allow-ot-command-engineer-fat", version: 1, action: "inserted" }]);
    expect(defRows).toHaveLength(1);
    expect(defRows[0].source).toBe("git");

    const again = await syncPoliciesFromFiles({ dir });
    expect(again[0].action).toBe("unchanged");
    expect(defRows).toHaveLength(1);
    expect(updateCalls).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("same version + changed content → idempotent content upsert (UPDATE, no new row)", async () => {
    const dir = writeTmpPolicies({ "ot.policy.yaml": OT_ALLOW_YAML });
    await syncPoliciesFromFiles({ dir });
    fs.writeFileSync(path.join(dir, "ot.policy.yaml"), OT_ALLOW_YAML.replace("priority: 10", "priority: 20"));
    const res = await syncPoliciesFromFiles({ dir });
    expect(res[0].action).toBe("updated");
    expect(defRows).toHaveLength(1); // no duplicate row
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ priority: 20 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("VERSION GUARD: file version < DB version → skip + warn (DB governance wins)", async () => {
    defRows.push({
      id: 1,
      policyId: "allow-ot-command-engineer-fat",
      version: 2,
      effect: "allow",
      actionPattern: "ot.command.*",
      resourcePattern: null,
      conditions: [{ path: "context.role", op: "eq", value: "admin" }],
      priority: 0,
      status: "active",
      source: "db",
      description: "governance-edited v2",
      updatedBy: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = writeTmpPolicies({ "ot.policy.yaml": OT_ALLOW_YAML }); // file is version 1
    const res = await syncPoliciesFromFiles({ dir });
    expect(res[0].action).toBe("skipped_older");
    expect(defRows).toHaveLength(1); // nothing inserted
    expect(updateCalls).toHaveLength(0); // nothing overwritten
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DB governance is ahead"));
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("file version > DB version → a NEW version row is inserted", async () => {
    const dir = writeTmpPolicies({ "ot.policy.yaml": OT_ALLOW_YAML });
    await syncPoliciesFromFiles({ dir });
    fs.writeFileSync(path.join(dir, "ot.policy.yaml"), OT_ALLOW_YAML.replace("version: 1", "version: 2"));
    const res = await syncPoliciesFromFiles({ dir });
    expect(res[0]).toMatchObject({ version: 2, action: "inserted" });
    expect(defRows).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("rowsToRules — active-only, highest version wins", () => {
  it("maps rows and picks the latest active version per policy_id", () => {
    const base = {
      actionPattern: "ot.command.*",
      resourcePattern: null,
      conditions: [{ path: "context.role", op: "eq", value: "engineer" }],
      priority: 5,
      source: "git",
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const rules = rowsToRules([
      { id: 1, policyId: "p1", version: 1, effect: "allow", status: "active", description: "v1", ...base },
      { id: 2, policyId: "p1", version: 3, effect: "allow", status: "active", description: "v3", ...base },
      { id: 3, policyId: "p1", version: 2, effect: "allow", status: "active", description: "v2", ...base },
      { id: 4, policyId: "p2", version: 1, effect: "deny", status: "disabled", description: "off", ...base },
    ] as unknown as PolicyDefinition[]);
    expect(rules).toHaveLength(1); // p2 disabled, p1 collapsed to latest
    expect(rules[0]).toMatchObject({ id: "p1", version: "3", reason: "v3", priority: 5 });
  });
});

describe("initPolicyStore + snapshot (flag-gated boot, default OFF)", () => {
  it("flag OFF → total no-op (no rows read/written, snapshot null)", async () => {
    expect(policyStoreEnabled({})).toBe(false);
    const r = await initPolicyStore();
    expect(r).toEqual({ enabled: false, synced: [], loaded: 0 });
    expect(getPolicySnapshotSync()).toBeNull();
    expect(defRows).toHaveLength(0);
  });

  it("store ON → evaluatePolicy consumes the DB rules synchronously via the snapshot", async () => {
    process.env.POLICY_STORE_ENABLED = "true";
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*";
    defRows.push({
      id: 1,
      policyId: "allow-ot-command-engineer-fat",
      version: 1,
      effect: "allow",
      actionPattern: "ot.command.*",
      resourcePattern: null,
      conditions: [
        { path: "context.role", op: "in", value: ["engineer", "admin"] },
        { path: "context.fat_passed", op: "eq", value: true },
      ],
      priority: 10,
      status: "active",
      source: "git",
      description: "allow OT for engineer with FAT",
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await refreshPolicySnapshot();
    expect(getPolicySnapshotSync()).toHaveLength(1);

    // In-group + explicit allow from the STORE (not DEFAULT_POLICIES) → PERMIT.
    const permit = evaluatePolicy("orchestration", "ot.command.start", null, { role: "engineer", fat_passed: true });
    expect(permit.decision).toBe("PERMIT");
    expect(permit.reason_code).toBe(POLICY_REASON_CODES.POLICY_ALLOWED);
    expect(permit.policy_ref).toBe("allow-ot-command-engineer-fat");

    // Same action without FAT → DENY (no allow match, in-group).
    const deny = evaluatePolicy("orchestration", "ot.command.start", null, { role: "engineer", fat_passed: false });
    expect(deny.decision).toBe("DENY");
    expect(deny.reason_code).toBe(POLICY_REASON_CODES.NO_MATCHING_ALLOW_POLICY);
  });
});
