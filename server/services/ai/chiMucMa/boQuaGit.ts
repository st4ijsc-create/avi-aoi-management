/**
 * ★ Đợt 2 — tôn trọng `.gitignore` ở GỐC dự án khi duyệt cây cho chỉ mục mã.
 *
 * VÌ SAO (đo 2026-10-17 trên repo này): hộp cát chỉ cấm `node_modules/dist/build/…`; thư mục rác do công cụ sinh
 * (`tmp/snap-*` — bản chụp NGUYÊN cây mã) vẫn "đọc được" ⇒ lượt quét đầu thấy **14.252** tệp mã thay vì ~5.200 tệp git
 * theo dõi, và MỖI định nghĩa trả về ba lần (`server/…`, `tmp/snap-b14b/server/…`, `tmp/snap-fix/server/…`) — model
 * nhận ba "đáp án" cho một câu hỏi, hai cái là bản cũ lệch dòng. `.gitignore` là nơi dự án đã tự khai "đây không phải
 * mã của tôi"; đọc nó là cơ chế, không phải cấu hình mới.
 *
 * PHẠM VI (nói thẳng): CHỈ tệp `.gitignore` ở gốc, cú pháp thường dùng — chú thích, `!` phủ định (dòng sau thắng),
 * `/` neo gốc, `/` cuối = chỉ thư mục, `*` `**` `?` `[...]`. `.gitignore` lồng trong thư mục con và
 * `.git/info/exclude` KHÔNG đọc. Không có tệp ⇒ không bỏ gì (hành vi cũ). Đọc qua hộp cát (`.gitignore` thuộc danh sách
 * trắng basename của `repoSandbox`). Thuần sau khi đọc — không gọi `git` (không sinh tiến trình con).
 */
import { docTepChiMuc } from "./hopCatChiMuc";

interface Luat {
  re: RegExp;
  phuDinh: boolean;
  chiThuMuc: boolean;
}

function globSangRegex(mau: string): string {
  let out = "";
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i]!;
    if (c === "*") {
      if (mau[i + 1] === "*") {
        // `**/` = không hoặc nhiều thư mục; `**` cuối = mọi thứ.
        if (mau[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const j = mau.indexOf("]", i + 1);
      if (j < 0) out += "\\[";
      else {
        out += "[" + mau.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
        i = j;
      }
    } else if (c === "\\" && i + 1 < mau.length) {
      out += mau[i + 1]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 1;
    } else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return out;
}

/** Phân tích nội dung `.gitignore` thành luật. Thuần. */
export function phanTichGitignore(noiDung: string): Luat[] {
  const luat: Luat[] = [];
  for (const tho of noiDung.split(/\r?\n/)) {
    let d = tho.replace(/(?<!\\)\s+$/, "");
    if (d === "" || d.startsWith("#")) continue;
    let phuDinh = false;
    if (d.startsWith("!")) {
      phuDinh = true;
      d = d.slice(1);
    }
    if (d.startsWith("\\#") || d.startsWith("\\!")) d = d.slice(1);
    let chiThuMuc = false;
    if (d.endsWith("/")) {
      chiThuMuc = true;
      d = d.replace(/\/+$/, "");
    }
    if (d === "") continue;
    const neo = d.includes("/");
    d = d.replace(/^\//, "");
    const than = globSangRegex(d);
    try {
      luat.push({ re: new RegExp(neo ? `^${than}$` : `^(?:.*/)?${than}$`), phuDinh, chiThuMuc });
    } catch {
      /* mẫu hỏng ⇒ bỏ qua dòng ấy (git cũng không khớp được nó) */
    }
  }
  return luat;
}

/** `true` ⇔ đường tương đối POSIX `rel` bị bỏ qua theo `luat` (dòng sau thắng). */
export function biBoQua(luat: readonly Luat[], rel: string, laThuMuc: boolean): boolean {
  let bo = false;
  for (const l of luat) {
    if (l.chiThuMuc && !laThuMuc) continue;
    if (l.re.test(rel)) bo = !l.phuDinh;
  }
  return bo;
}

/** Bộ lọc của MỘT gốc dự án — `null` khi gốc không có `.gitignore` đọc được. */
export function napBoQuaGit(goc: string): ((rel: string, laThuMuc: boolean) => boolean) | null {
  const doc = docTepChiMuc(goc, ".gitignore", 256 * 1024);
  if (!doc.ok) return null;
  const luat = phanTichGitignore(doc.noiDung);
  if (luat.length === 0) return null;
  return (rel, laThuMuc) => biBoQua(luat, rel, laThuMuc);
}
