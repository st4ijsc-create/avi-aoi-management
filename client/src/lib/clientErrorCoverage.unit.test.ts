/**
 * Sprint 5 doc 71 Task 7 (F1 phần A) — CỔNG CHẶN HỒI QUY phía CLIENT.
 *
 * Cùng khuôn với server/routers/appErrorCoverage.test.ts (Task 4-8): đếm số "site"
 * `onError` (mỗi chỗ nối vào một `useMutation`/`useQuery` trong client/src/pages và
 * client/src/components) còn hiện message THÔ — CHƯA đi qua mapTrpcError()/
 * toastTrpcError() (client/src/lib/trpcErrors.ts) — và so với một ngân sách GIẢM
 * DẦN. Mỗi đợt di trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ trang mới không thể lặng
 * lẽ thêm nợ. Sạch hoàn toàn khi hằng số về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy: bạn
 * vừa thêm một chỗ hiện `err.message` tiếng Anh thô cho người dùng Việt Nam. Dùng
 * `toastTrpcError(err)` (khi chỉ hiện toast) hoặc `mapTrpcError(err)` (khi cần
 * chuỗi để ghép vào chỗ khác — vd `description:` của toast có tiêu đề riêng).
 *
 * ── VÌ SAO KHÔNG THỂ ĐẾM BẰNG MỘT REGEX/GREP MỘT DÒNG (khác cổng server) ──────
 * Cổng server chỉ cần `grep -c "new TRPCError("` vì mọi lần ném lỗi đều VIẾT TRỰC
 * TIẾP tại chỗ. Ở client, rất nhiều `onError` KHÔNG viết hàm nội tuyến mà tham
 * chiếu một hàm dùng chung khai báo phía trên cùng file, hai dạng phổ biến:
 *   - `onError: onMutationError` (đặt tên khác "onError")
 *   - `onError,` (viết tắt object — tham chiếu biến CÙNG TÊN "onError")
 * Ví dụ thật đã gặp khi đo (Task 7 Step 1): client/src/pages/EquipmentStandards.tsx
 * định nghĩa MỘT `onMutationError` rồi 8 mutation cùng tham chiếu nó; RepairStation.tsx
 * định nghĩa MỘT `onError` (biến) dùng cho 2 mutation. Đếm chỉ khớp
 * `onError:\s*\(` (bỏ qua tham chiếu) sẽ BỎ SÓT các file này hoàn toàn (đo thử ra
 * 0 cho cả 4 file trên trong khi thực tế RepairStation=2, EquipmentStandards=8,
 * FieldDevices=2, EscalationRulesSection=4 — xem lịch sử đo ở Task 7 report).
 * Nên hàm countRawMessageSites() dưới đây CÂN BẰNG NGOẶC (giống radius-context
 * regex của appErrorCoverage.test.ts) + TRA CỨU định nghĩa hàm dùng chung trong
 * CÙNG FILE khi gặp một tham chiếu, rồi phân tích thân hàm đã-giải-quyết đó.
 *
 * ── SỐ ĐO ──────────────────────────────────────────────────────────────────────
 * Task 7 Step 1 (trước khi di trú bất kỳ file nào): 575 site trong 170 file
 * (client/src/pages + client/src/components; không có site nào ngoài hai thư mục
 * này tại thời điểm đo — hooks/lib/_core sạch).
 *   Lô 1 (sản xuất + kiểm tra — 9 file: ProductionOrders/ProductionScheduling/
 *   ProductionSessionSignOff/ProductChangeoverWizard/FeederVerify/
 *   InspectionDetail/RepairStation/NonconformanceReports/QualityHome) — 25 site
 *   → hạ 575 → 550.
 *   Lô 2 (cảnh báo + thiết bị + andon — 8 file: Alerts/ShellAlertChip/
 *   UnifiedDeviceMonitor/MachineCockpit/OperatorSessionControl/WorkOrdersPage/
 *   AndonBoard/OperatorHome) — 19 site → hạ 550 → 531.
 * Tổng Task 7 (F1 phần A): 44 site / 17 file di trú. Phần còn lại (531 site /
 * 153 file) là việc của Task 8 — danh sách đầy đủ nằm trong task-7-report.md.
 *
 * Tự đo lại: chạy hàm countRawMessageSites() ở dưới trên "client/src" (không có
 * lệnh shell một-dòng tương đương vì cần cân bằng ngoặc + tra cứu — xem trên).
 *
 * ── ĐIỂM MÙ ĐÃ VÁ (review round 1 — Important) — "không phân giải được" phải ỒN
 * ÀO, không được im lặng ─────────────────────────────────────────────────────
 * resolveNamedDef() ở dưới CHỈ tìm định nghĩa dạng `const/let/var NAME = (...) =>`
 * hoặc `function NAME(...)` trong CÙNG FILE. Reviewer dựng 3 fixture chứng minh cả
 * ba đều trả về `null` mà bản gốc của file này lặng lẽ `continue` (bỏ qua, KHÔNG
 * đếm là vi phạm, CŨNG KHÔNG đếm là đã-di-trú — biến mất hoàn toàn khỏi hai con số
 * trên):
 *   1. `onError: sharedHandler` với `sharedHandler` IMPORT từ file khác (không có
 *      định nghĩa `const sharedHandler = ...` trong file đang quét).
 *   2. `const onError = useMemo(() => (e) => {...}, [])` — vế phải của `const
 *      onError =` không phải trực tiếp `(params) =>` (là `useMemo(` trước) nên
 *      regex định nghĩa không khớp.
 *   3. `const onError = createHandler();` (factory-call) rồi dùng `onError,`
 *      viết tắt — cùng lý do (2), vế phải không phải arrow trực tiếp.
 * Nguy hiểm: cổng này ĐIỀU KHIỂN Task 8/9/10 di trú 531 site còn lại — đúng loại
 * việc hay dẫn tới hoist handler dùng chung ra file/hook riêng (import) hoặc bọc
 * `useCallback`/`useMemo` cho ổn định tham chiếu. Nếu điều đó xảy ra mà không ai
 * biết, cổng vẫn xanh (vì "không đếm là vi phạm") trong khi con số 531 không còn
 * đúng nữa — sai LẶNG LẼ, tệ hơn cổng đỏ.
 *
 * Sửa: analyzeFile() giờ GHI NHẬN riêng mọi site có tham chiếu KHÔNG giải được
 * (danh sách `unresolved`, không gộp vào `violations`/`total` vì không biết chắc
 * đó CÓ phải vi phạm hay không — có thể handler đó đã dùng đúng mapTrpcError rồi,
 * chỉ là cổng không đọc được). `ALLOWED_UNRESOLVED_ONERROR_REFS` bên dưới là một
 * ngân sách RIÊNG, luôn phải là 0 tại thời điểm này (đo được: 0) — hễ tăng lên,
 * cổng ĐỎ NGAY, buộc người thêm handler dạng đó phải hoặc (a) viết lại thành dạng
 * cổng đọc được (định nghĩa cùng file), hoặc (b) mở rộng resolveNamedDef() để hỗ
 * trợ dạng mới rồi hạ ngân sách về đúng 0 lại, KHÔNG được nâng ngân sách lên để
 * "cho qua".
 *
 * ── ĐIỂM MÙ THỨ HAI (review round 2 — Important) — ba lối thoát im lặng khác ──
 * Round 2 dựng 3 fixture khác chứng minh cổng round-1 vẫn XANH TUYỆT ĐỐI dù có
 * `.message` thô nằm thật trên đĩa:
 *   1. **Object-spread từ NGOÀI client/src** — alias `@shared/*` (tsconfig.json)
 *      trỏ tới `shared/`, thư mục cổng round-1 CHƯA BAO GIỜ quét. Nếu handler
 *      dùng chung được định nghĩa ở `shared/` rồi spread/import vào client, token
 *      "onError" không hề xuất hiện trong client/src ⇒ không có gì để bắt.
 *   2. **Khoá tính-toán/dạng chuỗi** — `["onError"]: fn` hoặc `"onError": fn`.
 *      Rơi vào nhánh `else { continue }` cuối analyzeFile() — round 1 chỉ vá chỗ
 *      `resolveNamedDef()` trả `null`, CHƯA vá nhánh else này (cùng lớp lỗi
 *      "continue lặng lẽ", khác điều kiện kích hoạt).
 *   3. **HOC/hàm bọc trả object chứa `onError` inline** (vd `withToast(handlers)`
 *      import từ `shared/` rồi trả `{ ...handlers, onError: (e) => toast.error(e.message) }`)
 *      — cùng gốc với (1): `onError` sống trong file `shared/` không được quét.
 *
 * Sửa (bounded, KHÔNG xây trình phân tích tổng quát):
 *   a. Quét THÊM `shared/` (đúng alias `@shared/*` trong tsconfig.json) — vá cả
 *      (1) và (3) cùng lúc, vì trong cả hai dạng, `onError: fn` INLINE vẫn nằm
 *      thành text thật trong MỘT file nào đó — chỉ là file đó ở `shared/` thay vì
 *      `client/src/pages|components`. Quét thêm thư mục là đủ, không cần hiểu
 *      "spread"/"HOC" là gì.
 *   b. Nhận diện tường minh khoá dạng chuỗi/tính-toán (`"onError":` /
 *      `["onError"]:` / `['onError']:`) — nắn về CÙNG luồng xử lý `:` sẵn có
 *      (nội tuyến hoặc tham chiếu), không phải logic mới.
 *   c. RÀ LẠI toàn bộ nhánh `continue` còn lại trong analyzeFile(): những nhánh
 *      cổng THỰC SỰ HIỂU không áp dụng (comment dạng khối kiểu-C, JSX
 *      `onError={...}` — DOM event của `<img>`, không phải react-query option,
 *      thuộc tính kiểu TS `onError?: Type` trong interface/type, đọc thuộc tính
 *      `.onError`/`.onError?.(...)`) tiếp tục `continue` NHƯNG có lý do ghi rõ
 *      trong mã — đây KHÔNG phải "không đoán được", mà là "đã xác định chắc chắn
 *      không áp dụng". Nhánh CÒN LẠI (`else` cuối cùng, dạng cổng thật sự không
 *      hiểu) giờ đẩy vào `unresolved` thay vì `continue` lặng lẽ.
 *
 * GIỚI HẠN ĐÃ BIẾT (không cố bắt, cost/benefit không hợp lý — xem task-7-report.md
 * mục "giới hạn đã biết" để biết đầy đủ danh sách và lý do):
 *   - Tham chiếu XUYÊN FILE tới một handler đặt tên khác "onError" (vd `import {
 *     onMutationError } from "@shared/x"` rồi `onError: onMutationError`) — rơi
 *     vào `unresolved` (đúng, ồn ào) nhưng KHÔNG được resolveNamedDef() tự động
 *     lần theo import để đọc file kia — đòi hỏi một bộ resolver import/alias đầy
 *     đủ, ngoài phạm vi "cổng đếm bằng text", KHÔNG làm.
 *   - Gán `obj.onError = fn;` qua property-access (khác object-literal key) —
 *     không quan sát thấy trong repo hôm nay; nếu xuất hiện, cổng sẽ COI LÀ
 *     property-read và bỏ qua (không unresolved, không violation) — mù thật sự.
 *   - Khoá tính toán dùng BIẾN thay vì chuỗi trực tiếp (`[key]: fn` với `key =
 *     "onError"` khai báo nơi khác) — không phát hiện được bằng quét văn bản
 *     (token "onError" không xuất hiện tại vị trí khoá).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC_DIR = join(LIB_DIR, ".."); // client/src
const REPO_ROOT = join(CLIENT_SRC_DIR, "..", ".."); // client/src → client → <repo root>
const SHARED_DIR = join(REPO_ROOT, "shared"); // review round 2 — alias `@shared/*` (tsconfig.json:22-23)

/** Hai gốc quét: client/src (nơi migrate Task 7/8) + shared/ (nơi handler dùng
 *  chung có thể được hoist ra, xem docstring "ĐIỂM MÙ THỨ HAI" đầu file). */
