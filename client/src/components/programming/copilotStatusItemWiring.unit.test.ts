// doc 81 Đợt 7 task L fix 1 (b) — cả ba trang có Copilot trong layout (IDE / IR / POU) dùng CHUNG mục thanh trạng thái
// `CopilotStatusItem` (hiện "Copilot đang chạy" khi một lượt chạy khuất) — không trang nào tự vẽ lại "Copilot ●/○" (bản tự
// vẽ không biết luồng đang chạy). Lưới đếm trên mã nguồn: thêm trang Copilot mới mà quên mục này ⇒ đỏ.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const PAGES = ["pages/EngineeringWorkspace.tsx", "pages/IrEditor.tsx", "pages/PouStudio.tsx"];

describe("CopilotStatusItem — IDE/IR/POU dùng chung mục thanh trạng thái", () => {
  for (const p of PAGES) {
    it(`${p}: render <CopilotStatusItem /> và không tự vẽ "Copilot ●/○"`, () => {
      const src = fs.readFileSync(path.join(ROOT, p), "utf8");
      expect(src).toMatch(/<CopilotStatusItem\s*\/>/);
      expect(src).not.toMatch(/copilotOpen \? "●" : "○"/);
    });
  }
  it("mọi trang dùng CopilotInspector đều có CopilotStatusItem (không sót trang mới)", () => {
    const dir = path.join(ROOT, "pages");
    const users = fs.readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /<CopilotInspector\b/.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(users.sort()).toEqual(["EngineeringWorkspace.tsx", "IrEditor.tsx", "PouStudio.tsx"]);
  });
});
