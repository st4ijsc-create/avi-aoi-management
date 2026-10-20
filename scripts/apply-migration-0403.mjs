#!/usr/bin/env node
/**
 * 0403 — BÍ MẬT Luồng AI (AI Local Đợt 8.2 Task 1): bảng `ai_flow_credentials`. Áp `drizzle/0403_ai_flow_credentials.sql`
 * bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) bảng + 3 CHECK đúng tên; KHÔNG có cột nào tên gợi giá trị rõ (value/giaTri/plain…);
 *   (b) quyền avi_app S/I/U/D, không TRUNCATE/REFERENCES/TRIGGER;
 *   (c) giao dịch hoàn tác: id `../x` ⇒ 23514; loại lạ ⇒ 23514; iv 11 byte ⇒ 23514; tag 15 byte ⇒ 23514; phienBanKhoa 0 ⇒ 23514;
 *       hàng hợp lệ ⇒ OK; trùng id ⇒ 23505;
 *   (d) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0403.mjs --test-only | --dev-only | --both
 */
import { columnsOf, expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const CHECKS = ["chk_ai_flow_credentials_id", "chk_ai_flow_credentials_loai", "chk_ai_flow_credentials_ma"];
const COT = ["banMa", "createdAt", "createdBy", "id", "iv", "loai", "phienBanKhoa", "tag", "ten"];

await runMigration({
  file: "0403_ai_flow_credentials.sql",
  tag: "[0403]",
  async verify({ appSql, log }) {
    const bang = (await appSql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name = 'ai_flow_credentials'`).map((r) => r.t);
    expectExact("(a) table", { bang }, { bang: ["ai_flow_credentials"] });
    const checks = (await appSql`SELECT conname AS n FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_ai_flow_credentials%' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { checks }, { checks: CHECKS });
    const cot = (await columnsOf(appSql, "ai_flow_credentials")).sort();
    expectExact("(a) columns", { cot }, { cot: COT });
    expectExact("(b) ai_flow_credentials", await tablePriv(appSql, "public.ai_flow_credentials"), { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    log("(a) table + 3 CHECK + 9 columns (no plaintext column) · (b) avi_app S/I/U/D, no TRUNCATE/REFERENCES/TRIGGER");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const b = (n) => Buffer.alloc(n, 7);
      const chen = (id, loai, iv, tag, pb) => (sp) =>
        sp`INSERT INTO public.ai_flow_credentials (id, ten, loai, "banMa", iv, tag, "phienBanKhoa") VALUES (${id}, 'dò', ${loai}, ${b(5)}, ${iv}, ${tag}, ${pb})`;
      out.idXau = await maLoi(tx, chen("../x", "token", b(12), b(16), 1));
      out.loaiLa = await maLoi(tx, chen("probe0403", "la", b(12), b(16), 1));
      out.ivNgan = await maLoi(tx, chen("probe0403", "token", b(11), b(16), 1));
      out.tagNgan = await maLoi(tx, chen("probe0403", "token", b(12), b(15), 1));
      out.phienBan0 = await maLoi(tx, chen("probe0403", "token", b(12), b(16), 0));
      out.hopLe = await maLoi(tx, chen("probe0403", "token", b(12), b(16), 1));
      out.trung = await maLoi(tx, chen("probe0403", "khac", b(12), b(16), 2));
      return out;
    });
    expectExact("(c) behaviour", r, { idXau: "23514", loaiLa: "23514", ivNgan: "23514", tagNgan: "23514", phienBan0: "23514", hopLe: null, trung: "23505" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flow_credentials WHERE id = 'probe0403'`;
    if (left.n !== 0) throw new Error("(c) probe NOT rolled back");
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
