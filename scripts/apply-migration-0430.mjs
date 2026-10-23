#!/usr/bin/env node
/**
 * 0430 — SCADA R0 Task 9 (D2): cột `interlock_rules."khiThieuDuLieu"` varchar(8) NOT NULL DEFAULT 'chan' CHECK IN ('chan','cho_qua').
 * Áp `drizzle/0430_scada_interlock_thieu_du_lieu.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột tồn tại, varchar(8), NOT NULL, DEFAULT 'chan';
 *   (b) giao dịch hoàn tác: luật chèn không khai cột ⇒ 'chan'; 'cho_qua' giữ nguyên; giá trị lạ bị CHECK từ chối;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0430.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên điều phối duyệt (brief Task 9).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0430_scada_interlock_thieu_du_lieu.sql",
  tag: "[0430]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT data_type AS d, character_maximum_length AS len, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='interlock_rules' AND column_name='khiThieuDuLieu'`;
    expectExact("(a) column", { d: c?.d, len: c?.len, n: c?.n, macDinhChan: /'chan'/.test(String(c?.df ?? "")) }, { d: "character varying", len: 8, n: "NO", macDinhChan: true });
    log("(a) khiThieuDuLieu varchar(8) NOT NULL DEFAULT 'chan'");
    const r = await rolledBack(appSql, async (tx) => {
      const ins = (khi) => khi === undefined
        ? tx`INSERT INTO public.interlock_rules (name, scope, "sourceType", "comparisonOperator", action) VALUES ('probe0430', 'machine', 'telemetry_tag', 'gt', 'alert') RETURNING "khiThieuDuLieu" AS k`
        : tx`INSERT INTO public.interlock_rules (name, scope, "sourceType", "comparisonOperator", action, "khiThieuDuLieu") VALUES ('probe0430', 'machine', 'telemetry_tag', 'gt', 'alert', ${khi}) RETURNING "khiThieuDuLieu" AS k`;
      const [a] = await ins(undefined);
      const [b] = await ins("cho_qua");
      const loi = await maLoi(tx, (sp) => sp`INSERT INTO public.interlock_rules (name, scope, "sourceType", "comparisonOperator", action, "khiThieuDuLieu") VALUES ('probe0430', 'machine', 'telemetry_tag', 'gt', 'alert', 'la')`);
      return { macDinh: a.k, choQua: b.k, giaTriLaBiTuChoi: loi === "23514" };
    });
    expectExact("(b) behaviour", r, { macDinh: "chan", choQua: "cho_qua", giaTriLaBiTuChoi: true });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.interlock_rules WHERE name = 'probe0430'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
