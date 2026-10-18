#!/usr/bin/env node
/**
 * 0396 — Đợt 4B-server: phạm vi token `apply` (CHECK `phamVi` của `ai_gateway_tokens` + `ai_gateway_device_codes` nới
 * từ {chat, fim, embed} lên {chat, fim, embed, apply}). Áp `drizzle/0396_ai_gateway_tokens_pham_vi_apply.sql` bằng owner
 * `aoi`, rồi NGHIỆM THU bằng vai `avi_app` (khuôn 0394):
 *   (a) danh mục: hai CHECK có mặt và định nghĩa chứa 'apply';
 *   (b) hành vi trong một giao dịch LUÔN HOÀN TÁC: token phạm vi {chat, apply} ⇒ chèn được; {admin} ⇒ 23514; {} ⇒ 23514;
 *       mã thiết bị phạm vi {chat, fim, apply} ⇒ chèn được; 0 hàng dò còn lại;
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0396.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { createHash, randomBytes } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const bam = (s) => createHash("sha256").update(s, "utf8").digest("hex");

await runMigration({
  file: "0396_ai_gateway_tokens_pham_vi_apply.sql",
  tag: "[0396]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const ck = await appSql`SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint
                             WHERE conname IN ('chk_ai_gateway_tokens_pham_vi', 'chk_ai_gateway_device_codes_pham_vi') ORDER BY 1`;
    expectExact(
      "(a) checks",
      Object.fromEntries(ck.map((r) => [r.n, /'apply'/.test(r.d)])),
      { chk_ai_gateway_device_codes_pham_vi: true, chk_ai_gateway_tokens_pham_vi: true },
    );
    log(`(a) ${ck.map((r) => `${r.n}: ${r.d}`).join(" · ")}`);

    // (b) hành vi — avi_app, luôn hoàn tác
    const r = await rolledBack(appSql, async (tx) => {
      const [u] = await tx`SELECT id FROM public.users ORDER BY id LIMIT 1`;
      if (!u) throw new Error("(b) no user row to attach the probe token to");
      const chenToken = (sp, phamVi) =>
        sp`INSERT INTO public.ai_gateway_tokens ("userId", "tokenHash", "tienTo", ten, "phamVi", "hetHanLuc")
           VALUES (${u.id}, ${bam(randomBytes(8).toString("hex"))}, 'avgw_probe0', 'probe-0396', ${phamVi}::text[], now() + interval '1 day')`;
      return {
        tokenApply: await maLoi(tx, (sp) => chenToken(sp, "{chat,apply}")),
        tokenAdmin: await maLoi(tx, (sp) => chenToken(sp, "{admin}")),
        tokenRong: await maLoi(tx, (sp) => chenToken(sp, "{}")),
        maApply: await maLoi(
          tx,
          (sp) => sp`INSERT INTO public.ai_gateway_device_codes ("maThietBiHash", "maNguoiDung", ten, "phamVi", "hetHanLuc")
                     VALUES (${bam(randomBytes(8).toString("hex"))}, 'BCDF-GHJK', 'probe-0396', '{chat,fim,apply}'::text[], now() + interval '10 minutes')`,
        ),
      };
    });
    expectExact("(b) behaviour", r, { tokenApply: null, tokenAdmin: "23514", tokenRong: "23514", maApply: null });
    const [left] = await appSql`SELECT (SELECT count(*) FROM public.ai_gateway_tokens WHERE ten = 'probe-0396')
                                     + (SELECT count(*) FROM public.ai_gateway_device_codes WHERE ten = 'probe-0396') AS n`;
    if (Number(left.n) !== 0) throw new Error(`(b) probe NOT rolled back: ${left.n} rows left`);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
