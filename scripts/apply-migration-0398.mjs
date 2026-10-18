#!/usr/bin/env node
/**
 * 0398 — `ai_agent_feedback` nhận phiếu của lượt agent CHẠY CỤC BỘ trong extension VSCode (AI Local Đợt 5.1 phía VSCode):
 * cột `nguon` (`web` | `vscode`) + `luotClient` (uuid client), chỉ mục UNIQUE một phần `ai_agent_feedback_vscode_uq`, CHECK
 * hình dạng thay bản mới + CHECK nguồn. Áp `drizzle/0398_ai_phan_hoi_nguon_client.sql` bằng owner `aoi`, rồi NGHIỆM THU
 * bằng vai `avi_app` (khuôn 0397, bộ chạy chung apply-migration-dot10-common.mjs):
 *   (a) danh mục: 18 cột đúng kiểu; 6 CHECK đúng tên; 3 chỉ mục UNIQUE một phần; mọi hàng cũ mang `nguon = 'web'`;
 *   (b) quyền avi_app giữ nguyên (SELECT/INSERT/UPDATE/DELETE có; TRUNCATE/REFERENCES/TRIGGER không);
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app):
 *       vscode hợp lệ ⇒ được, `nguon`/`luotClient` đúng; trùng (user, luotClient, khối) ⇒ 23505; cùng luotClient khác khối
 *       ⇒ được; vscode thiếu luotClient ⇒ 23514; vscode mang runId ⇒ 23514; vscode không văn bản ⇒ 23514; vscode văn bản
 *       100001 ký tự ⇒ 23514; vscode câu hỏi 20001 ký tự ⇒ 23514; vscode loại diff ⇒ 23514; web mang luotClient ⇒ 23514;
 *       nguồn lạ ⇒ 23514; tra-loi web hợp lệ (mặc định nguồn) ⇒ được, nguon = 'web'; web không runId (chỉ luotClient) ⇒
 *       23514; diff web vẫn được; 0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0398.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const COT = {
  id: "uuid",
  userId: "integer",
  loai: "character varying",
  nguon: "character varying",
  luotClient: "uuid",
  runId: "uuid",
  chiSoTin: "integer",
  actionId: "character varying",
  projectId: "character varying",
  danhGia: "smallint",
  lyDo: "character varying",
  quyetDinh: "character varying",
  lyDoBac: "character varying",
  cauHoi: "text",
  noiDung: "text",
  duongDan: "character varying",
  createdAt: "timestamp with time zone",
  updatedAt: "timestamp with time zone",
};
const CHECKS = [
  "chk_ai_agent_feedback_danh_gia",
  "chk_ai_agent_feedback_hinh_dang",
  "chk_ai_agent_feedback_loai",
  "chk_ai_agent_feedback_nguon",
  "chk_ai_agent_feedback_project_id",
  "chk_ai_agent_feedback_quyet_dinh",
];

await runMigration({
  file: "0398_ai_phan_hoi_nguon_client.sql",
  tag: "[0398]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'ai_agent_feedback'`;
    const c = Object.fromEntries(cols.map((r) => [r.c, r.t]));
    expectExact("(a) columns", c, COT);
    if (cols.length !== Object.keys(COT).length) throw new Error(`(a) ai_agent_feedback has ${cols.length} columns`);
    const checks = (
      await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_agent_feedback'::regclass AND contype = 'c' ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) checks", { checks }, { checks: CHECKS });
    const uq = (
      await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ai_agent_feedback'
                    AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE%' ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) partial unique", { uq }, { uq: ["ai_agent_feedback_diff_uq", "ai_agent_feedback_tra_loi_uq", "ai_agent_feedback_vscode_uq"] });
    const [cu] = await appSql`SELECT count(*) FILTER (WHERE nguon <> 'web')::int AS khac, count(*)::int AS tong FROM public.ai_agent_feedback`;
    if (cu.khac !== 0) throw new Error(`(a) ${cu.khac} existing rows are not nguon='web' right after the migration`);
    log(`(a) ${cols.length} columns · ${CHECKS.length} CHECK · 3 partial UNIQUE · ${cu.tong} existing row(s) all nguon='web'`);

    // (b) quyền
    expectExact("(b) privileges", await tablePriv(appSql, "public.ai_agent_feedback"), {
      sel: true,
      ins: true,
      upd: true,
      del: true,
      trunc: false,
      refs: false,
      trig: false,
    });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const [u] = await appSql`SELECT id FROM public.users ORDER BY id LIMIT 1`;
    if (!u) throw new Error("(c) no users row to probe with");
    const luot = randomUUID();
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const ph = (sp, o) =>
        sp`INSERT INTO public.ai_agent_feedback ("userId", loai, nguon, "luotClient", "runId", "chiSoTin", "actionId", "projectId", "danhGia", "quyetDinh", "cauHoi", "noiDung")
           VALUES (${u.id}, ${o.loai ?? "tra-loi"}, ${o.nguon ?? "vscode"}, ${o.luotClient === undefined ? luot : o.luotClient},
                   ${o.runId ?? null}, ${o.chiSoTin === undefined ? 0 : o.chiSoTin}, ${o.actionId ?? null}, 'probe-0398',
                   ${o.danhGia === undefined ? 1 : o.danhGia}, ${o.quyetDinh ?? null},
                   ${o.cauHoi === undefined ? "hỏi" : o.cauHoi}, ${o.noiDung === undefined ? "trả lời" : o.noiDung})`;
      out.vscodeHopLe = await maLoi(tx, (sp) => ph(sp, {}));
      const [h] = await tx`SELECT nguon, "luotClient" AS l FROM public.ai_agent_feedback WHERE "projectId" = 'probe-0398' AND "chiSoTin" = 0`;
      out.ghiDung = h ? h.nguon === "vscode" && h.l === luot : null;
      out.trungKhoa = await maLoi(tx, (sp) => ph(sp, {}));
      out.khacKhoi = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 1 }));
      out.thieuLuot = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 2, luotClient: null }));
      out.vscodeCoRun = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 3, runId: randomUUID() }));
      out.vscodeKhongChu = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 4, noiDung: null }));
      out.vscodeChuQuaTran = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 5, noiDung: "x".repeat(100_001) }));
      out.vscodeHoiQuaTran = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 6, cauHoi: "x".repeat(20_001) }));
      out.vscodeDiff = await maLoi(tx, (sp) => ph(sp, { loai: "diff", chiSoTin: null, actionId: "probe-0398-act", danhGia: null, quyetDinh: "duyet" }));
      out.webCoLuot = await maLoi(tx, (sp) => ph(sp, { nguon: "web", chiSoTin: 7, runId: randomUUID() }));
      out.nguonLa = await maLoi(tx, (sp) => ph(sp, { nguon: "cli", chiSoTin: 8 }));
      out.webHopLe = await maLoi(
        tx,
        (sp) => sp`INSERT INTO public.ai_agent_feedback ("userId", loai, "runId", "chiSoTin", "projectId", "danhGia")
                   VALUES (${u.id}, 'tra-loi', ${randomUUID()}, 9, 'probe-0398', 1)`,
      );
      const [w] = await tx`SELECT nguon FROM public.ai_agent_feedback WHERE "projectId" = 'probe-0398' AND "chiSoTin" = 9`;
      out.webMacDinh = w ? w.nguon : null;
      out.webChiLuot = await maLoi(tx, (sp) => ph(sp, { nguon: "web", chiSoTin: 10 }));
      out.diffWeb = await maLoi(
        tx,
        (sp) => sp`INSERT INTO public.ai_agent_feedback ("userId", loai, "actionId", "projectId", "quyetDinh")
                   VALUES (${u.id}, 'diff', 'probe-0398-act-2', 'probe-0398', 'duyet')`,
      );
      return out;
    });
    expectExact("(c) behaviour", r, {
      vscodeHopLe: null,
      ghiDung: true,
      trungKhoa: "23505",
      khacKhoi: null,
      thieuLuot: "23514",
      vscodeCoRun: "23514",
      vscodeKhongChu: "23514",
      vscodeChuQuaTran: "23514",
      vscodeHoiQuaTran: "23514",
      vscodeDiff: "23514",
      webCoLuot: "23514",
      nguonLa: "23514",
      webHopLe: null,
      webMacDinh: "web",
      webChiLuot: "23514",
      diffWeb: null,
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_agent_feedback WHERE "projectId" = 'probe-0398' OR "actionId" LIKE 'probe-0398%'`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
