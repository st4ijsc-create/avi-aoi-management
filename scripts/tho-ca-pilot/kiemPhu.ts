/**
 * HA-10 — "PHỦ DANH SÁCH ĐÃ DUYỆT": chặn "xanh mà không thêm ca". Trước khi nhận "xong", mọi dòng ĐÃ DUYỆT số k (trừ dòng `GIỮ:`) phải có ≥ 1 ca test tên BẮT ĐẦU `[Dk] `
 * (vd `it("[D7] n ≤ 0 ⇒ N=1", …)`), ca đó phải MỚI so với base, có lời gọi `expect(<không phải hằng>).<matcher>(…)` thật, và (kiểm cuối) vitest báo PASSED.
 *
 * KHÔNG đánh giá ca có ĐÚNG không (việc của lớp lỗi cài / HA-5) — chỉ chặn "không thêm ca". Quét TĨNH bằng AST (typescript): tên ca động / template có `${}` / `.each` / `.skip` / `.todo` KHÔNG được tính (fail-closed).
 * Thông điệp trả về model chỉ gồm số dòng + tag (do host sinh từ quét tĩnh, KHÔNG từ đầu ra test) nên có thể kèm cả ở chế độ chi-so.
 * THUẦN: không fs, không mạng, không env.
 */
import ts from "typescript";

export interface DongDuyet {
  /** số thứ tự GHI TRONG THẺ (không phải vị trí) */
  k: number;
  /** dòng `GIỮ:` — hành vi cũ đã có test; không cần ca mới */
  giu: boolean;
  noiDung: string;
}

const boDau = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Đ/g, "D").replace(/đ/g, "d");

/**
 * Lấy các dòng đánh số dưới dòng `ĐÃ DUYỆT:` trong văn bản QUY TRÌNH (khối này nối tiếp QUY TRÌNH trong thẻ). Dừng ở dòng đầu tiên không đánh số (khác dòng trống).
 * `k` trùng ⇒ giữ lần đầu. Không có khối ⇒ [].
 */
export function docDongDaDuyet(quyTrinh: string | undefined): DongDuyet[] {
  if (!quyTrinh) return [];
  const dong = quyTrinh.replace(/\r\n/g, "\n").split("\n");
  const bat = dong.findIndex((d) => /^\s*DA DUYET\s*:/i.test(boDau(d)));
  if (bat < 0) return [];
  const ra: DongDuyet[] = [];
  const thay = new Set<number>();
  for (const d of dong.slice(bat + 1)) {
    if (d.trim() === "") continue;
    const m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(d);
    if (!m) break;
    const k = Number(m[1]);
    if (thay.has(k)) continue;
    thay.add(k);
    ra.push({ k, giu: /^\s*GIU\s*:/i.test(boDau(m[2]!)), noiDung: m[2]!.trim() });
  }
  return ra;
}

export interface CaTest {
  /** tên ca (chuỗi thuần) */
  ten: string;
  /** k của `[Dk] ` ở đầu tên, hoặc null */
  tag: number | null;
  /** có ≥ 1 `expect(<không phải hằng>).<matcher>(…)` */
  assertThat: boolean;
  /** có lời gọi expect nhưng TOÀN hằng so hằng (expect(true), expect(1).toBe(1)) */
  chiHangSo: boolean;
  /** vị trí đầu NỘI DUNG chuỗi tên (sau dấu nháy mở) — cho `boTienToTag` */
  viTriTen: number;
}
export interface KetQuaQuet {
  ca: CaTest[];
  /** ca có tên không phải chuỗi thuần (template có ${}, biến, …) — không đối chiếu được */
  tenDong: number;
}

const RE_TAG = /^\[D(\d{1,3})\] /;

function laHangThuan(n: ts.Node): boolean {
  if (ts.isNumericLiteral(n) || ts.isStringLiteralLike(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(n)) return n.text === "undefined" || n.text === "NaN" || n.text === "Infinity";
  if (ts.isParenthesizedExpression(n)) return laHangThuan(n.expression);
  if (ts.isPrefixUnaryExpression(n)) return laHangThuan(n.operand);
  if (ts.isBinaryExpression(n)) return laHangThuan(n.left) && laHangThuan(n.right);
  if (ts.isArrayLiteralExpression(n)) return n.elements.every(laHangThuan);
  if (ts.isObjectLiteralExpression(n)) return n.properties.every((p) => ts.isPropertyAssignment(p) && laHangThuan(p.initializer));
  return false;
}

/** Lời gọi `expect(...)` (hoặc `expect.soft(...)`) cho ra: { dungMatcher, hangThuan }. */
function phanTichExpect(c: ts.CallExpression): { matcher: boolean; hangThuan: boolean } | null {
  const e = c.expression;
  const laExpect = (ts.isIdentifier(e) && e.text === "expect") || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "expect" && e.name.text === "soft");
  if (!laExpect) return null;
  // leo lên chuỗi `.not` / `.resolves` / `.toBe` … đến lời gọi matcher
  let cur: ts.Node = c;
  let p: ts.Node = c.parent;
  let soTruyCap = 0;
  while (ts.isPropertyAccessExpression(p) && p.expression === cur) {
    cur = p;
    p = p.parent;
    soTruyCap++;
  }
  const matcher = soTruyCap > 0 && ts.isCallExpression(p) && p.expression === cur;
  const a0 = c.arguments[0];
  return { matcher, hangThuan: a0 === undefined ? true : laHangThuan(a0) };
}

