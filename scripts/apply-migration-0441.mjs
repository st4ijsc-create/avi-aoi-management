#!/usr/bin/env node
/**
 * 0441 — Đợt 11.8 T5: sổ cha–con của agent con (`ai_agent_runs`: parentRunId/depth/agentName/agentSource) + bảng tin cậy
 * `ai_agent_def_trust` (tin-lần-đầu theo băm). Áp `drizzle/0441_ai_agent_cha_con_tin_cay.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột mới + bảng tin cậy tồn tại; (b) hành vi (giao dịch HOÀN TÁC): lượt gốc depth 0; con cùng chủ OK; con trỏ cha của NGƯỜI KHÁC
 *   ⇒ 23503; depth/parent lệch ⇒ 23514; con thiếu agentName ⇒ 23514; agentSource sai ⇒ 23514; tin cậy trùng khoá ⇒ 23505; băm sai dạng ⇒ 23514;
 *   (c) quyền: avi_app DML trên ai_agent_def_trust, không TRUNCATE; quyền ai_agent_runs không đổi.
 *   node scripts/apply-migration-0441.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL (dải 0440–0442 cấp cho lô 11.8).
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0441_ai_agent_cha_con_tin_cay.sql",
  tag: "[0441]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT column_name AS c, data_type AS d, is_nullable AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_agent_runs' AND column_name IN ('parentRunId','depth','agentName','agentSource') ORDER BY column_name`;
    const m = Object.fromEntries(cols.map((r) => [r.c, r]));
    expectExact("(a) parentRunId", { d: m.parentRunId?.d, n: m.parentRunId?.n }, { d: "uuid", n: "YES" });
    expectExact("(a) depth", { d: m.depth?.d, n: m.depth?.n }, { d: "smallint", n: "NO" });
    expectExact("(a) agentName", { d: m.agentName?.d, n: m.agentName?.n }, { d: "character varying", n: "YES" });
    expectExact("(a) agentSource", { d: m.agentSource?.d, n: m.agentSource?.n }, { d: "character varying", n: "YES" });
    const [t] = await appSql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_agent_def_trust'`;
    if (t.n !== 1) throw new Error("(a) thiếu bảng ai_agent_def_trust");
    const [ts] = await appSql`SELECT data_type AS d FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_agent_def_trust' AND column_name='confirmedAt'`;
    expectExact("(a) confirmedAt", ts, { d: "timestamp with time zone" });
    log("(a) cột sổ cha–con + bảng tin cậy có mặt");

    const [u] = await appSql`SELECT (SELECT id FROM public.users ORDER BY id LIMIT 1) AS a, (SELECT id FROM public.users ORDER BY id OFFSET 1 LIMIT 1) AS b`;
    if (!u.a || !u.b) throw new Error("(b) cần ít nhất 2 người dùng để đo hàng rào chéo tài khoản");
    const goc = randomUUID();
    const gocB = randomUUID();
    const con = randomUUID();
    const hash = "a".repeat(64);

    const r = await rolledBack(appSql, async (tx) => {
      await tx`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi") VALUES (${goc}, ${u.a}, 'probe0441', 'sua', 'q')`;
      await tx`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi") VALUES (${gocB}, ${u.b}, 'probe0441', 'sua', 'q')`;
      const [g] = await tx`SELECT depth, "parentRunId" AS p, "agentName" AS a FROM public.ai_agent_runs WHERE id=${goc}`;
      await tx`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth,"agentName","agentSource") VALUES (${con}, ${u.a}, 'probe0441', 'hoi', 't', ${goc}, 1, 'kham-pha', 'dungSan')`;
      const conChuKhac = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth,"agentName","agentSource") VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', ${gocB}, 1, 'kham-pha', 'dungSan')`);
      const depthLech = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth,"agentName","agentSource") VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', ${goc}, 0, 'kham-pha', 'dungSan')`);
      const goc0CoCha = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi",depth) VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', 3)`);
      const thieuTen = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth) VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', ${goc}, 1)`);
      const nguonSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth,"agentName","agentSource") VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', ${goc}, 1, 'kham-pha', 'khac')`);
      const tenSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_runs (id,"userId","projectId","cheDo","cauHoi","parentRunId",depth,"agentName","agentSource") VALUES (${randomUUID()}, ${u.a}, 'probe0441', 'hoi', 't', ${goc}, 1, '../x', 'tuRepo')`);

      await tx`INSERT INTO public.ai_agent_def_trust ("userId","projectId","agentName","contentHash") VALUES (${u.a}, 'probe0441', 'kham-pha', ${hash})`;
      const trungKhoa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_def_trust ("userId","projectId","agentName","contentHash") VALUES (${u.a}, 'probe0441', 'kham-pha', ${hash})`);
      const bamSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_def_trust ("userId","projectId","agentName","contentHash") VALUES (${u.a}, 'probe0441', 'kham-pha', ${"Z".repeat(64)})`);
      const tenTinSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_def_trust ("userId","projectId","agentName","contentHash") VALUES (${u.a}, 'probe0441', 'Kham Pha', ${hash})`);
      const duongDan = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_def_trust ("userId","projectId","agentName","contentHash") VALUES (${u.a}, 'D:/x', 'kham-pha', ${"b".repeat(64)})`);
      const [tinCuaB] = await tx`SELECT count(*)::int AS n FROM public.ai_agent_def_trust WHERE "userId"=${u.b} AND "projectId"='probe0441'`;
      return { goc: { depth: g.depth, p: g.p, a: g.a }, conChuKhac, depthLech, goc0CoCha, thieuTen, nguonSai, tenSai, trungKhoa, bamSai, tenTinSai, duongDan, tinCuaB: tinCuaB.n };
    });
    expectExact("(b) behaviour", r, {
      goc: { depth: 0, p: null, a: null },
      conChuKhac: "23503",
      depthLech: "23514",
      goc0CoCha: "23514",
      thieuTen: "23514",
      nguonSai: "23514",
      tenSai: "23514",
      trungKhoa: "23505",
      bamSai: "23514",
      tenTinSai: "23514",
      duongDan: "23514",
      tinCuaB: 0,
    });
    const [left] = await appSql`SELECT (SELECT count(*) FROM public.ai_agent_runs WHERE "projectId"='probe0441')::int AS r, (SELECT count(*) FROM public.ai_agent_def_trust WHERE "projectId"='probe0441')::int AS t`;
    if (left.r !== 0 || left.t !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);

    const p = await tablePriv(appSql, "public.ai_agent_def_trust");
    expectExact("(c) privileges avi_app trên ai_agent_def_trust", p, { sel: true, ins: true, upd: true, del: true, trunc: false });
    const pr = await tablePriv(appSql, "public.ai_agent_runs");
    expectExact("(c) privileges avi_app trên ai_agent_runs", pr, { sel: true, ins: true, upd: true, trunc: false });
    log("(c) quyền DML đúng, không TRUNCATE");
  },
});
