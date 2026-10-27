/**
 * SCADA R1b-2b-2a Task 1 (mục 61) — MỘT bộ đếm ghi treo cho MỌI lượt ghi nền (sổ / audit) trên đường STOP, toàn tiến trình — kèm HÀNG CHỜ có trần
 * (fix round 1, điều phối DUYỆT 2026-10-27 thay cho "bỏ khi đầy").
 *
 * Vì sao một module riêng ở lớp OT: cả `services/scada/lenhHmi.ts` (STOP HMI: attempts, chốt dòng chờ, audit) lẫn
 * `services/ot/commandDispatcher.ts` (audit override của STOP ghim) đều phải đi qua CÙNG bộ đếm — hai bộ đếm riêng sẽ đòi hai phần ngân sách
 * pool (8 + 8 + khảo sát 8 = 24 > 25 − 9, `nganSachPoolStop.test.ts`). Phụ thuộc tĩnh DUY NHẤT: `server/logger`; dòng tóm tắt dùng `import()` động.
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
 *   · CHỈ tràn / quá tuổi / quá lớn / tắt máy mới BỎ: log error `<nhan>_bo_<lyDo>` + `khiBoQua` + đếm 24 h (`demGhiBoQuaDay`, posture) + gộp vào
 *     MỘT dòng tóm tắt `control_audit_log` (`ot_stop_ghi_nen_bo_roi`: số lượng, nhãn, khoảng thời gian, requestIds có trần). Dòng tóm tắt
 *     KHÔNG BAO GIỜ bị bỏ: nó đi trước hàng chờ khi có chỗ; ghi hỏng ⇒ gộp lại vào tóm tắt kế tiếp và thử lại (hẹn giờ + lần xả sau).
 *   · tắt tiến trình (`xaHangChoKhiTat`, gọi từ `stopOt({ tatTienTrinh })`): xả tối đa 2 s; còn lại ⇒ một dòng log + bỏ (lyDo "tat_may") + thử
 *     ghi tóm tắt. Mất khi sập / khởi động lại: GIỚI HẠN (spool bền ở R1b-2b-2b).
 *
 * Hạn `HAN_GHI_TREO_MS` chỉ quyết định khi nào người gọi đang `await` nhận trả lời (xong trong hạn ⇒ trả lúc xong; quá hạn ⇒ log `<nhan>_qua_han`,
 * trả, lượt ghi chạy nền). Handler gắn THẲNG lên promise của lượt ghi ⇒ ném MUỘN không thành `unhandledRejection`. Không bao giờ reject / ném
 * (log và callback của người gọi đều được bọc). Hẹn giờ `unref`.
 */
import { logger } from "../../logger";

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
}

export type LyDoBo = "tran" | "qua_tuoi" | "qua_lon" | "tat_may";
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
  const b = (noiDung as { bang?: unknown } | null | undefined)?.bang;
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

