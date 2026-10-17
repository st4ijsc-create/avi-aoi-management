#!/usr/bin/env node
/**
 * 0393 — Đợt 3a (AI Local): dự án CÁ NHÂN của kỹ sư trên `ai_repo_du_an` (hai cột `chuSoHuu`/`cachTao` + CHECK + chỉ
 * mục + UPDATE MỘT cột `ten`). Áp `drizzle/0393_ai_repo_du_an_ca_nhan.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai
 * ứng dụng `avi_app` (bộ chạy chung apply-migration-dot10-common.mjs — đúng MỘT cờ đích, lock_timeout 5 s):
 *   (a) danh mục: 7 cột đúng kiểu; 5 CHECK (2 của 0337 + 3 mới); chỉ mục chủ sở hữu;
 *   (b) quyền avi_app: SELECT/INSERT/DELETE; UPDATE CHỈ cột `ten`; không TRUNCATE/REFERENCES/TRIGGER;
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC: hàng admin cũ (hai cột NULL) vẫn chèn được; hàng cá nhân hợp lệ;
 *       chủ không cách tạo ⇒ 23514; cách tạo lạ ⇒ 23514; chủ ≤ 0 ⇒ 23514; UPDATE ten được; UPDATE goc ⇒ 42501;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0393.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối)
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

const COT = {
  id: "character varying",
  ten: "character varying",
  goc: "text",
  nguoiTao: "integer",
  createdAt: "timestamp with time zone",
  chuSoHuu: "integer",
  cachTao: "character varying",
};
const CHECKS = [
  "chk_ai_repo_du_an_ca_nhan",
  "chk_ai_repo_du_an_cach_tao",
  "chk_ai_repo_du_an_chu",
  "chk_ai_repo_du_an_id",
  "chk_ai_repo_du_an_ten",
];

await runMigration({
  file: "0393_ai_repo_du_an_ca_nhan.sql",
  tag: "[0393]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_repo_du_an'`;
    const ct = Object.fromEntries(cols.map((r) => [r.c, r.t]));
    expectExact("(a) columns", ct, COT);
    if (Object.keys(ct).length !== Object.keys(COT).length) throw new Error(`(a) ${Object.keys(ct).length} columns`);
    const ck = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_repo_du_an'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { ck }, { ck: CHECKS });
    const idx = (await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ai_repo_du_an' AND indexname NOT LIKE '%_pkey' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) indexes", { idx }, { idx: ["ai_repo_du_an_chu_idx"] });
    log(`(a) ${Object.keys(ct).length} columns · ${ck.length} CHECK · ${idx.length} index`);

    expectExact("(b) table privs", await tablePriv(appSql, "public.ai_repo_du_an"), {
      sel: true, ins: true, upd: false, del: true, trunc: false, refs: false, trig: false,
    });
    const upd = await updatableCols(appSql, "public.ai_repo_du_an", Object.keys(COT));
    expectExact("(b) updatable columns", { upd }, { upd: ["ten"] });
    log("(b) avi_app: SELECT/INSERT/DELETE + UPDATE(ten) only");

    const TAG = `probe0393-${Date.now().toString(36)}`;
    const r = await rolledBack(appSql, async (tx) => {
      const ins = (sp, o) =>
        sp`INSERT INTO public.ai_repo_du_an (id, ten, goc, "nguoiTao", "chuSoHuu", "cachTao")
           VALUES (${o.id}, 'probe-0393', 'D:\\probe', 1, ${o.chu ?? null}, ${o.cach ?? null})`;
      const out = {};
      out.hangAdmin = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-a` }));
      out.hangCaNhan = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-b`, chu: 7, cach: "khuon" }));
      out.chuKhongCach = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-c`, chu: 7 }));
      out.cachKhongChu = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-d`, cach: "zip" }));
      out.cachLa = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-e`, chu: 7, cach: "http" }));
      out.chuAm = await maLoi(tx, (sp) => ins(sp, { id: `${TAG}-f`, chu: 0, cach: "rong" }));
      out.doiTen = await maLoi(tx, (sp) => sp`UPDATE public.ai_repo_du_an SET ten = 'doi-ten' WHERE id = ${`${TAG}-b`}`);
      out.doiGoc = await maLoi(tx, (sp) => sp`UPDATE public.ai_repo_du_an SET goc = 'C:\\' WHERE id = ${`${TAG}-b`}`);
      out.doiChu = await maLoi(tx, (sp) => sp`UPDATE public.ai_repo_du_an SET "chuSoHuu" = 8 WHERE id = ${`${TAG}-b`}`);
      return out;
    });
    expectExact("(c) behaviour", r, {
      hangAdmin: null,
      hangCaNhan: null,
      chuKhongCach: "23514",
      cachKhongChu: "23514",
      cachLa: "23514",
      chuAm: "23514",
      doiTen: null,
      doiGoc: "42501",
      doiChu: "42501",
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_repo_du_an WHERE id LIKE ${`${TAG}%`}`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
