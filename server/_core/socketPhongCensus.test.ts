/**
 * ★★★ CENSUS AST (2026-10-23) — MỌI `socket.join(...)` của gateway socket phải đứng sau một CỔNG kiểm (phạm vi / quyền / xác thực), hoặc nằm
 * trong danh sách MIỄN có lý do.
 *
 * Lỗ gốc: handler `subscribe` cho MỌI socket người dùng join `factory:` / `workshop:` / `line:` / `machine:` / `robot:` / `device:` /
 * `telemetry:all` bằng id TỰ KHAI (chỉ `twin:` có kiểm) ⇒ nhà máy B nhận dữ liệu realtime của nhà máy A. Đây là lớp lỗi "đường thứ N quên":
 * ai thêm một `socket.join` mới mà quên cổng sẽ làm lưới này ĐỎ đúng chỗ (mặc định của phòng mới là CHẶN, không phải im lặng).
 *
 * Hình dạng: đọc AST (không regex trên dòng) → với mỗi lời gọi `<x>.join(<phòng>)` mà `<x>` là `socket`, lấy (1) mẫu tên phòng,
 * (2) HANDLER bao ngoài (hàm truyền cho `socket.on(...)`). Mỗi lời gọi phải khớp ĐÚNG MỘT luật trong BẢNG dưới đây; luật `gate` đòi handler
 * chứa các lời gọi cổng đã khai; luật `mien` ghi LÝ DO. Luật mồ côi (không lời gọi nào khớp) ⇒ ĐỎ. Riêng `thuVaoPhong(...)` (hàm bọc join bất đồng
 * bộ của `subscribe`): MỌI lời gọi phải truyền ĐÚNG cổng của PHÒNG đó theo BẢNG PHÒNG → CỔNG (SCADA 1a), hoặc `Promise.resolve(false)` — id sai
 * hình dạng ⇒ từ chối.
 *
 * Có ĐỘT BIẾN: lưới phải BẮT (a) phòng mới không cổng, (b) cổng bị thay bằng `Promise.resolve(true)`, (c) bỏ cổng của luật cũ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const GOC = process.cwd();

interface Luat {
  file: string;
  /** Khớp MẪU tên phòng (nguồn của đối số đầu tiên của `join`, đã bỏ khoảng trắng thừa). */
  phong: RegExp;
  /** Các chuỗi PHẢI xuất hiện trong handler bao ngoài (lời gọi cổng). */
  gate?: string[];
  /** Miễn: LÝ DO (bắt buộc khi không có `gate`). */
  mien?: string;
}

/**
 * SCADA 1a (2026-11-03) — BẢNG PHÒNG → CỔNG cho `thuVaoPhong(<phòng>, <cổng>)` (thay "bất kỳ cổng hợp lệ nào cho bất kỳ phòng nào" — trước đây
 * `thuVaoPhong("robot:…", duocVaoPhongTelemetryAll(…))` hay `duocVaoPhongPhamVi(socket.data, "line", n)` cho phòng robot vẫn XANH).
 * Tên phòng đọc từ ĐỐI SỐ 1 (chuỗi / template — tiền tố tĩnh; `${cap}` của vòng `for (const [.., cap] of [[..,"factory"], …])` được khai triển từ
 * mảng hằng của vòng); phòng là BIẾN chỉ hợp lệ khi chính biến đó là đối số phòng của cổng federation (cổng tự kiểm tên phòng ∈ danh sách được vào).
 * Hai nhánh `c ? A : B` của phòng và của cổng cùng điều kiện được GHÉP CẶP (nhánh id sai hình dạng ↔ `Promise.resolve(false)`).
 * Tiền tố phòng KHÔNG có trong bảng ⇒ ĐỎ.
 */
