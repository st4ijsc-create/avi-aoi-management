/**
 * W1-3 — unit test cho helper thuần checkControlGatewayConsistency + logger.
 * Các case: control on/gateway off (OT, Robot), cả hai on, cả hai off.
 */
import { describe, it, expect, vi } from "vitest";
import {
  checkControlGatewayConsistency,
  logControlGatewayConsistency,
} from "./controlGatewayConsistency";

describe("checkControlGatewayConsistency", () => {
  it("OT: control on nhưng gateway off (comment/unset) → 1 cảnh báo nêu đúng cặp cờ", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "true",
      // OT_GATEWAY_ENABLED bị comment → undefined
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("OT_CONTROL_ENABLED=true");
    expect(warnings[0]).toContain("OT_GATEWAY_ENABLED");
    expect(warnings[0]).toContain("unset");
  });

  it("OT: control on, gateway=\"false\" → vẫn cảnh báo (hiện giá trị false)", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "true",
      OT_GATEWAY_ENABLED: "false",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('OT_GATEWAY_ENABLED="false"');
  });

  it("Robot: control on nhưng gateway off → 1 cảnh báo cho Robot", () => {
    const warnings = checkControlGatewayConsistency({
      ROBOT_CONTROL_ENABLED: "true",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[Robot]");
    expect(warnings[0]).toContain("ROBOT_CONTROL_ENABLED=true");
    expect(warnings[0]).toContain("ROBOT_GATEWAY_ENABLED");
  });

  it("cả hai on (control + gateway) → không cảnh báo", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "true",
      OT_GATEWAY_ENABLED: "true",
      ROBOT_CONTROL_ENABLED: "true",
      ROBOT_GATEWAY_ENABLED: "true",
    });
    expect(warnings).toEqual([]);
  });

  it("cả hai off → không cảnh báo (mặc định an toàn)", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "false",
      OT_GATEWAY_ENABLED: "false",
    });
    expect(warnings).toEqual([]);
  });

  it("gateway on nhưng control off → KHÔNG cảnh báo (chỉ đọc telemetry, an toàn)", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "false",
      OT_GATEWAY_ENABLED: "true",
    });
    expect(warnings).toEqual([]);
  });

  it("cả OT lẫn Robot đều lệch → 2 cảnh báo", () => {
    const warnings = checkControlGatewayConsistency({
      OT_CONTROL_ENABLED: "true",
      ROBOT_CONTROL_ENABLED: "true",
    });
    expect(warnings).toHaveLength(2);
  });
});

describe("logControlGatewayConsistency", () => {
  it("console.warn mỗi cảnh báo và trả đúng số lượng", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const n = logControlGatewayConsistency({
        OT_CONTROL_ENABLED: "true",
        ROBOT_CONTROL_ENABLED: "true",
      });
      expect(n).toBe(2);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("không cảnh báo khi cấu hình nhất quán → không gọi console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const n = logControlGatewayConsistency({
        OT_CONTROL_ENABLED: "false",
        OT_GATEWAY_ENABLED: "false",
      });
      expect(n).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
