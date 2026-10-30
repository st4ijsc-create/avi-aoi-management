#!/usr/bin/env node
/**
 * 0443 — Đợt 11.8 T7: CHECK `ai_coding_sessions.source` thêm 'cli'. Áp `drizzle/0443_ai_phien_nguon_cli.sql` bằng owner `aoi`, nghiệm thu
 * bằng `avi_app`: (a) CHECK nhận web|vscode|cli, từ chối giá trị khác (23514); (b) quyền avi_app không đổi (không TRUNCATE); hàng cũ nguyên.
 *   node scripts/apply-migration-0443.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL (dải 0443–0444 cấp cho lô 11.8).
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0443_ai_phien_nguon_cli.sql",
  tag: "[0443]",
  async verify({ appSql, log }) {
    const [u] = await appSql`SELECT id FROM public.users ORDER BY id LIMIT 1`;
    const r = await rolledBack(appSql, async (tx) => {
      const ok = {};
      for (const nguon of ["web", "vscode", "cli"]) {
        ok[nguon] = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_coding_sessions ("userId","projectId","source") VALUES (${u.id}, 'probe0443', ${nguon})`);
      }
      const sai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_coding_sessions ("userId","projectId","source") VALUES (${u.id}, 'probe0443', 'khac')`);
      return { ...ok, sai };
    });
    expectExact("(a) behaviour", r, { web: null, vscode: null, cli: null, sai: "23514" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_coding_sessions WHERE "projectId"='probe0443'`;
    if (left.n !== 0) throw new Error("(a) probe NOT rolled back");
    log(`(a) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    const p = await tablePriv(appSql, "public.ai_coding_sessions");
    expectExact("(b) privileges avi_app", p, { sel: true, ins: true, upd: true, del: true, trunc: false });
    log("(b) quyền DML giữ nguyên, không TRUNCATE");
  },
});
