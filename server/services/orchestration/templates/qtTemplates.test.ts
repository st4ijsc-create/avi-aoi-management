/**
 * Doc 44 W3-B3 (G3.8) — QT templates: shape hợp lệ theo workflowModel + compensation
 * khai đủ (§18.2) + loader gate (QT_TEMPLATES_ENABLED off → no-op, 0 DB).
 */
import { describe, it, expect, afterEach } from "vitest";

import { validateWorkflow, type WorkflowStep } from "../foe/workflowModel";
import { listQtTemplates, getQtTemplate, QT_TEMPLATE_REFS, QT1_REF } from "./qtTemplates";
import { getQtBusinessSteps, findQtBusinessStep } from "./qtStepHandlers";
import { registerQtTemplates, qtTemplatesEnabled } from "./registerQtTemplates";

const ENV_KEYS = ["QT_TEMPLATES_ENABLED", "FOE_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function flatten(steps: WorkflowStep[]): WorkflowStep[] {
  const out: WorkflowStep[] = [];
  for (const s of steps) {
    out.push(s);
    if (s.type === "sequence" || s.type === "parallel") out.push(...flatten(s.steps));
    if (s.type === "branch") {
      out.push(...flatten(s.then));
      if (s.else) out.push(...flatten(s.else));
    }
  }
  return out;
}

describe("QT templates — shape theo workflowModel", () => {
  it("có đúng 4 template với ref chuẩn, load được", () => {
    const defs = listQtTemplates();
    expect(defs).toHaveLength(4);
    expect(defs.map((d) => d.ref)).toEqual([...QT_TEMPLATE_REFS]);
    expect(getQtTemplate(QT1_REF)?.name).toContain("QT-1");
    expect(getQtTemplate("khong-ton-tai")).toBeNull();
  });

  it("mỗi definition PASS validateWorkflow (structural — không machine ref)", () => {
    for (const def of listQtTemplates()) {
      const res = validateWorkflow(def, []);
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
      // Template nghiệp vụ: KHÔNG command step → không mở control-path nào từ engine.
      expect(res.referencedMachineIds).toEqual([]);
    }
  });

  it("mọi step là hitl_gate (wait/gate sẵn có của FOE) với prompt phân loại [auto]/[external]", () => {
    for (const def of listQtTemplates()) {
      for (const step of flatten(def.steps)) {
        expect(step.type).toBe("hitl_gate");
        const prompt = (step as Extract<WorkflowStep, { type: "hitl_gate" }>).prompt;
        expect(prompt.startsWith("[auto]") || prompt.startsWith("[external]")).toBe(true);
      }
    }
  });

  it("params khai đủ trường bắt buộc theo spec §10 cho từng QT", () => {
    const required = (ref: string) =>
      (getQtTemplate(ref)?.params ?? []).filter((p) => p.required).map((p) => p.name);
    expect(required("qt-1-order-production")).toEqual(["orderId"]);
    expect(required("qt-2-quality-closed-loop")).toEqual(["lineId"]);
    expect(required("qt-3-material-replenishment")).toEqual(["machineId", "componentCode"]);
    expect(required("qt-4-changeover-npi")).toEqual(["lineId", "recipeSetRef"]);
  });
});

describe("QT step-handler registry — compensation khai đủ (§18.2)", () => {
  it("MỌI step của MỌI template có entry trong registry (đúng thứ tự, đúng mode với prompt)", () => {
    for (const def of listQtTemplates()) {
      const steps = flatten(def.steps);
      const registry = getQtBusinessSteps(def.ref);
      expect(registry.map((r) => r.stepId)).toEqual(steps.map((s) => s.id));
      for (const step of steps) {
        const entry = findQtBusinessStep(def.ref, step.id);
        expect(entry, `thiếu handler cho ${def.ref}/${step.id}`).not.toBeNull();
        const prompt = (step as Extract<WorkflowStep, { type: "hitl_gate" }>).prompt;
        // Prompt [auto] ⇔ registry mode auto; [external] ⇔ mode external (nhất quán).
        expect(entry!.mode).toBe(prompt.startsWith("[auto]") ? "auto" : "external");
      }
    }
  });

  it("mode 'auto' ⇒ có run(); mode 'external' ⇒ không run() (gate chờ ngoài)", () => {
    for (const ref of QT_TEMPLATE_REFS) {
      for (const entry of getQtBusinessSteps(ref)) {
        if (entry.mode === "auto") expect(typeof entry.run, `${ref}/${entry.stepId} thiếu run()`).toBe("function");
        else expect(entry.run).toBeUndefined();
      }
    }
  });

  it("compensation='handler' ⇒ compensate() thật; khai 'none-*' ⇒ có lý do hợp lệ, không compensate()", () => {
    const noneReasons = new Set(["none-readonly", "none-safe-state", "none-terminal", "none-external-wait"]);
    for (const ref of QT_TEMPLATE_REFS) {
      for (const entry of getQtBusinessSteps(ref)) {
        if (entry.compensation === "handler") {
          expect(typeof entry.compensate, `${ref}/${entry.stepId} khai 'handler' mà thiếu compensate()`).toBe(
            "function",
          );
        } else {
          expect(noneReasons.has(entry.compensation), `${ref}/${entry.stepId} khai compensation lạ`).toBe(true);
          expect(entry.compensate).toBeUndefined();
        }
      }
    }
  });

  it("các bước MUTATING chủ chốt §18.2 có bù trừ handler (nhả giữ chỗ / hủy AMR / gỡ khóa recipe / line held)", () => {
    const mustHaveHandler: Array<[string, string]> = [
      ["qt-1-order-production", "qt1-allocate"],
      ["qt-1-order-production", "qt1-distribute-recipe"],
      ["qt-1-order-production", "qt1-line-start"],
      ["qt-3-material-replenishment", "qt3-create-transport-task"],
      ["qt-4-changeover-npi", "qt4-changeover"],
      ["qt-4-changeover-npi", "qt4-distribute-recipe"],
    ];
    for (const [ref, stepId] of mustHaveHandler) {
      expect(findQtBusinessStep(ref, stepId)?.compensation, `${ref}/${stepId}`).toBe("handler");
    }
  });
});

describe("registerQtTemplates — flag gate", () => {
  it("QT_TEMPLATES_ENABLED off (default) → no-op honest, không đăng ký gì", async () => {
    delete process.env.QT_TEMPLATES_ENABLED;
    expect(qtTemplatesEnabled()).toBe(false);
    const res = await registerQtTemplates();
    expect(res.enabled).toBe(false);
    expect(res.registered).toEqual([]);
    expect(res.skipped).toEqual([]);
    expect(res.failed).toEqual([]);
  });

  it("flag on nhưng FOE_ENABLED off → honest message, không deploy", async () => {
    process.env.QT_TEMPLATES_ENABLED = "true";
    delete process.env.FOE_ENABLED;
    const res = await registerQtTemplates();
    expect(res.enabled).toBe(true);
    expect(res.foeEnabled).toBe(false);
    expect(res.registered).toEqual([]);
    expect(res.message).toMatch(/FOE_ENABLED/);
  });
});
