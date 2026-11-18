/**
 * Chống trôi MA_GOC của test ẩn js-loi-3-lop v2 (HST 14/11). Ca ẩn (b) chép CỨNG mã gốc của mọi tệp nguồn ngoài test/ để
 * dựng lại "mã trước khi sửa". Nếu ai sửa sandbox-projects/agent-f/js-loi-3-lop mà quên MA_GOC thì ca (b) chấm trên một
 * "mã gốc" khác thật, và kiểm thước "goc" không bắt được.
 * Thuần: chỉ đọc tệp trong repo, không spawn, không mạng, không DB.
 * MA_GOC đọc từ CHÍNH tệp test ẩn (không import: import sẽ đăng ký các ca node:test). Mỗi mục một dòng
 * `  "<khoá>": <chuỗi JSON>,` như lúc sinh bằng JSON.stringify; dòng khác dạng ⇒ đỏ.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DAY = path.dirname(fileURLToPath(import.meta.url));
const GOC_REPO = path.resolve(DAY, "../../../..");
const TEP_AN = path.join(DAY, "an/js-loi-3-lop/test/an-f.test.mjs");
const DU_AN = path.join(GOC_REPO, "sandbox-projects/agent-f/js-loi-3-lop");
const DUOI_NGUON = /\.(mjs|cjs|js)$/;

function docMaGoc(nguon: string): Map<string, string> {
  const khoi = /^const MA_GOC = \{\n([\s\S]*?)^\};$/m.exec(nguon);
  if (!khoi) throw new Error("không tìm thấy khối `const MA_GOC = { … };` trong test ẩn");
  const ra = new Map<string, string>();
  for (const dong of khoi[1].split("\n").filter((d) => d !== "")) {
    const m = /^ {2}("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$/.exec(dong);
    if (!m) throw new Error(`dòng MA_GOC sai dạng: ${dong.slice(0, 80)}`);
    ra.set(JSON.parse(m[1]) as string, JSON.parse(m[2]) as string);
  }
  return ra;
}

/** Tệp nguồn của dự án NGOÀI test/ (đường tương đối, phân cách "/"). */
function tepNguonDuAn(): string[] {
  return (fs.readdirSync(DU_AN, { recursive: true }) as string[])
    .map((p) => p.split(path.sep).join("/"))
    .filter((p) => !p.startsWith("test/") && DUOI_NGUON.test(p) && fs.statSync(path.join(DU_AN, p)).isFile())
    .sort();
}

describe("bộ đọc MA_GOC", () => {
  it("dòng sai dạng ⇒ ném (không lặng lẽ bỏ qua mục)", () => {
    expect(() => docMaGoc('const MA_GOC = {\n  "a.mjs": "x"\n};')).toThrow(/sai dạng/);
    expect(() => docMaGoc('const MA_GOC = {\n  a: "x",\n};')).toThrow(/sai dạng/);
  });
  it("thiếu khối ⇒ ném", () => {
    expect(() => docMaGoc("const KHAC = {};")).toThrow(/không tìm thấy/);
  });
  it("đọc đúng chuỗi có thoát", () => {
    expect([...docMaGoc('const MA_GOC = {\n  "a.mjs": "x\\n\\"y\\"",\n};').entries()]).toEqual([["a.mjs", 'x\n"y"']]);
  });
});

describe("MA_GOC của test ẩn js-loi-3-lop v2 khớp dự án gốc", () => {
  const maGoc = docMaGoc(fs.readFileSync(TEP_AN, "utf8"));

  it("phủ ĐÚNG tập tệp nguồn ngoài test/ (không thiếu, không thừa)", () => {
    expect([...maGoc.keys()].sort()).toEqual(tepNguonDuAn());
    expect(tepNguonDuAn()).toEqual(["index.mjs", "src/tien.mjs", "src/tongHop.mjs", "src/xuatCsv.mjs"]);
  });

  for (const tep of ["index.mjs", "src/tien.mjs", "src/tongHop.mjs", "src/xuatCsv.mjs"]) {
    it(`${tep}: byte-đối-byte`, () => {
      const that = fs.readFileSync(path.join(DU_AN, tep));
      const chep = Buffer.from(maGoc.get(tep) ?? "", "utf8");
      expect(chep.equals(that), `MA_GOC["${tep}"] lệch sandbox-projects/agent-f/js-loi-3-lop/${tep}`).toBe(true);
    });
  }
});
