#!/usr/bin/env node
/**
 * 0419 — Dot 10.4b L3: ai_agent_runs."nguonModel" (dau nguon luot agent chay model ngoai) — CHECK mau chung 0417 + chi che do hoi;
 *   bat bien sau INSERT (trigger).
 * Nghiem thu bang `avi_app` (giao dich HOAN TAC):
 *   (a) cot co, avi_app SELECT/INSERT/UPDATE ai_agent_runs;
 *   (b) INSERT hoi + ngoai:… hop le duoc; INSERT sua + ngoai:… ⇒ 23514; INSERT mau sai ⇒ 23514; UPDATE suKien/trangThai van duoc;
 *       UPDATE "nguonModel" (dat / doi / xoa) ⇒ 23514; hang ngoai doi "cheDo" hoi→sua ⇒ 23514 (CHECK kiem lai khi UPDATE); hang cuc bo (NULL) UPDATE dat ngoai:… ⇒ 23514.
 *   node scripts/apply-migration-0419.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0419_ai_agent_runs_nguon_model.sql",
  tag: "[0419]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_agent_runs' AND column_name='nguonModel'`;
    const q = await tablePriv(appSql, "ai_agent_runs");
    expectExact("(a) cot + quyen", { n: c.n, sel: q.sel, ins: q.ins, upd: q.upd }, { n: 1, sel: true, ins: true, upd: true });
    log("(a) cot nguonModel co; avi_app doc/ghi ai_agent_runs");

    const r = await rolledBack(appSql, async (tx) => {
      const [u] = await tx`SELECT id FROM public.users ORDER BY id LIMIT 1`;
      if (!u) return { boQua: true };
      const them = (cn, id, cheDo, nguon) => cn`
        INSERT INTO public.ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi", "nguonModel")
        VALUES (${id}, ${u.id}, 'du-an-thu', ${cheDo}, 'tham do 0419', ${nguon})`;
      const A = "00000000-0000-4000-8000-000000000419";
      const B = "00000000-0000-4000-8000-000000000420";
      const hopLe = await maLoi(tx, (sp) => them(sp, A, "hoi", "ngoai:anthropic:claude-x"));
      const suaNgoai = await maLoi(tx, (sp) => them(sp, "00000000-0000-4000-8000-000000000421", "sua", "ngoai:anthropic:claude-x"));
      const mauSai = await maLoi(tx, (sp) => them(sp, "00000000-0000-4000-8000-000000000422", "hoi", "local:qwen"));
      const capNhat = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "suKien" = '[]'::jsonb, "trangThai" = 'xong', "updatedAt" = now() WHERE id = ${A}`);
      const doiNguon = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "nguonModel" = 'ngoai:openai:gpt-x' WHERE id = ${A}`);
      const doiCheDo = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "cheDo" = 'sua' WHERE id = ${A}`);
      const xoaNguon = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "nguonModel" = NULL WHERE id = ${A}`);
      const cucBo = await maLoi(tx, (sp) => them(sp, B, "hoi", null));
      const datNguon = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "nguonModel" = 'ngoai:anthropic:claude-x' WHERE id = ${B}`);
      return { hopLe, suaNgoai, mauSai, capNhat, doiNguon, doiCheDo, xoaNguon, cucBo, datNguon };
    });
    if (r.boQua) {
      log("(b) BO QUA: chua co nguoi dung de tham do");
      return;
    }
    expectExact("(b) behaviour", r, { hopLe: null, suaNgoai: "23514", mauSai: "23514", capNhat: null, doiNguon: "23514", doiCheDo: "23514", xoaNguon: "23514", cucBo: null, datNguon: "23514" });
    log(`(b) ${JSON.stringify(r)}; ROLLED BACK.`);
  },
});
