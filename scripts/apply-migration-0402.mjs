#!/usr/bin/env node
/**
 * 0402 — TOKEN WEBHOOK Luồng AI (AI Local Đợt 8.1 Task 4b): bảng `ai_flow_webhooks`. Áp `drizzle/0402_ai_flow_webhook.sql`
 * bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) bảng + CHECK `chk_ai_flow_webhooks_hash`;
 *   (b) quyền avi_app S/I/U/D, không TRUNCATE/REFERENCES/TRIGGER;
 *   (c) giao dịch hoàn tác: băm không phải hex64 ⇒ 23514; luồng không tồn tại ⇒ 23503; hàng thứ hai cùng luồng ⇒ 23505;
 *       xoá luồng ⇒ token đi theo (CASCADE);
 *   (d) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0402.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const HEX = "a".repeat(64);

await runMigration({
  file: "0402_ai_flow_webhook.sql",
  tag: "[0402]",
  async verify({ appSql, log }) {
    const bang = (await appSql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name = 'ai_flow_webhooks'`).map((r) => r.t);
    expectExact("(a) table", { bang }, { bang: ["ai_flow_webhooks"] });
    const checks = (await appSql`SELECT conname AS n FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_ai_flow_webhooks%' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { checks }, { checks: ["chk_ai_flow_webhooks_hash"] });
    expectExact("(b) ai_flow_webhooks", await tablePriv(appSql, "public.ai_flow_webhooks"), { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    log("(a) table + CHECK · (b) avi_app S/I/U/D, no TRUNCATE/REFERENCES/TRIGGER");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`INSERT INTO public.ai_flows (id, name) VALUES ('probe0402', 'dò')`;
      out.hashXau = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_webhooks ("flowId", "tokenHash") VALUES ('probe0402', 'KHONG-HEX')`);
      out.luongLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_webhooks ("flowId", "tokenHash") VALUES ('probe0402-khong', ${HEX})`);
      const chen = (sp) => sp`INSERT INTO public.ai_flow_webhooks ("flowId", "tokenHash") VALUES ('probe0402', ${HEX})`;
      out.chen1 = await maLoi(tx, chen);
      out.chenTrung = await maLoi(tx, chen);
      await tx`DELETE FROM public.ai_flows WHERE id = 'probe0402'`;
      const [n] = await tx`SELECT count(*)::int AS n FROM public.ai_flow_webhooks WHERE "flowId" = 'probe0402'`;
      out.conSauXoa = n.n;
      return out;
    });
    expectExact("(c) behaviour", r, { hashXau: "23514", luongLa: "23503", chen1: null, chenTrung: "23505", conSauXoa: 0 });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id = 'probe0402'`;
    if (left.n !== 0) throw new Error("(c) probe NOT rolled back");
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
