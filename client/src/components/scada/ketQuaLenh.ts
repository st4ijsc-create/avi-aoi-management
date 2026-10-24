/**
 * SCADA R1a Task 14 — quy tắc THUẦN của M5 (hộp thoại lệnh): trạng thái kết quả ⇒ khoá chữ + tự đóng; mã từ chối ⇒ chữ người đọc +
 * cách xử lý. Không React, không i18n ở đây (trả KHOÁ + tham số); component dịch.
 *
 * Báo cáo §4.6 / §4.10 + điều phối 2026-10-24:
 *   - `acked_verified` là trạng thái DUY NHẤT tự đóng (3000 ms). Mọi trạng thái khác giữ hộp mở — người vận hành phải đọc.
 *   - `rejected` ⇒ tên cổng thành chữ (`scada.lenh.cong.<MÃ>`); POLICY_* lạ gộp một khoá; mã chưa ánh xạ ⇒ dự phòng VẪN mang mã.
 *   - Từ chối ở `request`/`confirm` (appError của `scadaCommandsRouter`, `appParams.ma` = mã của lenhHmi) ⇒ `scada.lenh.loi.<MÃ>`.
 *   - `TOTP_TAM_KHOA` chỉ mang số PHÚT (`remainingMinutes`) — không bao giờ số lần thử.
 */

// ─── Kết quả dispatch ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Trạng thái kết quả `confirm` / `scada:cmd` (commandstatusenum, trừ các trạng thái trung gian của dòng chờ). */
export type TrangThaiKetQua = "acked_verified" | "acked_unverified" | "simulated" | "rejected" | "timeout" | "sent" | "acked" | "failed";

export const TRANG_THAI_KET_QUA: readonly TrangThaiKetQua[] = [
  "acked_verified",
  "acked_unverified",
  "simulated",
  "rejected",
  "timeout",
  "sent",
  "acked",
  "failed",
];

export const laTrangThaiKetQua = (s: unknown): s is TrangThaiKetQua => typeof s === "string" && (TRANG_THAI_KET_QUA as readonly string[]).includes(s);

/** Chỉ `acked_verified` tự đóng, sau đúng ngần này. */
export const TU_DONG_DONG_MS = 3000;

/**
 * Cổng có chữ riêng (`scada.lenh.cong.<MÃ>`): mã `reason` của `dispatch()` (commandDispatcher) + mã lenhHmi có thể đi qua `scada:cmd`
 * với `status: "rejected"` (từ chối KẾT THÚC của confirm, DISPATCH_LOI) + `TIMEOUT` (QĐ T9-5: status viết hoa khi không có reason).
 */
export const CONG_BIET = [
  "QUEUE_EXPIRED",
  "BUSY",
  "INTERLOCK_BLOCKED",
  "SAFETY_UNKNOWN",
  "SAFETY_BLOCKED",
  "SAFETY_SIM_ONLY",
  "MODE_LOCAL",
  "OUT_OF_RANGE",
  "OFF_STEP",
  "TYPE_MISMATCH",
  "CHANNEL_READ_ONLY",
  "NOT_CONFIRMED",
  "ACTION_BINDING_MISMATCH",
  "ADAPTER_OFFLINE",
  "ADAPTER_DISABLED",
  "POLICY_DENIED",
  "POLICY_APPROVAL_REQUIRED",
  "SUPERSEDED_BY_STOP",
  "STOPPED_BEFORE_WRITE",
  "DUPLICATE_IN_FLIGHT",
  "TAG_NOT_FOUND",
  "TAG_NOT_WRITABLE",
  "PRECONDITION_FAILED",
  "DISPATCH_LOI",
  "TIMEOUT",
  "HET_HAN",
  "KHOA_MAT",
  "MAY_DA_DOI",
] as const;

const CONG_BIET_SET: ReadonlySet<string> = new Set(CONG_BIET);

/** Khoá chữ của một cổng từ chối. */
export function khoaCong(reason: string | undefined): { khoa: string; ma: string } {
  const ma = reason && reason.trim() ? reason.trim() : "—";
  if (CONG_BIET_SET.has(ma)) return { khoa: `scada.lenh.cong.${ma}`, ma };
  if (ma.startsWith("POLICY_")) return { khoa: "scada.lenh.cong.POLICY", ma };
  return { khoa: "scada.lenh.cong.khac", ma };
}

