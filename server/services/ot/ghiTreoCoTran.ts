/**
 * SCADA R1b-2b-2a Task 1 (mục 61) — MỘT bộ đếm ghi treo cho MỌI lượt ghi nền (sổ / audit) trên đường STOP, toàn tiến trình — kèm HÀNG CHỜ có trần
 * (fix round 1, điều phối DUYỆT 2026-10-27 thay cho "bỏ khi đầy").
 *
 * Vì sao một module riêng ở lớp OT: cả `services/scada/lenhHmi.ts` (STOP HMI: attempts, chốt dòng chờ, audit) lẫn
 * `services/ot/commandDispatcher.ts` (audit override của STOP ghim) đều phải đi qua CÙNG bộ đếm — hai bộ đếm riêng sẽ đòi hai phần ngân sách
 * pool (8 + 8 + khảo sát 8 = 24 > 25 − 9, `nganSachPoolStop.test.ts`). Phụ thuộc tĩnh: `server/logger`, `node:crypto` và `canonicalize` (thuần, `services/security/auditChain.ts`); dòng tóm tắt dùng `import()` động.
 *
 * ★ Đếm IN-FLIGHT (kiem-dinh KD-A1): +1 NGAY lúc PHÁT (gọi `viec`), −1 lúc lượt ấy XONG (thành công / lỗi / ném đồng bộ; lượt bỏ rơi sau hạn: khi nó
 * xong). Trần `TRAN_GHI_TREO_STOP` áp từ lượt đầu ⇒ số kết nối pool mà ghi nền của đường STOP giữ cùng lúc ≤ 8 (cả lượt xả hàng chờ và dòng tóm tắt).
 *
 * ★ Hàng chờ (fix round 1, review I-1 — đo: DB KHOẺ, 5 adapter có override, SEC_PLATFORM, bấm đúp ⇒ bản bỏ-khi-đầy MẤT 18 lượt ghi):
 *   · trần còn chỗ VÀ hàng chờ rỗng ⇒ phát ngay (như trước). Ngược lại ⇒ XẾP HÀNG (MỘT FIFO; lượt mới không vượt lượt đang chờ ⇒ không đói):
 *     người gọi được trả NGAY (STOP không bao giờ chờ hàng chờ); lượt được phát khi một chỗ trống (mỗi lần một lượt xong ⇒ `xa()`).
 *   · trần hàng chờ: `TRAN_HANG_CHO_GHI_NEN` = 256 mục HOẶC `TUOI_TOI_DA_HANG_CHO_MS` = 10 phút (cái nào tới trước); mỗi mục ≤
 *     `TRAN_BYTE_MUC_HANG_CHO` (JSON của `noiDung`); nội dung giữ cho log / tóm tắt bị CẮT (`rutGon`).
 *   · lượt phát từ hàng chờ nhận `{ daXepHang: true, lucSuKien }` = giờ SỰ KIỆN (lúc gọi `ghiCoTran`) — bên gọi ghi nó vào hàng (attempts: cột
 *     `at`; audit: `after.lucSuKien` qua `themLucSuKien` — `recordAuditEvent` không nhận giờ; chốt dòng chờ: `executedAt`).
 *   · mục QUÁ LỚN (fix round 2, điều kiện 2 của điều phối): nội dung bị CẮT cho vừa trần (`daCat: true`) và ghi bằng `viecTuNoiDung` của bên gọi
 *     (thunk gốc — giữ cả nội dung lớn — bị bỏ); không có `viecTuNoiDung` hoặc cắt rồi vẫn không vừa ⇒ BỎ (lyDo "qua_lon").
 *   · CHỈ tràn / quá tuổi / quá lớn / tắt máy mới BỎ: log error `<nhan>_bo_<lyDo>` + `khiBoQua` + đếm 24 h (`demGhiBoQuaDay`, posture) + gộp vào
 *     MỘT dòng tóm tắt `control_audit_log` (`ot_stop_ghi_nen_bo_roi`: mã, số lượng, nhãn, khoảng thời gian, requestIds có trần). Dòng tóm tắt
 *     KHÔNG BAO GIỜ bị bỏ: nó đi trước hàng chờ khi có chỗ; ghi hỏng ⇒ gộp lại vào tóm tắt kế tiếp và thử lại (hẹn giờ + lần xả sau).
 *   · fix round 2 (re-review m5): lượt AUDIT (`bang` control_audit_log) tới DB rồi GHI HỎNG ⇒ cũng vào tóm tắt (lyDo "loi_ghi") + đếm.
 *   · tắt tiến trình (`xaHangChoKhiTat`, gọi từ `stopOt({ tatTienTrinh })`): xả tối đa 2 s — chờ CẢ hàng chờ, tóm tắt VÀ lượt đang bay (fix round 2,
 *     re-review N-1); còn lại ⇒ bỏ (lyDo "tat_may"); lượt VẪN ĐANG BAY ở hạn ⇒ MỘT dòng log LIỆT KÊ + vào tóm tắt (lyDo "dang_bay_khi_tat",
 *     `khongRoDaGhi` — có thể đã hoặc chưa commit) + thử ghi tóm tắt. Mất khi sập / khởi động lại: GIỚI HẠN (spool bền ở R1b-2b-2b).
 *
 * Hạn `HAN_GHI_TREO_MS` chỉ quyết định khi nào người gọi đang `await` nhận trả lời (xong trong hạn ⇒ trả lúc xong; quá hạn ⇒ log `<nhan>_qua_han`,
 * trả, lượt ghi chạy nền). Handler gắn THẲNG lên promise của lượt ghi ⇒ ném MUỘN không thành `unhandledRejection`. Không bao giờ reject / ném
 * (log và callback của người gọi đều được bọc). Hẹn giờ `unref`.
 */
import { createHash } from "node:crypto";
import { logger } from "../../logger";
import { canonicalize } from "../security/auditChain";

