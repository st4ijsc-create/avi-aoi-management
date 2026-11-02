#!/usr/bin/env node
/**
 * 0435 — F5 day du: kenh `socket_pham_vi` (TRIGGER pg_notify khi quyen / pham vi / phien cua mot nguoi doi).
 * Ap `drizzle/0435_socket_pham_vi.sql` bang owner `aoi` (DDL), nghiem thu bang `avi_app`:
 *   (a) catalog: 8 trigger tren 6 bang, dung su kien / cot `UPDATE OF` / co WHEN / ham goi / AFTER ROW / dang bat (pg_trigger +
 *       pg_get_triggerdef); cot ma ham tai trong doc ton tai tren bang that (information_schema);
 *   (b) ve sinh ham (R-10-e, bo chay chung): `socket_pham_vi_payload` avi_app EXECUTE duoc THEO THIET KE (ngoai le RIENG cua tep nay,
 *       `hygiene.callableByDesign` — tap chung EDGE_FN_CALLABLE KHONG mo rong); `socket_pham_vi_notify` KHONG ai EXECUTE;
 *       search_path ghim; IMMUTABLE cho ham tai trong;
 *   (c) hanh vi ham tai trong bang SELECT thuan trong giao dich HOAN TAC: moi bang x thao tac, UPDATE khong doi cot quan trong ⇒ NULL,
 *       phien chi true→false, userId cu + moi, KHONG token / KHONG cot nao khac trong bat ky tai trong nao;
 *   (d) `__applied_migrations` 1 hang (bo chay chung).
 *   node scripts/apply-migration-0435.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi do phien dieu phoi, sau khi F5 qua cong gop va len main. Task F5 chi chay --test-only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expectExact, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

/** Trigger mong doi: ten → { bang, su kien, cot UPDATE OF (sap xep), co WHEN }. */
const TRIGGER_0435 = {
  trg_socket_pham_vi_users_upd: { bang: "users", ev: ["UPDATE"], cot: ["isActive", "passwordInvalidBefore", "role"], when: true },
  trg_socket_pham_vi_users_del: { bang: "users", ev: ["DELETE"], cot: [], when: false },
  trg_socket_pham_vi_sessions_upd: { bang: "user_sessions", ev: ["UPDATE"], cot: ["isActive"], when: true },
  trg_socket_pham_vi_sessions_del: { bang: "user_sessions", ev: ["DELETE"], cot: [], when: false },
  trg_socket_pham_vi_ufa: { bang: "user_factory_assignments", ev: ["DELETE", "INSERT", "UPDATE"], cot: [], when: false },
  trg_socket_pham_vi_uca: { bang: "user_corporate_assignments", ev: ["DELETE", "INSERT", "UPDATE"], cot: [], when: false },
  trg_socket_pham_vi_permissions: { bang: "permissions", ev: ["DELETE", "INSERT", "UPDATE"], cot: [], when: false },
  trg_socket_pham_vi_factories: { bang: "factories", ev: ["UPDATE"], cot: ["code", "corporateCode"], when: true },
};

/** Manh WHEN phai co trong pg_get_triggerdef (so sau khi bo ngoac, khoang trang, nhay kep, ha chu). */
const WHEN_CAN = {
  trg_socket_pham_vi_users_upd: ["old.roleisdistinctfromnew.role", "old.isactiveisdistinctfromnew.isactive", "old.passwordinvalidbeforeisdistinctfromnew.passwordinvalidbefore"],
  trg_socket_pham_vi_sessions_upd: ["old.isactiveandnotnew.isactive"],
  trg_socket_pham_vi_factories: ["old.codeisdistinctfromnew.code", "old.corporatecodeisdistinctfromnew.corporatecode"],
};

/** Cot ma ham tai trong doc (to_jsonb(OLD/NEW) → khoa = ten cot that). */
const COT_CAN = {
  users: ["id", "role", "isActive", "passwordInvalidBefore"],
  user_sessions: ["id", "userId", "isActive", "sessionToken"],
  user_factory_assignments: ["userId"],
  user_corporate_assignments: ["userId"],
  permissions: ["userId"],
  factories: ["code", "corporateCode"],
};

/** Ca hanh vi DUNG CHUNG voi `server/_core/socketPhamVi0435.db.test.ts`: [nhan, bang, op, old, new, mong (null | doi tuong JSON)].
 *  Hang chua token / ten / mat khau de chung minh chung KHONG lot ra tai trong. */
const CA_0435 = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "migration0435Cases.json"), "utf-8")).cases;

