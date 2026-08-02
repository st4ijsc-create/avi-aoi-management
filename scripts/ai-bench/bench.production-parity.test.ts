import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Trích thân hàm `function <name>(...)` cho tới khai báo hàm TOP-LEVEL kế tiếp.
 *
 * review round 2 M-c — bản ĐẾM NGOẶC trước đó (`{`/`}`) MÙ chuỗi/comment: reviewer đã CHỨNG
 * MINH false-negative sống — chèn một `}` lạc trong MỘT comment SAU điểm cần canh trong
 * `benchEmbedModel()` khiến vòng đếm kết thúc thân hàm SỚM (đủ để "}" đó cân bằng lại depth về
 * 0 trước khi chạm code drift thật nằm sau), 3/3 test vẫn XANH dù khối drift đã quay lại. Đặt
 * "}" lạc TRƯỚC điểm chèn thì assert khác (dòng ~52 khi đó) bắt được — chỉ NỬA VẾ được bảo vệ,
 * không đủ cho cổng đã drift 3 lần.
 *
 * SỬA: bỏ hẳn việc đếm `{`/`}`. Mọi hàm top-level trong bench.mjs khai báo KHÔNG THỤT LỀ
 * (`^function ` / `^async function ` ở đầu dòng — xác nhận bằng grep, 18/18 khai báo hiện có).
 * Vì JS không cho phép một khai báo hàm top-level NẰM TRONG thân một khai báo hàm top-level
 * khác, khai báo top-level KẾ TIẾP sau `functionName` LUÔN LUÔN nằm ngoài thân hàm đó — bất kể
 * bên trong có bao nhiêu `{`/`}` thật hay giả (trong chuỗi/comment). Không đếm ngoặc ⇒ không
 * còn mù chuỗi/comment theo BẤT KỲ hướng nào (cả "}" lạc trước lẫn sau điểm cần canh).
 */
function extractFunctionBody(src: string, functionName: string): string {
  const lines = src.split("\n");
  const declRe = new RegExp(`^(async\\s+)?function\\s+${functionName}\\s*\\(`);
  const startIdx = lines.findIndex((l) => declRe.test(l));
  if (startIdx === -1) {
    throw new Error(
      `extractFunctionBody: không tìm thấy khai báo TOP-LEVEL "function ${functionName}(" (đầu dòng, không thụt lề) trong bench.mjs`,
    );
  }

  const anyTopLevelFnRe = /^(async\s+)?function\s+\w+\s*\(/;
  let endIdx = lines.length; // mặc định: tới hết file nếu đây là hàm top-level CUỐI CÙNG
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (anyTopLevelFnRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(startIdx, endIdx).join("\n");
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
