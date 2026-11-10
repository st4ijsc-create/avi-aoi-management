import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, commitBoChay, docLuatTuTep, duongTepLuat, sha256Hex } from "./chayMotViec";
import type { ChayKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const THE = `MÃ: TC-98
MỤC TIÊU: thử ghi luật vào JSON
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/a.test.ts
LỆNH KIỂM: npx vitest run client/src/lib/a.test.ts
GIỚI HẠN: 1 phút, 3 vòng`;

const chayKiemXanh: ChayKiem = async (lenh) => ({
  lenh,
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } },
});

let goc: string;
let wt: string;
let ra: string;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcl-"));
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
  chayMotViec({ van: THE, wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, chayKiem: chayKiemXanh, ...over });

describe("JSON lượt ghi luật thật sự gửi model (--luat)", () => {
  it("★★★ luật truyền vào: sha256/byte khớp CHÍNH chuỗi ghi vào AGENTS.md của worktree; nguồn = nhãn truyền vào", async () => {
    const luat = "# luật thử — Thợ Cả\nkhông sửa ngoài tệp được phép\n";
    const r = await chay({ luat, luatNguon: "D:/x/AGENTS.pilot.md" });
    expect(r.luat).toEqual({ sha256: sha(luat), nguon: "D:/x/AGENTS.pilot.md", byte: Buffer.byteLength(luat, "utf8") });
    expect(Buffer.byteLength(luat, "utf8")).toBeGreaterThan(luat.length); // có chữ có dấu ⇒ byte ≠ ký tự
    expect(sha(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8"))).toBe(r.luat!.sha256);
  });

  it("★★ luật truyền vào mà không nêu nguồn ⇒ nguon = tham-so", async () => {
    const r = await chay({ luat: "# a\n" });
    expect(r.luat?.nguon).toBe("tham-so");
  });

  it("★★★ không truyền luật ⇒ dùng luat-du-an.md của repo; JSON ghi đúng sha và đường tệp đó", async () => {
    const r = await chay({});
    const noiDung = fs.readFileSync(duongTepLuat(), "utf8");
    expect(r.luat).toEqual({ sha256: sha(noiDung), nguon: duongTepLuat(), byte: Buffer.byteLength(noiDung, "utf8") });
    expect(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8")).toBe(noiDung);
  });

  it("★★ hai luật khác nhau ⇒ hai sha khác nhau (sha đo nội dung, không đo tên)", async () => {
    const a = await chay({ luat: "# một\n" });
    const b = await chay({ luat: "# hai\n" });
    expect(a.luat!.sha256).not.toBe(b.luat!.sha256);
  });

  it("★★ boChay truyền vào được ghi nguyên; vắng thì không có khoá boChay", async () => {
    const co = await chay({ luat: "# a\n", boChay: { commit: "abc123", sach: false, tepLech: ["docs/tho-ca-pilot/luat-du-an.md"] } });
    expect(co.boChay).toEqual({ commit: "abc123", sach: false, tepLech: ["docs/tho-ca-pilot/luat-du-an.md"] });
    const khong = await chay({ luat: "# a\n" });
    expect("boChay" in khong).toBe(false);
  });

  it("★ lượt bị từ chối (thẻ lỗi) không ghi luật (chưa tới bước ghi luật)", async () => {
    const r = await chay({ van: "không phải thẻ", luat: "# a\n" });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.luat).toBeUndefined();
  });
});

describe("sha256Hex", () => {
  it("★ khớp vectơ chuẩn của SHA-256 (chuỗi rỗng và abc) và băm theo UTF-8", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("ế")).toBe(createHash("sha256").update(Buffer.from("ế", "utf8")).digest("hex"));
  });
});

describe("docLuatTuTep (--luat <tệp>)", () => {
  it("★★★ đọc tệp UTF-8, trả nội dung nguyên văn và đường tuyệt đối", () => {
    const f = path.join(goc, "luat.md");
    fs.writeFileSync(f, "# luật\nchữ có dấu\n", "utf8");
    expect(docLuatTuTep(f)).toEqual({ luat: "# luật\nchữ có dấu\n", nguon: path.resolve(f) });
  });
  it("★★★ tệp vắng ⇒ NÉM LỖI (không lùi lặng lẽ về luật mặc định)", () => {
    expect(() => docLuatTuTep(path.join(goc, "khong-co.md"))).toThrow(/không có tệp/);
  });
  it("★★ tệp rỗng hoặc toàn khoảng trắng ⇒ ném lỗi", () => {
    const f = path.join(goc, "rong.md");
    fs.writeFileSync(f, " \n\n", "utf8");
    expect(() => docLuatTuTep(f)).toThrow(/rỗng/);
  });
});

describe("commitBoChay", () => {
  const taoRepo = () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "tcb-"));
    git(r, "init", "-q");
    git(r, "config", "user.email", "t@t");
    git(r, "config", "user.name", "t");
    fs.mkdirSync(path.join(r, "scripts/tho-ca-pilot"), { recursive: true });
    fs.mkdirSync(path.join(r, "docs/tho-ca-pilot"), { recursive: true });
    fs.writeFileSync(path.join(r, "scripts/tho-ca-pilot/a.ts"), "1\n");
    fs.writeFileSync(path.join(r, "docs/tho-ca-pilot/luat-du-an.md"), "luat\n");
    fs.writeFileSync(path.join(r, "khac.txt"), "k\n");
    git(r, "add", ".");
    git(r, "commit", "-q", "-m", "init");
    return r;
  };

  it("★★★ sạch: commit = HEAD thật, sach = true, không có tepLech", () => {
    const r = taoRepo();
    try {
      const kq = commitBoChay(r);
      expect(kq.commit).toBe(git(r, "rev-parse", "HEAD"));
      expect(kq.sach).toBe(true);
      expect("tepLech" in kq).toBe(false);
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("★★★ tệp luật chép tạm chưa commit ⇒ sach = false và tepLech nêu đúng tệp", () => {
    const r = taoRepo();
    try {
      fs.writeFileSync(path.join(r, "docs/tho-ca-pilot/luat-du-an.md"), "bản tạm\n");
      const kq = commitBoChay(r);
      expect(kq.sach).toBe(false);
      expect(kq.tepLech).toEqual(["docs/tho-ca-pilot/luat-du-an.md"]);
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("★★ tệp MỚI chưa theo dõi trong thư mục bộ chạy cũng làm sach = false", () => {
    const r = taoRepo();
    try {
      fs.writeFileSync(path.join(r, "scripts/tho-ca-pilot/moi.ts"), "2\n");
      expect(commitBoChay(r)).toMatchObject({ sach: false, tepLech: ["scripts/tho-ca-pilot/moi.ts"] });
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("★★ thay đổi NGOÀI hai thư mục bộ chạy không làm bẩn", () => {
    const r = taoRepo();
    try {
      fs.writeFileSync(path.join(r, "khac.txt"), "đổi\n");
      expect(commitBoChay(r).sach).toBe(true);
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("★ không phải repo git ⇒ commit null, sach null (không ném)", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tcn-"));
    try {
      expect(commitBoChay(d)).toEqual({ commit: null, sach: null });
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
