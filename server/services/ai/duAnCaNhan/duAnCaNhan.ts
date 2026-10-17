/**
 * ★★★ Đợt 3a (2026-10-17, quyết định Q3 của chủ dự án) — **DỰ ÁN CÁ NHÂN CỦA KỸ SƯ**: tạo · đổi tên · xoá (thùng rác)
 * trong GỐC QUẢN LÝ `AI_PROJECTS_ROOT`, không cần admin/2FA, không cần thư mục có sẵn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KỸ SƯ ĐƯỢC LÀM VIỆC MÀ TRƯỚC ĐÂY CHỈ ADMIN + 2FA LÀM (`themDuAn`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `themDuAn` nhận một ĐƯỜNG DẪN TUỲ Ý trên máy chủ ⇒ mở một thư mục bất kỳ cho AI đọc/ghi ⇒ đúng là việc quản trị hạ
 * tầng. Ở đây KHÔNG có đường dẫn nào đi từ client: server tự chọn chỗ (`<gốc>/u<id>/<id dự án>`), thư mục do chính
 * server TẠO MỚI (rỗng/khuôn/zip/clone), và chỉ chủ (cùng admin) phân giải được nó. Quyền tối thiểu hợp lý vì thế là
 * quyền đã cho phép người dùng **ghi đĩa qua AI**: `ai_repo_exec/canCreate` (mig 0331 cấp cho engineer+admin) cộng
 * `ai_repo_read/canView` (để thấy được thứ mình tạo). Thiếu một trong hai ⇒ từ chối ở router (fail-closed).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TRẦN — chống lấp đĩa máy chủ xưởng: số dự án / người (20) + dung lượng / người (2 GiB) + một lượt tạo / người
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dung lượng đo bằng cách ĐI cây thư mục người dùng (lstat, không theo symlink, dừng sớm khi vượt) — không tin một con
 * số lưu ở đâu đó. Một lượt tạo / người cùng lúc (khoá trong tiến trình): hai lượt song song không qua mặt được trần
 * số dự án, và một người không chạy được mười lượt clone cùng lúc.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * XOÁ = CHUYỂN VÀO THÙNG RÁC `<gốc>/.thung-rac/<thời điểm>__<id>`, xoá cứng sau 30 ngày
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mã của kỹ sư là thứ không tái tạo được; một cú bấm nhầm không được là mất trắng. Thùng rác nằm NGOÀI mọi thư mục
 * người dùng (không tính vào dung lượng, không phân giải được thành dự án). Dọn hạn chạy cơ hội mỗi lượt tạo/xoá.
 *
 * ⚠ VÌ SAO THƯ MỤC NÀY NẰM NGOÀI `aiLocalTools/`: cây ấy là đường THỰC THI TOOL của model, và census M3
 *   (`programmingFileIo.census.test.ts`) ghim mọi lượt chạm byte của nó vào đúng bốn hàm cửa. Ở đây là vòng đời dự án
 *   do NGƯỜI bấm (tạo/giải nén/chép khuôn/thùng rác) — model không gọi tới được. Đặt chung cây sẽ phải nới lưới M3
 *   (mất tín hiệu "đường thoát mới của tool"); tách cây giữ lưới nguyên vẹn. Chỉ vị từ chỗ-đứng (không chạm byte)
 *   ở lại `aiLocalTools/gocDuAnCaNhan.ts` vì `repoProjects` cần nó.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { gocHopCat } from "../../aiLocalTools/repoSandbox";
import { danhSachDuAn, napLaiDuAnTuDb } from "../../aiLocalTools/repoProjects";
import { gocQuanLy, thuMucNguoiDung, TEN_KHONG_HOOK, TEN_THUNG_RAC, duAnCaNhanDungCho } from "../../aiLocalTools/gocDuAnCaNhan";
import { duongKhoCheckpoint, namTrongHoacLa, realpathMotPhan } from "../../aiLocalTools/khoCheckpoint";
import { giaiNenZipAnToan, TRAN_BYTE_ZIP_TAI_LEN, type MaLoiZip } from "./nhapZipAnToan";
import { cloneGitNoiBo, damBaoThuMucKhongHook, khoiTaoGitVaCommitDau, type MaLoiGit } from "./gitDuAnCaNhan";
import { gocRepoChinh } from "../../aiCodingTuTriGhi";

export const TRAN_DU_AN_MOI_NGUOI_MAC_DINH = 20;
export const TRAN_BYTE_MOI_NGUOI_MAC_DINH = 2 * 1024 * 1024 * 1024;
export const HAN_THUNG_RAC_MS = 30 * 24 * 60 * 60 * 1000;
export const KHUON_CO_SAN = ["node-ts", "python", "csharp-console", "react-vite"] as const;
export type TenKhuon = (typeof KHUON_CO_SAN)[number];
export type CachTao = "rong" | "khuon" | "zip" | "git";
const CACH_TAO: ReadonlySet<string> = new Set(["rong", "khuon", "zip", "git"]);
/** Đoạn KHÔNG chép khi tạo từ khuôn (tạo tác build lỡ nằm trong khuôn của repo). */
const BO_QUA_KHI_CHEP_KHUON: ReadonlySet<string> = new Set(["node_modules", ".git", "bin", "obj", "dist", "__pycache__", ".venv"]);

