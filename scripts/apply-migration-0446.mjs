#!/usr/bin/env node
/**
 * 0446 — `ai_external_calls."requestId"` (Đợt 12 H3.3a: id yêu cầu của nhà cung cấp AI ngoài trong sổ WORM).
 * Áp `drizzle/0446_ai_ngoai_request_id.sql` bằng owner `aoi`, nghiệm thu bằng `avi_app`:
 *   (a) cột tồn tại, kiểu text, is_nullable = YES, KHÔNG default; ràng buộc đã VALIDATE;
 *   (b) giao dịch hoàn tác: ý định + kết quả không requestId ⇒ NULL · kết quả 'req_011:a.b-9' ⇒ OK · 128 ký tự ⇒ OK · 129 ký tự / có
 *       khoảng trắng / xuống dòng ⇒ 23514 · ý định MANG requestId ⇒ 23514;
 *   (c) `__applied_migrations` 1 hàng (bộ chạy chung).
 *   node scripts/apply-migration-0446.mjs --test-only | --dev-only | --both
 */
import { expectExact, maLoi, rolledBack, runMigration } from "./apply-migration-dot10-common.mjs";

await runMigration({
  file: "0446_ai_ngoai_request_id.sql",
  tag: "[0446]",
  async verify({ appSql, log }) {
    const cot = await appSql`
      SELECT column_name AS c, data_type AS t, is_nullable AS nul, column_default AS d
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_external_calls' AND column_name = 'requestId'`;
    const [rb] = await appSql`
      SELECT convalidated AS v FROM pg_constraint
      WHERE conname = 'ai_external_calls_request_id_chk' AND conrelid = 'public.ai_external_calls'::regclass`;
    expectExact("(a) column", { cot: cot.map((r) => `${r.c}:${r.t}:${r.nul}:${r.d}`), validated: rb?.v ?? null }, {
      cot: ["requestId:text:YES:null"],
      validated: true,
    });
    log("(a) requestId text — NULLABLE, không default; CHECK đã VALIDATE");
    const r = await rolledBack(appSql, async (tx) => {
      const out = {};
      const [yd] = await tx`
        INSERT INTO public.ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung")
        VALUES (1, 'y-dinh', false, 'openai', 'do-0446', ${"0".repeat(64)}) RETURNING id, "requestId"`;
      out.yDinhVang = yd.requestId;
      const ketQua = (yDinhId, rid) => (sp) =>
        sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "yDinhId", "tuDong", "nhaCungCap", model, "ketCuc", "requestId")
           VALUES (1, 'ket-qua', ${yDinhId}, false, 'openai', 'do-0446', 'loi', ${rid})`;
      // mỗi ca một ý định riêng (chỉ mục duy nhất một kết quả mỗi ý định)
      const yDinh = async () =>
        (await tx`INSERT INTO public.ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung")
                  VALUES (1, 'y-dinh', false, 'openai', 'do-0446', ${"0".repeat(64)}) RETURNING id`)[0].id;
      out.vang = await maLoi(tx, ketQua(yd.id, null));
      out.thuong = await maLoi(tx, ketQua(await yDinh(), "req_011:a.b-9"));
      out.tran128 = await maLoi(tx, ketQua(await yDinh(), "a".repeat(128)));
      out.qua129 = await maLoi(tx, ketQua(await yDinh(), "a".repeat(129)));
      out.khoangTrang = await maLoi(tx, ketQua(await yDinh(), "a b"));
      out.xuongDong = await maLoi(tx, ketQua(await yDinh(), "a\nb"));
      out.yDinhMang = await maLoi(
        tx,
        (sp) => sp`INSERT INTO public.ai_external_calls ("factoryId", loai, "tuDong", "nhaCungCap", model, "bamNoiDung", "requestId")
                   VALUES (1, 'y-dinh', false, 'openai', 'do-0446', ${"0".repeat(64)}, 'req_1')`,
      );
      return out;
    });
    expectExact("(b) behaviour", r, {
      yDinhVang: null,
      vang: null,
      thuong: null,
      tran128: null,
      qua129: "23514",
      khoangTrang: "23514",
      xuongDong: "23514",
      yDinhMang: "23514",
    });
    const [left] = await appSql`SELECT count(*)::int AS n FROM public.ai_external_calls WHERE model = 'do-0446'`;
    if (left.n !== 0) throw new Error("(b) probe NOT rolled back");
    log(`(b) behaviour ${JSON.stringify(r)}; ROLLED BACK`);
  },
});