interface CongPhong {
  /** Tên cổng (callee) được phép. */
  ten: string;
  /** Ràng buộc đối số (chỉ số đối số ⇒ phải bằng NGUỒN của phần tử nào của phòng): "cap" = biến cấp của template, "id" = biến id cuối template, "phong" = chính biến phòng. */
  doiSo?: Record<number, "cap" | "id" | "phong">;
}
interface DongBangPhong {
  /** Khớp tên phòng đã chuẩn hoá (template ⇒ `${x}` thay bằng `{x}`). */
  khop: (ten: string) => boolean;
  moTa: string;
  /** Cổng được phép; rỗng = chỉ `Promise.resolve(false)` (phòng từ chối). */
  cong: CongPhong[];
}
const tienTo = (p: string) => (ten: string) => ten.startsWith(p);
const dung = (p: string) => (ten: string) => ten === p;
export const BANG_PHONG_CONG: DongBangPhong[] = [
  ...(["factory", "workshop", "line", "machine"] as const).map((cap) => ({ khop: tienTo(`${cap}:`), moTa: `${cap}:`, cong: [{ ten: "duocVaoPhongPhamVi", doiSo: { 1: "cap", 2: "id" } as Record<number, "cap" | "id" | "phong"> }] })),
  { khop: tienTo("robot:"), moTa: "robot:", cong: [{ ten: "duocVaoPhongRobot", doiSo: { 1: "id" } }] },
  // fix 1 (m-2): cổng thiết bị phải kiểm CHÍNH khoá dựng tên phòng (`device:${khoa}` ⇒ đối số 1 = `khoa`)
  { khop: tienTo("device:"), moTa: "device:", cong: [{ ten: "duocVaoPhongThietBi", doiSo: { 1: "id" } }] },
  { khop: dung("telemetry:all"), moTa: "telemetry:all", cong: [{ ten: "duocVaoPhongTelemetryAll" }] },
  { khop: dung("ai:agents"), moTa: "ai:agents", cong: [{ ten: "duocVaoPhongAiAgents" }] },
  // PV-socket-1: phòng `sites:all` / `sites:corp:{mã}` — tên phòng là BIẾN lấy từ `phongFederationDuocVao`; cổng nhận chính biến đó và kiểm nó ∈ danh sách
  { khop: (t) => t === "sites:all" || t.startsWith("sites:corp:") || t === "{bien-phong-federation}", moTa: "sites:all | sites:corp: (biến)", cong: [{ ten: "duocVaoPhongFederation", doiSo: { 1: "phong" } }] },
  { khop: dung("sites:invalid"), moTa: "sites:invalid (chỉ từ chối)", cong: [] },
];
/** Tên cổng xuất hiện trong bảng (kiểm export). */
const CONG_THU_VAO_PHONG = [...new Set(BANG_PHONG_CONG.flatMap((d) => d.cong.map((c) => c.ten)))];

