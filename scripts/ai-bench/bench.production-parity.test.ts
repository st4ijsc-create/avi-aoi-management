import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Trích thân hàm `function <name>(...)` bằng cách ĐẾM NGOẶC (không phải regex thô) — bền hơn
 * `/\{[^}]*\}/` khi thân hàm có ngoặc lồng nhau (object literal, try/finally, ...), đúng thực tế
 * của `benchEmbedModel()`/`benchTextModel()`. Trả về thân hàm (không gồm dòng khai báo) hoặc
 * ném lỗi rõ ràng nếu không tìm thấy — test phải THẤY được lý do đỏ, không âm thầm bỏ qua.
 */
function extractFunctionBody(src: string, functionName: string): string {
  const declMatch = src.match(new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`));
  if (!declMatch || declMatch.index === undefined) {
    throw new Error(`extractFunctionBody: không tìm thấy khai báo "function ${functionName}(" trong bench.mjs`);
  }
  const bodyStart = declMatch.index + declMatch[0].length;
  let depth = 1; // đã ăn dấu "{" mở đầu thân hàm ở declMatch
  let i = bodyStart;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  if (depth !== 0) {
    throw new Error(`extractFunctionBody: ngoặc "{}" không cân bằng trong thân hàm ${functionName}()`);
  }
  return src.slice(bodyStart, i - 1);
}

/** Cổng chống DRIFT: bench.mjs đã sai 3 lần vì tự dựng context khác đường sản
 *  xuất. Test này không đo VRAM — nó khẳng định bench KHÔNG còn hard-code tham
 *  số context riêng, mà lấy từ cùng nguồn với sản xuất. */
describe("bench.mjs — khớp đường sản xuất", () => {
  const src = readFileSync("scripts/ai-bench/bench.mjs", "utf8");

  it("KHÔNG còn hard-code contextSize 'auto' cho embedding", () => {
    expect(src).not.toMatch(/createEmbeddingContext\(\{\s*contextSize:\s*"auto"/);
  });

  it("KHÔNG còn tạo context text mà bỏ qua sequences", () => {
    const m = src.match(/model\.createContext\(\{[^}]*\}\)/s);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/sequences/);
  });

  // review round 1 Minor-1 — cổng CŨ dùng src.match() (không /g) nên chỉ khớp LẦN XUẤT HIỆN
  // ĐẦU TIÊN của `model.createContext({...})` trong toàn file (ở benchTextModel()). Ai thêm
  // lại context thường vào benchEmbedModel() (đúng bug dot2 Task 1 từng mô phỏng, Task 3 vừa
  // xoá) thì cổng cũ VẪN XANH — không có tác dụng chống drift cho ĐÚNG hàm cần canh. Cổng chống
  // drift lần thứ TƯ (Task 3) này canh ĐÚNG thân hàm benchEmbedModel().
  it("dot2 Task 3 — benchEmbedModel() KHÔNG còn tạo context thường (createContext) — chỉ embedding context", () => {
    const body = extractFunctionBody(src, "benchEmbedModel");
    expect(body).not.toMatch(/\.createContext\(/);
    expect(body).toMatch(/\.createEmbeddingContext\(/); // vẫn phải còn — không xoá nhầm cả phần cần giữ
  });
});
