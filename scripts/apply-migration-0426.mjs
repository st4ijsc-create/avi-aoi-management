#!/usr/bin/env node
/**
 * 0426 — LUAT CANH BAO MQTT + NGUONG YIELD THEO NHA MAY (lo W17b): "factoryId" (NULL, FK factories ON DELETE SET NULL) + chi muc tren mqtt_alert_rules / yield_alert_thresholds /
 * mqtt_alert_history; chi muc duy nhat tung phan uq_yield_thresholds_factory_metric (factoryId, metricType) WHERE factoryId IS NOT NULL. Ap `drizzle/0426_luat_mqtt_nguong_yield_theo_nha_may.sql`
 * bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot "factoryId" integer NULL khong default + chi muc + FK ON DELETE SET NULL tren ca 3 bang; chi muc duy nhat tung phan ton tai;
 *   (b) hanh vi trong giao dich HOAN TAC (vai avi_app): INSERT khong factoryId => NULL; gan nha may OK; gan nha may khong ton tai => 23503; hai nguong cung (nha may, metricType) => 23505,
 *       cung metricType o hai nha may OK, nhieu hang NULL cung metricType OK; xoa nha may => ve NULL;
 *   (c) so hang khong doi (bao so hang moi bang).
 *   node scripts/apply-migration-0426.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so do.
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const BANG = ["mqtt_alert_rules", "yield_alert_thresholds", "mqtt_alert_history"];
const CHI_MUC = { mqtt_alert_rules: "idx_mqtt_alert_rules_factory", yield_alert_thresholds: "idx_yield_thresholds_factory", mqtt_alert_history: "idx_mqtt_alert_history_factory" };

await runMigration({
  file: "0426_luat_mqtt_nguong_yield_theo_nha_may.sql",
  tag: "[0426]",
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
    const uq = await appSql`SELECT indexdef AS d FROM pg_indexes WHERE schemaname='public' AND tablename='yield_alert_thresholds' AND indexname='uq_yield_thresholds_factory_metric'`;
    if (uq.length !== 1 || !/UNIQUE/.test(uq[0].d) || !/WHERE \("factoryId" IS NOT NULL\)/.test(uq[0].d)) throw new Error(`(a) chi muc duy nhat tung phan: ${JSON.stringify(uq)}`);
    log("(a) 3 bang: factoryId integer NULL khong default · chi muc · FK factories(id) ON DELETE SET NULL; uq_yield_thresholds_factory_metric (tung phan) ton tai");

    const dem = {};
    for (const t of BANG) dem[t] = (await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM ${appSql("public." + t)}`)[0];
    const r = await rolledBack(appSql, async (tx) => {
      const [f1] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0426a_" + Date.now()}, 'probe a') RETURNING id`;
      const [f2] = await tx`INSERT INTO public.factories (code, name) VALUES (${"__0426b_" + Date.now()}, 'probe b') RETURNING id`;
      const [y0] = await tx`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold") VALUES ('FPY', 90, 80) RETURNING id, "factoryId"`;
      const [y0b] = await tx`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold") VALUES ('FPY', 91, 81) RETURNING id`;
      await tx`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold", "factoryId") VALUES ('FPY', 92, 82, ${f1.id})`;
      const haiNhaMay = await maLoi(tx, (sp) => sp`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold", "factoryId") VALUES ('FPY', 93, 83, ${f2.id})`);
      const trungNhaMay = await maLoi(tx, (sp) => sp`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold", "factoryId") VALUES ('FPY', 94, 84, ${f1.id})`);
      const khongCo = await maLoi(tx, (sp) => sp`INSERT INTO public.yield_alert_thresholds ("metricType", "warningThreshold", "criticalThreshold", "factoryId") VALUES ('FY', 94, 84, ${2147483000})`);
      const [m0] = await tx`INSERT INTO public.mqtt_alert_rules (name, "ruleType", "thresholdValue") VALUES ('__0426', 'LATENCY_THRESHOLD', 100) RETURNING id, "factoryId"`;
      const gan = await maLoi(tx, (sp) => sp`UPDATE public.mqtt_alert_rules SET "factoryId" = ${f1.id} WHERE id = ${m0.id}`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.factories WHERE id = ${f1.id}`);
      const [ve] = await tx`SELECT "factoryId" AS f FROM public.mqtt_alert_rules WHERE id = ${m0.id}`;
      return { macDinh: y0.factoryId, haiNullCungMetric: y0b.id > y0.id, haiNhaMay, trungNhaMay, khongCo, mqttMacDinh: m0.factoryId, gan, xoa, veNull: ve.f };
    });
    expectExact("(b) behaviour avi_app", r, { macDinh: null, haiNullCungMetric: true, haiNhaMay: null, trungNhaMay: "23505", khongCo: "23503", mqttMacDinh: null, gan: null, xoa: null, veNull: null });
    for (const t of BANG) {
      const [sau] = await appSql`SELECT count(*)::int AS n, count("factoryId")::int AS c FROM ${appSql("public." + t)}`;
      expectExact(`(c) ${t} hang dang co khong doi`, sau, dem[t]);
      log(`(c) ${t}: ${sau.n} hang, ${sau.c} co nha may (khong doi)`);
    }
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
