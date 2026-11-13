/**
 * `--luat-cach ghi-de|ghep` (điều kiện mở lô 2). `ghi-de` = hành vi cũ (mặc định, không đổi); `ghep` = bộ chạy KHÔNG chạm tệp nào ở worktree, model đọc AGENTS.md của BASE (B1)
 * qua docTepQuyUoc, tệp --luat chỉ ghép vào LỆNH như phần bổ sung riêng cho pilot.
 * ĐỘT BIẾN PHẢI BẮT: ghep vẫn ghi AGENTS.md · ghep ghi info/exclude · ghep vẫn lọc AGENTS.md khỏi diff · B1 vào lệnh hai lần · phần bổ sung vào khối quy ước · ghi-de đổi hành vi ·
 * không so AGENTS.md worktree với base · so bằng status (bị exclude nuốt) · JSON thiếu luatCach/b1 · sha b1 sai · mặc định ghep đọc luật cũ.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { docTepQuyUoc } from "../../server/services/ai/agent/tepQuyUocAgent";
import { dungKhoiNguCanhDuAn } from "../../shared/agentCore/loiNhac";
import { chayMotViec, docLuatCach, duongTepLuat, duongTepLuatBoSung, khopB1, type Driver } from "./chayMotViec";
import type { ChayKiem } from "./kiemChung";

const sh = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const TEP = "server/x/a.test.ts";
const B1 = "# AGENTS gốc của base\nSENTINEL_B1_QWERTY: luật chung của dự án.\n";
const BO_SUNG = "# Bổ sung pilot thử\nSENTINEL_BOSUNG_ASDFG: phần riêng của pilot.\n";
const LUAT_CU = "# Luật cũ thử\nSENTINEL_LUATCU_ZXCVB: toàn bộ luật ghi-đè.\n";
const the = () => `MÃ: TC-95
MỤC TIÊU: thử cách đưa luật
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}
LỆNH KIỂM: npx vitest run ${TEP}
GIỚI HẠN: 1 phút, 3 vòng`;
const chayKiemXanh: ChayKiem = async (lenh) => ({ lenh, exit: 0, hetGio: false, giay: 1, duoi: "", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } } });

let goc: string;
let wt: string;
let ra: string;
const nap = (coB1: boolean, exclude = "") => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tclc-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(wt, "server/x"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, TEP), `import { it } from "vitest";\nit("cu", () => {});\n`);
  if (coB1) fs.writeFileSync(path.join(wt, "AGENTS.md"), B1);
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
  if (exclude) {
    fs.mkdirSync(path.join(wt, ".git", "info"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".git", "info", "exclude"), exclude);
  }
};
afterEach(() => {
  if (goc) fs.rmSync(goc, { recursive: true, force: true });
  goc = "";
});
const TEST_MOI = `import { it } from "vitest";\nit("moi", () => {});\n`;

/** driver ghi lại lệnh model nhận + ghi tệp được phép; tuỳ chọn thêm hành vi */
function driverGhi(nhan: { lenh?: string }, them?: (wt: string) => void): Driver {
  return async (v) => {
    nhan.lenh = v.lenh;
    fs.writeFileSync(path.join(v.wt, TEP), TEST_MOI);
    them?.(v.wt);
    return { vong: 1, token: null, ghiChu: [], hetGio: false };
  };
}
const chay = (over: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van: the(), wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, chayKiem: chayKiemXanh, khoGhi: { [TEP]: TEST_MOI }, ...over });
const dem = (s: string, kim: string) => s.split(kim).length - 1;
const khoiQuyUoc = (lenh: string) => `${dungKhoiNguCanhDuAn({ ten: "p", cay: [], lenhDuocPhep: [], tepQuyUoc: docTepQuyUoc(wt) })}\n${lenh}`;

describe("docLuatCach", () => {
  it("★★ vắng ⇒ ghi-de; ghi-de / ghep ⇒ chính nó; lạ, rỗng, hoa/thường sai ⇒ null", () => {
    expect(docLuatCach(undefined)).toBe("ghi-de");
    expect(docLuatCach("ghi-de")).toBe("ghi-de");
    expect(docLuatCach("ghep")).toBe("ghep");
    for (const x of ["", "GHEP", "ghi", "ghep ", "merge"]) expect(docLuatCach(x), x).toBeNull();
  });
});