const LUAT: Luat[] = [
  // ── subscribe: hàm bọc join bất đồng bộ (MỌI lời gọi `thuVaoPhong` được kiểm riêng bên dưới)
  //    PV-socket-1: + `duocVaoPhongFederation` — phòng `sites:all` / `sites:corp:{mã}` của `site:update` (thay `site:{code}` / `sites:global`, miễn trước đây)
  { file: "server/_core/socket.ts", phong: /^phong$/, gate: ["duocVaoPhongPhamVi(", "duocVaoPhongRobot(", "duocVaoPhongThietBi(", "duocVaoPhongTelemetryAll(", "duocVaoPhongAiAgents(", "duocVaoPhongFederation(", "phongFederationDuocVao("] },
  // ── twin: cổng có từ Đợt 6 (G12/G20)
  { file: "server/_core/socket.ts", phong: /^`twin:\$\{twinFactoryId\}`$/, gate: ["nguoiXemDuocNhan(", "resolveTenantFactoryScope("] },
  // ── engineering: QUYỀN + PHẠM VI
  { file: "server/_core/socket.ts", phong: /^phong$/, gate: ["duocVaoPhongEngineering(", "duocVaoPhongPhamVi("] },
  // ── luồng MÁY: phòng `machine:{id}` của CHÍNH máy đã xác thực apiKey (id lấy từ máy đã gắn, không từ payload)
  { file: "server/_core/socket.ts", phong: /^`machine:\$\{machineId\}`$/, gate: ["xacDinhMaySuKien("] },
  // ── admin
  { file: "server/_core/socket.ts", phong: /^"admin"$/, gate: ["duocQuanLyDangKyMay("] },
  // ── F5 đầy đủ: phòng ĐIỀU KHIỂN của server (chỉ để NGẮT — census socketKiemCensus cấm phát vào đó), danh tính từ handshake đã xác thực
  { file: "server/_core/socket.ts", phong: /^phongKiemNguoi\(u\.id\)$/, gate: ["laSocketNguoiDung(", "sdk.authenticateRequest("] },
  { file: "server/_core/socket.ts", phong: /^phongKiemPhien\(\(socket\.data as any\)\.khoaPhien\)$/, gate: ["laSocketNguoiDung(", "chuanBiKiemHandshake("] },
  // ── P-S1b: tự vào phòng theo PHẠM VI của chính người dùng (idsTrongPhamVi) — không từ lời tự khai
  { file: "server/_core/socketPhongQuyen.ts", phong: /^PHONG_TOAN_QUYEN_SOCKET$/, gate: ["laSocketNguoiDung(", "idsTrongPhamVi("] },
  { file: "server/_core/socketPhongQuyen.ts", phong: /^`factory:\$\{id\}`$/, gate: ["laSocketNguoiDung(", "idsTrongPhamVi("] },
  // ── thông báo theo người dùng: chỉ phòng CỦA MÌNH
  { file: "server/services/notificationService.ts", phong: /^`user:\$\{userId\}`$/, gate: ["duocVaoPhongNguoiDung("] },
  // ── MIỄN (có lý do — KHÔNG thêm im lặng)
  {
    file: "server/_core/socket.ts",
    phong: /^"global"$/,
    mien: "phòng chung CHỈ cho socket người dùng đã xác thực (đã qua `laSocketNguoiDung` ở đầu `subscribe`). KHÔNG mang dữ liệu: từ P-S1b không còn điểm phát nào vào `global` (census socketPhatCensus, MIEN rỗng). Nơi DUY NHẤT còn dùng nó là `phatTwinUpdateTheoPhamVi` — CHỈ để LIỆT KÊ socket (`fetchSockets`), rồi lọc trạm theo phạm vi TỪNG người nhận và bỏ hẳn người phạm vi rỗng (ghim bằng đột biến ở socketPhamViSite.test.ts).",
  },
];

/** Bỏ ngoặc. */
const boNgoac = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? boNgoac(e.expression) : e);
const boAs = (e: ts.Expression): ts.Expression => (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) ? boAs(e.expression) : e);

/** Ghép cặp (nhánh phòng, nhánh cổng): hai biểu thức điều kiện CÙNG điều kiện ⇒ ghép theo nhánh; còn lại ⇒ tích. */
function capNhanh(phong: ts.Expression, cong: ts.Expression): [ts.Expression, ts.Expression][] {
  const p = boNgoac(phong);
  const c = boNgoac(cong);
  if (ts.isConditionalExpression(p) && ts.isConditionalExpression(c) && p.condition.getText() === c.condition.getText()) {
    return [...capNhanh(p.whenTrue, c.whenTrue), ...capNhanh(p.whenFalse, c.whenFalse)];
  }
  if (ts.isConditionalExpression(p)) return [...capNhanh(p.whenTrue, c), ...capNhanh(p.whenFalse, c)];
  if (ts.isConditionalExpression(c)) return [...capNhanh(p, c.whenTrue), ...capNhanh(p, c.whenFalse)];
  return [[p, c]];
}

interface TenPhong {
  /** Tên đã chuẩn hoá: phần động `${x}` ⇒ `{x}`; phòng là biến ⇒ `{bien-phong-federation}`. */
  ten: string;
  /** Nguồn biến cấp (`${cap}` đầu template) — để ràng buộc đối số cổng. */
  cap?: string;
  /** Nguồn biến id (`${n}` cuối template). */
  id?: string;
  /** Nguồn biến phòng (phòng là một định danh). */
  bien?: string;
}

