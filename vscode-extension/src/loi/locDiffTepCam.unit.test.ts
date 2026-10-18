/**
 * ★★★ RÀ BẢO MẬT 9d26ad568 — `git diff`/`git diff --staged` mang NGUYÊN VĂN nội dung của mọi tệp đã theo dõi/đã stage,
 * kể cả `.env` / khoá riêng lỡ `git add -f`. `cheBiMat` chỉ bắt được chuỗi CÓ HÌNH DẠNG bí mật (`sk-…`, `password=`…);
 * `GITHUB_PAT=ghp_…`, `PRIVATE_KEY_B64=…` lọt nguyên. Tệp cấm phải bị loại ở tầng TỆP (cùng nguyên tắc `camRoiMay`:
 * thứ không được MỞ thì chặn ở tầng mở, không phó thác cho tầng che).
 */
import { describe, it, expect } from "vitest";
import { locDiffTepCam } from "./locDiffTepCam";

const khoi = (duong: string, than: string) =>
  `diff --git a/${duong} b/${duong}\nindex 1111111..2222222 100644\n--- a/${duong}\n+++ b/${duong}\n@@ -1 +1 @@\n${than}\n`;

describe("locDiffTepCam", () => {
  it("★★★ loại TOÀN BỘ khối của .env / khoá riêng, giữ khối tệp mã thường, liệt kê tệp bị loại", () => {
    const diff = khoi("src/a.ts", "+const a = 1;") + khoi(".env", "+GITHUB_PAT=ghp_abcdefghijklmnopqrstuvwxyz0123456789") + khoi("deploy/id_rsa_work", "+AAAAB3Nza");
    const kq = locDiffTepCam(diff);
    expect(kq.diff).toContain("+const a = 1;");
    expect(kq.diff).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(kq.diff).not.toContain("AAAAB3Nza");
    expect(kq.tepBiLoai).toEqual([".env", "deploy/id_rsa_work"]);
    expect(kq.diff).toMatch(/\.env/); // để model/người đọc biết có tệp bị loại — tên tệp không phải bí mật
  });

  it("★★★ tệp mới / xoá (--- /dev/null), tệp nhị phân, đổi tên SANG tên cấm, đường có dấu cách và đường trích dẫn", () => {
    const moi = "diff --git a/config/.env.local b/config/.env.local\nnew file mode 100644\n--- /dev/null\n+++ b/config/.env.local\n@@ -0,0 +1 @@\n+K=v1\n";
    const nhiPhan = "diff --git a/certs/a.pfx b/certs/a.pfx\nnew file mode 100644\nBinary files /dev/null and b/certs/a.pfx differ\n";
    const doiTen = "diff --git a/notes.txt b/server.key\nsimilarity index 90%\nrename from notes.txt\nrename to server.key\n@@ -1 +1 @@\n+MIIEv\n";
    const dauCach = "diff --git a/my dir/.env b/my dir/.env\n--- a/my dir/.env\t\n+++ b/my dir/.env\t\n@@ -1 +1 @@\n+K=v2\n";
    const trichDan = 'diff --git "a/t\\303\\240i/.env" "b/t\\303\\240i/.env"\n--- "a/t\\303\\240i/.env"\n+++ "b/t\\303\\240i/.env"\n@@ -1 +1 @@\n+K=v3\n';
    const kq = locDiffTepCam(moi + nhiPhan + doiTen + dauCach + trichDan + khoi("README.md", "+ok"));
    for (const bi of ["K=v1", "MIIEv", "K=v2", "K=v3"]) expect(kq.diff).not.toContain(bi);
    expect(kq.diff).toContain("+ok");
    expect(kq.tepBiLoai).toHaveLength(5);
  });

  it("★★ không có tệp cấm ⇒ nguyên văn, danh sách rỗng; chạy hai lần không phát hiện lại (dòng thay thế không mở khối mới)", () => {
    const diff = khoi("src/a.ts", "+x");
    expect(locDiffTepCam(diff)).toEqual({ diff, tepBiLoai: [] });
    const mot = locDiffTepCam(khoi(".env", "+A=1"));
    expect(locDiffTepCam(mot.diff).diff).toBe(mot.diff);
  });
});
