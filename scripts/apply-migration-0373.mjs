#!/usr/bin/env node
/**
 * 0373 — doc 81 Đợt 10 task A: edge report-stream cursors, node-reported program checks, PUBLIC edge signing keys, and
 * edge_nodes."protocolVersion". Applies `drizzle/0373_edge_report_streams_and_keys.sql` as owner `aoi`, then VERIFIES as
 * `avi_app` (pattern 0363–0371):
 *   (a) the three tables with every column, their CHECKs and triggers, edge_nodes."protocolVersion" (default 1, CHECK 1|2);
 *   (b) grants (catalog — EXACT): SELECT / INSERT on each table; no table UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER;
 *       column UPDATE exactly: cursors (lastSeq, updatedAt), program reports (status, checksum, reason, readAt, receivedAt),
 *       keys (status, retiredAt); then BEHAVIOUR in an ALWAYS-rolled-back transaction:
 *       cursors — insert at 0 ⇒ ok, at 5 ⇒ 23514, bad stream / epoch ⇒ 23514, 0 → 7 ⇒ ok, 7 → 6 ⇒ 23514, the key ⇒ 42501,
 *         same (node, stream) under a new epoch ⇒ ok, DELETE ⇒ 42501;
 *       program reports — verified with checksum ⇒ ok, verified without / unreadable without reason ⇒ 23514, upsert ⇒ ok,
 *         DELETE ⇒ 42501;
 *       keys (R-10-c: avi_app SELECT only — an INSERT / UPDATE by avi_app ⇒ 42501; the rest measured AS OWNER) — a genesis key (active) ⇒ ok, a next key endorsed by it ⇒ ok, a key born retired ⇒ 23514, a bad kid / not a
 *         PEM / an endorsement without a signature ⇒ 23514, self-endorsement ⇒ 23514, next → active ⇒ ok, active → next ⇒
 *         23514, active → retired (with retiredAt) ⇒ ok, retired → active ⇒ 23514, the public key ⇒ 42501, DELETE ⇒ 42501;
 *       protocolVersion — 2 ⇒ ok, 3 ⇒ 23514;
 *       AS OWNER (triggers below privileges): publicKeyPem / endorsement / notBefore change or late first write ⇒ 23514,
 *         cursor key change ⇒ 23514; 0 probe rows left;
 *   (c) `__applied_migrations` has exactly 1 row for this file.
 *
 *   node scripts/apply-migration-0373.mjs --test-only | --dev-only | --both   (NO flag ⇒ refused — R-3-g)
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const CUR = "edge_node_report_cursors";
const PRG = "edge_node_program_reports";
const KEYS = "edge_auth_signing_keys";
const COLS = {
  [CUR]: ["edgeNodeId", "stream", "epoch", "lastSeq", "createdAt", "updatedAt"],
  [PRG]: ["edgeNodeId", "adapterId", "status", "checksum", "reason", "readAt", "receivedAt"],
  [KEYS]: ["kid", "publicKeyPem", "status", "notBefore", "retiredAt", "createdBy", "createdAt", "endorsedByKid", "endorsementSig"],
};
const WANT_UPD = {
  [CUR]: ["lastSeq", "updatedAt"],
  [PRG]: ["checksum", "readAt", "reason", "receivedAt", "status"],
  [KEYS]: [],
};
const EP = (c) => c.repeat(32);
function key() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const kid = "edk_" + createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 22);
  return { kid, pem };
}
const SIG = "S".repeat(86);

async function fixtures(tx, code) {
  const [node] = await tx`INSERT INTO edge_nodes (code, name, status) VALUES (${code}, ${code}, 'offline') RETURNING id`;
  const owned = (await tx`SELECT 1 FROM information_schema.columns WHERE table_name = 'device_adapters' AND column_name = 'edgeNodeId'`).length > 0;
  const [ad] = owned
    ? await tx`INSERT INTO device_adapters (code, name, protocol, endpoint, "edgeNodeId") VALUES (${code}, ${code}, 'stub', 'stub://probe', ${node.id}) RETURNING id`
    : await tx`INSERT INTO device_adapters (code, name, protocol, endpoint) VALUES (${code}, ${code}, 'stub', 'stub://probe') RETURNING id`;
  return { node, ad };
}

await runMigration({
  file: "0373_edge_report_streams_and_keys.sql",
  tag: "[0373]",
  async verify({ sql, appSql, log }) {
    // (a)
    for (const [t, cols] of Object.entries(COLS)) {
      const have = await columnsOf(appSql, t);
      for (const c of cols) if (!have.includes(c)) throw new Error(`(a) ${t}.${c} missing`);
    }
    const [pv] = await appSql`SELECT column_default AS d, is_nullable AS n, data_type AS t FROM information_schema.columns WHERE table_name = 'edge_nodes' AND column_name = 'protocolVersion'`;
    if (!pv || pv.n !== "NO" || pv.t !== "smallint" || !/1/.test(String(pv.d))) throw new Error(`(a) edge_nodes.protocolVersion: ${JSON.stringify(pv)}`);
    const trg = await appSql`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname IN ('trg_edge_report_cursor_guard', 'trg_edge_auth_signing_keys_guard')`;
    if (trg.length !== 2) throw new Error(`(a) triggers: ${JSON.stringify(trg.map((r) => r.tgname))}`);
    for (const t of [CUR, PRG, KEYS]) {
      const [ct] = await appSql`SELECT obj_description(${"public." + t}::regclass, 'pg_class') AS c`;
      if (!ct?.c || !/Dot 10 A \(0373\)/.test(ct.c)) throw new Error(`(a) ${t} comment missing`);
    }
    log(`(a) ${CUR} / ${PRG} / ${KEYS} + edge_nodes.protocolVersion; triggers 2`);
    // fix review 4 (R-10-ag): the per-record content hash table — columns, write-once grants + trigger, behaviour
    {
      const REC = "edge_node_report_records";
      const have = await columnsOf(appSql, REC);
      for (const c of ["edgeNodeId", "stream", "epoch", "seq", "contentHash", "receivedAt"]) if (!have.includes(c)) throw new Error(`(a) ${REC}.${c} missing`);
      const [nn] = await appSql`SELECT is_nullable AS n FROM information_schema.columns WHERE table_name = ${REC} AND column_name = 'contentHash'`;
      if (nn.n !== "NO") throw new Error(`(a) ${REC}.contentHash must be NOT NULL`);
      const p = await tablePriv(appSql, REC);
      if (!p.sel || !p.ins || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) table grants on ${REC} not exact: ${JSON.stringify(p)}`);
      const [w] = await appSql`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D' AND tgname = 'trg_edge_report_record_worm'`;
      if (w.n !== 1) throw new Error("(a) trg_edge_report_record_worm missing");
      const H = (c) => c.repeat(64);
      const rr = await rolledBack(appSql, async (tx) => {
        const { node } = await fixtures(tx, `__probe_0373r_${Date.now()}`);
        await tx`INSERT INTO ${tx(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'events', ${EP("c")})`;
        const ins = (sp, seq, h) => sp`INSERT INTO ${sp(REC)} ("edgeNodeId", stream, epoch, seq, "contentHash") VALUES (${node.id}, 'events', ${EP("c")}, ${seq}, ${h})`;
        return {
          ok: await maLoi(tx, (sp) => ins(sp, 1, H("a"))),
          sameSeqAgain: await maLoi(tx, (sp) => ins(sp, 1, H("b"))),
          noHash: await maLoi(tx, (sp) => ins(sp, 2, null)),
          badHash: await maLoi(tx, (sp) => ins(sp, 2, "xyz")),
          seq0: await maLoi(tx, (sp) => ins(sp, 0, H("a"))),
          noCursor: await maLoi(tx, (sp) => sp`INSERT INTO ${sp(REC)} ("edgeNodeId", stream, epoch, seq, "contentHash") VALUES (${node.id}, 'robot_state', ${EP("c")}, 1, ${H("a")})`),
          upd: await maLoi(tx, (sp) => sp`UPDATE ${sp(REC)} SET "contentHash" = ${H("c")} WHERE "edgeNodeId" = ${node.id}`),
          del: await maLoi(tx, (sp) => sp`DELETE FROM ${sp(REC)} WHERE "edgeNodeId" = ${node.id}`),
        };
      });
      expectExact("(b) report records (avi_app)", rr, { ok: null, sameSeqAgain: "23505", noHash: "23502", badHash: "23514", seq0: "23514", noCursor: "23503", upd: "42501", del: "42501" });
      const ro = await rolledBack(sql, async (tx) => {
        const { node } = await fixtures(tx, `__probe_0373ro_${Date.now()}`);
        await tx`INSERT INTO ${tx(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'events', ${EP("d")})`;
        await tx`INSERT INTO ${tx(REC)} ("edgeNodeId", stream, epoch, seq, "contentHash") VALUES (${node.id}, 'events', ${EP("d")}, 1, ${H("a")})`;
        return { ownerUpd: await maLoi(tx, (sp) => sp`UPDATE ${sp(REC)} SET "contentHash" = ${H("b")} WHERE "edgeNodeId" = ${node.id}`) };
      });
      expectExact("(b) report records (owner, write-once)", ro, { ownerUpd: "23514" });
      log(`(a/b) ${REC}: contentHash NOT NULL, SELECT/INSERT only, write-once ${JSON.stringify(rr)} ${JSON.stringify(ro)}; ROLLED BACK`);
    }
    // (b) catalog
    for (const t of [CUR, PRG, KEYS]) {
      const p = await tablePriv(appSql, t);
      const wantIns = t !== KEYS; // R-10-c: the key mirror is SELECT only for avi_app
      if (!p.sel || p.ins !== wantIns || p.upd || p.del || p.trunc || p.refs || p.trig) throw new Error(`(b) table grants on ${t} not exact: ${JSON.stringify(p)}`);
      const upd = await updatableCols(appSql, t, COLS[t]);
      if (JSON.stringify(upd) !== JSON.stringify(WANT_UPD[t])) throw new Error(`(b) column UPDATE on ${t} not exact: ${JSON.stringify(upd)}`);
    }
    // (b) behaviour
    const CODE = `__probe_0373_${Date.now()}`;
    const k1 = key();
    const k2 = key();
    const k3 = key();
    const kq = await rolledBack(appSql, async (tx) => {
      const { node, ad } = await fixtures(tx, CODE);
      const r = {};
      r.curOk = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'run:9:1', ${EP("a")})`);
      r.curStartHigh = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CUR)} ("edgeNodeId", stream, epoch, "lastSeq") VALUES (${node.id}, 'events', ${EP("a")}, 5)`);
      r.curBadStream = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'run:0:1', ${EP("a")})`);
      r.curBadEpoch = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'events', 'XYZ')`);
      r.curUp = await maLoi(tx, (sp) => sp`UPDATE ${sp(CUR)} SET "lastSeq" = 7, "updatedAt" = now() WHERE "edgeNodeId" = ${node.id} AND stream = 'run:9:1'`);
      r.curDown = await maLoi(tx, (sp) => sp`UPDATE ${sp(CUR)} SET "lastSeq" = 6 WHERE "edgeNodeId" = ${node.id} AND stream = 'run:9:1'`);
      r.curKey = await maLoi(tx, (sp) => sp`UPDATE ${sp(CUR)} SET epoch = ${EP("b")} WHERE "edgeNodeId" = ${node.id} AND stream = 'run:9:1'`);
      r.curNewEpoch = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'run:9:1', ${EP("b")})`);
      r.curDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(CUR)} WHERE "edgeNodeId" = ${node.id}`);
      r.prgOk = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(PRG)} ("edgeNodeId", "adapterId", status, checksum, "readAt") VALUES (${node.id}, ${ad.id}, 'verified', 's7:1', now())`);
      r.prgNoSum = await maLoi(tx, (sp) => sp`UPDATE ${sp(PRG)} SET checksum = NULL WHERE "edgeNodeId" = ${node.id}`);
      r.prgNoReason = await maLoi(tx, (sp) => sp`UPDATE ${sp(PRG)} SET status = 'unreadable', checksum = NULL WHERE "edgeNodeId" = ${node.id}`);
      r.prgUpsert = await maLoi(
        tx,
        (sp) => sp`INSERT INTO ${sp(PRG)} ("edgeNodeId", "adapterId", status, reason, "readAt") VALUES (${node.id}, ${ad.id}, 'unreadable', 'timeout', now())
          ON CONFLICT ("edgeNodeId", "adapterId") DO UPDATE SET status = EXCLUDED.status, checksum = NULL, reason = EXCLUDED.reason, "readAt" = EXCLUDED."readAt", "receivedAt" = now()`,
      );
      r.prgDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(PRG)} WHERE "edgeNodeId" = ${node.id}`);
      r.keyPlantByApp = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(KEYS)} (kid, "publicKeyPem", status, "createdBy") VALUES (${k1.kid}, ${k1.pem}, 'active', ${CODE})`);
      r.pv2 = await maLoi(tx, (sp) => sp`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id = ${node.id}`);
      r.pv3 = await maLoi(tx, (sp) => sp`UPDATE edge_nodes SET "protocolVersion" = 3 WHERE id = ${node.id}`);
      const [c] = await tx`SELECT "lastSeq"::int AS s FROM ${tx(CUR)} WHERE "edgeNodeId" = ${node.id} AND stream = 'run:9:1' AND epoch = ${EP("a")}`;
      r.cursorAfter = c?.s ?? null;
      return r;
    });
    expectExact("(b) avi_app behaviour", kq, {
      curOk: null, curStartHigh: "23514", curBadStream: "23514", curBadEpoch: "23514", curUp: null, curDown: "23514", curKey: "42501", curNewEpoch: null, curDel: "42501",
      prgOk: null, prgNoSum: "23514", prgNoReason: "23514", prgUpsert: null, prgDel: "42501",
      keyPlantByApp: "42501", pv2: null, pv3: "23514", cursorAfter: 7,
    });
    const kk = await rolledBack(sql, async (tx) => {
      const r = {};
      const keyIns = (sp, k, status, by = null, sig = null) =>
        sp`INSERT INTO ${sp(KEYS)} (kid, "publicKeyPem", status, "createdBy", "endorsedByKid", "endorsementSig") VALUES (${k.kid}, ${k.pem}, ${status}, ${CODE}, ${by}, ${sig})`;
      r.keyGenesis = await maLoi(tx, (sp) => keyIns(sp, k1, "active"));
      r.keyNext = await maLoi(tx, (sp) => keyIns(sp, k2, "next", k1.kid, SIG));
      r.keyBornRetired = await maLoi(tx, (sp) => sp`INSERT INTO ${sp(KEYS)} (kid, "publicKeyPem", status, "retiredAt", "createdBy") VALUES (${k3.kid}, ${k3.pem}, 'retired', now(), ${CODE})`);
      r.keyBadKid = await maLoi(tx, (sp) => keyIns(sp, { kid: "k3", pem: k3.pem }, "next"));
      r.keyBadPem = await maLoi(tx, (sp) => keyIns(sp, { kid: k3.kid, pem: "-----BEGIN PRIVATE KEY-----" }, "next"));
      r.keyHalfEndorse = await maLoi(tx, (sp) => keyIns(sp, k3, "next", k1.kid, null));
      r.keySelfEndorse = await maLoi(tx, (sp) => keyIns(sp, k3, "next", k3.kid, SIG));
      r.keyActivate = await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET status = 'active' WHERE kid = ${k2.kid}`);
      r.keyBackToNext = await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET status = 'next' WHERE kid = ${k2.kid}`);
      r.keyRetire = await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET status = 'retired', "retiredAt" = now() WHERE kid = ${k1.kid}`);
      r.keyUnretire = await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET status = 'active', "retiredAt" = NULL WHERE kid = ${k1.kid}`);
      r.keyPem = await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET "publicKeyPem" = ${k3.pem} WHERE kid = ${k2.kid}`);
      r.keyDel = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(KEYS)} WHERE kid = ${k2.kid}`);
      return r;
    });
    expectExact("(b) owner-level key mirror", kk, {
      keyGenesis: null, keyNext: null, keyBornRetired: "23514", keyBadKid: "23514", keyBadPem: "23514", keyHalfEndorse: "23514", keySelfEndorse: "23514",
      keyActivate: null, keyBackToNext: "23514", keyRetire: null, keyUnretire: "23514", keyPem: "23514", keyDel: null,
    });
    const ko = await rolledBack(sql, async (tx) => {
      const { node } = await fixtures(tx, CODE + "-o");
      await tx`INSERT INTO ${tx(KEYS)} (kid, "publicKeyPem", status, "createdBy") VALUES (${k1.kid}, ${k1.pem}, 'active', ${CODE})`;
      await tx`INSERT INTO ${tx(KEYS)} (kid, "publicKeyPem", status, "createdBy") VALUES (${k3.kid}, ${k3.pem}, 'next', ${CODE})`;
      await tx`INSERT INTO ${tx(CUR)} ("edgeNodeId", stream, epoch) VALUES (${node.id}, 'events', ${EP("c")})`;
      return {
        pem: await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET "publicKeyPem" = ${k2.pem} WHERE kid = ${k1.kid}`),
        lateEndorse: await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET "endorsedByKid" = ${k1.kid}, "endorsementSig" = ${SIG} WHERE kid = ${k3.kid}`),
        notBefore: await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET "notBefore" = now() - interval '1 day' WHERE kid = ${k1.kid}`),
        createdBy: await maLoi(tx, (sp) => sp`UPDATE ${sp(KEYS)} SET "createdBy" = 'someone' WHERE kid = ${k1.kid}`),
        cursorKey: await maLoi(tx, (sp) => sp`UPDATE ${sp(CUR)} SET stream = 'robot_state' WHERE "edgeNodeId" = ${node.id}`),
      };
    });
    expectExact("(b) owner-level write-once", ko, { pem: "23514", lateEndorse: "23514", notBefore: "23514", createdBy: "23514", cursorKey: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM edge_nodes WHERE code LIKE ${CODE + "%"}`;
    const [leftK] = await appSql`SELECT count(*)::int AS n FROM edge_auth_signing_keys WHERE "createdBy" = ${CODE}`;
    if (left.n !== 0 || leftK.n !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} nodes / ${leftK.n} keys left`);
    log(`(b) grants exact (key mirror SELECT only); behaviour ${JSON.stringify(kq)}; owner-level keys ${JSON.stringify(kk)}; owner-level ${JSON.stringify(ko)}; ROLLED BACK`);
  },
});
