#!/usr/bin/env node
/**
 * 0417 — Dot 10.4b L0a': dau nguon luot sinh chu bang model ngoai.
 *   ai_external_calls."bamTraLoi" (+ CHECK hex, chi muc nguoi+bam) · ai_chat_messages."nguonModel"/"ngoaiCallId" (+ CHECK) ·
 *   ai_chat_conversations."coLuotNgoai" · ai_coding_sessions."coLuotNgoai".
 * Nghiem thu bang `avi_app` (giao dich HOAN TAC):
 *   (a) cot co du; avi_app UPDATE duoc nguonModel/ngoaiCallId/coLuotNgoai; ai_external_calls van WORM (avi_app khong UPDATE);
 *   (b) nguonModel sai hinh ⇒ 23514; nguonModel tren tin `user` ⇒ 23514; nguonModel hop le tren tin `assistant` ⇒ duoc;
 *       bamTraLoi khong phai 64 hex ⇒ 23514 (INSERT ket-qua tham do).
 *   node scripts/apply-migration-0417.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv, updatableCols } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0417_ai_ngoai_dau_nguon.sql",
  tag: "[0417]",
  async verify({ appSql, log }) {
    const cot = async (t, cs) =>
      (await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=${t} AND column_name = ANY(${cs}) ORDER BY column_name`).map((r) => r.c);
    expectExact("(a) ai_external_calls", { c: await cot("ai_external_calls", ["bamTraLoi"]) }, { c: ["bamTraLoi"] });
    expectExact("(a) ai_chat_messages", { c: await cot("ai_chat_messages", ["ngoaiCallId", "nguonModel"]) }, { c: ["ngoaiCallId", "nguonModel"] });
    expectExact("(a) ai_chat_conversations", { c: await cot("ai_chat_conversations", ["coLuotNgoai"]) }, { c: ["coLuotNgoai"] });
    expectExact("(a) ai_coding_sessions", { c: await cot("ai_coding_sessions", ["coLuotNgoai"]) }, { c: ["coLuotNgoai"] });
    expectExact("(a) updatable msg", { u: await updatableCols(appSql, "ai_chat_messages", ["ngoaiCallId", "nguonModel"]) }, { u: ["ngoaiCallId", "nguonModel"] });
    expectExact("(a) updatable conv", { u: await updatableCols(appSql, "ai_chat_conversations", ["coLuotNgoai"]) }, { u: ["coLuotNgoai"] });
    expectExact("(a) updatable coding", { u: await updatableCols(appSql, "ai_coding_sessions", ["coLuotNgoai"]) }, { u: ["coLuotNgoai"] });
    const p = await tablePriv(appSql, "ai_external_calls");
    expectExact("(a) WORM giu nguyen", { upd: p.upd, del: p.del }, { upd: false, del: false });
    log("(a) cot + quyen ok; ai_external_calls van WORM");

    const r = await rolledBack(appSql, async (tx) => {
      const [u] = await tx`SELECT id FROM public.users ORDER BY id LIMIT 1`;
      if (!u) return { boQua: true };
      const [c] = await tx`INSERT INTO public.ai_chat_conversations ("userId", title) VALUES (${u.id}, '0417-tham-do') RETURNING id`;
      const [mu] = await tx`INSERT INTO public.ai_chat_messages ("conversationId", role, content) VALUES (${c.id}, 'user', 'h') RETURNING id`;
      const [ma] = await tx`INSERT INTO public.ai_chat_messages ("conversationId", role, content) VALUES (${c.id}, 'assistant', 'd') RETURNING id`;
      const saiHinh = await maLoi(tx, (sp) => sp`UPDATE public.ai_chat_messages SET "nguonModel" = 'local:x' WHERE id = ${ma.id}`);
      const tinUser = await maLoi(tx, (sp) => sp`UPDATE public.ai_chat_messages SET "nguonModel" = 'ngoai:anthropic:claude-x' WHERE id = ${mu.id}`);
      const dung = await maLoi(tx, (sp) => sp`UPDATE public.ai_chat_messages SET "nguonModel" = 'ngoai:anthropic:claude-x' WHERE id = ${ma.id}`);
      // dieu-phoi duyet SQL (2) — id co `/` va `@` phai LUU DUOC
      const coGach = await maLoi(tx, (sp) => sp`UPDATE public.ai_chat_messages SET "nguonModel" = 'ngoai:openai-compat:meta-llama/Llama-3.3-70B@2025' WHERE id = ${ma.id}`);
      const [chiMuc] = await tx`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname='ai_chat_messages_ngoai_call_idx'`;
      const co = await maLoi(tx, (sp) => sp`UPDATE public.ai_chat_conversations SET "coLuotNgoai" = true WHERE id = ${c.id}`);
      const bamSai = await maLoi(
        tx,
        (sp) => sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "yDinhId", "tuDong", "nhaCungCap", model, "ketCuc", "bamTraLoi")
                   VALUES (0, 'ket-qua', 0, false, 'x', 'x', 'ok', 'xyz')`,
      );
      return { saiHinh, tinUser, dung, coGach, chiMuc: chiMuc.n, co, bamSai };
    });
    if (r.boQua) {
      log("(b) BO QUA: chua co nguoi dung de tham do");
      return;
    }
    expectExact("(b) behaviour", r, { saiHinh: "23514", tinUser: "23514", dung: null, coGach: null, chiMuc: 1, co: null, bamSai: "23514" });
    log(`(b) ${JSON.stringify(r)}; ROLLED BACK.`);
  },
});