const chuoi = (v: unknown): string => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

export interface NguCanhKetQua {
  readBack?: unknown;
  reason?: string;
  requested: unknown;
  /** định dạng giá trị theo khuôn kênh + ngôn ngữ (vắng ⇒ String) */
  dinhDang?: (v: unknown) => string;
}

/**
 * Trạng thái ⇒ khoá chữ (+ tham số) + tự đóng. `tuDongDongMs`: `acked_verified` ⇒ 3000; MỌI trạng thái khác ⇒ null.
 */
export function nhanKetQua(
  status: TrangThaiKetQua,
  ctx: NguCanhKetQua,
): { khoa: string; tuDongDongMs: number | null; thamSo: Record<string, string>; goiYStop?: boolean } {
  const dd = ctx.dinhDang ?? chuoi;
  const coDoc = ctx.readBack !== null && ctx.readBack !== undefined;
  switch (status) {
    case "acked_verified":
      return { khoa: "scada.lenh.ketQua.ackedVerified", tuDongDongMs: TU_DONG_DONG_MS, thamSo: { v: coDoc ? dd(ctx.readBack) : "—" } };
    case "acked_unverified":
      return coDoc
        ? { khoa: "scada.lenh.ketQua.ackedUnverified", tuDongDongMs: null, thamSo: { v: dd(ctx.readBack) } }
        : { khoa: "scada.lenh.ketQua.ackedUnverifiedKhongDoc", tuDongDongMs: null, thamSo: {} };
    case "acked":
      return { khoa: "scada.lenh.ketQua.acked", tuDongDongMs: null, thamSo: {} };
    case "simulated":
      return { khoa: "scada.lenh.ketQua.simulated", tuDongDongMs: null, thamSo: {} };
    case "sent":
      return { khoa: "scada.lenh.ketQua.sent", tuDongDongMs: null, thamSo: {} };
    case "timeout":
      return { khoa: "scada.lenh.ketQua.timeout", tuDongDongMs: null, thamSo: {} };
    case "failed":
      return { khoa: "scada.lenh.ketQua.failed", tuDongDongMs: null, thamSo: { ma: ctx.reason ?? "—" } };
    case "rejected":
    default: {
      const c = khoaCong(ctx.reason);
      // fix round 1 — máy chuyển LOCAL giữa cổng của confirm và dispatch ⇒ cùng gợi ý dừng (E-STOP cứng / nút dừng tại tủ — HMI R1a KHÔNG phải đường STOP, final I-3) như từ chối MODE_LOCAL
      return { khoa: c.khoa, tuDongDongMs: null, thamSo: { ma: c.ma }, ...(c.ma === "MODE_LOCAL" ? { goiYStop: true } : {}) };
    }
  }
}

// ─── Từ chối request / confirm ────────────────────────────────────────────────────────────────────────────────────────────────
/** Mã từ chối của lenhHmi (MaTuChoiYeuCau) + hai mã kết cục M5 tự hiện. */
export const MA_LOI_LENH = [
  "FEATURE_DISABLED",
  "NOT_FOUND",
  "CHANNEL_READ_ONLY",
  "TYPE_MISMATCH",
  "OUT_OF_RANGE",
  "OFF_STEP",
  "ROLE_FLOOR",
  "PERMISSION_DENIED",
  "TOTP_CHUA_DANG_KY",
  "EDGE_CHUA_HO_TRO",
  "MODE_LOCAL",
  "DANG_DUOC_CHON",
  "KHOA_CHON_LOI",
  "DA_XU_LY",
  "HET_HAN",
  "KHOA_MAT",
  "TOTP_CAN",
  "TOTP_SAI",
  "MAY_DA_DOI",
  "TOTP_TAM_KHOA",
  "TOTP_KHONG_KIEM_DUOC",
  "DISPATCH_LOI",
  "TIMEOUT",
] as const;
const MA_LOI_SET: ReadonlySet<string> = new Set(MA_LOI_LENH);

/** Từ chối GIỮ dòng chờ + khoá ở máy chủ (QĐ T9-2): người dùng nhập lại mã rồi gửi lại trong TTL. Mọi mã khác kết thúc yêu cầu. */
export const MA_GIU_YEU_CAU: ReadonlySet<string> = new Set(["TOTP_CAN", "TOTP_SAI", "TOTP_KHONG_KIEM_DUOC"]);

