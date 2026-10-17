/**
 * ★★★ Đợt 3a (Q3) — **GIT cho dự án cá nhân**: (1) `git init` + commit đầu cho mọi dự án mới (để checkpoint/hoàn
 * tác và phép kiểm "tệp bẩn" của Q1 hoạt động đúng); (2) `git clone` CHỈ từ nguồn trong danh sách trắng nội bộ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHÔNG HOOK NÀO CHẠY — `core.hooksPath` TRỎ VÀO MỘT THƯ MỤC RỖNG CHO MỌI LỆNH GIT Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hook đến từ ba nơi: `.git/hooks` của repo (clone KHÔNG chép hook từ nguồn, nhưng một ZIP có thể mang `.git/hooks`
 * — `nhapZipAnToan` bỏ qua `.git`), `core.hooksPath` trong cấu hình TOÀN CỤC/HỆ THỐNG của tài khoản chạy server
 * (máy dev thật có cấu hình này), và `post-checkout` chạy NGAY trong `git clone`. `-c core.hooksPath=<thư mục rỗng>`
 * trên dòng lệnh thắng mọi tầng cấu hình ⇒ cả ba nguồn đều câm. Thêm `--no-verify` cho commit (hai lớp độc lập).
 * Lưới đo bằng một hook `post-checkout` THẬT trong cấu hình toàn cục giả: `git clone` trơn ⇒ hook CHẠY (đối chứng
 * — chứng minh thiết bị đo bắt được), qua hàm này ⇒ KHÔNG chạy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CLONE OFFLINE — DANH SÁCH TRẮNG `AI_GIT_CLONE_ALLOW`, VẮNG ⇒ TẮT (fail-closed)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Định dạng: các mục ngăn bởi `;`, mỗi mục là MỘT trong hai:
 *   • tiền tố URL máy chủ git NỘI BỘ: `https://git.xuong.local/nhom/` (so theo URL ĐÃ PHÂN TÍCH: cùng giao thức,
 *     cùng host:port, đường bắt đầu bằng đường của mục theo RANH GIỚI `/` — không so chuỗi thô, để
 *     `https://git.xuong.local@ke-xau.com/` hay `https://git.xuong.local.ke-xau.com/` không lọt);
 *   • thư mục CỤC BỘ tuyệt đối: `D:\GitMirror` — nguồn phải nằm (realpath) TRONG thư mục ấy.
 * Đường cục bộ CŨNG phải qua danh sách trắng: clone một đường tuỳ ý = đọc một thư mục tuỳ ý của máy chủ (repo chính,
 * repo của dự án khác) bằng quyền của server. Giao thức giới hạn bằng `GIT_ALLOW_PROTOCOL=file:https:http:ssh:git`
 * (chặn `ext::` — chạy lệnh tuỳ ý — kể cả qua submodule/chuyển hướng). Không submodule, `--depth 1`, có trần giờ,
 * `core.symlinks=false` (symlink trong repo nguồn thành tệp văn bản thường — không có đường thoát khỏi thư mục).
 *
 * ⚠ Chạy `git` bằng `execFile` với MẢNG đối số (không shell) và nguồn đứng SAU `--` ⇒ một "URL" bắt đầu bằng `-`
 *   (`--upload-pack=…`) không bao giờ thành một cờ. Nguồn bắt đầu bằng `-` còn bị từ chối từ cửa phán.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { namTrongHoacLa } from "../../aiLocalTools/khoCheckpoint";

export const BIEN_GIT_CLONE_ALLOW = "AI_GIT_CLONE_ALLOW";
export const BIEN_GIT_CLONE_TIMEOUT = "AI_GIT_CLONE_TIMEOUT_MS";
const HAN_GIO_CLONE_MAC_DINH = 120_000;
const HAN_GIO_GIT_NHO = 60_000;
const GIAO_THUC_URL = new Set(["https:", "http:", "ssh:", "git:"]);

export type MucDanhSachGit = { loai: "url"; url: URL } | { loai: "duong"; goc: string };

/** Danh sách trắng (đọc env TẠI CHỖ GỌI). Mục xấu bị BỎ (không làm hỏng các mục khác). */
export function danhSachTrangGit(): MucDanhSachGit[] {
  const raw = (process.env[BIEN_GIT_CLONE_ALLOW] ?? "").trim();
  if (raw === "") return [];
  const ra: MucDanhSachGit[] = [];
  for (const m of raw.split(";")) {
    const s = m.trim();
    if (s === "") continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        if (!GIAO_THUC_URL.has(u.protocol) || u.username !== "" || u.password !== "") continue;
        if (!u.pathname.endsWith("/")) u.pathname += "/";
        ra.push({ loai: "url", url: u });
      } catch {
        /* bỏ mục */
      }
    } else if (path.isAbsolute(s)) {
      try {
        ra.push({ loai: "duong", goc: fs.realpathSync.native(s) });
      } catch {
        /* thư mục không tồn tại ⇒ bỏ */
      }
    }
  }
  return ra;
}

