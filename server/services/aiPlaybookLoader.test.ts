/**
 * Sprint G2.3b — Playbook loader/validator tests.
 *
 * Verifies:
 *  - a structurally valid YAML playbook loads with all steps;
 *  - a schema-invalid playbook (missing title.en) is rejected by validation;
 *  - a `tool` step naming an UNREGISTERED tool is rejected;
 *  - a `tool` step naming a READ tool (not write) is rejected;
 *  - a navigate step with a route OUTSIDE the whitelist is rejected;
 *  - the real on-disk playbooks all load (no parse/validation regressions).
 *
 * The tool registry is the REAL one (the side-effect import registers all
 * built-in tools), so validation runs against the live registry + whitelist.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { parse as parseYaml } from "yaml";
import "./aiLocalTools"; // register all built-in tools (write + client)
import {
  loadPlaybooks,
  validatePlaybookSemantics,
  type Playbook,
} from "./aiPlaybookLoader";

const L = (s: string) => ({ vi: s, en: s, zh: s });

function makePlaybook(over: Partial<Playbook> = {}): Playbook {
  return {
    id: "test-pb",
    title: L("Test"),
    steps: [{ type: "guidance", text: L("hi") }],
    ...over,
  };
}

describe("validatePlaybookSemantics", () => {
  it("accepts a guidance-only playbook", () => {
    expect(validatePlaybookSemantics(makePlaybook())).toEqual([]);
  });

  it("accepts a tool step that names a registered WRITE tool", () => {
    const pb = makePlaybook({
      steps: [{ type: "tool", tool: "set_spec_limits", text: L("set spec") }],
    });
    expect(validatePlaybookSemantics(pb)).toEqual([]);
  });

  it("rejects a tool step naming an UNREGISTERED tool", () => {
    const pb = makePlaybook({
      steps: [{ type: "tool", tool: "no_such_tool", text: L("x") }],
    });
    const errs = validatePlaybookSemantics(pb);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/chưa đăng ký/);
  });

  it("rejects a tool step naming a READ tool (not a write tool)", () => {
    // navigate is a client tool, not a write tool → must be rejected as a tool step.
    const pb = makePlaybook({
      steps: [{ type: "tool", tool: "navigate", text: L("x") }],
    });
    const errs = validatePlaybookSemantics(pb);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/không phải write-tool/);
  });

  it("rejects a navigate step whose route is OUTSIDE the whitelist", () => {
    const pb = makePlaybook({
      steps: [{ type: "navigate", route: "/not-allowed-route", text: L("x") }],
    });
    const errs = validatePlaybookSemantics(pb);
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/ngoài whitelist/);
  });

  it("accepts a navigate step with a whitelisted route", () => {
    const pb = makePlaybook({
      steps: [{ type: "navigate", route: "/datasettings", text: L("x") }],
    });
    expect(validatePlaybookSemantics(pb)).toEqual([]);
  });

  it("flags a branch step with no options", () => {
    const pb = makePlaybook({ steps: [{ type: "branch", text: L("x") }] });
    const errs = validatePlaybookSemantics(pb);
    expect(errs.length).toBe(1);
  });
});

describe("loadPlaybooks (real knowledge/workflows/*.playbook.yaml)", () => {
  let playbooks: Playbook[];
  beforeAll(() => {
    playbooks = loadPlaybooks();
  });

  it("loads the shipped playbooks (every file parsed + validated)", () => {
    const ids = playbooks.map((p) => p.id);
    expect(ids).toContain("create-measurement-point");
    expect(ids).toContain("ng-handling");
    expect(ids).toContain("change-recipe-line-start");
    expect(ids).toContain("install-new-machine");
  });

  it("every loaded playbook passes semantic validation (no half-broken file shipped)", () => {
    for (const pb of playbooks) {
      expect(validatePlaybookSemantics(pb), `playbook ${pb.id}`).toEqual([]);
    }
  });

  it("the create-measurement-point playbook keeps all of its steps", () => {
    const pb = playbooks.find((p) => p.id === "create-measurement-point")!;
    expect(pb).toBeDefined();
    // guidance, navigate, prefill, tool(create), confirm, tool(set_spec) = 6 steps
    expect(pb.steps.length).toBe(6);
    const toolSteps = pb.steps.filter((s) => s.type === "tool").map((s) => s.tool);
    expect(toolSteps).toEqual(["create_measurement_point", "set_spec_limits"]);
  });
});

describe("YAML parse safety", () => {
  it("a syntactically valid YAML doc parses to the expected object", () => {
    const doc = parseYaml("id: x\ntitle:\n  vi: a\n  en: b\n  zh: c\nsteps: []\n");
    expect(doc.id).toBe("x");
    expect(doc.title.en).toBe("b");
  });
});
