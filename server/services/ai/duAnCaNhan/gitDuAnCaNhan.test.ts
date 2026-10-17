/**
 * ★★★ Đợt 3a — LƯỚI GIT dự án cá nhân, chạy `git` THẬT:
 *   §1 danh sách trắng clone: vắng ⇒ tắt; URL/đường ngoài danh sách ⇒ chặn; các hình dạng lách tiền tố ⇒ chặn.
 *   §2 clone `--depth 1` từ đường cục bộ trong danh sách: chỉ 1 commit dù nguồn có 3.
 *   §3 HOOK KHÔNG CHẠY: một `post-checkout`/`pre-commit` THẬT trong cấu hình TOÀN CỤC giả — ĐỐI CHỨNG `git` trơn ⇒ hook
 *      CHẠY (thiết bị đo bắt được), qua hàm ⇒ KHÔNG chạy.
 *   §4 git init + commit đầu: đúng 1 commit, cây sạch, kể cả dự án rỗng.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BIEN_GIT_CLONE_ALLOW,
  cloneGitNoiBo,
  damBaoThuMucKhongHook,
  khoiTaoGitVaCommitDau,
  phanQuyetNguonGit,
} from "./gitDuAnCaNhan";

let GOC = "";
let MIRROR = ""; // thư mục cục bộ trong danh sách trắng
let NGUON = ""; // repo nguồn (3 commit) trong MIRROR
let NGOAI = ""; // repo NGOÀI danh sách trắng
let KHONG_HOOK = "";
let HOOKS = "";
let CAU_HINH = "";
let DAU = ""; // tệp dấu mà hook ghi ra
const CU: Record<string, string | undefined> = {};

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env } }).trim();
}

beforeAll(() => {
  GOC = fs.mkdtempSync(path.join(os.tmpdir(), "git3a-"));
  MIRROR = path.join(GOC, "mirror");
  NGUON = path.join(MIRROR, "nguon");
  NGOAI = path.join(GOC, "ngoai");
  KHONG_HOOK = damBaoThuMucKhongHook(path.join(GOC, ".khong-hook"));
  HOOKS = path.join(GOC, "hooks-toan-cuc");
  CAU_HINH = path.join(GOC, "gitconfig-toan-cuc");
  DAU = path.join(GOC, "hook-da-chay.txt");
  for (const d of [NGUON, NGOAI, HOOKS]) fs.mkdirSync(d, { recursive: true });
  const id = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${KHONG_HOOK}`];
  for (const [repo, n] of [[NGUON, 3], [NGOAI, 1]] as const) {
    git([...id, "init", "-q", "-b", "main"], repo);
    for (let i = 0; i < n; i++) {
      fs.writeFileSync(path.join(repo, `t${i}.txt`), `v${i}`);
      git([...id, "add", "-A"], repo);
      git([...id, "commit", "-q", "-m", `c${i}`], repo);
    }
  }
  // Hook THẬT: ghi tệp dấu. Cấu hình toàn cục GIẢ trỏ core.hooksPath vào đây (giống máy dev có hooksPath toàn cục).
  const kichBan = `#!/bin/sh\necho "$0" >> "${DAU.split(path.sep).join("/")}"\n`;
  for (const h of ["post-checkout", "pre-commit", "post-commit"]) {
    fs.writeFileSync(path.join(HOOKS, h), kichBan, { mode: 0o755 });
  }
  fs.writeFileSync(CAU_HINH, `[core]\n\thooksPath = ${HOOKS.split(path.sep).join("/")}\n`);
});
afterAll(() => {
  fs.rmSync(GOC, { recursive: true, force: true });
});
beforeEach(() => {
  for (const k of [BIEN_GIT_CLONE_ALLOW, "GIT_CONFIG_GLOBAL"]) CU[k] = process.env[k];
  process.env[BIEN_GIT_CLONE_ALLOW] = `${MIRROR};https://git.xuong.local/nhom-a/`;
  try { fs.rmSync(DAU, { force: true }); } catch { /* */ }
});
afterEach(() => {
  for (const k of Object.keys(CU)) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
});

