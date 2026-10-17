/**
 * ★★★ Đợt 3c (2026-10-17) — BẢN KIỂM ĐẾM của "Chạy & Xem trước" (AST, quét theo THƯ MỤC — file mới tự rơi vào lưới).
 *
 *   §1 MỘT cửa sinh: trong `chayUngDung/`, CHỈ `cuaSinhUngDung.ts` nhập `child_process`; `sinhUngDungThat` chỉ được
 *      THAM CHIẾU (ngoài định nghĩa) ở `chayUngDung/index.ts` — singleton trình quản lý.
 *   §2 `new QuanLyUngDung(` trong mã sản phẩm: đúng MỘT chỗ (singleton) — trình quản lý thứ hai = cổng/tiến trình
 *      không ai dừng khi tắt máy.
 *   §3 Vòng TỰ ĐỘNG (tu-dong) KHÔNG chạy được ứng dụng: không file nào của vòng agent / vòng kiểm chứng nhập module
 *      `chayUngDung` (ngoại trừ cấu hình đọc-thuần `cauHinhChayDuAn`, mà hộp cát lệnh dùng để quyết `--ignore-scripts`).
 *   §4 Người nhập `chayUngDung` trong mã sản phẩm — danh sách ĐÓNG: thêm một người gọi mới phải được nhìn thấy một lần.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const GOC_SERVER = path.resolve(__dirname, "..", "..", "..");
const GOC_REPO = path.resolve(GOC_SERVER, "..");
const THU_MUC = path.resolve(__dirname);

function moiFileTs(dir: string): string[] {
  const ra: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") ra.push(...moiFileTs(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

function rel(p: string): string {
  return path.relative(GOC_REPO, p).split(path.sep).join("/");
}

function phanTich(file: string) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const nhap: string[] = [];
  const thamChieu = new Map<string, number>();
  let soNewQuanLy = 0;
  const di = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) nhap.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      nhap.push(n.arguments[0].text);
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "QuanLyUngDung") soNewQuanLy++;
    if (ts.isIdentifier(n) && !ts.isImportSpecifier(n.parent) && !(ts.isFunctionDeclaration(n.parent) && n.parent.name === n)) {
      thamChieu.set(n.text, (thamChieu.get(n.text) ?? 0) + 1);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { nhap, thamChieu, soNewQuanLy };
}

const SAN_PHAM = moiFileTs(GOC_SERVER).map((f) => ({ f, r: rel(f), ...phanTich(f) }));

describe("§0 — cầu chì", () => {
  it("★ quét thấy cả cây server/ và đủ 7 file của chayUngDung/", () => {
    expect(SAN_PHAM.length).toBeGreaterThan(500);
    expect(SAN_PHAM.filter((x) => x.f.startsWith(THU_MUC)).map((x) => path.basename(x.f)).sort()).toEqual(
      ["capCong.ts", "cauHinhChayDuAn.ts", "cuaSinhUngDung.ts", "dichVu.ts", "index.ts", "proxyXemTruoc.ts", "quanLyUngDung.ts"].sort(),
    );
  });
});

describe("§1 — MỘT cửa sinh tiến trình ứng dụng", () => {
  it("★★★ trong chayUngDung/, chỉ cuaSinhUngDung.ts nhập child_process", () => {
    const co = SAN_PHAM.filter((x) => x.f.startsWith(THU_MUC) && x.nhap.some((m) => m === "node:child_process" || m === "child_process")).map((x) => path.basename(x.f));
    expect(co).toEqual(["cuaSinhUngDung.ts"]);
  });

  it("★★★ `sinhUngDungThat` chỉ được dùng ở singleton (chayUngDung/index.ts)", () => {
    const dung = SAN_PHAM.filter((x) => (x.thamChieu.get("sinhUngDungThat") ?? 0) > 0 && !x.r.endsWith("chayUngDung/cuaSinhUngDung.ts")).map((x) => x.r);
    expect(dung).toEqual(["server/services/ai/chayUngDung/index.ts"]);
  });
});

describe("§2 — một trình quản lý", () => {
  it("★★★ `new QuanLyUngDung(` đúng MỘT chỗ trong mã sản phẩm", () => {
    const o = SAN_PHAM.filter((x) => x.soNewQuanLy > 0).map((x) => `${x.r}×${x.soNewQuanLy}`);
    expect(o).toEqual(["server/services/ai/chayUngDung/index.ts×1"]);
  });
});

const laNhapChayUngDung = (m: string) => /chayUngDung(\/|$)/.test(m) && !/cauHinhChayDuAn$/.test(m);

describe("§3 — vòng TỰ ĐỘNG không chạm được trình quản lý ứng dụng", () => {
  it("★★★ vòng agent (`ai/agent/**`), vòng kiểm chứng/tự-trị-ghi (`aiCodingVerify`, `aiCodingTuTriGhi`) và kho tool (`aiLocalTools/**`) KHÔNG nhập chayUngDung", () => {
    const xau = SAN_PHAM.filter(
      (x) =>
        (x.r.startsWith("server/services/ai/agent/") ||
          x.r.startsWith("server/services/aiLocalTools/") ||
          /server\/services\/aiCoding(Verify|TuTriGhi)/.test(x.r)) &&
        x.nhap.some(laNhapChayUngDung),
    ).map((x) => x.r);
    expect(xau).toEqual([]);
  });
});

describe("§4 — người nhập chayUngDung (danh sách ĐÓNG)", () => {
  it("★★ đúng các điểm nối đã biết", () => {
    const ds = SAN_PHAM.filter((x) => !x.f.startsWith(THU_MUC) && x.nhap.some(laNhapChayUngDung)).map((x) => x.r).sort();
    expect(ds).toEqual(["server/_core/index.ts", "server/routers/aiChayUngDungRouter.ts", "server/routes/aiXemTruocApi.ts"]);
  });
});
