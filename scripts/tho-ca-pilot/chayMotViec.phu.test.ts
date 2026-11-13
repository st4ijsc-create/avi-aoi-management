/**
 * HA-10 qua chayMotViec(): thẻ bật `KIỂM PHỦ: CÓ` ⇒ lệnh kiểm + tsc xanh vẫn phải phủ mọi dòng ĐÃ DUYỆT (trừ GIỮ:) bằng ca MỚI `[Dk] …` có expect thật và PASSED; thiếu ⇒ ketCuc `thieu-phu`.
 * Thẻ KHÔNG bật ⇒ không đổi byte (không khoá `phu`, lời nhắc không có câu luật). Kiểm PASSED chạy lại lệnh kiểm với `--reporter=json --outputFile=<ngoài worktree>`.
 * ĐỘT BIẾN PHẢI BẮT: bỏ kiểm phủ · không ra thieu-phu · kiểm cuối bỏ PASSED · fail-closed khi không có JSON · ca cũ đổi tên vẫn tính · thẻ không bật vẫn kiểm · thiếu khối ĐÃ DUYỆT vẫn chạy.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, ghepLenh } from "./chayMotViec";
import { CAU_LUAT_PHU, quetCaTest } from "./kiemPhu";
import { quyetKetCuc, type ChayKiem, type KetQuaKiem } from "./kiemChung";
import { docTheViec } from "./theViec";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const TEP = "server/x/a.test.ts";
const theViec = (phu: string | null, khoi: string | null = "1. Bỏ null.\n2. Bỏ rỗng.\n3. GIỮ: mọi test cũ vẫn xanh.") => `MÃ: TC-87
QUY TRÌNH: Danh sách dưới khoá ĐÃ DUYỆT đã được duyệt. Làm ngay.${khoi ? `\nĐÃ DUYỆT:\n${khoi}` : ""}
${phu ? `KIỂM PHỦ: ${phu}\n` : ""}MỤC TIÊU: thử phủ
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;

const ca = (k: number | string, ten = "nội dung", than = "expect(f(1)).toBe(1);") => `it("${typeof k === "number" ? `[D${k}] ` : k}${ten}", () => { ${than} });`;
const tepTest = (...ds: string[]) => `import { it, expect } from "vitest";\nconst f = (x: number) => x;\n${ds.join("\n")}\n`;

const xanh = (lenh: string): KetQuaKiem => ({ lenh, exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } } });

let goc: string;
let wt: string;
let ra: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcphu-"));
  wt = path.join(goc, "_tho_ca_wt_phu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(wt, "server/x"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, TEP), tepTest(ca("ca cu A ", "", "expect(f(5)).toBe(5);").replace('it("ca cu A ', 'it("ca cu A')));
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

/** chayKiem giả: lệnh thường ⇒ xanh; lệnh có --reporter=json ⇒ ghi JSON "tên ca → trạng thái" theo `trangThai(ten)` (mặc định passed) */
function chayKiemGia(opt: { trangThai?: (ten: string) => string; khongGhiJson?: boolean } = {}) {
  const goi: string[] = [];
  const fn: ChayKiem = async (lenh, w) => {
    goi.push(lenh);
    const m = /--outputFile="([^"]+)"/.exec(lenh);
    if (m && !opt.khongGhiJson) {
      const ten = quetCaTest(fs.readFileSync(path.join(w, TEP), "utf8")).ca.map((c) => c.ten);
      fs.writeFileSync(m[1]!, JSON.stringify({ testResults: [{ assertionResults: ten.map((t) => ({ title: t, status: (opt.trangThai ?? (() => "passed"))(t) })) }] }));
    }
    return xanh(lenh);
  };
  return { fn, goi };
}
const chay = (van: string, khoGhi: Record<string, string>, ck: ChayKiem) =>
  chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: ck, khoGhi });

