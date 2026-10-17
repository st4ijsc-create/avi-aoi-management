/**
 * ★★★ Đợt 2 — chỉ mục KÝ HIỆU (`find_symbol`): trích định nghĩa theo mẫu + tham chiếu ranh giới từ, CHỈ qua hộp cát.
 *
 * Oracle độc lập: dự án TẠM dựng tay trên đĩa (nhiều ngôn ngữ), số dòng đếm từ chính chuỗi nguồn viết trong ca —
 * không suy ra từ mã đang thử. Ca an toàn đặt một định nghĩa "mồi" ở chỗ CẤM (đuôi cấm, `.env*`, `node_modules`,
 * ngoài gốc qua junction/`..`) rồi đòi nó KHÔNG được thấy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { trichKyHieu, timKyHieu, xoaBoDemKyHieu, dungBangKyHieu } from "./kyHieu";
import { phanTichGitignore, biBoQua } from "./boQuaGit";

let tam: string;
let goc: string;

function viet(rel: string, noiDung: string): void {
  const abs = path.join(goc, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung, "utf8");
}

/** Dòng (1-based) của lần xuất hiện ĐẦU TIÊN của `mau` trong `src` — oracle đếm tay, độc lập với bộ trích. */
function dongCua(src: string, mau: string): number {
  const i = src.split("\n").findIndex((l) => l.includes(mau));
  if (i < 0) throw new Error(`oracle: không thấy ${mau}`);
  return i + 1;
}

const TS = [
  `import { x } from "./x";`,
  ``,
  `export async function taiDuLieu(id: number): Promise<string> {`,
  `  return String(id);`,
  `}`,
  ``,
  `export class KhoHang<T> extends Base {`,
  `  private readonly ds: T[] = [];`,
  `  constructor(private a: number) { super(); }`,
  `  async themMuc(muc: T): Promise<void> {`,
  `    if (muc) { this.ds.push(muc); }`,
  `  }`,
  `}`,
  ``,
  `export interface CauHinhKho { ten: string }`,
  `export type MaKho = string | number;`,
  `export enum TrangThaiKho { Mo, Dong }`,
  `export const TRAN_KHO = 10;`,
  `const tinhTong = (a: number, b: number) => a + b;`,
  `export default function () {}`,
].join("\n");

beforeEach(() => {
  tam = fs.mkdtempSync(path.join(os.tmpdir(), "chimucma-kh-"));
  goc = path.join(tam, "du-an");
  fs.mkdirSync(goc);
  xoaBoDemKyHieu();
});
afterEach(() => {
  fs.rmSync(tam, { recursive: true, force: true });
});

