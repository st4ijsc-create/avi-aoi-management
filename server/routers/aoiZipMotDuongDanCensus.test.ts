/**
 * I-3 (review lượt 8) — CENSUS TOÀN REPO cho bất biến "MỘT đường dẫn, MỘT chỗ
 * tìm" khi đọc ảnh trong gói ZIP AOI.
 *
 * ── Vì sao census, không phải thêm một ca test nữa ─────────────────────────
 * BG-87 (`cc322bca`) khai đã bỏ fallback tên trần `zip.file(fileName)` ở BA
 * chỗ. Review lượt 8 tìm ra chỗ thứ TƯ (`aoiImageEmbeddingWorker.ts`) — cùng
 * ZIP, cùng phép tra tệp, chỉ khác tệp nguồn. Lưới BG-87 mệnh đề 4 phủ 1/4 chỗ
 * (tRPC `getImage`) nên nó KHÔNG THỂ bắt ba chỗ kia: nó canh một ĐIỂM, còn cái
 * phải canh là một BẤT BIẾN. Đúng lớp lỗi L-1 ("lưới theo DANH SÁCH, không theo
 * ∀") — không có census này, chỗ thứ NĂM sẽ xuất hiện và cũng sẽ không ai thấy.
 *
 * ── Bất biến được cưỡng chế ────────────────────────────────────────────────
 * Trong MÃ SẢN XUẤT (`server/**`, KHÔNG tính `*.test.ts`), MỌI lời gọi
 * `<biến có tên chứa "zip">.file(...)` chỉ được phép có đối số là:
 *   (a) hằng chuỗi `"meta.json"` — manifest, ĐÚNG ở gốc gói theo chuẩn;
 *   (b) template/chuỗi bắt đầu bằng `images/` — đường ảnh DUY NHẤT;
 *   (c) một định danh mà CHÍNH tệp đó khởi tạo bằng (b)
 *       (VD `const imagePath = \`images/${fileName}\``) — cùng (b), chỉ đặt tên.
 * Hình dạng khác (điển hình `zip.file(fileName)` tên trần) ⇒ ĐỎ, nêu tệp:dòng.
 *
 * ── Vì sao quét trên CÂY (AST), không trên VĂN BẢN ─────────────────────────
 * Cùng bài học BG-16 mà `cuaIngestScan.ts` đã ghi: regex trên văn bản nguồn
 * không phân biệt được MÃ với CHÚ THÍCH — và chính các docblock của bản vá
 * BG-87 có chứa nguyên văn chuỗi `zip.file(fileName)` để giải thích cái ĐÃ BỎ.
 * Một cổng đỏ vì lời văn nói về chính nó là một cổng sẽ bị người sau tắt đi.
 * `ts.createSourceFile` bỏ chú thích theo cấu tạo, không cần bộ bóc tự viết.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const GOC_SERVER = path.resolve(__dirname, "..");

/** Liệt kê mọi `.ts` SẢN XUẤT dưới `server/` (bỏ `*.test.ts`, `*.d.ts`, node_modules/dist). */
function lietKeTepSanXuat(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === "dist") continue;
    const p = path.join(thuMuc, ten);
    if (statSync(p).isDirectory()) lietKeTepSanXuat(p, ra);
    else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

interface DiemTra {
  tep: string;
  dong: number;
  doiSo: string;
  hopLe: boolean;
}

/** Node này là một chuỗi/template BẮT ĐẦU bằng `images/`? */
function laDuongAnh(node: ts.Node): boolean {
  if (ts.isStringLiteralLike(node)) return node.text.startsWith("images/");
  if (ts.isTemplateExpression(node)) return node.head.text.startsWith("images/");
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text.startsWith("images/");
  return false;
}

/** Node này là hằng chuỗi `"meta.json"`? */
function laManifest(node: ts.Node): boolean {
  return ts.isStringLiteralLike(node) && node.text === "meta.json";
}

