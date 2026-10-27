/**
 * SCADA R1b-2b-2a Task 1 (mục 61) — MỘT bộ đếm ghi treo cho MỌI lượt ghi nền (sổ / audit) trên đường STOP, toàn tiến trình.
 *
 * Vì sao một module riêng ở lớp OT: cả `services/scada/lenhHmi.ts` (STOP HMI: attempts, chốt dòng chờ, audit) lẫn
 * `services/ot/commandDispatcher.ts` (audit override của STOP ghim) đều phải đi qua CÙNG bộ đếm — hai bộ đếm riêng sẽ đòi hai phần ngân sách
 * pool (8 + 8 + khảo sát 8 = 24 > 25 − 9, `nganSachPoolStop.test.ts`). Chỉ phụ thuộc `server/logger` (thuần).
 *
 * ★ Ngữ nghĩa đếm — IN-FLIGHT (kiem-dinh KD-A1, điều phối 2026-10-27; ĐỔI so với T9 của R1b-2b-1):
 *   · +1 NGAY lúc PHÁT lượt ghi (gọi `viec`), −1 lúc lượt ấy XONG (thành công / lỗi), kể cả lượt đã bị bỏ rơi sau hạn. Ném đồng bộ từ `viec`
 *     ⇒ −1 ngay. Mọi đường thoát đều trả lại đúng một lần (`giam` idempotent).
 *   · Trần `TRAN_GHI_TREO_STOP` áp NGAY từ lượt đầu: đủ trần lượt đang bay ⇒ lượt mới KHÔNG được phát (`viec` không bị gọi), log
 *     `<nhan>_bo_qua_day` mang `noiDung` (nội dung hàng — dựng lại được từ log), gọi `khiBoQua`, ĐẾM vào `demGhiBoQuaDay` (posture,
 *     KD-A3), trả ngay. Không bao giờ ảnh hưởng kết quả STOP.
 *   · Trước đây (T9) chỉ đếm lượt ĐÃ quá 500 ms ⇒ khi các lượt ghi chuyển sang `void`, 3N truy vấn có thể cùng treo trong 500 ms đầu. Nay
 *     số kết nối pool mà ghi nền của đường STOP giữ cùng lúc ≤ trần, bất kể bao nhiêu lượt bấm song song.
 *   · DB nhanh: lượt xong trong vài ms ⇒ số đang bay gần 0, trần không chạm (trừ khi > 8 lượt ghi trùng nhau trong cùng vài ms — xem giới hạn
 *     trong báo cáo task).
 *   · Hạn `HAN_GHI_TREO_MS` CHỈ quyết định khi nào người gọi đang `await` nhận trả lời (xong trong hạn ⇒ trả lúc xong; quá hạn ⇒ log
 *     `<nhan>_qua_han`, trả, lượt ghi chạy nền). Với lời gọi `void` hạn không có tác dụng gì ngoài log.
 *
 * Handler gắn THẲNG lên promise của lượt ghi (cả nhánh lỗi) ⇒ ném MUỘN vẫn được xử lý, không thành `unhandledRejection`. Không bao giờ reject.
 * Callback của người gọi (`khiLoi`, `khiBoQua`) ném ⇒ bị nuốt + log (không phá bộ đếm, không phá STOP). Hẹn giờ `unref`.
 */
import { logger } from "../../logger";

/** Hạn chờ một lượt ghi nền cho người gọi đang `await` (đường trả lời của STOP HMI). */
export const HAN_GHI_TREO_MS = 500;
/** Trần số lượt ghi nền của đường STOP ĐANG BAY (đã phát, chưa xong), toàn tiến trình. ≈ 1/3 pool mặc định 25. */
export const TRAN_GHI_TREO_STOP = 8;

export interface TuyChonGhiCoTran {
  /** nhãn log: `<nhan>_bo_qua_day`, `<nhan>_qua_han`, `<nhan>_muon_xong` (và mặc định `<nhan>` / `<nhan>_muon` khi lỗi) */
  nhan: string;
  requestId: string;
  /** nội dung hàng (log khi bị bỏ qua vì đầy). Trường `bang` (nếu có) là nhóm đếm của `demGhiBoQuaDay`. */
  noiDung?: unknown;
  /** lượt ghi lỗi (`muon` = lỗi tới SAU hạn). Vắng ⇒ log mặc định. */
  khiLoi?: (e: unknown, muon: boolean) => void;
  /** lượt ghi bị bỏ qua vì đầy trần (không được phát). */
  khiBoQua?: () => void;
}

let dangBay = 0;

/** Số lượt ghi nền của đường STOP đang bay (đã phát, chưa xong) — test / chẩn đoán. */
export function soGhiTreoStop(): number {
  return dangBay;
}

