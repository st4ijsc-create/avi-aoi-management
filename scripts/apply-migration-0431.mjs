#!/usr/bin/env node
/**
 * 0431 — SCADA R1a Task 1: kenh (channel) tren `device_tags`, `scada_kenh_che_do` (K2), `scada_khoa_chon` (K6),
 * `scada_command_attempts` (§C.5, WORM). Ap `drizzle/0431_scada_kenh_lenh.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) moi cot / bang / CHECK / trigger ton tai dung kieu;
 *   (b) giao dich hoan tac: actuation_level=2, write_min>write_max, write_step<=0 bi CHECK tu choi (23514); stage/outcome la bi tu choi;
 *       avi_app INSERT duoc, UPDATE/DELETE tren scada_command_attempts bi 42501; has_table_privilege UPDATE=false, DELETE=false, INSERT=true;
 *       owner UPDATE/DELETE/TRUNCATE bi trigger WORM tu choi (23514);
 *   (c) `__applied_migrations` 1 hang (bo chay chung).
 *   node scripts/apply-migration-0431.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so dem (global-constraints).
 * R1b-1 T6 (2026-10-24, fix round 1): verify CHAY LAI DUOC sau 0433 — kiem cot la TAP CON (0433 them ly_do), va hai probe id gia
 * (adapter 999999 / may 987654) coi 23503 (FK them o 0433) la dat.
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

const COT_DEVICE_TAGS = {
  channel_kind: { t: "USER-DEFINED", udt: "scada_channel_kind" },
  display_name: { t: "character varying", len: 128 },
  display_format: { t: "character varying", len: 64 },
  write_min: { t: "double precision" },
  write_max: { t: "double precision" },
  write_step: { t: "double precision" },
  actuation_level: { t: "smallint" },
};

await runMigration({
  file: "0431_scada_kenh_lenh.sql",
  tag: "[0431]",
  async verify({ sql, appSql, log }) {
    // ── (a) cau truc ────────────────────────────────────────────────────────────────────────────────────────────
    const cols = await appSql`SELECT column_name AS c, data_type AS t, udt_name AS udt, character_maximum_length AS len, is_nullable AS n
      FROM information_schema.columns WHERE table_schema='public' AND table_name='device_tags' AND column_name = ANY(${Object.keys(COT_DEVICE_TAGS)})`;
    for (const [c, want] of Object.entries(COT_DEVICE_TAGS)) {
      const got = cols.find((x) => x.c === c);
      expectExact(
        `(a) device_tags.${c}`,
        { t: got?.t, len: got?.len ?? undefined, udt: want.udt ? got?.udt : undefined, n: got?.n },
        { t: want.t, len: want.len, udt: want.udt, n: "YES" },
      );
    }
    const [enumVals] = await appSql`SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'scada_channel_kind'`;
    expectExact("(a) enum", { v: enumVals?.v }, { v: ["input", "input_output", "calculated", "calculated_output", "output"] });

    const BANG = {
      scada_kenh_che_do: { machine_id: "integer", adapter_id: "integer", tag_key: "character varying", gia_tri_remote: "jsonb", updated_by: "integer", updated_at: "timestamp with time zone" },
      scada_khoa_chon: { adapter_id: "integer", tag_key: "character varying", user_id: "integer", request_id: "character varying", expires_at: "timestamp with time zone" },
      scada_command_attempts: {
        id: "bigint", request_id: "character varying", user_id: "integer", adapter_id: "integer", tag_key: "character varying", requested_value: "jsonb", after_formula: "jsonb",
        stage: "character varying", outcome: "character varying", reason_code: "character varying", command_log_ids: "ARRAY", at: "timestamp with time zone",
      },
    };
    for (const [t, want] of Object.entries(BANG)) {
      const rows = await appSql`SELECT column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema='public' AND table_name=${t}`;
      expectExact(`(a) ${t} columns`, Object.fromEntries(rows.map((r) => [r.c, r.d])), want);
      if (rows.length < Object.keys(want).length) throw new Error(`(a) ${t}: ${rows.length} cot (muon >= ${Object.keys(want).length}; cot them o migration sau, vd 0433 ly_do, duoc phep)`);
    }
    const [arr] = await appSql`SELECT format_type(a.atttypid, a.atttypmod) AS ty FROM pg_attribute a WHERE a.attrelid = 'public.scada_command_attempts'::regclass AND a.attname = 'command_log_ids'`;
    expectExact("(a) command_log_ids", arr, { ty: "bigint[]" });
    const pk = await appSql`SELECT conrelid::regclass::text AS t, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype='p' AND conrelid IN ('public.scada_kenh_che_do'::regclass, 'public.scada_khoa_chon'::regclass)`;
    expectExact("(a) primary keys", Object.fromEntries(pk.map((r) => [r.t, r.d])), { scada_kenh_che_do: "PRIMARY KEY (machine_id)", scada_khoa_chon: "PRIMARY KEY (adapter_id, tag_key)" });
    const chk = await appSql`SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype='c' AND conname IN (
      'device_tags_actuation_level_chk','device_tags_write_range_chk','device_tags_write_step_chk','scada_command_attempts_stage_chk','scada_command_attempts_outcome_chk')`;
    const chkMap = Object.fromEntries(chk.map((r) => [r.n, r.d]));
    if (Object.keys(chkMap).length !== 5) throw new Error(`(a) CHECK: thay ${Object.keys(chkMap).join(",")} (muon 5)`);
    if (!/1, 3, 4, 5/.test(chkMap.device_tags_actuation_level_chk)) throw new Error(`(a) actuation CHECK la: ${chkMap.device_tags_actuation_level_chk}`);
    const trg = await appSql`SELECT tgname AS n, tgenabled AS en FROM pg_trigger WHERE tgrelid = 'public.scada_command_attempts'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expectExact("(a) triggers", { n: trg.map((r) => r.n), en: trg.map((r) => r.en) }, { n: ["trg_scada_command_attempts_worm", "trg_scada_command_attempts_worm_truncate"], en: ["O", "O"] });
    log("(a) 7 cot device_tags · enum 5 gia tri · 3 bang · 2 PK · 5 CHECK · 2 trigger WORM (UPDATE/DELETE, TRUNCATE)");

    // ── (b1) quyen, do bang catalog ─────────────────────────────────────────────────────────────────────────────
    const [g] = await appSql`SELECT
        has_table_privilege('avi_app', 'scada_command_attempts', 'SELECT') AS sel,
        has_table_privilege('avi_app', 'scada_command_attempts', 'INSERT') AS ins,
        has_table_privilege('avi_app', 'scada_command_attempts', 'UPDATE') AS upd,
        has_table_privilege('avi_app', 'scada_command_attempts', 'DELETE') AS del,
        has_table_privilege('avi_app', 'scada_command_attempts', 'TRUNCATE') AS trunc,
        has_sequence_privilege('avi_app', 'scada_command_attempts_id_seq', 'USAGE') AS seq`;
    expectExact("(b) has_table_privilege", g, { sel: true, ins: true, upd: false, del: false, trunc: false, seq: true });
    for (const t of ["scada_kenh_che_do", "scada_khoa_chon"]) {
      const [p] = await appSql`SELECT has_table_privilege('avi_app', ${t}, 'SELECT') AS sel, has_table_privilege('avi_app', ${t}, 'INSERT') AS ins,
        has_table_privilege('avi_app', ${t}, 'UPDATE') AS upd, has_table_privilege('avi_app', ${t}, 'DELETE') AS del`;
      expectExact(`(b) ${t} privileges`, p, { sel: true, ins: true, upd: true, del: true });
    }

    // ── (b2) hanh vi, giao dich hoan tac, vai avi_app ───────────────────────────────────────────────────────────
    const r = await rolledBack(appSql, async (tx) => {
      const adapterId = 999999;
      const chen = (x) => (sp) => sp`INSERT INTO public.device_tags ("adapterId","tagKey","address","dataType","actuation_level","write_min","write_max","write_step")
        VALUES (${adapterId}, 'probe0431', 'X0', 'float', ${x.lv ?? null}, ${x.min ?? null}, ${x.max ?? null}, ${x.step ?? null})`;
      const level2 = await maLoi(tx, chen({ lv: 2 }));
      const minGtMax = await maLoi(tx, chen({ min: 10, max: 5 }));
      const stepKhong = await maLoi(tx, chen({ step: 0 }));
      const stepAm = await maLoi(tx, chen({ step: -1 }));
      const levelOk = await maLoi(tx, chen({ lv: 3, min: 0, max: 10, step: 0.5 }));
      const rongOk = await maLoi(tx, (sp) => sp`INSERT INTO public.device_tags ("adapterId","tagKey","address","dataType") VALUES (${adapterId}, 'probe0431b', 'X1', 'bool')`);
      const [nullCols] = await tx`SELECT channel_kind AS k, actuation_level AS l, write_min AS mi FROM public.device_tags WHERE "tagKey" = 'probe0431b'`;
      const kenhLa = await maLoi(tx, (sp) => sp`UPDATE public.device_tags SET channel_kind = 'khong_co' WHERE "tagKey" = 'probe0431b'`);
      const kenhOk = await maLoi(tx, (sp) => sp`UPDATE public.device_tags SET channel_kind = 'calculated_output' WHERE "tagKey" = 'probe0431b'`);

      const [ins] = await tx`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome, requested_value, command_log_ids)
        VALUES ('probe0431', 1, 'request', 'proposed', '"1"'::jsonb, ARRAY[1,2]::bigint[]) RETURNING id, command_log_ids`;
      const stageLa = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_command_attempts (user_id, stage, outcome) VALUES (1, 'la', 'rejected')`);
      const outcomeLa = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_command_attempts (user_id, stage, outcome) VALUES (1, 'request', 'la')`);
      const upd = await maLoi(tx, (sp) => sp`UPDATE public.scada_command_attempts SET outcome = 'cancelled' WHERE id = ${ins.id}`);
      const del = await maLoi(tx, (sp) => sp`DELETE FROM public.scada_command_attempts WHERE id = ${ins.id}`);
      const trunc = await maLoi(tx, (sp) => sp`TRUNCATE public.scada_command_attempts`);
      const khoa = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_khoa_chon (adapter_id, tag_key, user_id, request_id, expires_at) VALUES (${adapterId}, 'probe0431', 1, 'r', now())`);
      const khoaTrung = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_khoa_chon (adapter_id, tag_key, user_id, request_id, expires_at) VALUES (${adapterId}, 'probe0431', 2, 'r2', now())`);
      const che = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (987654, ${adapterId}, 'mode', '1'::jsonb, 1)`);
      const cheTrung = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (987654, ${adapterId}, 'mode', '2'::jsonb, 1)`);
      // 0433 them FK (adapter/may) => id gia 999999 / 987654 bi 23503 truoc khi toi PK: 23503 = FK ton tai = dat (ruling R1b-1 T6 I2);
      // khi chua co 0433 thi ket qua cu (null / 23505) van dung.
      const fk = (v, khiFk) => (v === "23503" ? khiFk : v);
      return { level2, minGtMax, stepKhong, stepAm, levelOk, rongOk, nullCols, kenhLa, kenhOk, chenAttempt: ins.command_log_ids, stageLa, outcomeLa, upd, del, trunc, khoa: fk(khoa, null), khoaTrung: fk(khoaTrung, "23505"), che: fk(che, null), cheTrung: fk(cheTrung, "23505") };
    });
    expectExact("(b) behaviour avi_app", r, {
      level2: "23514", minGtMax: "23514", stepKhong: "23514", stepAm: "23514", levelOk: null, rongOk: null,
      nullCols: { k: null, l: null, mi: null }, kenhLa: "22P02", kenhOk: null, chenAttempt: ["1", "2"],
      stageLa: "23514", outcomeLa: "23514", upd: "42501", del: "42501", trunc: "42501", khoa: null, khoaTrung: "23505", che: null, cheTrung: "23505",
    });

    // ── (b3) WORM bang trigger, vai owner (ke ca owner cung khong sua duoc) ────────────────────────────────────────
    const w = await rolledBack(sql, async (tx) => {
      const [ins] = await tx`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome) VALUES ('probe0431w', 1, 'request', 'rejected') RETURNING id`;
      const upd = await maLoi(tx, (sp) => sp`UPDATE public.scada_command_attempts SET outcome = 'cancelled' WHERE id = ${ins.id}`);
      const del = await maLoi(tx, (sp) => sp`DELETE FROM public.scada_command_attempts WHERE id = ${ins.id}`);
      const trunc = await maLoi(tx, (sp) => sp`TRUNCATE public.scada_command_attempts`);
      return { upd, del, trunc };
    });
    expectExact("(b) WORM trigger (owner)", w, { upd: "23514", del: "23514", trunc: "23514" });

    const [left] = await appSql`SELECT (SELECT count(*)::int FROM public.device_tags WHERE "tagKey" LIKE 'probe0431%') AS t,
      (SELECT count(*)::int FROM public.scada_command_attempts WHERE request_id LIKE 'probe0431%') AS a,
      (SELECT count(*)::int FROM public.scada_khoa_chon WHERE tag_key = 'probe0431') AS k,
      (SELECT count(*)::int FROM public.scada_kenh_che_do WHERE machine_id = 987654) AS c`;
    expectExact("(b) probe rolled back", left, { t: 0, a: 0, k: 0, c: 0 });
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify({ ...r, nullCols: undefined })}; owner WORM ${JSON.stringify(w)}; ROLLED BACK`);
    log("(c) __applied_migrations: bo chay chung ghi + dem dung 1 hang sau verify");
  },
});
