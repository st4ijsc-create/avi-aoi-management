/**
 * Sprint 5 doc 71 Task F11 — CỔNG CHẶN cho BA LỚP khoá i18n hỏng nuốt mất chi tiết
 * lỗi, phát hiện ở Task 8 lượt B/D nhưng KHÔNG có cổng nào bắt được lúc đó:
 *
 *  Lớp 1 — khoá THIẾU PLACEHOLDER: `t('qualityGates.failedToCreate', { error: ... })`
 *    nhưng bản dịch không có `{{error}}` ⇒ chuỗi lỗi truyền vào bị VỨT ĐI, người
 *    dùng chỉ thấy câu tĩnh vô nghĩa (vd `vi.json` cũ: `"errorMessage": "Lỗi Tin
 *    nhắn"`, `"failedToCreate": "Thất bại đến Tạo"`).
 *  Lớp 3 — khoá KHÔNG TỒN TẠI ở ≥1 trong 3 locale, dùng làm THÔNG ĐIỆP LỖI (bên
 *    trong `onError` của mutation, nhánh `.isError`/`.error` của query, hoặc
 *    `toast.error(...)`) ⇒ người dùng ngôn ngữ thiếu khoá LUÔN thấy defaultValue
 *    hard-code trong mã (thường là tiếng Anh — hoặc NGƯỢC LẠI, tiếng Việt hard-code
 *    nếu dev viết default bằng tiếng Việt, xem `dashboard.analyticsUnavailable`).
 *  (Lớp 2 — chất lượng dịch máy — không thể kiểm bằng máy, đã sửa thủ công cùng
 *    đợt cho ĐÚNG các khoá cổng này bắt được; xem task-F11-report.md.)
 *
 * ⚠ ĐIỂM MÙ của `npm run i18n:check` (scripts/i18n-check.mjs) mà cổng này bổ khuyết:
 *  - Lớp 1: i18n-check chỉ so khớp placeholder GIỮA các locale CÙNG có khoá đó. Nếu
 *    CẢ BA locale cùng thiếu `{{message}}` (như bug gốc) thì "khớp nhau" ⇒ xanh giả.
 *  - Lớp 3: i18n-check CỐ Ý bỏ qua khoá xuất hiện ở <2 locale
 *    (`if (present.length < 2) continue;`) — đúng ngay điểm mù của khoá "chỉ có ở
 *    en.json" (vd `mqtt.replayPage.registerError` trước khi sửa).
 *
 * Cổng này quét TĨNH bằng AST thật của TypeScript (cùng kỹ thuật với
 * clientErrorCoverage.unit.test.ts — KHÔNG dựng `ts.Program`/`TypeChecker`, chỉ
 * `ts.createSourceFile` để nhanh) mọi lời gọi `t("key", {...})` trong `client/src`
 * + `shared/`, nhận diện:
 *  (a) tham số nào "mang nội dung lỗi thật" — `mapTrpcError(...)`, `<x>.message`
 *      (mọi cấp, kể cả bracket `["message"]`), hoặc identifier tên
 *      error/err/e/exception/message/errMsg/errorMessage — kể cả khi lồng trong
 *      `||`/`??`/`?:`/`(...)`/`as`/`!`/template literal (khớp cách đóng gói THẬT
 *      trong repo, vd `err.message || "Unknown"` ở LicenseManagement.tsx).
 *  (b) lời gọi có phải "đường thông điệp lỗi" hay không — bên trong `onError:` của
 *      mutation, `.catch(`, hoặc nhánh DƯƠNG (không bị `!` phủ định) của điều kiện
 *      `x.error`/`x.isError` (if/&&/?:) — PHÂN BIỆT NHÁNH để không đếm nhầm nhánh
 *      rỗng/thành-công đứng cạnh nhánh lỗi (bug thật gặp phải khi dựng cổng này:
 *      `!searchQuery.isError && kbOff` bị đếm nhầm vì regex đơn giản khớp cả
 *      "isError" trong đoạn phủ định).
 *
 * Giới hạn ĐÃ BIẾT (cùng lớp với clientErrorCoverage.unit.test.ts — parse-only,
 * không phải TypeChecker):
 *  - Biến trung gian đặt tên khác rồi mới gán vào param (vd
 *    `const reason = mapTrpcError(err); t(key, { reason })`) — KHÔNG lần theo được
 *    initializer của biến; `reason` không nằm trong danh sách tên nhận diện Lớp 1
 *    (đây là không gian từ điển RIÊNG của `errors.reason.*`, xem errorCodes.ts, có
 *    cổng khác chuyên trị ở appErrorParamsCoverage.test.ts).
 *  - `t()` với khoá KHÔNG PHẢI string literal (biến động, template có `${}`) — bỏ
 *    qua có chủ đích, không đoán.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC_DIR = join(LIB_DIR, ".."); // client/src
const REPO_ROOT = join(CLIENT_SRC_DIR, "..", ".."); // client/src → client → <repo root>
const SHARED_DIR = join(REPO_ROOT, "shared");
const LOCALE_DIR = join(CLIENT_SRC_DIR, "i18n", "locales");
const LOCALES = ["vi", "en", "zh"] as const;

const SCAN_ROOTS = [CLIENT_SRC_DIR, SHARED_DIR];

function walkTsxFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // thư mục không tồn tại (vd shared/ bị xoá) — không sập cổng
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsxFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name) || name.endsWith(".unit.test.ts")) continue;
    out.push(full);
  }
  return out;
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const text = readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Bóc `||`/`??`/`?:`/`(...)`/`as`/`!`/template-literal để tìm mọi biểu thức LÁ mà
 *  giá trị cuối cùng có thể nhận — vd `err.message || "Unknown"` trả về [err.message,
 *  "Unknown"]. Khớp cách viết THẬT trong repo (LicenseManagement.tsx). */
