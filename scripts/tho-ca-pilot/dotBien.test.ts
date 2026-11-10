import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  apDungDotBien,
  docDotBien,
  docKhangDinhCam,
  kiemDotBienTrenBase,
  quetGhimNghiNgo,
  quetKhangDinhCam,
  tachCauExpect,
} from "./dotBien";
import { docTheViec } from "./theViec";
import type { ChayKiem, KetQuaKiem } from "./kiemChung";

const kiemXanh = (lenh = "x"): KetQuaKiem => ({
  lenh,
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } },
});
const kiemDo = (lenh = "x"): KetQuaKiem => ({
  ...kiemXanh(lenh),
  exit: 1,
  vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 1, boQua: 0, tong: 2 } },
});

describe("docDotBien — thẻ khai đột biến tệp|tìm|thay", () => {
  it("★ nhiều dòng; thay được chứa '|'; dòng trống / # / gạch đầu dòng", () => {
    const r = docDotBien(`# chú thích
- server/utils/a.ts|n > 0|n >= 0

server/utils/b.ts|x ? 1 : 2|x || y|z`);
    expect(r.loi).toEqual([]);
    expect(r.ds).toEqual([
      { tep: "server/utils/a.ts", tim: "n > 0", thay: "n >= 0" },
      { tep: "server/utils/b.ts", tim: "x ? 1 : 2", thay: "x || y|z" },
    ]);
  });
  it("★ lỗi: thiếu dấu |, tìm rỗng, tìm = thay, đường tuyệt đối / thoát", () => {
    const r = docDotBien(["a.ts|chỉ-hai-phần", "b.ts||thay", "c.ts|x|x", "/etc/passwd|a|b", "../x.ts|a|b", "D:/x.ts|a|b"].join("\n"));
    expect(r.ds).toEqual([]);
    expect(r.loi).toHaveLength(6);
  });
});

