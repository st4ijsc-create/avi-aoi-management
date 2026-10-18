/**
 * ★★★ Đợt 3b (3.4) — **CỬA GIT CÓ KIỂM SOÁT** cho bảng Git của `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * MỌI LỆNH GIT CỦA BẢNG GIT ĐI QUA ĐÚNG MỘT HÀM: `chayGitTrongRepo`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không có tham số nào biến thành một lệnh tuỳ ý: mỗi thao tác (trạng thái · diff · commit · nhánh · log) là một
 * hàm ở đây dựng argv HẰNG + đúng những ô đã kiểm (đường dẫn ⊂ danh sách trạng thái vừa đọc, tên nhánh qua hai lớp
 * kiểm, thông điệp đi trong MỘT phần tử argv). Bộ chạy là `chayGitDauRa` của Đợt 3a (execFile, mảng đối số, KHÔNG
 * shell, trần giờ) — không mở điểm sinh tiến trình thứ hai.
 *
 * Năm lớp, mỗi lớp độc lập:
 *   1. **Không hook nào chạy** — `core.hooksPath=<thư mục rỗng>` trên dòng lệnh (thắng mọi tầng cấu hình) + `--no-verify`
 *      cho commit. Đo ở `cuaGitDuAn.test.ts` bằng hook THẬT ở `.git/hooks` VÀ ở cấu hình toàn cục giả, có đối chứng.
 *   2. **Môi trường LỌC** (`moiTruongGitDaLoc`): KHÔNG kế thừa `process.env` — chỉ PATH/hệ thống/thư mục tạm; mọi
 *      `GIT_*` của tiến trình (GIT_DIR, GIT_WORK_TREE, GIT_SSH_COMMAND, GIT_CONFIG_*…) bị bỏ; cấu hình TOÀN CỤC của tài
 *      khoản chạy server trỏ về một TỆP RỖNG (`GIT_CONFIG_GLOBAL`) — không hook/alias/include/danh tính nào của máy
 *      dev lọt vào. Cấu hình HỆ THỐNG giữ lại (cài đặt Git do quản trị đặt: `core.autocrlf` của Git for Windows — bỏ
 *      nó thì `status` báo mọi tệp CRLF là đã sửa); các khoá nguy hiểm của nó bị `-c` ghi đè.
 *   3. **Repo phải ĐÚNG là gốc dự án** — `GIT_CEILING_DIRECTORIES` chặn git đi ngược lên thư mục cha, và
 *      `rev-parse --show-toplevel` (realpath) phải bằng gốc dự án. Dự án con nằm trong repo chính mà không có `.git`
 *      riêng ⇒ `GIT_KHONG_PHAI_REPO` (không bao giờ thao tác nhầm lên repo cha).
 *   4. **Repo chính CHỈ ĐỌC** — gốc dự án chồng lấn (realpath, hai chiều) `gocRepoChinh()` ⇒ trạng thái/diff/log/nhánh
 *      được, commit/tạo/chuyển nhánh ⇒ `GIT_REPO_CHINH_CHI_DOC`. Ghi còn đòi `.git` là THƯ MỤC THẬT (không tệp gitdir
 *      của worktree, không symlink/junction) — một "dự án" là worktree của repo khác không ghi được qua đây.
 *   5. **Tác giả commit = người dùng PHIÊN** — tên/email truyền vào từ `ctx.user` (router), đặt bằng
 *      `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (thắng mọi `user.name` cấu hình); KHÔNG lấy cấu hình git toàn cục.
 *
 * ⚠ Cửa này KHÔNG kiểm quyền người dùng (RBAC ở router: đọc = `ai_repo_read/canView`, ghi = `ai_repo_exec/canCreate`)
 *   và KHÔNG ghi audit (router ghi, có danh tính). Nó nhận một GỐC đã được `phanGiaiGoc(id, người gọi)` phán quyết.
 */