describe("bo-sung-pilot.md — tệp thật", () => {
  const tho = fs.readFileSync(duongTepLuatBoSung());
  const chu = tho.toString("utf8");
  it("★★ ≤ 2 KB, LF, không BOM", () => {
    expect(tho.length).toBeLessThanOrEqual(2048);
    expect(tho.includes(Buffer.from([0x0d, 0x0a]))).toBe(false);
    expect(tho.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  });
  it("★★ mang đủ các ý HST đã duyệt (6 lần lệnh kiểm, kết quả 'bị từ chối' kèm tự chạy, CON SỐ khi chạm CSDL, trần lượt dành 2 lượt cuối, edit_file không ghi đè, thẻ 5 phút)", () => {
    for (const k of ["tối đa 6 lần trong lượt", "kết quả thật của lệnh kiểm", "CON SỐ", "ít nhất 2 lượt cuối", "edit_file từng chỗ", "write_file ghi đè", "5 phút", "TỆP ĐƯỢC PHÉP SỬA/TẠO", "QUY TRÌNH"]) expect(chu, k).toContain(k);
    expect(chu).not.toContain("là bình thường");
  });
});

describe("ghi-de (mặc định) — hành vi CŨ không đổi", () => {
  beforeEach(() => nap(true));
  it("★★★ không truyền luatCach ⇒ AGENTS.md worktree bị ghi đè bằng luật, lệnh chứa luật, JSON luatCach=ghi-de, KHÔNG có b1", async () => {
    const nhan: { lenh?: string } = {};
    const r = await chay({ luat: LUAT_CU, driver: driverGhi(nhan) });
    expect(r.ketCuc).toBe("xong");
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(LUAT_CU);
    expect(dem(nhan.lenh!, "SENTINEL_LUATCU_ZXCVB")).toBe(1);
    expect(r.luatCach).toBe("ghi-de");
    expect("b1" in r).toBe(false);
    expect(r.luat).toMatchObject({ sha256: sh(LUAT_CU) });
    expect(r.tepDoi).toEqual([TEP]); // AGENTS.md bị ghi đè KHÔNG vào danh sách tệp đổi (cũ)
  });
  it("★★★ không truyền --luat ⇒ mặc định là luat-du-an.md (KHÔNG phải bo-sung-pilot.md)", async () => {
    const r = await chay({});
    const cu = fs.readFileSync(duongTepLuat(), "utf8");
    expect(r.luat).toMatchObject({ nguon: duongTepLuat(), sha256: sh(cu) });
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(cu);
  });
  it("★★ luatCach:'ghi-de' tường minh = mặc định", async () => {
    const r = await chay({ luat: LUAT_CU, luatCach: "ghi-de" });
    expect(r.luatCach).toBe("ghi-de");
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(LUAT_CU);
  });
});

describe("ghep — bộ chạy KHÔNG chạm tệp nào ở worktree", () => {
  beforeEach(() => nap(true, "# runtime\nAGENTS.md\n"));
  it("★★★ base CÓ AGENTS.md đã theo dõi ⇒ sau lượt: còn theo dõi, sha đĩa = sha blob của base, git diff base rỗng, exclude KHÔNG bị ghi thêm", async () => {
    const exTruoc = fs.readFileSync(path.join(wt, ".git", "info", "exclude"), "utf8");
    const nhan: { lenh?: string } = {};
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep", driver: driverGhi(nhan) });
    expect(r.ketCuc).toBe("xong");
    expect(git(wt, "ls-files", "AGENTS.md")).toBe("AGENTS.md");
    expect(sh(fs.readFileSync(path.join(wt, "AGENTS.md")))).toBe(sh(git(wt, "show", "HEAD:AGENTS.md") + "\n"));
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(B1);
    expect(spawnSync("git", ["diff", "--quiet", "HEAD", "--", "AGENTS.md"], { cwd: wt }).status).toBe(0);
    expect(fs.readFileSync(path.join(wt, ".git", "info", "exclude"), "utf8")).toBe(exTruoc);
    expect(r.tepDoi).toEqual([TEP]);
  });
  it("★★★ prompt: B1 xuất hiện ĐÚNG MỘT lần (qua khối quy ước), phần bổ sung ĐÚNG MỘT lần (trong lệnh), luật cũ 0 lần", async () => {
    const nhan: { lenh?: string } = {};
    await chay({ luat: BO_SUNG, luatCach: "ghep", driver: driverGhi(nhan) });
    const tong = khoiQuyUoc(nhan.lenh!);
    expect(dem(tong, "SENTINEL_B1_QWERTY")).toBe(1);
    expect(dem(tong, "SENTINEL_BOSUNG_ASDFG")).toBe(1);
    expect(dem(tong, "SENTINEL_LUATCU_ZXCVB")).toBe(0);
    // B1 đến từ kênh tệp quy ước, KHÔNG nằm trong lệnh; phần bổ sung nằm trong lệnh, KHÔNG nằm trong khối quy ước
    expect(nhan.lenh).not.toContain("SENTINEL_B1_QWERTY");
    expect(dungKhoiNguCanhDuAn({ ten: "p", cay: [], lenhDuocPhep: [], tepQuyUoc: docTepQuyUoc(wt) })).not.toContain("SENTINEL_BOSUNG_ASDFG");
  });
  it("★★★ JSON ghi luatCach=ghep và sha CẢ HAI: luat = phần bổ sung, b1 = AGENTS.md của base", async () => {
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep" });
    expect(r.luatCach).toBe("ghep");
    expect(r.luat).toEqual({ sha256: sh(BO_SUNG), nguon: "tham-so", byte: Buffer.byteLength(BO_SUNG, "utf8") });
    expect(r.b1).toMatchObject({ sha256: sh(B1), byte: Buffer.byteLength(B1, "utf8"), saoLuotKhop: true });
    expect(r.b1!.nguon).toMatch(/^AGENTS\.md@[0-9a-f]{12}$/);
  });
  it("★★★ mặc định của ghep là bo-sung-pilot.md (KHÔNG phải luat-du-an.md cũ)", async () => {
    const nhan: { lenh?: string } = {};
    const r = await chay({ luatCach: "ghep", driver: driverGhi(nhan) });
    const bs = fs.readFileSync(duongTepLuatBoSung(), "utf8");
    expect(r.luat).toMatchObject({ nguon: duongTepLuatBoSung(), sha256: sh(bs) });
    expect(nhan.lenh).toContain(bs.trim().split("\n")[0]!);
    expect(nhan.lenh).not.toContain(fs.readFileSync(duongTepLuat(), "utf8").trim().split("\n")[0]!);
  });
  it("★★★ model sửa AGENTS.md trong lượt ghep ⇒ KHÔNG bị lọc: vào tepDoi và vi phạm TỆP ĐƯỢC PHÉP; saoLuotKhop=false", async () => {
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep", driver: driverGhi({}, (w) => fs.appendFileSync(path.join(w, "AGENTS.md"), "them\n")) });
    expect(r.tepDoi).toEqual(["AGENTS.md", TEP]);
    expect(r.viPham.length).toBeGreaterThan(0);
    expect(r.b1!.saoLuotKhop).toBe(false);
  });
  it("★★ worktree có AGENTS.md đã SỬA (còn bản ghi-đè của lượt cũ) ⇒ từ chối, không tốn lượt model", async () => {
    fs.writeFileSync(path.join(wt, "AGENTS.md"), LUAT_CU);
    let goi = 0;
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep", driver: async () => (goi++, { vong: 0, token: null, ghiChu: [], hetGio: false }) });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("worktree không sạch"); // AGENTS.md sửa DỞ hiện trong trạng thái bẩn (ghep không lọc nó khỏi status)
    expect(goi).toBe(0);
  });
  it("★★★ đứng trên nhánh pilot với AGENTS.md sửa dở ⇒ CẤT vào nhánh pilot (kèm AGENTS.md), rồi về B1 của base và chạy được", async () => {
    const base = git(wt, "rev-parse", "HEAD");
    git(wt, "checkout", "-q", "-b", "pilot/tho-ca-TC-94");
    fs.writeFileSync(path.join(wt, "AGENTS.md"), LUAT_CU);
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep", base });
    expect(r.ketCuc).toBe("xong");
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(B1);
    expect(git(wt, "log", "pilot/tho-ca-TC-94", "-1", "--format=%s", "--", "AGENTS.md")).toContain("pilot: cất kết quả lượt trước");
  });
});

describe("ghep — base KHÔNG có AGENTS.md", () => {
  beforeEach(() => nap(false, "AGENTS.md\n"));
  it("★★★ không tạo AGENTS.md, không đụng exclude; JSON b1.sha256=null, byte=0", async () => {
    const exTruoc = fs.readFileSync(path.join(wt, ".git", "info", "exclude"), "utf8");
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep" });
    expect(r.ketCuc).toBe("xong");
    expect(fs.existsSync(path.join(wt, "AGENTS.md"))).toBe(false);
    expect(fs.readFileSync(path.join(wt, ".git", "info", "exclude"), "utf8")).toBe(exTruoc);
    expect(r.b1).toMatchObject({ sha256: null, byte: 0, saoLuotKhop: true });
  });
  it("★★★ AGENTS.md CHƯA THEO DÕI bị exclude nuốt khỏi `git status` ⇒ vẫn bị phát hiện bằng đĩa và từ chối", async () => {
    fs.writeFileSync(path.join(wt, "AGENTS.md"), LUAT_CU);
    expect(git(wt, "status", "--porcelain", "--", "AGENTS.md")).toBe(""); // đối chứng tiền đề: status KHÔNG thấy
    expect(khopB1(wt, git(wt, "rev-parse", "HEAD"))).toBe(false);
    const r = await chay({ luat: BO_SUNG, luatCach: "ghep" });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("AGENTS.md");
  });
});

describe("khopB1", () => {
  beforeEach(() => nap(true));
  it("★★ khớp ⇒ true; sửa ⇒ false; xoá ⇒ false", () => {
    const h = git(wt, "rev-parse", "HEAD");
    expect(khopB1(wt, h)).toBe(true);
    fs.appendFileSync(path.join(wt, "AGENTS.md"), "x");
    expect(khopB1(wt, h)).toBe(false);
    fs.rmSync(path.join(wt, "AGENTS.md"));
    expect(khopB1(wt, h)).toBe(false);
  });
});

describe("dòng lệnh thật", () => {
  it("★★★ --luat-cach giá trị lạ ⇒ thoát mã 2, thông báo nêu giá trị, chưa đọc thẻ", () => {
    const r = spawnSync("npx", ["tsx", "scripts/tho-ca-pilot/chayMotViec.ts", "--the", path.join(os.tmpdir(), "khong-co-the.txt"), "--luat-cach", "tron"], { cwd: process.cwd(), encoding: "utf8", shell: true, timeout: 120_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--luat-cach phải là ghi-de hoặc ghep");
    expect(r.stderr).toContain("tron");
  }, 130_000);
});
