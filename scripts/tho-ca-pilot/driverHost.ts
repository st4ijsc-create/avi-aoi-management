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
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chuanDuong, kiemDiffTheoThe, vungCamCua, type TheViec } from "./theViec";
import { chayLenhKiem, loaiUrlCsdl, type ChayKiem, type KetQuaKiem } from "./kiemChung";
import type { DauVaoDriver, KetQuaDriver } from "./chayMotViec";

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
  ghiNguyenTu(tepDangCho(ctx.ra), `${h.ma} ${h.ten} ${h.duong.join(",")} id=${h.id} HET HAN ${hetHan}\n`);
  process.stderr.write(`[tho-ca-pilot] CHỜ DUYỆT ${h.ma} ${h.ten} ${h.duong.join(",")} id=${h.id} HẾT HẠN ${hetHan} → ${tepChoDuyet(ctx.ra, h.ma)}\n`);
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

/**
 * Văn bản trả cho model khi bộ chạy TỰ chạy LỆNH KIỂM thay cho thẻ duyệt. Kênh duy nhất để đưa kết quả về model là lý do từ chối của thẻ
 * (host in nó sau "User rejected this change:"), nên câu đầu nói rõ đây là KẾT QUẢ THẬT, không phải bị người từ chối.
 */
export function tomTatKiemChoModel(k: KetQuaKiem, lan: number): string {
  const tep = k.vitest.tep ? `Test Files ${k.vitest.tep.hong > 0 ? `${k.vitest.tep.hong} failed | ` : ""}${k.vitest.tep.dat} passed (${k.vitest.tep.tong})` : "Test Files: (không có dòng tổng kết)";
  const ca = k.vitest.ca ? `Tests ${k.vitest.ca.hong > 0 ? `${k.vitest.ca.hong} failed | ` : ""}${k.vitest.ca.dat} passed (${k.vitest.ca.tong})` : "Tests: (không có dòng tổng kết)";
  const dau = k.hetGio ? `hết hạn sau ${k.giay}s` : k.loi ? `không khởi chạy được: ${k.loi}` : `thoát mã ${k.exit}`;
  return loaiUrlCsdl([
    `[pilot] KHÔNG PHẢI bị người từ chối: bộ chạy đã TỰ CHẠY lệnh kiểm này thay bạn (lần ${lan}); đây là KẾT QUẢ THẬT. ${dau}.`,
    tep,
    ca,
    "--- đuôi đầu ra ---",
    k.duoi.length > 1800 ? k.duoi.slice(-1800) : k.duoi,
    "Đỏ ⇒ sửa tệp rồi gọi lại đúng lệnh này; xanh ⇒ báo kết quả cuối. Bộ chạy cũng tự chạy lại lệnh kiểm khi bạn kết thúc.",
  ].join("\n"));
}

// ── Phụ thuộc ──────────────────────────────────────────────────────────────────────────────────────

type SuKien = { loai: string; [k: string]: unknown };
export interface PhuThuocHost {
  /** trả lỗi (chuỗi) nếu môi trường không đạt; null = đạt */
  kiemMoiTruong(v: DauVaoDriver): Promise<string | null>;
  taoLuot(y: { cauHoi: string; projectId: string }): Promise<{ ok: true; runId: string } | { ok: false; loi: string }>;
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
  /** Bảo đảm có khoá ký checkpoint (SECRET_ENCRYPTION_KEY|JWT_SECRET ≥ 16). `tam` = bộ chạy tự sinh khoá riêng của tiến trình. */
  datKhoaKy(): { ok: boolean; tam: boolean };
}

