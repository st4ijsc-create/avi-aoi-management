/**
 * doc 44 W3-B4 / G5.10 — Line View FSM helper (client mirror) unit tests.
 *
 * Bảo đảm map client KHÔNG lệch ngữ nghĩa server:
 *   • mọi lệnh enable đều map tới một transition hợp lệ theo LINE_STATE_TRANSITIONS
 *     (drizzle/schema/lineController.ts §4.1);
 *   • lineViewCommandTarget mirror đúng resolveCommandTarget (lineControllerService).
 */
import { describe, expect, it } from "vitest";
import {
  LINE_VIEW_STATES,
  LINE_VIEW_TRANSITIONS,
  LINE_VIEW_COMMANDS,
  LINE_VIEW_COMMANDS_BY_STATE,
  LINE_VIEW_COMMAND_RISK,
  LINE_VIEW_STATE_TONE,
  lineViewCommandTarget,
  isLineViewCommandEnabled,
  asLineViewState,
  formatMs,
} from "./lineFsm";

describe("lineFsm — client mirror of the line FSM", () => {
  it("every enabled command maps to a legal transition (per §4.1 map)", () => {
    for (const state of LINE_VIEW_STATES) {
      for (const command of LINE_VIEW_COMMANDS_BY_STATE[state]) {
        expect(isLineViewCommandEnabled(command, state), `${command} @ ${state}`).toBe(true);
        const { to, chainReadyFirst } = lineViewCommandTarget(command, state);
        if (chainReadyFirst) {
          expect(LINE_VIEW_TRANSITIONS[state]).toContain("ready");
          expect(LINE_VIEW_TRANSITIONS.ready).toContain(to);
        } else {
          expect(LINE_VIEW_TRANSITIONS[state]).toContain(to);
        }
      }
    }
  });

  it("commands NOT listed for a state are disabled", () => {
    for (const state of LINE_VIEW_STATES) {
      const listed = new Set(LINE_VIEW_COMMANDS_BY_STATE[state]);
      for (const command of LINE_VIEW_COMMANDS) {
        if (!listed.has(command)) {
          expect(isLineViewCommandEnabled(command, state), `${command} @ ${state}`).toBe(false);
        }
      }
    }
  });

  it("mirrors resolveCommandTarget contextual targets (spec §13.2)", () => {
    // start từ idle = chuỗi idle→ready→producing (readiness gate bước 1).
    expect(lineViewCommandTarget("start", "idle")).toEqual({ to: "producing", chainReadyFirst: true });
    expect(lineViewCommandTarget("start", "ready")).toEqual({ to: "producing" });
    // complete là lệnh "tiến chuỗi hoàn tất" theo ngữ cảnh.
    expect(lineViewCommandTarget("complete", "producing")).toEqual({ to: "completing" });
    expect(lineViewCommandTarget("complete", "completing")).toEqual({ to: "idle" });
    expect(lineViewCommandTarget("complete", "changeover")).toEqual({ to: "ready" });
    // fault chỉ thoát bằng reset_fault → ready (khắc phục + xác nhận).
    expect(lineViewCommandTarget("reset_fault", "fault")).toEqual({ to: "ready" });
    expect(LINE_VIEW_COMMANDS_BY_STATE.fault).toEqual(["reset_fault"]);
  });

  it("risk + tone maps cover every command/state (exhaustive)", () => {
    for (const command of LINE_VIEW_COMMANDS) {
      expect(["low", "high"]).toContain(LINE_VIEW_COMMAND_RISK[command]);
    }
    // Quyết định batch W3-B4: changeover/reset_fault = high, còn lại low.
    expect(LINE_VIEW_COMMAND_RISK.changeover).toBe("high");
    expect(LINE_VIEW_COMMAND_RISK.reset_fault).toBe("high");
    expect(LINE_VIEW_COMMAND_RISK.start).toBe("low");
    for (const state of LINE_VIEW_STATES) {
      expect(LINE_VIEW_STATE_TONE[state]).toBeTruthy();
    }
    // ISA-101: bất thường mới lên màu mạnh.
    expect(LINE_VIEW_STATE_TONE.fault).toBe("error");
    expect(LINE_VIEW_STATE_TONE.held).toBe("warning");
    expect(LINE_VIEW_STATE_TONE.idle).toBe("default");
  });

  it("asLineViewState parses tokens fail-safe", () => {
    expect(asLineViewState("PRODUCING")).toBe("producing");
    expect(asLineViewState(" held ")).toBe("held");
    expect(asLineViewState("bogus")).toBeNull();
    expect(asLineViewState(null)).toBeNull();
  });

  it("formatMs renders compact humane durations", () => {
    expect(formatMs(0)).toBe("0s");
    expect(formatMs(12_000)).toBe("12s");
    expect(formatMs(90_000)).toBe("1m30s");
    expect(formatMs(120_000)).toBe("2m");
    expect(formatMs(2 * 3600_000 + 5 * 60_000)).toBe("2h05m");
    expect(formatMs(null)).toBe("—");
    expect(formatMs(-5)).toBe("—");
  });
});
