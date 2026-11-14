/**
 * ★★★ CENSUS AST (T2 của lượt sửa gốc A2(n), 14/11) — "CHỮ KHÔNG PHẢI TRẠNG THÁI".
 *
 * Central và edge không được suy trạng thái an toàn (nợ STOP, kết cục không rõ, chốt run, giữ run, phân loại STOP, URGENT)
 * từ CHỮ (chuỗi lỗi, thông điệp thư viện, rider trong chuỗi). Tệp này KHÔNG sửa hành vi: nó ĐÓNG BĂNG mọi chỗ đọc chữ đang có
 * (bảng kiểm kê `thuc-thi\T9\kiem-ke-chu\bang.md`, cập nhật tới `27f9b47ac`) và ĐỎ khi:
 *   (1) có chỗ khớp mới mà không có dòng đóng băng;
 *   (2) có dòng đóng băng mà mã không còn ⇒ thông báo "xoá dòng X khỏi danh sách";
 *   (3) số dòng đóng băng vượt `SO_DONG_MOC` (mốc chỉ được GIẢM: mỗi bước sửa gốc làm danh sách ngắn đi).
 *
 * Luật quét (đi AST bằng TypeScript compiler API, không dùng regex dòng ⇒ lời gọi xuống dòng và optional chaining đều thấy):
 *   L1  `.startsWith/.endsWith/.includes/.match/.indexOf/.split/.replace(…)` áp trên biểu thức có ĐỊNH DANH CUỐI là
 *       `error|err|message|detail|reason|text|msg` hoặc bắt đầu bằng `loi`/`raw` (hoặc đúng một cặp tệp + định danh trong
 *       `CAP_DINH_DANH`: A1-38, A1-39, A1-41); `.test(…)`/`.exec(…)` (regex literal hay hằng regex)
 *       và `JSON.parse(…)` áp trên đối số như vậy. Định danh cuối được bóc qua ngoặc, `!`, `as`, `?.`, `String(x)`, `?? / ||`,
 *       `a ? b : c` và các phép biến chữ `toLowerCase`, `toUpperCase`, `trim…`, `toString`, `slice`, `substring`, `substr`, `normalize`
 *       (chặt hơn đọc thô: `err.message.toLowerCase().includes(…)` vẫn là đọc `message`).
 *   L2  hằng chuỗi bắt đầu bằng `FOE_`, `EDGE_` hoặc `[[A2N` (bỏ khoảng trắng đầu; regex: chứa) khi nằm trong phép so chữ:
 *       đối số (hoặc mảng nhận) của các phép ở L1, nhận của `.test/.exec`, toán hạng `=== !== == !=`, nhãn `case`.
 *       Định danh được giải về giá trị `const` cấp tệp của MỌI tệp trong phạm vi; không giải được mà tên là `FOE_*`/`EDGE_*` ⇒ tính.
 *   L3  mọi nơi gọi / tham chiếu tới hàm trung gian đã biết "đọc chữ rồi trả trạng thái" (`HAM_TRUNG_GIAN`, trừ chỗ khai báo,
 *       import/export). Đây là lưới bù cho giới hạn [H7]: chữ đi qua hàm trung gian thì L1 không thấy.
 *
 * Khoá của một dòng = tệp + hàm bao + phép so + đoạn chữ chuẩn hoá (bỏ mọi khoảng trắng, bỏ dấu phẩy treo). KHÔNG dùng số dòng.
 * Đối chiếu là theo BỘ ĐẾM (multiset): hai chỗ y hệt trong cùng hàm là hai dòng.
 *
 * Test thuần: chỉ đọc tệp nguồn trong repo (CRLF → LF), không DB, không mạng, không đồng hồ.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Phạm vi quét và loại trừ (mỗi loại trừ có lý do)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Gốc thư mục quét đệ quy. */
const GOC_QUET: readonly string[] = [
  "server/services/orchestration/foe",
  "server/services/edge",
  "server/services/robot", // gồm robot/drivers, robot/ursim
  "server/services/ot/drivers",
  "server/services/equipment", // A1-32, A1-37…A1-40 nằm ở đây hoặc đọc từ đây
];

/**
 * Tệp lẻ quét thêm: `server/services/ot/commandDispatcher*` (A1-21, A1-33, A1-34).
 * LOẠI TRỪ phần còn lại của `server/services/ot/**`: theo kế hoạch T2 [H7], chỗ đó không dựng trạng thái STOP từ chữ của thiết bị
 * hay của nút (chỉ drivers và dispatcher làm việc này).
 */
const TIEN_TO_TEP_LE = { thuMuc: "server/services/ot", tienTo: "commandDispatcher" } as const;

/**
 * Loại trừ theo tên tệp:
 *  - `*.test.ts`: tệp test, không chạy trong sản xuất (gồm chính tệp census này);
 *  - `*.testkit.ts`: bộ dựng cho test, không chạy trong sản xuất;
 *  - `__*`: phụ kiện test (fixture, sim giả, harness e2e), không chạy trong sản xuất.
 */
const LOAI_TRU_TEN: readonly { re: RegExp; lyDo: string }[] = [
  { re: /\.test\.ts$/, lyDo: "tệp test, không chạy trong sản xuất" },
  { re: /\.testkit\.ts$/, lyDo: "bộ dựng cho test, không chạy trong sản xuất" },
  { re: /^__/, lyDo: "phụ kiện test (fixture, sim giả, harness), không chạy trong sản xuất" },
];

const DUOI_MA = /\.(ts|tsx|mts|cts)$/;

function laTepLoaiTru(ten: string): boolean {
  return LOAI_TRU_TEN.some((l) => l.re.test(ten));
}

function tepTrongPhamVi(): string[] {
  const out: string[] = [];
  const di = (dir: string): void => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (laTepLoaiTru(ten)) continue; // thư mục `__*` (nếu có) cũng là phụ kiện test
        di(p);
      } else if (DUOI_MA.test(ten) && !laTepLoaiTru(ten)) out.push(p);
    }
  };
  for (const g of GOC_QUET) di(resolve(GOC, g));
  const thuMucLe = resolve(GOC, TIEN_TO_TEP_LE.thuMuc);
  for (const ten of readdirSync(thuMucLe)) {
    if (ten.startsWith(TIEN_TO_TEP_LE.tienTo) && DUOI_MA.test(ten) && !laTepLoaiTru(ten)) out.push(resolve(thuMucLe, ten));
  }
  return out.map((p) => relative(GOC, p).replace(/\\/g, "/")).sort();
}

/** Chuẩn hoá CRLF → LF (bản làm việc trên Windows có thể là CRLF). */
export const veLf = (s: string): string => s.replace(/\r\n/g, "\n");
/** Đọc nguồn, luôn qua `veLf`. */
const docNguon = (rel: string): string => veLf(readFileSync(resolve(GOC, rel), "utf8"));

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Luật quét
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** L1: phép so chữ áp trên NHẬN (receiver). */
const PHEP_TREN_NHAN = new Set(["startsWith", "endsWith", "includes", "match", "indexOf", "split", "replace"]);
/** L1: phép so chữ áp trên ĐỐI SỐ đầu (regex literal hay hằng regex). */
const PHEP_TREN_DOI_SO = new Set(["test", "exec"]);
/** Phép biến chữ được bóc khi tìm định danh cuối. */
const PHEP_BIEN_CHU = new Set([
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "toString",
  "slice",
  "substring",
  "substr",
  "normalize",
]);

/** `msg` thêm theo quyết định scada-master 14/11 (A1-35: `msg.startsWith(OPCUA_TIEN_TO_QUA_HAN)` ở opcuaDriver). */
const TEN_CHU_DUNG = new Set(["error", "err", "message", "detail", "reason", "text", "msg"]);
export const laTenChu = (ten: string): boolean => TEN_CHU_DUNG.has(ten) || ten.startsWith("loi") || ten.startsWith("raw");

/**
 * L1-CẶP: đúng cặp (tệp, định danh) cho các ô mà tên biến nằm ngoài tập trên (quyết định scada-master 14/11: KHÔNG mở luật tới
 * `outcome` / `reply` / `data` ở mọi nơi, vì ồn). Định danh so với chữ của biểu thức đích đã bỏ khoảng trắng, `?` và `!`.
 */
