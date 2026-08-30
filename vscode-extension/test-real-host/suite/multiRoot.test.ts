/**
 * ★★ MỤC 5 (spec Đợt E) — `asRelativePath` với ≥2 gốc workspace THÊM TIỀN TỐ tên thư mục (quirk đã
 * biết, từng khiến Cmd+K trỏ nhầm sang tệp THẬT KHÁC). Chỉ VSCode thật mới trả lời được hành vi này
 * — `vscode` giả (`vi.mock`) không mô phỏng lại đúng thuật toán `asRelativePath` thật của VSCode.
 * Chạy ở lượt VSCode RIÊNG (workspace hai gốc, xem `runTest.ts`).
 */
import * as assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { duongTuongDoiTrongWorkspace, giaiDuongDeXuat } from "../prodImports";

describe("Đợt E — workspace HAI GỐC: asRelativePath vs. hàm sản xuất", () => {
  if (process.env.AVI_TEST_SUITE !== "multi-root") return; // chỉ chạy ở lượt workspace hai gốc

  it("★★ xác nhận workspace THẬT có ĐÚNG hai gốc app/ và lib/", () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.equal(folders.length, 2, `kỳ vọng 2 thư mục workspace, thực tế ${folders.length}`);
  });

  it('★★ vscode.workspace.asRelativePath THẬT thêm tiền tố "app/" khi workspace có ≥2 gốc (xác nhận quirk)', () => {
    const folders = vscode.workspace.workspaceFolders!;
    const appFolder = folders.find((f) => f.uri.fsPath.replace(/\\/g, "/").endsWith("/app"))!;
    assert.ok(appFolder, `không thấy gốc "app" trong ${folders.map((f) => f.uri.fsPath).join(", ")}`);
    const uri = vscode.Uri.file(join(appFolder.uri.fsPath, "x.ts"));
    const rel = vscode.workspace.asRelativePath(uri);
    assert.equal(
      rel,
      "app/x.ts",
      `asRelativePath trả "${rel}" — nếu KHÔNG còn tiền tố "app/", VSCode đã ĐỔI hành vi và toàn bộ ` +
        `lý do né API này ở "duongTuongDoiTrongWorkspace" cần xét lại.`,
    );
  });

  it("★★★ duongTuongDoiTrongWorkspace (hàm SẢN XUẤT thật) trả đường KHÔNG tiền tố, neo đúng gốc CHỨA tệp", () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const appRoot = folders.find((f) => f.replace(/\\/g, "/").endsWith("/app"))!;
    const abs = join(appRoot, "x.ts");
    const kq = duongTuongDoiTrongWorkspace(abs, folders);
    assert.ok(kq, "duongTuongDoiTrongWorkspace trả undefined cho một tệp CÓ THẬT trong workspace");
    assert.equal(kq!.duongTuongDoi, "x.ts", `kỳ vọng "x.ts" KHÔNG tiền tố, thực tế "${kq!.duongTuongDoi}"`);
  });

  it("★★★ giaiDuongDeXuat TỪ CHỐI 'x.ts' khi CẢ HAI gốc đều có tệp x.ts THẬT trên đĩa (đo bằng existsSync THẬT)", () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const appRoot = folders.find((f) => f.replace(/\\/g, "/").endsWith("/app"))!;
    // ⚠★★★ dùng `existsSync` THẬT (node:fs), không giả lập — đúng tinh thần "chỉ đo cái mà đĩa
    //   thật/VSCode thật trả lời được", khác hẳn `duongThat.unit.test.ts` (đã tiêm `tonTai` giả).
    const kq = giaiDuongDeXuat("x.ts", appRoot, folders, existsSync);
    assert.equal(kq.ok, false, `giaiDuongDeXuat PHẢI từ chối khi 2 tệp thật cùng khớp — thực tế: ${JSON.stringify(kq)}`);
  });

  it("★★★ giaiDuongDeXuat CHO QUA đường chỉ khớp MỘT ứng viên thật, dù KHÔNG phải gốc đang chọn", () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const appRoot = folders.find((f) => f.replace(/\\/g, "/").endsWith("/app"))!;
    // "only-in-lib.ts" (fixtures.ts) CHỈ tồn tại thật ở lib/, không tồn tại ở app/ — người dùng đang
    // CHỌN gốc app/ (gocDangChon=appRoot) nhưng model đề xuất sửa tệp ở lib/. Đúng 1 ứng viên tồn
    // tại thật trên đĩa ⇒ phải CHO QUA, neo đúng gốc lib/ (không phải gốc đang chọn).
    const kq = giaiDuongDeXuat("only-in-lib.ts", appRoot, folders, existsSync);
    assert.equal(kq.ok, true, `kỳ vọng cho qua khi đúng một ứng viên tồn tại thật: ${JSON.stringify(kq)}`);
    if (kq.ok) {
      assert.ok(
        kq.duong.replace(/\\/g, "/").includes("/lib/"),
        `kỳ vọng neo vào gốc lib/ (nơi tệp THẬT tồn tại), thực tế: ${kq.duong}`,
      );
    }
  });
});