export type MaLoiGit = "GIT_TAT" | "GIT_NGUON_KHONG_HOP_LE" | "GIT_NGOAI_DANH_SACH" | "GIT_CLONE_THAT_BAI" | "GIT_HET_GIO";

/**
 * ★★★ PHÁN một NGUỒN clone ⇒ chuỗi đưa cho `git clone` (URL; đường cục bộ thành `file://…` để `--depth 1` có
 * hiệu lực), hoặc mã từ chối. THUẦN trừ `realpath`.
 */
export function phanQuyetNguonGit(nguon: unknown): { ok: true; url: string } | { ok: false; ma: MaLoiGit } {
  const ds = danhSachTrangGit();
  if (ds.length === 0) return { ok: false, ma: "GIT_TAT" };
  const s = typeof nguon === "string" ? nguon.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (s === "" || s.length > 1024 || s.startsWith("-") || /[\s\u0000-\u001f]/.test(s)) {
    return { ok: false, ma: "GIT_NGUON_KHONG_HOP_LE" };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { ok: false, ma: "GIT_NGUON_KHONG_HOP_LE" };
    }
    if (!GIAO_THUC_URL.has(u.protocol) || u.username !== "" || u.password !== "") {
      return { ok: false, ma: "GIT_NGUON_KHONG_HOP_LE" };
    }
    const khop = ds.some(
      (m) =>
        m.loai === "url" &&
        m.url.protocol === u.protocol &&
        m.url.host.toLowerCase() === u.host.toLowerCase() &&
        (u.pathname + (u.pathname.endsWith("/") ? "" : "/")).startsWith(m.url.pathname),
    );
    return khop ? { ok: true, url: u.toString() } : { ok: false, ma: "GIT_NGOAI_DANH_SACH" };
  }
  if (!path.isAbsolute(s)) return { ok: false, ma: "GIT_NGUON_KHONG_HOP_LE" }; // `git@host:x` / tương đối
  let that: string;
  try {
    that = fs.realpathSync.native(s);
  } catch {
    return { ok: false, ma: "GIT_NGOAI_DANH_SACH" };
  }
  const khop = ds.some((m) => m.loai === "duong" && namTrongHoacLa(that, m.goc));
  return khop ? { ok: true, url: pathToFileURL(that).href } : { ok: false, ma: "GIT_NGOAI_DANH_SACH" };
}

/** Cờ cấu hình chung cho MỌI lệnh git ở đây (đứng trước tên lệnh con). */
export function coGitAnToan(thuMucKhongHook: string): string[] {
  return [
    "-c", `core.hooksPath=${thuMucKhongHook}`,
    "-c", "core.symlinks=false",
    "-c", "core.fsmonitor=false",
    "-c", "protocol.ext.allow=never",
    "-c", "submodule.recurse=false",
    "-c", "commit.gpgsign=false",
    "-c", "user.name=AI Local",
    "-c", "user.email=ai-local@localhost",
  ];
}

function moiTruongGit(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file:https:http:ssh:git",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "never",
  };
}

/** Kết quả THÔ của một lượt `git` (dùng chung cho cửa git dự án — Đợt 3b). */
export interface KetQuaChayGit {
  ok: boolean;
  hetGio: boolean;
  /** Mã thoát (`null` khi bị giết / không khởi động được). */
  ma: number | null;
  stdout: string;
  loi: string;
}

/**
 * ★★★ BỘ CHẠY `git` DUY NHẤT của thư mục này (và của cửa git dự án `ai/gitDuAn/cuaGitDuAn.ts` — Đợt 3b dùng lại, không
 * mở điểm sinh tiến trình thứ hai): `execFile` + MẢNG đối số (không shell), trần giờ, trần bộ đệm, cửa sổ ẩn. `env`
 * vắng ⇒ môi trường của clone/init (`moiTruongGit`); cửa git dự án truyền môi trường ĐÃ LỌC của nó.
 */
