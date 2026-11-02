/**
 * R1b-2b-2a A2(o) — CENTRAL never serves / signs a safety-PLC set it cannot stand behind (no DB: the DB reads are stubbed).
 *   O2 — a guarding config the shipped form cannot express (fails the item schema / no trust digest) ⇒ the WHOLE build is
 *        refused (EdgeContractError safety_plc_unshippable), never a set without it; ONE URGENT alert per (node, config, digest):
 *        per process AND durably (khuTrungBenVung, 24 h — a restart does not re-send it to every admin).
 *   O3 — authorize: a signed id NOT in the snapshot central serves the node (servedSafetyPlcConfigIds) ⇒ device_refused
 *        {safety} naming it + EDGE_ANOMALY audit; all served ⇒ null; the served snapshot unbuildable ⇒ throws (⇒ 503). The call
 *        sits in authorizeForNode after the device gates and before the transaction (source scan).
 *   O4 — more than 64 guarding configs ⇒ device_refused {safety}, never a truncated list; exactly 64 ⇒ all 64 listed.
 *   O5 (central) — a pinned STOP never meets the new checks: authorize answers stop_needs_no_authorization BEFORE the gates
 *        and the served-snapshot check; an unbuildable config never fails the pull / heartbeat (currentConfigVersion never
 *        throws) — the STOPs they carry still go.
 *   O8 — a config that cannot be built is no longer a SILENT configVersion 0: logged once per node + reason, and a contract
 *        failure raises one URGENT alert (edge_config_unbuildable).
 *   r3 F1 + r4 m-2 — the per-process alert memory: a delivered alert is suppressed 24 h; a FAILED delivery (recipients unreadable /
 *        none, the raise threw) only 5 min ⇒ no flood of raises to nobody, and an occurrence after 5 min alerts again.
 *   r3 F3 — an EMPTY signed list still reads the served snapshot: an unbuildable config ⇒ throws (⇒ 503), never a pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; details: Record<string, unknown>; status?: string }>,
  served: "real" as "real" | "throw" | number[],
  plcs: [] as Array<Record<string, unknown>>,
  dbError: null as Error | null,
  /** r3 F1 — the raise throws (the inbox / stream could not be written) */
  raiseThrows: false,
}));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    throw new Error("DB_TRAP: this suite never reaches the DB");
  },
}));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: Record<string, unknown>) => {
    if (H.raiseThrows) throw new Error("raise failed");
    H.alerts.push(a);
  },
}));
vi.mock("../safety/plc/safetyPlcAdapter", () => ({ listPlcConfigs: async () => H.plcs }));
vi.mock("./edgeCentralCommon", async (orig) => {
  const real = (await orig()) as typeof import("./edgeCentralCommon");
  return {
    ...real,
    centralDb: async () => {
      throw H.dbError ?? new real.EdgeCentralUnavailable("db unavailable");
    },
    nodeFactoryId: async () => 1,
    robotPlacements: async (_d: unknown, ids: readonly number[]) => new Map(ids.map((id) => [id, { id, stationId: 3, lineId: 2, factoryId: 1 }] as const)),
    auditNode: async (_n: unknown, action: string, _e: unknown, details: Record<string, unknown>, status?: string) => void H.audits.push({ action, details, status }),
  };
});
vi.mock("./edgeConfigCentral", async (orig) => {
  const real = (await orig()) as typeof import("./edgeConfigCentral");
  return {
    ...real,
    servedSafetyPlcConfigIds: async (...a: Parameters<typeof real.servedSafetyPlcConfigIds>) => {
      if (H.served === "real") return real.servedSafetyPlcConfigIds(...a);
      if (H.served === "throw") throw new Error("config build failed");
      return new Set(H.served);
    },
  };
});