export const CAP_DINH_DANH: readonly { tep: string; dinhDanh: string; o: string; lyDo: string }[] = [
  { tep: "server/services/robot/drivers/techmanDriver.ts", dinhDanh: "frame.data", o: "A1-38", lyDo: "id / kết quả trong khung TMSCT ⇒ ok / lỗi đã biết / không rõ" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", dinhDanh: "result", o: "A1-38", lyDo: "phần kết quả của khung TMSCT (regex OK / ERROR)" },
  { tep: "server/services/robot/ursimBridge.ts", dinhDanh: "safety", o: "A1-39", lyDo: "chữ dashboard `safetystatus` ⇒ estop" },
  { tep: "server/services/robot/ursim/ursimClient.ts", dinhDanh: "reply", o: "A1-39", lyDo: "chữ dashboard `running` ⇒ busy" },
  { tep: "server/services/edge/edgeExecutionAgent.ts", dinhDanh: "r.outcome", o: "A1-41", lyDo: "outcome `pending:` do agent đặt ⇒ hoãn STOP sang pha làm việc" },
];
const vanBanDich = (e: ts.Expression): string => boc(e).getText().replace(/\s+/g, "").replace(/[?!]/g, "");

/** L2: tiền tố của hằng chữ trạng thái. */
const TIEN_TO_HANG = ["FOE_", "EDGE_", "[[A2N"] as const;
const TEN_HANG_TIEN_TO = /^(FOE|EDGE)_[A-Z0-9_]*$/;

/**
 * L3: hàm trung gian "đọc chữ rồi trả trạng thái". Mỗi tên có nguồn (ô bảng) và lý do.
 * Danh sách RỘNG HƠN brief (brief: 3 tên + mục B, C, F, G): thêm các hàm phân loại mã trả về của driver (kế hoạch T2 [H7]) và các bộ đọc
 * chữ lõi của bảng A. Lý do: không có chúng thì một nơi gọi MỚI như `loiLaKetCucKhongRo(row.error)` không đỏ (chữ đi qua hàm trung gian
 * là giới hạn [H7] của L1), và khoảng 20 ô A1 không thấy được. scada-master CHẤP NHẬN ngày 14/11 (86 dòng `goi:` ở lúc đó).
 * `edgeOutcomeUnknownOf` không còn nơi gọi trong mã sản xuất ở `27f9b47ac` (chỉ test gọi); giữ tên để bắt nơi gọi mới.
 * Không có trong danh sách (đã xét, có lý do):
 *  - `runDaChotKhongRo`, `outcomeUnknownOf`, `buTruKhongRoCho`, `lyDoDongBoKhoa` (mục B): đọc ctx / resume state CÓ CẤU TRÚC;
 *    chữ chỉ vào qua `edgeOutcomeUnknownOf` / `tapKhongRoEdge` / `chotTuHang`, đã có tên ở đây.
 *  - `isEdgeUnavailableError`, `isEdgeControlSchemaMissing` (mục C): đọc `code` của lỗi PG (mã có cấu trúc), không đọc chữ.
 *  - `ganBaoCaoKhongRoEdge` (mục G): nơi SOẠN chữ, không đọc chữ để trả trạng thái.
 *  - `maKetCucKhongRoCua` (A1-29): chỉ chọn mã HIỂN THỊ, không đổi quyết định.
 *  - `nguonCuaKetQua`: nhận `status` + mã đã tách, có cấu trúc.
 */
export const HAM_TRUNG_GIAN: readonly { ten: string; nguon: string; lyDo: string }[] = [
  // brief T2 (đã biết)
  { ten: "tachBaoCaoKhongRoEdge", nguon: "A1-24, R-i", lyDo: "tách rider [[A2N:…]] khỏi chữ end ⇒ báo cáo STOP/không rõ" },
  { ten: "docDsKhongRoEdge", nguon: "A1-22 (mục 0)", lyDo: "đọc danh sách EDGE_OUTCOME_UNKNOWN(…) từ chữ end" },
  { ten: "edgeOutcomeUnknownOf", nguon: "A1-22, mục F", lyDo: "danh sách lệnh không rõ của đoạn edge, rơi xuống chữ" },
  // mục B, C, F, G: hàm đọc chữ rồi trả trạng thái
  { ten: "chotTuHang", nguon: "A1-14, mục B", lyDo: "chốt run suy từ chữ lỗi của hàng bước (loiLaKetCucKhongRo)" },
  { ten: "stopChuaRaTuHang", nguon: "A1-3, B-12", lyDo: "nợ STOP suy từ chữ lỗi của hàng bước (laHangMaChuaRa)" },
  { ten: "tapKhongRoEdge", nguon: "A1-22 (mục 0), B-1", lyDo: "tập không rõ cuối đoạn = HỢP(chữ, hàng + sổ)" },
  // kế hoạch T2 [H7]: "các hàm phân loại mã trả về của driver"
  { ten: "maTienTo", nguon: "A1-33", lyDo: "tách mã đầu chữ lỗi của dispatcher OT ⇒ hàng thiết bị hay không gửi" },
  { ten: "laQuaHanGhiEip", nguon: "A1-37", lyDo: "chữ lỗi thư viện EtherNet/IP ⇒ kết cục ghi không rõ" },
  { ten: "laQuaHanThuVienEip", nguon: "A1-37", lyDo: "chữ lỗi thư viện EtherNet/IP ⇒ phiên nhiễm" },
  { ten: "coTheDaBayCua", nguon: "A1-32", lyDo: "mã 'có thể đã bay' đọc từ chữ lỗi robot" },
  { ten: "maTuChoiCua", nguon: "A1-21", lyDo: "tuChoi/driverLoi của STOP đọc từ mã đầu chữ lỗi" },
  // bảng A / mục 0: bộ đọc chữ lõi (chữ đi qua chúng thì L1 không thấy ở nơi gọi)
  { ten: "loiLaKetCucKhongRo", nguon: "A1-14…A1-17", lyDo: "mã FOE/EDGE_OUTCOME_UNKNOWN ở bất kỳ đâu trong chữ ⇒ không rõ" },
  { ten: "laLoiKhongGuiChot", nguon: "A1-13", lyDo: "tiền tố FOE_NOT_SENT_RUN_LATCHED: ⇒ chưa gửi có chứng minh" },
  { ten: "viChuaRaCuaLoi", nguon: "A1-7, A1-8", lyDo: "[MA] ở đuôi chữ ⇒ nguồn 'chưa ra'" },
  { ten: "laHangMaChuaRa", nguon: "A1-1", lyDo: "tiền tố FOE_STOP_NOT_SENT: ⇒ nợ STOP" },
  { ten: "laHangChuaRa", nguon: "A1-1, A1-2", lyDo: "nợ STOP / settled của hàng (vế chữ qua laHangMaChuaRa)" },
  { ten: "edgeHoldMarkOf", nguon: "A1-25", lyDo: "dấu EDGE_HELD(x): MARK: trong chữ ⇒ lời khuyên Continue/Abort" },
  { ten: "docAnomalyKhongRo", nguon: "A1-28", lyDo: "JSON trong detail của anomaly ⇒ báo cáo URGENT" },
  { ten: "dauKhongRoTuEdge", nguon: "A1-19", lyDo: "id bước/bù trừ của dấu held đọc từ chữ" },
  { ten: "laLoiCuaKhoa", nguon: "A1-20", lyDo: "mã trong chữ khối chứa ⇒ đi vào khối để nêu việc bị bỏ" },
  { ten: "standardCodeToReason", nguon: "A1-40", lyDo: "từ khoá trong mã báo động ⇒ loại Andon safety" },
  { ten: "decodeRobotMode", nguon: "A1-39", lyDo: "chữ dashboard UR ⇒ mode robot" },
];
const TEN_TRUNG_GIAN = new Set(HAM_TRUNG_GIAN.map((h) => h.ten));

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bộ quét AST
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChoKhop {
  tep: string;
  ham: string;
  dang: string;
  chu: string;
  dong: number; // CHỈ để báo, không thuộc khoá
}

/** Giá trị `const` cấp tệp (theo tên) của mọi tệp trong phạm vi: dùng để giải định danh ở L2. */
export type BangHang = Map<string, ts.Expression[]>;

export function gomHang(nguon: ReadonlyArray<{ tep: string; src: string }>): BangHang {
  const bang: BangHang = new Map();
  for (const { tep, src } of nguon) {
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const ds = bang.get(d.name.text) ?? [];
        ds.push(d.initializer);
        bang.set(d.name.text, ds);
      }
    }
  }
  return bang;
}

const boc = (e: ts.Expression): ts.Expression => {
  let x = e;
  for (;;) {
    if (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
    else return x;
  }
};

/** Định danh cuối của một biểu thức (bóc ngoặc, `!`, `as`, String(x), ??, ||, ?:, phép biến chữ). */
export function dinhDanhCuoi(e0: ts.Expression): string[] {
  const e = boc(e0);
  if (ts.isIdentifier(e)) return [e.text];
  if (ts.isPropertyAccessExpression(e)) return [e.name.text];
  if (ts.isElementAccessExpression(e)) return ts.isStringLiteralLike(e.argumentExpression) ? [e.argumentExpression.text] : [];
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return [...dinhDanhCuoi(e.left), ...dinhDanhCuoi(e.right)];
  }
  if (ts.isConditionalExpression(e)) return [...dinhDanhCuoi(e.whenTrue), ...dinhDanhCuoi(e.whenFalse)];
  if (ts.isCallExpression(e)) {
    const c = boc(e.expression);
    if (ts.isPropertyAccessExpression(c) && PHEP_BIEN_CHU.has(c.name.text)) return dinhDanhCuoi(c.expression);
    if (ts.isIdentifier(c) && c.text === "String" && e.arguments[0]) return dinhDanhCuoi(e.arguments[0]);
    if (ts.isIdentifier(c)) return [c.text];
    if (ts.isPropertyAccessExpression(c)) return [c.name.text];
  }
  return [];
}

const apTrenChu = (e: ts.Expression | undefined, tep: string): boolean =>
  !!e && (dinhDanhCuoi(e).some(laTenChu) || CAP_DINH_DANH.some((c) => c.tep === tep && c.dinhDanh === vanBanDich(e)));