describe("trichKyHieu — mẫu theo ngôn ngữ (thuần)", () => {
  it("TS: function/class/method/interface/type/enum/const xuất/arrow — đúng dòng + chữ ký một dòng", () => {
    const ky = trichKyHieu(TS, "ts");
    const tim = (ten: string) => ky.find((k) => k.ten === ten);
    expect(tim("taiDuLieu")).toMatchObject({ kind: "function", dong: dongCua(TS, "function taiDuLieu") });
    expect(tim("taiDuLieu")!.chuKy).toBe("export async function taiDuLieu(id: number): Promise<string>");
    expect(tim("KhoHang")).toMatchObject({ kind: "class", dong: dongCua(TS, "class KhoHang") });
    expect(tim("themMuc")).toMatchObject({ kind: "method", dong: dongCua(TS, "async themMuc") });
    expect(tim("CauHinhKho")).toMatchObject({ kind: "interface", dong: dongCua(TS, "interface CauHinhKho") });
    expect(tim("MaKho")).toMatchObject({ kind: "type", dong: dongCua(TS, "type MaKho") });
    expect(tim("TrangThaiKho")).toMatchObject({ kind: "enum", dong: dongCua(TS, "enum TrangThaiKho") });
    expect(tim("TRAN_KHO")).toMatchObject({ kind: "const", dong: dongCua(TS, "TRAN_KHO") });
    expect(tim("tinhTong")).toMatchObject({ kind: "function", dong: dongCua(TS, "tinhTong") });
    // Từ khoá điều khiển KHÔNG phải phương thức; lời gọi `super()` / `push(` không phải định nghĩa.
    expect(ky.map((k) => k.ten)).not.toContain("if");
    expect(ky.map((k) => k.ten)).not.toContain("push");
    expect(ky.map((k) => k.ten)).not.toContain("super");
  });

  it("Python: def cấp đỉnh = function, def thụt lề = method, class, HẰNG cấp đỉnh", () => {
    const py = ["MAX_RETRY = 3", "", "class Kho:", "    def them(self, x):", "        return x", "", "async def tai(url):", "    pass"].join("\n");
    const ky = trichKyHieu(py, "py");
    expect(ky).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ten: "MAX_RETRY", kind: "const", dong: 1 }),
        expect.objectContaining({ ten: "Kho", kind: "class", dong: 3 }),
        expect.objectContaining({ ten: "them", kind: "method", dong: 4 }),
        expect.objectContaining({ ten: "tai", kind: "function", dong: 7 }),
      ]),
    );
  });

  it("C# / Java / Kotlin / Go / Rust / C++ — mỗi ngôn ngữ thấy kiểu + hàm/phương thức", () => {
    const cs = ["namespace A {", "  public sealed class DonHang : IDon {", "    public async Task<int> TinhTien(int a) {", "      if (a > 0) { return a; }", "    }", "  }", "  public interface IDon { }", "  public enum Loai { A }", "}"].join("\n");
    const kyCs = trichKyHieu(cs, "cs");
    expect(kyCs).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "DonHang", kind: "class", dong: 2 }),
      expect.objectContaining({ ten: "TinhTien", kind: "method", dong: 3 }),
      expect.objectContaining({ ten: "IDon", kind: "interface", dong: 7 }),
      expect.objectContaining({ ten: "Loai", kind: "enum", dong: 8 }),
    ]));
    expect(kyCs.map((k) => k.ten)).not.toContain("if");

    const java = ["public class Kho {", "  private static final int MAX = 3;", "  public List<String> layDs(int n) throws IOException {", "    return null;", "  }", "}"].join("\n");
    expect(trichKyHieu(java, "java")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "Kho", kind: "class", dong: 1 }),
      expect.objectContaining({ ten: "layDs", kind: "method", dong: 3 }),
    ]));

    const kt = ["data class Diem(val x: Int)", "fun tinh(a: Int): Int = a", "const val GIOI_HAN = 5", "object Kho {", "  suspend fun tai(): String = \"\"", "}"].join("\n");
    expect(trichKyHieu(kt, "kt")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "Diem", kind: "class", dong: 1 }),
      expect.objectContaining({ ten: "tinh", kind: "function", dong: 2 }),
      expect.objectContaining({ ten: "GIOI_HAN", kind: "const", dong: 3 }),
      expect.objectContaining({ ten: "tai", kind: "method", dong: 5 }),
    ]));

    const go = ["package kho", "type Kho struct {", "  ds []int", "}", "type DocDuoc interface { Doc() }", "func (k *Kho) Them(x int) {", "}", "func TaoKho() *Kho { return nil }", "const MaxKho = 3"].join("\n");
    expect(trichKyHieu(go, "go")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "Kho", kind: "class", dong: 2 }),
      expect.objectContaining({ ten: "DocDuoc", kind: "interface", dong: 5 }),
      expect.objectContaining({ ten: "Them", kind: "method", dong: 6 }),
      expect.objectContaining({ ten: "TaoKho", kind: "function", dong: 8 }),
      expect.objectContaining({ ten: "MaxKho", kind: "const", dong: 9 }),
    ]));

    const rs = ["pub struct Kho { ds: Vec<i32> }", "pub trait DocDuoc { fn doc(&self); }", "impl Kho {", "    pub fn them(&mut self, x: i32) {", "    }", "}", "pub async fn tai() -> u8 { 0 }", "pub const MAX: u8 = 3;", "enum Loai { A }"].join("\n");
    expect(trichKyHieu(rs, "rs")).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "Kho", kind: "class", dong: 1 }),
      expect.objectContaining({ ten: "DocDuoc", kind: "interface", dong: 2 }),
      expect.objectContaining({ ten: "them", kind: "method", dong: 4 }),
      expect.objectContaining({ ten: "tai", kind: "function", dong: 7 }),
      expect.objectContaining({ ten: "MAX", kind: "const", dong: 8 }),
      expect.objectContaining({ ten: "Loai", kind: "enum", dong: 9 }),
    ]));

    const cpp = ["#define MAX_KHO 8", "struct Diem { int x; };", "class Kho : public Base {", "public:", "  void them(int x);", "};", "void Kho::them(int x) {", "  if (x) { return; }", "}", "static int tinh_tong(int a, int b)", "{", "  return a + b;", "}", "int khai_bao(int a);"].join("\n");
    const kyC = trichKyHieu(cpp, "c");
    expect(kyC).toEqual(expect.arrayContaining([
      expect.objectContaining({ ten: "MAX_KHO", kind: "const", dong: 1 }),
      expect.objectContaining({ ten: "Diem", kind: "class", dong: 2 }),
      expect.objectContaining({ ten: "Kho", kind: "class", dong: 3 }),
      expect.objectContaining({ ten: "them", kind: "method", dong: 7 }),
      expect.objectContaining({ ten: "tinh_tong", kind: "function", dong: 10 }),
    ]));
    // Khai báo nguyên mẫu (kết thúc `;`) KHÔNG phải định nghĩa; `if (` cũng không.
    expect(kyC.map((k) => k.ten)).not.toContain("khai_bao");
    expect(kyC.map((k) => k.ten)).not.toContain("if");
  });
});

