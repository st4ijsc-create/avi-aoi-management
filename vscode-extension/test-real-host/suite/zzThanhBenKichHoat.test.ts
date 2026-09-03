/**
 * ★★★ THANH BÊN (2026-09-01) — view trong `viewsContainers.activitybar` phải THẬT SỰ đăng ký được
 * trong extension host THẬT, mở nó (đúng thao tác người dùng: bấm icon ở thanh hoạt động) không
 * được ném lỗi, và đường CŨ (`aviAiLocal.moBangChat`/Ctrl+Alt+K → lệnh `aviAiLocal.suaDoanChon`)
 * phải VẪN chạy y hệt sau khi thêm bề mặt mới — đây là "nhánh kia" của thay đổi này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO TÊN TỆP BẮT ĐẦU BẰNG "zz" — ĐO ĐƯỢC, KHÔNG PHẢI GU THẨM MỸ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `suite/index.ts` nạp `*.test.js` cho Mocha bằng `glob()` (gói `glob` v13). Gọi trực tiếp `glob()`
 * trên chính thư mục này (lệnh chạy tay, kết quả dán vào báo cáo) cho thấy nó trả về danh sách theo
 * thứ tự **NGƯỢC BẢNG CHỮ CÁI** trên máy này — không phải hành vi có tài liệu chính thức của gói
 * `glob`, nên phép đo "extension CHƯA active trước khi tệp này chạm tới nó" ở ca thứ hai bên dưới
 * CHỈ ghi log chẩn đoán, KHÔNG `assert` cứng — nếu thứ tự này khác trên một máy/khác phiên bản
 * `glob`, ca đó vẫn không đỏ oan. Hai khẳng định CHÍNH (mở view không ném lỗi · active=true SAU khi
 * mở · đường cũ vẫn chạy) không phụ thuộc thứ tự file.
 */
import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

const EXT_ROOT = join(__dirname, "..", "..");
const pkg: {
  publisher: string;
  name: string;
  contributes?: {
    viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
    views?: Record<string, Array<{ id: string; name: string; type?: string }>>;
    commands?: Array<{ command: string }>;
  };
} = JSON.parse(readFileSync(join(EXT_ROOT, "package.json"), "utf8"));

const EXT_ID = `${pkg.publisher}.${pkg.name}`;

describe("THANH BÊN — viewsContainers.activitybar + views (webview) trong host thật", function () {
  this.timeout(30_000);

  it("★★★ package.json khai ĐÚNG MỘT container activity-bar + ĐÚNG MỘT view webview bên trong nó, icon THẬT TRÊN ĐĨA", () => {
    const containers = pkg.contributes?.viewsContainers?.activitybar ?? [];
    assert.equal(containers.length, 1, "kỳ vọng đúng một container activity-bar (thêm nhiều là bất thường)");
    const containerId = containers[0].id;
    assert.ok(containers[0].icon, "container thiếu trường icon");
    const iconAbs = join(EXT_ROOT, containers[0].icon);
    assert.ok(
      existsSync(iconAbs),
      `icon khai "${containers[0].icon}" trong package.json nhưng KHÔNG có tệp thật tại ${iconAbs}`,
    );
    const svg = readFileSync(iconAbs, "utf8");
    assert.ok(svg.includes("<svg"), "tệp icon không phải SVG hợp lệ (thiếu thẻ <svg>)");

    const views = pkg.contributes?.views?.[containerId] ?? [];
    assert.equal(views.length, 1, `kỳ vọng đúng một view khai dưới container "${containerId}"`);
    assert.equal(views[0].type, "webview", "view phải khai type=webview để BangChat gắn được vào");
  });

  it("★ (chẩn đoán, KHÔNG assert cứng — xem docblock đầu tệp) extension isActive TRƯỚC khi ca này chạm tới nó", () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    console.log(`[thanh-ben] isActive TRƯỚC khi mở view lần đầu trong lượt chạy này: ${ext?.isActive}`);
  });

  it("★★★ mở view bằng lệnh `<viewId>.focus` (đúng thao tác 'bấm icon') KHÔNG NÉM LỖI, và extension active=true SAU đó", async () => {
    const containerId = pkg.contributes!.viewsContainers!.activitybar![0].id;
    const viewId = pkg.contributes!.views![containerId][0].id;
    assert.equal(viewId, "aviAiLocal.bangChat", "id view lệch khỏi hằng số MA_VIEW_THANH_BEN dùng trong extension.ts");

    // `<viewId>.focus` là lệnh CỐT LÕI do CHÍNH workbench sinh ra cho MỌI view đã khai trong
    // manifest — tồn tại kể cả khi extension CHƯA active (đó chính là ý nghĩa của activation event
    // `onView:<id>`: VSCode phải biết lệnh này tồn tại để activate extension khi người dùng bấm icon
    // — không phải extension tự đăng ký ra lệnh đó).
    await vscode.commands.executeCommand(`${viewId}.focus`);
    // Nhường vài nhịp cho `resolveWebviewView` (bất đồng bộ, không có API public để await chính xác
    // "view đã resolve xong").
    await new Promise((r) => setTimeout(r, 2000));

    const ext = vscode.extensions.getExtension(EXT_ID)!;
    assert.equal(
      ext.isActive,
      true,
      "mở view trong thanh bên KHÔNG kích hoạt extension (activationEvents thiếu onView, hoặc id view sai)",
    );
  });

  it("★★ mở container bằng workbench.view.extension.<id> cũng KHÔNG ném lỗi (đường thứ hai người dùng có thể đi)", async () => {
    const containerId = pkg.contributes!.viewsContainers!.activitybar![0].id;
    await vscode.commands.executeCommand(`workbench.view.extension.${containerId}`);
  });

  it("★★★ ĐƯỜNG CŨ vẫn chạy: lệnh `aviAiLocal.moBangChat` (bảng NỔI, Command Palette/Ctrl+Alt+K) vẫn mở được KHÔNG NÉM LỖI", async () => {
    assert.ok(
      (pkg.contributes?.commands ?? []).some((c) => c.command === "aviAiLocal.moBangChat"),
      "package.json không còn khai lệnh aviAiLocal.moBangChat — đường cũ đã bị xoá khỏi manifest",
    );
    await vscode.commands.executeCommand("aviAiLocal.moBangChat");
    // Dọn tab đã mở — bảng NỔI là một WebviewPanel, chiếm một tab editor.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
