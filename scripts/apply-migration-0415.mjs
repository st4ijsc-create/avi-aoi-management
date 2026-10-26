#!/usr/bin/env node
/**
 * 0415 — Dot 10.3: so ai_external_calls (WORM) + ai_external_call_noi_dung + ai_ngoai_dem + ai_ngoai_dem_phut.
 * Nghiem thu:
 *   (a) quyen avi_app: ai_external_calls CHI SELECT + INSERT; noi_dung SELECT/INSERT/DELETE; dem* SELECT/INSERT/UPDATE/DELETE;
 *   (b) hanh vi (avi_app, HOAN TAC): y dinh chen duoc; ket qua thu hai cho cung y dinh ⇒ 23505; hinh sai (y dinh co ketCuc) ⇒ 23514;
 *       UPDATE / DELETE bang avi_app ⇒ 42501;
 *   (c) WORM voi OWNER (HOAN TAC): UPDATE / DELETE / TRUNCATE ai_external_calls ⇒ 23514 (trigger).
 *   node scripts/apply-migration-0415.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BAM_A = "a".repeat(64);
const BAM_B = "b".repeat(64);

await runMigration({
  file: "0415_ai_ngoai_so_dem.sql",
  tag: "[0415]",
  async verify({ sql, appSql, log }) {
    expectExact("(a) ai_external_calls", await tablePriv(appSql, "ai_external_calls"), { sel: true, ins: true, upd: false, del: false, trunc: false });
    expectExact("(a) ai_external_call_noi_dung", await tablePriv(appSql, "ai_external_call_noi_dung"), { sel: true, ins: true, upd: false, del: true });
    for (const t of ["ai_ngoai_dem", "ai_ngoai_dem_phut"]) expectExact(`(a) ${t}`, await tablePriv(appSql, t), { sel: true, ins: true, upd: true, del: true });
    log("(a) quyen avi_app dung khuon (so: SELECT+INSERT)");

    const yDinh = (tx) => tx`INSERT INTO public.ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung")
      VALUES (1, 'y-dinh', false, 'anthropic', 'm', ${BAM_A}) RETURNING id`;
    const r = await rolledBack(appSql, async (tx) => {
      const [y] = await yDinh(tx);
      const kq1 = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "yDinhId", "tuDong", "nhaCungCap", model, "ketCuc") VALUES (1, 'ket-qua', ${y.id}, false, 'anthropic', 'm', 'ok')`);
      const kq2 = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "yDinhId", "tuDong", "nhaCungCap", model, "ketCuc") VALUES (1, 'ket-qua', ${y.id}, false, 'anthropic', 'm', 'loi')`);
      const hinhSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung", "ketCuc") VALUES (1, 'y-dinh', false, 'anthropic', 'm', ${BAM_B}, 'ok')`);
      const sua = await maLoi(tx, (sp) => sp`UPDATE public.ai_external_calls SET model = 'x' WHERE id = ${y.id}`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.ai_external_calls WHERE id = ${y.id}`);
      return { kq1, kq2, hinhSai, sua, xoa };
    });
    expectExact("(b) behaviour avi_app", r, { kq1: null, kq2: "23505", hinhSai: "23514", sua: "42501", xoa: "42501" });
    log(`(b) ${JSON.stringify(r)}; ROLLED BACK`);

    const w = await rolledBack(sql, async (tx) => {
      const [y] = await yDinh(tx);
      const sua = await maLoi(tx, (sp) => sp`UPDATE public.ai_external_calls SET model = 'x' WHERE id = ${y.id}`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.ai_external_calls WHERE id = ${y.id}`);
      const cat = await maLoi(tx, (sp) => sp`TRUNCATE public.ai_external_calls CASCADE`);
      return { sua, xoa, cat };
    });
    expectExact("(c) WORM owner", w, { sua: "23514", xoa: "23514", cat: "23514" });
    log(`(c) WORM voi owner ${JSON.stringify(w)}; ROLLED BACK`);
  },
});
