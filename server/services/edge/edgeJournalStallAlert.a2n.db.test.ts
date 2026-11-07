/**
 * Đĩa edge treo (a2n) — what only real rows can show (real `_test` DB, every write inside a transaction that is ROLLED BACK; no explicit ids in WORM tables; no
 * DELETE / TRUNCATE; the app role only):
 *   (1) the DURABLE 24 h dedup of the URGENT of a stall: the real raiseCriticalStopAlert, the real inbox row. A restart of central (every per-process memory
 *       forgotten) ⇒ no second row for the same stall; another stall of the same node ⇒ a new row, even with the runs and the STOPs unchanged;
 *   (2) the same for the URGENT of its end;
 *   (3) the read of the lost-progress sweep on real rows: only a claim of a run still walking, past the threshold, on the real timestamptz columns; the same
 *       durable dedup across a restart; a later outage of the same run ⇒ a new row.
 * Unit cases: edgeJournalStallCentral.a2n.test. Recipients are this file's one fixture user (alertRecipients stubbed: `_test` holds hundreds of admins).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const H = vi.hoisted(() => ({ tx: null as unknown, nguoi: [] as number[] }));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return { ...real, getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb, __realGetDb: real.getDb };
});
vi.mock("./edgeConfigCentral", async (importOriginal) => ({ ...(await importOriginal<typeof import("./edgeConfigCentral")>()), alertRecipients: async () => H.nguoi }));

import * as conn from "../../db/connection";
import { orchestrationRuns, orchestrationWorkflows, users } from "../../../drizzle/schema";
import { hashWorkflowDefinition } from "../orchestration/foe/foeGateApproval";
import { __quenBoNhoKhuTrungChoTest } from "../robot/criticalStopAlert";
import { __edgeConfigAlertsSettledForTests, __resetEdgeConfigAlertsForTests, alertForEdgeAnomaly } from "./edgeConfigCentral";
import { __resetJournalTreoForTests, baoJournalTreo, baoRunMatProgress, edgeProgressLostAlertMs } from "./edgeExecutionCentral";
import { runEdgeAssignments } from "./edgeExecutionSchema";
import { authenticateEdgeNodeToken, issueNodeCredential, type EdgeNodePrincipal } from "./edgeNodeCredentials";
import { EDGE_JOURNAL_STALL_RECOVERED_CODE } from "./edgeProtocol";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const DAU = `A2N-${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
        await settled();
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/** a node + the one recipient */
async function taoNode(tx: Tx): Promise<EdgeNodePrincipal> {
  const nodeCode = `N-${DAU}-${randomBytes(4).toString("hex")}`;
  const [n] = rowsOf(await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${nodeCode}, 'a2n node', 'online') RETURNING id`));
  const [u] = await tx.insert(users).values({ openId: `${nodeCode}-u`, username: `${nodeCode}-u`, name: "a2n user", role: "admin", isActive: true } as never).returning({ id: users.id });
  H.nguoi = [u!.id];
  // a claim names a credential of its node (edge_run_assignment_guard)
  const { token } = await issueNodeCredential({ nodeCode, actorUserId: u!.id, reason: "a2n stall alert" });
  const node = await authenticateEdgeNodeToken(token);
  if (!node) throw new Error("the node's credential was not accepted");
  return node;
}

/** one run of a workflow whose definition hashes to the assignment; a claim on it or none */
async function taoRun(tx: Tx, node: EdgeNodePrincipal, o: { status: string; claimed: boolean; lastProgressAt: Date }): Promise<number> {
  const ref = `${DAU}-wf-${randomBytes(4).toString("hex")}`;
  const def = { ref, name: ref, steps: [] };
  const [wf] = await tx.insert(orchestrationWorkflows).values({ ref, name: ref, definitionJson: def, status: "active", scopeKey: "global", version: 1 } as never).returning({ id: orchestrationWorkflows.id });
  // the triggers take a queued run and an unclaimed assignment only: the claim, then the status of the case, come after
  const [run] = await tx.insert(orchestrationRuns).values({ workflowId: wf!.id, workflowRef: ref, status: "queued", paramsJson: {}, contextJson: {}, startedBy: H.nguoi[0] } as never).returning({ id: orchestrationRuns.id });
  await tx.insert(runEdgeAssignments).values({ runId: run!.id, edgeNodeId: node.nodeId, workflowId: wf!.id, workflowVersion: 1, defHash: hashWorkflowDefinition(def as never), assignedBy: H.nguoi[0], lastProgressAt: o.lastProgressAt });
  if (o.claimed) await tx.execute(sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = 1, "claimTokenHash" = ${"c".repeat(64)}, "claimedByCredentialId" = ${node.credentialId}, "claimedAt" = ${o.lastProgressAt.toISOString()}::timestamptz WHERE "runId" = ${run!.id}`);
  if (o.status !== "queued") await tx.execute(sql`UPDATE orchestration_runs SET status = ${o.status} WHERE id = ${run!.id}`);
  return run!.id;
}

