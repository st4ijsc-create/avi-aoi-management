#!/usr/bin/env node
/**
 * 0375 — doc 81 Đợt 10 task A (owner D6: plain by default, trusted only after a MAKER-CHECKER approval per (node, robot)):
 * `edge_robot_trust_approvals` + the 'edge_robot_telemetry' origin on safety_event_trust; fix scan 2 (R-8-a lessons in the DB,
 * R-10-b owner epoch). Applies `drizzle/0375_edge_robot_trust_approvals.sql` as owner `aoi`, then VERIFIES as `avi_app`:
 *   (a) the table (11 cols), its 7 CHECKs, the trigger, the 4 guarded functions (SECURITY DEFINER), the comment; the origin CHECK;
 *   (b) grants (catalog — EXACT): avi_app SELECT only on the table (no INSERT / UPDATE / DELETE / TRUNCATE), EXECUTE on the 4
 *       functions; then BEHAVIOUR in an ALWAYS-rolled-back transaction (fixture users created inside it):
 *       direct INSERT / UPDATE ⇒ 42501; request by user 0 / a non-user ⇒ 23514; request for an unowned robot ⇒ 23514;
 *       approve by the creator / by a later editor / by a non-admin / an inactive admin / user 0 ⇒ 23514; approve against a
 *       digest other than the one shown ⇒ 23514; approve by an outside admin ⇒ ok and is_approved(digest) = true, is_approved(
 *       other digest) = false; a second approval ⇒ 23514; a new request (digest change) clears it (is_approved false) and the
 *       requester joins the editors; the robot changing owner (away and back) ⇒ is_approved false and approval refused until
 *       re-requested; revoke ⇒ false; a safety_event_trust row with origin 'edge_robot_telemetry' ⇒ ok, 'edge' ⇒ 23514;
 *       AS OWNER (the trigger itself): pre-approved insert, approval with a digest edit in the same write, approver among the
 *       editors, approval not bound to the digest, approver swap ⇒ 23514; a digest edit clears the approval; 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0375.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const T = "edge_robot_trust_approvals";
const COLS = ["edgeNodeId", "robotId", "digest", "ownerEpoch", "editedBy", "editedAt", "editorsSinceApproval", "approvedBy", "approvedAt", "approvedDigest", "approvedOwnerEpoch"];
const FNS = ["edge_robot_trust_request", "edge_robot_trust_approve", "edge_robot_trust_revoke", "edge_robot_trust_is_approved"];
const H = (c) => c.repeat(64);

async function fixtures(tx, code) {
  const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code}, ${code}, 'offline') RETURNING id`;
  const [node2] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code + "-2"}, ${code}, 'offline') RETURNING id`;
  const [robot] = await tx`INSERT INTO robots (code, name, vendor, endpoint, "edgeNodeId") VALUES (${code + "-r"}, ${code}, 'sim', 'sim://probe', ${node.id}) RETURNING id`;
  const u = async (tag, role, active = true) => (await tx`INSERT INTO users ("openId", role, "isActive") VALUES (${code + tag}, ${role}, ${active}) RETURNING id`)[0].id;
  return { node, node2, robot, maker: await u("-maker", "admin"), editor2: await u("-ed2", "admin"), admin: await u("-adm", "admin"), plain: await u("-plain", "user"), inactive: await u("-off", "admin", false) };
}

await runMigration({
  file: "0375_edge_robot_trust_approvals.sql",
  tag: "[0375]",
  async verify({ sql, appSql, log }) {
    const have = await columnsOf(appSql, T);
    for (const c of COLS) if (!have.includes(c)) throw new Error(`(a) ${T}.${c} missing`);
    const cks = (await appSql`SELECT conname FROM pg_constraint WHERE conrelid = ${"public." + T}::regclass AND contype = 'c'`).map((r) => r.conname).sort();
    const wantCks = ["ck_edge_robot_trust_actors", "ck_edge_robot_trust_approved", "ck_edge_robot_trust_binding", "ck_edge_robot_trust_digest", "ck_edge_robot_trust_editors", "ck_edge_robot_trust_epoch", "ck_edge_robot_trust_sod"];
    if (JSON.stringify(cks) !== JSON.stringify(wantCks)) throw new Error(`(a) CHECKs: ${JSON.stringify(cks)}`);
    const trg = await appSql`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname = 'trg_edge_robot_trust_guard'`;
    if (trg.length !== 1) throw new Error("(a) trigger missing");
    const fns = await appSql`SELECT proname, prosecdef FROM pg_proc WHERE proname = ANY(${FNS})`;
    if (fns.length !== 4 || !fns.every((f) => f.prosecdef)) throw new Error(`(a) guarded functions: ${JSON.stringify(fns)}`);
    const [ct] = await appSql`SELECT obj_description(${"public." + T}::regclass, 'pg_class') AS c`;
    if (!ct?.c || !/Dot 10 A \(0375/.test(ct.c)) throw new Error("(a) comment missing");
    const [oc] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ck_safety_event_trust_origin'`;
    if (!oc || !/edge_robot_telemetry/.test(oc.d) || !/robot_telemetry'::/.test(oc.d) || !/safety_plc/.test(oc.d)) throw new Error(`(a) origin CHECK: ${oc?.d}`);
    log(`(a) ${T} (${COLS.length} cols, CHECKs ${cks.length}, trigger 1, guarded functions 4 SECURITY DEFINER); origin + edge_robot_telemetry`);
    const p = await tablePriv(appSql, T);
    if (!p.sel || p.ins || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) table grants not exact (SELECT only): ${JSON.stringify(p)}`);
    for (const f of FNS) {
      const [e] = await appSql`SELECT bool_or(has_function_privilege(oid, 'EXECUTE')) AS x FROM pg_proc WHERE proname = ${f}`;
      if (!e?.x) throw new Error(`(b) EXECUTE ${f} missing`);
    }
    const CODE = `__probe_0375_${Date.now()}`;
    const kq = await rolledBack(appSql, async (tx) => {
      const f = await fixtures(tx, CODE);
      const req = (sp, digest, editor, node = f.node.id, robot = f.robot.id) => sp`SELECT edge_robot_trust_request(${node}, ${robot}, ${digest}, ${editor})`;
      const appr = (sp, digest, who) => sp`SELECT edge_robot_trust_approve(${f.node.id}, ${f.robot.id}, ${digest}, ${who})`;
      const isOk = async (digest) => (await tx`SELECT edge_robot_trust_is_approved(${f.node.id}, ${f.robot.id}, ${digest}) AS ok`)[0].ok;
      const r = {};
      r.directInsert = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(T)} ("edgeNodeId", "robotId", digest, "ownerEpoch", "editedBy") VALUES (${f.node.id}, ${f.robot.id}, ${H("a")}, 1, ${f.maker})`);
      r.requestUser0 = await maLoi(tx, (sp) => req(sp, H("a"), 0));
      r.requestNonUser = await maLoi(tx, (sp) => req(sp, H("a"), 2_000_000_000));
      r.requestUnowned = await maLoi(tx, (sp) => req(sp, H("a"), f.maker, f.node2.id));
      r.request = await maLoi(tx, (sp) => req(sp, H("a"), f.maker));
      r.directUpdate = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = ${f.admin}, "approvedAt" = now() WHERE "robotId" = ${f.robot.id}`);
      r.approveByCreator = await maLoi(tx, (sp) => appr(sp, H("a"), f.maker));
      r.edit2 = await maLoi(tx, (sp) => req(sp, H("a"), f.editor2)); // a later editor (an admin)
      r.approveByLaterEditor = await maLoi(tx, (sp) => appr(sp, H("a"), f.editor2));
      r.approveByNonAdmin = await maLoi(tx, (sp) => appr(sp, H("a"), f.plain));
      r.approveByInactive = await maLoi(tx, (sp) => appr(sp, H("a"), f.inactive));
      r.approveByUser0 = await maLoi(tx, (sp) => appr(sp, H("a"), 0));
      r.approveOtherDigest = await maLoi(tx, (sp) => appr(sp, H("b"), f.admin));
      r.approve = await maLoi(tx, (sp) => appr(sp, H("a"), f.admin));
      r.isApproved = await isOk(H("a"));
      r.isApprovedOtherDigest = await isOk(H("b"));
      r.approveAgain = await maLoi(tx, (sp) => appr(sp, H("a"), f.admin));
      const [row1] = await tx`SELECT "editorsSinceApproval" AS e FROM ${tx(T)} WHERE "robotId" = ${f.robot.id}`;
      r.editorsBefore = [...row1.e].sort((a, b) => a - b).join(",") === [f.maker, f.editor2].sort((a, b) => a - b).join(",");
      r.reRequest = await maLoi(tx, (sp) => req(sp, H("c"), f.editor2));
      r.afterDigestChange = await isOk(H("a"));
      const [row2] = await tx`SELECT "editorsSinceApproval" AS e, "approvedBy" AS a FROM ${tx(T)} WHERE "robotId" = ${f.robot.id}`;
      r.editorsReset = row2.e.length === 1 && row2.e[0] === f.editor2 && row2.a === null;
      r.approveC = await maLoi(tx, (sp) => appr(sp, H("c"), f.admin));
      r.isApprovedC = await isOk(H("c"));
      await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${f.robot.id}`;
      await tx`UPDATE robots SET "edgeNodeId" = ${f.node.id} WHERE id = ${f.robot.id}`;
      r.afterOwnerChange = await isOk(H("c"));
      r.revoke = await maLoi(tx, (sp) => sp`SELECT edge_robot_trust_revoke(${f.node.id}, ${f.robot.id}, ${f.admin})`);
      r.approveStaleEpoch = await maLoi(tx, (sp) => appr(sp, H("c"), f.admin));
      r.reRequestEpoch = await maLoi(tx, (sp) => req(sp, H("c"), f.maker));
      r.approveCurrentEpoch = await maLoi(tx, (sp) => appr(sp, H("c"), f.admin));
      r.isApprovedNow = await isOk(H("c"));
      r.revoke2 = await maLoi(tx, (sp) => sp`SELECT edge_robot_trust_revoke(${f.node.id}, ${f.robot.id}, ${f.admin})`);
      r.afterRevoke = await isOk(H("c"));
      const [ev] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'robot', 'advisory', ${CODE}) RETURNING id`;
      r.originEdge = await maLoi(tx, (sp) => sp`INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest) VALUES (${ev.id}, 'edge_robot_telemetry', 'estop', ${H("c")})`);
      const [ev2] = await tx`INSERT INTO safety_events ("eventType", "detectedBy", "handledBy", notes) VALUES ('estop', 'robot', 'advisory', ${CODE}) RETURNING id`;
      r.originBogus = await maLoi(tx, (sp) => sp`INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest) VALUES (${ev2.id}, 'edge', 'estop', ${H("c")})`);
      return r;
    });
    expectExact("(b) avi_app behaviour", kq, {
      directInsert: "42501", requestUser0: "23514", requestNonUser: "23514", requestUnowned: "23514", request: null, directUpdate: "42501",
      approveByCreator: "23514", edit2: null, approveByLaterEditor: "23514", approveByNonAdmin: "23514", approveByInactive: "23514", approveByUser0: "23514",
      approveOtherDigest: "23514", approve: null, isApproved: true, isApprovedOtherDigest: false, approveAgain: "23514", editorsBefore: true,
      reRequest: null, afterDigestChange: false, editorsReset: true, approveC: null, isApprovedC: true, afterOwnerChange: false, revoke: null,
      approveStaleEpoch: "23514", reRequestEpoch: null, approveCurrentEpoch: null, isApprovedNow: true, revoke2: null, afterRevoke: false,
      originEdge: null, originBogus: "23514",
    });
    // the trigger itself (as the owner, below the functions)
    const ko = await rolledBack(sql, async (tx) => {
      const f = await fixtures(tx, CODE + "-o");
      const pre = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(T)} ("edgeNodeId", "robotId", digest, "ownerEpoch", "editedBy", "approvedBy", "approvedAt", "approvedDigest", "approvedOwnerEpoch") VALUES (${f.node.id}, ${f.robot.id}, ${H("a")}, 1, ${f.maker}, ${f.admin}, now(), ${H("a")}, 1)`);
      await tx`INSERT INTO ${tx(T)} ("edgeNodeId", "robotId", digest, "ownerEpoch", "editedBy") VALUES (${f.node.id}, ${f.robot.id}, ${H("a")}, 1, ${f.maker})`;
      const k = (sp) => sp`"robotId" = ${f.robot.id}`;
      const r = {
        pre,
        approveWithEdit: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET digest = ${H("b")}, "approvedBy" = ${f.admin}, "approvedAt" = now(), "approvedDigest" = ${H("b")}, "approvedOwnerEpoch" = 1 WHERE ${k(sp)}`),
        approveByEditor: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = ${f.maker}, "approvedAt" = now(), "approvedDigest" = ${H("a")}, "approvedOwnerEpoch" = 1 WHERE ${k(sp)}`),
        approveUnbound: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = ${f.admin}, "approvedAt" = now(), "approvedDigest" = ${H("e")}, "approvedOwnerEpoch" = 1 WHERE ${k(sp)}`),
        shrinkEditors: await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "editorsSinceApproval" = '{}' WHERE ${k(sp)}`),
      };
      await tx`UPDATE ${tx(T)} SET "approvedBy" = ${f.admin}, "approvedAt" = now(), "approvedDigest" = ${H("a")}, "approvedOwnerEpoch" = 1 WHERE "robotId" = ${f.robot.id}`;
      r.swap = await maLoi(tx, (sp) => sp`UPDATE ${sp(T)} SET "approvedBy" = ${f.editor2} WHERE ${k(sp)}`);
      await tx`UPDATE ${tx(T)} SET digest = ${H("f")} WHERE "robotId" = ${f.robot.id}`;
      const [after] = await tx`SELECT "approvedBy" AS a FROM ${tx(T)} WHERE "robotId" = ${f.robot.id}`;
      r.editClears = after.a === null;
      return r;
    });
    expectExact("(b) owner-level trigger", ko, { pre: "23514", approveWithEdit: "23514", approveByEditor: "23514", approveUnbound: "23514", shrinkEditors: "23514", swap: "23514", editClears: true });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    const [leftE] = await appSql`SELECT count(*)::int AS n FROM safety_events WHERE notes = ${CODE}`;
    const [leftU] = await appSql`SELECT count(*)::int AS n FROM users WHERE "openId" LIKE ${CODE + "%"}`;
    if (left.n !== 0 || leftE.n !== 0 || leftU.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} nodes / ${leftE.n} events / ${leftU.n} users left`);
    log(`(b) grants exact (SELECT only + EXECUTE on 4 guarded functions); behaviour ${JSON.stringify(kq)}; owner-level ${JSON.stringify(ko)}; ROLLED BACK`);
  },
});
