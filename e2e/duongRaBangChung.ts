import fs from "node:fs";

/**
 * ===============================================================================================
 * ĐỢT 51 (mục B) — THƯ MỤC BẰNG CHỨNG KHÔNG BAO GIỜ BỊ GHI ĐÈ IM LẶNG
 * ===============================================================================================
 *
 * ★★★ G130 / G129 — SỰ CỐ ĐỢT 50, nguyên văn: một agent chạy lại
 *     `npx playwright test e2e/twin-dot47-bam-canh.spec.ts`
 * mà không đặt `TWIN_E2E_ANH`. Spec ghi vào MẶC ĐỊNH `.qa-dot47/e2e/` ⇒ **8 tệp ĐÃ COMMIT
 * của Đợt 47 bị ghi đè + 12 tệp untracked bị ghi đè**; vòng "khôi phục" sau đó làm rỗng thêm
 * 103 tệp. Đợt 49 (mục F) ĐÃ thêm `TWIN_E2E_ANH` — và nó KHÔNG cứu được, vì **mặc định vẫn
 * trỏ thẳng vào thư mục bằng chứng**. Một biến môi trường mà người chạy phải NHỚ đặt không
 * phải hàng rào; nó là một dòng trong tài liệu.
 *
 * ★★★ HÀNG RÀO Ở ĐÂY LÀ BẤT BIẾN, KHÔNG PHẢI DANH SÁCH:
 *     "thư mục đích ĐÃ CÓ TỆP" ⇒ KHÔNG ghi vào đó.
 * Không cần biết tệp nào tracked, đợt nào, ai sinh ra. Mọi spec bằng chứng đi qua hàm này.
 * (Đợt 51 đo: 5 spec trong `e2e/` ghi đường `.qa-dotNN` ghim cứng — brief chỉ nêu 1.)
 *
 * ★ VÌ SAO KHÔNG `throw` (đã cân nhắc và LOẠI): `playwright.config.ts` để `testDir: "./e2e"`
 *   + `testMatch` bắt mọi `*.spec.ts` ⇒ cả 5 spec bằng chứng NẰM TRONG suite mặc định. Ném lỗi
 *   lúc nạp module biến `npx playwright test` thành ĐỎ tại HEAD cho mọi người, chỉ vì thư mục
 *   bằng chứng của một đợt cũ còn tệp. Đó là G108 (lưới đỏ có sẵn mà không ai chạy = không có
 *   lưới) tự gây ra. Nên: ĐỔI ĐƯỜNG RA + kêu to, thay vì đỏ.
 *
 * Thứ tự quyết định:
 *   1. ENV (`TWIN_E2E_ANH`, …) có giá trị       ⇒ dùng đúng nó (người đo đã nói rõ ý mình).
 *   2. ENV trống, thư mục mặc định TRỐNG/chưa có ⇒ dùng mặc định (mọi lệnh trong tài liệu vẫn đúng).
 *   3. ENV trống, thư mục mặc định CÓ TỆP        ⇒ đổi sang `<mặc định>-lai-<mốc>` + in cảnh báo.
 *   4. `QA_GHI_DE_BANG_CHUNG=1`                  ⇒ ép ghi đè mặc định (lối thoát CÓ CHỦ Ý, phải gõ ra).
 */
export function duongRaBangChung(tenEnv: string, macDinh: string): string {
  const tuEnv = (process.env[tenEnv] ?? "").trim();
  if (tuEnv) return tuEnv.split("\\").join("/").replace(/\/+$/, "");
  if (process.env.QA_GHI_DE_BANG_CHUNG === "1") {
    console.warn(`[bang-chung] QA_GHI_DE_BANG_CHUNG=1 - GHI DE co chu y vao ${macDinh}`);
    return macDinh;
  }
  const daCo = fs.existsSync(macDinh) ? fs.readdirSync(macDinh) : [];
  if (daCo.length === 0) return macDinh;
  const moc = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const moi = `${macDinh}-lai-${moc}`;
  console.warn(
    [
      "",
      `[bang-chung] *** ${macDinh} DA CO ${daCo.length} tep (bang chung cua dot truoc).`,
      `[bang-chung] Duong ra DOI sang: ${moi}`,
      `[bang-chung] Muon cho khac: ${tenEnv}=<thu muc>  ·  muon ghi de that: QA_GHI_DE_BANG_CHUNG=1`,
      "",
    ].join("\n"),
  );
  return moi;
}

/**
 * ★★★ VÌ SAO `duongRaBangChung` KHÔNG `mkdir` — lỗi của chính bản vá này, đo được rồi mới sửa.
 * Bản đầu gọi `mkdirSync` ngay trong hàm. Hằng `const ANH = duongRaBangChung(...)` chạy lúc NẠP
 * MODULE, mà Playwright nạp mọi spec kể cả khi chỉ `--list` ⇒ một lệnh `npx playwright test --list`
 * đẻ ra **15 thư mục rỗng** `.qa-dotNN-lai-<mốc>` (3 lượt thu thập × 5 spec). Phép đo bắt được:
 * `ls -d .qa-dot*-lai-*` sau `--list` = 15, mỗi thư mục 0 tệp.
 * ⇒ Hàm trên chỉ TÍNH đường; `taoThuMuc()` mới tạo, và chỉ được gọi ngay trước khi GHI.
 */
export function taoThuMuc(d: string): string {
  fs.mkdirSync(d, { recursive: true });
  return d;
}
