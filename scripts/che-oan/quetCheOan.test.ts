/**
 * K1 (quét che oan của shared/mauBiMat) — phần THUẦN. Không git, không đĩa, không mạng. Khoá trong tệp là GIẢ, ghép lúc chạy.
 */
import { describe, it, expect } from "vitest";
import {
  docNen,
  laTepTrongKho,
  lapNen,
  maThoat,
  quetNoiDung,
  soVoiNen,
  taoKetQuaRong,
  tachCatFileBatch,
  TEN_MAU,
  type Nen,
} from "./quetCheOan";
import nenRepo from "./nen.json";
import { MAU_TOKEN_CO_TIEN_TO } from "../../shared/mauBiMat";

const THAN = "Kq7Zx2Wm9Rt4Lp8N".repeat(8);
const AWS = `AK${"IA"}${THAN.slice(0, 16).toUpperCase()}`;
const ANT = `sk-${"ant"}-api03-${THAN.slice(0, 95)}`;
const GH = `gh${"p"}_${THAN.slice(0, 36)}`;

const nenTu = (khop: Record<string, number>): Nen => ({ rev: "abc", khop: { ...Object.fromEntries(TEN_MAU.map((t) => [t, 0])), ...khop } });

describe("laTepTrongKho", () => {
  it.each([
    "server/index.ts",
    "server/services/ai/aiSafety.ts",
    "docs/README.md",
    "docs/ai/a/b.md",
    "client/src/App.tsx",
    "client/src/lib/x.ts",
    "shared/mauBiMat.ts",
    "scripts/a.mjs",
    "scripts/ai-eval/lib/b.mjs",
    "vscode-extension/src/loi/nguCanh.ts",
  ])("thuộc kho: %s", (d) => expect(laTepTrongKho(d)).toBe(true));
  it.each([
    "server/a.test.ts",
    "server/a.db.test.ts",
    "client/src/x.unit.test.ts",
    "client/src/x.dom.test.tsx",
    "scripts/a.test.mjs",
    "server/testing/fixtures/a.ts",
    "server/testing/fixture/a.ts",
    "server/__tests__/a.ts",
    "server/a.js",
    "package.json",
    "scripts/che-oan/quetCheOan.ts",
    "client/public/x.ts",
    "vscode-extension/dist/extension.js",
    "README.md",
  ])("KHÔNG thuộc kho: %s", (d) => expect(laTepTrongKho(d)).toBe(false));
});

describe("quetNoiDung — đếm theo mẫu, vị trí, không lộ thân", () => {
  const kq = taoKetQuaRong();
  quetNoiDung(kq, "docs/a.md", `dong 1 ${AWS}\nsach\nx=e${ANT} va ${AWS}\n`);
  quetNoiDung(kq, "server/b.ts", `const t = "MAKIAGEPRODUCTIONLINE7"; // khong phai khoa\nconst u = "x${GH}";`);

  it("đếm đúng từng mẫu (aws 2, anthropic 1 dính chữ, github 1 dính chữ, còn lại 0)", () => {
    expect(kq.khop).toEqual({ ...Object.fromEntries(TEN_MAU.map((t) => [t, 0])), aws: 2, anthropic: 1, github: 1 });
  });
  it("vị trí: tệp, dòng (đếm từ 1), hình <tiền tố>+<n>", () => {
    expect(kq.viTri.aws).toEqual([
      { tep: "docs/a.md", dong: 1, dang: "AKIA+16" },
      { tep: "docs/a.md", dong: 3, dang: "AKIA+16" },
    ]);
    expect(kq.viTri.anthropic).toEqual([{ tep: "docs/a.md", dong: 3, dang: "sk-ant-+101" }]);
    expect(kq.viTri.github).toEqual([{ tep: "server/b.ts", dong: 2, dang: "ghp_+36" }]);
  });
  it("tổng tệp / dòng / ký tự", () => {
    expect(kq.soTep).toBe(2);
    expect(kq.soDong).toBe(4 + 2);
  });
  it("kết quả KHÔNG chứa thân khoá", () => {
    const s = JSON.stringify(kq);
    for (const k of [AWS, ANT, GH]) expect(s).not.toContain(k.slice(4, 20));
  });
});

