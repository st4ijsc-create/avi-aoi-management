import { describe, expect, it } from "vitest";
import {
  TOI_DA_ANH,
  TOI_DA_TEP,
  TRAN_ANH_BYTE,
  TRAN_TONG_ANH_BYTE,
  TRAN_CANH_DAI_ANH,
  boAnh,
  ghiChuAnhLuotTruoc,
  kichThuocAnh,
  TRAN_TEP_BYTE,
  anhChoKb,
  coAnh,
  dungKhoiTepNgoai,
  kiemTraDinhKemNgoai,
  kieuAnhTheoChuKy,
  laTenNhayCam,
  lamSachTen,
} from "./dinhKemNgoai";

// PNG 1x1 thật (chữ ký + IHDR…) — đủ để chữ ký byte khớp
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
const WEBP_B64 = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBP")]).toString("base64");

const anh = (ten: string, noiDung = PNG_B64) => ({ loai: "anh", ten, kieu: "image/png", noiDung });
const tep = (ten: string, noiDung = "xin chào") => ({ loai: "tep", ten, kieu: "text/plain", noiDung });

describe("kiemTraDinhKemNgoai — ảnh", () => {
  it("★ ảnh PNG/JPEG/WEBP thật ⇒ nhận; kiểu LẤY TỪ CHỮ KÝ BYTE, kích thước do host tính lại", () => {
    const r = kiemTraDinhKemNgoai([anh("a.png"), { ...anh("b.jpg", JPG_B64), kieu: "image/png" }, anh("c.webp", WEBP_B64)]);
    expect(r.tuChoi).toEqual([]);
    expect(r.ds.map((d) => [d.ten, d.kieu])).toEqual([["a.png", "image/png"], ["b.jpg", "image/jpeg"], ["c.webp", "image/webp"]]);
    expect(r.ds[0]!.kichThuoc).toBe(Buffer.from(PNG_B64, "base64").length);
  });
  it("★★ ảnh GIẢ (đuôi/kiểu khai là ảnh nhưng byte là chữ thường) ⇒ từ chối", () => {
    const r = kiemTraDinhKemNgoai([anh("giả.png", Buffer.from("đây là văn bản").toString("base64"))]);
    expect(r.ds).toEqual([]);
    expect(r.tuChoi[0]).toMatch(/không phải ảnh PNG\/JPEG\/WEBP/);
  });
  it("★ ảnh quá trần 6 MB ⇒ từ chối (kể cả khi khai kichThuoc nhỏ — host tính lại)", () => {
    const lon = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.alloc(TRAN_ANH_BYTE)]).toString("base64");
    const r = kiemTraDinhKemNgoai([{ ...anh("to.png", lon), kichThuoc: 10 }]);
    expect(r.ds).toEqual([]);
    expect(r.tuChoi[0]).toMatch(/quá lớn/);
  });
  it("★ quá TOI_DA_ANH ảnh ⇒ nhận đúng 4, báo phần dư", () => {
    const r = kiemTraDinhKemNgoai(Array.from({ length: TOI_DA_ANH + 2 }, (_, i) => anh(`a${i}.png`)));
    expect(r.ds).toHaveLength(TOI_DA_ANH);
    expect(r.tuChoi).toHaveLength(2);
  });
  it("★★ TỔNG ảnh một lượt vượt 12 MB ⇒ nhận phần còn trong trần, báo phần dư (khớp 413 ANH_QUA_LON của /v1)", () => {
    const to = (ten: string) => anh(ten, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.alloc(5.5 * 1024 * 1024)]).toString("base64"));
    const r = kiemTraDinhKemNgoai([to("a.png"), to("b.png"), to("c.png")]);
    expect(r.ds.map((d) => d.ten)).toEqual(["a.png", "b.png"]);
    expect(r.tuChoi).toHaveLength(1);
    expect(r.tuChoi[0]).toMatch(/tổng dung lượng ảnh vượt 12\.0 MB/);
    expect(TRAN_TONG_ANH_BYTE).toBe(12 * 1024 * 1024);
  });
  it("boAnh: bỏ MỌI ảnh, giữ tệp văn bản, đếm số ảnh bỏ", () => {
    const r = kiemTraDinhKemNgoai([anh("a.png"), tep("l.log"), anh("b.png")]);
    const b = boAnh(r.ds);
    expect(b.soAnhBo).toBe(2);
    expect(b.ds.map((d) => d.ten)).toEqual(["l.log"]);
  });
  it("base64 sai ⇒ từ chối", () => {
    expect(kiemTraDinhKemNgoai([anh("x.png", "***không phải base64***")]).tuChoi[0]).toMatch(/base64 sai/);
  });
});

