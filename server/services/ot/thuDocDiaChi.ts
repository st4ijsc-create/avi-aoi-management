/**
 * SCADA R1b-2b-2b A C4 (mục 5) — phần KHÔNG phụ thuộc DB / tRPC của Lab "thử đọc một địa chỉ" (`scadaDiag.thuDocDiaChi`): tập giao thức đã chứng minh,
 * hằng hợp đồng, trần (10 lượt / phút / người + 1 lượt đang bay / adapter), làm sạch văn bản driver, chuẩn hoá giá trị, bộ ghi audit KẾT QUẢ nền có trần.
 * Thủ tục ở `server/routers/scadaDiagRouter.ts` (tái xuất các hằng). Module không import DB / otManager (driver test nạp được rẻ).
 */
import { logger } from "../../logger";

/**
 * Giao thức mà Lab được đọc trên phiên đang chạy — CHỈ những giao thức đã ĐO qua cả (a) đúng giá trị khi trả lời đảo thứ tự, (b) thư viện thật dưới trả
 * lời chậm / đảo, (c) lượt Lab treo không trì hoãn STOP, và (4.3) không lệch trạng thái dùng chung (`drivers/docDongThoi.drivers.r1b2b2b.test.ts`):
 *   • `modbus` — driver chỉ nói Modbus TCP (transaction-id MBAP), modbus-serial 8.0.25;
 *   • `opcua`  — node-opcua 2.174.0 (requestHandle, không hàng đợi giao dịch, hết hạn không hạ kênh);
 *   • `stub`   — luôn trong tập (mô phỏng trong bộ nhớ).
 * LOẠI: `s7` / `mitsubishi-mc` (điều phối Q1 — danh sách item DÙNG CHUNG của kết nối, không chứng minh được), `ethernet-ip` (st-ethernet-ip xếp hàng đọc
 * + hết hạn ⇒ hạ phiên: poll hỏng, trạng thái đổi), `slmp` (`transact` 1 outstanding / socket: STOP xếp hàng sau lượt Lab treo).
 */
export const GIAO_THUC_THU_DOC: ReadonlySet<string> = new Set(["stub", "modbus", "opcua"]);

/** Hạn MỘT lượt đọc thử (từ lúc gọi driver). Quá hạn ⇒ `{ quality: "bad", reason: "timeout" }` (không ném). */
export const HAN_THU_DOC_DIA_CHI_MS = 3000;
/** Trần lượt đọc thử được NHẬN mỗi người trong cửa sổ trượt `CUA_SO_TRAN_THU_DOC_MS`. */
export const TRAN_THU_DOC_MOI_PHUT = 10;
export const CUA_SO_TRAN_THU_DOC_MS = 60_000;
/**
 * KD-2bA 4.4 — chỗ "đang bay" của một adapter được trả khi lượt đọc THẬT (promise của driver) xong — kể cả sau khi người gọi đã nhận "timeout" ở 3 s
 * (thư viện còn giữ yêu cầu tới hạn giao dịch của nó). Van xả: chỗ giữ lâu hơn ngần này (driver không bao giờ xong — lỗi) coi như rò và được tái dùng.
 */
export const HAN_GIU_CHO_THU_DOC_TOI_DA_MS = 30_000;
/** Trần độ dài chuỗi trả ra (giá trị chuỗi / văn bản lý do / statusCode). */
export const TRAN_CHUOI_THU_DOC = 256;
/** tagKey giả của lượt đọc thử (không phải tag đã khai). */
export const TAG_THU_DOC = "__lab__";
/** KD-2bA 4.5 — trần lượt ghi audit KẾT QUẢ đang bay (đếm in-flight, khuôn KD-A1; KHÔNG dùng chung trần 8 của đường STOP). Đầy ⇒ bỏ + log + đếm. */
export const TRAN_GHI_KET_QUA_THU_DOC = 2;

export type LyDoTuChoiTran = "rateLimited" | "scadaLabDangBan";
export type DatChoThuDoc = { ok: true; huy(): void; xongDoc(): void } | { ok: false; lyDo: LyDoTuChoiTran };

const lichSuTheoNguoi = new Map<number, number[]>();
const adapterDangDoc = new Map<number, { luc: number; the: symbol }>();

