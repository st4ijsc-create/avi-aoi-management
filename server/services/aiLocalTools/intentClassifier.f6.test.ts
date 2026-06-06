/**
 * Sprint F6 — intent classification for the line-monitoring read + insight tools.
 * Also guards GĐ1 against regression (today_stats still wins for "NG hôm nay").
 */
import { describe, it, expect } from "vitest";
import "./handlers"; // GĐ1 read tools
import "./writeHandlers";
import "./handlersF6"; // F6 read tools
import "./insightHandlersF6"; // F6 insight tools
import { classifyToolIntent } from "./intentClassifier";

describe("F6 — classifyToolIntent line-monitoring intents", () => {
  it("routes 'torque máy SCR-01 7 ngày' → get_process_metric_trend with correct args", () => {
    const d = classifyToolIntent("xu hướng torque máy SCR-01 7 ngày");
    expect(d.tool).toBe("get_process_metric_trend");
    const a = d.args as Record<string, unknown>;
    expect(a.metricKey).toBe("torque");
    expect(a.stepType).toBe("torque");
    expect(a.machineCode).toBe("SCR-01");
    expect(a.days).toBe(7);
  });

  it("maps 'lượng keo' → metricKey volume / stepType dispense", () => {
    const d = classifyToolIntent("xu hướng lượng keo máy DIS-02");
    expect(d.tool).toBe("get_process_metric_trend");
    const a = d.args as Record<string, unknown>;
    expect(a.metricKey).toBe("volume");
    expect(a.stepType).toBe("dispense");
  });

  it("routes 'nút thắt line A' → get_line_balance", () => {
    const d = classifyToolIntent("nút thắt line A hiện tại");
    expect(d.tool).toBe("get_line_balance");
    expect((d.args as Record<string, unknown>).lineCode).toBe("A");
  });

  it("routes a forecast bottleneck question → analyze_line_bottleneck", () => {
    const d = classifyToolIntent("dự báo line A có sẽ nghẽn không");
    expect(d.tool).toBe("analyze_line_bottleneck");
  });

  it("routes 'trạng thái palletizer' → get_palletizer_status", () => {
    const d = classifyToolIntent("trạng thái palletizer thế nào");
    expect(d.tool).toBe("get_palletizer_status");
  });

  it("routes packaging throughput question → get_packaging_throughput", () => {
    const d = classifyToolIntent("sản lượng đóng gói hôm nay");
    expect(d.tool).toBe("get_packaging_throughput");
  });

  it("routes telemetry question → get_ot_telemetry_latest", () => {
    const d = classifyToolIntent("đọc tag telemetry máy PLC-01");
    expect(d.tool).toBe("get_ot_telemetry_latest");
    expect((d.args as Record<string, unknown>).machineCode).toBe("PLC-01");
  });

  it("routes 'tương quan torque với NG' → correlate_process_quality", () => {
    const d = classifyToolIntent("tương quan torque với NG ở hạ nguồn");
    expect(d.tool).toBe("correlate_process_quality");
    const a = d.args as Record<string, unknown>;
    expect(a.upstreamStepType).toBe("torque");
    expect(a.metricKey).toBe("torque");
  });

  it("asks for clarification when correlation args are missing the metric mapping", () => {
    const d = classifyToolIntent("tương quan ảnh hưởng đến NG");
    expect(d.tool).toBeNull();
    expect(d.reason).toBe("MISSING_CORRELATION_ARGS");
    expect(d.clarifyMessage).toBeTruthy();
  });

  it("does NOT regress: 'hôm nay bao nhiêu NG' still → get_today_stats", () => {
    const d = classifyToolIntent("hôm nay bao nhiêu NG?");
    expect(d.tool).toBe("get_today_stats");
  });
});