/**
 * Quét MỘT tệp: trả về mọi lời gọi `<zip>.file(<đối số>)`, kèm phán quyết hợp lệ.
 * Nhánh (c) — định danh — được giải quyết bằng cách tìm TRONG CÙNG TỆP một
 * `const/let/var <tên> = <đường ảnh>` (phạm vi tệp là đủ: cả bốn điểm gọi thật
 * đều khai biến ngay trên dòng gọi).
 */
function quetMotTep(duongDan: string): DiemTra[] {
  const nguon = readFileSync(duongDan, "utf8");
  if (!/\.file\s*\(/.test(nguon)) return [];
  const sf = ts.createSourceFile(duongDan, nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** Tên biến trong tệp này được khởi tạo bằng một đường `images/…`. */
  const bienDuongAnh = new Set<string>();
  const thu = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && laDuongAnh(n.initializer)) {
      bienDuongAnh.add(n.name.text);
    }
    ts.forEachChild(n, thu);
  };
  thu(sf);

  const ra: DiemTra[] = [];
  const di = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "file" &&
      n.arguments.length >= 1
    ) {
      // Chỉ đối tượng JSZip — nhận diện qua TÊN biến chứa "zip" (không bắt
      // `this.cfg.file()` của storeForward, cùng tên phương thức nhưng khác vật).
      const doiTuong = n.expression.expression;
      const tenDoiTuong = ts.isIdentifier(doiTuong)
        ? doiTuong.text
        : ts.isPropertyAccessExpression(doiTuong)
        ? doiTuong.name.text
        : "";
      if (!/zip/i.test(tenDoiTuong)) return ts.forEachChild(n, di);

      const arg = n.arguments[0];
      const hopLe =
        laManifest(arg) ||
        laDuongAnh(arg) ||
        (ts.isIdentifier(arg) && bienDuongAnh.has(arg.text));
      const dong = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      ra.push({
        tep: path.relative(GOC_SERVER, duongDan).replace(/\\/g, "/"),
        dong,
        doiSo: arg.getText(sf),
        hopLe,
      });
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

describe("I-3 — census toàn repo: MỘT đường dẫn duy nhất cho ảnh trong ZIP AOI", () => {
  const TEP = lietKeTepSanXuat(GOC_SERVER);
  const DIEM = TEP.flatMap(quetMotTep);

  it("census PHẢI quét được một tập tệp khác rỗng (chống xanh-vì-glob-rỗng)", () => {
    expect(
      TEP.length,
      "0 tệp quét được nghĩa là census này xanh vì KHÔNG ĐO GÌ — đúng lớp lỗi 'glob rỗng ⇒ vitest im lặng' " +
        "đã cắn dự án ở VRAM Pha 4",
    ).toBeGreaterThan(200);
  });

  it("census PHẢI nhìn thấy các điểm tra ảnh THẬT (chống bộ dò không khớp gì)", () => {
    const anh = DIEM.filter((d) => !/meta\.json/.test(d.doiSo));
    expect(
      anh.map((d) => `server/${d.tep}:${d.dong}`),
      "phải thấy ÍT NHẤT 4 điểm tra ẢNH (getOrExtractImage · bất biến 2 của commit · closure inline AI gate · " +
        "REST GET /api/aoi/image · worker embedding). Danh sách RỖNG nghĩa là bộ dò không khớp gì và cổng " +
        "dưới xanh RỖNG — nguy hiểm hơn đỏ.",
    ).toHaveLength(5);
  });

  it("★★★ 0 lời gọi `zip.file(<tên trần>)` trong toàn bộ mã sản xuất `server/**`", () => {
    const viPham = DIEM.filter((d) => !d.hopLe);
    expect(
      viPham.map((d) => `server/${d.tep}:${d.dong} → zip.file(${d.doiSo})`),
      "MỖI dòng dưới đây là một cửa THỨ HAI để tìm CÙNG một ảnh. Đường dẫn ảnh DUY NHẤT là `images/<fileName>` " +
        "(§3 chuẩn gói ảnh) và bất biến 2 ở `commit` đã cưỡng chế điều đó KHI GHI — đường ĐỌC không được rộng " +
        "hơn đường GHI. Sửa: bỏ nhánh fallback, để phép tra thất bại NÓI RA thay vì tự cứu.",
    ).toEqual([]);
  });
});