import fs from "node:fs";
import path from "node:path";
import { chayGitDauRa, coGitAnToan, damBaoThuMucKhongHook, type KetQuaChayGit } from "../duAnCaNhan/gitDuAnCaNhan";
import { kiemTraGocQuanLy } from "../duAnCaNhan/duAnCaNhan";
import { TEN_KHONG_HOOK } from "../../aiLocalTools/gocDuAnCaNhan";
import { namTrongHoacLa, realpathMotPhan } from "../../aiLocalTools/khoCheckpoint";
import { gocRepoChinh } from "../../aiCodingTuTriGhi";
import { duoiDuocPhep, moTepTrongHopCat, phanQuyetDuongDan, TRAN_BYTE_MOI_TEP } from "../../aiLocalTools/repoSandbox";
import { redactSecretsOnly } from "../aiSafety";

export const HAN_GIO_GIT_DOC_MS = 20_000;
export const HAN_GIO_GIT_GHI_MS = 60_000;
/** Trần số mục trạng thái trả về (repo chính có thể có hàng trăm tệp bẩn). */
export const TRAN_MUC_TRANG_THAI = 2_000;
/** Trần số tệp một lượt commit, và tổng ký tự đường dẫn (argv Windows ~32 K). */
export const TRAN_TEP_COMMIT = 200;
export const TRAN_KY_TU_DUONG_COMMIT = 20_000;
export const TRAN_THONG_DIEP = 2_000;
export const SO_LOG_MAC_DINH = 30;
/** Thư mục (dưới gốc quản lý) chứa HOME + tệp cấu hình toàn cục RỖNG cho mọi lượt git của cửa này. */
export const TEN_THU_MUC_GIT_RONG = ".git-rong";

export type MaLoiCuaGit =
  | "GIT_CHUA_SAN_SANG"
  | "GIT_KHONG_PHAI_REPO"
  | "GIT_REPO_CHINH_CHI_DOC"
  | "GIT_WORKTREE_CHI_DOC"
  | "GIT_CAY_BAN"
  | "GIT_TEN_NHANH_SAI"
  | "GIT_NHANH_DA_CO"
  | "GIT_NHANH_KHONG_CO"
  | "GIT_DUONG_KHONG_HOP_LE"
  | "GIT_KHONG_CO_TEP"
  | "GIT_QUA_NHIEU_TEP"
  | "GIT_THONG_DIEP_RONG"
  | "GIT_TEP_BI_CHAN"
  | "GIT_HET_GIO"
  | "GIT_THAT_BAI";

export type KetQuaGit<T> = ({ ok: true } & T) | { ok: false; ma: MaLoiCuaGit; chiTiet?: string };

/** Ngữ cảnh một repo đã phán quyết. */
export interface RepoGit {
  /** realpath gốc dự án = toplevel của repo. */
  goc: string;
  /** Gốc chồng lấn repo NỀN TẢNG (mã của chính server) ⇒ chỉ đọc. */
  laRepoChinh: boolean;
  /** Được commit/tạo/chuyển nhánh qua cửa này. */
  ghiDuoc: boolean;
}

