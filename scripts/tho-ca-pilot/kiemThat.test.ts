/**
 * HA-6b (phần 2) — LỆNH KIỂM THẬT: đọc khoá đi đôi, chép fixture vào thư mục tạm (ngoài worktree, không liên kết tượng trưng, có trần), thay {CAY}, fail-closed,
 * kết quả CHO JSON không chứa lệnh / đường / đầu ra.
 * ĐỘT BIẾN PHẢI BẮT: nhận một khoá đơn lẻ · nhận {CAY} có nháy · nhận đường tương đối · cây giả nằm trong worktree · đi theo liên kết tượng trưng · bỏ trần số tệp ·
 * chạy trên fixture gốc (không chép) · không dọn bản chép · exit ≠ 0 mà vẫn đạt · lỗi/hết giờ mà vẫn đạt · lộ lệnh/đường ra kết quả.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KetQuaKiem } from "./kiemChung";
import { chayKiemThat, chepCayGia, chupWt, docKiemThat, TRAN_BYTE_CAY, TRAN_CAY_MAC_DINH, TRAN_TEP_CAY } from "./kiemThat";

const gitThat = (cwd: string, a: string[]): string | null => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};
const chupGit = (w: string) => chupWt(w, gitThat);
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

let goc: string;
let wt: string;
let cay: string;
beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "kt-"));
  wt = path.join(goc, "_tho_ca_wt_kt");
  cay = path.join(goc, "fixture");
  fs.mkdirSync(wt, { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, ".gitignore"), "dist/\n");
  fs.writeFileSync(path.join(wt, "a.ts"), "export const a = 1;\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
  fs.mkdirSync(path.join(cay, "assets"), { recursive: true });
  fs.writeFileSync(path.join(cay, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(cay, "assets", "app-abc123.js"), "console.log(1)");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const tmpRieng = () => fs.mkdtempSync(path.join(goc, "tmp-"));
const kq = (o: Partial<KetQuaKiem> = {}): KetQuaKiem => ({ lenh: "x", exit: 0, hetGio: false, giay: 2, duoi: "ĐẦU RA BÍ MẬT", vitest: { tep: null, ca: null }, ...o });

describe("docKiemThat", () => {
  it("★★★ cả hai rỗng ⇒ ok không bật; có đủ ⇒ trả lệnh + cây", () => {
    expect(docKiemThat(undefined, undefined)).toEqual({ ok: true });
    expect(docKiemThat("  ", "")).toEqual({ ok: true });
    expect(docKiemThat("node tool.mjs --dist {CAY}", cay)).toEqual({ ok: true, kiemThat: { lenh: "node tool.mjs --dist {CAY}", cay } });
  });
  it.each([
    ["chỉ có lệnh", "node x {CAY}", ""],
    ["chỉ có cây", "", "C:/f"],
    ["lệnh không có {CAY}", "node x", "C:/f"],
    ["{CAY} có nháy kép", 'node x "{CAY}"', "C:/f"],
    ["{CAY} có nháy đơn", "node x '{CAY}'", "C:/f"],
    ["lệnh nhiều dòng", "node x {CAY}\nrm -rf /", "C:/f"],
    ["lệnh quá dài", `node ${"a".repeat(400)} {CAY}`, "C:/f"],
    ["cây là đường tương đối", "node x {CAY}", "fixture/dist"],
    ["cây có ký tự điều khiển", "node x {CAY}", "C:/f\u0000x"],
  ])("★★★ thẻ LỖI: %s", (_t, lenh, c) => {
    expect(docKiemThat(lenh, c).ok).toBe(false);
  });
  it("★★ thông điệp lỗi KHÔNG chép lệnh / đường", () => {
    const r = docKiemThat("node BI_MAT_LENH", "tuong-doi/BI_MAT_DUONG");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("BI_MAT");
  });
});

describe("chepCayGia", () => {
  it("★★★ chép vào thư mục tạm MỚI (khác fixture), nội dung giống; sửa bản chép không đổi fixture; don() xoá sạch", () => {
    const t = tmpRieng();
    const r = chepCayGia(cay, wt, t);
    if (!r.ok) throw new Error(r.lyDo);
    expect(path.resolve(r.dir)).not.toBe(path.resolve(cay));
    expect(path.relative(t, r.dir).startsWith("..")).toBe(false);
    expect(fs.readFileSync(path.join(r.dir, "assets", "app-abc123.js"), "utf8")).toBe("console.log(1)");
    fs.writeFileSync(path.join(r.dir, "index.html"), "DA SUA");
    expect(fs.readFileSync(path.join(cay, "index.html"), "utf8")).toBe("<html></html>");
    r.don();
    expect(fs.existsSync(r.dir)).toBe(false);
    expect(fs.readdirSync(t)).toEqual([]);
  });
  it("★★★ cây giả nằm TRONG worktree, hoặc worktree nằm trong cây giả ⇒ từ chối", () => {
    const trong = path.join(wt, "fixture");
    fs.mkdirSync(trong);
    expect(chepCayGia(trong, wt, tmpRieng())).toEqual({ ok: false, lyDo: "cay-gia-long-voi-worktree" });
    expect(chepCayGia(goc, wt, tmpRieng())).toEqual({ ok: false, lyDo: "cay-gia-long-voi-worktree" });
  });
  it("★★ không tồn tại / không phải thư mục ⇒ từ chối", () => {
    expect(chepCayGia(path.join(goc, "khong-co"), wt, tmpRieng())).toEqual({ ok: false, lyDo: "cay-gia-khong-doc-duoc" });
    expect(chepCayGia(path.join(cay, "index.html"), wt, tmpRieng())).toEqual({ ok: false, lyDo: "cay-gia-khong-phai-thu-muc" });
  });
  it("★★★ có liên kết tượng trưng ⇒ từ chối (không đi theo ra ngoài)", () => {
    try {
      fs.symlinkSync(os.tmpdir(), path.join(cay, "ra-ngoai"), "junction");
    } catch {
      return; // máy không cho tạo liên kết ⇒ bỏ ca (không kết luận)
    }
    expect(chepCayGia(cay, wt, tmpRieng())).toEqual({ ok: false, lyDo: "cay-gia-co-lien-ket-tuong-trung" });
  });
  it("★★ quá trần số tệp ⇒ từ chối, không để lại thư mục tạm", () => {
    const nhieu = path.join(cay, "nhieu");
    fs.mkdirSync(nhieu);
    for (let i = 0; i <= TRAN_TEP_CAY; i++) fs.writeFileSync(path.join(nhieu, `f${i}`), "");
    const t = tmpRieng();
    expect(chepCayGia(cay, wt, t)).toEqual({ ok: false, lyDo: "cay-gia-qua-lon" });
    expect(fs.readdirSync(t)).toEqual([]);
  });
});

describe("chayKiemThat", () => {
  it("★★★ thay {CAY} bằng đường BẢN CHÉP (nháy kép), lệnh chạy ở worktree; bản chép tồn tại trong lúc chạy và bị xoá sau; fixture gốc nguyên vẹn", async () => {
    const t = tmpRieng();
    let lenhThay = "";
    let cwd = "";
    let thayLucChay = false;
    const r = await chayKiemThat({ lenh: "node tool.mjs --dist {CAY} --kiem", cay }, wt, async (l, w) => {
      lenhThay = l;
      cwd = w;
      const m = /--dist "([^"]+)" --kiem/.exec(l)!;
      thayLucChay = fs.existsSync(path.join(m[1]!, "assets", "app-abc123.js"));
      fs.writeFileSync(path.join(m[1]!, "index.html"), "SAI");
      return kq();
    }, 30, chupGit, t);
    expect(r).toEqual({ dat: true, exit: 0, hetGio: false, giay: 2, lyDo: null });
    expect(cwd).toBe(wt);
    expect(thayLucChay).toBe(true);
    expect(lenhThay).not.toContain("{CAY}");
    expect(lenhThay).not.toContain(cay);
    expect(fs.readdirSync(t)).toEqual([]);
    expect(fs.readFileSync(path.join(cay, "index.html"), "utf8")).toBe("<html></html>");
  });
  it("★★★ exit ≠ 0 / hết giờ / lỗi khởi chạy / hàm ném ⇒ KHÔNG đạt, lý do ngắn, đã dọn bản chép", async () => {
    const t = tmpRieng();
    const chay = (k: Partial<KetQuaKiem> | "nem") => chayKiemThat({ lenh: "x {CAY}", cay }, wt, async () => (k === "nem" ? Promise.reject(new Error("BI_MAT_LOI")) : kq(k)), 30, chupGit, t);
    expect(await chay({ exit: 3 })).toMatchObject({ dat: false, exit: 3, lyDo: "thoat-ma-3" });
    expect(await chay({ exit: null, hetGio: true, giay: 30 })).toMatchObject({ dat: false, hetGio: true, lyDo: "het-gio-30s" });
    expect(await chay({ exit: null, loi: "spawn ENOENT BI_MAT_LOI" })).toMatchObject({ dat: false, lyDo: "khong-khoi-chay-duoc" });
    const nem = await chay("nem");
    expect(nem).toMatchObject({ dat: false, lyDo: "loi-bo-chay" });
    expect(JSON.stringify(nem)).not.toContain("BI_MAT_LOI");
    expect(fs.readdirSync(t)).toEqual([]);
  });
  it("★★★ kết quả KHÔNG chứa lệnh, đường fixture, đường bản chép hay đầu ra", async () => {
    const kd = await chayKiemThat({ lenh: "node BI_MAT_CMD.mjs {CAY}", cay }, wt, async () => kq({ exit: 1, duoi: "DAU_RA_BI_MAT" }), 30, chupGit, tmpRieng());
    const s = JSON.stringify(kd);
    for (const x of ["BI_MAT_CMD", "DAU_RA_BI_MAT", cay, "tcp-cay-", "fixture"]) expect(s).not.toContain(x);
    expect(Object.keys(kd).sort()).toEqual(["dat", "exit", "giay", "hetGio", "lyDo"]);
  });
  it("★★★ lệnh GHI vào worktree ⇒ không đạt 'lenh-that-ghi-vao-wt' dù exit 0: tạo tệp mới / sửa tệp theo dõi / xoá / ghi vào thư mục .gitignore / ghi THÊM vào tệp model đã sửa", async () => {
    const t = tmpRieng();
    fs.writeFileSync(path.join(wt, "a.ts"), "export const a = 2; // model đã sửa\n"); // trạng thái ' M' có sẵn TRƯỚC lệnh
    fs.mkdirSync(path.join(wt, "thu"));
    fs.writeFileSync(path.join(wt, "thu", "f0.txt"), "x"); // thư mục chưa theo dõi CÓ SẴN trước lệnh
    const ghi: Array<[string, () => void]> = [
      ["tạo tệp mới", () => fs.writeFileSync(path.join(wt, "moi.txt"), "x")],
      ["tạo tệp trong thư mục chưa theo dõi ĐÃ CÓ SẴN (status gọn vẫn là `?? thu/`)", () => fs.writeFileSync(path.join(wt, "thu", "f1.txt"), "x")],
      ["ghi thêm vào tệp model đã sửa", () => fs.appendFileSync(path.join(wt, "a.ts"), "// lệnh ghi\n")],
      ["ghi vào dist/ (bị .gitignore)", () => (fs.mkdirSync(path.join(wt, "dist")), fs.writeFileSync(path.join(wt, "dist", "out.js"), "x"))],
      ["xoá tệp theo dõi", () => fs.rmSync(path.join(wt, ".gitignore"))],
    ];
    for (const [ten, lam] of ghi) {
      const r = await chayKiemThat({ lenh: "x {CAY}", cay }, wt, async () => (lam(), kq()), 30, chupGit, t);
      expect(r, ten).toMatchObject({ dat: false, exit: 0, lyDo: "lenh-that-ghi-vao-wt" });
    }
  });
  it("★★★ lệnh chỉ ghi vào {CAY} (bản chép) và tmp ⇒ ĐẠT; worktree có sẵn thay đổi của model không bị tính", async () => {
    fs.writeFileSync(path.join(wt, "a.ts"), "export const a = 3; // model đã sửa\n");
    const t = tmpRieng();
    const r = await chayKiemThat({ lenh: "node tool {CAY}", cay }, wt, async (l) => {
      const m = /"([^"]+)"/.exec(l)!;
      fs.writeFileSync(path.join(m[1]!, "ra.txt"), "x");
      fs.writeFileSync(path.join(t, "tam.txt"), "x");
      return kq();
    }, 30, chupGit, t);
    expect(r).toMatchObject({ dat: true, lyDo: null });
  });
  it("★★ không chụp được worktree (không phải kho git) ⇒ không đạt, KHÔNG chạy lệnh (fail-closed)", async () => {
    const khongGit = path.join(goc, "khong-git");
    fs.mkdirSync(khongGit);
    let goi = 0;
    const r = await chayKiemThat({ lenh: "x {CAY}", cay }, khongGit, async () => (goi++, kq()), 30, chupGit, tmpRieng());
    expect(r).toMatchObject({ dat: false, lyDo: "khong-chup-duoc-wt" });
    expect(goi).toBe(0);
    expect(chupWt(khongGit, gitThat)).toBeNull();
  });
  it("★★ cây giả hỏng (ngoài thư mục / trong worktree) ⇒ không đạt, KHÔNG chạy lệnh", async () => {
    let goi = 0;
    const r = await chayKiemThat({ lenh: "x {CAY}", cay: path.join(wt) }, wt, async () => (goi++, kq()), 30, chupGit, tmpRieng());
    expect(r).toMatchObject({ dat: false, lyDo: "cay-gia-long-voi-worktree" });
    expect(goi).toBe(0);
  });
});

describe("trần bản chép cây giả — tiêm qua tham số (số tệp / byte)", () => {
  // cây của beforeEach: index.html (13 byte) + assets/app-abc123.js (14 byte) = 2 tệp, 27 byte
  it("★★★ trần mặc định = hằng đã công bố (5 000 tệp, 100 MiB); không truyền tham số ⇒ dùng mặc định", () => {
    expect(TRAN_CAY_MAC_DINH).toEqual({ tep: TRAN_TEP_CAY, byte: TRAN_BYTE_CAY });
    expect(TRAN_TEP_CAY).toBe(5000);
    expect(TRAN_BYTE_CAY).toBe(100 * 1024 * 1024);
    const t = tmpRieng();
    const r = chepCayGia(cay, wt, t);
    expect(r.ok).toBe(true);
    if (r.ok) r.don();
  });
  it("★★★ trần SỐ TỆP: đúng bằng (2) vẫn chép; thấp hơn một (1) ⇒ cay-gia-qua-lon và KHÔNG để lại thư mục tạm", () => {
    const t = tmpRieng();
    const bang = chepCayGia(cay, wt, t, { tep: 2, byte: 1e9 });
    expect(bang.ok).toBe(true);
    if (bang.ok) bang.don();
    const t2 = tmpRieng();
    expect(chepCayGia(cay, wt, t2, { tep: 1, byte: 1e9 })).toEqual({ ok: false, lyDo: "cay-gia-qua-lon" });
    expect(fs.readdirSync(t2)).toEqual([]);
  });
  it("★★★ trần BYTE: đúng bằng (27) vẫn chép; thấp hơn một (26) ⇒ cay-gia-qua-lon và KHÔNG để lại thư mục tạm", () => {
    const t = tmpRieng();
    const bang = chepCayGia(cay, wt, t, { tep: 1000, byte: 27 });
    expect(bang.ok).toBe(true);
    if (bang.ok) bang.don();
    const t2 = tmpRieng();
    expect(chepCayGia(cay, wt, t2, { tep: 1000, byte: 26 })).toEqual({ ok: false, lyDo: "cay-gia-qua-lon" });
    expect(fs.readdirSync(t2)).toEqual([]);
  });
  it("★★★ trần TIÊM áp cả ở THƯ MỤC CON (đệ quy truyền trần, không rơi về trần mặc định): 3 tệp chỉ ở tầng con, trần 2 tệp / 29 byte ⇒ cay-gia-qua-lon; đúng bằng (3 / 30) vẫn chép", () => {
    const cayLong = path.join(goc, "cay-long");
    fs.mkdirSync(path.join(cayLong, "a", "b"), { recursive: true });
    for (const ten of ["x.txt", "y.txt", "z.txt"]) fs.writeFileSync(path.join(cayLong, "a", "b", ten), "0123456789"); // 3 tệp × 10 byte, KHÔNG tệp nào ở tầng gốc
    const t1 = tmpRieng();
    expect(chepCayGia(cayLong, wt, t1, { tep: 2, byte: 1e9 })).toEqual({ ok: false, lyDo: "cay-gia-qua-lon" });
    expect(fs.readdirSync(t1)).toEqual([]);
    const t2 = tmpRieng();
    expect(chepCayGia(cayLong, wt, t2, { tep: 1e9, byte: 29 })).toEqual({ ok: false, lyDo: "cay-gia-qua-lon" });
    const t3 = tmpRieng();
    const vua = chepCayGia(cayLong, wt, t3, { tep: 3, byte: 30 });
    expect(vua.ok).toBe(true);
    if (vua.ok) vua.don();
  });
  it("★★★ chayKiemThat truyền trần xuống: vượt ⇒ dat:false lyDo cay-gia-qua-lon và lệnh KHÔNG được chạy; không vượt ⇒ chạy bình thường", async () => {
    let goi = 0;
    const chayGia = async () => (goi++, kq());
    const r1 = await chayKiemThat({ lenh: "node x {CAY}", cay }, wt, chayGia, 30, chupGit, tmpRieng(), { tep: 1, byte: 1e9 });
    expect(r1).toEqual({ dat: false, exit: null, hetGio: false, giay: 0, lyDo: "cay-gia-qua-lon" });
    expect(goi).toBe(0);
    const r2 = await chayKiemThat({ lenh: "node x {CAY}", cay }, wt, chayGia, 30, chupGit, tmpRieng(), { tep: 2, byte: 27 });
    expect(r2).toEqual({ dat: true, exit: 0, hetGio: false, giay: 2, lyDo: null });
    expect(goi).toBe(1);
  });
});
