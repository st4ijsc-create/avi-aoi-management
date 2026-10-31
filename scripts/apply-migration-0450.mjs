#!/usr/bin/env node
/**
 * 0450 — Đợt 12 · H5.4: bảng `ai_agent_run_lich_su` (lịch sử model mỗi bước để TIẾP TỤC lượt). Áp `drizzle/0450_ai_agent_lich_su_tiep_tuc.sql` bằng owner
 * `aoi`, nghiệm thu bằng `avi_app` (giao dịch HOÀN TÁC):
 *   (a) bảng + 7 cột + FK kép + 5 CHECK; (b) quyền avi_app: SELECT/INSERT/UPDATE/DELETE, KHÔNG TRUNCATE; (c) hành vi: FK kép chặn userId lệch (23503),
 *   tinNhan không phải mảng (23514), soTin ngoài khoảng (23514), quá 600 000 byte (23514), tự tiếp tục chính mình (23514), xoá lượt ⇒ cascade xoá bản lưu,
 *   UPDATE có điều kiện đặt daTiepTucBoi chỉ thắng MỘT lần.
 *   node scripts/apply-migration-0450.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL (đã duyệt 2026-10-31).
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const COT = ["runId", "userId", "tinNhan", "soTin", "buoc", "capNhatLuc", "daTiepTucBoi"];
const mkUser = async (tx, tag) => {
  const k = `${tag}_${randomUUID()}`;
  const [u] = await tx`INSERT INTO public.users ("openId", username, name, role, "loginMethod") VALUES (${k}, ${k}, ${tag}, 'engineer', 'local') RETURNING id`;
  return u.id;
};
const mkRun = async (tx, userId) => {
  const id = randomUUID();
  await tx`INSERT INTO public.ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi") VALUES (${id}, ${userId}, 'repo', 'sua', 'q')`;
  return id;
};
const MANG = [{ role: "user", content: "q" }];

await runMigration({
  file: "0450_ai_agent_lich_su_tiep_tuc.sql",
  tag: "[0450]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_agent_run_lich_su'`;
    expectExact("(a) cot", cols.map((x) => x.c).sort(), [...COT].sort());
    const fk = await appSql`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.ai_agent_run_lich_su'::regclass AND contype = 'f'`;
    expectExact("(a) fk", fk[0].n, 1);
    const ck = await appSql`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.ai_agent_run_lich_su'::regclass AND contype = 'c' AND conname LIKE 'chk_ai_agent_run_lich_su_%'`;
    expectExact("(a) check", ck[0].n, 5);
    log(`(a) bang + ${COT.length} cot + 1 FK kep + 5 CHECK`);

    const p = await tablePriv(appSql, "public.ai_agent_run_lich_su");
    log(`(b) quyen avi_app ${JSON.stringify(p)}`);
    if (p.trunc) throw new Error("(b) avi_app khong duoc TRUNCATE ai_agent_run_lich_su");

    const r = await rolledBack(appSql, async (tx) => {
      const a = await mkUser(tx, "p0450a");
      const b = await mkUser(tx, "p0450b");
      const runA = await mkRun(tx, a);
      await tx`INSERT INTO public.ai_agent_run_lich_su ("runId","userId","tinNhan","soTin") VALUES (${runA}::uuid, ${a}, ${tx.json(MANG)}, 1)`;
      const userLech = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_run_lich_su ("runId","userId","tinNhan","soTin") VALUES (${randomUUID()}::uuid, ${b}, ${sp.json(MANG)}, 1)`);
      const runB = await mkRun(tx, b);
      const chuLech = await maLoi(tx, (sp) => sp`INSERT INTO public.ai_agent_run_lich_su ("runId","userId","tinNhan","soTin") VALUES (${runB}::uuid, ${a}, ${sp.json(MANG)}, 1)`);
      const khongMang = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_run_lich_su SET "tinNhan" = ${sp.json({ a: 1 })} WHERE "runId" = ${runA}::uuid`);
      const soTinLo = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_run_lich_su SET "soTin" = 401 WHERE "runId" = ${runA}::uuid`);
      const quaLon = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_run_lich_su SET "tinNhan" = jsonb_build_array(repeat('x', 700000)) WHERE "runId" = ${runA}::uuid`);
      const tuTiepTuc = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_run_lich_su SET "daTiepTucBoi" = ${runA}::uuid WHERE "runId" = ${runA}::uuid`);
      const thang1 = await tx`UPDATE public.ai_agent_run_lich_su SET "daTiepTucBoi" = ${randomUUID()}::uuid WHERE "runId" = ${runA}::uuid AND "userId" = ${a} AND "daTiepTucBoi" IS NULL RETURNING "runId"`;
      const thang2 = await tx`UPDATE public.ai_agent_run_lich_su SET "daTiepTucBoi" = ${randomUUID()}::uuid WHERE "runId" = ${runA}::uuid AND "userId" = ${a} AND "daTiepTucBoi" IS NULL RETURNING "runId"`;
      await tx`DELETE FROM public.ai_agent_runs WHERE id = ${runA}::uuid`;
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM public.ai_agent_run_lich_su WHERE "runId" = ${runA}::uuid`;
      return { userLech, chuLech, khongMang, soTinLo, quaLon, tuTiepTuc, thang1: thang1.length, thang2: thang2.length, saukhiXoaLuot: n };
    });
    expectExact("(c) behaviour", r, {
      userLech: "23503",
      chuLech: "23503",
      khongMang: "23514",
      soTinLo: "23514",
      quaLon: "23514",
      tuTiepTuc: "23514",
      thang1: 1,
      thang2: 0,
      saukhiXoaLuot: 0,
    });
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
