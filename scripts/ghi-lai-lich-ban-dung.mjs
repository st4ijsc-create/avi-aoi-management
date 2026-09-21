#!/usr/bin/env node
/**
 * ghi-lai-lich-ban-dung.mjs — **GHI LAI LỊCH VÀO `dist/BUILD-INFO.txt`, TRONG CHÍNH BƯỚC DỰNG.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÀ MỘT BƯỚC CỦA `npm run build`, KHÔNG PHẢI MỘT QUY ƯỚC
 * ════════════════════════════════════════════════════════════════════════════
 * Dự án này **đã mất lai lịch bản dựng HAI lần**, và cả hai lần đều đúng một kiểu: có quy ước
 * *"dựng xong thì ghi BUILD-INFO"*, không có **cơ chế ép**, nên nó rụng ngay lần dựng sau mà
 * không ai biết.
 *
 * Lần đầu (Đợt 55/PH-43): tệp còn đó nhưng **khai SAI commit** — tức tệ hơn không có, vì nó nói
 * dối một cách đáng tin. Chủ dự án chốt *"Đồng ý xoá"*, và bằng chứng được ghi lại trước khi xoá
 * (md5 `8ebaa84a…`, `commit=e780bcab…`).
 * Lần hai (2026-09-17): dựng lại lúc 16:08 **không ghi** BUILD-INFO ⇒ lai lịch mất lần nữa.
 * Đo 2026-09-21: `dist/BUILD-INFO.txt` **không tồn tại**, và **không dòng nào** trong `npm run
 * build` sinh ra nó.
 *
 * ⇒ Quy ước không được cưỡng chế thì không phải quy ước, nó là một lời chúc. Bước này chạy
 *   **trong** `build`, nên bản dựng nào cũng có lai lịch, kể cả bản dựng của một phiên đang vội.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHÔNG BAO GIỜ ĐƯỢC NÓI DỐI — THÀ KHAI "KHÔNG BIẾT"
 * ════════════════════════════════════════════════════════════════════════════
 * Bài học PH-43: một tệp lai lịch **khai sai** nguy hiểm hơn một tệp **vắng mặt**, vì người đọc
 * tin nó. Nên:
 *   · `git` không chạy được / không phải repo ⇒ ghi `commit=(khong doc duoc)`, **không** bịa;
 *   · cây làm việc BẨN ⇒ ghi `sach=false` kèm số tệp bẩn — bản dựng ấy **không** bằng commit;
 *   · mọi giá trị đều ghi **nguyên văn thứ đọc được**, không suy diễn.
 *
 * ⚠ Bước này **không được làm hỏng bản dựng**: mọi lỗi đều nuốt và vẫn ghi phần đọc được. Một
 *   bản dựng đổ vì không đọc nổi `git` là đổi một phiền toái lấy một sự cố.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DICH = path.join("dist", "BUILD-INFO.txt");

/** Chạy `git …`; trả `null` khi không đọc được — KHÔNG bịa một giá trị thay thế. */
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

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
  `node=${process.version}`,
  `NODE_ENV=${process.env.NODE_ENV ?? khong}`,
  "",
].join("\n");

try {
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync(DICH, dong, "utf8");
  const canhBao = soBan ? `  ⚠ cay BAN ${soBan} tep — ban dung nay KHAC commit` : "";
  console.log(`[lai-lich] ${DICH} — commit=${(commit ?? khong).slice(0, 9)} sach=${soBan === 0}${canhBao}`);
} catch (e) {
  // Không làm đổ bản dựng: thiếu lai lịch là phiền, đổ bản dựng là sự cố.
  console.warn(`[lai-lich] KHONG ghi duoc ${DICH}: ${String(e).slice(0, 120)}`);
}