// pg_get_triggerdef chen ep kieu cho cot varchar (`(old.code)::text`) ⇒ bo `::<kieu>` truoc khi so.
const chuan = (s) => String(s).replace(/::[a-z_]+/gi, "").replace(/[()"\s]/g, "").toLowerCase();

await runMigration({
  file: "0435_socket_pham_vi.sql",
  tag: "[0435]",
  hygiene: { callableByDesign: new Set(["socket_pham_vi_payload"]) },
  async verify({ appSql, log }) {
    // ── (a) catalog ─────────────────────────────────────────────────────────────────────────────────────────────
    const rows = await appSql`
      SELECT t.tgname AS ten, c.relname AS bang, n.nspname AS lop, t.tgtype::int AS kieu, t.tgenabled AS bat, t.tgqual IS NOT NULL AS co_when,
             p.proname AS ham, pn.nspname AS ham_lop, pg_get_triggerdef(t.oid) AS dinh_nghia,
             COALESCE((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
                        WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])), ARRAY[]::text[]) AS cot
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
       WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_socket_pham_vi%'`;
    const thay = Object.fromEntries(rows.map((r) => [r.ten, r]));
    expectExact("(a) trigger names", { ten: Object.keys(thay).sort() }, { ten: Object.keys(TRIGGER_0435).sort() });
    for (const [ten, mong] of Object.entries(TRIGGER_0435)) {
      const r = thay[ten];
      const kieu = r.kieu;
      const ev = [["INSERT", 4], ["DELETE", 8], ["UPDATE", 16], ["TRUNCATE", 32]].filter(([, b]) => (kieu & b) !== 0).map(([e]) => e).sort();
      const got = {
        bang: r.bang, lop: r.lop, row: (kieu & 1) === 1, after: (kieu & 2) === 0 && (kieu & 64) === 0, ev, cot: [...r.cot].sort(),
        co_when: r.co_when, bat: r.bat, ham: `${r.ham_lop}.${r.ham}`,
      };
      expectExact(`(a) ${ten}`, got, {
        bang: mong.bang, lop: "public", row: true, after: true, ev: mong.ev, cot: [...mong.cot].sort(), co_when: mong.when, bat: "O", ham: "public.socket_pham_vi_notify",
      });
      for (const manh of WHEN_CAN[ten] ?? []) {
        if (!chuan(r.dinh_nghia).includes(manh)) throw new Error(`(a) ${ten}: WHEN lacks "${manh}" — ${r.dinh_nghia}`);
      }
    }
    for (const [bang, cot] of Object.entries(COT_CAN)) {
      const co = (await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=${bang}`).map((x) => x.c);
      const thieu = cot.filter((c) => !co.includes(c));
      if (thieu.length) throw new Error(`(a) ${bang} lacks columns ${thieu.join(", ")} that the payload function reads`);
    }
    log(`(a) ${rows.length} triggers on ${new Set(rows.map((r) => r.bang)).size} tables: events / UPDATE OF / WHEN / AFTER ROW / enabled / function as expected`);

    // ── (b) phan bo sung cua ve sinh ham (bo chay chung da kiem search_path + PUBLIC + avi_app EXECUTE) ───────────
    const fn = await appSql`
      SELECT p.proname AS ten, p.provolatile AS bien, p.prosecdef AS definer,
             has_function_privilege(current_user, p.oid, 'EXECUTE') AS app, has_function_privilege('public', p.oid, 'EXECUTE') AS pub
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('socket_pham_vi_payload', 'socket_pham_vi_notify') ORDER BY p.proname`;
    expectExact("(b) functions", { fn: fn.map((f) => `${f.ten}:${f.bien}:${f.definer}:${f.app}:${f.pub}`) }, {
      fn: ["socket_pham_vi_notify:v:false:false:false", "socket_pham_vi_payload:i:false:true:false"],
    });
    log("(b) socket_pham_vi_payload IMMUTABLE INVOKER, avi_app EXECUTE (by design), not PUBLIC; socket_pham_vi_notify executable by nobody");

    // ── (c) hanh vi ham tai trong — SELECT thuan, giao dich HOAN TAC ─────────────────────────────────────────────
    const ket = await rolledBack(appSql, async (tx) => {
      const out = [];
      for (const [nhan, bang, op, cu, moi, mong] of CA_0435) {
        const [r] = await tx`SELECT public.socket_pham_vi_payload(${bang}, ${op}, ${cu === null ? null : tx.json(cu)}::jsonb, ${moi === null ? null : tx.json(moi)}::jsonb) AS p`;
        out.push({ nhan, mong, p: r.p });
      }
      return out;
    });
    const sai = [];
    for (const { nhan, mong, p } of ket) {
      if (mong === null) {
        if (p !== null) sai.push(`${nhan}: want NULL, got ${p}`);
        continue;
      }
      if (typeof p !== "string") {
        sai.push(`${nhan}: want ${JSON.stringify(mong)}, got NULL`);
        continue;
      }
      if (/tok-BI-MAT|hash-bi-mat|Ten Bi Mat|sessionToken|F-A|C-1/.test(p)) sai.push(`${nhan}: payload carries a row value: ${p}`);
      const o = JSON.parse(p);
      if (Object.keys(o).some((k) => !["u", "s", "all"].includes(k))) sai.push(`${nhan}: payload has a foreign key: ${p}`);
      if (JSON.stringify(o) !== JSON.stringify(mong)) sai.push(`${nhan}: want ${JSON.stringify(mong)}, got ${p}`);
    }
    if (sai.length) throw new Error(`(c) payload behaviour:\n  ${sai.join("\n  ")}`);
    log(`(c) payload function: ${ket.length} cases (every table x op, no-change UPDATE => NULL, session true->false only, old+new userId, no row value); ROLLED BACK`);
  },
});