/** Hạn chờ một lượt ghi nền cho người gọi đang `await` (đường trả lời của STOP HMI). */
export const HAN_GHI_TREO_MS = 500;
/** Trần số lượt ghi nền của đường STOP ĐANG BAY (đã phát, chưa xong), toàn tiến trình. ≈ 1/3 pool mặc định 25. */
export const TRAN_GHI_TREO_STOP = 8;
/** Trần số mục của hàng chờ (FIFO). */
export const TRAN_HANG_CHO_GHI_NEN = 256;
/** Tuổi tối đa của một mục hàng chờ (tính từ giờ sự kiện). */
export const TUOI_TOI_DA_HANG_CHO_MS = 10 * 60 * 1000;
/** Trần cỡ một mục (độ dài JSON của `noiDung` ~ nội dung hàng); lớn hơn ⇒ bỏ (lyDo "qua_lon"). */
export const TRAN_BYTE_MUC_HANG_CHO = 16 * 1024;
/** Hạn xả hàng chờ khi tắt tiến trình. */
export const HAN_XA_KHI_TAT_MS = 2_000;
/**
 * fix round 3 (re-review N2-2) — phần ĐUÔI của hạn tắt DÀNH cho lượt ghi tóm tắt cuối: thôi chờ hàng chờ / lượt đang bay ở `hạn − 500 ms` (trước:
 * chờ tới hết hạn ⇒ tóm tắt chỉ còn 1 ms ⇒ không bao giờ commit). Hạn ngắn hơn 2 × đuôi ⇒ đuôi = nửa hạn.
 */
export const HAN_DU_TRU_TOM_TAT_KHI_TAT_MS = 500;
/**
 * fix round 3 (kiem-dinh) — VAN XẢ chỗ rò: một lượt ghi đang bay lâu hơn ngần này (> statement_timeout 30 s + dư) coi như RÒ (kết nối treo mãi,
 * không statement_timeout nào bắn): log error, trả chỗ của nó MỘT lần, đếm (posture `slotGiaiPhong`); nếu lượt thật xong sau đó KHÔNG trừ lần hai.
 */
export const HAN_GIAI_PHONG_SLOT_MS = 120_000;
/** Ghi tóm tắt hỏng ⇒ thử lại sau ngần này (ngoài lần xả kế tiếp). */
export const HAN_THU_LAI_TOM_TAT_MS = 2_000;
/** Trần requestIds / nhãn giữ trong MỘT dòng tóm tắt. */
export const TRAN_REQUEST_ID_TOM_TAT = 32;
export const TRAN_NHAN_TOM_TAT = 32;

/** Bối cảnh của MỘT lượt ghi (truyền cho thunk). `daXepHang` ⇒ thunk ghi `lucSuKien` vào hàng. */
export interface BoiCanhGhi {
  daXepHang: boolean;
  /** giờ SỰ KIỆN (lúc gọi `ghiCoTran`), không phải lúc ghi */
  lucSuKien: Date;
}

export interface TuyChonGhiCoTran {
  /** nhãn log: `<nhan>_xep_hang`, `<nhan>_bo_<lyDo>`, `<nhan>_qua_han`, `<nhan>_muon_xong` (và mặc định `<nhan>` / `<nhan>_muon` khi lỗi) */
  nhan: string;
  requestId: string;
  /** nội dung hàng (log khi bị bỏ; cỡ của mục hàng chờ). Trường `bang` (nếu có) là nhóm đếm của `demGhiBoQuaDay`. */
  noiDung?: unknown;
  /** lượt ghi lỗi (`muon` = lỗi tới SAU hạn). Vắng ⇒ log mặc định. */
  khiLoi?: (e: unknown, muon: boolean) => void;
  /** lượt ghi KHÔNG BAO GIỜ được ghi (tràn / quá tuổi / quá lớn / tắt máy). Xếp hàng KHÔNG gọi nó. */
  khiBoQua?: () => void;
  /**
   * fix round 2 — người ghi TỪ NỘI DUNG (đã cắt, `daCat: true`) cho mục quá lớn trong hàng chờ: chỉ được bắt `db`, KHÔNG bắt nội dung gốc (để thả
   * nó khỏi bộ nhớ). Vắng ⇒ mục quá lớn bị bỏ (lyDo "qua_lon").
   */
  viecTuNoiDung?: (noiDungDaCat: unknown, t: BoiCanhGhi) => Promise<unknown>;
}

/** tran / qua_tuoi / qua_lon / tat_may = KHÔNG ghi; loi_ghi = audit tới DB rồi hỏng; dang_bay_khi_tat = KHÔNG RÕ (đang bay lúc tắt) */
export type LyDoBo = "tran" | "qua_tuoi" | "qua_lon" | "dinh_danh_qua_lon" | "tat_may" | "loi_ghi" | "dang_bay_khi_tat";
type Viec = (t: BoiCanhGhi) => Promise<unknown>;
interface MucCho {
  viec: Viec;
  o: TuyChonGhiCoTran;
  lucSuKien: number;
}

// ─── trạng thái của tiến trình ──────────────────────────────────────────────────────────────────────────────────────────────────
let dangBay = 0;
/** thế hệ — `_datLaiGhiTreoChoTest` tăng nó; `giam` của thế hệ cũ là no-op (review M-1: bộ đếm không bao giờ âm sau khi đặt lại) */
let theHe = 0;
/** giờ bộ đếm chạm trần (posture "đầy từ"), null khi còn chỗ — review M-4 */
let dayTu: number | null = null;
const hangCho: MucCho[] = [];
/** fix round 2 (re-review N-1) — lượt ĐANG BAY (không gồm dòng tóm tắt): nhãn / requestId / bảng / giờ sự kiện — để liệt kê khi tắt */
interface MucDangBay {
  nhan: string;
  requestId: string;
  bang: BangGhiNenStop;
  lucSuKien: number;
  noiDung: unknown;
}
const dangBayMuc = new Map<number, MucDangBay>();
let soMucDaPhat = 0;
/** kiem-dinh (fix round 3) — số lần van xả trả chỗ của một lượt treo (từ khi khởi động / đặt lại) */
let soSlotGiaiPhong = 0;

// ─── log / callback không bao giờ ném (review M-2) ──────────────────────────────────────────────────────────────────────────────
function logAnToan(muc: "error" | "warn" | "info", obj: Record<string, unknown>, msg: string): void {
  try {
    logger[muc](obj, msg);
  } catch {
    /* logger hỏng không được phá STOP / bộ đếm */
  }
}
const goiAnToan = (f: () => void, nhan: string, requestId: string): void => {
  try {
    f();
  } catch (e) {
    logAnToan("error", { err: (e as Error)?.message ?? String(e), requestId, cho: `${nhan}_callback_loi` }, "[OT] ghi nền đường STOP: callback của người gọi ném (đã nuốt)");
  }
};

