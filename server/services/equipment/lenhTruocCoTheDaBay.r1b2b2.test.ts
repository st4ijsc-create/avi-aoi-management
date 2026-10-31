/**
 * SCADA R1b-2b-2a T3F (backlog 91, AN TOÀN) — lớp "lệnh trước có thể đang bay / đã bay": bộ phân loại (`coTheDaBayCua`), quyết định của engine trên kết
 * quả (`ketCucLenhFoe` → `khongGuiLaiKhongRo`, đúng hai hàm execCommand / execStep dùng), và đường mặt tiền THẬT (equipmentRegistry) đưa mã tới engine
 * cho từng bên gửi: OT trung tâm (detail.reason), robot trung tâm (error), edge OT / robot (detail.reason + detail.refusal = jti_consumed).
 * Bên gửi được thay bằng mock trả ĐÚNG hình dạng của nó (bằng chứng file:dòng trong báo cáo T3F); đường DB thật + engine thật của DUPLICATE_IN_FLIGHT:
 * foeDuplicateInFlight.r1b2b2.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const M = vi.hoisted(() => ({
  ot: vi.fn(),
  otEdge: vi.fn(),
  robot: vi.fn(),
  robotEdge: vi.fn(),
}));
vi.mock("../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ot/commandDispatcher")>();
  return { ...orig, dispatch: M.ot };
});
vi.mock("../ot/otEdgeDispatch", () => ({ dispatchOtOnEdge: M.otEdge }));
vi.mock("../robot/robotCommandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/robotCommandDispatcher")>();
  return { ...orig, dispatchRobotJob: M.robot };
});
vi.mock("../robot/robotEdgeDispatch", () => ({ dispatchRobotOnEdge: M.robotEdge }));

import { CAC_MA_CO_THE_DA_BAY, coTheDaBayCua } from "./lenhTruocCoTheDaBay";
import { equipmentRegistry } from "./equipmentAdapter";
import { FOE_OUTCOME_UNKNOWN, ketCucLenhFoe, khongGuiLaiKhongRo } from "../orchestration/foe/foeEngine";
import { idempotentReplay, PROCESS_RESTART_OUTCOME_UNKNOWN } from "../robot/robotCommandDispatcher";

const otCmd = { name: "start", adapterId: 7, machineId: 1, writes: [{ tagKey: "a", value: 5 }], idempotencyKey: "run1-main-a1", hitl: { actionId: "foe-run1-main-a1", requestedBy: 1, confirmedBy: 2 } };
const robotCmd = { name: "run_job", robotId: 9, machineId: 1, job: { jobType: "pick", params: {} }, idempotencyKey: "run1-main-a1", hitl: { actionId: "foe-run1-main-a1", requestedBy: 1, confirmedBy: 2 } };

/** Quyết định của engine sau MỘT lần thử (non-STOP / STOP): chốt (không thử nữa) hay null (vòng thử lại quyết định như cũ). */
const chot = (r: Parameters<typeof ketCucLenhFoe>[0], stop: boolean) => khongGuiLaiKhongRo(ketCucLenhFoe(r, "start"), stop);

let roleCu: string | undefined;
beforeEach(() => {
  roleCu = process.env.AVI_PROCESS_ROLE;
  delete process.env.AVI_PROCESS_ROLE;
  for (const f of Object.values(M)) f.mockReset();
});
afterEach(() => {
  if (roleCu === undefined) delete process.env.AVI_PROCESS_ROLE;
  else process.env.AVI_PROCESS_ROLE = roleCu;
});

