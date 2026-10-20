#!/usr/bin/env node
/**
 * 0401 — LUỒNG AI (AI Local Đợt 8.0): 8 bảng `ai_flow*`. Áp `drizzle/0401_ai_flows.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) 8 bảng; 6 CHECK đúng tên; UNIQUE bước (run, node, lần, lần thử);
 *   (b) quyền avi_app S/I/U/D, không TRUNCATE/REFERENCES/TRIGGER;
 *   (c) giao dịch hoàn tác: id luồng `../x` ⇒ 23514; trạng thái run lạ ⇒ 23514; bước trùng (run,node,lần,lần thử) ⇒ 23505;
 *       run trỏ phiên bản không tồn tại ⇒ 23503; hai worker cùng `FOR UPDATE SKIP LOCKED` một mục ⇒ thấy 1 rồi 0 (kiểm trong tx);
 *   (d) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0401.mjs --test-only | --dev-only | --both
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BANG = ["ai_flow_events", "ai_flow_inbox", "ai_flow_queue", "ai_flow_runs", "ai_flow_steps", "ai_flow_versions", "ai_flow_waits", "ai_flows"];
const CHECKS = ["chk_ai_flow_runs_status", "chk_ai_flow_steps_status", "chk_ai_flow_versions_risk", "chk_ai_flow_waits_kind", "chk_ai_flows_id", "chk_ai_flows_risk"];

await runMigration({
  file: "0401_ai_flows.sql",
  tag: "[0401]",
  async verify({ appSql, log }) {
    const bang = (await appSql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${BANG}) ORDER BY 1`).map((r) => r.t);
    expectExact("(a) tables", { bang }, { bang: BANG });
    const checks = (await appSql`SELECT conname AS n FROM pg_constraint WHERE contype='c' AND conname LIKE 'chk_ai_flow%' ORDER BY 1`).map((r) => r.n);
    expectExact("(a) checks", { checks }, { checks: CHECKS });
    log(`(a) ${BANG.length} tables · ${CHECKS.length} CHECK`);
    for (const b of BANG) {
      expectExact(`(b) ${b}`, await tablePriv(appSql, `public.${b}`), { sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false });
    }
    log("(b) avi_app S/I/U/D, no TRUNCATE/REFERENCES/TRIGGER");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      out.idXau = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flows (id, name) VALUES ('../x', 'x')`);
      await tx`INSERT INTO public.ai_flows (id, name) VALUES ('probe0401', 'dò')`;
      await tx`INSERT INTO public.ai_flow_versions ("flowId", version, definition, "riskClass") VALUES ('probe0401', 1, '{}'::jsonb, 'thuan')`;
      const run = randomUUID();
      out.runVersionLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind") VALUES (${randomUUID()}, 'probe0401', 9, 'thu-cong')`);
      out.runStatusLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind", status) VALUES (${randomUUID()}, 'probe0401', 1, 'thu-cong', 'la')`);
      await tx`INSERT INTO public.ai_flow_runs (id, "flowId", version, "triggerKind") VALUES (${run}, 'probe0401', 1, 'thu-cong')`;
      const buoc = (sp) => sp`INSERT INTO public.ai_flow_steps ("runId", "nodeId", lan, "lanThu", status, "idempotencyKey") VALUES (${run}, 'a', 1, 1, 'xong', 'k')`;
      out.buoc1 = await maLoi(tx, buoc);
      out.buocTrung = await maLoi(tx, buoc);
      await tx`INSERT INTO public.ai_flow_queue ("runId", "nodeId", lan) VALUES (${run}, 'a', 1)`;
      const [n1] = await tx`SELECT count(*)::int AS n FROM (SELECT id FROM public.ai_flow_queue WHERE "runId" = ${run} FOR UPDATE SKIP LOCKED) x`;
      out.nhat = n1.n;
      return out;
    });
    expectExact("(c) behaviour", r, { idXau: "23514", runVersionLa: "23503", runStatusLa: "23514", buoc1: null, buocTrung: "23505", nhat: 1 });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_flows WHERE id = 'probe0401'`;
    if (left.n !== 0) throw new Error("(c) probe NOT rolled back");
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
