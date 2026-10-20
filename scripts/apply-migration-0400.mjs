#!/usr/bin/env node
/**
 * 0400 — SỔ MODEL (AI Local Đợt 7.0): `ai_model_artifacts`, `ai_serving_profiles`, `ai_roles`, `ai_model_bindings`,
 * `ai_model_eval_runs` + seed 11 vai trò + 11 gán global THEO-ENV. Áp `drizzle/0400_ai_model_registry.sql` bằng owner `aoi`,
 * rồi NGHIỆM THU bằng vai `avi_app` (bộ chạy chung apply-migration-dot10-common.mjs):
 *   (a) danh mục: 5 bảng; CHECK đúng tên; chỉ mục UNIQUE một phần `ai_model_bindings_hieu_luc_uq`;
 *   (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE có; TRUNCATE/REFERENCES/TRIGGER không (5 bảng);
 *   (c) hành vi trong một giao dịch LUÔN HOÀN TÁC: gán có cả profileId lẫn envKey ⇒ 23514; gán không đích ⇒ 23514;
 *       gán global có scopeId ⇒ 23514; gán project không scopeId ⇒ 23514; hai gán active cùng (vai trò, global) chưa
 *       retire ⇒ 23505; cùng khoá nhưng hàng cũ đã retire ⇒ được; chế độ 'thu' song song active ⇒ được; vai trò `../x`
 *       ⇒ 23514; filePath `a/b.gguf` ⇒ 23514; filePath `..x.gguf` ⇒ 23514; slot lạ ⇒ 23514; 0 hàng dò còn lại;
 *   (d) seed: 11 vai trò, mỗi vai trò đúng 1 gán global active theo-env còn hiệu lực, envKey khớp vai trò;
 *   (e) `__applied_migrations` có đúng 1 hàng cho tệp này (bộ chạy chung).
 *
 *   node scripts/apply-migration-0400.mjs --test-only | --dev-only | --both   (KHÔNG cờ ⇒ từ chối — R-3-g)
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const BANG = ["ai_model_artifacts", "ai_model_bindings", "ai_model_eval_runs", "ai_roles", "ai_serving_profiles"];
const CHECKS = [
  "chk_ai_model_artifacts_file_path",
  "chk_ai_model_artifacts_loai",
  "chk_ai_model_artifacts_status",
  "chk_ai_model_bindings_dich",
  "chk_ai_model_bindings_mode",
  "chk_ai_model_bindings_scope",
  "chk_ai_roles_id",
  "chk_ai_serving_profiles_ctx",
  "chk_ai_serving_profiles_slot",
  "chk_ai_serving_profiles_thinking",
];
const SEED = {
  chat: "GGUF_DEFAULT_MODEL",
  "chat.ops": "GGUF_FAST_MODEL",
  classify: "GGUF_FAST_MODEL",
  "code.plc": "GGUF_CODE_MODEL",
  "code.software": "GGUF_CODE_MODEL",
  embed: "GGUF_EMBED_MODEL",
  extract: "GGUF_FAST_MODEL",
  fim: "GGUF_FIM_MODEL",
  rerank: "GGUF_RERANKER_MODEL",
  summarize: "GGUF_DEFAULT_MODEL",
  vision: "GGUF_VISION_MODEL",
};

await runMigration({
  file: "0400_ai_model_registry.sql",
  tag: "[0400]",
  async verify({ appSql, log }) {
    // (a) danh mục
    const bang = (
      await appSql`SELECT table_name AS t FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = ANY(${BANG}) ORDER BY 1`
    ).map((r) => r.t);
    expectExact("(a) tables", { bang }, { bang: BANG });
    const checks = (
      await appSql`SELECT conname AS n FROM pg_constraint
                    WHERE contype = 'c' AND conrelid::regclass::text = ANY(${BANG.map((b) => `public.${b}`).concat(BANG)}) ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) checks", { checks }, { checks: CHECKS });
    const uq = (
      await appSql`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ai_model_bindings'
                    AND indexdef ILIKE 'CREATE UNIQUE INDEX%WHERE%' ORDER BY 1`
    ).map((r) => r.n);
    expectExact("(a) partial unique", { uq }, { uq: ["ai_model_bindings_hieu_luc_uq"] });
    log(`(a) ${BANG.length} tables · ${CHECKS.length} CHECK · 1 partial UNIQUE`);

    // (b) quyền
    for (const b of BANG) {
      expectExact(`(b) privileges ${b}`, await tablePriv(appSql, `public.${b}`), {
        sel: true, ins: true, upd: true, del: true, trunc: false, refs: false, trig: false,
      });
    }
    log("(b) avi_app: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER (5 tables)");

    // (c) hành vi — avi_app, luôn hoàn tác
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      await tx`INSERT INTO public.ai_roles (id, "moTa", "envKey", "taskKind") VALUES ('probe0400.r', 'dò', 'GGUF_CODE_MODEL', 'code')`;
      await tx`INSERT INTO public.ai_model_artifacts (id, "filePath", family) VALUES ('probe0400-a', 'probe0400-a.gguf', 'probe')`;
      await tx`INSERT INTO public.ai_serving_profiles (id, "artifactId", "slotClass", ctx) VALUES ('probe0400-p', 'probe0400-a', 'nho', 4096)`;
      const gan = (sp, o) =>
        sp`INSERT INTO public.ai_model_bindings ("roleId", "scopeKind", "scopeId", "profileId", "envKey", mode, "retiredAt")
           VALUES ('probe0400.r', ${o.scopeKind ?? "global"}, ${o.scopeId ?? null}, ${o.profileId === undefined ? null : o.profileId},
                   ${o.envKey === undefined ? "GGUF_CODE_MODEL" : o.envKey}, ${o.mode ?? "active"}, ${o.retiredAt ?? null})`;
      out.caHai = await maLoi(tx, (sp) => gan(sp, { profileId: "probe0400-p" }));
      out.khongDich = await maLoi(tx, (sp) => gan(sp, { envKey: null }));
      out.globalCoScope = await maLoi(tx, (sp) => gan(sp, { scopeId: "x" }));
      out.projectKhongScope = await maLoi(tx, (sp) => gan(sp, { scopeKind: "project" }));
      out.daRetire = await maLoi(tx, (sp) => gan(sp, { retiredAt: new Date() }));
      out.hopLe = await maLoi(tx, (sp) => gan(sp, {}));
      out.trung = await maLoi(tx, (sp) => gan(sp, {}));
      out.thuSongSong = await maLoi(tx, (sp) => gan(sp, { mode: "thu", envKey: null, profileId: "probe0400-p" }));
      out.projectHopLe = await maLoi(tx, (sp) => gan(sp, { scopeKind: "project", scopeId: "du-an-1" }));
      out.vaiTroXau = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_roles (id, "moTa", "envKey", "taskKind") VALUES ('../x', 'x', 'GGUF_CODE_MODEL', 'code')`);
      out.tepCoThuMuc = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_model_artifacts (id, "filePath", family) VALUES ('probe0400-b', 'a/b.gguf', 'p')`);
      out.tepDiNguoc = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_model_artifacts (id, "filePath", family) VALUES ('probe0400-c', '..x.gguf', 'p')`);
      out.slotLa = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_serving_profiles (id, "artifactId", "slotClass", ctx) VALUES ('probe0400-q', 'probe0400-a', 'to', 4096)`);
      return out;
    });
    expectExact("(c) behaviour", r, {
      caHai: "23514",
      khongDich: "23514",
      globalCoScope: "23514",
      projectKhongScope: "23514",
      daRetire: null,
      hopLe: null,
      trung: "23505",
      thuSongSong: null,
      projectHopLe: null,
      vaiTroXau: "23514",
      tepCoThuMuc: "23514",
      tepDiNguoc: "23514",
      slotLa: "23514",
    });
    const [left] = await appSql`SELECT (SELECT count(*) FROM public.ai_roles WHERE id LIKE 'probe0400%')
                                     + (SELECT count(*) FROM public.ai_model_artifacts WHERE id LIKE 'probe0400%') AS n`;
    if (Number(left.n) !== 0) throw new Error(`(c) probe NOT rolled back: ${left.n} rows left`);
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);

    // (d) seed
    const vt = Object.fromEntries(
      (await appSql`SELECT id, "envKey" AS k FROM public.ai_roles WHERE id NOT LIKE 'probe%' ORDER BY id`).map((x) => [x.id, x.k]),
    );
    expectExact("(d) roles", vt, SEED);
    const gan = Object.fromEntries(
      (
        await appSql`SELECT "roleId" AS r, count(*)::int AS n, max("envKey") AS k FROM public.ai_model_bindings
                      WHERE "scopeKind" = 'global' AND mode = 'active' AND "retiredAt" IS NULL GROUP BY 1 ORDER BY 1`
      ).map((x) => [x.r, `${x.n}:${x.k ?? "profile"}`]),
    );
    expectExact("(d) seed bindings", gan, Object.fromEntries(Object.entries(SEED).map(([k, v]) => [k, `1:${v}`])));
    log(`(d) ${Object.keys(SEED).length} roles · ${Object.keys(SEED).length} global env-following bindings`);
  },
});