describe("HA-10 — kiểm phủ cuối lượt", () => {
  it("★★★ đủ ca [D1] [D2] thật + PASSED ⇒ xong; GIỮ (dòng 3) không đòi ca; JSON phu đủ; chạy lại lệnh kiểm với --reporter=json ra NGOÀI worktree", async () => {
    const ck = chayKiemGia();
    const r = await chay(theViec("CÓ"), { [TEP]: tepTest(ca("ca cu A"), ca(1), ca(2)).replace(ca("ca cu A"), `it("ca cu A", () => { expect(f(5)).toBe(5); });`) }, ck.fn);
    expect(r.ketCuc).toBe("xong");
    expect(r.phu).toMatchObject({ dongCanPhu: [1, 2], dongGiu: [3], dongDaPhu: [1, 2], dongThieu: [], xacNhanPassed: true, soLanNhac: 0 });
    expect(r.phu!.caMoi).toEqual(["[D1] nội dung", "[D2] nội dung"]);
    const lenhJson = ck.goi.find((g) => g.includes("--reporter=json"))!;
    expect(lenhJson).toContain(`npx vitest run ${TEP}`);
    expect(lenhJson).toContain(path.join(ra, "TC-87.vitest-phu.json"));
    expect(path.relative(wt, path.join(ra, "TC-87.vitest-phu.json")).startsWith("..")).toBe(true);
  });
  it("★★★ THIẾU ca [D2] ⇒ ketCuc thieu-phu (lệnh kiểm vẫn xanh); phu.dongThieu=[2]; lý do nêu dòng; KHÔNG tốn lần chạy --reporter=json (tĩnh đã thiếu)", async () => {
    const ck = chayKiemGia();
    const r = await chay(theViec("CÓ"), { [TEP]: tepTest(ca(1)) }, ck.fn);
    expect(r.ketCuc).toBe("thieu-phu");
    expect(r.ok).toBe(false);
    expect(r.phu).toMatchObject({ dongThieu: [2], dongDaPhu: [1], xacNhanPassed: false });
    expect(r.kiem).toMatchObject({ exit: 0 });
    expect(r.luuY?.join(" ")).toMatch(/HA-10: dòng ĐÃ DUYỆT 2 chưa có ca/);
    expect(ck.goi.some((g) => g.includes("--reporter=json"))).toBe(false);
  });
  it("★★★ ca [D2] CÓ nhưng vitest báo KHÔNG PASSED (đỏ/skip) ⇒ thieu-phu, xacNhanPassed=true, loaiBo.khongPassed=1", async () => {
    const ck = chayKiemGia({ trangThai: (t) => (t.startsWith("[D2]") ? "failed" : "passed") });
    const r = await chay(theViec("CÓ"), { [TEP]: tepTest(ca(1), ca(2)) }, ck.fn);
    expect(r.ketCuc).toBe("thieu-phu");
    expect(r.phu).toMatchObject({ dongThieu: [2], xacNhanPassed: true });
    expect(r.phu!.loaiBo.khongPassed).toBe(1);
  });
  it("★★★ FAIL-CLOSED: không đọc được JSON vitest ⇒ thieu-phu, mọi dòng coi là thiếu, phu.loi nêu lý do", async () => {
    const ck = chayKiemGia({ khongGhiJson: true });
    const r = await chay(theViec("CÓ"), { [TEP]: tepTest(ca(1), ca(2)) }, ck.fn);
    expect(r.ketCuc).toBe("thieu-phu");
    expect(r.phu).toMatchObject({ dongThieu: [1, 2], dongDaPhu: [], xacNhanPassed: false });
    expect(r.phu!.loi).toMatch(/không đọc được JSON/);
  });
  it("★★★ ca RỖNG / expect(hằng) / ca CŨ đổi tên để gắn tag KHÔNG phủ", async () => {
    const ck = chayKiemGia();
    const nguon = tepTest(`it("[D1] rỗng", () => {});`, `it("[D2] hằng", () => { expect(true).toBe(true); });`, `it("[D2] ca cu A", () => { expect(f(5)).toBe(5); });`);
    const r = await chay(theViec("CÓ"), { [TEP]: nguon }, ck.fn);
    expect(r.ketCuc).toBe("thieu-phu");
    expect(r.phu).toMatchObject({ dongThieu: [1, 2] });
    expect(r.phu!.loaiBo).toMatchObject({ rong: 1, hangSoHang: 1, caCuDoiTen: 1 });
    expect(r.phu!.caCuDoiTen).toEqual(["[D2] ca cu A"]);
  });
  it("★★★ thẻ KHÔNG bật KIỂM PHỦ: cùng bài làm thiếu ca ⇒ vẫn xong, không có khoá `phu`, không chạy lại --reporter=json", async () => {
    const ck = chayKiemGia();
    const r = await chay(theViec(null), { [TEP]: tepTest(ca("không tag")) }, ck.fn);
    expect(r.ketCuc).toBe("xong");
    expect("phu" in r).toBe(false);
    expect(ck.goi.some((g) => g.includes("--reporter=json"))).toBe(false);
  });
  it("★★ KIỂM PHỦ: CÓ nhưng thẻ không có khối ĐÃ DUYỆT (hoặc chỉ toàn GIỮ) ⇒ tu-choi trước khi chạm worktree", async () => {
    const r1 = await chay(theViec("CÓ", null), { [TEP]: tepTest(ca(1)) }, chayKiemGia().fn);
    expect(r1.ketCuc).toBe("tu-choi");
    expect(r1.loi).toMatch(/KIỂM PHỦ: CÓ nhưng thẻ không có khối/);
    const r2 = await chay(theViec("CÓ", "1. GIỮ: a\n2. GIỮ: b"), { [TEP]: tepTest(ca(1)) }, chayKiemGia().fn);
    expect(r2.ketCuc).toBe("tu-choi");
  });
  it("★★ lệnh kiểm đã có --reporter ⇒ chỉ kiểm tĩnh (không thêm --reporter=json), xacNhanPassed=false", async () => {
    const ck = chayKiemGia();
    const van = theViec("CÓ").replace(`LỆNH KIỂM: npx vitest run ${TEP}`, `LỆNH KIỂM: npx vitest run ${TEP} --reporter=dot`);
    const r = await chay(van, { [TEP]: tepTest(ca(1), ca(2)) }, ck.fn);
    expect(r.ketCuc).toBe("xong");
    expect(r.phu).toMatchObject({ dongThieu: [], xacNhanPassed: false });
    expect(ck.goi.filter((g) => g.includes("--reporter=json"))).toHaveLength(0);
  });
});