/** `X` là phần tử thứ i của mẫu mảng trong `for (const [..] of [[..], ..] as const)` bao ngoài ⇒ các chuỗi hằng ở vị trí i; không giải được ⇒ null. */
function giaiBienVong(x: ts.Identifier): string[] | null {
  for (let cur: ts.Node | undefined = x.parent; cur; cur = cur.parent) {
    if (!ts.isForOfStatement(cur) || !ts.isVariableDeclarationList(cur.initializer)) continue;
    const ten = cur.initializer.declarations[0]?.name;
    if (!ten || !ts.isArrayBindingPattern(ten)) continue;
    const i = ten.elements.findIndex((el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === x.text);
    if (i < 0) continue;
    const mang = boAs(cur.expression);
    if (!ts.isArrayLiteralExpression(mang)) return null;
    const out: string[] = [];
    for (const hang of mang.elements) {
      const h = boAs(hang as ts.Expression);
      if (!ts.isArrayLiteralExpression(h)) return null;
      const g = h.elements[i];
      if (!g || !ts.isStringLiteralLike(g)) return null;
      out.push(g.text);
    }
    return out;
  }
  return null;
}

/** Đối số 1 của `thuVaoPhong` ⇒ các tên phòng có thể; null = không giải được (ĐỎ). */
function tenPhongCua(e: ts.Expression): TenPhong[] | null {
  if (ts.isStringLiteralLike(e)) return [{ ten: e.text }];
  if (ts.isIdentifier(e)) return [{ ten: "{bien-phong-federation}", bien: e.text }];
  if (!ts.isTemplateExpression(e)) return null;
  const spans = e.templateSpans;
  const cuoi = spans[spans.length - 1];
  const id = cuoi.literal.text === "" ? cuoi.expression.getText() : undefined;
  if (e.head.text === "") {
    // phần đầu động: chỉ chấp nhận biến của vòng hằng (`${cap}`), khai triển thành từng giá trị
    const x = spans[0].expression;
    if (!ts.isIdentifier(x)) return null;
    const giaTri = giaiBienVong(x);
    if (!giaTri || giaTri.length === 0) return null;
    const duoi = spans[0].literal.text + spans.slice(1).map((s) => `{${s.expression.getText()}}${s.literal.text}`).join("");
    return giaTri.map((g) => ({ ten: g + duoi, cap: x.text, id: spans.length > 1 ? id : undefined }));
  }
  return [{ ten: e.head.text + spans.map((s) => `{${s.expression.getText()}}${s.literal.text}`).join(""), id }];
}

const laTuChoi = (c: ts.Expression): boolean =>
  ts.isCallExpression(c) && c.expression.getText() === "Promise.resolve" && c.arguments.length === 1 && c.arguments[0].getText() === "false";

/** Kiểm một lời gọi `thuVaoPhong(phòng, cổng)` theo BẢNG PHÒNG → CỔNG; trả lý do vi phạm (rỗng = đạt). */
export function kiemThuVaoPhong(n: ts.CallExpression): string[] {
  if (n.arguments.length < 2) return ["`thuVaoPhong` phải nhận một CỔNG (đối số thứ hai)"];
  const loi: string[] = [];
  for (const [p, c] of capNhanh(n.arguments[0], n.arguments[1])) {
    const ds = tenPhongCua(p);
    if (!ds) {
      loi.push(`tên phòng \`${p.getText()}\` không giải được (chuỗi / template có tiền tố tĩnh / biến vòng hằng / biến phòng federation)`);
      continue;
    }
    for (const ph of ds) {
      const dong = BANG_PHONG_CONG.filter((d) => d.khop(ph.ten));
      if (dong.length === 0) {
        loi.push(`phòng \`${ph.ten}\` KHÔNG có trong BẢNG PHÒNG → CỔNG — phòng mới phải khai cổng riêng`);
        continue;
      }
      if (laTuChoi(c)) continue; // từ chối, không mở cửa
      const ok =
        ts.isCallExpression(c) &&
        dong.some((d) =>
          d.cong.some(
            (g) =>
              g.ten === c.expression.getText() &&
              Object.entries(g.doiSo ?? {}).every(([i, nguon]) => {
                const can = nguon === "cap" ? ph.cap : nguon === "id" ? ph.id : ph.bien;
                return can !== undefined && c.arguments[Number(i)]?.getText() === can;
              }),
          ),
        );
      if (!ok) loi.push(`cổng \`${c.getText()}\` KHÔNG phải cổng của phòng \`${ph.ten}\` (bảng: ${dong.map((d) => d.cong.map((g) => g.ten).join("|") || "chỉ Promise.resolve(false)").join(" / ")})`);
    }
  }
  return loi;
}

export interface ViPham {
  file: string;
  dong: number;
  phong: string;
  lyDo: string;
}

/** Quét một tệp nguồn: trả vi phạm + (file, mẫu phòng) đã khớp luật nào (để bắt luật mồ côi). */
export function quetJoin(src: string, file: string): { viPham: ViPham[]; khop: number[] } {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const viPham: ViPham[] = [];
  const khop: number[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const handlerBao = (n: ts.Node): ts.Node => {
    // hàm truyền cho một lời gọi `.on(...)` gần nhất; không có ⇒ hàm ngoài cùng
    let cur: ts.Node | undefined = n.parent;
    let hamNgoai: ts.Node | undefined;
    while (cur) {
      if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) || ts.isFunctionDeclaration(cur)) {
        hamNgoai = cur;
        const p = cur.parent;
        if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "on" && p.expression.expression.getText().endsWith("socket")) return cur;
      }
      cur = cur.parent;
    }
    return hamNgoai ?? sf;
  };

  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      // socket.join(<phòng>)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "join" && callee.expression.getText() === "socket" && n.arguments.length >= 1) {
        const phong = n.arguments[0].getText().replace(/\s+/g, " ");
        const handler = handlerBao(n).getText();
        const ungVien = LUAT.map((l, i) => ({ l, i })).filter(({ l }) => l.file === file && l.phong.test(phong));
        // chọn luật có đủ cổng trong handler (cùng mẫu `phong` có thể có nhiều luật theo handler khác nhau)
        const dat = ungVien.filter(({ l }) => (l.gate ?? []).every((g) => handler.includes(g)));
        if (ungVien.length === 0) {
          viPham.push({ file, dong: dong(n), phong, lyDo: "`socket.join` KHÔNG có trong bảng luật — phòng mới phải có CỔNG (phạm vi/quyền/xác thực) hoặc khai MIỄN kèm lý do" });
        } else if (dat.length === 0) {
          viPham.push({ file, dong: dong(n), phong, lyDo: `handler bao ngoài THIẾU cổng đã khai (${ungVien.map(({ l }) => (l.gate ?? ["(miễn)"]).join("+")).join(" | ")})` });
        } else {
          for (const { i } of dat) khop.push(i);
        }
      }
      // thuVaoPhong(<phòng>, <cổng>)
      if (ts.isIdentifier(callee) && callee.text === "thuVaoPhong") {
        for (const lyDo of kiemThuVaoPhong(n)) viPham.push({ file, dong: dong(n), phong: n.arguments[0]?.getText() ?? "?", lyDo });
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return { viPham, khop };
}

