#!/usr/bin/env node
/**
 * 0406 — `ai_gateway_metrics` + `requestId` · `luotPhu` (AI Local Đợt 9: đo các lượt sửa của vòng kiểm biên dịch ST).
 * Áp `drizzle/0406_ai_gateway_metrics_luot_phu.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) hai cột tồn tại, đúng kiểu (character varying 64 / 32), is_nullable = YES, KHÔNG default;
 *   (b) giao dịch hoàn tác: hàng chính (không hai cột) ⇒ NULL/NULL · hàng phụ ('chatcmpl-x', 'sua-bien-dich-st') ⇒ OK ·
 *       luotPhu 'Sua Bien' / '' ⇒ 23514;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0406.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0406_ai_gateway_metrics_luot_phu.sql",
  tag: "[0406]",
  async verify({ appSql, log }) {
    const cot = await appSql`
      SELECT column_name AS c, data_type AS t, character_maximum_length AS n, is_nullable AS nul, column_default AS d
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_gateway_metrics' AND column_name IN ('requestId', 'luotPhu')
      ORDER BY column_name`;
    expectExact("(a) columns", { cot: cot.map((r) => `${r.c}:${r.t}:${r.n}:${r.nul}:${r.d}`) }, {
      cot: ["luotPhu:character varying:32:YES:null", "requestId:character varying:64:YES:null"],
    });
    log("(a) requestId varchar(64) · luotPhu varchar(32) — NULLABLE, không default");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [chinh] = await tx`
        INSERT INTO public.ai_gateway_metrics (tier, task, model, outcome) VALUES (3, 'chat', 'do-0406', 'ok')
        RETURNING "requestId", "luotPhu"`;
      out.chinh = [chinh.requestId, chinh.luotPhu];
      const phu = (lp) => (sp) =>
        sp`INSERT INTO public.ai_gateway_metrics (tier, task, model, outcome, "requestId", "luotPhu")
           VALUES (3, 'chat', 'do-0406', 'ok', 'chatcmpl-0406', ${lp})`;
      out.phu = await maLoi(tx, phu("sua-bien-dich-st"));
      out.hoa = await maLoi(tx, phu("Sua Bien"));
      out.rong = await maLoi(tx, phu(""));
      return out;
    });
    expectExact("(b) behaviour", r, { chinh: [null, null], phu: null, hoa: "23514", rong: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_gateway_metrics WHERE model = 'do-0406'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