/** Trang có thẻ đăng ký xác thực hai lớp (App.tsx: `/profile` ⇒ Profile, thẻ "Xác thực hai lớp"). */
export const LIEN_KET_DANG_KY_2FA = "/profile";

/** Khoá chữ của 9 lý do `cheDoMay` (+ biến thể edge, + dự phòng). Bản đồ đầy đủ — thêm lý do ở máy chủ ⇒ thêm ở đây. */
export const KHOA_LY_DO_LOCAL: Record<string, string> = {
  remote: "scada.lenh.local.remote",
  chua_khai: "scada.lenh.local.chuaKhai",
  bo_dem_tat: "scada.lenh.local.boDemTat",
  chua_co_mau: "scada.lenh.local.chuaCoMau",
  chat_luong_xau: "scada.lenh.local.chatLuongXau",
  cu: "scada.lenh.local.cu",
  khac_remote: "scada.lenh.local.khacRemote",
  loi_doc: "scada.lenh.local.loiDoc",
  kenh_sai_may: "scada.lenh.local.kenhSaiMay",
};

/** `chua_co_mau` trên máy do edge sở hữu ⇒ chữ R1c (điều phối 2026-10-24); lý do lạ ⇒ dự phòng có tham số `lyDo`. */
export function khoaLyDoLocal(lyDo: string, laEdge: boolean): string {
  if (lyDo === "chua_co_mau" && laEdge) return "scada.lenh.local.chuaCoMauEdge";
  return Object.prototype.hasOwnProperty.call(KHOA_LY_DO_LOCAL, lyDo) ? KHOA_LY_DO_LOCAL[lyDo] : "scada.lenh.local.khongRo";
}

export type LoiApp = { appCode: string; appParams?: Record<string, unknown> };

/** appCode/appParams do `appError()` gắn vào lỗi tRPC (`error.data`); không có ⇒ null. */
export function docLoiApp(err: unknown): LoiApp | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: { appCode?: unknown; appParams?: unknown } }).data;
  if (!data || typeof data.appCode !== "string") return null;
  return {
    appCode: data.appCode,
    ...(data.appParams && typeof data.appParams === "object" ? { appParams: data.appParams as Record<string, unknown> } : {}),
  };
}

/**
 * R1a final I-1 — 429 của bộ giới hạn tần suất: middleware `trpcGioiHanThuTuc` (data.appCode `TRPC_GIOI_HAN_THU_TUC`, httpStatus 429) hoặc
 * `apiLimiter` (express-rate-limit — thân không phải lỗi tRPC, chỉ còn `meta.response.status`). Middleware chặn TRƯỚC tRPC ⇒ máy chủ
 * KHÔNG chạy thủ tục nào: chắc chắn chưa gửi gì tới máy (không phải "không rõ máy đã nhận").
 */
export function laLoiGioiHanTanSuat(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { data?: { appCode?: unknown; httpStatus?: unknown; code?: unknown }; meta?: { response?: { status?: unknown } } };
  if (e.data?.appCode === "TRPC_GIOI_HAN_THU_TUC") return true;
  // re-review — lỗi mang appCode KHÁC (vd. TOTP_TAM_KHOA: appError("TOO_MANY_REQUESTS", …) ⇒ errorFormatter rải code + httpStatus 429)
  // giữ ánh xạ riêng của nó; chỉ 429 KHÔNG có appCode mới coi là bộ giới hạn.
  if (typeof e.data?.appCode === "string" && e.data.appCode !== "") return false;
  if (e.data?.httpStatus === 429 || e.data?.code === "TOO_MANY_REQUESTS") return true;
  return e.meta?.response?.status === 429;
}

