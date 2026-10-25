#!/usr/bin/env node
/**
 * 0424 — KHO VAT TU THEO NHA MAY (lo W16): "factoryId" (NULL, FK factories ON DELETE SET NULL) + chi muc cho spare_parts_inventory / material_receipts / supplier_lots /
 * lot_disposition; spare_parts_inventory UNIQUE(partCode) => UNIQUE(partCode, COALESCE(factoryId,0)); backfill chi khi suy duoc that. Ap `drizzle/0424_kho_vat_tu_theo_nha_may.sql`
 * bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot "factoryId" integer NULL khong default + chi muc + FK ON DELETE SET NULL tren ca 4 bang; rang buoc cu spare_parts_inventory_partCode_unique da bo, chi muc duy nhat moi ton tai;
 *   (b) hanh vi trong giao dich HOAN TAC (vai avi_app): cung partCode o 2 nha may OK; trung (partCode, cung nha may) va (partCode, NULL, NULL) => 23505; xoa nha may => ton kho ve NULL;
 *   (c) so hang khong doi; bao so hang spare_parts_inventory duoc backfill / con NULL; `__applied_migrations` 1 hang.
 *   node scripts/apply-migration-0424.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so do (global-constraints).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const BANG = ["spare_parts_inventory", "material_receipts", "supplier_lots", "lot_disposition"];
const CHI_MUC = { spare_parts_inventory: "idx_spare_factory", material_receipts: "idx_matrecv_factory", supplier_lots: "idx_suplot_factory", lot_disposition: "idx_lotdisp_factory" };

await runMigration({
  file: "0424_kho_vat_tu_theo_nha_may.sql",
  tag: "[0424]",
  async verify({ appSql, log }) {
    for (const t of BANG) {
      const cot = await appSql`SELECT data_type AS d, is_nullable AS n, column_default AS def FROM information_schema.columns WHERE table_schema='public' AND table_name=${t} AND column_name='factoryId'`;
      if (cot.length !== 1) throw new Error(`(a) ${t}.factoryId: ${cot.length} (muon 1)`);
      expectExact(`(a) ${t}.factoryId`, { d: cot[0].d, n: cot[0].n, def: cot[0].def }, { d: "integer", n: "YES", def: null });
      const idx = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname='public' AND tablename=${t} AND indexname=${CHI_MUC[t]}`;
      if (idx.length !== 1 || !/\("factoryId"\)/.test(idx[0].d)) throw new Error(`(a) chi muc ${t}: ${JSON.stringify(idx)}`);
      const fk = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = ${"public." + t}::regclass AND contype = 'f'`;
      const fkF = fk.map((r) => r.d).filter((d) => /factoryId/.test(d));
      if (fkF.length !== 1 || !/REFERENCES factories\(id\) ON DELETE SET NULL/.test(fkF[0])) throw new Error(`(a) FK ${t}: ${JSON.stringify(fkF)}`);
    }
    const cu = await appSql`SELECT 1 FROM pg_constraint WHERE conrelid = 'public.spare_parts_inventory'::regclass AND conname = 'spare_parts_inventory_partCode_unique'`;
    if (cu.length !== 0) throw new Error("(a) rang buoc cu spare_parts_inventory_partCode_unique con ton tai");
    const uq = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname='public' AND tablename='spare_parts_inventory' AND indexname='uq_spare_parts_code_factory'`;
    if (uq.length !== 1 || !/UNIQUE/.test(uq[0].d) || !/COALESCE\("factoryId"/.test(uq[0].d)) throw new Error(`(a) chi muc duy nhat moi: ${JSON.stringify(uq)}`);
    log("(a) 4 bang: factoryId integer NULL khong default · chi muc · FK factories(id) ON DELETE SET NULL; UNIQUE(partCode) cu da bo, uq_spare_parts_code_factory ton tai");

    const truoc = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.spare_parts_inventory`)[0];
    const r = await rolledBack(appSql, async (tx) => {
      const [f1] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0424a_" + Date.now()}, 'probe a') RETURNING id`;
      const [f2] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0424b_" + Date.now()}, 'probe b') RETURNING id`;
      const ma = "__0424_" + Date.now();
      await tx`INSERT INTO public.spare_parts_inventory ("partCode", "partName", "factoryId") VALUES (${ma}, 'p', ${f1.id})`;
      const haiNhaMay = await maLoi(tx, (sp) => sp`INSERT INTO public.spare_parts_inventory ("partCode", "partName", "factoryId") VALUES (${ma}, 'p', ${f2.id})`);
      const trungCungNhaMay = await maLoi(tx, (sp) => sp`INSERT INTO public.spare_parts_inventory ("partCode", "partName", "factoryId") VALUES (${ma}, 'p', ${f1.id})`);
      const ma2 = ma + "n";
      await tx`INSERT INTO public.spare_parts_inventory ("partCode", "partName") VALUES (${ma2}, 'p')`;
      const trungNull = await maLoi(tx, (sp) => sp`INSERT INTO public.spare_parts_inventory ("partCode", "partName") VALUES (${ma2}, 'p')`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.factories WHERE id = ${f1.id}`);
      const [ve] = await tx`SELECT "factoryId" AS f FROM public.spare_parts_inventory WHERE "partCode" = ${ma} AND "factoryId" IS NULL`;
      return { haiNhaMay, trungCungNhaMay, trungNull, xoa, veNull: ve ? ve.f : "khong-co-hang" };
    });
    expectExact("(b) behaviour avi_app", r, { haiNhaMay: null, trungCungNhaMay: "23505", trungNull: "23505", xoa: null, veNull: null });
    const sau = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.spare_parts_inventory`)[0];
    expectExact("(c) hang dang co khong doi", sau, truoc);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log(`(c) spare_parts_inventory: ${sau.n} hang, ${sau.c} da backfill nha may, ${sau.n - sau.c} con NULL (chi toan quyen thay)`);
    for (const t of BANG.slice(1)) {
      const [x] = await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM ${appSql("public." + t)}`;
      log(`(c) ${t}: ${x.n} hang, ${x.c} co nha may`);
    }
  },
});
