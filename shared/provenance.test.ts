/**
 * doc 80 Đợt 1 Task 4 (X-01, ORC-13) — bảng tín hiệu → nhãn nguồn dữ liệu.
 *
 * Mỗi hàng của bảng là MỘT tín hiệu có thật trong dữ liệu dev (đo 2026-09-27, phiên chỉ-đọc):
 *   orchestration_runs.contextJson.seed=true · operator_assignments.scope='demo' ·
 *   device_types.origin='seed' · tasks.taskKey 'DEMO-TASK-*' + payload.demo=true ·
 *   safety_plc_configs.code 'SIM-SAFETY-PLC-1' + scope='sim' · kết quả bước simulated=true.
 */
import { describe, expect, it } from "vitest";
import { deriveProvenance, classifyStepDispatch, summarizeRunDispatch } from "./provenance";

describe("deriveProvenance — bảng tín hiệu → nhãn", () => {
  const table: Array<[string, Record<string, unknown>, "SIM" | "DEMO" | "SEED" | null]> = [
    ["contextJson.seed=true (run orchestration)", { id: 7, contextJson: { gate: "passed", seed: true } }, "SEED"],
    ["contextJson.seed=false", { id: 1, contextJson: { seed: false } }, null],
    ["scope='demo' (assignment)", { id: 3, scope: "demo" }, "DEMO"],
    ["scope='sim' (safety PLC config)", { id: 1, scope: "sim" }, "SIM"],
    ["scope='seed'", { id: 1, scope: "seed" }, "SEED"],
    ["scope='F1:line' (scope thật)", { id: 1, scope: "corp:factory" }, null],
    ["origin='seed' (device type)", { typeKey: "AOI", origin: "seed" }, "SEED"],
    ["origin='manual'", { typeKey: "AOI", origin: "manual" }, null],
    ["taskKey tiền tố DEMO-", { taskKey: "DEMO-TASK-PICK-1" }, "DEMO"],
    ["code tiền tố SIM-", { code: "SIM-SAFETY-PLC-1" }, "SIM"],
    ["ref tiền tố SEED-", { ref: "SEED-LINE-A" }, "SEED"],
    ["workflowRef tiền tố DEMO- (chữ thường)", { workflowRef: "demo-startup" }, "DEMO"],
    ["simulated=true", { id: 1, simulated: true }, "SIM"],
    ["simulated=false", { id: 1, simulated: false }, null],
    ["payload.demo=true (task)", { taskKey: "T-1", payload: { demo: true } }, "DEMO"],
    ["tên chứa DEMO nhưng KHÔNG ở đầu", { taskKey: "LINE-DEMOLITION-1" }, null],
    ["hàng thật không tín hiệu", { id: 9, taskKey: "WO-123-A", scope: null, origin: null, contextJson: {} }, null],
    ["null / không phải object", null as unknown as Record<string, unknown>, null],
  ];
  for (const [name, row, want] of table) {
    it(`${name} ⇒ ${want ?? "không nhãn"}`, () => {
      expect(deriveProvenance(row)?.label ?? null).toBe(want);
    });
  }

  it("nhiều tín hiệu ⇒ SIM > DEMO > SEED, và liệt kê MỌI tín hiệu làm lý do", () => {
    const p = deriveProvenance({ taskKey: "DEMO-TASK-1", payload: { demo: true }, scope: "sim", origin: "seed" });
    expect(p?.label).toBe("SIM");
    expect(p?.reasons).toEqual(expect.arrayContaining(["scope=sim", "taskKey=DEMO-*", "payload.demo=true", "origin=seed"]));
    expect(deriveProvenance({ scope: "demo", origin: "seed" })?.label).toBe("DEMO");
  });
});

