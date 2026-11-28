/**
 * Pilot "Thợ Cả nhận việc" — DRIVER `host`: chạy ĐÚNG Thợ Cả (host agent `quanLyLuotChay`, cùng đường với VS Code/web) trong tiến trình,
 * để đo cả AGENTS.md (qua tepQuyUocAgent), `usage` (cacheN/promptN) và số vòng.
 *
 * CỔNG DUYỆT GIỮ NGUYÊN (chủ dự án quyết 2026-11-02: "dieu-phoi là người theo dõi và duyệt"). Mỗi thẻ `can-duyet`:
 *   1. LỌC TRƯỚC (`locTruocKhiCho`, thuần): ghi ngoài danh sách thẻ / vùng cấm / thoát worktree / tool lạ / `run_command` khác LỆNH KIỂM ⇒ TỰ TỪ CHỐI
 *      (cancelAction), không hỏi người.
 *   2. Còn lại ⇒ `chinhSachDuyet` quyết. Mặc định `duyetQuaTep`: ghi `<ra>/<mã>.cho-duyet.json` rồi ĐỢI `<ra>/<mã>.quyet.json` (do `duyet.ts` ghi);
 *      hết hạn ⇒ từ chối + `het-gio`. Việc chấp nhận gọi `thuTucDuyet` (= confirmAction thật: token, băm neo, checkpoint) — không đường tắt.
 *   ⚠ ĐIỂM CẮM CHÍNH SÁCH: `PhuThuocHost.chinhSachDuyet`. Chưa có chính sách tự duyệt và KHÔNG được dựng cho tới khi dieu-phoi báo chủ dự án đổi quyết.
 *
 * Môi trường (đặt bởi người chạy, qua env của TIẾN TRÌNH này; bộ chạy không đọc/sửa .env): DATABASE_URL trỏ `aoi_management_test` (khẳng định
 * `current_database()` trước khi chạy), LLAMA_SERVER_URL, AI_REPO_SANDBOX_ROOTS có `<tên thư mục worktree>=<đường worktree>`.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loiNhacPhu, tinhPhu } from "./kiemPhu";
import { quetHoSo, thuMucTamMacDinh, tomTatCanhBao, type CanhBao } from "./quetTinh";
import { chuanDuong, kiemDiffTheoThe, vungCamCua, type TheViec } from "./theViec";
import { canChayTsc, chayLenhKiem, cheTokenTrongDauRa, danhSachTinDuoc, soLoiMoi, loaiUrlCsdl, xoaGiaTriBiMat, type ChayKiem, type KetQuaKiem, type KetQuaTsc } from "./kiemChung";
import type { BaiHocLuot, DauVaoDriver, KetQuaDriver, KieuMotLan, TheDuyetMuc } from "./chayMotViec";
import type { GioiHanLuotChoDriver } from "./tranLuot";
import type { PhuThuocQuanLy } from "../../server/services/ai/agent/quanLyLuotChay";

export const NHAN_PILOT = "pilot-tho-ca";
/** nhãn trong loiCongCu cho từ chối KHÔNG phải lỗi công cụ: bộ chạy tự từ chối (lọc trước) · người duyệt từ chối · hết hạn chờ người */
export const NHAN_TU_CHOI_BO_CHAY = "TU_CHOI_BO_CHAY";
export const NHAN_TU_CHOI_NGUOI = "TU_CHOI_NGUOI_DUYET";
export const NHAN_HET_GIO_DUYET = "HET_GIO_DUYET";
/** run_command đúng LỆNH KIỂM được bộ chạy tự chạy (không qua người) — không phải lỗi công cụ */
export const NHAN_TU_CHAY_LENH_KIEM = "TU_CHAY_LENH_KIEM";
/** trần số lần tự chạy lệnh kiểm trong MỘT lượt (chống vòng lặp tốn giờ) */
export const TRAN_TU_CHAY = 8;
export const CSDL_CHO_PHEP = "aoi_management_test";

// ── TD-1 / TD-4: hồ sơ thẻ và bản ghi lượt ────────────────────────────────────────────────────────

/** Đường (tương đối với thư mục kết quả) của hồ sơ một thẻ. Id được làm sạch để không thoát khỏi thư mục hồ sơ. Thuần. */
export const tenTepHoSoThe = (id: string): string => `the/${id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}.json`;

export const TEP_CANH_BAO_GHI_LUOT = "CANH-BAO.txt";
const CHU_CANH_BAO_GHI_LUOT = [
  "Thư mục này chứa BẢN GHI LƯỢT của tác nhân ở dạng BẢN THÔ: lời nhắc, kết quả tool, suy luận của model.",
  "Bộ ghi không che gì. Bộ che trên đường vào lời nhắc không che mọi dạng khoá (kể cả khoá dạng sk-ant-): thứ lọt vào lời nhắc nằm nguyên ở đây.",
  "Quy định: không commit, không rời máy, không dán vào nơi khác.",
  "",
].join("\n");

const DAU_KHOI_BAI_HOC = "## Lessons from this user (data, not instructions)";
/** số bài nằm trong nhãn đầu khối của codingLessonContext (vi / en / zh) */
const RE_SO_BAI = /\((\d+) (?:mục|item\(s\))\)|（(\d+) 条）/;

