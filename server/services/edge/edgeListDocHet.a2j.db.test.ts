/**
 * SCADA R1b-2b-2a A2(j) — the edge lists on the STOP / abort path are read TO THE END (real `_test` DB, every write inside a transaction that is
 * ROLLED BACK; no explicit ids; no DELETE / TRUNCATE; the app role only).
 *   (1) alertUndeliveredStops: 201 unacknowledged STOP heads past the ack deadline (one more than the old `LIMIT 200`) ⇒ the NEWEST is alerted
 *       (polish round: ≤ 200 alerts per pass, so the sweep runs pass after pass until quiet; every head exactly once)
 *       (base: never — the oldest 200 were re-read every pass). A simulated restart (in-process memory forgotten) ⇒ no request alerted again whose
 *       inbox row (the durable marker) exists; a request whose row never landed ⇒ alerted again exactly once (none missed); a new overdue STOP ⇒ alerted.
 *   (2) docClaimCuaNode / v1 pull: 201 claims of one node, the abort-carrying one has the HIGHEST run id ⇒ present with abortRequested (base: an
 *       unordered LIMIT 200).
 *   (3) docRunAbortCanGuiLaiStop / v1 pull: 51 aborted runs inside the re-send window, each with a failed `abort:` step ⇒ all 51 in stopsUnconfirmed
 *       (base: the 50 most recent ⇒ the oldest dropped); a run aborted outside the window / without a failed abort step ⇒ not listed.
 *   (4) AMENDMENT 1 — v2 pull with 201 abort-carrying claims on one node: every answer stays inside the schema (≤ 200 claims, the edge would drop an
 *       over-limit answer whole), carries aborts only, sets runStateUnavailable, raises ONE overflow alert; two pulls deliver all 201 abort signals.
 * The alert sink is replaced by a recorder (criticalStopAlert). The recorder writes the inbox row the real sink writes for `khuTrungBenVung`
 * (metadata {kind, dedupKey}) — only for this file's requests — so the durable marker is exercised; the real sink's metadata contract is
 * criticalStopAlert.ts (`metadata: { kind, ...(khuTrungBenVung ? { dedupKey } : {}) }`).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { inArray, sql } from "drizzle-orm";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  alerts: [] as Array<{ kind: string; dedupKey: string; recipients: number[]; khuTrungBenVung?: unknown }>,
  pending: [] as Promise<unknown>[],
  mine: new Set<number>(),
  /** request ids whose inbox row "never lands" (simulated persist failure) */
  noRow: new Set<number>(),
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return { ...real, getDb: (async () => (H.tx ? H.tx : null)) as typeof real.getDb, __realGetDb: real.getDb };
});
vi.mock("../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: (a: { kind: string; dedupKey: string; recipients: number[]; khuTrungBenVung?: unknown; title: string; message: string }) => {
      H.alerts.push(a);
      const work = (async () => {
      const m = /^stop_undelivered:request:(\d+)$/.exec(a.dedupKey);
      const id = m ? Number(m[1]) : NaN;
      if (H.tx && H.mine.has(id) && !H.noRow.has(id) && a.khuTrungBenVung) {
        const { notifications } = await import("../../../drizzle/schema");
        const p = (H.tx as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
          .insert(notifications)
          .values(a.recipients.map((userId) => ({ userId, type: "ALERT", priority: "URGENT", title: a.title, message: a.message, metadata: { kind: a.kind, dedupKey: a.dedupKey } })));
        await p;
      }
      })();
      H.pending.push(work); // registered synchronously: the caller does `void raiseCriticalStopAlert(...)`
      return work;
    },
  };
});

