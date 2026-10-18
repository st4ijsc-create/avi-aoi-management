#!/usr/bin/env node
/**
 * 0395 — bảng `ai_code_index_state` (trạng thái lượt dựng chỉ mục ngữ nghĩa mã theo dự án × model nhúng; `san-sang`
 * CHỈ khi `xong`). Áp `drizzle/0395_ai_code_index_state.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai `avi_app`
 * (khuôn 0391, bộ chạy chung apply-migration-dot10-common.mjs):
 *   (a) danh mục: 12 cột đúng kiểu (mốc giờ `timestamptz`); khoá chính (projectId, moHinh); 5 CHECK; KHÔNG hàm nào;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có, TRUNCATE/REFERENCES/TRIGGER không;
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app): chèn `dang-dung` hợp lệ ⇒ mặc định đủ; trùng
 *       (projectId, moHinh) ⇒ 23505; cùng dự án khác model ⇒ được; trạng thái lạ ⇒ 23514; `xong` thiếu ketThuc ⇒ 23514;
 *       `dang-dung` có ketThuc ⇒ 23514; projectId là ĐƯỜNG DẪN ⇒ 23514; soTep âm ⇒ 23514; chốt `xong` + ketThuc ⇒ được;
 *       0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0395.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BANG = "ai_code_index_state";
const COT = {
  projectId: "character varying",
  moHinh: "character varying",
  trangThai: "character varying",
  batDau: "timestamp with time zone",
  ketThuc: "timestamp with time zone",
  soTep: "integer",
  soDoan: "integer",
  catBot: "boolean",
  loi: "character varying",
  tienTrinh: "character varying",
  luot: "uuid",
  capNhat: "timestamp with time zone",
};
const CHECKS = [
  "chk_ai_code_index_state_dem",
  "chk_ai_code_index_state_ket_thuc",
  "chk_ai_code_index_state_mo_hinh",
  "chk_ai_code_index_state_project_id",
  "chk_ai_code_index_state_trang_thai",
];

await runMigration({
  file: "0395_ai_code_index_state.sql",
  tag: "[0395]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${BANG}`;
    expectExact("(a) columns", Object.fromEntries(cols.map((r) => [r.c, r.t])), COT);
    if (cols.length !== Object.keys(COT).length) throw new Error(`(a) ${cols.length} columns, want ${Object.keys(COT).length}`);
    const [pk] = await appSql`
      SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum)) AS k
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'public.ai_code_index_state'::regclass AND c.contype = 'p'`;
    expectExact("(a) primary key", pk, { k: "projectId,moHinh" });
    const ck = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_code_index_state'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { ck }, { ck: CHECKS });
    log(`(a) ${cols.length} columns · PK (${pk.k}) · ${ck.length} CHECK`);

    // (b) quyền
    const pr = await tablePriv(appSql, `public.${BANG}`);
    expectExact("(b) privileges", pr, { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const ins = (sp, o) =>
        sp`INSERT INTO public.ai_code_index_state ("projectId", "moHinh", "trangThai", "ketThuc", "soTep", "tienTrinh", luot)
           VALUES (${o.projectId ?? "probe-0395"}, ${o.moHinh ?? "probe-model"}, ${o.trangThai ?? "dang-dung"},
                   ${o.ketThuc ? new Date() : null}, ${o.soTep ?? 0}, 'probe-host:1:x', ${randomUUID()})`;
      out.hopLe = await maLoi(tx, (sp) => ins(sp, {}));
      const [h] = await tx`SELECT ("batDau" IS NOT NULL AND "capNhat" IS NOT NULL) AS gio, "soDoan" AS d, "catBot" AS c
                             FROM public.ai_code_index_state WHERE "projectId" = 'probe-0395'`;
      out.macDinh = h ? `${h.gio}|${h.d}|${h.c}` : null;
      out.trungKhoa = await maLoi(tx, (sp) => ins(sp, {}));
      out.khacModel = await maLoi(tx, (sp) => ins(sp, { moHinh: "probe-model-2" }));
      out.trangThaiLa = await maLoi(tx, (sp) => ins(sp, { projectId: "probe-0395-b", trangThai: "san-sang", ketThuc: true }));
      out.xongThieuKetThuc = await maLoi(tx, (sp) => ins(sp, { projectId: "probe-0395-b", trangThai: "xong" }));
      out.dangDungCoKetThuc = await maLoi(tx, (sp) => ins(sp, { projectId: "probe-0395-b", ketThuc: true }));
      out.duAnDuongDan = await maLoi(tx, (sp) => ins(sp, { projectId: "D:\\SOURCES\\x" }));
      out.soTepAm = await maLoi(tx, (sp) => ins(sp, { projectId: "probe-0395-b", soTep: -1 }));
      out.chotXong = await maLoi(
        tx,
        (sp) => sp`UPDATE public.ai_code_index_state SET "trangThai" = 'xong', "ketThuc" = now(), "capNhat" = now()
                    WHERE "projectId" = 'probe-0395' AND "moHinh" = 'probe-model'`,
      );
      return out;
    });
    expectExact("(c) behaviour", r, {
      hopLe: null,
      macDinh: "true|0|false",
      trungKhoa: "23505",
      khacModel: null,
      trangThaiLa: "23514",
      xongThieuKetThuc: "23514",
      dangDungCoKetThuc: "23514",
      duAnDuongDan: "23514",
      soTepAm: "23514",
      chotXong: null,
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_code_index_state WHERE "projectId" LIKE 'probe-0395%'`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
