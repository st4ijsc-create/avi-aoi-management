/**
 * Dựng lại DỰ ÁN MẪU của một fixture phát lại (thư mục tạm, `git archive` đúng commit lúc ghi) — dùng chung cho `phatLaiFixture.test.ts` và `phatLaiFixture.epDo.db.test.ts`.
 * Không chạm CSDL. Thư mục tạm được ghi sổ để `donDuAnTam()` dọn ở `afterAll`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { FixturePhatLai } from "./phatLaiLuot";

const GOC_REPO = path.join(__dirname, "..", "..");
const tamDaTao: string[] = [];

/**
 * Thư mục tạm sao cho đường gốc phát lại CÙNG độ dài với lúc ghi (`fx.lenh.doDaiGoc`) — tóm tắt sự kiện / nén cắt theo số ký tự ⇒ đường
 * dài ngắn khác nhau làm chỗ cắt lệch. Thử `os.tmpdir()` rồi thư mục cha của repo; không cách nào khớp ⇒ thư mục tạm thường (có thể lệch).
 */
function taoThuMucTam(fx: FixturePhatLai): string {
  const duoi = path.join(...fx.lenh.duAnTuongDoi.split("/"));
  if (fx.lenh.doDaiGoc) {
    for (const cha of [fs.realpathSync(os.tmpdir()), path.dirname(GOC_REPO)]) {
      const ten = fx.lenh.doDaiGoc - duoi.length - 2 - cha.length; // cha + sep + ten + sep + duoi
      if (ten >= 9) return fs.realpathSync(fs.mkdtempSync(path.join(cha, "phat-lai-fx-".padEnd(ten - 6, "x").slice(0, ten - 6))));
    }
  }
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phat-lai-fx-")));
}

/** Dự án mẫu ở commit lúc ghi ⇒ thư mục tạm; trả gốc dự án (thư mục `duAnTuongDoi` bên trong). */
export function dungDuAn(fx: FixturePhatLai): string {
  const tam = taoThuMucTam(fx);
  tamDaTao.push(tam);
  const tar = path.join(tam, "du-an.tar");
  execFileSync("git", ["-C", GOC_REPO, "archive", "--format=tar", "-o", tar, fx.lenh.commit ?? "HEAD", "--", fx.lenh.duAnTuongDoi]);
  // Đường TƯƠNG ĐỐI + cwd: GNU tar của Git Bash đọc `C:\…` là máy từ xa ("Cannot connect to C: resolve failed"); bsdtar Windows cũng chạy.
  execFileSync("tar", ["-xf", "du-an.tar"], { cwd: tam });
  fs.rmSync(tar);
  const goc = path.join(tam, ...fx.lenh.duAnTuongDoi.split("/"));
  const git = (...a: string[]) => execFileSync("git", ["-C", goc, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "phat-lai");
  // Thư mục bị git bỏ qua đã có lúc ghi (`git archive` không mang theo) — dựng RỖNG sau commit.
  for (const d of fx.lenh.tonTaiTruoc ?? []) fs.mkdirSync(path.join(goc, ...d.split("/")), { recursive: true });
  return goc;
}

/** Dọn mọi thư mục tạm đã dựng (không ném: tệp còn bị khoá bởi máy chủ build dotnet không làm đỏ). */
export function donDuAnTam(): void {
  for (const t of tamDaTao.splice(0)) {
    try {
      fs.rmSync(t, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* thư mục tạm */
    }
  }
}