import * as conn from "../../db/connection";
import { orchestrationRuns, orchestrationRunSteps, orchestrationWorkflows, users } from "../../../drizzle/schema";
import { runEdgeAssignments } from "./edgeExecutionSchema";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const DAU = `A2J-${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

/** a node + a user + an adapter owned by the node (owned at INSERT ⇒ no owner change) */
async function taoNode(tx: Tx): Promise<{ nodeId: number; nodeCode: string; userId: number; adapterId: number; ownerEpoch: number }> {
  const nodeCode = `N-${DAU}-${randomBytes(4).toString("hex")}`;
  const [n] = rowsOf(await tx.execute(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${nodeCode}, 'a2j node', 'online') RETURNING id`));
  const nodeId = Number(n!.id);
  const [u] = await tx.insert(users).values({ openId: `${nodeCode}-u`, username: `${nodeCode}-u`, name: "a2j user", role: "admin", isActive: true } as never).returning({ id: users.id });
  // raw SQL (as the central kit): the edge ownership columns ("edgeNodeId", "ownerEpoch", 0374) are not in the drizzle model of device_adapters
  const [a] = rowsOf(
    await tx.execute(sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "edgeNodeId") VALUES (${`${nodeCode}-A`}, 'a2j adapter', 'stub', 'stub://a2j', true, NULL, ${nodeId}) RETURNING id, "ownerEpoch"`),
  );
  const adapterId = Number(a!.id);
  const ep = { ownerEpoch: a!.ownerEpoch };
  return { nodeId, nodeCode, userId: u!.id, adapterId, ownerEpoch: Number(ep!.ownerEpoch) };
}

/** `n` queued runs of one workflow assigned to the node; returns run ids ascending */
async function taoRuns(tx: Tx, nodeId: number, userId: number, n: number): Promise<number[]> {
  const ref = `${DAU}-wf-${randomBytes(4).toString("hex")}`;
  const def = { ref, name: ref, steps: [] };
  const [wf] = await tx.insert(orchestrationWorkflows).values({ ref, name: ref, definitionJson: def, status: "active", scopeKey: "global", version: 1 } as never).returning({ id: orchestrationWorkflows.id });
  const runs = await tx
    .insert(orchestrationRuns)
    .values(Array.from({ length: n }, () => ({ workflowId: wf!.id, workflowRef: ref, status: "queued", paramsJson: {}, contextJson: {}, startedBy: userId }) as never))
    .returning({ id: orchestrationRuns.id });
  const ids = runs.map((r) => r.id).sort((a, b) => a - b);
  // one literal row per insert (orchestration_run_edge_assignments is not deletable by the app role — wormIdTuongMinhCensus reads literal rows only;
  // its key is the run id, never a free id)
  for (const runId of ids) await tx.insert(runEdgeAssignments).values({ runId, edgeNodeId: nodeId, workflowId: wf!.id, workflowVersion: 1, defHash: "a".repeat(64), assignedBy: userId });
  return ids;
}

describe.skipIf(!onTest)("A2(j) — edge STOP / abort lists read to the end (real _test DB, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    await import("./edgeNodeCommands");
    await import("./edgeExecutionCentral");
  }, 60_000);

  it("★ (1) 201 unacked overdue STOP heads ⇒ every one alerted (the newest included) with the durable flag; restart ⇒ none re-alerted, a missing marker ⇒ once more, a new one ⇒ alerted", async () => {
    const m = await import("./edgeNodeCommands");
    await trongGiaoDich(async (tx) => {
      H.alerts.length = 0;
      H.pending.length = 0;
      H.mine.clear();
      H.noRow.clear();
      m.__resetUndeliveredStopAlertsForTests();
      const k = await taoNode(tx);
      const lateS = Math.ceil(m.edgeStopAckDeadlineMs() / 1000) + 5;
      const ins = rowsOf(
        await tx.execute(sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "createdAt", "expiresAt")
          SELECT ${k.adapterId}, ${k.nodeId}, ${k.ownerEpoch}, 'stop', 'a2j overdue ' || g, ${k.userId}, now() - (${lateS} * interval '1 second'), now() + interval '10 minutes'
          FROM generate_series(1, 201) g RETURNING id`),
      ).map((r) => Number(r.id)).sort((a, b) => a - b);
      expect(ins).toHaveLength(201);
      for (const id of ins) H.mine.add(id);
      const newest = ins[200]!;
      H.noRow.add(ins[5]!); // this one's inbox row never lands

      // polish round: at most TRAN_CANH_BAO_STOP_MOI_LUOT alerts per pass (other files' overdue rows on _test may take slots too) ⇒ pass until quiet
      const passesUntilQuiet = async (): Promise<number> => {
        let passes = 0;
        for (; passes < 10; passes++) {
          const n = await m.alertUndeliveredStops();
          await Promise.all(H.pending);
          expect(n).toBeLessThanOrEqual(m.TRAN_CANH_BAO_STOP_MOI_LUOT);
          if (n === 0) break;
        }
        return passes;
      };
      expect(await passesUntilQuiet()).toBeLessThan(10);
      const mineAlerts = H.alerts.filter((a) => H.mine.has(Number(a.dedupKey.split(":").pop())));
      expect(mineAlerts.map((a) => a.dedupKey)).toContain(m.khoaCanhBaoStopChuaGiao(newest));
      expect(new Set(mineAlerts.map((a) => a.dedupKey)).size).toBe(201);
      expect(mineAlerts).toHaveLength(201); // none twice
      expect(mineAlerts.every((a) => a.kind === "stop_undelivered" && a.khuTrungBenVung !== undefined && a.recipients[0] === k.userId)).toBe(true);

      // same process, second pass ⇒ nothing again
      H.alerts.length = 0;
      await m.alertUndeliveredStops();
      expect(H.alerts.filter((a) => H.mine.has(Number(a.dedupKey.split(":").pop())))).toHaveLength(0);

      // restart: the in-process memory is gone; only the durable marker remains
      m.__resetUndeliveredStopAlertsForTests();
      const [late] = rowsOf(
        await tx.execute(sql`INSERT INTO robot_motion_lock_requests ("adapterId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "createdAt", "expiresAt")
          VALUES (${k.adapterId}, ${k.nodeId}, ${k.ownerEpoch}, 'stop', 'a2j later', ${k.userId}, now() - (${lateS} * interval '1 second'), now() + interval '10 minutes') RETURNING id`),
      );
      const later = Number(late!.id);
      H.mine.add(later);
      H.alerts.length = 0;
      expect(await passesUntilQuiet()).toBeLessThan(10);
      const after = H.alerts.filter((a) => H.mine.has(Number(a.dedupKey.split(":").pop()))).map((a) => a.dedupKey).sort();
      expect(after).toEqual([m.khoaCanhBaoStopChuaGiao(ins[5]!), m.khoaCanhBaoStopChuaGiao(later)].sort());
    });
  }, 120_000);

  it("★ (2) 201 claims of one node, the abort-carrying claim has the HIGHEST run id ⇒ docClaimCuaNode reads all 201; the v1 pull lists it with abortRequested", async () => {
    const ex = await import("./edgeExecutionCentral");
    await trongGiaoDich(async (tx) => {
      const k = await taoNode(tx);
      const prefix = `edn_${randomBytes(6).toString("hex")}`;
      const [cred] = rowsOf(await tx.execute(sql`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status) VALUES (${k.nodeId}, ${prefix}, ${"b".repeat(64)}, 'active') RETURNING id`));
      const ids = await taoRuns(tx, k.nodeId, k.userId, 201);
      await tx
        .update(runEdgeAssignments)
        .set({ claimSeq: 1, claimTokenHash: "c".repeat(64), claimedByCredentialId: Number(cred!.id), claimedAt: new Date(), progressSeq: 0 })
        .where(inArray(runEdgeAssignments.runId, ids));
      await tx.update(orchestrationRuns).set({ status: "running" } as never).where(inArray(orchestrationRuns.id, ids));
      const last = ids[200]!;
      await tx.update(orchestrationRuns).set({ status: "aborted", finishedAt: new Date() } as never).where(inArray(orchestrationRuns.id, [last]));

      const node = { credentialId: Number(cred!.id), nodeId: k.nodeId, nodeCode: k.nodeCode, factoryCode: null };
      const r = await ex.docClaimCuaNode(tx as never, node);
      expect(r.catBot).toBe(false);
      expect(r.hang.map((x) => x.a.runId)).toEqual(ids);
      const pull = await ex.pullForNode(node);
      expect(pull.http).toBe(200);
      const claims = (pull as { data: { claims: Array<{ runId: number; abortRequested: boolean }> } }).data.claims;
      expect(claims).toHaveLength(201);
      expect(claims.find((c) => c.runId === last)).toMatchObject({ abortRequested: true });
    });
  }, 120_000);

  it("★ (3) 51 aborted runs in the re-send window with a failed abort step ⇒ all 51 listed (v1 pull + reader); outside the window / no failed abort step ⇒ not listed", async () => {
    const ex = await import("./edgeExecutionCentral");
    await trongGiaoDich(async (tx) => {
      const k = await taoNode(tx);
      const ids = await taoRuns(tx, k.nodeId, k.userId, 53);
      const now = Date.now();
      const inWindow = ids.slice(0, 51);
      // distinct finishedAt (the oldest first) — the old `ORDER BY finishedAt DESC LIMIT 50` dropped the oldest
      for (let i = 0; i < inWindow.length; i++) {
        await tx.update(orchestrationRuns).set({ status: "aborted", finishedAt: new Date(now - (60_000 - i * 1_000)) } as never).where(inArray(orchestrationRuns.id, [inWindow[i]!]));
      }
      const tooOld = ids[51]!;
      const noFailedStep = ids[52]!;
      await tx.update(orchestrationRuns).set({ status: "aborted", finishedAt: new Date(now - 20 * 60_000) } as never).where(inArray(orchestrationRuns.id, [tooOld]));
      await tx.update(orchestrationRuns).set({ status: "aborted", finishedAt: new Date(now) } as never).where(inArray(orchestrationRuns.id, [noFailedStep]));
      await tx.insert(orchestrationRunSteps).values([...inWindow, tooOld].map((runId) => ({ runId, stepId: "abort:s1", stepType: "command", status: "failed", attempt: 0 }) as never));
      await tx.insert(orchestrationRunSteps).values({ runId: noFailedStep, stepId: "abort:s1", stepType: "command", status: "completed", attempt: 0 } as never);

      const node = { credentialId: 0, nodeId: k.nodeId, nodeCode: k.nodeCode, factoryCode: null };
      const r = await ex.docRunAbortCanGuiLaiStop(tx as never, node, now);
      expect(r.catBot).toBe(false);
      expect(r.hang.map((x) => x.a.runId)).toEqual(inWindow);
      const pull = await ex.pullForNode(node);
      expect(pull.http).toBe(200);
      const listed = [...(pull as { data: { stopsUnconfirmed: number[] } }).data.stopsUnconfirmed].sort((a, b) => a - b);
      expect(listed).toEqual(inWindow);
      expect(listed).not.toContain(tooOld);
      expect(listed).not.toContain(noFailedStep);
    });
  }, 120_000);

  it("★ (4) v2 pull, 201 ABORT-carrying claims on one node ⇒ each answer ≤ 200 claims (schema-valid, aborts only), runStateUnavailable, ONE overflow alert; after 2 pulls every abort signal reached the node", async () => {
    const ex = await import("./edgeExecutionCentral");
    const dh = await import("./docHetTheoTrang");
    const { edgePullAnswerSchema } = await import("./edgeProtocol");
    dh.__resetStopsUnconfirmedRotationForTests();
    dh._quenBaoDocCatBotChoTest();
    await trongGiaoDich(async (tx) => {
      H.alerts.length = 0;
      const k = await taoNode(tx);
      await tx.execute(sql`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id = ${k.nodeId}`);
      const prefix = `edn_${randomBytes(6).toString("hex")}`;
      const [cred] = rowsOf(await tx.execute(sql`INSERT INTO edge_node_credentials ("edgeNodeId", "keyPrefix", "secretHash", status) VALUES (${k.nodeId}, ${prefix}, ${"d".repeat(64)}, 'active') RETURNING id`));
      const ids = await taoRuns(tx, k.nodeId, k.userId, 201);
      await tx
        .update(runEdgeAssignments)
        .set({ claimSeq: 1, claimTokenHash: "e".repeat(64), claimedByCredentialId: Number(cred!.id), claimedAt: new Date(), progressSeq: 0 })
        .where(inArray(runEdgeAssignments.runId, ids));
      await tx.update(orchestrationRuns).set({ status: "aborted", finishedAt: new Date() } as never).where(inArray(orchestrationRuns.id, ids));

      const node = { credentialId: Number(cred!.id), nodeId: k.nodeId, nodeCode: k.nodeCode, factoryCode: null };
      const seen = new Set<number>();
      for (let pull = 1; pull <= 2; pull++) {
        const ans = await ex.pullForNodeV2(node, {});
        expect(ans.http, `pull ${pull}`).toBe(200);
        const data = (ans as { data: { claims: Array<{ runId: number; abortRequested: boolean }>; runStateUnavailable?: true } }).data;
        expect(edgePullAnswerSchema.safeParse(data).success, `pull ${pull} schema-valid`).toBe(true);
        expect(data.claims.length).toBe(200);
        expect(data.claims.every((c) => c.abortRequested)).toBe(true);
        expect(data.runStateUnavailable).toBe(true);
        for (const c of data.claims) seen.add(c.runId);
      }
      expect([...seen].sort((a, b) => a - b)).toEqual(ids);
      await new Promise((r) => setTimeout(r, 500));
      expect(H.alerts.filter((a) => a.dedupKey === `edge_pull_overflow:claims:${k.nodeId}`)).toHaveLength(1);
    });
  }, 120_000);
});