const coTienTo = (s: string): boolean => {
  const t = s.trimStart();
  return TIEN_TO_HANG.some((p) => t.startsWith(p));
};
const regexCoTienTo = (re: string): boolean => /FOE_|EDGE_|\[\[A2N/.test(re.replace(/\\\[/g, "["));

/** L2: biểu thức có phải hằng chữ trạng thái (giải định danh qua bảng hằng, chống vòng). */
export function laHangTienTo(e0: ts.Expression, bang: BangHang, dangGiai: Set<string> = new Set()): boolean {
  const e = boc(e0);
  if (ts.isStringLiteralLike(e)) return coTienTo(e.text);
  if (ts.isRegularExpressionLiteral(e)) return regexCoTienTo(e.text);
  if (ts.isTemplateExpression(e)) {
    if (coTienTo(e.head.text)) return true;
    return e.head.text.trim() === "" && e.templateSpans.length > 0 && laHangTienTo(e.templateSpans[0].expression, bang, dangGiai);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return laHangTienTo(e.left, bang, dangGiai);
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => ts.isExpression(x) && laHangTienTo(x, bang, dangGiai));
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "RegExp" && e.arguments?.[0]) {
    return laHangTienTo(e.arguments[0], bang, dangGiai);
  }
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
    const ten = ts.isIdentifier(e) ? e.text : e.name.text;
    const ds = bang.get(ten);
    if (ds && !dangGiai.has(ten)) {
      dangGiai.add(ten);
      const r = ds.some((x) => laHangTienTo(x, bang, dangGiai));
      dangGiai.delete(ten);
      return r;
    }
    // Tên `FOE_*`/`EDGE_*` không giải được: chỉ tính khi là định danh TRẦN (hằng nhập từ ngoài). Thuộc tính (`process.env.FOE_ENABLED`,
    // `env.EDGE_RUNTIME_ENABLED`) là tên biến môi trường, không phải hằng chữ trạng thái.
    return !ds && ts.isIdentifier(e) && TEN_HANG_TIEN_TO.test(ten);
  }
  return false;
}

/** Chuẩn hoá đoạn chữ của khoá: bỏ mọi khoảng trắng, bỏ dấu phẩy treo (prettier thêm khi xuống dòng), tối đa 240 ký tự. */
export const chuanHoa = (s: string): string => s.replace(/\s+/g, "").replace(/,([)\]}])/g, "$1").slice(0, 240);

/** Tên hàm bao gần nhất có tên (lớp.phương thức khi là phương thức); hàm vô danh (callback) thì lấy hàm ngoài. */
export function hamBao(n: ts.Node): string {
  for (let c: ts.Node | undefined = n.parent; c; c = c.parent) {
    let ten: string | undefined;
    if (ts.isFunctionDeclaration(c) && c.name) ten = c.name.text;
    else if ((ts.isMethodDeclaration(c) || ts.isGetAccessorDeclaration(c) || ts.isSetAccessorDeclaration(c)) && ts.isIdentifier(c.name)) ten = c.name.text;
    else if (ts.isConstructorDeclaration(c)) ten = "constructor";
    else if (ts.isFunctionExpression(c) || ts.isArrowFunction(c)) {
      if (ts.isFunctionExpression(c) && c.name) ten = c.name.text;
      else if (ts.isVariableDeclaration(c.parent) && ts.isIdentifier(c.parent.name)) ten = c.parent.name.text;
      else if ((ts.isPropertyAssignment(c.parent) || ts.isPropertyDeclaration(c.parent)) && ts.isIdentifier(c.parent.name)) ten = c.parent.name.text;
    }
    if (ten === undefined) continue;
    for (let k: ts.Node | undefined = c.parent; k; k = k.parent) {
      if ((ts.isClassDeclaration(k) || ts.isClassExpression(k)) && k.name) return `${k.name.text}.${ten}`;
      if (ts.isFunctionLike(k)) break;
    }
    return ten;
  }
  return "(cap-tep)";
}

const laKhaiBaoHoacImport = (id: ts.Identifier): boolean => {
  const p = id.parent;
  if ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name === id) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  // `typeof ten` / `Parameters<typeof ten>` trong vị trí KIỂU: không chạy, không phải nơi gọi.
  for (let c: ts.Node | undefined = p; c; c = c.parent) {
    if (ts.isTypeNode(c)) return true;
    if (ts.isExpression(c) || ts.isStatement(c)) break;
  }
  return false;
};