/**
 * Giữ chỗ ĐỒNG BỘ (không `await` giữa kiểm và ghi ⇒ hai lời gọi đồng thời không cùng lọt): trần người trước, rồi chỗ của adapter.
 * Từ chối ⇒ không ghi gì. Nhận ⇒ mốc đã vào cửa sổ của người + adapter đã bận; bên gọi phải gọi ĐÚNG một trong hai:
 *   • `huy()`    — lượt bị từ chối ở cổng SAU (driver vắng, audit ý định hỏng): gỡ mốc khỏi cửa sổ (chỉ lượt được nhận mới đếm) + trả chỗ;
 *   • `xongDoc()` — lượt đọc thật xong: trả chỗ, mốc GIỮ (lượt đã được nhận).
 * Cả hai idempotent.
 */
export function datChoThuDoc(userId: number, adapterId: number, now: number = Date.now()): DatChoThuDoc {
  const ls = (lichSuTheoNguoi.get(userId) ?? []).filter((t) => t > now - CUA_SO_TRAN_THU_DOC_MS);
  if (ls.length >= TRAN_THU_DOC_MOI_PHUT) {
    lichSuTheoNguoi.set(userId, ls);
    return { ok: false, lyDo: "rateLimited" };
  }
  const dang = adapterDangDoc.get(adapterId);
  if (dang && dang.luc > now - HAN_GIU_CHO_THU_DOC_TOI_DA_MS) {
    lichSuTheoNguoi.set(userId, ls);
    return { ok: false, lyDo: "scadaLabDangBan" };
  }
  if (dang) logger.warn({ adapterId, giuMs: now - dang.luc }, "[scada lab] chỗ đọc thử giữ quá lâu (driver không trả lời) — van xả trả chỗ");
  const the = Symbol("thuDoc");
  ls.push(now);
  lichSuTheoNguoi.set(userId, ls);
  adapterDangDoc.set(adapterId, { luc: now, the });
  let xong = false;
  const traCho = () => {
    if (adapterDangDoc.get(adapterId)?.the === the) adapterDangDoc.delete(adapterId);
  };
  return {
    ok: true,
    huy: () => {
      if (xong) return;
      xong = true;
      const hienTai = lichSuTheoNguoi.get(userId);
      const i = hienTai ? hienTai.lastIndexOf(now) : -1;
      if (hienTai && i >= 0) hienTai.splice(i, 1);
      traCho();
    },
    xongDoc: () => {
      if (xong) return;
      xong = true;
      traCho();
    },
  };
}

// ─── KD-2bA 4.6 — làm sạch văn bản lỗi của driver ────────────────────────────────────────────────────────────────────────────────
const RE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi;
const RE_IPV6 = /\[[0-9a-z:.%_-]+\](?::\d{1,5})?/gi;
/** IPv6 trần (không ngoặc) — chỉ dạng có "::" (không nuốt giờ "10:30:00"). */
const RE_IPV6_TRAN = /(?<![\w:])(?=[0-9a-f:]*::)[0-9a-f:]{2,}(?:%[\w.-]+)?/gi;
const RE_IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
/** host:cổng — host phải có ít nhất một chữ cái (IPv4 đã xử lý ở trên; không nuốt giờ "10:30"). */
const RE_HOST_CONG = /\b(?=[a-z0-9.-]*[a-z])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*:\d{2,5}\b/gi;
const RE_DUONG_DAN_WIN = /\b[a-z]:[\\/][^\s'"<>]*/gi;
const RE_DUONG_DAN_UNC = /\\\\[^\s'"<>]+/g;
const RE_DUONG_DAN_POSIX = /(^|[\s('"=])\/(?:[^\s'"<>/]+\/)*[^\s'"<>/]*/g;

/**
 * Văn bản lỗi driver ⇒ an toàn để trả kỹ sư / ghi audit: chỉ DÒNG ĐẦU (bỏ stack), bỏ URL, IP(:cổng), host:cổng, đường dẫn Windows / UNC / POSIX,
 * gộp khoảng trắng, cắt ≤ `TRAN_CHUOI_THU_DOC`. "connect ECONNREFUSED 10.0.0.5:502" ⇒ "connect ECONNREFUSED <host>". Rỗng ⇒ null.
 */
export function lamSachLyDoDriver(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let t = String(v);
  t = t.split(/\r?\n/)[0] ?? "";
  t = t.replace(/\s+at\s+.*?[A-Za-z_$)\]][\w$./\-]*:\d+:\d+\)?.*$/, ""); // khung stack lọt vào cùng dòng ("at f (tệp:dòng:cột)"; không nuốt "at 10:30:00")
  t = t
    .replace(RE_URL, "<url>")
    .replace(RE_DUONG_DAN_UNC, "<path>")
    .replace(RE_DUONG_DAN_WIN, "<path>")
    .replace(RE_DUONG_DAN_POSIX, "$1<path>")
    .replace(RE_IPV6, "<host>")
    .replace(RE_IPV6_TRAN, "<host>")
    .replace(RE_IPV4, "<host>")
    .replace(RE_HOST_CONG, "<host>");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > TRAN_CHUOI_THU_DOC ? t.slice(0, TRAN_CHUOI_THU_DOC) : t;
}

/** Giá trị trả ra: số hữu hạn / bool / chuỗi (cắt 256); bigint ⇒ chuỗi; đối tượng / mảng ⇒ JSON cắt 256; còn lại ⇒ null. */
export function chuanHoaGiaTriThuDoc(v: unknown): number | boolean | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > TRAN_CHUOI_THU_DOC ? v.slice(0, TRAN_CHUOI_THU_DOC) : v;
  if (typeof v === "bigint") return String(v).slice(0, TRAN_CHUOI_THU_DOC);
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x));
      return typeof s === "string" ? s.slice(0, TRAN_CHUOI_THU_DOC) : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── KD-2bA 4.5 — audit KẾT QUẢ nền, có trần (đếm in-flight) ────────────────────────────────────────────────────────────────────
