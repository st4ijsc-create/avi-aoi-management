// scripts/bundle-tai-dau/soSanhTaiDau.mjs
// ═══════════════════════════════════════════════════════════════════════════════
// Đo "bundle tải đầu" của client build (vite, thư mục dist/public):
//   1. Phân tích index.html → danh sách tệp tải đầu
//   2. Đo kích thước mỗi tệp (raw + gzip)
//   3. So hai bản chụp: mới, mất, tăng, giảm, tổng
//   4. CLI: `chup` ghi JSON, `so` in bảng
// ═══════════════════════════════════════════════════════════════════════════════

import { createGzip } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. PHÂN TÍCH index.html — nhận chuỗi HTML, trả mảng tên tệp
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Phân tích index.html (thuần, nhận chuỗi): lấy mọi script type=module có src,
 * link rel=modulepreload, link rel=stylesheet trỏ /assets/; bỏ script inline,
 * script không module, tài nguyên ngoài /assets/.
 */
export function phanTichIndex(html) {
  const ketQua = [];

  // <script type="module" src="...">
  const regexScript = /<script\s+[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = regexScript.exec(html)) !== null) {
    ketQua.push(m[1]);
  }

  // <link rel="modulepreload" href="...">
  const regexPreload = /<link\s+[^>]*rel\s*=\s*["']modulepreload["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = regexPreload.exec(html)) !== null) {
    ketQua.push(m[1]);
  }

  // <link rel="stylesheet" href="/assets/...">
  const regexStyle = /<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = regexStyle.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith("/assets/")) {
      ketQua.push(href);
    }
  }

  return ketQua;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. BỎ HASH TÊN — chỉ bỏ đúng đoạn hash CUỐI trước đuôi tệp
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Bỏ hash ở cuối tên tệp: index-rGrdkIQr.js → index.js.
 * Giữ nguyên phần trước nếu có nhiều gạch nối (không phải hash).
 * Hash vite: 8 ký tự [a-zA-Z0-9_-] sau dấu gạch nối cuối.
 */