/** Quét một tệp nguồn theo ba luật. */
export function quet(src: string, tep: string, bang: BangHang): ChoKhop[] {
  const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);
  const out: ChoKhop[] = [];
  const dong = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const them = (n: ts.Node, dang: string, chu: string): void => {
    out.push({ tep, ham: hamBao(n), dang, chu: chuanHoa(chu), dong: dong(n) });
  };
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const c = boc(n.expression);
      if (ts.isPropertyAccessExpression(c)) {
        const op = c.name.text;
        const nhan = c.expression;
        if (op === "parse" && ts.isIdentifier(boc(nhan)) && (boc(nhan) as ts.Identifier).text === "JSON") {
          if (apTrenChu(n.arguments[0], tep)) them(n, "JSON.parse", n.getText(sf));
        } else if (PHEP_TREN_NHAN.has(op)) {
          const l1 = apTrenChu(nhan, tep);
          const l2 = n.arguments.some((a) => laHangTienTo(a, bang)) || (ts.isArrayLiteralExpression(boc(nhan)) && laHangTienTo(nhan, bang));
          if (l1 || l2) them(n, `.${op}`, n.getText(sf));
        } else if (PHEP_TREN_DOI_SO.has(op)) {
          const l1 = apTrenChu(n.arguments[0], tep);
          const l2 = laHangTienTo(nhan, bang);
          if (l1 || l2) them(n, ts.isRegularExpressionLiteral(boc(nhan)) ? `/re/.${op}` : `re.${op}`, n.getText(sf));
        }
      }
    } else if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (
        (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken) &&
        (laHangTienTo(n.left, bang) || laHangTienTo(n.right, bang))
      ) {
        them(n, n.operatorToken.getText(sf), n.getText(sf));
      }
    } else if (ts.isCaseClause(n)) {
      if (laHangTienTo(n.expression, bang)) them(n, "case", `case ${n.expression.getText(sf)}`);
    } else if (ts.isIdentifier(n) && TEN_TRUNG_GIAN.has(n.text) && !laKhaiBaoHoacImport(n)) {
      const p = n.parent;
      const laCallee = (ts.isCallExpression(p) && p.expression === n) || (ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p);
      const goi = ts.isCallExpression(p) && p.expression === n ? p : ts.isPropertyAccessExpression(p) && ts.isCallExpression(p.parent) ? p.parent : undefined;
      them(n, `goi:${n.text}`, laCallee && goi ? goi.getText(sf) : `tham-chieu:${n.text}`);
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Danh sách đóng băng
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DongDongBang {
  tep: string;
  ham: string;
  dang: string;
  chu: string;
  /** Mã ô của bảng kiểm kê (A1-x, B-x, C-x, E-x, R-i/R-ii) hoặc MOI-x nếu bảng chưa có. */
  ma: string;
  lyDo: string;
  /** Chỉ còn cần cho tuyến complete/anomaly cũ (HST chọn phương án (B) ngày 14/11: giữ giao thức 2, thêm tuyến mới có cấu trúc). */
  nhan?: "tuyen-cu-chi";
}

/**
 * Mã MOI (bảng chưa có ô; đề xuất cho scada-master ghi vào bảng). Không dòng MOI nào quyết STOP / run:
 *  MOI-1  edgeConfigCentral: `code` có cấu trúc + `detail` của anomaly cấu hình (bảng: mục "Đã xem", không mã) · MOI-2 tệp đệm cấu hình của nút
 *  MOI-3  releaseAlert: `code` kiểu literal · MOI-4 quiesceRobot: khoá chống lặp cảnh báo · MOI-5 retireEdgeNode: chữ audit (vùng auth)
 *  MOI-6  tệp đệm edgeRuntime · MOI-7 JSON chuẩn tắc của gói đã ký · MOI-8 biến môi trường JOIN_STATIC_PEERS · MOI-9 giá trị json OPC UA
 *  MOI-10 OPC UA nối lại một lần khi chứng chỉ chưa tin · MOI-11 che URL đăng nhập trong chữ lỗi · MOI-12 tệp đánh dấu motion-lock
 *  MOI-13 nghiaVuKetThucNguoi: chữ hàng chỉ để ghi audit · MOI-14 edgeStreams warnOnce: chỉ log (bảng: Đã xem) · MOI-15 robotStopAuth: vùng auth (bảng: Đã xem)
 */
/** Mốc số dòng đóng băng: chỉ được GIẢM. */
const SO_DONG_MOC = 148;

const DONG_BANG: readonly DongDongBang[] = [
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "===", chu: "rec.code===EDGE_JOURNAL_STALL_RECOVERED_CODE", ma: "MOI-1", lyDo: "so `code` có cấu trúc của anomaly nút để chọn loại cảnh báo cấu hình (bảng: mục Đã xem, edgeConfigCentral)" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "!==", chu: "rec.code!==\"EDGE_SAFETY_CONFIG_MISSING\"", ma: "MOI-1", lyDo: "như trên: `code` có cấu trúc, chọn cảnh báo PLC an toàn thiếu cấu hình" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertForEdgeAnomaly", dang: "/re/.exec", chu: "/signedsafety-PLCconfig\\(s\\)([#0-9]+)/.exec(detail)", ma: "MOI-1", lyDo: "bảng Đã xem edgeConfigCentral.ts:235: id cấu hình trong detail chỉ chọn khoá chống trùng + câu URGENT" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertJournalStallRecovered", dang: "/re/.exec", chu: "/since(\\d+)/.exec(detail)", ma: "MOI-1", lyDo: "bảng Đã xem :272: `since` trong detail chỉ chọn khoá chống trùng của URGENT" },
  { tep: "server/services/edge/edgeConfigCentral.ts", ham: "alertJournalStallRecovered", dang: "/re/.test", chu: "/healthy=false/.test(detail)", ma: "MOI-1", lyDo: "bảng Đã xem :273: `healthy=` trong detail chỉ chọn câu URGENT (nút còn từ chối việc không phải STOP)" },
  { tep: "server/services/edge/edgeConfigSource.ts", ham: "openEdgeConfigCache", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "MOI-2", lyDo: "đọc tệp đệm cấu hình do chính nút ghi (phong bì AES-GCM có thẻ xác thực); hỏng ⇒ ném cache_format" },
  { tep: "server/services/edge/edgeCoordinator.ts", ham: "lyDoDongBoKhoa", dang: "goi:chotTuHang", chu: "chotTuHang(hang)", ma: "B-5", lyDo: "lyDoDongBoKhoa: chốt từ chữ hàng ⇒ từ chối syncRunResult/assignRun" },
  { tep: "server/services/edge/edgeCoordinator.ts", ham: "lyDoDongBoKhoa", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(hang,ctxasRecord<string,unknown>|null)", ma: "B-5", lyDo: "lyDoDongBoKhoa: nợ STOP từ chữ hàng ⇒ từ chối đồng bộ" },
  { tep: "server/services/edge/edgeGatewayRuntime.ts", ham: "releaseAlert", dang: "!==", chu: "code!==\"EDGE_DEVICE_RELEASED\"", ma: "MOI-3", lyDo: "`code` là kiểu hợp literal của chính hàm; chỉ chọn có in console.error" },
  { tep: "server/services/edge/edgeGatewayRuntime.ts", ham: "quiesceRobot", dang: ".split", chu: "(d.reason??\"?\").split(\":\")", ma: "MOI-4", lyDo: "mã lý do detach (có cấu trúc) ⇒ khoá chống lặp cảnh báo attach; không quyết STOP" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "parseLine", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "E-8", lyDo: "dòng journal JSONL do chính nút ghi; hỏng ⇒ JournalCorrupt (ném)" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "EdgeJournal.restore", dang: ".split", chu: "text.split(\"\\n\")", ma: "E-8", lyDo: "tách dòng tệp journal của nút; dòng hỏng ⇒ JournalCorrupt" },
  { tep: "server/services/edge/edgeJournal.ts", ham: "EdgeJournal.countUnreported", dang: ".split", chu: "text.split(\"\\n\")", ma: "E-10", lyDo: "như E-8: đếm bản ghi chưa báo từ tệp journal của nút" },
  { tep: "server/services/edge/edgeNodeCredentials.ts", ham: "retireEdgeNode", dang: ".replace", chu: "String((causeasError)?.message??cause).replace(/^edge_nodes:/,\"\")", ma: "MOI-5", lyDo: "vùng auth: chỉ bỏ tiền tố chữ của DB guard để ghi audit; quyết định do isEdgeControlRefusal (mã)" },
  { tep: "server/services/edge/edgeProgramReportRule.ts", ham: "edgeHoldMarkOf", dang: "/re/.exec", chu: "/^EDGE_HELD\\([A-Za-z]+\\):([A-Z_]+):/.exec(error??\"\")", ma: "A1-25", lyDo: "dấu EDGE_HELD(x): MARK: trong chữ end của nút ⇒ lời khuyên Continue/Abort", nhan: "tuyen-cu-chi" },
  { tep: "server/services/edge/edgeReportsCentral.ts", ham: "coTheDaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({status:st,detail:r.detail})", ma: "A1-21", lyDo: "bảng Đã xem edgeReportsCentral.ts:258: maTuChoiCua chỉ nhận status + detail.reason (có cấu trúc)" },
  { tep: "server/services/edge/edgeReportsCentral.ts", ham: "reportForNode", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(cu)", ma: "A1-11", lyDo: "hàng bước của nút: giữ chữ trạng thái C của trung tâm (laHangChuaRa trên cu.error)" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.upsertStep", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(patch.error)", ma: "A1-18", lyDo: "upsertStep của nút: mã không rõ trong chữ lỗi walker ⇒ daChot phía nút" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.baoCaoKetQua", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({status,detail:result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "bảng Đã xem edgeRunStore.ts:406: maTuChoiCua chỉ nhận status + detail (có cấu trúc)" },
  { tep: "server/services/edge/edgeRunStore.ts", ham: "EdgeRunStore.ketCucKhongRo", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(detail)", ma: "A1-28", lyDo: "nút đọc lại detail do chính nó soạn (chiTietAnomalyKhongRo) để giữ bản có cấu trúc cho rider" },
  { tep: "server/services/edge/edgeRuntime.ts", ham: "restoreBuffer", dang: ".split", chu: "raw.split(\"\\n\")", ma: "MOI-6", lyDo: "đọc tệp đệm của nút (JSONL do chính nút ghi); không quyết STOP/run" },
  { tep: "server/services/edge/edgeSigning.ts", ham: "parseEdgeCanonicalJson", dang: "JSON.parse", chu: "JSON.parse(text)", ma: "MOI-7", lyDo: "parse JSON chuẩn tắc của gói đã ký (kiểm chữ ký), có cấu trúc; hỏng ⇒ ném" },
  { tep: "server/services/edge/joinWizardService.ts", ham: "parseStaticPeers", dang: ".split", chu: "raw.split(\",\")", ma: "MOI-8", lyDo: "parse biến môi trường JOIN_STATIC_PEERS (cấu hình), không phải trạng thái an toàn" },
  { tep: "server/services/equipment/alarmNormalizer.ts", ham: "buildAndonInput", dang: "goi:standardCodeToReason", chu: "standardCodeToReason(normalized.standardCode)", ma: "A1-40", lyDo: "từ khoá trong mã báo động ⇒ loại Andon safety/maintenance" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(r.error)", ma: "A1-7", lyDo: "loadCompletedSteps (stopCoTheRa): [MA] ở đuôi chữ hàng ⇒ 'có thể đã ra' hay không" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-7", lyDo: "loadCompletedSteps: hàng trạng thái C (vế chữ qua laHangMaChuaRa) ⇒ dùng câu trả lời dispatcher" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-7", lyDo: "loadCompletedSteps: hàng trạng thái C ⇒ đưa vào stopCoTheRa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loadCompletedSteps", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "A1-14", lyDo: "loadCompletedSteps: chốt run từ mã trong chữ hàng (khongRoChotHang)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(rs.error)", ma: "A1-13", lyDo: "execStep (:1024 ở 2500736bc): FOE_NOT_SENT_RUN_LATCHED: ⇒ STOP pass gửi bước bị từ chối" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(rs.error)", ma: "A1-13", lyDo: "execStep (:1042 ở 2500736bc): chưa gửi có chứng minh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execStep", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(rs.error)", ma: "A1-15", lyDo: "execStep (:1029 ở 2500736bc): cờ khongRo từ chữ resume ⇒ bù trừ qua n3" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: ".includes", chu: "e.includes(`${FOE_NOT_SENT_RUN_LATCHED}:`)", ma: "A1-20", lyDo: "laLoiCuaKhoa: mã trong chữ khối chứa ⇒ có lời cuối riêng hay đi vào khối" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: ".includes", chu: "e.includes(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-20", lyDo: "như trên, mã FOE_STOP_NOT_SENT" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "laLoiCuaKhoa", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(e)", ma: "A1-20", lyDo: "như trên, mã không rõ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loiRieng", dang: "goi:laLoiCuaKhoa", chu: "laLoiCuaKhoa(resumeStateOf(rc,s.id)?.error)", ma: "A1-20", lyDo: "loiRieng: đọc chữ resume state của khối chứa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "loiRieng", dang: "goi:laLoiCuaKhoa", chu: "laLoiCuaKhoa(r.error)", ma: "A1-20", lyDo: "loiRieng: đọc chữ hàng của khối chứa" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "guiStopSauChot", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(hangNo?.error)", ma: "A1-7", lyDo: "nhánh plan.notPinned (:1670-1676 ở 2500736bc): [MA] của hàng nợ ⇒ 'có thể đã ra'" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viTuKetQuaHang", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r?.error??null,status:typeofkq.status===\"string\"?kq.status:null,detail:(kq.detail??null)as{reason?:unknown}|null})", ma: "A1-21", lyDo: "viTuKetQuaHang (:1813 ở 2500736bc): tuChoi/driverLoi từ mã đầu chữ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "giuStopChuaRa", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi((src?.hang??[]).find((r)=>r.stepId===id)?.error)", ma: "A1-8", lyDo: "giuStopChuaRa: [MA] của hàng ⇒ chữ lỗi run và URGENT khi còn nợ STOP" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "nghiaVuKetThucNguoi", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "MOI-13", lyDo: "nghiaVuKetThucNguoi: mã không rõ trong chữ hàng chỉ để ghi danh sách vào audit, không quyết định" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "nghiaVuKetThucNguoi", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(r.error)", ma: "MOI-13", lyDo: "nghiaVuKetThucNguoi: tiền tố FOE_NOT_SENT_RUN_LATCHED chỉ để ghi forwardDropped vào audit" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "baoKetCucKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(a.error)", ma: "A1-30", lyDo: "baoKetCucKhongRo (`biet`): chọn chữ URGENT known/unknown" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "ketCucLenhFoe", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua(result)", ma: "A1-32", lyDo: "ketCucLenhFoe: mã 'có thể đã bay' (đọc cả error robot) ⇒ chống gửi lại" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execCommandMot", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:auth.error})", ma: "A1-21", lyDo: "execCommandMot (:3230 ở 2500736bc): mã từ chối của /authorize" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "execCommandMot", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:result.error,status:result.status,detail:result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "execCommandMot (:3337 ở 2500736bc): tuChoi/driverLoi của kết quả lệnh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resumeRun", dang: "goi:chotTuHang", chu: "chotTuHang(((awaitreadRunStepRows(runId))??[])asParameters<typeofchotTuHang>[0])", ma: "B-4", lyDo: "resumeRun: hệ thống từ chối (QT pump) không kết thúc run đã chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resumeRun", dang: "goi:chotTuHang", chu: "chotTuHang(derivedRows,resume)", ma: "A1-14", lyDo: "resumeRun: chốt vượt biên đoạn ở mỗi lần trao lại (chotTuHang trên hàng suy ra)" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resendAbortStops", dang: "goi:chotTuHang", chu: "chotTuHang(hang)", ma: "B-6", lyDo: "resendAbortStops (`biet`): chốt từ chữ hàng ⇒ gửi lại STOP còn nợ" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "resendAbortStops", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(hang??[],ctxRun)", ma: "B-6", lyDo: "resendAbortStops: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error})", ma: "A1-21", lyDo: "viAbortChuaRa (:6543-6545 ở 2500736bc): tuChoi/driverLoi của STOP Abort" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error})", ma: "A1-21", lyDo: "như trên" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "viAbortChuaRa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.result.error,status:r.result.status,detail:r.result.detailas{reason?:unknown}|null|undefined})", ma: "A1-21", lyDo: "như trên, kết quả lệnh" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: ".startsWith", chu: "String(r.error??\"\").startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-10", lyDo: "noSauAbortKhoa (:6603 ở 2500736bc): hàng abort: failed có tiền tố FOE_STOP_NOT_SENT ⇒ URGENT" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error,status:typeofkq.status===\"string\"?kq.status:null,detail:(kq.detail??null)as{reason?:unknown}|null})", ma: "A1-21", lyDo: "noSauAbortKhoa (:6606 ở 2500736bc): tuChoi/driverLoi" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noSauAbortKhoa", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-9", lyDo: "noSauAbortKhoa (:6624 ở 2500736bc): hàng trạng thái C ⇒ báo nợ STOP" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "noKetThucKhongQuet", dang: "goi:chotTuHang", chu: "chotTuHang((src?.hang??[])asParameters<typeofchotTuHang>[0])", ma: "B-8", lyDo: "noKetThucKhongQuet: chốt từ chữ hàng ⇒ đường run chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:chotTuHang", chu: "chotTuHang((src?.hang??[])asParameters<typeofchotTuHang>[0])", ma: "B-9", lyDo: "runAbortStopSweep `khoa`: chốt từ chữ hàng ⇒ bộ lập kế hoạch run chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:chotTuHang", chu: "chotTuHang((src.hang??[])asParameters<typeofchotTuHang>[0])", ma: "B-10", lyDo: "runAbortStopSweep hoChuaKhoa: R-6-b khi không chốt" },
  { tep: "server/services/orchestration/foe/foeEngine.ts", ham: "runAbortStopSweep", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(src.hang??[],ctxRun)", ma: "A1-3", lyDo: "runAbortStopSweep noDaBen: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiLaKetCucKhongRo", dang: "re.test", chu: "RE_KHONG_RO.test(error)", ma: "A1-14", lyDo: "thân loiLaKetCucKhongRo: RE_KHONG_RO trên chữ (khớp theo từ ở bất kỳ đâu)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "maKetCucKhongRoCua", dang: "re.exec", chu: "RE_KHONG_RO.exec(error)", ma: "A1-29", lyDo: "maKetCucKhongRoCua: chỉ chọn mã hiển thị FOE/EDGE" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiCoMaKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-14", lyDo: "loiCoMaKhongRo (nơi soạn): không ghép mã hai lần" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "dauKetCucKhongRoCua", dang: "===", chu: "d.ma===\"EDGE_OUTCOME_UNKNOWN\"", ma: "E-28", lyDo: "dauKetCucKhongRoCua đọc `ma` CÓ CẤU TRÚC của ctx; lạ ⇒ FOE_OUTCOME_UNKNOWN (fail-closed)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buTruKhongRoCho", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(typeofe.error===\"string\"?e.error:null)", ma: "A1-16", lyDo: "buTruKhongRoCho: chữ lỗi trong resume state ⇒ kiểm n3" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "runDaChotKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(typeofe?.error===\"string\"?e.error:null)", ma: "A1-16", lyDo: "runDaChotKhongRo: chữ lỗi trong resume state ⇒ chốt" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "chotTuHang", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(x.error)", ma: "A1-14", lyDo: "thân chotTuHang: chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "xacNhanHetChot", dang: ".startsWith", chu: "r.error.startsWith(DAU_KHONG_GUI_CHOT)", ma: "A1-13", lyDo: "xacNhanHetChot (:287 ở 2500736bc): DAU_KHONG_GUI_CHOT ⇒ cần URGENT hay không" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "xacNhanHetChot", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-13", lyDo: "xacNhanHetChot (:290): hàng lệnh chưa final có mã không rõ ⇒ vẫn cần xác nhận" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buocCoTheDaBayTuHang", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-17", lyDo: "buocCoTheDaBayTuHang: mã không rõ ⇒ bước có thể đã bay" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "nhanBuocSauChot", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(x.error)", ma: "A1-17", lyDo: "nhanBuocSauChot (:332): không bao giờ gắn nhãn chưa gửi khi có mã" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "nhanBuocSauChot", dang: ".startsWith", chu: "x.error.startsWith(DAU_KHONG_GUI_CHOT)", ma: "A1-13", lyDo: "nhanBuocSauChot (:336): DAU_KHONG_GUI_CHOT ⇒ nhãn chuaGui" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "buTruBiChanKhongRo", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "B-13", lyDo: "buTruBiChanKhongRo (/authorize): chốt từ chữ hàng ⇒ từ chối uỷ quyền bù trừ" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiGiuBuTruKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(stepError)", ma: "A1-19", lyDo: "loiGiuBuTruKhongRo (nơi SOẠN chữ held): mã trong chữ bước chỉ chọn câu (STOP thân)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "loiGiuBuTruKhongRo", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(stepError)", ma: "A1-19", lyDo: "loiGiuBuTruKhongRo: như trên (m-K, lỗi đã biết không nói không rõ)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "maTuChoiCua", dang: "/re/.exec", chu: "/^[A-Z][A-Z0-9_]{2,63}(?=$|[:\\s(])/.exec(r.error??\"\")", ma: "A1-21", lyDo: "thân maTuChoiCua: mã đầu chữ lỗi khi detail.reason không phải mã" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "viChuaRaCuaLoi", dang: "/re/.exec", chu: "/(refusedbeforeadriver|mayhavegoneout|nobodycoulddecideit)\\[([A-Za-z0-9_]{1,64})\\]/.exec(String(error??\"\"))", ma: "A1-7", lyDo: "thân viChuaRaCuaLoi: [MA] ở đuôi chữ (dùng cả cho A1-8)" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docAnomalyKhongRo", dang: "JSON.parse", chu: "JSON.parse(String(detail??\"\"))", ma: "A1-28", lyDo: "thân docAnomalyKhongRo: JSON trong detail của anomaly", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docAnomalyKhongRo", dang: "===", chu: "v.ma===\"EDGE_OUTCOME_UNKNOWN\"", ma: "A1-28", lyDo: "docAnomalyKhongRo: kiểm `ma` sau khi parse", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "canhBaoTuAnomalyEdge", dang: "!==", chu: "rec.code!==KHONG_RO_EDGE_ANOMALY", ma: "A1-28", lyDo: "canhBaoTuAnomalyEdge: `code` có cấu trúc của anomaly", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "canhBaoTuAnomalyEdge", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(rec.detail)", ma: "A1-28", lyDo: "canhBaoTuAnomalyEdge: detail anomaly ⇒ URGENT", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "ganBaoCaoKhongRoEdge", dang: ".startsWith", chu: "e.startsWith(DAU_DS_KHONG_RO_EDGE)", ma: "A1-24", lyDo: "ganBaoCaoKhongRoEdge (nút): giữ nguyên danh sách khi ghép rider", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".startsWith", chu: "error.startsWith(DAU_DS_KHONG_RO_EDGE)", ma: "A1-22", lyDo: "docDsKhongRoEdge: tiền tố EDGE_OUTCOME_UNKNOWN( trong chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".indexOf", chu: "error.indexOf(CUOI_DS_KHONG_RO_EDGE,DAU_DS_KHONG_RO_EDGE.length)", ma: "A1-22", lyDo: "docDsKhongRoEdge: dấu cuối danh sách", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".indexOf", chu: "error.indexOf(\")\",DAU_DS_KHONG_RO_EDGE.length)", ma: "A1-22", lyDo: "docDsKhongRoEdge: ')' cuối danh sách", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "docDsKhongRoEdge", dang: ".split", chu: "error.slice(DAU_DS_KHONG_RO_EDGE.length,j>=0?j:k>=0?k:error.length).split(\",\")", ma: "A1-22", lyDo: "docDsKhongRoEdge: tách id theo ','", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: ".endsWith", chu: "error.endsWith(BAO_CAO_CUOI)", ma: "A1-24", lyDo: "tachBaoCaoKhongRoEdge: đuôi rider ]]", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: "JSON.parse", chu: "JSON.parse(error.slice(i+(thieu?BAO_CAO_DAU_THIEU:BAO_CAO_DAU).length,-BAO_CAO_CUOI.length))", ma: "R-i", lyDo: "tachBaoCaoKhongRoEdge: JSON.parse rider sau lastIndexOf dấu ⇒ id STOP chứa dấu làm hỏng (R-i)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeKetCucKhongRo.ts", ham: "tachBaoCaoKhongRoEdge", dang: "goi:docAnomalyKhongRo", chu: "docAnomalyKhongRo(JSON.stringify(x))", ma: "A1-24", lyDo: "tachBaoCaoKhongRoEdge: lọc báo cáo qua docAnomalyKhongRo", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "priorStepsOf", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r)", ma: "A1-2", lyDo: "priorStepsOf: hàng trạng thái C ⇒ không settled" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laLoiKhongGuiChot", dang: ".startsWith", chu: "error.startsWith(`${FOE_NOT_SENT_RUN_LATCHED}:`)", ma: "A1-13", lyDo: "thân laLoiKhongGuiChot: tiền tố FOE_NOT_SENT_RUN_LATCHED:" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangMaChuaRa", dang: ".startsWith", chu: "r.error.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-1", lyDo: "thân laHangMaChuaRa: tiền tố FOE_STOP_NOT_SENT: ⇒ nợ STOP" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangChuaRa", dang: "goi:laHangMaChuaRa", chu: "laHangMaChuaRa(r,id)", ma: "A1-1", lyDo: "laHangChuaRa: vế chữ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "laHangChuaRa", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua({ok:false,detail:(kq.detail??undefined)asRecord<string,unknown>|undefined})", ma: "A1-1", lyDo: "laHangChuaRa vế 2 (bảng Đã xem :412-416): chỉ resultJson.detail, có cấu trúc" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:chotTuHang", chu: "chotTuHang(rows??[])", ma: "B-12", lyDo: "stopChuaRaTuHang `khoa`: chốt từ chữ hàng ⇒ hàng bị từ chối / abort: failed là nợ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:laHangMaChuaRa", chu: "laHangMaChuaRa(r,id)", ma: "A1-3", lyDo: "stopChuaRaTuHang `coMa`: nợ STOP qua mã" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "stopChuaRaTuHang", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r,id)", ma: "A1-3", lyDo: "stopChuaRaTuHang: nợ STOP qua laHangChuaRa" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:maTuChoiCua", chu: "maTuChoiCua({error:r.error,status:typeofkq.status===\"string\"?kq.status:null,detail})", ma: "A1-21", lyDo: "dauVetCuaHang (foeRunStore.ts:491 ở 2500736bc): tuChoi/driverLoi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:coTheDaBayCua", chu: "coTheDaBayCua({ok:false,detail:detailasRecord<string,unknown>|undefined})", ma: "A1-4", lyDo: "dauVetCuaHang: 'có thể đã bay' (chỉ detail, có cấu trúc)" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:laHangChuaRa", chu: "laHangChuaRa(r,id)", ma: "A1-4", lyDo: "dauVetCuaHang: hàng trạng thái C" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauVetCuaHang", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(r.error)", ma: "A1-13", lyDo: "dauVetCuaHang (:495 ở 2500736bc): chưa gửi có chứng minh" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "phanLoaiStopAbort", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(vao.hang,vao.ctx)", ma: "A1-3", lyDo: "phanLoaiStopAbort (A1-6) lấy nợ STOP qua stopChuaRaTuHang" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:chotTuHang", chu: "chotTuHang(rows)", ma: "A1-14", lyDo: "quyetDinhKetThucAnh: chốt từ chữ hàng ⇒ URGENT cuối run" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,x.ctx)", ma: "A1-3", lyDo: "quyetDinhKetThucAnh: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quyetDinhKetThucAnh", dang: "goi:viChuaRaCuaLoi", chu: "viChuaRaCuaLoi(rows.find((r)=>r.stepId===id0)?.error)", ma: "A1-8", lyDo: "quyetDinhKetThucAnh (:709 ở 2500736bc): [MA] ⇒ chữ nợ, VI_KHONG_BAO dự phòng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "quetMotRun", dang: "goi:chotTuHang", chu: "chotTuHang(hang,ctx[RESUME_STATE_CTX_KEY]asParameters<typeofchotTuHang>[1])", ma: "A1-14", lyDo: "quetMotRun (quét URGENT run_end): chốt từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "liveSweepSource", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,rc.context)", ma: "A1-3", lyDo: "liveSweepSource: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "storedSweepSource", dang: "goi:stopChuaRaTuHang", chu: "stopChuaRaTuHang(rows,context)", ma: "A1-3", lyDo: "storedSweepSource: nợ STOP từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeOutcomeUnknownOf", dang: "goi:docDsKhongRoEdge", chu: "docDsKhongRoEdge(end.error,commands)", ma: "A1-22", lyDo: "edgeOutcomeUnknownOf (chỉ test gọi ở 27f9b47ac): danh sách từ chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "tapKhongRoEdge", dang: "goi:docDsKhongRoEdge", chu: "docDsKhongRoEdge(x.error,lenh)", ma: "A1-22", lyDo: "tapKhongRoEdge: vế chữ của HỢP (chữ ∪ hàng + sổ)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "dauKhongRoTuEdge", dang: "/re/.exec", chu: "/(?:command|step)\"([^\"]{1,128})\"(?:outcomeunknown|failed;anothercommand'soutcomeisunknown)—machinestateunknown—compensation\"([^\"]{1,128})\"/.exec(end.error??\"\")", ma: "A1-19", lyDo: "dauKhongRoTuEdge: id bước/bù trừ của dấu held từ chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "themBuocHongKhiTiepTuc", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-15", lyDo: "themBuocHongKhiTiepTuc: cờ khongRo từ chữ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-25", lyDo: "heldAdvice: tiền tố FOE_STOP_NOT_SENT ⇒ lời khuyên Abort", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "goi:edgeHoldMarkOf", chu: "edgeHoldMarkOf(error)", ma: "A1-25", lyDo: "heldAdvice: dấu overrun/unused của nút", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "===", chu: "mark===EDGE_HOLD_CONSUME_OVERRUN", ma: "A1-25", lyDo: "heldAdvice: so dấu EDGE_HOLD_CONSUME_OVERRUN", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "heldAdvice", dang: "===", chu: "mark===EDGE_HOLD_UNUSED_NOT_REPORTED", ma: "A1-25", lyDo: "heldAdvice: so dấu EDGE_HOLD_UNUSED_NOT_REPORTED", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "applyEdgeSegmentEnd", dang: "goi:tachBaoCaoKhongRoEdge", chu: "tachBaoCaoKhongRoEdge(endTho.error,(x)=>x.claimSeq===endTho.claimSeq&&baoCaoHopLe(endTho.def,x))", ma: "A1-24", lyDo: "applyEdgeSegmentEnd: tách rider khỏi chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "khongRoCuaDoan", dang: "goi:tapKhongRoEdge", chu: "tapKhongRoEdge({def:end.def,error:end.error,outcomeUnknown:end.outcomeUnknown,catDay:(endTho.error?.length??0)>=TRAN_LOI_EDGE,thieu:riderThieu===true,rows:hangKr,uyQuyen,stops})", ma: "B-1", lyDo: "khongRoCuaDoan: nguồn foeOutcomeUnknown của ctx (tapKhongRoEdge, vế chữ = A1-22)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-26", lyDo: "held (loiHien): tiền tố ⇒ chữ trung tâm hay chữ nút", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: ".startsWith", chu: "error?.startsWith(`${FOE_STOP_NOT_SENT}:`)", ma: "A1-27", lyDo: "held: tiền tố ⇒ dấu KET_CUC_KHONG_RO (Continue cần người)", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "held", dang: "goi:dauKhongRoTuEdge", chu: "dauKhongRoTuEdge(end,at,baoKhongRo)", ma: "A1-19", lyDo: "held: dấu không rõ từ chữ end", nhan: "tuyen-cu-chi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(r.error)", ma: "A1-15", lyDo: "edgeResumeStateOf (:2225 ở 2500736bc): cờ khongRo từ chữ hàng" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(error)", ma: "A1-15", lyDo: "edgeResumeStateOf (:2246): cờ khongRo từ chữ lỗi" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:loiLaKetCucKhongRo", chu: "loiLaKetCucKhongRo(c?.error)", ma: "A1-15", lyDo: "edgeResumeStateOf: cờ khongRo từ chữ bù trừ" },
  { tep: "server/services/orchestration/foe/foeRunStore.ts", ham: "edgeResumeStateOf", dang: "goi:laLoiKhongGuiChot", chu: "laLoiKhongGuiChot(error)", ma: "A1-13", lyDo: "edgeResumeStateOf (:2249): compensationHeld / doneFailed" },
  { tep: "server/services/ot/commandDispatcher.ts", ham: "hangThietBi", dang: "goi:maTienTo", chu: "maTienTo(r.errorText)", ma: "A1-33", lyDo: "hangThietBi: mã đầu errorText ⇒ hàng thiết bị hay không gửi" },
  { tep: "server/services/ot/commandDispatcher.ts", ham: "ketQuaPhatLai", dang: "goi:maTienTo", chu: "maTienTo(existing.errorText)", ma: "A1-34", lyDo: "ketQuaPhatLai: reason phát lại từ mã đầu errorText" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.readOne", dang: "goi:laQuaHanThuVienEip", chu: "laQuaHanThuVienEip(err)", ma: "A1-37", lyDo: "readOne: chữ lỗi thư viện EIP ⇒ phiên nhiễm" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.writeOne", dang: "goi:laQuaHanThuVienEip", chu: "laQuaHanThuVienEip(err)", ma: "A1-37", lyDo: "writeOne: chữ lỗi thư viện EIP ⇒ phiên nhiễm" },
  { tep: "server/services/ot/drivers/ethernetIpDriver.ts", ham: "EthernetIpDriver.writeOne", dang: "goi:laQuaHanGhiEip", chu: "laQuaHanGhiEip(err)", ma: "A1-37", lyDo: "writeOne: chữ lỗi thư viện EIP ⇒ kết cục ghi không rõ" },
  { tep: "server/services/ot/drivers/opcuaAddress.ts", ham: "normalizeOpcuaValue", dang: "JSON.parse", chu: "JSON.parse(raw)", ma: "MOI-9", lyDo: "giá trị kiểu json của thẻ OPC UA (dữ liệu, không phải lỗi); hỏng ⇒ quality bad" },
  { tep: "server/services/ot/drivers/opcuaDriver.ts", ham: "OpcuaDriver.connect", dang: "/re/.test", chu: "/BadCertificateUntrusted|certificateverificationfail/i.test((errasError)?.message??\"\")", ma: "MOI-10", lyDo: "chữ lỗi node-opcua khi NỐI (chứng chỉ chưa tin) ⇒ quét lại trust-list, thử nối lại đúng một lần" },
  { tep: "server/services/robot/deviceOwnershipService.ts", ham: "errText", dang: ".replace", chu: "String((easError)?.message??e).replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "che thông tin đăng nhập trong URL của chữ lỗi (hiển thị)" },
  { tep: "server/services/robot/robotCommandDispatcher.ts", ham: "safeDbError", dang: ".replace", chu: "raw.replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "như trên" },
  { tep: "server/services/robot/robotMotionLockStore.ts", ham: "errText", dang: ".replace", chu: "raw.replace(/([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/@]*@/gi,\"$1***@\")", ma: "MOI-11", lyDo: "như trên" },
  { tep: "server/services/robot/robotMotionLockStore.ts", ham: "readLockPersistPending", dang: "JSON.parse", chu: "JSON.parse(raw)", ma: "MOI-12", lyDo: "tệp đánh dấu motion-lock do chính tiến trình ghi; hỏng ⇒ unreadable" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "decodeRobotMode", dang: ".includes", chu: "raw.includes(\"POWER_OFF\")", ma: "A1-39", lyDo: "decodeRobotMode: chữ dashboard UR ⇒ mode" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "UrsimBridgeDriver.getState", dang: "goi:decodeRobotMode", chu: "decodeRobotMode(modeReply)", ma: "A1-39", lyDo: "getState: mode robot UR từ chữ dashboard" },
  // lượt 2 (scada-master 14/11): `msg` + L1-CẶP
  { tep: "server/services/edge/edgeExecutionAgent.ts", ham: "EdgeExecutionAgent.pullOnce", dang: ".includes", chu: "r.outcome.includes(\"pending:\")", ma: "A1-41", lyDo: "outcome `pending:` (hằng của agent) ⇒ hoãn STOP sang pha làm việc" },
  { tep: "server/services/edge/edgeStreams.ts", ham: "EdgeStreamShipper.warnOnce", dang: ".includes", chu: "msg.includes(\"ANOMALY\")", ma: "MOI-14", lyDo: "bảng Đã xem edgeStreams.ts:272: chỉ chọn có ghi log hay không" },
  { tep: "server/services/ot/drivers/opcuaDriver.ts", ham: "OpcuaDriver.writeTags", dang: ".startsWith", chu: "msg.startsWith(OPCUA_TIEN_TO_QUA_HAN)", ma: "A1-35", lyDo: "chữ lỗi node-opcua `Transaction has timed out` ⇒ qua_han_driver (không rõ) hay failed" },
  { tep: "server/services/ot/drivers/opcuaSecurity.ts", ham: "explainOpcuaConnectError", dang: "/re/.test", chu: "/BadCertificateUntrusted|certificateverificationfailed/i.test(msg)", ma: "E-41", lyDo: "chỉ chọn câu giải thích lỗi kết nối (chứng chỉ chưa tin)" },
  { tep: "server/services/ot/drivers/opcuaSecurity.ts", ham: "explainOpcuaConnectError", dang: "/re/.test", chu: "/End?pointmustexist|cannotfindendpoint/i.test(msg)", ma: "E-40", lyDo: "chỉ chọn câu giải thích lỗi kết nối (endpoint None)" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: ".indexOf", chu: "frame.data.indexOf(\",\")", ma: "A1-38", lyDo: "id / kết quả trong khung TMSCT ⇒ ok / tm_reply_id_mismatch / tm_reply_unexpected" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "/re/.exec", chu: "/^OK((?:;\\d+)+)$/.exec(result)", ma: "A1-38", lyDo: "kết quả TMSCT `OK;…` ⇒ ok kèm cảnh báo" },
  { tep: "server/services/robot/drivers/techmanDriver.ts", ham: "classifyTmsctReply", dang: "/re/.test", chu: "/^ERROR(;|$)/.test(result)", ma: "A1-38", lyDo: "kết quả TMSCT `ERROR` ⇒ tm_script_error" },
  { tep: "server/services/robot/robotStopAuth.ts", ham: "refusalAsTrpc", dang: "/re/.test", chu: "/MUST_CHANGE_PASSWORD/.test(msg)", ma: "MOI-15", lyDo: "bảng Đã xem robotStopAuth.ts:152: vùng auth, chỉ đổi mã lỗi tRPC" },
  { tep: "server/services/robot/ursim/ursimClient.ts", ham: "UrsimClient.isProgramRunning", dang: "/re/.test", chu: "/true/i.test(reply)", ma: "A1-39", lyDo: "`/true/i` trên chữ dashboard `running` ⇒ busy (lỗi không chứa true ⇒ rảnh)" },
  { tep: "server/services/robot/ursimBridge.ts", ham: "UrsimBridgeDriver.getState", dang: "/re/.test", chu: "/EMERGENCY_STOP|PROTECTIVE_STOP/i.test(safety)", ma: "A1-39", lyDo: "chữ dashboard `safetystatus` ⇒ estop (chữ lạ hoặc ném ⇒ false)" },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const khoa = (x: { tep: string; ham: string; dang: string; chu: string }): string => `${x.tep} | ${x.ham} | ${x.dang} | ${x.chu}`;

function demTheoKhoa<T extends { tep: string; ham: string; dang: string; chu: string }>(ds: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of ds) {
    const k = khoa(x);
    const a = m.get(k) ?? [];
    a.push(x);
    m.set(k, a);
  }
  return m;
}

/**
 * Tệp NGOÀI phạm vi mà tệp trong phạm vi import trực tiếp (đường tương đối hoặc `@shared/`), MỘT tầng: chỉ để giải giá trị `const`
 * ở L2 (ví dụ `FOE_ENGINE_TOOL = "foe.orchestration"` ở `ot/otActionBinding.ts` không phải hằng chữ trạng thái). Không quét các tệp này.
 */
export function tepNhapNgoai(nguon: ReadonlyArray<{ tep: string; src: string }>): string[] {
  const trong = new Set(nguon.map((n) => n.tep));
  const ra = new Set<string>();
  for (const { tep, src } of nguon) {
    const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, false);
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
      const m = st.moduleSpecifier;
      if (!m || !ts.isStringLiteral(m)) continue;
      const s = m.text;
      let goc: string | undefined;
      if (s.startsWith("./") || s.startsWith("../")) goc = resolve(GOC, tep, "..", s);
      else if (s.startsWith("@shared/")) goc = resolve(GOC, "shared", s.slice("@shared/".length));
      if (!goc) continue;
      for (const ung of [`${goc}.ts`, resolve(goc, "index.ts"), goc.replace(/\.js$/, ".ts")]) {
        if (!existsSync(ung) || !statSync(ung).isFile()) continue;
        const rel = relative(GOC, ung).replace(/\\/g, "/");
        if (!trong.has(rel)) ra.add(rel);
        break;
      }
    }
  }
  return [...ra].sort();
}

function quetPhamVi(): { tep: string[]; khop: ChoKhop[] } {
  const tep = tepTrongPhamVi();
  const nguon = tep.map((t) => ({ tep: t, src: docNguon(t) }));
  const bang = gomHang([...nguon, ...tepNhapNgoai(nguon).map((t) => ({ tep: t, src: docNguon(t) }))]);
  return { tep, khop: nguon.flatMap(({ tep: t, src }) => quet(src, t, bang)) };
}

const dongGoiY = (x: ChoKhop): string =>
  `  { tep: ${JSON.stringify(x.tep)}, ham: ${JSON.stringify(x.ham)}, dang: ${JSON.stringify(x.dang)}, chu: ${JSON.stringify(x.chu)}, ma: "?", lyDo: "?" }, // :${x.dong}`;

describe("census — chữ không phải trạng thái (central/edge)", () => {
  const { tep, khop } = quetPhamVi();

  it("phạm vi quét không rỗng (glob rỗng ⇒ census mù) và mỗi gốc có tệp", () => {
    expect(tep.length, "số tệp trong phạm vi").toBeGreaterThanOrEqual(100);
    for (const g of GOC_QUET) expect(tep.some((t) => t.startsWith(`${g}/`)), `gốc ${g} không có tệp nào`).toBe(true);
    expect(tep).toContain("server/services/ot/commandDispatcher.ts");
    expect(tep.some((t) => /\.test\.ts$|\.testkit\.ts$/.test(t) || t.split("/").some((p) => p.startsWith("__"))), "lọt tệp test/testkit/__").toBe(false);
    const tatCa = tep.map(docNguon).join("\n");
    for (const h of HAM_TRUNG_GIAN) expect(new RegExp(`\\b${h.ten}\\b`).test(tatCa), `hàm trung gian ${h.ten} không còn trong phạm vi ⇒ sửa HAM_TRUNG_GIAN`).toBe(true);
  });

  it("mọi chỗ khớp có dòng đóng băng", () => {
    const dongBang = demTheoKhoa(DONG_BANG);
    const thua: ChoKhop[] = [];
    for (const [k, ds] of demTheoKhoa(khop)) {
      const n = dongBang.get(k)?.length ?? 0;
      if (ds.length > n) thua.push(...ds.slice(n));
    }
    expect(thua.length, `chỗ khớp CHƯA có dòng đóng băng (${thua.length}):\n${thua.map(dongGoiY).join("\n")}`).toBe(0);
  });

  it("mọi dòng đóng băng còn chỗ khớp (dòng mồ côi ⇒ xoá khỏi danh sách)", () => {
    const thay = demTheoKhoa(khop);
    const moCoi: string[] = [];
    for (const [k, ds] of demTheoKhoa(DONG_BANG)) {
      const n = thay.get(k)?.length ?? 0;
      for (let i = n; i < ds.length; i += 1) moCoi.push(`xoá dòng ${ds[i].ma} [${k}] khỏi danh sách`);
    }
    expect(moCoi, moCoi.join("\n")).toEqual([]);
  });

  it(`số dòng đóng băng không vượt mốc SO_DONG_MOC (chỉ được giảm)`, () => {
    expect(DONG_BANG.length, `danh sách có ${DONG_BANG.length} dòng > mốc ${SO_DONG_MOC}`).toBeLessThanOrEqual(SO_DONG_MOC);
  });

  it("mỗi dòng đóng băng có mã bảng hợp lệ, lý do, nhãn hợp lệ", () => {
    for (const d of DONG_BANG) {
      expect(d.ma, khoa(d)).toMatch(/^(A1-\d+|B-\d+[a-g]?|C-\d+|E-\d+|R-ii?|MOI-\d+)$/);
      expect(d.lyDo.trim().length, `thiếu lý do: ${khoa(d)}`).toBeGreaterThan(5);
      if (d.nhan !== undefined) expect(d.nhan).toBe("tuyen-cu-chi");
    }
  });
});

describe("bộ quét — bắt đúng dạng, kể cả xuống dòng và optional chaining", () => {
  const f = "server/x.ts";
  const q = (s: string, hang = "") => {
    const bang = gomHang([{ tep: "server/hang.ts", src: hang }]);
    return quet(s, f, bang);
  };

  it("L1: phép gọi xuống dòng và optional chaining", () => {
    const ds = q('function f(e: any) {\n  if (e\n    ?.message\n    ?.startsWith(\n      "X",\n    )) return 1;\n}');
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ ham: "f", dang: ".startsWith", chu: 'e?.message?.startsWith("X")', dong: 2 });
    expect(q('const g = (err: any) => err?.includes?.("x");')).toHaveLength(1);
    expect(q("const g = (r: any) => r.error!.toLowerCase().split(',');")[0]).toMatchObject({ ham: "g", dang: ".split" });
    expect(q("const g = (o: any) => String(o.detail ?? '').indexOf('a');")).toHaveLength(1);
    expect(q("const g = (loiHien: string) => loiHien.endsWith('a');")).toHaveLength(1);
    expect(q("const g = (rawLine: string) => rawLine.replace(/a/g, '');")).toHaveLength(1);
  });

  it("L1: regex .test/.exec và JSON.parse áp trên đối số", () => {
    expect(q("const g = (e: any) => /x/.test(\n  e?.message ?? '',\n);")[0]).toMatchObject({ dang: "/re/.test", chu: "/x/.test(e?.message??'')" });
    expect(q("const RE = /x/; const g = (text: string) => RE.exec(text);")[0]).toMatchObject({ dang: "re.exec" });
    expect(q("const g = (raw: string) => JSON.parse(raw.slice(1));")[0]).toMatchObject({ dang: "JSON.parse" });
  });

  it("L2: hằng FOE_/EDGE_/[[A2N trong phép so chữ, giải qua const của tệp khác", () => {
    expect(q('const g = (x: string) => x.startsWith(`${FOE_STOP_NOT_SENT}:`);')[0]).toMatchObject({ dang: ".startsWith" });
    expect(q('const g = (x: string) => x === "EDGE_OUTCOME_UNKNOWN";')[0]).toMatchObject({ dang: "===" });
    expect(q("const g = (x: string) => x.lastIndexOf(DAU) + x.indexOf(DAU);", 'export const DAU = " [[A2N:";')).toHaveLength(1);
    expect(q("const g = (x: string) => { switch (x) { case MA: return 1; } };", 'export const MA = "FOE_X";')[0]).toMatchObject({ dang: "case" });
    expect(q("const g = (x: string) => /^EDGE_HELD\\(/.test(x);")[0]).toMatchObject({ dang: "/re/.test" });
    // hằng số (không phải chữ) tên EDGE_ ⇒ không tính
    expect(q("const g = (v: number) => v === EDGE_PROTOCOL_VERSION;", "export const EDGE_PROTOCOL_VERSION = 2;")).toHaveLength(0);
    // hằng tên FOE_ mà giá trị không bắt đầu bằng FOE_ ⇒ không tính; tên biến môi trường (thuộc tính) ⇒ không tính
    expect(q("const g = (t: string) => t === FOE_ENGINE_TOOL;", 'export const FOE_ENGINE_TOOL = "foe.orchestration";')).toHaveLength(0);
    expect(q('const g = () => process.env.FOE_ENABLED === "1";')).toHaveLength(0);
    // không giải được (nhập từ ngoài) mà tên là FOE_* ⇒ tính
    expect(q("const g = (t: string) => t.startsWith(FOE_KHONG_RO_DAU);")).toHaveLength(1);
  });

  it("L3: nơi gọi / tham chiếu hàm trung gian (trừ khai báo, import, export)", () => {
    const ds = q('import { docDsKhongRoEdge } from "./a";\nexport { docDsKhongRoEdge };\nfunction h(e: string) {\n  return docDsKhongRoEdge(\n    e,\n    new Set(),\n  );\n}\nconst k = [1].map(chotTuHang);');
    expect(ds.map((d) => [d.ham, d.dang, d.chu])).toEqual([
      ["h", "goi:docDsKhongRoEdge", "docDsKhongRoEdge(e,newSet())"],
      ["(cap-tep)", "goi:chotTuHang", "tham-chieu:chotTuHang"],
    ]);
    expect(q("export function docDsKhongRoEdge(x: string) { return x; }")).toHaveLength(0);
    // vị trí KIỂU (`typeof`) không phải nơi gọi; lời gọi cạnh nó vẫn tính
    expect(q("const g = (r: unknown) => chotTuHang(r as Parameters<typeof chotTuHang>[0]);").map((d) => d.chu)).toEqual(["chotTuHang(rasParameters<typeofchotTuHang>[0])"]);
  });

  it("L1: `msg` là tên chữ; L1-CẶP chỉ khớp đúng (tệp, định danh)", () => {
    expect(q("const g = (msg: string) => msg.startsWith(T);")).toHaveLength(1);
    const bang = gomHang([]);
    const tm = "server/services/robot/drivers/techmanDriver.ts";
    expect(quet("const g = (frame: any) => frame?.data.indexOf(',');", tm, bang)).toHaveLength(1);
    expect(quet("const g = (result: string) => /^OK/.exec(result);", tm, bang)).toHaveLength(1);
    // cùng định danh ở tệp khác ⇒ không khớp; định danh khác cùng tệp ⇒ không khớp
    expect(quet("const g = (frame: any) => frame.data.indexOf(',');", "server/services/robot/khac.ts", bang)).toHaveLength(0);
    expect(quet("const g = (frame: any) => frame.header.indexOf(',');", tm, bang)).toHaveLength(0);
    expect(quet('const g = (r: any) => r.outcome.includes("pending:");', "server/services/edge/edgeExecutionAgent.ts", bang)).toHaveLength(1);
    expect(quet('const g = (r: any) => r.outcome.includes("pending:");', "server/services/edge/edgeRunStore.ts", bang)).toHaveLength(0);
  });

  it("THA: chữ không mang tên chữ, mã có cấu trúc, tên gần giống", () => {
    for (const s of [
      'const g = (name: string) => name.startsWith("a");',
      'const g = (ctx: any) => ctx.ma === "X";',
      'const g = (errors: string[]) => errors.includes("a");',
      'const g = (errorText: string) => errorText.startsWith("a");',
      "const g = (x: string) => x.lastIndexOf('a');",
      'const g = (o: any) => o.message.length > 0 && JSON.stringify(o.message);',
    ]) expect(q(s), s).toHaveLength(0);
  });

  it("hàm bao: phương thức lớp, arrow gán biến, callback vô danh lấy hàm ngoài", () => {
    const ds = q('class A { m(e: any) { return [1].some(() => e.message.includes("x")); } }\nconst z = { p: (err: any) => err.startsWith("y") };');
    expect(ds.map((d) => d.ham)).toEqual(["A.m", "p"]);
  });

  it("đọc nguồn chuẩn hoá CRLF ⇒ khoá không đổi theo kết thúc dòng", () => {
    const lf = 'function f(e: any) {\n  return e.message\n    .startsWith(`X\nY`);\n}';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(veLf(crlf)).toBe(lf);
    expect(q(veLf(crlf)).map(khoa)).toEqual(q(lf).map(khoa));
    expect(q(veLf(crlf))).toHaveLength(1);
    expect(existsSync(resolve(GOC, "server/services/orchestration/foe/foeRunStore.ts"))).toBe(true);
  });
});
