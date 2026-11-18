/**
 * scripts/bundle-tai-dau/soSanhTaiDau.test.ts
 *
 * Test thuần cho soSanhTaiDau.mjs: dùng thư mục tạm tự dựng (index.html giả
 * + asset giả nội dung biết trước), xoá trong afterEach; KHÔNG đọc dist thật.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  phanTichIndex,
  boDamTen,
  doKichThuoc,
  soHaiBanChup,
  taoBanChup,
  inBangSoSanh,
  chayCLI,
} from "./soSanhTaiDau.mjs";

/* ─────────────────────────────────────────────────────────────────────────────
 * Helper: dựng thư mục tạm với index.html giả + asset giả
 * ─────────────────────────────────────────────────────────────────────────────
 */

let thuMucTam: string;

beforeEach(async () => {
  thuMucTam = await mkdtemp(join(tmpdir(), "bundle-tai-dau-"));
});

afterEach(async () => {
  if (thuMucTam) {
    await rm(thuMucTam, { recursive: true, force: true });
  }
});

/** Dựng index.html với các thẻ đã cho */
function dungIndexHtml(script: string[], preload: string[], style: string[]) {
  let html = "<!DOCTYPE html><html><head><meta charset='utf-8'>\n";
  for (const href of preload) {
    html += `<link rel="modulepreload" href="${href}">\n`;
  }
  for (const href of style) {
    html += `<link rel="stylesheet" href="${href}">\n`;
  }
  html += "</head><body>\n";
  for (const src of script) {
    html += `<script type="module" src="${src}"></script>\n`;
  }
  html += "</body></html>";
  return html;
}