export function boDamTen(ten) {
  // Tách phần mở rộng (đuôi tệp)
  const dotIdx = ten.lastIndexOf(".");
  if (dotIdx === -1) return ten; // không có đuôi → giữ nguyên

  const tenGoc = ten.slice(0, dotIdx);
  const phanDuoi = ten.slice(dotIdx);

  // Hash của vite: 8 ký tự [a-zA-Z0-9_-] sau dấu gạch nối cuối
  const damRegex = /-([a-zA-Z0-9_-]{8})$/;
  const damMatch = tenGoc.match(damRegex);

  if (damMatch) {
    return tenGoc.slice(0, damMatch.index) + phanDuoi;
  }

  return ten;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. ĐO KÍCH THƯỚC — đọc tệp trong thư mục được truyền vào
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Đo kích thước: nhận thư mục gốc + danh sách tên tệp, đọc tệp TRONG thư mục
 * được truyền vào (không đọc gì ngoài), trả byte thô và byte gzip (node:zlib
 * mức mặc định) cho từng tệp và tổng của cả hai.
 */
export async function doKichThuoc(thuMucGoc, danhSachTen) {
  const ketQua = [];
  let tongRo = 0;
  let tongGzip = 0;

  for (const ten of danhSachTen) {
    // Bỏ dấu '/' ở đầu nếu có
    const tenSan = ten.startsWith("/") ? ten.slice(1) : ten;

    // Chỉ đọc tệp trong thư mục được truyền vào
    const duongDan = resolve(thuMucGoc, tenSan);

    // Từ chối đường ra ngoài thư mục: dùng path.relative
    const duongDoi = relative(thuMucGoc, duongDan);
    if (duongDoi.startsWith("..") || resolve(duongDoi) === duongDoi) {
      throw new Error(`Tệp '${ten}' nằm ngoài thư mục gốc`);
    }

    const raw = await readFile(duongDan);
    const rawBytes = raw.length;

    // Nén gzip với mức mặc định
    const gzipData = await new Promise((resolveGzip) => {
      const chunks = [];
      const stream = createGzip();
      stream.write(raw);
      stream.end();
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolveGzip(Buffer.concat(chunks)));
    });

    const gzipBytes = gzipData.length;

    tongRo += rawBytes;
    tongGzip += gzipBytes;

    ketQua.push({
      ten,
      tenGoc: boDamTen(ten),
      byteRo: rawBytes,
      byteGzip: gzipBytes,
    });
  }

  return {
    danhSach: ketQua,
    tongRo,
    tongGzip,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. SO HAI BẢN CHỤP — mới, mất, tăng, giảm, tổng
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * So hai bản chụp (thuần): tệp mới, tệp mất, tệp lớn lên, tệp nhỏ đi,
 * tổng trước/sau và chênh lệch; so theo tên gốc.
 * Ngưỡng: đánh dấu khi chênh lệch gzip LỚN HƠN ngưỡng (đúng bằng ngưỡng
 * thì KHÔNG đánh dấu); ngưỡng mặc định 50 kB.
 */
export function soHaiBanChup(banChupTruoc, banChupSau, nguongKb = 50) {
  const danhSachTruoc = new Map(banChupTruoc.danhSach.map((f) => [f.tenGoc, f]));
  const danhSachSau = new Map(banChupSau.danhSach.map((f) => [f.tenGoc, f]));

  const tepMoi = [];
  const tepMat = [];
  const tepTang = [];
  const tepGiam = [];

  // Tệp mới (có sau, không có trước)
  for (const [tenGoc, tep] of danhSachSau) {
    if (!danhSachTruoc.has(tenGoc)) {
      tepMoi.push(tep);
    }
  }

  // Tệp mất (có trước, không có sau)
  for (const [tenGoc, tep] of danhSachTruoc) {
    if (!danhSachSau.has(tenGoc)) {
      tepMat.push(tep);
    }
  }

  // Tệp có cả trước và sau → so sánh
  for (const [tenGoc, tepSau] of danhSachSau) {
    const tepTruoc = danhSachTruoc.get(tenGoc);
    if (!tepTruoc) continue;

    const chenhLechGzip = tepSau.byteGzip - tepTruoc.byteGzip;

    if (chenhLechGzip > 0) {
      tepTang.push({
        tenGoc,
        tenTruoc: tepTruoc.ten,
        tenSau: tepSau.ten,
        byteGzipTruoc: tepTruoc.byteGzip,
        byteGzipSau: tepSau.byteGzip,
        chenhLechGzip,
        vuotNguong: chenhLechGzip > nguongKb * 1024,
      });
    } else if (chenhLechGzip < 0) {
      tepGiam.push({
        tenGoc,
        tenTruoc: tepTruoc.ten,
        tenSau: tepSau.ten,
        byteGzipTruoc: tepTruoc.byteGzip,
        byteGzipSau: tepSau.byteGzip,
        chenhLechGzip,
      });
    }
  }

  const tongTruoc = banChupTruoc.tongGzip;
  const tongSau = banChupSau.tongGzip;
  const tongChenhLech = tongSau - tongTruoc;

  return {
    tepMoi,
    tepMat,
    tepTang,
    tepGiam,
    tongTruoc,
    tongSau,
    tongChenhLech,
    nguongKb,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. TẠO BẢN CHỤP — phân tích + đo + đóng gói JSON
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Tạo bản chụp: phân tích index.html, đo kích thước, đóng gói JSON.
 * Tên trường model tự đặt, tiếng Việt không dấu.
 */
export async function taoBanChup(thuMucGoc) {
  const indexHtml = await readFile(join(thuMucGoc, "index.html"), "utf8");
  const danhSachTen = phanTichIndex(indexHtml);
  const { danhSach, tongRo, tongGzip } = await doKichThuoc(thuMucGoc, danhSachTen);

  return {
    thoiDiem: new Date().toISOString(),
    danhSach,
    tongRo,
    tongGzip,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. IN BẢNG — văn bản thuần với đơn vị rõ
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * In bảng so sánh ra writer, trả mã thoát (0 = không vượt, 2 = có vượt).
 * Bảng có đơn vị rõ ở mọi số (B, kB gzip), gồm dòng tổng trước/sau.
 */
export function inBangSoSanh(ketQuaSo, writer) {
  let coVuot = false;

  // Tệp mới
  if (ketQuaSo.tepMoi.length > 0) {
    writer("\n── TỆP MỚI ──");
    for (const t of ketQuaSo.tepMoi) {
      writer(`  ${t.tenGoc}  (${t.byteGzip} B, ${(t.byteGzip / 1024).toFixed(2)} kB gzip)`);
    }
  }

  // Tệp mất
  if (ketQuaSo.tepMat.length > 0) {
    writer("\n── TỆP MẤT ──");
    for (const t of ketQuaSo.tepMat) {
      writer(`  ${t.tenGoc}  (${t.byteGzip} B, ${(t.byteGzip / 1024).toFixed(2)} kB gzip)`);
    }
  }

  // Tệp tăng
  if (ketQuaSo.tepTang.length > 0) {
    writer("\n── TỆP TĂNG ──");
    for (const t of ketQuaSo.tepTang) {
      const dau = t.chenhLechGzip > 0 ? "+" : "";
      const hieuChu = t.vuotNguong ? " ⚠ VƯỢT NGƯỠNG" : "";
      writer(
        `  ${t.tenGoc}  ${t.byteGzipTruoc} B (${(t.byteGzipTruoc / 1024).toFixed(2)} kB gzip) → ${t.byteGzipSau} B (${(t.byteGzipSau / 1024).toFixed(2)} kB gzip)  (${dau}${t.chenhLechGzip} B)${hieuChu}`,
      );
      if (t.vuotNguong) coVuot = true;
    }
  }

  // Tệp giảm
  if (ketQuaSo.tepGiam.length > 0) {
    writer("\n── TỆP GIẢM ──");
    for (const t of ketQuaSo.tepGiam) {
      writer(
        `  ${t.tenGoc}  ${t.byteGzipTruoc} B (${(t.byteGzipTruoc / 1024).toFixed(2)} kB gzip) → ${t.byteGzipSau} B (${(t.byteGzipSau / 1024).toFixed(2)} kB gzip)  (${t.chenhLechGzip} B)`,
      );
    }
  }

  // Tổng
  writer("\n── TỔNG ──");
  writer(`  Trước: ${ketQuaSo.tongTruoc} B (${(ketQuaSo.tongTruoc / 1024).toFixed(2)} kB gzip)`);
  writer(`  Sau:   ${ketQuaSo.tongSau} B (${(ketQuaSo.tongSau / 1024).toFixed(2)} kB gzip)`);
  const dau = ketQuaSo.tongChenhLech >= 0 ? "+" : "";
  writer(
    `  Chênh lệch: ${dau}${ketQuaSo.tongChenhLech} B (${dau}${(ketQuaSo.tongChenhLech / 1024).toFixed(2)} kB gzip)`,
  );
  writer(`  Ngưỡng: ${ketQuaSo.nguongKb} kB gzip`);

  if (coVuot) {
    writer("\n⚠ CÓ TỆP VƯỢT NGƯỠNG");
    return 2;
  }

  writer("\n✓ Không có tệp nào vượt ngưỡng");
  return 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 7. CLI — nhận argv và writer qua tham số, trả mã thoát
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Hàm CLI chính: nhận argv và writer qua tham số, trả mã thoát.
 * argv đã được cắt bỏ tên script (command ở argv[0]).
 */
export async function chayCLI(argv, writer) {
  if (argv.length < 1) {
    writer("Sử dụng: soSanhTaiDau.mjs chup <thư mục dist/public> <tệp json ra>\n");
    writer("         soSanhTaiDau.mjs so <json trước> <json sau> [--nguong-kb N]\n");
    return 1;
  }

  const cmd = argv[0];

  if (cmd === "chup") {
    if (argv.length < 3) {
      writer("Cú pháp: chup <thư mục dist/public> <tệp json ra>\n");
      return 1;
    }
    const thuMuc = argv[1];
    const tepRa = argv[2];
    const banChup = await taoBanChup(thuMuc);
    await writeFile(tepRa, JSON.stringify(banChup, null, 2), "utf8");
    writer(`Ghi bản chụp → ${tepRa}\n`);
    writer(JSON.stringify(banChup, null, 2));
    return 0;
  }

  if (cmd === "so") {
    if (argv.length < 3) {
      writer("Cú pháp: so <json trước> <json sau> [--nguong-kb N]\n");
      return 1;
    }
    const jsonTruoc = await readFile(argv[1], "utf8");
    const jsonSau = await readFile(argv[2], "utf8");
    const banChupTruoc = JSON.parse(jsonTruoc);
    const banChupSau = JSON.parse(jsonSau);

    // Parse --nguong-kb
    let nguongKb = 50; // mặc định 50 kB
    const nguongIdx = argv.indexOf("--nguong-kb");
    if (nguongIdx !== -1 && argv[nguongIdx + 1]) {
      const val = Number(argv[nguongIdx + 1]);
      if (isNaN(val)) {
        writer(`Lỗi: --nguong-kb phải là số, nhận '${argv[nguongIdx + 1]}'\n`);
        return 1;
      }
      nguongKb = val;
    }

    const ketQuaSo = soHaiBanChup(banChupTruoc, banChupSau, nguongKb);
    return inBangSoSanh(ketQuaSo, writer);
  }

  writer(`Lệnh không biết: ${cmd}\n`);
  return 1;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 8. ENTRY POINT — chỉ chạy khi tệp là entry
 * ─────────────────────────────────────────────────────────────────────────────
 */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ketQua = await chayCLI(process.argv.slice(2), console.log);
  if (typeof ketQua === "number") {
    process.exit(ketQua);
  }
}
