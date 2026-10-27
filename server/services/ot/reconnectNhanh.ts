/**
 * SCADA R0 (cổng "sau khi nối lại ⇒ good trong ≤ 2 chu kỳ poll") — nối lại NHANH khi đợt mất còn mới.
 *
 * MƯỜI lần nối lại đầu của một đợt mất thử mỗi `max(pollIntervalMs, 500)` ms (không để backoff lũy thừa làm chậm quá một chu kỳ
 * poll khi thiết bị vừa rớt); từ lần thứ 11 trở đi quay về backoff lũy thừa như cũ (bắt đầu lại từ bước đầu, trần không đổi).
 * Bộ đếm là số lần thất bại liên tiếp của từng adapter và về 0 khi nối thành công (đã có sẵn ở supervisor/otManager).
 */
import type { LyDoChatLuong, OtQuality, OtSample, SuKienDoc } from "./otDriver";

export const NOI_LAI_NHANH_SO_LAN = 10;
export const NOI_LAI_NHANH_TOI_THIEU_MS = 500;

/** Khoảng chờ giữa hai lần nối lại trong pha nhanh. */
export function khoangNoiLaiNhanhMs(pollIntervalMs: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  return Math.max(poll, NOI_LAI_NHANH_TOI_THIEU_MS);
}

/**
 * Chọn khoảng chờ sau lần thất bại thứ `failures` (≥ 1). `expDelay(n)` là backoff lũy thừa hiện có theo số lần thất bại n.
 * Pha nhanh (failures ≤ 10): min(backoff cũ, khoảng nhanh) — không bao giờ CHẬM hơn cấu hình cũ. Sau đó: expDelay(failures − 10).
 */
export function khoangNoiLaiMs(failures: number, pollIntervalMs: number, expDelay: (n: number) => number): number {
  if (failures <= NOI_LAI_NHANH_SO_LAN) return Math.min(expDelay(failures), khoangNoiLaiNhanhMs(pollIntervalMs));
  return expDelay(failures - NOI_LAI_NHANH_SO_LAN);
}

/** Tối thiểu (ms) liên kết phải giữ vững sau một lần nối LẠI thì mới coi là ổn định (bộ đếm thất bại về 0, đợt mất kết thúc). */
export const NOI_LAI_ON_DINH_TOI_THIEU_MS = 5_000;

/**
 * Thời gian ổn định `max(3 × poll, 5000)` ms. Một liên kết nối được rồi rớt ngay (thiết bị chạm giới hạn kết nối: chấp nhận rồi
 * đóng) KHÔNG được xoá bộ đếm thất bại — nếu không backoff không bao giờ tích luỹ và vòng nối lại chạy mãi mỗi 500 ms.
 */
export function thoiGianOnDinhMs(pollIntervalMs: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  return Math.max(3 * poll, NOI_LAI_ON_DINH_TOI_THIEU_MS);
}

/**
 * Hạn cứng (ms) cho MỘT lần đọc của vòng poll, do otManager truyền xuống driver (SCADA R0 C5):
 * `max(2 × poll, (timeoutMs ?? 5000) + 1000)`. KHÔNG buộc vào chu kỳ poll: hạn ngắn theo chu kỳ sẽ cắt oan lần đọc chậm-nhưng-khoẻ.
 * Phát hiện nhanh việc rút cáp đến từ timeout từng giao dịch + huỷ ở tầng liên kết, không từ hạn này.
 */
export function tinhDeadlineMs(pollIntervalMs: number, timeoutMs?: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  const t = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 5000;
  return Math.max(2 * poll, t + 1000);
}

/**
 * SCADA R0 T12 (D1) — liên kết TREO (TCP nửa mở: cáp rút sau switch, PLC đóng băng) không bao giờ làm `isConnected()` lật false.
 * K tick poll HỎNG LIÊN TIẾP ⇒ người giữ phiên (otManager legacy / ConnectionSupervisor) báo `lost` và HẠ phiên driver để đường nối
 * lại nhanh chạy. Giá phải trả nếu sai: thiết bị sống-nhưng-chậm chập chờn lost/nối lại mỗi ~K chu kỳ (đã chấp nhận).
 */