function gopTomTat(dich: TomTatBoRoi | null, them: TomTatBoRoi): TomTatBoRoi {
  if (!dich) return { ...them, theoLyDo: { ...them.theoLyDo }, theoNhan: { ...them.theoNhan }, theoBang: { ...them.theoBang }, requestIds: [...them.requestIds] };
  const kq: TomTatBoRoi = {
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
    reason: `R1b-2b-2a T1: ${tt.soLuong} lượt ghi nền của đường STOP KHÔNG được ghi (${tt.tu} → ${tt.den}) — xem theoNhan / requestIds`,
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
function coJson(v: unknown): number {
  try {
    return JSON.stringify(v ?? null)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Một lượt KHÔNG BAO GIỜ được ghi: log + callback + đếm + gộp vào tóm tắt chờ. */
function bo(o: TuyChonGhiCoTran, lucSuKien: number, lyDo: LyDoBo): void {
  const { nhan, requestId } = o;
  logAnToan(
    "error",
    { cho: `${nhan}_bo_${lyDo}`, requestId, lyDo, dangBay, hangCho: hangCho.length, lucSuKien: new Date(lucSuKien).toISOString(), noiDung: rutGon(o.noiDung) },
    "[OT] đường STOP: BỎ một lượt ghi nền (hàng chờ tràn / quá tuổi / quá lớn / tắt máy); nội dung hàng ở noiDung, STOP vẫn có trong command_log; một dòng tóm tắt sẽ vào control_audit_log",
  );
  const bang = bangCua(o.noiDung);
  mocBoQua.push({ at: Date.now(), bang });
  tiaMocBoQua(Date.now());
  const iso = new Date(lucSuKien).toISOString();
  tomTatCho = gopTomTat(tomTatCho, {
    soLuong: 1,
    theoLyDo: { [lyDo]: 1 },
    theoNhan: { [cat(nhan, 80)]: 1 },
    theoBang: { [bang]: 1 },
    tu: iso,
    den: iso,
    requestIds: [cat(String(requestId), 80)],
    soRequestIdBoBot: 0,
  });
  if (o.khiBoQua) goiAnToan(o.khiBoQua, nhan, requestId);
}

/** Bỏ các mục ĐẦU hàng chờ đã quá tuổi. */
function tiaHangCho(now: number): void {
  while (hangCho.length > 0 && now - hangCho[0].lucSuKien > TUOI_TOI_DA_HANG_CHO_MS) {
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
  if (tomTatCho && !tomTatDangGhi && dangBay < TRAN_GHI_TREO_STOP && Date.now() >= thuLaiTomTatSau) phatTomTat();
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
  // KD-A1 — +1 lúc PHÁT; `giam` chạy đúng một lần trên MỌI đường thoát (xong, lỗi, ném đồng bộ; lượt bỏ rơi: khi nó xong)
  dangBay += 1;
  capNhatDay();
  let daGiam = false;
  const giam = () => {
    if (daGiam) return;
    daGiam = true;
    if (theHeLuot !== theHe) return; // review M-1: lượt của thế hệ trước khi đặt lại — không đụng bộ đếm mới
    dangBay -= 1;
    capNhatDay();
    xa();
  };
  const baoLoi = (e: unknown, muon: boolean) => {
    if (o.khiLoi) {
      const khiLoi = o.khiLoi;
      goiAnToan(() => khiLoi(e, muon), nhan, requestId);
      return;
    }
    logAnToan("error", { err: (e as Error)?.message ?? String(e), requestId, cho: muon ? `${nhan}_muon` : nhan }, "[OT] đường STOP: ghi nền lỗi");
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
 * Phát MỘT lượt ghi nền của đường STOP dưới trần chung (ngữ nghĩa ở đầu tệp). `viec` là THUNK (nhận `BoiCanhGhi`): trần được kiểm TRƯỚC khi truy
 * vấn được phát. Không bao giờ reject. Trả khi lượt ghi xong, hoặc sau `HAN_GHI_TREO_MS`, hoặc NGAY khi xếp hàng / bị bỏ.
 */
export function ghiCoTran(viec: Viec, o: TuyChonGhiCoTran): Promise<void> {
  const lucSuKien = Date.now();
  tiaHangCho(lucSuKien);
  if (dangBay < TRAN_GHI_TREO_STOP && hangCho.length === 0) return phat(viec, o, lucSuKien, false);
  // xếp hàng (MỘT FIFO) — người gọi trả NGAY
  if (hangCho.length >= TRAN_HANG_CHO_GHI_NEN) {
    bo(o, lucSuKien, "tran");
    return Promise.resolve();
  }
  if (coJson(o.noiDung) > TRAN_BYTE_MUC_HANG_CHO) {
    bo(o, lucSuKien, "qua_lon");
    return Promise.resolve();
  }
  hangCho.push({ viec, o: { ...o, noiDung: rutGon(o.noiDung) }, lucSuKien });
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
  };
}

let dangXaKhiTat: Promise<void> | null = null;
/**
 * Tắt tiến trình: xả hàng chờ tối đa `hanMs`; còn lại ⇒ MỘT dòng log + bỏ (lyDo "tat_may") + thử ghi tóm tắt trong phần hạn còn lại. Không ném.
 * Gọi nhiều lần ⇒ cùng một promise.
 */
export function xaHangChoKhiTat(hanMs: number = HAN_XA_KHI_TAT_MS): Promise<void> {
  dangXaKhiTat ??= (async () => {
    const het = Date.now() + hanMs;
    const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());
    xa();
    while ((hangCho.length > 0 || tomTatCho || tomTatDangGhi) && Date.now() < het) await ngu(20);
    if (hangCho.length > 0) {
      const con = hangCho.splice(0);
      logAnToan("error", { cho: "ot_stop_ghi_nen_tat_may_con_lai", soLuong: con.length, dangBay }, "[OT] tắt tiến trình: hàng chờ ghi nền của đường STOP chưa xả hết trong hạn — các lượt còn lại bị BỎ (đã gộp vào dòng tóm tắt)");
      for (const m of con) bo(m.o, m.lucSuKien, "tat_may");
    }
    if (tomTatCho && !tomTatDangGhi) {
      const tt = tomTatCho;
      tomTatCho = null;
      const conLai = Math.max(1, het - Date.now());
      try {
        await Promise.race([Promise.resolve(ghiTomTat(tt)), new Promise((_, b) => setTimeout(() => b(new Error("hết hạn tắt máy")), conLai).unref?.())]);
      } catch (e) {
        tomTatCho = tomTatCho ? gopTomTat(tt, tomTatCho) : tt;
        logAnToan("error", { err: (e as Error)?.message ?? String(e), cho: "ot_stop_ghi_nen_tat_may_tom_tat_loi", tomTat: tt }, "[OT] tắt tiến trình: không ghi được dòng tóm tắt lượt bị bỏ — nội dung ở log");
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
  dangXaKhiTat = null;
  mocBoQua.length = 0;
  batDauDemBoQua = Date.now();
}
