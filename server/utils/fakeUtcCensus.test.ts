/**
 * BG-96 (Khối C, chốt) — census cấm công thức "fake-UTC" TÁI SINH trong mã sản xuất.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * BỐI CẢNH
 * ══════════════════════════════════════════════════════════════════════════════════
 * `d.getTime() - d.getTimezoneOffset() * 60000` từng là cách dự án "dịch" một mốc giờ
 * sang UTC — SAI, vì `getTimezoneOffset()` đọc TZ của PROCESS chạy Node, không phải TZ
 * nhà máy. Task 1 (BG-96 Task 1, `aedd3096`) đã bỏ phép dịch này khỏi MỌI đường ghi; Task
 * 2 (`86b0e889`/`118d5322`/`db10d08f`) đã chuyển 3 ổ đọc + bucketing sang UTC thật/
 * factory-TZ (`docGioTuongNhaMay`, `server/utils/factoryTime.ts`). Sau hai Task đó,
 * `server/**` KHÔNG còn công thức này ở bất kỳ dòng MÃ nào — cổng dưới đây KHOÁ trạng
 * thái đó VĨNH VIỄN: thêm lại công thức ở bất cứ đâu trong `server/**` (trừ *.test.ts)
 * là ĐỎ, không có ngân sách để lách.
 *
 * ── BẪY ĐÃ BIẾT: doc-comment TRÍCH NGUYÊN VĂN công thức đang bị khai tử ──────────────
 * Ba chú thích cutover của Task 1/2 (`factoryTime.ts`, `_core/index.ts`,
 * `externalInspectionApi.ts`) giải thích "trước đây dự án dùng
 * `d.getTime() - d.getTimezoneOffset()*60000`" LÀM VÍ DỤ cho thứ đã bị bỏ — chuỗi đó vẫn
 * NẰM NGUYÊN VĂN trong ba file. Quét thô (regex trên toàn văn bản) sẽ ĐỎ GIẢ trên chính
 * lời giải thích rằng công thức đã bị bỏ — một cổng như vậy chỉ dạy người ta xoá đúng câu
 * cảnh báo hữu ích. Census này BỎ QUA dòng comment (`//…`, khối `/* … *‍/` nhiều dòng)
 * trước khi so khớp — bắt chước cách `demChuoiTran()` ở
 * `client/src/lib/viStringCoverage.unit.test.ts` strip comment theo DÒNG, KHÔNG phải một
 * bộ phân tích cú pháp đầy đủ (đủ dùng: comment của dự án luôn ở đầu dòng sau khi trim).
 *
 * Fuse chống-vacuity dùng chuỗi mồi là DÒNG MÃ (không phải comment) — nếu chỉ bơm mồi vào
 * một dòng comment, một thước ĐANG BỊ HỎNG theo hướng "không strip comment nào cả" vẫn có
 * thể trông như đúng (bắt được mồi lẫn trong đống đỏ giả). Mồi phải là mã THẬT để phép thử
 * chỉ có một cách duy nhất đi qua: strip đúng comment CŨ và vẫn thấy mã MỚI.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Công thức fake-UTC bị khai tử. Đọc kỹ: đây LÀ đích canh, không phải chuỗi mồi.
 *
 * ★★★ Vòng sửa 9 (I-5.4, review lượt 9 §6-4) — bản gốc chỉ khớp `* 60000` (một số
 * nguyên); biến thể CÙNG NGHĨA, CÙNG DÒNG `* 60 * 1000` (vd
 * `d.getTimezoneOffset() * 60 * 1000`) tách phép nhân làm hai bước, tính ra ĐÚNG
 * 60000 nhưng lách qua bản gốc — census vẫn XANH trong khi công thức fake-UTC tái
 * sinh. Regex nay khớp CẢ HAI dạng cùng dòng. ⚠ Chưa đóng lớp "đa dòng / qua biến
 * trung gian" (`MS_PER_MIN`, `6e4`…) — ledger đã ghi nhận đó là BG-100, một lớp
 * lỗi KHÁC (cần theo dữ liệu qua biến, không phải một regex một dòng); vá ở đây
 * chỉ đóng đúng biến thể `* 60 * 1000` mà review lượt 9 đo được là MỘT DÒNG,
 * KHÔNG qua biến trung gian — cùng lớp với bản gốc `* 60000`.
 */
const RE_FAKE_UTC = /getTimezoneOffset\(\)\s*\*\s*(?:60000|60\s*\*\s*1000)/;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Xoá (các) đoạn `/* … *‍/` khỏi MỘT dòng, GIỮ mã trước/sau đoạn đó — kể cả khi dòng đang
 * tiếp nối một khối đã mở từ dòng TRƯỚC (`dangTrongKhoi=true`) và/hoặc có NHIỀU cặp
 * `/* … *‍/` trên CÙNG một dòng (lặp tới khi hết cặp).
 *
 * ⚠ FIX review 2026-09-03 (Important): bản đầu blank CẢ DÒNG bất cứ khi nào dòng (trimmed)
 * bắt đầu bằng `/*`, kể cả khi `*‍/` đóng NGAY trên dòng đó — mã đứng SAU `*‍/` (vd
 * `/* eslint-disable *‍/ const x = d.getTimezoneOffset() * 60000;`) bị xoá theo, không bao
 * giờ được quét. Hàm này thay bằng một vòng quét thật: chỉ mask đúng đoạn từ `/*` tới `*‍/`
 * gần nhất, phần còn lại của dòng (trước/giữa/sau) được GIỮ để so khớp tiếp.
 *
 * Nếu một khối MỞ mà KHÔNG đóng trên dòng đang xét, phần còn lại của dòng (không có mã ở
 * đó — nó vẫn đang ở trong khối) bị bỏ và trả `blockOpen=true` cho dòng kế — giữ NGUYÊN
 * hành vi trước đây cho trường hợp khối trải nhiều dòng.
 */
function boCacKhoiTrenDong(line: string, dangTrongKhoi: boolean): { text: string; blockOpen: boolean } {
  let s = line;
  let out = "";
  let inBlock = dangTrongKhoi;
  for (;;) {
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) return { text: out, blockOpen: true };
      s = s.slice(end + 2);
      inBlock = false;
      continue;
    }
    const open = s.indexOf("/*");
    if (open === -1) {
      out += s;
      return { text: out, blockOpen: false };
    }
    out += s.slice(0, open);
    s = s.slice(open + 2);
    inBlock = true;
  }
}