let ketQuaDangBay = 0;
let soKetQuaBoQua = 0;
let soKetQuaLoi = 0;
/** thế hệ — `_datLaiThuDocChoTest` tăng; lượt của thế hệ cũ xong không trừ bộ đếm mới (không bao giờ âm). */
let theHe = 0;

/**
 * Phát MỘT lượt ghi audit kết quả ở nền: +1 lúc phát, −1 lúc xong (thành công / lỗi / ném đồng bộ). Đủ trần ⇒ BỎ (log warn + đếm) — kết quả đọc đã có
 * dòng audit Ý ĐỊNH (ghi TRƯỚC lượt đọc), dòng kết quả là bổ sung. Không bao giờ ném / reject; lỗi ghi không đổi kết quả trả người gọi.
 */
export function ghiKetQuaThuDocNen(viec: () => Promise<unknown>, nhan: { adapterId: number; maLuot: string }): void {
  if (ketQuaDangBay >= TRAN_GHI_KET_QUA_THU_DOC) {
    soKetQuaBoQua += 1;
    logger.warn({ ...nhan, dangBay: ketQuaDangBay, cho: "scada_lab_ket_qua_bo_tran" }, "[scada lab] bỏ audit kết quả đọc thử (đủ trần ghi nền)");
    return;
  }
  ketQuaDangBay += 1;
  const theHeLuot = theHe;
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(viec());
  } catch (e) {
    p = Promise.reject(e);
  }
  p.then(
    () => undefined,
    (e: unknown) => {
      soKetQuaLoi += 1;
      logger.error({ ...nhan, err: lamSachLyDoDriver((e as Error)?.message ?? e), cho: "scada_lab_ket_qua_loi_ghi" }, "[scada lab] ghi audit kết quả đọc thử hỏng");
    },
  ).finally(() => {
    if (theHeLuot === theHe) ketQuaDangBay -= 1;
  });
}

/** Trạng thái (test / chẩn đoán). */
export function trangThaiThuDoc(): { ketQuaDangBay: number; soKetQuaBoQua: number; soKetQuaLoi: number; adapterDangDoc: number[] } {
  return { ketQuaDangBay, soKetQuaBoQua, soKetQuaLoi, adapterDangDoc: [...adapterDangDoc.keys()] };
}

/** Cho test: quên mọi trạng thái trong tiến trình. */
export function _datLaiThuDocChoTest(): void {
  lichSuTheoNguoi.clear();
  adapterDangDoc.clear();
  theHe += 1;
  ketQuaDangBay = 0;
  soKetQuaBoQua = 0;
  soKetQuaLoi = 0;
}
