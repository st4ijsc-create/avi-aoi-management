/**
 * Sparkplug NCMD/DCMD — pha 0 · C0-1 (chọn B, 2026-11-04): CHỈ còn NCMD "Node Control/Rebirth"; DCMD bị TỪ CHỐI (không ghi/bay thiết bị, không dispatcher).
 *
 * Covers:
 *   - NCMD "Node Control/Rebirth" ⇒ onRebirth (phát lại BIRTH) khi có bật; value=false ⇒ không.
 *   - DCMD (mọi metric, kể cả mang `HITL/ActionId` cũ) ⇒ TỪ CHỐI + log; KHÔNG có hook ghi nào để gọi (deps chỉ còn subscribe/onRebirth).
 *   - NCMD metric lạ ⇒ bỏ qua + log; payload hỏng ⇒ drop, không ném; cờ TẮT ⇒ start() không subscribe.
 * Payload là Sparkplug protobuf thật (encodePayload) nên đường decode chạy đủ; MQTT + rebirth được mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodePayload } from "./sparkplugEncoder";
import {
  SparkplugCommandHandler,
  REBIRTH_METRIC,
  commandTopicFilters,
  parseCommandTopic,
  type SparkplugCommandDeps,
} from "./sparkplugCommand";

const GROUP = "avi";
const NODE = "avi-aoi-ot";
const DEVICE = "Station45";

function makeDeps(over: Partial<SparkplugCommandDeps> = {}) {
  const onRebirth = vi.fn(() => {});
  const subscribe = vi.fn(() => {});
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const deps: SparkplugCommandDeps = { subscribe, onRebirth, log, ...over };
  return { deps, onRebirth, subscribe, log };
}

const ORIG = process.env.SPARKPLUG_COMMAND_ENABLED;
beforeEach(() => {
  process.env.SPARKPLUG_COMMAND_ENABLED = "true";
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.SPARKPLUG_COMMAND_ENABLED;
  else process.env.SPARKPLUG_COMMAND_ENABLED = ORIG;
});

describe("parseCommandTopic", () => {
  it("parses NCMD (no device)", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/NCMD/${NODE}`)).toEqual({ kind: "NCMD", groupId: GROUP, edgeNodeId: NODE });
  });
  it("parses DCMD (with device)", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`)).toEqual({ kind: "DCMD", groupId: GROUP, edgeNodeId: NODE, deviceId: DEVICE });
  });
  it("rejects non-command / malformed topics", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DDATA/${NODE}/${DEVICE}`)).toBeNull();
    expect(parseCommandTopic(`spBv1.0/${GROUP}/NCMD/${NODE}/${DEVICE}`)).toBeNull(); // NCMD w/ device
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DCMD/${NODE}`)).toBeNull(); // DCMD w/o device
    expect(parseCommandTopic("garbage")).toBeNull();
  });
});

describe("commandTopicFilters", () => {
  it("returns NCMD + DCMD wildcard filters (DCMD vẫn subscribe để GHI LOG việc từ chối)", () => {
    expect(commandTopicFilters(GROUP, NODE)).toEqual([`spBv1.0/${GROUP}/NCMD/${NODE}`, `spBv1.0/${GROUP}/DCMD/${NODE}/+`]);
  });
});

describe("SparkplugCommandHandler — NCMD Rebirth (hành động an toàn DUY NHẤT)", () => {
  it("NCMD Rebirth=true ⇒ phát lại BIRTH đúng một lần", async () => {
    const { deps, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ timestamp: Date.now(), metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: true }] });
    const cmd = await handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, payload);
    expect(cmd?.kind).toBe("NCMD");
    expect(onRebirth).toHaveBeenCalledTimes(1);
  });

  it("Rebirth value=false ⇒ KHÔNG phát lại", async () => {
    const { deps, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    await handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, encodePayload({ metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: false }] }));
    expect(onRebirth).not.toHaveBeenCalled();
  });

  it("NCMD metric ngoài Rebirth ⇒ bỏ qua + log (không điều khiển nút nào)", async () => {
    const { deps, onRebirth, log } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    await handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, encodePayload({ metrics: [{ name: "Node Control/Reboot", type: "Boolean", value: true }] }));
    expect(onRebirth).not.toHaveBeenCalled();
    expect(log.warn.mock.calls.some((c) => /only Rebirth/.test(String(c[0])))).toBe(true);
  });

  it("onRebirth ném ⇒ không thoát khỏi handler", async () => {
    const { deps } = makeDeps({ onRebirth: () => { throw new Error("boom"); } });
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: true }] });
    await expect(handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, payload)).resolves.toBeDefined();
  });
});

describe("SparkplugCommandHandler — DCMD bị TỪ CHỐI (cửa ghi thiết bị đã gỡ)", () => {
  it("★ DCMD lệnh thiết bị ⇒ từ chối + log; KHÔNG rebirth; deps không có hook ghi nào", async () => {
    const { deps, onRebirth, log } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: "cmd_stop", type: "Boolean", value: true }] });
    const cmd = await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload);
    expect(cmd?.kind).toBe("DCMD");
    expect(onRebirth).not.toHaveBeenCalled();
    expect(log.warn.mock.calls.some((c) => /DCMD REFUSED/.test(String(c[0])) && /nothing was written/.test(String(c[0])))).toBe(true);
    expect(Object.keys(deps).sort()).toEqual(["log", "onRebirth", "subscribe"]);
  });

  it("★ DCMD mang metric `HITL/ActionId` cũ + Rebirth ⇒ vẫn từ chối, KHÔNG rebirth (Rebirth chỉ có nghĩa ở NCMD)", async () => {
    const { deps, onRebirth, log } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({
      metrics: [
        { name: "HITL/ActionId", type: "String", value: "act-1" },
        { name: REBIRTH_METRIC, type: "Boolean", value: true },
        { name: "speed_sp", type: "Int64", value: 5 },
      ],
    });
    await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload);
    expect(onRebirth).not.toHaveBeenCalled();
    expect(log.warn.mock.calls.some((c) => /DCMD REFUSED/.test(String(c[0])) && /3 metric/.test(String(c[0])))).toBe(true);
  });
});

describe("SparkplugCommandHandler — fail-safe", () => {
  it("malformed payload → dropped, no throw, no rebirth", async () => {
    const { deps, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const garbage = Buffer.from([0xff, 0xfe, 0x00, 0x11, 0x22, 0x33]);
    let cmd: unknown;
    await expect((async () => { cmd = await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, garbage); })()).resolves.not.toThrow();
    expect(cmd).toBeUndefined();
    expect(onRebirth).not.toHaveBeenCalled();
  });

  it("non-command topic → dropped", async () => {
    const { deps, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: true }] });
    expect(await handler.handleMessage(`spBv1.0/${GROUP}/DDATA/${NODE}/${DEVICE}`, payload)).toBeUndefined();
    expect(onRebirth).not.toHaveBeenCalled();
  });
});

describe("SparkplugCommandHandler — flag gating (mặc định TẮT)", () => {
  it("flag OFF → start() does not subscribe", () => {
    delete process.env.SPARKPLUG_COMMAND_ENABLED;
    const { deps, subscribe } = makeDeps();
    expect(new SparkplugCommandHandler(deps).start(GROUP, NODE)).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("flag ON → start() subscribes to NCMD/DCMD filters, idempotent", () => {
    const { deps, subscribe } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    expect(handler.start(GROUP, NODE)).toBe(true);
    expect(handler.start(GROUP, NODE)).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toEqual([`spBv1.0/${GROUP}/NCMD/${NODE}`, `spBv1.0/${GROUP}/DCMD/${NODE}/+`]);
  });
});
