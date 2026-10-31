#!/usr/bin/env node
/**
 * 0442 — Đợt 11.8 M4/S7: cột `ai_pending_actions."agentRunId"` uuid NULL (+ chỉ mục từng phần). Áp
 * `drizzle/0442_ai_pending_actions_luot_agent.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột tồn tại, uuid, nullable, không default; (b) quyền avi_app trên bảng KHÔNG ĐỔI; (c) hành vi (giao dịch HOÀN TÁC): hàng cũ/mới
 *   không khai cột ⇒ NULL; ghi một uuid được; chuỗi không phải uuid ⇒ 22P02.
 *   node scripts/apply-migration-0442.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL.
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0442_ai_pending_actions_luot_agent.sql",
  tag: "[0442]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT data_type AS d, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_pending_actions' AND column_name='agentRunId'`;
    expectExact("(a) column", { d: c?.d, n: c?.n, df: c?.df ?? null }, { d: "uuid", n: "YES", df: null });
    log("(a) agentRunId uuid NULL, không default");

    const p = await tablePriv(appSql, "public.ai_pending_actions");
    log(`(b) quyền avi_app ${JSON.stringify(p)}`);
    if (p.trunc) throw new Error("(b) avi_app không được TRUNCATE ai_pending_actions");

    const [u] = await appSql`SELECT id FROM public.users ORDER BY id LIMIT 1`;
    const id1 = randomUUID();
    const id2 = randomUUID();
    const run = randomUUID();
    const r = await rolledBack(appSql, async (tx) => {
      await tx`INSERT INTO public.ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "idempotencyKey", "expiresAt")
        VALUES (${id1}, 'probe0442', '{}'::json, ${u.id}, 'engineer', 's', ${"k-" + id1}, now() + interval '1 hour')`;
      const [a] = await tx`SELECT "agentRunId" AS r FROM public.ai_pending_actions WHERE id = ${id1}`;
      await tx`INSERT INTO public.ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, "idempotencyKey", "expiresAt", "agentRunId")
        VALUES (${id2}, 'probe0442', '{}'::json, ${u.id}, 'engineer', 's', ${"k-" + id2}, now() + interval '1 hour', ${run})`;
      const [b] = await tx`SELECT "agentRunId" AS r FROM public.ai_pending_actions WHERE id = ${id2}`;
      const sai = await maLoi(tx, (sp) => sp`UPDATE public.ai_pending_actions SET "agentRunId" = 'khong-phai-uuid' WHERE id = ${id1}`);
      return { macDinh: a.r, ghi: b.r, sai };
    });
    expectExact("(c) behaviour", r, { macDinh: null, ghi: run, sai: "22P02" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_pending_actions WHERE tool = 'probe0442'`;
    if (left.n !== 0) throw new Error("(c) probe NOT rolled back");
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