describe("timKyHieu — định nghĩa + tham chiếu trên dự án tạm", () => {
  it("định nghĩa đúng tệp:dòng; tham chiếu theo RANH GIỚI TỪ, bỏ chính dòng định nghĩa", async () => {
    viet("src/kho.ts", TS);
    const dung = [`import { taiDuLieu } from "./kho";`, `const a = taiDuLieu(1);`, `const b = taiDuLieuCu(2); // tên dài hơn: KHÔNG phải tham chiếu`].join("\n");
    viet("src/dung.ts", dung);
    viet("tools/goi.py", "from x import y\nprint('taiDuLieu')\n");

    const kq = await timKyHieu({ gocDuAn: goc, ten: "taiDuLieu" });
    expect(kq.dinhNghia).toEqual([
      { duong: "src/kho.ts", dong: dongCua(TS, "function taiDuLieu"), kind: "function", chuKy: "export async function taiDuLieu(id: number): Promise<string>" },
    ]);
    const tc = kq.thamChieu.map((t) => `${t.duong}:${t.dong}`).sort();
    expect(tc).toEqual(["src/dung.ts:1", "src/dung.ts:2", "tools/goi.py:2"]);
    expect(kq.thamChieu.find((t) => t.duong === "src/dung.ts" && t.dong === 2)!.dongMa).toBe("const a = taiDuLieu(1);");
    expect(kq.catBot).toBe(false);
  });

  it("khớp CHÍNH XÁC trước; không có thì rơi về không phân biệt hoa/thường; lọc `kind`", async () => {
    viet("a.ts", "export function kho() {}\nexport class Kho {}\n");
    viet("b.py", "def KHOHANG():\n    pass\n");
    const chinhXac = await timKyHieu({ gocDuAn: goc, ten: "Kho" });
    expect(chinhXac.dinhNghia.map((d) => `${d.duong}:${d.dong}:${d.kind}`)).toEqual(["a.ts:2:class"]);
    const hoaThuong = await timKyHieu({ gocDuAn: goc, ten: "khohang" });
    expect(hoaThuong.dinhNghia.map((d) => `${d.duong}:${d.dong}`)).toEqual(["b.py:1"]);
    const loc = await timKyHieu({ gocDuAn: goc, ten: "kho", kind: "class" });
    expect(loc.dinhNghia.map((d) => `${d.duong}:${d.kind}`)).toEqual(["a.ts:class"]);
  });

  it("trần tham chiếu ⇒ cắt đúng N và khai `catBot`", async () => {
    viet("def.ts", "export function goi() {}\n");
    viet("dung.ts", Array.from({ length: 30 }, (_, i) => `goi(${i});`).join("\n"));
    const kq = await timKyHieu({ gocDuAn: goc, ten: "goi", tran: 5 });
    expect(kq.thamChieu).toHaveLength(5);
    expect(kq.catBot).toBe(true);
  });

  it("bộ đệm theo (tệp, mtime, kích thước): sửa tệp ⇒ lượt sau thấy định nghĩa mới", async () => {
    viet("a.ts", "export function cu() {}\n");
    expect((await timKyHieu({ gocDuAn: goc, ten: "moi" })).dinhNghia).toHaveLength(0);
    viet("a.ts", "export function cu() {}\nexport function moi() {}\n");
    const t = new Date(Date.now() + 5_000);
    fs.utimesSync(path.join(goc, "a.ts"), t, t);
    expect((await timKyHieu({ gocDuAn: goc, ten: "moi" })).dinhNghia.map((d) => d.dong)).toEqual([2]);
  });

  it("tệp vượt trần byte ⇒ vẫn trích phần đầu nhưng khai `catBot`", async () => {
    viet("lon.ts", "export function dau() {}\n" + "// x\n".repeat(5000));
    const kq = await timKyHieu({ gocDuAn: goc, ten: "dau", tranByteTep: 1024 });
    expect(kq.dinhNghia).toHaveLength(1);
    expect(kq.catBot).toBe(true);
  });
});