describe("kiemTraDinhKemNgoai — tệp văn bản", () => {
  it("★ tệp văn bản hợp lệ ⇒ nhận, kích thước tính theo BYTE UTF-8 (không theo số ký tự)", () => {
    const r = kiemTraDinhKemNgoai([tep("ghi-chu.txt", "Việt Nam")]);
    expect(r.ds[0]!.kichThuoc).toBe(Buffer.byteLength("Việt Nam", "utf8"));
  });
  it("★ quá 200 KB ⇒ từ chối; đúng trần ⇒ nhận", () => {
    expect(kiemTraDinhKemNgoai([tep("lon.log", "a".repeat(TRAN_TEP_BYTE + 1))]).tuChoi[0]).toMatch(/quá lớn/);
    expect(kiemTraDinhKemNgoai([tep("vua.log", "a".repeat(TRAN_TEP_BYTE))]).ds).toHaveLength(1);
  });
  it("★ tệp nhị phân (có byte NUL) ⇒ từ chối", () => {
    expect(kiemTraDinhKemNgoai([tep("x.bin", "ab\u0000cd")]).tuChoi[0]).toMatch(/nhị phân/);
  });
  it("★ quá TOI_DA_TEP tệp ⇒ nhận đúng 5", () => {
    const r = kiemTraDinhKemNgoai(Array.from({ length: TOI_DA_TEP + 1 }, (_, i) => tep(`t${i}.txt`)));
    expect(r.ds).toHaveLength(TOI_DA_TEP);
    expect(r.tuChoi).toHaveLength(1);
  });
});

describe("tên nhạy cảm — bị từ chối dù người dùng chủ động đưa vào", () => {
  it.each([".env", ".env.local", "id_rsa", "id_ed25519.pub", "khoa.pem", "server.key", "cert.pfx", "vault.kdbx", "credentials.json", "secrets.yaml", ".npmrc", "api-token.json", "DB_PASSWORD.txt"])(
    "%s ⇒ nhạy cảm",
    (ten) => {
      expect(laTenNhayCam(ten)).toBe(true);
      expect(kiemTraDinhKemNgoai([tep(ten)]).ds).toEqual([]);
      expect(kiemTraDinhKemNgoai([tep(ten)]).tuChoi[0]).toMatch(/nhạy cảm/);
    },
  );
  it.each(["README.md", "log.txt", "bao-cao.csv", "environment.md", "keyboard.txt", "mo-ta-token-nguoi-dung.md"])("%s ⇒ KHÔNG bị chặn nhầm", (ten) => {
    expect(laTenNhayCam(ten)).toBe(false);
  });
  it("tên có đường dẫn: chỉ xét tên cuối (khoá nằm trong thư mục .ssh vẫn bị bắt)", () => {
    expect(laTenNhayCam("C:\\Users\\a\\.ssh\\id_rsa")).toBe(true);
    expect(lamSachTen("C:\\x\\y\\bao-cao.txt")).toBe("bao-cao.txt");
    expect(lamSachTen("a\u0000b\u001f.txt")).toBe("ab.txt");
    expect(lamSachTen("")).toBe("tep-khong-ten");
    expect(lamSachTen("x".repeat(200))).toHaveLength(80);
  });
});

describe("hình dạng đầu vào lạ — không bao giờ ném", () => {
  it.each([undefined, null, 5, "x", {}, [null], [{}], [{ loai: "anh" }], [{ loai: "khac", noiDung: "x" }], [{ loai: "tep", noiDung: 5 }]])("%j", (raw) => {
    expect(() => kiemTraDinhKemNgoai(raw)).not.toThrow();
    expect(kiemTraDinhKemNgoai(raw).ds).toEqual([]);
  });
});

