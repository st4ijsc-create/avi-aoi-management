#!/usr/bin/env node
/**
 * 0394 — rà bảo mật de591c868 #3 (device-code phishing): `ai_gateway_device_codes` thêm NGUỒN GỐC của lượt khởi tạo
 * (`ipKhoiTao`, `tacNhanKhoiTao`) + chỉ mục một phần cho trần "mã đang chờ theo IP". Áp
 * `drizzle/0394_ai_gateway_device_codes_nguon_goc.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai `avi_app` (khuôn 0392):
 *   (a) danh mục: hai cột mới đúng kiểu + độ dài; chỉ mục một phần có mặt;
 *   (b) quyền avi_app: INSERT/UPDATE/SELECT hai cột mới (kế thừa quyền bảng của 0392);
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC: chèn mã có nguồn gốc ⇒ đọc lại đúng; IP dài > 64 ⇒ 22001;
 *       0 hàng dò còn lại;
 *   (d) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0394.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { createHash, randomBytes } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const bam = (s) => createHash("sha256").update(s, "utf8").digest("hex");

await runMigration({
  file: "0394_ai_gateway_device_codes_nguon_goc.sql",
  tag: "[0394]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const cols = await appSql`SELECT column_name AS c, data_type AS t, character_maximum_length AS l
                                FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'ai_gateway_device_codes'
                                 AND column_name IN ('ipKhoiTao', 'tacNhanKhoiTao') ORDER BY 1`;
    expectExact(
      "(a) columns",
      Object.fromEntries(cols.map((r) => [r.c, `${r.t}(${r.l})`])),
      { ipKhoiTao: "character varying(64)", tacNhanKhoiTao: "character varying(200)" },
    );
    const [ix] = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ai_gateway_device_codes_ip_cho_idx'`;
    if (!ix || !/WHERE/i.test(ix.d)) throw new Error(`(a) partial index missing: ${ix?.d}`);
    log(`(a) 2 columns · ${ix.d}`);

    // (b) quyền (bảng — cột kế thừa)
    expectExact("(b) ai_gateway_device_codes", await tablePriv(appSql, "public.ai_gateway_device_codes"), {
      sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false,
    });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE (inherited by the new columns)");

    // (c) hành vi — avi_app, luôn hoàn tác
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const ins = (sp, ip) =>
        sp`INSERT INTO public.ai_gateway_device_codes ("maThietBiHash", "maNguoiDung", ten, "hetHanLuc", "ipKhoiTao", "tacNhanKhoiTao")
           VALUES (${bam(randomBytes(8).toString("hex"))}, ${"BCDF-" + "GHJK"}, 'probe-0394', now() + interval '10 minutes', ${ip}, 'probe-ua/1.0')`;
      out.hopLe = await maLoi(tx, (sp) => ins(sp, "10.1.2.3"));
      const [h] = await tx`SELECT "ipKhoiTao" AS ip, "tacNhanKhoiTao" AS ua FROM public.ai_gateway_device_codes WHERE ten = 'probe-0394'`;
      out.docLai = h ? `${h.ip}|${h.ua}` : null;
      out.ipQuaDai = await maLoi(tx, (sp) => sp`UPDATE public.ai_gateway_device_codes SET "ipKhoiTao" = ${"x".repeat(65)} WHERE ten = 'probe-0394'`);
      return out;
    });
    expectExact("(c) behaviour", r, { hopLe: null, docLai: "10.1.2.3|probe-ua/1.0", ipQuaDai: "22001" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_gateway_device_codes WHERE ten = 'probe-0394'`;
    if (left.n !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
