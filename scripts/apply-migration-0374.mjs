#!/usr/bin/env node
/**
 * 0374 — doc 81 Đợt 10 task A: DEVICE OWNERSHIP (robots / device_adapters "edgeNodeId"), the robot motion-lock generation
 * floor, robot_motion_locks."authority", robot_motion_lock_requests, device_owner_changes (WORM). Applies
 * `drizzle/0374_edge_device_ownership_and_lock_authority.sql` as owner `aoi`, then VERIFIES as `avi_app` (pattern 0363–0371):
 *   (a) the new columns (types, defaults, FKs ON DELETE RESTRICT, CHECKs), both tables, every trigger, comments;
 *   (b) grants (catalog — EXACT): robot_motion_lock_requests SELECT / INSERT + column UPDATE (deliveredAt, ackedAt,
 *       ackGeneration, outcome) + sequence USAGE; device_owner_changes SELECT only; then BEHAVIOUR in an ALWAYS-rolled-back
 *       transaction: robot owner NULL → node ⇒ ok, floor = max(floor, lock generation) + 1, one history row with the
 *       `avi.actor` actor; floor lowered ⇒ 23514; owner change while a robot_jobs row is 'running' ⇒ 23514; adapter owner
 *       change ⇒ ok (history), while a command_log row is 'sent' ⇒ 23514; a robot inserted already owned ⇒ history row;
 *       history INSERT / UPDATE / DELETE by avi_app ⇒ 42501; a lock row 'edge:<owner>' ⇒ ok, 'edge:<other>' / 'bogus' ⇒
 *       23514; lock requests: lock for an owned robot ⇒ ok, unowned ⇒ 23514, two targets ⇒ 23514, an adapter lock (not
 *       stop) ⇒ 23514, an adapter stop ⇒ ok, clear without expectedGeneration ⇒ 23514, born delivered ⇒ 23514, delivered
 *       once ⇒ ok / again ⇒ 23514, acked once ⇒ ok / again ⇒ 23514, outcome without ackedAt ⇒ 23514, identity ⇒ 42501,
 *       DELETE ⇒ 42501; a program report for an adapter the node does not own ⇒ 23514; deleting a node that owns a device
 *       ⇒ 23503; AS OWNER: history UPDATE / DELETE / TRUNCATE ⇒ 23514 (WORM), a lock request identity change ⇒ 23514;
 *       0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0374.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const REQ = "robot_motion_lock_requests";
const HIST = "device_owner_changes";
const REQ_COLS = ["id", "robotId", "adapterId", "edgeNodeId", "kind", "expectedGeneration", "reason", "requestedBy", "createdAt", "expiresAt", "deliveredAt", "ackedAt", "ackGeneration", "outcome"];
const HIST_COLS = ["id", "deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "changedBy", "changedAt"];
const TRIGGERS = [
  "trg_robots_owner_change", "trg_robots_owner_insert", "trg_adapters_owner_change", "trg_adapters_owner_insert", "trg_device_owner_changes_worm",
  "trg_device_owner_changes_worm_truncate", "trg_robot_motion_lock_authority", "trg_edge_program_owned", "trg_robot_motion_lock_request_guard",
];

async function fixtures(tx, code) {
  const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code}, ${code}, 'offline') RETURNING id`;
  const [node2] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code + "-2"}, ${code}, 'offline') RETURNING id`;
  const [robot] = await tx`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${code + "-r"}, ${code}, 'sim', 'sim://probe') RETURNING id`;
  const [robotBusy] = await tx`INSERT INTO robots (code, name, vendor, endpoint) VALUES (${code + "-rb"}, ${code}, 'sim', 'sim://probe') RETURNING id`;
  const [ad] = await tx`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${code + "-a"}, ${code}, 'stub', 'stub://probe') RETURNING id`;
  const [adBusy] = await tx`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${code + "-ab"}, ${code}, 'stub', 'stub://probe') RETURNING id`;
  return { node, node2, robot, robotBusy, ad, adBusy };
}
const reqIns = (sp, o) =>
  sp`INSERT INTO ${sp(REQ)} ("robotId", "adapterId", "edgeNodeId", kind, "expectedGeneration", reason, "requestedBy", "expiresAt", "deliveredAt")
     VALUES (${o.robotId ?? null}, ${o.adapterId ?? null}, ${o.edgeNodeId}, ${o.kind}, ${o.expectedGeneration ?? null}, 'probe', 5, now() + interval '1 minute', ${o.deliveredAt ?? null}) RETURNING id`;

await runMigration({
  file: "0374_edge_device_ownership_and_lock_authority.sql",
  tag: "[0374]",
  async verify({ sql, appSql, log }) {
    // (a)
    const col = async (t, c) => (await appSql`SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_name = ${t} AND column_name = ${c}`)[0];
    const want = [
      ["robots", "edgeNodeId", "integer", "YES"], ["device_adapters", "edgeNodeId", "integer", "YES"],
      ["robots", "motionLockGenerationFloor", "integer", "NO"], ["robot_motion_locks", "authority", "character varying", "NO"],
    ];
    for (const [t, c, ty, n] of want) {
      const x = await col(t, c);
      if (!x || x.t !== ty || x.n !== n) throw new Error(`(a) ${t}.${c}: ${JSON.stringify(x)}`);
    }
    if (!/central/.test(String((await col("robot_motion_locks", "authority")).d))) throw new Error("(a) authority default");
    for (const fk of ["fk_robots_edge_node", "fk_device_adapters_edge_node"]) {
      const [d] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = ${fk}`;
      if (!d || !/REFERENCES edge_nodes\(id\) ON DELETE RESTRICT/.test(d.d)) throw new Error(`(a) ${fk}: ${d?.d}`);
    }
    for (const [t, cols] of [[REQ, REQ_COLS], [HIST, HIST_COLS]]) {
      const have = await columnsOf(appSql, t);
      for (const c of cols) if (!have.includes(c)) throw new Error(`(a) ${t}.${c} missing`);
      const [ct] = await appSql`SELECT obj_description(${"public." + t}::regclass, 'pg_class') AS c`;
      if (!ct?.c || !/Dot 10 A \(0374\)/.test(ct.c)) throw new Error(`(a) ${t} comment missing`);
    }
    const trg = (await appSql`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname = ANY(${TRIGGERS})`).map((r) => r.tgname);
    if (trg.length !== TRIGGERS.length) throw new Error(`(a) triggers: ${JSON.stringify(trg)}`);
    const [sd] = await appSql`SELECT bool_and(prosecdef) AS d FROM pg_proc WHERE proname IN ('device_owner_change_guard', 'device_owner_insert_log')`;
    if (!sd?.d) throw new Error("(a) owner-change functions must be SECURITY DEFINER");
    log(`(a) columns + FKs RESTRICT + ${REQ} + ${HIST}; triggers ${trg.length}; SECURITY DEFINER logging`);
    // (b) catalog
    const pr = await tablePriv(appSql, REQ);
    if (!pr.sel || !pr.ins || pr.upd || pr.del || pr.trunc || pr.refs || pr.trig) throw new Error(`(b) ${REQ} grants not exact: ${JSON.stringify(pr)}`);
    const upd = await updatableCols(appSql, REQ, REQ_COLS);
    if (JSON.stringify(upd) !== JSON.stringify(["ackGeneration", "ackedAt", "deliveredAt", "outcome"])) throw new Error(`(b) ${REQ} column UPDATE: ${JSON.stringify(upd)}`);
    const ph = await tablePriv(appSql, HIST);
    if (!ph.sel || ph.ins || ph.upd || ph.del || ph.trunc || ph.refs || ph.trig) throw new Error(`(b) ${HIST} grants not exact: ${JSON.stringify(ph)}`);
    const [sq] = await appSql`SELECT has_sequence_privilege('robot_motion_lock_requests_id_seq', 'USAGE') AS u, has_sequence_privilege('robot_motion_lock_requests_id_seq', 'UPDATE') AS upd`;
    if (!sq.u || sq.upd) throw new Error(`(b) sequence grants: ${JSON.stringify(sq)}`);
    // (b) behaviour
    const CODE = `__probe_0374_${Date.now()}`;
    const kq = await rolledBack(appSql, async (tx) => {
      const f = await fixtures(tx, CODE);
      await tx`SELECT set_config('avi.actor', ${"probe:" + CODE}, true)`;
      const r = {};
      await tx`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation) VALUES (${f.robot.id}, 'probe', 5)`;
      r.robotOwn = await maLoi(tx, (sp) => sp`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`);
      const [rf] = await tx`SELECT "motionLockGenerationFloor" AS f FROM robots WHERE id = ${f.robot.id}`;
      r.floorAfter = rf.f;
      const hist = await tx`SELECT "deviceKind" AS k, "fromEdgeNodeId" AS fr, "toEdgeNodeId" AS t, "generationFloor" AS g, "changedBy" AS by FROM ${tx(HIST)} WHERE "deviceKind" = 'robot' AND "deviceId" = ${f.robot.id}`;
      r.robotHist = hist.length === 1 && hist[0].fr === null && hist[0].t === f.node.id && hist[0].g === 6 && hist[0].by === "probe:" + CODE;
      r.floorDown = await maLoi(tx, (sp) => sp`UPDATE robots SET "motionLockGenerationFloor" = 0 WHERE id = ${f.robot.id}`);
      await tx`INSERT INTO robot_jobs ("robotId", "jobType", status) VALUES (${f.robotBusy.id}, 'move', 'running')`;
      r.robotBusy = await maLoi(tx, (sp) => sp`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robotBusy.id}`);
      r.adOwn = await maLoi(tx, (sp) => sp`UPDATE device_adapters SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.ad.id}`);
      await tx`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status) VALUES (${f.adBusy.id}, 1, 1, 'sent')`;
      r.adBusy = await maLoi(tx, (sp) => sp`UPDATE device_adapters SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.adBusy.id}`);
      const [born] = await tx`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${CODE + "-born"}, ${CODE}, 'sim', 'sim://probe', ${f.node2.id}) RETURNING id`;
      const [bh] = await tx`SELECT count(*)::int AS n FROM ${tx(HIST)} WHERE "deviceKind" = 'robot' AND "deviceId" = ${born.id} AND "toEdgeNodeId" = ${f.node2.id}`;
      r.bornHist = bh.n;
      const [ah] = await tx`SELECT count(*)::int AS n FROM ${tx(HIST)} WHERE "deviceKind" = 'adapter' AND "deviceId" = ${f.ad.id}`;
      r.adHist = ah.n;
      r.histIns = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(HIST)} ("deviceKind", "deviceId", "changedBy") VALUES ('adapter', 1, 'forged')`);
      r.histUpd = await maLoi(tx, (sp) => sp`UPDATE ${sp(HIST)} SET "changedBy" = 'x' WHERE "deviceId" = ${f.robot.id}`);
      r.histDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(HIST)} WHERE "deviceId" = ${f.robot.id}`);
      r.lockOwner = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = ${"edge:" + f.node.id}, generation = 7 WHERE "robotId" = ${f.robot.id}`);
      r.lockOther = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = ${"edge:" + f.node2.id} WHERE "robotId" = ${f.robot.id}`);
      r.lockBogus = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = 'bogus' WHERE "robotId" = ${f.robot.id}`);
      r.lockInsUnowned = await maLoi(tx, (sp) => sp`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation, authority) VALUES (${f.robotBusy.id}, 'probe', 1, ${"edge:" + f.node.id})`);
      let reqId = null;
      r.reqLock = await maLoi(tx, async (sp) => {
        reqId = (await reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, kind: "lock" }))[0].id;
      });
      r.reqUnowned = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node2.id, kind: "lock" }));
      r.reqTwoTargets = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, adapterId: f.ad.id, edgeNodeId: f.node.id, kind: "stop" }));
      r.reqAdapterLock = await maLoi(tx, (sp) => reqIns(sp, { adapterId: f.ad.id, edgeNodeId: f.node.id, kind: "lock" }));
      r.reqAdapterStop = await maLoi(tx, (sp) => reqIns(sp, { adapterId: f.ad.id, edgeNodeId: f.node.id, kind: "stop" }));
      r.reqClearNoGen = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, kind: "clear" }));
      r.reqClearGen = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, kind: "clear", expectedGeneration: 7 }));
      r.reqBornDelivered = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, kind: "lock", deliveredAt: new Date() }));
      r.deliver1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() WHERE id = ${reqId}`);
      r.deliver2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() + interval '1 second' WHERE id = ${reqId}`);
      r.outcomeOnly = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET outcome = 'done' WHERE id = ${reqId}`);
      r.ack1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'done', "ackGeneration" = 8 WHERE id = ${reqId}`);
      r.ack2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET outcome = 'refused' WHERE id = ${reqId}`);
      r.reqIdentity = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET kind = 'clear' WHERE id = ${reqId}`);
      r.reqDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(REQ)} WHERE id = ${reqId}`);
      const hasPrg = (await tx`SELECT to_regclass('public.edge_node_program_reports') IS NOT NULL AS x`)[0].x;
      r.prgUnowned = hasPrg ? await maLoi(tx, (sp) => sp`INSERT INTO edge_node_program_reports ("edgeNodeId", "adapterId", status, checksum, "readAt") VALUES (${f.node2.id}, ${f.ad.id}, 'verified', 'x', now())`) : "23514";
      r.prgOwned = hasPrg ? await maLoi(tx, (sp) => sp`INSERT INTO edge_node_program_reports ("edgeNodeId", "adapterId", status, checksum, "readAt") VALUES (${f.node.id}, ${f.ad.id}, 'verified', 'x', now())`) : null;
      r.nodeDel = await maLoi(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${f.node2.id}`);
      return r;
    });
    expectExact("(b) avi_app behaviour", kq, {
      robotOwn: null, floorAfter: 6, robotHist: true, floorDown: "23514", robotBusy: "23514", adOwn: null, adBusy: "23514", bornHist: 1, adHist: 1,
      histIns: "42501", histUpd: "42501", histDel: "42501", lockOwner: null, lockOther: "23514", lockBogus: "23514", lockInsUnowned: "23514",
      reqLock: null, reqUnowned: "23514", reqTwoTargets: "23514", reqAdapterLock: "23514", reqAdapterStop: null, reqClearNoGen: "23514", reqClearGen: null,
      reqBornDelivered: "23514", deliver1: null, deliver2: "23514", outcomeOnly: "23514", ack1: null, ack2: "23514", reqIdentity: "42501", reqDel: "42501",
      prgUnowned: "23514", prgOwned: null, nodeDel: "23503",
    });
    const ko = await rolledBack(sql, async (tx) => {
      const f = await fixtures(tx, CODE + "-o");
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`;
      const [q] = await reqIns(tx, { robotId: f.robot.id, edgeNodeId: f.node.id, kind: "lock" });
      return {
        histUpd: await maLoi(tx, (sp) => sp`UPDATE ${sp(HIST)} SET "changedBy" = 'x' WHERE "deviceId" = ${f.robot.id}`),
        histDel: await maLoi(tx, (sp) => sp`DELETE FROM ${sp(HIST)} WHERE "deviceId" = ${f.robot.id}`),
        histTrunc: await maLoi(tx, (sp) => sp`TRUNCATE ${sp(HIST)}`),
        reqIdentity: await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "expiresAt" = "expiresAt" + interval '1 hour' WHERE id = ${q.id}`),
        reqLateGen: await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackGeneration" = 3 WHERE id = ${q.id}`),
      };
    });
    expectExact("(b) owner-level", ko, { histUpd: "23514", histDel: "23514", histTrunc: "23514", reqIdentity: "23514", reqLateGen: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    const [leftH] = await appSql`SELECT count(*)::int AS n FROM device_owner_changes WHERE "changedBy" LIKE ${"%" + CODE + "%"}`;
    if (left.n !== 0 || leftH.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} nodes / ${leftH.n} history rows left`);
    log(`(b) grants exact (${REQ} UPDATE ${JSON.stringify(upd)}, ${HIST} SELECT only); behaviour ${JSON.stringify(kq)}; owner-level ${JSON.stringify(ko)}; ROLLED BACK`);
  },
});
