/**
 * doc 81 Đợt 10 task F2 — ruling R-10-s on the REAL `_test` DB (as avi_app, every case in a ROLLED-BACK transaction): the CLI
 * drives D's real changeDeviceOwner, reads the node by code, writes the real audit_logs row and the WORM history names the
 * proven admin + reason. Cross-factory is refused with the R-10-am message and leaves the owner unchanged. Only the admin
 * proof is a fake here (the proof path is unit-tested in edge-device-owner.test.ts and the shared TOTP ledger in
 * edgeCredentialAdminTotpLedger.dot10.db.test.ts); the in-process session attach/detach is stubbed (this is not the server).
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as any }));
vi.mock("../server/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(async () => {
      if (!H.tx) return actual.getDb();
      const wrap = (t: any): any =>
        new Proxy(t, {
          get(target, k) {
            if (k === "transaction") return (fn: any) => target.transaction((sp: any) => fn(wrap(sp)));
            const v = Reflect.get(target, k);
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      return wrap(H.tx);
    }),
  };
});
vi.mock("../server/services/robot/robotManager", () => ({
  detachRobot: async () => true,
  attachRobot: async () => false,
  isCentralRobotGatewayOn: () => false,
  isRobotGatewayRunning: () => false,
  getActiveRobot: () => undefined,
  activeRobotIds: () => [],
}));
vi.mock("../server/services/ot/otManager", () => ({ detachOtAdapter: async () => true, attachOtAdapter: async () => false, isOtGatewayOn: () => false, isOtRunning: () => false }));

import { getDb } from "../server/db/connection";
import { runEdgeDeviceOwnerCli } from "./edge-device-owner";

const onTest = /_test\b/.test(process.env.DATABASE_URL ?? "");
const TAG = `F2OWN-${Date.now()}`;
class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: any) => Promise<void>): Promise<void> {
  const d = (await getDb())!;
  try {
    await d.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx);
      } finally {
        H.tx = null;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
const rows = async (tx: any, q: ReturnType<typeof sql>) => (await tx.execute(q)) as Array<Record<string, any>>;
const id = async (tx: any, q: ReturnType<typeof sql>) => Number((await rows(tx, q))[0].id);
let seq = 0;
async function chain(tx: any, s: string) {
  const f = await id(tx, sql`INSERT INTO factories (code, name) VALUES (${`${TAG}-F${s}`}, 'f') RETURNING id`);
  const w = await id(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`${TAG}-W${s}`}, 'w') RETURNING id`);
  const line = await id(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${TAG}-L${s}`}, 'l') RETURNING id`);
  return { code: `${TAG}-F${s}`, line };
}
const nodeCode = () => `${TAG}-N${seq++}`;
const node = async (tx: any, code: string, factoryCode: string | null) => id(tx, sql`INSERT INTO edge_nodes (code, name, status, "factoryCode") VALUES (${code}, 'n', 'offline', ${factoryCode}) RETURNING id`);
const robot = (tx: any, lineId: number) => id(tx, sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${TAG}-R${seq++}`}, 'r', 'sim', 'sim://t', true, ${lineId}) RETURNING id`);
const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {} } };
};
const det = (d: unknown) => (typeof d === "string" ? JSON.parse(d) : d); // audit_logs.details is a JSON text column
const ADMIN = { verifyAdmin: async () => ({ userId: 1, name: "F2 probe admin" }) };

describe.skipIf(!onTest)("R-10-s — edge-device-owner CLI on _test (rolled back)", () => {
  it("assign → WORM history names the admin + reason, audit row written, list shows it; release → central, history + audit", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "a");
      const code = nodeCode();
      const n = await node(tx, code, a.code);
      const r = await robot(tx, a.line);
      const t = io();
      expect(await runEdgeDeviceOwnerCli(["assign", "--robot", String(r), "--node", code, "--actor", "admin", "--reason", "commission F2 probe"], t.io, ADMIN), t.err.join("\n")).toBe(0);
      expect((await rows(tx, sql`SELECT "edgeNodeId" FROM robots WHERE id = ${r}`))[0].edgeNodeId).toBe(n);
      const hist = await rows(tx, sql`SELECT "toEdgeNodeId", "changedBy" FROM device_owner_changes WHERE "deviceKind" = 'robot' AND "deviceId" = ${r} ORDER BY id`);
      expect(hist).toHaveLength(1);
      expect(hist[0].toEdgeNodeId).toBe(n);
      expect(hist[0].changedBy).toContain("F2 probe admin — commission F2 probe (#1)");
      const aud = await rows(tx, sql`SELECT action, status, "userId", details FROM audit_logs WHERE "entityType" = 'edge_device_owner' AND "entityName" = ${`robot:${r}`} ORDER BY id`);
      expect(aud.map((x) => [x.action, x.status, x.userId])).toEqual([["EDGE_DEVICE_OWNER_ASSIGN", "success", 1]]);
      expect(det(aud[0].details)).toMatchObject({ reason: "commission F2 probe", outcome: "done" });

      const l = io();
      expect(await runEdgeDeviceOwnerCli(["list", "--node", code], l.io)).toBe(0);
      expect(l.out).toEqual([expect.stringMatching(new RegExp(`^robot\\t${r}\\t${TAG}-R\\d+\\tnode=${code}\\townerEpoch=\\d+$`))]);

      const t2 = io();
      expect(await runEdgeDeviceOwnerCli(["release", "--robot", String(r), "--actor", "admin", "--reason", "gateway replaced"], t2.io, ADMIN), t2.err.join("\n")).toBe(0);
      expect((await rows(tx, sql`SELECT "edgeNodeId" FROM robots WHERE id = ${r}`))[0].edgeNodeId).toBeNull();
      expect(await rows(tx, sql`SELECT count(*)::int AS n FROM device_owner_changes WHERE "deviceKind" = 'robot' AND "deviceId" = ${r}`)).toEqual([{ n: 2 }]);
      expect((await rows(tx, sql`SELECT action FROM audit_logs WHERE "entityType" = 'edge_device_owner' AND "entityName" = ${`robot:${r}`} ORDER BY id`)).map((x) => x.action)).toEqual(["EDGE_DEVICE_OWNER_ASSIGN", "EDGE_DEVICE_OWNER_RELEASE"]);
    });
  });

  it("cross-factory ⇒ exit 1 with the R-10-am message, owner unchanged, no history row, audited failure", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "b1");
      const b = await chain(tx, "b2");
      const codeB = nodeCode();
      await node(tx, codeB, b.code);
      const r = await robot(tx, a.line);
      const t = io();
      expect(await runEdgeDeviceOwnerCli(["assign", "--robot", String(r), "--node", codeB, "--actor", "admin", "--reason", "wrong factory"], t.io, ADMIN)).toBe(1);
      expect(t.err[0]).toMatch(new RegExp(`^refused \\(cross-factory, R-10-am\\): robot ${r} belongs to factory ${a.code}; edge node \\d+ serves factory ${b.code}`));
      expect((await rows(tx, sql`SELECT "edgeNodeId" FROM robots WHERE id = ${r}`))[0].edgeNodeId).toBeNull();
      expect(await rows(tx, sql`SELECT count(*)::int AS n FROM device_owner_changes WHERE "deviceKind" = 'robot' AND "deviceId" = ${r}`)).toEqual([{ n: 0 }]);
      const aud = await rows(tx, sql`SELECT status, details FROM audit_logs WHERE "entityType" = 'edge_device_owner' AND "entityName" = ${`robot:${r}`}`);
      expect(aud).toHaveLength(1);
      expect(aud[0].status).toBe("failure");
      expect(det(aud[0].details)).toMatchObject({ outcome: "crossFactory" });
    });
  });

  it("unknown node ⇒ exit 1, nothing changed", async () => {
    await inRolledBackTx(async (tx) => {
      const a = await chain(tx, "c");
      const r = await robot(tx, a.line);
      const t = io();
      expect(await runEdgeDeviceOwnerCli(["assign", "--robot", String(r), "--node", `${TAG}-nope`, "--actor", "admin", "--reason", "abc"], t.io, ADMIN)).toBe(1);
      expect(t.err[0]).toMatch(/is not registered/);
      expect((await rows(tx, sql`SELECT "edgeNodeId" FROM robots WHERE id = ${r}`))[0].edgeNodeId).toBeNull();
    });
  });
});
