/**
 * ★ Bộ vàng ST4I — `dapAnTraLoi` (mẫu theo cách NGƯỜI trả lời, 2026-09-24). Chấm đầu–cuối (`scripts/ai-eval/kb-dau-cuoi.mjs`)
 * dựa vào nó; hai lỗi đã gặp khi viết: (1) mẫu KHỚP CHÍNH CÂU HỎI ⇒ câu trả lời nhắc lại câu hỏi được chấm đạt (T57/T69/T73);
 * (2) mẫu hỏng cú pháp ⇒ bộ chấm ném giữa lượt. Đã đối chiếu chấm tay: 0 lệch trên 30 câu.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const bo = fs.readFileSync("knowledge/studio-golden/st4i-may-aoi.jsonl", "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const trong = bo.filter((c) => c.nguon.length > 0);

describe("st4i-may-aoi — dapAnTraLoi", () => {
  it("mọi câu TRONG corpus có dapAnTraLoi biên dịch được", () => {
    const thieu = trong.filter((c) => !c.dapAnTraLoi?.regex).map((c) => c.id);
    expect(thieu).toEqual([]);
    for (const c of trong) expect(() => new RegExp(c.dapAnTraLoi.regex, "i"), c.id).not.toThrow();
  });
  it("★ KHÔNG mẫu nào khớp chính câu hỏi (câu trả lời nhắc lại đề không được tính là đúng)", () => {
    const tu = trong.filter((c) => new RegExp(c.dapAnTraLoi.regex, "i").test(c.cauHoi)).map((c) => c.id);
    expect(tu).toEqual([]);
  });
  it("câu NGOÀI corpus không mang dapAnTraLoi", () => {
    expect(bo.filter((c) => c.nguon.length === 0 && c.dapAnTraLoi).map((c) => c.id)).toEqual([]);
  });
});