const SCAN_ROOTS: Array<{ dir: string; displayPrefix: string }> = [
  { dir: CLIENT_SRC_DIR, displayPrefix: "client/src" },
  { dir: SHARED_DIR, displayPrefix: "shared" },
];

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_RAW_MESSAGE_HANDLERS = 531; // ← Task 7 Step 3 lô 2/2 (F1 phần A, HẾT) — cảnh báo+thiết bị+andon, 19 site / 8 file. Tổng Task 7 = 44/17. Task 8 tiếp tục. (shared/ thêm ở round 2 không đổi số — 0 onError trong shared/ hôm nay.)

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

/** Từ vị trí `openIdx` trỏ vào một ký tự mở ( { [ — trả về vị trí NGAY SAU ký tự đóng khớp. */
function balanceFrom(src: string, openIdx: number): number {
  const open = src[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let k = openIdx; k < src.length; k++) {
    const c = src[k];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return k + 1; }
  }
  return src.length;
}

/** Từ vị trí ngay sau "(params)", đọc phần thân hàm mũi tên: block `{...}` hoặc concise expr. */
function readArrowBody(src: string, afterParamsIdx: number): string {
  let k = afterParamsIdx;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src.slice(k, k + 2) === "=>") {
    k += 2;
    while (k < src.length && /\s/.test(src[k])) k++;
  }
  if (src[k] === "{") return src.slice(k, balanceFrom(src, k));
  let depth = 0, end = k;
  for (; end < src.length; end++) {
    const c = src[end];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
    else if (c === ";" && depth === 0) { end++; break; }
    else if (c === "," && depth === 0) break;
  }
  return src.slice(k, end);
}

