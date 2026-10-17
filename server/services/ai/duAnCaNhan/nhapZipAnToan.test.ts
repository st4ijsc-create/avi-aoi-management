/**
 * ★★★ Đợt 3a — LƯỚI NHẬP ZIP AN TOÀN: zip-slip · symlink · zip bomb (kể cả kích thước KHAI NÓI DỐI) · đuôi tệp ·
 * chiều DƯƠNG (một ZIP sạch giải đúng từng byte — không có ca này thì một bản vá "từ chối tất cả" cũng xanh).
 * ZIP dựng bằng JSZip THẬT (cùng thư viện đọc), ZIP độc hại dựng bằng cách VÁ BYTE của ZIP sạch khi JSZip không cho
 * viết hình dạng ấy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { giaiNenZipAnToan, lyDoBoQua, phanQuyetTenMuc } from "./nhapZipAnToan";

let DICH = "";
let GOC = "";
beforeEach(() => {
  GOC = fs.mkdtempSync(path.join(os.tmpdir(), "zip3a-"));
  DICH = path.join(GOC, "dich");
  fs.mkdirSync(DICH);
});
afterEach(() => {
  fs.rmSync(GOC, { recursive: true, force: true });
});

async function dungZip(muc: Array<{ ten: string; noiDung: string | Buffer; unix?: number }>, nen = true): Promise<Buffer> {
  const z = new JSZip();
  for (const m of muc) z.file(m.ten, m.noiDung, m.unix !== undefined ? { unixPermissions: m.unix } : {});
  return z.generateAsync({ type: "nodebuffer", compression: nen ? "DEFLATE" : "STORE", platform: "UNIX" });
}

/** Liệt kê mọi tệp dưới một thư mục (tương đối, `/`). */
function cay(goc: string): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const m of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, m.name);
      if (m.isDirectory()) di(p);
      else ra.push(path.relative(goc, p).split(path.sep).join("/"));
    }
  };
  di(goc);
  return ra.sort();
}

