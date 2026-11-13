/**
 * HA-6b (phần 2) qua chayMotViec(): thẻ có `LỆNH KIỂM THẬT:` + `CÂY GIẢ:` ⇒ sau khi lệnh kiểm xanh, host chạy lệnh trên BẢN CHÉP fixture; không đạt ⇒ `hau-qua-xau`.
 * Model KHÔNG thấy lệnh / đường fixture (driver nhận `the` không có hai khoá; lệnh đưa model không có; nhật ký / luuY / JSON không có).
 * ĐỘT BIẾN PHẢI BẮT: bỏ hạ kết cục · chạy khi lệnh kiểm đỏ · lệnh/đường lọt driver · lệnh/đường lọt nhật ký hoặc JSON · không dọn bản chép · chạy trên fixture gốc.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec } from "./chayMotViec";
import type { ChayKiem, KetQuaKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const TEP = "server/x/a.test.ts";
const NGUON = `import { it, expect } from "vitest";\nit("x", () => { expect(1 + 1).toBe(2); });\n`;
const LENH_THAT = "node BI_MAT_TOOL.mjs --dist {CAY}";

let goc: string;
let wt: string;
let ra: string;
let cay: string;
const the = (them = "") => `MÃ: TC-94
MỤC TIÊU: thử lệnh kiểm thật
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
LỆNH KIỂM: npx vitest run ${TEP}
${them}GIỚI HẠN: 1 phút, 3 vòng`;
const KHOA_THAT = () => `LỆNH KIỂM THẬT: ${LENH_THAT}\nCÂY GIẢ: ${cay}\n`;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tckt-"));
  wt = path.join(goc, "_tho_ca_wt_kt");
  ra = path.join(goc, "ra");
  cay = path.join(goc, "BI_MAT_FIXTURE");
  fs.mkdirSync(path.join(cay, "assets"), { recursive: true });
  fs.writeFileSync(path.join(cay, "assets", "a.js"), "1");
  fs.mkdirSync(path.join(wt, "server/x"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, TEP), `import { it } from "vitest";\nit("cu", () => {});\n`);
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const xanh = (lenh: string, o: Partial<KetQuaKiem> = {}): KetQuaKiem => ({ lenh, exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } }, ...o });
/** chayKiem giả: lệnh THẬT (chứa BI_MAT_TOOL) trả `that`, lệnh kiểm trả `kiem` */
function ck(that: Partial<KetQuaKiem> = {}, kiem: Partial<KetQuaKiem> = {}) {
  const goi: string[] = [];
  const fn: ChayKiem = async (lenh) => {
    goi.push(lenh);
    return lenh.includes("BI_MAT_TOOL") ? xanh(lenh, { duoi: "DAU_RA_BI_MAT", ...that }) : xanh(lenh, kiem);
  };
  return { fn, goi };
}
const chay = (van: string, c: ChayKiem, o: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: c, khoGhi: { [TEP]: NGUON }, ...o });
const banChep = () => fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith("tcp-cay-"));

