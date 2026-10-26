#!/usr/bin/env node
/**
 * 0413 — Dot 10.3: enum "apikeyprovider" them anthropic / gemini / openai_compat.
 * Ap `drizzle/0413_ai_ngoai_nha_cung_cap.sql` bang owner `aoi`, nghiem thu bang `avi_app`: enum co du 7 gia tri theo thu tu.
 *   node scripts/apply-migration-0413.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL (dai 0413–0416 cap cho do-model).
 */
import { expectExact, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0413_ai_ngoai_nha_cung_cap.sql",
  tag: "[0413]",
  async verify({ appSql, log }) {
    const rows = await appSql`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'apikeyprovider' ORDER BY e.enumsortorder`;
    expectExact("(a) enum", { v: rows.map((r) => r.v) }, { v: ["openai", "azure_openai", "huggingface", "custom", "anthropic", "gemini", "openai_compat"] });
    log(`(a) apikeyprovider = ${rows.map((r) => r.v).join(", ")}`);
  },
});
