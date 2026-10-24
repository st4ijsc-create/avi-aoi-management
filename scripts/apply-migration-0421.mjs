#!/usr/bin/env node
/**
 * 0421 — THIET BI DO THEO NHA MAY (lo W7c): `measurement_instruments."factoryId"` (NULL, FK factories ON DELETE SET NULL) + chi muc. Ap
 * `drizzle/0421_thiet_bi_do_nha_may.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot "factoryId" integer NULL (khong default), chi muc idx_measurement_instruments_factory ton tai, FK toi factories(id) ON DELETE SET NULL;
 *   (b) QUYEN: avi_app SELECT/INSERT/UPDATE tren cot moi; hanh vi trong giao dich HOAN TAC (vai avi_app): INSERT thiet bi khong factoryId ⇒ NULL, UPDATE gan factoryId
 *       ton tai duoc, gan factoryId KHONG ton tai ⇒ 23503, xoa nha may ⇒ thiet bi ve NULL (SET NULL);
 *   (c) hang dang co KHONG doi (so hang + so hang co factoryId khong NULL truoc/sau); `__applied_migrations` 1 hang.
 *   node scripts/apply-migration-0421.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so hang (global-constraints).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0421_thiet_bi_do_nha_may.sql",
  tag: "[0421]",
  async verify({ appSql, log }) {
    // ── (a) cau truc ─────────────────────────────────────────
    const cot = await appSql`SELECT data_type AS d, is_nullable AS n, column_default AS def FROM information_schema.columns
      WHERE table_schema='public' AND table_name='measurement_instruments' AND column_name='factoryId'`;
    if (cot.length !== 1) throw new Error(`(a) cot factoryId: ${cot.length} (muon 1)`);
    expectExact("(a) factoryId", { d: cot[0].d, n: cot[0].n, def: cot[0].def }, { d: "integer", n: "YES", def: null });
    const idx = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname='public' AND tablename='measurement_instruments' AND indexname='idx_measurement_instruments_factory'`;
    if (idx.length !== 1 || !/\("factoryId"\)/.test(idx[0].d)) throw new Error(`(a) chi muc: ${JSON.stringify(idx)}`);
    const fk = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.measurement_instruments'::regclass AND contype = 'f'`;
    const fkF = fk.map((r) => r.d).filter((d) => /factoryId/.test(d));
    if (fkF.length !== 1 || !/REFERENCES factories\(id\) ON DELETE SET NULL/.test(fkF[0])) throw new Error(`(a) FK: ${JSON.stringify(fkF)}`);
    log("(a) factoryId integer NULL, khong default · chi muc idx_measurement_instruments_factory · FK factories(id) ON DELETE SET NULL");

    // ── (b) quyen + hanh vi, giao dich hoan tac, vai avi_app ──────────────────
    const [g] = await appSql`SELECT has_column_privilege('measurement_instruments', 'factoryId', 'SELECT') AS sel,
      has_column_privilege('measurement_instruments', 'factoryId', 'INSERT') AS ins, has_column_privilege('measurement_instruments', 'factoryId', 'UPDATE') AS upd`;
    expectExact("(b) has_column_privilege", g, { sel: true, ins: true, upd: true });
    const truoc = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.measurement_instruments`)[0];
    const r = await rolledBack(appSql, async (tx) => {
      const [f] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0421_" + Date.now()}, 'probe 0421') RETURNING id`;
      const [i] = await tx`INSERT INTO public.measurement_instruments (code, name, "instrumentType") VALUES (${"__0421_" + Date.now()}, 'probe', 'caliper') RETURNING id, "factoryId"`;
      const gan = await maLoi(tx, (sp) => sp`UPDATE public.measurement_instruments SET "factoryId" = ${f.id} WHERE id = ${i.id}`);
      const [sau] = await tx`SELECT "factoryId" AS f FROM public.measurement_instruments WHERE id = ${i.id}`;
      const khongCo = await maLoi(tx, (sp) => sp`UPDATE public.measurement_instruments SET "factoryId" = ${2147483000} WHERE id = ${i.id}`);
      const xoaNhaMay = await maLoi(tx, (sp) => sp`DELETE FROM public.factories WHERE id = ${f.id}`);
      const [veNull] = await tx`SELECT "factoryId" AS f FROM public.measurement_instruments WHERE id = ${i.id}`;
      return { macDinh: i.factoryId, gan, ganDuoc: sau.f === f.id, khongCo, xoaNhaMay, veNull: veNull.f };
    });
    expectExact("(b) behaviour avi_app", r, { macDinh: null, gan: null, ganDuoc: true, khongCo: "23503", xoaNhaMay: null, veNull: null });
    const sauChay = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.measurement_instruments`)[0];
    expectExact("(c) hang dang co khong doi", sauChay, truoc);
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log(`(c) measurement_instruments truoc/sau: ${JSON.stringify(truoc)} / ${JSON.stringify(sauChay)} (khong doi)`);
  },
});