describe("dungKhoiTepNgoai / anhChoKb / kieuAnhTheoChuKy", () => {
  it("khối tệp mang nhãn NGUỒN 'không thuộc workspace'; rỗng khi chỉ có ảnh", () => {
    const { ds } = kiemTraDinhKemNgoai([tep("a.txt", "NỘI DUNG A"), anh("x.png")]);
    const k = dungKhoiTepNgoai(ds);
    expect(k).toContain("KHÔNG thuộc workspace");
    expect(k).toContain("NỘI DUNG A");
    expect(dungKhoiTepNgoai(kiemTraDinhKemNgoai([anh("x.png")]).ds)).toBe("");
  });
  it("đường KB nhận ĐÚNG một ảnh (ảnh đầu) dạng data URL + mime; báo số ảnh phải bỏ", () => {
    const { ds } = kiemTraDinhKemNgoai([anh("1.png"), anh("2.jpg", JPG_B64)]);
    const r = anhChoKb(ds);
    expect(r.image).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(r.imageMimeType).toBe("image/png");
    expect(r.boQua).toBe(1);
    expect(anhChoKb([])).toEqual({ boQua: 0 });
    expect(coAnh(ds)).toBe(true);
  });
  it("chữ ký byte", () => {
    expect(kieuAnhTheoChuKy(Buffer.from(PNG_B64, "base64"))).toBe("image/png");
    expect(kieuAnhTheoChuKy(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("kích thước ảnh từ tiêu đề + trần cạnh dài (0.3.2)", () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    const b = Buffer.alloc(30);
    b[0] = 0xff; b[1] = 0xd8;
    b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(4, 4); // APP0 rỗng (len 4)
    b[8] = 0xff; b[9] = 0xc0; b.writeUInt16BE(11, 10); b[12] = 8;
    b.writeUInt16BE(h, 13);
    b.writeUInt16BE(w, 15);
    return b;
  };
  const webpX = (w: number, h: number) => {
    const b = Buffer.alloc(32);
    b.write("RIFF", 0, "ascii"); b.write("WEBP", 8, "ascii"); b.write("VP8X", 12, "ascii");
    b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
    return b;
  };
  const webpL = (w: number, h: number) => {
    const b = Buffer.alloc(32);
    b.write("RIFF", 0, "ascii"); b.write("WEBP", 8, "ascii"); b.write("VP8L", 12, "ascii");
    b[20] = 0x2f;
    b.writeUInt32LE((w - 1) | ((h - 1) << 14), 21);
    return b;
  };
  const webpLossy = (w: number, h: number) => {
    const b = Buffer.alloc(32);
    b.write("RIFF", 0, "ascii"); b.write("WEBP", 8, "ascii"); b.write("VP8 ", 12, "ascii");
    b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28);
    return b;
  };

  it("★★ đọc đúng PNG / JPEG / WEBP (VP8X, VP8L, VP8); ảnh lạ ⇒ null", () => {
    expect(kichThuocAnh(png(1920, 1080))).toEqual({ rong: 1920, cao: 1080 });
    expect(kichThuocAnh(jpeg(4000, 3000))).toEqual({ rong: 4000, cao: 3000 });
    expect(kichThuocAnh(webpX(2500, 1200))).toEqual({ rong: 2500, cao: 1200 });
    expect(kichThuocAnh(webpL(800, 600))).toEqual({ rong: 800, cao: 600 });
    expect(kichThuocAnh(webpLossy(640, 480))).toEqual({ rong: 640, cao: 480 });
    expect(kichThuocAnh(Buffer.from("không phải ảnh"))).toBeNull();
  });

  it("★★★ cạnh dài > 2048 ⇒ host TỪ CHỐI (không tin webview), ≤ 2048 ⇒ nhận; biên đúng 2048 nhận, 2049 từ chối", () => {
    const b64 = (b: Buffer) => b.toString("base64");
    const r = kiemTraDinhKemNgoai([
      anh("lon.png", b64(png(4000, 3000))),
      anh("vua.png", b64(png(2048, 1000))),
      anh("sat.png", b64(png(2049, 100))),
      anh("doc.jpg", b64(jpeg(900, 5000))),
      anh("nho.jpg", b64(jpeg(1600, 900))),
    ]);
    expect(r.ds.map((d) => d.ten)).toEqual(["vua.png", "nho.jpg"]);
    expect(r.tuChoi).toHaveLength(3);
    expect(r.tuChoi[0]).toMatch(/4000×3000 px vượt 2048 px/);
    expect(TRAN_CANH_DAI_ANH).toBe(2048);
  });

  it("ghi chú thay ảnh ở lượt cũ nêu tên từng ảnh; không ảnh ⇒ rỗng", () => {
    expect(ghiChuAnhLuotTruoc([{ ten: "a.png" }, { ten: "b.jpg" }])).toBe("\n[ảnh đã gửi ở lượt trước: a.png, b.jpg]");
    expect(ghiChuAnhLuotTruoc([])).toBe("");
  });
});