function unwrapLeaves(expr: ts.Expression | undefined, out: ts.Expression[] = []): ts.Expression[] {
  if (!expr) return out;
  if (ts.isParenthesizedExpression(expr)) return unwrapLeaves(expr.expression, out);
  if (ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return unwrapLeaves(expr.expression, out);
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken || expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    unwrapLeaves(expr.left, out);
    unwrapLeaves(expr.right, out);
    return out;
  }
  if (ts.isConditionalExpression(expr)) {
    unwrapLeaves(expr.whenTrue, out);
    unwrapLeaves(expr.whenFalse, out);
    return out;
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "String" && expr.arguments[0]) {
    return unwrapLeaves(expr.arguments[0], out);
  }
  if (ts.isTemplateExpression(expr)) {
    for (const span of expr.templateSpans) unwrapLeaves(span.expression, out);
    return out;
  }
  out.push(expr);
  return out;
}

const ERRORISH_IDENTIFIER_RE = /^(error|err|e|exception|message|errMsg|errorMessage)$/;

function isErrorishLeaf(expr: ts.Expression): boolean {
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
    if (name === "mapTrpcError") return true;
  }
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "message") return true;
  if (
    ts.isElementAccessExpression(expr) &&
    expr.argumentExpression &&
    ts.isStringLiteralLike(expr.argumentExpression) &&
    expr.argumentExpression.text === "message"
  ) {
    return true;
  }
  if (ts.isIdentifier(expr) && ERRORISH_IDENTIFIER_RE.test(expr.text)) return true;
  return false;
}

function isErrorishExpr(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  return unwrapLeaves(expr).some(isErrorishLeaf);
}

/** Mệnh đề đơn (tách bởi `&&`) tham chiếu TRỰC TIẾP `.error`/`.isError`, KHÔNG bị
 *  phủ định bởi `!` ngay trước — "x.isError" khớp, "!x.isError" thì KHÔNG (đó là
 *  nhánh KHÔNG lỗi — rỗng/thành công — đếm nhầm sẽ tạo dương-tính-giả, gặp thật khi
 *  dựng cổng này ở `ManualHelp.tsx`/`NonconformanceReports.tsx`). */
function hasPositiveErrorClause(conditionText: string): boolean {
  return conditionText
    .split("&&")
    .some((clause) => /^[A-Za-z_$][\w]*(\.[A-Za-z_$][\w]*)*\.(error|isError)\b/.test(clause.trim()));
}

interface TCallInfo {
  file: string;
  line: number;
  key: string;
  params: Array<{ name: string; isErrorish: boolean }>;
  isErrorPath: boolean;
}

/** Ngữ cảnh bao quanh 1 lời gọi t(...): có nằm trong onError/catch/toast.error hay
 *  nhánh DƯƠNG của điều kiện .error/.isError hay không. */
function isErrorPathCall(node: ts.CallExpression): boolean {
  let prev: ts.Node = node;
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === "error" && ts.isIdentifier(callee.expression) && callee.expression.text === "toast") return true;
        if (callee.name.text === "catch") return true;
      }
    }
    if (ts.isPropertyAssignment(cur) || ts.isShorthandPropertyAssignment(cur)) {
      const nameNode = cur.name;
      const nm = ts.isIdentifier(nameNode) ? nameNode.text : ts.isStringLiteral(nameNode) ? nameNode.text : undefined;
      if (nm === "onError") return true;
    }
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && /onError|handleError/i.test(cur.name.text)) return true;
    if (ts.isIfStatement(cur) && hasPositiveErrorClause(cur.expression.getText()) && prev === cur.thenStatement) return true;
    if (
      ts.isBinaryExpression(cur) &&
      cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      hasPositiveErrorClause(cur.left.getText()) &&
      prev === cur.right
    ) {
      return true;
    }
    if (ts.isConditionalExpression(cur) && hasPositiveErrorClause(cur.condition.getText()) && prev === cur.whenTrue) return true;
    prev = cur;
    cur = cur.parent;
  }
  return false;
}