export interface TacGiaGit {
  ten: string;
  email: string;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THƯ MỤC RỖNG + MÔI TRƯỜNG LỌC
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface ThuMucGitRong {
  hooks: string;
  home: string;
  cauHinhRong: string;
}

/**
 * Thư mục hook RỖNG (dùng lại `<gốc quản lý>/.khong-hook` của Đợt 3a) + HOME rỗng + tệp cấu hình toàn cục RỖNG. Gốc
 * quản lý hỏng (chồng lấn repo chính…) ⇒ `null` ⇒ người gọi trả `GIT_CHUA_SAN_SANG` (fail-closed: không có chỗ an toàn
 * cho thư mục rỗng thì không chạy git).
 */
function chuanBiThuMucRong(): ThuMucGitRong | null {
  const g = kiemTraGocQuanLy();
  if (!g.ok) return null;
  try {
    const hooks = damBaoThuMucKhongHook(path.join(g.goc, TEN_KHONG_HOOK));
    const home = path.join(g.goc, TEN_THU_MUC_GIT_RONG);
    fs.mkdirSync(home, { recursive: true });
    const cauHinhRong = path.join(home, "gitconfig-rong");
    // "rỗng" là BẤT BIẾN, không là lời khai: ghi lại 0 byte mỗi lượt.
    fs.writeFileSync(cauHinhRong, "");
    return { hooks, home, cauHinhRong };
  } catch {
    return null;
  }
}

/** Biến môi trường HỆ THỐNG được giữ (git cần để chạy; không biến nào đổi hành vi git). */
const BIEN_GIU = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SystemDrive", "SYSTEMDRIVE", "ProgramData", "ProgramFiles", "PROGRAMFILES", "NUMBER_OF_PROCESSORS"];

/**
 * ★★★ MÔI TRƯỜNG LỌC — danh sách GIỮ (không phải danh sách bỏ): biến lạ mặc định KHÔNG vào. Thuần (nhận nguồn) để lưới
 * hỏi thẳng.
 */
export function moiTruongGitDaLoc(
  nguon: NodeJS.ProcessEnv,
  y: { home: string; cauHinhRong: string; tran: string; tacGia?: TacGiaGit | null; chiDoc: boolean },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of BIEN_GIU) if (typeof nguon[k] === "string") env[k] = nguon[k];
  env.HOME = y.home;
  env.USERPROFILE = y.home;
  env.XDG_CONFIG_HOME = y.home;
  env.GIT_CONFIG_GLOBAL = y.cauHinhRong;
  env.GIT_CEILING_DIRECTORIES = y.tran;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_ALLOW_PROTOCOL = "file";
  env.GCM_INTERACTIVE = "never";
  if (y.chiDoc) env.GIT_OPTIONAL_LOCKS = "0";
  if (y.tacGia) {
    env.GIT_AUTHOR_NAME = y.tacGia.ten;
    env.GIT_AUTHOR_EMAIL = y.tacGia.email;
    env.GIT_COMMITTER_NAME = y.tacGia.ten;
    env.GIT_COMMITTER_EMAIL = y.tacGia.email;
  }
  return env;
}

/** Cờ `-c` THÊM (sau `coGitAnToan`): khoá mọi đường git tự chạy một chương trình ngoài. */
const CO_THEM: readonly string[] = [
  "-c", "core.pager=cat",
  "-c", "core.editor=false",
  "-c", "core.quotePath=false",
  "-c", "core.sshCommand=false",
  "-c", "diff.external=",
  "-c", "log.showSignature=false",
  "-c", "credential.helper=",
  "-c", "gpg.program=false",
];

/**
 * ★★★ CỬA DUY NHẤT — chạy MỘT lệnh git con trong repo đã phán quyết. `args` do các hàm ở tệp này dựng (không có lối
 * vào từ ngoài tệp — hàm KHÔNG xuất khẩu).
 */
async function chayGitTrongRepo(
  repo: RepoGit,
  args: string[],
  y: { ghi?: boolean; tacGia?: TacGiaGit | null; maxBuffer?: number } = {},
): Promise<KetQuaChayGit | { ok: false; chuaSan: true }> {
  const rong = chuanBiThuMucRong();
  if (!rong) return { ok: false, chuaSan: true };
  const env = moiTruongGitDaLoc(process.env, {
    home: rong.home,
    cauHinhRong: rong.cauHinhRong,
    tran: path.dirname(repo.goc),
    tacGia: y.tacGia ?? null,
    chiDoc: y.ghi !== true,
  });
  return chayGitDauRa(
    [...coGitAnToan(rong.hooks), ...CO_THEM, "--no-pager", ...args],
    repo.goc,
    y.ghi ? HAN_GIO_GIT_GHI_MS : HAN_GIO_GIT_DOC_MS,
    { env, maxBuffer: y.maxBuffer ?? 8 * 1024 * 1024 },
  );
}