export const SO_TICK_HONG_DE_MAT = 2;

/**
 * SCADA R1b-2a T13 — MỘT mẫu / một tag cho thấy máy chủ ĐÃ TRẢ LỜI. CHƯA trả lời = `bad` + `comm_lost` HOẶC `bad` KHÔNG lý do
 * (fix round 1, fail-closed: driver OPC UA push phát bad trần cho item err / terminated(err) / … — sau khi rớt liên kết chúng không được
 * báo connected). `stale`, `config_error`, `device_error`, `out_of_range`, `uncertain` (kể cả kèm comm_lost) đều là đã trả lời (K13).
 * Mọi đường đọc mà thiết bị ĐÃ trả lời phải gắn lý do cho mẫu bad khi cờ V2 bật (chatLuong.MAU_GIA_TRI_HONG cho giá trị hỏng).
 * ★ LUẬT (điều phối 2026-10-26): `stale` được tính là ĐÃ trả lời CHỈ vì không ai phát nó vào sink của phiên. A staleness watchdog on this
 *   path MUST emit comm_lost, never stale — bộ canh độ tươi trên đường này PHẢI phát `comm_lost`, KHÔNG BAO GIỜ `stale`. Ghim bởi census
 *   `staleKhongVaoPhien.census.test.ts` (bảng cho phép rỗng; chỉ phản hồi stale THẬT của thiết bị, có lý do + ngày, mới được thêm).
 * Đây là luật tag DUY NHẤT của cả hai đường: `moiTagMatLienLac` (đường poll: laTickHong / laDocTot) và `taoBatDocTot.quaMau` (đường push).
 */
export function mauMayChuDaTraLoi(s: Pick<OtSample, "quality" | "reason">): boolean {
  return !(s.quality === "bad" && (s.reason === "comm_lost" || s.reason === undefined));
}

/**
 * SCADA R1b-2b-1 T5 (mục 51, T13 m4) — mã mà driver TỰ đặt khi KHÔNG gửi yêu cầu nào cho tag (địa chỉ sai, phát hiện cục bộ):
 * S7 / MC `invalid_address`; OPC UA cú pháp sai `STATUS_BAD_NODEID_INVALID` (opcuaDriver.ts, gõ tay trước khi gửi).
 */
export const MA_CAU_HINH_KHONG_GUI: ReadonlySet<string> = new Set(["invalid_address", "BadNodeIdInvalid (0x80330000)"]);

/**
 * SCADA R1b-2b-1 T5 — mẫu TRUNG TÍNH: `bad` + `config_error` + mã ∈ MA_CAU_HINH_KHONG_GUI. Thiết bị chưa hề được hỏi ⇒ mẫu không nói gì
 * về liên lạc: không "đã trả lời", không "chưa trả lời". Lỗi cấu hình mà THIẾT BỊ trả (Modbus exception, SLMP end code, OPC UA
 * BadNodeIdUnknown) KHÔNG trung tính (máy chủ đã trả lời — K13 giữ); MC `device_error` không trung tính.
 */
export function laMauTrungTinh(s: { quality: OtQuality; reason?: LyDoChatLuong; statusCode?: string }): boolean {
  return s.quality === "bad" && s.reason === "config_error" && s.statusCode !== undefined && MA_CAU_HINH_KHONG_GUI.has(s.statusCode);
}

/** Mọi tag KHÔNG trung tính đều chưa trả lời. Không còn tag nào sau khi bỏ tag trung tính ⇒ false (không nói gì về liên lạc). */
const moiTagMatLienLac = (e: SuKienDoc): boolean => {
  const coNghia = e.tags.filter((t) => !laMauTrungTinh(t));
  return coNghia.length > 0 && coNghia.every((t) => !mauMayChuDaTraLoi(t));
};

