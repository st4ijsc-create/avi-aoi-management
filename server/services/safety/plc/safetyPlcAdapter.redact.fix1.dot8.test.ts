/**
 * doc 81 Đợt 8 task N fix 1 (review M3) — the PLC endpoint (host / port) never reaches a safety_events row or the
 * readSafetyPlc answer: neither from the background poller nor from the user-triggered readSafetyPlc (readAndRecord), and
 * not through Node's UNBRACKETED IPv6 error form ("connect ECONNREFUSED fd00::5:502").
 * Oracle: the INSERT captured at the db seam; a fake OT driver whose connect/read errors carry the address.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const E = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, nextId: 77_000 }));
vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          E.rows.push(v);
          return [{ id: E.nextId++, createdAt: new Date(), ...v }];
        },
      }),
    }),
  })),
}));
vi.mock("../../../_core/socket", () => ({ emitSafetyEvent: vi.fn() }));

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import { registerDriver } from "../../ot/driverRegistry";
import { readAndRecord } from "./safetyPlcAdapter";
import { redactEndpoint, safeBackendLabel } from "./plcRedact";
import { OtReadSafetyPlcBackend, SimSafetyPlcBackend } from "./safetyPlcAdapter";

const DRV = { mode: "connectFail" as "connectFail" | "ok", msg: "" };
registerDriver("modbus", (() => ({
  protocol: "modbus",
  connect: async () => {
    if (DRV.mode === "connectFail") throw new Error(DRV.msg);
  },
  disconnect: async () => undefined,
  isConnected: () => true,
  readTags: async (tags: Array<{ tagKey: string }>) => tags.map((t) => ({ tagKey: t.tagKey, value: true, quality: "good", ts: new Date() })),
  writeTags: async () => {
    throw new Error("never");
  },
})) as never);

const cfg = (endpoint: string): SafetyPlcConfig =>
  ({ id: 1, code: "RX", name: "rx", vendor: "pilz", backend: "modbus", endpoint, statusMap: { estop: { address: "coil:1" } }, robotId: 2, stationId: null, lineId: null, enabled: true, scope: null, corporateCode: null, factoryId: null }) as unknown as SafetyPlcConfig;

const LEAKS = /fd00|5:502|10\.44\.0\.9|plc-a7\.plant|:5020|2001:db8/;
const saved = { a: process.env.SAFETY_PLC_ADAPTER_ENABLED, s: process.env.SAFETY_AUDIT_ENABLED };
beforeEach(() => {
  E.rows.length = 0;
  process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
  process.env.SAFETY_AUDIT_ENABLED = "true";
});
afterEach(() => {
  for (const [k, v] of [["SAFETY_PLC_ADAPTER_ENABLED", saved.a], ["SAFETY_AUDIT_ENABLED", saved.s]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("doc 81 Đợt 8 N fix 1 — M3 redaction", () => {
  it("★ unbracketed IPv6 (Node's net-error form) is redacted, with or without a port / zone", () => {
    for (const m of ["connect ECONNREFUSED fd00::5:502", "connect ETIMEDOUT 2001:db8:0:0:0:0:0:7 port", "EHOSTUNREACH fe80::1%eth0", "ECONNRESET ::1"]) {
      const r = redactEndpoint(m, null);
      expect(r, m).not.toMatch(/fd00|2001:db8|fe80|::1\b|5:502/);
      expect(r, m).toMatch(/E[A-Z]+/);
    }
  });

  it("safeBackendLabel names the kind only — never the endpoint the backend's own label() carries", () => {
    const real = new OtReadSafetyPlcBackend("opcua", "opc.tcp://10.44.0.9:5020/ua", {} as never);
    expect(real.label()).toMatch(/10.44.0.9/); // the adapter's own label DOES carry it (why this helper exists)
    expect(safeBackendLabel(real)).toBe("real opcua read");
    expect(safeBackendLabel(new SimSafetyPlcBackend([]))).toMatch(/^sim/);
    expect(safeBackendLabel(null)).toBe("none");
  });

  it("does not eat ordinary text (an error class, a plain number)", () => {
    expect(redactEndpoint("read failed: ETIMEDOUT after 3000 ms", null)).toBe("read failed: ETIMEDOUT after 3000 ms");
  });

  it("★ user-triggered readSafetyPlc on a REAL config whose connect fails: the answer carries no endpoint", async () => {
    for (const [ep, msg] of [
      ["tcp://10.44.0.9:5020", "connect ECONNREFUSED 10.44.0.9:5020"],
      ["tcp://[fd00::5]:502", "connect ECONNREFUSED fd00::5:502"],
      ["tcp://plc-a7.plant:502", "getaddrinfo ENOTFOUND plc-a7.plant"],
    ] as const) {
      DRV.mode = "connectFail";
      DRV.msg = msg;
      const r = await readAndRecord(cfg(ep));
      expect(JSON.stringify(r), ep).not.toMatch(LEAKS);
      expect(r.message).toMatch(/read failed: .*E[A-Z]+/);
    }
  });

  it("★ user-triggered readSafetyPlc that records findings: notes + answer carry no endpoint", async () => {
    DRV.mode = "ok";
    const r = await readAndRecord(cfg("tcp://10.44.0.9:5020"));
    expect(r.findings.map((f) => f.eventType)).toEqual(["estop"]);
    expect(E.rows).toHaveLength(1);
    expect(String(E.rows[0].notes)).not.toMatch(LEAKS);
    expect(String(E.rows[0].notes)).toMatch(/real modbus read/);
    expect(JSON.stringify(r)).not.toMatch(LEAKS);
  });
});
