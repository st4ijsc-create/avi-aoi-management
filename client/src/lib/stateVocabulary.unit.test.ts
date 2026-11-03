import { describe, expect, it } from "vitest";
import { resolveStateToken } from "./stateVocabulary";

/* ============================================================
   TC-02 — resolveStateToken: unit test
   ============================================================ */

describe("resolveStateToken", () => {
  /* ---------- PACKML ---------- */
  describe("packml", () => {
    it("chạy → --packml-run", () => {
      expect(resolveStateToken("packml", "execute")).toEqual({ varName: "--packml-run" });
      expect(resolveStateToken("packml", "producing")).toEqual({ varName: "--packml-run" });
      expect(resolveStateToken("packml", "running")).toEqual({ varName: "--packml-run" });
    });

    it("sẵn sàng → --packml-ready", () => {
      expect(resolveStateToken("packml", "idle")).toEqual({ varName: "--packml-ready" });
      expect(resolveStateToken("packml", "ready")).toEqual({ varName: "--packml-ready" });
      expect(resolveStateToken("packml", "complete")).toEqual({ varName: "--packml-ready" });
      expect(resolveStateToken("packml", "stopped")).toEqual({ varName: "--packml-ready" });
    });

    it("đang hoạt động (transient) → --packml-acting", () => {
      expect(resolveStateToken("packml", "resetting")).toEqual({ varName: "--packml-ready", transient: true });
      expect(resolveStateToken("packml", "starting")).toEqual({ varName: "--packml-acting", transient: true });
      expect(resolveStateToken("packml", "completing")).toEqual({ varName: "--packml-acting", transient: true });
      expect(resolveStateToken("packml", "unholding")).toEqual({ varName: "--packml-acting", transient: true });
      expect(resolveStateToken("packml", "unsuspending")).toEqual({ varName: "--packml-acting", transient: true });
      expect(resolveStateToken("packml", "clearing")).toEqual({ varName: "--packml-acting", transient: true });
    });

    it("giữ / tạm giữ → --packml-held / --packml-suspend", () => {
      expect(resolveStateToken("packml", "holding")).toEqual({ varName: "--packml-held", transient: true });
      expect(resolveStateToken("packml", "held")).toEqual({ varName: "--packml-held" });
      expect(resolveStateToken("packml", "suspending")).toEqual({ varName: "--packml-suspend", transient: true });
      expect(resolveStateToken("packml", "suspended")).toEqual({ varName: "--packml-suspend" });
    });

    it("dừng / abort → --packml-abort", () => {
      expect(resolveStateToken("packml", "stopping")).toEqual({ varName: "--packml-abort", transient: true });
      expect(resolveStateToken("packml", "aborting")).toEqual({ varName: "--packml-abort", transient: true });
      expect(resolveStateToken("packml", "aborted")).toEqual({ varName: "--packml-abort" });
    });

    it("transient: đúng cho trạng thái chuyển tiếp, vắng ở trạng thái tĩnh", () => {
      // Các trạng thái chuyển tiếp (transient)
      const transientStates = ["resetting", "starting", "completing", "unholding", "unsuspending", "clearing", "holding", "suspending", "stopping", "aborting"];
      for (const s of transientStates) {
        const r = resolveStateToken("packml", s);
        expect(r, `transient=${s}`).toBeTruthy();
        expect(r!.transient).toBe(true);
      }

      // Các trạng thái tĩnh (không transient)
      const staticStates = ["execute", "producing", "running", "idle", "ready", "complete", "stopped", "held", "suspended", "aborted"];
      for (const s of staticStates) {
        const r = resolveStateToken("packml", s);
        expect(r, `static=${s}`).toBeTruthy();
        expect(r!.transient).toBeUndefined();
      }
    });
  });

  /* ---------- E10 ---------- */
  describe("e10", () => {
    it("productive → --e10-pt", () => {
      expect(resolveStateToken("e10", "pt")).toEqual({ varName: "--e10-pt" });
      expect(resolveStateToken("e10", "productive")).toEqual({ varName: "--e10-pt" });
    });

    it("standby → --e10-sb", () => {
      expect(resolveStateToken("e10", "sb")).toEqual({ varName: "--e10-sb" });
      expect(resolveStateToken("e10", "standby")).toEqual({ varName: "--e10-sb" });
    });

    it("engineering → --e10-et", () => {
      expect(resolveStateToken("e10", "et")).toEqual({ varName: "--e10-et" });
      expect(resolveStateToken("e10", "engineering")).toEqual({ varName: "--e10-et" });
    });

    it("scheduled downtime → --e10-sd", () => {
      expect(resolveStateToken("e10", "sd")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "scheduled_downtime")).toEqual({ varName: "--e10-sd" });
    });

    it("unscheduled downtime → --e10-ud", () => {
      expect(resolveStateToken("e10", "ud")).toEqual({ varName: "--e10-ud" });
      expect(resolveStateToken("e10", "unscheduled_downtime")).toEqual({ varName: "--e10-ud" });
    });

    it("non-scheduled → --e10-ns", () => {
      expect(resolveStateToken("e10", "ns")).toEqual({ varName: "--e10-ns" });
      expect(resolveStateToken("e10", "non_scheduled")).toEqual({ varName: "--e10-ns" });
      expect(resolveStateToken("e10", "nonscheduled")).toEqual({ varName: "--e10-ns" });
    });
  });

  /* ---------- ALARM ---------- */
  describe("alarm", () => {
    it("critical → --alarm-critical", () => {
      expect(resolveStateToken("alarm", "critical")).toEqual({ varName: "--alarm-critical" });
      expect(resolveStateToken("alarm", "crit")).toEqual({ varName: "--alarm-critical" });
      expect(resolveStateToken("alarm", "p1")).toEqual({ varName: "--alarm-critical" });
    });

    it("high → --alarm-high", () => {
      expect(resolveStateToken("alarm", "high")).toEqual({ varName: "--alarm-high" });
      expect(resolveStateToken("alarm", "p2")).toEqual({ varName: "--alarm-high" });
    });

    it("medium → --alarm-medium", () => {
      expect(resolveStateToken("alarm", "medium")).toEqual({ varName: "--alarm-medium" });
      expect(resolveStateToken("alarm", "med")).toEqual({ varName: "--alarm-medium" });
      expect(resolveStateToken("alarm", "warning")).toEqual({ varName: "--alarm-medium" });
      expect(resolveStateToken("alarm", "p3")).toEqual({ varName: "--alarm-medium" });
    });

    it("low → --alarm-low", () => {
      expect(resolveStateToken("alarm", "low")).toEqual({ varName: "--alarm-low" });
      expect(resolveStateToken("alarm", "info")).toEqual({ varName: "--alarm-low" });
      expect(resolveStateToken("alarm", "advisory")).toEqual({ varName: "--alarm-low" });
      expect(resolveStateToken("alarm", "p4")).toEqual({ varName: "--alarm-low" });
    });
  });

  /* ---------- ANDON ---------- */
  describe("andon", () => {
    it("green/ok/normal → --e10-pt", () => {
      expect(resolveStateToken("andon", "green")).toEqual({ varName: "--e10-pt" });
      expect(resolveStateToken("andon", "ok")).toEqual({ varName: "--e10-pt" });
      expect(resolveStateToken("andon", "normal")).toEqual({ varName: "--e10-pt" });
    });

    it("yellow/warn → --alarm-medium", () => {
      expect(resolveStateToken("andon", "yellow")).toEqual({ varName: "--alarm-medium" });
      expect(resolveStateToken("andon", "warn")).toEqual({ varName: "--alarm-medium" });
    });

    it("red/stop/down → --alarm-critical", () => {
      expect(resolveStateToken("andon", "red")).toEqual({ varName: "--alarm-critical" });
      expect(resolveStateToken("andon", "stop")).toEqual({ varName: "--alarm-critical" });
      expect(resolveStateToken("andon", "down")).toEqual({ varName: "--alarm-critical" });
    });

    it("call/help → --alarm-high", () => {
      expect(resolveStateToken("andon", "call")).toEqual({ varName: "--alarm-high" });
      expect(resolveStateToken("andon", "help")).toEqual({ varName: "--alarm-high" });
    });
  });

  /* ---------- UNITMODE ---------- */
  describe("unitmode", () => {
    it("production/auto/automatic → --packml-ready", () => {
      expect(resolveStateToken("unitmode", "production")).toEqual({ varName: "--packml-ready" });
      expect(resolveStateToken("unitmode", "auto")).toEqual({ varName: "--packml-ready" });
      expect(resolveStateToken("unitmode", "automatic")).toEqual({ varName: "--packml-ready" });
    });

    it("maintenance → --alarm-medium", () => {
      expect(resolveStateToken("unitmode", "maintenance")).toEqual({ varName: "--alarm-medium" });
    });

    it("manual/semi_auto → --packml-acting", () => {
      expect(resolveStateToken("unitmode", "manual")).toEqual({ varName: "--packml-acting" });
      expect(resolveStateToken("unitmode", "semi_auto")).toEqual({ varName: "--packml-acting" });
    });
  });

  /* ---------- CHUẨN HOÁ ĐẦU VÀO ---------- */
  describe("chuẩn hoá đầu vào", () => {
    it("viết hoa / thường không ảnh hưởng", () => {
      expect(resolveStateToken("packml", "RUNNING")).toEqual({ varName: "--packml-run" });
      expect(resolveStateToken("packml", "Running")).toEqual({ varName: "--packml-run" });
      expect(resolveStateToken("packml", "rUnNiNg")).toEqual({ varName: "--packml-run" });
    });

    it("khoảng trắng đầu / cuối được bỏ", () => {
      expect(resolveStateToken("packml", "  running  ")).toEqual({ varName: "--packml-run" });
      expect(resolveStateToken("packml", "\trunning\t")).toEqual({ varName: "--packml-run" });
    });

    it("khoảng trắng giữa các từ → _", () => {
      expect(resolveStateToken("packml", "unsuspending")).toEqual({ varName: "--packml-acting", transient: true });
      expect(resolveStateToken("e10", "scheduled downtime")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "unscheduled downtime")).toEqual({ varName: "--e10-ud" });
      expect(resolveStateToken("e10", "non scheduled")).toEqual({ varName: "--e10-ns" });
    });

    it("gạch nối giữa các từ → _", () => {
      expect(resolveStateToken("e10", "scheduled-downtime")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "unscheduled-downtime")).toEqual({ varName: "--e10-ud" });
      expect(resolveStateToken("e10", "non-scheduled")).toEqual({ varName: "--e10-ns" });
    });

    it("kết hợp: hoa + khoảng trắng + gạch nối", () => {
      expect(resolveStateToken("e10", "  SCHEDULED  DOWNTIME  ")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "UnsChEdUlEd-DowNtImE")).toEqual({ varName: "--e10-ud" });
    });
  });

  /* ---------- TRẠNG THÁI LẠ / RỖNG / HỌ KHÔNG TỒN TẠI ---------- */
  describe("trả null cho đầu vào không hợp lệ", () => {
    it("chuỗi lạ → null", () => {
      expect(resolveStateToken("packml", "xyz")).toBeNull();
      expect(resolveStateToken("e10", "unknown")).toBeNull();
      expect(resolveStateToken("alarm", "extreme")).toBeNull();
      expect(resolveStateToken("andon", "blue")).toBeNull();
      expect(resolveStateToken("unitmode", "test")).toBeNull();
    });

    it("chuỗi rỗng → null", () => {
      expect(resolveStateToken("packml", "")).toBeNull();
      expect(resolveStateToken("e10", "")).toBeNull();
      expect(resolveStateToken("alarm", "")).toBeNull();
      expect(resolveStateToken("andon", "")).toBeNull();
      expect(resolveStateToken("unitmode", "")).toBeNull();
    });

    it("chuỗi chỉ khoảng trắng → null", () => {
      expect(resolveStateToken("packml", "   ")).toBeNull();
      expect(resolveStateToken("e10", "\t\n")).toBeNull();
    });
  });

  /* ---------- CROSS-FAMILY ---------- */
  describe("trạng thái họ này hỏi ở họ khác → null", () => {
    it("PackML state hỏi ở E10 → null", () => {
      expect(resolveStateToken("e10", "running")).toBeNull();
      expect(resolveStateToken("e10", "idle")).toBeNull();
      expect(resolveStateToken("e10", "stopping")).toBeNull();
    });

    it("E10 state hỏi ở PackML → null", () => {
      expect(resolveStateToken("packml", "pt")).toBeNull();
      expect(resolveStateToken("packml", "productive")).toBeNull();
      expect(resolveStateToken("packml", "standby")).toBeNull();
    });

    it("Alarm state hỏi ở Andon → null", () => {
      expect(resolveStateToken("andon", "critical")).toBeNull();
      expect(resolveStateToken("andon", "p1")).toBeNull();
      expect(resolveStateToken("andon", "high")).toBeNull();
    });

    it("Andon state hỏi ở Alarm → null", () => {
      expect(resolveStateToken("alarm", "green")).toBeNull();
      expect(resolveStateToken("alarm", "red")).toBeNull();
      expect(resolveStateToken("alarm", "call")).toBeNull();
    });

    it("Unitmode state hỏi ở PackML → null", () => {
      expect(resolveStateToken("packml", "production")).toBeNull();
      expect(resolveStateToken("packml", "maintenance")).toBeNull();
      expect(resolveStateToken("packml", "manual")).toBeNull();
    });

    it("PackML state hỏi ở Unitmode → null", () => {
      expect(resolveStateToken("unitmode", "running")).toBeNull();
      expect(resolveStateToken("unitmode", "idle")).toBeNull();
    });

    it("Alarm state hỏi ở E10 → null", () => {
      expect(resolveStateToken("e10", "critical")).toBeNull();
      expect(resolveStateToken("e10", "warning")).toBeNull();
    });

    it("E10 state hỏi ở Alarm → null", () => {
      expect(resolveStateToken("alarm", "productive")).toBeNull();
      expect(resolveStateToken("alarm", "standby")).toBeNull();
    });
  });

  /* ---------- HỌ KHÔNG TỒN TẠI ---------- */
  describe("họ không tồn tại → null", () => {
    it("family không thuộc 5 giá trị hợp lệ → null", () => {
      expect(resolveStateToken("invalid" as any, "running")).toBeNull();
      expect(resolveStateToken("xyz" as any, "idle")).toBeNull();
      expect(resolveStateToken("PACKML" as any, "running")).toBeNull();
      expect(resolveStateToken("PackML" as any, "running")).toBeNull();
      expect(resolveStateToken("" as any, "running")).toBeNull();
      expect(resolveStateToken(" " as any, "running")).toBeNull();
    });
  });

  /* ---------- EDGE CASES BỔ SUNG ---------- */
  describe("edge cases bổ sung", () => {
    it("null/undefined raw → null", () => {
      expect(resolveStateToken("packml", null as any)).toBeNull();
      expect(resolveStateToken("e10", null as any)).toBeNull();
      expect(resolveStateToken("alarm", undefined as any)).toBeNull();
    });

    it("Unicode không khớp → null", () => {
      expect(resolveStateToken("packml", "rúnnîng")).toBeNull();
      expect(resolveStateToken("packml", "running🔥")).toBeNull();
    });

    it("nhiều khoảng trắng/gạch nối liên tiếp → _", () => {
      expect(resolveStateToken("e10", "scheduled   downtime")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "scheduled--downtime")).toEqual({ varName: "--e10-sd" });
      expect(resolveStateToken("e10", "scheduled - downtime")).toEqual({ varName: "--e10-sd" });
    });

    it("resetting: transient=true, varName='--packml-ready'", () => {
      const r = resolveStateToken("packml", "resetting");
      expect(r).not.toBeNull();
      expect(r!.varName).toBe("--packml-ready");
      expect(r!.transient).toBe(true);
    });

    it("holding: transient=true, varName='--packml-held'", () => {
      const r = resolveStateToken("packml", "holding");
      expect(r).not.toBeNull();
      expect(r!.varName).toBe("--packml-held");
      expect(r!.transient).toBe(true);
    });

    it("chuỗi chỉ có _ → null", () => {
      expect(resolveStateToken("packml", "___")).toBeNull();
    });

    it("chuỗi rất dài → null", () => {
      const long = "a".repeat(10000);
      expect(resolveStateToken("packml", long)).toBeNull();
    });
  });
});
