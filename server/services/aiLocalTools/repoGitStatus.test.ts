/**
 * `trangThaiGitCuaTep` — dòng `warning:` của git KHÔNG phải trạng thái tệp.
 *
 * Đo 2026-10-17: `git status --porcelain -- <thư mục chưa có>/moi.ts` in
 * `warning: could not open directory '<thư mục>/': No such file or directory` (stderr, exit 0), và bộ
 * chạy hộp cát gộp stderr vào đầu ra ⇒ trước bản vá, tạo tệp MỚI trong thư mục MỚI bị coi là "tệp bẩn"
 * (FILE_DIRTY) — đúng việc agent làm nhiều nhất (thêm module mới). Phát hiện khi làm `rename_file` (T2).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { trangThaiGitCuaTep } from "./repoGitStatus";

function taoRepoTam(): string {
  const goc = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-"));
  execFileSync("git", ["init", "-q"], { cwd: goc });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "goc"], { cwd: goc });
  fs.writeFileSync(path.join(goc, "da-co.ts"), "export const a = 1;\n");
  execFileSync("git", ["add", "da-co.ts"], { cwd: goc });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "tep"], { cwd: goc });
  return goc;
}

describe("trangThaiGitCuaTep", () => {
  it("tệp mới trong THƯ MỤC CHƯA CÓ là sạch (dòng warning của git bị bỏ qua)", async () => {
    const goc = taoRepoTam();
    const kq = await trangThaiGitCuaTep("thu-muc-moi/con/moi.ts", goc);
    expect(kq.ok).toBe(true);
    if (kq.ok) expect(kq.sach).toBe(true);
  });

  it("tệp mới trong thư mục CON chưa có của một thư mục ĐÃ track (ca git in warning) ⇒ sạch", async () => {
    const goc = taoRepoTam();
    fs.mkdirSync(path.join(goc, "src"));
    fs.writeFileSync(path.join(goc, "src", "a.ts"), "x\n");
    execFileSync("git", ["add", "src"], { cwd: goc });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "src"], { cwd: goc });
    const kq = await trangThaiGitCuaTep("src/moi/b.ts", goc);
    expect(kq.ok).toBe(true);
    if (kq.ok) expect(kq.sach).toBe(true);
  });

  it("tệp đã commit, không sửa ⇒ sạch", async () => {
    const goc = taoRepoTam();
    const kq = await trangThaiGitCuaTep("da-co.ts", goc);
    expect(kq.ok && kq.sach).toBe(true);
  });

  it("tệp đã commit bị sửa ⇒ BẨN (dòng porcelain vẫn được tính dù có warning đi kèm)", async () => {
    const goc = taoRepoTam();
    fs.writeFileSync(path.join(goc, "da-co.ts"), "export const a = 2;\n");
    const kq = await trangThaiGitCuaTep("da-co.ts", goc);
    expect(kq.ok).toBe(true);
    if (kq.ok) {
      expect(kq.sach).toBe(false);
      expect(kq.trangThai).toMatch(/da-co\.ts/);
    }
  });

  it("tệp chưa track ⇒ BẨN", async () => {
    const goc = taoRepoTam();
    fs.writeFileSync(path.join(goc, "la.ts"), "x\n");
    const kq = await trangThaiGitCuaTep("la.ts", goc);
    expect(kq.ok && kq.sach).toBe(false);
  });
});
