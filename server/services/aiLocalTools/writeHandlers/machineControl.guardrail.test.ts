/**
 * doc 44 W5-A2 (G4.18) — set_machine_param guardrail ENFORCEMENT at the tool.
 *
 * Asserts:
 *   - PARAM_GUARDRAIL_ENABLED OFF → bit-compat: dispatch as before, NO guardrail
 *     check, NO change-log write.
 *   - ON + violation → REJECTED result (code + range), dispatch NEVER called.
 *   - ON + pass → dispatch called + recordChange written (append-only log).
 *
 * The guardrail SERVICE is mocked (its pure decision is unit-tested separately);
 * here we verify the WIRING in machineControl.execute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boDemChungChoTest } from "../../ot/aiControlGate";

type Row = Record<string, any>;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
}));

const adapters: Row[] = [{ id: 10, machineId: 5, code: "A10", isEnabled: true }];
const fakeDb = {
  select: () => ({
    from: (_t: any) => ({
      where: (pred: (r: Row) => boolean) => ({
        limit: async () => {
          for (const r of adapters) if (pred(r)) return [r];
          return [];
        },
      }),
    }),
  }),
};
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("../../../../drizzle/schema", () => ({
  deviceAdapters: { __table: "device_adapters", machineId: { __name: "machineId" }, id: { __name: "id" }, isEnabled: { __name: "isEnabled" } },
  deviceTags: { __table: "device_tags", adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, writable: { __name: "writable" } },
}));
vi.mock("../../../db/machineRecipe", () => ({ getActiveRecipe: vi.fn(async () => null) }));
// doc 81 Đợt 1D Task 2 — machineControl now imports ot/stopPin (machine_stop pinned writes); its real module pulls
// db/index, which this suite's partial schema mock cannot satisfy. This suite never dispatches a stop.
vi.mock("../../ot/stopPin", () => ({ loadStopPins: vi.fn(async () => []) }));

const dispatchSpy = vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] }));
vi.mock("../../ot/commandDispatcher", () => ({
  dispatch: (...a: unknown[]) => dispatchSpy(...a),
  isOtControlEnabled: () => false,
}));

// L-7 — cầu nối safety của cổng AI (cổng chính chạy THẬT, không mock).
const safetyChoAi = vi.fn(async () => "OK" as const);
vi.mock("../../ot/aiControlGate.safety", () => ({
  preflightSafetyChoAi: (...a: unknown[]) => safetyChoAi(...a),
  // SCADA R1a T10 — mức KÊNH đích (actuation_level). 1 = kênh không nâng mức: các ca dưới đo mức của TOOL như trước.
  mucKenhChoAi: async () => ({ dungGhim: false, muc: 1 }),
}));

// The guardrail service — fully controllable.
const paramGuardrailEnabled = vi.fn(() => false);
const paramGuardrailStrict = vi.fn(() => false);
const resolveGuardrail = vi.fn(async () => ({ id: 7, minValue: 1.6, maxValue: 1.9, maxStep: 0.1, unit: "Nm" }));
const checkAgainstGuardrail = vi.fn(() => ({ ok: true }) as any);
const lastKnownValue = vi.fn(async () => null);
const recordChange = vi.fn(async () => 1);
vi.mock("../../ai/parameterGuardrailService", () => ({
  paramGuardrailEnabled: () => paramGuardrailEnabled(),
  paramGuardrailStrict: () => paramGuardrailStrict(),
  resolveGuardrail: (...a: unknown[]) => resolveGuardrail(...(a as [])),
  checkAgainstGuardrail: (...a: unknown[]) => checkAgainstGuardrail(...(a as [])),
  lastKnownValue: (...a: unknown[]) => lastKnownValue(...(a as [])),
  recordChange: (...a: unknown[]) => recordChange(...(a as [])),
}));

import "./machineControl";
import { getTool } from "../toolRegistry";

const ctx = { user: { id: 1, role: "admin", name: "A" }, lang: "vi" as const, actionId: "act-1" };
function execTool(params: Record<string, unknown>) {
  const t = getTool("set_machine_param") as any;
  return t.execute(params, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  // ── L-7 (2026-09-06) — `set_machine_param` nay đi qua cổng AI trước dispatcher.
  //   `speed` là tag KHÔNG-an-toàn ⇒ Mức 3 ⇒ được phép, NHƯNG chỉ khi cờ riêng
  //   bật + safety-PLC = "OK". Suite này đo GUARDRAIL, không đo cổng L-7, nên nó
  //   đặt cả hai để cô lập đúng thứ nó muốn đo. (Cổng L-7 có suite riêng:
  //   server/services/ot/aiControlGate.test.ts)
  process.env.AI_OT_CONTROL_ENABLED = "true";
  safetyChoAi.mockResolvedValue("OK");
  boDemChungChoTest().xoaHet(); // trần tần suất dùng chung — dọn giữa các ca
  paramGuardrailEnabled.mockReturnValue(false);
  paramGuardrailStrict.mockReturnValue(false);
  checkAgainstGuardrail.mockReturnValue({ ok: true });
  lastKnownValue.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.AI_OT_CONTROL_ENABLED;
});

describe("set_machine_param — guardrail enforcement (G4.18)", () => {
  it("PARAM_GUARDRAIL_ENABLED OFF → bit-compat: dispatch, no check, no change-log", async () => {
    const res = await execTool({ machineId: 5, tagKey: "speed", value: 42 });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("set_param");
    expect(arg.writes).toEqual([{ tagKey: "speed", value: 42 }]);
    expect(checkAgainstGuardrail).not.toHaveBeenCalled();
    expect(recordChange).not.toHaveBeenCalled();
    expect((res as any).data.ok).toBe(true);
  });

  it("ON + violation → REJECTED (code + range), dispatch NEVER called", async () => {
    paramGuardrailEnabled.mockReturnValue(true);
    checkAgainstGuardrail.mockReturnValue({
      ok: false,
      code: "OUT_OF_RANGE",
      detail: "Giá trị 42 Nm nằm ngoài dải cho phép [1.6, 1.9] Nm.",
      guardrail: { min: 1.6, max: 1.9, maxStep: 0.1, unit: "Nm" },
    });
    const res = (await execTool({ machineId: 5, tagKey: "torque_nm", value: 42 })) as any;
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(recordChange).not.toHaveBeenCalled();
    expect(res.data.rejected).toBe(true);
    expect(res.data.code).toBe("OUT_OF_RANGE");
    expect(res.textSummary).toContain("REJECTED");
    expect(res.textSummary).toContain("[1.6, 1.9]");
  });

  it("ON + STEP_TOO_LARGE → REJECTED, dispatch NEVER called", async () => {
    paramGuardrailEnabled.mockReturnValue(true);
    checkAgainstGuardrail.mockReturnValue({ ok: false, code: "STEP_TOO_LARGE", detail: "bước quá lớn", guardrail: { min: 1.6, max: 1.9, maxStep: 0.1, unit: "Nm" } });
    const res = (await execTool({ machineId: 5, tagKey: "torque_nm", value: 1.9 })) as any;
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(res.data.code).toBe("STEP_TOO_LARGE");
  });

  it("ON + pass → dispatch + recordChange(append-only) written", async () => {
    paramGuardrailEnabled.mockReturnValue(true);
    checkAgainstGuardrail.mockReturnValue({ ok: true });
    lastKnownValue.mockResolvedValue(1.7);
    const res = (await execTool({ machineId: 5, tagKey: "torque_nm", value: 1.75 })) as any;
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(recordChange).toHaveBeenCalledTimes(1);
    const rc = recordChange.mock.calls[0][0] as any;
    expect(rc).toMatchObject({ machineId: 5, paramKey: "torque_nm", newValue: 1.75, oldValue: 1.7, source: "ai_proposal", guardrailId: 7, correlationId: "act-1" });
    expect(res.data.ok).toBe(true);
  });
});

// SCADA R1b-1 T13 — dispatcher từ chối OFF_STEP (lưới thô / bước) ⇒ đường AI nói câu ĐÃ DỊCH của mã SCADA_VALUE_OFF_STEP (cùng câu HMI),
// không chỉ mã trần; `note` giữ mã máy-đọc-được (bi_tu_choi_ghi).
describe("set_machine_param — từ chối OFF_STEP của dispatcher hiện câu đã dịch (R1b-1 T13)", () => {
  const tuChoi = {
    ok: false,
    simulated: false,
    status: "rejected",
    reason: "OFF_STEP",
    results: [],
    commandLogIds: [9],
    appError: { appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "speed", step: 10, goiY: 30 } },
  };
  for (const [lang, cau] of [
    ["vi", "Giá trị không nằm trên bước 10 của kênh speed. Giá trị hợp lệ gần nhất: 30 — hãy chọn lại."],
    ["en", "The value is not on step 10 of channel speed. Nearest valid value: 30 — please choose again."],
    ["zh", "该值不在通道 speed 的步长 10 上。最接近的有效值：30——请重新选择。"],
  ] as const) {
    it(`${lang}: title + textSummary mang câu của locale; note = OFF_STEP`, async () => {
      dispatchSpy.mockResolvedValueOnce(tuChoi as never);
      const t = getTool("set_machine_param") as any;
      const res = (await t.execute({ machineId: 5, tagKey: "speed", value: 25 }, { ...ctx, lang })) as any;
      expect(res.title).toContain(cau);
      expect(res.textSummary).toContain("(OFF_STEP)");
      expect(res.textSummary).toContain(cau);
      expect(res.note).toBe("OFF_STEP");
    });
  }

  it("lệnh thành công / từ chối khác ⇒ title như cũ (không thêm câu)", async () => {
    const ok = (await execTool({ machineId: 5, tagKey: "speed", value: 30 })) as any;
    expect(ok.title).not.toContain("—");
    dispatchSpy.mockResolvedValueOnce({ ok: false, simulated: false, status: "rejected", reason: "OUT_OF_RANGE", results: [], commandLogIds: [] } as never);
    const khac = (await execTool({ machineId: 5, tagKey: "speed", value: 999 })) as any;
    expect(khac.textSummary).toBe("set_param → rejected (OUT_OF_RANGE)");
  });
});