function soEnv(bien: string, macDinh: number): number {
  const n = Number((process.env[bien] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : macDinh;
}
export const tranDuAnMoiNguoi = (): number => soEnv("AI_PROJECTS_MAX_PER_USER", TRAN_DU_AN_MOI_NGUOI_MAC_DINH);
export const tranByteMoiNguoi = (): number => soEnv("AI_PROJECTS_MAX_BYTES_PER_USER", TRAN_BYTE_MOI_NGUOI_MAC_DINH);

/** Thư mục chứa khuôn: `<repo chính>/sandbox-projects/khuon` (chép OFFLINE, không mạng). Env ghi đè cho lưới. */
export function thuMucKhuon(): string {
  const raw = (process.env.AI_PROJECT_TEMPLATES_DIR ?? "").trim();
  return raw !== "" && path.isAbsolute(raw) ? raw : path.join(gocRepoChinh(), "sandbox-projects", "khuon");
}

export type MaLoiDuAnCaNhan =
  | "GOC_QUAN_LY_KHONG_HOP_LE"
  | "TEN_KHONG_HOP_LE"
  | "CACH_TAO_KHONG_HOP_LE"
  | "KHUON_KHONG_CO"
  | "ZIP_THIEU"
  | "VUOT_TRAN_SO_DU_AN"
  | "VUOT_TRAN_DUNG_LUONG"
  | "DANG_TAO"
  | "KHONG_DEM_DUOC"
  | "GIT_INIT_THAT_BAI"
  | "LUU_THAT_BAI"
  | "KHONG_TIM_THAY"
  | "XOA_THAT_BAI"
  | MaLoiZip
  | MaLoiGit;

export type KetQua<T> = ({ ok: true } & T) | { ok: false; ma: MaLoiDuAnCaNhan; chiTiet?: string };

/** Tên hiển thị: 1..100 ký tự, cấm `#;=|` — CÙNG luật CHECK 0337 (tên còn xuất ngược ra dòng env được). */
export function chuanHoaTen(ten: unknown): string | null {
  const s = typeof ten === "string" ? ten.trim() : "";
  if (s.length < 1 || s.length > 100 || /[#;=|]/.test(s)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(s)) return null;
  return s;
}

/**
 * ★★★ GỐC QUẢN LÝ HỢP LỆ ⇔ tuyệt đối, tạo được, và KHÔNG chồng lấn (nằm trong HOẶC chứa — so cả chữ lẫn realpath):
 * repo chính, gốc hộp cát mặc định, mọi dự án env/admin, kho checkpoint. Vì sao từng mục:
 *   • repo chính / hộp cát: agent TỰ ĐỘNG được bật trên dự án cá nhân (Q1 chỉ chặn repo chính) — gốc nằm trong repo
 *     chính thì "dự án cá nhân" là cửa sau ghi vào mã của chính server;
 *   • dự án env/admin: hai hộp cát lồng nhau = cùng tệp hai chủ;
 *   • kho checkpoint: agent ghi được vào dự án cá nhân ⇒ ghi đè được manifest hoàn tác (rà bảo mật a5f56d089).
 */
export function kiemTraGocQuanLy(): KetQua<{ goc: string }> {
  const goc = gocQuanLy();
  if (!path.isAbsolute(goc)) return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: "không tuyệt đối" };
  const cam: string[] = [gocRepoChinh(), gocHopCat(), duongKhoCheckpoint()];
  for (const d of danhSachDuAn()) if (d.chuSoHuu === undefined) cam.push(d.goc);
  const gocThat = realpathMotPhan(goc);
  for (const c of cam) {
    const cThat = realpathMotPhan(c);
    if (namTrongHoacLa(goc, c) || namTrongHoacLa(c, goc) || namTrongHoacLa(gocThat, cThat) || namTrongHoacLa(cThat, gocThat)) {
      return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: `chồng lấn "${c}"` };
    }
  }
  try {
    fs.mkdirSync(goc, { recursive: true });
    return { ok: true, goc: fs.realpathSync.native(goc) };
  } catch (e) {
    return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Thư mục của người dùng: tạo nếu thiếu; PHẢI là thư mục THẬT (lstat — không symlink/junction) và realpath là con
 * TRỰC TIẾP của realpath(gốc). Junction `u5 → C:\` ⇒ từ chối.
 */
export function damBaoThuMucNguoiDung(userId: number, gocThat: string): KetQua<{ duong: string }> {
  const duong = thuMucNguoiDung(userId, gocThat);
  try {
    fs.mkdirSync(duong, { recursive: true });
    const st = fs.lstatSync(duong);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: "thư mục người dùng là symlink/junction" };
    }
    const that = fs.realpathSync.native(duong);
    const cha = path.dirname(that);
    const khac = process.platform === "win32" ? cha.toLowerCase() !== gocThat.toLowerCase() : cha !== gocThat;
    if (khac) {
      return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: "thư mục người dùng trỏ ra ngoài gốc" };
    }
    return { ok: true, duong: that };
  } catch (e) {
    return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: (e as Error)?.message ?? String(e) };
  }
}

/** Tổng byte một cây (lstat, KHÔNG theo symlink); dừng sớm khi vượt `tran` (trả `tran + 1`). */
export function dungLuongThuMuc(goc: string, tran: number = Number.MAX_SAFE_INTEGER): number {
  let tong = 0;
  const ngan: string[] = [goc];
  while (ngan.length > 0) {
    const d = ngan.pop()!;
    let muc: fs.Dirent[];
    try {
      muc = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const m of muc) {
      const p = path.join(d, m.name);
      if (m.isSymbolicLink()) continue;
      if (m.isDirectory()) {
        ngan.push(p);
        continue;
      }
      try {
        tong += fs.lstatSync(p).size;
      } catch {
        /* tệp biến mất giữa chừng */
      }
      if (tong > tran) return tran + 1;
    }
  }
  return tong;
}

/** Chép khuôn (thư mục trong repo) — bỏ symlink và tạo tác build. THUẦN về hệ tệp. */
function chepKhuon(nguon: string, dich: string): void {
  for (const m of fs.readdirSync(nguon, { withFileTypes: true })) {
    if (m.isSymbolicLink() || BO_QUA_KHI_CHEP_KHUON.has(m.name.toLowerCase())) continue;
    const a = path.join(nguon, m.name);
    const b = path.join(dich, m.name);
    if (m.isDirectory()) {
      fs.mkdirSync(b, { recursive: true });
      chepKhuon(a, b);
    } else if (m.isFile()) {
      fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
    }
  }
}

/** Dọn thùng rác: mục `<epochMs>__<id>` quá hạn ⇒ xoá cứng. Lỗi từng mục bị nuốt (lượt sau dọn tiếp). */
export function donThungRac(gocThat: string, bayGio: number = Date.now()): number {
  const thung = path.join(gocThat, TEN_THUNG_RAC);
  let n = 0;
  let muc: string[];
  try {
    muc = fs.readdirSync(thung);
  } catch {
    return 0;
  }
  for (const ten of muc) {
    const luc = Number(ten.split("__")[0]);
    if (!Number.isFinite(luc) || bayGio - luc < HAN_THUNG_RAC_MS) continue;
    try {
      fs.rmSync(path.join(thung, ten), { recursive: true, force: true });
      n++;
    } catch {
      /* lượt sau */
    }
  }
  return n;
}

/** Tầng dữ liệu tiêm được (lưới thay bằng bộ nhớ khi không cần CSDL). Mặc định = `server/db/aiRepoDuAn`. */
export interface KhoDuAnCaNhan {
  dem(chuSoHuu: number): Promise<number | null>;
  them(muc: { id: string; ten: string; goc: string; nguoiTao: number; chuSoHuu: number; cachTao: CachTao }): Promise<{ ok: boolean }>;
  doc(id: string): Promise<{ id: string; ten: string; goc: string; chuSoHuu?: number | null } | null>;
  doiTen(id: string, chuSoHuu: number, ten: string): Promise<{ ok: boolean }>;
  xoa(id: string): Promise<{ ok: boolean }>;
  napLai(): Promise<unknown>;
}

async function khoMacDinh(): Promise<KhoDuAnCaNhan> {
  const db = await import("../../../db/aiRepoDuAn");
  return {
    dem: db.demDuAnCaNhanDb,
    them: db.themDuAnDb,
    doc: db.docDuAnDb,
    doiTen: db.doiTenDuAnCaNhanDb,
    xoa: db.xoaDuAnDb,
    napLai: napLaiDuAnTuDb,
  };
}

const dangTao = new Set<number>();

export interface YeuCauTaoDuAn {
  userId: number;
  ten: unknown;
  cachTao: unknown;
  khuon?: unknown;
  /** ZIP đã giải mã base64 (router lo phần mã hoá + trần byte tải lên). */
  zip?: Buffer | null;
  nguonGit?: unknown;
}

/**
 * ★★★ TẠO một dự án cá nhân. Thứ tự: hình dạng (rẻ) → gốc + thư mục người dùng → trần số → khoá một-lượt → dựng nội
 * dung trong `<u>/<id>` → trần dung lượng → git init + commit đầu → ghi hàng → nạp lại ảnh chụp. Hỏng ở BẤT KỲ bước
 * nào sau khi thư mục đã tạo ⇒ xoá thư mục (không để rác vô chủ) và trả đúng mã.
 */
export async function taoDuAnCaNhan(y: YeuCauTaoDuAn, kho?: KhoDuAnCaNhan): Promise<KetQua<{ id: string; ten: string; boQua: string[] }>> {
  if (!Number.isInteger(y.userId) || y.userId <= 0) return { ok: false, ma: "KHONG_TIM_THAY" };
  const ten = chuanHoaTen(y.ten);
  if (ten === null) return { ok: false, ma: "TEN_KHONG_HOP_LE" };
  if (typeof y.cachTao !== "string" || !CACH_TAO.has(y.cachTao)) return { ok: false, ma: "CACH_TAO_KHONG_HOP_LE" };
  const cachTao = y.cachTao as CachTao;
  let khuonNguon: string | null = null;
  if (cachTao === "khuon") {
    if (typeof y.khuon !== "string" || !(KHUON_CO_SAN as readonly string[]).includes(y.khuon)) return { ok: false, ma: "KHUON_KHONG_CO" };
    khuonNguon = path.join(thuMucKhuon(), y.khuon);
    try {
      if (!fs.statSync(khuonNguon).isDirectory()) return { ok: false, ma: "KHUON_KHONG_CO" };
    } catch {
      return { ok: false, ma: "KHUON_KHONG_CO" };
    }
  }
  if (cachTao === "zip" && (!y.zip || y.zip.length === 0 || y.zip.length > TRAN_BYTE_ZIP_TAI_LEN)) {
    return { ok: false, ma: y.zip && y.zip.length > TRAN_BYTE_ZIP_TAI_LEN ? "ZIP_QUA_LON" : "ZIP_THIEU" };
  }

  const g = kiemTraGocQuanLy();
  if (!g.ok) return g;
  const u = damBaoThuMucNguoiDung(y.userId, g.goc);
  if (!u.ok) return u;
  donThungRac(g.goc);

  if (dangTao.has(y.userId)) return { ok: false, ma: "DANG_TAO" };
  dangTao.add(y.userId);
  const k = kho ?? (await khoMacDinh());
  const id = `u${y.userId}-${randomBytes(5).toString("hex")}`;
  const dich = path.join(u.duong, id);
  let daTao = false;
  try {
    const so = await k.dem(y.userId);
    if (so === null) return { ok: false, ma: "KHONG_DEM_DUOC" };
    if (so >= tranDuAnMoiNguoi()) return { ok: false, ma: "VUOT_TRAN_SO_DU_AN" };
    const tranByte = tranByteMoiNguoi();
    const daDung = dungLuongThuMuc(u.duong, tranByte);
    if (daDung >= tranByte) return { ok: false, ma: "VUOT_TRAN_DUNG_LUONG" };

    let boQua: string[] = [];
    if (cachTao === "git") {
      daTao = true; // clone tự tạo `dich`; lỗi giữa chừng có thể để lại thư mục dở
      const kq = await cloneGitNoiBo(y.nguonGit, dich, damBaoThuMucKhongHook(path.join(g.goc, TEN_KHONG_HOOK)));
      if (!kq.ok) return { ok: false, ma: kq.ma, ...(kq.chiTiet ? { chiTiet: kq.chiTiet } : {}) };
    } else {
      fs.mkdirSync(dich);
      daTao = true;
      if (cachTao === "khuon" && khuonNguon) chepKhuon(khuonNguon, dich);
      if (cachTao === "zip" && y.zip) {
        const kq = await giaiNenZipAnToan(y.zip, dich, { byteGiaiNen: Math.max(0, tranByte - daDung) });
        if (!kq.ok) return { ok: false, ma: kq.ma, chiTiet: kq.chiTiet };
        boQua = kq.boQua;
      }
    }
    if (dungLuongThuMuc(u.duong, tranByte) > tranByte) return { ok: false, ma: "VUOT_TRAN_DUNG_LUONG" };

    const git = await khoiTaoGitVaCommitDau(dich, ten, damBaoThuMucKhongHook(path.join(g.goc, TEN_KHONG_HOOK)));
    if (!git.ok) return { ok: false, ma: "GIT_INIT_THAT_BAI", ...(git.loi ? { chiTiet: git.loi } : {}) };

    const gocThat = fs.realpathSync.native(dich);
    if (!duAnCaNhanDungCho(gocThat, y.userId)) return { ok: false, ma: "GOC_QUAN_LY_KHONG_HOP_LE", chiTiet: "chỗ đứng" };
    const luu = await k.them({ id, ten, goc: gocThat, nguoiTao: y.userId, chuSoHuu: y.userId, cachTao });
    if (!luu.ok) return { ok: false, ma: "LUU_THAT_BAI" };
    daTao = false; // đã thuộc về một hàng — không dọn nữa
    await k.napLai();
    return { ok: true, id, ten, boQua };
  } catch (e) {
    return { ok: false, ma: "LUU_THAT_BAI", chiTiet: (e as Error)?.message ?? String(e) };
  } finally {
    if (daTao) {
      try {
        fs.rmSync(dich, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    dangTao.delete(y.userId);
  }
}

/** Người gọi được SỬA (đổi tên/xoá) dự án cá nhân này: chủ, hoặc admin. Mục env/admin ⇒ không (đó là việc `xoaDuAn`). */
function duocSua(hang: { chuSoHuu?: number | null } | null, nguoiGoi: { id: number; role: string }): hang is { chuSoHuu: number } {
  if (!hang || hang.chuSoHuu == null) return false;
  return hang.chuSoHuu === nguoiGoi.id || nguoiGoi.role === "admin";
}

/** Đổi TÊN hiển thị (id + thư mục KHÔNG đổi — phiên chat/lượt chạy/chỉ mục khoá theo id). */
export async function doiTenDuAnCaNhan(
  nguoiGoi: { id: number; role: string },
  id: unknown,
  tenMoi: unknown,
  kho?: KhoDuAnCaNhan,
): Promise<KetQua<{ id: string; ten: string }>> {
  const ten = chuanHoaTen(tenMoi);
  if (ten === null) return { ok: false, ma: "TEN_KHONG_HOP_LE" };
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const k = kho ?? (await khoMacDinh());
  const hang = await k.doc(id);
  // Không có / không phải của bạn ⇒ CÙNG mã (không kênh dò dự án người khác).
  if (!duocSua(hang, nguoiGoi)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const r = await k.doiTen(id, hang.chuSoHuu, ten);
  if (!r.ok) return { ok: false, ma: "KHONG_TIM_THAY" };
  await k.napLai();
  return { ok: true, id, ten };
}

/**
 * XOÁ = chuyển thư mục vào `<gốc>/.thung-rac/<epochMs>__<id>` RỒI xoá hàng. Xoá hàng hỏng ⇒ chuyển thư mục về chỗ
 * cũ (không để hàng trỏ vào hư không). Thư mục đã biến mất trước đó ⇒ vẫn xoá hàng (dọn hàng mồ côi).
 */
export async function xoaDuAnCaNhan(
  nguoiGoi: { id: number; role: string },
  id: unknown,
  kho?: KhoDuAnCaNhan,
  bayGio: number = Date.now(),
): Promise<KetQua<{ id: string; thungRac: string | null }>> {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const k = kho ?? (await khoMacDinh());
  const hang = await k.doc(id);
  if (!duocSua(hang, nguoiGoi)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const g = kiemTraGocQuanLy();
  if (!g.ok) return g;
  donThungRac(g.goc, bayGio);
  const thung = path.join(g.goc, TEN_THUNG_RAC);
  let dichRac: string | null = null;
  // Chỉ CHUYỂN khi gốc hàng đứng đúng chỗ của chủ — một hàng bị sửa tay trỏ ra ngoài KHÔNG kéo thư mục lạ vào rác.
  if (fs.existsSync(hang!.goc) && duAnCaNhanDungCho(hang!.goc, hang.chuSoHuu)) {
    try {
      fs.mkdirSync(thung, { recursive: true });
      dichRac = path.join(thung, `${bayGio}__${id}`);
      fs.renameSync(hang!.goc, dichRac);
    } catch (e) {
      return { ok: false, ma: "XOA_THAT_BAI", chiTiet: (e as Error)?.message ?? String(e) };
    }
  }
  const r = await k.xoa(id);
  if (!r.ok) {
    if (dichRac) {
      try {
        fs.renameSync(dichRac, hang!.goc);
      } catch {
        /* để nguyên trong rác — admin thấy */
      }
    }
    return { ok: false, ma: "XOA_THAT_BAI" };
  }
  await k.napLai();
  return { ok: true, id, thungRac: dichRac };
}

/** Dung lượng đã dùng của một người (cho UI). */
export function dungLuongNguoiDung(userId: number): { daDung: number; tran: number } {
  const tran = tranByteMoiNguoi();
  try {
    return { daDung: dungLuongThuMuc(thuMucNguoiDung(userId), tran), tran };
  } catch {
    return { daDung: 0, tran };
  }
}