// ─── KD-A3: đếm lượt bị BỎ (posture, 24 h, bộ nhớ tiến trình) ───────────────────────────────────────────────────────────────────
/** Nhóm đếm — tập ĐÓNG (bảng đích của lượt ghi); `noiDung.bang` khác / vắng ⇒ "khac". */
export const BANG_GHI_NEN_STOP = ["control_audit_log", "scada_command_attempts", "ai_pending_actions", "khac"] as const;
export type BangGhiNenStop = (typeof BANG_GHI_NEN_STOP)[number];
export const CUA_SO_DEM_BO_QUA_MS = 24 * 60 * 60 * 1000;
/** Trần số mốc giữ lại (cũ nhất bị bỏ trước) — bộ đếm không bao giờ lớn vô hạn. */
export const TRAN_DEM_BO_QUA = 10_000;
const mocBoQua: Array<{ at: number; bang: BangGhiNenStop }> = [];
let batDauDemBoQua = Date.now();

function bangCua(noiDung: unknown): BangGhiNenStop {
  let b: unknown;
  try {
    b = (noiDung as { bang?: unknown } | null | undefined)?.bang;
  } catch {
    return "khac"; // re-review N2-5 — getter `bang` ném ⇒ không phá đường STOP
  }
  return typeof b === "string" && (BANG_GHI_NEN_STOP as readonly string[]).includes(b) ? (b as BangGhiNenStop) : "khac";
}
function tiaMocBoQua(now: number): void {
  while (mocBoQua.length > 0 && now - mocBoQua[0].at > CUA_SO_DEM_BO_QUA_MS) mocBoQua.shift();
  while (mocBoQua.length > TRAN_DEM_BO_QUA) mocBoQua.shift();
}

/** Số lượt ghi nền của đường STOP bị BỎ (không bao giờ ghi) trong 24 h (tiến trình này, từ `batDauLuc`), theo bảng đích. */
export function demGhiBoQuaDay(now: number = Date.now()): { tong: number; theoBang: Partial<Record<BangGhiNenStop, number>>; batDauLuc: string } {
  tiaMocBoQua(now);
  const theoBang: Partial<Record<BangGhiNenStop, number>> = {};
  for (const m of mocBoQua) theoBang[m.bang] = (theoBang[m.bang] ?? 0) + 1;
  return { tong: mocBoQua.length, theoBang, batDauLuc: new Date(batDauDemBoQua).toISOString() };
}

// ─── dòng tóm tắt lượt bị bỏ (không bao giờ bị bỏ) ──────────────────────────────────────────────────────────────────────────────
export interface TomTatBoRoi {
  /** fix round 2 (re-review m1) — mã của đợt tóm tắt: một dòng ghi hai lần (COMMIT mơ hồ / đua lúc tắt) mang CÙNG mã ⇒ phát hiện được */
  ma: string;
  /** mã của các tóm tắt chưa ghi đã gộp vào dòng này (≤ 16) */
  maDaGop: string[];
  /** số lượt KHÔNG RÕ đã ghi hay chưa (đang bay lúc tắt — lyDo dang_bay_khi_tat) */
  khongRoDaGhi: number;
  /** re-review N2-4 — tổng = lượt KHÔNG ghi (tran / qua_tuoi / qua_lon / tat_may / loi_ghi) + lượt KHÔNG RÕ (`khongRoDaGhi`); đọc `theoLyDo` để tách */
  soLuong: number;
  theoLyDo: Partial<Record<LyDoBo, number>>;
  /** ≤ TRAN_NHAN_TOM_TAT nhãn; phần dư gộp vào "khac" */
  theoNhan: Record<string, number>;
  theoBang: Partial<Record<BangGhiNenStop, number>>;
  /** giờ sự kiện sớm nhất / muộn nhất của các lượt bị bỏ (ISO) */
  tu: string;
  den: string;
  /** ≤ TRAN_REQUEST_ID_TOM_TAT (các lượt ĐẦU); `soRequestIdBoBot` = phần không liệt kê */
  requestIds: string[];
  soRequestIdBoBot: number;
}
let tomTatCho: TomTatBoRoi | null = null;
/** tóm tắt ĐANG ghi (một lượt mỗi lúc) */
let tomTatDangGhi: TomTatBoRoi | null = null;
let henThuLai: ReturnType<typeof setTimeout> | null = null;
/** ghi tóm tắt hỏng ⇒ không thử lại trước mốc này (không quay vòng nóng khi DB hỏng liên tục) */
let thuLaiTomTatSau = 0;
/** fix round 2 (re-review m1) — lượt ghi tóm tắt CUỐI lúc tắt đã bắt đầu ⇒ `xa` không phát lại tóm tắt (chống ghi đôi khi đua hạn) */
let daGhiTomTatKhiTat = false;
const maMoi = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

function gopTomTat(dich: TomTatBoRoi | null, them: TomTatBoRoi): TomTatBoRoi {
  if (!dich)
    return {
      ...them,
      ma: them.ma || maMoi(),
      maDaGop: [...them.maDaGop],
      theoLyDo: { ...them.theoLyDo },
      theoNhan: { ...them.theoNhan },
      theoBang: { ...them.theoBang },
      requestIds: [...them.requestIds],
    };
  const maDaGop = [...dich.maDaGop];
  for (const m of [them.ma, ...them.maDaGop]) if (m && m !== dich.ma && !maDaGop.includes(m) && maDaGop.length < 16) maDaGop.push(m);
  const kq: TomTatBoRoi = {
    ma: dich.ma || maMoi(),
    maDaGop,
    khongRoDaGhi: dich.khongRoDaGhi + them.khongRoDaGhi,
    soLuong: dich.soLuong + them.soLuong,
    theoLyDo: { ...dich.theoLyDo },
    theoNhan: { ...dich.theoNhan },
    theoBang: { ...dich.theoBang },
    tu: dich.tu < them.tu ? dich.tu : them.tu,
    den: dich.den > them.den ? dich.den : them.den,
    requestIds: [...dich.requestIds],
    soRequestIdBoBot: dich.soRequestIdBoBot + them.soRequestIdBoBot,
  };
  for (const [k, v] of Object.entries(them.theoLyDo)) kq.theoLyDo[k as LyDoBo] = (kq.theoLyDo[k as LyDoBo] ?? 0) + (v ?? 0);
  for (const [k, v] of Object.entries(them.theoBang)) kq.theoBang[k as BangGhiNenStop] = (kq.theoBang[k as BangGhiNenStop] ?? 0) + (v ?? 0);
  for (const [k, v] of Object.entries(them.theoNhan)) themNhan(kq.theoNhan, k, v);
  for (const r of them.requestIds) {
    if (kq.requestIds.length < TRAN_REQUEST_ID_TOM_TAT) kq.requestIds.push(r);
    else kq.soRequestIdBoBot += 1;
  }
  return kq;
}
function themNhan(theoNhan: Record<string, number>, nhan: string, n: number): void {
  if (nhan in theoNhan || Object.keys(theoNhan).length < TRAN_NHAN_TOM_TAT) theoNhan[nhan] = (theoNhan[nhan] ?? 0) + n;
  else theoNhan.khac = (theoNhan.khac ?? 0) + n;
}

