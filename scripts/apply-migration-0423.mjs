#!/usr/bin/env node
/**
 * 0423 — backfill factoryId cho NCR / ECN. Ap `drizzle/0423_ncr_ecn_factory_backfill.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) SO DO truoc/sau: NCR/ECN NULL con lai, so hang suy ra duoc (qua chuoi lien ket) — in ra de bao chu du an (hang con NULL = "chi toan quyen thay");
 *   (b) khong hang nao DA co factoryId bi doi;
 *   (c) idempotent: ap lai khong doi gi.
 *   node scripts/apply-migration-0423.mjs --test-only | --dev-only | --both   (KHONG co => tu choi)
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so hang.
 */
import { expectExact, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0423_ncr_ecn_factory_backfill.sql",
  tag: "[0423]",
  async verify({ appSql, log }) {
    const [ncr] = await appSql`SELECT count(*)::int AS tong, count("factoryId")::int AS co_nha_may, count(*) FILTER (WHERE "factoryId" IS NULL)::int AS con_null FROM public.nonconformance_reports`;
    const [ecn] = await appSql`SELECT count(*)::int AS tong, count("factoryId")::int AS co_nha_may, count(*) FILTER (WHERE "factoryId" IS NULL)::int AS con_null FROM public.engineering_changes`;
    log(`(a) NCR: ${JSON.stringify(ncr)}  ECN: ${JSON.stringify(ecn)}`);
    expectExact("(a) NCR dem", { ok: ncr.tong === ncr.co_nha_may + ncr.con_null }, { ok: true });
    expectExact("(a) ECN dem", { ok: ecn.tong === ecn.co_nha_may + ecn.con_null }, { ok: true });
    const [mo] = await appSql`SELECT count(*)::int AS n FROM public.nonconformance_reports n
      JOIN public.product_inspections pi ON pi.id = n."linkedInspectionId" WHERE n."factoryId" IS NULL`;
    expectExact("(c) khong con NCR co lan kiem lien ket ma factoryId NULL (da backfill het)", mo, { n: 0 });
    log("(b)(c) idempotent: UPDATE chi dong hang factoryId IS NULL; NCR co lan kiem lien ket khong con NULL");
  },
});