import { EdgeContractError } from "./edgeSigning";
import { __edgeConfigAlertsSettledForTests, __resetEdgeConfigAlertsForTests, currentConfigVersion, shipSafetyPlcConfigs } from "./edgeConfigCentral";
import { EDGE_AUTH_MAX_SAFETY_CONFIG_IDS, edgeAuthorizeSafetyConfigIds, edgeSafetyIdsNotServed } from "./edgeAuthorizeCentral";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";
import type { SafetyPlcConfig } from "../../../drizzle/schema";

const NODE = { nodeId: 7, nodeCode: "EDGE-A", credentialId: 31, factoryCode: "F1" } as unknown as EdgeNodePrincipal;
const plc = (id: number, over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig =>
  ({ id, code: `PLC-${id}`, name: `plc ${id}`, vendor: "generic", backend: "modbus", endpoint: "tcp://plc", statusMap: null, robotId: 12, stationId: null, lineId: null, factoryId: null, enabled: true, ...over }) as unknown as SafetyPlcConfig;
const HEX = "a".repeat(64);
const deps = (digest: (c: SafetyPlcConfig) => string = () => HEX) => ({ digest, approved: async () => false, recipients: async () => [1, 2] });

let errors: string[] = [];
let warns: string[] = [];
beforeEach(() => {
  H.alerts.length = 0;
  H.audits.length = 0;
  H.served = "real";
  H.plcs = [];
  H.dbError = null;
  H.raiseThrows = false;
  __resetEdgeConfigAlertsForTests();
  errors = [];
  warns = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warns.push(a.map(String).join(" ")));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("A2(o) O2 — central refuses to build a config that cannot carry a guarding safety PLC (never a set without it)", () => {
  it("control: every guarding config expressible ⇒ all shipped, in order, no alert", async () => {
    const out = await shipSafetyPlcConfigs(NODE, [plc(4), plc(9)], deps());
    expect(out.map((c) => c.id)).toEqual([4, 9]);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toEqual([]);
  });

  it("★ O2: one config fails the item schema (id 0) ⇒ the WHOLE build throws safety_plc_unshippable (logged), one URGENT alert with the durable dedup", async () => {
    const bad = plc(0, { code: "PLC-BAD" });
    await expect(shipSafetyPlcConfigs(NODE, [plc(4), bad], deps())).rejects.toMatchObject({ name: "EdgeContractError", code: "safety_plc_unshippable" });
    await __edgeConfigAlertsSettledForTests();
    expect(errors.some((l) => l.includes("NO config is served") && l.includes("#0 PLC-BAD"))).toBe(true);
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0]).toMatchObject({
      kind: "edge_safety_plc_unshippable",
      dedupKey: `edge_safety_plc_unshippable:7:0:${HEX}`,
      recipients: [1, 2],
      khuTrungBenVung: {},
      retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
      entityType: "edge_node",
      entityId: 7,
    });
    // the next build (every pull rebuilds) ⇒ refused again, but NOT alerted again in this process
    await expect(shipSafetyPlcConfigs(NODE, [plc(4), bad], deps())).rejects.toBeInstanceOf(EdgeContractError);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toHaveLength(1);
    // a restart forgets the process memory: the alert is raised again, and only the DURABLE dedup (khuTrungBenVung) keeps it to one row
    __resetEdgeConfigAlertsForTests();
    await expect(shipSafetyPlcConfigs(NODE, [plc(4), bad], deps())).rejects.toBeInstanceOf(EdgeContractError);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toHaveLength(2);
    expect(H.alerts[1]).toMatchObject({ dedupKey: H.alerts[0].dedupKey, khuTrungBenVung: {} });
  });

  it("★ O2: a trust digest that is not hex64 / cannot be computed ⇒ refused too; each config alerted under its own key", async () => {
    await expect(
      shipSafetyPlcConfigs(
        NODE,
        [plc(4), plc(5), plc(6)],
        deps((c) => {
          if (c.id === 5) return "sha256:not-hex";
          if (c.id === 6) throw new Error("digest crashed");
          return HEX;
        }),
      ),
    ).rejects.toMatchObject({ code: "safety_plc_unshippable" });
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts.map((a) => a.dedupKey)).toEqual(["edge_safety_plc_unshippable:7:5:sha256:not-hex", "edge_safety_plc_unshippable:7:6:none"]);
  });
});