/** R1b-2b-1 T5 — tick đọc THÀNH CÔNG mà MỌI tag trung tính: không đọc tốt, không hỏng ⇒ phiên ở `connecting` + lý do. */
export const laTickMoiTagTrungTinh = (e: SuKienDoc): boolean => e.ok === true && e.tags.length > 0 && e.tags.every((t) => laMauTrungTinh(t));

/**
 * Tick hỏng = quá hạn (giao dịch hoặc hạn vòng poll), lỗi comm_lost cho CẢ tick, hoặc tick "ok" mà MỌI tag CHƯA trả lời (bad/comm_lost
 * hoặc bad không lý do — mauMayChuDaTraLoi, R1b-2a T13 fix round 1).
 * R1b-1 T4 — `lyDo:"ingest_treo"` (lượt phát mẫu/ghi DB quá hạn) KHÔNG BAO GIỜ hỏng vì cờ timeout của nó: DB chậm không phải thiết bị mất.
 * Tick đó mang lần đọc chính (`ok:true`) ⇒ phán theo tag của lần đọc như mọi tick ok; không mang lần đọc ⇒ không hỏng.
 */
export function laTickHong(e: SuKienDoc): boolean {
  if (e.lyDo === "ingest_treo") return e.ok === true && moiTagMatLienLac(e);
  if (!e.ok) return e.timeout || e.reason === "comm_lost";
  return moiTagMatLienLac(e);
}

/**
 * SCADA R1b-1 T3 — "đọc tốt" = giao dịch đọc THÀNH CÔNG (`ok:true`: thiết bị đã trả lời) và không phải tick mà D1 coi là hỏng.
 * ok:true mà mọi tag bad vì lý do khác mất liên lạc (config_error / device_error / out_of_range…) VẪN là đọc tốt: liên lạc đã thông.
 * ok:true mà MỌI tag bad/comm_lost (laTickHong) KHÔNG phải: D1 đếm nó là tick hỏng, coi nó là đọc tốt sẽ báo connected rồi lost ngay.
 * R1b-1 T4 (chốt) — lần đọc thành công mà lượt phát mẫu treo (`ok:true, lyDo:"ingest_treo"`) VẪN là đọc tốt: thiết bị đã trả lời,
 * "connected" nói về liên kết thiết bị chứ không về DB (đường push cũng đánh dấu ở mẫu "đã trả lời" đầu — R1b-2a T13 — TRƯỚC khi sink ghi DB). Báo treo
 * không kèm lần đọc (`ok:false`) thì không.
 */
export function laDocTot(e: SuKienDoc): boolean {
  // R1b-2b-1 T5 — tick mà MỌI tag trung tính (driver không gửi yêu cầu nào) không phải đọc tốt: thiết bị chưa hề được hỏi.
  return e.ok === true && !laTickHong(e) && (e.tags.length === 0 || e.tags.some((t) => !laMauTrungTinh(t)));
}

/** R1b-2a T13 — bộ bắt "lần đọc tốt" của MỘT phiên (xem taoBatDocTot). */
export interface BatDocTot {
  /** Mọi tick của phiên (đường poll). */
  quaTick: (e: SuKienDoc) => void;
  /** Mọi mẫu của phiên (đường push — OPC UA monitored items không gọi onTick). */
  quaMau: (s: Pick<OtSample, "quality" | "reason" | "statusCode">) => void;
}

