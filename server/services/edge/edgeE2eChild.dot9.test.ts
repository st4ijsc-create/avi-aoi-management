/**
 * doc 81 Đợt 9 task S4 — the EDGE PROCESS of the two-process end-to-end test (edgeExecution.s4.e2e.dot9.db.test.ts spawns it as
 * a separate `vitest run` process). It runs ONLY when spawned (S9_EDGE_E2E_CHILD set); in a normal test run it is skipped.
 *
 * It is a real edge: the real EdgeExecutionAgent (HTTP to central with its node credential), the real engine and the real
 * robot dispatcher against `_test`. Only the robot itself is an in-process counting fake (and the safety-PLC read it consults),
 * so nothing leaves this machine. It runs until the parent creates the stop file, then reports what its robot received.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({ motions: 0, stops: 0 }));

vi.mock("../robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === Number(process.env.S9_EDGE_E2E_ROBOT_ID)
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            runJob: async (job: { jobType: string }) => {
              if (job.jobType === "abort") h.stops++;
              else h.motions++;
              return { ok: true, status: "done", detail: { edgeProcess: process.pid } };
            },
            abort: async () => {
              h.stops++;
            },
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "S9-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

const DIR = process.env.S9_EDGE_E2E_DIR ?? "";

describe.skipIf(!process.env.S9_EDGE_E2E_CHILD)("doc 81 Đợt 9 S4 — child: the edge process", () => {
  it("runs the edge agent until the parent says stop", async () => {
    expect(process.env.DATABASE_URL).toMatch(/_test/); // never the dev DB
    await import("../ot/adapterFacade");
    await import("../ot/safetyTarget");
    const { EdgeExecutionAgent, edgeExecutionConfigFromEnv } = await import("./edgeExecutionAgent");
    const cfg = await edgeExecutionConfigFromEnv();
    expect("error" in cfg ? cfg.error : null).toBeNull();
    const agent = new EdgeExecutionAgent(cfg as Exclude<typeof cfg, { error: string }>);
    agent.start();
    writeFileSync(path.join(DIR, "ready"), String(process.pid));
    const deadline = Date.now() + 240_000;
    while (!existsSync(path.join(DIR, "stop")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await agent.stop();
    await agent.idle();
    writeFileSync(path.join(DIR, "report.json"), JSON.stringify({ pid: process.pid, motions: h.motions, stops: h.stops, live: agent.liveRunIds() }));
  }, 300_000);
});
