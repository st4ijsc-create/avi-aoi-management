/**
 * ★★★ Đợt 3b — LƯỚI CỬA GIT DỰ ÁN, trên repo git THẬT dựng tạm (không mock git).
 *
 * Bốn câu hỏi brief đặt ra, mỗi câu có ĐỐI CHỨNG (chứng minh thiết bị đo bắt được điều nó canh):
 *   1. Hook KHÔNG chạy — hook thật ở `.git/hooks` VÀ ở cấu hình toàn cục giả; `git` trơn ⇒ hook CHẠY (đối chứng).
 *   2. Repo chính TỪ CHỐI ghi (đọc vẫn được) — kể cả dự án lồng trong repo chính có `.git` riêng.
 *   3. Cây BẨN từ chối tạo/chuyển nhánh (sửa tệp đã track · tệp chưa track · tệp bị ẩn theo chính sách).
 *   4. Tác giả = người dùng PHIÊN, không phải `GIT_AUTHOR_*` của tiến trình hay `user.name` toàn cục.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  chuanHoaThongDiep,
  chuyenNhanh,
  commitTep,
  danhSachNhanh,
  diffTep,
  logNgan,
  moiTruongGitDaLoc,
  phanGiaiRepoGit,
  phanTichPorcelain,
  tacGiaTuPhien,
  taoNhanh,
  tenNhanhHopLe,
  trangThai,
  type RepoGit,
} from "./cuaGitDuAn";

let T = "";
let QUAN_LY = "";
let MARKER = "";
const ENV_CU: Record<string, string | undefined> = {};
const TAC_GIA = { ten: "Kỹ sư A", email: "a@nha-may.vn" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Seed", "-c", "user.email=seed@x", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(T, "khong-co-gitconfig") },
  });
}

/** Dựng một repo sạch có 2 tệp đã commit. */
function taoRepo(ten: string, cha = T): string {
  const r = path.join(cha, ten);
  fs.mkdirSync(r, { recursive: true });
  git(r, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(r, "a.txt"), "dong 1\n");
  fs.writeFileSync(path.join(r, "b.txt"), "b 1\n");
  git(r, "add", "-A");
  git(r, "commit", "-q", "-m", "dau");
  return r;
}

/** Hook sh ghi MARKER khi chạy (Git for Windows chạy hook qua sh đi kèm). */
function datHook(thuMuc: string, ten: string): void {
  fs.mkdirSync(thuMuc, { recursive: true });
  const f = path.join(thuMuc, ten);
  fs.writeFileSync(f, `#!/bin/sh\necho ${ten} >> "${MARKER.replace(/\\/g, "/")}"\nexit 0\n`);
  try {
    fs.chmodSync(f, 0o755);
  } catch {
    /* Windows */
  }
}

const markerCo = () => fs.existsSync(MARKER) && fs.readFileSync(MARKER, "utf8").trim() !== "";

async function repoTu(goc: string, gocChinh = path.join(T, "khong-phai-repo-chinh")): Promise<RepoGit> {
  const r = await phanGiaiRepoGit(goc, gocChinh);
  if (!r.ok) throw new Error(`phanGiaiRepoGit hỏng: ${r.ma}`);
  return r.repo;
}

