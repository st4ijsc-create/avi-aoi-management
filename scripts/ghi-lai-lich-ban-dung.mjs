#!/usr/bin/env node
/**
 * ghi-lai-lich-ban-dung.mjs — **GHI LAI LỊCH VÀO `dist/BUILD-INFO.txt`, TRONG CHÍNH BƯỚC DỰNG.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÀ MỘT BƯỚC CỦA BẢN DỰNG, KHÔNG PHẢI MỘT QUY ƯỚC
 * ════════════════════════════════════════════════════════════════════════════
 * Dự án này **đã mất lai lịch bản dựng HAI lần**, và cả hai lần đều đúng một kiểu: có quy ước
 * *"dựng xong thì ghi BUILD-INFO"*, không có **cơ chế ép**, nên nó rụng ngay lần dựng sau mà
 * không ai biết.
 *
 * Lần đầu (Đợt 55/PH-43): tệp còn đó nhưng **khai SAI commit** — tức tệ hơn không có, vì nó nói
 * dối một cách đáng tin. Lần hai (2026-09-17): dựng lại lúc 16:08 **không ghi** ⇒ mất lần nữa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LẦN BA (2026-09-21) — VÀ LẦN NÀY CHÍNH BẢN VÁ BỊ LÁCH
 * ════════════════════════════════════════════════════════════════════════════
 * Bước 0 của vòng 6 đo được:
 *   · `dist/BUILD-INFO.txt` khai `commit=8a3eb08fa`, `luc-dung=08:01`;
 *   · nhưng `dist/public/index.html` **đang được phục vụ** có mtime **08:42**, dựng từ một
 *     commit MUỘN HƠN (chunk `TwinVanHanh-*.js` chứa `demTheoNhieuNhaMay`, tức đã có M3).
 * ⇒ Tệp lai lịch **nói sai về chính thứ đang chạy** — đúng lớp PH-43 mà nó sinh ra để chặn.
 *
 * **Gốc**: bước này chỉ là mắt xích cuối của `npm run build`. Một lượt dựng **chỉ client**
 * (`vite build`, việc người ta làm mỗi khi sửa UI cho nhanh) không chạm tới nó.
 * ⇒ Nay nó **cũng chạy trong vite** (plugin `closeBundle`, xem `vite.config.ts`), nên đường
 *   dựng nào cũng ghi. Một hàng rào chỉ chặn được lối chính thì không phải hàng rào.
 *
 * ★ Và tệp ghi thêm **mtime của chính các artefact**: ai đọc cũng tự đối chiếu được `luc-dung`
 *   với thứ đang nằm trên đĩa, không phải tin lời tệp. Nếu mai này còn đường dựng nào lách
 *   được nữa, hai con số ấy sẽ lệch và **nói ra**, thay vì im lặng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHÔNG BAO GIỜ ĐƯỢC NÓI DỐI — THÀ KHAI "KHÔNG BIẾT"
 * ════════════════════════════════════════════════════════════════════════════
 * Bài học PH-43: một tệp lai lịch **khai sai** nguy hiểm hơn một tệp **vắng mặt**, vì người đọc
 * tin nó. Nên:
 *   · `git` không chạy được ⇒ ghi `commit=(khong doc duoc)`, **không** bịa;
 *   · cây làm việc BẨN ⇒ ghi `sach=false` kèm số tệp bẩn — bản dựng ấy **không** bằng commit;
 *   · mọi giá trị đều ghi **nguyên văn thứ đọc được**, không suy diễn.
 *
 * ⚠ Bước này **không được làm hỏng bản dựng**: mọi lỗi đều nuốt và vẫn ghi phần đọc được. Một
 *   bản dựng đổ vì không đọc nổi `git` là đổi một phiền toái lấy một sự cố.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DICH = path.join("dist", "BUILD-INFO.txt");

/** Artefact mà người đọc sẽ muốn đối chiếu — đường dẫn và tên hiển thị. */
const ARTEFACT = [
  ["client-index-html", path.join("dist", "public", "index.html")],
  ["server-index-js", path.join("dist", "index.js")],
];