function collectTCalls(sf: ts.SourceFile, displayFile: string): TCallInfo[] {
  const out: TCallInfo[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (calleeName === "t" && node.arguments.length >= 1) {
        const keyArg = node.arguments[0];
        if (ts.isStringLiteralLike(keyArg)) {
          const optsArg = node.arguments[1];
          const params: Array<{ name: string; isErrorish: boolean }> = [];
          if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
            for (const prop of optsArg.properties) {
              let paramName: string | undefined;
              let valueExpr: ts.Expression | undefined;
              if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
                paramName = prop.name.text;
                valueExpr = prop.initializer;
              } else if (ts.isShorthandPropertyAssignment(prop)) {
                paramName = prop.name.text;
                valueExpr = prop.name;
              }
              if (paramName) params.push({ name: paramName, isErrorish: isErrorishExpr(valueExpr) });
            }
          }
          out.push({
            file: displayFile,
            line: lineOf(sf, node),
            key: keyArg.text,
            params,
            isErrorPath: isErrorPathCall(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

let cachedCalls: TCallInfo[] | null = null;
/** Parse + quét TOÀN BỘ file MỘT LẦN, cache lại — cùng lý do hiệu năng với
 *  clientErrorCoverage.unit.test.ts (nhiều `it()` dùng chung dữ liệu). */
function scanAllTCalls(): TCallInfo[] {
  if (cachedCalls) return cachedCalls;
  const out: TCallInfo[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsxFiles(root)) {
      const sf = parseSourceFile(file);
      const display = file.replace(REPO_ROOT, "").replace(/\\/g, "/");
      out.push(...collectTCalls(sf, display));
    }
  }
  cachedCalls = out;
  return out;
}

function flattenLocale(obj: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenLocale(v as Record<string, unknown>, key, out);
    else if (typeof v === "string") out[key] = v;
  }
  return out;
}

function loadFlatLocales(): Record<(typeof LOCALES)[number], Record<string, string>> {
  const out = {} as Record<(typeof LOCALES)[number], Record<string, string>>;
  for (const l of LOCALES) {
    out[l] = flattenLocale(JSON.parse(readFileSync(join(LOCALE_DIR, `${l}.json`), "utf8")));
  }
  return out;
}

function placeholdersOf(str: string): string[] {
  return [...str.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Lớp 1 — placeholder thiếu cho tham số mang nội dung lỗi thật.
// ═══════════════════════════════════════════════════════════════════════════
describe("cổng chặn F11 — Lớp 1: khoá i18n dùng làm thông điệp lỗi phải có placeholder khớp tham số", () => {
  it("không lời gọi t(key, {param: <lỗi thật>}) nào bị placeholder {{param}} vắng mặt ở CẢ BA locale", () => {
    const flat = loadFlatLocales();
    const calls = scanAllTCalls();
    const violations: string[] = [];

    for (const call of calls) {
      const presentLocales = LOCALES.filter((l) => flat[l][call.key] !== undefined);
      if (presentLocales.length === 0) continue; // Lớp 3 xử lý riêng bên dưới
      for (const p of call.params) {
        if (!p.isErrorish) continue;
        const anyHasPlaceholder = presentLocales.some((l) => placeholdersOf(flat[l][call.key]).includes(p.name));
        if (!anyHasPlaceholder) {
          violations.push(`${call.file}:${call.line}  t('${call.key}', { ${p.name}: ... }) — KHÔNG locale nào có {{${p.name}}}`);
        }
      }
    }

    if (violations.length > 0) {
      console.error(`[cổng F11 Lớp 1] ${violations.length} chỗ thiếu placeholder:\n` + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lớp 3 — khoá đường-lỗi thiếu ở ≥1/3 locale.
// ═══════════════════════════════════════════════════════════════════════════
describe("cổng chặn F11 — Lớp 3: khoá i18n dùng làm thông điệp lỗi phải tồn tại đủ vi/en/zh", () => {
  it("không lời gọi t(key) nào trên đường thông điệp lỗi (onError/catch/toast.error/nhánh .error) trỏ khoá vắng ở bất kỳ locale nào", () => {
    const flat = loadFlatLocales();
    const calls = scanAllTCalls();
    const violations: string[] = [];
    const seen = new Set<string>();

    for (const call of calls) {
      if (!call.isErrorPath) continue;
      const missingFrom = LOCALES.filter((l) => flat[l][call.key] === undefined);
      if (missingFrom.length === 0) continue;
      const dedupeKey = `${call.key}|${missingFrom.join(",")}`;
      if (seen.has(dedupeKey)) continue; // 1 khoá dùng nhiều site — báo 1 dòng đại diện/tổ hợp locale-thiếu
      seen.add(dedupeKey);
      violations.push(`${call.file}:${call.line}  t('${call.key}', ...) — THIẾU ở [${missingFrom.join(",")}]`);
    }

    if (violations.length > 0) {
      console.error(`[cổng F11 Lớp 3] ${violations.length} khoá đường-lỗi thiếu locale:\n` + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });
});
