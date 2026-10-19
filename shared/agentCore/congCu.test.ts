import { describe, expect, it } from "vitest";
import {
  CONG_CU,
  TEN_CONG_CU,
  LOAI_CONG_CU,
  congCuTheoCheDo,
  kiemThamSo,
  apDungEdits,
  chuanHoaThamSo,
} from "./congCu";
// Chỉ TEST được nhìn sang server (lõi thì không): đối chiếu schema với đúng bộ kiểm grammar của đường /v1.
import { timGioiHanGrammar, type WireTool as WireToolServer } from "../../server/services/ai/nativeToolCalls";
import type { WireTool } from "./kieu";

const tenTheoCheDo = (c: Parameters<typeof congCuTheoCheDo>[0]) => congCuTheoCheDo(c).map((t) => t.function.name).sort();

describe("congCu — schema 15 tool (10 của Đợt 1 + 4 của Đợt 2 + lookup_api)", () => {
  it("có đúng 15 tool (spec Đợt 1 §3 + Đợt 2 §2 + lookup_api 2026-10-18), tên tiếng Anh, có mô tả + parameters object", () => {
    expect([...TEN_CONG_CU].sort()).toEqual(
      [
        "delete_file",
        "edit_file",
        "find_files",
        "find_symbol",
        "grep",
        "list_dir",
        "lookup_api",
        "read_file",
        "remember",
        "rename_file",
        "run_command",
        "search_code",
        "search_docs",
        "todo_write",
        "write_file",
      ].sort(),
    );
    for (const t of CONG_CU) {
      expect(t.type).toBe("function");
      expect(t.function.description && t.function.description.length).toBeGreaterThan(10);
      expect((t.function.parameters as any).type).toBe("object");
      expect(Array.isArray((t.function.parameters as any).required)).toBe(true);
    }
  });

  it("lọt bộ kiểm grammar llama.cpp của server (không pattern xấu, không maxLength > 1999)", () => {
    // gán chéo kiểu: WireTool của lõi phải dùng được ở chỗ WireTool của server và ngược lại
    const sangServer: WireToolServer[] = CONG_CU;
    const veLoi: WireTool[] = sangServer;
    expect(timGioiHanGrammar(veLoi)).toEqual([]);
    // từ khoá schema `pattern` (giá trị chuỗi) cấm hẳn; `pattern` là TÊN thuộc tính của grep/find_files thì được
    const khoaPattern: string[] = [];
    const duyet = (n: unknown, duong: string) => {
      if (!n || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n)) {
        if (k === "pattern" && typeof v === "string") khoaPattern.push(duong);
        duyet(v, `${duong}.${k}`);
      }
    };
    duyet(CONG_CU, "");
    expect(khoaPattern).toEqual([]);
  });

  it("phân loại đọc/ghi/lệnh/kế hoạch", () => {
    expect(LOAI_CONG_CU.read_file).toBe("doc");
    expect(LOAI_CONG_CU.grep).toBe("doc");
    expect(LOAI_CONG_CU.edit_file).toBe("ghi");
    expect(LOAI_CONG_CU.rename_file).toBe("ghi");
    expect(LOAI_CONG_CU.run_command).toBe("lenh");
    expect(LOAI_CONG_CU.todo_write).toBe("ke-hoach");
  });

  it("congCuTheoCheDo: hoi = đọc (kể cả 3 tool tìm + lookup_api) + todo_write + remember; sua/tu-dong = đủ 15", () => {
    expect(tenTheoCheDo("hoi")).toEqual([
      "find_files",
      "find_symbol",
      "grep",
      "list_dir",
      "lookup_api",
      "read_file",
      "remember",
      "search_code",
      "search_docs",
      "todo_write",
    ]);
    expect(tenTheoCheDo("sua")).toHaveLength(15);
    expect(tenTheoCheDo("tu-dong")).toHaveLength(15);
  });

  it("congCuTheoCheDo trả bản sao — sửa kết quả không làm bẩn hằng", () => {
    const a = congCuTheoCheDo("sua");
    (a[0].function as any).name = "bi_sua";
    expect(congCuTheoCheDo("sua")[0].function.name).not.toBe("bi_sua");
  });
});