export const driverHost = (dep: PhuThuocHost, hanDuyetGiay = 3600) =>
  async function host(v: DauVaoDriver): Promise<KetQuaDriver & { hetGio: boolean; loi?: string }> {
    const ghiChu: string[] = [];
    const loiMt = await dep.kiemMoiTruong(v);
    if (loiMt) return { vong: null, token: null, ghiChu, hetGio: false, loi: `môi trường không đạt: ${loiMt}` };
    // Checkpoint ký manifest TRƯỚC mọi lượt ghi: thiếu khoá ⇒ write_file bị chặn trước cả cổng duyệt (TC-01 lượt 2). Kiểm TRƯỚC khi tạo lượt.
    const khoa = dep.datKhoaKy();
    if (!khoa.ok) return { vong: null, token: null, ghiChu, hetGio: false, loi: "môi trường không đạt: thiếu khoá ký checkpoint (SECRET_ENCRYPTION_KEY|JWT_SECRET ≥ 16 ký tự) và không tạo được khoá tạm" };
    const luuY: string[] = khoa.tam ? ["checkpoint ký bằng khoá pilot tạm (sinh ngẫu nhiên cho tiến trình này; checkpoint của lượt không đọc lại được sau khi tiến trình thoát)"] : [];
    const loiCongCu: Record<string, number> = {};

    const projectId = dep.duAnId(v.wt);
    const cauHoi = `[${NHAN_PILOT}:${v.the.ma}] ${v.lenh}`;
    const tao = await dep.taoLuot({ cauHoi, projectId });
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
    let soLanBaoHan = 0;
    const xuLyDuyet = async (id: string, de: { ten: string; thamSo: Record<string, unknown>; moTa?: string; xemTruoc?: unknown; nguonDangNgo?: string[] }, actionId: string) => {
      const loc = locTruocKhiCho(de, v.the, v.wt);
      if (loc.loai === "tu-choi") {
        th.soTuChoi++;
        nhanTuChoi.set(id, NHAN_TU_CHOI_BO_CHAY);
        ghiChu.push(`tự từ chối ${de.ten}: ${loc.lyDo}`);
        await dep.bac(actionId, `[pilot tự từ chối] ${loc.lyDo}`);
        return;
      }
      if (loc.loai === "tu-chay") {
        nhanTuChoi.set(id, NHAN_TU_CHAY_LENH_KIEM);
        soTuChay++;
        if (soTuChay > TRAN_TU_CHAY) {
          ghiChu.push(`quá ${TRAN_TU_CHAY} lần tự chạy lệnh kiểm trong một lượt — từ chối`);
          await dep.bac(actionId, `[pilot] đã tự chạy lệnh kiểm ${TRAN_TU_CHAY} lần trong lượt này; dừng gọi lại và báo kết quả cuối.`);
          return;
        }
        const k = await (v.chayKiem ?? dep.chayKiem ?? chayLenhKiem)(loc.lenh, v.wt, 300);
        ghiChu.push(`tự chạy lệnh kiểm lần ${soTuChay}: exit ${k.exit}${k.vitest.ca ? `, Tests ${k.vitest.ca.dat} passed / ${k.vitest.ca.tong}` : ""}`);
        await dep.bac(actionId, tomTatKiemChoModel(k, soTuChay));
        return;
      }
      th.soLanCho++;
      const t0 = dep.bay();
      dangChoTu = t0;
      const hanMs = hanDuyetHieuLucMs(hanDuyetGiay);
      if (hanDuyetGiay * 1000 > hanMs && soLanBaoHan++ === 0) {
        ghiChu.push(`--han-duyet ${hanDuyetGiay}s dài hơn TTL thẻ ${TTL_THE_DUYET_MS / 1000}s ⇒ chờ người tối đa ${Math.round(hanMs / 1000)}s mỗi thẻ (thẻ hết hạn sau đó dù bộ chạy còn đợi)`);
      }
      const q = await dep.chinhSachDuyet(
        {
          ma: v.the.ma,
          id: actionId,
          ten: de.ten,
          duong: loc.duong,
          moTa: de.moTa ?? null,
          lyDoModel: typeof de.thamSo.reason === "string" ? de.thamSo.reason : null,
          xemTruoc: de.xemTruoc ?? null,
          thamSo: de.thamSo,
          nguonDangNgo: de.nguonDangNgo ?? [],
          luc: new Date().toISOString(),
          hetHanLuc: new Date(Date.now() + hanMs).toISOString(),
        },
        { ra: v.ra, hanMs },
      );
      th.msCho += dep.bay() - t0;
      dangChoTu = null;
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
      const q = await dep.chinhSachDuyet(
        {
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
        },
        { ra: v.ra, hanMs },
      );
      th.msCho += dep.bay() - t0;
      dangChoTu = null;
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
    if (luuY.length > 0) kq.luuY = luuY;
    return kq;
  };

// ── Phụ thuộc THẬT (nạp lười: chỉ khi --driver host) ────────────────────────────────────────────────

export interface CauHinhHostThat {
  nguoi: { id: number; role: string; name?: string | null };
  chinhSachDuyet?: ChinhSachDuyet;
}

export async function phuThuocHostThat(c: CauHinhHostThat): Promise<PhuThuocHost> {
  const { quanLyLuotChay } = await import("../../server/services/ai/agent/quanLyLuotChay");
  const tt = await import("../../server/services/ai/agent/thuTucLuotChay");
  const tk = await import("../../server/services/ai/agent/thuTucKeHoach");
  const ql = quanLyLuotChay();
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
export function keLoiCongCu(e: { ma?: unknown; tomTat?: unknown }): string {
  const ma = typeof e.ma === "string" && e.ma !== "" ? e.ma : "KHONG_RO";
  const tt = typeof e.tomTat === "string" ? e.tomTat : "";
  const m = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/.exec(tt);
  return m && m[1] !== ma ? `${ma}:${m[1]}` : ma;
}
