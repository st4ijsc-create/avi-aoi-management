/**
 * ★★★ MỤC 4 (spec Đợt E) — CHUẨN HOÁ EOL/BOM THẬT của VSCode, đo qua ghi đĩa THẬT (`apBanVa`).
 * Nợ đã hoãn có chủ ý ở `ghepBanVa.ts` (xem docblock F2 ở đó) — đây là chỗ nghi có lỗi thật, đo
 * bằng byte trên đĩa (node:fs), KHÔNG suy từ chuỗi trong bộ nhớ.
 *
 * Dùng CÙNG cửa duyệt server thật như `writeDiskReal.test.ts` (mỗi tệp `before()` đăng nhập riêng —
 * rẻ, và giữ mỗi tệp lưới độc lập, không phụ thuộc thứ tự chạy).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ 2026-08-30 (F7) — LỖI ĐÃ ĐO ĐƯỢC Ở CA "EOL LẪN LỘN", VÀ HÀNH VI MỚI SAU KHI VÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ca "EOL LẪN LỘN" bên dưới TỪNG đỏ: gốc `"M1\r\nM2\nM3\r\nM4\n"`, sửa dòng 3, đọc lại bằng
 * `node:fs` cho `"M1\nM2\nM3-EDITED\nM4\n"` — dòng 1 (CRLF, KHÔNG hề bị chạm) đổi thành LF, vì
 * `TextDocument` của VSCode chỉ mang MỘT `eol` cho cả tài liệu và `save()` chuẩn hoá EOL của TOÀN
 * BỘ tệp. `loi/ghepBanVa.ts` giữ đúng dấu ngắt từng dòng ở tầng CHUỖI (đúng, có lưới riêng), nhưng
 * điều đó không bao giờ tới được đĩa qua đường ghi thật.
 *
 * Vá: `ui/apBanVa.ts` nay TỪ CHỐI CẢ LƯỢT khi tệp gốc có EOL lẫn lộn (`loi/eolLanLon.ts`), TRƯỚC
 * khi chạm đĩa lần thứ hai. Ca dưới đây giờ đo ĐÚNG hành vi mới: từ chối, đĩa KHÔNG đổi một byte —
 * KHÔNG còn đo "kết quả sau khi ghi" vì lượt ghi không còn xảy ra. Hai ca "CRLF thuần" và "LF
 * thuần" đo NHÁNH KIA: tệp EOL ĐỒNG NHẤT không hề bị vá này chặn, vẫn áp vá được như cũ.
 */
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { apBanVa, bamNoiDung, dangNhap } from "../prodImports";
import { NOI_DUNG, TEN } from "../fixtures";

const SERVER_URL = "http://localhost:3000";
const TK = "engineer1";
const MK = "User@123";

