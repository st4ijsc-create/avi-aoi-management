import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docGocTuEnv, docTep, ghiTep, giaiDuongDanDoc, giaiDuongDanGhi, lietKe, tachDuongDanTuongDoi, timGoc, timTep, type GocTep } from "./tepAnToan";

let tam: string;
let ngoai: string;
let goc: GocTep;
let gocRo: GocTep;

beforeAll(async () => {
  tam = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cuc-bo-"));
  ngoai = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ngoai-"));
  await fs.mkdir(path.join(tam, "rw", "con"), { recursive: true });
  await fs.mkdir(path.join(tam, "ro"), { recursive: true });
  await fs.writeFile(path.join(tam, "rw", "a.txt"), "xin chào");
  await fs.writeFile(path.join(tam, "rw", ".env"), "SECRET=1");
  await fs.writeFile(path.join(tam, "rw", "con", "bao-cao-1.csv"), "a,b");
  await fs.writeFile(path.join(tam, "rw", "anh.bin"), Buffer.from([1, 0, 2]));
  await fs.writeFile(path.join(tam, "ro", "ma.ts"), "export const x = 1;");
  await fs.writeFile(path.join(ngoai, "bi-mat.txt"), "ngoài gốc");
  // junction trỏ RA NGOÀI gốc (Windows tạo được không cần quyền admin)
  await fs.symlink(ngoai, path.join(tam, "rw", "loi-ra"), "junction");
  goc = { ten: "chung", duongDan: path.join(tam, "rw"), chiDoc: false };
  gocRo = { ten: "ma", duongDan: path.join(tam, "ro"), chiDoc: true };
});

afterAll(async () => {
  await fs.rm(tam, { recursive: true, force: true });
  await fs.rm(ngoai, { recursive: true, force: true });
});

describe("cấu hình gốc", () => {
  it("đọc ten=duong[:ro]; tên sai / tương đối / trùng ⇒ ném", () => {
    const ds = docGocTuEnv("chung=D:\\AI\\tep; ma=D:\\SOURCES\\x:ro");
    expect(ds.map((g) => [g.ten, g.chiDoc])).toEqual([["chung", false], ["ma", true]]);
    expect(() => docGocTuEnv("Chung Sai=D:\\x")).toThrow(/tên gốc/);
    expect(() => docGocTuEnv("a=tuong\\doi")).toThrow(/tuyệt đối/);
    expect(() => docGocTuEnv("a=D:\\x;a=D:\\y")).toThrow(/trùng/);
    expect(docGocTuEnv(undefined)).toEqual([]);
  });
  it("timGoc: một gốc ⇒ mặc định; nhiều gốc ⇒ phải chọn", () => {
    expect(timGoc([goc], undefined)).toBe(goc);
    expect(() => timGoc([goc, gocRo], undefined)).toThrow(/phải chọn/);
    expect(() => timGoc([goc], "khac")).toThrow(/không có gốc/);
  });
});

describe("đường dẫn bị cấm", () => {
  it.each([
    ["C:\\Windows\\win.ini"],
    ["/etc/passwd"],
    ["\\\\may\\chia-se\\x"],
    ["../x"],
    ["con/../../x"],
    ["a.txt:luong"],
    ["NUL"],
    ["con/COM1.txt"],
    ["ten-cuoi-cham."],
    [".git/config"],
    ["node_modules/x"],
    ["a\u0000b"],
  ])("%s ⇒ DUONG_DAN_CAM", (p) => {
    expect(() => tachDuongDanTuongDoi(p)).toThrow();
  });
  it("junction trỏ ra ngoài ⇒ đọc / ghi đều bị chặn", async () => {
    await expect(giaiDuongDanDoc(goc, "loi-ra/bi-mat.txt")).rejects.toMatchObject({ ma: "DUONG_DAN_CAM" });
    await expect(giaiDuongDanGhi(goc, "loi-ra/moi.txt")).rejects.toMatchObject({ ma: "DUONG_DAN_CAM" });
  });
  it("tệp bí mật trong gốc ⇒ không đọc, không liệt kê, không tìm thấy", async () => {
    await expect(giaiDuongDanDoc(goc, ".env")).rejects.toMatchObject({ ma: "TEP_BI_MAT" });
    expect((await lietKe(goc, "")).muc.map((m) => m.ten)).not.toContain(".env");
    expect((await timTep(goc, "env", "")).ketQua).toEqual([]);
    await expect(ghiTep(goc, "x/.env.local", "A=1", false)).rejects.toMatchObject({ ma: "TEP_BI_MAT" });
  });
});

describe("đọc / ghi / tìm", () => {
  it("đọc văn bản; tệp nhị phân ⇒ từ chối", async () => {
    expect((await docTep(goc, "a.txt", undefined, undefined)).noiDung).toBe("xin chào");
    await expect(docTep(goc, "anh.bin", undefined, undefined)).rejects.toMatchObject({ ma: "TEP_NHI_PHAN" });
  });
  it("ghi tạo thư mục con; không ghi đè trừ khi ghiDe", async () => {
    expect(await ghiTep(goc, "xuat/2026/bao-cao.md", "# A", false)).toEqual({ byte: 3, taoMoi: true });
    await expect(ghiTep(goc, "xuat/2026/bao-cao.md", "# B", false)).rejects.toMatchObject({ ma: "DA_TON_TAI" });
    expect(await ghiTep(goc, "xuat/2026/bao-cao.md", "# B", true)).toMatchObject({ taoMoi: false });
    expect(await fs.readFile(path.join(tam, "rw", "xuat", "2026", "bao-cao.md"), "utf8")).toBe("# B");
  });
  it("gốc chỉ đọc ⇒ ghi bị chặn, đọc được", async () => {
    await expect(ghiTep(gocRo, "moi.ts", "x", false)).rejects.toMatchObject({ ma: "GOC_CHI_DOC" });
    expect((await docTep(gocRo, "ma.ts", 0, 6)).noiDung).toBe("export");
  });
  it("tìm theo một phần tên, đường dẫn tương đối dùng /", async () => {
    expect((await timTep(goc, "BAO-CAO", "")).ketQua).toContain("con/bao-cao-1.csv");
  });
});
