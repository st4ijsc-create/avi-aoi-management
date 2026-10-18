/**
 * ★★★ 2026-10-18 — LƯỚI ĐỊNH TUYẾN "ĐẶC TẢ SINH MÃ bị cửa SỬA/TỰ TRỊ nuốt".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC (bộ ngẫu nhiên `scripts/ai-eval/ngau-nhien/`, đường (a) pipeline, seed a/b)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường chat lập trình thua model thô 7 bài/54. Nguyên nhân là ĐỊNH TUYẾN, không phải model: một
 * ĐẶC TẢ dài (tiêu đề, khối mã, danh sách tệp, test kỳ vọng) có nhắc tên tệp (`Cargo.toml`,
 * `schema.sql`) + một động từ "sửa/viết lại" ở ĐÂU ĐÓ trong thân (thậm chí PHỦ ĐỊNH: *"Không được
 * sửa tệp test"*) ⇒ bị cửa "sửa 1 tệp" / "sửa nhiều tệp" / "tự trị" nuốt ⇒ "Không có tệp" sau 20 ms,
 * "CẢ LÔ dừng", thẻ duyệt sửa NHẦM `schema.sql` của repo, hay "vòng tự trị không sinh được bản vá".
 *
 * Nguyên tắc vá: **chỉ rẽ sang cửa SỬA/TỰ TRỊ khi CHẮC CHẮN; nghi ngờ ⇒ sinh mã.**
 *
 * ⚠ Mẫu câu ở đây VIẾT MỚI theo HÌNH DẠNG của câu hỏi bộ đo (tiêu đề `#`, khối mã, mục "Các tệp hiện
 *   có", câu phủ định "Không được sửa…", "cho tới khi" trong thân) — KHÔNG chép bài nào của kho
 *   (luật kho §4: không chỉnh đường ống theo từng bài rồi báo số trên chính kho ấy như đo mù).
 *
 * Đột biến phải bắt:
 *   • gỡ vế "đặc tả không có lệnh ở dòng đầu ⇒ không rẽ"         ⇒ §2/§5 ĐỎ
 *   • `laYDinhTuTri` đọc cả thân đặc tả thay vì dòng lệnh đầu      ⇒ §3/§5 ĐỎ
 *   • thu quá tay: câu "sửa X: …" / "tự sửa cho test xanh" THẬT bị chặn ⇒ §2/§3/§5 ĐỎ
 *   • phép kiểm tồn tại trả `true` cho tệp không có / thoát gốc   ⇒ §4 ĐỎ
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../aiLocalTools/index"; // đăng ký toàn bộ tool (side-effect) — `classifyCodingToolIntent` chỉ chọn tool ĐÃ đăng ký
import { laDacTaDai, dongLenhDau, laYDinhTuTri, TRAN_KY_TU_CAU_LENH } from "../aiLocalTools/intentClassifier";
import { coLenhGhiODau, dinhTuyenCuaGhi, phanLoaiYDinhGhi, tepTonTaiTrongGoc } from "./dinhTuyenGhi";

// ─── Mẫu câu CỐ ĐỊNH ───────────────────────────────────────────────────────────────────────────
const rao = "```";

/** Hình dạng câu bộ đo: tiêu đề + đặc tả + khối mã + "các tệp hiện có" + câu phủ định "Không được sửa". */
function dacTa(o: { tieuDe: string; ngonNgu: string; than: string; tep: Array<[string, string]>; tepGiai: string[] }): string {
  return [
    `# ${o.tieuDe}`,
    `Ngôn ngữ / nền tảng: ${o.ngonNgu}.`,
    o.than,
    "## Các tệp hiện có trong dự án",
    "Không được sửa tệp test và tệp cấu hình. Tệp cần viết có thể đang là khung rỗng — hãy viết lại TOÀN BỘ nội dung của nó.",
    ...o.tep.map(([rel, nd]) => `### \`${rel}\`\n${rao}\n${nd}\n${rao}`),
    `## Định dạng trả lời\nViết ĐẦY ĐỦ nội dung: ${o.tepGiai.map((t) => `\`${t}\``).join(", ")}.`,
  ].join("\n\n");
}

/** Mỗi mẫu nhắm MỘT cơ chế nuốt đã đo. */
const DAC_TA: Array<[string, string]> = [
  [
    "rust: Cargo.toml + 'viết lại' ⇒ từng bị cửa SỬA 1 TỆP nuốt",
    dacTa({
      tieuDe: "Gộp khoảng thời gian chồng lấn",
      ngonNgu: "Rust (stable, cargo test)",
      than: `Trong crate \`bai\` (tệp \`src/lib.rs\`), cài:\n\n${rao}rust\npub fn gop(v: &[(i64, i64)]) -> Vec<(i64, i64)>;\n${rao}\n\n- Khoảng rỗng bị bỏ.\n- Kết quả sắp tăng dần.\n- Hai khoảng chạm nhau được gộp.`,
      tep: [["Cargo.toml", '[package]\nname = "bai"\nedition = "2021"'], ["tests/hien_thi.rs", "#[test] fn t() {}"]],
      tepGiai: ["src/lib.rs"],
    }),
  ],
  [
    "sql: schema.sql + truy_van.sql ⇒ từng bị cửa SỬA NHIỀU TỆP nuốt",
    dacTa({
      tieuDe: "Xếp hạng doanh thu theo tháng (SQLite)",
      ngonNgu: "SQL (SQLite 3)",
      than: "Cho bảng `don_hang(id, ngay, tong)` trong `schema.sql`. Viết truy vấn trong `xep_hang.sql` trả về tháng, doanh thu, hạng.\n1. Tháng không có đơn vẫn không xuất hiện.\n2. Hạng dùng DENSE_RANK.\n3. Sắp theo tháng tăng dần.",
      tep: [["schema.sql", "CREATE TABLE don_hang(id INTEGER PRIMARY KEY, ngay TEXT, tong INTEGER);"], ["xep_hang.sql", "-- viết ở đây"]],
      tepGiai: ["xep_hang.sql"],
    }),
  ],
  [
    "c#: src/*.cs + Bai.csproj ⇒ từng bị cửa SỬA NHIỀU TỆP nuốt ('CẢ LÔ dừng')",
    dacTa({
      tieuDe: "Hàng đợi ưu tiên ổn định",
      ngonNgu: "C# (.NET 10, xUnit)",
      than: `Cài lớp \`HangDoi<T>\` trong \`src/HangDoi.cs\` và \`src/SoSanh.cs\`:\n\n${rao}csharp\npublic sealed class HangDoi<T> { public void Them(T x, int uuTien); public T Lay(); }\n${rao}`,
      tep: [["Bai.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />"], ["src/HangDoi.cs", ""], ["src/SoSanh.cs", ""], ["tests/HienThiTests.cs", "public class T {}"]],
      tepGiai: ["src/HangDoi.cs", "src/SoSanh.cs"],
    }),
  ],
  [
    "python: 'cho tới khi' trong THÂN thuật toán + 'Không được sửa' + test ⇒ từng bị cửa TỰ TRỊ nuốt",
    dacTa({
      tieuDe: "Tìm đường ngắn nhất trên lưới có cổng dịch chuyển",
      ngonNgu: "Python 3 (pytest)",
      than: `Viết \`duong_ngan(luoi)\` trong \`bai.py\`. Thuật toán gợi ý: đưa ô xuất phát vào hàng đợi; lặp cho tới khi hàng đợi rỗng hoặc gặp đích, mỗi bước lấy ô đầu và đẩy các ô kề chưa thăm.\n\n${rao}python\ndef duong_ngan(luoi: list[str]) -> int: ...\n${rao}`,
      tep: [["tests/test_hien_thi.py", "def test_a(): pass"]],
      tepGiai: ["bai.py"],
    }),
  ],
  [
    "c#: 'đến khi còn một' trong thân + 'sửa' phủ định ⇒ từng bị cửa TỰ TRỊ nuốt (dù có đường tệp)",
    dacTa({
      tieuDe: "Mã Huffman",
      ngonNgu: "C# (.NET 10, xUnit)",
      than: "Dựng cây: lấy hai nút nhỏ nhất, ghép, đưa lại vào tập; đến khi còn một gốc. Cài trong `src/Huffman.cs`.",
      tep: [["Bai.csproj", "<Project />"], ["src/Huffman.cs", ""], ["tests/HienThiTests.cs", "public class T {}"]],
      tepGiai: ["src/Huffman.cs"],
    }),
  ],
  [
    "python: 'thử lại cho tới khi' + 'sửa lại độ trễ' (KHÔNG phủ định) trong thân ⇒ chỉ dòng đầu được quyền mở tự trị",
    dacTa({
      tieuDe: "Bộ thử lại có lùi luỹ thừa",
      ngonNgu: "Python 3 (pytest)",
      than: `Viết \`thu_lai(tac_vu, so_lan)\` trong \`thu_lai.py\`: gọi tác vụ, thử lại cho tới khi thành công hoặc hết lượt; sau mỗi lần lỗi, sửa lại độ trễ (nhân đôi, trần 8 s).\n\n${rao}python\ndef thu_lai(tac_vu, so_lan: int) -> object: ...\n${rao}\nTest ẩn kiểm cả trường hợp hết lượt.`,
      tep: [["tests/test_hien_thi.py", "def test_a(): pass"]],
      tepGiai: ["thu_lai.py"],
    }),
  ],
  [
    "js: đặc tả dài KHÔNG tiêu đề, KHÔNG khối mã — chỉ dài + nhắc tệp + 'sửa' phủ định",
    "Hãy cài module phân tích số La Mã cho dự án Node. Hàm `docLaMa(s)` nhận chuỗi, trả số nguyên; chuỗi sai quy tắc (IIII, VV, IC) ném RangeError với thông báo nêu vị trí ký tự lỗi. " +
      "Hàm `vietLaMa(n)` nhận 1..3999, ngoài khoảng ném RangeError. Viết trong src/laMa.mjs, test hiển thị ở test/laMa.test.mjs chạy bằng node --test; " +
      "không được sửa package.json hay tệp test. Chuỗi rỗng ném TypeError. Chữ thường được chấp nhận và chuẩn hoá. Khoảng trắng hai đầu bị bỏ qua, khoảng trắng giữa là lỗi. " +
      "Kết quả của vietLaMa luôn là chữ hoa, dạng ngắn nhất theo quy tắc trừ chuẩn (IV, IX, XL, XC, CD, CM). Hai hàm phải là nghịch đảo của nhau trên toàn miền 1..3999 — test ẩn kiểm điều này cho mọi giá trị.",
  ],
];

