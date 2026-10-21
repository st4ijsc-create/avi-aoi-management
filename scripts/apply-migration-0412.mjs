#!/usr/bin/env node
/**
 * 0412 — HOST CHO PHÉP của bí mật Luồng AI (Đợt 9, M2): cột `ai_flow_credentials."hostChoPhep"` text[] NOT NULL DEFAULT '{}'.
 * Áp `drizzle/0412_ai_flow_bi_mat_host.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột kiểu ARRAY (text[]), NOT NULL, mặc định mảng rỗng;
 *   (b) giao dịch hoàn tác: hàng không khai host ⇒ mảng rỗng; khai hai host ⇒ giữ nguyên;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0412.mjs --test-only | --dev-only | --both
 */
import { expectExact, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0412_ai_flow_bi_mat_host.sql",
  tag: "[0412]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT data_type AS d, udt_name AS u, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_flow_credentials' AND column_name='hostChoPhep'`;
    expectExact("(a) column", { d: c?.d, u: c?.u, n: c?.n, macDinhRong: /'\{\}'/.test(String(c?.df ?? "")) }, { d: "ARRAY", u: "_text", n: "NO", macDinhRong: true });
    log("(a) hostChoPhep text[] NOT NULL DEFAULT '{}'");
    const r = await rolledBack(appSql, async (tx) => {
      const iv = Buffer.alloc(12, 2);
      const tag = Buffer.alloc(16, 3);
      const ma = Buffer.alloc(8, 1);
      await tx`INSERT INTO public.ai_flow_credentials (id, ten, loai, "banMa", iv, tag, "phienBanKhoa") VALUES ('probe0412a', 'dò', 'token', ${ma}, ${iv}, ${tag}, 1)`;
      await tx`INSERT INTO public.ai_flow_credentials (id, ten, loai, "banMa", iv, tag, "phienBanKhoa", "hostChoPhep") VALUES ('probe0412b', 'dò', 'token', ${ma}, ${iv}, ${tag}, 1, ${["a.example", "b.example"]})`;
      const [a] = await tx`SELECT "hostChoPhep" AS h FROM public.ai_flow_credentials WHERE id = 'probe0412a'`;
      const [b] = await tx`SELECT "hostChoPhep" AS h FROM public.ai_flow_credentials WHERE id = 'probe0412b'`;
      return { a: a.h, b: b.h };
    });
    expectExact("(b) behaviour", r, { a: [], b: ["a.example", "b.example"] });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flow_credentials WHERE id LIKE 'probe0412%'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