/** Chưa có kết nối DB khi ghi dòng tóm tắt (lỗi CÓ KIỂU — `rawErrorCensus` không tăng). Tóm tắt được giữ lại, thử lại sau. */
export class LoiTomTatKhongCoDb extends Error {
  constructor() {
    super("DB_UNAVAILABLE");
    this.name = "LoiTomTatKhongCoDb";
  }
}

/** Người ghi dòng tóm tắt — mặc định: `getDb()` + `recordAuditEvent` (import động, giữ module thuần cho test). Ném ⇒ tóm tắt được giữ lại. */
async function ghiTomTatMacDinh(tt: TomTatBoRoi): Promise<void> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) throw new LoiTomTatKhongCoDb();
  const { recordAuditEvent } = await import("../audit/controlAuditService");
  await recordAuditEvent(db, {
    entityType: "ot_stop_path",
    entityId: "ghi_nen",
    action: "ot_stop_ghi_nen_bo_roi",
    actorId: null,
    before: null,
    after: tt,
    reason:
      `R1b-2b-2a T1: ${tt.soLuong} lượt ghi nền của đường STOP KHÔNG được ghi hoặc KHÔNG RÕ (${tt.tu} → ${tt.den}) — xem theoLyDo / theoNhan / requestIds` +
      (tt.khongRoDaGhi > 0 ? `; ${tt.khongRoDaGhi} lượt đang bay lúc tắt tiến trình: CÓ THỂ đã hoặc chưa commit` : ""),
  });
}
let ghiTomTat: (tt: TomTatBoRoi) => Promise<unknown> = ghiTomTatMacDinh;

/** Test seam — thay người ghi dòng tóm tắt (null ⇒ mặc định). */
export function _datGhiTomTatChoTest(f: ((tt: TomTatBoRoi) => Promise<unknown>) | null): void {
  ghiTomTat = f ?? ghiTomTatMacDinh;
}

function cat(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
/** Bản CẮT của nội dung (log / tóm tắt): chuỗi ≤ 200, mảng ≤ 16, sâu ≤ 4. Không bao giờ ném. */
export function rutGon(v: unknown, sau = 0): unknown {
  if (typeof v === "string") return cat(v, 200);
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  if (sau >= 4) return "[…]";
  if (Array.isArray(v)) {
    const a = v.slice(0, 16).map((x) => rutGon(x, sau + 1));
    if (v.length > 16) a.push(`[+${v.length - 16}]`);
    return a;
  }
  const o: Record<string, unknown> = {};
  let i = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (i++ >= 32) {
      o["…"] = "[cắt]";
      break;
    }
    o[k] = rutGon(x, sau + 1);
  }
  return o;
}
/** review m7 — cắt KHÔNG BAO GIỜ ném (getter ném / proxy lạ ⇒ chuỗi đánh dấu). */
export function rutGonAnToan(v: unknown): unknown {
  try {
    return rutGon(v);
  } catch {
    return "[rutGon lỗi]";
  }
}
function rutGonMuc(v: unknown, sMax: number, aMax: number, dMax: number, kMax: number, sau = 0): unknown {
  if (typeof v === "string") return cat(v, sMax);
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return v.toISOString();
  if (sau >= dMax) return "[…]";
  if (Array.isArray(v)) {
    const a = v.slice(0, aMax).map((x) => rutGonMuc(x, sMax, aMax, dMax, kMax, sau + 1));
    if (v.length > aMax) a.push(`[+${v.length - aMax}]`);
    return a;
  }
  const o: Record<string, unknown> = {};
  let i = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (i++ >= kMax) {
      o["…"] = "[cắt]";
      break;
    }
    o[k] = rutGonMuc(x, sMax, aMax, dMax, kMax, sau + 1);
  }
  return o;
}
/** Trường được CẮT khi một mục quá lớn (fix round 3, re-review S-1): CHỈ ảnh chụp trạng thái — mọi trường khác (định danh) giữ NGUYÊN VĂN. */
export const TRUONG_DUOC_CAT = ["before", "after"] as const;
/** Dấu vết của MỘT trường bị cắt (nằm trong phần được BĂM của hàng): độ dài + băm của bản GỐC trước khi cắt. */
export interface DauCatTruong {
  /** số BYTE UTF-8 của `canonicalize(gốc)` (JSON khoá sắp xếp — `services/security/auditChain.ts`) */
  doDaiGocByteUtf8: number;
  /** sha256 hex của cùng chuỗi `canonicalize(gốc)` */
  sha256Goc: string;
}
/** Dấu cắt của một hàng: `daCat: true` + dấu vết theo từng trường bị cắt (`before` / `after`). */
export interface DauCat {
  daCat: true;
  catGoc: Partial<Record<(typeof TRUONG_DUOC_CAT)[number], DauCatTruong>>;
}
/** Kết quả cắt: được (nội dung đã cắt, kèm dấu cắt), TỪ CHỐI vì riêng định danh đã quá trần, hoặc cắt ở mức chặt nhất vẫn không vừa. */
export type KetQuaCat = { ket: "ok"; noiDung: Record<string, unknown> } | { ket: "dinh_danh_qua_lon" } | { ket: "khong_vua" };

function dauCatTruong(x: unknown): DauCatTruong {
  const chuoi = canonicalize(x ?? null);
  return { doDaiGocByteUtf8: Buffer.byteLength(chuoi, "utf8"), sha256Goc: createHash("sha256").update(chuoi).digest("hex") };
}

/**
 * fix round 2 → fix round 3 (re-review S-1 + yêu cầu điều phối, an ninh) — CẮT một nội dung audit cho VỪA `TRAN_BYTE_MUC_HANG_CHO`:
 *   · CHỈ `before` / `after` bị cắt (qua các mức ngày càng chặt); mọi trường cấp đầu khác (`bang`, `entityType`, `entityId`, `action`, `actorId`,
 *     `reason`, …) chép NGUYÊN VĂN — chúng là ĐỊNH DANH được băm vào chuỗi;
 *   · DẤU CẮT (đi vào `after` — phần được băm): `daCat: true` + `catGoc.<trường>` = độ dài byte UTF-8 + sha256 của `canonicalize(gốc)` cho MỖI
 *     trường thực sự bị cắt ⇒ chuỗi băm chứng nhận ĐÚNG thứ được lưu, không bao giờ trình một hàng cắt như hàng đủ; người có bản gốc kiểm lại được;
 *   · chỗ cho dấu cắt được DÀNH TRƯỚC khi quyết định cắt bao nhiêu; riêng định danh + dấu cắt đã quá trần ⇒ TỪ CHỐI (`dinh_danh_qua_lon`, KHÔNG
 *     cắt định danh); mức chặt nhất vẫn không vừa ⇒ `khong_vua`.
 */
