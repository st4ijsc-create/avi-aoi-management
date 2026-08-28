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

  it("★★★ Đợt A KHÔNG khai lệnh nào mang nghĩa GHI/ÁP/DUYỆT", () => {
    // Dùng mẫu CHÍNH XÁC, không dùng `contains("ghi")` — "nghiệm thu" cũng chứa "ghi" nên phép
    // đo thô sẽ đỏ oan và người sau sẽ nới lỏng lưới cho hết đỏ (tệ hơn là không có lưới).
    const ten = JSON.stringify(manifest.contributes.commands).toLowerCase();
    for (const mau of [/ghi\s*tệp/, /áp\s*dụng/, /apply/, /confirm/, /duyệt/]) {
      expect(ten).not.toMatch(mau);
    }
  });
});
