#!/usr/bin/env node
/**
 * 0432 — SCADA R1a Task 16: `totp_khoa_sai` (bo dem TOTP sai theo nguoi dung, 5 lan / 5 phut ⇒ khoa 5 phut).
 * Ap `drizzle/0432_totp_khoa_sai.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) bang ton tai, 5 cot dung kieu + nullability, PK (user_id);
 *   (b) has_table_privilege avi_app SELECT/INSERT/UPDATE/DELETE = true; hanh vi trong giao dich HOAN TAC (vai avi_app):
 *       INSERT duoc, PK trung ⇒ 23505, so_lan_sai NULL ⇒ 23502, upsert ON CONFLICT tang dem, DELETE duoc;
 *   (c) `__applied_migrations` 1 hang (bo chay chung).
 *   node scripts/apply-migration-0432.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL (global-constraints).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0432_totp_khoa_sai.sql",
  tag: "[0432]",
  async verify({ appSql, log }) {
    // ── (a) cau truc ────────────────────────────────────────────────────────────────────────────────────────────
    const rows = await appSql`SELECT column_name AS c, data_type AS d, is_nullable AS n, column_default AS def
      FROM information_schema.columns WHERE table_schema='public' AND table_name='totp_khoa_sai'`;
    const cot = Object.fromEntries(rows.map((r) => [r.c, `${r.d}|${r.n}`]));
    expectExact("(a) totp_khoa_sai columns", cot, {
      user_id: "integer|NO",
      so_lan_sai: "integer|NO",
      cua_so_bat_dau: "timestamp with time zone|NO",
      khoa_den: "timestamp with time zone|YES",
      updated_at: "timestamp with time zone|NO",
    });
    if (rows.length !== 5) throw new Error(`(a) totp_khoa_sai: ${rows.length} cot (muon 5)`);
    const def = rows.find((r) => r.c === "updated_at")?.def ?? "";
    if (!/now\(\)/.test(def)) throw new Error(`(a) updated_at default la: ${def}`);
    const pk = await appSql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype='p' AND conrelid = 'public.totp_khoa_sai'::regclass`;
    expectExact("(a) primary key", { d: pk.map((r) => r.d) }, { d: ["PRIMARY KEY (user_id)"] });
    log("(a) 5 cot (user_id int NOT NULL · so_lan_sai int NOT NULL · cua_so_bat_dau/khoa_den/updated_at timestamptz, khoa_den NULL) · PK (user_id)");

    // ── (b1) quyen, do bang catalog ─────────────────────────────────────────────────────────────────────────────
    const [g] = await appSql`SELECT
        has_table_privilege('avi_app', 'totp_khoa_sai', 'SELECT') AS sel,
        has_table_privilege('avi_app', 'totp_khoa_sai', 'INSERT') AS ins,
        has_table_privilege('avi_app', 'totp_khoa_sai', 'UPDATE') AS upd,
        has_table_privilege('avi_app', 'totp_khoa_sai', 'DELETE') AS del`;
    expectExact("(b) has_table_privilege", g, { sel: true, ins: true, upd: true, del: true });

    // ── (b2) hanh vi, giao dich hoan tac, vai avi_app ───────────────────────────────────────────────────────────
    const uid = -432_000_001; // id am: khong bao gio trung nguoi dung that
    const r = await rolledBack(appSql, async (tx) => {
      const chen = await maLoi(tx, (sp) => sp`INSERT INTO public.totp_khoa_sai (user_id, so_lan_sai, cua_so_bat_dau) VALUES (${uid}, 1, now())`);
      const trung = await maLoi(tx, (sp) => sp`INSERT INTO public.totp_khoa_sai (user_id, so_lan_sai, cua_so_bat_dau) VALUES (${uid}, 1, now())`);
      const nullDem = await maLoi(tx, (sp) => sp`INSERT INTO public.totp_khoa_sai (user_id, so_lan_sai, cua_so_bat_dau) VALUES (${uid - 1}, NULL, now())`);
      const [up] = await tx`INSERT INTO public.totp_khoa_sai (user_id, so_lan_sai, cua_so_bat_dau) VALUES (${uid}, 1, now())
        ON CONFLICT (user_id) DO UPDATE SET so_lan_sai = public.totp_khoa_sai.so_lan_sai + 1, updated_at = now() RETURNING so_lan_sai`;
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.totp_khoa_sai WHERE user_id = ${uid}`);
      const [con] = await tx`SELECT count(*)::int AS n FROM public.totp_khoa_sai WHERE user_id = ${uid}`;
      return { chen, trung, nullDem, upsert: up.so_lan_sai, xoa, conLai: con.n };
    });
    expectExact("(b) behaviour avi_app", r, { chen: null, trung: "23505", nullDem: "23502", upsert: 2, xoa: null, conLai: 0 });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.totp_khoa_sai WHERE user_id IN (${uid}, ${uid - 1})`;
    expectExact("(b) probe rolled back", left, { n: 0 });
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log("(c) __applied_migrations: bo chay chung ghi + dem dung 1 hang sau verify");
  },
});
