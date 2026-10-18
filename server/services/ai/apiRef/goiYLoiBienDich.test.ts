/**
 * ★ (2026-10-19) "Gợi ý tra cứu API (tự động)" — khuyến nghị #2 báo cáo nguồn học (bản TẤT ĐỊNH): lỗi biên dịch/chạy
 * dạng "không tìm thấy kiểu/thành viên/namespace" ⇒ máy chủ tự trích tên, tra chỉ mục `traApi`, gắn khối gợi ý ngắn —
 * không phụ thuộc model tự gọi `lookup_api` (bộ ngẫu nhiên: 2 lần gọi / 81 lượt).
 *
 * MẪU ĐẦU RA LÀ THẬT (không gõ tay):
 *   • C# CS0246 `Xunit`/`Fact` — sự kiện `ai_agent_runs` lượt NN-b-agent-3 cs-tv1 (2026-10-18); CS1061/CS0103 dự án —
 *     `scripts/ai-eval/codegen-chay-duoc/reports/F-kiem-goc-1.json`; CS0246/CS0234/CS1061/CS0103 thư viện — `dotnet build`
 *     .NET SDK 10.0.302 trên máy này (2026-10-19), đường dẫn rút gọn.
 *   • TS — `tsc` 5.x của repo (2026-10-19). Java — `javac` JDK 26.0.1. Python — pytest 9.1.1 / Python 3.14.6; NameError dự án
 *     từ `NN-a-pipe-2026-10-18c.json`. Go — go1.27.2 `go build` + `NN-a-raw-2026-10-18b.json`. Rust — rustc 1.99.1.
 *
 * ĐỘT BIẾN PHẢI BẮT: trích sai tên (lấy cả đường/ngoặc) · không khử trùng · vượt trần số tên · tra ngôn ngữ chưa có chỉ mục
 * (Go/Rust ⇒ khớp nhầm C#/Java) · gắn khối khi KHÔNG có mục khớp · khối vượt trần độ dài · khớp thành viên của kiểu khác
 * cho tên trần (`fs` ⇒ `Utf8StreamOptions.fs`) · công tắc `AI_AGENT_TU_TRA_API=0` không tắt · bộ tra ném ⇒ ném theo.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu
import { vietChiMuc } from "../../../../scripts/ai-kb/api-ref/phanTich.mjs";
import { moChiMucApi, type ChiMucApiMo, type TraApi } from "./traApi";
import { goiYTraApiTuDauRa, trichTenLoiBienDich, tuTraApiBat, TIEU_DE_GOI_Y_API } from "./goiYLoiBienDich";

// ─── mẫu đầu ra THẬT ────────────────────────────────────────────────────────────────────────────
const CS_XUNIT = [
  String.raw`D:\SOURCES\_ai7_nnbai\_bai\obj\Debug\net10.0\Bai.GlobalUsings.g.cs(9,14): error CS0246: The type or namespace name 'Xunit' could not be found (are you missing a using directive or an assembly reference?) [D:\SOURCES\_ai7_nnbai\_bai\Bai.csproj]`,
  String.raw`D:\SOURCES\_ai7_nnbai\_bai\tests\HienThiTests.cs(10,6): error CS0246: The type or namespace name 'FactAttribute' could not be found (are you missing a using directive or an assembly reference?) [D:\SOURCES\_ai7_nnbai\_bai\Bai.csproj]`,
  String.raw`D:\SOURCES\_ai7_nnbai\_bai\tests\HienThiTests.cs(10,6): error CS0246: The type or namespace name 'Fact' could not be found (are you missing a using directive or an assembly reference?) [D:\SOURCES\_ai7_nnbai\_bai\Bai.csproj]`,
  String.raw`D:\SOURCES\_ai7_nnbai\_bai\tests\HienThiTests.cs(17,6): error CS0246: The type or namespace name 'FactAttribute' could not be found (are you missing a using directive or an assembly reference?) [D:\SOURCES\_ai7_nnbai\_bai\Bai.csproj]`,
].join("\r\n");
const CS_DU_AN = [
  String.raw`D:\SOURCES\_ai7_wt\tmp\agent-f-work\cs-dat-phong\tests\DatPhong.Tests\AnFDatLapLaiTests.cs(98,20): error CS1061: 'DichVuDatPhong' does not contain a definition for 'DatLapLai' and no accessible extension method 'DatLapLai' accepting a first argument of type 'DichVuDatPhong' could be found (are you missing a using directive or an assembly reference?) [D:\SOURCES\_ai7_wt\tmp\agent-f-work\cs-dat-phong\tests\DatPhong.Tests\DatPhong.Tests.csproj]`,
  String.raw`D:\SOURCES\_ai7_wt\tmp\agent-f-work\cs-nhat-ky\tests\NhatKy.Tests\AnFBaoCaoNguonTests.cs(71,18): error CS0103: The name 'BaoCaoNguon' does not exist in the current context [D:\SOURCES\_ai7_wt\tmp\agent-f-work\cs-nhat-ky\tests\NhatKy.Tests\NhatKy.Tests.csproj]`,
].join("\r\n");
const CS_THU_VIEN = [
  String.raw`D:\bai\A.cs(3,18): error CS0246: The type or namespace name 'StringBuilder' could not be found (are you missing a using directive or an assembly reference?) [D:\bai\a.csproj]`,
  String.raw`D:\bai\A.cs(4,13): error CS0234: The type or namespace name 'JsonDocumentt' does not exist in the namespace 'System.Text.Json' (are you missing an assembly reference?) [D:\bai\a.csproj]`,
  String.raw`D:\bai\A.cs(5,15): error CS1061: 'List<int>' does not contain a definition for 'Where' and no accessible extension method 'Where' accepting a first argument of type 'List<int>' could be found (are you missing a using directive or an assembly reference?) [D:\bai\a.csproj]`,
  String.raw`D:\bai\A.cs(5,43): error CS0103: The name 'Math' does not exist in the current context [D:\bai\a.csproj]`,
  "",
  "Build FAILED.",
].join("\r\n");
const TS = [
  `a.ts(1,19): error TS2307: Cannot find module 'khong-co-goi' or its corresponding type declarations.`,
  `a.ts(2,15): error TS2552: Cannot find name 'Mapp'. Did you mean 'Map'?`,
  `a.ts(4,15): error TS2551: Property 'lenght' does not exist on type '"abc"'. Did you mean 'length'?`,
  `a.ts(4,23): error TS2304: Cannot find name 'readFileSync'.`,
].join("\n");
const TS2339 = `src/kho.ts(12,9): error TS2339: Property 'flatMapp' does not exist on type 'Map<string, number>'.`;
const JAVA = [
  "A.java:3: error: cannot find symbol",
  "    List<String> xs = new ArrayList<>();",
  "    ^",
  "  symbol:   class List",
  "  location: class A",
  "A.java:3: error: cannot find symbol",
  "    List<String> xs = new ArrayList<>();",
  "                          ^",
  "  symbol:   class ArrayList",
  "  location: class A",
  "A.java:5: error: cannot find symbol",
  "    System.out.println(s.lenght() + xs.size());",
  "                        ^",
  "  symbol:   method lenght()",
  "  location: variable s of type String",
  "3 errors",
].join("\r\n");
const JAVA_DU_AN = [
  String.raw`src\DuongLuoi.java:60: error: cannot find symbol`,
  "            segReach[i] = computeReach(luoi, r1, c1, r2, c2);",
  "                          ^",
  "  symbol:   method computeReach(String[],int,int,int,int)",
  "  location: class DuongLuoi",
  "1 error",
].join("\r\n");
const PY = [
  "    def test_a():",
  ">       d = OrderedDict()",
  "            ^^^^^^^^^^^",
  "E       NameError: name 'OrderedDict' is not defined",
  "",
  "test_a.py:3: NameError",
  "    def test_b():",
  '>       assert json.loadz("1") == 1',
  "E       AttributeError: module 'json' has no attribute 'loadz'. Did you mean: 'load'?",
  "E   ModuleNotFoundError: No module named 'dang_ky.kiem_tra'",
  "=========================== short test summary info ===========================",
  "FAILED test_a.py::test_a - NameError: name 'OrderedDict' is not defined",
  "FAILED test_a.py::test_b - AttributeError: module 'json' has no attribute 'lo...",
].join("\r\n");
const PY_DU_AN = "E               NameError: name 'TRANG_THAI' is not defined\r\ndon_hang\\ung_dung.py:47: NameError\r\n";
const GO = [
  "# bai",
  String.raw`.\a.go:7:4: b.WriteStrin undefined (type strings.Builder has no field or method WriteStrin)`,
  String.raw`.\a.go:8:9: undefined: Max`,
  String.raw`.\a.go:8:21: undefined: strconv`,
  String.raw`.\rpn.go:29:23: undefined: math.Add`,
].join("\n");
const RUST = [
  "error[E0425]: cannot find type `HashMap` in this scope",
  " --> a.rs:2:12",
  "error[E0433]: cannot find type `HashMap` in this scope",
  "  |                                   ^^^^^^^ use of undeclared type `HashMap`",
  "error[E0425]: cannot find value `khong_co` in this scope",
  "error[E0599]: no method named `lenn` found for struct `String` in the current scope",
  "error[E0599]: no method named `is_lowercase` found for reference `&String` in the current scope",
].join("\n");

// ─── chỉ mục nhỏ dựng bằng ĐÚNG bộ ghi của bộ dựng ───────────────────────────────────────────────
const m = (o: Record<string, unknown>) => ({ tomTat: "", chuKy: String(o.ten), ...o });
let thuMuc = "";
let cm: ChiMucApiMo;
let traThat: TraApi;

beforeAll(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "goi-y-loi-"));
  const cs = [
    m({ nn: "csharp", loai: "type", ns: "System.Text", ten: "StringBuilder", tep: "System.Runtime.xml", _nhom: "sb" }),
    m({ nn: "csharp", loai: "method", ns: "System.Text", ten: "StringBuilder.Append", cha: "StringBuilder", chuKy: "Append(string? value)", _thuoc: "sb", tep: "System.Runtime.xml" }),
    m({ nn: "csharp", loai: "type", ns: "System", ten: "Math", tep: "System.Runtime.xml" }),
    m({ nn: "csharp", loai: "type", ns: "System.Linq", ten: "Enumerable", tep: "System.Linq.xml", _nhom: "en" }),
    m({ nn: "csharp", loai: "method", ns: "System.Linq", ten: "Enumerable.Where", cha: "Enumerable", chuKy: "Where<TSource>(this IEnumerable<TSource> source, Func<TSource, bool> predicate)", _thuoc: "en", tep: "System.Linq.xml" }),
    m({ nn: "csharp", loai: "type", ns: "System.Collections.Generic", ten: "List", tep: "System.Collections.xml", _nhom: "li" }),
    m({ nn: "csharp", loai: "method", ns: "System.Collections.Generic", ten: "List.Add", cha: "List", chuKy: "Add(T item)", _thuoc: "li", tep: "System.Collections.xml" }),
    m({ nn: "csharp", loai: "type", ns: "System.Text.Json", ten: "JsonDocument", tep: "System.Text.Json.xml" }),
  ];
  const java = [
    m({ nn: "java", loai: "interface", ns: "java.util", ten: "List", chuKy: "public interface List<E> extends SequencedCollection<E>", tep: "java/util/List.java" }),
    m({ nn: "java", loai: "class", ns: "java.util", ten: "ArrayList", chuKy: "public class ArrayList<E> extends AbstractList<E>", tep: "java/util/ArrayList.java" }),
    m({ nn: "java", loai: "class", ns: "java.lang", ten: "String", chuKy: "public final class String", _nhom: "str", tep: "java/lang/String.java" }),
    m({ nn: "java", loai: "method", ns: "java.lang", ten: "String.length", cha: "String", chuKy: "public int length()", _thuoc: "str", tep: "java/lang/String.java" }),
    m({ nn: "java", loai: "method", ns: "java.lang", ten: "String.lines", cha: "String", chuKy: "public Stream<String> lines()", _thuoc: "str", tep: "java/lang/String.java" }),
    m({ nn: "java", loai: "method", ns: "java.lang", ten: "String.isEmpty", cha: "String", chuKy: "public boolean isEmpty()", _thuoc: "str", tep: "java/lang/String.java" }),
  ];
  const py = [
    m({ nn: "python", loai: "class", ns: "collections", ten: "OrderedDict", chuKy: "class OrderedDict(...)", tep: "collections/__init__.py" }),
    m({ nn: "python", loai: "module", ns: "json", ten: "json", chuKy: "import json", tep: "json/__init__.py" }),
    m({ nn: "python", loai: "function", ns: "json", ten: "load", chuKy: "load(fp, *, cls=None, ...)", tep: "json/__init__.py" }),
  ];
  const ts = [
    m({ nn: "typescript", loai: "function", ns: "fs", ten: "readFileSync", chuKy: "export function readFileSync(path: PathOrFileDescriptor, options?: ...): NonSharedBuffer;", tep: "fs.d.ts" }),
    m({ nn: "typescript", loai: "property", ns: "fs", ten: "ReadStreamOptions.fs", cha: "ReadStreamOptions", chuKy: "fs?: CreateReadStreamFSImplementation | null | undefined;", tep: "fs.d.ts" }),
    m({ nn: "typescript", loai: "interface", ns: "", ten: "Map", chuKy: "interface Map<K, V>", _nhom: "map", tep: "lib.es2015.collection.d.ts" }),
    m({ nn: "typescript", loai: "method", ns: "", ten: "Map.forEach", cha: "Map", chuKy: "forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;", _thuoc: "map", tep: "lib.es2015.collection.d.ts" }),
    m({ nn: "typescript", loai: "method", ns: "", ten: "Map.entries", cha: "Map", chuKy: "entries(): MapIterator<[K, V]>;", _thuoc: "map", tep: "lib.es2015.iterable.d.ts" }),
    m({ nn: "typescript", loai: "interface", ns: "", ten: "String", chuKy: "interface String", _nhom: "s", tep: "lib.es5.d.ts" }),
    m({ nn: "typescript", loai: "property", ns: "", ten: "String.length", cha: "String", chuKy: "readonly length: number;", _thuoc: "s", tep: "lib.es5.d.ts" }),
  ];
  vietChiMuc(
    thuMuc,
    [
      { id: "dotnet", nn: "csharp", nhan: ".NET 10.0.10", muc: cs },
      { id: "jdk", nn: "java", nhan: "JDK 26.0.1", muc: java },
      { id: "py", nn: "python", nhan: "Python 3.14 stdlib", muc: py },
      { id: "ts", nn: "typescript", nhan: "TypeScript lib + @types/node", muc: ts },
    ],
    { taoLuc: "2026-10-19T00:00:00Z" },
  );
  cm = moChiMucApi(thuMuc)!;
  traThat = async (y) => cm.tra(y);
});
afterAll(() => fs.rmSync(thuMuc, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const tenCua = (s: string) => trichTenLoiBienDich(s).map((t) => `${t.nn}:${t.ma}:${t.ten}`);

describe("trichTenLoiBienDich — mỗi ngôn ngữ một mẫu đầu ra THẬT", () => {
  it("C# CS0246/CS0234/CS1061/CS0103 (dotnet build thật) — tên sạch, thành viên tách kiểu, generic bỏ", () => {
    const ds = trichTenLoiBienDich(CS_THU_VIEN);
    expect(ds.map((t) => `${t.nn}:${t.ma}:${t.ten}`)).toEqual([
      "csharp:CS0246:StringBuilder",
      "csharp:CS0234:System.Text.Json.JsonDocumentt",
      "csharp:CS1061:List.Where",
      "csharp:CS0103:Math",
    ]);
    expect(ds[2]).toMatchObject({ kieu: "List", thanhVien: "Where" });
  });

  it("C# khử trùng tên lặp (sự kiện thật NN-b-agent-3: Xunit/FactAttribute/Fact lặp nhiều dòng)", () => {
    expect(tenCua(CS_XUNIT)).toEqual(["csharp:CS0246:Xunit", "csharp:CS0246:FactAttribute", "csharp:CS0246:Fact"]);
  });

  it("TypeScript TS2307/TS2552/TS2551/TS2304 (tsc thật) + TS2339 — kiểu chuỗi literal ⇒ String, generic bỏ", () => {
    expect(tenCua(TS)).toEqual([
      "typescript:TS2307:khong-co-goi",
      "typescript:TS2552:Mapp",
      "typescript:TS2551:String.lenght",
      "typescript:TS2304:readFileSync",
    ]);
    expect(trichTenLoiBienDich(TS2339)).toEqual([{ nn: "typescript", ma: "TS2339", ten: "Map.flatMapp", kieu: "Map", thanhVien: "flatMapp" }]);
  });

  it("Java `cannot find symbol` (javac thật) — class ⇒ tên trần; method + `variable s of type String` ⇒ String.lenght", () => {
    expect(tenCua(JAVA)).toEqual(["java:cannot find symbol:List", "java:cannot find symbol:ArrayList", "java:cannot find symbol:String.lenght"]);
    expect(tenCua(JAVA_DU_AN)).toEqual(["java:cannot find symbol:DuongLuoi.computeReach"]);
  });

  it("Python traceback pytest (thật) — NameError / AttributeError module / ModuleNotFoundError", () => {
    expect(tenCua(PY)).toEqual([
      "python:NameError:OrderedDict",
      "python:AttributeError:json.loadz",
      "python:ModuleNotFoundError:dang_ky.kiem_tra",
    ]);
  });

  it("Go `undefined:` + `X undefined (type T has no field or method M)` (go build thật)", () => {
    expect(tenCua(GO)).toEqual(["go:undefined:strings.Builder.WriteStrin", "go:undefined:Max", "go:undefined:strconv", "go:undefined:math.Add"]);
  });

  it("Rust E0425/E0433/E0599 (rustc 1.99 thật) — `&String` ⇒ String", () => {
    expect(tenCua(RUST)).toEqual(["rust:E0425:HashMap", "rust:E0425:khong_co", "rust:E0599:String.lenn", "rust:E0599:String.is_lowercase"]);
  });

  it("trần số tên (mặc định 5) + đầu ra sạch ⇒ rỗng", () => {
    expect(trichTenLoiBienDich(`${GO}\n${RUST}`).length).toBe(5);
    expect(trichTenLoiBienDich("ok - tất cả xanh\nKT_TONG pass=3 fail=0")).toEqual([]);
  });
});

describe("goiYTraApiTuDauRa — khối gợi ý (chỉ khi chỉ mục có mục khớp)", () => {
  it("★ C# thư viện: using đúng cho StringBuilder/Math; CS1061 List<int>.Where ⇒ phương thức mở rộng System.Linq", async () => {
    const g = await goiYTraApiTuDauRa(CS_THU_VIEN, traThat);
    expect(g).not.toBeNull();
    expect(g!.vanBan).toContain(TIEU_DE_GOI_Y_API);
    expect(g!.vanBan).toMatch(/NOT part of the command output/i);
    expect(g!.vanBan).toContain("using System.Text;");
    expect(g!.vanBan).toContain("using System;");
    expect(g!.vanBan).toContain("using System.Linq;");
    expect(g!.ten).toEqual(["StringBuilder", "List.Where", "Math"]);
    // JsonDocumentt không có trong chỉ mục ⇒ không có dòng nào cho nó (không bịa)
    expect(g!.vanBan).not.toContain("JsonDocumentt");
    // mỗi tên ≤ 3 dòng
    const dongMuc = g!.vanBan.split("\n").filter((d) => d.trim() !== "").slice(1);
    expect(dongMuc.length).toBeLessThanOrEqual(3 * g!.ten.length);
  });

  it("TS: readFileSync ⇒ import từ \"fs\"; thuộc tính sai trên kiểu có trong chỉ mục ⇒ thành viên gần nhất", async () => {
    const g = await goiYTraApiTuDauRa(`${TS}\n${TS2339}`, traThat);
    expect(g!.vanBan).toContain('import { readFileSync } from "fs";');
    expect(g!.vanBan).toMatch(/String[\s\S]*length/);
    expect(g!.vanBan).toMatch(/Map[\s\S]*(forEach|entries)/);
    expect(g!.ten).not.toContain("khong-co-goi");
  });

  it("Java: import java.util.List / ArrayList; String.lenght ⇒ gần nhất length()", async () => {
    const g = await goiYTraApiTuDauRa(JAVA, traThat);
    expect(g!.vanBan).toContain("import java.util.List;");
    expect(g!.vanBan).toContain("import java.util.ArrayList;");
    expect(g!.vanBan).toContain("length()");
  });

  it("Python: OrderedDict ⇒ from collections import OrderedDict", async () => {
    const g = await goiYTraApiTuDauRa(PY, traThat);
    expect(g!.vanBan).toContain("from collections import OrderedDict");
    expect(g!.ten).toContain("OrderedDict");
  });

  it("tên của DỰ ÁN (không có trong chỉ mục) ⇒ null — không gắn khối rỗng", async () => {
    expect(await goiYTraApiTuDauRa(CS_DU_AN, traThat)).toBeNull();
    expect(await goiYTraApiTuDauRa(JAVA_DU_AN, traThat)).toBeNull();
    expect(await goiYTraApiTuDauRa(PY_DU_AN, traThat)).toBeNull();
  });

  it("Go/Rust: chỉ mục chưa có ngôn ngữ ⇒ KHÔNG gọi bộ tra (không khớp nhầm C#/Java), null", async () => {
    const goi: unknown[] = [];
    const g = await goiYTraApiTuDauRa(`${GO}\n${RUST}`, async (y) => {
      goi.push(y);
      return cm.tra(y);
    });
    expect(g).toBeNull();
    expect(goi).toEqual([]);
  });

  it("tên trần KHÔNG khớp thành viên của kiểu khác (TS2304 'fs' ⇏ ReadStreamOptions.fs)", async () => {
    expect(await goiYTraApiTuDauRa("a.ts(1,1): error TS2304: Cannot find name 'fs'.", traThat)).toBeNull();
  });

  it("trần độ dài toàn khối", async () => {
    const g = await goiYTraApiTuDauRa(`${CS_THU_VIEN}\n${JAVA}`, traThat, { tranKyTu: 300 });
    expect(g!.vanBan.length).toBeLessThanOrEqual(300);
  });

  it("bộ tra trả null (chỉ mục chưa dựng) hoặc NÉM ⇒ null, không ném", async () => {
    expect(await goiYTraApiTuDauRa(CS_THU_VIEN, async () => null)).toBeNull();
    await expect(
      goiYTraApiTuDauRa(CS_THU_VIEN, async () => {
        throw new Error("đĩa hỏng");
      }),
    ).resolves.toBeNull();
  });
});

describe("tuTraApiBat — công tắc AI_AGENT_TU_TRA_API", () => {
  it("mặc định BẬT; '0' / 'false' / 'off' ⇒ tắt", () => {
    expect(tuTraApiBat(undefined)).toBe(true);
    expect(tuTraApiBat("1")).toBe(true);
    expect(tuTraApiBat("0")).toBe(false);
    expect(tuTraApiBat("false")).toBe(false);
    expect(tuTraApiBat(" OFF ")).toBe(false);
  });
});

describe.skipIf(!fs.existsSync(path.join(process.cwd(), "knowledge", "api-ref", "ky-hieu", "chi-muc.tsv")))("chỉ mục THẬT của máy (nếu đã dựng)", () => {
  it("dotnet build thật ⇒ using System.Text; / using System.Linq;", async () => {
    const that = moChiMucApi(path.join(process.cwd(), "knowledge", "api-ref", "ky-hieu"))!;
    const g = await goiYTraApiTuDauRa(CS_THU_VIEN, async (y) => that.tra(y));
    expect(g!.vanBan).toContain("using System.Text;");
    expect(g!.vanBan).toContain("using System.Linq;");
  });
});
