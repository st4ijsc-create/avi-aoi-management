#!/usr/bin/env node
/**
 * 0375 — doc 81 Đợt 10 task A (owner D6: plain by default, trusted only after a MAKER-CHECKER approval per (node, robot)):
 * `edge_robot_trust_approvals` + the 'edge_robot_telemetry' origin on safety_event_trust. Applies
 * `drizzle/0375_edge_robot_trust_approvals.sql` as owner `aoi`, then VERIFIES as `avi_app` (pattern 0368 / 0371):
 *   (a) the table, its 4 CHECKs, the trigger, the comment; safety_event_trust's origin CHECK lists the three origins;
 *   (b) grants (catalog — EXACT): SELECT / INSERT; column UPDATE exactly (digest, editedBy, editedAt, approvedBy, approvedAt);
 *       no DELETE / TRUNCATE; then BEHAVIOUR in an ALWAYS-rolled-back transaction: a request for an owned robot ⇒ ok, for an
 *       unowned robot ⇒ 23514, pre-approved ⇒ 23514; approval by the maker ⇒ 23514; by another admin ⇒ ok; approver swap ⇒
 *       23514; an edit (digest) keeping the approval ⇒ 23514; an edit clearing it ⇒ ok; approvedBy without approvedAt ⇒
 *       23514; the key ⇒ 42501; DELETE ⇒ 42501; a safety_event_trust row with origin 'edge_robot_telemetry' ⇒ ok, 'edge' ⇒
 *       23514; 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0375.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const T = "edge_robot_trust_approvals";
const COLS = ["edgeNodeId", "robotId", "digest", "editedBy", "editedAt", "approvedBy", "approvedAt"];
const H = (c) => c.repeat(64);

await runMigration({
  file: "0375_edge_robot_trust_approvals.sql",
  tag: "[0375]",
  async verify({ appSql, log }) {
    const have = await columnsOf(appSql, T);
    for (const c of COLS) if (!have.includes(c)) throw new Error(`(a) ${T}.${c} missing`);
    const cks = (await appSql`SELECT conname FROM pg_constraint WHERE conrelid = ${"public." + T}::regclass AND contype = 'c'`).map((r) => r.conname).sort();
    if (JSON.stringify(cks) !== JSON.stringify(["ck_edge_robot_trust_actors", "ck_edge_robot_trust_approved", "ck_edge_robot_trust_digest", "ck_edge_robot_trust_sod"])) throw new Error(`(a) CHECKs: ${JSON.stringify(cks)}`);
    const trg = await appSql`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname = 'trg_edge_robot_trust_guard'`;
    if (trg.length !== 1) throw new Error("(a) trigger missing");
    const [ct] = await appSql`SELECT obj_description(${"public." + T}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 10 A \(0375/.test(ct.c)) throw new Error("(a) comment missing");
    const [oc] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ck_safety_event_trust_origin'`;
    if (!oc || !/edge_robot_telemetry/.test(oc.d) || !/robot_telemetry'::/.test(oc.d) || !/safety_plc/.test(oc.d)) throw new Error(`(a) origin CHECK: ${oc?.d}`);
    log(`(a) ${T} (${COLS.length} cols, CHECKs ${cks.length}, trigger 1); safety_event_trust origins + edge_robot_telemetry`);
    const p = await tablePriv(appSql, T);
    if (!p.sel || !p.ins || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) table grants not exact: ${JSON.stringify(p)}`);
    const upd = await updatableCols(appSql, T, COLS);
    if (JSON.stringify(upd) !== JSON.stringify(["approvedAt", "approvedBy", "digest", "editedAt", "editedBy"])) throw new Error(`(b) column UPDATE: ${JSON.stringify(upd)}`);
    const CODE = `__probe_0375_${Date.now()}`;
    const kq = await rolledBack(appSql, async (tx) => {
      const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE}, ${CODE}, 'offline') RETURNING id`;
      const [node2] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${CODE + "-2"}, ${CODE}, 'offline') RETURNING id`;
      const [robot] = await tx`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${CODE + "-r"}, ${CODE}, 'sim', 'sim://probe', ${node.id}) RETURNING id`;
      const key = (sp) => sp`"edgeNodeId" = ${node.id} AND "robotId" = ${robot.id}`;
      const r = {};
      r.request = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(T)} ("edgeNodeId", "robotId", digest, "editedBy") VALUES (${node.id}, ${robot.id}, ${H("a")}, 10)`);
      r.unowned = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(T)} ("edgeNodeId", "robotId", digest, "editedBy") VALUES (${node2.id}, ${robot.id}, ${H("a")}, 10)`);
      r.preApproved = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(T)} ("edgeNodeId", "robotId", digest, "editedBy", "approvedBy", "approvedAt") VALUES (${node2.id}, ${robot.id}, ${H("a")}, 10, 11, now())`);
      r.selfApprove = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = 10, "approvedAt" = now() WHERE ${key(sp)}`);
      r.halfApprove = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = 11 WHERE ${key(sp)}`);
      r.approve = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = 11, "approvedAt" = now() WHERE ${key(sp)}`);
      r.swap = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = 12 WHERE ${key(sp)}`);
      r.editKeep = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET digest = ${H("b")} WHERE ${key(sp)}`);
      r.editClear = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET digest = ${H("b")}, "editedBy" = 11, "editedAt" = now(), "approvedBy" = NULL, "approvedAt" = NULL WHERE ${key(sp)}`);
      r.badDigest = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET digest = 'nothex' WHERE ${key(sp)}`);
      r.keyChange = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "robotId" = ${robot.id} + 1 WHERE ${key(sp)}`);
      r.del = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(T)} WHERE ${key(sp)}`);
      const [ev] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'robot', 'advisory', ${CODE}) RETURNING id`;
      r.originEdge = await maLoi(tx, (sp) => sp`INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest) VALUES (${ev.id}, 'edge_robot_telemetry', 'estop', ${H("c")})`);
      const [ev2] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'robot', 'advisory', ${CODE}) RETURNING id`;
      r.originBogus = await maLoi(tx, (sp) => sp`INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest) VALUES (${ev2.id}, 'edge', 'estop', ${H("c")})`);
      return r;
    });
    expectExact("(b) avi_app behaviour", kq, {
      request: null, unowned: "23514", preApproved: "23514", selfApprove: "23514", halfApprove: "23514", approve: null, swap: "23514", editKeep: "23514",
      editClear: null, badDigest: "23514", keyChange: "42501", del: "42501", originEdge: null, originBogus: "23514",
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    const [leftE] = await appSql`SELECT count(*)::int AS n FROM safety_events WHERE notes = ${CODE}`;
    if (left.n !== 0 || leftE.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} nodes / ${leftE.n} events left`);
    log(`(b) grants exact (UPDATE ${JSON.stringify(upd)}); behaviour ${JSON.stringify(kq)}; ROLLED BACK`);
  },
});
