#!/usr/bin/env node
/**
 * 0416 — Dot 10.3: ai_flow_versions them coNodeNgoai / ngoaiDuyetBoi / ngoaiDuyetLuc / ngoaiTuDuyet / ngoaiBamDuyet.
 * Nghiem thu bang `avi_app` (giao dich HOAN TAC): 5 cot co; avi_app UPDATE duoc cac cot moi;
 *   duyet co luc ma khong bam ⇒ 23514; bam khong phai 64 hex ⇒ 23514; bam + luc hop le ⇒ duoc.
 *   node scripts/apply-migration-0416.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, updatableCols } from "./apply-migration-dot10-common.mjs";

const COT = ["coNodeNgoai", "ngoaiBamDuyet", "ngoaiDuyetBoi", "ngoaiDuyetLuc", "ngoaiTuDuyet"];

await runMigration({
  file: "0416_ai_flow_duyet_ngoai.sql",
  tag: "[0416]",
  async verify({ appSql, log }) {
    const rows = await appSql`SELECT column_name AS c, column_default AS d, is_nullable AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_flow_versions' AND column_name = ANY(${COT}) ORDER BY column_name`;
    expectExact("(a) columns", { c: rows.map((r) => r.c) }, { c: COT });
    expectExact("(a) updatable", { u: await updatableCols(appSql, "ai_flow_versions", COT) }, { u: COT });
    log(`(a) ${rows.map((r) => `${r.c}(${r.n},${r.d ?? "-"})`).join(" ")}`);
    const [v] = await appSql`SELECT "flowId" AS f, version AS v FROM public.ai_flow_versions ORDER BY "createdAt" DESC LIMIT 1`;
    if (!v) {
      log("(b) BO QUA: chua co phien ban luong nao de tham do");
      return;
    }
    const BAM = "c".repeat(64);
    const r = await rolledBack(appSql, async (tx) => {
      const lucKhongBam = await maLoi(tx, (sp) => sp`UPDATE public.ai_flow_versions SET "ngoaiDuyetLuc" = now() WHERE "flowId" = ${v.f} AND version = ${v.v}`);
      const bamSai = await maLoi(tx, (sp) => sp`UPDATE public.ai_flow_versions SET "ngoaiDuyetLuc" = now(), "ngoaiBamDuyet" = 'xyz' WHERE "flowId" = ${v.f} AND version = ${v.v}`);
      const dung = await maLoi(tx, (sp) => sp`UPDATE public.ai_flow_versions SET "ngoaiDuyetLuc" = now(), "ngoaiBamDuyet" = ${BAM}, "coNodeNgoai" = true WHERE "flowId" = ${v.f} AND version = ${v.v}`);
      return { lucKhongBam, bamSai, dung };
    });
    expectExact("(b) behaviour", r, { lucKhongBam: "23514", bamSai: "23514", dung: null });
    const [dem] = await appSql`SELECT count(*)::int AS n, count(*) FILTER (WHERE "coNodeNgoai")::int AS ngoai FROM public.ai_flow_versions`;
    log(`(b) ${JSON.stringify(r)}; ROLLED BACK. (info) phien ban ${dem.n}, co node ngoai ${dem.ngoai}`);
  },
});
