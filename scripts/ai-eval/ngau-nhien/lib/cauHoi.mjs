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

/**
 * Lệnh test HIỂN THỊ theo đúng KHUÔN lệnh agent máy chủ được phép (`server/services/aiLocalTools/repoCommandSandbox.ts`,
 * 241e1880f), viết với đường dự án `da` (tương đối GỐC DỰ ÁN của agent; `null`/`"."` ⇒ dự án bài CHÍNH LÀ gốc).
 * Trả `{ buoc, lenh, agentChayDuoc, lyDo }` — mỗi phần tử `buoc` là MỘT lời gọi run_command, đúng thứ tự.
 *
 * Khuôn (không shell, không `&&`, cờ cố định, ô tự do = đường tương đối; trần 8 token/lệnh):
 *   pytest `python -m pytest <đường>` · node `node --test <đường>` · dotnet `dotnet test <đường>`
 *   java   `javac -d <ra> <tệp|thư-mục>…` (máy chủ tự thêm `-encoding UTF-8`; THƯ MỤC ⇒ mọi .java dưới nó — liệt kê
 *          từng tệp thì bài ud vượt trần 8 token) → `java -cp <ra> <LớpTest>` (tên `*Test` ⇒ tự chạy; máy chủ thêm `-ea`)
 *   cmake  `cmake -S . -B <dựng>` → `cmake --build <dựng>` → `ctest --test-dir <dựng>` (khung khai `add_test`)
 *   go     `go test ./...` (cần go.mod ở GỐC dự án) · cargo `cargo test --offline` (cần Cargo.toml ở GỐC)
 * ⇒ cmake/go/cargo KHÔNG có ô đường: chỉ chạy được khi dự án bài LÀ gốc dự án của agent (`agent.mjs --goc-bai`).
 *   Bài nằm trong thư mục con (mặc định `tmp/ngau-nhien-agent/<id>` của dự án `repo`) ⇒ `agentChayDuoc: false`.
 * Thư mục ra `out-kt` / `_b` CỐ Ý trùng thư mục sản phẩm bộ chấm bỏ qua (`lib/kho.mjs` BO_QUA). Dựng chỗ khác vẫn chấm
 * đúng (cham.mjs bỏ cây dựng có CMakeCache.txt) nhưng để rác trong "tệp đã đổi".
 * ⚠ Extension (đường c) chỉ nhận `javac` với TỆP .java — đường (c) không có bài java nên không xung đột.
 */
export function lenhTest(bai, da) {
  const goc = da === null || da === undefined || da === "" || da === ".";
  const p = (rel) => (goc ? rel : `${da}/${rel}`);
  const lop = (rel) => rel.split("/").pop().replace(/\.java$/, "");
  let buoc;
  let chiOGoc = false;
  switch (bai.kieu) {
    case "pytest": buoc = bai.testHienThi.map((t) => `python -m pytest ${p(t)}`); break;
    case "node": buoc = bai.testHienThi.map((t) => `node --test ${p(t)}`); break;
    case "dotnet": buoc = [`dotnet test ${p("Bai.csproj")}`]; break;
    case "java":
      buoc = [`javac -d ${p("out-kt")} ${p("src")} ${p("test")}`, ...bai.testHienThi.map((t) => `java -cp ${p("out-kt")} ${lop(t)}`)];
      break;
    case "cmake": buoc = ["cmake -S . -B _b", "cmake --build _b", "ctest --test-dir _b"]; chiOGoc = true; break;
    case "go": buoc = ["go test ./..."]; chiOGoc = true; break;
    case "cargo": buoc = ["cargo test --offline"]; chiOGoc = true; break;
    default: return { buoc: [], lenh: "?", agentChayDuoc: false, lyDo: `kiểu chấm lạ ${bai.kieu}` };
  }
  const agentChayDuoc = goc || !chiOGoc;
  return {
    buoc,
    lenh: buoc.join(" → "),
    agentChayDuoc,
    lyDo: agentChayDuoc ? null : `khuôn ${bai.kieu} không có ô đường — chỉ chạy ở GỐC dự án agent; bài nằm ở ${da}`,
  };
}

/** Câu hỏi cho chế độ agent (máy chủ `/api/ai/agent/runs` hoặc extension). `da` = đường dự án; null ⇒ "dự án này" (bài = gốc). */
export function taoCauHoiAgent(bai, da) {
  const ten = da ? `\`${da}\`` : "này";
  const { buoc, agentChayDuoc } = lenhTest(bai, da);
  const lenhIn = buoc.map((l) => `\`${l}\``).join(" → ");
  return [
    `Trong dự án ${ten} (${TEN_NGON_NGU[bai.lang]}), hãy làm việc sau. Các đường tệp trong yêu cầu tính từ gốc dự án${da ? ` \`${da}\`` : ""}.`,
    `# ${bai.tieuDe}`,
    bai.deBai.trim(),
    `Tệp cần tạo/sửa: ${bai.tepGiai.map((t) => `\`${t}\``).join(", ")}. KHÔNG sửa tệp test và tệp cấu hình dự án; không tạo tệp cấu hình test mới.`,
    agentChayDuoc
      ? `Test hiển thị (mỗi lệnh một lần gọi run_command, đúng thứ tự, đường tính từ gốc dự án của bạn): ${lenhIn}. Chạy để kiểm tra trước khi kết thúc. Máy chấm còn chạy thêm test ẩn kiểm đúng đặc tả.`
      : `Test hiển thị (chạy tại thư mục ${ten}): ${lenhIn}. Lệnh này chỉ chạy được ở GỐC dự án nên có thể bị từ chối ở đây — nếu không chạy được, hãy tự rà soát kỹ mã theo test hiển thị. Máy chấm còn chạy thêm test ẩn kiểm đúng đặc tả.`,
  ].join("\n\n");
}
