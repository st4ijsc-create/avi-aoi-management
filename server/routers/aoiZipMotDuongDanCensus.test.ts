/**
 * I-3 (review lượt 8, đóng nốt ở vòng 9) — CENSUS TOÀN REPO cho bất biến
 * "MỘT đường dẫn, MỘT chỗ tìm" khi ĐỌC ảnh trong gói ZIP AOI.
 *
 * ── Vì sao census, không phải thêm một ca test nữa ─────────────────────────
 * BG-87 (`cc322bca`) khai đã bỏ fallback tên trần `zip.file(fileName)` ở BA
 * chỗ. Review lượt 8 tìm ra chỗ thứ TƯ (`aoiImageEmbeddingWorker.ts`) — cùng
 * ZIP, cùng phép tra tệp, chỉ khác tệp nguồn. Lưới BG-87 mệnh đề 4 phủ 1/4 chỗ
 * (tRPC `getImage`) nên nó KHÔNG THỂ bắt ba chỗ kia: nó canh một ĐIỂM, còn cái
 * phải canh là một BẤT BIẾN. Đúng lớp lỗi L-1 ("lưới theo DANH SÁCH, không theo
 * ∀") — không có census này, chỗ thứ NĂM sẽ xuất hiện và cũng sẽ không ai thấy.
 *
 * ── ⛔ VÒNG 9: CHÍNH CENSUS NÀY TỪNG MÙ THEO CẤU TẠO (I-3 còn nửa) ─────────
 * Bản đầu của census xanh trong khi chỗ thứ **NĂM** và **SÁU** đã có sẵn:
 *   `scripts/ai/backfill-ai-data.mjs`      → `zip.file(mp.fileName)`
 *   `scripts/ai-kb/reembed-images-onnx.mjs` → `zip.file(fileName)`
 * Cả hai ghi `ai_image_embeddings` THẬT. Census mù chúng vì HAI ràng buộc CẤU
 * TẠO của chính nó — không phải vì thiếu một mục trong danh sách:
 *   1. `lietKeTepSanXuat(GOC_SERVER)` — phạm vi chỉ `server/**`, chỉ `.ts` ⇒
 *      `.mjs` dưới `scripts/` KHÔNG BAO GIỜ được quét.
 *   2. `if (!/zip/i.test(tenDoiTuong)) return` — nhận diện JSZip bằng TÊN BIẾN
 *      ⇒ một đối tượng JSZip đặt tên `goi`/`pkg` thoát hoàn toàn.
 * ⇒ Đây LÀ L-1 lần nữa, lần này ở chính thiết bị đo. Bản này nới cả hai:
 *   · Phạm vi: TOÀN REPO, mọi `.ts/.tsx/.mts/.cts/.js/.mjs/.cjs` — trừ đúng
 *     những thư mục KHÔNG PHẢI mã nguồn của dự án (xem `THU_MUC_BO_QUA`, mỗi
 *     mục kèm lý do). Không có danh sách "thư mục cần quét".
 *   · Nhận diện JSZip theo IMPORT + CÁCH KHỞI TẠO (`new JSZip()`,
 *     `JSZip.loadAsync()`, `.folder()` của một zip đã biết, gán lại biến), HỢP
 *     với heuristic tên cũ — nên đổi tên biến KHÔNG còn làm census mù. §5 chứng
 *     minh bằng nguồn tổng hợp đặt tên biến là `goi`.
 *
 * ── Bất biến được cưỡng chế ────────────────────────────────────────────────
 * Trong MÃ SẢN XUẤT (không tính `*.test.ts`), MỌI **phép TRA** trên một đối
 * tượng JSZip — `<zip>.file(<đối số>)` với ĐÚNG MỘT đối số — chỉ được phép có
 * đối số là:
 *   (a) hằng chuỗi `"meta.json"` — manifest, ĐÚNG ở gốc gói theo chuẩn;
 *   (b) template/chuỗi bắt đầu bằng `images/` — đường ảnh DUY NHẤT;
 *   (c) một định danh mà CHÍNH tệp đó khởi tạo bằng (b).
 * Hình dạng khác (điển hình `zip.file(fileName)` tên trần) ⇒ ĐỎ, nêu tệp:dòng.
 *
 * ⚠ `zip.file(<tên>, <nội dung>[, <opts>])` — HAI đối số trở lên — là phép GHI,
 * KHÔNG phải phép tra, và KHÔNG thuộc bất biến này (đường GHI có bất biến 2 của
 * `commit` cưỡng chế riêng). Không loại nó ra thì census sẽ đỏ vì mọi đoạn mã
 * DỰNG ZIP (`imgFolder.file(name, buffer)` trong script kiểm thử, `folder?.file
 * (filename, blob)` của `BatchImageExport.tsx`) — tức đỏ vì một bất biến khác.
 * §4 ghim ranh giới này bằng nguồn tổng hợp.
 *
 * ── Vì sao quét trên CÂY (AST), không trên VĂN BẢN ─────────────────────────
 * Cùng bài học BG-16 mà `cuaIngestScan.ts` đã ghi: regex trên văn bản nguồn
 * không phân biệt được MÃ với CHÚ THÍCH — và chính các docblock của bản vá
 * BG-87 (và docblock NÀY) có chứa nguyên văn chuỗi `zip.file(fileName)` để giải
 * thích cái ĐÃ BỎ. Một cổng đỏ vì lời văn nói về chính nó là một cổng sẽ bị
 * người sau tắt đi. `ts.createSourceFile` bỏ chú thích theo cấu tạo.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const GOC_REPO = path.resolve(__dirname, "..", "..");

/**
 * Thư mục KHÔNG quét — mỗi mục là "không phải mã nguồn của dự án", không phải
 * "chỗ ta chưa muốn nhìn". Đây là điều kiện để census còn là ∀ chứ không thành
 * một danh sách trắng.
 */