// ─── KD-A3: đếm lượt bị BỎ QUA vì đầy trần (posture, 24 h, bộ nhớ tiến trình) ──────────────────────────────────────────────────────
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

/** Số lượt ghi nền của đường STOP bị BỎ QUA vì đầy trần trong 24 h (tiến trình này, từ `batDauLuc`), theo bảng đích. */
export function demGhiBoQuaDay(now: number = Date.now()): { tong: number; theoBang: Partial<Record<BangGhiNenStop, number>>; batDauLuc: string } {
  tiaMocBoQua(now);
  const theoBang: Partial<Record<BangGhiNenStop, number>> = {};
  for (const m of mocBoQua) theoBang[m.bang] = (theoBang[m.bang] ?? 0) + 1;
  return { tong: mocBoQua.length, theoBang, batDauLuc: new Date(batDauDemBoQua).toISOString() };
}

/** Test seam — đặt lại bộ đếm đang bay + bộ đếm bỏ qua. */
export function _datLaiGhiTreoChoTest(): void {
  dangBay = 0;
  mocBoQua.length = 0;
  batDauDemBoQua = Date.now();
}

const goiAnToan = (f: () => void, nhan: string, requestId: string): void => {
  try {
    f();
  } catch (e) {
    logger.error({ err: (e as Error)?.message ?? String(e), requestId, cho: `${nhan}_callback_loi` }, "[OT] ghi nền đường STOP: callback của người gọi ném (đã nuốt)");
  }
};

/**
 * Phát MỘT lượt ghi nền của đường STOP dưới trần chung (ngữ nghĩa ở đầu tệp). `viec` là THUNK: trần được kiểm TRƯỚC khi truy vấn được phát.
 * Không bao giờ reject. Trả khi lượt ghi xong, hoặc sau `HAN_GHI_TREO_MS`, hoặc ngay khi bị bỏ qua.
 */
export function ghiCoTran(viec: () => Promise<unknown>, o: TuyChonGhiCoTran): Promise<void> {
  const { nhan, requestId } = o;
  if (dangBay >= TRAN_GHI_TREO_STOP) {
    logger.error(
      { cho: `${nhan}_bo_qua_day`, requestId, dangBay, tran: TRAN_GHI_TREO_STOP, noiDung: o.noiDung },
      "[OT] đường STOP: BỎ QUA ghi nền — đã đủ trần lượt ghi đang bay (DB chậm); nội dung hàng ở trường noiDung, STOP vẫn có trong command_log",
    );
    mocBoQua.push({ at: Date.now(), bang: bangCua(o.noiDung) });
    tiaMocBoQua(Date.now());
    if (o.khiBoQua) goiAnToan(o.khiBoQua, nhan, requestId);
    return Promise.resolve();
  }
  // KD-A1 — +1 lúc PHÁT; `giam` chạy đúng một lần trên MỌI đường thoát (xong, lỗi, ném đồng bộ; lượt bỏ rơi: khi nó xong)
  dangBay += 1;
  let daGiam = false;
  const giam = () => {
    if (daGiam) return;
    daGiam = true;
    dangBay -= 1;
  };
  const baoLoi = (e: unknown, muon: boolean) => {
    if (o.khiLoi) {
      const khiLoi = o.khiLoi;
      goiAnToan(() => khiLoi(e, muon), nhan, requestId);
      return;
    }
    logger.error({ err: (e as Error)?.message ?? String(e), requestId, cho: muon ? `${nhan}_muon` : nhan }, "[OT] đường STOP: ghi nền lỗi");
  };
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(viec());
  } catch (e) {
    giam();
    baoLoi(e, false);
    return Promise.resolve();
  }
  return new Promise<void>((xong) => {
    let quaHan = false;
    const t = setTimeout(() => {
      quaHan = true;
      logger.error(
        { err: `ghi nền đường STOP quá ${HAN_GHI_TREO_MS} ms — trả lời không chờ nữa, lượt ghi chạy nền`, requestId, cho: `${nhan}_qua_han` },
        "[OT] đường STOP: ghi nền quá hạn — lượt ghi chạy nền (vẫn tính vào trần tới khi xong)",
      );
      xong();
    }, HAN_GHI_TREO_MS);
    (t as { unref?: () => void }).unref?.();
    p.then(
      () => {
        clearTimeout(t);
        giam();
        if (quaHan) logger.info({ cho: `${nhan}_muon_xong`, requestId }, "[OT] đường STOP: lượt ghi nền bị bỏ rơi đã ghi xong (muộn)");
        xong();
      },
      (e) => {
        clearTimeout(t);
        giam();
        baoLoi(e, quaHan);
        xong();
      },
    );
  });
}