export function catNoiDungAudit(v: unknown, tran: number = TRAN_BYTE_MUC_HANG_CHO): KetQuaCat {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ket: "khong_vua" };
  const MUC: Array<[number, number, number, number]> = [
    [200, 16, 4, 32],
    [60, 4, 3, 16],
    [20, 2, 2, 12],
  ];
  let goc: Record<string, unknown>;
  const dinhDanh: Record<string, unknown> = {};
  const catGoc: DauCat["catGoc"] = {};
  try {
    goc = { ...(v as Record<string, unknown>) };
    for (const [k, x] of Object.entries(goc)) if (!(TRUONG_DUOC_CAT as readonly string[]).includes(k)) dinhDanh[k] = x;
    // dấu vết của bản GỐC (trước khi cắt) — tính một lần; chỉ giữ cho trường thực sự bị cắt ở mức được chọn
    for (const k of TRUONG_DUOC_CAT) if (k in goc) catGoc[k] = dauCatTruong(goc[k]);
  } catch {
    return { ket: "khong_vua" };
  }
  // dành chỗ cho dấu cắt ĐẦY ĐỦ (mọi trường có thể bị cắt) trước khi cắt
  if (coJson({ ...dinhDanh, daCat: true, catGoc }) > tran) return { ket: "dinh_danh_qua_lon" };
  for (const [sM, aM, dM, kM] of MUC) {
    const c: Record<string, unknown> = { ...dinhDanh };
    const dau: DauCat["catGoc"] = {};
    try {
      for (const k of TRUONG_DUOC_CAT) {
        if (!(k in goc)) continue;
        const ban = rutGonMuc(goc[k], sM, aM, dM, kM);
        c[k] = ban;
        if (canonicalize(ban ?? null) !== canonicalize(goc[k] ?? null)) dau[k] = catGoc[k];
      }
    } catch {
      return { ket: "khong_vua" };
    }
    c.daCat = true;
    c.catGoc = dau;
    if (coJson(c) <= tran) return { ket: "ok", noiDung: c };
  }
  return { ket: "khong_vua" };
}
/** Bản cắt (kèm dấu cắt) hoặc null nếu không cắt được — xem `catNoiDungAudit`. */
export function rutGonVua(v: unknown, tran: number = TRAN_BYTE_MUC_HANG_CHO): Record<string, unknown> | null {
  const k = catNoiDungAudit(v, tran);
  return k.ket === "ok" ? k.noiDung : null;
}
/**
 * Sự kiện audit dựng lại từ nội dung đã cắt (`{ bang, daCat, catGoc, ...AuditEventInput }`): bỏ `bang`; DẤU CẮT (`daCat`, `catGoc`) chuyển vào
 * `after` (phần được băm của hàng — `truongBamCua`).
 */