export function chayGitDauRa(
  args: string[],
  cwd: string,
  hanGio: number,
  tuyChon: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
): Promise<KetQuaChayGit> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: tuyChon.env ?? moiTruongGit(),
        timeout: hanGio,
        windowsHide: true,
        maxBuffer: tuyChon.maxBuffer ?? 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, hetGio: false, ma: 0, stdout: String(stdout ?? ""), loi: String(stderr ?? "") });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: number | string };
        resolve({
          ok: false,
          hetGio: e.killed === true || e.signal === "SIGTERM",
          ma: typeof e.code === "number" ? e.code : null,
          stdout: String(stdout ?? ""),
          loi: String(stderr || e.message).slice(0, 2000),
        });
      },
    );
  });
}

async function chayGit(args: string[], cwd: string, hanGio: number): Promise<{ ok: boolean; hetGio: boolean; loi: string }> {
  const kq = await chayGitDauRa(args, cwd, hanGio);
  return { ok: kq.ok, hetGio: kq.hetGio, loi: kq.loi };
}

/** Thư mục rỗng cho `core.hooksPath` (tạo nếu thiếu; có tệp lạ ⇒ dọn — "rỗng" là bất biến, không là lời khai). */
export function damBaoThuMucKhongHook(duong: string): string {
  fs.mkdirSync(duong, { recursive: true });
  for (const ten of fs.readdirSync(duong)) fs.rmSync(path.join(duong, ten), { recursive: true, force: true });
  return duong;
}

/**
 * ★★★ Clone `--depth 1` một nguồn ĐÃ QUA `phanQuyetNguonGit` vào `dich` (CHƯA tồn tại; thư mục cha tồn tại). Hết giờ
 * ⇒ `GIT_HET_GIO`. Hàm không dọn `dich` khi lỗi — người gọi sở hữu nó.
 */
export async function cloneGitNoiBo(
  nguon: unknown,
  dich: string,
  thuMucKhongHook: string,
): Promise<{ ok: true } | { ok: false; ma: MaLoiGit; chiTiet?: string }> {
  const pq = phanQuyetNguonGit(nguon);
  if (!pq.ok) return pq;
  const raw = Number((process.env[BIEN_GIT_CLONE_TIMEOUT] ?? "").trim());
  const hanGio = Number.isFinite(raw) && raw > 0 ? raw : HAN_GIO_CLONE_MAC_DINH;
  const kq = await chayGit(
    [
      ...coGitAnToan(thuMucKhongHook),
      "clone",
      "--depth", "1",
      "--single-branch",
      "--no-recurse-submodules",
      "--quiet",
      "--",
      pq.url,
      dich,
    ],
    path.dirname(dich),
    hanGio,
  );
  if (kq.ok) return { ok: true };
  return { ok: false, ma: kq.hetGio ? "GIT_HET_GIO" : "GIT_CLONE_THAT_BAI", chiTiet: kq.loi };
}

/** Đã là repo git (có `.git`) chưa — clone thì có, còn lại thì chưa. */
export function laRepoGit(goc: string): boolean {
  return fs.existsSync(path.join(goc, ".git"));
}

/**
 * ★★★ `git init` + `git add -A` + commit đầu (`--allow-empty` cho dự án rỗng, `--no-verify`). Repo đã có (clone) ⇒
 * không làm gì. Nhánh mặc định `main` (`-b`, git ≥ 2.28).
 */
export async function khoiTaoGitVaCommitDau(goc: string, ten: string, thuMucKhongHook: string): Promise<{ ok: boolean; loi?: string }> {
  if (laRepoGit(goc)) return { ok: true };
  const co = coGitAnToan(thuMucKhongHook);
  for (const args of [
    [...co, "init", "--quiet", "-b", "main"],
    [...co, "add", "-A"],
    [...co, "commit", "--quiet", "--allow-empty", "--no-verify", "-m", `Khởi tạo dự án: ${ten}`],
  ]) {
    const kq = await chayGit(args, goc, HAN_GIO_GIT_NHO);
    if (!kq.ok) return { ok: false, loi: kq.loi };
  }
  return { ok: true };
}
