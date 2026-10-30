#!/usr/bin/env node
/**
 * 0440 — Đợt 11.8 T5: phiên hợp nhất trên `ai_coding_sessions` (kind/source/runIds/parentSessionId/contextPct/version).
 * Áp `drizzle/0440_ai_phien_hop_nhat.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) 6 cột mới đúng kiểu/nullable/mặc định; hàng cũ nhận kind='coding', source='web', version=1, runIds=[];
 *   (b) hành vi (giao dịch HOÀN TÁC): kind/source sai ⇒ 23514; runIds không phải mảng ⇒ 23514; version 0 ⇒ 23514;
 *       parentSessionId trỏ phiên của NGƯỜI KHÁC ⇒ 23503 (khoá ngoại kép); trỏ phiên của chính mình OK; tự trỏ chính nó ⇒ 23514;
 *       xoá cha ⇒ con còn, parentSessionId NULL;
 *   (c) quyền avi_app trên bảng KHÔNG ĐỔI (SELECT/INSERT/UPDATE/DELETE, không TRUNCATE).
 *   node scripts/apply-migration-0440.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL (dải 0440–0442 cấp cho lô 11.8).
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0440_ai_phien_hop_nhat.sql",
  tag: "[0440]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT column_name AS c, data_type AS d, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_coding_sessions' AND column_name IN ('kind','source','runIds','parentSessionId','contextPct','version') ORDER BY column_name`;
    const m = Object.fromEntries(cols.map((r) => [r.c, r]));
    expectExact("(a) kind", { d: m.kind?.d, n: m.kind?.n }, { d: "character varying", n: "NO" });
    expectExact("(a) source", { d: m.source?.d, n: m.source?.n }, { d: "character varying", n: "NO" });
    expectExact("(a) runIds", { d: m.runIds?.d, n: m.runIds?.n }, { d: "jsonb", n: "NO" });
    expectExact("(a) parentSessionId", { d: m.parentSessionId?.d, n: m.parentSessionId?.n }, { d: "uuid", n: "YES" });
    expectExact("(a) contextPct", { d: m.contextPct?.d, n: m.contextPct?.n }, { d: "smallint", n: "YES" });
    expectExact("(a) version", { d: m.version?.d, n: m.version?.n }, { d: "integer", n: "NO" });
    log("(a) 6 cột mới đúng kiểu");

    const [u] = await appSql`SELECT (SELECT id FROM public.users ORDER BY id LIMIT 1) AS a, (SELECT id FROM public.users ORDER BY id OFFSET 1 LIMIT 1) AS b`;
    if (!u.a || !u.b) throw new Error("(b) cần ít nhất 2 người dùng để đo hàng rào chéo tài khoản");

    const r = await rolledBack(appSql, async (tx) => {
      const [sa] = await tx`INSERT INTO public.ai_coding_sessions ("userId","projectId") VALUES (${u.a}, 'probe0440') RETURNING id, kind, source, version, "runIds"`;
      const [sb] = await tx`INSERT INTO public.ai_coding_sessions ("userId","projectId") VALUES (${u.b}, 'probe0440') RETURNING id`;
      const macDinh = { kind: sa.kind, source: sa.source, version: sa.version, runIds: sa.runIds };
      const kindSai = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET kind='bogus' WHERE id=${sa.id}`);
      const sourceSai = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET source='bogus' WHERE id=${sa.id}`);
      const runIdsObj = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET "runIds"='{}'::jsonb WHERE id=${sa.id}`);
      const verSai = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET version=0 WHERE id=${sa.id}`);
      const chaNguoiKhac = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET "parentSessionId"=${sb.id} WHERE id=${sa.id}`);
      const tuTro = await maLoi(tx, (sp) => sp`UPDATE public.ai_coding_sessions SET "parentSessionId"=${sa.id} WHERE id=${sa.id}`);
      const [con] = await tx`INSERT INTO public.ai_coding_sessions ("userId","projectId","kind","parentSessionId") VALUES (${u.a}, 'probe0440', 'agent', ${sa.id}) RETURNING id, "parentSessionId" AS p`;
      await tx`DELETE FROM public.ai_coding_sessions WHERE id=${sa.id}`;
      const [sau] = await tx`SELECT id, "parentSessionId" AS p FROM public.ai_coding_sessions WHERE id=${con.id}`;
      return { macDinh, kindSai, sourceSai, runIdsObj, verSai, chaNguoiKhac, tuTro, conCoCha: con.p === sa.id, conConSauXoaCha: sau?.id === con.id, chaSauXoa: sau?.p ?? null };
    });
    expectExact("(b) behaviour", r, {
      macDinh: { kind: "coding", source: "web", version: 1, runIds: [] },
      kindSai: "23514",
      sourceSai: "23514",
      runIdsObj: "23514",
      verSai: "23514",
      chaNguoiKhac: "23503",
      tuTro: "23514",
      conCoCha: true,
      conConSauXoaCha: true,
      chaSauXoa: null,
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_coding_sessions WHERE "projectId"='probe0440'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);

    const p = await tablePriv(appSql, "public.ai_coding_sessions");
    expectExact("(c) privileges avi_app", p, { sel: true, ins: true, upd: true, del: true, trunc: false });
    const [cu] = await appSql`SELECT count(*)::int AS n, count(*) FILTER (WHERE kind='coding' AND source='web')::int AS coding FROM public.ai_coding_sessions`;
    log(`(c) quyền DML giữ nguyên; hàng hiện có ${cu.n}, trong đó kind=coding/source=web ${cu.coding}`);
  },
});
