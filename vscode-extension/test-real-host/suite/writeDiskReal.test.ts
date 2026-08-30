/**
 * ★★★ MỤC 3 (spec Đợt E) — GHI ĐĨA THẬT qua `apBanVa` (`ui/apBanVa.ts`), gọi ĐÚNG hàm sản xuất
 * (qua `../prodImports`, xem docblock ở đó) trong workspace TẠM ở scratchpad, rồi đọc lại bằng
 * `node:fs` THÔ — KHÔNG đọc bằng `vscode.workspace.fs`/`TextDocument` (chính API vừa dùng để ghi).
 * Bài học cũ (Đợt C): phép đo tự thoả khi đọc lại bằng CHÍNH API vừa ghi và so `"" === ""`.
 *
 * `apBanVa` đòi một cửa duyệt THẬT trên máy chủ (`goiBatDauApClient`/`goiChotApClient`, tRPC) —
 * đăng nhập THẬT vào server đang chạy (`http://localhost:3000`, tài khoản dev cục bộ từ brief
 * nhiệm vụ) qua chính hàm sản xuất `dangNhap`, không giả lập fetch.
 */
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { apBanVa, bamNoiDung, dangNhap } from "../prodImports";
import { NOI_DUNG, TEN } from "../fixtures";

const SERVER_URL = "http://localhost:3000";
// Tài khoản DEV cục bộ (đã cấp sẵn trong brief nhiệm vụ) — CHỈ dùng để nghiệm thu cửa duyệt THẬT
// của máy chủ đang chạy trên chính máy dev này. Không phải bí mật, không phải server chia sẻ.
const TK = "engineer1";
const MK = "User@123";

describe("Đợt E — ghi đĩa THẬT qua apBanVa (WorkspaceEdit thật + cửa duyệt server thật)", function () {
  if (process.env.AVI_TEST_SUITE === "multi-root") return; // lượt này chỉ chạy ở workspace MỘT gốc

  this.timeout(30_000);

  let cookie = "";
  let ws = "";

  before(async function () {
    this.timeout(15_000);
    ws = process.env.AVI_TEST_WORKSPACE ?? "";
    assert.ok(ws, "thiếu biến môi trường AVI_TEST_WORKSPACE — runTest.ts phải bơm nó qua extensionTestsEnv");

    const { ket, cookie: c } = await dangNhap(SERVER_URL, TK, MK);
    assert.equal(
      ket.loai,
      "ok",
      `Đăng nhập THẬT vào ${SERVER_URL} thất bại (${JSON.stringify(ket)}) — server có đang chạy và ` +
        `tài khoản "${TK}" có đúng mật khẩu không? Không thể đo mục 3 nếu không đăng nhập được.`,
    );
    assert.ok(c, "đăng nhập báo ok nhưng máy chủ không cấp cookie phiên");
    cookie = c as string;
  });

  it("★★★ ghi một ĐOẠN qua apBanVa thật → node:fs đọc lại thấy ĐÚNG byte mới trên đĩa", async () => {
    const abs = join(ws, TEN.GHI_OK);
    const truoc = readFileSync(abs, "utf8");
    assert.equal(truoc, NOI_DUNG.GHI_OK, "fixture không đúng như kỳ vọng — kiểm fixtures.ts");
    const bamGoc = bamNoiDung(truoc);

    // apBanVa (bước 4) đòi mở được TextDocument và kiểm isDirty — mở qua đúng API của VSCode.
    await vscode.workspace.openTextDocument(vscode.Uri.file(abs));

    const ket = await apBanVa({
      deXuat: { loai: "doan", path: TEN.GHI_OK, dongDau: 2, dongCuoi: 2, thayThe: "DA SUA BOI REAL-HOST TEST" },
      duongTuyetDoi: abs,
      duongTuongDoi: TEN.GHI_OK,
      bamGoc,
      thuMucWorkspace: [ws],
      nhanWorkspace: "real-host-test",
      serverUrl: SERVER_URL,
      cookie,
    });

    assert.equal(ket.ok, true, `apBanVa báo KHÔNG GHI (kỳ vọng GHI được): ${ket.thongDiep}`);

    // ⚠★★★ Đọc lại bằng node:fs THÔ — KHÔNG dùng vscode.workspace.fs (bài học cũ: đọc bằng chính
    //   API vừa ghi thì phép đo tự thoả).
    const sau = readFileSync(abs, "utf8");
    assert.notEqual(sau, truoc, "đĩa (đọc bằng node:fs) KHÔNG đổi — apBanVa khai ok:true nhưng KHÔNG có byte nào rơi thật");
    assert.equal(
      sau,
      "dong 1\nDA SUA BOI REAL-HOST TEST\ndong 3\n",
      `nội dung đĩa sau khi ghi không đúng dự kiến: ${JSON.stringify(sau)}`,
    );
  });

  it("★★★ đề xuất với BĂM GỐC SAI (xung đột) → apBanVa TỪ CHỐI, đĩa (node:fs) KHÔNG đổi một byte", async () => {
    const abs = join(ws, TEN.GHI_XUNG_DOT);
    const truoc = readFileSync(abs, "utf8");
    assert.equal(truoc, NOI_DUNG.GHI_XUNG_DOT);

    await vscode.workspace.openTextDocument(vscode.Uri.file(abs));

    const ket = await apBanVa({
      deXuat: { loai: "doan", path: TEN.GHI_XUNG_DOT, dongDau: 1, dongCuoi: 1, thayThe: "KHONG DUOC GHI XUONG DIA" },
      duongTuyetDoi: abs,
      duongTuongDoi: TEN.GHI_XUNG_DOT,
      bamGoc: "0".repeat(64), // băm SAI cố ý — mô phỏng tệp đã đổi kể từ lúc đề xuất
      thuMucWorkspace: [ws],
      nhanWorkspace: "real-host-test",
      serverUrl: SERVER_URL,
      cookie,
    });

    assert.equal(ket.ok, false, "apBanVa PHẢI từ chối khi băm gốc lệch — nếu ok:true ở đây là LỖI THẬT");

    const sau = readFileSync(abs, "utf8");
    assert.equal(sau, truoc, "đĩa (node:fs) ĐÃ ĐỔI dù apBanVa báo từ chối — ĐÂY LÀ LỖI GHI ĐÈ THẬT nếu xảy ra");
  });

  it("★★★ đường dẫn NGOÀI mọi thư mục workspace → apBanVa TỪ CHỐI ở vị từ chặn cục bộ (không gọi mạng)", async () => {
    const abs = join(ws, "..", "khong-thuoc-workspace.txt");
    const ket = await apBanVa({
      deXuat: { loai: "toanVan", path: "khong-thuoc-workspace.txt", modified: "khong duoc ghi" },
      duongTuyetDoi: abs,
      duongTuongDoi: "khong-thuoc-workspace.txt",
      bamGoc: bamNoiDung(""),
      thuMucWorkspace: [ws],
      nhanWorkspace: "real-host-test",
      serverUrl: SERVER_URL,
      cookie,
    });
    assert.equal(ket.ok, false, "apBanVa PHẢI từ chối đường dẫn ngoài workspace");
    assert.match(ket.thongDiep, /KHÔNG GHI/, `lời khai từ chối không đúng khuôn: ${ket.thongDiep}`);
  });
});
