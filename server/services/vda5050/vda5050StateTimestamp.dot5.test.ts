/**
 * doc 81 Đợt 5 task F5 (item 6) — the VDA 5050 AGV `state.timestamp` follows the SAME device-time rule as every telemetry
 * door (`docTsThietBi`, R-1C-a): no time zone ⇒ rejected; unparseable ⇒ rejected; more than the 24 h future skew
 * (`maxFutureSkewMs`, OT_INGEST_MAX_FUTURE_SKEW_MS) ⇒ rejected. A rejected stamp falls back to SERVER time and is logged.
 *
 * Why it matters: robotIngest writes this timestamp as `robot_telemetry.lastHeartbeat` and as the field-health heartbeat
 * (`recordHeartbeat({ at })`). A wrong-clock AGV stamping +48 h kept a heartbeat "in the future", so the X1-b TTL sweep
 * (`classifyLiveness`) never saw it age — false liveness after the AGV went silent.
 * Oracles: fixed ISO strings and the pure field-health classifier (no product clock reads beyond Date.now bounds).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapStateToRobotTelemetry } from "./vda5050Mapping";
import { classifyLiveness } from "../field/fieldHealthService";
import type { Vda5050State } from "./vda5050Messages";

const H = 60 * 60 * 1000;
const stateAt = (timestamp: unknown, serialNumber = "AGV-TS"): Vda5050State =>
  ({
    headerId: 1,
    timestamp,
    version: "2.0.0",
    manufacturer: "ACME",
    serialNumber,
    orderId: "",
    orderUpdateId: 0,
    lastNodeId: "",
    lastNodeSequenceId: 0,
    nodeStates: [],
    edgeStates: [],
    driving: false,
    actionStates: [],
    batteryState: { batteryCharge: 80, charging: false },
    operatingMode: "AUTOMATIC",
    errors: [],
    safetyState: { eStop: "NONE", fieldViolation: false },
  }) as unknown as Vda5050State;

let warn: ReturnType<typeof vi.spyOn>;
const savedSkew = process.env.OT_INGEST_MAX_FUTURE_SKEW_MS;
beforeEach(() => {
  delete process.env.OT_INGEST_MAX_FUTURE_SKEW_MS; // default 24 h
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  if (savedSkew === undefined) delete process.env.OT_INGEST_MAX_FUTURE_SKEW_MS;
  else process.env.OT_INGEST_MAX_FUTURE_SKEW_MS = savedSkew;
});

/** The mapped timestamp is server time: inside [before, after] of the call. */
function expectServerTime(ts: string | unknown, serial: string) {
  const before = Date.now();
  const got = mapStateToRobotTelemetry(stateAt(ts, serial)).timestamp!;
  const after = Date.now();
  expect(got.getTime()).toBeGreaterThanOrEqual(before);
  expect(got.getTime()).toBeLessThanOrEqual(after);
}

describe("Đợt 5 F5 — VDA 5050 state timestamp: device-time rule (no tz / garbage / > 24 h future ⇒ server time + log)", () => {
  it("a zoned past timestamp is kept exactly (the AGV's own time)", () => {
    const iso = "2026-10-10T08:15:30.250Z";
    expect(mapStateToRobotTelemetry(stateAt(iso)).timestamp!.toISOString()).toBe(iso);
    expect(mapStateToRobotTelemetry(stateAt("2026-10-10T15:15:30.250+07:00")).timestamp!.toISOString()).toBe(iso);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a zoned timestamp 1 h ahead (inside the 24 h skew) is kept — same rule as the telemetry bus", () => {
    const ahead = new Date(Date.now() + H);
    expect(mapStateToRobotTelemetry(stateAt(ahead.toISOString())).timestamp!.getTime()).toBe(ahead.getTime());
  });

  it("★ more than 24 h in the future ⇒ rejected: server time + a log naming the AGV and the reason", () => {
    expectServerTime(new Date(Date.now() + 48 * H).toISOString(), "AGV-FUT");
    expect(warn).toHaveBeenCalled();
    const line = String(warn.mock.calls.map((c) => c.join(" ")).join("\n"));
    expect(line).toMatch(/AGV-FUT/);
    expect(line).toMatch(/ts_too_far_future/);
  });

  it("the future limit follows OT_INGEST_MAX_FUTURE_SKEW_MS (read at call time)", () => {
    process.env.OT_INGEST_MAX_FUTURE_SKEW_MS = String(10 * 60 * 1000);
    expectServerTime(new Date(Date.now() + H).toISOString(), "AGV-ENV");
  });

  it("★ NO time zone (naive) ⇒ rejected: server time + log ts_no_timezone (never read in the process TZ)", () => {
    expectServerTime("2026-10-10T08:15:30", "AGV-NAIVE");
    const line = String(warn.mock.calls.map((c) => c.join(" ")).join("\n"));
    expect(line).toMatch(/AGV-NAIVE/);
    expect(line).toMatch(/ts_no_timezone/);
  });

  it("garbage / wrong type ⇒ server time (+ log); absent ⇒ server time (no reject)", () => {
    expectServerTime("not-a-date", "AGV-G1");
    expectServerTime({ t: 1 }, "AGV-G2");
    expect(String(warn.mock.calls.map((c) => c.join(" ")).join("\n"))).toMatch(/invalid_ts/);
    warn.mockClear();
    expectServerTime(undefined, "AGV-ABSENT");
    expectServerTime("", "AGV-EMPTY");
    expect(warn).not.toHaveBeenCalled();
  });

  it("the log is throttled per AGV and reason (a 1 Hz state stream does not flood the log)", () => {
    const far = new Date(Date.now() + 48 * H).toISOString();
    for (let i = 0; i < 50; i++) mapStateToRobotTelemetry(stateAt(far, "AGV-FLOOD"));
    const n = warn.mock.calls.filter((c) => String(c.join(" ")).includes("AGV-FLOOD")).length;
    expect(n).toBe(1);
  });

  it("★ a FUTURE heartbeat no longer hides staleness: the AGV goes silent after one +48 h state ⇒ the sweep sees it lost", () => {
    const t0 = Date.now();
    const mapped = mapStateToRobotTelemetry(stateAt(new Date(t0 + 48 * H).toISOString(), "AGV-SILENT"));
    // robotIngest records `state.timestamp ?? now` as lastHeartbeat / the field-health heartbeat.
    const heartbeat = mapped.timestamp!;
    const ttl = 2000;
    const lostMult = 5;
    expect(classifyLiveness(heartbeat, new Date(t0 + 1000), ttl, lostMult)).toBe("live");
    expect(classifyLiveness(heartbeat, new Date(t0 + 5000), ttl, lostMult)).toBe("stale");
    expect(classifyLiveness(heartbeat, new Date(t0 + 60_000), ttl, lostMult)).toBe("lost_connection");
  });
});
