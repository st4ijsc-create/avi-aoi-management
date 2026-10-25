#!/usr/bin/env node
/**
 * 0433 — SCADA R1b-1 Task 6: cot `scada_command_attempts.ly_do` varchar(300) NULL (bang WORM) + 3 FK ON DELETE CASCADE
 * (`scada_kenh_che_do`.machine_id -> machines, `scada_kenh_che_do`.adapter_id -> device_adapters, `scada_khoa_chon`.adapter_id -> device_adapters).
 * Ap `drizzle/0433_scada_ly_do_fk.sql` bang owner `aoi`, nghiem thu bang `avi_app`:
 *   (a) ly_do ton tai (character varying(300), nullable), bang van 13 cot; 3 FK dung ten / bang dich / cot / confdeltype='c' (CASCADE);
 *   (b) quyen avi_app tren scada_command_attempts KHONG DOI (SELECT/INSERT true, UPDATE/DELETE/TRUNCATE false); 2 trigger WORM van bat;
 *       giao dich HOAN TAC: avi_app INSERT co ly_do duoc, UPDATE ly_do 42501; owner UPDATE ly_do bi trigger WORM (23514);
 *       FK: kenh che do tro may / adapter khong ton tai => 23503; xoa device_adapters (adapter tam, trong giao dich hoan tac) =>
 *       dong scada_khoa_chon va scada_kenh_che_do tro toi no BIEN MAT (CASCADE);
 *   (c) `__applied_migrations` 1 hang (bo chay chung).
 *   node scripts/apply-migration-0433.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL + so dem mo coi (global-constraints).
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

// ten FK -> [bang, cot, bang dich, cot dich]
const FK = {
  scada_kenh_che_do_machine_fk: ["scada_kenh_che_do", "machine_id", "machines", "id"],
  scada_kenh_che_do_adapter_fk: ["scada_kenh_che_do", "adapter_id", "device_adapters", "id"],
  scada_khoa_chon_adapter_fk: ["scada_khoa_chon", "adapter_id", "device_adapters", "id"],
};

await runMigration({
  file: "0433_scada_ly_do_fk.sql",
  tag: "[0433]",
  async verify({ sql, appSql, log }) {
    // ── (a) cau truc ────────────────────────────────────────────────────────────────────────────────────────────
    const cols = await appSql`SELECT column_name AS c, data_type AS t, character_maximum_length AS len, is_nullable AS n
      FROM information_schema.columns WHERE table_schema='public' AND table_name='scada_command_attempts'`;
    const lyDo = cols.find((x) => x.c === "ly_do");
    expectExact("(a) scada_command_attempts.ly_do", { t: lyDo?.t, len: lyDo?.len, n: lyDo?.n }, { t: "character varying", len: 300, n: "YES" });
    if (cols.length !== 13) throw new Error(`(a) scada_command_attempts: ${cols.length} cot (muon 13 = 12 cu + ly_do)`);

    const fks = await appSql`SELECT c.conname AS n, c.conrelid::regclass::text AS t, a.attname AS col, c.confrelid::regclass::text AS rt, af.attname AS rcol,
        c.confdeltype AS del, c.convalidated AS ok
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND c.conrelid IN ('public.scada_kenh_che_do'::regclass, 'public.scada_khoa_chon'::regclass)`;
    expectExact("(a) so FK", { n: fks.length, ten: fks.map((r) => r.n).sort() }, { n: 3, ten: Object.keys(FK).sort() });
    for (const [ten, [t, col, rt, rcol]] of Object.entries(FK)) {
      const got = fks.find((r) => r.n === ten);
      expectExact(`(a) FK ${ten}`, got, { t, col, rt, rcol, del: "c", ok: true }); // confdeltype 'c' = ON DELETE CASCADE
    }
    log("(a) ly_do varchar(300) NULL · 13 cot · 3 FK ON DELETE CASCADE (validated)");

    // ── (b1) quyen + trigger WORM khong doi, do bang catalog ────────────────────────────────────────────────────
    const [g] = await appSql`SELECT
        has_table_privilege('avi_app', 'scada_command_attempts', 'SELECT') AS sel,
        has_table_privilege('avi_app', 'scada_command_attempts', 'INSERT') AS ins,
        has_table_privilege('avi_app', 'scada_command_attempts', 'UPDATE') AS upd,
        has_table_privilege('avi_app', 'scada_command_attempts', 'DELETE') AS del,
        has_table_privilege('avi_app', 'scada_command_attempts', 'TRUNCATE') AS trunc,
        has_sequence_privilege('avi_app', 'scada_command_attempts_id_seq', 'USAGE') AS seq`;
    expectExact("(b) has_table_privilege attempts", g, { sel: true, ins: true, upd: false, del: false, trunc: false, seq: true });
    const [colPriv] = await appSql`SELECT has_column_privilege('avi_app', 'scada_command_attempts', 'ly_do', 'UPDATE') AS u,
      has_column_privilege('avi_app', 'scada_command_attempts', 'ly_do', 'INSERT') AS i`;
    expectExact("(b) ly_do column privilege", colPriv, { u: false, i: true });
    const trg = await appSql`SELECT tgname AS n, tgenabled AS en FROM pg_trigger WHERE tgrelid = 'public.scada_command_attempts'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expectExact("(b) triggers WORM", { n: trg.map((r) => r.n), en: trg.map((r) => r.en) }, { n: ["trg_scada_command_attempts_worm", "trg_scada_command_attempts_worm_truncate"], en: ["O", "O"] });

    // ── (b2) hanh vi, giao dich hoan tac ───────────────────────────────────────────────────────────────────────
    const dai = "x".repeat(301);
    const r = await rolledBack(appSql, async (tx) => {
      const [ins] = await tx`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome, ly_do) VALUES ('probe0433', 1, 'request', 'rejected', 'ly do thu') RETURNING id, ly_do`;
      const [nul] = await tx`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome) VALUES ('probe0433b', 1, 'request', 'rejected') RETURNING ly_do`;
      const quaDai = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome, ly_do) VALUES ('probe0433c', 1, 'request', 'rejected', ${dai})`);
      const sua = await maLoi(tx, (sp) => sp`UPDATE public.scada_command_attempts SET ly_do = 'sua' WHERE id = ${ins.id}`);
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.scada_command_attempts WHERE id = ${ins.id}`);
      // FK: may / adapter khong ton tai => 23503 (vai avi_app; FK kiem bang quyen chu bang)
      const [adap] = await tx`SELECT id FROM public.device_adapters ORDER BY id LIMIT 1`;
      const mayLa = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (987654321, ${adap.id}, 'mode', '1'::jsonb, 1)`);
      const adapterLa = await maLoi(tx, (sp) => sp`INSERT INTO public.scada_khoa_chon (adapter_id, tag_key, user_id, request_id, expires_at) VALUES (987654321, 'probe0433', 1, 'r', now())`);
      return { lyDoLuu: ins.ly_do, lyDoNull: nul.ly_do, quaDai, sua, xoa, mayLa, adapterLa };
    });
    expectExact("(b) behaviour avi_app", r, { lyDoLuu: "ly do thu", lyDoNull: null, quaDai: "22001", sua: "42501", xoa: "42501", mayLa: "23503", adapterLa: "23503" });

    // WORM tren ly_do voi vai owner: trigger van chan UPDATE
    const w = await rolledBack(sql, async (tx) => {
      const [ins] = await tx`INSERT INTO public.scada_command_attempts (request_id, user_id, stage, outcome, ly_do) VALUES ('probe0433w', 1, 'request', 'rejected', 'a') RETURNING id`;
      return { upd: await maLoi(tx, (sp) => sp`UPDATE public.scada_command_attempts SET ly_do = 'b' WHERE id = ${ins.id}`) };
    });
    expectExact("(b) WORM trigger (owner) tren ly_do", w, { upd: "23514" });

    // CASCADE: adapter tam (chi cot NOT NULL) + khoa chon + kenh che do tro toi no; xoa adapter => ca hai dong bien mat. Vai owner, ROLLBACK.
    const c = await rolledBack(sql, async (tx) => {
      const [may] = await tx`SELECT id FROM public.machines ORDER BY id LIMIT 1`;
      if (!may) throw new Error("(b) khong co may nao de thu CASCADE kenh che do");
      const [proto] = await tx`SELECT (enum_range(NULL::"otprotocolenum"))[1]::text AS p`;
      const [ad] = await tx`INSERT INTO public.device_adapters ("code","name","protocol","endpoint") VALUES ('probe0433-adapter','probe0433',${proto.p}::"otprotocolenum",'probe://0433') RETURNING id`;
      await tx`INSERT INTO public.scada_khoa_chon (adapter_id, tag_key, user_id, request_id, expires_at) VALUES (${ad.id}, 'probe0433', 1, 'r', now())`;
      // PK machine_id: neu may da co hang kenh che do thi xoa hang do TRONG giao dich hoan tac de co cho chen
      await tx`DELETE FROM public.scada_kenh_che_do WHERE machine_id = ${may.id}`;
      await tx`INSERT INTO public.scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${may.id}, ${ad.id}, 'mode', '1'::jsonb, 1)`;
      const [truoc] = await tx`SELECT (SELECT count(*)::int FROM public.scada_khoa_chon WHERE adapter_id = ${ad.id}) AS khoa, (SELECT count(*)::int FROM public.scada_kenh_che_do WHERE adapter_id = ${ad.id}) AS che`;
      await tx`DELETE FROM public.device_adapters WHERE id = ${ad.id}`;
      const [sau] = await tx`SELECT (SELECT count(*)::int FROM public.scada_khoa_chon WHERE adapter_id = ${ad.id}) AS khoa, (SELECT count(*)::int FROM public.scada_kenh_che_do WHERE adapter_id = ${ad.id}) AS che`;
      return { truoc, sau };
    });
    expectExact("(b) CASCADE khi xoa device_adapters", c, { truoc: { khoa: 1, che: 1 }, sau: { khoa: 0, che: 0 } });

    const [left] = await appSql`SELECT (SELECT count(*)::int FROM public.scada_command_attempts WHERE request_id LIKE 'probe0433%') AS a,
      (SELECT count(*)::int FROM public.device_adapters WHERE code = 'probe0433-adapter') AS d,
      (SELECT count(*)::int FROM public.scada_khoa_chon WHERE tag_key = 'probe0433') AS k`;
    expectExact("(b) probe rolled back", left, { a: 0, d: 0, k: 0 });
    log(`(b) privileges ${JSON.stringify(g)}; behaviour ${JSON.stringify(r)}; owner WORM ${JSON.stringify(w)}; cascade ${JSON.stringify(c)}; ROLLED BACK`);
    log("(c) __applied_migrations: bo chay chung ghi + dem dung 1 hang sau verify");
  },
});
