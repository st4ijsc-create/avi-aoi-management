/**
 * Pha 0 · C0-1 — unsPublisher ↔ SparkplugCommandHandler WIRING sau khi gỡ nhánh DCMD (chọn B).
 *
 * Trước đây (Sprint F4 HITL) test này đo hai hàm ánh xạ publisher tiêm vào handler: `resolveSparkplugTarget` (Station{N} → máy/adapter) và `sparkplugMetricToWrite`
 * (tên metric → tagKey ghi). Cả hai là CỬA GHI thiết bị ngoài dispatcher-có-người-xác-nhận nên đã GỠ. Bất biến mới: publisher KHÔNG còn xuất ra chúng, và
 * không import `commandDispatcher` (census AST chi tiết ở `uns/sparkplugCommand.khongGhi.test.ts`). NCMD "Node Control/Rebirth" vẫn do handler lo (uns/sparkplugCommand.test.ts).
 *
 * mqtt được stub để import không có tác dụng phụ.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));

describe("unsPublisher — không còn ánh xạ DCMD → ghi thiết bị", () => {
  it("không xuất resolveSparkplugTarget / sparkplugMetricToWrite", async () => {
    const pub = (await import("./unsPublisher")) as Record<string, unknown>;
    expect(pub.resolveSparkplugTarget).toBeUndefined();
    expect(pub.sparkplugMetricToWrite).toBeUndefined();
    expect(typeof pub.resolveSparkplugTarget).toBe("undefined");
  });
});