/** Câu SỬA/TẠO THẬT — phải VẪN rẽ đúng cửa ghi (lấy từ hình dạng các lưới định tuyến hiện có). */
const LENH_SUA_THAT = [
  "sửa src/Calculator.cs: thêm dòng chú thích",
  "sửa src/Calculator.cs và src/StringUtils.cs: thêm dòng chú thích `// Dự án thử AI local` lên đầu mỗi tệp",
  "sửa Calc.cs để khắc phục lỗi sau khi chạy `dotnet test CalculatorDemo.sln`. Đây là đầu ra THẬT:\n\nFailed! - Failed: 2\n  at T.Divide() in D:\\x\\tests\\CalculatorTests.cs:line 42",
  "fix src/StringUtils.cs to add a null check",
  "thêm hàm formatNgay vào src/utils/date.ts",
  "tạo file mới src/utils/date.ts với hàm formatNgay",
  "viết lại Cargo.toml để thêm serde",
  // ĐẶC TẢ có lệnh SỬA nhắm tệp cụ thể NGAY DÒNG ĐẦU ⇒ vẫn là một lượt sửa tường minh.
  // ⚠ `.ts` chứ không `.rs`: `REPO_PATH_REGEX` không nhận đuôi `.rs` (giới hạn CÓ SẴN, ngoài phạm vi lượt này).
  `sửa src/gop.ts theo đặc tả dưới đây:\n\n## Yêu cầu\n- hàm gop() bỏ khoảng rỗng\n- sắp tăng dần\n\n${rao}ts\nexport function gop(v: Array<[number, number]>): Array<[number, number]>;\n${rao}`,
];

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `laDacTaDai` / `dongLenhDau`: nhận HÌNH DẠNG đặc tả, không nhận câu lệnh ngắn", () => {
  for (const [ten, q] of DAC_TA) it(`★★★ ${ten} ⇒ ĐẶC TẢ`, () => expect(laDacTaDai(q)).toBe(true));

  const ngan = [
    "sửa src/Calculator.cs: thêm dòng chú thích",
    "tự sửa cho test xanh",
    "đọc server/routers.ts và cho biết export gì",
    "viết hàm C# tính giai thừa",
  ];
  for (const q of ngan) it(`★★ "${q}" ⇒ KHÔNG phải đặc tả`, () => expect(laDacTaDai(q)).toBe(false));

  it("★★ ngưỡng độ dài có thật và nằm GIỮA câu lệnh dài nhất của lưới và đặc tả ngắn nhất của bộ đo (2.055 ký tự)", () => {
    expect(TRAN_KY_TU_CAU_LENH).toBeGreaterThanOrEqual(400);
    expect(TRAN_KY_TU_CAU_LENH).toBeLessThan(2055);
    for (const q of LENH_SUA_THAT.slice(0, 7)) expect(q.length).toBeLessThan(TRAN_KY_TU_CAU_LENH);
  });

  it("★★ dòng lệnh đầu = dòng KHÁC RỖNG đầu tiên, có trần độ dài", () => {
    expect(dongLenhDau("\n\n  sửa a.ts: x\nthân")).toBe("sửa a.ts: x");
    expect(dongLenhDau("x".repeat(5000)).length).toBeLessThanOrEqual(300);
    expect(dongLenhDau("")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `phanLoaiYDinhGhi`: đặc tả KHÔNG rẽ cửa ghi; lệnh sửa THẬT vẫn rẽ", () => {
  for (const [ten, q] of DAC_TA) {
    it(`★★★ ${ten} ⇒ "khong"`, () => expect(phanLoaiYDinhGhi(q)).toBe("khong"));
  }
  for (const q of LENH_SUA_THAT) {
    it(`★★★ "${q.split("\n")[0]}" ⇒ "lenh_dau" (lệnh tường minh ở dòng đầu)`, () =>
      expect(phanLoaiYDinhGhi(q)).toBe("lenh_dau"));
  }

  it("★★★ câu PHỦ ĐỊNH ở dòng đầu KHÔNG phải lệnh sửa", () => {
    expect(coLenhGhiODau("Không được sửa src/a.ts, chỉ giải thích nó")).toBe(false);
    expect(coLenhGhiODau("đừng sửa Cargo.toml")).toBe(false);
    expect(coLenhGhiODau("do not modify src/a.ts")).toBe(false);
  });

  it("★★ câu NGẮN, lệnh không ở dòng đầu ⇒ 'can_tep_ton_tai' (rẽ chỉ khi tệp CÓ THẬT)", () => {
    expect(phanLoaiYDinhGhi("Dự án Rust của tôi.\nsửa Cargo.toml thêm serde")).toBe("can_tep_ton_tai");
  });

  it("★ không có động từ ghi ⇒ 'khong' (đường ĐỌC giữ nguyên)", () => {
    expect(phanLoaiYDinhGhi("đọc server/routers.ts và cho biết export gì")).toBe("khong");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — `laYDinhTuTri`: chỉ mệnh lệnh tự trị TƯỜNG MINH, không bao giờ vì thân đặc tả", () => {
  for (const [ten, q] of DAC_TA) it(`★★★ ${ten} ⇒ KHÔNG tự trị`, () => expect(laYDinhTuTri(q)).toBe(false));

  it("★★★ đặc tả có mệnh lệnh tự trị ở DÒNG ĐẦU ⇒ vẫn tự trị", () => {
    const q = `tự sửa cho tới khi test xanh\n\n${rao}\nFAILED tests/test_a.py::test_x - AssertionError\n${rao}\n` + "chi tiết ".repeat(100);
    expect(laDacTaDai(q)).toBe(true);
    expect(laYDinhTuTri(q)).toBe(true);
  });

  const khong = [
    // "và" bỏ dấu = "va" — trước đây khớp như động từ "vá".
    "đọc src/a.ts và chạy test cho tới khi xong thì báo tôi",
    // động từ sửa bị PHỦ ĐỊNH.
    "không được sửa test, chạy lại cho tới khi build xanh",
  ];
  for (const q of khong) it(`★★★ "${q}" ⇒ KHÔNG tự trị`, () => expect(laYDinhTuTri(q)).toBe(false));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — `tepTonTaiTrongGoc`: tồn tại THẬT (realpath trong gốc), không phải hình dạng", () => {
  let goc = "";
  beforeAll(() => {
    goc = fs.mkdtempSync(path.join(os.tmpdir(), "dinh-tuyen-ghi-"));
    fs.mkdirSync(path.join(goc, "src"));
    fs.writeFileSync(path.join(goc, "src", "a.ts"), "export const a = 1;\n");
  });
  afterAll(() => {
    try { fs.rmSync(goc, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  });

  it("★★★ tệp có thật ⇒ true", () => expect(tepTonTaiTrongGoc(goc, "src/a.ts")).toBe(true));
  it("★★★ tệp không có ⇒ false", () => expect(tepTonTaiTrongGoc(goc, "Cargo.toml")).toBe(false));
  it("★★★ thư mục ⇒ false (không phải tệp)", () => expect(tepTonTaiTrongGoc(goc, "src")).toBe(false));
  it("★★★ thoát gốc (`..`) ⇒ false", () => {
    fs.writeFileSync(path.join(path.dirname(goc), "ngoai-goc-dinh-tuyen.ts"), "x");
    try {
      expect(tepTonTaiTrongGoc(goc, "../ngoai-goc-dinh-tuyen.ts")).toBe(false);
    } finally {
      fs.rmSync(path.join(path.dirname(goc), "ngoai-goc-dinh-tuyen.ts"), { force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * §5 — LƯỚI CHUỖI CỬA: cùng hàm `dinhTuyenCuaGhi` mà `streamCodingAnswer` dùng (KHÔNG mô phỏng lại
 * các vị từ — bản mô phỏng ở `tmp/chan-doan-pipe/dinh-tuyen.mts` chép tay `laYDinhSuaTep` là đúng lớp
 * lỗi "hai bản sao một vị từ").
 */
describe("§5 — chuỗi cửa định tuyến: đặc tả ⇒ KHÔNG cửa ghi nào; lệnh thật ⇒ đúng cửa", () => {
  for (const [ten, q] of DAC_TA) {
    it(`★★★ ${ten} ⇒ cửa ghi = KHÔNG (rơi xuống vòng tool/sinh mã)`, () => {
      expect(dinhTuyenCuaGhi(q).cua).toBe("KHONG");
    });
  }

  const ky: Array<[string, string]> = [
    ["sửa src/Calculator.cs: thêm dòng chú thích", "SUA_TAT_DINH"],
    ["tạo dự án C# WPF đọc file pdf", "TAO_KHUNG"],
    ["tự sửa cho test xanh", "TU_TRI"],
    ["thêm hàm formatNgay vào src/utils/date.ts", "SUA_1_TEP"],
    ["sửa src/Calculator.cs và src/StringUtils.cs để đổi tên hàm Divide thành Chia", "SUA_NHIEU_TEP"],
  ];
  for (const [q, cua] of ky) {
    it(`★★★ "${q}" ⇒ ${cua}`, () => expect(dinhTuyenCuaGhi(q).cua).toBe(cua));
  }

  it("★★ cửa ghi 'mờ' mang cờ canTonTai — streamCodingAnswer phải kiểm đĩa trước khi rẽ", () => {
    const d = dinhTuyenCuaGhi("Dự án Rust của tôi.\nsửa Cargo.toml thêm serde");
    expect(d.cua).toBe("SUA_1_TEP");
    expect(d.ghiTep?.canTonTai).toBe(true);
    expect(dinhTuyenCuaGhi("thêm hàm formatNgay vào src/utils/date.ts").ghiTep?.canTonTai).toBe(false);
  });
});