describe("timKyHieu — an toàn: CHỈ qua hộp cát", () => {
  it("đuôi cấm / tệp bí mật / thư mục cấm ⇒ định nghĩa mồi KHÔNG được thấy, nội dung KHÔNG lọt ra tham chiếu", async () => {
    viet(".env.ts", "export function moiBiMat() {}\n");
    viet(".env", "function moiBiMat() {}\n");
    viet("ghi-chu.pyc", "def moiBiMat():\n");
    viet("ban.exe", "function moiBiMat() {}\n");
    viet("node_modules/goi/index.ts", "export function moiBiMat() {}\n");
    viet("dist/bundle.js", "function moiBiMat() {}\n");
    viet("khoa.pem", "function moiBiMat() {}\n");
    const kq = await timKyHieu({ gocDuAn: goc, ten: "moiBiMat" });
    expect(kq.dinhNghia).toEqual([]);
    expect(kq.thamChieu).toEqual([]);
  });

  it("`..` / ngoài gốc (junction trỏ ra ngoài) ⇒ không đọc; tên không phải định danh ⇒ rỗng", async () => {
    const ngoai = path.join(tam, "ngoai");
    fs.mkdirSync(ngoai);
    fs.writeFileSync(path.join(ngoai, "evil.ts"), "export function moiNgoai() {}\n");
    viet("src/ok.ts", "export function trong() {}\n");
    try {
      fs.symlinkSync(ngoai, path.join(goc, "lien"), "junction");
    } catch {
      /* không tạo được liên kết trên máy này — phần còn lại của ca vẫn đo */
    }
    const kq = await timKyHieu({ gocDuAn: goc, ten: "moiNgoai" });
    expect(kq.dinhNghia).toEqual([]);
    expect(kq.thamChieu).toEqual([]);
    for (const ten of ["../ngoai/evil", "a b", "", "x".repeat(300)]) {
      const r = await timKyHieu({ gocDuAn: goc, ten });
      expect(r.dinhNghia, ten).toEqual([]);
      expect(r.thamChieu, ten).toEqual([]);
    }
  });

  it("tham chiếu đã CHE BÍ MẬT (dòng mã đi qua redactSecretsOnly)", async () => {
    viet("cfg.ts", `export function ketNoi() {}\nketNoi("postgres://aoi:matkhau123@db:5432/x");\n`);
    const kq = await timKyHieu({ gocDuAn: goc, ten: "ketNoi" });
    expect(kq.thamChieu).toHaveLength(1);
    expect(kq.thamChieu[0]!.dongMa).not.toContain("matkhau123");
  });
});

describe("`.gitignore` ở gốc — bản chụp/rác do công cụ sinh không nhân đôi định nghĩa", () => {
  it("phanTichGitignore/biBoQua: neo `/`, chỉ-thư-mục, `**`, `*.ext`, phủ định (dòng sau thắng)", () => {
    const l = phanTichGitignore("# chú thích\ntmp/\n/build-x\n**/sinh\n*.gen.ts\n!giu.gen.ts\n");
    expect(biBoQua(l, "tmp", true)).toBe(true);
    expect(biBoQua(l, "a/tmp", true)).toBe(true);
    expect(biBoQua(l, "tmp", false)).toBe(false); // `tmp/` chỉ áp cho THƯ MỤC
    expect(biBoQua(l, "build-x", true)).toBe(true);
    expect(biBoQua(l, "a/build-x", true)).toBe(false); // neo gốc
    expect(biBoQua(l, "x/y/sinh", true)).toBe(true);
    expect(biBoQua(l, "src/a.gen.ts", false)).toBe(true);
    expect(biBoQua(l, "src/giu.gen.ts", false)).toBe(false);
    expect(biBoQua(l, "src/a.ts", false)).toBe(false);
  });

  it("thư mục bị `.gitignore` bỏ ⇒ định nghĩa trong đó không xuất hiện; không có `.gitignore` ⇒ thấy hết", async () => {
    viet("src/kho.ts", "export function duyNhat() {}\n");
    viet("tmp/snap/src/kho.ts", "export function duyNhat() {}\n");
    viet("src/a.gen.ts", "export function duyNhat() {}\n");
    expect((await timKyHieu({ gocDuAn: goc, ten: "duyNhat" })).dinhNghia).toHaveLength(3);
    viet(".gitignore", "tmp/\n*.gen.ts\n");
    const kq = await timKyHieu({ gocDuAn: goc, ten: "duyNhat" });
    expect(kq.dinhNghia.map((d) => d.duong)).toEqual(["src/kho.ts"]);
  });
});

describe("dungBangKyHieu — thống kê dựng (dùng đo hiệu năng)", () => {
  it("đếm tệp + ký hiệu, khai thời gian", async () => {
    viet("src/kho.ts", TS);
    viet("b.py", "def a():\n    pass\n");
    viet("README.md", "# không phải mã\n");
    const tk = await dungBangKyHieu({ gocDuAn: goc });
    expect(tk.soTep).toBe(2);
    expect(tk.soKyHieu).toBeGreaterThanOrEqual(10);
    expect(tk.catBot).toBe(false);
    expect(tk.ms).toBeGreaterThanOrEqual(0);
  });
});