beforeAll(() => {
  T = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cua-git-")));
  QUAN_LY = path.join(T, "quan-ly");
  MARKER = path.join(T, "marker.txt");
  for (const k of ["AI_PROJECTS_ROOT", "GIT_CONFIG_GLOBAL", "GIT_DIR", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
    ENV_CU[k] = process.env[k];
  }
  process.env.AI_PROJECTS_ROOT = QUAN_LY;
});

afterAll(() => {
  for (const [k, v] of Object.entries(ENV_CU)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(T, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(MARKER, { force: true });
  for (const k of ["GIT_CONFIG_GLOBAL", "GIT_DIR", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
    if (ENV_CU[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_CU[k];
  }
});

describe("§1 — HOOK KHÔNG CHẠY (có đối chứng)", () => {
  it("★★★ hook ở .git/hooks: git trơn ⇒ CHẠY; qua cửa (commit + tạo nhánh + chuyển nhánh) ⇒ KHÔNG", async () => {
    const r = taoRepo("hook-repo");
    for (const h of ["pre-commit", "commit-msg", "post-commit", "post-checkout"]) datHook(path.join(r, ".git", "hooks"), h);
    // ĐỐI CHỨNG — thiết bị đo bắt được hook thật.
    git(r, "commit", "-q", "--allow-empty", "-m", "doi chung");
    expect(markerCo(), "đối chứng: git trơn phải chạy hook (nếu không, lưới này mù)").toBe(true);
    fs.rmSync(MARKER, { force: true });

    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "a.txt"), "dong 2\n");
    const c = await commitTep(repo, ["a.txt"], "sua a", TAC_GIA);
    expect(c.ok).toBe(true);
    const n = await taoNhanh(repo, "tinh-nang/x");
    expect(n.ok).toBe(true);
    const s = await chuyenNhanh(repo, "main");
    expect(s.ok).toBe(true);
    expect(markerCo(), "qua cửa: KHÔNG hook nào được chạy").toBe(false);
  });

  it("★★★ hook trong CẤU HÌNH TOÀN CỤC (core.hooksPath) của tài khoản server: git trơn ⇒ CHẠY; qua cửa ⇒ KHÔNG", async () => {
    const r = taoRepo("hook-toan-cuc");
    const thuMucHook = path.join(T, "hook-toan-cuc-dir");
    datHook(thuMucHook, "pre-commit");
    const cfg = path.join(T, "gitconfig-ke-xau");
    fs.writeFileSync(cfg, `[core]\n\thooksPath = ${thuMucHook.replace(/\\/g, "/")}\n[user]\n\tname = Ke Gia\n\temail = ke@gia\n`);
    // ĐỐI CHỨNG
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "dc"], { cwd: r, env: { ...process.env, GIT_CONFIG_GLOBAL: cfg } });
    expect(markerCo(), "đối chứng: hook toàn cục phải chạy với git trơn").toBe(true);
    fs.rmSync(MARKER, { force: true });

    process.env.GIT_CONFIG_GLOBAL = cfg;
    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "b.txt"), "b 2\n");
    const c = await commitTep(repo, ["b.txt"], "sua b", TAC_GIA);
    expect(c.ok).toBe(true);
    expect(markerCo()).toBe(false);
    // …và danh tính toàn cục giả KHÔNG thành tác giả.
    expect(git(r, "log", "-1", "--format=%an|%ae").trim()).toBe(`${TAC_GIA.ten}|${TAC_GIA.email}`);
  });
});

