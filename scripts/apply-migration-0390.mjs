#!/usr/bin/env node
/**
 * 0390 — Đợt 1 · T4 (AI Local): bảng `ai_agent_runs` (sổ lượt chạy vòng agent máy chủ). Áp
 * `drizzle/0390_ai_agent_runs.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng `avi_app` (khuôn 0363–0378,
 * bộ chạy chung apply-migration-dot10-common.mjs — đúng MỘT cờ đích, lock_timeout 5 s, statement_timeout 60 s, vai
 * nghiệm thu không superuser/BYPASSRLS, sổ `__applied_migrations`):
 *   (a) danh mục: 17 cột đúng kiểu; 5 CHECK; 2 chỉ mục; KHÔNG có hàm nào (nên không search_path nào phải ghim);
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có, TRUNCATE/REFERENCES/TRIGGER không;
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app): chèn một lượt chạy hợp lệ ⇒ mặc định đúng
 *       (dang-chay, 0, [], []); projectId là ĐƯỜNG DẪN ⇒ 23514; cheDo lạ ⇒ 23514; trangThai lạ ⇒ 23514; suKien
 *       không phải mảng ⇒ 23514; đếm âm ⇒ 23514; userId không tồn tại ⇒ 23503; đổi sang `gian-doan` được; 0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0390.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BANG = "ai_agent_runs";
const COT = {
  id: "uuid",
  userId: "integer",
  projectId: "character varying",
  cheDo: "character varying",
  cauHoi: "text",
  trangThai: "character varying",
  lyDoDung: "character varying",
  soLuot: "integer",
  tokenVao: "integer",
  tokenRa: "integer",
  tokenNghi: "integer",
  suKien: "jsonb",
  checkpointIds: "jsonb",
  tomTat: "text",
  sessionId: "uuid",
  createdAt: "timestamp without time zone",
  updatedAt: "timestamp without time zone",
};
const CHECKS = [
  "chk_ai_agent_runs_che_do",
  "chk_ai_agent_runs_dem",
  "chk_ai_agent_runs_mang",
  "chk_ai_agent_runs_project_id",
  "chk_ai_agent_runs_trang_thai",
];

await runMigration({
  file: "0390_ai_agent_runs.sql",
  tag: "[0390]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${BANG}`;
    expectExact("(a) columns", Object.fromEntries(cols.map((r) => [r.c, r.t])), COT);
    if (cols.length !== Object.keys(COT).length) throw new Error(`(a) ${cols.length} columns, want ${Object.keys(COT).length}`);
    const ck = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_agent_runs'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { ck }, { ck: CHECKS });
    const idx = (await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${BANG} AND indexname <> 'ai_agent_runs_pkey' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) indexes", { idx }, { idx: ["ai_agent_runs_owner_idx", "ai_agent_runs_song_idx"] });
    log(`(a) ${cols.length} columns · ${ck.length} CHECK · ${idx.length} indexes`);

    // (b) quyền
    const pr = await tablePriv(appSql, `public.${BANG}`);
    expectExact("(b) privileges", pr, { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const CODE = `__probe_0390_${Date.now()}`;
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [u] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE}, 'engineer', true) RETURNING id`;
      const ins = (sp, o) =>
        sp`INSERT INTO public.ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi", "trangThai")
           VALUES (${o.id ?? randomUUID()}, ${o.userId ?? u.id}, ${o.projectId ?? "probe-0390"}, ${o.cheDo ?? "sua"}, 'probe', ${o.trangThai ?? "dang-chay"})`;
      const id = randomUUID();
      out.hopLe = await maLoi(tx, (sp) => ins(sp, { id }));
      const [h] = await tx`SELECT "trangThai" AS t, "soLuot" AS s, "suKien" AS e, "checkpointIds" AS c FROM public.ai_agent_runs WHERE id = ${id}`;
      out.macDinh = h ? [h.t, h.s, JSON.stringify(h.e), JSON.stringify(h.c)].join("|") : null;
      out.duongDan = await maLoi(tx, (sp) => ins(sp, { projectId: "D:\\SOURCES\\x" }));
      out.duongDanPosix = await maLoi(tx, (sp) => ins(sp, { projectId: "../etc" }));
      out.cheDoLa = await maLoi(tx, (sp) => ins(sp, { cheDo: "root" }));
      out.trangThaiLa = await maLoi(tx, (sp) => ins(sp, { trangThai: "chay-ngam" }));
      out.suKienObject = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "suKien" = '{}'::jsonb WHERE id = ${id}`);
      out.demAm = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "tokenRa" = -1 WHERE id = ${id}`);
      out.userLa = await maLoi(tx, (sp) => ins(sp, { userId: -987654 }));
      out.gianDoan = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "trangThai" = 'gian-doan', "updatedAt" = now() WHERE id = ${id}`);
      return out;
    });
    expectExact("(c) behaviour", r, {
      hopLe: null,
      macDinh: "dang-chay|0|[]|[]",
      duongDan: "23514",
      duongDanPosix: "23514",
      cheDoLa: "23514",
      trangThaiLa: "23514",
      suKienObject: "23514",
      demAm: "23514",
      userLa: "23503",
      gianDoan: null,
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_agent_runs WHERE "projectId" = 'probe-0390'`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
