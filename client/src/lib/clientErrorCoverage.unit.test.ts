/**
 * Sprint 5 doc 71 Task 7 (F1 phần A) — CỔNG CHẶN HỒI QUY phía CLIENT.
 *
 * Cùng khuôn với server/routers/appErrorCoverage.test.ts (Task 4-8): đếm số "site"
 * `onError` (mỗi chỗ nối vào một `useMutation`/`useQuery` trong client/src và
 * shared/) còn hiện message THÔ — CHƯA đi qua mapTrpcError()/toastTrpcError()
 * (client/src/lib/trpcErrors.ts) — và so với một ngân sách GIẢM DẦN. Mỗi đợt di
 * trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ trang mới không thể lặng lẽ thêm nợ.
 * Sạch hoàn toàn khi hằng số về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy: bạn
 * vừa thêm một chỗ hiện `err.message` tiếng Anh thô cho người dùng Việt Nam. Dùng
 * `toastTrpcError(err)` (khi chỉ hiện toast) hoặc `mapTrpcError(err)` (khi cần
 * chuỗi để ghép vào chỗ khác — vd `description:` của toast có tiêu đề riêng).
 *
 * ── LỊCH SỬ: TỪ QUÉT VĂN BẢN SANG AST (review round 3) ─────────────────────────
 * Round 1 (đếm bằng cân bằng ngoặc + tra cứu định nghĩa dùng chung trong cùng
 * file — vì `onError` ở client thường KHÔNG viết nội tuyến mà tham chiếu một hàm
 * đặt tên khác, khác cổng server chỉ cần `grep -c "new TRPCError("`) → phát hiện
 * 3 dạng tham chiếu không giải được (import xuyên file / useMemo / factory-call)
 * bị `continue` lặng lẽ, vá bằng bucket `unresolved` riêng.
 * Round 2 → phát hiện 3 lối thoát im lặng KHÁC (object-spread từ `shared/` chưa
 * quét / khoá dạng chuỗi-tính-toán rơi vào nhánh else / các dạng JSX·type-sig·
 * property-read cần loại trừ có căn cứ) — vá bằng cách quét thêm `shared/` +
 * nhận diện thêm các dạng khoá + đẩy nhánh else-cuối vào unresolved. TRONG LÚC
 * vá, tự phát hiện thêm 2 bug do CHÍNH cơ chế loại trừ gây ra (cửa sổ 20-ký-tự
 * cắt ngang dòng ăn nhầm dấu chấm cuối câu của comment dòng trước; bộ dò comment
 * khối kiểu `lastIndexOf` bị chính fixture của tôi lừa vì text "@shared/*" chứa
 * gạch-chéo-sao liền nhau).
 * Round 3 → phát hiện: `computeCommentRanges()` (round 2) không hiểu REGEX
 * LITERAL — mẫu ký tự-lớp như `/[\\/*?[\]:]/g` (ThẬT tại
 * client/src/components/ReportExportButton.tsx:592, lọc ký-tự-không-hợp-lệ cho
 * tên sheet Excel) chứa gạch-chéo rồi sao liền nhau, bị hiểu là MỞ comment khối;
 * không có "đóng" thật → "comment" nuốt TỚI HẾT FILE, mọi onError phía sau biến
 * mất — không đỏ, không vào `unresolved`.
 *
 * BA VÒNG liền là CÙNG MỘT LỚP LỖI: bài toán "đâu là comment/chuỗi/regex" là bài
 * toán CỦA TRÌNH BIÊN DỊCH, tự viết lại bằng quét ký tự luôn có ca thứ N+1. Theo
 * đề nghị của người review, round 3 CHUYỂN HẲN sang AST thật của TypeScript
 * (`ts.createSourceFile` — cùng gói `typescript` mà `tsc --noEmit` đã dùng, đã là
 * dependency sẵn có, KHÔNG thêm gói mới). Bộ tokenizer của TS xử lý ĐÚNG comment/
 * chuỗi/template-literal/regex-literal miễn phí — cổng giờ chỉ cần duyệt CÂY cú
 * pháp tìm `PropertyAssignment`/`ShorthandPropertyAssignment` tên "onError" (và
 * phép gán `obj.onError = fn`), không còn tự phân tích ký tự.
 *
 * Lợi ích đo được (so 3 vòng quét-văn-bản trước):
 *   - Không còn khái niệm "loại trừ có căn cứ" thủ công (JSX/type-signature/
 *     property-read/comment) — các dạng đó là NODE KIND KHÁC trong AST
 *     (JsxAttribute / PropertySignature / PropertyAccessExpression đọc), tự
 *     nhiên KHÔNG khớp `PropertyAssignment`, không cần regex loại trừ nào.
 *   - Đóng thêm giới hạn round-2 mục "gán `obj.onError = fn` qua property-access"
 *     (trước đây mù hoàn toàn) — AST phân biệt được `BinaryExpression` gán thật.
 *   - Tên thuộc tính so bằng `.text` CHÍNH XÁC — hết false-positive kiểu
 *     "onErrorHandler" (không cần check ký tự liền trước/sau nữa).
 *
 * Giới hạn KHÔNG đóng được (không phải AST không làm được, mà cố tình dừng ở mức
 * cú pháp — parse-only bằng `ts.createSourceFile`, KHÔNG dựng `ts.Program` +
 * `TypeChecker` để giữ cổng nhanh/đơn giản, xem "GIỚI HẠN ĐÃ BIẾT" dưới):
 *   - Tham chiếu XUYÊN FILE (`import { x } from "@shared/y"` rồi `onError: x`) —
 *     vẫn cần một resolver import/module thật để lần sang file kia; AST cú pháp
 *     đơn file không cho biết `x` được định nghĩa ở đâu.
 *   - Khoá tính toán dùng BIẾN (`[key]: fn` với `key = "onError"` khai báo nơi
 *     khác) — cần suy luận giá trị hằng của biến (constant folding / type
 *     narrowing), đòi hỏi `TypeChecker` thật, ngoài phạm vi parse-only.
 *
 * ── SỐ ĐO ──────────────────────────────────────────────────────────────────────
 * Task 7 Step 1 (quét văn bản, trước di trú): 575 site / 170 file. Lô 1 (sản
 * xuất+kiểm tra, 9 file, 25 site) → 550. Lô 2 (cảnh báo+thiết bị+andon, 8 file,
 * 19 site) → 531. Round 2 thêm `shared/` vào phạm vi quét — không đổi số (0
 * onError trong shared/ hôm nay). Round 3 (đổi sang AST) — xem "SỐ CỔNG SAU VÒNG
 * SỬA 3" trong task-7-report.md mục 9 cho số đo lại + so sánh chênh lệch với quét
 * văn bản (nếu có) và lý do.
 *
 * Tự đo lại: chạy hàm countRawMessageSites() ở dưới trên hai gốc SCAN_ROOTS.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC_DIR = join(LIB_DIR, ".."); // client/src
const REPO_ROOT = join(CLIENT_SRC_DIR, "..", ".."); // client/src → client → <repo root>
const SHARED_DIR = join(REPO_ROOT, "shared"); // review round 2 — alias `@shared/*` (tsconfig.json:22-23)

/** Hai gốc quét: client/src (nơi migrate Task 7/8) + shared/ (nơi handler dùng
 *  chung có thể được hoist ra, xem docstring đầu file). */