describe("§1 — danh sách trắng `AI_GIT_CLONE_ALLOW` (offline: không clone internet tuỳ ý)", () => {
  it("★★★ VẮNG ⇒ GIT_TAT (fail-closed), kể cả nguồn trông hợp lệ", () => {
    delete process.env[BIEN_GIT_CLONE_ALLOW];
    expect(phanQuyetNguonGit(NGUON)).toEqual({ ok: false, ma: "GIT_TAT" });
  });

  it("★★★ URL internet / máy chủ khác / nhóm khác ⇒ GIT_NGOAI_DANH_SACH", () => {
    for (const u of [
      "https://github.com/x/y.git",
      "https://git.xuong.local/nhom-b/repo.git",
      "https://git.xuong.local.ke-xau.com/nhom-a/repo.git",
      "https://git.xuong.local:8443/nhom-a/repo.git",
      "http://git.xuong.local/nhom-a/repo.git",
      "https://git.xuong.local/nhom-a-gia/repo.git",
    ]) {
      expect(phanQuyetNguonGit(u), u).toEqual({ ok: false, ma: "GIT_NGOAI_DANH_SACH" });
    }
    expect(phanQuyetNguonGit("https://git.xuong.local/nhom-a/repo.git")).toEqual({ ok: true, url: "https://git.xuong.local/nhom-a/repo.git" });
  });

  it("★★ hình dạng xấu ⇒ GIT_NGUON_KHONG_HOP_LE: userinfo, cờ `-`, `ext::`, scp-like, tương đối, khoảng trắng", () => {
    for (const x of [
      "https://git.xuong.local@ke-xau.com/nhom-a/x",
      "https://u:p@git.xuong.local/nhom-a/x",
      "--upload-pack=calc.exe",
      "ext::sh -c touch% /tmp/pwn",
      "git@git.xuong.local:nhom-a/x.git",
      "nhom-a/x",
      "file:///C:/Windows",
      "https://git.xuong.local/nhom-a/x y",
    ]) {
      expect(phanQuyetNguonGit(x).ok, x).toBe(false);
    }
    expect(phanQuyetNguonGit("file:///C:/Windows")).toEqual({ ok: false, ma: "GIT_NGUON_KHONG_HOP_LE" });
  });

  it("★★★ ĐƯỜNG CỤC BỘ ngoài thư mục trong danh sách ⇒ GIT_NGOAI_DANH_SACH (clone đường tuỳ ý = đọc thư mục tuỳ ý)", () => {
    expect(phanQuyetNguonGit(NGOAI)).toEqual({ ok: false, ma: "GIT_NGOAI_DANH_SACH" });
    expect(phanQuyetNguonGit(path.join(MIRROR, "..", "ngoai"))).toEqual({ ok: false, ma: "GIT_NGOAI_DANH_SACH" });
    const kq = phanQuyetNguonGit(NGUON);
    expect(kq.ok).toBe(true);
    if (kq.ok) expect(kq.url.startsWith("file://")).toBe(true);
  });
});

describe("§2 — clone `--depth 1` từ nguồn trong danh sách", () => {
  it("★★ chỉ 1 commit dù nguồn có 3; tệp của commit cuối có mặt", async () => {
    const dich = path.join(GOC, "clone-1");
    expect(await cloneGitNoiBo(NGUON, dich, KHONG_HOOK)).toEqual({ ok: true });
    expect(git(["rev-list", "--count", "HEAD"], dich)).toBe("1");
    expect(fs.readFileSync(path.join(dich, "t2.txt"), "utf8")).toBe("v2");
  });

  it("★★ nguồn ngoài danh sách ⇒ không thư mục nào được tạo", async () => {
    const dich = path.join(GOC, "clone-ngoai");
    expect(await cloneGitNoiBo(NGOAI, dich, KHONG_HOOK)).toEqual({ ok: false, ma: "GIT_NGOAI_DANH_SACH" });
    expect(fs.existsSync(dich)).toBe(false);
  });
});

describe("§3 — HOOK KHÔNG CHẠY (cấu hình toàn cục có core.hooksPath với hook THẬT)", () => {
  it("★★★ ĐỐI CHỨNG: `git clone` trơn với cùng cấu hình ⇒ post-checkout CHẠY (thiết bị đo bắt được hook)", () => {
    process.env.GIT_CONFIG_GLOBAL = CAU_HINH;
    execFileSync("git", ["clone", "-q", NGUON, path.join(GOC, "doi-chung")], { env: { ...process.env } });
    expect(fs.existsSync(DAU), "đối chứng phải thấy hook chạy — nếu không, ca dưới xanh vì lý do sai").toBe(true);
  });

  it("★★★ qua `cloneGitNoiBo` ⇒ post-checkout KHÔNG chạy", async () => {
    process.env.GIT_CONFIG_GLOBAL = CAU_HINH;
    const dich = path.join(GOC, "clone-hook");
    expect(await cloneGitNoiBo(NGUON, dich, KHONG_HOOK)).toEqual({ ok: true });
    expect(fs.existsSync(DAU)).toBe(false);
  });

  it("★★★ `khoiTaoGitVaCommitDau` ⇒ pre-commit/post-commit KHÔNG chạy", async () => {
    process.env.GIT_CONFIG_GLOBAL = CAU_HINH;
    const d = path.join(GOC, "init-hook");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "a.txt"), "x");
    expect(await khoiTaoGitVaCommitDau(d, "Dự án", KHONG_HOOK)).toEqual({ ok: true });
    expect(fs.existsSync(DAU)).toBe(false);
  });
});

describe("§4 — git init + commit đầu", () => {
  it("★★★ dự án có tệp ⇒ 1 commit, cây sạch (Q1 'tệp bẩn' không báo oan), nhánh main", async () => {
    const d = path.join(GOC, "init-1");
    fs.mkdirSync(path.join(d, "src"), { recursive: true });
    fs.writeFileSync(path.join(d, "src", "a.ts"), "export {};\n");
    expect(await khoiTaoGitVaCommitDau(d, "Dự án thử", KHONG_HOOK)).toEqual({ ok: true });
    expect(git(["rev-list", "--count", "HEAD"], d)).toBe("1");
    expect(git(["status", "--porcelain"], d)).toBe("");
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], d)).toBe("main");
    expect(git(["log", "-1", "--format=%s"], d)).toBe("Khởi tạo dự án: Dự án thử");
  });

  it("★★ dự án RỖNG ⇒ vẫn có commit đầu (--allow-empty) — checkpoint/hoàn tác cần một HEAD", async () => {
    const d = path.join(GOC, "init-rong");
    fs.mkdirSync(d);
    expect(await khoiTaoGitVaCommitDau(d, "Rỗng", KHONG_HOOK)).toEqual({ ok: true });
    expect(git(["rev-list", "--count", "HEAD"], d)).toBe("1");
  });
});
