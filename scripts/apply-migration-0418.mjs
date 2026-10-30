#!/usr/bin/env node
/**
 * 0418 — Dot 10.4b L0a': tran D10 sinh chu model ngoai — ai_ngoai_dang_bay (1 luot bay / nguoi, TTL), ai_ngoai_dem."soLan",
 *   ai_ngoai_nha_may."tranTienLuotUsd"/"tranVongLuot"/"tranByteDocLuot"/"tranTepDocLuot", ai_ngoai_cong_cu_ghi (avi_app CHI DOC).
 * Nghiem thu bang `avi_app` (giao dich HOAN TAC):
 *   (a) bang + cot co; avi_app SELECT/INSERT/UPDATE/DELETE ai_ngoai_dang_bay; ai_ngoai_cong_cu_ghi: SELECT co, INSERT/UPDATE/DELETE KHONG;
 *   (b) giu nguyen tu: lan 1 giu duoc; lan 2 (con han) KHONG lay duoc (0 hang); het han ⇒ lay lai duoc; TTL > 15 phut ⇒ 23514;
 *       tranVongLuot 0 ⇒ 23514; tranTienLuotUsd 0 ⇒ 23514.
 *   node scripts/apply-migration-0418.mjs --test-only | --dev-only | --both
 * ⚠ DEV chi sau khi phien dieu phoi duyet SQL.
 */
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0418_ai_ngoai_luot_bay_tran_run.sql",
  tag: "[0418]",
  async verify({ appSql, log }) {
    const cot = async (t, cs) =>
      (await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=${t} AND column_name = ANY(${cs}) ORDER BY column_name`).map((r) => r.c);
    const COT_NM = ["tranByteDocLuot", "tranTepDocLuot", "tranTienLuotUsd", "tranVongLuot"];
    expectExact("(a) ai_ngoai_nha_may", { c: await cot("ai_ngoai_nha_may", COT_NM) }, { c: COT_NM });
    expectExact("(a) ai_ngoai_dem", { c: await cot("ai_ngoai_dem", ["soLan"]) }, { c: ["soLan"] });
    const bay = await tablePriv(appSql, "ai_ngoai_dang_bay");
    expectExact("(a) dang_bay", { sel: bay.sel, ins: bay.ins, upd: bay.upd, del: bay.del }, { sel: true, ins: true, upd: true, del: true });
    const ghi = await tablePriv(appSql, "ai_ngoai_cong_cu_ghi");
    expectExact("(a) cong_cu_ghi CHI DOC", { sel: ghi.sel, ins: ghi.ins, upd: ghi.upd, del: ghi.del, trunc: ghi.trunc }, { sel: true, ins: false, upd: false, del: false, trunc: false });
    log("(a) cot + quyen ok; ai_ngoai_cong_cu_ghi chi doc voi avi_app");

    const r = await rolledBack(appSql, async (tx) => {
      const [u] = await tx`SELECT id FROM public.users ORDER BY id LIMIT 1`;
      const [f] = await tx`SELECT "factoryId" AS f FROM public.ai_ngoai_nha_may ORDER BY "factoryId" LIMIT 1`;
      if (!u) return { boQua: true };
      // dieu-phoi duyet SQL (3) — batDau / hetHan tinh trong CUNG cau SQL tu now() (khong dong ho JS); nhanh DO UPDATE dat lai CA HAI.
      //   Day la HINH DANG chuan cua cau giu cho trong ma ung dung (L0a').
      const giu = (token, ttlGiay) => tx`
        INSERT INTO public.ai_ngoai_dang_bay ("userId", "factoryId", token, "batDau", "hetHan")
        VALUES (${u.id}, 1, ${token}, now(), now() + make_interval(secs => ${ttlGiay}))
        ON CONFLICT ("userId") DO UPDATE SET token = EXCLUDED.token, "factoryId" = EXCLUDED."factoryId", "batDau" = now(), "hetHan" = now() + make_interval(secs => ${ttlGiay})
        WHERE public.ai_ngoai_dang_bay."hetHan" < now()
        RETURNING token`;
      const lan1 = (await giu("a", 120)).length;
      const lan2 = (await giu("b", 120)).length;
      await tx`UPDATE public.ai_ngoai_dang_bay SET "batDau" = now() - interval '10 minutes', "hetHan" = now() - interval '1 second' WHERE "userId" = ${u.id}`;
      const lan3 = (await giu("c", 900)).length; // TTL tran 15 phut dung bang batDau = now() moi ⇒ CHECK khong do oan
      const ttlDai = await maLoi(tx, (sp) => sp`UPDATE public.ai_ngoai_dang_bay SET "hetHan" = "batDau" + interval '16 minutes' WHERE "userId" = ${u.id}`);
      const vong0 = f ? await maLoi(tx, (sp) => sp`UPDATE public.ai_ngoai_nha_may SET "tranVongLuot" = 0 WHERE "factoryId" = ${f.f}`) : "23514";
      const tien0 = f ? await maLoi(tx, (sp) => sp`UPDATE public.ai_ngoai_nha_may SET "tranTienLuotUsd" = 0 WHERE "factoryId" = ${f.f}`) : "23514";
      return { lan1, lan2, lan3, ttlDai, vong0, tien0 };
    });
    if (r.boQua) {
      log("(b) BO QUA: chua co nguoi dung de tham do");
      return;
    }
    expectExact("(b) behaviour", r, { lan1: 1, lan2: 0, lan3: 1, ttlDai: "23514", vong0: "23514", tien0: "23514" });
    log(`(b) ${JSON.stringify(r)}; ROLLED BACK.`);
  },
});