/**
 * SCADA R1b-2a T13 — bắt lần đọc tốt của MỘT phiên từ cả hai nguồn, cùng nghĩa "máy chủ đã trả lời":
 *   - tick (đường poll): `laDocTot(e)`;
 *   - mẫu (đường push): `mauMayChuDaTraLoi(s)`, CHỈ khi phiên CHƯA thấy tick nào.
 * Vì sao mẫu thôi quyết định khi phiên đã có tick: driver poll phát mẫu qua CÙNG sink. Sau một tick lỗi `ok:false`, vòng poll (cờ V2) phát
 * loạt `mauXauChoMoiTag(…, reason = phanLoiLoi(err))`; reason có thể là `device_error` (lỗi không nhận ra) ⇒ mẫu "đã trả lời" trong khi
 * laDocTot nói KHÔNG ⇒ đường poll sẽ báo connected oan. Lần đọc THÀNH CÔNG phát mẫu TRƯỚC tick của nó, và ≥ 1 mẫu đã trả lời ⇔
 * laDocTot(tick đó) ⇒ trước tick đầu, mẫu không đổi nghĩa đường poll. Driver push không bao giờ gọi onTick ⇒ mẫu luôn quyết định.
 * `khiDocTot` có thể bị gọi nhiều lần; người gọi tự chốt lần đầu (khiDocTotLegacy / danhDauDocTot).
 * R1b-2b-1 T5 — mẫu trung tính (laMauTrungTinh) KHÔNG đánh dấu đọc tốt. `khiMoiTagTrungTinh(co)` (tuỳ chọn) báo lý do "mọi tag sai cấu
 * hình cục bộ" của phiên CHƯA đọc tốt: `true` khi chỉ thấy mẫu trung tính — tick laTickMoiTagTrungTinh (poll), hoặc mẫu trung tính khi
 * phiên chưa thấy tick nào VÀ chưa thấy mẫu không trung tính nào (push); `false` khi phiên thấy điều trái lại (tick không đọc tốt mà không
 * trung tính, mẫu chưa trả lời) — lý do "sai cấu hình" không được che việc mất liên lạc. Báo ingest treo không kèm lần đọc: không nói gì.
 * Đã đọc tốt ⇒ không gọi nữa (người gọi xoá lý do ở `connected`).
 */
export function taoBatDocTot(khiDocTot: () => void, khiMoiTagTrungTinh?: (co: boolean) => void): BatDocTot {
  let daThayTick = false;
  let daDocTot = false;
  let daThayMauCoNghia = false;
  const docTot = () => {
    daDocTot = true;
    khiDocTot();
  };
  return {
    quaTick: (e) => {
      daThayTick = true;
      if (laDocTot(e)) docTot();
      else if (!daDocTot && !(e.lyDo === "ingest_treo" && e.ok !== true)) khiMoiTagTrungTinh?.(laTickMoiTagTrungTinh(e));
    },
    quaMau: (s) => {
      if (daThayTick) return;
      if (laMauTrungTinh(s)) {
        if (!daDocTot && !daThayMauCoNghia) khiMoiTagTrungTinh?.(true);
        return;
      }
      daThayMauCoNghia = true;
      if (mauMayChuDaTraLoi(s)) docTot();
      else if (!daDocTot) khiMoiTagTrungTinh?.(false);
    },
  };
}

/**
 * Bộ đếm tick hỏng liên tiếp cho MỘT phiên (mỗi lần subscribe một bộ mới). Từ tick hỏng thứ `k` trở đi gọi `khiDat(e)` mỗi tick hỏng
 * (người gọi tự chặn khi phiên không còn là phiên đang hoạt động); tick không hỏng ⇒ về 0.
 * R1b-1 T4 — báo ingest treo KHÔNG kèm lần đọc (`ok:false, lyDo:"ingest_treo"`) là TRUNG TÍNH: không đếm, không về 0 (nó không nói gì
 * về thiết bị; lần đọc của nó đã được báo ở tick riêng). Ingest treo kèm lần đọc chính được phán theo lần đọc (laTickHong).
 */
export function taoDemTickHong(k: number, khiDat: (e: SuKienDoc) => void): (e: SuKienDoc) => void {
  let n = 0;
  return (e) => {
    if (e.lyDo === "ingest_treo" && e.ok !== true) return;
    if (!laTickHong(e)) {
      n = 0;
      return;
    }
    n += 1;
    if (n >= k) khiDat(e);
  };
}