function xetThan(thanHam: ts.Node): { assertThat: boolean; chiHangSo: boolean } {
  let that = false;
  let coExpect = false;
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const r = phanTichExpect(n);
      if (r && r.matcher) {
        coExpect = true;
        if (!r.hangThuan) that = true;
      }
    }
    ts.forEachChild(n, di);
  };
  di(thanHam);
  return { assertThat: that, chiHangSo: coExpect && !that };
}

/** callee là `it` / `test` (kể cả .only / .concurrent / .sequential); .skip / .todo / .each / .skipIf … KHÔNG tính. */
function laLoiGoiCa(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "it" || callee.text === "test";
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && (callee.expression.text === "it" || callee.expression.text === "test")) {
    return ["only", "concurrent", "sequential"].includes(callee.name.text);
  }
  return false;
}

/** Quét tĩnh một tệp test. Tệp không phân tích được ⇒ ca rỗng (fail-closed: không phủ gì). */
export function quetCaTest(nguon: string): KetQuaQuet {
  const sf = ts.createSourceFile("t.test.ts", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ca: CaTest[] = [];
  let tenDong = 0;
  const di = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && laLoiGoiCa(n.expression)) {
      const a0 = n.arguments[0];
      if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) {
        const ten = a0.text;
        const m = RE_TAG.exec(ten);
        const ham = n.arguments[1];
        const x = ham && (ts.isArrowFunction(ham) || ts.isFunctionExpression(ham)) ? xetThan(ham.body) : { assertThat: false, chiHangSo: false };
        ca.push({ ten, tag: m ? Number(m[1]) : null, assertThat: x.assertThat, chiHangSo: x.chiHangSo, viTriTen: a0.getStart(sf) + 1 });
      } else if (a0) {
        tenDong++;
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { ca, tenDong };
}

export interface KetQuaPhu {
  dongCanPhu: number[];
  dongGiu: number[];
  dongDaPhu: number[];
  dongThieu: number[];
  /** tag k KHÔNG có trong khối ĐÃ DUYỆT (vd [D99]) */
  tagLa: number[];
  /** ca mang tag nhưng KHÔNG tính: rỗng (không expect), toàn hằng, là ca CŨ đổi tên, không PASSED */
  loaiBo: { rong: number; hangSoHang: number; caCuDoiTen: number; khongPassed: number; tenDong: number };
  /** ca mới mang tag hợp lệ (tên) — để ghi JSON */
  caMoi: string[];
  /** tên ca cũ (base) bị đổi tên để gắn tag — vi phạm */
  caCuDoiTen: string[];
}

export interface TuyChonPhu {
  /** tên mọi ca có ở BASE (tệp test sửa); vắng ⇒ coi mọi ca là mới */
  tenCaCu?: ReadonlySet<string>;
  /** tên ca vitest báo PASSED (kiểm cuối); vắng ⇒ chỉ kiểm tĩnh */
  passed?: ReadonlySet<string>;
}

/** Tính độ phủ. THUẦN. `nguon` = nội dung (các) tệp test sau lượt, nối lại nếu nhiều tệp. */
export function tinhPhu(dong: readonly DongDuyet[], nguon: string, opt: TuyChonPhu = {}): KetQuaPhu {
  const dongCanPhu = dong.filter((d) => !d.giu).map((d) => d.k).sort((a, b) => a - b);
  const dongGiu = dong.filter((d) => d.giu).map((d) => d.k).sort((a, b) => a - b);
  const quet = quetCaTest(nguon);
  const biet = new Set(dong.map((d) => d.k));
  const daPhu = new Set<number>();
  const loaiBo = { rong: 0, hangSoHang: 0, caCuDoiTen: 0, khongPassed: 0, tenDong: quet.tenDong };
  const caMoi: string[] = [];
  const caCuDoiTen: string[] = [];
  const tagLa = new Set<number>();
  for (const c of quet.ca) {
    if (c.tag === null) continue;
    if (!biet.has(c.tag)) {
      tagLa.add(c.tag);
      continue;
    }
    if (!c.assertThat) {
      if (c.chiHangSo) loaiBo.hangSoHang++;
      else loaiBo.rong++;
      continue;
    }
    const khongTag = c.ten.replace(RE_TAG, "");
    if (opt.tenCaCu && (opt.tenCaCu.has(c.ten) || opt.tenCaCu.has(khongTag))) {
      loaiBo.caCuDoiTen++;
      caCuDoiTen.push(c.ten);
      continue;
    }
    if (opt.passed && !opt.passed.has(c.ten)) {
      loaiBo.khongPassed++;
      continue;
    }
    if (dongCanPhu.includes(c.tag)) {
      daPhu.add(c.tag);
      caMoi.push(c.ten);
    }
  }
  return {
    dongCanPhu,
    dongGiu,
    dongDaPhu: [...daPhu].sort((a, b) => a - b),
    dongThieu: dongCanPhu.filter((k) => !daPhu.has(k)),
    tagLa: [...tagLa].sort((a, b) => a - b),
    loaiBo,
    caMoi,
    caCuDoiTen,
  };
}

/**
 * Dòng PHỦ trả cho model (chỉ số dòng + tag — không lộ nội dung thẻ khác, không từ đầu ra test). Đủ ⇒ dòng xác nhận ngắn. Không có dòng cần phủ ⇒ "".
 */
export function loiNhacPhu(p: KetQuaPhu): string {
  if (p.dongCanPhu.length === 0) return "";
  if (p.dongThieu.length === 0) return `PHỦ: đủ ${p.dongCanPhu.length}/${p.dongCanPhu.length} dòng ĐÃ DUYỆT đã có ca [Dk] có expect thật.`;
  return `PHỦ: dòng ${p.dongThieu.join(", ")} chưa có ca — đặt tên ca bắt đầu bằng ${p.dongThieu.map((k) => `[D${k}]`).join(", ")} (ca MỚI, có expect(giá trị thật) — không phải hằng so hằng).`;
}

/** Câu luật đưa vào lệnh khi thẻ bật KIỂM PHỦ (bo-sung nói trước luật). */
export const CAU_LUAT_PHU =
  "KIỂM PHỦ: việc chỉ XONG khi mọi dòng ĐÃ DUYỆT (trừ dòng GIỮ:) có ít nhất một ca MỚI tên bắt đầu `[Dk] ` (k = số dòng, vd `it(\"[D3] …\", …)`) với expect(giá trị thật); gọi lệnh kiểm để xem dòng còn thiếu.";

/** Từ JSON của `vitest --reporter=json`: tên ca PASSED (title). Hỏng/không phân tích được ⇒ null (không kết luận). */
export function docVitestJson(van: string): Set<string> | null {
  try {
    const j = JSON.parse(van) as { testResults?: Array<{ assertionResults?: Array<{ title?: string; status?: string }> }> };
    if (!Array.isArray(j.testResults)) return null;
    const ra = new Set<string>();
    for (const t of j.testResults) for (const a of t.assertionResults ?? []) if (a.status === "passed" && typeof a.title === "string") ra.add(a.title);
    return ra;
  } catch {
    return null;
  }
}

/** Tên MỌI ca chuỗi thuần trong một tệp (cho tập tên ca ở base). */
export function tenMoiCa(nguon: string): Set<string> {
  return new Set(quetCaTest(nguon).ca.map((c) => c.ten));
}

/**
 * `bo-the-phu` (tất định): bỏ ĐÚNG tiền tố `[Dk] ` ở đầu tên ca (chuỗi thuần) — dấu của một thẻ, vô nghĩa sau khi gộp. Không đụng chuỗi/chú thích khác. Trả nguồn mới + số tiền tố đã bỏ.
 */
export function boTienToTag(nguon: string): { nguon: string; soBo: number } {
  const ca = quetCaTest(nguon).ca.filter((c) => c.tag !== null);
  let ra = nguon;
  for (const c of [...ca].sort((a, b) => b.viTriTen - a.viTriTen)) {
    const tien = RE_TAG.exec(c.ten)![0];
    if (ra.slice(c.viTriTen, c.viTriTen + tien.length) === tien) ra = ra.slice(0, c.viTriTen) + ra.slice(c.viTriTen + tien.length);
  }
  return { nguon: ra, soBo: ca.length };
}