const THU_MUC_BO_QUA = new Set([
  "node_modules",   // phụ thuộc bên thứ ba
  ".git",
  "dist",           // sản phẩm build (bản sao đã bundle của chính mã đang quét)
  "dist-secure",    // nt.
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "uploads",        // dữ liệu chạy
  "data",           // dữ liệu chạy (WAL store-forward THẬT)
  "knowledge",      // chỉ mục sinh tự động
]);

const DUOI_MA_NGUON = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** Liệt kê mọi tệp MÃ NGUỒN SẢN XUẤT trong repo (bỏ `*.test.*`, `*.d.ts`). */
function lietKeTepSanXuat(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (THU_MUC_BO_QUA.has(ten) || ten.startsWith(".tmp")) continue;
    const p = path.join(thuMuc, ten);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // symlink gãy / tệp biến mất giữa chừng — không được làm census sập
    }
    if (st.isDirectory()) {
      lietKeTepSanXuat(p, ra);
      continue;
    }
    const duoi = path.extname(ten);
    if (!DUOI_MA_NGUON.has(duoi)) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(ten)) continue;
    if (ten.endsWith(".d.ts")) continue;
    // Tệp > 1 MiB không phải mã người viết (bundle/minified/sinh tự động). Bỏ
    // qua CÓ LÝ DO chứ không phải cho nhanh: 2 737 tệp của repo cộng lại 292 MB,
    // và phần khổng lồ đó nằm ở vài bundle — đọc chúng làm census chậm 45s mà
    // không thêm một điểm tra ảnh nào. §"nhìn thấy điểm THẬT" ở dưới là cầu chì:
    // nếu ngưỡng này có ngày nuốt mất một tệp thật, ca đó đỏ trước.
    if (st.size > 1024 * 1024) continue;
    ra.push(p);
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

/** Biểu thức này là `import("jszip")` / `require("jszip")` (kể cả `.default` bọc ngoài)? */
function laNguonJSZip(n: ts.Node): boolean {
  return /\bjszip\b/i.test(n.getText());
}