describe("classifyStepDispatch / summarizeRunDispatch — DRY-RUN hay thật (ORC-13)", () => {
  it("kết quả bước từ foeEngine: simulated=true ⇒ simulated", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "simulated", accepted: true, simulated: true })).toBe("simulated");
  });
  it("robot dispatcher status='simulated' (không có cờ simulated) ⇒ simulated", () => {
    expect(classifyStepDispatch({ routedTo: "robot-dispatcher", status: "simulated", accepted: true, detail: { jobId: 7 } })).toBe("simulated");
  });
  it("detail.simulated=true ⇒ simulated", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "x", detail: { simulated: true } })).toBe("simulated");
  });
  it("routedTo chỉ ra mô phỏng ⇒ simulated", () => {
    expect(classifyStepDispatch({ routedTo: "simulator", status: "done" })).toBe("simulated");
  });
  it("gửi thật (acked/sent/done) ⇒ live", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "acked", simulated: false })).toBe("live");
    expect(classifyStepDispatch({ routedTo: "robot-dispatcher", status: "done" })).toBe("live");
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "sent", simulated: false })).toBe("live");
  });
  it("bị từ chối ⇒ rejected (không thật, không mô phỏng)", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "rejected", simulated: false })).toBe("rejected");
  });
  it("bước không phải lệnh (hitl_gate {ok:true}, seed) ⇒ null", () => {
    expect(classifyStepDispatch({ ok: true })).toBeNull();
    expect(classifyStepDispatch(null)).toBeNull();
  });

  it("gộp run", () => {
    const sim = { routedTo: "ot-dispatcher", status: "simulated", simulated: true };
    const live = { routedTo: "ot-dispatcher", status: "acked", simulated: false };
    expect(summarizeRunDispatch([sim, { ok: true }, sim])).toEqual({ mode: "simulated", simulated: 2, live: 0, unconfirmed: 0 });
    expect(summarizeRunDispatch([live])).toEqual({ mode: "live", simulated: 0, live: 1, unconfirmed: 0 });
    expect(summarizeRunDispatch([live, sim])).toEqual({ mode: "mixed", simulated: 1, live: 1, unconfirmed: 0 });
    expect(summarizeRunDispatch([{ ok: true }, { ok: true }])).toEqual({ mode: "none", simulated: 0, live: 0, unconfirmed: 0 });
    expect(summarizeRunDispatch([])).toEqual({ mode: "none", simulated: 0, live: 0, unconfirmed: 0 });
  });
});

// ── Fix round 1 (review Important #2 · Minor #6) ─────────────────────────────────────────
describe("Fix round 1 — failed/timeout là CHƯA XÁC NHẬN (có thể đã tới thiết bị), chỉ rejected là 'không gửi'", () => {
  it("rejected ⇒ rejected (không gửi)", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "rejected", simulated: false })).toBe("rejected");
    expect(classifyStepDispatch({ routedTo: "robot-dispatcher", status: "rejected" })).toBe("rejected");
  });
  it("failed / timeout (OT sau writeTags, robot sau driver) ⇒ unconfirmed", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "failed", simulated: false })).toBe("unconfirmed");
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "timeout", simulated: false })).toBe("unconfirmed");
    expect(classifyStepDispatch({ routedTo: "robot-dispatcher", status: "failed" })).toBe("unconfirmed");
  });
  it("trạng thái lạ ⇒ unconfirmed (an toàn: không bao giờ tự nhận là không gửi)", () => {
    expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: "weird" })).toBe("unconfirmed");
  });
  it("mọi trạng thái ack của enum commandstatusenum ⇒ live", () => {
    for (const s of ["sent", "acked", "acked_verified", "acked_unverified", "done"]) {
      expect(classifyStepDispatch({ routedTo: "ot-dispatcher", status: s, simulated: false }), s).toBe("live");
    }
  });
  it("gộp: unconfirmed tính là CÓ THỂ thật, không bao giờ là dry-run", () => {
    const sim = { routedTo: "ot-dispatcher", status: "simulated", simulated: true };
    const unc = { routedTo: "ot-dispatcher", status: "timeout", simulated: false };
    const rej = { routedTo: "ot-dispatcher", status: "rejected", simulated: false };
    expect(summarizeRunDispatch([unc])).toEqual({ mode: "unconfirmed", simulated: 0, live: 0, unconfirmed: 1 });
    expect(summarizeRunDispatch([sim, unc])).toEqual({ mode: "mixed", simulated: 1, live: 0, unconfirmed: 1 });
    expect(summarizeRunDispatch([sim, rej])).toEqual({ mode: "simulated", simulated: 1, live: 0, unconfirmed: 0 });
    expect(summarizeRunDispatch([{ routedTo: "ot-dispatcher", status: "acked" }, unc])).toEqual({ mode: "live", simulated: 0, live: 1, unconfirmed: 1 });
  });
});

describe("Fix round 1 — routedTo chỉ khớp mô phỏng khi NEO đầu chuỗi (Minor #6)", () => {
  it("'simatic-s7' KHÔNG phải mô phỏng; 'simulator' / 'sim-gate' / 'sim' là", () => {
    expect(classifyStepDispatch({ routedTo: "simatic-s7", status: "acked" })).toBe("live");
    expect(classifyStepDispatch({ routedTo: "simulator", status: "done" })).toBe("simulated");
    expect(classifyStepDispatch({ routedTo: "sim-gate", status: "done" })).toBe("simulated");
    expect(classifyStepDispatch({ routedTo: "sim", status: "done" })).toBe("simulated");
  });
});
