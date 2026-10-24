#!/usr/bin/env node
/**
 * 0422 — bang `annotation_templates`. Ap `drizzle/0422_annotation_templates.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) cot dung kieu / CHECK category;
 *   (b) avi_app SELECT/INSERT/UPDATE/DELETE duoc (has_table_privilege) va KHONG co TRUNCATE; sequence dung duoc;
 *   (c) giao dich hoan tac: INSERT mau hop le chay; category la bi CHECK tu choi (23514);
 *   (d) idempotent: ap lai khong loi.
 *   node scripts/apply-migration-0422.mjs --test-only | --dev-only | --both   (KHONG co => tu choi)
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const COT = {
  id: "integer",
  name: "character varying",
  category: "character varying",
  description: "text",
  annotations: "json",
  previewUrl: "text",
  isSystem: "boolean",
  createdBy: "integer",
  createdAt: "timestamp without time zone",
};

await runMigration({
  file: "0422_annotation_templates.sql",
  tag: "[0422]",
  async verify({ appSql, log }) {
    const rows = await appSql`SELECT column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema='public' AND table_name='annotation_templates'`;
    expectExact("(a) columns", Object.fromEntries(rows.map((r) => [r.c, r.d])), COT);
    if (rows.length !== Object.keys(COT).length) throw new Error(`(a) ${rows.length} cot (muon ${Object.keys(COT).length})`);
    const [chk] = await appSql`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'annotation_templates_category_chk' AND contype = 'c'`;
    expectExact("(a) CHECK category", chk, { n: 1 });
    log(`(a) ${rows.length} cot + CHECK category`);

    const p = await tablePriv(appSql, "public.annotation_templates");
    expectExact("(b) quyen avi_app", p, { sel: true, ins: true, upd: true, del: true, trunc: false });
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE, khong TRUNCATE");

    const ok = await rolledBack(appSql, async (tx) => {
      const [r] = await tx`INSERT INTO public.annotation_templates (name, category, annotations) VALUES ('probe-0422', 'custom', '[]'::json) RETURNING id`;
      return typeof r.id === "number";
    });
    expectExact("(c) INSERT hop le", { ok }, { ok: true });
    const code = await rolledBack(appSql, (tx) => maLoi(tx, () => tx`INSERT INTO public.annotation_templates (name, category) VALUES ('probe-0422', 'la')`));
    expectExact("(c) category la bi CHECK tu choi", { code }, { code: "23514" });
    log("(c) INSERT hop le chay; category la bi 23514");
  },
});