export function suKienAuditTuNoiDung<T = { entityType: string; entityId: string | number; action: string; after?: unknown }>(nd: unknown): T {
  const { bang: _b, daCat, catGoc, ...e } = (nd ?? {}) as Record<string, unknown>;
  void _b;
  if (daCat === true) {
    const dau = { daCat: true, catGoc: catGoc ?? {} };
    const goc = e.after;
    e.after = goc !== null && typeof goc === "object" && !Array.isArray(goc) ? { ...(goc as Record<string, unknown>), ...dau } : { goc: goc ?? null, ...dau };
  }
  return e as T;
}
function coJson(v: unknown): number {
  try {
    return JSON.stringify(v ?? null)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Một lượt KHÔNG được ghi (hoặc KHÔNG RÕ — `dang_bay_khi_tat`): log + callback + đếm + gộp vào tóm tắt chờ. `tuyChon` (fix round 2): `khiBoQua` false ⇒
 * không gọi callback (audit lỗi ghi — người gọi đã nhận `khiLoi`); `dem` false ⇒ không vào `demGhiBoQuaDay` (không rõ); `log` false ⇒ người gọi
 * tự log (một dòng liệt kê lúc tắt).
 */
function bo(o: TuyChonGhiCoTran, lucSuKien: number, lyDo: LyDoBo, tuyChon: { khiBoQua?: boolean; dem?: boolean; log?: boolean } = {}): void {
  const { nhan, requestId } = o;
  if (tuyChon.log !== false) {
    logAnToan(
      "error",
      { cho: `${nhan}_bo_${lyDo}`, requestId, lyDo, dangBay, hangCho: hangCho.length, lucSuKien: new Date(lucSuKien).toISOString(), noiDung: rutGonAnToan(o.noiDung) },
      "[OT] đường STOP: một lượt ghi nền KHÔNG vào sổ (hàng chờ tràn / quá tuổi / quá lớn / tắt máy / audit ghi hỏng); nội dung hàng ở noiDung, STOP vẫn có trong command_log; một dòng tóm tắt sẽ vào control_audit_log",
    );
  }
  const bang = bangCua(o.noiDung);
  if (tuyChon.dem !== false) {
    mocBoQua.push({ at: Date.now(), bang });
    tiaMocBoQua(Date.now());
  }
  const iso = new Date(lucSuKien).toISOString();
  tomTatCho = gopTomTat(tomTatCho, {
    ma: "",
    maDaGop: [],
    khongRoDaGhi: lyDo === "dang_bay_khi_tat" ? 1 : 0,
    soLuong: 1,
    theoLyDo: { [lyDo]: 1 },
    theoNhan: { [cat(nhan, 80)]: 1 },
    theoBang: { [bang]: 1 },
    tu: iso,
    den: iso,
    requestIds: [cat(String(requestId), 80)],
    soRequestIdBoBot: 0,
  });
  if (o.khiBoQua && tuyChon.khiBoQua !== false) goiAnToan(o.khiBoQua, nhan, requestId);
}

/** Bỏ các mục ĐẦU hàng chờ đã quá tuổi — tối đa `toiDa` mục mỗi lần (re-review m3: trên đường STOP chỉ tỉa một ít; phần còn lại ở lần xả / posture). */
export const TRAN_TIA_MOT_LUOT_STOP = 16;
function tiaHangCho(now: number, toiDa = Number.POSITIVE_INFINITY): void {
  let n = 0;
  while (n++ < toiDa && hangCho.length > 0 && now - hangCho[0].lucSuKien > TUOI_TOI_DA_HANG_CHO_MS) {
    const m = hangCho.shift()!;
    bo(m.o, m.lucSuKien, "qua_tuoi");
  }
}

function capNhatDay(): void {
  if (dangBay >= TRAN_GHI_TREO_STOP) dayTu ??= Date.now();
  else dayTu = null;
}

/** Xả: dòng tóm tắt (nếu có) trước, rồi hàng chờ FIFO — mỗi lượt chiếm một chỗ của CÙNG trần. */
function xa(): void {
  tiaHangCho(Date.now());
  if (tomTatCho && !tomTatDangGhi && !daGhiTomTatKhiTat && dangBay < TRAN_GHI_TREO_STOP && Date.now() >= thuLaiTomTatSau) phatTomTat();
  while (dangBay < TRAN_GHI_TREO_STOP && hangCho.length > 0) {
    const m = hangCho.shift()!;
    phat(m.viec, m.o, m.lucSuKien, true);
  }
}

function phatTomTat(): void {
  const tt = tomTatCho!;
  tomTatCho = null;
  tomTatDangGhi = tt;
  const theHeLuot = theHe;
  dangBay += 1;
  capNhatDay();
  let daGiam = false;
  const xong = (ok: boolean, e?: unknown) => {
    if (daGiam) return;
    daGiam = true;
    if (theHeLuot !== theHe) return;
    dangBay -= 1;
    tomTatDangGhi = null;
    capNhatDay();
    if (!ok) {
      // không bao giờ bỏ: gộp lại (lượt bỏ mới có thể đã tới trong lúc ghi) và thử lại
      tomTatCho = tomTatCho ? gopTomTat(tt, tomTatCho) : tt;
      thuLaiTomTatSau = Date.now() + HAN_THU_LAI_TOM_TAT_MS;
      logAnToan("error", { err: (e as Error)?.message ?? String(e), cho: "ot_stop_ghi_nen_bo_roi_tom_tat_loi", soLuong: tomTatCho.soLuong }, "[OT] đường STOP: ghi dòng tóm tắt lượt bị bỏ HỎNG — giữ lại, thử lại sau");
      henThuLaiTomTat();
    }
    xa();
  };
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(ghiTomTat(tt));
  } catch (e) {
    xong(false, e);
    return;
  }
  p.then(
    () => xong(true),
    (e) => xong(false, e),
  );
}
function henThuLaiTomTat(): void {
  if (henThuLai) return;
  henThuLai = setTimeout(() => {
    henThuLai = null;
    xa();
    // vẫn chưa có chỗ (trần đầy) ⇒ lần xả kế tiếp (một lượt xong) sẽ thử; vẫn còn tóm tắt mà chưa phát ⇒ hẹn lại
    if (tomTatCho && !tomTatDangGhi) henThuLaiTomTat();
  }, HAN_THU_LAI_TOM_TAT_MS);
  (henThuLai as { unref?: () => void }).unref?.();
}

/** Phát một lượt (đã có chỗ). Trả promise cho người gọi: xong lúc lượt xong hoặc sau `HAN_GHI_TREO_MS`. */
function phat(viec: Viec, o: TuyChonGhiCoTran, lucSuKien: number, daXepHang: boolean): Promise<void> {
  const { nhan, requestId } = o;
  const theHeLuot = theHe;
  const maMuc = ++soMucDaPhat;
  dangBayMuc.set(maMuc, { nhan, requestId, bang: bangCua(o.noiDung), lucSuKien, noiDung: o.noiDung });
  // KD-A1 — +1 lúc PHÁT; `giam` chạy đúng một lần trên MỌI đường thoát (xong, lỗi, ném đồng bộ; lượt bỏ rơi: khi nó xong)
  dangBay += 1;
  capNhatDay();
  let daGiam = false;
  const giam = () => {
    if (daGiam) return;
    daGiam = true;
    if (theHeLuot !== theHe) return; // review M-1: lượt của thế hệ trước khi đặt lại — không đụng bộ đếm mới
    dangBayMuc.delete(maMuc);
    if (henVan) clearTimeout(henVan);
    dangBay -= 1;
    capNhatDay();
    xa();
  };
  // kiem-dinh (fix round 3) — van xả chỗ rò: lượt treo quá HAN_GIAI_PHONG_SLOT_MS ⇒ trả chỗ MỘT lần (giam idempotent ⇒ lượt thật xong sau không trừ nữa)
  let henVan: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    henVan = undefined;
    if (daGiam || theHeLuot !== theHe) return;
    soSlotGiaiPhong += 1;
    logAnToan(
      "error",
      { cho: `${nhan}_giai_phong_slot`, requestId, treoMs: HAN_GIAI_PHONG_SLOT_MS, lucSuKien: new Date(lucSuKien).toISOString() },
      "[OT] đường STOP: lượt ghi nền treo quá hạn van xả — coi như RÒ, TRẢ chỗ của nó (kết nối có thể vẫn bị giữ); lượt thật xong sau sẽ không trừ lần hai",
    );
    giam();
  }, HAN_GIAI_PHONG_SLOT_MS);
  (henVan as { unref?: () => void }).unref?.();
  const baoLoi = (e: unknown, muon: boolean) => {
    if (o.khiLoi) {
      const khiLoi = o.khiLoi;
      goiAnToan(() => khiLoi(e, muon), nhan, requestId);
    } else {
      logAnToan("error", { err: (e as Error)?.message ?? String(e), requestId, cho: muon ? `${nhan}_muon` : nhan }, "[OT] đường STOP: ghi nền lỗi");
    }
    // fix round 2 (re-review m5) — AUDIT ghi hỏng (tới DB rồi lỗi) ⇒ một khoảng trống trong chuỗi: vào tóm tắt + đếm, nội dung (cắt) ở log
    if (bangCua(o.noiDung) === "control_audit_log" && theHeLuot === theHe) bo(o, lucSuKien, "loi_ghi", { khiBoQua: false });
  };
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(viec({ daXepHang, lucSuKien: new Date(lucSuKien) }));
  } catch (e) {
    baoLoi(e, false);
    giam();
    return Promise.resolve();
  }
  // review M-5: audit (luôn `void`) quá hạn chỉ là cảnh báo — chờ khoá chuỗi băm là chuyện thường dưới SEC_PLATFORM; sổ trên đường trả lời: error
  const mucQuaHan = bangCua(o.noiDung) === "control_audit_log" ? "warn" : "error";
  return new Promise<void>((xong) => {
    let quaHan = false;
    const t = setTimeout(() => {
      quaHan = true;
      logAnToan(
        mucQuaHan,
        { err: `ghi nền đường STOP quá ${HAN_GHI_TREO_MS} ms — trả lời không chờ nữa, lượt ghi chạy nền`, requestId, cho: `${nhan}_qua_han` },
        "[OT] đường STOP: ghi nền quá hạn — lượt ghi chạy nền (vẫn tính vào trần tới khi xong)",
      );
      xong();
    }, HAN_GHI_TREO_MS);
    (t as { unref?: () => void }).unref?.();
    p.then(
      () => {
        clearTimeout(t);
        if (quaHan) logAnToan("info", { cho: `${nhan}_muon_xong`, requestId }, "[OT] đường STOP: lượt ghi nền bị bỏ rơi đã ghi xong (muộn)");
        giam();
        xong();
      },
      (e) => {
        clearTimeout(t);
        baoLoi(e, quaHan);
        giam();
        xong();
      },
    );
  });
}

