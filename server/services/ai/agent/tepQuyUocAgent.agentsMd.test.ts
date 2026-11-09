import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DUONG_TEP_QUY_UOC, TRAN_BYTE_MOI_TEP_QUY_UOC, docTepQuyUoc } from "./tepQuyUocAgent";

const GOC = process.cwd();

describe("AGENTS.md ở gốc repo (B1) nạp được bằng docTepQuyUoc", () => {
  const tep = docTepQuyUoc(GOC).find((t) => t.duong === "AGENTS.md");

  it("★★★ có mặt và được nạp (không bị bỏ vì mẫu tiêm / chính sách đường dẫn)", () => {
    expect(DUONG_TEP_QUY_UOC[0]).toBe("AGENTS.md");
    expect(tep).toBeDefined();
    expect(tep!.noiDung).toContain("Lệnh kiểm");
    expect(tep!.noiDung).not.toMatch(/bị bỏ|ignore previous/i);
  });

  it("★★ nằm dưới trần byte mỗi tệp (không bị cắt cụt) và LF, không BOM", () => {
    const tho = fs.readFileSync(path.join(GOC, "AGENTS.md"));
    expect(tho.length).toBeLessThanOrEqual(TRAN_BYTE_MOI_TEP_QUY_UOC);
    expect(tho.includes(Buffer.from("\r\n"))).toBe(false);
    expect(tho.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(tep!.noiDung.length).toBeGreaterThan(tho.toString("utf8").length * 0.95); // không bị cắt cụt (so ký tự, không so byte)
  });

  it("★★ các lệnh được nêu có thật trong package.json (không dạy lệnh không tồn tại)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(GOC, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const ten of ["check", "check:tests", "i18n:check"]) {
      expect(pkg.scripts[ten], ten).toBeTruthy();
      expect(tep!.noiDung).toContain(`npm run ${ten}`);
    }
  });

  it("★★ mang đủ các luật đã duyệt (C# lớp lồng, không định nghĩa lại kiểu, đồng hồ giả, vùng cấm, tập đúng đặc tả)", () => {
    const c = tep!.noiDung;
    expect(c).toContain("CS0122");
    expect(c).toContain("internal");
    expect(c).toContain("KHÔNG định nghĩa lại kiểu");
    expect(c).toContain("afterEach(() => vi.useRealTimers())");
    expect(c).toContain("server/services/ot/**");
    expect(c).toContain("không trả tập bao trùm");
  });

  it("★ không dạy đề thi: không nhắc tên thuật toán / định dạng của bài cụ thể", () => {
    expect(tep!.noiDung).not.toMatch(/Kahn|Tarjan|SCC|RFC ?4180/i);
  });

  it("★ chỉ trỏ tới tệp tham chiếu khi tệp đó có thật (§7 thêm từng đường khi B2/B3/B4 xong)", () => {
    const duongs = [...tep!.noiDung.matchAll(/`(docs\/ai\/[^`]+)`/g)].map((m) => m[1]!).filter((d) => d !== "docs/ai/");
    for (const d of duongs) expect(fs.existsSync(path.join(GOC, d)), d).toBe(true);
    expect(tep!.noiDung).toContain("KHÔNG bịa");
  });
});