const SCAN_ROOTS: Array<{ dir: string; displayPrefix: string }> = [
  { dir: CLIENT_SRC_DIR, displayPrefix: "client/src" },
  { dir: SHARED_DIR, displayPrefix: "shared" },
];

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_RAW_MESSAGE_HANDLERS = 131; // ← Task 8 lượt C, lô 3 (5 file 3-site, đạt mốc ≥130): 146 → 131 (15 site, xem task-8c-report.md).

function walkTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkTsxFiles(full)); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name) || name.endsWith(".unit.test.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Parse một file thành AST thật bằng trình phân tích cú pháp của TypeScript
 *  (parse-only — KHÔNG dựng `ts.Program`/`TypeChecker`, nên rất nhanh: xem số đo
 *  thời gian ở task-7-report.md mục 9). `.tsx` dùng ScriptKind.TSX để hiểu JSX. */
function parseSourceFile(filePath: string): ts.SourceFile {
  const text = readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, false, scriptKind);
}

type HandlerFn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** Thân hàm có tham chiếu `.message` (bất kỳ đâu, kể cả lồng trong callback con)
 *  mà KHÔNG có lời gọi `mapTrpcError(`/`toastTrpcError(` nào trong cùng thân hàm
 *  ⇒ vi phạm. Duyệt AST thật của thân hàm — không còn cần regex `\.message\b`
 *  trên text (vốn có thể khớp nhầm trong chuỗi/comment; AST phân biệt được
 *  PropertyAccessExpression thật với text trông giống). */