export interface MoTaLoi {
  /** mã lenhHmi (appParams.ma) nếu có — hiện nhỏ cạnh chữ */
  ma: string | null;
  khoa: string;
  thamSo: Record<string, string | number>;
  /** MODE_LOCAL: khoá chữ của lý do (component dịch rồi đưa vào `{{lyDo}}`) */
  khoaLyDo?: string;
  /** OFF_STEP: giá trị hợp lệ gần nhất (nút "Dùng {goiY}" CHỈ điền ô) */
  goiY?: number;
  lienKet2FA?: boolean;
  /** MODE_LOCAL: gợi ý dừng bằng E-STOP cứng / nút dừng tại tủ (R1a final I-3: màn HMI chưa có lệnh STOP riêng) */
  goiYStop?: boolean;
  /** lỗi không có mã: cần chữ chi tiết đã dịch (`mapTrpcError`) cho `{{chiTiet}}` */
  canChiTiet?: boolean;
  /** true ⇒ yêu cầu còn `proposed` ở máy chủ VÀ gửi lại được trong TTL */
  giuYeuCau: boolean;
  /**
   * fix round 1 — true ⇒ máy chủ CÓ THỂ còn giữ yêu cầu `proposed` + khoá chọn ⇒ đóng hộp phải gọi `huy` (tốt-nhất-có-thể):
   * mọi mã giữ yêu cầu, TOTP_CHUA_DANG_KY (máy chủ giữ — QĐ T9-2 — nhưng không sửa được trong TTL) và lỗi KHÔNG mã (mạng / ném).
   */
  huyKhiDong: boolean;
}

function soTheoNgonNgu(v: unknown, locale: string): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return v === null || v === undefined ? "—" : String(v);
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v);
  } catch {
    return String(v);
  }
}

function lucTheoNgonNgu(iso: unknown, locale: string): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(t));
  } catch {
    return new Date(t).toLocaleTimeString();
  }
}

/**
 * Một lỗi từ `scadaCommands.request` / `confirm` ⇒ chữ + cách xử lý. Lỗi KHÔNG mang mã:
 *   - ở `confirm` ⇒ DISPATCH_LOI ("không rõ máy đã nhận") — client không thể biết lệnh đã tới máy chưa, nên nói phía an toàn;
 *   - ở `request` ⇒ dự phòng chung (chưa có gì được gửi).
 */
export function moTaLoiLenh(err: unknown, giaiDoan: "request" | "confirm", ctx: { laEdge: boolean; locale: string }): MoTaLoi {
  const m = moTaLoiThan(err, giaiDoan, ctx);
  const huyKhiDong = m.giuYeuCau || m.ma === null || m.ma === "TOTP_CHUA_DANG_KY";
  return { ...m, huyKhiDong };
}

