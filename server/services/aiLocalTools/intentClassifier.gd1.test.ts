/**
 * GĐ1 — C3a context pre-fill for read-tool args.
 */
import { describe, it, expect } from "vitest";
import "./handlers"; // side-effect: register built-in tools
import { classifyToolIntent } from "./intentClassifier";

describe("C3a — classifyToolIntent context pre-fill", () => {
  it("uses context.selectedMachineCode for OEE when the question omits a code", () => {
    const d = classifyToolIntent("OEE máy này thế nào?", { selectedMachineCode: "AOI-01" });
    expect(d.tool).toBe("get_oee");
    expect((d.args as Record<string, unknown>).machineCode).toBe("AOI-01");
  });

  it("prefers a machine code from the question over the context default", () => {
    const d = classifyToolIntent("OEE của máy AOI-09", { selectedMachineCode: "AOI-01" });
    expect(d.tool).toBe("get_oee");
    expect((d.args as Record<string, unknown>).machineCode).toBe("AOI-09");
  });

  it("works without context (backward-compatible — no machineCode)", () => {
    const d = classifyToolIntent("OEE 7 ngày qua");
    expect(d.tool).toBe("get_oee");
    expect((d.args as Record<string, unknown>).machineCode).toBeUndefined();
  });

  it("uses context.selectedLot for lot status when no order code is given", () => {
    const d = classifyToolIntent("lô này tiến độ ra sao?", { selectedLot: "L20260505-001" });
    // get_lot_status requires an orderCode; context supplies it so the tool fires.
    expect(d.tool).toBe("get_lot_status");
    expect((d.args as Record<string, unknown>).orderCode).toBe("L20260505-001");
  });
});