function isViolationFunction(fn: HandlerFn): boolean {
  let hasMessage = false;
  let hasMapper = false;
  function visit(node: ts.Node) {
    if (hasMapper) return; // đã chắc chắn KHÔNG vi phạm — dừng sớm cho nhanh
    if (ts.isPropertyAccessExpression(node) && node.name.text === "message") hasMessage = true;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (calleeName === "mapTrpcError" || calleeName === "toastTrpcError") hasMapper = true;
    }
    ts.forEachChild(node, visit);
  }
  if (fn.body) visit(fn.body);
  return hasMessage && !hasMapper;
}

/** Tìm `const/let/var NAME = (async)? (...) => {...}` / `function NAME(...) {}`
 *  trong CÙNG file (AST — chỉ khớp khi initializer là hàm TRỰC TIẾP; nếu là
 *  `useMemo(...)`/`useCallback(...)`/factory-call khác thì KHÔNG tự "bóc" —
 *  giữ nguyên tinh thần round 1: không đoán, coi là chưa tìm thấy ⇒ unresolved). */
function findNamedHandlerInFile(sf: ts.SourceFile, name: string): HandlerFn | null {
  let found: HandlerFn | null = null;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

function propertyNameIsOnError(name: ts.PropertyName): boolean {
  if (ts.isIdentifier(name)) return name.text === "onError";
  if (ts.isStringLiteral(name)) return name.text === "onError";
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression;
    return ts.isStringLiteralLike(expr) && expr.text === "onError";
  }
  return false;
}