describe("HA-10 — thẻ + lời nhắc + quyết kết cục", () => {
  it("★★★ khoá `KIỂM PHỦ`: CÓ / KHÔNG / vắng / giá trị lạ; CÓ ⇒ kiemPhu=true; lạ ⇒ thẻ lỗi nêu giá trị", () => {
    const d = (them: string) => docTheViec(`MÃ: TC-86\nMỤC TIÊU: m\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\n${them}`);
    const co = d("KIỂM PHỦ: CÓ");
    expect(co.ok && co.the.kiemPhu).toBe(true);
    const khong = d("KIỂM PHỦ: KHÔNG");
    expect(khong.ok && "kiemPhu" in khong.the).toBe(false);
    const vang = d("");
    expect(vang.ok && "kiemPhu" in vang.the).toBe(false);
    const thieuDau = d("kiem phu: co");
    expect(thieuDau.ok && thieuDau.the.kiemPhu).toBe(true);
    const la = d("KIỂM PHỦ: CÓ_LẼ");
    expect(la.ok).toBe(false);
    expect(!la.ok && la.loi).toContain("KIỂM PHỦ phải là CÓ hoặc KHÔNG");
  });
  it("★★★ ghepLenh: thẻ bật ⇒ có ĐÚNG MỘT câu luật phủ ngay sau QUY TRÌNH; thẻ không bật ⇒ lời nhắc BẰNG từng byte lời nhắc không có kiemPhu", () => {
    const bat = docTheViec(theViec("CÓ"));
    const tat = docTheViec(theViec(null));
    if (!bat.ok || !tat.ok) throw new Error("thẻ");
    const lenhBat = ghepLenh(bat.the, "# l\n");
    expect(lenhBat.split(CAU_LUAT_PHU).length - 1).toBe(1);
    expect(lenhBat.indexOf(CAU_LUAT_PHU)).toBeGreaterThan(lenhBat.indexOf("QUY TRÌNH:"));
    expect(lenhBat.indexOf(CAU_LUAT_PHU)).toBeLessThan(lenhBat.indexOf("MỤC TIÊU:"));
    expect(ghepLenh(tat.the, "# l\n")).not.toContain("KIỂM PHỦ");
    expect(ghepLenh({ ...bat.the, kiemPhu: undefined }, "# l\n")).toBe(ghepLenh(tat.the, "# l\n"));
  });
  it("★★★ quyetKetCuc: xanh + phu.dongThieu≠∅ ⇒ thieu-phu (đứng TRƯỚC đột biến); phu đủ ⇒ xong; ketCuc xấu từ trước giữ nguyên (sticky)", () => {
    const co = { dungVitest: true, tepTest: [{ duong: TEP, soCa: 2 }], kiem: xanh("x") };
    expect(quyetKetCuc({ truoc: "xong", ...co, phu: { dongThieu: [2, 4] } })).toMatchObject({ ketCuc: "thieu-phu" });
    expect(quyetKetCuc({ truoc: "xong", ...co, phu: { dongThieu: [2, 4] } }).lyDo).toContain("2, 4");
    expect(quyetKetCuc({ truoc: "xong", ...co, phu: { dongThieu: [] } })).toMatchObject({ ketCuc: "xong" });
    expect(quyetKetCuc({ truoc: "xong", ...co })).toMatchObject({ ketCuc: "xong" });
    expect(quyetKetCuc({ truoc: "vi-pham", ...co, phu: { dongThieu: [2] } })).toMatchObject({ ketCuc: "vi-pham" });
    expect(quyetKetCuc({ truoc: "xong", ...co, kiem: { ...xanh("x"), exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } }, phu: { dongThieu: [2] } })).toMatchObject({ ketCuc: "kiem-do" });
  });
});
