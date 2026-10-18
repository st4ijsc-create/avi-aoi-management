#!/usr/bin/env node
/**
 * 0397 — hai bảng AI Local Đợt 5: `ai_agent_feedback` (phản hồi 👍/👎 + diff duyệt/bác, CHỈ CHỦ) và `kb_eval_ma_runs`
 * (lượt eval mã A/B corpus của Training Studio). Áp `drizzle/0397_ai_phan_hoi_eval_ma.sql` bằng owner `aoi`, rồi NGHIỆM
 * THU bằng vai `avi_app` (khuôn 0395, bộ chạy chung apply-migration-dot10-common.mjs):
 *   (a) danh mục: cột đúng kiểu (mốc giờ `timestamptz`) cho CẢ HAI bảng; CHECK đúng tên; 2 chỉ mục UNIQUE một phần;
 *       KHÔNG hàm nào (không có search_path phải ghim);
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có, TRUNCATE/REFERENCES/TRIGGER không (cả hai bảng);
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app):
 *       ai_agent_feedback — phiếu tra-loi hợp lệ ⇒ được, mặc định id/giờ đủ; trùng (user, run, khối) ⇒ 23505; tra-loi
 *       thiếu runId ⇒ 23514; tra-loi mang actionId ⇒ 23514; tra-loi không phiếu ⇒ 23514; danhGia 2 ⇒ 23514; diff chỉ có
 *       quyết định (chưa phiếu) ⇒ được; trùng (user, action) ⇒ 23505; diff không phiếu + không quyết định ⇒ 23514;
 *       lyDoBac với quyết định duyet ⇒ 23514; projectId là ĐƯỜNG DẪN ⇒ 23514; loai lạ ⇒ 23514;
 *       kb_eval_ma_runs — dang-chay hợp lệ ⇒ được; trạng thái lạ ⇒ 23514; xong thiếu ketThuc ⇒ 23514; xong thiếu
 *       tongHop ⇒ 23514; tienDo 101 ⇒ 23514; soLap 0 ⇒ 23514; ketQua không phải mảng ⇒ 23514; chốt xong + ketThuc +
 *       tongHop ⇒ được; 0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0397.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const COT_PHAN_HOI = {
  id: "uuid",
  userId: "integer",
  loai: "character varying",
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
const COT_EVAL_MA = {
  id: "uuid",
  corpus: "character varying",
  boBai: "character varying",
  boBaiHash: "character varying",
  trangThai: "character varying",
  tienDo: "integer",
  soBai: "integer",
  soLap: "integer",
  tongHop: "jsonb",
  ketQua: "jsonb",
  lyDo: "character varying",
  tienTrinh: "character varying",
  createdBy: "integer",
  batDau: "timestamp with time zone",
  ketThuc: "timestamp with time zone",
  capNhat: "timestamp with time zone",
};
const CHECKS_PHAN_HOI = [
  "chk_ai_agent_feedback_danh_gia",
  "chk_ai_agent_feedback_hinh_dang",
  "chk_ai_agent_feedback_loai",
  "chk_ai_agent_feedback_project_id",
  "chk_ai_agent_feedback_quyet_dinh",
];
const CHECKS_EVAL_MA = [
  "chk_kb_eval_ma_runs_dem",
  "chk_kb_eval_ma_runs_ket_thuc",
  "chk_kb_eval_ma_runs_tong_hop",
  "chk_kb_eval_ma_runs_trang_thai",
];

async function cotCua(appSql, bang) {
  const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${bang}`;
  return Object.fromEntries(cols.map((r) => [r.c, r.t]));
}
async function checkCua(appSql, bang) {
  return (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = ${`public.${bang}`}::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
}

await runMigration({
  file: "0397_ai_phan_hoi_eval_ma.sql",
  tag: "[0397]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const c1 = await cotCua(appSql, "ai_agent_feedback");
    expectExact("(a) ai_agent_feedback columns", c1, COT_PHAN_HOI);
    if (Object.keys(c1).length !== Object.keys(COT_PHAN_HOI).length) throw new Error(`(a) ai_agent_feedback has ${Object.keys(c1).length} columns`);
    const c2 = await cotCua(appSql, "kb_eval_ma_runs");
    expectExact("(a) kb_eval_ma_runs columns", c2, COT_EVAL_MA);
    if (Object.keys(c2).length !== Object.keys(COT_EVAL_MA).length) throw new Error(`(a) kb_eval_ma_runs has ${Object.keys(c2).length} columns`);
    expectExact("(a) checks", { a: await checkCua(appSql, "ai_agent_feedback"), b: await checkCua(appSql, "kb_eval_ma_runs") }, { a: CHECKS_PHAN_HOI, b: CHECKS_EVAL_MA });
    const uq = (
      await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ai_agent_feedback'
                    AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE%' ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) partial unique", { uq }, { uq: ["ai_agent_feedback_diff_uq", "ai_agent_feedback_tra_loi_uq"] });
    log(`(a) ${Object.keys(c1).length}+${Object.keys(c2).length} columns · ${CHECKS_PHAN_HOI.length}+${CHECKS_EVAL_MA.length} CHECK · 2 partial UNIQUE`);

    // (b) quyền
    const quyen = { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false };
    expectExact("(b) ai_agent_feedback privileges", await tablePriv(appSql, "public.ai_agent_feedback"), quyen);
    expectExact("(b) kb_eval_ma_runs privileges", await tablePriv(appSql, "public.kb_eval_ma_runs"), quyen);
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE on both; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const [u] = await appSql`SELECT id FROM public.users ORDER BY id LIMIT 1`;
    if (!u) throw new Error("(c) no users row to probe with");
    const run = randomUUID();
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const ph = (sp, o) =>
        sp`INSERT INTO public.ai_agent_feedback ("userId", loai, "runId", "chiSoTin", "actionId", "projectId", "danhGia", "quyetDinh", "lyDoBac")
           VALUES (${u.id}, ${o.loai ?? "tra-loi"}, ${o.runId === undefined ? run : o.runId}, ${o.chiSoTin === undefined ? 0 : o.chiSoTin},
                   ${o.actionId ?? null}, ${o.projectId ?? "probe-0397"}, ${o.danhGia === undefined ? 1 : o.danhGia},
                   ${o.quyetDinh ?? null}, ${o.lyDoBac ?? null})`;
      const diff = (o) => ({ loai: "diff", runId: null, chiSoTin: null, actionId: "probe-0397-act", danhGia: null, ...o });
      out.traLoiHopLe = await maLoi(tx, (sp) => ph(sp, {}));
      const [h] = await tx`SELECT (id IS NOT NULL AND "createdAt" IS NOT NULL AND "updatedAt" IS NOT NULL) AS d
                             FROM public.ai_agent_feedback WHERE "projectId" = 'probe-0397' AND loai = 'tra-loi'`;
      out.macDinh = h ? h.d : null;
      out.trungTraLoi = await maLoi(tx, (sp) => ph(sp, {}));
      out.traLoiThieuRun = await maLoi(tx, (sp) => ph(sp, { runId: null, chiSoTin: 1 }));
      out.traLoiCoAction = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 2, actionId: "x" }));
      out.traLoiKhongPhieu = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 3, danhGia: null }));
      out.danhGiaLa = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 4, danhGia: 2 }));
      out.diffChiQuyetDinh = await maLoi(tx, (sp) => ph(sp, diff({ quyetDinh: "duyet" })));
      out.trungDiff = await maLoi(tx, (sp) => ph(sp, diff({ quyetDinh: "bac" })));
      out.diffRong = await maLoi(tx, (sp) => ph(sp, diff({ actionId: "probe-0397-act-2" })));
      out.lyDoBacKhiDuyet = await maLoi(tx, (sp) => ph(sp, diff({ actionId: "probe-0397-act-3", quyetDinh: "duyet", lyDoBac: "x" })));
      out.duAnDuongDan = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 5, projectId: "D:\\SOURCES\\x" }));
      out.loaiLa = await maLoi(tx, (sp) => ph(sp, { chiSoTin: 6, loai: "khac" }));

      const ev = (sp, o) =>
        sp`INSERT INTO public.kb_eval_ma_runs (id, corpus, "boBai", "boBaiHash", "trangThai", "tienDo", "soBai", "soLap", "tongHop", "ketQua", "tienTrinh", "ketThuc")
           VALUES (${o.id ?? randomUUID()}, 'probe-0397', 'tasks-hard', 'abc', ${o.trangThai ?? "dang-chay"}, ${o.tienDo ?? 0}, 12, ${o.soLap ?? 1},
                   ${o.tongHop === undefined ? null : sp.json(o.tongHop)}, ${o.ketQua === undefined ? sp.json([]) : sp.json(o.ketQua)}, 'probe-host:1',
                   ${o.ketThuc ? new Date() : null})`;
      const idEval = randomUUID();
      out.evalHopLe = await maLoi(tx, (sp) => ev(sp, { id: idEval }));
      out.evalTrangThaiLa = await maLoi(tx, (sp) => ev(sp, { trangThai: "dang-cho", ketThuc: true }));
      out.evalXongThieuKetThuc = await maLoi(tx, (sp) => ev(sp, { trangThai: "xong", tongHop: { a: 1 } }));
      out.evalXongThieuTongHop = await maLoi(tx, (sp) => ev(sp, { trangThai: "xong", ketThuc: true }));
      out.evalTienDo101 = await maLoi(tx, (sp) => ev(sp, { tienDo: 101 }));
      out.evalSoLap0 = await maLoi(tx, (sp) => ev(sp, { soLap: 0 }));
      out.evalKetQuaKhongMang = await maLoi(tx, (sp) => ev(sp, { ketQua: { a: 1 } }));
      out.evalChotXong = await maLoi(
        tx,
        (sp) => sp`UPDATE public.kb_eval_ma_runs SET "trangThai" = 'xong', "ketThuc" = now(), "tongHop" = '{"tut":false}'::jsonb, "tienDo" = 100
                    WHERE id = ${idEval}`,
      );
      return out;
    });
    expectExact("(c) behaviour", r, {
      traLoiHopLe: null,
      macDinh: true,
      trungTraLoi: "23505",
      traLoiThieuRun: "23514",
      traLoiCoAction: "23514",
      traLoiKhongPhieu: "23514",
      danhGiaLa: "23514",
      diffChiQuyetDinh: null,
      trungDiff: "23505",
      diffRong: "23514",
      lyDoBacKhiDuyet: "23514",
      duAnDuongDan: "23514",
      loaiLa: "23514",
      evalHopLe: null,
      evalTrangThaiLa: "23514",
      evalXongThieuKetThuc: "23514",
      evalXongThieuTongHop: "23514",
      evalTienDo101: "23514",
      evalSoLap0: "23514",
      evalKetQuaKhongMang: "23514",
      evalChotXong: null,
    });
    const [left1] = await appSql`SELECT count(*)::int AS n FROM public.ai_agent_feedback WHERE "projectId" = 'probe-0397' OR "actionId" LIKE 'probe-0397%'`;
    const [left2] = await appSql`SELECT count(*)::int AS n FROM public.kb_eval_ma_runs WHERE corpus = 'probe-0397'`;
    if (left1.n !== 0 || left2.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left1.n}+${left2.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
