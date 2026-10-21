#!/usr/bin/env node
/**
 * 0415 — H2 (audit 2026-10-21): `ai_flow_versions."enabledBy"` + `ai_flow_runs."startedBy"` (tách người duyệt khỏi người bật / người chạy).
 * Áp `drizzle/0415_ai_flow_nguoi_bat_nguoi_chay.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) hai cột tồn tại, kiểu integer, cho NULL;
 *   (b) giao dịch hoàn tác: ghi enabledBy/startedBy = user thật ⇒ OK; user không tồn tại ⇒ 23503;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0415.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0415_ai_flow_nguoi_bat_nguoi_chay.sql",
  tag: "[0415]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT table_name AS t, column_name AS c, data_type AS ty, is_nullable AS nl FROM information_schema.columns
      WHERE table_schema='public' AND ((table_name='ai_flow_versions' AND column_name='enabledBy') OR (table_name='ai_flow_runs' AND column_name='startedBy')) ORDER BY 1`;
    expectExact("(a) columns", cols.map((r) => `${r.t}.${r.c}:${r.ty}:${r.nl}`), ["ai_flow_runs.startedBy:integer:YES", "ai_flow_versions.enabledBy:integer:YES"]);
    log("(a) ai_flow_versions.enabledBy · ai_flow_runs.startedBy (integer, NULL được)");
    const [u] = await appSql`SELECT id FROM public.users ORDER BY id LIMIT 1`;
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`INSERT INTO public.ai_flows (id, name) VALUES ('probe0415', 'dò')`;
      out.version = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_versions ("flowId", version, definition, "riskClass", "enabledBy") VALUES ('probe0415', 1, '{}'::jsonb, 'thuan', ${u.id})`);
      out.versionUserLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_versions ("flowId", version, definition, "riskClass", "enabledBy") VALUES ('probe0415', 2, '{}'::jsonb, 'thuan', 2147480000)`);
      out.run = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind", "startedBy") VALUES ('00000000-0000-4000-8000-000000000415', 'probe0415', 1, 'thu-cong', ${u.id})`);
      out.runUserLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind", "startedBy") VALUES ('00000000-0000-4000-8000-000000000416', 'probe0415', 1, 'thu-cong', 2147480000)`);
      return out;
    });
    expectExact("(b) behaviour", r, { version: null, versionUserLa: "23503", run: null, runUserLa: "23503" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id = 'probe0415'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