describe("A2(o) O3 — authorize signs only ids inside the snapshot central SERVES the node", () => {
  it("★ O3: signed [7, 8], served {8} ⇒ device_refused {safety} naming #7 + EDGE_ANOMALY audit", async () => {
    H.served = [8];
    const r = await edgeSafetyIdsNotServed(NODE, [7, 8]);
    expect(r).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
    expect(r!.message).toContain("#7");
    expect(r!.message).not.toContain("#8");
    expect(H.audits).toEqual([{ action: "EDGE_ANOMALY", details: { anomaly: "safety_config_not_served", ids: [7] }, status: "failure" }]);
  });

  it("control: every signed id served (a superset is fine) ⇒ null; an empty list with a buildable snapshot ⇒ null", async () => {
    H.served = [7, 8, 9];
    expect(await edgeSafetyIdsNotServed(NODE, [7, 8])).toBeNull();
    H.served = [];
    expect(await edgeSafetyIdsNotServed(NODE, [])).toBeNull();
    expect(H.audits).toEqual([]);
  });

  it("★ r3 F3: an EMPTY signed list still reads the served snapshot — unbuildable ⇒ THROWS (⇒ 503), never a pass for an unguarded device", async () => {
    H.served = "throw";
    await expect(edgeSafetyIdsNotServed(NODE, [])).rejects.toThrow("config build failed");
    // the real one: no config can be built (central's DB unavailable) ⇒ throws as well
    H.served = "real";
    await expect(edgeSafetyIdsNotServed(NODE, [])).rejects.toThrow();
    expect(H.audits).toEqual([]);
  });

  it("★ O3: the served snapshot cannot be built ⇒ THROWS (authorizeForNode's catch ⇒ 503, nothing signed) — never a pass", async () => {
    H.served = "throw";
    await expect(edgeSafetyIdsNotServed(NODE, [7])).rejects.toThrow("config build failed");
    // the real one: centralDb unavailable ⇒ currentNodeConfig throws as well
    H.served = "real";
    await expect(edgeSafetyIdsNotServed(NODE, [7])).rejects.toThrow();
  });

  it("★ O3 / O5 (central): authorizeForNode calls it with the gates' signed ids — after the STOP answer and the device gates, inside the try, before the transaction", () => {
    const s = readFileSync(path.join(__dirname, "edgeAuthorizeCentral.ts"), "utf8");
    const body = s.slice(s.indexOf("export async function authorizeForNode("), s.indexOf("async function insertOrReplay("));
    const call = body.indexOf("await edgeSafetyIdsNotServed(node, g.safetyConfigIds)");
    expect(call).toBeGreaterThan(0);
    expect([...body.matchAll(/edgeSafetyIdsNotServed\(/g)]).toHaveLength(1);
    expect(call).toBeGreaterThan(body.indexOf("  try {"));
    expect(call).toBeGreaterThan(body.lastIndexOf("stop_needs_no_authorization"));
    expect(call).toBeGreaterThan(body.indexOf(`if ("gate" in g) return edgeError("device_refused"`));
    expect(call).toBeLessThan(body.indexOf("insertOrReplay("));
    expect(call).toBeLessThan(body.indexOf("} catch (err) {"));
  });
});

describe("A2(o) O4 — more than 64 guarding configs ⇒ refused, never a truncated signed list", () => {
  const d = {} as never;
  it(`★ O4: ${EDGE_AUTH_MAX_SAFETY_CONFIG_IDS + 1} configs guard the robot ⇒ device_refused {safety}, naming the count`, async () => {
    H.plcs = Array.from({ length: EDGE_AUTH_MAX_SAFETY_CONFIG_IDS + 1 }, (_, i) => plc(100 + i));
    await expect(edgeAuthorizeSafetyConfigIds(d, 7, { robotId: 12 }, { centralPreflight: false })).rejects.toMatchObject({
      answer: { http: 409, code: "device_refused", data: { gate: "safety" }, message: expect.stringContaining("65 safety-PLC configurations") },
    });
  });
  it("control: exactly 64 ⇒ all 64 listed, sorted", async () => {
    H.plcs = Array.from({ length: EDGE_AUTH_MAX_SAFETY_CONFIG_IDS }, (_, i) => plc(200 - i));
    const ids = await edgeAuthorizeSafetyConfigIds(d, 7, { robotId: 12 }, { centralPreflight: false });
    expect(ids).toHaveLength(64);
    expect(ids[0]).toBe(137);
    expect(ids[63]).toBe(200);
  });
});

describe("A2(o) O5 (central) + O8 — an unbuildable config never fails the pull / heartbeat, and is never silent", () => {
  it("★ O5/O8: unshippable safety PLC ⇒ currentConfigVersion resolves 0 (the pull still answers with its STOPs), logged ONCE per reason", async () => {
    H.dbError = new EdgeContractError("safety_plc_unshippable", "safety-PLC config(s) #0 PLC-BAD of node EDGE-A cannot be shipped");
    expect(await currentConfigVersion(NODE)).toBe(0);
    expect(await currentConfigVersion(NODE)).toBe(0);
    const lines = errors.filter((l) => l.includes("config of node EDGE-A cannot be built"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("configVersion 0");
    expect(lines[0]).toContain("refused");
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toEqual([]); // that one alerts per config, in the build
  });

  it("★ O8: a contract failure (e.g. > 200 configs: the signed schema refuses the envelope) ⇒ one URGENT edge_config_unbuildable alert, durable dedup", async () => {
    H.dbError = new EdgeContractError("invalid_payload", "signForNode: central built an invalid config payload");
    expect(await currentConfigVersion(NODE)).toBe(0);
    expect(await currentConfigVersion(NODE)).toBe(0);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0]).toMatchObject({ kind: "edge_config_unbuildable", dedupKey: "edge_config_unbuildable:7:invalid_payload", khuTrungBenVung: {}, entityId: 7 });
    expect(errors.filter((l) => l.includes("cannot be built"))).toHaveLength(1);
  });

  it("O8: central's DB unreachable ⇒ a warning (not an alert), still never thrown", async () => {
    expect(await currentConfigVersion(NODE)).toBe(0);
    expect(warns.some((l) => l.includes("config of node EDGE-A cannot be built"))).toBe(true);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toEqual([]);
  });

  it("★ O5 (central): the pull and the heartbeat take the version through currentConfigVersion (never throws) — no STOP path reads the served snapshot", () => {
    const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
    expect(read("edgeExecutionCentral.ts")).toContain("configVersion = await currentConfigVersion(node);");
    expect(read("edgeCoordinator.ts")).toContain("configVersion: await currentConfigVersion(node)");
    for (const rel of ["edgeExecutionCentral.ts", "edgeCoordinator.ts", "edgeNodeCommands.ts", "edgeReportsCentral.ts"]) {
      expect(read(rel), rel).not.toMatch(/servedSafetyPlcConfigIds|currentNodeConfig\(/);
    }
  });
});

describe("A2(o) AMENDMENT 2 — central's answer to an EDGE-reported anomaly", () => {
  const MISSING = { code: "EDGE_SAFETY_CONFIG_MISSING", detail: "adapter 5: signed safety-PLC config(s) #9, #7 absent from the verified config v3 (issued 90 s ago) — the preflight could not consult them; refused, a refresh is requested" };
  it("★ EDGE_SAFETY_CONFIG_MISSING ⇒ ONE URGENT alert per (node, sorted ids), durable 24 h dedup + per-process dedup", async () => {
    const { alertForEdgeAnomaly } = await import("./edgeConfigCentral");
    expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(true);
    expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(false); // the same refusal again (every retried write)
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toHaveLength(1);
    expect(H.alerts[0]).toMatchObject({
      kind: "edge_safety_plc_missing",
      dedupKey: "edge_safety_plc_missing:7:7,9",
      recipients: [1, 2],
      khuTrungBenVung: {},
      retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
      entityType: "edge_node",
      entityId: 7,
    });
    expect(String(H.alerts[0].message)).toContain("#7, #9");
    // another set of ids is another alert
    expect(alertForEdgeAnomaly(NODE, { ...MISSING, detail: "robot 12: signed safety-PLC config(s) #11 absent from the verified config v3" }, async () => [1])).toBe(true);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts.map((a) => a.dedupKey)).toEqual(["edge_safety_plc_missing:7:7,9", "edge_safety_plc_missing:7:11"]);
  });

  it("★ EDGE_CONFIG_STALE (and any other code) ⇒ NO alert — it stays the EDGE_ANOMALY audit", async () => {
    const { alertForEdgeAnomaly } = await import("./edgeConfigCentral");
    for (const code of ["EDGE_CONFIG_STALE", "EDGE_AUTHORIZATION_REFUSED", "EDGE_STOP_NOT_PINNED"]) expect(alertForEdgeAnomaly(NODE, { code, detail: MISSING.detail }, async () => [1])).toBe(false);
    await __edgeConfigAlertsSettledForTests();
    expect(H.alerts).toEqual([]);
  });

  it("★ edgeReportsCentral: the events stream's anomaly branch audits EVERY anomaly and hands it to alertForEdgeAnomaly (source scan)", () => {
    const s = readFileSync(path.join(__dirname, "edgeReportsCentral.ts"), "utf8");
    const at = s.indexOf(`if (rec.kind === "anomaly") {`);
    expect(at).toBeGreaterThan(0);
    const branch = s.slice(at, s.indexOf("return;", at));
    expect(branch).toContain(`audits.push({ action: "EDGE_ANOMALY"`);
    expect(branch).toMatch(/alertForEdgeAnomaly\(node, \{ code: rec\.code, detail: rec\.detail \}/);
    expect(branch.indexOf("audits.push")).toBeLessThan(branch.indexOf("alertForEdgeAnomaly("));
  });
});

describe("A2(o) r3 F1 + r4 m-2 — the per-process alert memory: a failed delivery keeps a 5 min stamp, a delivered one 24 h", () => {
  const MISSING = { code: "EDGE_SAFETY_CONFIG_MISSING", detail: "robot 12: signed safety-PLC config(s) #7 absent from the verified config v3 (issued 9 s ago)" };
  it("the window is the durable dedup's (criticalStopAlert CRITICAL_STOP_ALERT_DEDUP_WINDOW_MS, 24 h)", async () => {
    const real = await vi.importActual<typeof import("../robot/criticalStopAlert")>("../robot/criticalStopAlert");
    const { EDGE_CONFIG_ALERT_WINDOW_MS } = await import("./edgeConfigCentral");
    expect(EDGE_CONFIG_ALERT_WINDOW_MS).toBe(real.CRITICAL_STOP_ALERT_DEDUP_WINDOW_MS);
    expect(EDGE_CONFIG_ALERT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("the retry stamp of a FAILED delivery is 5 min (r4, review m-2)", async () => {
    const { EDGE_CONFIG_ALERT_RETRY_MS } = await import("./edgeConfigCentral");
    expect(EDGE_CONFIG_ALERT_RETRY_MS).toBe(5 * 60 * 1000);
  });

  it("★ r4 m-2: the recipients read FAILS ⇒ a SHORT stamp: suppressed < 5 min (no flood of raises to nobody), alerts again ≥ 5 min (to the people); delivered ⇒ 24 h", async () => {
    const { alertForEdgeAnomaly, EDGE_CONFIG_ALERT_RETRY_MS, EDGE_CONFIG_ALERT_WINDOW_MS } = await import("./edgeConfigCentral");
    const t0 = 1_900_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => Promise.reject(new Error("users unreadable")))).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      // the stream + log still carried it (raised to nobody) …
      expect(H.alerts).toHaveLength(1);
      expect(H.alerts[0]).toMatchObject({ dedupKey: "edge_safety_plc_missing:7:7", recipients: [] });
      expect(errors.some((l) => l.includes("recipients could not be read"))).toBe(true);
      // … a rebuild / refusal every few seconds is NOT raised again within 5 min
      now.mockReturnValue(t0 + 5_000);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(false);
      now.mockReturnValue(t0 + EDGE_CONFIG_ALERT_RETRY_MS - 1);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(false);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts).toHaveLength(1);
      // ≥ 5 min ⇒ the next occurrence alerts, now reaching the people
      const t1 = t0 + EDGE_CONFIG_ALERT_RETRY_MS;
      now.mockReturnValue(t1);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts).toHaveLength(2);
      expect(H.alerts[1]).toMatchObject({ dedupKey: "edge_safety_plc_missing:7:7", recipients: [1, 2], khuTrungBenVung: {} });
      // delivered ⇒ the full 24 h window (not 5 min)
      now.mockReturnValue(t1 + EDGE_CONFIG_ALERT_RETRY_MS);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(false);
      now.mockReturnValue(t1 + EDGE_CONFIG_ALERT_WINDOW_MS - 1);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1, 2])).toBe(false);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("★ r4 m-2: the recipients list is EMPTY, or the raise THROWS ⇒ the same 5 min stamp (suppressed before, alerts after)", async () => {
    const { alertForEdgeAnomaly, EDGE_CONFIG_ALERT_RETRY_MS } = await import("./edgeConfigCentral");
    const t0 = 1_900_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      now.mockReturnValue(t0 + EDGE_CONFIG_ALERT_RETRY_MS - 1);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [3])).toBe(false);
      now.mockReturnValue(t0 + EDGE_CONFIG_ALERT_RETRY_MS);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [3])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts.map((a) => a.recipients)).toEqual([[], [3]]);
      // the raise throws (another key) ⇒ the same short stamp
      const other = { ...MISSING, detail: "robot 12: signed safety-PLC config(s) #8 absent" };
      const t1 = t0 + 10 * EDGE_CONFIG_ALERT_RETRY_MS;
      now.mockReturnValue(t1);
      H.raiseThrows = true;
      expect(alertForEdgeAnomaly(NODE, other, async () => [1])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      expect(errors.some((l) => l.includes("the alert could not be raised"))).toBe(true);
      H.raiseThrows = false;
      now.mockReturnValue(t1 + EDGE_CONFIG_ALERT_RETRY_MS - 1);
      expect(alertForEdgeAnomaly(NODE, other, async () => [1])).toBe(false);
      now.mockReturnValue(t1 + EDGE_CONFIG_ALERT_RETRY_MS);
      expect(alertForEdgeAnomaly(NODE, other, async () => [1])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts.map((a) => a.dedupKey)).toEqual(["edge_safety_plc_missing:7:7", "edge_safety_plc_missing:7:7", "edge_safety_plc_missing:7:8"]);
    } finally {
      now.mockRestore();
    }
  });

  it("★ an entry OLDER than 24 h ⇒ alerts again; within 24 h ⇒ not (a state that lasts is re-raised once a day, as the durable dedup allows)", async () => {
    const { alertForEdgeAnomaly, EDGE_CONFIG_ALERT_WINDOW_MS } = await import("./edgeConfigCentral");
    const t0 = 1_900_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      now.mockReturnValue(t0 + EDGE_CONFIG_ALERT_WINDOW_MS - 1);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1])).toBe(false);
      now.mockReturnValue(t0 + EDGE_CONFIG_ALERT_WINDOW_MS);
      expect(alertForEdgeAnomaly(NODE, MISSING, async () => [1])).toBe(true);
      await __edgeConfigAlertsSettledForTests();
      expect(H.alerts).toHaveLength(2);
      expect(H.alerts[1]).toMatchObject({ dedupKey: "edge_safety_plc_missing:7:7", khuTrungBenVung: {} });
    } finally {
      now.mockRestore();
    }
  });
});
