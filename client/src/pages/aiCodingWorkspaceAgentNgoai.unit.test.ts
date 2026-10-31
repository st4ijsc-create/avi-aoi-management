// Đợt 10.4b L4 — ghim KEO NỐI của màn lập trình cho agent bằng model ngoài (trang quá lớn để dựng DOM; lưới đọc nguồn như các ghim cùng loại):
//   • công tắc CHỈ bày khi `agentNgoaiBay` (model ngoài + máy chủ khai bề mặt agent);
//   • đường gửi agent-ngoài luôn `cheDo: "hoi"`, đặt TRƯỚC đường agent thường, và trả câu về ô nhập khi người dùng từ chối;
//   • hook nhận `hoiVanHanh` (hộp xác nhận chung với đường Hỏi);
//   • vòng tự sửa (`tuVong`) không bao giờ vào đường ngoài.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const nguon = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "AICodingWorkspace.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("AICodingWorkspace — agent bằng model ngoài", () => {
  it("công tắc chỉ render trong nhánh agentNgoaiBay, và agentNgoaiBay phụ thuộc cả laNgoai lẫn agentNgoaiMo(danh mục)", () => {
    expect(nguon).toMatch(/const agentNgoaiBay = laNgoai && agentNgoaiMo\(danhMucModel, chonModel\);/);
    expect(nguon).toMatch(/\{agentNgoaiBay && \(\s*<label data-testid="bat-agent-ngoai"/);
  });
  it("đường gửi: duongAgentNgoai = dungAgentNgoai(công tắc, danh mục, model) và gọi agentGui(text, \"hoi\") — không chế độ nào khác", () => {
    expect(nguon).toMatch(/const duongAgentNgoai = dungAgentNgoai\(batAgentNgoai, danhMucModel, chonModel\);/);
    const i = nguon.indexOf("if (duongAgentNgoai && !tuVong) {");
    expect(i).toBeGreaterThan(0);
    const khoi = nguon.slice(i, nguon.indexOf("return;\n    }", i) + 20);
    expect(khoi).toContain('agentGui(text, "hoi")');
    expect(khoi).toContain('kq === "tu-choi"');
    expect(khoi).toContain("setInput(text)");
    expect(khoi).not.toMatch(/agentGui\(text, cheDoChat\)/);
  });
  it("đường agent-ngoài đứng TRƯỚC đường agent thường (nếu không, laNgoai sẽ bị nuốt vào đường Hỏi KB)", () => {
    expect(nguon.indexOf("if (duongAgentNgoai && !tuVong) {")).toBeLessThan(nguon.indexOf("if (!laNgoai && cheDoChat !== \"hoi\" && !tuVong) {"));
  });
  it("hook nhận hoiVanHanh của useXacNhanNgoai và handleSend phụ thuộc duongAgentNgoai", () => {
    expect(nguon).toMatch(/const agent = useLuotChayAgent\(\{[^}]*?\n\s*hoiVanHanh,/s);
    expect(nguon).toMatch(/agentGui, laNgoai, duongAgentNgoai,/);
  });
  it("đổi model ⇒ công tắc agent-ngoài về tắt (effect phụ thuộc chonModel)", () => {
    expect(nguon).toMatch(/useEffect\(\(\) => \{\s*setBatAgentNgoai\(false\);\s*\}, \[chonModel\]\);/);
  });
  it("ô chọn chế độ vẫn bị khoá khi chọn model ngoài (chỉ-hỏi)", () => {
    expect(nguon).toMatch(/khoa=\{agentDangChay \|\| isStreaming \|\| laNgoai\}/);
  });
});
