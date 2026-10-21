#!/usr/bin/env node
/**
 * 0411 — PHẠM VI NHÀ MÁY của Luồng AI (Đợt 9): cột `factoryId` (FK factories, ON DELETE SET NULL) trên `ai_flows` và `ai_flow_credentials`.
 * Áp `drizzle/0411_ai_flow_pham_vi_nha_may.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) hai cột integer NULLable + hai chỉ mục;
 *   (b) giao dịch hoàn tác: factoryId NULL ⇒ OK; factoryId trỏ nhà máy không có ⇒ 23503;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0411.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0411_ai_flow_pham_vi_nha_may.sql",
  tag: "[0411]",
  async verify({ appSql, log }) {
    const cot = await appSql`SELECT table_name AS t, data_type AS d, is_nullable AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('ai_flows','ai_flow_credentials') AND column_name='factoryId' ORDER BY table_name`;
    expectExact("(a) columns", cot.map((c) => ({ t: c.t, d: c.d, n: c.n })), [
      { t: "ai_flow_credentials", d: "integer", n: "YES" },
      { t: "ai_flows", d: "integer", n: "YES" },
    ]);
    const idx = (await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' AND indexname IN ('ai_flows_factory_idx','ai_flow_credentials_factory_idx') ORDER BY 1`).map((r) => r.n);
    expectExact("(a) indexes", { idx }, { idx: ["ai_flow_credentials_factory_idx", "ai_flows_factory_idx"] });
    log("(a) ai_flows.factoryId + ai_flow_credentials.factoryId integer NULL + 2 index");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      out.flowNull = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flows (id, name, "factoryId") VALUES ('probe0411a', 'dò', NULL)`);
      out.flowKhongCo = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flows (id, name, "factoryId") VALUES ('probe0411b', 'dò', 2147000000)`);
      return out;
    });
    expectExact("(b) behaviour", r, { flowNull: null, flowKhongCo: "23503" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id LIKE 'probe0411%'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
