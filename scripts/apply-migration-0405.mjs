#!/usr/bin/env node
/**
 * 0405 — PHẠM VI BỀ MẶT của gán vai trò (AI Local Đợt 9): CHECK `chk_ai_model_bindings_scope` thêm `be-mat` (scopeId 'luong').
 * Áp `drizzle/0405_ai_model_bindings_be_mat.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) CHECK có đúng năm scopeKind + danh sách trắng scopeId của be-mat;
 *   (b) giao dịch hoàn tác: be-mat/'luong' ⇒ OK; be-mat/'khac' ⇒ 23514; be-mat/NULL ⇒ 23514; flow/'f1' vẫn OK; kind lạ ⇒ 23514;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0405.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0405_ai_model_bindings_be_mat.sql",
  tag: "[0405]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'chk_ai_model_bindings_scope'`;
    const d = String(c?.d ?? "");
    const kind = [...(/"scopeKind"\)::text = ANY \(\(ARRAY\[([^\]]*)\]/.exec(d)?.[1] ?? "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expectExact("(a) scopeKind values", { kind }, { kind: ["be-mat", "flow", "global", "project", "tenant"] });
    if (!/be-mat/.test(d) || !/luong/.test(d)) throw new Error(`(a) CHECK thiếu điều kiện be-mat/luong: ${d}`);
    log("(a) CHECK scopeKind = global|tenant|project|flow|be-mat · be-mat ⇒ scopeId ∈ {luong}");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const chen = (kind, id, mode) => (sp) =>
        sp`INSERT INTO public.ai_model_bindings ("roleId", "scopeKind", "scopeId", "envKey", mode) VALUES ('extract', ${kind}, ${id}, 'GGUF_FAST_MODEL', ${mode})`;
      out.beMatLuong = await maLoi(tx, chen("be-mat", "luong", "thu"));
      out.beMatKhac = await maLoi(tx, chen("be-mat", "khac", "shadow"));
      out.beMatNull = await maLoi(tx, chen("be-mat", null, "shadow"));
      out.flow = await maLoi(tx, chen("flow", "f0405", "shadow"));
      out.la = await maLoi(tx, chen("be-mat-x", "luong", "shadow"));
      return out;
    });
    expectExact("(b) behaviour", r, { beMatLuong: null, beMatKhac: "23514", beMatNull: "23514", flow: null, la: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_model_bindings WHERE "scopeKind" = 'be-mat' OR "scopeId" = 'f0405'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