/** Chạy `git …`; trả `null` khi không đọc được — KHÔNG bịa một giá trị thay thế. */
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** mtime ISO của một tệp, hoặc `null` nếu không có — dùng để ĐỐI CHIẾU với `luc-dung`. */
function mtime(p) {
  try {
    return fs.statSync(p).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Ghi `dist/BUILD-INFO.txt`. Gọi được từ CLI **và** từ trong vite.
 *
 * @param {string} [nguon] ai gọi — ghi vào tệp để biết bản dựng đi đường nào.
 */
export function ghiLaiLichBanDung(nguon = "cli") {
  const commit = git("rev-parse", "HEAD");
  const nhanh = git("rev-parse", "--abbrev-ref", "HEAD");
  const moTa = git("log", "-1", "--format=%s");
  const lucCommit = git("log", "-1", "--format=%cI");
  /*
   * ⚠ `--untracked-files=no`: **chỉ tệp ĐƯỢC THEO DÕI** mới đổi được bản dựng. Bản đầu đếm cả
   *   untracked và ra `sach=false` với **4.854** mục (uploads, test-results, thư mục đo) — tức
   *   một cảnh báo **LUÔN kêu**, và một cảnh báo luôn kêu thì không ai nghe. Số untracked vẫn
   *   được ghi, ở một dòng RIÊNG: nó là sự thật, chỉ không phải sự thật về lai lịch.
   */
  const banTheoDoi = git("status", "--porcelain", "--untracked-files=no");
  const soBan =
    banTheoDoi === null ? null : banTheoDoi.split("\n").filter((l) => l.trim().length > 0).length;
  const banTatCa = git("status", "--porcelain");
  const soNgoaiSo =
    banTatCa === null
      ? null
      : banTatCa.split("\n").filter((l) => l.trim().startsWith("??")).length;

  const khong = "(khong doc duoc)";
  const dong = [
    `commit=${commit ?? khong}`,
    `nhanh=${nhanh ?? khong}`,
    `mo-ta=${moTa ?? khong}`,
    `luc-commit=${lucCommit ?? khong}`,
    // ⚠ `sach=false` nghĩa là bản dựng này KHÁC commit ở trên — đọc `commit=` mà bỏ dòng này là
    //   tự cho mình một lai lịch không có thật.
    `sach=${soBan === null ? khong : soBan === 0}`,
    `so-tep-ban=${soBan ?? khong}`,
    // Không vào bản dựng, nhưng ghi ra để người đọc biết cây lúc ấy trông thế nào.
    `so-tep-ngoai-so=${soNgoaiSo ?? khong}`,
    `luc-dung=${new Date().toISOString()}`,
    `duong-dung=${nguon}`,
    /*
     * ★ HAI DÒNG ĐỐI CHIẾU — thứ đã bắt được lần thất bại thứ ba.
     *   `luc-dung` nói tệp này được ghi lúc nào; hai dòng dưới nói artefact thật sự được ghi
     *   lúc nào. Lệch nhau ⇒ có đường dựng nào đó vẫn lách được, và nó TỰ NÓI RA.
     */
    ...ARTEFACT.map(([ten, p]) => `${ten}-mtime=${mtime(p) ?? "(khong co)"}`),
    `node=${process.version}`,
    `NODE_ENV=${process.env.NODE_ENV ?? khong}`,
    "",
  ].join("\n");

  try {
    fs.mkdirSync("dist", { recursive: true });
    fs.writeFileSync(DICH, dong, "utf8");
    const canhBao = soBan ? `  ⚠ cay BAN ${soBan} tep — ban dung nay KHAC commit` : "";
    console.log(
      `[lai-lich] ${DICH} — commit=${(commit ?? khong).slice(0, 9)} sach=${soBan === 0} duong=${nguon}${canhBao}`,
    );
  } catch (e) {
    // Không làm đổ bản dựng: thiếu lai lịch là phiền, đổ bản dựng là sự cố.
    console.warn(`[lai-lich] KHONG ghi duoc ${DICH}: ${String(e).slice(0, 120)}`);
  }
}

/**
 * Plugin vite — ghi lai lịch ngay sau khi bundle client đóng.
 *
 * ★ Đặt ở đây (cạnh chính hàm ghi) chứ không ở `vite.config.ts` là cố ý: luật *"bản dựng nào
 *   cũng có lai lịch"* chỉ nên có MỘT chỗ để đọc.
 */
export function pluginGhiLaiLich() {
  return {
    name: "ghi-lai-lich-ban-dung",
    apply: "build",
    closeBundle() {
      ghiLaiLichBanDung("vite");
    },
  };
}

/* Chạy thẳng bằng `node scripts/ghi-lai-lich-ban-dung.mjs` ⇒ ghi luôn. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ghiLaiLichBanDung("cli");
}