/** Site vi phạm = có `.message` trong thân hàm ĐÃ-GIẢI-QUYẾT nhưng không gọi mapTrpcError(/toastTrpcError(. */
function isViolationBody(body: string): boolean {
  const hasMessage = /\.message\b/.test(body);
  const hasMapper = /\bmapTrpcError\s*\(|\btoastTrpcError\s*\(/.test(body);
  return hasMessage && !hasMapper;
}

/**
 * Quét TOÀN FILE một lượt (tuyến tính), trả về danh sách khoảng [start, end) là
 * comment dòng đơn (mở bằng hai gạch-chéo, tới hết dòng) hoặc comment khối kiểu-C
 * (mở bằng cặp sao-gạch-chéo, đóng bằng cặp gạch-chéo-sao) — có TÔN TRỌNG chuỗi
 * (nhảy qua nội dung nháy-kép/nháy-đơn/backtick mà không diễn giải bên trong).
 *
 * ⚠ Tự kiểm phát hiện: bản đầu dùng lastIndexOf đơn giản (so mốc mở/đóng gần
 * nhất) SAI khi một comment DÒNG ĐƠN chứa chính hai ký tự mở-comment-khối làm nội
 * dung — ví dụ thật gặp ngay khi tự kiểm fixture round 2: một dòng comment nhắc
 * tới alias import dạng "@shared" cộng dấu sao (glob) — cụm đó chứa gạch-chéo rồi
 * sao liền nhau, bị hiểu lầm là MỞ một comment khối, và vì không có gì đóng nó
 * trước "onError" ở dòng sau, MỌI onError phía sau trong file bị coi là "đang
 * trong comment" → bị loại lặng lẽ. Đây là dạng lỗi Y HỆT lớp bị round 1/2 bắt
 * (loại trừ sai căn cứ) — chỉ khác ở chỗ do CHÍNH cơ chế phát hiện exclusion gây
 * ra, không phải một site thật.
 * Sửa: quét MỘT LƯỢT từ đầu file, xử lý comment dòng đơn bằng cách nuốt
 * hết-tới-hết-dòng (không cho phần còn lại của dòng đó "mở" thêm gì), xử lý
 * chuỗi bằng cách nhảy qua nội dung (kể cả nếu chuỗi chứa cặp ký tự comment giả)
 * trước khi xét comment khối.
 */
function computeCommentRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const start = i;
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? n : nl; // KHÔNG nuốt ký tự newline — dòng sau vẫn được xét bình thường
      ranges.push([start, end]);
      i = end;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const start = i;
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return ranges;
}

/** `ranges` từ computeCommentRanges() luôn tăng dần theo vị trí quét — dò tuyến
 *  tính là đủ nhanh (file nguồn thực tế chỉ vài trăm–vài nghìn dòng). */
function isInComment(ranges: Array<[number, number]>, pos: number): boolean {
  for (const [s, e] of ranges) {
    if (pos < s) break;
    if (pos < e) return true;
  }
  return false;
}

/** Số dòng (1-based) của vị trí `pos` trong `src`. */
function lineOf(src: string, pos: number): number {
  return src.slice(0, pos).split("\n").length;
}

/** Tìm `const/let/var NAME = (async)? (...) => body` hoặc `function NAME(...) {}` trong CÙNG file. */
function resolveNamedDef(src: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const arrowRe = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(async\\s+)?\\(`);
  const m = arrowRe.exec(src);
  if (m) {
    const parenOpen = src.indexOf("(", m.index);
    return readArrowBody(src, balanceFrom(src, parenOpen));
  }
  const fnRe = new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`);
  const fm = fnRe.exec(src);
  if (fm) {
    const parenOpen = src.indexOf("(", fm.index);
    const afterParams = balanceFrom(src, parenOpen);
    let k = afterParams;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] === "{") return src.slice(k, balanceFrom(src, k));
  }
  return null; // không tìm thấy định nghĩa trong file (vd import từ nơi khác) — không đoán
}

