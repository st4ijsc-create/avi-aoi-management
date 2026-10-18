/**
 * CÂU HỎI gửi model — một nguồn cho hai đường:
 *   (a) MỘT LƯỢT: đặc tả + toàn bộ tệp khung (kể cả test hiển thị) + định dạng trả lời có dòng đánh dấu tệp;
 *   (b) AGENT: đặc tả + đường dự án + lệnh test — agent tự đọc/ghi/chạy.
 * Câu hỏi KHÔNG chứa test ẩn, KHÔNG chứa lời giải mẫu (kiểm ở kiem-thuoc.mjs: "rò đáp án vào prompt").
 */
import fs from "node:fs";
import { lietKeTep, TEN_NGON_NGU } from "./kho.mjs";
import { tienToChuThich } from "./trichTep.mjs";

const NGON_NGU_RAO = { py: "python", sql: "sql", js: "javascript", ts: "typescript", cs: "csharp", java: "java", cpp: "cpp", go: "go", rs: "rust" };
const raoTheoDuoi = (rel) => {
  const d = rel.split(".").pop();
  return { py: "python", sql: "sql", mjs: "javascript", js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", cs: "csharp",
    csproj: "xml", java: "java", cpp: "cpp", hpp: "cpp", h: "cpp", txt: "cmake", go: "go", mod: "text", rs: "rust", toml: "toml",
    json: "json", ini: "ini", md: "markdown", csv: "csv" }[d] ?? "";
};

/** Lời hệ thống của trục M (gọi thẳng llama-server). */
export const SYS_MOT_LUOT =
  "Bạn là trợ lý lập trình. Trả lời bằng các khối mã đúng định dạng được yêu cầu (mỗi tệp một khối, dòng đầu khối ghi đường tệp). Không giải thích ngoài các khối mã.";

export function taoCauHoiMotLuot(bai) {
  const tepKhung = lietKeTep(bai.khungAbs);
  const phan = [];
  phan.push(`# ${bai.tieuDe}`);
  phan.push(`Ngôn ngữ / nền tảng: ${TEN_NGON_NGU[bai.lang]}.`);
  phan.push(bai.deBai.trim());
  phan.push("## Các tệp hiện có trong dự án");
  phan.push("Không được sửa tệp test và tệp cấu hình. Tệp cần viết có thể đang là khung rỗng — hãy viết lại TOÀN BỘ nội dung của nó.");
  for (const rel of tepKhung) {
    const nd = fs.readFileSync(`${bai.khungAbs}/${rel}`, "utf8");
    phan.push(`### \`${rel}\`\n\`\`\`${raoTheoDuoi(rel)}\n${nd.replace(/\n$/, "")}\n\`\`\``);
  }
  const vd = bai.tepGiai[0];
  phan.push(
    "## Định dạng trả lời\n" +
      `Viết ĐẦY ĐỦ nội dung ${bai.tepGiai.length === 1 ? "tệp" : `${bai.tepGiai.length} tệp`}: ${bai.tepGiai.map((t) => `\`${t}\``).join(", ")}.\n` +
      "Mỗi tệp nằm trong MỘT khối mã riêng; dòng ĐẦU TIÊN trong khối là chú thích ghi đường tệp, ví dụ:\n" +
      `\`\`\`${NGON_NGU_RAO[bai.lang] ?? ""}\n${tienToChuThich(vd)} tệp: ${vd}\n…\n\`\`\`\n` +
      "Mã phải biên dịch/chạy được và qua cả các test ẩn kiểm đúng đặc tả ở trên (không chỉ test hiển thị).",
  );
  return phan.join("\n\n");
}

/** Lệnh test hiển thị, viết với đường dự án `da` (tương đối gốc repo/dự án của agent). */
export function lenhTest(bai, da) {
  const p = (rel) => `${da}/${rel}`;
  switch (bai.kieu) {
    case "pytest": return { lenh: `python -m pytest ${bai.testHienThi.map(p).join(" ")}`, agentChayDuoc: true };
    case "node": return { lenh: `node --test ${bai.testHienThi.map(p).join(" ")}`, agentChayDuoc: true };
    case "dotnet": return { lenh: `dotnet test ${da}/Bai.csproj`, agentChayDuoc: true };
    case "java": return { lenh: `(trong ${da}) javac -encoding UTF-8 -d out-kt src/*.java test/*.java && java -ea -cp out-kt ${bai.testHienThi.map((t) => t.split("/").pop().replace(/\.java$/, "")).join(" / ")}`, agentChayDuoc: false };
    case "cmake": return { lenh: `(trong ${da}) cmake -S . -B _b && cmake --build _b --config Release && _b/Release/<tên test>.exe`, agentChayDuoc: false };
    case "go": return { lenh: `(trong ${da}) go test ./...`, agentChayDuoc: false };
    case "cargo": return { lenh: `(trong ${da}) cargo test`, agentChayDuoc: false };
    default: return { lenh: "?", agentChayDuoc: false };
  }
}

/** Câu hỏi cho chế độ agent (máy chủ `/api/ai/agent/runs` hoặc extension). `da` = đường dự án; null ⇒ "dự án này". */
export function taoCauHoiAgent(bai, da) {
  const ten = da ? `\`${da}\`` : "này";
  const dDuong = da ?? ".";
  const { lenh, agentChayDuoc } = lenhTest(bai, dDuong);
  return [
    `Trong dự án ${ten} (${TEN_NGON_NGU[bai.lang]}), hãy làm việc sau. Các đường tệp trong yêu cầu tính từ gốc dự án${da ? ` \`${da}\`` : ""}.`,
    `# ${bai.tieuDe}`,
    bai.deBai.trim(),
    `Tệp cần tạo/sửa: ${bai.tepGiai.map((t) => `\`${t}\``).join(", ")}. KHÔNG sửa tệp test và tệp cấu hình dự án; không tạo tệp cấu hình test mới.`,
    `Test hiển thị: \`${lenh}\`.` +
      (agentChayDuoc ? " Chạy nó để kiểm tra trước khi kết thúc." : " (Lệnh này có thể không nằm trong danh sách lệnh bạn được chạy — nếu không chạy được, hãy tự rà soát kỹ mã theo test hiển thị.)") +
      " Máy chấm còn chạy thêm test ẩn kiểm đúng đặc tả.",
  ].join("\n\n");
}