/** Tệp server (không test) có `socket.join(` — gom TOÀN BỘ gateway, không chỉ socket.ts. */
function tepCoJoin(): string[] {
  const out: string[] = [];
  const di = (dir: string) => {
    for (const ten of readdirSync(dir)) {
      if (ten === "node_modules" || ten.startsWith(".")) continue;
      const p = resolve(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(ten) && !/\.(test|spec|d)\.ts$/.test(ten) && readFileSync(p, "utf8").includes("socket.join(")) out.push(relative(GOC, p).replace(/\\/g, "/"));
    }
  };
  di(resolve(GOC, "server"));
  return out.sort();
}

const doc = (rel: string) => readFileSync(resolve(GOC, rel), "utf8");

describe("census — mọi socket.join đứng sau cổng hoặc có miễn kèm lý do", () => {
  it("quét TOÀN server/: chỉ các tệp đã biết có socket.join (tệp mới ⇒ phải vào bảng luật)", () => {
    expect(tepCoJoin()).toEqual(["server/_core/socket.ts", "server/_core/socketPhongQuyen.ts", "server/services/notificationService.ts"]);
  });

  it("socket.ts + notificationService.ts: 0 vi phạm; mọi luật đều có ≥ 1 lời gọi khớp (không luật mồ côi); miễn có lý do", () => {
    const tong: ViPham[] = [];
    const khop = new Set<number>();
    for (const f of tepCoJoin()) {
      const r = quetJoin(doc(f), f);
      tong.push(...r.viPham);
      r.khop.forEach((i) => khop.add(i));
    }
    expect(tong, tong.map((v) => `${v.file}:${v.dong} ${v.phong} — ${v.lyDo}`).join("\n")).toEqual([]);
    const moCoi = LUAT.map((l, i) => ({ l, i })).filter(({ i }) => !khop.has(i));
    expect(moCoi.map(({ l }) => `${l.file} ${l.phong}`), "luật mồ côi — xoá hoặc sửa").toEqual([]);
    for (const l of LUAT) expect(Boolean(l.gate?.length) || (l.mien ?? "").length > 20, `luật ${l.phong} thiếu cổng/lý do miễn`).toBe(true);
  });

  it("SCADA 1a — BẢNG PHÒNG → CỔNG: mọi lời gọi `thuVaoPhong` của socket.ts giải được tên phòng, và MỌI dòng bảng có ≥ 1 lời gọi khớp (không dòng mồ côi)", () => {
    const sf = ts.createSourceFile("socket.ts", doc("server/_core/socket.ts"), ts.ScriptTarget.Latest, true);
    const goi: ts.CallExpression[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "thuVaoPhong") goi.push(n);
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(goi.length, "thiết bị đo: thấy các lời gọi thuVaoPhong").toBeGreaterThanOrEqual(7);
    const daDung = new Set<number>();
    for (const n of goi) {
      expect(kiemThuVaoPhong(n), n.getText()).toEqual([]);
      for (const [p] of capNhanh(n.arguments[0], n.arguments[1])) {
        for (const ph of tenPhongCua(p) ?? []) BANG_PHONG_CONG.forEach((d, i) => d.khop(ph.ten) && daDung.add(i));
      }
    }
    expect(BANG_PHONG_CONG.map((d, i) => (daDung.has(i) ? null : d.moTa)).filter(Boolean), "dòng bảng mồ côi").toEqual([]);
  });

  it("tên cổng trong bảng thực sự được export (không trỏ vào hàm không tồn tại)", () => {
    const src = doc("server/_core/socketPhongQuyen.ts");
    for (const g of CONG_THU_VAO_PHONG) expect(src, g).toMatch(new RegExp(`export (async )?function ${g}\\b|export const ${g}\\b`));
  });
});

