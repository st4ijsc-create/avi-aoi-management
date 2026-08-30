/**
 * ★★★ MỤC 1+2 (spec Đợt E) — CÂU HỎI CƠ BẢN NHẤT CHƯA AI TỪNG HỎI TRONG EXTENSION HOST THẬT:
 * `activate()` có chạy không ném lỗi không, và mọi lệnh khai trong `package.json` có khớp lệnh THẬT
 * đã đăng ký không (`vscode.commands.getCommands(true)`). 420 ca cũ đều chạy trên `vscode` GIẢ — một
 * `vi.mock("vscode", ...)` không bao giờ TỰ CHỐI kích hoạt hay quên đăng ký lệnh; chỉ VSCode thật
 * mới trả lời được hai câu này.
 */
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

const pkg: {
  publisher: string;
  name: string;
  contributes?: { commands?: Array<{ command: string; title: string }>; keybindings?: Array<{ command: string; key: string; when?: string }> };
} = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));

const EXT_ID = `${pkg.publisher}.${pkg.name}`;

describe("Đợt E — extension host THẬT: kích hoạt + lệnh khai báo", () => {
  it('★★★ extension "st4i.avi-ai-local" được VSCode thật NẠP (extensionDevelopmentPath đúng)', () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(
      ext,
      `Không tìm thấy extension "${EXT_ID}" trong danh sách đã nạp — kiểm publisher/name ` +
        `trong package.json khớp với extensionDevelopmentPath truyền cho runTests().`,
    );
  });

  it("★★★ activate() CHẠY KHÔNG NÉM LỖI trong extension host thật, và isActive=true sau đó", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    // Gọi activate() dù có thể VSCode đã tự kích hoạt trước đó (activation event ngầm sinh từ
    // contributes.commands, VSCode ≥1.74) — an toàn: activate() trả lại ĐÚNG promise đã cache nếu
    // extension đã active, không kích hoạt lần hai.
    await ext.activate();
    assert.equal(ext.isActive, true, "extension KHÔNG ở trạng thái active sau khi activate() trả về");
  });

  it("★★★ MỌI lệnh khai trong contributes.commands có mặt trong vscode.commands.getCommands(true)", async () => {
    const khaiBao = (pkg.contributes?.commands ?? []).map((c) => c.command);
    assert.ok(khaiBao.length > 0, "package.json không khai lệnh nào — kiểm đường đọc pkg.json ở trên");

    const daDangKy = await vscode.commands.getCommands(true);
    const thieu = khaiBao.filter((c) => !daDangKy.includes(c));
    assert.deepEqual(
      thieu,
      [],
      `Lệnh khai trong package.json nhưng KHÔNG có trong danh sách lệnh THẬT đã đăng ký: ${JSON.stringify(thieu)}. ` +
        `Nút bấm cho (các) lệnh này sẽ không làm gì cả — và không lưới giả nào bắt được lỗ này.`,
    );
  });

  it("★ keybinding ctrl+alt+k khai đúng LỆNH ĐÃ ĐĂNG KÝ (không kiểm được xung đột phím qua API công khai — xem báo cáo)", async () => {
    const kb = pkg.contributes?.keybindings ?? [];
    assert.equal(kb.length, 1, "kỳ vọng đúng MỘT keybinding khai trong package.json (aviAiLocal.suaDoanChon)");
    const daDangKy = await vscode.commands.getCommands(true);
    assert.ok(
      daDangKy.includes(kb[0].command),
      `keybinding "${kb[0].key}" trỏ tới lệnh "${kb[0].command}" nhưng lệnh đó KHÔNG được đăng ký thật`,
    );
    // ⚠⚠ KHÔNG có API công khai để hỏi VSCode "phím ctrl+alt+k hiện đang resolve về lệnh nào" hay
    //   "có xung đột với keybinding mặc định/extension khác không" — `vscode.commands`/`vscode.
    //   extensions` không lộ bảng keybinding đã RESOLVE. Ca này CHỈ xác nhận khai báo trỏ đúng lệnh
    //   có thật; xung đột phím (nếu có) phải người dùng tự bấm thử và xác nhận (xem checklist nghiệm
    //   thu con người trong báo cáo).
  });
});