describe("Đợt E — chuẩn hoá EOL/BOM THẬT khi ghi qua apBanVa", function () {
  if (process.env.AVI_TEST_SUITE === "multi-root") return;

  this.timeout(30_000);
  let cookie = "";
  let ws = "";

  before(async function () {
    this.timeout(15_000);
    ws = process.env.AVI_TEST_WORKSPACE ?? "";
    const { ket, cookie: c } = await dangNhap(SERVER_URL, TK, MK);
    assert.equal(ket.loai, "ok", `đăng nhập thất bại: ${JSON.stringify(ket)}`);
    cookie = c as string;
  });

  async function ghi(relName: string, dongDau: number, dongCuoi: number, thayThe: string) {
    const abs = join(ws, relName);
    const truoc = readFileSync(abs, "utf8");
    await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const ket = await apBanVa({
      deXuat: { loai: "doan", path: relName, dongDau, dongCuoi, thayThe },
      duongTuyetDoi: abs,
      duongTuongDoi: relName,
      bamGoc: bamNoiDung(truoc),
      thuMucWorkspace: [ws],
      nhanWorkspace: "real-host-test",
      serverUrl: SERVER_URL,
      cookie,
    });
    return { ket, truoc };
  }

  it("★★★ tệp CRLF thuần: sửa dòng giữa → MỌI dòng khác GIỮ NGUYÊN \\r\\n (không lẫn \\n trần)", async () => {
    const abs = join(ws, TEN.EOL_CRLF);
    const { ket } = await ghi(TEN.EOL_CRLF, 2, 2, "L2-EDITED");
    assert.equal(ket.ok, true, `ghi thất bại: ${(ket as any).thongDiep}`);
    const sau = readFileSync(abs, "utf8");
    assert.equal(sau, "L1\r\nL2-EDITED\r\nL3\r\n", `kết quả sai: ${JSON.stringify(sau)}`);
    assert.equal(/(?<!\r)\n/.test(sau), false, "có \\n TRẦN (không đi kèm \\r) trong một tệp vốn CRLF thuần — chuẩn hoá EOL đã lệch");
  });

  it("★★★ tệp LF thuần: sửa dòng giữa → vẫn ÁP VÁ ĐƯỢC như cũ (NHÁNH KIA của F7 — không phải cấm tất)", async () => {
    // Đối xứng với ca CRLF thuần ở trên, cho kiểu ngắt dòng còn lại. Vá F7 chỉ chặn tệp LẪN LỘN —
    // tệp LF đồng nhất (phổ biến trên mã nguồn không phải .NET) không hề bị chạm.
    const abs = join(ws, TEN.EOL_LF);
    const { ket } = await ghi(TEN.EOL_LF, 2, 2, "P2-EDITED");
    assert.equal(ket.ok, true, `ghi thất bại (KHÔNG kỳ vọng bị chặn — tệp LF đồng nhất): ${(ket as any).thongDiep}`);
    const sau = readFileSync(abs, "utf8");
    assert.equal(sau, "P1\nP2-EDITED\nP3\n", `kết quả sai: ${JSON.stringify(sau)}`);
    assert.equal(/\r/.test(sau), false, "có \\r xuất hiện trong một tệp vốn LF thuần — chuẩn hoá EOL đã lệch");
  });

  it("★★★ tệp EOL LẪN LỘN: cả lượt áp vá bị TỪ CHỐI, đĩa (node:fs) KHÔNG đổi MỘT BYTE", async () => {
    /**
     * ★★★ F7 (2026-08-30) — LỖI ĐÃ ĐO ĐƯỢC: bản trước kỳ vọng ghi THÀNH CÔNG với các dòng không bị
     * chạm giữ đúng EOL gốc (`"M1\r\nM2\nM3-EDITED\r\nM4\n"`), nhưng đọc đĩa thật cho
     * `"M1\nM2\nM3-EDITED\nM4\n"` — dòng 1 (CRLF, KHÔNG hề bị chạm) bị VSCode chuẩn hoá thành LF lúc
     * `save()`, vì `TextDocument` chỉ mang MỘT `eol` cho cả tài liệu. Vá: `ui/apBanVa.ts` nay TỪ
     * CHỐI cả lượt khi tệp gốc EOL lẫn lộn, TRƯỚC khi chạm đĩa lần thứ hai — nên bây giờ đúng phải
     * là: `ok:false`, VÀ đĩa giữ NGUYÊN VĂN nội dung gốc (không một byte nào đổi, kể cả dòng 3 mà
     * đề xuất nhắm tới).
     */
    const abs = join(ws, TEN.EOL_MIXED);
    const truocBuf = readFileSync(abs);
    const { ket } = await ghi(TEN.EOL_MIXED, 3, 3, "M3-EDITED");

    assert.equal(ket.ok, false, `apBanVa PHẢI từ chối tệp EOL lẫn lộn (kỳ vọng ok:false): ${JSON.stringify(ket)}`);
    assert.match((ket as any).thongDiep, /EOL LẪN LỘN/, `lời khai từ chối không nói rõ lý do EOL: ${(ket as any).thongDiep}`);

    // Đĩa (đọc bằng node:fs THÔ, không qua VSCode) phải NGUYÊN VĂN — so cả CHUỖI lẫn BYTE, phòng
    // trường hợp một phép so chuỗi utf8 bỏ sót một khác biệt byte-level mà so buffer bắt được.
    const sauBuf = readFileSync(abs);
    assert.equal(Buffer.compare(sauBuf, truocBuf), 0, `đĩa ĐÃ ĐỔI dù apBanVa báo từ chối — chính lỗ mà F7 vá: trước=${JSON.stringify(truocBuf.toString("utf8"))}, sau=${JSON.stringify(sauBuf.toString("utf8"))}`);
    const sau = readFileSync(abs, "utf8");
    assert.equal(sau, "M1\r\nM2\nM3\r\nM4\n", `đĩa phải giữ NGUYÊN nội dung gốc (kể cả dòng 3 mà đề xuất nhắm tới): ${JSON.stringify(sau)}`);
  });

  it("★★★ tệp có BOM: sửa dòng 2 (KHÔNG chạm dòng 1) → BOM (3 byte EF BB BF) GIỮ NGUYÊN ở đầu tệp", async () => {
    const abs = join(ws, TEN.EOL_BOM_DONG2);
    const truocBuf = readFileSync(abs);
    assert.deepEqual([truocBuf[0], truocBuf[1], truocBuf[2]], [0xef, 0xbb, 0xbf], "fixture không có BOM thật — kiểm fixtures.ts");

    const { ket } = await ghi(TEN.EOL_BOM_DONG2, 2, 2, "L2-EDITED");
    assert.equal(ket.ok, true, `ghi thất bại: ${(ket as any).thongDiep}`);

    const sauBuf = readFileSync(abs);
    assert.deepEqual(
      [sauBuf[0], sauBuf[1], sauBuf[2]],
      [0xef, 0xbb, 0xbf],
      `BOM đã MẤT sau khi sửa dòng 2 (3 byte đầu thật: ${[sauBuf[0], sauBuf[1], sauBuf[2]].map((b) => b?.toString(16)).join(" ")}) — không kỳ vọng lỗ này ở đây vì dòng 1 (mang BOM) không hề bị chạm`,
    );
  });

  it("★★★ tệp có BOM: sửa CHÍNH dòng 1 (dòng mang BOM) → đo BOM còn hay mất (nghi ngại thật, không giả định trước)", async () => {
    const abs = join(ws, TEN.EOL_BOM);
    const truocBuf = readFileSync(abs);
    assert.deepEqual([truocBuf[0], truocBuf[1], truocBuf[2]], [0xef, 0xbb, 0xbf], "fixture không có BOM thật");

    const { ket } = await ghi(TEN.EOL_BOM, 1, 1, "L1-EDITED");
    assert.equal(ket.ok, true, `ghi thất bại: ${(ket as any).thongDiep}`);

    const sauBuf = readFileSync(abs);
    // ★★★ KHÔNG NỚI: đây CHÍNH XÁC là ca task yêu cầu "để nguyên lỗi, báo cáo" nếu nó ĐỎ.
    // `ghepBanVa.ts` tách dòng bằng `/(\r\n|\n)/` — BOM (U+FEFF) dính liền vào dòng 1 dưới dạng một
    // KÝ TỰ THƯỜNG của dòng đó (không phải một thực thể tách riêng). Sửa NGUYÊN dòng 1 thay `thayThe`
    // của model (không mang BOM) vào chỗ đó ⇒ dự đoán: BOM biến mất im lặng. Giữ assertion "PHẢI
    // còn BOM" (kỳ vọng đúng của một trình soạn thảo văn bản tôn trọng byte-order-mark) — nếu ĐỎ,
    // đó là lỗ CÓ THẬT cần báo lại, không phải lưới sai.
    assert.deepEqual(
      [sauBuf[0], sauBuf[1], sauBuf[2]],
      [0xef, 0xbb, 0xbf],
      `BOM ĐÃ MẤT sau khi sửa dòng 1 (3 byte đầu thật: ${[sauBuf[0], sauBuf[1], sauBuf[2]].map((b) => b?.toString(16)).join(" ")}, kỳ vọng "ef bb bf") — sửa nội dung dòng 1 của một tệp có BOM làm RỤNG luôn dấu hiệu byte-order-mark của cả tệp`,
    );
  });
});