describe("§2 — REPO CHÍNH CHỈ ĐỌC", () => {
  it("★★★ gốc = repo chính ⇒ đọc được (trạng thái/nhánh/log), commit/tạo/chuyển nhánh ⇒ GIT_REPO_CHINH_CHI_DOC; đĩa không đổi", async () => {
    const r = taoRepo("repo-chinh");
    const repo = await repoTu(r, r);
    expect(repo.laRepoChinh).toBe(true);
    expect(repo.ghiDuoc).toBe(false);
    fs.writeFileSync(path.join(r, "a.txt"), "ban\n");
    const tt = await trangThai(repo);
    expect(tt.ok && tt.tt.muc.map((m) => m.path)).toEqual(["a.txt"]);
    expect((await danhSachNhanh(repo)).ok).toBe(true);
    expect((await logNgan(repo)).ok).toBe(true);
    const truoc = git(r, "rev-parse", "HEAD").trim();
    expect(await commitTep(repo, ["a.txt"], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_REPO_CHINH_CHI_DOC" });
    expect(await taoNhanh(repo, "moi")).toMatchObject({ ok: false, ma: "GIT_REPO_CHINH_CHI_DOC" });
    expect(await chuyenNhanh(repo, "main")).toMatchObject({ ok: false, ma: "GIT_REPO_CHINH_CHI_DOC" });
    expect(git(r, "rev-parse", "HEAD").trim()).toBe(truoc);
    expect(git(r, "branch", "--list", "moi").trim()).toBe("");
  });

  it("★★ dự án LỒNG trong repo chính (có .git riêng) ⇒ vẫn chỉ đọc; thư mục con KHÔNG có .git riêng ⇒ GIT_KHONG_PHAI_REPO (không thao tác lên repo cha)", async () => {
    const chinh = taoRepo("chinh-cha");
    const long = taoRepo("du-an-long", path.join(chinh, "sandbox"));
    const rl = await phanGiaiRepoGit(long, chinh);
    expect(rl.ok && rl.repo.laRepoChinh).toBe(true);
    fs.mkdirSync(path.join(chinh, "con-khong-git"), { recursive: true });
    expect(await phanGiaiRepoGit(path.join(chinh, "con-khong-git"), path.join(T, "khac"))).toMatchObject({ ok: false, ma: "GIT_KHONG_PHAI_REPO" });
  });

  it("★★ `.git` là TỆP gitdir (worktree) ⇒ đọc được, ghi ⇒ GIT_WORKTREE_CHI_DOC", async () => {
    const r = taoRepo("co-worktree");
    const wt = path.join(T, "wt-cua-r");
    git(r, "worktree", "add", "-q", "-b", "wt-nhanh", wt);
    const rw = await phanGiaiRepoGit(wt, path.join(T, "khac"));
    expect(rw.ok).toBe(true);
    if (!rw.ok) return;
    expect(rw.repo.ghiDuoc).toBe(false);
    expect((await trangThai(rw.repo)).ok).toBe(true);
    fs.writeFileSync(path.join(wt, "a.txt"), "x\n");
    expect(await commitTep(rw.repo, ["a.txt"], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_WORKTREE_CHI_DOC" });
  });
});

describe("§3 — CÂY BẨN TỪ CHỐI tạo/chuyển nhánh", () => {
  it("★★★ sửa tệp đã track · tệp chưa track · tệp BỊ ẨN (.env) ⇒ GIT_CAY_BAN; sạch ⇒ được", async () => {
    const r = taoRepo("cay-ban");
    const repo = await repoTu(r);
    expect((await taoNhanh(repo, "nhanh-2")).ok).toBe(true);
    expect((await chuyenNhanh(repo, "main")).ok).toBe(true);

    fs.writeFileSync(path.join(r, "a.txt"), "ban\n");
    expect(await chuyenNhanh(repo, "nhanh-2")).toMatchObject({ ok: false, ma: "GIT_CAY_BAN" });
    expect(await taoNhanh(repo, "nhanh-3")).toMatchObject({ ok: false, ma: "GIT_CAY_BAN" });
    git(r, "checkout", "--", "a.txt");

    fs.writeFileSync(path.join(r, "moi.txt"), "chua track\n");
    expect(await chuyenNhanh(repo, "nhanh-2")).toMatchObject({ ok: false, ma: "GIT_CAY_BAN" });
    fs.rmSync(path.join(r, "moi.txt"));

    fs.writeFileSync(path.join(r, ".env"), "MAT_KHAU=1\n");
    const tt = await trangThai(repo);
    expect(tt.ok && tt.tt.muc).toEqual([]); // .env bị ẩn khỏi danh sách…
    expect(tt.ok && tt.tt.soAn).toBe(1);
    expect(await chuyenNhanh(repo, "nhanh-2")).toMatchObject({ ok: false, ma: "GIT_CAY_BAN" }); // …nhưng vẫn là cây bẩn
    fs.rmSync(path.join(r, ".env"));

    expect(await chuyenNhanh(repo, "nhanh-2")).toMatchObject({ ok: true, nhanh: "nhanh-2" });
    expect(git(r, "symbolic-ref", "--short", "HEAD").trim()).toBe("nhanh-2");
  });

  it("★★ tên nhánh: đã có ⇒ GIT_NHANH_DA_CO; không có ⇒ GIT_NHANH_KHONG_CO; méo ⇒ GIT_TEN_NHANH_SAI", async () => {
    const r = taoRepo("ten-nhanh");
    const repo = await repoTu(r);
    expect(await taoNhanh(repo, "main")).toMatchObject({ ok: false, ma: "GIT_NHANH_DA_CO" });
    expect(await chuyenNhanh(repo, "khong-co")).toMatchObject({ ok: false, ma: "GIT_NHANH_KHONG_CO" });
    expect(await taoNhanh(repo, "--upload-pack=x")).toMatchObject({ ok: false, ma: "GIT_TEN_NHANH_SAI" });
    expect(await chuyenNhanh(repo, "-f")).toMatchObject({ ok: false, ma: "GIT_TEN_NHANH_SAI" });
  });

  it("tenNhanhHopLe — bảng ca", () => {
    for (const ok of ["main", "tinh-nang/x", "v1.2", "a_b"]) expect(tenNhanhHopLe(ok), ok).toBe(true);
    for (const sai of ["", "-x", "a..b", "a//b", "a.lock", "a/", ".a", "a/.b", "HEAD", "a b", "a~1", "a^", "a:b", "a@{1}", "x".repeat(101), 5]) {
      expect(tenNhanhHopLe(sai), String(sai)).toBe(false);
    }
  });
});

describe("§4 — TÁC GIẢ = NGƯỜI DÙNG PHIÊN; commit ĐÚNG tệp đã chọn", () => {
  it("★★★ GIT_AUTHOR_*/GIT_COMMITTER_* của TIẾN TRÌNH bị bỏ; tác giả + người commit = phiên", async () => {
    const r = taoRepo("tac-gia");
    process.env.GIT_AUTHOR_NAME = "Tien Trinh";
    process.env.GIT_AUTHOR_EMAIL = "tien@trinh";
    process.env.GIT_COMMITTER_NAME = "Tien Trinh";
    process.env.GIT_COMMITTER_EMAIL = "tien@trinh";
    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "a.txt"), "moi\n");
    const c = await commitTep(repo, ["a.txt"], "Sửa a\n\nthân thông điệp", TAC_GIA);
    expect(c.ok).toBe(true);
    expect(git(r, "log", "-1", "--format=%an|%ae|%cn|%ce").trim()).toBe(`${TAC_GIA.ten}|${TAC_GIA.email}|${TAC_GIA.ten}|${TAC_GIA.email}`);
    expect(git(r, "log", "-1", "--format=%B").trim()).toBe("Sửa a\n\nthân thông điệp");
    const lg = await logNgan(repo);
    expect(lg.ok && lg.dong[0]).toMatchObject({ tacGia: TAC_GIA.ten, email: TAC_GIA.email, tieuDe: "Sửa a" });
  });

  it("★★★ chỉ tệp ĐÃ CHỌN vào commit (kể cả khi tệp khác đã staged từ trước); tệp mới + tệp xoá được", async () => {
    const r = taoRepo("chon-tep");
    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "a.txt"), "a moi\n");
    fs.writeFileSync(path.join(r, "b.txt"), "b moi\n");
    git(r, "add", "b.txt"); // b đã staged từ trước
    fs.writeFileSync(path.join(r, "c.txt"), "tep moi\n");
    const c = await commitTep(repo, ["a.txt", "c.txt"], "a + c", TAC_GIA);
    expect(c).toMatchObject({ ok: true, soTep: 2 });
    expect(git(r, "show", "--name-only", "--format=", "HEAD").trim().split(/\r?\n/).sort()).toEqual(["a.txt", "c.txt"]);
    const tt = await trangThai(repo);
    expect(tt.ok && tt.tt.muc.map((m) => m.path)).toEqual(["b.txt"]);

    fs.rmSync(path.join(r, "c.txt"));
    expect((await commitTep(repo, ["c.txt"], "xoa c", TAC_GIA)).ok).toBe(true);
    expect(git(r, "ls-files", "c.txt").trim()).toBe("");
  });

  it("★★★ đường KHÔNG có trong trạng thái / pathspec ma thuật / thông điệp rỗng ⇒ từ chối, HEAD không đổi", async () => {
    const r = taoRepo("tu-choi");
    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "a.txt"), "x\n");
    const truoc = git(r, "rev-parse", "HEAD").trim();
    expect(await commitTep(repo, ["b.txt"], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_DUONG_KHONG_HOP_LE" });
    expect(await commitTep(repo, [":(top)*"], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_DUONG_KHONG_HOP_LE" });
    expect(await commitTep(repo, ["../ngoai.txt"], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_DUONG_KHONG_HOP_LE" });
    expect(await commitTep(repo, ["a.txt"], "   \n\u0000 ", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_THONG_DIEP_RONG" });
    expect(await commitTep(repo, [], "x", TAC_GIA)).toMatchObject({ ok: false, ma: "GIT_KHONG_CO_TEP" });
    expect(git(r, "rev-parse", "HEAD").trim()).toBe(truoc);
  });

  it("★★ GIT_DIR của tiến trình bị bỏ: cửa đọc ĐÚNG repo của gốc dự án", async () => {
    const r = taoRepo("git-dir-dung");
    const khac = taoRepo("git-dir-khac");
    // repo KHÁC có tệp mà gốc dự án không có ⇒ GIT_DIR lọt vào ⇒ " D chi-o-khac.txt" (đột biến M5 đo được).
    fs.writeFileSync(path.join(khac, "chi-o-khac.txt"), "x\n");
    git(khac, "add", "-A");
    git(khac, "commit", "-q", "-m", "khac");
    process.env.GIT_DIR = path.join(khac, ".git");
    const repo = await repoTu(r);
    const tt = await trangThai(repo);
    expect(tt.ok && tt.tt.muc).toEqual([]);
  });
});

describe("§5 — diff · porcelain · môi trường (thuần)", () => {
  it("★★ diffTep: bản HEAD + bản đĩa; tệp mới ⇒ gốc rỗng; tệp xoá ⇒ mới rỗng; đường ngoài trạng thái ⇒ từ chối", async () => {
    const r = taoRepo("diff");
    const repo = await repoTu(r);
    fs.writeFileSync(path.join(r, "a.txt"), "dong 1\ndong 2\n");
    fs.writeFileSync(path.join(r, "moi.txt"), "moi\n");
    fs.rmSync(path.join(r, "b.txt"));
    const a = await diffTep(repo, "a.txt", "u:test");
    expect(a.ok && a.diff).toMatchObject({ goc: "dong 1\n", moi: "dong 1\ndong 2\n", nhiPhan: false });
    const m = await diffTep(repo, "moi.txt", "u:test");
    expect(m.ok && m.diff).toMatchObject({ goc: "", moi: "moi\n" });
    const b = await diffTep(repo, "b.txt", "u:test");
    expect(b.ok && b.diff).toMatchObject({ goc: "b 1\n", moi: "" });
    expect(await diffTep(repo, "khong-co.txt", "u:test")).toMatchObject({ ok: false, ma: "GIT_DUONG_KHONG_HOP_LE" });
  });

  it("phanTichPorcelain: nhánh, chưa có commit, đổi tên (hai mục -z)", () => {
    const p = phanTichPorcelain("## main...origin/main [ahead 1]\0 M a.txt\0R  moi.txt\0cu.txt\0?? x y.txt\0");
    expect(p.nhanh).toBe("main");
    expect(p.muc).toEqual([
      { path: "a.txt", tuDuong: null, xy: " M" },
      { path: "moi.txt", tuDuong: "cu.txt", xy: "R " },
      { path: "x y.txt", tuDuong: null, xy: "??" },
    ]);
    expect(phanTichPorcelain("## No commits yet on main\0")).toMatchObject({ nhanh: "main", chuaCoCommit: true });
  });

  it("★★ moiTruongGitDaLoc: danh sách GIỮ — GIT_*/biến lạ của tiến trình KHÔNG vào; cấu hình toàn cục = tệp rỗng", () => {
    const env = moiTruongGitDaLoc(
      { PATH: "/bin", GIT_DIR: "/x", GIT_SSH_COMMAND: "ke-xau", GIT_CONFIG_GLOBAL: "/g", NODE_OPTIONS: "--require x", DATABASE_URL: "pg://" },
      { home: "/h", cauHinhRong: "/h/rong", tran: "/cha", tacGia: TAC_GIA, chiDoc: false },
    );
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_SSH_COMMAND).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.GIT_CONFIG_GLOBAL).toBe("/h/rong");
    expect(env.GIT_CEILING_DIRECTORIES).toBe("/cha");
    expect(env.GIT_AUTHOR_NAME).toBe(TAC_GIA.ten);
    expect(env.GIT_COMMITTER_EMAIL).toBe(TAC_GIA.email);
  });

  it("tacGiaTuPhien / chuanHoaThongDiep", () => {
    expect(tacGiaTuPhien({ id: 5, name: "A <b>\n", email: "a@b.c" })).toEqual({ ten: "A b", email: "a@b.c" });
    expect(tacGiaTuPhien({ id: 5, name: "", username: "ks5", email: "xau" })).toEqual({ ten: "ks5", email: "u5@ai-local.invalid" });
    expect(tacGiaTuPhien({ id: 5 })).toEqual({ ten: "user5", email: "u5@ai-local.invalid" });
    expect(chuanHoaThongDiep("  a\r\nb\u0000c  ")).toBe("a\nbc");
  });
});
