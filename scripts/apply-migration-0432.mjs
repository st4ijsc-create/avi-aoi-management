#!/usr/bin/env node
/**
 * 0432 — SCADA R1a Task 16 (+ fix round 1): `totp_khoa_sai` — HAI bo dem rieng theo (nguoi dung, loai): 'totp' (5 lan / 5 phut ⇒
 * khoa 5 phut) va 'backup' (10 lan / 60 phut ⇒ khoa den het cua so). Ap `drizzle/0432_totp_khoa_sai.sql` bang owner `aoi`, nghiem thu
 * bang `avi_app`:
 *   (a) bang ton tai, 9 cot dung kieu + nullability + default, PK (user_id, loai), CHECK loai IN ('totp','backup');
 *   (b) has_table_privilege avi_app SELECT/INSERT/UPDATE/DELETE = true; hanh vi trong giao dich HOAN TAC (vai avi_app):
 *       INSERT 'totp' + 'backup' cung user duoc (PK hai cot), PK trung ⇒ 23505, loai la ⇒ 23514, so_lan_sai NULL ⇒ 23502,
 *       upsert ON CONFLICT (user_id, loai) tang dem chi hang cua loai do, DELETE duoc;
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
    const rows = await appSql`SELECT column_name AS c, data_type AS d, is_nullable AS n, character_maximum_length AS len, column_default AS def
      FROM information_schema.columns WHERE table_schema='public' AND table_name='totp_khoa_sai'`;
    const cot = Object.fromEntries(rows.map((r) => [r.c, `${r.d}${r.len ? `(${r.len})` : ""}|${r.n}`]));
    expectExact("(a) totp_khoa_sai columns", cot, {
      user_id: "integer|NO",
      loai: "character varying(8)|NO",
      so_lan_sai: "integer|NO",
      cua_so_bat_dau: "timestamp with time zone|NO",
      khoa_den: "timestamp with time zone|YES",
      khoa_boi: "character varying(64)|YES",
      tu_choi_dem: "integer|NO",
      tu_choi_audit_luc: "timestamp with time zone|YES",
      updated_at: "timestamp with time zone|NO",
    });
    if (rows.length !== 9) throw new Error(`(a) totp_khoa_sai: ${rows.length} cot (muon 9)`);
    const def = Object.fromEntries(rows.map((r) => [r.c, r.def ?? ""]));
    if (!/now\(\)/.test(def.updated_at)) throw new Error(`(a) updated_at default la: ${def.updated_at}`);
    if (!/^0(::integer)?$/.test(def.tu_choi_dem)) throw new Error(`(a) tu_choi_dem default la: ${def.tu_choi_dem}`);
    const rb = await appSql`SELECT contype AS t, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public.totp_khoa_sai'::regclass AND contype IN ('p','c') ORDER BY contype`;
    expectExact("(a) primary key", { d: rb.filter((r) => r.t === "p").map((r) => r.d) }, { d: ["PRIMARY KEY (user_id, loai)"] });
    const chk = rb.filter((r) => r.t === "c").map((r) => r.d);
    if (chk.length !== 1 || !/'totp'/.test(chk[0]) || !/'backup'/.test(chk[0])) throw new Error(`(a) CHECK loai la: ${JSON.stringify(chk)}`);
    log("(a) 9 cot · PK (user_id, loai) · CHECK loai IN ('totp','backup') · default updated_at now(), tu_choi_dem 0");

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
      const chen = (loai, n = 1) => (sp) => sp`INSERT INTO public.totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau) VALUES (${uid}, ${loai}, ${n}, now())`;
      const totp = await maLoi(tx, chen("totp"));
      const backup = await maLoi(tx, chen("backup"));
      const trung = await maLoi(tx, chen("totp"));
      const loaiLa = await maLoi(tx, chen("khac"));
      const nullDem = await maLoi(tx, (sp) => sp`INSERT INTO public.totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau) VALUES (${uid - 1}, 'totp', NULL, now())`);
      const [up] = await tx`INSERT INTO public.totp_khoa_sai (user_id, loai, so_lan_sai, cua_so_bat_dau) VALUES (${uid}, 'backup', 1, now())
        ON CONFLICT (user_id, loai) DO UPDATE SET so_lan_sai = public.totp_khoa_sai.so_lan_sai + 1, updated_at = now() RETURNING so_lan_sai`;
      const [dem] = await tx`SELECT so_lan_sai AS n, tu_choi_dem AS t FROM public.totp_khoa_sai WHERE user_id = ${uid} AND loai = 'totp'`;
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.totp_khoa_sai WHERE user_id = ${uid}`);
      const [con] = await tx`SELECT count(*)::int AS n FROM public.totp_khoa_sai WHERE user_id = ${uid}`;
      return { totp, backup, trung, loaiLa, nullDem, upsertBackup: up.so_lan_sai, totpGiuNguyen: dem.n, tuChoiDemMacDinh: dem.t, xoa, conLai: con.n };
    });
    expectExact("(b) behaviour avi_app", r, {
      totp: null, backup: null, trung: "23505", loaiLa: "23514", nullDem: "23502", upsertBackup: 2, totpGiuNguyen: 1, tuChoiDemMacDinh: 0, xoa: null, conLai: 0,
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.totp_khoa_sai WHERE user_id IN (${uid}, ${uid - 1})`;
    expectExact("(b) probe rolled back", left, { n: 0 });
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify(r)}; ROLLED BACK`);
    log("(c) __applied_migrations: bo chay chung ghi + dem dung 1 hang sau verify");
  },
});