/** Đếm mỗi SITE `onError` (khoá trong options object của react-query) hiện message
 *  thô. Xem docstring đầu file để biết vì sao cần cân bằng ngoặc + tra cứu tham
 *  chiếu, thay vì một regex đơn giản.
 *
 *  `unresolved` = site có tham chiếu (`onError: name` / viết tắt `onError,`) mà
 *  resolveNamedDef() KHÔNG tìm được định nghĩa trong cùng file (import từ nơi
 *  khác / useMemo·useCallback bọc ngoài / factory-call gián tiếp — xem docstring
 *  "ĐIỂM MÙ ĐÃ VÁ" đầu file). Đây KHÔNG phải violations (không biết chắc đúng/sai)
 *  nhưng PHẢI được báo riêng — im lặng bỏ qua là chính điểm mù bị review round 1
 *  bắt lỗi. */
function analyzeFile(file: string): { violations: number; lines: number[]; unresolved: Array<{ line: number; refName: string }> } {
  const src = readFileSync(file, "utf8");
  const commentRanges = computeCommentRanges(src);
  let violations = 0;
  const lines: number[] = [];
  const unresolved: Array<{ line: number; refName: string }> = [];
  let idx = 0;
  while (true) {
    const found = src.indexOf("onError", idx);
    if (found === -1) break;
    idx = found + 7;

    // ── Loại trừ CÓ CĂN CỨ — cổng THỰC SỰ HIỂU các dạng này không áp dụng, khác
    // với "không đoán được" (xem docstring "ĐIỂM MÙ THỨ HAI" đầu file, mục c). ──
    if (isInComment(commentRanges, found)) continue; // comment dòng đơn HOẶC khối kiểu-C

    const lineStart = src.lastIndexOf("\n", found) + 1;
    const before = src.slice(Math.max(0, found - 20), found);
    if (/[A-Za-z0-9_$]$/.test(before)) continue; // vd "...onError" là hậu tố của định danh dài hơn
    const after1 = src[found + 7];
    if (after1 && /[A-Za-z0-9_$]/.test(after1)) continue; // vd "onErrorHandler"

    if (/\b(const|let|var)$/.test(before.trimEnd())) continue; // đây là ĐỊNH NGHĨA — tra cứu on-demand ở nhánh site

    // property READ (vd `this.props.onError?.(...)`), không phải khai báo khoá.
    // ⚠ PHẢI dùng phần CÙNG DÒNG (không phải `before` 20-ký-tự) — bug đã bắt được
    // khi tự kiểm: `before` 20-ký-tự có thể vượt qua ranh giới dòng và "ăn" luôn
    // dấu chấm CUỐI CÂU của một comment ở DÒNG TRƯỚC (vd
    // "// ... show it verbatim.\n    onError: (e) => ..." tại
    // client/src/pages/EquipmentIntegration.tsx:867-868 và
    // client/src/components/lineView/LineCommandBar.tsx:85-86) — trimEnd() xoá
    // khoảng trắng/newline rồi vẫn thấy "." của CÂU COMMENT, hiểu lầm là
    // "obj.onError". Chỉ xét phần văn bản CÙNG DÒNG với "onError" mới đúng.
    const sameLineBefore = src.slice(lineStart, found);
    if (sameLineBefore.trimEnd().endsWith(".")) continue;

    const afterToken = found + 7;
    // Thuộc tính optional kiểu TS trong interface/type (`onError?: Type`, không
    // phải giá trị runtime) HOẶC optional-chaining ĐỌC (`onError?.(...)`).
    if (src[afterToken] === "?" && (src[afterToken + 1] === ":" || src[afterToken + 1] === ".")) continue;

    // JSX attribute `onError={...}` (vd `<img onError={...}>`) — DOM event của
    // element/component, KHÔNG phải react-query onError option. Giới hạn đã biết
    // (task-7-report.md): nếu một component tuỳ biến truyền lỗi tRPC qua đúng tên
    // prop "onError", cổng không thấy — chưa quan sát thấy ca nào trong repo.
    {
      let j = afterToken;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === "=") {
        let j2 = j + 1;
        while (j2 < src.length && /\s/.test(src[j2])) j2++;
        if (src[j2] === "{") continue;
      }
    }

    let k = afterToken;
    while (k < src.length && /\s/.test(src[k])) k++;
    let body: string | null = null;
    let refName: string | null = null;

    // Khoá dạng chuỗi/tính-toán: "onError": fn · 'onError': fn · ["onError"]: fn ·
    // ['onError']: fn — round 2 mục b. Nắn `k` qua dấu nháy (+ dấu `]` nếu là khoá
    // tính toán) rồi tiếp tục đúng luồng xử lý `:` sẵn có bên dưới.
    const beforeChar = before.slice(-1);
    const QUOTE_CHARS = new Set(['"', "'", "`"]);
    if (QUOTE_CHARS.has(beforeChar) && src[k] === beforeChar) {
      k++; // qua dấu nháy đóng
      if (before.length >= 2 && before[before.length - 2] === "[" && src[k] === "]") {
        k++; // qua dấu ] của khoá tính toán ["onError"]/['onError']
      }
      while (k < src.length && /\s/.test(src[k])) k++;
    }

    if (src[k] === ":") {
      k++;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === "(") {
        body = readArrowBody(src, balanceFrom(src, k));
      } else {
        const identMatch = /^[A-Za-z_$][\w$]*/.exec(src.slice(k));
        if (identMatch) {
          refName = identMatch[0];
        } else {
          // ":" nhưng giá trị không phải hàm nội tuyến cũng không phải định danh
          // (biểu thức lạ) — round 2 mục c: KHÔNG đoán, báo ồn thay vì bỏ qua.
          unresolved.push({ line: lineOf(src, found), refName: "<biểu thức sau ':' không nhận diện được>" });
          continue;
        }
      }
    } else if (src[k] === "," || src[k] === "}") {
      refName = "onError"; // viết tắt { onError, ... } / { ..., onError }
    } else {
      // ĐIỂM MÙ round 2 (mục c): dạng còn lại KHÔNG nhận diện được sau khi đã loại
      // các trường hợp có căn cứ ở trên — trước đây `continue` lặng lẽ, giờ báo ồn.
      unresolved.push({ line: lineOf(src, found), refName: "<cấu trúc sau 'onError' không nhận diện được>" });
      continue;
    }

    if (refName) {
      const resolved = resolveNamedDef(src, refName);
      if (resolved === null) {
        // ĐIỂM MÙ round 1: trước đây `continue` lặng lẽ ở đây — giờ ghi nhận ồn ào.
        unresolved.push({ line: lineOf(src, found), refName });
        continue;
      }
      body = resolved;
    }

    if (body !== null && isViolationBody(body)) {
      violations++;
      lines.push(lineOf(src, found));
    }
  }
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

