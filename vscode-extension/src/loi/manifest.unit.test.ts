/**
 * LƯỚI manifest extension: giữ các bất biến mà một lỗi gõ nhầm sẽ làm extension im lặng không
 * chạy (main sai đường ⇒ VSCode nạp rỗng; id lệnh lệch tiền tố ⇒ không tìm thấy trong Command
 * Palette). Đo THẲNG trên tệp thật, không mô phỏng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const goc = join(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(goc, "package.json"), "utf8"));

describe("manifest extension", () => {
  it("★★★ trỏ đúng bundle đã build", () => {
    expect(manifest.main).toBe("./dist/extension.js");
  });

  it("★★★ khai trần phiên bản VSCode", () => {
    expect(manifest.engines?.vscode).toBeTruthy();
  });

  it("★★ MỌI lệnh dùng tiền tố aviAiLocal.", () => {
    const ds: Array<{ command: string }> = manifest.contributes.commands;
    expect(ds.length).toBeGreaterThan(0);
    for (const l of ds) expect(l.command.startsWith("aviAiLocal.")).toBe(true);
  });

  it("★★ MỌI khoá cấu hình dùng tiền tố aviAiLocal.", () => {
    const khoa = Object.keys(manifest.contributes.configuration.properties);
    expect(khoa.length).toBeGreaterThan(0);
    for (const k of khoa) expect(k.startsWith("aviAiLocal.")).toBe(true);
  });

  /**
   * ★★★ ĐỢT H / TASK H2 / B1 — `aviAiLocal.mcpServers` PHẢI `scope: "machine"`, KHÔNG cho workspace
   * ghi đè. Bài học Đợt A đã trả giá: `aviAiLocal.serverUrl` từng thiếu `scope`, để một repo thù
   * địch sửa `.vscode/settings.json` là chiếm được đường dữ liệu (mật khẩu + cookie). Với
   * `mcpServers` cái giá còn nặng hơn — thiếu `scope` nghĩa là một repo thù địch có thể tự thêm một
   * server MCP (một TIẾN TRÌNH SẼ ĐƯỢC CHẠY) vào cấu hình chỉ bằng cách commit một tệp
   * `.vscode/settings.json`.
   */
  it("★★★ aviAiLocal.mcpServers PHẢI scope:\"machine\" — workspace KHÔNG được ghi đè", () => {
    expect(manifest.contributes.configuration.properties["aviAiLocal.mcpServers"]?.scope).toBe("machine");
  });

  it("★ ĐỐI CHỨNG — aviAiLocal.serverUrl vẫn scope:\"machine\" (bài học Đợt A không bị hoàn tác)", () => {
    expect(manifest.contributes.configuration.properties["aviAiLocal.serverUrl"]?.scope).toBe("machine");
  });

  it("★★★ KHÔNG lệnh nào trong Command Palette tự nó GHI/ÁP/DUYỆT — mọi lượt ghi phải qua thẻ duyệt", () => {
    /**
     * ⚠ TIÊU ĐỀ CŨ NÓI SAI TỪ ĐỢT C (sửa 2026-08-30): nó viết "Đợt A KHÔNG khai lệnh nào mang nghĩa
     * GHI" trong một đợt mà extension CÓ ghi vào đĩa. Khẳng định thì vẫn đúng và vẫn cần — nhưng lý
     * do đã đổi: không phải "đợt này chưa ghi" mà là **đường ghi duy nhất đi qua thẻ duyệt của bảng
     * chat** (`bangChat.duyetDeXuat` → `apBanVa`). Một lệnh Command Palette tên "Áp bản vá" sẽ là
     * một lối ghi bấm-một-phát KHÔNG có diff, không có thẻ, không có nhãn nói byte rơi ở đâu.
     * Tiêu đề sai làm người đọc tin lưới đang canh một bất biến đã hết hiệu lực — tệ hơn không có.
     *
     * Dùng mẫu CHÍNH XÁC, không dùng `contains("ghi")` — "nghiệm thu" cũng chứa "ghi" nên phép
     * đo thô sẽ đỏ oan và người sau sẽ nới lỏng lưới cho hết đỏ (tệ hơn là không có lưới).
     */
    const ten = JSON.stringify(manifest.contributes.commands).toLowerCase();
    for (const mau of [/ghi\s*tệp/, /áp\s*dụng/, /apply/, /confirm/, /duyệt/]) {
      expect(ten).not.toMatch(mau);
    }
  });
});
