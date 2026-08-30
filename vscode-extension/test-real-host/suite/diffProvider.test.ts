/**
 * ★★ MỤC 6 (spec Đợt E) — `TextDocumentContentProvider` (khung diff, `ui/diffDeXuat.ts`) mở được
 * NỘI DUNG THẬT, kể cả tên tệp TIẾNG VIỆT CÓ DẤU. Lỗ đã từng có: dựng URI bằng NỐI CHUỖI khiến
 * `%XX`/`#`/`?` trong tên tệp bị `Uri.parse` diễn giải sai ⇒ diff mở RỖNG, im lặng. `KhoDeXuat` hiện
 * dựng URI "theo THÀNH PHẦN" (`Uri.from({scheme, path})`) — chỉ registry + resolver THẬT của VSCode
 * mới xác nhận được điều đó có còn đúng không (`vscode` giả không parse URI thật).
 */
import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { KhoDeXuat, SCHEME } from "../prodImports";
import { NOI_DUNG, TEN } from "../fixtures";

describe("Đợt E — TextDocumentContentProvider với tên tệp tiếng Việt có dấu", function () {
  if (process.env.AVI_TEST_SUITE === "multi-root") return;
  this.timeout(20_000);

  let kho: KhoDeXuat;
  let sub: vscode.Disposable;

  before(() => {
    kho = new KhoDeXuat();
    sub = vscode.workspace.registerTextDocumentContentProvider(SCHEME, kho);
  });

  after(() => {
    sub.dispose();
    kho.dispose();
  });

  it("★★★ mở được NỘI DUNG THẬT (cả hai vế) cho đường dẫn tiếng Việt có dấu + khoảng trắng + gạch ngang", async () => {
    const relPath = "Tệp tiếng Việt có dấu — đề xuất.ts";
    const original = "// bản gốc\nconst x = 1;\n";
    const modified = "// bản đề xuất của AI\nconst x = 2;\n";
    const { cu, moi } = kho.datDeXuat({ actionId: `vn-${Date.now()}`, path: relPath, original, modified });

    const docCu = await vscode.workspace.openTextDocument(cu);
    const docMoi = await vscode.workspace.openTextDocument(moi);

    assert.equal(docCu.getText(), original, `phía TRÁI (bản gốc ảo) SAI hoặc RỖNG — URI: ${cu.toString()}`);
    assert.equal(docMoi.getText(), modified, `phía PHẢI (bản đề xuất) SAI hoặc RỖNG — URI: ${moi.toString()}`);
  });

  it('★ dựng URI "theo thành phần" không bị %XX/#/? trong tên tệp diễn giải sai (đối chứng lỗ cũ)', async () => {
    // Tên chứa cả khoảng trắng lẫn ký tự có thể bị hiểu thành fragment/query nếu URI bị NỐI CHUỖI
    // rồi Uri.parse: "#" (fragment) và "?" (query). Đây chính là đối chứng cho lỗ "diff rỗng im lặng".
    const relPath = "tệp có # và ? trong tên.ts";
    const original = "GOC";
    const modified = "MOI";
    const { cu, moi } = kho.datDeXuat({ actionId: `special-${Date.now()}`, path: relPath, original, modified });
    const docCu = await vscode.workspace.openTextDocument(cu);
    const docMoi = await vscode.workspace.openTextDocument(moi);
    assert.equal(docCu.getText(), original, `"#"/"?" trong tên tệp làm hỏng URI — phía trái: "${docCu.getText()}"`);
    assert.equal(docMoi.getText(), modified, `"#"/"?" trong tên tệp làm hỏng URI — phía phải: "${docMoi.getText()}"`);
  });

  it("★★ moDiffCucBo (chế độ LOCAL, trái = TỆP THẬT trên đĩa) chạy vscode.diff không ném lỗi cho tệp tiếng Việt THẬT", async () => {
    const ws = process.env.AVI_TEST_WORKSPACE ?? "";
    const abs = join(ws, TEN.VN);
    assert.ok(existsSync(abs), `fixture tiếng Việt không tồn tại trên đĩa: ${abs}`);
    assert.equal(readFileSync(abs, "utf8"), NOI_DUNG.VN);

    const modified = `${NOI_DUNG.VN}// đề xuất thêm dòng của AI\n`;
    await kho.moDiffCucBo({ actionId: `vn-diff-${Date.now()}`, path: TEN.VN, duongTuyetDoi: abs, modified }, "REAL-HOST-TEST");
    // Không ném là đạt phần "mở được". Đóng lại các tab đã mở để không rò giữa các ca lưới khác.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