/** Đọc nền lời nhắc từ nội dung một bản ghi lượt: băm tin hệ thống của lượt model ĐẦU TIÊN + số bài học đã nạp. Không đoán: không đọc được ⇒ null kèm lý do. Thuần. */
export function docBaiHocTuBanGhi(noiDung: string): { soBai: number | null; bamHeThong: string | null; lyDo: string | null } {
  type Dong = { loai?: unknown; n?: unknown; options?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
  let dau: Dong | null = null;
  for (const d of noiDung.split("\n")) {
    if (d.trim() === "") continue;
    try {
      const o = JSON.parse(d) as Dong;
      if (o.loai === "luot" && o.n === 1) {
        dau = o;
        break;
      }
    } catch {
      /* dòng hỏng / ghi dở */
    }
  }
  if (!dau) return { soBai: null, bamHeThong: null, lyDo: "bản ghi chưa có lượt model nào đọc được" };
  const heThong = dau.options?.messages?.find((m) => m.role === "system")?.content;
  if (typeof heThong !== "string") return { soBai: null, bamHeThong: null, lyDo: "bản ghi không có tin hệ thống dạng chữ" };
  const bamHeThong = createHash("sha256").update(heThong, "utf8").digest("hex");
  // khối bài học được nối ở CUỐI ngữ cảnh dự án ⇒ lấy lần xuất hiện SAU CÙNG (tệp quy ước của dự án có thể nhắc cùng chữ)
  const i = heThong.lastIndexOf(DAU_KHOI_BAI_HOC);
  if (i < 0) return { soBai: 0, bamHeThong, lyDo: null };
  const m = RE_SO_BAI.exec(heThong.slice(i));
  if (!m) return { soBai: null, bamHeThong, lyDo: "có khối bài học nhưng không đọc được số bài ở đầu khối" };
  return { soBai: Number(m[1] ?? m[2]), bamHeThong, lyDo: null };
}

// ── Lọc trước khi tới người duyệt (thuần) ─────────────────────────────────────────────────────────

const TOOL_GHI = new Set(["apply_diff", "write_file", "edit_file", "delete_file", "rename_file"]);
const KHOA_DUONG = ["path", "file", "filePath", "file_path", "target", "from", "to", "oldPath", "newPath", "old_path", "new_path"];

export type LocTruoc = { loai: "cho"; duong: string[] } | { loai: "tu-choi"; lyDo: string } | { loai: "tu-chay"; lenh: string };

/** Gom mọi đường tệp mà lời gọi tool nêu (thamSo cấp 1 + mảng `files`/`paths`). Rỗng ⇒ không xác định được. */
export function duongCuaDeXuat(thamSo: Record<string, unknown>): string[] {
  const ra: string[] = [];
  const them = (v: unknown) => {
    if (typeof v === "string" && v.trim() !== "") ra.push(v);
  };
  for (const k of KHOA_DUONG) them(thamSo[k]);
  for (const k of ["files", "paths"]) {
    const m = thamSo[k];
    if (Array.isArray(m)) for (const x of m) them(typeof x === "object" && x !== null ? (x as Record<string, unknown>).path : x);
  }
  return ra;
}

export function locTruocKhiCho(de: { ten: string; thamSo: Record<string, unknown> }, the: Pick<TheViec, "tepDuocPhep" | "lenhKiem">, wt: string): LocTruoc {
  if (de.ten === "run_command") {
    const lenh = typeof de.thamSo.command === "string" ? de.thamSo.command.trim() : "";
    // L2 (TC-05): thẻ run_command vitest chờ NGƯỜI duyệt hết hạn sau 5 phút (expiresAt = createdAt + 5') trong khi người tới sau ~10 phút ⇒ model lặp ⇒ lap-lai.
    // LỆNH KIỂM là việc bộ chạy vốn tự chạy (L3a, env DB chết) ⇒ chạy NGAY, không qua người, trả kết quả cho model. Lệnh khác ⇒ từ chối như cũ.
    return lenh !== "" && lenh === the.lenhKiem.trim() ? { loai: "tu-chay", lenh } : { loai: "tu-choi", lyDo: "run_command khác LỆNH KIỂM của thẻ" };
  }
  if (!TOOL_GHI.has(de.ten)) return { loai: "tu-choi", lyDo: `tool "${de.ten}" không nằm trong danh sách được phép cho pilot` };
  const tho = duongCuaDeXuat(de.thamSo);
  if (tho.length === 0) return { loai: "tu-choi", lyDo: "không xác định được tệp bị ghi (fail-closed)" };
  const goc = path.resolve(wt);
  const rel: string[] = [];
  for (const t of tho) {
    // tuyệt đối phải nằm TRONG worktree; tương đối chuẩn hoá như thẻ
    const x = path.isAbsolute(t) ? path.relative(goc, path.resolve(t)).split(path.sep).join("/") : t;
    const d = chuanDuong(x);
    if (d === null) return { loai: "tu-choi", lyDo: `đường thoát worktree / không hợp lệ: ${t}` };
    rel.push(d);
  }
  const vp = kiemDiffTheoThe(rel, the.tepDuocPhep);
  if (vp.length > 0) return { loai: "tu-choi", lyDo: vp.map((v) => `${v.duong}: ${v.loai}${v.chiTiet ? ` (${v.chiTiet})` : ""}`).join("; ") };
  for (const d of rel) if (vungCamCua(d)) return { loai: "tu-choi", lyDo: `vùng cấm: ${d}` };
  return { loai: "cho", duong: rel };
}

// ── Duyệt qua tệp ─────────────────────────────────────────────────────────────────────────────────

export interface HoSoCho {
  ma: string;
  id: string;
  ten: string;
  duong: string[];
  moTa: string | null;
  lyDoModel: string | null;
  xemTruoc: unknown;
  thamSo: Record<string, unknown>;
  nguonDangNgo: string[];
  luc: string;
  /** hạn THẬT người duyệt phải trả lời trước (ISO) — thẻ của app hết hạn sau 5 phút kể từ lúc tạo, bất kể --han-duyet */
  hetHanLuc?: string;
  /** HA-9 — cảnh báo của bộ quét tĩnh trên phần được thêm / đổi (KHÔNG chặn; chỉ để người duyệt thấy). Vắng khi sạch. */
  canhBao?: CanhBao[];
}
/** App đặt `expiresAt = createdAt + 5 phút` cho thẻ (aiCopilotActions.PENDING_TTL_MS); quá hạn thẻ `invalid` dù bộ chạy còn đợi (TC-05 lượt 2). */
export const TTL_THE_DUYET_MS = 5 * 60_000;
/**
 * Biên an toàn 15 s: hạn ghi trong `cho-duyet.json` (và hạn chờ của bộ chạy) SỚM hơn `expiresAt` của hàng thẻ đúng khoảng này — cố ý,
 * lệch về phía an toàn: người duyệt ở sát hạn không làm thẻ `invalid` giữa lúc bộ chạy còn đợi (TC-05 lượt 2). Đo ở TC-06: lệch 15 s.
 */
export const BIEN_AN_TOAN_MS = 15_000;
/** Cổng kế hoạch 11.3-C chờ người tối đa 15 phút (choDuyetKeHoach.TRAN_CHO_DUYET_KE_HOACH_MS) — KHÁC TTL thẻ ghi (5 phút). */
export const TRAN_CHO_KE_HOACH_MS = 15 * 60_000;
/** id hồ sơ của kế hoạch = `kh-<băm>`: băm đổi ⇒ id đổi ⇒ quyết định của kế hoạch cũ KHÔNG duyệt kế hoạch mới. */
export const idKeHoach = (bam: string) => `kh-${bam}`;
export function hanKeHoachHieuLucMs(hanDuyetGiay: number): number {
  return Math.max(1000, Math.min(hanDuyetGiay * 1000, TRAN_CHO_KE_HOACH_MS - BIEN_AN_TOAN_MS));
}
/** Hạn chờ người HIỆU LỰC = min(--han-duyet, TTL của thẻ − biên an toàn). Không bao giờ dài hơn thời gian thẻ còn sống. */
export function hanDuyetHieuLucMs(hanDuyetGiay: number): number {
  return Math.max(1000, Math.min(hanDuyetGiay * 1000, TTL_THE_DUYET_MS - BIEN_AN_TOAN_MS));
}
export type QuyetDinh = { quyet: "chap-nhan" | "tu-choi"; lyDo?: string } | { quyet: "het-gio" };
export type ChinhSachDuyet = (h: HoSoCho, ctx: { ra: string; hanMs: number }) => Promise<QuyetDinh>;

export const tepChoDuyet = (ra: string, ma: string) => path.join(ra, `${ma}.cho-duyet.json`);
export const tepQuyet = (ra: string, ma: string) => path.join(ra, `${ma}.quyet.json`);
/** MỘT dòng cho người duyệt: thẻ đang chờ + id + hạn (hoặc "(không có thẻ chờ)"). Ghi ngay khi thẻ xuất hiện. */
export const tepDangCho = (ra: string) => path.join(ra, "dang-cho.txt");

export function ghiNguyenTu(tep: string, noiDung: string): void {
  const tam = `${tep}.${process.pid}.tmp`;
  fs.writeFileSync(tam, noiDung, "utf8");
  fs.renameSync(tam, tep);
}

/** Mặc định: ghi hồ sơ, đợi tệp quyết định KHỚP id (id lệch ⇒ bỏ qua — không trả lời nhầm thẻ). */
export const duyetQuaTep: ChinhSachDuyet = async (h, ctx) => {
  fs.mkdirSync(ctx.ra, { recursive: true });
  const qp = tepQuyet(ctx.ra, h.ma);
  fs.rmSync(qp, { force: true });
  ghiNguyenTu(tepChoDuyet(ctx.ra, h.ma), JSON.stringify(h, null, 2));
  const han = Date.now() + ctx.hanMs;
  const hetHan = h.hetHanLuc ?? new Date(han).toISOString();
  const cb = tomTatCanhBao(h.canhBao);
  ghiNguyenTu(tepDangCho(ctx.ra), `${h.ma} ${h.ten} ${h.duong.join(",")} id=${h.id} HET HAN ${hetHan}${cb ? ` | ${cb}` : ""}\n`);
  process.stderr.write(`[tho-ca-pilot] CHỜ DUYỆT ${h.ma} ${h.ten} ${h.duong.join(",")} id=${h.id} HẾT HẠN ${hetHan}${cb ? ` | ${cb}` : ""} → ${tepChoDuyet(ctx.ra, h.ma)}\n`);
  const xong = <T extends QuyetDinh>(q: T): T => {
    ghiNguyenTu(tepDangCho(ctx.ra), `(không có thẻ chờ) ${new Date().toISOString()}\n`);
    return q;
  };
  while (Date.now() < han) {
    try {
      const q = JSON.parse(fs.readFileSync(qp, "utf8")) as { id?: unknown; quyet?: unknown; lyDo?: unknown };
      if (q.id === h.id && (q.quyet === "chap-nhan" || q.quyet === "tu-choi")) {
        fs.rmSync(qp, { force: true });
        return xong({ quyet: q.quyet, ...(typeof q.lyDo === "string" ? { lyDo: q.lyDo } : {}) });
      }
    } catch {
      /* chưa có / đang ghi */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return xong({ quyet: "het-gio" });
};

/** (V0) ngân sách chữ CHI TIẾT (thông báo đầu, dòng vị trí, diff, khung mã) của một lời nhắc; tên ca nằm ngoài ngân sách này */
export const NGAN_SACH_CHI_TIET = 6000;
/** LỆCH CÓ TÊN «V0-TRAN-TEN» so kế hoạch §10.3 ("không cắt tên"): nhiều hơn thế thì riêng tên đã làm đầy cửa sổ ngữ cảnh */
export const TRAN_SO_TEN = 100;
export const TRAN_DAI_TEN = 300;
const DUOI_CHO_MODEL = 1800;

/** Chia `tong` ký tự cho các mảnh: mảnh ngắn lấy đủ, phần thừa chia đều tiếp cho mảnh dài — không mảnh nào bị bỏ đói vì đứng trước/sau. */
function chiaDeu(can: readonly number[], tong: number): number[] {
  const ra = new Array<number>(can.length).fill(0);
  const thuTu = can.map((_, i) => i).sort((a, b) => can[a]! - can[b]!);
  let con = tong;
  thuTu.forEach((i, viTri) => {
    const phan = Math.min(can[i]!, Math.floor(con / (thuTu.length - viTri)));
    ra[i] = phan;
    con -= phan;
  });
  return ra;
}

const catChu = (s: string, n: number) => (s.length <= n ? s : n <= 0 ? "" : `${s.slice(0, n - 1)}…`);
const laTepHong = (ten: string) => !ten.includes(" > ") && /\[ .+ \]$/.test(ten);

/**
 * (V0) Phần "ca đỏ" của lời nhắc: TÊN mọi ca đỏ, kèm thông báo đầu + vị trí, rồi diff / khung mã chia đều trong ngân sách. Trả null khi không có gì để dựng
 * (không mang khối, hoặc không khối nào và không ca nào hỏng) ⇒ chỗ gọi giữ định dạng đuôi đầu ra cũ.
 */
export function dungPhanCaDo(k: KetQuaKiem): { dong: string[]; kemDuoi: boolean; soTenGui: number; soCaDo: number; soKhoiCat: number; soKyTu: number } | null {
  const soCaDo = k.vitest.ca?.hong ?? 0;
  if (!k.khoiDo || (k.khoiDo.length === 0 && soCaDo === 0)) return null;
  const demCa = (ds: ReadonlyArray<{ ten: string[] }>) => ds.reduce((n, x) => n + x.ten.filter((t) => !laTepHong(t)).length, 0);
  const demMoiTen = (ds: ReadonlyArray<{ ten: string[] }>) => ds.reduce((n, x) => n + x.ten.length, 0);
  let conCho = TRAN_SO_TEN;
  const khoi = k.khoiDo.flatMap((x) => {
    const ten = x.ten.slice(0, conCho);
    conCho -= ten.length;
    return ten.length > 0 ? [{ ...x, ten }] : [];
  });
  const dauKhoi = khoi.flatMap((x) => [x.thongBao, x.viTri]);
  const capDau = chiaDeu(dauKhoi.map((s) => s.length), NGAN_SACH_CHI_TIET);
  const capSau = chiaDeu(khoi.map((x) => x.conLai.length), NGAN_SACH_CHI_TIET - capDau.reduce((a, b) => a + b, 0));
  let soKhoiCat = 0;
  let soKyTu = 0;
  const dong: string[] = [];
  khoi.forEach((x, i) => {
    const manh = [catChu(x.thongBao, capDau[2 * i]!), catChu(x.viTri, capDau[2 * i + 1]!), catChu(x.conLai, capSau[i]!)];
    if (manh[0] !== x.thongBao || manh[1] !== x.viTri || manh[2] !== x.conLai) soKhoiCat++;
    soKyTu += manh.reduce((n, s) => n + s.length, 0);
    dong.push(...x.ten.map((t) => `FAIL ${catChu(t, TRAN_DAI_TEN)}`), ...manh.filter((s) => s !== ""), "");
  });
  const boTen = demMoiTen(k.khoiDo) - demMoiTen(khoi);
  if (boTen > 0) dong.push(`còn ${boTen} ca đỏ không liệt kê`);
  if (soKhoiCat > 0) dong.push(`đã cắt bớt chi tiết của ${soKhoiCat}/${khoi.length} khối${boTen > 0 ? "" : "; tên ca giữ đủ"}`);
  const docThieu = demCa(k.khoiDo) < soCaDo;
  if (docThieu) dong.push(`chỉ đọc được tên ${demCa(k.khoiDo)}/${soCaDo} ca đỏ; kèm đuôi đầu ra`);
  if (k.coLoiNgoaiCa) dong.push("đầu ra có lỗi ngoài ca (Unhandled); kèm đuôi đầu ra");
  return { dong, kemDuoi: docThieu || k.coLoiNgoaiCa === true, soTenGui: demCa(khoi), soCaDo, soKhoiCat, soKyTu };
}

// ── V10: kiểu đi CÙNG kết quả lệnh kiểm trong vòng ─────────────────────────────────────────────────

/** Lệnh kiểm + tsc phải xong trước khi thẻ lệnh hết hạn (TTL_THE_DUYET_MS 300 s), chừa biên. */
export const TRAN_KIEM_VA_KIEU_GIAY = 270;
/** Còn ít hơn thế thì không chạy tsc (tsc "nóng" đo được ~12 s). */
export const TOI_THIEU_TSC_GIAY = 20;
/** Ngân sách chữ cho cả khối "KIỂU:" (gồm dòng giải thích thụt lề). */
export const NGAN_SACH_KIEU = 2400;
const TRAN_DAI_DONG_LOI = 300;
const CHO_CHO_CAU_CUOI = 120;
/** Số dòng lỗi MỚI ở tệp ngoài phép được nêu cho model (không kèm giải thích). */
const TOI_DA_LOI_MOI_NEU = 5;
const NHAN_LOI_MOI = "Lỗi MỚI ở tệp khác:";

/** Khối kiểu khi tsc ĐỎ. `trong` = lỗi ở tệp được phép; luôn giữ vị trí + mã trước, cắt giải thích trước, bớt lỗi sau cùng — cắt gì cũng NÓI. THUẦN. */
export function dungKhoiKieuDo(trong: readonly string[], khoiTheoDau: ReadonlyMap<string, string>, soKhac: number, chiSo: boolean, loiMoi: { tong: number; duocNeu: readonly string[] } | null = null): string {
  const cauMoi = loiMoi ? ` Trong đó ${loiMoi.tong} lỗi MỚI ở tệp khác so với cây gốc.` : "";
  const dau = `KIỂU: ĐỎ — ${trong.length} lỗi trong tệp được phép, ${soKhac} lỗi ở tệp khác.${cauMoi} Lệnh kiểm xanh CHƯA đủ: sửa lỗi kiểu rồi gọi lại đúng lệnh kiểm.`;
  const soMoi = loiMoi?.tong ?? 0;
  if (chiSo || (trong.length === 0 && soMoi === 0)) return dau;
  const giu: Array<{ dong: string; them: string }> = [];
  let daDung = dau.length;
  for (const d of trong) {
    const dong = catChu(cheTokenTrongDauRa(d), TRAN_DAI_DONG_LOI);
    if (daDung + dong.length + 1 > NGAN_SACH_KIEU - CHO_CHO_CAU_CUOI) break;
    daDung += dong.length + 1;
    const khoi = khoiTheoDau.get(d);
    giu.push({ dong, them: khoi ? cheTokenTrongDauRa(khoi.split("\n").slice(1).join("\n")) : "" });
  }
  const moiGiu: string[] = [];
  if ((loiMoi?.duocNeu.length ?? 0) > 0) daDung += NHAN_LOI_MOI.length + 1;
  for (const d of (loiMoi?.duocNeu ?? []).slice(0, TOI_DA_LOI_MOI_NEU)) {
    const dong = catChu(cheTokenTrongDauRa(d), TRAN_DAI_DONG_LOI);
    if (daDung + dong.length + 1 > NGAN_SACH_KIEU - CHO_CHO_CAU_CUOI) break;
    daDung += dong.length + 1;
    moiGiu.push(dong);
  }
  const phan = chiaDeu(giu.map((x) => (x.them ? x.them.length + 1 : 0)), Math.max(0, NGAN_SACH_KIEU - CHO_CHO_CAU_CUOI - daDung));
  let daCat = false;
  const ra = [dau];
  giu.forEach((x, i) => {
    ra.push(x.dong);
    if (!x.them) return;
    const them = catChu(x.them, phan[i]! - 1);
    if (them !== x.them) daCat = true;
    if (them !== "") ra.push(them);
  });
  const conLai = trong.length - giu.length;
  if (conLai > 0) ra.push(`còn ${conLai} lỗi không liệt kê`);
  if (daCat) ra.push("đã cắt bớt giải thích của một số lỗi");
  if (moiGiu.length > 0) ra.push(NHAN_LOI_MOI, ...moiGiu);
  if (soMoi > moiGiu.length) ra.push(`còn ${soMoi - moiGiu.length} lỗi mới ở tệp khác không liệt kê`);
  return ra.join("\n");
}

/** Chỉ nêu cho model dòng lỗi có đường mà hộp cát cho model thấy; không nạp được chính sách thì không nêu dòng nào (chỉ đếm). */
async function locTheoHopCat(dong: readonly string[]): Promise<string[]> {
  if (dong.length === 0) return [];
  try {
    const { phanQuyetDuongDan } = await import("../../server/services/aiLocalTools/repoSandbox");
    return dong.filter((d) => {
      const m = /^(.+?)\(\d+,\d+\): /.exec(d);
      return m !== null && phanQuyetDuongDan(m[1]) === null;
    });
  } catch {
    return [];
  }
}

/** Quyết có chạy tsc cho lần tự chạy này không và dựng khối "KIỂU:". Không nhánh nào im lặng. */
export async function kiemKieuTrongVong(v: DauVaoDriver, k: KetQuaKiem): Promise<{ van: string; trangThai: KieuMotLan["trangThai"]; giay: number | null }> {
  const kieu = v.kieu!;
  const khong = (van: string, trangThai: KieuMotLan["trangThai"]) => ({ van, trangThai, giay: null });
  const kiemXanh = k.exit === 0 && !k.hetGio && !k.loi && (k.vitest.ca?.hong ?? 0) === 0 && (k.vitest.tep?.hong ?? 0) === 0;
  if (!kiemXanh) return khong("KIỂU: chưa kiểm vì lệnh kiểm đang đỏ.", "kiem-do");
  const tepDoi = kieu.tepDoi();
  if (!canChayTsc(v.wt, tepDoi)) return khong("KIỂU: không kiểm — không có tệp TypeScript đổi (hoặc dự án không có tsconfig.tests.json).", "khong-ap");
  if (kieu.hamLoi !== null) return khong(`KIỂU: CHƯA kiểm được — hâm sổ kiểu hỏng: ${kieu.hamLoi}`, "chua");
  const han = Math.floor(TRAN_KIEM_VA_KIEU_GIAY - k.giay);
  if (han < TOI_THIEU_TSC_GIAY) return khong(`KIỂU: CHƯA kiểm được — lệnh kiểm đã dùng ${k.giay} s, không còn đủ chỗ trước khi thẻ lệnh hết hạn.`, "chua");
  let t: KetQuaTsc;
  try {
    t = await kieu.chayTsc(tepDoi, han);
  } catch (e) {
    t = { exit: null, hetGio: false, giay: 0, loiTrongTep: [], tongLoi: 0, loi: e instanceof Error ? e.message : String(e) };
  }
  const chua = (lyDo: string) => ({ van: `KIỂU: CHƯA kiểm được — ${lyDo}. Đừng coi là kiểu sạch.`, trangThai: "chua" as const, giay: t.giay });
  if (t.hetGio) return chua(`tsc quá ${han} s`);
  if (t.loi) return chua(v.cheDoKiem === "chi-so" ? "tsc không khởi chạy được" : `tsc không khởi chạy được: ${catChu(cheTokenTrongDauRa(t.loi), TRAN_DAI_DONG_LOI)}`);
  // lỗi không gắn tệp (cấu hình…): kiểu có thể chưa được kiểm — cổng cuối sẽ chặn, ở đây không được nói "sạch" hay "không có lỗi mới"
  if (t.tongLoi > 0 && (t.loiKhongViTri?.length ?? 0) > 0) return chua("tsc báo lỗi không gắn tệp (cấu hình)");
  if (t.tongLoi === 0) {
    // thoát khác 0 mà không đọc được dòng lỗi nào (lỗi cấu hình, sập) KHÔNG phải là sạch
    if (t.exit !== 0) return chua(`tsc thoát mã ${t.exit} mà không có dòng lỗi đọc được`);
    return { van: `KIỂU: sạch (tsc tsconfig.tests.json, ${t.giay} s).`, trangThai: "sach", giay: t.giay };
  }
  const duocPhep = tepDoi.filter((x) => kiemDiffTheoThe([x], v.the.tepDuocPhep).length === 0).map((x) => x.replace(/\\/g, "/"));
  const trong = t.loiTrongTep.filter((d) => duocPhep.some((x) => d.startsWith(`${x}(`)));
  const khoiTheoDau = new Map((t.khoiTrongTep ?? []).map((b) => [b.split("\n")[0]!.trim(), b]));
  const soKhac = t.tongLoi - trong.length;
  const chiSo = v.cheDoKiem === "chi-so";
  const ds = danhSachTinDuoc(t);
  let loiMoi: { tong: number; duocNeu: string[] } | null = null;
  if (kieu.nen != null && ds !== null) {
    const moiKhac = soLoiMoi(kieu.nen, ds).filter((d) => !duocPhep.some((x) => d.startsWith(`${x}(`)));
    // chỉ còn lỗi sẵn có ở tệp model không được sửa: cổng cuối cho qua ⇒ không bảo model đi sửa; trạng thái RIÊNG, không lẫn với "sach"
    if (trong.length === 0 && moiKhac.length === 0) return { van: `KIỂU: không có lỗi mới — ${soKhac} lỗi sẵn có ở tệp khác (cổng cuối không tính chúng).`, trangThai: "nen", giay: t.giay };
    loiMoi = { tong: moiKhac.length, duocNeu: chiSo ? [] : await locTheoHopCat(moiKhac) };
  }
  return { van: dungKhoiKieuDo(trong, khoiTheoDau, soKhac, chiSo, loiMoi), trangThai: "do", giay: t.giay };
}

/**
 * Văn bản trả cho model khi bộ chạy TỰ chạy LỆNH KIỂM thay cho thẻ duyệt. Kênh duy nhất để đưa kết quả về model là lý do từ chối của thẻ
 * (host in nó sau "User rejected this change:"), nên câu đầu nói rõ đây là KẾT QUẢ THẬT, không phải bị người từ chối.
 */
export function tomTatKiemChoModel(k: KetQuaKiem, lan: number): string {
  const tep = k.vitest.tep ? `Test Files ${k.vitest.tep.hong > 0 ? `${k.vitest.tep.hong} failed | ` : ""}${k.vitest.tep.dat} passed (${k.vitest.tep.tong})` : "Test Files: (không có dòng tổng kết)";
  const ca = k.vitest.ca ? `Tests ${k.vitest.ca.hong > 0 ? `${k.vitest.ca.hong} failed | ` : ""}${k.vitest.ca.dat} passed (${k.vitest.ca.tong})` : "Tests: (không có dòng tổng kết)";
  const dau = k.hetGio ? `hết hạn sau ${k.giay}s` : k.loi ? `không khởi chạy được: ${k.loi}` : `thoát mã ${k.exit}`;
  const phan = dungPhanCaDo(k);
  return [
    `[pilot] KHÔNG PHẢI bị người từ chối: bộ chạy đã TỰ CHẠY lệnh kiểm này thay bạn (lần ${lan}); đây là KẾT QUẢ THẬT. ${dau}.`,
    tep,
    ca,
    ...(phan ? ["--- ca đỏ ---", ...phan.dong] : []),
    ...(!phan || phan.kemDuoi ? ["--- đuôi đầu ra ---", k.duoi.length > DUOI_CHO_MODEL ? k.duoi.slice(-DUOI_CHO_MODEL) : k.duoi] : []),
    "Đỏ ⇒ sửa tệp rồi gọi lại đúng lệnh này; xanh ⇒ báo kết quả cuối. Bộ chạy cũng tự chạy lại lệnh kiểm khi bạn kết thúc.",
  ].join("\n");
}

/**
 * `--cho-phep-db`: lời nhắc cho model sau lần tự chạy lệnh kiểm CHỈ gồm CON SỐ: mã thoát, `Test Files`, `Tests` (kèm số ca đỏ). KHÔNG đuôi đầu ra, KHÔNG tên ca (tên ca do model đặt nên cũng mang được bí mật),
 * KHÔNG thông điệp lỗi / văn bản lỗi khởi chạy. Đầu ra đầy đủ đi vào TỆP KẾT QUẢ cho người duyệt (xem `v.ra`). Văn bản vẫn qua bộ lọc URL + giá trị bí mật như lưới thứ hai.
 */
export function tomTatChiSoChoModel(k: KetQuaKiem, lan: number, giaTriBiMat: readonly string[]): string {
  const tep = k.vitest.tep ? `Test Files ${k.vitest.tep.hong > 0 ? `${k.vitest.tep.hong} failed | ` : ""}${k.vitest.tep.dat} passed (${k.vitest.tep.tong})` : "Test Files: (không có dòng tổng kết)";
  const ca = k.vitest.ca ? `Tests ${k.vitest.ca.hong > 0 ? `${k.vitest.ca.hong} failed | ` : ""}${k.vitest.ca.dat} passed (${k.vitest.ca.tong})` : "Tests: (không có dòng tổng kết)";
  const dau = k.hetGio ? `hết hạn sau ${k.giay}s` : k.loi ? "không khởi chạy được" : `thoát mã ${k.exit}`;
  return xoaGiaTriBiMat(
    loaiUrlCsdl(
      [
        `[pilot] KHÔNG PHẢI bị người từ chối: bộ chạy đã TỰ CHẠY lệnh kiểm này thay bạn (lần ${lan}); đây là KẾT QUẢ THẬT. ${dau}.`,
        tep,
        ca,
        "(đầu ra chi tiết và tên ca KHÔNG được cung cấp vì lượt này chạm CSDL _test; chỉ có con số ở trên)",
        "Số ca đỏ > 0 ⇒ đọc lại mã và test của bạn, sửa tệp rồi gọi lại đúng lệnh này; toàn xanh ⇒ báo kết quả cuối. Bộ chạy cũng tự chạy lại lệnh kiểm khi bạn kết thúc.",
      ].join("\n"),
    ),
    giaTriBiMat,
  );
}

// ── Phụ thuộc ──────────────────────────────────────────────────────────────────────────────────────

type SuKien = { loai: string; [k: string]: unknown };
export interface PhuThuocHost {
  /** trả lỗi (chuỗi) nếu môi trường không đạt; null = đạt */
  kiemMoiTruong(v: DauVaoDriver): Promise<string | null>;
  taoLuot(y: { cauHoi: string; projectId: string; gioiHan?: GioiHanLuotChoDriver }): Promise<{ ok: true; runId: string } | { ok: false; loi: string }>;
  nghe(runId: string, f: (m: { seq: number; suKien: SuKien }) => void): (() => void) | null;
  huy(runId: string): void;
  duyet(actionId: string): Promise<{ ok: boolean; daGhi: boolean; status: string | null }>;
  bac(actionId: string, lyDo: string): Promise<void>;
  /**
   * (cổng kế hoạch 11.3-C — chỉ khi env tiến trình có AI_AGENT_CONG_KE_HOACH=1) quyết kế hoạch của lượt qua `thuTucDuyetKeHoach` (KHÔNG phải confirmAction:
   * duyệt kế hoạch không duyệt thẻ ghi/lệnh). `bam` PHẢI là băm của sự kiện `ke-hoach-cho-duyet` hiện tại — máy chủ so với băm đã lưu và từ chối nếu lệch.
   */
  duyetKeHoach?(runId: string, bam: string, quyetDinh: "duyet" | "bac"): Promise<{ ok: boolean; note: string | null }>;
  duAnId(wt: string): string;
  /** (tuỳ chọn) trạng thái lượt đọc từ kho sau khi dừng */
  trangThaiLuot?(runId: string): Promise<{ trangThai: string | null; lyDoDung: string | null } | null>;
  chinhSachDuyet: ChinhSachDuyet;
  /** đo thời gian chờ người (ms) — tiêm được để test */
  bay(): number;
  /** (tuỳ chọn) chạy lệnh kiểm tự động khi model xin run_command đúng LỆNH KIỂM; mặc định chạy thật (kiemChung.chayLenhKiem) */
  chayKiem?: ChayKiem;
  /** V2 (tuỳ chọn): model llama-server đang phục vụ; null = không biết. Vắng ⇒ kết quả không có `modelPhucVu`. */
  modelDangPhucVu?(): Promise<string | null>;
  /** TD-4 (tuỳ chọn): cờ trí nhớ bài học CÓ HIỆU LỰC trong tiến trình chạy lượt. */
  coBaiHoc?(): boolean | Promise<boolean>;
  /** Bảo đảm có khoá ký checkpoint (SECRET_ENCRYPTION_KEY|JWT_SECRET ≥ 16). `tam` = bộ chạy tự sinh khoá riêng của tiến trình. */
  datKhoaKy(): { ok: boolean; tam: boolean };
}

export const driverHost = (dep: PhuThuocHost, hanDuyetGiay = 3600) => {
  // V10: driver này TỰ KHAI biết kiểm kiểu trong vòng (xem Driver.kiemKieuTrongVong)
  const chayMotLuot = async function host(v: DauVaoDriver): Promise<KetQuaDriver & { hetGio: boolean; loi?: string }> {
    const ghiChu: string[] = [];
    const loiMt = await dep.kiemMoiTruong(v);
    if (loiMt) return { vong: null, token: null, ghiChu, hetGio: false, loi: `môi trường không đạt: ${loiMt}` };
    // Checkpoint ký manifest TRƯỚC mọi lượt ghi: thiếu khoá ⇒ write_file bị chặn trước cả cổng duyệt (TC-01 lượt 2). Kiểm TRƯỚC khi tạo lượt.
    const khoa = dep.datKhoaKy();
    if (!khoa.ok) return { vong: null, token: null, ghiChu, hetGio: false, loi: "môi trường không đạt: thiếu khoá ký checkpoint (SECRET_ENCRYPTION_KEY|JWT_SECRET ≥ 16 ký tự) và không tạo được khoá tạm" };
    const luuY: string[] = khoa.tam ? ["checkpoint ký bằng khoá pilot tạm (sinh ngẫu nhiên cho tiến trình này; checkpoint của lượt không đọc lại được sau khi tiến trình thoát)"] : [];
    const loiCongCu: Record<string, number> = {};

    if (v.ghiLuotDir) {
      try {
        fs.mkdirSync(v.ghiLuotDir, { recursive: true });
        fs.writeFileSync(path.join(v.ghiLuotDir, TEP_CANH_BAO_GHI_LUOT), CHU_CANH_BAO_GHI_LUOT, { encoding: "utf8", flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") luuY.push(`ghi lượt: không ghi được ${TEP_CANH_BAO_GHI_LUOT} (${(e as NodeJS.ErrnoException).code ?? "lỗi"})`);
      }
    }
    // V2: hỏi model TRƯỚC khi tạo lượt (và lần nữa sau khi lượt kết thúc). Hỏi hỏng ⇒ null, không đưa chữ lỗi đi đâu.
    const hoiModel = async (): Promise<string | null> => {
      try {
        return (await dep.modelDangPhucVu?.()) ?? null;
      } catch {
        return null;
      }
    };
    const modelDau = dep.modelDangPhucVu ? await hoiModel() : null;

    const projectId = dep.duAnId(v.wt);
    const cauHoi = `[${NHAN_PILOT}:${v.the.ma}] ${v.lenh}`;
    const tao = await dep.taoLuot({ cauHoi, projectId, ...(v.gioiHanLuot ? { gioiHan: v.gioiHanLuot } : {}) });
    if (!tao.ok) return { vong: null, token: null, ghiChu, hetGio: false, loi: `không tạo được lượt: ${tao.loi}` };

    const th = { soLanCho: 0, soChapNhan: 0, soTuChoi: 0, msCho: 0 };
    /** thống kê RIÊNG cho cổng kế hoạch (không lẫn với thẻ ghi/lệnh) */
    const kh = { soLanCho: 0, soChapNhan: 0, soTuChoi: 0 };
    let vong = 0;
    let cache = 0;
    let prompt = 0;
    let coCache = false;
    let soLuotModel = 0;
    let ketThuc: { loai: "xong" } | { loai: "loi"; thongDiep: string } | null = null;
    /** lỗi của lượt (STICKY: sự kiện `xong` đến SAU `loi` không được xoá nó — bug lượt TC-01 đầu tiên báo "xong" cho lượt lỗi model) và lý do dừng */
    let loiLuot: string | null = null;
    let lyDoDung: string | null = null;
    let hetGioDuyet = false;
    let chuoi: Promise<void> = Promise.resolve();
    /** thời điểm bắt đầu chờ người (đang chờ dở) — để hạn model KHÔNG tính cả lúc đang chờ */
    let dangChoTu: number | null = null;
    /** nhãn riêng cho các từ chối (id lời gọi tool → nhãn): để loiCongCu không trộn "bộ chạy/người từ chối" (mã BI_BAC của host) với lỗi công cụ THẬT */
    const nhanTuChoi = new Map<string, string>();

    let soTuChay = 0;
    const kieuGhi: KieuMotLan[] = [];
    let soNhacPhu = 0;
    let soLanBaoHan = 0;
    // TD-1: MỌI thẻ được ghi quyết định + một tệp hồ sơ. Chỉ ghi thêm: không đổi gì gửi model; ghi hỏng không làm hỏng lượt.
    const theDuyet: TheDuyetMuc[] = [];
    const xoaBiMat = (s: string) => (v.giaTriBiMat?.length ? xoaGiaTriBiMat(s, v.giaTriBiMat) : s);
    const hoSoCua = (actionId: string, de: { ten: string; thamSo: Record<string, unknown>; moTa?: string; xemTruoc?: unknown; nguonDangNgo?: string[] }, duong: string[]): HoSoCho => ({
      ma: v.the.ma,
      id: actionId,
      ten: de.ten,
      duong,
      moTa: de.moTa ?? null,
      lyDoModel: typeof de.thamSo.reason === "string" ? de.thamSo.reason : null,
      xemTruoc: de.xemTruoc ?? null,
      thamSo: de.thamSo,
      nguonDangNgo: de.nguonDangNgo ?? [],
      luc: new Date().toISOString(),
    });
    const ghiThe = (hoSo: HoSoCho, ai: TheDuyetMuc["ai"], quyet: TheDuyetMuc["quyet"], lyDo: string | null) => {
      const lyDoSach = lyDo === null ? null : cheTokenTrongDauRa(xoaBiMat(lyDo)).slice(0, 300);
      const luc = new Date().toISOString();
      let tep: string | null = tenTepHoSoThe(hoSo.id);
      try {
        const dich = path.join(v.ra, tep);
        fs.mkdirSync(path.dirname(dich), { recursive: true });
        fs.writeFileSync(dich, JSON.stringify({ ...hoSo, quyetDinh: { ai, quyet, lyDo: lyDoSach, luc } }, (_k, x: unknown) => (typeof x === "string" ? xoaBiMat(x) : x), 2), "utf8");
      } catch (e) {
        luuY.push(`không ghi được hồ sơ thẻ ${tep} (${(e as NodeJS.ErrnoException).code ?? "lỗi"})`);
        tep = null;
      }
      theDuyet.push({ id: hoSo.id, ten: hoSo.ten, duong: hoSo.duong.map(xoaBiMat), ai, quyet, lyDo: lyDoSach, soCanhBao: hoSo.canhBao?.length ?? 0, luc, tep });
    };
    const xuLyDuyet = async (id: string, de: { ten: string; thamSo: Record<string, unknown>; moTa?: string; xemTruoc?: unknown; nguonDangNgo?: string[] }, actionId: string) => {
      const loc = locTruocKhiCho(de, v.the, v.wt);
      if (loc.loai === "tu-choi") {
        th.soTuChoi++;
        nhanTuChoi.set(id, NHAN_TU_CHOI_BO_CHAY);
        ghiChu.push(`tự từ chối ${de.ten}: ${loc.lyDo}`);
        ghiThe(hoSoCua(actionId, de, duongCuaDeXuat(de.thamSo)), "bo-chay", "tu-choi", loc.lyDo);
        await dep.bac(actionId, `[pilot tự từ chối] ${loc.lyDo}`);
        return;
      }
      if (loc.loai === "tu-chay") {
        nhanTuChoi.set(id, NHAN_TU_CHAY_LENH_KIEM);
        soTuChay++;
        ghiThe(hoSoCua(actionId, de, []), "bo-chay", soTuChay > TRAN_TU_CHAY ? "tu-choi" : "tu-chay", soTuChay > TRAN_TU_CHAY ? `quá ${TRAN_TU_CHAY} lần tự chạy lệnh kiểm trong một lượt` : null);
        if (soTuChay > TRAN_TU_CHAY) {
          ghiChu.push(`quá ${TRAN_TU_CHAY} lần tự chạy lệnh kiểm trong một lượt — từ chối`);
          await dep.bac(actionId, `[pilot] đã tự chạy lệnh kiểm ${TRAN_TU_CHAY} lần trong lượt này; dừng gọi lại và báo kết quả cuối.`);
          return;
        }
        const k = await (v.chayKiem ?? dep.chayKiem ?? chayLenhKiem)(loc.lenh, v.wt, 300);
        ghiChu.push(`tự chạy lệnh kiểm lần ${soTuChay}: exit ${k.exit}${k.vitest.ca ? `, Tests ${k.vitest.ca.dat} passed / ${k.vitest.ca.tong}` : ""}`);
        // tóm tắt cho model được TÍNH và GỬI trước; tệp đầy đủ chỉ được ghi SAU đó (không có đường nào từ nội dung tệp vào lời nhắc)
        let loiNhac = v.cheDoKiem === "chi-so" ? tomTatChiSoChoModel(k, soTuChay, v.giaTriBiMat ?? []) : tomTatKiemChoModel(k, soTuChay);
        // HA-10: dòng PHỦ do HOST sinh từ quét TĨNH tệp test (số dòng + tag, KHÔNG từ đầu ra test) ⇒ được kèm cả ở chế độ chi-so (không mở kênh lộ dữ liệu). Nhắc dòng THIẾU tối đa 2 lần/lượt.
        if (v.phu) {
          const nguon = v.phu.tepTest.map((t) => { try { return fs.readFileSync(path.join(v.wt, t), "utf8"); } catch { return ""; } }).join("\n");
          const ph = tinhPhu(v.phu.dongDuyet, nguon, { tenCaCu: v.phu.tenCaCu });
          const msg = loiNhacPhu(ph);
          if (msg !== "" && (ph.dongThieu.length === 0 || soNhacPhu < 2)) {
            loiNhac = `${loiNhac}\n${msg}`;
            if (ph.dongThieu.length > 0) soNhacPhu++;
            ghiChu.push(`PHỦ lần ${soTuChay}: thiếu dòng ${ph.dongThieu.join(",") || "(không)"}`);
          }
        }
        // (V0, chỉ số M19) bao nhiêu tên ca đỏ tới model; chế độ chi-so không gửi tên nên không ghi
        const phan = v.cheDoKiem === "chi-so" ? null : dungPhanCaDo(k);
        if (phan) ghiChu.push(`V0 lần ${soTuChay}: gửi model tên ${phan.soTenGui}/${phan.soCaDo} ca đỏ; cắt chi tiết ${phan.soKhoiCat} khối; ${phan.soKyTu} ký tự chi tiết`);
        // V10: khối kiểu đặt CUỐI lời nhắc; giờ tsc vẫn nằm trong thời gian thẻ lệnh đang chờ
        if (v.kieu) {
          const r = await kiemKieuTrongVong(v, k);
          loiNhac = `${loiNhac}\n${r.van}`;
          kieuGhi.push({ lan: soTuChay, giay: r.giay, trangThai: r.trangThai });
          ghiChu.push(`KIỂU lần ${soTuChay}: ${r.trangThai}${r.giay === null ? "" : `, ${r.giay} s`}`);
        }
        await dep.bac(actionId, loiNhac);
        if (v.cheDoKiem === "chi-so") {
          // đầu ra ĐẦY ĐỦ (đã lọc URL + bí mật) chỉ cho NGƯỜI duyệt đọc — tệp kết quả, không bao giờ đi vào lời nhắc của model
          try {
            fs.mkdirSync(v.ra, { recursive: true });
            fs.writeFileSync(path.join(v.ra, `${v.the.ma}.kiem-trong-luot-lan${soTuChay}.txt`), k.dauRaDayDu ?? k.duoi, "utf8");
          } catch {
            /* ghi tệp phụ không được làm hỏng lượt */
          }
        }
        return;
      }
      th.soLanCho++;
      const t0 = dep.bay();
      dangChoTu = t0;
      const hanMs = hanDuyetHieuLucMs(hanDuyetGiay);
      if (hanDuyetGiay * 1000 > hanMs && soLanBaoHan++ === 0) {
        ghiChu.push(`--han-duyet ${hanDuyetGiay}s dài hơn TTL thẻ ${TTL_THE_DUYET_MS / 1000}s ⇒ chờ người tối đa ${Math.round(hanMs / 1000)}s mỗi thẻ (thẻ hết hạn sau đó dù bộ chạy còn đợi)`);
      }
      // HA-9: quét tĩnh phần được thêm / đổi — CHỈ cảnh báo, không chặn; lỗi của bộ quét không làm hỏng lượt
      let canhBao: CanhBao[] = [];
      try {
        const thuc = (() => {
          try {
            return fs.realpathSync.native(os.tmpdir());
          } catch {
            return undefined;
          }
        })();
        canhBao = quetHoSo({ xemTruoc: de.xemTruoc, thamSo: de.thamSo }, { wt: v.wt, thuMucTam: thuMucTamMacDinh(os.tmpdir(), thuc), choPhep: v.the.choPhepTrongTest });
      } catch (e) {
        ghiChu.push(`bộ quét tĩnh lỗi (bỏ qua): ${e instanceof Error ? e.message : String(e)}`);
      }
      if (canhBao.length) ghiChu.push(`thẻ ${de.ten} ${loc.duong.join(",")}: ${tomTatCanhBao(canhBao)}`);
      const hoSo: HoSoCho = { ...hoSoCua(actionId, de, loc.duong), hetHanLuc: new Date(Date.now() + hanMs).toISOString(), ...(canhBao.length ? { canhBao } : {}) };
      const q = await dep.chinhSachDuyet(hoSo, { ra: v.ra, hanMs });
      th.msCho += dep.bay() - t0;
      dangChoTu = null;
      ghiThe(hoSo, "nguoi", q.quyet, q.quyet === "het-gio" ? null : (q.lyDo ?? null));
      if (q.quyet === "chap-nhan") {
        th.soChapNhan++;
        const kq = await dep.duyet(actionId);
        ghiChu.push(`duyệt ${de.ten} ${loc.duong.join(",")}: ok=${kq.ok} daGhi=${kq.daGhi} status=${kq.status}`);
      } else {
        th.soTuChoi++;
        nhanTuChoi.set(id, q.quyet === "het-gio" ? NHAN_HET_GIO_DUYET : NHAN_TU_CHOI_NGUOI);
        if (q.quyet === "het-gio") hetGioDuyet = true;
        await dep.bac(actionId, q.quyet === "het-gio" ? "hết hạn chờ dieu-phoi" : (q.lyDo ?? "dieu-phoi từ chối"));
      }
    };

    /** (11.3-C) chờ NGƯỜI duyệt KẾ HOẠCH: cùng đường hồ sơ ↔ quyết định với thẻ ghi (cho-duyet.json / duyet.ts), id = `kh-<băm>` nên quyết định của kế hoạch CŨ không duyệt kế hoạch mới */
    const xuLyKeHoach = async (runId: string, viec: unknown, bam: string) => {
      kh.soLanCho++;
      const t0 = dep.bay();
      dangChoTu = t0;
      const hanMs = hanKeHoachHieuLucMs(hanDuyetGiay);
      const hoSoKeHoach: HoSoCho = {
          ma: v.the.ma,
          id: idKeHoach(bam),
          ten: "ke_hoach",
          duong: [],
          moTa: `Kế hoạch của Thợ Cả (${Array.isArray(viec) ? viec.length : "?"} bước) — duyệt kế hoạch KHÔNG duyệt thẻ ghi/lệnh`,
          lyDoModel: null,
          xemTruoc: viec,
          thamSo: { viec, bam },
          nguonDangNgo: [],
          luc: new Date().toISOString(),
          hetHanLuc: new Date(Date.now() + hanMs).toISOString(),
      };
      const q = await dep.chinhSachDuyet(hoSoKeHoach, { ra: v.ra, hanMs });
      th.msCho += dep.bay() - t0;
      dangChoTu = null;
      ghiThe(hoSoKeHoach, "nguoi", q.quyet, q.quyet === "het-gio" ? null : (q.lyDo ?? null));
      const quyet: "duyet" | "bac" = q.quyet === "chap-nhan" ? "duyet" : "bac";
      if (quyet === "duyet") kh.soChapNhan++;
      else {
        kh.soTuChoi++;
        if (q.quyet === "het-gio") hetGioDuyet = true;
      }
      if (!dep.duyetKeHoach) {
        ghiChu.push("dep không có duyetKeHoach — không thể quyết kế hoạch (lượt sẽ hết hạn chờ kế hoạch)");
        return;
      }
      const r = await dep.duyetKeHoach(runId, bam, quyet);
      ghiChu.push(`kế hoạch ${quyet} (băm ${bam.slice(0, 8)}): ok=${r.ok}${r.note ? ` note=${r.note}` : ""}`);
      if (!r.ok) {
        const k = `DUYET_KE_HOACH_LOI:${r.note ?? "?"}`;
        loiCongCu[k] = (loiCongCu[k] ?? 0) + 1;
      }
    };

    const dung = dep.nghe(tao.runId, (m) => {
      const e = m.suKien;
      if (e.loai === "ke-hoach-cho-duyet") {
        chuoi = chuoi.then(() => xuLyKeHoach(tao.runId, e.viec, String(e.bam))).catch((err) => void ghiChu.push(`lỗi duyệt kế hoạch: ${String(err)}`));
      } else if (e.loai === "can-duyet") {
        const de = e.deXuat as { ten: string; thamSo: Record<string, unknown>; moTa?: string; xemTruoc?: unknown; nguonDangNgo?: string[]; pendingActionId?: string | number };
        const actionId = de.pendingActionId !== undefined ? String(de.pendingActionId) : String(e.id);
        chuoi = chuoi.then(() => xuLyDuyet(String(e.id), de, actionId)).catch((err) => void ghiChu.push(`lỗi duyệt: ${String(err)}`));
      } else if (e.loai === "usage") {
        soLuotModel++;
        if (typeof e.cacheN === "number" && typeof e.promptN === "number") {
          coCache = true;
          cache += e.cacheN;
          prompt += e.promptN;
        }
      } else if (e.loai === "ket-qua-tool" && e.ok === false) {
        const k = (e.ma === "BI_BAC" && nhanTuChoi.get(String(e.id))) || keLoiCongCu(e);
        loiCongCu[k] = (loiCongCu[k] ?? 0) + 1;
      } else if (e.loai === "goi-tool" && typeof e.luot === "number") {
        vong = Math.max(vong, e.luot);
      } else if (e.loai === "xong") {
        lyDoDung = typeof e.lyDo === "string" ? e.lyDo : "khong-ro";
        if (ketThuc === null) ketThuc = { loai: "xong" };
      } else if (e.loai === "loi") {
        loiLuot ??= `${String(e.ma)}: ${String(e.thongDiep)}`;
        ketThuc = { loai: "loi", thongDiep: loiLuot };
      }
    });
    if (!dung) return { vong: null, token: null, ghiChu, hetGio: false, loi: "không nghe được lượt vừa tạo" };

    // Chờ kết thúc. Hạn = hanGiay của thẻ (thời gian MODEL) + thời gian đã chờ người (không tính vào hạn model).
    const t0 = dep.bay();
    let hetGio = false;
    while (ketThuc === null) {
      const daQua = dep.bay() - t0 - th.msCho - (dangChoTu !== null ? dep.bay() - dangChoTu : 0);
      if (daQua > v.hanGiay * 1000) {
        hetGio = true;
        dep.huy(tao.runId);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await chuoi;
    dung();
    if (hetGioDuyet) hetGio = true;

    const kq: KetQuaDriver & { hetGio: boolean; loi?: string } = {
      vong: vong || null,
      token: soLuotModel > 0 ? { cache: coCache ? cache : null, prompt: coCache ? prompt : null, soLuotModel } : null,
      ghiChu,
      hetGio,
      duyet: { soLanCho: th.soLanCho, soChapNhan: th.soChapNhan, soTuChoi: th.soTuChoi, giayChoDuyet: Math.round(th.msCho / 100) / 10 },
      ...(kh.soLanCho > 0 ? { keHoach: { ...kh } } : {}),
    };
    if (loiLuot) kq.loi = loiLuot;
    else if (lyDoDung === "het-gio") kq.hetGio = true;
    else if (lyDoDung !== null && lyDoDung !== "hoan-thanh") kq.loi = `lượt dừng không hoàn thành: lyDo=${lyDoDung}`;
    // nguồn thứ hai: hàng ai_agent_runs (trangThai) — lượt "loi" mà sự kiện không kịp tới vẫn không được tính là xong
    if (!kq.loi && !kq.hetGio && dep.trangThaiLuot) {
      const t = await dep.trangThaiLuot(tao.runId).catch(() => null);
      if (t && t.trangThai === "loi") kq.loi = `hàng lượt trangThai=loi lyDoDung=${t.lyDoDung ?? "?"}`;
    }
    if (lyDoDung !== null) kq.lyDoDung = lyDoDung;
    kq.loiCongCu = loiCongCu;
    kq.soTuChay = soTuChay;
    if (kieuGhi.length > 0) kq.kieuTrongVong = kieuGhi;
    if (v.phu) kq.soLanNhacPhu = soNhacPhu;
    kq.runId = tao.runId;
    if (theDuyet.length > 0) kq.theDuyet = theDuyet;
    if (dep.modelDangPhucVu) kq.modelPhucVu = { dau: modelDau, cuoi: await hoiModel() };
    if (dep.coBaiHoc || v.ghiLuotDir) kq.baiHoc = await nenLoiNhac(tao.runId, v.ghiLuotDir, dep.coBaiHoc, luuY);
    if (luuY.length > 0) kq.luuY = luuY;
    return kq;
  };
  // TD-4: AI_GHI_LUOT_DIR chỉ có trong lúc lượt chạy (bộ ghi của máy chủ đọc biến này ở mỗi lượt model), rồi trả lại giá trị cũ
  const chay = async (v: DauVaoDriver): Promise<KetQuaDriver & { hetGio: boolean; loi?: string }> => {
    if (!v.ghiLuotDir) return chayMotLuot(v);
    const cu = process.env.AI_GHI_LUOT_DIR;
    process.env.AI_GHI_LUOT_DIR = v.ghiLuotDir;
    try {
      return await chayMotLuot(v);
    } finally {
      if (cu === undefined) delete process.env.AI_GHI_LUOT_DIR;
      else process.env.AI_GHI_LUOT_DIR = cu;
    }
  };
  return Object.assign(chay, { kiemKieuTrongVong: true as const });
};

/** TD-4 — nền lời nhắc của lượt: cờ bài học + (khi có ghi lượt) số bài và băm đọc từ `<thư mục>/<runId>.jsonl`. Bật ghi mà không thấy bản ghi ⇒ NÓI (lưu ý). */
async function nenLoiNhac(runId: string, ghiLuotDir: string | null, coBaiHoc: PhuThuocHost["coBaiHoc"], luuY: string[]): Promise<BaiHocLuot> {
  let co: boolean | null = null;
  try {
    co = coBaiHoc ? await coBaiHoc() : null;
  } catch {
    co = null;
  }
  const khong = (lyDo: string): BaiHocLuot => ({ runId, co, soBai: null, bamHeThong: null, lyDo });
  if (!ghiLuotDir) return khong("không bật ghi lượt");
  let noiDung: string;
  try {
    noiDung = fs.readFileSync(path.join(ghiLuotDir, `${runId.toLowerCase()}.jsonl`), "utf8");
  } catch {
    luuY.push(`ghi lượt: không thấy bản ghi của lượt ${runId} trong thư mục ghi (bộ ghi có thể đã từ chối thư mục)`);
    return khong("không thấy bản ghi lượt trong thư mục ghi");
  }
  return { runId, co, ...docBaiHocTuBanGhi(noiDung) };
}


// ── Phụ thuộc THẬT (nạp lười: chỉ khi --driver host) ────────────────────────────────────────────────

export interface CauHinhHostThat {
  nguoi: { id: number; role: string; name?: string | null };
  chinhSachDuyet?: ChinhSachDuyet;
  /** CHỈ ĐỂ TIÊM TRONG TEST: trộn vào bộ quản lý lượt MỚI dựng khi thẻ có trần (`taoQuanLyLuotChay({ ...phuThuocQuanLy, gioiHan })`); không áp cho bộ dùng chung, không đọc biến môi trường; vắng ⇒ hành vi thật không đổi. */
  phuThuocQuanLy?: Partial<PhuThuocQuanLy>;
}

export async function phuThuocHostThat(c: CauHinhHostThat): Promise<PhuThuocHost> {
  const { quanLyLuotChay, taoQuanLyLuotChay } = await import("../../server/services/ai/agent/quanLyLuotChay");
  const tt = await import("../../server/services/ai/agent/thuTucLuotChay");
  const tk = await import("../../server/services/ai/agent/thuTucKeHoach");
  // HA-3: trần lượt do khoá thẻ ⇒ dựng quản lý lượt MỚI bằng `taoQuanLyLuotChay({ gioiHan })` (chỉ khi thẻ có khoá; mặc định giữ bộ dùng chung `quanLyLuotChay()`)
  let ql = quanLyLuotChay();
  return {
    async kiemMoiTruong(v) {
      const url = process.env.DATABASE_URL;
      if (!url) return "thiếu DATABASE_URL (phải trỏ aoi_management_test)";
      const thieuMt = thieuKhoaModel(process.env);
      if (thieuMt.length > 0) return `thiếu khoá cấu hình model: ${thieuMt.join(", ")} (xem --env-tu / napEnv.ts)`;
      const roots = process.env.AI_REPO_SANDBOX_ROOTS ?? "";
      const ten = path.basename(path.resolve(v.wt));
      const co = roots.split(";").some((m) => {
        const i = m.indexOf("=");
        if (i < 0 || m.slice(0, i).trim() !== ten) return false;
        const p = m.slice(i + 1).split("|").pop() ?? "";
        return path.resolve(p.trim()).toLowerCase() === path.resolve(v.wt).toLowerCase();
      });
      if (!co) return `AI_REPO_SANDBOX_ROOTS thiếu "${ten}=<đường worktree>"`;
      const postgres = (await import("postgres")).default;
      const sql = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const [r] = await sql`SELECT current_database() AS db`;
        if (r?.db !== CSDL_CHO_PHEP) return `current_database() = ${String(r?.db)}, chỉ cho phép ${CSDL_CHO_PHEP}`;
      } catch (e) {
        return `không kiểm được current_database(): ${(e as Error).message}`;
      } finally {
        await sql.end({ timeout: 2 });
      }
      return null;
    },
    async taoLuot(y) {
      // `quanLyLuotChay()` KHÔNG nhận tham số (bộ dùng chung); `taoQuanLyLuotChay({ gioiHan })` mới dựng bộ có trần. Các thủ tục duyệt/bác/kế hoạch không dùng bộ quản lý (bus theo actionId/runId ở mức module) nên không cần truyền `ql`.
      if (y.gioiHan) ql = taoQuanLyLuotChay({ ...c.phuThuocQuanLy, gioiHan: y.gioiHan });
      const kq = await ql.taoLuotChay({ user: c.nguoi, cauHoi: y.cauHoi, projectId: y.projectId, cheDo: "sua", lichSu: [], ngonNgu: "vi" });
      return kq.ok ? { ok: true, runId: kq.luot.id } : { ok: false, loi: `${kq.ma}${kq.thongDiep ? `: ${kq.thongDiep}` : ""}` };
    },
    nghe: (runId, f) => ql.nghe(runId, c.nguoi.id, 0, f as never),
    huy: (runId) => void ql.huy(runId, c.nguoi.id),
    async duyet(actionId) {
      const r = await tt.thuTucDuyet(c.nguoi, { actionId, lang: "vi" });
      return { ok: r.ok, daGhi: r.daGhi ?? false, status: (r.status as string | null) ?? null };
    },
    async bac(actionId, lyDo) {
      await tt.thuTucBac(c.nguoi, { actionId, lyDo });
    },
    async duyetKeHoach(runId, bam, quyetDinh) {
      const r = await tk.thuTucDuyetKeHoach(c.nguoi, { runId, bam, quyetDinh });
      return { ok: r.ok, note: r.note };
    },
    duAnId: (wt) => path.basename(path.resolve(wt)),
    async trangThaiLuot(runId) {
      const ct = await ql.chiTiet(runId, c.nguoi.id);
      return ct ? { trangThai: String((ct as unknown as { trangThai?: unknown }).trangThai ?? ""), lyDoDung: ((ct as unknown as { lyDoDung?: string | null }).lyDoDung ?? null) } : null;
    },
    modelDangPhucVu: async () => (await import("../../server/services/aiLlamaServerClient")).modelServerDangChay(),
    coBaiHoc: async () => (await import("../../server/services/ai/codingLessonContext")).baiHocEnabled(),
    chinhSachDuyet: c.chinhSachDuyet ?? duyetQuaTep,
    bay: () => Date.now(),
    datKhoaKy: () => bamKhoaKyTam(process.env),
  };
}

/** Khoá model/serving mà host agent BẮT BUỘC có (thiếu ⇒ model null ⇒ "tool call không hỗ trợ"). Thuần. */
export function thieuKhoaModel(env: Record<string, string | undefined>): string[] {
  const ra: string[] = [];
  const bat = (env.LLAMA_SERVER_ENABLED ?? "").trim().toLowerCase();
  if (bat !== "true" && bat !== "1") ra.push("LLAMA_SERVER_ENABLED=true");
  if (!(env.LLAMA_SERVER_URL ?? "").trim()) ra.push("LLAMA_SERVER_URL");
  if (!(env.LLAMA_SERVER_MODEL ?? "").trim()) ra.push("LLAMA_SERVER_MODEL");
  if (!(env.GGUF_CODE_MODEL ?? "").trim() && !(env.GGUF_DEFAULT_MODEL ?? "").trim()) ra.push("GGUF_CODE_MODEL|GGUF_DEFAULT_MODEL");
  return ra;
}

/** Khoá ký checkpoint: có sẵn (≥ 16 ký tự, theo đúng thứ tự ưu tiên của checkpointAgent) ⇒ giữ; không ⇒ SINH khoá ngẫu nhiên RIÊNG cho tiến trình (không dùng bí mật server, không in). */
export function bamKhoaKyTam(env: Record<string, string | undefined>): { ok: boolean; tam: boolean } {
  const ikm = (env.SECRET_ENCRYPTION_KEY ?? "").trim() || (env.JWT_SECRET ?? "").trim();
  if (ikm.length >= 16) return { ok: true, tam: false };
  env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  return { ok: true, tam: true };
}

/** Khoá đếm lỗi công cụ: `ma` của kết quả tool (vd CHECKPOINT_LOI); nếu tóm tắt nêu thêm một mã IN HOA (vd KHONG_CO_KHOA) thì `ma:MÃ`. Thuần. */
export function keLoiCongCu(e: { ma?: unknown; tomTat?: unknown; [khoa: string]: unknown }): string {
  const ma = typeof e.ma === "string" && e.ma !== "" ? e.ma : "KHONG_RO";
  const tt = typeof e.tomTat === "string" ? e.tomTat : "";
  const m = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/.exec(tt);
  return m && m[1] !== ma ? `${ma}:${m[1]}` : ma;
}