/**
 * fix round 3 (re-review N2-3) — mục hàng chờ của một lượt QUÁ LỚN dựng trong phạm vi RIÊNG từ nội dung ĐÃ CẮT: không bắt `viec` gốc, không bắt `o`
 * (giữ `noiDung` gốc) ⇒ V8 thả được tải lớn. Người gọi phải tạo `viecTuNoiDung` / `khiLoi` ngoài phạm vi giữ tải (xem `nguoiGhiAuditTuNoiDung`).
 */
function mucTuNoiDungCat(
  viecTuNoiDung: NonNullable<TuyChonGhiCoTran["viecTuNoiDung"]>,
  daCat: unknown,
  nhan: string,
  requestId: string,
  khiLoi: TuyChonGhiCoTran["khiLoi"],
  khiBoQua: TuyChonGhiCoTran["khiBoQua"],
  lucSuKien: number,
): MucCho {
  return { viec: (t) => viecTuNoiDung(daCat, t), o: { nhan, requestId, noiDung: daCat, khiLoi, khiBoQua }, lucSuKien };
}

/**
 * Phát MỘT lượt ghi nền của đường STOP dưới trần chung (ngữ nghĩa ở đầu tệp). `viec` là THUNK (nhận `BoiCanhGhi`): trần được kiểm TRƯỚC khi truy
 * vấn được phát. Không bao giờ reject. Trả khi lượt ghi xong, hoặc sau `HAN_GHI_TREO_MS`, hoặc NGAY khi xếp hàng / bị bỏ.
 */
export function ghiCoTran(viec: Viec, o: TuyChonGhiCoTran): Promise<void> {
  const lucSuKien = Date.now();
  tiaHangCho(lucSuKien, TRAN_TIA_MOT_LUOT_STOP);
  if (dangBay < TRAN_GHI_TREO_STOP && hangCho.length === 0) return phat(viec, o, lucSuKien, false);
  // xếp hàng (MỘT FIFO) — người gọi trả NGAY
  if (hangCho.length >= TRAN_HANG_CHO_GHI_NEN) {
    bo(o, lucSuKien, "tran");
    return Promise.resolve();
  }
  if (coJson(o.noiDung) > TRAN_BYTE_MUC_HANG_CHO) {
    // fix round 2 (điều kiện 2) — CẮT cho vừa trần, ghi bằng `viecTuNoiDung` (thunk gốc giữ nội dung lớn bị thả); không được ⇒ bỏ "qua_lon"
    const kq: KetQuaCat = o.viecTuNoiDung ? catNoiDungAudit(o.noiDung) : { ket: "khong_vua" };
    if (kq.ket !== "ok" || !o.viecTuNoiDung) {
      // fix round 3 (điều phối) — riêng định danh quá trần ⇒ TỪ CHỐI hàng (không cắt định danh), lý do riêng
      bo(o, lucSuKien, kq.ket === "dinh_danh_qua_lon" ? "dinh_danh_qua_lon" : "qua_lon");
      return Promise.resolve();
    }
    const daCat = kq.noiDung;
    hangCho.push(mucTuNoiDungCat(o.viecTuNoiDung, daCat, o.nhan, o.requestId, o.khiLoi, o.khiBoQua, lucSuKien));
    logAnToan("warn", { cho: `${o.nhan}_xep_hang`, requestId: o.requestId, dangBay, hangCho: hangCho.length, daCat: true }, "[OT] đường STOP: ghi nền XẾP HÀNG — nội dung quá lớn đã CẮT cho vừa trần (daCat)");
    return Promise.resolve();
  }
  hangCho.push({ viec, o: { ...o, noiDung: rutGonAnToan(o.noiDung) }, lucSuKien });
  logAnToan("warn", { cho: `${o.nhan}_xep_hang`, requestId: o.requestId, dangBay, hangCho: hangCho.length }, "[OT] đường STOP: ghi nền XẾP HÀNG (đủ trần lượt đang bay) — sẽ ghi khi có chỗ, giữ giờ sự kiện");
  return Promise.resolve();
}

/** Thêm giờ SỰ KIỆN vào `after` của một sự kiện audit khi lượt được ghi từ hàng chờ (`recordAuditEvent` không nhận giờ). */
export function themLucSuKien<T extends { after?: unknown }>(e: T, t: BoiCanhGhi): T {
  if (!t.daXepHang) return e;
  const goc = e.after;
  const after =
    goc !== null && typeof goc === "object" && !Array.isArray(goc)
      ? { ...(goc as Record<string, unknown>), lucSuKien: t.lucSuKien.toISOString(), tuHangCho: true }
      : { goc: goc ?? null, lucSuKien: t.lucSuKien.toISOString(), tuHangCho: true };
  return { ...e, after };
}

