#!/usr/bin/env node
/**
 * 0425 — QUY TAC LEO THANG THEO NHA MAY (lo W16): `alert_escalation_rules."factoryId"` (NULL = mac dinh toan tap doan, FK factories ON DELETE SET NULL) + chi muc. Ap
 * `drizzle/0425_quy_tac_leo_thang_theo_nha_may.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot "factoryId" integer NULL khong default + chi muc idx_alert_escalation_rules_factory + FK ON DELETE SET NULL;
 *   (b) hanh vi (giao dich HOAN TAC, vai avi_app): INSERT quy tac khong factoryId => NULL; gan factoryId ton tai OK, khong ton tai => 23503; xoa nha may => ve NULL;
 *   (c) hang dang co KHONG doi (so hang + so hang co factoryId); `__applied_migrations` 1 hang.
 *   node scripts/apply-migration-0425.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so do.
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0425_quy_tac_leo_thang_theo_nha_may.sql",
  tag: "[0425]",
  async verify({ appSql, log }) {
    const cot = await appSql`SELECT data_type AS d, is_nullable AS n, column_default AS def FROM information_schema.columns WHERE table_schema='public' AND table_name='alert_escalation_rules' AND column_name='factoryId'`;
    if (cot.length !== 1) throw new Error(`(a) cot factoryId: ${cot.length} (muon 1)`);
    expectExact("(a) factoryId", { d: cot[0].d, n: cot[0].n, def: cot[0].def }, { d: "integer", n: "YES", def: null });
    const idx = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname='public' AND tablename='alert_escalation_rules' AND indexname='idx_alert_escalation_rules_factory'`;
    if (idx.length !== 1 || !/\("factoryId"\)/.test(idx[0].d)) throw new Error(`(a) chi muc: ${JSON.stringify(idx)}`);
    const fk = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.alert_escalation_rules'::regclass AND contype = 'f'`;
    const fkF = fk.map((r) => r.d).filter((d) => /factoryId/.test(d));
    if (fkF.length !== 1 || !/REFERENCES factories\(id\) ON DELETE SET NULL/.test(fkF[0])) throw new Error(`(a) FK: ${JSON.stringify(fkF)}`);
    log("(a) factoryId integer NULL, khong default · chi muc · FK factories(id) ON DELETE SET NULL");
    const truoc = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.alert_escalation_rules`)[0];
    const r = await rolledBack(appSql, async (tx) => {
      const [f] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0425_" + Date.now()}, 'probe 0425') RETURNING id`;
      const [q] = await tx`INSERT INTO public.alert_escalation_rules (name, "escalateAfterMin") VALUES ('__0425', 5) RETURNING id, "factoryId"`;
      const gan = await maLoi(tx, (sp) => sp`UPDATE public.alert_escalation_rules SET "factoryId" = ${f.id} WHERE id = ${q.id}`);
      const khongCo = await maLoi(tx, (sp) => sp`UPDATE public.alert_escalation_rules SET "factoryId" = ${2147483000} WHERE id = ${q.id}`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.factories WHERE id = ${f.id}`);
      const [ve] = await tx`SELECT "factoryId" AS f FROM public.alert_escalation_rules WHERE id = ${q.id}`;
      return { macDinh: q.factoryId, gan, khongCo, xoa, veNull: ve.f };
    });
    expectExact("(b) behaviour avi_app", r, { macDinh: null, gan: null, khongCo: "23503", xoa: null, veNull: null });
    const sau = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM public.alert_escalation_rules`)[0];
    expectExact("(c) hang dang co khong doi", sau, truoc);
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log(`(c) alert_escalation_rules truoc/sau: ${JSON.stringify(truoc)} / ${JSON.stringify(sau)} (khong doi)`);
  },
});