describe("docKhangDinhCam + quetKhangDinhCam — chỉ trong câu expect(...)", () => {
  it("★ chuỗi và /regex/; nhiều dòng; nháy bao ngoài được bỏ", () => {
    expect(docKhangDinhCam(`"?old=1?new=2"\n/#.*\\?x/i\n- plain`)).toEqual(["?old=1?new=2", /#.*\?x/i, "plain"]);
  });
  it("tachCauExpect tách câu trải nhiều dòng và bỏ qua ';' trong chuỗi", () => {
    const c = tachCauExpect(`it("a", () => {
  expect(f("x;y",
    { k: 1 })).toBe("z");
  const q = 1;
  expect(q).toBe(1);
});`);
    expect(c).toHaveLength(2);
    expect(c[0].text).toContain('f("x;y"');
    expect(c[0].dong).toBe(2);
  });
  it("★ bắt chuỗi cấm TRONG expect, KHÔNG bắt khi nó chỉ nằm trong chú thích / biến ngoài expect", () => {
    const nguon = `// ghi nhận "?old=1?new=2" là lỗi
const loi = "?old=1?new=2";
it("a", () => {
  expect(withParams("/a?old=1", { new: 2 })).toBe("/a?old=1?new=2");
  expect(withParams("/a", {})).toBe("/a");
});`;
    const hits = quetKhangDinhCam(nguon, ["?old=1?new=2"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].dong).toBe(4);
    expect(quetKhangDinhCam(nguon, [/\?old=\d\?new/])).toHaveLength(1);
    expect(quetKhangDinhCam(nguon, ["không-có"])).toEqual([]);
    expect(quetKhangDinhCam(nguon, [])).toEqual([]);
  });
});

describe("quetGhimNghiNgo — nhãn nghi ghim lỗi", () => {
  it("★ bắt hiện trạng / known bug / ghi lại / tạm thời / current behavior", () => {
    const r = quetGhimNghiNgo(`it("HIỆN TRẠNG — lỗi đã biết", () => {});
// known bug: path có sẵn ?
it("ghi lại hành vi hiện tại", () => {});
// tạm thời chấp nhận
// documents the bug
// current behaviour
it("bình thường", () => {});`);
    expect(r.map((x) => x.dong)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("không nhãn ⇒ rỗng", () => {
    expect(quetGhimNghiNgo(`it("a", () => { expect(1).toBe(1); });`)).toEqual([]);
  });
});

describe("docTheViec — khoá ĐỘT BIẾN / KHÔNG ĐƯỢC KHẲNG ĐỊNH", () => {
  const THE = (them: string, tep = "client/src/lib/a.unit.test.ts") => `MÃ: TC-77
MỤC TIÊU: thử
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${tep}
LỆNH KIỂM: npx vitest run client/src/lib/a.unit.test.ts
${them}
GIỚI HẠN: 15 phút, 8 vòng.`;
  it("★ đọc đột biến + chuỗi cấm vào thẻ; khoá không lẫn vào LỆNH KIỂM / GIỚI HẠN", () => {
    const r = docTheViec(
      THE(`ĐỘT BIẾN: client/src/lib/a.ts|n > 0|n >= 0
client/src/lib/a.ts|trim()|toString()
KHÔNG ĐƯỢC KHẲNG ĐỊNH: ?old=1?new=2
/hash.*query/`),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.the.dotBien).toHaveLength(2);
    expect(r.the.khangDinhCam).toEqual(["?old=1?new=2", /hash.*query/]);
    expect(r.the.lenhKiem).toBe("npx vitest run client/src/lib/a.unit.test.ts");
    expect(r.the.gioiHan).toEqual({ giay: 900, vong: 8 });
  });
  it("★ đột biến nằm trong TỆP ĐƯỢC PHÉP của model ⇒ thẻ lỗi; dòng đột biến sai dạng ⇒ thẻ lỗi", () => {
    expect(docTheViec(THE("ĐỘT BIẾN: client/src/lib/a.unit.test.ts|x|y")).ok).toBe(false);
    expect(docTheViec(THE("ĐỘT BIẾN: chỉ-một-phần")).ok).toBe(false);
  });
  it("thẻ không có hai khoá ⇒ không có trường", () => {
    const r = docTheViec(THE(""));
    expect(r.ok && r.the.dotBien === undefined && r.the.khangDinhCam === undefined).toBe(true);
  });
});

// ── đột biến trên đĩa ──────────────────────────────────────────────────────────────────────────────
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
let goc: string;
let wt: string;
const NGUON = "export const f = (n: number) => (n > 0 ? 1 : 0);\nexport const g = (s: string) => s.trim();\n";

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "db-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  fs.mkdirSync(path.join(wt, "src"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, "src/a.ts"), NGUON);
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(wt, "src/a.unit.test.ts"), "it('x', () => {});\n"); // bài làm của model (chưa commit)
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

/** Lệnh kiểm GIẢ: đỏ khi nguồn mang đột biến `dau` (đọc tệp THẬT trên đĩa lúc chạy). */
const kiemTheoNguon =
  (dauHieuDo: string[]): ChayKiem =>
  async (lenh) => {
    const nguon = fs.readFileSync(path.join(wt, "src/a.ts"), "utf8");
    return dauHieuDo.some((d) => nguon.includes(d)) ? kiemDo(lenh) : kiemXanh(lenh);
  };

describe("kiemDotBienTrenBase", () => {
  it("★ đúng một chỗ khớp ⇒ sạch; 0 hoặc 2 chỗ / tệp thiếu ⇒ lỗi nêu rõ", () => {
    expect(kiemDotBienTrenBase(wt, [{ tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }])).toEqual([]);
    expect(kiemDotBienTrenBase(wt, [{ tep: "src/a.ts", tim: "khong-co", thay: "x" }])[0]).toMatch(/0 lần/);
    expect(kiemDotBienTrenBase(wt, [{ tep: "src/a.ts", tim: "export const", thay: "x" }])[0]).toMatch(/2 lần/);
    expect(kiemDotBienTrenBase(wt, [{ tep: "src/mat.ts", tim: "x", thay: "y" }])[0]).toMatch(/không có trên base/);
  });
});

describe("apDungDotBien", () => {
  const tepDoi = ["src/a.unit.test.ts"];
  it("★ bắt được ⇒ do; sống ⇒ song; MỖI lần khôi phục nguyên văn (nội dung = bản gốc, git status chỉ còn tệp model đổi)", async () => {
    const r = await apDungDotBien(
      wt,
      [
        { tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }, // test bắt (giả)
        { tep: "src/a.ts", tim: "s.trim()", thay: "s" }, // test KHÔNG bắt
      ],
      tepDoi,
      "npx vitest run x",
      kiemTheoNguon(["n >= 0"]),
      60,
    );
    expect(r).toMatchObject({ tong: 2, do: 1, song: 1, khongApDung: 0, khoiPhucSach: true, tepLa: [] });
    expect(r.chiTiet.map((c) => c.ketQua)).toEqual(["do", "song"]);
    expect(fs.readFileSync(path.join(wt, "src/a.ts"), "utf8")).toBe(NGUON);
  });
  it("★ lệnh kiểm THẤY đột biến lúc chạy (áp thật trên đĩa) và không còn thấy sau khi xong", async () => {
    const thay: string[] = [];
    const r = await apDungDotBien(
      wt,
      [{ tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }],
      tepDoi,
      "x",
      async (lenh) => (thay.push(fs.readFileSync(path.join(wt, "src/a.ts"), "utf8")), kiemDo(lenh)),
      60,
    );
    expect(thay[0]).toContain("n >= 0");
    expect(r.do).toBe(1);
    expect(fs.readFileSync(path.join(wt, "src/a.ts"), "utf8")).not.toContain("n >= 0");
  });
  it("★ lệnh kiểm NÉM LỖI giữa chừng vẫn khôi phục (finally)", async () => {
    await expect(
      apDungDotBien(wt, [{ tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }], tepDoi, "x", async () => {
        throw new Error("chết");
      }, 60),
    ).rejects.toThrow("chết");
    expect(fs.readFileSync(path.join(wt, "src/a.ts"), "utf8")).toBe(NGUON);
  });
  it("★ không áp dụng được: 0 hoặc 2 chỗ khớp, tệp mất, hoặc nằm trong tệp model đổi; hết hạn KHÔNG tính là bắt được", async () => {
    const r = await apDungDotBien(
      wt,
      [
        { tep: "src/a.ts", tim: "khong-co", thay: "x" },
        { tep: "src/a.ts", tim: "export const", thay: "x" },
        { tep: "src/mat.ts", tim: "x", thay: "y" },
        { tep: "src/a.unit.test.ts", tim: "it('x'", thay: "it('y'" },
        { tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" },
      ],
      tepDoi,
      "x",
      async (lenh) => ({ ...kiemXanh(lenh), hetGio: true, exit: null }),
      60,
    );
    expect(r.khongApDung).toBe(5);
    expect(r.do).toBe(0);
    expect(r.chiTiet[4].chiTiet).toMatch(/hết hạn/);
    expect(fs.readFileSync(path.join(wt, "src/a.unit.test.ts"), "utf8")).toBe("it('x', () => {});\n");
  });
  it("★ 'tìm' khớp NHIỀU chỗ ⇒ không áp, KHÔNG chạy lệnh kiểm, nguồn nguyên vẹn (mơ hồ không được đoán)", async () => {
    let goi = 0;
    const r = await apDungDotBien(wt, [{ tep: "src/a.ts", tim: "export const", thay: "const" }], tepDoi, "x", async (l) => (goi++, kiemDo(l)), 60);
    expect(goi).toBe(0);
    expect(r).toMatchObject({ khongApDung: 1, do: 0, song: 0 });
    expect(r.chiTiet[0].chiTiet).toMatch(/2 lần/);
    expect(fs.readFileSync(path.join(wt, "src/a.ts"), "utf8")).toBe(NGUON);
  });
  it("★ khôi phục KHÔNG sạch (ghi lại hỏng) ⇒ khoiPhucSach=false; tệp lạ sinh ra lúc chạy ⇒ tepLa", async () => {
    const r1 = await apDungDotBien(
      wt,
      [{ tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }],
      tepDoi,
      "x",
      async (l) => kiemDo(l),
      60,
      () => undefined, // khôi phục giả: không ghi gì
    );
    expect(r1.khoiPhucSach).toBe(false);
    fs.writeFileSync(path.join(wt, "src/a.ts"), NGUON);
    const r2 = await apDungDotBien(
      wt,
      [{ tep: "src/a.ts", tim: "n > 0", thay: "n >= 0" }],
      tepDoi,
      "x",
      async (l) => (fs.writeFileSync(path.join(wt, "ra-ngoai.txt"), "rác"), kiemDo(l)),
      60,
    );
    expect(r2.tepLa).toEqual(["ra-ngoai.txt"]);
  });
});