// ─── đọc trạng thái / tắt tiến trình / test ─────────────────────────────────────────────────────────────────────────────────────
/** Số lượt ghi nền của đường STOP đang bay (đã phát, chưa xong) — test / chẩn đoán. */
export function soGhiTreoStop(): number {
  return dangBay;
}
/** Trạng thái sống (posture, review M-4): đang bay, trần, đầy từ, độ dài hàng chờ, số lượt bị bỏ đang chờ tóm tắt. */
export function trangThaiGhiTreo(now: number = Date.now()): {
  dangBay: number;
  tran: number;
  dayTu: string | null;
  hangCho: number;
  hangChoTheoBang: Partial<Record<BangGhiNenStop, number>>;
  tranHangCho: number;
  tomTatCho: number;
  slotGiaiPhong: number;
} {
  tiaHangCho(now);
  const hangChoTheoBang: Partial<Record<BangGhiNenStop, number>> = {};
  for (const m of hangCho) {
    const b = bangCua(m.o.noiDung);
    hangChoTheoBang[b] = (hangChoTheoBang[b] ?? 0) + 1;
  }
  return {
    hangChoTheoBang,
    dangBay,
    tran: TRAN_GHI_TREO_STOP,
    dayTu: dayTu === null ? null : new Date(dayTu).toISOString(),
    hangCho: hangCho.length,
    tranHangCho: TRAN_HANG_CHO_GHI_NEN,
    tomTatCho: (tomTatCho?.soLuong ?? 0) + (tomTatDangGhi?.soLuong ?? 0),
    slotGiaiPhong: soSlotGiaiPhong,
  };
}

let dangXaKhiTat: Promise<void> | null = null;
/** Trần số lượt đang bay được LIỆT KÊ trong dòng log lúc tắt (mọi lượt vẫn vào tóm tắt; requestIds của tóm tắt có trần riêng). */
export const TRAN_LIET_KE_DANG_BAY_KHI_TAT = 32;
/**
 * Tắt tiến trình: xả tối đa `hanMs` — chờ hàng chờ, tóm tắt VÀ lượt đang bay (re-review N-1: `process.exit` sau đó giết lượt đang bay — audit dưới
 * SEC_PLATFORM là giao dịch ⇒ ROLLBACK). Ở hạn: hàng chờ còn lại ⇒ bỏ ("tat_may"); lượt VẪN đang bay ⇒ MỘT dòng log LIỆT KÊ chúng + tóm tắt
 * ("dang_bay_khi_tat", `khongRoDaGhi`); rồi ghi tóm tắt cuối (kể cả nội dung của tóm tắt đang bay, cùng mã) trong phần hạn còn lại. Không ném.
 * Hẹn giờ KHÔNG `unref` (re-review m8): lượt chờ ≤ hạn phải giữ được vòng lặp sự kiện. Gọi nhiều lần ⇒ cùng một promise.
 */
export function xaHangChoKhiTat(hanMs: number = HAN_XA_KHI_TAT_MS): Promise<void> {
  dangXaKhiTat ??= (async () => {
    const het = Date.now() + hanMs;
    // re-review N2-2 — thôi chờ ở hạn − đuôi: phần đuôi dành cho lượt ghi tóm tắt cuối
    const thoiCho = het - Math.min(HAN_DU_TRU_TOM_TAT_KHI_TAT_MS, Math.floor(hanMs / 2));
    const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    xa();
    while ((hangCho.length > 0 || tomTatCho || tomTatDangGhi || dangBay > 0) && Date.now() < thoiCho) await ngu(20);
    if (hangCho.length > 0) {
      const con = hangCho.splice(0);
      logAnToan("error", { cho: "ot_stop_ghi_nen_tat_may_con_lai", soLuong: con.length, dangBay }, "[OT] tắt tiến trình: hàng chờ ghi nền của đường STOP chưa xả hết trong hạn — các lượt còn lại bị BỎ (đã gộp vào dòng tóm tắt)");
      for (const m of con) bo(m.o, m.lucSuKien, "tat_may");
    }
    const conBay = [...dangBayMuc.values()];
    if (conBay.length > 0) {
      logAnToan(
        "error",
        {
          cho: "ot_stop_ghi_nen_tat_may_dang_bay",
          soLuong: conBay.length,
          ketCuc: "khong_ro",
          lietKe: conBay.slice(0, TRAN_LIET_KE_DANG_BAY_KHI_TAT).map((m) => ({
            nhan: cat(m.nhan, 80),
            requestId: cat(String(m.requestId), 80),
            bang: m.bang,
            lucSuKien: new Date(m.lucSuKien).toISOString(),
          })),
          soKhongLietKe: Math.max(0, conBay.length - TRAN_LIET_KE_DANG_BAY_KHI_TAT),
        },
        "[OT] tắt tiến trình: lượt ghi nền của đường STOP VẪN ĐANG BAY khi hết hạn xả — KHÔNG RÕ đã commit hay chưa (thoát tiến trình có thể rollback); đã gộp vào dòng tóm tắt",
      );
      for (const m of conBay) bo({ nhan: m.nhan, requestId: m.requestId, noiDung: m.noiDung }, m.lucSuKien, "dang_bay_khi_tat", { khiBoQua: false, dem: false, log: false });
    }
    // tóm tắt cuối: phần chờ + (nếu đang ghi dở) nội dung của tóm tắt đang bay — CÙNG mã ⇒ ghi đôi phát hiện được
    let tt = tomTatCho;
    if (tomTatDangGhi) tt = tt ? gopTomTat(tomTatDangGhi, tt) : { ...tomTatDangGhi };
    if (tt) {
      daGhiTomTatKhiTat = true; // re-review m1: `xa` không phát lại tóm tắt nữa
      tomTatCho = null;
      const conLai = Math.max(1, het - Date.now());
      let hen: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(ghiTomTat(tt)),
          new Promise((_, b) => {
            hen = setTimeout(() => b(new Error("hết hạn tắt máy")), conLai);
          }),
        ]);
      } catch (e) {
        tomTatCho = tomTatCho ? gopTomTat(tt, tomTatCho) : tt;
        logAnToan("error", { err: (e as Error)?.message ?? String(e), cho: "ot_stop_ghi_nen_tat_may_tom_tat_loi", tomTat: tt }, "[OT] tắt tiến trình: không ghi được dòng tóm tắt lượt bị bỏ — nội dung ở log");
      } finally {
        if (hen) clearTimeout(hen);
      }
    }
  })();
  return dangXaKhiTat;
}

/** Test seam — đặt lại MỌI trạng thái (bộ đếm, hàng chờ, tóm tắt, thế hệ mới ⇒ lượt cũ không đụng bộ đếm mới). */
export function _datLaiGhiTreoChoTest(): void {
  theHe += 1;
  dangBay = 0;
  dayTu = null;
  hangCho.length = 0;
  tomTatCho = null;
  tomTatDangGhi = null;
  if (henThuLai) clearTimeout(henThuLai);
  henThuLai = null;
  thuLaiTomTatSau = 0;
  daGhiTomTatKhiTat = false;
  dangXaKhiTat = null;
  dangBayMuc.clear();
  soSlotGiaiPhong = 0;
  mocBoQua.length = 0;
  batDauDemBoQua = Date.now();
}
