#!/usr/bin/env node
/**
 * 0490 — Pha 0 T0-3: MỘT nguồn chính sách Timescale. Áp `drizzle/0490_timescale_mot_nguon_chinh_sach.sql` bằng owner `aoi`:
 *   (a) mỗi hypertable đúng MỘT job nén + MỘT job giữ, đúng giá trị; segmentby/orderby đúng;
 *   (b) trên DB đã chuẩn migration là NO-OP: job_id trước = sau;
 *   (c) chỉ _test, giao dịch HOÀN TÁC: làm lệch chính sách (ot_telemetry nén 30 d, oee_metrics mất job giữ) rồi chạy lại SQL ⇒ về đúng.
 *   node scripts/apply-migration-0490.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectExact, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const FILE = "0490_timescale_mot_nguon_chinh_sach.sql";
const TEN_SQL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle", FILE), "utf-8");

const CHUAN = {
  machine_heartbeats: { seg: ["machineId"], ord: "timestamp", nen: "14 days" },
  measurement_results: { seg: ["pointDefId"], ord: "createdAt", nen: "30 days" },
  oee_metrics: { seg: ["machineId"], ord: "timestamp", nen: "90 days" },
  ot_telemetry: { seg: ["deviceId", "metric"], ord: "ts", nen: "7 days" },
  process_results: { seg: ["machineId"], ord: "measuredAt", nen: "60 days" },
  product_inspections: { seg: ["machineId"], ord: "inspectionTime", nen: "30 days" },
  robot_telemetry: { seg: ["robotId"], ord: "timestamp", nen: "14 days" },
};
const BANG = Object.keys(CHUAN);

const jobCua = (c) => c`SELECT job_id, proc_name, hypertable_name, config->>'compress_after' AS nen, config->>'drop_after' AS giu
  FROM timescaledb_information.jobs
  WHERE proc_name IN ('policy_compression', 'policy_retention') AND hypertable_schema = 'public' AND hypertable_name IN ${c(BANG)}
  ORDER BY hypertable_name, proc_name, job_id`;

function kiemJob(jobs, nhan) {
  for (const b of BANG) {
    const nen = jobs.filter((j) => j.hypertable_name === b && j.proc_name === "policy_compression");
    const giu = jobs.filter((j) => j.hypertable_name === b && j.proc_name === "policy_retention");
    expectExact(`${nhan} ${b} job nen`, nen.map((j) => j.nen), [CHUAN[b].nen]);
    expectExact(`${nhan} ${b} job giu`, giu.map((j) => j.giu), ["365 days"]);
  }
}

let truoc = null;
await runMigration({
  file: FILE,
  tag: "[0490]",
  guard: {
    async before({ sql }) {
      truoc = (await jobCua(sql)).map((j) => Number(j.job_id));
      return false;
    },
    after() {},
  },
  async verify({ sql, appSql, label, log }) {
    const jobs = await jobCua(appSql);
    kiemJob(jobs, "(a)");
    const nen = await appSql`SELECT hypertable_name AS b, attname AS c, segmentby_column_index AS s, orderby_column_index AS o, orderby_asc AS a
      FROM timescaledb_information.compression_settings WHERE hypertable_schema = 'public' AND hypertable_name IN ${appSql(BANG)}`;
    for (const b of BANG) {
      const dong = nen.filter((x) => x.b === b);
      expectExact(`(a) ${b} segmentby`, dong.filter((x) => x.s != null).sort((p, q) => p.s - q.s).map((x) => x.c), CHUAN[b].seg);
      expectExact(`(a) ${b} orderby`, dong.filter((x) => x.o != null).map((x) => `${x.c}${x.a ? "+" : "-"}`), [`${CHUAN[b].ord}-`]);
    }
    log(`(a) ${BANG.length} bang: dung 1 job nen + 1 job giu, segmentby/orderby dung`);

    expectExact("(b) no-op job_id", jobs.map((j) => Number(j.job_id)), truoc);
    log(`(b) no-op: ${truoc.length} job_id khong doi`);

    if (/test/i.test(label)) {
      const r = await rolledBack(sql, async (tx) => {
        await tx`SELECT remove_compression_policy('public.ot_telemetry'::regclass, if_exists => TRUE)`;
        await tx`SELECT add_compression_policy('public.ot_telemetry'::regclass, INTERVAL '30 days')`;
        await tx`SELECT remove_retention_policy('public.oee_metrics'::regclass, if_exists => TRUE)`;
        const lech = await jobCua(tx);
        const loDo = lech.find((j) => j.hypertable_name === "ot_telemetry" && j.proc_name === "policy_compression")?.nen;
        const conGiu = lech.filter((j) => j.hypertable_name === "oee_metrics" && j.proc_name === "policy_retention").length;
        await tx.unsafe(TEN_SQL);
        const sau = await jobCua(tx);
        kiemJob(sau, "(c) sau hoa giai");
        return { lechNen: loDo, lechGiu: conGiu };
      });
      expectExact("(c) da tao lech that", r, { lechNen: "30 days", lechGiu: 0 });
      expectExact("(c) hoan tac", (await jobCua(appSql)).map((j) => Number(j.job_id)), truoc);
      log(`(c) lam lech ${JSON.stringify(r)} => SQL hoa giai dung; ROLLED BACK, job_id nguyen`);
    }
  },
});
