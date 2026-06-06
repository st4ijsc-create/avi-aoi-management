/**
 * Sprint F5a — propose_interlock_rule write-tool safety tests.
 *
 *   - The tool is kind:'write' with requiredPermission interlock/canCreate.
 *   - execute() ALWAYS inserts enabled=false, approvedBy=null, approvedAt=null,
 *     requiresHumanConfirm=true (a proposed rule can never auto-act).
 *   - There is NO AI tool to enable/approve/trigger an interlock rule.
 *   - The tool module never imports a command dispatcher / writeTags.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

let inserted: any = null;
function fakeDb() {
  return {
    insert: () => ({
      values: (vals: any) => {
        inserted = vals;
        return { returning: async () => [{ id: 42, ...vals }] };
      },
    }),
  };
}
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb()) }));
vi.mock("../../../../drizzle/schema", () => ({ interlockRules: { __t: "interlock_rules" } }));

import { getTool, listTools } from "../toolRegistry";
import "./interlock"; // self-registers

beforeEach(() => {
  inserted = null;
});

const ctx = { user: { id: 3, role: "supervisor", name: "Sup" }, lang: "vi" as const };

describe("propose_interlock_rule", () => {
  it("is a write tool gated on interlock/canCreate", () => {
    const tool = getTool("propose_interlock_rule");
    expect(tool).toBeDefined();
    expect(tool!.kind).toBe("write");
    expect(tool!.requiredPermission).toEqual({ module: "interlock", action: "canCreate" });
  });

  it("execute inserts a SAFE rule (disabled, unapproved, human-confirm)", async () => {
    const tool = getTool("propose_interlock_rule")!;
    const args = {
      name: "NG spike block",
      scope: "machine" as const,
      machineId: 5,
      sourceType: "ng_rate" as const,
      comparisonOperator: "gt" as const,
      threshold: 10,
      action: "block_downstream" as const,
    };
    const res = await tool.execute!(args as any, ctx as any);
    expect(res.type).toBe("action_result");
    expect(inserted).toMatchObject({
      enabled: false,
      approvedBy: null,
      approvedAt: null,
      requiresHumanConfirm: true,
      action: "block_downstream",
    });
  });

  it("there is NO AI tool to enable / approve / trigger an interlock rule", () => {
    const names = listTools().map((t) => t.name);
    expect(names).not.toContain("enable_interlock_rule");
    expect(names).not.toContain("approve_interlock_rule");
    expect(names).not.toContain("trigger_interlock_rule");
  });

  it("the tool source never imports a dispatcher or writeTags", () => {
    const src = fs.readFileSync(path.join(__dirname, "interlock.ts"), "utf-8");
    expect(src).not.toMatch(/commandDispatcher/);
    expect(src).not.toMatch(/writeTags/);
  });
});
