#!/usr/bin/env node
/**
 * 0391 — Đợt 2 (AI Local): bảng `ai_code_chunks` (chỉ mục ngữ nghĩa mã nguồn theo dự án, pgvector). Áp
 * `drizzle/0391_ai_code_chunks.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app` (khuôn 0390, bộ chạy
 * chung apply-migration-dot10-common.mjs — đúng MỘT cờ đích, lock_timeout 5 s, statement_timeout 60 s, vai nghiệm thu
 * không superuser/BYPASSRLS, sổ `__applied_migrations`):
 *   (a) danh mục: 10 cột đúng kiểu (`embedding` là `vector(1024)`); 4 CHECK; 1 chỉ mục ngoài khoá chính (KHÔNG HNSW —
 *       xem đầu tệp SQL vì sao); KHÔNG có hàm nào;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có, TRUNCATE/REFERENCES/TRIGGER không;
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app): chèn một đoạn hợp lệ ⇒ id/capNhat mặc định; projectId là
 *       ĐƯỜNG DẪN ⇒ 23514; duong tuyệt đối / có `..` / có `\` ⇒ 23514; băm không phải hex64 ⇒ 23514; dòng ngược ⇒ 23514;
 *       vector sai số chiều ⇒ 22000; cosine `<=>` chạy và lọc theo projectId; 0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0391.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BANG = "ai_code_chunks";
const COT = {
  id: "uuid",
  projectId: "character varying",
  duong: "character varying",
  bam: "character",
  dongDau: "integer",
  dongCuoi: "integer",
  noiDung: "text",
  moHinh: "character varying",
  embedding: "USER-DEFINED",
  capNhat: "timestamp without time zone",
};
const CHECKS = ["chk_ai_code_chunks_bam", "chk_ai_code_chunks_dong", "chk_ai_code_chunks_duong", "chk_ai_code_chunks_project_id"];
const BAM = "a".repeat(64);
const vec = (dau, n = 1024) => `[${Array.from({ length: n }, (_, i) => (i === 0 ? dau : 0)).join(",")}]`;

await runMigration({
  file: "0391_ai_code_chunks.sql",
  tag: "[0391]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${BANG}`;
    expectExact("(a) columns", Object.fromEntries(cols.map((r) => [r.c, r.t])), COT);
    if (cols.length !== Object.keys(COT).length) throw new Error(`(a) ${cols.length} columns, want ${Object.keys(COT).length}`);
    const [kieu] = await appSql`SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a WHERE a.attrelid = 'public.ai_code_chunks'::regclass AND a.attname = 'embedding'`;
    expectExact("(a) embedding type", kieu, { t: "vector(1024)" });
    const ck = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_code_chunks'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { ck }, { ck: CHECKS });
    const idx = (await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${BANG} AND indexname <> 'ai_code_chunks_pkey' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) indexes", { idx }, { idx: ["ai_code_chunks_du_an_tep_idx"] });
    log(`(a) ${cols.length} columns (embedding ${kieu.t}) · ${ck.length} CHECK · ${idx.length} index (no HNSW by design)`);

    // (b) quyền
    const pr = await tablePriv(appSql, `public.${BANG}`);
    expectExact("(b) privileges", pr, { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const ins = (sp, o) =>
        sp`INSERT INTO public.ai_code_chunks ("projectId", duong, bam, "dongDau", "dongCuoi", "noiDung", "moHinh", embedding)
           VALUES (${o.projectId ?? "probe-0391"}, ${o.duong ?? "src/a.ts"}, ${o.bam ?? BAM}, ${o.dongDau ?? 1}, ${o.dongCuoi ?? 3},
                   'probe', 'probe-model', ${o.vec ?? vec(1)}::vector)`;
      out.hopLe = await maLoi(tx, (sp) => ins(sp, {}));
      const [h] = await tx`SELECT (id IS NOT NULL) AS co_id, ("capNhat" IS NOT NULL) AS co_gio FROM public.ai_code_chunks WHERE "projectId" = 'probe-0391'`;
      out.macDinh = h ? `${h.co_id}|${h.co_gio}` : null;
      out.duAnDuongDan = await maLoi(tx, (sp) => ins(sp, { projectId: "D:\\SOURCES\\x" }));
      out.duongTuyetDoi = await maLoi(tx, (sp) => ins(sp, { duong: "/etc/passwd" }));
      out.duongODia = await maLoi(tx, (sp) => ins(sp, { duong: "C:/x.ts" }));
      out.duongLui = await maLoi(tx, (sp) => ins(sp, { duong: "src/../../x.ts" }));
      out.duongGachNguoc = await maLoi(tx, (sp) => ins(sp, { duong: "src\\x.ts" }));
      out.bamSai = await maLoi(tx, (sp) => ins(sp, { bam: "Z".repeat(64) }));
      out.dongNguoc = await maLoi(tx, (sp) => ins(sp, { dongDau: 5, dongCuoi: 2 }));
      out.vectorSaiChieu = await maLoi(tx, (sp) => ins(sp, { vec: vec(1, 3) }));
      await maLoi(tx, (sp) => ins(sp, { projectId: "probe-0391-khac", vec: vec(-1) }));
      const tim = await tx`SELECT "projectId" AS p, 1 - (embedding <=> ${vec(1)}::vector) AS diem
                             FROM public.ai_code_chunks WHERE "projectId" = 'probe-0391' ORDER BY embedding <=> ${vec(1)}::vector LIMIT 5`;
      out.cosine = tim.map((x) => `${x.p}:${Number(x.diem).toFixed(3)}`).join(",");
      return out;
    });
    expectExact("(c) behaviour", r, {
      hopLe: null,
      macDinh: "true|true",
      duAnDuongDan: "23514",
      duongTuyetDoi: "23514",
      duongODia: "23514",
      duongLui: "23514",
      duongGachNguoc: "23514",
      bamSai: "23514",
      dongNguoc: "23514",
      vectorSaiChieu: "22000",
      cosine: "probe-0391:1.000",
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_code_chunks WHERE "projectId" LIKE 'probe-0391%'`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