describe("§1 — CHIỀU DƯƠNG: ZIP sạch giải đúng, giữ cây thư mục, bỏ qua đúng thứ phải bỏ", () => {
  it("★★★ tệp mã + ảnh vào đúng chỗ, byte khớp; .exe/.env/.git/node_modules bị BỎ QUA và được liệt kê", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    const buf = await dungZip([
      { ten: "src/index.ts", noiDung: "export const a = 1;\n" },
      { ten: "README.md", noiDung: "# x" },
      { ten: "public/logo.png", noiDung: png },
      { ten: "tools/cai.exe", noiDung: "MZ" },
      { ten: ".env", noiDung: "SECRET=1" },
      { ten: ".git/hooks/post-commit", noiDung: "#!/bin/sh\necho pwn" },
      { ten: "node_modules/x/index.js", noiDung: "x" },
    ]);
    const kq = await giaiNenZipAnToan(buf, DICH);
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(cay(DICH)).toEqual(["README.md", "public/logo.png", "src/index.ts"]);
    expect(fs.readFileSync(path.join(DICH, "src/index.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(fs.readFileSync(path.join(DICH, "public/logo.png")).equals(png)).toBe(true);
    expect(kq.boQua.sort()).toEqual([".env", ".git/hooks/post-commit", "node_modules/x/index.js", "tools/cai.exe"]);
    expect(kq.soTep).toBe(3);
  });

  it("lyDoBoQua — tập trắng: mã/văn bản/tài nguyên nhận; tệp chạy được + bí mật bỏ", () => {
    for (const ok of ["a.ts", "b.py", "c.cs", "App.csproj", "Dockerfile", ".gitignore", "x/y.svg", "f.woff2", "yarn.lock"]) {
      expect(lyDoBoQua(ok), ok).toBeNull();
    }
    for (const bo of ["a.exe", "b.dll", "c.bat", "d.ps1", "e.msi", ".env.local", "k.pem", "id_rsa", "x.jar"]) {
      expect(lyDoBoQua(bo), bo).not.toBeNull();
    }
  });
});

describe("§2 — ZIP-SLIP: tên mục GỐC (`unsafeOriginalName`) bị phán, KHÔNG đọc tên JSZip đã làm sạch", () => {
  it("★★★ `../thoat.txt` ⇒ ZIP_DUONG_DAN_XAU, KHÔNG một byte nào được ghi (kể cả tệp sạch đi trước)", async () => {
    const buf = await dungZip([
      { ten: "sach.txt", noiDung: "ok" },
      { ten: "../thoat.txt", noiDung: "pwn" },
    ]);
    const kq = await giaiNenZipAnToan(buf, DICH);
    expect(kq).toMatchObject({ ok: false, ma: "ZIP_DUONG_DAN_XAU" });
    expect(fs.existsSync(path.join(GOC, "thoat.txt"))).toBe(false);
    expect(cay(DICH), "fail-closed CẢ tệp: không giải nén một phần").toEqual([]);
  });

  it("★★ phanQuyetTenMuc — tuyệt đối / ổ đĩa / UNC / `\\..\\` / luồng NTFS / ký tự điều khiển ⇒ null", () => {
    for (const xau of ["/etc/passwd", "C:/Windows/x.txt", "C:\\x.txt", "\\\\srv\\share\\x", "a/../../x", "a\\..\\..\\x", "a.txt:ads", "a\u0000b", ".."]) {
      expect(phanQuyetTenMuc(xau), JSON.stringify(xau)).toBeNull();
    }
    expect(phanQuyetTenMuc("a/./b\\c.ts")).toBe("a/b/c.ts");
  });

  it("★★ tên `C:/x` trong ZIP thật ⇒ từ chối", async () => {
    const buf = await dungZip([{ ten: "C:/x.txt", noiDung: "pwn" }]);
    expect(await giaiNenZipAnToan(buf, DICH)).toMatchObject({ ok: false, ma: "ZIP_DUONG_DAN_XAU" });
  });
});

describe("§3 — SYMLINK trong ZIP ⇒ từ chối cả tệp", () => {
  it("★★★ mục mang kiểu S_IFLNK (0o120777) ⇒ ZIP_SYMLINK, đích rỗng", async () => {
    const buf = await dungZip([
      { ten: "a.txt", noiDung: "ok" },
      { ten: "lien-ket", noiDung: "../../Windows", unix: 0o120777 },
    ]);
    expect(await giaiNenZipAnToan(buf, DICH)).toMatchObject({ ok: false, ma: "ZIP_SYMLINK" });
    expect(cay(DICH)).toEqual([]);
  });
});

/** Vá trường "uncompressed size" (cả header cục bộ lẫn thư mục trung tâm) của MỌI mục thành `n` — ZIP nói dối. */
function vaKichThuocKhai(buf: Buffer, n: number): Buffer {
  const b = Buffer.from(buf);
  for (let i = 0; i < b.length - 4; i++) {
    const sig = b.readUInt32LE(i);
    if (sig === 0x04034b50) b.writeUInt32LE(n, i + 22); // local file header
    else if (sig === 0x02014b50) b.writeUInt32LE(n, i + 24); // central directory header
  }
  return b;
}

describe("§4 — ZIP BOMB: trần đếm trên byte THẬT ra khỏi bộ giải nén", () => {
  it("★★★ kích thước KHAI = 10 byte nhưng giải ra 3 MiB ⇒ ZIP_TEP_QUA_LON (trần 1 MiB), không tệp nào ghi", async () => {
    const that = await dungZip([{ ten: "bom.txt", noiDung: Buffer.alloc(3 * 1024 * 1024, 0x41) }]);
    const noiDoi = vaKichThuocKhai(that, 10);
    const kq = await giaiNenZipAnToan(noiDoi, DICH, { byteMoiTep: 1024 * 1024 });
    expect(kq).toMatchObject({ ok: false, ma: "ZIP_TEP_QUA_LON" });
    expect(cay(DICH)).toEqual([]);
  });

  it("★★ tổng vượt trần ⇒ ZIP_QUA_LON", async () => {
    const buf = await dungZip([
      { ten: "a.txt", noiDung: Buffer.alloc(600 * 1024, 0x41) },
      { ten: "b.txt", noiDung: Buffer.alloc(600 * 1024, 0x42) },
    ]);
    expect(await giaiNenZipAnToan(buf, DICH, { byteGiaiNen: 1024 * 1024 })).toMatchObject({ ok: false, ma: "ZIP_QUA_LON" });
  });

  it("★★ tỉ lệ nén bất thường (5 MiB số 0 nén còn vài KB) ⇒ ZIP_TI_LE_NEN", async () => {
    const buf = await dungZip([{ ten: "khong.txt", noiDung: Buffer.alloc(5 * 1024 * 1024, 0) }]);
    expect(buf.length).toBeLessThan(50 * 1024);
    expect(await giaiNenZipAnToan(buf, DICH)).toMatchObject({ ok: false, ma: "ZIP_TI_LE_NEN" });
  });

  it("★ quá nhiều mục ⇒ ZIP_QUA_NHIEU_MUC (đếm cả mục bị bỏ qua)", async () => {
    const muc = Array.from({ length: 12 }, (_, i) => ({ ten: `x${i}.exe`, noiDung: "MZ" }));
    expect(await giaiNenZipAnToan(await dungZip(muc), DICH, { soMuc: 10 })).toMatchObject({ ok: false, ma: "ZIP_QUA_NHIEU_MUC" });
  });

  it("★ không phải ZIP ⇒ ZIP_HONG", async () => {
    expect(await giaiNenZipAnToan(Buffer.from("khong phai zip"), DICH)).toMatchObject({ ok: false, ma: "ZIP_HONG" });
  });
});