function lineOfNode(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Đếm mỗi SITE `onError` (khoá của một object literal nối vào
 *  `useMutation`/`useQuery`, hoặc gán qua property-access `obj.onError = fn`)
 *  hiện message thô. Duyệt AST thật — xem docstring đầu file để biết vì sao thay
 *  quét văn bản (round 1-2) bằng AST (round 3).
 *
 *  `unresolved` = site tham chiếu (`onError: name` / viết tắt `onError,`) mà
 *  findNamedHandlerInFile() KHÔNG tìm được định nghĩa TRỰC TIẾP là hàm trong
 *  cùng file (import từ nơi khác / useMemo·useCallback bọc ngoài / factory-call
 *  gián tiếp / biểu thức khác không phải hàm-nội-tuyến-hay-định-danh). KHÔNG
 *  phải violations (không biết chắc đúng/sai — có thể handler đó đã dùng đúng
 *  mapTrpcError rồi, chỉ là cổng không lần theo được) nhưng PHẢI báo riêng —
 *  im lặng bỏ qua chính là lớp lỗi bị bắt liên tiếp 3 vòng review. */
function analyzeSourceFile(sf: ts.SourceFile): {
  violations: number;
  lines: number[];
  unresolved: Array<{ line: number; refName: string }>;
} {
  let violations = 0;
  const lines: number[] = [];
  const unresolved: Array<{ line: number; refName: string }> = [];

  function handleValue(siteNode: ts.Node, valueExpr: ts.Expression) {
    if (ts.isArrowFunction(valueExpr) || ts.isFunctionExpression(valueExpr)) {
      if (isViolationFunction(valueExpr)) {
        violations++;
        lines.push(lineOfNode(sf, siteNode));
      }
      return;
    }
    if (ts.isIdentifier(valueExpr)) {
      const refName = valueExpr.text;
      const resolved = findNamedHandlerInFile(sf, refName);
      if (!resolved) {
        unresolved.push({ line: lineOfNode(sf, siteNode), refName });
        return;
      }
      if (isViolationFunction(resolved)) {
        violations++;
        lines.push(lineOfNode(sf, siteNode));
      }
      return;
    }
    // Biểu thức khác (property access, ternary, call trả về hàm, ...) — không
    // đoán, báo ồn (khác round 1-2: giờ đây là nhánh RÕ RÀNG, không phải "else
    // cuối cùng của một chuỗi if/else ký tự" — AST đã loại hết các trường hợp có
    // căn cứ trước khi tới đây).
    unresolved.push({ line: lineOfNode(sf, siteNode), refName: "<biểu thức không nhận diện được>" });
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && propertyNameIsOnError(node.name)) {
      handleValue(node, node.initializer);
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "onError") {
      // { onError, ... } — viết tắt, tham chiếu biến CÙNG TÊN trong scope bao quanh.
      const resolved = findNamedHandlerInFile(sf, "onError");
      if (!resolved) {
        unresolved.push({ line: lineOfNode(sf, node), refName: "onError" });
      } else if (isViolationFunction(resolved)) {
        violations++;
        lines.push(lineOfNode(sf, node));
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === "onError") ||
        (ts.isElementAccessExpression(node.left) &&
          node.left.argumentExpression &&
          ts.isStringLiteralLike(node.left.argumentExpression) &&
          node.left.argumentExpression.text === "onError"))
    ) {
      // Gán obj.onError = fn / obj["onError"] = fn — round 2 liệt vào "giới hạn
      // đã biết" (mù hoàn toàn khi quét văn bản); AST phân biệt được đây là MỘT
      // BinaryExpression gán thật, khác PropertyAccessExpression đọc thông
      // thường (vd `this.props.onError?.(...)`) — đóng được giới hạn đó.
      handleValue(node, node.right);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return { violations, lines, unresolved };
}

/** Quét cả hai gốc (SCAN_ROOTS) — trả về cặp [đường dẫn hiển thị, path tuyệt đối]. */
function allScannedFiles(): Array<{ file: string; display: (f: string) => string }> {
  const out: Array<{ file: string; display: (f: string) => string }> = [];
  for (const root of SCAN_ROOTS) {
    let files: string[];
    try {
      files = walkTsxFiles(root.dir);
    } catch {
      continue; // thư mục không tồn tại (vd shared/ bị xoá) — bỏ qua, không sập cổng
    }
    for (const file of files) out.push({ file, display: (f) => f.replace(root.dir, root.displayPrefix) });
  }
  return out;
}

type FileResult = { display: string; violations: number; unresolved: Array<{ line: number; refName: string }> };

/**
 * Parse + phân tích TOÀN BỘ file MỘT LẦN, cache lại — 4 `it()` bên dưới (2 mô tả
 * × 2 assert mỗi mô tả) đều đọc cùng dữ liệu này thay vì mỗi `it()` tự parse lại
 * từ đầu (ban đầu KHÔNG cache: 4 lượt quét toàn bộ client/src+shared/ ≈ 4.9s; có
 * cache: 1 lượt ≈ xem số đo thật ở task-7-report.md mục 9). An toàn để cache vì
 * cổng chạy trong MỘT tiến trình `vitest run` ngắn hạn, không phải server sống
 * lâu — không có rủi ro dữ liệu cũ.
 */
let cachedResults: FileResult[] | null = null;
function scanAll(): FileResult[] {
  if (cachedResults) return cachedResults;
  const out: FileResult[] = [];
  for (const { file, display } of allScannedFiles()) {
    const sf = parseSourceFile(file);
    const { violations, unresolved } = analyzeSourceFile(sf);
    out.push({ display: display(file), violations, unresolved });
  }
  cachedResults = out;
  return out;
}

function countRawMessageSites(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const r of scanAll()) {
    if (r.violations > 0) {
      byFile.push([r.display, r.violations]);
      total += r.violations;
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Tổng site KHÔNG giải được tham chiếu (xem docstring đầu file). */
function countUnresolvedRefs(): { total: number; byFile: Array<[string, string, number]> } {
  const byFile: Array<[string, string, number]> = [];
  let total = 0;
  for (const r of scanAll()) {
    for (const u of r.unresolved) {
      byFile.push([r.display, `${u.refName}:${u.line}`, 1]);
      total++;
    }
  }
  return { total, byFile };
}

describe("phủ mã lỗi trong client/src (onError → mapTrpcError/toastTrpcError)", () => {
  it(`còn tối đa ${ALLOWED_RAW_MESSAGE_HANDLERS} site onError hiện message thô`, () => {
    const { total, byFile } = countRawMessageSites();
    if (total > ALLOWED_RAW_MESSAGE_HANDLERS) {
      // In ra file nặng nhất để đợt sau (Task 8) biết bắt đầu từ đâu.
      console.error("[phủ mã lỗi client] còn nợ ở:", byFile.slice(0, 20));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_MESSAGE_HANDLERS);
  });

  it("ngân sách KHÔNG được nới rộng hơn thực tế — số dư thừa che mất nợ mới", () => {
    // Ngân sách phải bám SÁT số thật. Nếu nó cao hơn thực tế, ai đó thêm một
    // `onError: (e) => toast.error(e.message)` mới sẽ lọt qua cổng mà không ai biết.
    const { total } = countRawMessageSites();
    expect(ALLOWED_RAW_MESSAGE_HANDLERS).toBe(total);
  });
});

/** Hạ số này về 0 nếu >0 ở đây nghĩa là cổng CHÍNH bên trên đang có site mù (xem
 *  docstring đầu file). KHÔNG BAO GIỜ nâng lên để "cho qua" — nếu một tham chiếu
 *  hợp lệ mới thật sự không giải được, MỞ RỘNG findNamedHandlerInFile() để cổng
 *  đọc được nó rồi hạ ngân sách về đúng 0, đừng nới ngân sách. */
const ALLOWED_UNRESOLVED_ONERROR_REFS = 0; // ← đo được bằng AST (round 3): 0.

describe("phủ mã lỗi trong client/src — site onError KHÔNG giải được tham chiếu", () => {
  it(`còn tối đa ${ALLOWED_UNRESOLVED_ONERROR_REFS} site onError không truy được định nghĩa (import xuyên file/useMemo/factory-call...)`, () => {
    const { total, byFile } = countUnresolvedRefs();
    if (total > ALLOWED_UNRESOLVED_ONERROR_REFS) {
      console.error(
        "[phủ mã lỗi client] site onError KHÔNG giải được tham chiếu — không rõ đã di trú hay chưa, cần soát thủ công:",
        byFile,
      );
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_UNRESOLVED_ONERROR_REFS);
  });

  it("ngân sách site-không-giải-được KHÔNG được nới rộng hơn thực tế", () => {
    const { total } = countUnresolvedRefs();
    expect(ALLOWED_UNRESOLVED_ONERROR_REFS).toBe(total);
  });
});
