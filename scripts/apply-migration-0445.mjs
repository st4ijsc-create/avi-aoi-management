#!/usr/bin/env node
/**
 * 0445 — `ai_gateway_metrics` + `cacheTokens` · `promptEvalTokens` (Đợt 12 H0.1: tách token prompt tái dùng / xử lý lại).
 * Áp `drizzle/0445_ai_gateway_metrics_cache_prompt.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) hai cột tồn tại, kiểu integer, is_nullable = YES, KHÔNG default; ràng buộc đã VALIDATE;
 *   (b) giao dịch hoàn tác: hàng không hai cột ⇒ NULL/NULL · (12, 2) ⇒ OK · (0, 0) ⇒ OK · cacheTokens −1 / promptEvalTokens −1 ⇒ 23514;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0445.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0445_ai_gateway_metrics_cache_prompt.sql",
  tag: "[0445]",
  async verify({ appSql, log }) {
    const cot = await appSql`
      SELECT column_name AS c, data_type AS t, is_nullable AS nul, column_default AS d
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_gateway_metrics' AND column_name IN ('cacheTokens', 'promptEvalTokens')
      ORDER BY column_name`;
    const [rb] = await appSql`
      SELECT convalidated AS v FROM pg_constraint
      WHERE conname = 'chk_ai_gateway_metrics_cache_prompt' AND conrelid = 'public.ai_gateway_metrics'::regclass`;
    expectExact("(a) columns", { cot: cot.map((r) => `${r.c}:${r.t}:${r.nul}:${r.d}`), validated: rb?.v ?? null }, {
      cot: ["cacheTokens:integer:YES:null", "promptEvalTokens:integer:YES:null"],
      validated: true,
    });
    log("(a) cacheTokens · promptEvalTokens integer — NULLABLE, không default; CHECK đã VALIDATE");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [chinh] = await tx`
        INSERT INTO public.ai_gateway_metrics (tier, task, model, outcome) VALUES (3, 'chat', 'do-0445', 'ok')
        RETURNING "cacheTokens", "promptEvalTokens"`;
      out.vang = [chinh.cacheTokens, chinh.promptEvalTokens];
      const hang = (c, p) => (sp) =>
        sp`INSERT INTO public.ai_gateway_metrics (tier, task, model, outcome, "cacheTokens", "promptEvalTokens")
           VALUES (3, 'chat', 'do-0445', 'ok', ${c}, ${p})`;
      out.thuong = await maLoi(tx, hang(12, 2));
      out.khong = await maLoi(tx, hang(0, 0));
      out.amCache = await maLoi(tx, hang(-1, 2));
      out.amXuLy = await maLoi(tx, hang(12, -1));
      return out;
    });
    expectExact("(b) behaviour", r, { vang: [null, null], thuong: null, khong: null, amCache: "23514", amXuLy: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_gateway_metrics WHERE model = 'do-0445'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
