#!/usr/bin/env node
/**
 * Stage CHỈ phần sửa của phiên mình trong một tệp DÙNG CHUNG với phiên khác (locales ×3, kế hoạch, báo cáo audit).
 *
 * Vì sao có công cụ này (2026-09-23): hai phiên Claude cùng một cây làm việc. Phiên training sửa `vi/en/zh.json` và tệp kế
 * hoạch bằng script "đọc cả tệp → thêm khoá → ghi lại", rồi `git commit -- <tệp>` ⇒ commit `466d7a3d0` và `ba1100eda` cuốn
 * luôn khoá i18n F4/F6 + dòng trạng thái kế hoạch CHƯA COMMIT của phiên kia. Không mất gì, nhưng lai lịch sai commit. Lời dặn
 * "đọc từng hunk trước khi commit" là cấu hình con người — công cụ này là cơ chế:
 *
 *   node scripts/git/stage-phan-minh.mjs chup  <tệp…>   # TRƯỚC khi sửa: chụp nội dung đĩa hiện tại (kể cả hunk của phiên kia)
 *   … sửa tệp …
 *   node scripts/git/stage-phan-minh.mjs stage <tệp…>   # stage ĐÚNG hiệu (bản chụp → bản đĩa) vào index, không đụng cây làm việc
 *   git commit -m "…"                                   # ⚠ KHÔNG kèm pathspec: `git commit -- <tệp>` lại lấy CẢ tệp từ đĩa
 *
 * Hiệu của mình chạm sát hunk của phiên kia (vd thêm khoá cuối cùng một object ⇒ dấu phẩy ở dòng của họ) ⇒ `git apply --cached`
 * TỪ CHỐI và công cụ dừng với mã 2: đó là tín hiệu ĐÚNG — phải nhắn phiên kia (họ commit trước, hoặc đồng ý commit chung),
 * không phải lỗi để lách. Bản chụp nằm trong `.git/phan-minh/` (không thành tệp untracked), bị xoá sau khi stage thành công.
 * ⚠ Giới hạn: phiên kia sửa CÙNG tệp trong khoảng giữa "chup" và "stage" ⇒ phần đó lẫn vào hiệu của mình. Chụp NGAY trước khi
 * sửa, stage NGAY sau; tệp chung vẫn nhắn phiên kia trước khi commit.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [lenh, ...tep] = process.argv.slice(2);
if (!["chup", "stage"].includes(lenh) || tep.length === 0) {
  console.error("dùng: stage-phan-minh.mjs chup|stage <tệp…>");
  process.exit(1);
}
const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
const goc = git(["rev-parse", "--show-toplevel"]).trim();
const kho = path.join(git(["rev-parse", "--absolute-git-dir"]).trim(), "phan-minh");
const tuongDoi = (t) => path.relative(goc, path.resolve(t)).split(path.sep).join("/");
const banChup = (rel) => path.join(kho, rel);

if (lenh === "chup") {
  for (const t of tep) {
    const rel = tuongDoi(t);
    fs.mkdirSync(path.dirname(banChup(rel)), { recursive: true });
    fs.copyFileSync(path.join(goc, rel), banChup(rel));
    console.log(`đã chụp ${rel}`);
  }
  process.exit(0);
}

let loi = 0;
for (const t of tep) {
  const rel = tuongDoi(t);
  if (!fs.existsSync(banChup(rel))) {
    console.error(`✗ ${rel}: chưa có bản chụp — chạy "chup" TRƯỚC khi sửa (không đoán được đâu là phần của mình).`);
    loi = 1;
    continue;
  }
  let hieu = "";
  try {
    // --no-index trả mã 1 khi CÓ khác biệt — đó là ca bình thường.
    hieu = git(["diff", "--no-index", "--no-color", "--", banChup(rel), path.join(goc, rel)]);
  } catch (e) {
    if (e.status !== 1) throw e;
    hieu = String(e.stdout);
  }
  if (!hieu.trim()) {
    console.log(`= ${rel}: không có sửa nào của mình kể từ lúc chụp.`);
    continue;
  }
  // `.gitattributes` `eol=lf`: index LF nhưng locales trên đĩa CRLF (`i/lf w/crlf`) ⇒ hiệu đĩa→đĩa mang `\r`, ngữ cảnh không
  // khớp index ⇒ bỏ `\r` khi index là LF (đúng thứ git sẽ lưu).
  const indexLf = /^i\/lf\b/.test(git(["ls-files", "--eol", "--", rel]).trim());
  // Đổi đường dẫn tuyệt đối của bản chụp/bản đĩa về a/<rel> b/<rel> để `git apply` hiểu là CÙNG một tệp trong repo.
  const vaDau = (indexLf ? hieu.replace(/\r(?=\n|$)/g, "") : hieu)
    .split("\n")
    .map((d) => {
      if (d.startsWith("diff --git ")) return `diff --git a/${rel} b/${rel}`;
      if (d.startsWith("--- ")) return `--- a/${rel}`;
      if (d.startsWith("+++ ")) return `+++ b/${rel}`;
      return d;
    })
    .join("\n");
  try {
    git(["apply", "--cached", "--whitespace=nowarn", "-"], { input: vaDau });
    fs.rmSync(banChup(rel));
    console.log(`✓ ${rel}: đã stage đúng phần sửa của mình.`);
  } catch (e) {
    console.error(
      `✗ ${rel}: hiệu của mình chạm hunk CHƯA COMMIT của phiên khác — git apply từ chối:\n${String(e.stderr ?? e.message).trim()}\n` +
        `  ⇒ nhắn phiên kia (họ commit trước, hoặc thống nhất commit chung). Bản chụp giữ nguyên.`,
    );
    loi = 2;
  }
}
const conLai = git(["diff", "--stat", "--", ...tep.map(tuongDoi)]).trim();
if (conLai) console.log(`\nCòn KHÔNG stage (phần của phiên khác, hoặc sửa sau lúc chụp):\n${conLai}`);
process.exit(loi);