describe("HA-6b — LỆNH KIỂM THẬT trên cây giả", () => {
  it("★★★ lệnh kiểm xanh + lệnh thật đạt ⇒ xong; lệnh thật chạy SAU lệnh kiểm, trên BẢN CHÉP (không phải fixture gốc); JSON kiemThat không có lệnh/đường/đầu ra", async () => {
    const truoc = banChep().length;
    const c = ck();
    const r = await chay(the(KHOA_THAT()), c.fn);
    expect(r.ketCuc).toBe("xong");
    expect(r.kiemThat).toEqual({ dat: true, exit: 0, hetGio: false, giay: 1, lyDo: null });
    expect(c.goi).toHaveLength(2);
    expect(c.goi[0]).toContain("npx vitest run");
    expect(c.goi[1]).toContain("BI_MAT_TOOL.mjs --dist ");
    expect(c.goi[1]).not.toContain(cay);
    expect(c.goi[1]).toContain("tcp-cay-");
    expect(banChep().length).toBe(truoc);
    const s = JSON.stringify(r);
    for (const x of ["BI_MAT_TOOL", "BI_MAT_FIXTURE", "DAU_RA_BI_MAT", "tcp-cay-"]) expect(s).not.toContain(x);
  });
  it("★★★ lệnh kiểm XANH nhưng lệnh thật KHÔNG đạt (exit 1) ⇒ hau-qua-xau (ok:false); lý do nêu mã thoát, không nêu lệnh/đường", async () => {
    const r = await chay(the(KHOA_THAT()), ck({ exit: 1 }).fn);
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.ok).toBe(false);
    expect(r.kiem).toMatchObject({ exit: 0 });
    expect(r.kiemThat).toMatchObject({ dat: false, exit: 1, lyDo: "thoat-ma-1" });
    expect(r.luuY?.join(" ")).toContain("LỆNH KIỂM THẬT");
    expect(r.luuY?.join(" ")).toContain("thoat-ma-1");
    const s = JSON.stringify(r);
    for (const x of ["BI_MAT_TOOL", "BI_MAT_FIXTURE", "DAU_RA_BI_MAT"]) expect(s).not.toContain(x);
  });
  it("★★★ hết giờ ⇒ hau-qua-xau; cây giả không đọc được ⇒ hau-qua-xau (fail-closed), KHÔNG chạy lệnh thật", async () => {
    const r1 = await chay(the(KHOA_THAT()), ck({ exit: null, hetGio: true, giay: 300 }).fn);
    expect(r1.ketCuc).toBe("hau-qua-xau");
    expect(r1.kiemThat).toMatchObject({ dat: false, hetGio: true });
    fs.rmSync(path.join(goc, "BI_MAT_FIXTURE"), { recursive: true, force: true });
    const c = ck();
    const r2 = await chay(the(KHOA_THAT()), c.fn, { khoGhi: { [TEP]: `${NGUON}// hai\n` } });
    expect(r2.ketCuc).toBe("hau-qua-xau");
    expect(r2.kiemThat).toMatchObject({ dat: false, lyDo: "cay-gia-khong-doc-duoc" });
    expect(c.goi.some((g) => g.includes("BI_MAT_TOOL"))).toBe(false);
  });
  it("★★★ lệnh thật GHI vào worktree (dù exit 0) ⇒ hau-qua-xau 'lenh-that-ghi-vao-wt'; chỉ ghi vào {CAY} ⇒ xong", async () => {
    const ghiWt: ChayKiem = async (lenh) => {
      if (lenh.includes("BI_MAT_TOOL")) fs.writeFileSync(path.join(wt, "rac.txt"), "x");
      return xanh(lenh);
    };
    const r = await chay(the(KHOA_THAT()), ghiWt);
    expect(r.ketCuc).toBe("hau-qua-xau");
    expect(r.kiemThat).toMatchObject({ dat: false, exit: 0, lyDo: "lenh-that-ghi-vao-wt" });
    fs.rmSync(path.join(wt, "rac.txt"), { force: true });
    const ghiCay: ChayKiem = async (lenh) => {
      if (lenh.includes("BI_MAT_TOOL")) fs.writeFileSync(path.join(/"([^"]+)"/.exec(lenh)![1]!, "ra.txt"), "x");
      return xanh(lenh);
    };
    const r2 = await chay(the(KHOA_THAT()), ghiCay, { khoGhi: { [TEP]: `${NGUON}// hai\n` } });
    expect(r2.ketCuc).toBe("xong");
  });
  it("★★★ lệnh kiểm ĐỎ ⇒ kiem-do, lệnh thật KHÔNG chạy (chỉ chạy khi các bước trước xanh)", async () => {
    const c = ck({}, { exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } });
    const r = await chay(the(KHOA_THAT()), c.fn);
    expect(r.ketCuc).toBe("kiem-do");
    expect(c.goi.some((g) => g.includes("BI_MAT_TOOL"))).toBe(false);
    expect("kiemThat" in r).toBe(false);
  });
  it("★★★ thẻ KHÔNG có hai khoá ⇒ không chạy lệnh thật, không có khoá kiemThat; thẻ thiếu một khoá ⇒ từ chối", async () => {
    const c = ck();
    const r = await chay(the(), c.fn);
    expect(r.ketCuc).toBe("xong");
    expect("kiemThat" in r).toBe(false);
    expect(c.goi).toHaveLength(1);
    const r1 = await chay(the(`LỆNH KIỂM THẬT: ${LENH_THAT}\n`), ck().fn);
    expect(r1.ketCuc).toBe("tu-choi");
    expect(JSON.stringify(r1)).not.toContain("BI_MAT_TOOL");
    const r2 = await chay(the(`CÂY GIẢ: ${cay}\n`), ck().fn);
    expect(r2.ketCuc).toBe("tu-choi");
  });
  it("★★★ driver nhận `the` KHÔNG có lenhKiemThat / cayGia; lệnh đưa model và nhật ký không chứa lệnh / đường fixture", async () => {
    let thay: unknown = null;
    let lenh = "";
    const nk: string[] = [];
    await chay(the(KHOA_THAT()), ck().fn, {
      nhatKy: (s) => nk.push(s),
      driver: async (v) => {
        thay = v.the;
        lenh = v.lenh;
        fs.writeFileSync(path.join(wt, TEP), NGUON);
        return { vong: 1, token: null, ghiChu: [], hetGio: false };
      },
    });
    expect(thay).not.toBeNull();
    expect("lenhKiemThat" in (thay as object)).toBe(false);
    expect("cayGia" in (thay as object)).toBe(false);
    for (const x of ["BI_MAT_TOOL", "BI_MAT_FIXTURE", "CÂY GIẢ", "KIỂM THẬT"]) expect(lenh).not.toContain(x);
    for (const x of ["BI_MAT_TOOL", "BI_MAT_FIXTURE"]) expect(nk.join("\n")).not.toContain(x);
  });
});