describe("kiemThamSo — parse an toàn + chuẩn hoá", () => {
  it("chuỗi JSON đúng ⇒ ok", () => {
    const r = kiemThamSo("read_file", '{"path":"src/a.ts","start_line":3}');
    expect(r).toEqual({ ok: true, thamSo: { path: "src/a.ts", start_line: 3 } });
  });

  it("object sẵn ⇒ ok; khoá lạ bị bỏ", () => {
    const r = kiemThamSo("list_dir", { path: ".", la: 1 });
    expect(r).toEqual({ ok: true, thamSo: { path: "." } });
  });

  it("JSON hỏng ⇒ ok:false với thông điệp sửa cho model (nêu tool + ví dụ), không ném", () => {
    const r = kiemThamSo("read_file", '{"path": "src/a.ts"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loiChoModel).toMatch(/read_file/);
    expect(r.loiChoModel).toMatch(/not valid JSON/i);
    expect(r.loiChoModel).toMatch(/"path"/);
  });

  it("chuỗi rỗng ⇒ {} rồi báo thiếu trường bắt buộc", () => {
    const r = kiemThamSo("read_file", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loiChoModel).toMatch(/missing required.*path/i);
  });

  it("JSON bọc rào ```json ⇒ vẫn đọc được", () => {
    const r = kiemThamSo("list_dir", '```json\n{"path":"src"}\n```');
    expect(r).toEqual({ ok: true, thamSo: { path: "src" } });
  });

  it("không phải object (mảng/số) ⇒ lỗi", () => {
    expect(kiemThamSo("list_dir", "[1,2]").ok).toBe(false);
    expect(kiemThamSo("list_dir", "42").ok).toBe(false);
  });

  it("sai kiểu ⇒ lỗi nêu tên trường; số dạng chuỗi được ép", () => {
    const sai = kiemThamSo("read_file", { path: 5 });
    expect(sai.ok).toBe(false);
    if (!sai.ok) expect(sai.loiChoModel).toMatch(/path.*string/i);
    expect(kiemThamSo("read_file", { path: "a", start_line: "10", end_line: 20 })).toEqual({
      ok: true,
      thamSo: { path: "a", start_line: 10, end_line: 20 },
    });
    expect(kiemThamSo("read_file", { path: "a", start_line: "mười" }).ok).toBe(false);
  });

  it("đường rỗng / có NUL ⇒ lỗi", () => {
    expect(kiemThamSo("read_file", { path: "" }).ok).toBe(false);
    expect(kiemThamSo("read_file", { path: "a\u0000b" }).ok).toBe(false);
  });

  it("edit_file: edits đúng hình; replace_all tuỳ chọn; edits dạng chuỗi JSON (mã hoá kép) được chấp nhận", () => {
    const r = kiemThamSo("edit_file", {
      path: "a.ts",
      edits: JSON.stringify([{ old_string: "x", new_string: "y", replace_all: "true" }]),
    });
    expect(r).toEqual({
      ok: true,
      thamSo: { path: "a.ts", edits: [{ old_string: "x", new_string: "y", replace_all: true }] },
    });
  });

  it("edit_file: dạng phẳng {path, old_string, new_string} ⇒ chuẩn hoá thành edits[1]", () => {
    const r = kiemThamSo("edit_file", '{"path":"a.ts","old_string":"x","new_string":"y"}');
    expect(r).toEqual({ ok: true, thamSo: { path: "a.ts", edits: [{ old_string: "x", new_string: "y" }] } });
  });

  it("edit_file: edits rỗng / thiếu new_string ⇒ lỗi nêu chỉ số", () => {
    expect(kiemThamSo("edit_file", { path: "a", edits: [] }).ok).toBe(false);
    const r = kiemThamSo("edit_file", { path: "a", edits: [{ old_string: "x", new_string: "y" }, { old_string: "z" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loiChoModel).toMatch(/edits\[1\]\.new_string/);
  });

  it("write_file: content chuỗi (cho phép rỗng); rename_file: from/to; run_command: command", () => {
    expect(kiemThamSo("write_file", { path: "a", content: "" }).ok).toBe(true);
    expect(kiemThamSo("write_file", { path: "a" }).ok).toBe(false);
    expect(kiemThamSo("rename_file", { from: "a", to: "b" })).toEqual({ ok: true, thamSo: { from: "a", to: "b" } });
    expect(kiemThamSo("rename_file", { from: "a" }).ok).toBe(false);
    expect(kiemThamSo("run_command", { command: "  " }).ok).toBe(false);
    expect(kiemThamSo("run_command", { command: "npm test" })).toEqual({ ok: true, thamSo: { command: "npm test" } });
  });

  it("grep: pattern bắt buộc, path/include tuỳ chọn; find_files: pattern", () => {
    expect(kiemThamSo("grep", { pattern: "foo", include: "*.ts" })).toEqual({
      ok: true,
      thamSo: { pattern: "foo", include: "*.ts" },
    });
    expect(kiemThamSo("find_files", {}).ok).toBe(false);
  });

  it("todo_write: status hợp lệ; status lạ ⇒ lỗi liệt kê giá trị đúng", () => {
    expect(
      kiemThamSo("todo_write", { todos: [{ content: "a", status: "pending" }, { content: "b", status: "completed" }] }),
    ).toEqual({
      ok: true,
      thamSo: { todos: [{ content: "a", status: "pending" }, { content: "b", status: "completed" }] },
    });
    const r = kiemThamSo("todo_write", { todos: [{ content: "a", status: "done" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loiChoModel).toMatch(/pending.*in_progress.*completed/);
  });

  it("tool ngoài bộ 14 ⇒ chỉ đòi object (bộ thực thi tự kiểm)", () => {
    expect(kiemThamSo("get_diagnostics", '{"x":1}')).toEqual({ ok: true, thamSo: { x: 1 } });
    expect(kiemThamSo("get_diagnostics", "{hỏng").ok).toBe(false);
  });

  it("chuanHoaThamSo: thứ tự khoá không ảnh hưởng", () => {
    expect(chuanHoaThamSo({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(
      chuanHoaThamSo({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });
});

describe("apDungEdits", () => {
  it("thay một lần khi old_string duy nhất", () => {
    expect(apDungEdits("a\nb\nc\n", [{ old_string: "b", new_string: "B" }])).toEqual({
      ok: true,
      noiDung: "a\nB\nc\n",
      soThayThe: 1,
    });
  });

  it("không tìm thấy ⇒ lỗi rõ + chỉ số edit", () => {
    const r = apDungEdits("abc", [{ old_string: "a", new_string: "A" }, { old_string: "zz", new_string: "y" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHONG_TIM_THAY");
    expect(r.chiSo).toBe(1);
    expect(r.loi).toMatch(/not found/i);
    expect(r.loi).toMatch(/#2|edits\[1\]/);
  });

  it("nhiều lần ⇒ lỗi kèm số lần; replace_all thay hết", () => {
    const r = apDungEdits("x x x", [{ old_string: "x", new_string: "y" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe("NHIEU_LAN");
      expect(r.soLan).toBe(3);
      expect(r.loi).toMatch(/3 times/);
      expect(r.loi).toMatch(/replace_all/);
    }
    expect(apDungEdits("x x x", [{ old_string: "x", new_string: "y", replace_all: true }])).toEqual({
      ok: true,
      noiDung: "y y y",
      soThayThe: 3,
    });
  });

  it("edits áp TUẦN TỰ (edit sau thấy kết quả edit trước)", () => {
    const r = apDungEdits("foo", [
      { old_string: "foo", new_string: "bar" },
      { old_string: "bar", new_string: "baz" },
    ]);
    expect(r).toEqual({ ok: true, noiDung: "baz", soThayThe: 2 });
  });

  it("old_string rỗng / trùng new_string ⇒ lỗi", () => {
    expect(apDungEdits("a", [{ old_string: "", new_string: "b" }]).ok).toBe(false);
    const r = apDungEdits("a", [{ old_string: "a", new_string: "a" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("KHONG_DOI");
  });

  it("ký tự đặc biệt của String.replace ($&, $1) trong new_string được giữ nguyên văn", () => {
    const r = apDungEdits("a.b", [{ old_string: "a.b", new_string: "$& $1 $$" }]);
    expect(r).toEqual({ ok: true, noiDung: "$& $1 $$", soThayThe: 1 });
  });

  it("ký tự đặc biệt regex trong old_string được coi là chữ", () => {
    const r = apDungEdits("f(x) = [a+b]*2\nf(x)", [{ old_string: "[a+b]*2\nf(x)", new_string: "c" }]);
    expect(r).toEqual({ ok: true, noiDung: "f(x) = c", soThayThe: 1 });
  });

  it("tệp LF + old/new LF ⇒ giữ LF", () => {
    const r = apDungEdits("a\nb\nc\n", [{ old_string: "a\nb", new_string: "A\nB\nX" }]);
    expect(r).toEqual({ ok: true, noiDung: "A\nB\nX\nc\n", soThayThe: 1 });
  });

  it("tệp CRLF + old_string LF ⇒ khớp sau chuẩn hoá và ghi lại theo CRLF", () => {
    const r = apDungEdits("a\r\nb\r\nc\r\n", [{ old_string: "a\nb", new_string: "A\nB\nX" }]);
    expect(r).toEqual({ ok: true, noiDung: "A\r\nB\r\nX\r\nc\r\n", soThayThe: 1 });
  });

  it("tệp CRLF + old_string CRLF ⇒ khớp thẳng; new_string LF vẫn được ghi CRLF", () => {
    const r = apDungEdits("a\r\nb\r\nc\r\n", [{ old_string: "b\r\nc", new_string: "B\nC" }]);
    expect(r).toEqual({ ok: true, noiDung: "a\r\nB\r\nC\r\n", soThayThe: 1 });
  });

  it("tệp LF + old_string CRLF (model dán CRLF) ⇒ vẫn khớp, ghi LF", () => {
    const r = apDungEdits("a\nb\nc\n", [{ old_string: "a\r\nb", new_string: "X\r\nY" }]);
    expect(r).toEqual({ ok: true, noiDung: "X\nY\nc\n", soThayThe: 1 });
  });

  it("tệp xuống dòng LẪN LỘN: phần không bị sửa giữ nguyên từng byte", () => {
    const goc = "a\r\nb\nc\r\nd\r\n";
    const r = apDungEdits(goc, [{ old_string: "c\nd", new_string: "C\nD" }]);
    expect(r).toEqual({ ok: true, noiDung: "a\r\nb\nC\r\nD\r\n", soThayThe: 1 });
  });

  it("CRLF + replace_all + đếm số lần qua chuẩn hoá", () => {
    const goc = "x\r\ny\r\nx\r\ny\r\n";
    const nhieu = apDungEdits(goc, [{ old_string: "x\ny", new_string: "z" }]);
    expect(nhieu.ok).toBe(false);
    if (!nhieu.ok) expect(nhieu.soLan).toBe(2);
    expect(apDungEdits(goc, [{ old_string: "x\ny", new_string: "z", replace_all: true }])).toEqual({
      ok: true,
      noiDung: "z\r\nz\r\n",
      soThayThe: 2,
    });
  });
});
