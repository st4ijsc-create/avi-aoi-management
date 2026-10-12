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
 *       fix scan 2 (R-10-b, owner epoch): an owner change bumps ownerEpoch and LOCKS the robot under the new authority + epoch
 *       ('ownerChanged', generation = the raised floor); a manual epoch change ⇒ 23514; a lock write quoting a stale epoch ⇒
 *       23514, a stale clear deletes 0 rows; an authority text that disagrees with authorityNodeId ⇒ 23514; a request at a
 *       stale epoch ⇒ 23514 and a request whose device changed owner is never DELIVERED (23514); program reports carry the
 *       adapter's epoch; history carries from/to epochs; AS OWNER: a node deleted and RE-CREATED under the same id, owning the
 *       robot again, cannot write / clear with the old (authority, epoch);
 *       fix scan 2 (safety-lock bypass): avi_app cannot DELETE / UPDATE an edge-authority lock row, move a row between
 *       authorities, or write a central row of an edge-owned robot (23514); edge_motion_lock_apply / _clear work only on the
 *       matching (robot, node, epoch) with the generation check; central rows of central robots stay writable as before;
 *       lock requests: done before delivery / delivery in the future or before creation / ackGeneration on a non-done ack ⇒ 23514;
 *       fix review 1: R-10-e function hygiene (common runner); M2 apply below the floor ⇒ false; M1 a STOP for the old owner
 *       stays deliverable after an owner change and is carried to the new edge owner (one request, new epoch);
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0374.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const REQ = "robot_motion_lock_requests";
const HIST = "device_owner_changes";
const REQ_COLS = ["id", "robotId", "adapterId", "edgeNodeId", "ownerEpoch", "kind", "expectedGeneration", "reason", "requestedBy", "createdAt", "expiresAt", "deliveredAt", "ackedAt", "ackGeneration", "outcome"];
const HIST_COLS = ["id", "deviceKind", "deviceId", "fromEdgeNodeId", "toEdgeNodeId", "generationFloor", "fromOwnerEpoch", "toOwnerEpoch", "changedBy", "changedAt"];
const TRIGGERS = [
  "trg_robots_owner_change", "trg_robots_owner_insert", "trg_robots_owner_relock", "trg_adapters_owner_change", "trg_adapters_owner_insert", "trg_device_owner_changes_worm",
  "trg_device_owner_changes_worm_truncate", "trg_robot_motion_lock_authority", "trg_robot_motion_lock_write_guard", "trg_edge_program_owned", "trg_robot_motion_lock_request_guard",
  "trg_robots_owner_stop_carry", "trg_adapters_owner_stop_carry", // fix review 1 (M1)
  "trg_robot_motion_lock_request_keep_stop", "trg_robots_keep_pending_stop", "trg_adapters_keep_pending_stop", // fix review 2 (R-10-i)
  "trg_edge_stop_ack_refusals_worm", "trg_edge_stop_ack_refusals_worm_truncate", // fix review 4 (R-10-ah)
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
  sp`INSERT INTO ${sp(REQ)} ("robotId", "adapterId", "edgeNodeId", "ownerEpoch", kind, "expectedGeneration", reason, "requestedBy", "expiresAt", "deliveredAt")
     VALUES (${o.robotId ?? null}, ${o.adapterId ?? null}, ${o.edgeNodeId}, ${o.ownerEpoch ?? 1}, ${o.kind}, ${o.expectedGeneration ?? null}, 'probe', 5, now() + interval '1 minute', ${o.deliveredAt ?? null}) RETURNING id`;
const apply = (sp, robot, node, epoch, gen) => sp`SELECT edge_motion_lock_apply(${robot}, ${node}, ${epoch}::bigint, ${gen}, 'probe', NULL) AS ok`;
const clear = (sp, robot, node, epoch, gen) => sp`SELECT edge_motion_lock_clear(${robot}, ${node}, ${epoch}::bigint, ${gen}) AS n`;
const epochOf = async (tx, t, id) => Number((await tx`SELECT "ownerEpoch" AS e FROM ${tx(t)} WHERE id = ${id}`)[0].e);

await runMigration({
  file: "0374_edge_device_ownership_and_lock_authority.sql",
  tag: "[0374]",
  async verify({ sql, appSql, log }) {
    // (a)
    const col = async (t, c) => (await appSql`SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_name = ${t} AND column_name = ${c}`)[0];
    const want = [
      ["robots", "edgeNodeId", "integer", "YES"], ["device_adapters", "edgeNodeId", "integer", "YES"],
      ["robots", "motionLockGenerationFloor", "integer", "NO"], ["robot_motion_locks", "authority", "character varying", "NO"],
      ["robots", "ownerEpoch", "bigint", "NO"], ["device_adapters", "ownerEpoch", "bigint", "NO"], ["robot_motion_locks", "authorityNodeId", "integer", "YES"],
      ["robot_motion_locks", "ownerEpoch", "bigint", "YES"], ["edge_node_program_reports", "ownerEpoch", "bigint", "YES"], [REQ, "ownerEpoch", "bigint", "NO"],
    ];
    for (const [t, c, ty, n] of want) {
      const x = await col(t, c);
      if (!x || x.t !== ty || x.n !== n) throw new Error(`(a) ${t}.${c}: ${JSON.stringify(x)}`);
    }
    if (!/central/.test(String((await col("robot_motion_locks", "authority")).d))) throw new Error("(a) authority default");
    for (const fk of ["fk_robots_edge_node", "fk_device_adapters_edge_node", "fk_robot_motion_locks_authority_node"]) {
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
    const [sd] = await appSql`SELECT bool_and(prosecdef) AS d FROM pg_proc WHERE proname IN ('device_owner_change_guard', 'device_owner_insert_log', 'robot_owner_relock', 'edge_motion_lock_apply', 'edge_motion_lock_clear', 'device_owner_stop_carry', 'edge_stop_ack_central')`;
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
      r.centralRowEpoch = Number((await tx`SELECT "ownerEpoch" AS e FROM robot_motion_locks WHERE "robotId" = ${f.robot.id}`)[0].e);
      r.robotOwn = await maLoi(tx, (sp) => sp`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`);
      const [rf] = await tx`SELECT "motionLockGenerationFloor" AS f, "ownerEpoch" AS e FROM robots WHERE id = ${f.robot.id}`;
      r.floorAfter = rf.f;
      r.epochAfter = Number(rf.e);
      const [lk] = await tx`SELECT authority, "authorityNodeId" AS n, "ownerEpoch" AS e, generation AS g, "reasonCode" AS rc FROM robot_motion_locks WHERE "robotId" = ${f.robot.id}`;
      r.relocked = lk.authority === "edge:" + f.node.id && lk.n === f.node.id && Number(lk.e) === 2 && lk.g === 6 && lk.rc === "ownerChanged";
      const hist = await tx`SELECT "fromEdgeNodeId" AS fr, "toEdgeNodeId" AS t, "generationFloor" AS g, "fromOwnerEpoch" AS fe, "toOwnerEpoch" AS te, "changedBy" AS by FROM ${tx(HIST)} WHERE "deviceKind" = 'robot' AND "deviceId" = ${f.robot.id}`;
      r.robotHist = hist.length === 1 && hist[0].fr === null && hist[0].t === f.node.id && hist[0].g === 6 && Number(hist[0].fe) === 1 && Number(hist[0].te) === 2 && hist[0].by === "probe:" + CODE;
      r.epochManual = await maLoi(tx, (sp) => sp`UPDATE robots SET "ownerEpoch" = 9 WHERE id = ${f.robot.id}`);
      r.floorDown = await maLoi(tx, (sp) => sp`UPDATE robots SET "motionLockGenerationFloor" = 0 WHERE id = ${f.robot.id}`);
      await tx`INSERT INTO robot_jobs ("robotId", "jobType", status) VALUES (${f.robotBusy.id}, 'move', 'running')`;
      r.robotBusy = await maLoi(tx, (sp) => sp`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robotBusy.id}`);
      r.adOwn = await maLoi(tx, (sp) => sp`UPDATE device_adapters SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.ad.id}`);
      r.adEpoch = await epochOf(tx, "device_adapters", f.ad.id);
      await tx`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status) VALUES (${f.adBusy.id}, 1, 1, 'sent')`;
      r.adBusy = await maLoi(tx, (sp) => sp`UPDATE device_adapters SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.adBusy.id}`);
      const [born] = await tx`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${CODE + "-born"}, ${CODE}, 'sim', 'sim://probe', ${f.node2.id}) RETURNING id`;
      const [bh] = await tx`SELECT count(*)::int AS n FROM ${tx(HIST)} WHERE "deviceKind" = 'robot' AND "deviceId" = ${born.id} AND "toEdgeNodeId" = ${f.node2.id} AND "toOwnerEpoch" = 1`;
      r.bornHist = bh.n;
      const [ah] = await tx`SELECT count(*)::int AS n FROM ${tx(HIST)} WHERE "deviceKind" = 'adapter' AND "deviceId" = ${f.ad.id}`;
      r.adHist = ah.n;
      r.histIns = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(HIST)} ("deviceKind", "deviceId", "changedBy") VALUES ('adapter', 1, 'forged')`);
      r.histUpd = await maLoi(tx, (sp) => sp`UPDATE ${sp(HIST)} SET "changedBy" = 'x' WHERE "deviceId" = ${f.robot.id}`);
      r.histDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(HIST)} WHERE "deviceId" = ${f.robot.id}`);
      r.lockOwner = (await apply(tx, f.robot.id, f.node.id, 2, 7))[0].ok;
      r.lockLowerGen = (await apply(tx, f.robot.id, f.node.id, 2, 3))[0].ok;
      r.lockStaleEpoch = await maLoi(tx, (sp) => apply(sp, f.robot.id, f.node.id, 1, 8));
      r.lockOther = await maLoi(tx, (sp) => apply(sp, f.robot.id, f.node2.id, 2, 8));
      r.directEdgeUpdate = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET generation = 99 WHERE "robotId" = ${f.robot.id}`);
      r.directEdgeDelete = await maLoi(tx, (sp) => sp`DELETE FROM robot_motion_locks WHERE "robotId" = ${f.robot.id}`);
      r.directMoveCentral = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = 'central', "authorityNodeId" = NULL WHERE "robotId" = ${f.robot.id}`);
      r.lockTextMismatch = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = ${"edge:" + f.node2.id} WHERE "robotId" = ${f.robot.id}`);
      r.lockBogus = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET authority = 'bogus', "authorityNodeId" = NULL WHERE "robotId" = ${f.robot.id}`);
      r.lockInsUnowned = await maLoi(tx, (sp) => sp`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation, authority, "authorityNodeId", "ownerEpoch") VALUES (${f.robotBusy.id}, 'probe', 1, ${"edge:" + f.node.id}, ${f.node.id}, 1)`);
      r.centralDirect = await maLoi(tx, async (sp) => {
        await sp`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation) VALUES (${f.robotBusy.id}, 'probe', 2)`;
        await sp`UPDATE robot_motion_locks SET generation = 3 WHERE "robotId" = ${f.robotBusy.id}`;
        await sp`DELETE FROM robot_motion_locks WHERE "robotId" = ${f.robotBusy.id} AND generation <= 3`;
      });
      // away and back to the SAME node: epoch 2 → 3 → 4; the old (authority, epoch 2) can neither write nor clear
      await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${f.robot.id}`;
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`;
      r.epochBack = await epochOf(tx, "robots", f.robot.id);
      r.staleAfterReturn = await maLoi(tx, (sp) => apply(sp, f.robot.id, f.node.id, 2, 100));
      r.staleClearDeleted = (await clear(tx, f.robot.id, f.node.id, 2, 100))[0].n;
      const [g4] = await tx`SELECT generation AS g FROM robot_motion_locks WHERE "robotId" = ${f.robot.id}`;
      r.clearLowGen = (await clear(tx, f.robot.id, f.node.id, 4, g4.g - 1))[0].n;
      r.clearCurrent = (await clear(tx, f.robot.id, f.node.id, 4, g4.g))[0].n;
      r.centralRowOnEdgeRobot = await maLoi(tx, (sp) => sp`INSERT INTO robot_motion_locks ("robotId", "reasonCode", generation) VALUES (${f.robot.id}, 'probe', 50)`);
      r.reapply = (await apply(tx, f.robot.id, f.node.id, 4, g4.g + 1))[0].ok;
      let reqId = null;
      r.reqLock = await maLoi(tx, async (sp) => {
        reqId = (await reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "lock" }))[0].id;
      });
      r.reqStaleEpoch = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 2, kind: "lock" }));
      r.reqUnowned = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node2.id, ownerEpoch: 4, kind: "lock" }));
      r.reqTwoTargets = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, adapterId: f.ad.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "stop" }));
      r.reqAdapterLock = await maLoi(tx, (sp) => reqIns(sp, { adapterId: f.ad.id, edgeNodeId: f.node.id, ownerEpoch: 2, kind: "lock" }));
      r.reqAdapterStop = await maLoi(tx, (sp) => reqIns(sp, { adapterId: f.ad.id, edgeNodeId: f.node.id, ownerEpoch: 2, kind: "stop" }));
      r.reqClearNoGen = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "clear" }));
      r.reqClearGen = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "clear", expectedGeneration: 7 }));
      r.reqBornDelivered = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "lock", deliveredAt: new Date() }));
      r.deliver1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() WHERE id = ${reqId}`);
      r.deliver2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() + interval '1 second' WHERE id = ${reqId}`);
      const [q2] = await reqIns(tx, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "lock" });
      r.doneUndelivered = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'done' WHERE id = ${q2.id}`);
      r.deliverFuture = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() + interval '1 hour' WHERE id = ${q2.id}`);
      r.deliverBeforeCreate = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = "createdAt" - interval '1 second' WHERE id = ${q2.id}`);
      await tx`UPDATE ${tx(REQ)} SET "deliveredAt" = now() WHERE id = ${q2.id}`;
      r.genOnRefused = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'refused', "ackGeneration" = 3 WHERE id = ${q2.id}`);
      r.expireDeliveredEarly = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'expired' WHERE id = ${q2.id}`);
      r.outcomeOnly = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET outcome = 'done' WHERE id = ${reqId}`);
      r.ack1 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'done', "ackGeneration" = 8 WHERE id = ${reqId}`);
      r.ack2 = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET outcome = 'refused' WHERE id = ${reqId}`);
      r.reqIdentity = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET kind = 'clear' WHERE id = ${reqId}`);
      r.reqDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(REQ)} WHERE id = ${reqId}`);
      // a request for a device that then changes owner is never delivered
      const [bornReq] = await reqIns(tx, { robotId: born.id, edgeNodeId: f.node2.id, ownerEpoch: 1, kind: "lock" });
      await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${born.id}`;
      r.deliverStale = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() WHERE id = ${bornReq.id}`);
      r.expireStale = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackedAt" = now(), outcome = 'expired' WHERE id = ${bornReq.id}`);
      const hasPrg = (await tx`SELECT to_regclass('public.edge_node_program_reports') IS NOT NULL AS x`)[0].x;
      r.prgUnowned = hasPrg ? await maLoi(tx, (sp) => sp`INSERT INTO edge_node_program_reports ("edgeNodeId", "adapterId", status, checksum, "readAt") VALUES (${f.node2.id}, ${f.ad.id}, 'verified', 'x', now())`) : "23514";
      r.prgOwned = hasPrg ? await maLoi(tx, (sp) => sp`INSERT INTO edge_node_program_reports ("edgeNodeId", "adapterId", status, checksum, "readAt", "ownerEpoch") VALUES (${f.node.id}, ${f.ad.id}, 'verified', 'x', now(), 99)`) : null;
      r.prgEpoch = hasPrg ? Number((await tx`SELECT "ownerEpoch" AS e FROM edge_node_program_reports WHERE "adapterId" = ${f.ad.id}`)[0]?.e ?? -1) : 2;
      r.nodeDel = await maLoi(tx, (sp) => sp`DELETE FROM edge_nodes WHERE id = ${f.node.id}`);
      // fix review 1 (M2): below the floor ⇒ nothing applied / cleared
      const [fl] = await tx`SELECT "motionLockGenerationFloor" AS f FROM robots WHERE id = ${f.robot.id}`;
      r.applyBelowFloor = (await apply(tx, f.robot.id, f.node.id, 4, fl.f - 1))[0].ok;
      // fix review 1 (M1, L-7): a STOP for the old owner stays deliverable and is carried to the new edge owner
      const [stopReq] = await reqIns(tx, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 4, kind: "stop" });
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node2.id} WHERE id = ${f.robot.id}`; // epoch 5
      r.stopStaleDeliver = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "deliveredAt" = now() WHERE id = ${stopReq.id}`);
      const [cr] = await tx`SELECT count(*)::int AS n FROM ${tx(REQ)} WHERE "robotId" = ${f.robot.id} AND "edgeNodeId" = ${f.node2.id} AND "ownerEpoch" = 5 AND kind = 'stop'`;
      r.stopCarried = cr.n;
      return r;
    });
    expectExact("(b) avi_app behaviour", kq, {
      centralRowEpoch: 1, robotOwn: null, floorAfter: 6, epochAfter: 2, relocked: true, robotHist: true, epochManual: "23514", floorDown: "23514",
      robotBusy: "23514", adOwn: null, adEpoch: 2, adBusy: "23514", bornHist: 1, adHist: 1,
      histIns: "42501", histUpd: "42501", histDel: "42501", lockOwner: true, lockLowerGen: false, lockStaleEpoch: "23514", lockOther: "23514",
      directEdgeUpdate: "23514", directEdgeDelete: "23514", directMoveCentral: "23514", lockTextMismatch: "23514",
      lockBogus: "23514", lockInsUnowned: "23514", centralDirect: null, epochBack: 4, staleAfterReturn: "23514", staleClearDeleted: 0,
      clearLowGen: 0, clearCurrent: 1, centralRowOnEdgeRobot: "23514", reapply: true,
      doneUndelivered: "23514", deliverFuture: "23514", deliverBeforeCreate: "23514", genOnRefused: "23514", expireDeliveredEarly: "23514",
      reqLock: null, reqStaleEpoch: "23514", reqUnowned: "23514", reqTwoTargets: "23514", reqAdapterLock: "23514", reqAdapterStop: null, reqClearNoGen: "23514",
      reqClearGen: null, reqBornDelivered: "23514", deliver1: null, deliver2: "23514", outcomeOnly: "23514", ack1: null, ack2: "23514", reqIdentity: "42501",
      reqDel: "42501", deliverStale: "23514", expireStale: null, prgUnowned: "23514", prgOwned: null, prgEpoch: 2,
      nodeDel: "23514", // fix review 2 (R-10-i (d)): the node still has an UNACKED STOP (reqAdapterStop) ⇒ refused before the RESTRICT FK
      applyBelowFloor: false, stopStaleDeliver: null, stopCarried: 1,
    });
    const ko = await rolledBack(sql, async (tx) => {
      const f = await fixtures(tx, CODE + "-o");
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`;
      const [q] = await reqIns(tx, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 2, kind: "lock" });
      const reqIdentity = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "expiresAt" = "expiresAt" + interval '1 hour' WHERE id = ${q.id}`);
      const reqLateGen = await maLoi(tx, (sp) => sp`UPDATE ${sp(REQ)} SET "ackGeneration" = 3 WHERE id = ${q.id}`);
      // R-10-b — a node deleted and RE-CREATED under the SAME id, owning the robot again, never inherits the old authority
      await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${f.robot.id}`; // epoch 3, row central
      await tx`DELETE FROM ${tx(REQ)} WHERE "edgeNodeId" = ${f.node.id}`;
      await tx`DELETE FROM edge_nodes WHERE id = ${f.node.id}`;
      await tx`INSERT INTO edge_nodes (id, code, name, status) VALUES (${f.node.id}, ${CODE + "-o-reused"}, ${CODE}, 'offline')`;
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`; // epoch 4, row edge:N epoch 4
      const reusedStaleWrite = await maLoi(tx, (sp) => sp`UPDATE robot_motion_locks SET "ownerEpoch" = 2, generation = generation + 1 WHERE "robotId" = ${f.robot.id}`);
      const reusedStaleClear = (await tx`DELETE FROM robot_motion_locks WHERE "robotId" = ${f.robot.id} AND authority = ${"edge:" + f.node.id} AND "ownerEpoch" = 2 RETURNING 1`).length;
      const reusedStaleReq = await maLoi(tx, (sp) => reqIns(sp, { robotId: f.robot.id, edgeNodeId: f.node.id, ownerEpoch: 2, kind: "lock" }));
      return {
        reusedStaleWrite,
        reusedStaleClear,
        reusedStaleReq,
        histUpd: await maLoi(tx, (sp) => sp`UPDATE ${sp(HIST)} SET "changedBy" = 'x' WHERE "deviceId" = ${f.robot.id}`),
        histDel: await maLoi(tx, (sp) => sp`DELETE FROM ${sp(HIST)} WHERE "deviceId" = ${f.robot.id}`),
        histTrunc: await maLoi(tx, (sp) => sp`TRUNCATE ${sp(HIST)}`),
        reqIdentity,
        reqLateGen,
      };
    });
    expectExact("(b) owner-level", ko, { reusedStaleWrite: "23514", reusedStaleClear: 0, reusedStaleReq: "23514", histUpd: "23514", histDel: "23514", histTrunc: "23514", reqIdentity: "23514", reqLateGen: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    const [leftH] = await appSql`SELECT count(*)::int AS n FROM device_owner_changes WHERE "changedBy" LIKE ${"%" + CODE + "%"}`;
    if (left.n !== 0 || leftH.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} nodes / ${leftH.n} history rows left`);
    log(`(b) grants exact (${REQ} UPDATE ${JSON.stringify(upd)}, ${HIST} SELECT only); behaviour ${JSON.stringify(kq)}; owner-level ${JSON.stringify(ko)}; ROLLED BACK`);
  },
});
