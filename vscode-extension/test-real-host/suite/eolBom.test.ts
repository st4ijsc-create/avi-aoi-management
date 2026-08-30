/**
 * ★★★ MỤC 4 (spec Đợt E) — CHUẨN HOÁ EOL/BOM THẬT của VSCode, đo qua ghi đĩa THẬT (`apBanVa`).
 * Nợ đã hoãn có chủ ý ở `ghepBanVa.ts` (xem docblock F2 ở đó) — đây là chỗ nghi có lỗi thật, đo
 * bằng byte trên đĩa (node:fs), KHÔNG suy từ chuỗi trong bộ nhớ.
 *
 * Dùng CÙNG cửa duyệt server thật như `writeDiskReal.test.ts` (mỗi tệp `before()` đăng nhập riêng —
 * rẻ, và giữ mỗi tệp lưới độc lập, không phụ thuộc thứ tự chạy).
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

  it("★★★ tệp EOL LẪN LỘN: sửa MỘT dòng giữa → các dòng KHÔNG bị chạm giữ ĐÚNG kiểu ngắt dòng gốc của TỪNG dòng", async () => {
    const abs = join(ws, TEN.EOL_MIXED);
    const { ket } = await ghi(TEN.EOL_MIXED, 3, 3, "M3-EDITED");
    assert.equal(ket.ok, true, `ghi thất bại: ${(ket as any).thongDiep}`);
    const sau = readFileSync(abs, "utf8");
    // Gốc: "M1\r\nM2\nM3\r\nM4\n" — dòng 3 (M3) đổi, dòng 1/2/4 PHẢI giữ đúng dấu ngắt gốc của chúng.
    assert.equal(sau, "M1\r\nM2\nM3-EDITED\r\nM4\n", `kết quả sai — EOL của các dòng KHÔNG bị sửa đã bị đổi: ${JSON.stringify(sau)}`);
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
