#!/usr/bin/env node
/**
 * 0434 — kiem-dinh R1b-1 I1 (a): cot `interlock_rules."approvedDefHash"` varchar(80) NULL (bam dinh nghia tag nguon / dich chup luc duyet).
 * Ap `drizzle/0434_interlock_bam_dinh_nghia_duyet.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot ton tai, character varying(80), nullable, khong default;
 *   (b) quyen avi_app tren interlock_rules KHONG DOI (SELECT/INSERT/UPDATE nhu truoc) va avi_app UPDATE duoc cot moi (has_column_privilege);
 *       giao dich HOAN TAC: luat chen khong khai cot ⇒ NULL; ghi mot bam 'd1:<64 hex>' (67 ky tu) duoc; chuoi 81 ky tu ⇒ 22001;
 *   (c) `__applied_migrations` 1 hang (bo chay chung).
 *   node scripts/apply-migration-0434.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL (global-constraints; dai 0434 cap cho ban sua kiem-dinh R1b-1).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0434_interlock_bam_dinh_nghia_duyet.sql",
  tag: "[0434]",
  async verify({ appSql, log }) {
    // ── (a) cau truc ────────────────────────────────────────────────────────────────────────────────────────────
    const [c] = await appSql`SELECT data_type AS d, character_maximum_length AS len, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='interlock_rules' AND column_name='approvedDefHash'`;
    expectExact("(a) column", { d: c?.d, len: c?.len, n: c?.n, df: c?.df ?? null }, { d: "character varying", len: 80, n: "YES", df: null });
    log("(a) approvedDefHash varchar(80) NULL, khong default");

    // ── (b1) quyen ──────────────────────────────────────────────────────────────────────────────────────────────
    const [g] = await appSql`SELECT
        has_table_privilege('interlock_rules', 'SELECT') AS sel,
        has_table_privilege('interlock_rules', 'INSERT') AS ins,
        has_table_privilege('interlock_rules', 'UPDATE') AS upd,
        has_column_privilege('interlock_rules', 'approvedDefHash', 'UPDATE') AS cotUpd,
        has_column_privilege('interlock_rules', 'approvedDefHash', 'SELECT') AS cotSel`;
    expectExact("(b) privileges avi_app", g, { sel: true, ins: true, upd: true, cotupd: true, cotsel: true });

    // ── (b2) hanh vi, giao dich hoan tac ───────────────────────────────────────────────────────────────────────
    const bam = "d1:" + "a".repeat(64);
    const r = await rolledBack(appSql, async (tx) => {
      const [ins] = await tx`INSERT INTO public.interlock_rules (name, scope, "sourceType", "comparisonOperator", action)
        VALUES ('probe0434', 'machine', 'ng_rate', 'gt', 'alert') RETURNING id, "approvedDefHash" AS h`;
      const [up] = await tx`UPDATE public.interlock_rules SET "approvedDefHash" = ${bam} WHERE id = ${ins.id} RETURNING "approvedDefHash" AS h`;
      const quaDai = await maLoi(tx, (sp) => sp`UPDATE public.interlock_rules SET "approvedDefHash" = ${"x".repeat(81)} WHERE id = ${ins.id}`);
      return { macDinh: ins.h, ghi: up.h, quaDai };
    });
    expectExact("(b) behaviour", r, { macDinh: null, ghi: bam, quaDai: "22001" });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.interlock_rules WHERE name = 'probe0434'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    const [dem] = await appSql`SELECT count(*) FILTER (WHERE "approvedBy" IS NOT NULL)::int AS da_duyet,
        count(*) FILTER (WHERE "approvedBy" IS NOT NULL AND "approvedDefHash" IS NULL)::int AS can_duyet_lai,
        count(*) FILTER (WHERE "approvedBy" IS NOT NULL AND "approvedDefHash" IS NULL AND enabled)::int AS dang_bat_can_duyet_lai
      FROM public.interlock_rules`;
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log(`(info) luat da duyet ${dem.da_duyet}; can DUYET LAI (approvedDefHash NULL) ${dem.can_duyet_lai}, trong do dang bat ${dem.dang_bat_can_duyet_lai}`);
  },
});
