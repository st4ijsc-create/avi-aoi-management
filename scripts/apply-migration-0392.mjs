#!/usr/bin/env node
/**
 * 0392 — Đợt 4A (AI Local): token theo người dùng cho cổng `/v1` (`ai_gateway_tokens`) + device flow
 * (`ai_gateway_device_codes`). Áp `drizzle/0392_ai_gateway_tokens.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai
 * ứng dụng `avi_app` (khuôn 0390, bộ chạy chung apply-migration-dot10-common.mjs — đúng MỘT cờ đích, lock_timeout 5 s,
 * statement_timeout 60 s, vai nghiệm thu không superuser/BYPASSRLS, sổ `__applied_migrations`):
 *   (a) danh mục: cột đúng kiểu cho cả hai bảng; CHECK; chỉ mục; KHÔNG có hàm nào;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE + dùng sequence; không TRUNCATE/REFERENCES/TRIGGER;
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC (avi_app): token hợp lệ ⇒ mặc định đúng; BẢN RÕ `avgw_…` vào cột
 *       băm ⇒ 23514; băm trùng ⇒ 23505; phạm vi rỗng/lạ ⇒ 23514; hết hạn trước lúc tạo ⇒ 23514; nguồn lạ ⇒ 23514;
 *       device code: mã người dùng sai bảng chữ ⇒ 23514; `da-duyet` không chủ ⇒ 23514; trạng thái lạ ⇒ 23514;
 *       0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0392.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { createHash, randomBytes } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const TZ = "timestamp with time zone";
const COT_TOKEN = {
  id: "integer",
  userId: "integer",
  tokenHash: "character",
  tienTo: "character varying",
  ten: "character varying",
  phamVi: "ARRAY",
  nguon: "character varying",
  hetHanLuc: TZ,
  thuHoiLuc: TZ,
  thuHoiBoi: "integer",
  dungLanCuoiLuc: TZ,
  createdAt: TZ,
};
const COT_THIET_BI = {
  id: "integer",
  maThietBiHash: "character",
  maNguoiDung: "character varying",
  ten: "character varying",
  phamVi: "ARRAY",
  trangThai: "character varying",
  userId: "integer",
  tokenId: "integer",
  soLanHoi: "integer",
  hoiLanCuoiLuc: TZ,
  hetHanLuc: TZ,
  createdAt: TZ,
};
const CHECKS_TOKEN = [
  "chk_ai_gateway_tokens_hash",
  "chk_ai_gateway_tokens_het_han",
  "chk_ai_gateway_tokens_nguon",
  "chk_ai_gateway_tokens_pham_vi",
  "chk_ai_gateway_tokens_ten",
  "chk_ai_gateway_tokens_thu_hoi",
  "chk_ai_gateway_tokens_tien_to",
];
const CHECKS_THIET_BI = [
  "chk_ai_gateway_device_codes_chu",
  "chk_ai_gateway_device_codes_dem",
  "chk_ai_gateway_device_codes_hash",
  "chk_ai_gateway_device_codes_ma_nd",
  "chk_ai_gateway_device_codes_pham_vi",
  "chk_ai_gateway_device_codes_ten",
  "chk_ai_gateway_device_codes_trang_thai",
];

const bam = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function cotCua(appSql, bang) {
  const cols = await appSql`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${bang}`;
  return Object.fromEntries(cols.map((r) => [r.c, r.t]));
}

await runMigration({
  file: "0392_ai_gateway_tokens.sql",
  tag: "[0392]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const ct = await cotCua(appSql, "ai_gateway_tokens");
    expectExact("(a) ai_gateway_tokens columns", ct, COT_TOKEN);
    if (Object.keys(ct).length !== Object.keys(COT_TOKEN).length) throw new Error(`(a) tokens: ${Object.keys(ct).length} columns`);
    const cd = await cotCua(appSql, "ai_gateway_device_codes");
    expectExact("(a) ai_gateway_device_codes columns", cd, COT_THIET_BI);
    if (Object.keys(cd).length !== Object.keys(COT_THIET_BI).length) throw new Error(`(a) device codes: ${Object.keys(cd).length} columns`);
    const ck1 = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_gateway_tokens'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) token checks", { ck1 }, { ck1: CHECKS_TOKEN });
    const ck2 = (await appSql`SELECT conname AS n FROM pg_constraint WHERE conrelid = 'public.ai_gateway_device_codes'::regclass AND contype = 'c' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) device checks", { ck2 }, { ck2: CHECKS_THIET_BI });
    const idx = (
      await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('ai_gateway_tokens', 'ai_gateway_device_codes') AND indexname NOT LIKE '%_pkey' ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) indexes", { idx }, {
      idx: ["ai_gateway_device_codes_ma_nd_uq", "ai_gateway_device_codes_ma_tb_uq", "ai_gateway_tokens_hash_uq", "ai_gateway_tokens_owner_idx"],
    });
    log(`(a) ${Object.keys(ct).length}+${Object.keys(cd).length} columns · ${ck1.length}+${ck2.length} CHECK · ${idx.length} indexes`);

    // (b) quyền
    for (const t of ["ai_gateway_tokens", "ai_gateway_device_codes"]) {
      expectExact(`(b) ${t}`, await tablePriv(appSql, `public.${t}`), { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
      const [s] = await appSql`SELECT has_sequence_privilege(${`public.${t}_id_seq`}, 'USAGE') AS u`;
      if (!s.u) throw new Error(`(b) avi_app lacks USAGE on ${t}_id_seq`);
    }
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE + sequence USAGE; no TRUNCATE/REFERENCES/TRIGGER");

    // (c) hành vi — avi_app, luôn hoàn tác
    const CODE = `__probe_0392_${Date.now()}`;
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [u] = await tx`INSERT INTO public.users ("openId", role, "isActive") VALUES (${CODE}, 'engineer', true) RETURNING id`;
      const tokenRo = "avgw_" + randomBytes(32).toString("base64url");
      const h = bam(tokenRo);
      const ins = (sp, o) =>
        sp`INSERT INTO public.ai_gateway_tokens ("userId", "tokenHash", "tienTo", ten, "phamVi", nguon, "hetHanLuc")
           VALUES (${u.id}, ${o.hash ?? bam(randomBytes(8).toString("hex"))}, ${o.tienTo ?? "avgw_probe12"}, ${o.ten ?? "probe-0392"},
                   ${o.phamVi ?? ["chat", "fim"]}::text[], ${o.nguon ?? "web"}, ${o.hetHan ?? sp`now() + interval '90 days'`})`;
      out.hopLe = await maLoi(tx, (sp) => ins(sp, { hash: h }));
      const [m] = await tx`SELECT "phamVi" AS p, nguon AS n, "thuHoiLuc" AS t, ("hetHanLuc" > now() + interval '89 days') AS han FROM public.ai_gateway_tokens WHERE "tokenHash" = ${h}`;
      out.macDinh = m ? [JSON.stringify(m.p), m.n, String(m.t), String(m.han)].join("|") : null;
      out.banRo = await maLoi(tx, (sp) => ins(sp, { hash: tokenRo.slice(0, 64).padEnd(64, "x") }));
      out.hoaHex = await maLoi(tx, (sp) => ins(sp, { hash: h.toUpperCase() }));
      out.trung = await maLoi(tx, (sp) => ins(sp, { hash: h }));
      out.phamViRong = await maLoi(tx, (sp) => ins(sp, { phamVi: [] }));
      out.phamViLa = await maLoi(tx, (sp) => ins(sp, { phamVi: ["chat", "admin"] }));
      out.hetHanTruoc = await maLoi(tx, (sp) => ins(sp, { hetHan: sp`now() - interval '1 day'` }));
      out.nguonLa = await maLoi(tx, (sp) => ins(sp, { nguon: "cli" }));
      out.tienToLa = await maLoi(tx, (sp) => ins(sp, { tienTo: "sk-abc" }));
      out.thuHoiBoiKhongLuc = await maLoi(tx, (sp) => sp`UPDATE public.ai_gateway_tokens SET "thuHoiBoi" = ${u.id} WHERE "tokenHash" = ${h}`);
      out.thuHoi = await maLoi(tx, (sp) => sp`UPDATE public.ai_gateway_tokens SET "thuHoiBoi" = ${u.id}, "thuHoiLuc" = now() WHERE "tokenHash" = ${h}`);

      const insTb = (sp, o) =>
        sp`INSERT INTO public.ai_gateway_device_codes ("maThietBiHash", "maNguoiDung", ten, "trangThai", "userId", "hetHanLuc")
           VALUES (${o.hash ?? bam(randomBytes(8).toString("hex"))}, ${o.ma ?? "BCDF-GHJK"}, 'probe-0392', ${o.trangThai ?? "cho"},
                   ${o.userId ?? null}, now() + interval '10 minutes')`;
      out.tbHopLe = await maLoi(tx, (sp) => insTb(sp, {}));
      out.tbMaNguyenAm = await maLoi(tx, (sp) => insTb(sp, { ma: "ABCD-EFGH" }));
      out.tbMaTrung = await maLoi(tx, (sp) => insTb(sp, {}));
      out.tbDuyetKhongChu = await maLoi(tx, (sp) => insTb(sp, { ma: "BCDF-GHJL", trangThai: "da-duyet" }));
      out.tbDuyetCoChu = await maLoi(tx, (sp) => insTb(sp, { ma: "BCDF-GHJM", trangThai: "da-duyet", userId: u.id }));
      out.tbTrangThaiLa = await maLoi(tx, (sp) => insTb(sp, { ma: "BCDF-GHJN", trangThai: "ok" }));
      return out;
    });
    expectExact("(c) behaviour", r, {
      hopLe: null,
      macDinh: '["chat","fim"]|web|null|true',
      banRo: "23514",
      hoaHex: "23514",
      trung: "23505",
      phamViRong: "23514",
      phamViLa: "23514",
      hetHanTruoc: "23514",
      nguonLa: "23514",
      tienToLa: "23514",
      thuHoiBoiKhongLuc: "23514",
      thuHoi: null,
      tbHopLe: null,
      tbMaNguyenAm: "23514",
      tbMaTrung: "23505",
      tbDuyetKhongChu: "23514",
      tbDuyetCoChu: null,
      tbTrangThaiLa: "23514",
    });
    const [left] = await appSql`SELECT (SELECT count(*)::int FROM public.ai_gateway_tokens WHERE ten = 'probe-0392') + (SELECT count(*)::int FROM public.ai_gateway_device_codes WHERE ten = 'probe-0392') AS n`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
