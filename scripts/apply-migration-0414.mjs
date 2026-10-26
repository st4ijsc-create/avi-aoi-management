#!/usr/bin/env node
/**
 * 0414 — Dot 10.3: ai_api_keys."factoryId" + CHECK (active ⇒ co nha may) + ai_ngoai_nha_may / ai_ngoai_model / ai_ngoai_host_noi_bo.
 * Nghiem thu bang `avi_app` (giao dich HOAN TAC):
 *   (a) cot ton tai; (b) quyen avi_app (SELECT/INSERT/UPDATE/DELETE tren 3 bang moi, khong TRUNCATE);
 *   (c) hanh vi: khoa 'active' khong factoryId ⇒ 23514; 'inactive' khong factoryId ⇒ duoc; model khong gia + khong tranTokenLuot ⇒ 23514;
 *       nhaCungCap la / ten model la ⇒ 23514; hostCong sai dang ⇒ 23514; mac dinh ai_ngoai_nha_may = TAT het;
 *   (d) dem: so khoa con 'active' khong factoryId = 0.
 *   node scripts/apply-migration-0414.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0414_ai_ngoai_khoa_cau_hinh.sql",
  tag: "[0414]",
  async verify({ appSql, log }) {
    const [c] = await appSql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_api_keys' AND column_name='factoryId'`;
    expectExact("(a) ai_api_keys.factoryId", c, { n: 1 });
    for (const t of ["ai_ngoai_nha_may", "ai_ngoai_model", "ai_ngoai_host_noi_bo"]) {
      expectExact(`(b) ${t}`, await tablePriv(appSql, t), { sel: true, ins: true, upd: true, del: true, trunc: false });
    }
    log("(a)(b) cot + 3 bang + quyen avi_app (SELECT/INSERT/UPDATE/DELETE, khong TRUNCATE)");

    const [f] = await appSql`SELECT id FROM public.factories ORDER BY id LIMIT 1`;
    if (!f) {
      log("(c) BO QUA: khong co nha may nao de tham do hanh vi");
    } else {
      const r = await rolledBack(appSql, async (tx) => {
        const activeKhongNm = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_api_keys (name, provider, "encryptedKey", status, "createdBy") VALUES ('p0414', 'anthropic', 'enc:v1:x', 'active', 1)`);
        const inactiveKhongNm = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_api_keys (name, provider, "encryptedKey", status, "createdBy") VALUES ('p0414', 'anthropic', 'enc:v1:x', 'inactive', 1)`);
        const [k] = await tx`INSERT INTO public.ai_api_keys (name, provider, "encryptedKey", status, "createdBy", "factoryId") VALUES ('p0414', 'anthropic', 'enc:v1:x', 'active', 1, ${f.id}) RETURNING id`;
        const khongGiaKhongTran = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId") VALUES (${f.id}, 'anthropic', 'm1', 'M1', ${k.id})`);
        const nccLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId", "tranTokenLuot") VALUES (${f.id}, 'x-ai', 'm2', 'M2', ${k.id}, 1000)`);
        const tenModelLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId", "tranTokenLuot") VALUES (${f.id}, 'openai', '../x', 'M3', ${k.id}, 1000)`);
        const coTran = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_model ("factoryId", "nhaCungCap", model, nhan, "keyId", "tranTokenLuot") VALUES (${f.id}, 'openai', 'gpt-x', 'G', ${k.id}, 1000)`);
        const hostSai = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_host_noi_bo ("factoryId", "hostCong") VALUES (${f.id}, 'http://x:1')`);
        const hostDung = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_ngoai_host_noi_bo ("factoryId", "hostCong") VALUES (${f.id}, 'llm.local:8000')`);
        const [cfg] = await tx`INSERT INTO public.ai_ngoai_nha_may ("factoryId") VALUES (${f.id})
          ON CONFLICT ("factoryId") DO UPDATE SET "factoryId" = EXCLUDED."factoryId"
          RETURNING "batNgoai" AS b, "choDuLieuVanHanh" AS v, "luuNguyenVan" AS l, "hanGiuNgay" AS h, "tranLanPhut" AS p`;
        return { activeKhongNm, inactiveKhongNm, khongGiaKhongTran, nccLa, tenModelLa, coTran, hostSai, hostDung, macDinh: cfg };
      });
      expectExact("(c) behaviour", r, {
        activeKhongNm: "23514",
        inactiveKhongNm: null,
        khongGiaKhongTran: "23514",
        nccLa: "23514",
        tenModelLa: "23514",
        coTran: null,
        hostSai: "23514",
        hostDung: null,
      });
      log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    }
    const [d] = await appSql`SELECT count(*) FILTER (WHERE "factoryId" IS NULL AND status = 'active')::int AS active_khong_nm, count(*)::int AS tong FROM public.ai_api_keys`;
    expectExact("(d) khong con khoa active thieu nha may", d, { active_khong_nm: 0 });
    log(`(d) ai_api_keys tong ${d.tong}, active khong nha may ${d.active_khong_nm}`);
  },
});