function moTaLoiThan(err: unknown, giaiDoan: "request" | "confirm", ctx: { laEdge: boolean; locale: string }): Omit<MoTaLoi, "huyKhiDong"> {
  // R1a final I-1 — 429 (bộ giới hạn) ⇒ chưa gửi gì; ở confirm máy chủ còn giữ yêu cầu proposed + khoá (ma null ⇒ huyKhiDong khi đóng hộp).
  if (laLoiGioiHanTanSuat(err)) return { ma: null, khoa: "scada.lenh.loi.vuotTanSuat", thamSo: {}, giuYeuCau: false };
  const app = docLoiApp(err);
  const p = app?.appParams ?? {};
  const ma = typeof p.ma === "string" ? p.ma : null;
  const so = (v: unknown) => soTheoNgonNgu(v, ctx.locale);
  const khoa = (m: string) => `scada.lenh.loi.${m}`;
  const giu = !!ma && MA_GIU_YEU_CAU.has(ma);

  if (!ma || !MA_LOI_SET.has(ma)) {
    if (!ma && giaiDoan === "confirm") return { ma: null, khoa: khoa("DISPATCH_LOI"), thamSo: {}, canChiTiet: true, giuYeuCau: false };
    // mã có cấu trúc nhưng client chưa biết: ở confirm là từ chối TRƯỚC dispatch (loiTuChoiLenh) ⇒ "lệnh không được gửi", không phải "không tạo được yêu cầu"
    return { ma, khoa: khoa(giaiDoan === "confirm" ? "khacXacNhan" : "khac"), thamSo: {}, canChiTiet: true, giuYeuCau: false };
  }
  switch (ma) {
    case "CHANNEL_READ_ONLY":
      return { ma, khoa: khoa(ma), thamSo: { tagKey: String(p.tagKey ?? "—") }, giuYeuCau: false };
    case "TYPE_MISMATCH":
      return { ma, khoa: khoa(ma), thamSo: { dataType: String(p.dataType ?? "—") }, giuYeuCau: false };
    case "OUT_OF_RANGE":
      return { ma, khoa: khoa(ma), thamSo: { min: so(p.min), max: so(p.max) }, giuYeuCau: false };
    case "OFF_STEP": {
      const goiY = typeof p.goiY === "number" && Number.isFinite(p.goiY) ? p.goiY : undefined;
      return goiY === undefined
        ? { ma, khoa: khoa("OFF_STEP_NO_HINT"), thamSo: { step: so(p.step) }, giuYeuCau: false }
        : { ma, khoa: khoa(ma), thamSo: { step: so(p.step), goiY: so(goiY) }, goiY, giuYeuCau: false };
    }
    case "MODE_LOCAL":
      // `thamSo.lyDo` = mã lý do THÔ (cho câu dự phòng `khongRo`); component thay bằng chữ đã dịch của `khoaLyDo`.
      return {
        ma,
        khoa: khoa(ma),
        thamSo: { lyDo: String(p.lyDo ?? "—") },
        khoaLyDo: khoaLyDoLocal(String(p.lyDo ?? ""), ctx.laEdge),
        goiYStop: true,
        giuYeuCau: false,
      };
    case "DANG_DUOC_CHON":
      return { ma, khoa: khoa(ma), thamSo: { ten: String(p.boiTen ?? "—"), den: lucTheoNgonNgu(p.hetHanLuc, ctx.locale) }, giuYeuCau: false };
    case "EDGE_CHUA_HO_TRO":
      return { ma, khoa: khoa(ma), thamSo: { edge: String(p.edgeCode ?? "—") }, giuYeuCau: false };
    case "ROLE_FLOOR":
    case "TOTP_CAN":
      return { ma, khoa: khoa(ma), thamSo: { level: so(p.level) }, giuYeuCau: giu };
    case "TOTP_CHUA_DANG_KY":
      return { ma, khoa: khoa(ma), thamSo: {}, lienKet2FA: true, giuYeuCau: false };
    case "TOTP_TAM_KHOA":
      // CHỈ số phút — không đọc bất kỳ tham số đếm nào (không bao giờ hiện số lần thử).
      return { ma, khoa: khoa(ma), thamSo: { phut: so(p.remainingMinutes) }, giuYeuCau: false };
    case "DISPATCH_LOI":
      return { ma, khoa: khoa(ma), thamSo: {}, canChiTiet: true, giuYeuCau: false };
    default:
      return { ma, khoa: khoa(ma), thamSo: {}, giuYeuCau: giu };
  }
}

// ─── Đồng hồ đếm của M5 (fix round 1) ───────────────────────────────────────────────────────────────────────────────────────
/** TTL của yêu cầu ở máy chủ (`LENH_HMI_TTL_MS` của lenhHmi.ts — client không import được mã máy chủ có DB). */
export const TTL_YEU_CAU_MS = 60_000;

/**
 * fix round 1 — thời gian còn lại, NEO vào lúc nhận phản hồi `request` (không tin đồng hồ máy khách khớp máy chủ):
 *   conLaiLucNhan = expiresAt − nhanLuc. Máy chủ chỉ trả yêu cầu CÒN hạn (tạo mới: +60 s; gửi lại QĐ-5: kiểm expiresAt > now), nên
 *   một giá trị ngoài (0, TTL] chỉ có thể là LỆCH ĐỒNG HỒ ⇒ dùng TTL đếm từ lúc nhận. Sau đó đếm lùi bằng đồng hồ máy khách kể từ
 *   lúc nhận: còn lại = conLaiLucNhan − (now − nhanLuc). Lệch đồng hồ không làm sai đồng hồ đếm; chỉ thời gian bay của phản hồi
 *   (thường < 1 s) làm nó dư — máy chủ vẫn là ranh giới (HET_HAN).
 */
export function conLaiTuLucNhan(expiresAt: string, nhanLuc: number, now: number): number {
  const tho = Date.parse(expiresAt) - nhanLuc;
  const luc = Number.isFinite(tho) && tho > 0 && tho <= TTL_YEU_CAU_MS ? tho : TTL_YEU_CAU_MS;
  return Math.max(0, luc - Math.max(0, now - nhanLuc));
}