describe("T3F — lớp 'lệnh trước có thể đã bay' ⇒ không rõ kết cục, không attempt key mới (non-STOP); STOP thử lại", () => {
  it("bảng mã đúng ba mã nguồn; chuỗi robot = hằng PROCESS_RESTART_OUTCOME_UNKNOWN của dispatcher robot (ghim)", () => {
    expect([...CAC_MA_CO_THE_DA_BAY].sort()).toEqual(["DUPLICATE_IN_FLIGHT", "IDEMPOTENT_JOB_IN_PROGRESS", "process_restart_outcome_unknown"].sort());
    expect(CAC_MA_CO_THE_DA_BAY).toContain(PROCESS_RESTART_OUTCOME_UNKNOWN);
  });

  it("★ OT trung tâm: dispatcher `rejected` + DUPLICATE_IN_FLIGHT qua mặt tiền THẬT ⇒ FOE_OUTCOME_UNKNOWN cho non-STOP; STOP ⇒ null (thử lại)", async () => {
    M.ot.mockResolvedValue({ ok: false, simulated: false, status: "rejected", reason: "DUPLICATE_IN_FLIGHT", results: [], commandLogIds: [11] });
    const r = await equipmentRegistry.getAdapter("ot-s7").sendCommand(otCmd as never);
    expect(coTheDaBayCua(r)).toBe("DUPLICATE_IN_FLIGHT");
    const c = chot(r, false);
    expect(c).toMatchObject({ kind: "failed" });
    expect(String((c as { error: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: DUPLICATE_IN_FLIGHT: command "start" — .*outcome unknown — not sent again; check the device\\.$`));
    expect(chot(r, true)).toBeNull();
  });

  it("★ robot trung tâm: IDEMPOTENT_JOB_IN_PROGRESS (job cùng khoá chưa kết thúc) ⇒ không rõ; STOP ⇒ null", async () => {
    M.robot.mockResolvedValue({ ok: false, status: "rejected", jobId: 4, error: "IDEMPOTENT_JOB_IN_PROGRESS" });
    const r = await equipmentRegistry.getAdapter("robot").sendCommand(robotCmd as never);
    expect(coTheDaBayCua(r)).toBe("IDEMPOTENT_JOB_IN_PROGRESS");
    expect(String((chot(r, false) as { error: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: IDEMPOTENT_JOB_IN_PROGRESS: `));
    expect(chot(r, true)).toBeNull();
  });

  it("★ robot trung tâm sau khởi động lại: idempotentReplay của job bị quét PROCESS_RESTART_OUTCOME_UNKNOWN MANG mã ⇒ qua mặt tiền ⇒ không rõ; job failed thường ⇒ không mã (thử lại như cũ)", async () => {
    const sauQuet = idempotentReplay({ id: 4, status: "failed", result: { reasonCode: PROCESS_RESTART_OUTCOME_UNKNOWN } });
    expect(sauQuet).toEqual({ ok: false, status: "failed", jobId: 4, error: PROCESS_RESTART_OUTCOME_UNKNOWN });
    M.robot.mockResolvedValue(sauQuet);
    const r = await equipmentRegistry.getAdapter("robot").sendCommand(robotCmd as never);
    expect(coTheDaBayCua(r)).toBe(PROCESS_RESTART_OUTCOME_UNKNOWN);
    expect(String((chot(r, false) as { error: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: ${PROCESS_RESTART_OUTCOME_UNKNOWN}: `));
    expect(chot(r, true)).toBeNull();
    // đối chứng: job failed thật (driver trả lỗi) — kết cục BIẾT ⇒ hành vi cũ
    const thuong = idempotentReplay({ id: 5, status: "failed", result: { reasonCode: "DRIVER_ERROR" } });
    expect(thuong).toEqual({ ok: false, status: "failed", jobId: 5 });
    expect(chot({ ok: false, status: "failed", routedTo: "robot-dispatcher", detail: { jobId: 5 } }, false)).toBeNull();
  });

  it("★ edge OT + edge robot: AUTHORIZATION_INVALID / JOURNAL_CONSUME_FAILED với chi tiết jti_consumed (uỷ quyền đã dùng) ⇒ không rõ; chi tiết khác ⇒ hành vi cũ", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    for (const reason of ["AUTHORIZATION_INVALID", "JOURNAL_CONSUME_FAILED"]) {
      M.otEdge.mockResolvedValueOnce({ ok: false, status: "rejected", reason, stop: false, results: [], detail: "jti_consumed" });
      const r = await equipmentRegistry.getAdapter("ot-s7").sendCommand(otCmd as never);
      expect(coTheDaBayCua(r)).toBe(`${reason}(jti_consumed)`);
      expect(String((chot(r, false) as { error: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: ${reason}\\(jti_consumed\\): `));
      expect(chot(r, true)).toBeNull();
      M.robotEdge.mockResolvedValueOnce({ ok: false, status: "rejected", reason, stop: false, detail: "jti_consumed" });
      const rr = await equipmentRegistry.getAdapter("robot").sendCommand(robotCmd as never);
      expect(coTheDaBayCua(rr)).toBe(`${reason}(jti_consumed)`);
    }
    for (const detail of ["expired", "context_mismatch", "io_error", "journal_full", "bad_signature"]) {
      M.otEdge.mockResolvedValueOnce({ ok: false, status: "rejected", reason: "AUTHORIZATION_INVALID", stop: false, results: [], detail });
      const r = await equipmentRegistry.getAdapter("ot-s7").sendCommand(otCmd as never);
      expect(coTheDaBayCua(r), detail).toBeNull();
      expect(chot(r, false), detail).toBeNull();
    }
  });

  it("đối chứng: từ chối CHẮC CHƯA GỬI (OT trung tâm / edge / robot) ⇒ không thuộc lớp ⇒ vòng thử lại quyết định như cũ", async () => {
    const otChuaGui = ["PRECONDITION_FAILED", "TAG_NOT_WRITABLE", "TAG_NOT_FOUND", "NOT_CONFIRMED", "ACTION_BINDING_MISMATCH", "BUSY", "SUPERSEDED_BY_STOP", "QUEUE_EXPIRED", "STOPPED_BEFORE_WRITE", "STOP_UNVERIFIED_QUEUE_FULL", "SAFETY_BLOCKED", "SAFETY_UNKNOWN", "SAFETY_SIM_ONLY", "INTERLOCK_BLOCKED", "ADAPTER_DISABLED", "ADAPTER_OFFLINE", "ADAPTER_OWNED_BY_EDGE", "LEDGER_INTENT_FAILED", "DB_UNAVAILABLE"];
    for (const reason of otChuaGui) {
      M.ot.mockResolvedValueOnce({ ok: false, simulated: false, status: reason === "ADAPTER_OFFLINE" || reason === "LEDGER_INTENT_FAILED" || reason === "DB_UNAVAILABLE" ? "failed" : "rejected", reason, results: [], commandLogIds: [] });
      const r = await equipmentRegistry.getAdapter("ot-s7").sendCommand(otCmd as never);
      expect(coTheDaBayCua(r), reason).toBeNull();
      expect(chot(r, false), reason).toBeNull();
    }
    for (const error of ["LEDGER_WRITE_FAILED", "HITL_ACTION_REQUIRED", "NOT_CONFIRMED", "MOTION_LOCKED", "robot_motion_in_progress", "IDEMPOTENCY_KEY_REUSED", "INTERLOCK_BLOCKED"]) {
      M.robot.mockResolvedValueOnce({ ok: false, status: "rejected", jobId: 4, error });
      const r = await equipmentRegistry.getAdapter("robot").sendCommand(robotCmd as never);
      expect(coTheDaBayCua(r), error).toBeNull();
      expect(chot(r, false), error).toBeNull();
    }
    // tiền lệ T2B giữ nguyên: timeout ⇒ không rõ (non-STOP), STOP thử lại
    const to = { ok: false, status: "timeout", routedTo: "ot-dispatcher" as const, detail: { reason: undefined } };
    expect(String((chot(to, false) as { error: string }).error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: `));
    expect(chot(to, true)).toBeNull();
    // kết quả ok không bao giờ thuộc lớp
    expect(coTheDaBayCua({ ok: true, detail: { reason: "DUPLICATE_IN_FLIGHT" } })).toBeNull();
  });
});