/** Dựng asset giả với nội dung biết trước */
async function dungAsset(thuMuc: string, ten: string, noiDung: string) {
  await mkdir(dirname(join(thuMuc, ten)), { recursive: true });
  await writeFile(join(thuMuc, ten), noiDung);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 10. TEST PHÂN TÍCH — ba loại thẻ hợp lệ + ba loại bị bỏ qua
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("phanTichIndex — thẻ hợp lệ", () => {
  it("script type=module có src", () => {
    const html = '<script type="module" src="/assets/app-xYz12345.js"></script>';
    expect(phanTichIndex(html)).toEqual(["/assets/app-xYz12345.js"]);
  });

  it("link rel=modulepreload", () => {
    const html = '<link rel="modulepreload" href="/assets/vendor-aBcDeFgH.js">';
    expect(phanTichIndex(html)).toEqual(["/assets/vendor-aBcDeFgH.js"]);
  });

  it("link rel=stylesheet trỏ /assets/", () => {
    const html = '<link rel="stylesheet" href="/assets/style-qR5tUvWx.css">';
    expect(phanTichIndex(html)).toEqual(["/assets/style-qR5tUvWx.css"]);
  });

  it("nhiều thẻ cùng lúc", () => {
    const html = dungIndexHtml(
      ["/assets/app-abc12345.js", "/assets/main-def67890.js"],
      ["/assets/chunk-ghi11111.js"],
      ["/assets/style-jkl22222.css"],
    );
    const ketQua = phanTichIndex(html);
    expect(ketQua).toContain("/assets/app-abc12345.js");
    expect(ketQua).toContain("/assets/main-def67890.js");
    expect(ketQua).toContain("/assets/chunk-ghi11111.js");
    expect(ketQua).toContain("/assets/style-jkl22222.css");
    expect(ketQua.length).toBe(4);
  });
});

describe("phanTichIndex — thẻ bị bỏ qua", () => {
  it("script inline (không có src)", () => {
    const html = '<script type="module">console.log("hello")</script>';
    expect(phanTichIndex(html)).toEqual([]);
  });

  it("script không module (không có type=module)", () => {
    const html = '<script src="/assets/old.js"></script>';
    expect(phanTichIndex(html)).toEqual([]);
  });

  it("stylesheet trỏ ngoài /assets/", () => {
    const html = '<link rel="stylesheet" href="https://cdn.example.com/font.css">';
    expect(phanTichIndex(html)).toEqual([]);
  });

  it("stylesheet trỏ ngoài /assets/ (tương đối)", () => {
    const html = '<link rel="stylesheet" href="../other/style.css">';
    expect(phanTichIndex(html)).toEqual([]);
  });

  it("link rel=preload (không phải modulepreload)", () => {
    const html = '<link rel="preload" href="/assets/font.woff2">';
    expect(phanTichIndex(html)).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. TEST BỎ HASH TÊN
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("boDamTen", () => {
  it("bỏ hash 8 ký tự cuối: index-rGrdkIQr.js → index.js", () => {
    expect(boDamTen("index-rGrdkIQr.js")).toBe("index.js");
  });

  it("giữ nhiều gạch nối: app-v1-abc12345.js → app-v1.js", () => {
    expect(boDamTen("app-v1-abc12345.js")).toBe("app-v1.js");
  });

  it("không có hash: app.js → app.js", () => {
    expect(boDamTen("app.js")).toBe("app.js");
  });

  it("hash chứa chữ hoa, chữ thường, số: vendor-aB3dEf7g.js → vendor.js", () => {
    expect(boDamTen("vendor-aB3dEf7g.js")).toBe("vendor.js");
  });

  it("tệp không có đuôi: README → README", () => {
    expect(boDamTen("README")).toBe("README");
  });

  it("hash chứa ký tự _ và -: chunk_X-1_abc12345.js → giữ nguyên (không có - trước hash 8 ký tự)", () => {
    // Regex chỉ nhận "-" trước hash 8 ký tự, không nhận "_" → giữ nguyên
    expect(boDamTen("chunk_X-1_abc12345.js")).toBe("chunk_X-1_abc12345.js");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 11. TEST ĐO KÍCH THƯỚC — byte thô/gzip đúng với nội dung đã biết
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("doKichThuoc", () => {
  it("đo byte thô và byte gzip đúng với nội dung biết trước", async () => {
    const noiDung = "Xin chao the gioi!"; // 18 byte
    await dungAsset(thuMucTam, "test.txt", noiDung);

    const ketQua = await doKichThuoc(thuMucTam, ["test.txt"]);

    expect(ketQua.danhSach).toHaveLength(1);
    expect(ketQua.danhSach[0].ten).toBe("test.txt");
    expect(ketQua.danhSach[0].byteRo).toBe(18);
    expect(ketQua.danhSach[0].byteGzip).toBeGreaterThan(0);
    expect(ketQua.tongRo).toBe(18);
    expect(ketQua.tongGzip).toBe(ketQua.danhSach[0].byteGzip);
  });

  it("nhiều tệp: tổng byteRo và byteGzip đúng", async () => {
    await dungAsset(thuMucTam, "a.txt", "AAA");
    await dungAsset(thuMucTam, "b.txt", "BBBB");

    const ketQua = await doKichThuoc(thuMucTam, ["a.txt", "b.txt"]);

    expect(ketQua.danhSach).toHaveLength(2);
    expect(ketQua.tongRo).toBe(3 + 4); // 7 byte
    expect(ketQua.tongGzip).toBe(ketQua.danhSach[0].byteGzip + ketQua.danhSach[1].byteGzip);
  });

  it("tệp có tên bắt đầu bằng /: /assets/app.js → đọc đúng trong assets/", async () => {
    await dungAsset(thuMucTam, "assets/app.js", "content");
    const ketQua = await doKichThuoc(thuMucTam, ["/assets/app.js"]);
    expect(ketQua.danhSach).toHaveLength(1);
    expect(ketQua.danhSach[0].byteRo).toBe(7);
  });

  it("từ chối đường ra ngoài thư mục", async () => {
    await dungAsset(thuMucTam, "safe.txt", "ok");
    await expect(doKichThuoc(thuMucTam, ["../outside.txt"])).rejects.toThrow("nằm ngoài thư mục gốc");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 11. TEST SO HAI BẢN CHỤP — mới, mất, tăng, giảm, tổng, ngưỡng
 * ─────────────────────────────────────────────────────────────────────────────
 */

function lapBanChup(danhSach: Array<{ ten: string; tenGoc: string; byteRo: number; byteGzip: number }>) {
  const tongRo = danhSach.reduce((s, f) => s + f.byteRo, 0);
  const tongGzip = danhSach.reduce((s, f) => s + f.byteGzip, 0);
  return { thoiDiem: "2026-01-01T00:00:00.000Z", danhSach, tongRo, tongGzip };
}

describe("soHaiBanChup", () => {
  it("tệp mới xuất hiện", () => {
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 20 }]);
    const sau = lapBanChup([
      { ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 20 },
      { ten: "b.js", tenGoc: "b.js", byteRo: 15, byteGzip: 25 },
    ]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tepMoi).toHaveLength(1);
    expect(ketQua.tepMoi[0].tenGoc).toBe("b.js");
  });

  it("tệp mất đi", () => {
    const truoc = lapBanChup([
      { ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 20 },
      { ten: "b.js", tenGoc: "b.js", byteRo: 15, byteGzip: 25 },
    ]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 20 }]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tepMat).toHaveLength(1);
    expect(ketQua.tepMat[0].tenGoc).toBe("b.js");
  });

  it("tệp lớn lên (byteGzip tăng)", () => {
    const truoc = lapBanChup([{ ten: "app.js", tenGoc: "app.js", byteRo: 100, byteGzip: 1000 }]);
    const sau = lapBanChup([{ ten: "app-abc12345.js", tenGoc: "app.js", byteRo: 120, byteGzip: 1500 }]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tepTang).toHaveLength(1);
    expect(ketQua.tepTang[0].tenGoc).toBe("app.js");
    expect(ketQua.tepTang[0].byteGzipTruoc).toBe(1000);
    expect(ketQua.tepTang[0].byteGzipSau).toBe(1500);
    expect(ketQua.tepTang[0].chenhLechGzip).toBe(500);
  });

  it("tệp nhỏ đi (byteGzip giảm)", () => {
    const truoc = lapBanChup([{ ten: "app.js", tenGoc: "app.js", byteRo: 100, byteGzip: 1500 }]);
    const sau = lapBanChup([{ ten: "app-abc12345.js", tenGoc: "app.js", byteRo: 80, byteGzip: 1000 }]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tepGiam).toHaveLength(1);
    expect(ketQua.tepGiam[0].tenGoc).toBe("app.js");
    expect(ketQua.tepGiam[0].chenhLechGzip).toBe(-500);
  });

  it("tổng trước/sau và chênh lệch đúng", () => {
    const truoc = lapBanChup([
      { ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 },
      { ten: "b.js", tenGoc: "b.js", byteRo: 20, byteGzip: 200 },
    ]);
    const sau = lapBanChup([
      { ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 150 },
      { ten: "c.js", tenGoc: "c.js", byteRo: 30, byteGzip: 300 },
    ]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tongTruoc).toBe(300);
    expect(ketQua.tongSau).toBe(450);
    expect(ketQua.tongChenhLech).toBe(150);
  });

  it("ngưỡng: đúng bằng ngưỡng thì KHÔNG đánh dấu", () => {
    const nguongKb = 50;
    const nguongB = nguongKb * 1024; // 51200
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 + nguongB }]);
    const ketQua = soHaiBanChup(truoc, sau, nguongKb);
    expect(ketQua.tepTang).toHaveLength(1);
    expect(ketQua.tepTang[0].chenhLechGzip).toBe(nguongB);
    expect(ketQua.tepTang[0].vuotNguong).toBe(false); // đúng bằng → không đánh dấu
  });

  it("ngưỡng: lớn hơn ngưỡng thì đánh dấu", () => {
    const nguongKb = 50;
    const nguongB = nguongKb * 1024; // 51200
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 + nguongB + 1 }]);
    const ketQua = soHaiBanChup(truoc, sau, nguongKb);
    expect(ketQua.tepTang).toHaveLength(1);
    expect(ketQua.tepTang[0].vuotNguong).toBe(true);
  });

  it("ngưỡng: nhỏ hơn ngưỡng thì không đánh dấu", () => {
    const nguongKb = 50;
    const nguongB = nguongKb * 1024;
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 + Math.floor(nguongB / 2) }]);
    const ketQua = soHaiBanChup(truoc, sau, nguongKb);
    expect(ketQua.tepTang).toHaveLength(1);
    expect(ketQua.tepTang[0].vuotNguong).toBe(false);
  });

  it("so theo tên gốc: hai tên khác nhau nhưng cùng tên gốc → so sánh", () => {
    const truoc = lapBanChup([{ ten: "app-oldHash.js", tenGoc: "app.js", byteRo: 100, byteGzip: 1000 }]);
    const sau = lapBanChup([{ ten: "app-newHash.js", tenGoc: "app.js", byteRo: 120, byteGzip: 1200 }]);
    const ketQua = soHaiBanChup(truoc, sau);
    expect(ketQua.tepTang).toHaveLength(1);
    expect(ketQua.tepTang[0].tenGoc).toBe("app.js");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 11. TEST TẠO BẢN CHỤP
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("taoBanChup", () => {
  it("đóng gói đúng cấu trúc JSON", async () => {
    const html = dungIndexHtml(["/assets/app-abc12345.js"], ["/assets/chunk-def67890.js"], []);
    await writeFile(join(thuMucTam, "index.html"), html);
    await dungAsset(thuMucTam, "assets/app-abc12345.js", "app content");
    await dungAsset(thuMucTam, "assets/chunk-def67890.js", "chunk content");

    const banChup = await taoBanChup(thuMucTam);

    expect(banChup.thoiDiem).toBeDefined();
    expect(typeof banChup.thoiDiem).toBe("string");
    expect(banChup.danhSach).toHaveLength(2);
    expect(banChup.danhSach.map((f) => f.ten)).toContain("/assets/app-abc12345.js");
    expect(banChup.danhSach.map((f) => f.ten)).toContain("/assets/chunk-def67890.js");
    expect(banChup.tongRo).toBeGreaterThan(0);
    expect(banChup.tongGzip).toBeGreaterThan(0);
    // Kiểm tra từng tệp có đủ trường
    for (const f of banChup.danhSach) {
      expect(f.ten).toBeDefined();
      expect(f.tenGoc).toBeDefined();
      expect(f.byteRo).toBeDefined();
      expect(f.byteGzip).toBeDefined();
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 12. TEST CLI — gọi thẳng hàm CLI với writer giả
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("chayCLI", () => {
  it("không có lệnh → trả 1", async () => {
    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);
    const ketQua = await chayCLI([], writer);
    expect(ketQua).toBe(1);
  });

  it("lệnh không biết → trả 1", async () => {
    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);
    const ketQua = await chayCLI(["xau"], writer);
    expect(ketQua).toBe(1);
  });

  it("chup: ghi JSON ra tệp và trả mã thoát 0", async () => {
    const html = dungIndexHtml(["/assets/app-abc12345.js"], [], []);
    await writeFile(join(thuMucTam, "index.html"), html);
    await dungAsset(thuMucTam, "assets/app-abc12345.js", "app content");

    const tepJson = join(thuMucTam, "snapshot.json");
    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);

    const ketQua = await chayCLI(["chup", thuMucTam, tepJson], writer);
    expect(ketQua).toBe(0);

    // Kiểm tra tệp JSON được ghi
    const { readFile } = await import("node:fs/promises");
    const jsonContent = await readFile(tepJson, "utf8");
    const parsed = JSON.parse(jsonContent);
    expect(parsed.thoiDiem).toBeDefined();
    expect(parsed.danhSach).toHaveLength(1);
    expect(parsed.tongRo).toBeGreaterThan(0);
  });

  it("so: không vượt ngưỡng → trả 0", async () => {
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);

    const tepTruoc = join(thuMucTam, "truoc.json");
    const tepSau = join(thuMucTam, "sau.json");
    await writeFile(tepTruoc, JSON.stringify(truoc));
    await writeFile(tepSau, JSON.stringify(sau));

    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);

    const ketQua = await chayCLI(["so", tepTruoc, tepSau], writer);
    expect(ketQua).toBe(0);
    // Kiểm tra bảng có dòng tổng
    const output = logs.join("\n");
    expect(output).toContain("TỔNG");
    expect(output).toContain("Trước:");
    expect(output).toContain("Sau:");
  });

  it("so: có tệp vượt ngưỡng → trả 2", async () => {
    const nguongKb = 50;
    const nguongB = nguongKb * 1024;
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 + nguongB + 1 }]);

    const tepTruoc = join(thuMucTam, "truoc.json");
    const tepSau = join(thuMucTam, "sau.json");
    await writeFile(tepTruoc, JSON.stringify(truoc));
    await writeFile(tepSau, JSON.stringify(sau));

    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);

    const ketQua = await chayCLI(["so", tepTruoc, tepSau], writer);
    expect(ketQua).toBe(2);
    const output = logs.join("\n");
    expect(output).toContain("VƯỢT NGƯỠNG");
  });

  it("so: --nguong-kb N đổi ngưỡng", async () => {
    // Chênh lệch 1000 byte, ngưỡng mặc định 50 kB → không vượt
    // Nhưng nếu đặt --nguong-kb 0 → vượt
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 1100 }]);

    const tepTruoc = join(thuMucTam, "truoc.json");
    const tepSau = join(thuMucTam, "sau.json");
    await writeFile(tepTruoc, JSON.stringify(truoc));
    await writeFile(tepSau, JSON.stringify(sau));

    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);

    // Với --nguong-kb 0, chênh lệch 1000 B > 0 → vượt
    const ketQua = await chayCLI(["so", tepTruoc, tepSau, "--nguong-kb", "0"], writer);
    expect(ketQua).toBe(2);
  });

  it("so: --nguong-kb sai định dạng → trả 1", async () => {
    const truoc = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);
    const sau = lapBanChup([{ ten: "a.js", tenGoc: "a.js", byteRo: 10, byteGzip: 100 }]);

    const tepTruoc = join(thuMucTam, "truoc.json");
    const tepSau = join(thuMucTam, "sau.json");
    await writeFile(tepTruoc, JSON.stringify(truoc));
    await writeFile(tepSau, JSON.stringify(sau));

    const logs: string[] = [];
    const writer = (msg: string) => logs.push(msg);

    const ketQua = await chayCLI(["so", tepTruoc, tepSau, "--nguong-kb", "abc"], writer);
    expect(ketQua).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 12. TEST ENTRY POINT — spawn chạy tệp như lệnh
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("entry point", () => {
  it("import.meta.url === pathToFileURL(process.argv[1]).href → entry chạy", async () => {
    // Test rằng guard entry hoạt động: khi gọi trực tiếp, process.exit được gọi
    // Ta kiểm tra bằng cách spawn node và xem output
    const { spawn } = await import("node:child_process");
    const { readFile } = await import("node:fs/promises");

    const html = dungIndexHtml(["/assets/app-abc12345.js"], [], []);
    await writeFile(join(thuMucTam, "index.html"), html);
    await dungAsset(thuMucTam, "assets/app-abc12345.js", "app content");

    const tepJson = join(thuMucTam, "entry-snapshot.json");

    const promise = new Promise<{ stdout: string; code: number }>((resolve) => {
      const proc = spawn(
        process.execPath,
        [join(import.meta.dirname, "soSanhTaiDau.mjs"), "chup", thuMucTam, tepJson],
        { cwd: import.meta.dirname },
      );
      const stdout: string[] = [];
      const stderr: string[] = [];
      proc.stdout.on("data", (d: Buffer) => stdout.push(d.toString()));
      proc.stderr.on("data", (d: Buffer) => stderr.push(d.toString()));
      proc.on("close", (code) => resolve({ stdout: stdout.join(""), code: code ?? 1 }));
    });

    const { stdout, code } = await promise;
    expect(code).toBe(0);
    expect(stdout).toContain("Ghi bản chụp");
    expect(stdout).toContain("thoiDiem");

    // Kiểm tra tệp JSON được ghi
    const jsonContent = await readFile(tepJson, "utf8");
    const parsed = JSON.parse(jsonContent);
    expect(parsed.danhSach).toHaveLength(1);
  });
});