describe("soVoiNen / maThoat", () => {
  const kq = taoKetQuaRong();
  kq.khop.aws = 2;
  it("bằng nền ⇒ không mới, thoát 0", () => {
    const ss = soVoiNen(kq, nenTu({ aws: 2 }));
    expect(ss).toEqual({ moi: [], giam: [], thieuTrongNen: [] });
    expect(maThoat(ss)).toBe(0);
  });
  it("tăng so với nền ⇒ mới, thoát 1", () => {
    const ss = soVoiNen(kq, nenTu({ aws: 1 }));
    expect(ss.moi).toEqual([{ ten: "aws", nen: 1, nay: 2 }]);
    expect(maThoat(ss)).toBe(1);
  });
  it("giảm so với nền ⇒ chỉ báo giảm, thoát 0", () => {
    const ss = soVoiNen(kq, nenTu({ aws: 3 }));
    expect(ss).toEqual({ moi: [], giam: [{ ten: "aws", nen: 3, nay: 2 }], thieuTrongNen: [] });
    expect(maThoat(ss)).toBe(0);
  });
  it("mẫu thiếu trong nền: 0 khớp ⇒ chỉ cảnh báo; > 0 khớp ⇒ tính là MỚI (nền 0)", () => {
    const nen: Nen = { rev: "abc", khop: Object.fromEntries(TEN_MAU.filter((t) => t !== "aws" && t !== "npm").map((t) => [t, 0])) };
    const ss = soVoiNen(kq, nen);
    expect(ss.thieuTrongNen).toEqual(["aws", "npm"]);
    expect(ss.moi).toEqual([{ ten: "aws", nen: 0, nay: 2 }]);
    expect(maThoat(ss)).toBe(1);
  });
  it("lapNen: đủ mọi mẫu theo thứ tự TEN_MAU, kể cả 0", () => {
    expect(lapNen(kq, "r1")).toEqual({ rev: "r1", khop: Object.fromEntries(TEN_MAU.map((t) => [t, t === "aws" ? 2 : 0])) });
    expect(Object.keys(lapNen(kq, "r1").khop)).toEqual([...TEN_MAU]);
  });
});

describe("docNen — nền hỏng thì NÉM (không coi là 0 khớp)", () => {
  it.each([
    ["không phải đối tượng", null, "nen-khong-phai-doi-tuong"],
    ["thiếu rev", { khop: {} }, "nen-thieu-rev"],
    ["khop là mảng", { rev: "a", khop: [] }, "nen-thieu-khop"],
    ["số âm", { rev: "a", khop: { aws: -1 } }, "nen-so-khop-sai:aws"],
    ["số lẻ", { rev: "a", khop: { aws: 1.5 } }, "nen-so-khop-sai:aws"],
    ["chuỗi", { rev: "a", khop: { aws: "2" } }, "nen-so-khop-sai:aws"],
  ])("%s", (_n, x, loi) => expect(() => docNen(x)).toThrow(loi));
  it("hợp lệ", () => expect(docNen({ rev: "a", khop: { aws: 2 } })).toEqual({ rev: "a", khop: { aws: 2 } }));
});

describe("tachCatFileBatch", () => {
  const sha = "a".repeat(40);
  const blob = (s: string) => Buffer.concat([Buffer.from(`${sha} blob ${Buffer.byteLength(s)}\n`), Buffer.from(s), Buffer.from("\n")]);
  it("nhiều mục, nội dung có xuống dòng và chữ nhiều byte (cỡ tính theo BYTE), mục missing", () => {
    const buf = Buffer.concat([blob("dòng một\ndòng hai\n"), Buffer.from("HEAD:b.ts missing\n"), blob("")]);
    expect(tachCatFileBatch(buf, ["a.md", "b.ts", "c.ts"])).toEqual([
      { tep: "a.md", noiDung: "dòng một\ndòng hai\n" },
      { tep: "b.ts", thieu: true },
      { tep: "c.ts", noiDung: "" },
    ]);
  });
  it("cắt ngang / đầu sai / cỡ sai / thừa dữ liệu ⇒ ném", () => {
    expect(() => tachCatFileBatch(blob("abc").subarray(0, 50), ["a"])).toThrow(/cat-file-co-sai/);
    expect(() => tachCatFileBatch(Buffer.from("rac\n"), ["a"])).toThrow(/cat-file-dau-sai/);
    expect(() => tachCatFileBatch(Buffer.from(""), ["a"])).toThrow(/cat-file-cut-ngang/);
    expect(() => tachCatFileBatch(Buffer.concat([blob("abc"), Buffer.from("x")]), ["a"])).toThrow(/cat-file-thua-du-lieu/);
  });
});

describe("nền trong repo (scripts/che-oan/nen.json)", () => {
  // Luật HST 14/11: đổi danh sách mẫu ⇒ chạy lại K1 và lập lại nền CÓ CHỦ Ý. Thêm/bớt mẫu mà không cập nhật nền ⇒ ca này đỏ.
  it("hợp lệ và có ĐỦ đúng các mẫu của shared/mauBiMat", () => {
    const nen = docNen(nenRepo);
    expect(Object.keys(nen.khop)).toEqual(MAU_TOKEN_CO_TIEN_TO.map((m) => m.ten));
  });
});
