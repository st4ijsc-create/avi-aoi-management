#!/usr/bin/env node
/**
 * 0410 — CHỦ LƯỢT CHẠY của Luồng AI (Đợt 9): cột `ai_flow_runs."chuLuong"` (FK users, ON DELETE SET NULL).
 * Áp `drizzle/0410_ai_flow_chu_luong.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột tồn tại, kiểu integer, NULLable;
 *   (b) giao dịch hoàn tác: chuLuong NULL ⇒ OK; chuLuong trỏ user không có ⇒ 23503;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0410.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0410_ai_flow_chu_luong.sql",
  tag: "[0410]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT data_type AS t, is_nullable AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_flow_runs' AND column_name='chuLuong'`;
    expectExact("(a) column", { t: c?.t, n: c?.n }, { t: "integer", n: "YES" });
    log("(a) ai_flow_runs.chuLuong integer NULL");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`INSERT INTO public.ai_flows (id, name) VALUES ('probe0410', 'dò')`;
      await tx`INSERT INTO public.ai_flow_versions ("flowId", version, definition, "riskClass") VALUES ('probe0410', 1, '{}'::jsonb, 'thuan')`;
      const chen = (id, u) => (sp) => sp`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind", "chuLuong") VALUES (${id}, 'probe0410', 1, 'thu-cong', ${u})`;
      out.null = await maLoi(tx, chen("00000000-0000-4000-8000-000000000410", null));
      out.khongCoUser = await maLoi(tx, chen("00000000-0000-4000-8000-000000000411", 2147000000));
      return out;
    });
    expectExact("(b) behaviour", r, { null: null, khongCoUser: "23503" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id = 'probe0410'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
