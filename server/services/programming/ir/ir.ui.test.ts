/**
 * W4-19 — field UI phụ (block.ui = {x,y}) là OPTIONAL + additive: KHÔNG phá irModel,
 * round-trip giữ nguyên, và transpile/lint bỏ qua nó (byte-identical với/không ui).
 */
import { describe, it, expect } from "vitest";
import { parseFlow, assignIds, type Flow } from "./irModel";
import { lintFlow } from "./irSafetyLinter";
import { transpileFlow } from "./transpilers/registry";

/** Một flow an toàn tối thiểu (nằm trong giới hạn mặc định). */
function baseFlow(withUi: boolean): Flow {
  return {
    flow_id: "ui_roundtrip",
    target_device_type: "universal-robots",
    version: 1,
    blocks: [
      {
        id: "b1",
        type: "move_linear",
        target_pose: { x: 100, y: 100, z: 300, rx: 0, ry: 0, rz: 0 },
        speed_mms: 100,
        acceleration: 1,
        blend_radius: 0,
        ...(withUi ? { ui: { x: 42, y: 84 } } : {}),
      },
    ],
  };
}

describe("IR block.ui (optional UI position)", () => {
  it("parse GIỮ NGUYÊN ui khi có", () => {
    const res = parseFlow(baseFlow(true));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.flow.blocks[0].ui).toEqual({ x: 42, y: 84 });
    }
  });

  it("parse KHÔNG chèn ui khi vắng (backward-compatible)", () => {
    const res = parseFlow(baseFlow(false));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.flow.blocks[0].ui).toBeUndefined();
    }
  });

  it("round-trip JSON giữ nguyên ui", () => {
    const flow = baseFlow(true);
    const parsed = parseFlow(JSON.parse(JSON.stringify(flow)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.flow).toEqual(flow);
  });

  it("assignIds giữ ui nguyên vẹn", () => {
    const withIds = assignIds(baseFlow(true));
    expect(withIds.blocks[0].ui).toEqual({ x: 42, y: 84 });
  });

  it("ui SAI kiểu bị từ chối (x/y phải là số)", () => {
    const bad = baseFlow(false);
    (bad.blocks[0] as unknown as Record<string, unknown>).ui = { x: "nope", y: 1 };
    const res = parseFlow(bad);
    expect(res.ok).toBe(false);
  });

  it("lint bỏ qua ui: cùng kết quả có/không ui", () => {
    const a = lintFlow(assignIds(baseFlow(true)));
    const b = lintFlow(assignIds(baseFlow(false)));
    expect(a.ok).toBe(b.ok);
    expect(a.diagnostics.length).toBe(b.diagnostics.length);
  });

  it("transpile BYTE-IDENTICAL có/không ui", () => {
    const withUi = transpileFlow(assignIds(baseFlow(true)), "urscript");
    const noUi = transpileFlow(assignIds(baseFlow(false)), "urscript");
    expect(withUi.ok).toBe(true);
    expect(noUi.ok).toBe(true);
    if (withUi.ok && noUi.ok) expect(withUi.code).toBe(noUi.code);
  });
});