/**
 * Quét MỘT nguồn: trả về mọi PHÉP TRA `<jszip>.file(<đối số>)` (đúng 1 đối số),
 * kèm phán quyết hợp lệ. Tách khỏi I/O để §4/§5 đo được bộ dò trên nguồn tổng
 * hợp — thiết bị đo phải tự chứng minh được là nó KHÔNG mù.
 */
export function quetNguon(duongDanHienThi: string, nguon: string, kieu: ts.ScriptKind): DiemTra[] {
  // Tiền lọc THEO CẤU TẠO (không phải danh sách tệp): một tệp không hề nhắc tới
  // JSZip thì không thể có đối tượng JSZip nào trong nó.
  if (!/jszip/i.test(nguon) || !/\.file\s*\(/.test(nguon)) return [];
  const sf = ts.createSourceFile(duongDanHienThi, nguon, ts.ScriptTarget.Latest, true, kieu);

  /** Tên biến đang giữ MỘT ĐỐI TƯỢNG JSZip — nhận từ import + cách khởi tạo. */
  const bienJSZip = new Set<string>();
  /** Tên định danh trỏ tới CHÍNH module/lớp JSZip (`import JSZip from "jszip"`, …). */
  const tenLopJSZip = new Set<string>();
  /** Tên biến được khởi tạo bằng một đường `images/…` — nhánh (c). */
  const bienDuongAnh = new Set<string>();

  const laBieuThucTaoZip = (init: ts.Expression | undefined): boolean => {
    if (!init) return false;
    let e: ts.Expression = init;
    while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    // `new JSZip()` / `new (await import("jszip")).default()`
    if (ts.isNewExpression(e)) {
      const t = e.expression.getText(sf);
      return tenLopJSZip.has(t) || laNguonJSZip(e.expression);
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const ten = e.expression.name.text;
      const chu = e.expression.expression.getText(sf);
      // `JSZip.loadAsync(...)` — cửa vào DUY NHẤT để ĐỌC một ZIP có sẵn.
      if (ten === "loadAsync" && (tenLopJSZip.has(chu) || laNguonJSZip(e.expression.expression))) return true;
      // `<zip đã biết>.folder(...)` — trả về một đối tượng JSZip khác.
      if (ten === "folder" && bienJSZip.has(chu)) return true;
    }
    // `(await import("jszip")).default`
    if (ts.isPropertyAccessExpression(e) && laNguonJSZip(e.expression)) return false;
    return false;
  };

  // Lượt 1 — thu tên lớp JSZip (import/require) và tên biến đường ảnh.
  const luot1 = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /^jszip$/i.test(n.moduleSpecifier.text)) {
      const b = n.importClause;
      if (b?.name) tenLopJSZip.add(b.name.text);
      if (b?.namedBindings && ts.isNamespaceImport(b.namedBindings)) tenLopJSZip.add(b.namedBindings.name.text);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      // `const JSZip = (await import("jszip")).default;` / `= require("jszip")`
      if (n.initializer && laNguonJSZip(n.initializer)) tenLopJSZip.add(n.name.text);
      if (n.initializer && laDuongAnh(n.initializer)) bienDuongAnh.add(n.name.text);
    }
    ts.forEachChild(n, luot1);
  };
  luot1(sf);

  // Lượt 2 — thu tên biến giữ đối tượng JSZip (khai báo + gán lại). Lặp tới khi
  // ổn định: `zip = await JSZip.loadAsync(...)` có thể nằm SAU chỗ dùng
  // `zipCache.get()`, và `.folder()` dây chuyền cần biết biến trước đó.
  let doi = true;
  while (doi) {
    doi = false;
    const luot2 = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && laBieuThucTaoZip(n.initializer)) {
        if (!bienJSZip.has(n.name.text)) { bienJSZip.add(n.name.text); doi = true; }
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        laBieuThucTaoZip(n.right)
      ) {
        if (!bienJSZip.has(n.left.text)) { bienJSZip.add(n.left.text); doi = true; }
      }
      ts.forEachChild(n, luot2);
    };
    luot2(sf);
  }

  const ra: DiemTra[] = [];
  const di = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "file" &&
      // ĐÚNG MỘT đối số = phép TRA. Hai trở lên = phép GHI, bất biến khác.
      n.arguments.length === 1
    ) {
      const doiTuong = n.expression.expression;
      const tenDoiTuong = ts.isIdentifier(doiTuong)
        ? doiTuong.text
        : ts.isPropertyAccessExpression(doiTuong)
        ? doiTuong.name.text
        : "";
      // Nhận diện JSZip theo KHỞI TẠO (chính) HỢP với heuristic tên cũ (giữ lại
      // để không mất vùng phủ khi đối tượng đến từ tham số hàm/`Map.get()`).
      const laZip = bienJSZip.has(tenDoiTuong) || /zip/i.test(tenDoiTuong);
      if (!laZip) return ts.forEachChild(n, di);

      const arg = n.arguments[0];
      const hopLe = laManifest(arg) || laDuongAnh(arg) || (ts.isIdentifier(arg) && bienDuongAnh.has(arg.text));
      const dong = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      ra.push({ tep: duongDanHienThi, dong, doiSo: arg.getText(sf), hopLe });
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

function kieuTheoDuoi(p: string): ts.ScriptKind {
  const d = path.extname(p);
  if (d === ".tsx") return ts.ScriptKind.TSX;
  if (d === ".jsx") return ts.ScriptKind.JSX;
  if (d === ".js" || d === ".mjs" || d === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function quetMotTep(duongDan: string): DiemTra[] {
  const hienThi = path.relative(GOC_REPO, duongDan).replace(/\\/g, "/");
  return quetNguon(hienThi, readFileSync(duongDan, "utf8"), kieuTheoDuoi(duongDan));
}

describe("I-3 — census TOÀN REPO: MỘT đường dẫn duy nhất cho ảnh trong ZIP AOI", () => {
  const TEP = lietKeTepSanXuat(GOC_REPO);
  const DIEM = TEP.flatMap(quetMotTep);

  it("census PHẢI quét được một tập tệp khác rỗng (chống xanh-vì-glob-rỗng)", () => {
    expect(
      TEP.length,
      "0 tệp quét được nghĩa là census này xanh vì KHÔNG ĐO GÌ — đúng lớp lỗi 'glob rỗng ⇒ vitest im lặng' " +
        "đã cắn dự án ở VRAM Pha 4",
    ).toBeGreaterThan(800);
  });

  it("★★★ phạm vi PHẢI vượt khỏi `server/**` và khỏi `.ts` — hai ràng buộc từng làm census MÙ chỗ thứ 5/6", () => {
    expect(
      existsSync(path.join(GOC_REPO, "scripts", "ai", "backfill-ai-data.mjs")),
      "tệp mốc phải còn tồn tại — nếu nó bị đổi tên, ca này phải đỏ chứ không được im lặng bỏ qua",
    ).toBe(true);
    const duoi = new Set(TEP.map((t) => path.extname(t)));
    expect(duoi.has(".mjs"), "census phải quét cả `.mjs` (chỗ thứ 5 và 6 đều là `.mjs`)").toBe(true);
    const ngoaiServer = TEP.filter((t) => !path.relative(GOC_REPO, t).replace(/\\/g, "/").startsWith("server/"));
    expect(ngoaiServer.length, "census phải quét cả ngoài `server/**`").toBeGreaterThan(100);
    expect(
      TEP.some((t) => t.replace(/\\/g, "/").endsWith("scripts/ai/backfill-ai-data.mjs")),
      "và cụ thể phải quét TỚI tệp mốc — không chỉ 'có quét .mjs ở đâu đó'",
    ).toBe(true);
  });

  it("census PHẢI nhìn thấy các điểm tra ảnh THẬT (chống bộ dò không khớp gì)", () => {
    const anh = DIEM.filter((d) => !/meta\.json/.test(d.doiSo));
    const ten = anh.map((d) => `${d.tep}:${d.dong}`);
    expect(
      ten,
      "phải thấy ĐÚNG 7 điểm tra ẢNH: 5 trong `server/**` (getOrExtractImage · bất biến 2 của commit · closure " +
        "inline AI gate · REST GET /api/aoi/image · worker embedding) + 2 trong `scripts/**` (backfill · reembed). " +
        "Danh sách RỖNG nghĩa là bộ dò không khớp gì và cổng dưới xanh RỖNG — nguy hiểm hơn đỏ.",
    ).toHaveLength(7);
    for (const moc of ["scripts/ai/backfill-ai-data.mjs", "scripts/ai-kb/reembed-images-onnx.mjs"]) {
      expect(anh.some((d) => d.tep === moc), `census phải THẤY điểm tra ảnh trong ${moc}`).toBe(true);
    }
  });

  it("§4 ranh giới GHI/TRA — `zip.file(name, content)` (2 đối số) KHÔNG thuộc bất biến này", () => {
    const nguon = `
      import JSZip from "jszip";
      const zip = new JSZip();
      zip.file("images/a.png", buf);
      zip.file(tenTran, buf);
      const f = zip.file(tenTran);
    `;
    const diem = quetNguon("tong-hop-ghi.ts", nguon, ts.ScriptKind.TS);
    expect(diem, "chỉ lời gọi 1-đối-số mới là phép TRA").toHaveLength(1);
    expect(diem[0].hopLe, "và phép tra tên trần đó PHẢI bị bắt").toBe(false);
  });

  it("★★★ §5 ĐỘT BIẾN — đổi tên biến JSZip thành `goi` KHÔNG được làm census mù (bản cũ mù ca này)", () => {
    const nguon = `
      import JSZip from "jszip";
      async function doc(buf, fileName) {
        const goi = await JSZip.loadAsync(buf);
        return goi.file(fileName);
      }
    `;
    const diem = quetNguon("tong-hop-doi-ten.ts", nguon, ts.ScriptKind.TS);
    expect(
      diem.map((d) => `${d.tep}:${d.dong} → ${d.doiSo}`),
      "nhận diện JSZip phải theo IMPORT + KHỞI TẠO, không theo tên biến — nếu không, đổi tên là mở lại lỗ",
    ).toHaveLength(1);
    expect(diem[0].hopLe).toBe(false);
  });

  it("§6 ĐỐI CHỨNG DƯƠNG tổng hợp — ba hình dạng HỢP LỆ không bị bắt oan", () => {
    const nguon = `
      import JSZip from "jszip";
      async function doc(buf, fileName) {
        const goi = await JSZip.loadAsync(buf);
        const duongAnh = \`images/\${fileName}\`;
        return [goi.file("meta.json"), goi.file(\`images/\${fileName}\`), goi.file(duongAnh)];
      }
    `;
    const diem = quetNguon("tong-hop-hop-le.ts", nguon, ts.ScriptKind.TS);
    expect(diem).toHaveLength(3);
    expect(diem.filter((d) => !d.hopLe), "cả ba nhánh (a)/(b)/(c) đều phải được chấp nhận").toEqual([]);
  });

  it("★★★ 0 phép tra `zip.file(<tên trần>)` trong TOÀN BỘ mã sản xuất của repo", () => {
    const viPham = DIEM.filter((d) => !d.hopLe);
    expect(
      viPham.map((d) => `${d.tep}:${d.dong} → zip.file(${d.doiSo})`),
      "MỖI dòng dưới đây là một cửa THỨ HAI để tìm CÙNG một ảnh. Đường dẫn ảnh DUY NHẤT là `images/<fileName>` " +
        "(§3 chuẩn gói ảnh) và bất biến 2 ở `commit` đã cưỡng chế điều đó KHI GHI — đường ĐỌC không được rộng " +
        "hơn đường GHI. Sửa: bỏ nhánh fallback, để phép tra thất bại NÓI RA thay vì tự cứu.",
    ).toEqual([]);
  });
});
