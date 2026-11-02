import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, ghepLenh, driverKho, type Driver } from "./chayMotViec";
import { docTheViec } from "./theViec";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const THE = (tep = "client/src/lib/a.test.ts") => `MÃ: TC-99
MỤC TIÊU: thử bộ chạy
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${tep}
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 1 phút, 3 vòng`;

let goc: string;
let ra: string;
let wt: string;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(wt, { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, "README.md"), "x\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const chay = (over: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van: THE(), wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# luat thu\n", ...over });

describe("chayMotViec — chạy khô (driver kho, không model)", () => {
  it("★ ghi đúng tệp được phép ⇒ ok, diff thu đủ tệp MỚI, AGENTS.md không lẫn, KHÔNG commit", async () => {
    const head0 = git(wt, "rev-parse", "HEAD");
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "import { it } from 'vitest';\nit('x', () => {});\n" } });
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", ma: "TC-99", nhanh: "pilot/tho-ca-TC-99", driver: "kho", vong: 1 });
    expect(r.tepDoi).toEqual(["client/src/lib/a.test.ts"]);
    expect(r.dong).toEqual({ them: 2, xoa: 0 });
    expect(r.viPham).toEqual([]);
    expect(fs.readFileSync(r.diff!, "utf8")).toContain("+it('x'");
    expect(git(wt, "rev-parse", "HEAD")).toBe(head0); // không commit
    expect(git(wt, "branch", "--show-current")).toBe("pilot/tho-ca-TC-99");
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe("# luat thu\n");
    expect(r.luuY?.join(" ")).toMatch(/token/);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // một dòng JSON tuần tự hoá được
  });

  it("★ chạm tệp NGOÀI danh sách + VÙNG CẤM ⇒ vi-pham, nêu từng tệp", async () => {
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "a\n", "client/src/lib/khac.ts": "b\n", "server/services/ot/x.ts": "c\n" } });
    expect(r.ok).toBe(false);
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham).toEqual(expect.arrayContaining([{ duong: "client/src/lib/khac.ts", loai: "ngoai-danh-sach" }, { duong: "server/services/ot/x.ts", loai: "vung-cam", chiTiet: "ot" }]));
    expect(r.viPham).toHaveLength(2);
  });

  it("★ tệp có CRLF ⇒ vi-pham (luật LF)", async () => {
    const r = await chay({ khoGhi: { "client/src/lib/a.test.ts": "a\r\nb\r\n" } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.crlf).toEqual(["client/src/lib/a.test.ts"]);
  });

  it("không có thay đổi nào ⇒ xong, 0 tệp (model không làm gì cũng là một kết quả để đo)", async () => {
    const r = await chay();
    expect(r).toMatchObject({ ok: true, ketCuc: "xong", tepDoi: [], dong: { them: 0, xoa: 0 } });
  });

  it("driver hết giờ ⇒ het-gio; driver lỗi ⇒ loi-driver; vi phạm thắng", async () => {
    const hetGio: Driver = async () => ({ vong: null, token: null, ghiChu: [], hetGio: true });
    expect((await chay({ driver: hetGio })).ketCuc).toBe("het-gio");
    const loi: Driver = async () => ({ vong: null, token: null, ghiChu: [], hetGio: false, loi: "no" });
    expect(await chay({ driver: loi })).toMatchObject({ ketCuc: "loi-driver", ok: false, loi: "no" });
  });
});

describe("chayMotViec — từ chối an toàn", () => {
  it("thẻ hỏng ⇒ tu-choi, không đụng worktree", async () => {
    const r = await chay({ van: "MÃ: X\n" });
    expect(r).toMatchObject({ ok: false, ketCuc: "tu-choi" });
    expect(git(wt, "branch", "--show-current")).not.toContain("pilot");
  });
  it("★ worktree không tên _tho_ca* ⇒ từ chối (không sửa nhầm nơi khác)", async () => {
    const khac = path.join(goc, "kho-khac");
    fs.mkdirSync(khac);
    git(khac, "init", "-q");
    expect(await chay({ wt: khac, choPhepKhoRieng: false })).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("_tho_ca") });
  });
  it("★ worktree CHÍNH (không phải liên kết) ⇒ từ chối khi không có cờ kiểm", async () => {
    expect(await chay({ choPhepKhoRieng: false })).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("worktree CHÍNH") });
  });
  it("★ worktree bẩn ⇒ từ chối, không tạo nhánh", async () => {
    fs.writeFileSync(path.join(wt, "dang-lam-do.txt"), "x");
    expect(await chay()).toMatchObject({ ketCuc: "tu-choi", loi: expect.stringContaining("không sạch") });
    expect(git(wt, "branch", "--show-current")).not.toContain("pilot");
  });
  it("base không tồn tại ⇒ từ chối", async () => {
    expect(await chay({ base: "khong-co-nhanh-nay" })).toMatchObject({ ketCuc: "tu-choi" });
  });
});

describe("ghepLenh & driverKho", () => {
  it("lệnh ghép luật + thẻ (không có tệp ngoài thẻ)", () => {
    const d = docTheViec(THE());
    if (!d.ok) throw new Error("thẻ");
    const l = ghepLenh(d.the, "# luat\n");
    expect(l).toContain("# luat");
    expect(l).toContain("TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts");
    expect(l).toContain("LỆNH KIỂM: npx vitest run");
  });
  it("driverKho bỏ qua đường thoát ra ngoài worktree", async () => {
    const r = await driverKho({ the: {} as never, wt, lenh: "", hanGiay: 1, ghiLuotDir: null, khoGhi: { "../thoat.txt": "x" } });
    expect(fs.existsSync(path.join(goc, "thoat.txt"))).toBe(false);
    expect(r.ghiChu.join(" ")).toMatch(/bỏ qua/);
  });
});
