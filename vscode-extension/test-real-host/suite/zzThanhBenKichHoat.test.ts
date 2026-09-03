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
import { MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU, hoTroThanhBenPhu } from "../prodImports";

const EXT_ROOT = join(__dirname, "..", "..");
const pkg: {
  publisher: string;
  name: string;
  contributes?: {
    viewsContainers?: {
      activitybar?: Array<{ id: string; title: string; icon: string; when?: string }>;
      secondarySidebar?: Array<{ id: string; title: string; icon: string; when?: string }>;
    };
    views?: Record<string, Array<{ id: string; name: string; type?: string; when?: string }>>;
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

/**
 * ★★★ ĐỢT F / TASK 4 (2026-09-03) — CẶP vùng chứa (secondarySidebar CHÍNH + activitybar LÙI, xem
 * `package.json` + `loi/thanhBenPhu.ts`). Lưới `thanhBen.unit.test.ts` đã canh MANIFEST (chuỗi
 * tĩnh); nhóm ca dưới đây đo KẾT CỤC trong extension host THẬT — thứ chỉ lộ ra khi VSCode thật đọc
 * `when` và thật sự resolve view.
 *
 * ⚠ CHƯA CHẠY (ràng buộc B5 của kế hoạch: KHÔNG chạy `npm run test-that` khi người dùng đang làm
 * việc — nó mở cửa sổ VSCode THẬT và từng làm treo extension host của họ). Viết ca vào đây và ĐỂ
 * ĐÓ; người review sẽ xin phép người dùng rồi chạy `test-that` sau. Cùng khuôn "zz" (tên tệp) để
 * Mocha nạp SAU các tệp khác, không đổi hành vi các ca trên.
 */
describe("ĐỢT F / TASK 4 — cặp vùng chứa thanh bên phụ/hoạt động trong host thật", function () {
  this.timeout(30_000);

  it("★★★ package.json khai ĐÚNG MỘT container secondarySidebar + ĐÚNG MỘT view webview bên trong nó, icon THẬT TRÊN ĐĨA", () => {
    const containers = pkg.contributes?.viewsContainers?.secondarySidebar ?? [];
    assert.equal(containers.length, 1, "kỳ vọng đúng một container secondarySidebar");
    const containerId = containers[0].id;
    assert.ok(containers[0].icon, "container secondarySidebar thiếu trường icon");
    const iconAbs = join(EXT_ROOT, containers[0].icon);
    assert.ok(existsSync(iconAbs), `icon khai "${containers[0].icon}" nhưng KHÔNG có tệp thật tại ${iconAbs}`);

    const views = pkg.contributes?.views?.[containerId] ?? [];
    assert.equal(views.length, 1, `kỳ vọng đúng một view khai dưới container "${containerId}"`);
    assert.equal(views[0].type, "webview", "view phải khai type=webview để BangChat gắn được vào");
    assert.equal(views[0].id, MA_VIEW_THANH_BEN_PHU, "id view secondarySidebar lệch khỏi hằng MA_VIEW_THANH_BEN_PHU");
  });

  it("★★★ hai `when` của viewsContainers (activitybar vs secondarySidebar) là PHỦ ĐỊNH CỦA NHAU", () => {
    const whenActivitybar = pkg.contributes!.viewsContainers!.activitybar![0].when ?? "";
    const whenPhu = pkg.contributes!.viewsContainers!.secondarySidebar![0].when ?? "";
    assert.ok(whenActivitybar.length > 0 && !whenActivitybar.startsWith("!"), `activitybar.when="${whenActivitybar}"`);
    assert.equal(whenPhu, `!${whenActivitybar}`, "secondarySidebar.when PHẢI là phủ định NGUYÊN VĂN của activitybar.when");
  });

  it("★★★ mở view Ở VÙNG CHỨA ĐANG HOẠT ĐỘNG (theo `vscode.version` THẬT của host này) KHÔNG NÉM LỖI, extension active=true SAU đó", async () => {
    // ★★★ B1/B2 — dùng ĐÚNG hàm sản xuất (`hoTroThanhBenPhu`, cùng logic `extension.ts` dùng để
    // `setContext` lúc `activate()`) để suy ra view id nào đang THỰC SỰ hiển thị trên host thật
    // đang chạy lưới này — không đoán, không hard-code một trong hai.
    const hoTro = hoTroThanhBenPhu(vscode.version);
    const viewIdDangHoatDong = hoTro ? MA_VIEW_THANH_BEN_PHU : MA_VIEW_THANH_BEN;
    console.log(
      `[thanh-ben-phu] vscode.version=${vscode.version} hoTroThanhBenPhu=${hoTro} ⇒ mở view "${viewIdDangHoatDong}"`,
    );

    await vscode.commands.executeCommand(`${viewIdDangHoatDong}.focus`);
    await new Promise((r) => setTimeout(r, 2000));

    const ext = vscode.extensions.getExtension(EXT_ID)!;
    assert.equal(
      ext.isActive,
      true,
      `mở view "${viewIdDangHoatDong}" (vùng chứa đang hoạt động theo vscode.version=${vscode.version}) KHÔNG kích hoạt extension`,
    );
  });
});
