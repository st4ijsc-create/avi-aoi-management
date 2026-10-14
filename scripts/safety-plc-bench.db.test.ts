/**
 * doc 81 Đợt 11 task L — DB evidence of the background safety-PLC poller: PRODUCTION deps (real DB doors, trust lookup, durable
 * poll-state, leader advisory lock) on the `_test` DB (vitest.setup forces it), flags ON for THIS process only.
 *   BENCH_PLC_ENDPOINT=tcp://127.0.0.1:15502 pnpm vitest run scripts/safety-plc-bench.db.test.ts   # a real OpenPLC (operator writes coils 1-3)
 *   (unset)                                                                                        # in-process Modbus server
 * Creates ONE config (code prefix BENCHL) through the audited save path, approves it with two checkers, polls, prints the
 * durable events / trusted markers / poll state / health from the DB, then deletes every row it created. Output: console.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import net from "node:net";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
  process.env.SAFETY_PLC_POLLER_ENABLED = "1";
  process.env.SAFETY_PLC_ADAPTER_ENABLED = "1";
  process.env.SAFETY_AUDIT_ENABLED = "1";
  process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "3000";
});
import { selfServer, externalPlc } from "./safety-plc-bench";
import { SafetyPlcPoller } from "../server/services/safety/plc/safetyPlcPoller";
import { savePlcConfig, decidePlcConfigTrust, plcTrustDigest } from "../server/services/safety/plc/safetyPlcTrust";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });
const DB_URL = process.env.DATABASE_URL;
const EXT = process.env.BENCH_PLC_ENDPOINT;
const RUN = `BENCHL${Date.now().toString(36)}`;
const MAKER = 962_301, CHK1 = 962_302, CHK2 = 962_303, ROBOT = 4;
let sql: ReturnType<typeof postgres>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown> = {};

/** Passive write-proof: a TCP pass-through that tallies the Modbus function code of every request the POLLER sends (MBAP byte 7). */
async function fcProxy(upstreamHost: string, upstreamPort: number) {
  const fcs = new Map<number, number>();
  const srv = net.createServer((cl) => {
    const up = net.connect(upstreamPort, upstreamHost);
    let buf = Buffer.alloc(0);
    cl.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8) {
        const len = buf.readUInt16BE(4) + 6;
        if (buf.length < len) break;
        fcs.set(buf[7], (fcs.get(buf[7]) ?? 0) + 1);
        buf = buf.subarray(len);
      }
      up.write(d);
    });
    up.on("data", (d) => cl.write(d));
    const kill = () => { cl.destroy(); up.destroy(); };
    cl.on("error", kill); up.on("error", kill); cl.on("close", kill); up.on("close", kill);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { port: (srv.address() as net.AddressInfo).port, fcs, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

describe.skipIf(!DB_URL)("safety-PLC poller bench with DB doors (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    expect(new URL(DB_URL!).pathname).toMatch(/test/i);
  });
  afterAll(async () => {
    const ids = (await sql`SELECT id FROM safety_plc_configs WHERE code = ${RUN}`).map((r) => r.id as number);
    for (const id of ids) {
      await sql`DELETE FROM safety_event_trust WHERE "eventId" IN (SELECT id FROM safety_events WHERE notes LIKE ${"%" + RUN + "%"})`.catch(() => undefined);
      await sql`DELETE FROM safety_events WHERE notes LIKE ${"%" + RUN + "%"}`.catch(() => undefined);
      await sql`DELETE FROM safety_plc_poll_state WHERE "configId" = ${id}`.catch(() => undefined);
      await sql`DELETE FROM safety_plc_config_trust WHERE "configId" = ${id}`.catch(() => undefined);
      await sql`DELETE FROM safety_plc_configs WHERE id = ${id}`;
    }
    out.restored = { configRowsLeft: (await sql`SELECT count(*)::int AS n FROM safety_plc_configs WHERE code = ${RUN}`)[0].n };
    await sql.end();
    console.info("BENCH-DB-RESULT " + JSON.stringify(out, null, 1));
  });

  it("★ real doors: events + trusted marker + poll state + offline/online", async () => {
    const plc = EXT ? await externalPlc(EXT) : await selfServer();
    // the poller talks to the PLC THROUGH the tally proxy; the operator fixture (writes) uses the direct connection
    const target = new URL(plc.endpoint.replace(/^tcp:/, "http:"));
    const proxy = await fcProxy(target.hostname, Number(target.port || 502));
    for (const a of [0, 1, 2]) await plc.set(a, false);
    const created = await savePlcConfig({
      code: RUN, name: "bench L", vendor: "generic", backend: "modbus", endpoint: `tcp://127.0.0.1:${proxy.port}`,
      statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, estopLatch: { address: "coil:3" }, pollIntervalMs: 500 },
      robotId: ROBOT, enabled: true,
    } as never, MAKER, null);
    if (created.kind !== "ok") throw new Error("create failed " + created.kind);
    const id = created.value.config.id;
    const dig = async () => plcTrustDigest((await sql`SELECT * FROM safety_plc_configs WHERE id = ${id}`)[0] as never);
    const d1 = await decidePlcConfigTrust({ id, decision: "approve", expectedDigest: await dig() }, CHK1, null);
    const d2 = d1.kind === "first" ? await decidePlcConfigTrust({ id, decision: "approve", expectedDigest: await dig() }, CHK2, null) : d1;
    out.approval = [d1.kind, d2.kind];

    const t0 = new Date();
    const p = new SafetyPlcPoller();
    const timings: Record<string, number> = {};
    try {
      await p.refreshConfigs();
      await p.pollNow(id);
      const step = async (name: string, act: () => Promise<void>) => { const s = Date.now(); await act(); await p.pollNow(id); timings[name] = Date.now() - s; };
      await step("estop_press", async () => { await plc.set(0, true); await plc.set(2, true); });
      await step("estop_release", async () => { await plc.set(0, false); });
      await step("latch_reset", async () => { await plc.set(2, false); });
      await step("short_press_with_latch", async () => { await plc.set(0, true); await plc.set(2, true); await plc.set(0, false); });
      await step("latch_reset2", async () => { await plc.set(2, false); });
      await step("guard_trip", async () => { await plc.set(1, true); });
      await step("guard_clear", async () => { await plc.set(1, false); });
      const s = Date.now(); await plc.offline(); for (let i = 0; i < 2; i++) await p.pollNow(id).catch(() => undefined); timings.offline = Date.now() - s;
      const s2 = Date.now(); await plc.online(); await sleep(500);
      for (let i = 0; i < 4; i++) { await p.pollNow(id).catch(() => undefined); await sleep(600); }
      timings.online = Date.now() - s2;
    } finally { await p.stop(); }

    out.timingsMs = timings;
    out.pollerFunctionCodes = Object.fromEntries([...proxy.fcs.entries()].sort((a, b) => a[0] - b[0]));
    await proxy.close();
    expect([...proxy.fcs.keys()].every((fc) => fc >= 1 && fc <= 4), "poller sends only FC 01-04").toBe(true);
    out.serverWritesFromPoller = plc.writes() ?? "n/a (external: see function codes)";
    out.events = await sql`SELECT e.id, e."eventType", e."detectedBy", e."handledBy", e.outcome, e."humanPosition"->>'transition' AS transition, (t."eventId" IS NOT NULL) AS trusted_marker, t.origin
      FROM safety_events e LEFT JOIN safety_event_trust t ON t."eventId" = e.id
      WHERE e."robotId" = ${ROBOT} AND e."createdAt" >= ${t0} AND e."detectedBy" = 'plc' ORDER BY e.id`;
    out.pollState = (await sql`SELECT * FROM safety_plc_poll_state WHERE "configId" = ${id}`)[0];
    const types = (out.events as Array<{ eventType: string; transition: string; trusted_marker: boolean }>);
    expect(types.map((e) => e.eventType)).toEqual(expect.arrayContaining(["estop", "estop_released", "zone_intrusion", "plc_offline", "plc_online"]));
    // the trusted marker is on the trips (estop / zone_intrusion) only; release, offline, online are normal notices by design
    expect(types.filter((e) => e.eventType === "estop" || e.eventType === "zone_intrusion").every((e) => e.trusted_marker)).toBe(true);
    expect(types.filter((e) => e.eventType !== "estop" && e.eventType !== "zone_intrusion").every((e) => !e.trusted_marker)).toBe(true);
    await sql`UPDATE safety_events SET notes = notes || ${" [" + RUN + "]"} WHERE "robotId" = ${ROBOT} AND "createdAt" >= ${t0} AND "detectedBy" = 'plc'`;
    await plc.close();
  });
});
