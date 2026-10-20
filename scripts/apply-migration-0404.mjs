#!/usr/bin/env node
/**
 * 0404 — LUỒNG CON của Luồng AI (AI Local Đợt 8.4): CHECK `kind` của `ai_flow_waits` thêm `luong-con` + chỉ mục "parentRunId".
 * Áp `drizzle/0404_ai_flow_cho_luong_con.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) CHECK `chk_ai_flow_waits_kind` có đúng bốn giá trị; chỉ mục `ai_flow_runs_parent_idx` tồn tại;
 *   (b) giao dịch hoàn tác: kind `luong-con` ⇒ OK; kind lạ ⇒ 23514;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0404.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0404_ai_flow_cho_luong_con.sql",
  tag: "[0404]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'chk_ai_flow_waits_kind'`;
    const giaTri = [...String(c?.d ?? "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expectExact("(a) kind values", { giaTri }, { giaTri: ["duyet", "luong-con", "thoi-gian", "webhook"] });
    const idx = (await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname='public' AND indexname = 'ai_flow_runs_parent_idx'`).map((r) => r.n);
    expectExact("(a) index", { idx }, { idx: ["ai_flow_runs_parent_idx"] });
    log("(a) CHECK kind = duyet|luong-con|thoi-gian|webhook · index ai_flow_runs_parent_idx");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`INSERT INTO public.ai_flows (id, name) VALUES ('probe0404', 'dò')`;
      await tx`INSERT INTO public.ai_flow_versions ("flowId", version, definition, "riskClass") VALUES ('probe0404', 1, '{}'::jsonb, 'thuan')`;
      await tx`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind") VALUES ('00000000-0000-4000-8000-000000000404', 'probe0404', 1, 'thu-cong')`;
      const chen = (kind, node) => (sp) => sp`INSERT INTO public.ai_flow_waits ("runId", "nodeId", kind) VALUES ('00000000-0000-4000-8000-000000000404', ${node}, ${kind})`;
      out.luongCon = await maLoi(tx, chen("luong-con", "a"));
      out.la = await maLoi(tx, chen("la", "b"));
      return out;
    });
    expectExact("(b) behaviour", r, { luongCon: null, la: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id = 'probe0404'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
