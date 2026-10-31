#!/usr/bin/env node
/**
 * 0444 — Đợt 11.3-C: cột kế hoạch trên `ai_agent_runs` (keHoach*). Áp `drizzle/0444_ai_agent_ke_hoach_duyet.sql` bằng owner `aoi`,
 * nghiệm thu bằng `avi_app`:
 *   (a) 6 cột tồn tại, nullable, không default; (b) quyền avi_app trên bảng KHÔNG ĐỔI; (c) hành vi (giao dịch HOÀN TÁC): hàng không khai ⇒ NULL;
 *   trạng thái lạ ⇒ 23514; 'duyet' thiếu băm/giờ ⇒ 23514; viec không phải mảng ⇒ 23514; duyệt đủ ⇒ ghi được; xoá người duyệt ⇒ SET NULL
 *   mà CHECK không chặn.
 *   node scripts/apply-migration-0444.mjs --test-only | --dev-only | --both
 * ⚠ DEV chỉ sau khi phiên dieu-phoi duyệt SQL.
 */
import { randomUUID } from "node:crypto";
import { expectExact, maLoi, rolledBack, runMigration, tablePriv } from "./apply-migration-dot10-common.mjs";

const COT = ["keHoachBam", "keHoachViec", "keHoachTrangThai", "keHoachNopLuc", "keHoachDuyetLuc", "keHoachDuyetBoi"];

const mkUser = async (tx, tag) => {
  const k = `${tag}_${randomUUID()}`;
  const [u] = await tx`INSERT INTO public.users ("openId", username, name, role, "loginMethod") VALUES (${k}, ${k}, ${tag}, 'engineer', 'local') RETURNING id`;
  return u.id;
};

await runMigration({
  file: "0444_ai_agent_ke_hoach_duyet.sql",
  tag: "[0444]",
  async verify({ appSql, log }) {
    const cols = await appSql`SELECT column_name AS c, is_nullable AS n, column_default AS df FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ai_agent_runs' AND column_name = ANY(${COT})`;
    expectExact("(a) so cot", cols.length, COT.length);
    for (const c of cols) if (c.n !== "YES" || c.df !== null) throw new Error(`(a) cot ${c.c} phai nullable, khong default`);
    log(`(a) ${COT.length} cot keHoach* nullable, khong default`);

    const p = await tablePriv(appSql, "public.ai_agent_runs");
    log(`(b) quyen avi_app ${JSON.stringify(p)}`);
    if (p.trunc) throw new Error("(b) avi_app khong duoc TRUNCATE ai_agent_runs");

    const r = await rolledBack(appSql, async (tx) => {
      const chu = await mkUser(tx, "p0444");
      const id = randomUUID();
      await tx`INSERT INTO public.ai_agent_runs (id, "userId", "projectId", "cheDo", "cauHoi") VALUES (${id}, ${chu}, 'repo', 'sua', 'q')`;
      const [a] = await tx`SELECT "keHoachBam" AS b, "keHoachTrangThai" AS t FROM public.ai_agent_runs WHERE id = ${id}`;
      const trangThaiLa = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "keHoachTrangThai" = 'la' WHERE id = ${id}`);
      const duyetThieu = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "keHoachTrangThai" = 'duyet' WHERE id = ${id}`);
      const viecKhongMang = await maLoi(tx, (sp) => sp`UPDATE public.ai_agent_runs SET "keHoachViec" = '{"a":1}'::jsonb WHERE id = ${id}`);
      const nguoiDuyet = await mkUser(tx, "p0444b");
      await tx`UPDATE public.ai_agent_runs SET "keHoachBam" = ${"a".repeat(64)}, "keHoachViec" = '[{"noiDung":"x","trangThai":"cho"}]'::jsonb,
        "keHoachTrangThai" = 'duyet', "keHoachNopLuc" = now(), "keHoachDuyetLuc" = now(), "keHoachDuyetBoi" = ${nguoiDuyet} WHERE id = ${id}`;
      const [b] = await tx`SELECT "keHoachTrangThai" AS t, "keHoachDuyetBoi" AS boi FROM public.ai_agent_runs WHERE id = ${id}`;
      const xoa = await maLoi(tx, (sp) => sp`DELETE FROM public.users WHERE id = ${nguoiDuyet}`);
      const [c] = await tx`SELECT "keHoachDuyetBoi" AS boi, "keHoachTrangThai" AS t FROM public.ai_agent_runs WHERE id = ${id}`;
      return { macDinh: [a.b, a.t], trangThaiLa, duyetThieu, viecKhongMang, ghi: b.t, boi: b.boi === nguoiDuyet, xoa, boiSauXoa: c.boi, ttSauXoa: c.t };
    });
    expectExact("(c) behaviour", r, {
      macDinh: [null, null],
      trangThaiLa: "23514",
      duyetThieu: "23514",
      viecKhongMang: "23514",
      ghi: "duyet",
      boi: true,
      xoa: null,
      boiSauXoa: null,
      ttSauXoa: "duyet",
    });
    log(`(c) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