function countRawMessageSites(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const { file, display } of allScannedFiles()) {
    const { violations } = analyzeFile(file);
    if (violations > 0) {
      byFile.push([display(file), violations]);
      total += violations;
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Tổng site KHÔNG giải được tham chiếu (xem docstring "ĐIỂM MÙ" đầu file — cả round 1 và round 2). */
function countUnresolvedRefs(): { total: number; byFile: Array<[string, string, number]> } {
  const byFile: Array<[string, string, number]> = [];
  let total = 0;
  for (const { file, display } of allScannedFiles()) {
    const { unresolved } = analyzeFile(file);
    for (const u of unresolved) {
      byFile.push([display(file), `${u.refName}:${u.line}`, 1]);
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
 *  docstring "ĐIỂM MÙ ĐÃ VÁ" đầu file). KHÔNG BAO GIỜ nâng lên để "cho qua" — nếu
 *  một tham chiếu hợp lệ mới thật sự không giải được, MỞ RỘNG resolveNamedDef() để
 *  cổng đọc được nó rồi hạ ngân sách về đúng 0, đừng nới ngân sách. */
const ALLOWED_UNRESOLVED_ONERROR_REFS = 0; // ← review round 1 (Important) — đo được: 0 tại thời điểm vá.

describe("phủ mã lỗi trong client/src — site onError KHÔNG giải được tham chiếu (review round 1)", () => {
  it(`còn tối đa ${ALLOWED_UNRESOLVED_ONERROR_REFS} site onError không truy được định nghĩa (import/useMemo/factory-call...)`, () => {
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