function loiTuKetQua(kq: KetQuaChayGit | { ok: false; chuaSan: true }): { ok: false; ma: MaLoiCuaGit; chiTiet?: string } {
  if ("chuaSan" in kq) return { ok: false, ma: "GIT_CHUA_SAN_SANG" };
  if (kq.hetGio) return { ok: false, ma: "GIT_HET_GIO" };
  return { ok: false, ma: "GIT_THAT_BAI", chiTiet: kq.loi.slice(0, 500) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÁN QUYẾT REPO
// ══════════════════════════════════════════════════════════════════════════════════════════════

function cung(a: string, b: string): boolean {
  return namTrongHoacLa(a, b) && namTrongHoacLa(b, a);
}

/**
 * ★★★ Gốc dự án (đã qua `phanGiaiGoc`) ⇒ repo git của ĐÚNG thư mục ấy, kèm cờ chỉ-đọc. `gocChinh` chỉ để lưới tiêm.
 */
export async function phanGiaiRepoGit(goc: string, gocChinh: string = gocRepoChinh()): Promise<KetQuaGit<{ repo: RepoGit }>> {
  let that: string;
  try {
    that = fs.realpathSync.native(goc);
  } catch {
    return { ok: false, ma: "GIT_KHONG_PHAI_REPO" };
  }
  let stGit: fs.Stats;
  try {
    stGit = fs.lstatSync(path.join(that, ".git"));
  } catch {
    return { ok: false, ma: "GIT_KHONG_PHAI_REPO" };
  }
  if (stGit.isSymbolicLink()) return { ok: false, ma: "GIT_KHONG_PHAI_REPO" };
  const chinh = realpathMotPhan(gocChinh);
  const laRepoChinh = namTrongHoacLa(that, chinh) || namTrongHoacLa(chinh, that);
  const repo: RepoGit = { goc: that, laRepoChinh, ghiDuoc: !laRepoChinh && stGit.isDirectory() };
  const kq = await chayGitTrongRepo(repo, ["rev-parse", "--show-toplevel"]);
  if (!kq.ok) {
    if ("chuaSan" in kq) return { ok: false, ma: "GIT_CHUA_SAN_SANG" };
    return { ok: false, ma: kq.hetGio ? "GIT_HET_GIO" : "GIT_KHONG_PHAI_REPO" };
  }
  const top = kq.stdout.trim();
  let topThat = "";
  try {
    topThat = fs.realpathSync.native(path.resolve(top));
  } catch {
    return { ok: false, ma: "GIT_KHONG_PHAI_REPO" };
  }
  if (!cung(topThat, that)) return { ok: false, ma: "GIT_KHONG_PHAI_REPO" };
  return { ok: true, repo };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRẠNG THÁI
// ══════════════════════════════════════════════════════════════════════════════════════════════

export interface MucTrangThai {
  /** Đường TƯƠNG ĐỐI (dấu `/`) so với gốc. */
  path: string;
  /** Đường cũ khi đổi tên/chép (`R`/`C` đã staged). */
  tuDuong: string | null;
  /** Hai ký tự porcelain `XY`. */
  xy: string;
}

export interface TrangThaiRepo {
  nhanh: string | null;
  chuaCoCommit: boolean;
  muc: MucTrangThai[];
  /** Số mục BỊ ẨN theo chính sách hộp cát (.env, node_modules…) — đếm để không im lặng, KHÔNG nêu tên. */
  soAn: number;
  /** Tổng số mục thật (kể cả bị ẩn) — `> 0` ⇔ cây BẨN. */
  tongThat: number;
  catBot: boolean;
  laRepoChinh: boolean;
  ghiDuoc: boolean;
}

/** Phân tích `status --porcelain=v1 -z --branch`. THUẦN. */
export function phanTichPorcelain(raw: string): { nhanh: string | null; chuaCoCommit: boolean; muc: MucTrangThai[] } {
  const tok = raw.split("\0");
  let nhanh: string | null = null;
  let chuaCoCommit = false;
  const muc: MucTrangThai[] = [];
  for (let i = 0; i < tok.length; i++) {
    const s = tok[i]!;
    if (s === "") continue;
    if (s.startsWith("## ")) {
      let h = s.slice(3);
      const m = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(h);
      if (m) {
        chuaCoCommit = true;
        h = m[1]!;
      }
      if (h.startsWith("HEAD (no branch)")) nhanh = null;
      else nhanh = h.split("...")[0]!.split(" ")[0]! || null;
      continue;
    }
    if (s.length < 4) continue;
    const xy = s.slice(0, 2);
    const p = s.slice(3);
    let tuDuong: string | null = null;
    if (xy[0] === "R" || xy[0] === "C") {
      tuDuong = tok[i + 1] ?? null;
      i++;
    }
    muc.push({ path: p, tuDuong, xy });
  }
  return { nhanh, chuaCoCommit, muc };
}

function anTheoChinhSach(p: string): boolean {
  return phanQuyetDuongDan(p) !== null;
}

export async function trangThai(repo: RepoGit): Promise<KetQuaGit<{ tt: TrangThaiRepo }>> {
  const kq = await chayGitTrongRepo(repo, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"]);
  if (!kq.ok) return loiTuKetQua(kq);
  const pt = phanTichPorcelain(kq.stdout);
  const hien = pt.muc.filter((m) => !anTheoChinhSach(m.path) && (m.tuDuong === null || !anTheoChinhSach(m.tuDuong)));
  return {
    ok: true,
    tt: {
      nhanh: pt.nhanh,
      chuaCoCommit: pt.chuaCoCommit,
      muc: hien.slice(0, TRAN_MUC_TRANG_THAI),
      soAn: pt.muc.length - hien.length,
      tongThat: pt.muc.length,
      catBot: hien.length > TRAN_MUC_TRANG_THAI,
      laRepoChinh: repo.laRepoChinh,
      ghiDuoc: repo.ghiDuoc,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DIFF MỘT TỆP — hai bản văn đã che bí mật, cho `HunkDiffView readOnly` ở client
// ══════════════════════════════════════════════════════════════════════════════════════════════

export interface DiffTep {
  path: string;
  xy: string;
  /** Bản ở HEAD ("" khi tệp mới / chưa có commit). */
  goc: string;
  /** Bản trên đĩa ("" khi tệp đã xoá). */
  moi: string;
  nhiPhan: boolean;
  catBot: boolean;
  daChe: boolean;
}

function coNul(s: string): boolean {
  return s.includes("\u0000");
}

export async function diffTep(repo: RepoGit, rel: string, khoaNganSach: string): Promise<KetQuaGit<{ diff: DiffTep }>> {
  const tt = await trangThai(repo);
  if (!tt.ok) return tt;
  const m = tt.tt.muc.find((x) => x.path === rel);
  if (!m) return { ok: false, ma: "GIT_DUONG_KHONG_HOP_LE" };
  const ten = rel.split("/").pop() ?? "";
  if (!duoiDuocPhep(ten)) {
    return { ok: true, diff: { path: rel, xy: m.xy, goc: "", moi: "", nhiPhan: true, catBot: false, daChe: false } };
  }
  // ── bản HEAD (qua cửa git, đọc blob THÔ: `cat-file blob` không chạy textconv/bộ lọc) ──
  let goc = "";
  let catBot = false;
  let nhiPhan = false;
  let daChe = false;
  const duongHead = m.tuDuong ?? rel;
  if (!tt.tt.chuaCoCommit && m.xy !== "??" && m.xy[0] !== "A") {
    const co = await chayGitTrongRepo(repo, ["cat-file", "-s", `HEAD:${duongHead}`]);
    if (co.ok) {
      const kichThuoc = Number(co.stdout.trim());
      if (Number.isFinite(kichThuoc) && kichThuoc > TRAN_BYTE_MOI_TEP) {
        catBot = true;
      } else {
        const blob = await chayGitTrongRepo(repo, ["cat-file", "blob", `HEAD:${duongHead}`]);
        if (!blob.ok) return loiTuKetQua(blob);
        if (coNul(blob.stdout)) nhiPhan = true;
        else {
          const che = redactSecretsOnly(blob.stdout);
          goc = che.text;
          daChe = daChe || che.text !== blob.stdout;
        }
      }
    }
  }
  // ── bản trên đĩa (qua CỬA ĐỌC hộp cát: chính sách · realpath · fd · che bí mật · ngân sách) ──
  let moi = "";
  const laXoa = m.xy[0] === "D" || m.xy[1] === "D";
  if (!laXoa) {
    const doc = moTepTrongHopCat(rel, { goc: repo.goc, khoaNganSach });
    if (!doc.ok) {
      if (doc.ma !== "NOT_FOUND") return { ok: false, ma: "GIT_TEP_BI_CHAN", chiTiet: doc.ma };
    } else {
      if (coNul(doc.noiDung)) nhiPhan = true;
      moi = doc.noiDung;
      catBot = catBot || doc.catBot;
      daChe = daChe || doc.daChe;
    }
  }
  if (nhiPhan || catBot) {
    goc = "";
    moi = "";
  }
  return { ok: true, diff: { path: rel, xy: m.xy, goc, moi, nhiPhan, catBot, daChe } };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NHÁNH + LOG
// ══════════════════════════════════════════════════════════════════════════════════════════════

export async function danhSachNhanh(repo: RepoGit): Promise<KetQuaGit<{ nhanh: string[]; hienTai: string | null }>> {
  const kq = await chayGitTrongRepo(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  if (!kq.ok) return loiTuKetQua(kq);
  const nhanh = kq.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 500);
  const ht = await chayGitTrongRepo(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return { ok: true, nhanh, hienTai: ht.ok ? ht.stdout.trim() || null : null };
}

export interface DongLog {
  hash: string;
  ngan: string;
  tacGia: string;
  email: string;
  luc: number;
  tieuDe: string;
}

export async function logNgan(repo: RepoGit, so = SO_LOG_MAC_DINH): Promise<KetQuaGit<{ dong: DongLog[] }>> {
  const n = Math.max(1, Math.min(100, Math.floor(so)));
  const kq = await chayGitTrongRepo(repo, ["log", `-n${n}`, "--no-color", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e"]);
  if (!kq.ok) {
    // repo chưa có commit nào: git thoát ≠ 0 — đó là "log rỗng", không phải lỗi.
    if (!("chuaSan" in kq) && /does not have any commits|bad default revision/i.test(kq.loi)) return { ok: true, dong: [] };
    return loiTuKetQua(kq);
  }
  const dong: DongLog[] = [];
  for (const r of kq.stdout.split("\x1e")) {
    const s = r.replace(/^\r?\n/, "");
    if (!s) continue;
    const [hash, ngan, tacGia, email, luc, tieuDe] = s.split("\x1f");
    if (!hash) continue;
    dong.push({ hash, ngan: ngan ?? "", tacGia: tacGia ?? "", email: email ?? "", luc: Number(luc) || 0, tieuDe: tieuDe ?? "" });
  }
  return { ok: true, dong };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GHI — commit · tạo nhánh · chuyển nhánh
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tên nhánh: lớp 1 (thuần, ở đây) — ký tự an toàn, không bắt đầu `-`, không `..`/`//`/`@{`, không kết thúc `.lock`/`/`/
 * `.`; lớp 2 — `git check-ref-format --branch` (luật thật của git) trong `taoNhanh`.
 */
export function tenNhanhHopLe(x: unknown): x is string {
  if (typeof x !== "string") return false;
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(x)) return false;
  if (x.startsWith("-") || x.startsWith("/") || x.startsWith(".")) return false;
  if (x.includes("..") || x.includes("//") || x.includes("/.")) return false;
  if (x.endsWith(".lock") || x.endsWith("/") || x.endsWith(".")) return false;
  return x !== "HEAD";
}

/** Tác giả từ danh tính PHIÊN: bỏ ký tự phá định dạng `Tên <email>`; email méo ⇒ địa chỉ nội bộ theo id. THUẦN. */
export function tacGiaTuPhien(u: { id: number; name?: string | null; username?: string | null; email?: string | null }): TacGiaGit {
  // eslint-disable-next-line no-control-regex
  const sach = (s: string) => s.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  const ten = sach(String(u.name ?? "")) || sach(String(u.username ?? "")) || `user${u.id}`;
  const e = sach(String(u.email ?? ""));
  const email = /^[^\s@]+@[^\s@]+$/.test(e) ? e : `u${u.id}@ai-local.invalid`;
  return { ten, email };
}

/** Thông điệp commit: bỏ NUL/ký tự điều khiển (giữ xuống dòng/tab), cắt trần. THUẦN. */
export function chuanHoaThongDiep(x: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(x ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, TRAN_THONG_DIEP);
}

function chiGhi(repo: RepoGit): { ok: false; ma: MaLoiCuaGit } | null {
  if (repo.laRepoChinh) return { ok: false, ma: "GIT_REPO_CHINH_CHI_DOC" };
  if (!repo.ghiDuoc) return { ok: false, ma: "GIT_WORKTREE_CHI_DOC" };
  return null;
}

/**
 * ★★★ Commit ĐÚNG các tệp đã chọn. Mỗi đường phải có trong danh sách trạng thái HIỂN THỊ vừa đọc (không đường tuỳ
 * ý, không pathspec ma thuật — `GIT_LITERAL_PATHSPECS=1`). `add -A -- <tệp>` (gồm cả xoá) rồi `commit --only` theo đúng
 * các tệp ấy: thứ khác đã staged từ trước KHÔNG lọt vào commit này.
 */
export async function commitTep(
  repo: RepoGit,
  duong: readonly string[],
  thongDiep: unknown,
  tacGia: TacGiaGit,
): Promise<KetQuaGit<{ hash: string; soTep: number }>> {
  const cam = chiGhi(repo);
  if (cam) return cam;
  const td = chuanHoaThongDiep(thongDiep);
  if (td === "") return { ok: false, ma: "GIT_THONG_DIEP_RONG" };
  const chon = [...new Set(duong)];
  if (chon.length === 0) return { ok: false, ma: "GIT_KHONG_CO_TEP" };
  if (chon.length > TRAN_TEP_COMMIT) return { ok: false, ma: "GIT_QUA_NHIEU_TEP" };
  const tt = await trangThai(repo);
  if (!tt.ok) return tt;
  const theoDuong = new Map(tt.tt.muc.map((m) => [m.path, m]));
  const pathspec: string[] = [];
  for (const p of chon) {
    const m = theoDuong.get(p);
    if (!m) return { ok: false, ma: "GIT_DUONG_KHONG_HOP_LE", chiTiet: p.slice(0, 200) };
    pathspec.push(m.path);
    if (m.tuDuong) pathspec.push(m.tuDuong);
  }
  if (pathspec.reduce((s, p) => s + p.length + 1, 0) > TRAN_KY_TU_DUONG_COMMIT) return { ok: false, ma: "GIT_QUA_NHIEU_TEP" };
  const add = await chayGitTrongRepo(repo, ["add", "-A", "--", ...pathspec], { ghi: true, tacGia });
  if (!add.ok) return loiTuKetQua(add);
  const ci = await chayGitTrongRepo(
    repo,
    ["commit", "--quiet", "--no-verify", "--no-gpg-sign", "--no-edit", "-m", td, "--only", "--", ...pathspec],
    { ghi: true, tacGia },
  );
  if (!ci.ok) return loiTuKetQua(ci);
  const h = await chayGitTrongRepo(repo, ["rev-parse", "HEAD"]);
  return { ok: true, hash: h.ok ? h.stdout.trim() : "", soTep: chon.length };
}

async function camKhiBan(repo: RepoGit): Promise<{ ok: false; ma: MaLoiCuaGit; chiTiet?: string } | null> {
  const tt = await trangThai(repo);
  if (!tt.ok) return tt;
  // ⚠ đếm TẤT CẢ (kể cả mục bị ẩn theo chính sách và tệp chưa track): "cây bẩn" là sự thật của đĩa, không của danh sách.
  if (tt.tt.tongThat > 0) return { ok: false, ma: "GIT_CAY_BAN", chiTiet: String(tt.tt.tongThat) };
  return null;
}

export async function taoNhanh(repo: RepoGit, ten: unknown): Promise<KetQuaGit<{ nhanh: string }>> {
  const cam = chiGhi(repo);
  if (cam) return cam;
  if (!tenNhanhHopLe(ten)) return { ok: false, ma: "GIT_TEN_NHANH_SAI" };
  const ck = await chayGitTrongRepo(repo, ["check-ref-format", "--branch", ten]);
  if (!ck.ok) return "chuaSan" in ck ? loiTuKetQua(ck) : { ok: false, ma: "GIT_TEN_NHANH_SAI" };
  const ds = await danhSachNhanh(repo);
  if (!ds.ok) return ds;
  if (ds.nhanh.includes(ten)) return { ok: false, ma: "GIT_NHANH_DA_CO" };
  const ban = await camKhiBan(repo);
  if (ban) return ban;
  const kq = await chayGitTrongRepo(repo, ["switch", "--quiet", "--no-guess", "-c", ten], { ghi: true });
  if (!kq.ok) return loiTuKetQua(kq);
  return { ok: true, nhanh: ten };
}

export async function chuyenNhanh(repo: RepoGit, ten: unknown): Promise<KetQuaGit<{ nhanh: string }>> {
  const cam = chiGhi(repo);
  if (cam) return cam;
  if (!tenNhanhHopLe(ten)) return { ok: false, ma: "GIT_TEN_NHANH_SAI" };
  const ds = await danhSachNhanh(repo);
  if (!ds.ok) return ds;
  if (!ds.nhanh.includes(ten)) return { ok: false, ma: "GIT_NHANH_KHONG_CO" };
  if (ds.hienTai === ten) return { ok: true, nhanh: ten };
  const ban = await camKhiBan(repo);
  if (ban) return ban;
  const kq = await chayGitTrongRepo(repo, ["switch", "--quiet", "--no-guess", ten], { ghi: true });
  if (!kq.ok) return loiTuKetQua(kq);
  return { ok: true, nhanh: ten };
}

/**
 * Diff GỘP (đã che bí mật, cắt trần) của các tệp được chọn — nguyên liệu cho "Gợi ý thông điệp". Chỉ ĐỌC. Tệp chưa
 * track không có trong `git diff HEAD` ⇒ chỉ nêu tên.
 */
export async function diffGopChoGoiY(repo: RepoGit, duong: readonly string[], tranKyTu = 6_000): Promise<KetQuaGit<{ van: string }>> {
  const tt = await trangThai(repo);
  if (!tt.ok) return tt;
  const theoDuong = new Map(tt.tt.muc.map((m) => [m.path, m]));
  const daTrack: string[] = [];
  const moi: string[] = [];
  for (const p of duong.slice(0, TRAN_TEP_COMMIT)) {
    const m = theoDuong.get(p);
    if (!m) continue;
    if (m.xy === "??") moi.push(p);
    else daTrack.push(p);
  }
  let van = "";
  if (daTrack.length > 0 && !tt.tt.chuaCoCommit) {
    const kq = await chayGitTrongRepo(repo, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--stat", "-p", "HEAD", "--", ...daTrack]);
    if (kq.ok) van = redactSecretsOnly(kq.stdout).text;
  }
  const dauMoi = moi.length + (tt.tt.chuaCoCommit ? daTrack.length : 0) > 0
    ? `Tệp mới: ${[...moi, ...(tt.tt.chuaCoCommit ? daTrack : [])].join(", ")}\n`
    : "";
  return { ok: true, van: (dauMoi + van).slice(0, tranKyTu) };
}
