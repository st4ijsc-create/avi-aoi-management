/**
 * SCADA R1b-2b-2b A — C2 polish (điều phối 2026-11-01, review fix 4 m1 / m4) — MÃ cho người KHÔNG được xem chi tiết kỹ thuật:
 *   • m1: mã ĐÃ BIẾT ĐẦU TIÊN ở bất kỳ đâu trong lỗi run / bước (biên từ chặt — chuỗi giống mã trong tên máy / đường dẫn không khớp), giữ dạng
 *     `FOE_GATE_REQUIRED(<lý do>)`;
 *   • m4: mã DỰ PHÒNG theo LOẠI bước, chỉ dùng mã đã có;
 *   • REST lệnh thiết bị: `cheKetQuaLenh` (cùng danh sách trắng `detail` với bước orchestration).
 */
import { describe, expect, it } from "vitest";
import { MA_LOI_DA_BIET, cheBuocRun, cheHangRun, cheKetQuaLenh, maDaBietDauTien, maLoiBuocFoe } from "./_chiTietKyThuat";

describe("C2 polish m1 — mã đã biết ĐẦU TIÊN ở bất kỳ đâu (không chỉ tiền tố)", () => {
  it("mỗi hình lỗi mức run của review ⇒ đúng mã outcome (không còn TECHNICAL_ERROR / DRIVER_WRITE_FAILED chung)", () => {
    expect(maLoiBuocFoe("Edge node E1 held run 7 (journalFull): EDGE_OUTCOME_UNKNOWN(a,b): command step a was sent — check the equipment.", "held")).toBe(
      "EDGE_OUTCOME_UNKNOWN",
    );
    expect(maLoiBuocFoe("failed on edge node E1: FOE_OUTCOME_UNKNOWN: connect ECONNREFUSED 10.9.8.7:5020 — not sent again", "failed")).toBe("FOE_OUTCOME_UNKNOWN");
    expect(maLoiBuocFoe("Parallel branch failed: FOE_OUTCOME_UNKNOWN: timed out — not sent again; check the device.", "failed")).toBe("FOE_OUTCOME_UNKNOWN");
    expect(maLoiBuocFoe("Parallel branch failed: FOE_OUTCOME_PARTIAL: 1 applied, 2 not applied.", "failed")).toBe("FOE_OUTCOME_PARTIAL");
    expect(maLoiBuocFoe("aborted on edge node E1: MOT_PHAN: tagA applied", "aborted")).toBe("MOT_PHAN");
    expect(maLoiBuocFoe("DUPLICATE_IN_FLIGHT: same idempotency key", "failed", "command")).toBe("DUPLICATE_IN_FLIGHT"); // tiền tố vẫn đúng
  });

  it("dạng cổng FOE_GATE_REQUIRED(<lý do>) được giữ (cả khi không ở đầu chuỗi)", () => {
    expect(maLoiBuocFoe('FOE_GATE_REQUIRED(approvedByOwner): command step "c3" was not sent: …', "failed", "command")).toBe("FOE_GATE_REQUIRED(approvedByOwner)");
    expect(maLoiBuocFoe('Parallel branch failed: FOE_GATE_REQUIRED(noGate): command step "c" was not sent', "failed", "parallel")).toBe("FOE_GATE_REQUIRED(noGate)");
  });

  it("BIÊN TỪ: chuỗi giống mã nằm trong tên máy / đường dẫn / định danh KHÔNG khớp ⇒ dự phòng", () => {
    expect(MA_LOI_DA_BIET).toContain("TIMEOUT");
    expect(MA_LOI_DA_BIET).toContain("BUSY");
    for (const t of [
      "connect ECONNREFUSED plc-TIMEOUT.local:502",
      "open /opt/ot/BUSY/driver.sock failed",
      "host PLC_TIMEOUT unreachable",
      "connect TIMEOUT.plant.example:502 refused",
      "x=TIMEOUT-01 not reachable",
      "ETIMEDOUT 10.9.8.7:5020",
    ])
      expect(maDaBietDauTien(t), t).toBeNull();
    expect(maDaBietDauTien("driver said BUSY, retry")).toBe("BUSY");
    expect(maDaBietDauTien("ended with TIMEOUT.")).toBe("TIMEOUT");
    expect(maDaBietDauTien("NOT_A_KNOWN_CODE: x")).toBeNull(); // mã lạ ⇒ không lộ như "mã"
  });

  it("mức RUN (cheHangRun) dùng cùng luật", () => {
    const r = cheHangRun({ status: "held", error: "Edge node E1 held run 7 (journalFull): EDGE_OUTCOME_UNKNOWN(a): 10.9.8.7:5020", contextJson: null }, false);
    expect(r.error).toBe("EDGE_OUTCOME_UNKNOWN");
  });
});

describe("C2 polish m4 — mã dự phòng theo LOẠI bước (chỉ mã đã có)", () => {
  const buoc = (stepType: string, error: string, status = "failed") => cheBuocRun({ stepId: "s", stepType, status, error, result: null }, false).error;
  it("mỗi loại bước một ca", () => {
    expect(buoc("command", "connect ECONNREFUSED 10.9.8.7:5020")).toBe("DRIVER_WRITE_FAILED");
    expect(buoc("command", 'Precondition (interlock) failed for step "c" (hold).')).toBe("PRECONDITION_FAILED");
    expect(buoc("delay", 'Precondition failed for step "d" (abort).', "aborted")).toBe("PRECONDITION_FAILED");
    expect(buoc("wait_state", 'wait_state timeout (machine 3 state="IDLE").')).toBe("TIMEOUT");
    expect(buoc("wait_telemetry", 'wait_telemetry timeout for step "w".')).toBe("TIMEOUT");
    expect(buoc("branch", "Machine 9 not found")).toBe("TECHNICAL_ERROR");
    expect(buoc("hitl_gate", "gate store unavailable")).toBe("TECHNICAL_ERROR");
    for (const m of ["DRIVER_WRITE_FAILED", "PRECONDITION_FAILED", "TIMEOUT", "TECHNICAL_ERROR", "REJECTED"]) expect(MA_LOI_DA_BIET).toContain(m);
  });
});

describe("C2 polish — cheKetQuaLenh (REST lệnh thiết bị)", () => {
  it("detail qua danh sách trắng chung, error ⇒ mã; kỹ sư (true) giữ nguyên", () => {
    const r = {
      status: "failed",
      error: "robot controller 10.9.8.7:5020 SENTINEL refused",
      detail: { jobId: 41, edge: true, stop: false, reason: "SENTINEL 10.9.8.7:5020", refusal: "SENTINEL", jti: "j", result: { raw: "SENTINEL" }, appError: { appCode: "X", appParams: {} } },
    };
    const an = cheKetQuaLenh(r, false);
    expect(JSON.stringify(an)).not.toMatch(/SENTINEL|10\.9\.8\.7|:5020/);
    expect(an).toEqual({ detail: { jobId: 41, edge: true, stop: false, appError: { appCode: "X", appParams: {} }, reason: "TECHNICAL_ERROR" }, error: "DRIVER_WRITE_FAILED" });
    expect(cheKetQuaLenh({ ...r, status: "rejected" }, false).error).toBe("REJECTED");
    expect(cheKetQuaLenh({ ...r, status: "timeout" }, false).error).toBe("TIMEOUT");
    expect(cheKetQuaLenh(r, true)).toEqual({ detail: r.detail, error: r.error });
  });
});