/**
 * Trả lại các dòng của file với dòng/đoạn COMMENT bị xoá trắng (giữ nguyên SỐ DÒNG để báo
 * lỗi trỏ đúng chỗ) — cùng thuật toán `demChuoiTran()` cho comment DÒNG (`//`, và dòng tiếp
 * nối bắt đầu bằng bare `*` trong khối `/** … *‍/`), cộng thêm `boCacKhoiTrenDong()` cho
 * comment KHỐI (`/* … *‍/`, có thể trải NHIỀU DÒNG HOẶC đóng ngay trên cùng một dòng — xem
 * docblock của hàm đó cho lý do cần tách riêng).
 */
function dongMaKhongComment(filePath: string): string[] {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const ln of lines) {
    const tr = ln.trim();
    if (inBlock) {
      const ket = boCacKhoiTrenDong(ln, true);
      inBlock = ket.blockOpen;
      out.push(ket.text);
      continue;
    }
    if (tr.startsWith("/*")) {
      const ket = boCacKhoiTrenDong(ln, false);
      inBlock = ket.blockOpen;
      out.push(ket.text);
      continue;
    }
    if (tr.startsWith("//") || tr.startsWith("*")) {
      out.push("");
      continue;
    }
    out.push(ln);
  }
  return out;
}

interface FakeUtcHit { file: string; line: number; text: string }

/** Quét `server/**\/*.ts` (trừ `*.test.ts`), bỏ qua comment, tìm công thức fake-UTC. */
function quetFakeUtc(goc: string = SERVER_ROOT): FakeUtcHit[] {
  const ket: FakeUtcHit[] = [];
  for (const file of walkTs(goc)) {
    const lines = dongMaKhongComment(file);
    lines.forEach((ln, i) => {
      if (RE_FAKE_UTC.test(ln)) {
        ket.push({
          file: relative(SERVER_ROOT, file).split("\\").join("/"),
          line: i + 1,
          text: ln.trim(),
        });
      }
    });
  }
  return ket;
}

// ══════════════════════════════════════════════════════════════════════════
// ★★★ Vòng sửa lượt 9, VÒNG 2 (I-5.4 residual) — CHUYỂN HẲN sang AST cho lớp
// "cùng dòng, qua biến thể LITERAL khác nhau" — `RE_FAKE_UTC` là một regex MỘT
// DÒNG, chỉ khớp ĐÚNG hai chuỗi ký tự đã liệt kê tay (`* 60000` / `* 60 * 1000`).
// Review lượt 9 vòng 2 đo được: `getTimezoneOffset() * 6e4`
// (ký hiệu khoa học) · `getTimezoneOffset() * 60_000` (dấu gạch dưới phân
// cách chữ số, ES2021) · `getTimezoneOffset() * (60*1000)` (ngoặc) ·
// `getTimezoneOffset() * 1000 * 60` (đảo thứ tự hai thừa số) — CÙNG NGHĨA
// (60000), CÙNG DÒNG, đều lách qua `RE_FAKE_UTC` vì không khớp CHUỖI KÝ TỰ
// đã liệt kê.
//
// Thay vì vá thêm regex (một cuộc rượt-đuổi vô tận — luôn còn MỘT dạng viết
// số khác), `quetFakeUtcAst` dưới đây ĐÁNH GIÁ SỐ HỌC: tìm mọi lời gọi
// `X.getTimezoneOffset()`, leo lên chuỗi BinaryExpression `*` (kể cả xuyên
// ngoặc) bao quanh lời gọi đó, rồi TÍNH TÍCH của mọi thừa số CÒN LẠI (coi
// chính lời gọi là thừa số trung lập `1`) — nếu tích đó bằng ĐÚNG `60000`,
// đây LÀ công thức fake-UTC, BẤT KỂ số đó được viết bằng ký hiệu nào
// (`60000`/`6e4`/`60_000`/`60*1000`/`1000*60`/`(60*1000)`…).
//
// ⚠ GIỚI HẠN CÓ CHỦ Ý (khác phạm vi, đã ghi sổ riêng — BG-100): thừa số đi
// qua BIẾN TRUNG GIAN có tên (`const MS_PER_MIN = 60000; … * MS_PER_MIN`)
// KHÔNG được đánh giá được (không phải một literal số) — ledger đã tách đây
// là "cần theo dữ liệu qua biến, một lớp lỗi KHÁC", KHÔNG thuộc phạm vi vá ở
// đây (chỉ đóng lớp "cùng dòng, LITERAL, không qua biến trung gian").
// ══════════════════════════════════════════════════════════════════════════

/** `text` của một `NumericLiteral` TypeScript → number (chịu được `6e4` VÀ dấu gạch dưới phân cách `60_000`). */
function soTuNumericLiteral(text: string): number {
  return Number(text.replace(/_/g, ""));
}

/**
 * Đánh giá TÍCH của một cây BinaryExpression `*` thuần LITERAL (xuyên
 * `ParenthesizedExpression`), coi node === `bietDanh` (lời gọi
 * `getTimezoneOffset()`) là thừa số TRUNG LẬP (`1`) — trả `null` nếu gặp bất
 * kỳ nhánh nào KHÔNG PHẢI numeric literal/`*`/ngoặc/chính `bietDanh` (biến
 * trung gian, phép toán khác… — ngoài phạm vi, xem docblock BG-100 ở trên).
 */
function tichBieuThucNhanLiteral(node: ts.Node, bietDanh: ts.CallExpression): number | null {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  if (n === bietDanh) return 1;
  if (ts.isNumericLiteral(n)) return soTuNumericLiteral(n.text);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
    const l = tichBieuThucNhanLiteral(n.left, bietDanh);
    const r = tichBieuThucNhanLiteral(n.right, bietDanh);
    if (l === null || r === null) return null;
    return l * r;
  }
  return null;
}

/** Leo lên `.parent` từ `call` xuyên mọi `ParenthesizedExpression`/BinaryExpression `*` bao quanh — trả GỐC của chuỗi nhân (có thể chính là `call` nếu không đứng trong phép nhân nào). */
function timGocChuoiNhan(call: ts.Node): ts.Node {
  let n: ts.Node = call;
  for (;;) {
    const p: ts.Node | undefined = n.parent;
    if (p === undefined) return n;
    if (ts.isParenthesizedExpression(p)) { n = p; continue; }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AsteriskToken) { n = p; continue; }
    return n;
  }
}

/**
 * Quét MỘT file (nguyên văn, comment KHÔNG cần strip tay — AST tự bỏ qua) —
 * trả một `FakeUtcHit` cho MỖI lời gọi `X.getTimezoneOffset()` mà chuỗi nhân
 * bao quanh nó (LITERAL thuần, xem giới hạn BG-100) tính ra ĐÚNG `60000`.
 */