describe("ĐỘT BIẾN — lưới phải BẮT", () => {
  const socketTs = () => doc("server/_core/socket.ts");

  it("(a) thêm một phòng MỚI không cổng ở `subscribe` ⇒ ĐỎ", () => {
    const loi = socketTs().replace('socket.join("global");', 'socket.join("global");\n      socket.join(`plc:${dd.plcId}`);');
    expect(loi).not.toBe(socketTs());
    const r = quetJoin(loi, "server/_core/socket.ts");
    expect(r.viPham.some((v) => v.phong.includes("plc:"))).toBe(true);
  });

  it("(b) một lời gọi `thuVaoPhong` bị thay cổng bằng Promise.resolve(true) / bỏ cổng ⇒ ĐỎ", () => {
    const g = 'thuVaoPhong("telemetry:all", duocVaoPhongTelemetryAll(socket.data));';
    expect(socketTs()).toContain(g);
    const a = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all", Promise.resolve(true));'), "server/_core/socket.ts");
    expect(a.viPham.length).toBeGreaterThan(0);
    const b = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all", socket.data ? Promise.resolve(true) : duocVaoPhongTelemetryAll(socket.data));'), "server/_core/socket.ts");
    expect(b.viPham.length).toBeGreaterThan(0);
    const c = quetJoin(socketTs().replace(g, 'thuVaoPhong("telemetry:all");'), "server/_core/socket.ts");
    expect(c.viPham.length).toBeGreaterThan(0);
  });

  it("(b2) `ai:agents` (mục tiêu agent của người khác): bỏ cổng / mở cửa / quay lại `socket.join` trần ⇒ ĐỎ", () => {
    const g = 'thuVaoPhong("ai:agents", duocVaoPhongAiAgents(socket.data));';
    expect(socketTs()).toContain(g);
    for (const doi of ['thuVaoPhong("ai:agents", Promise.resolve(true));', 'thuVaoPhong("ai:agents");', 'socket.join("ai:agents");']) {
      expect(quetJoin(socketTs().replace(g, doi), "server/_core/socket.ts").viPham.length, doi).toBeGreaterThan(0);
    }
  });

  it("(b3) PV-socket-1 — phòng federation: cổng bị mở / bỏ, join theo danh sách trần, join trần `site:{code}` / `sites:global` quay lại ⇒ ĐỎ", () => {
    const g = "for (const p of ds) thuVaoPhong(p, duocVaoPhongFederation(socket.data, p));";
    expect(socketTs()).toContain(g);
    for (const doi of [
      "for (const p of ds) thuVaoPhong(p, Promise.resolve(true));",
      "for (const p of ds) thuVaoPhong(p);",
      "for (const p of ds) socket.join(p);",
      g + "\n      socket.join(`site:${(data as any).siteCode}`);",
      g + '\n      socket.join("sites:global");',
    ]) {
      expect(quetJoin(socketTs().replace(g, doi), "server/_core/socket.ts").viPham.length, doi).toBeGreaterThan(0);
    }
  });

  it("(e) SCADA 1a — cổng SAI PHÒNG (thay / hoán đổi / chèn — census cũ: các ca chèn + hoán đổi XANH) ⇒ ĐỎ do BẢNG; phòng lạ ⇒ ĐỎ", () => {
    // Mọi khẳng định dưới đây đòi vi phạm do BẢNG PHÒNG → CỔNG báo (không nhờ luật "handler thiếu tên cổng" — luật đó chỉ đỏ khi tên cổng
    // BIẾN MẤT khỏi handler, nên mù với cổng sai được THÊM / HOÁN ĐỔI; đo trên census cũ: các ca chèn dưới đây XANH).
    const S = "server/_core/socket.ts";
    const loiBang = (src: string) => quetJoin(src, S).viPham.filter((v) => /BẢNG PHÒNG|KHÔNG phải cổng của phòng|không giải được/.test(v.lyDo));
    const robot = "duocVaoPhongRobot(socket.data, n)";
    expect(socketTs()).toContain(robot);
    for (const doi of ["duocVaoPhongTelemetryAll(socket.data)", 'duocVaoPhongPhamVi(socket.data, "line", n)', "Promise.resolve(true)", "duocVaoPhongRobot(socket.data, 1)", "duocVaoPhongThietBi(socket.data, n)"]) {
      expect(loiBang(socketTs().replace(robot, doi)).length, `robot: ⇒ ${doi}`).toBeGreaterThan(0);
    }
    const thietBi = "duocVaoPhongThietBi(socket.data, khoa)";
    expect(socketTs()).toContain(thietBi);
    for (const doi of ["duocVaoPhongRobot(socket.data, khoa)", "duocVaoPhongTelemetryAll(socket.data)", 'duocVaoPhongThietBi(socket.data, "machine:1")', "duocVaoPhongThietBi(socket.data, dd.deviceStreamId)"]) {
      expect(loiBang(socketTs().replace(thietBi, doi)).length, `device: ⇒ ${doi}`).toBeGreaterThan(0);
    }
    // hoán đổi: robot dùng cổng thiết bị, device dùng cổng robot — MỌI tên cổng vẫn có trong handler
    expect(loiBang(socketTs().replace(robot, "duocVaoPhongThietBi(socket.data, n)").replace(thietBi, "duocVaoPhongRobot(socket.data, khoa)")).length).toBeGreaterThan(0);
    const fed = "thuVaoPhong(p, duocVaoPhongFederation(socket.data, p))";
    expect(socketTs()).toContain(fed);
    for (const doi of ["thuVaoPhong(p, duocVaoPhongTelemetryAll(socket.data))", 'thuVaoPhong(p, duocVaoPhongPhamVi(socket.data, "factory", p))', 'thuVaoPhong(p, duocVaoPhongFederation(socket.data, "sites:all"))']) {
      expect(loiBang(socketTs().replace(fed, doi)).length, `federation ⇒ ${doi}`).toBeGreaterThan(0);
    }
    const phamVi = "duocVaoPhongPhamVi(socket.data, cap, n)";
    expect(socketTs()).toContain(phamVi);
    for (const doi of ['duocVaoPhongPhamVi(socket.data, "factory", n)', "duocVaoPhongRobot(socket.data, n)"]) {
      expect(loiBang(socketTs().replace(phamVi, doi)).length, `factory/workshop/line/machine ⇒ ${doi}`).toBeGreaterThan(0);
    }
    // CHÈN một lời gọi cổng sai cạnh lời gọi đúng (mọi tên cổng vẫn có trong handler) + phòng có tiền tố KHÔNG trong bảng + phần đầu động
    const g = 'thuVaoPhong("telemetry:all", duocVaoPhongTelemetryAll(socket.data));';
    for (const chen of [
      "thuVaoPhong(`robot:${n}`, duocVaoPhongTelemetryAll(socket.data));",
      'thuVaoPhong(`robot:${n}`, duocVaoPhongPhamVi(socket.data, "line", n));',
      "thuVaoPhong(`robot:${n}`, Promise.resolve(true));",
      "thuVaoPhong(`device:${khoa}`, duocVaoPhongRobot(socket.data, n));",
      'thuVaoPhong("sites:all", duocVaoPhongTelemetryAll(socket.data));',
      'thuVaoPhong("sites:corp:X", duocVaoPhongAiAgents(socket.data));',
      "thuVaoPhong(`plc:${n}`, duocVaoPhongRobot(socket.data, n));",
      'thuVaoPhong("telemetry:all2", duocVaoPhongTelemetryAll(socket.data));',
      "thuVaoPhong(`${String(dd.x)}:1`, duocVaoPhongTelemetryAll(socket.data));",
    ]) {
      expect(loiBang(socketTs().replace(g, g + "\n        " + chen)).length, chen).toBeGreaterThan(0);
    }
    // đối chứng: thêm lời gọi HỢP LỆ (phòng trong bảng + đúng cổng / `Promise.resolve(false)`) vẫn xanh (bộ dò không đỏ vì mọi thứ)
    const them = g + '\n        thuVaoPhong("robot:invalid", Promise.resolve(false));\n        thuVaoPhong(`robot:${n}`, duocVaoPhongRobot(socket.data, n));';
    expect(quetJoin(socketTs().replace(g, them), "server/_core/socket.ts").viPham).toEqual([]);
  });

  it("(c) bỏ cổng của luật cũ: twin không còn nguoiXemDuocNhan / engineering không còn kiểm phạm vi ⇒ ĐỎ", () => {
    const twin = socketTs().split("nguoiXemDuocNhan(").join("khongKiem(");
    expect(quetJoin(twin, "server/_core/socket.ts").viPham.some((v) => v.phong.includes("twin:"))).toBe(true);
    const eng = socketTs().replace('(await duocVaoPhongPhamVi(socket.data, "machine", data.machineId))', "true");
    expect(eng).not.toBe(socketTs());
    expect(quetJoin(eng, "server/_core/socket.ts").viPham.some((v) => v.phong === "phong")).toBe(true);
  });

  it("(d) đối chứng DƯƠNG: nguồn gốc không đột biến ⇒ 0 vi phạm (bộ dò không đỏ vô cớ)", () => {
    expect(quetJoin(socketTs(), "server/_core/socket.ts").viPham).toEqual([]);
  });
});
