/**
 * doc 81 Đợt 10 task D fix review 4 — security scan #76 ("toctou-authorization", commandDispatcher.ts), pinned. The re-review measured
 * it NOT exploitable: between the reservation (adapter owner read FOR SHARE, intent row written) and the device write, the adapter's
 * ownership cannot change — 0374's device_owner_change_guard refuses an owner change while the adapter has an in-flight command
 * (an intent without a result). This test pins it through the REAL dispatcher on `_test`: a central write is held on the wire;
 * changeDeviceOwner to a node of the SAME factory (so R-10-am passes and only the in-flight guard can refuse) is REFUSED and the
 * owner is unchanged; the write then completes 'acked'. (The reservation-time half — an owner change WAITS on the FOR SHARE — is
 * pinned in otAdapterOwnerGate.dot10.db.test.ts.) command_log rows are WORM and stay (unique key prefix); the rest is removed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const W = vi.hoisted(() => ({ release: null as null | (() => void), entered: false, writes: 0 }));
vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  const driver = {
    isConnected: () => true,
    async writeTags(writes: Array<{ tagKey: string }>) {
      W.writes++;
      W.entered = true;
      await new Promise<void>((r) => (W.release = r)); // the write is ON THE WIRE until the test releases it
      return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
    },
    async readTags() {
      return [];
    },
  };
  return { ...orig, getActiveDriver: (id: number) => (id === W_ADAPTER.id ? (driver as never) : orig.getActiveDriver(id)), detachOtAdapter: async () => false, attachOtAdapter: async () => false };
});
const W_ADAPTER = vi.hoisted(() => ({ id: -1 }));

import { dispatch } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { changeDeviceOwner } from "../robot/deviceOwnershipService";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const DAU = `D10T-${Date.now()}`;
const TOOL = "set_machine_param";
const OWNER = 990_710_001;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0, node: 0 };
const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "OT_READBACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;

describe.skipIf(!onTest)("scan #76 — the adapter owner is held across an in-flight central write (_test)", () => {
  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
    for (const k of ["OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "OT_READBACK_ENABLED"]) delete process.env[k];
    sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
    ids.factory = Number((await sql`INSERT INTO factories (code, name) VALUES (${`${DAU}-F`}, 'f') RETURNING id`)[0].id);
    ids.workshop = Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`${DAU}-W`}, 'w') RETURNING id`)[0].id);
    ids.line = Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${`${DAU}-L`}, 'l') RETURNING id`)[0].id);
    ids.station = Number((await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${`${DAU}-S`}, 's') RETURNING id`)[0].id);
    const [{ v }] = await sql`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'machinetypeenum' ORDER BY e.enumsortorder LIMIT 1`;
    ids.machine = Number((await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${`${DAU}-M`}, 'm', ${v}::machinetypeenum) RETURNING id`)[0].id);
    ids.node = Number((await sql`INSERT INTO edge_nodes (code, name, status, "factoryCode") VALUES (${`${DAU}-N`}, 'n', 'offline', ${`${DAU}-F`}) RETURNING id`)[0].id);
    W_ADAPTER.id = Number((await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`${DAU}-A`}, 'a', 'stub', 'stub://t', true, ${ids.machine}) RETURNING id`)[0].id);
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${W_ADAPTER.id}, 'speed_sp', 'D100', 'int', true)`;
  });
  afterAll(async () => {
    W.release?.();
    await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`${DAU}%`}`.catch(() => undefined);
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${W_ADAPTER.id} AND "edgeNodeId" IS NOT NULL`.catch(() => undefined);
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${W_ADAPTER.id}`.catch(() => undefined);
    await sql`DELETE FROM device_adapters WHERE id = ${W_ADAPTER.id}`.catch(() => undefined);
    await sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`.catch(() => undefined);
    await sql`DELETE FROM machines WHERE id = ${ids.machine}`.catch(() => undefined);
    await sql`DELETE FROM stations WHERE id = ${ids.station}`.catch(() => undefined);
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => undefined);
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`.catch(() => undefined);
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => undefined);
    await sql.end();
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  });

  it("★ an owner change while central's write is on the wire is REFUSED (in-flight guard), the owner stays central, the write completes", async () => {
    const writes = [{ tagKey: "speed_sp", value: 42 }];
    const actionId = `${DAU}-act`;
    const previewJson = withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId: W_ADAPTER.id, machineId: ids.machine, commandType: "set_param", writes }));
    await sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "previewJson", status, "idempotencyKey", "expiresAt")
              VALUES (${actionId}, ${TOOL}, '{}'::jsonb, ${OWNER}, 'engineer', 'scan 76 pin', ${sql.json(previewJson as never)}, 'confirmed', ${`${actionId}-idem`}, now() + interval '10 minutes')`;
    const p = dispatch({
      adapterId: W_ADAPTER.id,
      machineId: ids.machine,
      commandType: "set_param",
      writes,
      triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER },
      idempotencyKey: `${DAU}-k1`,
    });
    const t0 = Date.now();
    while (!W.entered && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 20));
    expect(W.entered).toBe(true); // reserved (intent committed) and on the wire
    const moved = await changeDeviceOwner({ kind: "adapter", deviceId: W_ADAPTER.id, toEdgeNodeId: ids.node, actorUserId: OWNER, actorName: "scan76" });
    expect(moved).toMatchObject({ ok: false, reason: "refused" });
    expect((moved as { detail: string }).detail).toMatch(/in-flight command/);
    expect((await sql`SELECT "edgeNodeId" FROM device_adapters WHERE id = ${W_ADAPTER.id}`)[0].edgeNodeId).toBeNull();
    W.release!();
    const res = await p;
    expect(res).toMatchObject({ ok: true, status: "acked" });
    expect(W.writes).toBe(1);
  });
});