function quetFakeUtcAstTuVanBan(relFile: string, source: string): FakeUtcHit[] {
  const ket: FakeUtcHit[] = [];
  const sf = ts.createSourceFile(relFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rawLines = source.split("\n");
  const di = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "getTimezoneOffset" &&
      n.arguments.length === 0
    ) {
      const goc = timGocChuoiNhan(n);
      if (goc !== n) {
        const tich = tichBieuThucNhanLiteral(goc, n);
        if (tich === 60000) {
          const dong = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          ket.push({ file: relFile, line: dong, text: (rawLines[dong - 1] ?? "").trim() });
        }
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ket;
}

/** Quét `server/**\/*.ts` (trừ `*.test.ts`) bằng AST — xem docblock nhóm ở trên. */
function quetFakeUtcAst(goc: string = SERVER_ROOT): FakeUtcHit[] {
  const ket: FakeUtcHit[] = [];
  for (const file of walkTs(goc)) {
    const rel = relative(SERVER_ROOT, file).split("\\").join("/");
    ket.push(...quetFakeUtcAstTuVanBan(rel, readFileSync(file, "utf8")));
  }
  return ket;
}

/** Hợp nhất thước DÒNG-THẲNG (regex, hai dạng đã biết) + thước AST (mọi dạng LITERAL) — khử trùng theo (file, dòng). Dùng cho mệnh đề BẤT BIẾN cuối cùng. */
function quetFakeUtcHopNhat(goc: string = SERVER_ROOT): FakeUtcHit[] {
  const ket = quetFakeUtc(goc);
  for (const h of quetFakeUtcAst(goc)) {
    if (!ket.some((g) => g.file === h.file && g.line === h.line)) ket.push(h);
  }
  return ket;
}

/** Ba file mang chú thích cutover trích NGUYÊN VĂN công thức cũ (xem docblock trên). */
const FILE_CO_COMMENT_BAY = [
  "utils/factoryTime.ts",
  "_core/index.ts",
  "routes/externalInspectionApi.ts",
];

describe("BG-96 — census cấm fake-UTC tái sinh (server/**, comment không tính)", () => {
  it("cầu chì 1: phép quét phải THẤY file thật — không thì đang canh tập rỗng", () => {
    expect(walkTs(SERVER_ROOT).length).toBeGreaterThan(500);
  });

  it("cầu chì 2 — bẫy đã biết PHẢI còn tồn tại (nếu không, ca dưới đây canh một bẫy ma)", () => {
    for (const rel of FILE_CO_COMMENT_BAY) {
      const raw = readFileSync(join(SERVER_ROOT, rel), "utf8");
      expect(
        RE_FAKE_UTC.test(raw),
        `${rel}: không còn chứa mẫu trong văn bản thô — bẫy đã biến mất, gỡ file này khỏi FILE_CO_COMMENT_BAY`,
      ).toBe(true);
    }
  });

  it("★★★ fuse chống-vacuity: mồi ở DÒNG MÃ (không phải comment) phải bị bắt", () => {
    const P = join(SERVER_ROOT, "utils", "__fakeUtcCensusProbe.tmp.ts");
    try {
      // Mồi PHẢI là mã thật, không phải comment — xem lý do ở docblock đầu file.
      writeFileSync(
        P,
        `export const moiFakeUtc = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000);\n`,
      );
      const bat = quetFakeUtc().filter((h) => h.file.endsWith("__fakeUtcCensusProbe.tmp.ts"));
      expect(bat.length, "thước KHÔNG bắt được mồi vừa bơm ⇒ nó đang mù, không phải sạch thật").toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ fuse hình dạng inline-block (review 2026-09-03): `/* … */ <mã>` CÙNG DÒNG phải bị bắt", () => {
    // Bản đầu của `dongMaKhongComment` blank CẢ DÒNG khi trimmed bắt đầu `/*` — kể cả khi
    // `*/` đóng NGAY trên dòng đó, xoá mất mã đứng sau. Chưa có dòng nào hình dạng này
    // trong server/** hôm nay, nhưng cổng tự nhận là BẤT BIẾN thì phải THẬT SỰ bắt được
    // hình dạng này, không chỉ "chưa gặp phải". Mồi: `/* mồi */ <mã chứa công thức>`.
    const P = join(SERVER_ROOT, "utils", "__fakeUtcCensusProbeInlineBlock.tmp.ts");
    try {
      writeFileSync(
        P,
        `/* eslint-disable */ export const moiFakeUtcInline = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000);\n`,
      );
      const bat = quetFakeUtc().filter((h) => h.file.endsWith("__fakeUtcCensusProbeInlineBlock.tmp.ts"));
      expect(
        bat.length,
        "thước blank CẢ DÒNG khi khối /* … */ đóng cùng dòng ⇒ bỏ lọt mã đứng sau */ (lỗ soundness)",
      ).toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ vòng sửa 9 (I-5.4): biến thể `* 60 * 1000` (tách phép nhân, CÙNG DÒNG, CÙNG NGHĨA 60000) phải bị bắt", () => {
    const P = join(SERVER_ROOT, "utils", "__fakeUtcCensusProbe60x1000.tmp.ts");
    try {
      writeFileSync(
        P,
        `export const moiFakeUtc60x1000 = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);\n`,
      );
      const bat = quetFakeUtc().filter((h) => h.file.endsWith("__fakeUtcCensusProbe60x1000.tmp.ts"));
      expect(
        bat.length,
        "bản GỐC chỉ khớp `* 60000` — `* 60 * 1000` cùng dòng lách qua, đúng lỗ I-5.4 review lượt 9",
      ).toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("ba file mang bẫy đã biết KHÔNG được tính là nợ (comment loại trừ đúng)", () => {
    const ket = quetFakeUtc();
    const trongBaFile = ket.filter((h) => FILE_CO_COMMENT_BAY.includes(h.file));
    if (trongBaFile.length) console.error("[BG-96] strip comment hỏng ở:", trongBaFile);
    expect(trongBaFile).toEqual([]);
  });

  it("★★★ BẤT BIẾN: 0 dòng MÃ chứa công thức fake-UTC trong toàn bộ server/** (regex, hai dạng đã biết)", () => {
    const ket = quetFakeUtc();
    if (ket.length) console.error("[BG-96] fake-UTC tái sinh ở:", ket);
    expect(ket).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ Vòng sửa lượt 9, VÒNG 2 (I-5.4 residual) — bốn phép thử dưới đây khoá
  // ĐÚNG bốn dạng review lượt 9 vòng 2 đo được là lách qua `RE_FAKE_UTC`:
  // `6e4` (khoa học) · `60_000` (gạch dưới) · `(60*1000)` (ngoặc) ·
  // `1000*60` (đảo thứ tự thừa số). Mỗi phép thử là MỘT ĐỘT BIẾN THẬT trên
  // đĩa TẠM (probe file, xoá ngay sau) — không mô phỏng trong bộ nhớ, vì mục
  // tiêu là chứng minh `quetFakeUtcAst`/`quetFakeUtcHopNhat` THẬT SỰ quét
  // được file trên đĩa, cùng khuôn các fuse chống-vacuity phía trên.
  // ══════════════════════════════════════════════════════════════════════════
  const CAC_DANG_LACH_QUA_REGEX: readonly { ten: string; bieuThuc: string }[] = [
    { ten: "khoa-hoc (6e4)", bieuThuc: "d.getTimezoneOffset() * 6e4" },
    { ten: "gach-duoi (60_000)", bieuThuc: "d.getTimezoneOffset() * 60_000" },
    { ten: "ngoac ((60*1000))", bieuThuc: "d.getTimezoneOffset() * (60*1000)" },
    { ten: "dao-thu-tu (1000*60)", bieuThuc: "d.getTimezoneOffset() * 1000 * 60" },
  ];

  for (const { ten, bieuThuc } of CAC_DANG_LACH_QUA_REGEX) {
    it(`★★★ ĐỘT BIẾN THẬT (I-5.4 residual): dạng "${ten}" lách qua regex CŨ, AST MỚI phải bắt (probe file thật, xoá sau)`, () => {
      const relProbe = `utils/__fakeUtcAstProbe_${ten.replace(/[^a-zA-Z0-9]/g, "")}.tmp.ts`;
      const P = join(SERVER_ROOT, relProbe);
      try {
        writeFileSync(P, `export const moiFakeUtcAst = (d: Date) => new Date(d.getTime() - ${bieuThuc});\n`);

        // Cầu chì: regex CŨ (quetFakeUtc) PHẢI MÙ dạng này — nếu nó tự bắt
        // được thì phép thử AST dưới đây không chứng minh được gì mới.
        const theoRegexCu = quetFakeUtc().filter((h) => h.file === relProbe);
        expect(theoRegexCu.length, `[cầu chì] regex CŨ phải MÙ dạng "${ten}" — nếu bắt được thì đây không phải một dạng lách`).toBe(0);

        // AST MỚI phải bắt được.
        const theoAst = quetFakeUtcAst().filter((h) => h.file === relProbe);
        expect(theoAst.length, `AST PHẢI bắt được dạng "${ten}" — đúng lỗ I-5.4 residual review lượt 9 vòng 2`).toBe(1);

        // Thước HỢP NHẤT (dùng cho BẤT BIẾN cuối cùng) cũng phải bắt được.
        const theoHopNhat = quetFakeUtcHopNhat().filter((h) => h.file === relProbe);
        expect(theoHopNhat.length).toBe(1);
      } finally {
        try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
      }
    });
  }

  it("fuse AST: `getTimezoneOffset() * 61` (KHÔNG bằng 60000) KHÔNG bị bắt oan — tránh dương tính giả trên phép nhân vô hại", () => {
    const relProbe = "utils/__fakeUtcAstProbeKhongLienQuan.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(P, `export const khongPhaiFakeUtc = (d: Date) => d.getTimezoneOffset() * 61;\n`);
      const bat = quetFakeUtcAst().filter((h) => h.file === relProbe);
      expect(bat.length, "61 ≠ 60000 — không phải công thức fake-UTC, không nên bị bắt").toBe(0);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse AST: `getTimezoneOffset()` KHÔNG nhân với gì cả (đọc trơn) KHÔNG bị bắt oan", () => {
    const relProbe = "utils/__fakeUtcAstProbeDocTron.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(P, `export const docTronOffset = (d: Date) => d.getTimezoneOffset();\n`);
      const bat = quetFakeUtcAst().filter((h) => h.file === relProbe);
      expect(bat.length, "đọc trơn getTimezoneOffset() (không nhân với gì) không phải công thức fake-UTC").toBe(0);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ BẤT BIẾN (HỢP NHẤT — I-5.4 residual): 0 dòng MÃ chứa công thức fake-UTC dưới BẤT KỲ dạng LITERAL nào trong toàn bộ server/**", () => {
    const ket = quetFakeUtcHopNhat();
    if (ket.length) console.error("[BG-96] fake-UTC tái sinh (hợp nhất regex+AST) ở:", ket);
    expect(ket).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════
// BG-99 (Khối C, Task 5) — census cấm chuỗi thời gian TRẦN của MÁY bị đọc bằng HAI luật
// khác nhau trong cùng một request.
// ══════════════════════════════════════════════════════════════════════════════════
/**
 * Chuỗi thời gian TRẦN của máy (không hậu tố múi giờ, mẫu thật
 * `"2026-08-18T09:30:00.150"`) từng bị đọc bằng HAI luật khác nhau trong cùng một
 * request: `docGioMay`/`mocDoTuChuoi` (trần = UTC) ở một số điểm vs `new Date(...)` thô
 * (trần = TZ hệ điều hành PROCESS — chính tội BG-96 bằng đường khác) ở các điểm còn
 * lại. Task 5 hợp nhất cả bốn file ingest về ĐÚNG MỘT luật (`docGioMay`,
 * `server/utils/factoryTime.ts`). Census này khoá trạng thái đó VĨNH VIỄN: một
 * `new Date(...)` CÓ ĐỐI SỐ, trên cùng dòng MÃ nhắc một trong ba trường máy khai
 * (`completedAt`/`startedAt`/`inspectionTime`), trong bất kỳ file ứng viên ingest
 * nào (vòng sửa 9 vòng 2 — QUÉT ĐỘNG `server/**`, không còn gắn tay bốn file cố
 * định, xem `timFileIngestBg99`/`laFileUngVienBg99` bên dưới) — là ĐỎ.
 *
 * ── VÌ SAO "CÓ ĐỐI SỐ" ─────────────────────────────────────────────────────────────
 * `new Date()` TRẦN (không đối số) không đọc bất kỳ chuỗi nào — nó là lối thoát AN TOÀN
 * `docGioMay(...) ?? new Date()` dùng ở khắp bốn file sau bản vá này. Một quét không
 * phân biệt sẽ đỏ GIẢ trên chính bản vá đúng.
 *
 * ── MIỄN TRỪ `bg99-ok:` ─────────────────────────────────────────────────────────────
 * Một số dòng khớp mẫu vì lý do KHÁC BG-99 (vd `inspection_packages.listPackages`:
 * `dateFrom`/`dateTo` là bộ lọc NGƯỜI VẬN HÀNH gõ trên UI, không phải chuỗi máy khai).
 * Dòng đó phải mang `bg99-ok: <lý do>` NGUYÊN VĂN trên CÙNG DÒNG để được miễn — không
 * phải dòng trên/dòng dưới, tránh miễn nhầm một dòng vi phạm THẬT đứng cạnh.
 *
 * ── ★★★ Vòng sửa lượt 9 (I-5.1, review lượt 9 §6-1) — MÙ ĐÚNG DÒNG NÓ SINH RA ĐỂ
 *    BẢO VỆ ─────────────────────────────────────────────────────────────────────────
 * Quét theo-dòng ở trên đòi `completedAt|startedAt|inspectionTime` xuất hiện TRÊN
 * CHÍNH DÒNG có `new Date(...)`. Một hàm HELPER cấp file với tham số đặt tên KHÁC
 * (vd `toDateOrUndefined(iso: string | undefined)`, thân hàm chỉ có `new Date(iso)`)
 * không hề nhắc ba từ khoá đó trên dòng của nó — dù MỌI lời gọi nó trong file đều
 * truyền `p.startedAt`/`c.completedAt`/… `quetBg99Ast` (bên dưới) đóng đúng lỗ này
 * bằng AST (`ts.createSourceFile`, cùng khuôn `cuaIngestScan.ts`): tìm mọi
 * `new Date(<định danh>)` mà định danh là THAM SỐ kiểu `string` của một hàm cấp
 * file có TÊN, rồi tra xem hàm đó có được GỌI ở đâu trong CÙNG file với một đối số
 * nhắc một trong ba từ khoá không — nếu có, dòng `new Date(...)` bên trong hàm đó
 * là ĐỎ, bất kể tên tham số. `quetBg99()` hợp nhất kết quả của cả hai thước (dòng-
 * thẳng + AST), khử trùng theo (file, dòng).
 */
/**
 * ★★★ Vòng sửa lượt 9, VÒNG 2 (I-5.1 residual) — TRƯỚC bản vá, danh sách BỐN
 * file ingest gắn TAY (đúng bốn file Task 5 vá) — một cửa ingest THỨ NĂM mọc
 * lên ở một file KHÁC bốn cái tên này (dù cùng đọc chuỗi thời gian máy trần
 * qua `new Date(...)`) SẼ VÔ HÌNH với census, đúng LỚP LỖI "thêm cửa mới CÂM"
 * mà chính census này tồn tại để chặn — chỉ khác là lần này ẩn sau MỘT DANH
 * SÁCH TĨNH thay vì một phạm vi thư mục hẹp (hình dạng I-5.2b/BG-98 đã vá).
 *
 * Thay bằng QUÉT ĐỘNG `server/**` (trừ `*.test.ts`): một file là ỨNG VIÊN
 * ingest nếu ĐỒNG THỜI (a) có ÍT NHẤT MỘT `new Date(<đối số>)` với đối số
 * THẬT (không trần — cùng vị từ `RE_NEW_DATE_CO_DOI_SO` mà thước dòng-thẳng ở
 * dưới đã dùng, coi là proxy "đọc một chuỗi", KHÔNG chạy type-checker đầy đủ
 * để xác nhận kiểu `string` CHÍNH XÁC — cùng mức "vị từ cú pháp, không phải
 * type-checker" mà `quetBg99AstTuVanBan`/`cuaIngestScan.ts` đã chấp nhận) VÀ
 * (b) có ÍT NHẤT MỘT dòng `import … from "..."` mà ĐƯỜNG DẪN chứa chữ
 * "ingest" hoặc "contracts" (không phân biệt hoa/thường — khớp cả
 * `../services/ingestCayKetQua` lẫn `../contracts/machineDataContractV2`,
 * ĐÚNG hai họ module mà bốn file Task 5 đều import ít nhất một, đo được
 * 2026-09-04).
 *
 * ⚠ ĐÂY LÀ BỘ LỌC ỨNG VIÊN (rộng, có chủ ý) — quyết định "ĐỎ hay không" vẫn
 * do `quetBg99`/`quetBg99Ast` (dòng-thẳng + AST theo lời gọi) làm, KHÔNG đổi;
 * bộ lọc này chỉ trả lời "file nào cần đưa vào quét", thay cho danh sách tĩnh.
 */
const RE_MODULE_INGEST_CONTRACTS = /ingest|contracts/i;
/** `new Date(` với đối số THẬT ngay sau — loại trừ `new Date()` trần (an toàn). */
const RE_NEW_DATE_CO_DOI_SO = /new Date\(\s*[^)\s]/;

function laFileUngVienBg99(noiDungKhongComment: string): boolean {
  if (!RE_NEW_DATE_CO_DOI_SO.test(noiDungKhongComment)) return false;
  const specifiers = [...noiDungKhongComment.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
  return specifiers.some((sp) => RE_MODULE_INGEST_CONTRACTS.test(sp));
}

/** Quét ĐỘNG toàn bộ `server/**` (qua `walkTs`, đã trừ `*.test.ts`) — trả đường dẫn TƯƠNG ĐỐI `SERVER_ROOT` của mọi file ứng viên (xem `laFileUngVienBg99`). */
function timFileIngestBg99(goc: string = SERVER_ROOT): string[] {
  const ra: string[] = [];
  for (const file of walkTs(goc)) {
    const lines = dongMaKhongComment(file);
    if (laFileUngVienBg99(lines.join("\n"))) {
      ra.push(relative(SERVER_ROOT, file).split("\\").join("/"));
    }
  }
  return ra.sort();
}

/** BỐN file Task 5 đã vá — giữ lại làm SỔ ĐỐI CHỨNG (không còn dùng để QUÉT — xem `timFileIngestBg99` ở trên). */
const BON_FILE_TASK5_DA_VA = [
  "routers/machineApiRouters.ts",
  "routers/aoiPackageRouter.ts",
  "db/inspection.ts",
  "services/ingestCayKetQua.ts",
];

/** Danh sách file THẬT SỰ được quét hôm nay — ĐỘNG, không còn gắn tay. */
const FILE_INGEST_BG99 = timFileIngestBg99();

/** Ba trường thời gian MÁY khai trên đường ingest (brief BG-99). */
const RE_TU_KHOA_MAY = /completedAt|startedAt|inspectionTime/;
/** Miễn trừ CÓ LÝ DO — phải nằm TRÊN CHÍNH DÒNG bị canh. */
const RE_MIEN_TRU_BG99 = /bg99-ok:/;

interface Bg99Hit { file: string; line: number; text: string }

/** Một hàm CẤP FILE có TÊN (function declaration, hoặc `const NAME = (...) => …`/`function(...)`). */
interface HamCapFileBg99 {
  readonly ten: string;
  readonly node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

function thuHamCapFileBg99(sf: ts.SourceFile): HamCapFileBg99[] {
  const ra: HamCapFileBg99[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) {
      ra.push({ ten: st.name.text, node: st });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer !== undefined &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          ra.push({ ten: d.name.text, node: d.initializer });
        }
      }
    }
  }
  return ra;
}

/** Hàm cấp file (function/arrow/function-expression) BAO QUANH GẦN NHẤT của `node` — đi ngược `.parent`. */
function timHamBaoQuanhGanNhatBg99(
  node: ts.Node,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  let n: ts.Node | undefined = node.parent;
  while (n !== undefined) {
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return n;
    n = n.parent;
  }
  return null;
}

/**
 * ★★★ Vòng sửa 9 (I-5.1) — quét AST một file NGUYÊN VĂN (không cần đọc đĩa, cho
 * phép lưới đột biến chạy trên một biến thể ĐÃ CHÈN đột biến hoàn toàn TRONG BỘ
 * NHỚ). Xem docblock ở trên cho thuật toán đầy đủ.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT (cùng lớp với `cuaIngestScan.ts`): chỉ theo được hàm CẤP FILE
 * CÓ TÊN — một arrow ẩn danh lồng trực tiếp (callback không tên) không tự đặt tên
 * thì KHÔNG resolve được "ai gọi nó" nên bị BỎ QUA (không flag, không phải xác nhận
 * sạch) — an toàn theo hướng ít dương tính giả hơn; hình dạng ẩn danh chưa xuất
 * hiện ở bốn file ingest hôm nay (đo được). Chỉ xử lý đối số là MỘT ĐỊNH DANH trực
 * tiếp (`new Date(iso)`) — biểu thức phức tạp hơn (`new Date(a.b)`, số học…) ngoài
 * phạm vi thước này (được thước dòng-thẳng ở trên phủ một phần qua từ khoá cùng dòng).
 */
function quetBg99AstTuVanBan(rel: string, raw: string): Bg99Hit[] {
  const ket: Bg99Hit[] = [];
  const sf = ts.createSourceFile(rel, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hams = thuHamCapFileBg99(sf);
  const tenNguoc = new Map<ts.Node, string>(hams.map((h) => [h.node, h.ten]));

  const diCacNewDate: ts.NewExpression[] = [];
  const di = (n: ts.Node): void => {
    if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Date" &&
      n.arguments !== undefined &&
      n.arguments.length === 1
    ) {
      diCacNewDate.push(n);
    }
    ts.forEachChild(n, di);
  };
  di(sf);

  const rawLines = raw.split("\n");
  for (const call of diCacNewDate) {
    const arg = call.arguments![0];
    if (!ts.isIdentifier(arg)) continue; // chỉ định danh trực tiếp — xem giới hạn ở docblock
    const ham = timHamBaoQuanhGanNhatBg99(call);
    if (ham === null) continue;
    const tenHam = tenNguoc.get(ham);
    if (tenHam === undefined) continue; // hàm ẩn danh/lồng — không resolve được người gọi

    const param = ham.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === arg.text);
    if (param === undefined || param.type === undefined) continue;
    const kieuVanBan = param.type.getText(sf);
    if (!/string/.test(kieuVanBan) || /\bDate\b/.test(kieuVanBan)) continue; // "không phải số/Date"

    // Có lời gọi NÀO tới `tenHam` trong CÙNG file mang một trong ba từ khoá không?
    let coLoiGoiKeyword = false;
    const diGoi = (n: ts.Node): void => {
      if (coLoiGoiKeyword) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === tenHam) {
        for (const a of n.arguments) {
          if (RE_TU_KHOA_MAY.test(a.getText(sf))) {
            coLoiGoiKeyword = true;
            break;
          }
        }
      }
      ts.forEachChild(n, diGoi);
    };
    diGoi(sf);
    if (!coLoiGoiKeyword) continue;

    const dong = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    const dongVanBan = rawLines[dong - 1] ?? "";
    if (RE_MIEN_TRU_BG99.test(dongVanBan)) continue;
    ket.push({ file: rel, line: dong, text: dongVanBan.trim() });
  }
  return ket;
}

function quetBg99Ast(relFiles: readonly string[], goc: string): Bg99Hit[] {
  const ket: Bg99Hit[] = [];
  for (const rel of relFiles) {
    const full = join(goc, rel);
    if (!existsSync(full)) continue;
    ket.push(...quetBg99AstTuVanBan(rel, readFileSync(full, "utf8")));
  }
  return ket;
}

/** Quét DANH SÁCH file tương đối `SERVER_ROOT` (mặc định bốn file ingest thật) — hợp nhất thước
 * dòng-thẳng (từ khoá cùng dòng) VÀ thước AST (theo lời gọi, vòng sửa 9/I-5.1), khử trùng theo
 * (file, dòng). */
function quetBg99(relFiles: readonly string[] = FILE_INGEST_BG99, goc: string = SERVER_ROOT): Bg99Hit[] {
  const ket: Bg99Hit[] = [];
  for (const rel of relFiles) {
    const full = join(goc, rel);
    if (!existsSync(full)) continue; // cầu chì 1 dưới đây canh việc file biến mất
    const lines = dongMaKhongComment(full);
    lines.forEach((ln, i) => {
      if (RE_NEW_DATE_CO_DOI_SO.test(ln) && RE_TU_KHOA_MAY.test(ln) && !RE_MIEN_TRU_BG99.test(ln)) {
        ket.push({ file: rel, line: i + 1, text: ln.trim() });
      }
    });
  }
  for (const h of quetBg99Ast(relFiles, goc)) {
    if (!ket.some((g) => g.file === h.file && g.line === h.line)) ket.push(h);
  }
  return ket;
}

describe("BG-99 — census cấm ĐỌC chuỗi thời gian MÁY bằng hai luật khác nhau (quét ĐỘNG server/**, không còn gắn tay 4 file)", () => {
  it("cầu chì 1: bộ quét ĐỘNG phải THẤY file thật — không thì đang canh tập rỗng", () => {
    expect(FILE_INGEST_BG99.length, "0 file ứng viên — laFileUngVienBg99/timFileIngestBg99 đang canh tập rỗng").toBeGreaterThan(0);
    for (const rel of FILE_INGEST_BG99) {
      expect(existsSync(join(SERVER_ROOT, rel)), `${rel} không tồn tại — bộ quét trả về đường dẫn hỏng`).toBe(true);
    }
  });

  // ★★★ Vòng sửa 9 vòng 2 (I-5.1 residual) — ĐO ĐƯỢC (2026-09-04): BA trong
  // BỐN file Task 5 gốc còn `new Date(<đối số>)` THẬT hôm nay —
  // `services/ingestCayKetQua.ts` đã di trú TRỌN VẸN, 0 lời gọi `new Date(`
  // nào còn sót trong CHÍNH file đó (dùng thẳng `docGioMay`/hàm khác) — tự
  // nhiên KHÔNG còn là ứng viên của điều kiện (a) (`new Date(đối số)`), ĐÚNG,
  // không phải một hồi quy. Danh sách dưới TÁCH riêng khỏi bốn file gốc để
  // không lẫn hai câu hỏi khác nhau: "còn new Date(...) THẬT không" (mục này)
  // vs "từng thuộc phạm vi Task 5" (`BON_FILE_TASK5_DA_VA`, sổ lịch sử).
  const BA_FILE_CON_NEW_DATE_THAT = BON_FILE_TASK5_DA_VA.filter((f) => f !== "services/ingestCayKetQua.ts");

  it("★★★ vòng sửa lượt 9 vòng 2 (I-5.1 residual): bộ quét ĐỘNG PHẢI vẫn thấy BA/BỐN file Task 5 gốc CÒN new Date(...) thật — không mất nợ cũ khi bỏ danh sách tĩnh", () => {
    for (const rel of BA_FILE_CON_NEW_DATE_THAT) {
      expect(
        FILE_INGEST_BG99.includes(rel),
        `${rel} (một trong ba file Task 5 gốc CÒN new Date(...) thật) KHÔNG còn xuất hiện trong bộ quét ĐỘNG — laFileUngVienBg99 đã đổi hành vi, kiểm lại điều kiện (a)/(b)`,
      ).toBe(true);
    }
    // Cầu chì đối chứng — xác nhận rớt khỏi danh sách vì ĐÃ DI TRÚ (0 new
    // Date(...) THẬT trong CHÍNH file), không phải bộ quét bị hỏng.
    expect(
      /new Date\(\s*[^)\s]/.test(readFileSync(join(SERVER_ROOT, "services/ingestCayKetQua.ts"), "utf8")),
      "cầu chì: services/ingestCayKetQua.ts phải THẬT SỰ 0 new Date(đối số) — nếu có, nó phải xuất hiện lại trong FILE_INGEST_BG99, kiểm lại bộ quét",
    ).toBe(false);
  });

  it("hôm nay (2026-09-04) bộ quét ĐỘNG mở rộng: BA file Task 5 gốc còn new Date(...) THẬT + BỐN cửa ứng viên MỚI đo được (đo được, không phải giả định) — 0 cửa nào biến mất mà KHÔNG lý do", () => {
    // Khai RÕ: đây là MỘT PHÉP ĐO tại một thời điểm, không phải một bất biến
    // cấu trúc — khác cầu chì trên (đòi ĐỦ ba file, mãi mãi đúng) và khác
    // BẤT BIẾN dưới (đòi 0 vi phạm THẬT, mãi mãi đúng). Nếu một cửa ứng viên
    // MỚI KHÁC xuất hiện sau này (đúng ý bản vá — bộ quét ĐỘNG phải THẤY nó),
    // ca này sẽ ĐỎ — đúng lúc đó đo lại, cập nhật danh sách, không phải dấu
    // hiệu hỏng. Bốn cửa MỚI ở đây ĐÃ xác nhận 0 vi phạm THẬT (xem BẤT BIẾN
    // dưới) — chúng hợp lệ đứng trong tập ỨNG VIÊN, không phải một lỗ mới.
    const BON_UNG_VIEN_MOI_DO_DUOC = [
      "_core/socket.ts",
      "services/inspection/inspectionStoreForward.ts",
      "services/mqttService.ts",
      "services/telemetryBus.ts",
    ];
    expect([...FILE_INGEST_BG99].sort()).toEqual(
      [...BA_FILE_CON_NEW_DATE_THAT, ...BON_UNG_VIEN_MOI_DO_DUOC].sort(),
    );
  });

  it("★★★ ĐỘT BIẾN THẬT (I-5.1 residual): một cửa ingest THỨ NĂM (import contracts + new Date(chuoi)) ở file MỚI ngoài bốn file gốc PHẢI được bộ quét ĐỘNG thấy (probe file thật, xoá sau)", () => {
    // Đặt probe NGOÀI bốn thư mục vòng sửa 9 gốc (vd `server/utils/`) — đúng
    // hình dạng "cửa ingest thứ năm mọc ở một TẦNG khác" mà danh sách tĩnh cũ
    // sẽ CÂM hoàn toàn (không đường nào để nó tự thêm vào FILE_INGEST_BG99).
    const relProbe = "utils/__bg99FileDiscoveryProbe.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        `import type { MachineDataContractV2 } from "../contracts/machineDataContractV2";\n` +
          `export const moiCuaThuNam = (p: { completedAt?: string }) => new Date(p.completedAt);\n`,
      );
      const ungVien = timFileIngestBg99();
      expect(
        ungVien.includes(relProbe),
        "cửa ingest MỚI (import contracts/ + new Date(chuỗi)) PHẢI được bộ quét ĐỘNG tự thấy — danh sách tĩnh cũ sẽ CÂM ở đây",
      ).toBe(true);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse: file có `new Date(chuỗi)` NHƯNG KHÔNG import ingest/contracts KHÔNG bị coi là ứng viên (tránh quét tràn lan mọi file dùng Date)", () => {
    const relProbe = "utils/__bg99FileDiscoveryProbeKhongLienQuan.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(P, `export const chiLaMotHamNgayThang = (s: string) => new Date(s);\n`);
      const ungVien = timFileIngestBg99();
      expect(ungVien.includes(relProbe), "file KHÔNG import ingest/contracts không phải một cửa ingest — không nên bị quét").toBe(false);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse: file import contracts NHƯNG 0 `new Date(...)` có đối số KHÔNG bị coi là ứng viên", () => {
    const relProbe = "utils/__bg99FileDiscoveryProbeKhongNewDate.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        `import type { MachineDataContractV2 } from "../contracts/machineDataContractV2";\n` +
          `export const khongDocGioNao = (p: MachineDataContractV2) => p;\n`,
      );
      const ungVien = timFileIngestBg99();
      expect(ungVien.includes(relProbe), "file KHÔNG có new Date(đối số) nào không đọc chuỗi thời gian nào — không nên bị quét").toBe(false);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ fuse chống-vacuity: mồi `new Date(x.completedAt)` ở DÒNG MÃ phải bị bắt", () => {
    const relProbe = "utils/__bg99CensusProbe.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        `export const moiBg99 = (x: { completedAt?: string }) => new Date(x.completedAt);\n`,
      );
      const bat = quetBg99([relProbe]);
      expect(bat.length, "thước KHÔNG bắt được mồi vừa bơm ⇒ nó đang mù, không phải sạch thật").toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse: `new Date()` TRẦN (không đối số — lối thoát `docGioMay(...) ?? new Date()`) KHÔNG bị bắt", () => {
    const relProbe = "utils/__bg99CensusProbeBareNewDate.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        `export const moiBg99Bare = (completedAt?: string) => new Date();\n`,
      );
      const bat = quetBg99([relProbe]);
      expect(
        bat.length,
        "new Date() trần không đọc chuỗi máy nào — bắt nó là đỏ GIẢ trên chính lối thoát an toàn",
      ).toBe(0);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse: dòng mang `bg99-ok: <lý do>` được MIỄN TRỪ đúng", () => {
    const relProbe = "utils/__bg99CensusProbeExempt.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        `export const moiBg99Exempt = (x: { completedAt?: string }) => new Date(x.completedAt); // bg99-ok: mo phong bo loc UI\n`,
      );
      const bat = quetBg99([relProbe]);
      expect(bat.length, "dòng có bg99-ok: kèm lý do phải được miễn trừ").toBe(0);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ vòng sửa 9 (I-5.1) — AST bắt được `new Date(iso)` khi tham số KHÔNG tên completedAt/startedAt/inspectionTime nhưng MỌI lời gọi hàm đều truyền một trong ba trường đó", () => {
    const relProbe = "utils/__bg99AstProbe.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        [
          "function toDateOrUndefinedMoPhong(iso: string | undefined): Date | undefined {",
          "  return iso === undefined ? undefined : new Date(iso);",
          "}",
          "export const dungThuBg99Ast = (p: { startedAt?: string }) => toDateOrUndefinedMoPhong(p.startedAt);",
          "",
        ].join("\n"),
      );
      const bat = quetBg99([relProbe]);
      expect(
        bat.length,
        "thước theo-dòng-cùng-từ-khoá KHÔNG thấy hình dạng này (tham số tên `iso`, không phải completedAt/startedAt/inspectionTime) — thước AST phải bắt được bằng cách theo lời gọi",
      ).toBe(1);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("fuse AST: hàm CÙNG hình dạng (tham số string, `new Date(param)`) nhưng KHÔNG hề được gọi với từ khoá nào — KHÔNG bị bắt", () => {
    const relProbe = "utils/__bg99AstProbeKhongLienQuan.tmp.ts";
    const P = join(SERVER_ROOT, relProbe);
    try {
      writeFileSync(
        P,
        [
          "function chuyenChuoiKhongLienQuanBg99(s: string | undefined): Date | undefined {",
          "  return s === undefined ? undefined : new Date(s);",
          "}",
          "export const dungThuKhongLienQuan = (x: { label?: string }) => chuyenChuoiKhongLienQuanBg99(x.label);",
          "",
        ].join("\n"),
      );
      const bat = quetBg99([relProbe]);
      expect(
        bat.length,
        "hàm này không hề được gọi với completedAt/startedAt/inspectionTime — không phải hình dạng BG-99, không nên đỏ (tránh dương tính giả tràn lan)",
      ).toBe(0);
    } finally {
      try { unlinkSync(P); } catch { /* đã xoá, hoặc chưa kịp tạo */ }
    }
  });

  it("★★★ ĐỘT BIẾN THẬT (I-5.1, review lượt 9 §6-1): inspection.ts quay lại `new Date(iso)` trong toDateOrUndefined ⇒ census AST PHẢI bắt (không chạm đĩa)", () => {
    const rel = "db/inspection.ts";
    const goc = readFileSync(join(SERVER_ROOT, rel), "utf8");
    const DONG_GOC = "  return iso === undefined ? undefined : docGioMay(iso) ?? undefined;";
    expect(
      goc.includes(DONG_GOC),
      "không tìm thấy thân toDateOrUndefined ĐÃ VÁ (BG-99 Task 5) — bộ suy đã đổi neo?",
    ).toBe(true);

    const DONG_DOT_BIEN = "  return iso === undefined ? undefined : new Date(iso);";
    const maDotBien = goc.replace(DONG_GOC, DONG_DOT_BIEN);
    expect(maDotBien).not.toBe(goc);

    const bat = quetBg99AstTuVanBan(rel, maDotBien);
    expect(
      bat.length,
      "đột biến quay lại new Date(iso) thô trong toDateOrUndefined PHẢI bị census AST bắt — tham số tên `iso`, không khớp từ khoá cùng dòng, chỉ AST-theo-lời-gọi mới thấy được (đúng lỗ §6-1 review lượt 9: 'census mù đúng dòng nó sinh ra để bảo vệ')",
    ).toBeGreaterThan(0);

    // Đột biến chỉ sống trong biến `maDotBien` — chưa từng `writeFileSync`.
    const docLai = readFileSync(join(SERVER_ROOT, rel), "utf8");
    expect(docLai).toBe(goc);
  });

  it("★★★ BẤT BIẾN: 0 dòng MÃ đọc chuỗi thời gian MÁY bằng `new Date(...)` thô trong TOÀN BỘ file ứng viên (quét ĐỘNG, không còn gắn tay 4 file)", () => {
    const ket = quetBg99(); // mặc định relFiles=FILE_INGEST_BG99 — danh sách ĐỘNG hôm nay (7 file, xem cầu chì/mô tả ở trên).
    if (ket.length) console.error("[BG-99] đọc chuỗi thời gian máy KHÔNG qua docGioMay ở:", ket);
    expect(ket).toEqual([]);
  });
});