const settled = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await __edgeConfigAlertsSettledForTests();
};
/** central restarted: every per-process memory gone, only the inbox rows left */
const khoiDongLai = () => {
  __resetEdgeConfigAlertsForTests();
  __resetJournalTreoForTests();
  __quenBoNhoKhuTrungChoTest();
};
const demHang = async (tx: Tx, kind: string): Promise<number> => {
  const [r] = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${H.nguoi[0]} AND priority = 'URGENT' AND metadata->>'kind' = ${kind}`));
  return Number(r!.n);
};

const T = Date.parse("2026-11-07T00:00:00Z");

describe.skipIf(!onTest)("a2n — stalled edge disk: the durable alert (real _test DB, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    await import("./edgeExecutionCentral");
  }, 60_000);
  beforeEach(() => khoiDongLai());

  it("★ (1) one stall, central restarted between two ticks: ONE inbox row; a later stall of the same node, same runs: a second row", async () => {
    await trongGiaoDich(async (tx) => {
      const node = await taoNode(tx);
      const runId = await taoRun(tx, node, { status: "running", claimed: true, lastProgressAt: new Date() });
      await baoJournalTreo(tx as never, node, T);
      await settled();
      expect(await demHang(tx, "edge_journal_stalled")).toBe(1);
      const [m] = rowsOf(await tx.execute(sql`SELECT message FROM notifications WHERE "userId" = ${H.nguoi[0]} AND metadata->>'kind' = 'edge_journal_stalled'`));
      expect(String(m!.message)).toContain(`run ${runId}`);
      khoiDongLai();
      await baoJournalTreo(tx as never, node, T);
      await settled();
      expect(await demHang(tx, "edge_journal_stalled")).toBe(1);
      khoiDongLai();
      await baoJournalTreo(tx as never, node, T + 60_000);
      await settled();
      expect(await demHang(tx, "edge_journal_stalled")).toBe(2);
    });
  });

  it("★ (2) the end of one stall, central restarted: ONE row; the end of another: a second", async () => {
    await trongGiaoDich(async (tx) => {
      const node = await taoNode(tx);
      const rec = (since: number) => ({ code: EDGE_JOURNAL_STALL_RECOVERED_CODE, detail: `journal stall since ${since} ended after 9000 ms; healthy=false` });
      alertForEdgeAnomaly(node, rec(T), async () => H.nguoi);
      await settled();
      khoiDongLai();
      alertForEdgeAnomaly(node, rec(T), async () => H.nguoi);
      await settled();
      expect(await demHang(tx, "edge_journal_stall_recovered")).toBe(1);
      alertForEdgeAnomaly(node, rec(T + 60_000), async () => H.nguoi);
      await settled();
      expect(await demHang(tx, "edge_journal_stall_recovered")).toBe(2);
    });
  });

  it("★ (3) the sweep on real rows: only the running claim past the threshold; restarted: no second row; a later outage: a second row", async () => {
    await trongGiaoDich(async (tx) => {
      const node = await taoNode(tx);
      const now = Date.now();
      const lau = new Date(now - edgeProgressLostAlertMs() - 5_000);
      const boot = now - 3_600_000;
      const mat = await taoRun(tx, node, { status: "running", claimed: true, lastProgressAt: lau });
      const dangBao = await taoRun(tx, node, { status: "running", claimed: true, lastProgressAt: new Date(now - 1_000) });
      const buTru = await taoRun(tx, node, { status: "compensating", claimed: true, lastProgressAt: lau });
      const khongClaim = await taoRun(tx, node, { status: "running", claimed: false, lastProgressAt: lau });
      const daXong = await taoRun(tx, node, { status: "completed", claimed: true, lastProgressAt: lau });
      const held = await taoRun(tx, node, { status: "held", claimed: true, lastProgressAt: lau });
      const out = await baoRunMatProgress(now, boot);
      expect(out).toContain(mat);
      expect(out).toContain(buTru);
      for (const id of [dangBao, khongClaim, daXong, held]) expect(out).not.toContain(id);
      await settled();
      const dau = await demHang(tx, "edge_run_progress_lost");
      expect(dau).toBeGreaterThanOrEqual(2);
      khoiDongLai();
      await baoRunMatProgress(now + 30_000, boot);
      await settled();
      expect(await demHang(tx, "edge_run_progress_lost")).toBe(dau);
      // progress came back and stopped again: another last progress, another URGENT
      const lai = new Date(now + 40_000);
      await tx.execute(sql`UPDATE orchestration_run_edge_assignments SET "lastProgressAt" = ${lai.toISOString()}::timestamptz WHERE "runId" = ${mat}`);
      khoiDongLai();
      await baoRunMatProgress(lai.getTime() + edgeProgressLostAlertMs(), boot);
      await settled();
      expect(await demHang(tx, "edge_run_progress_lost")).toBeGreaterThan(dau);
    });
  });
});
