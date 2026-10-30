/**
 * SCADA R1b-2b-1 (bench B1b lượt 1, điều phối 2026-10-27: Phương án A + nhãn (a) "không rõ kết cục") — YÊU CẦU ĐANG BAY của một phiên
 * driver bị TRẢ LỜI NGAY khi liên kết của phiên đó mất hoặc phiên bị hạ.
 *
 * Vì sao: thư viện giao thức huỷ yêu cầu đang chờ mà KHÔNG gọi callback khi phiên bị hạ:
 *   • modbus-serial 8.0.25 `destroy()` ⇒ `_cancelPendingTransactions()` xoá hẹn giờ giao dịch, không gọi `next` (index.js:725-772);
 *   • nodes7 0.3.x / mcprotocol 0.1.x `connectionCleanup()` (gọi từ dropConnection / hẹn giờ drop) ⇒ `clearWritePacketTimeouts()` /
 *     `clearReadPacketTimeouts()`, không gọi writeDoneCallback / readDoneCallback.
 * ⇒ promise của lệnh ghi không bao giờ xong; dispatcher chỉ trả lời ở hạn của nó (OT_CONTROL_TIMEOUT_MS 5000) — một STOP mất liên kết
 * giữa chừng chờ 5 s mới được nói "không rõ" (lỗi CÓ SẴN từ 1e0ae656c, 2026-09-26).
 *
 * Hợp đồng:
 *   • `bay(phien, p)` — bọc lời gọi thư viện của phiên `phien` (đối tượng client/conn); kết quả như `p`, trừ khi phiên bị huỷ trước.
 *   • `huy(phien, lyDo)` — mọi yêu cầu đang bay của phiên đó reject NGAY bằng `LoiMatLienKetKhiDangGui` (yêu cầu ĐÃ giao cho thư viện:
 *     có thể đã tới thiết bị ⇒ kết cục KHÔNG RÕ — dispatcher ánh xạ sang `timeout`, không bao giờ `failed`). Gọi ở BA điểm của mỗi
 *     driver: socket close/error của phiên hiện tại · disconnect() · connect() trước khi đóng phiên cũ.
 *   • Không thử lại, không trì hoãn gửi, không chặn gì trước lệnh — chỉ TRẢ LỜI sớm.
 */

/** Mã ổn định (so được qua ranh giới module / edge mà không cần `instanceof`). */
export const MA_MAT_LIEN_KET_KHI_DANG_GUI = "OT_LINK_LOST_IN_FLIGHT";

/** Yêu cầu đã giao cho thư viện khi liên kết mất / phiên bị hạ — kết cục KHÔNG RÕ (có thể đã tới thiết bị). */
export class LoiMatLienKetKhiDangGui extends Error {
  readonly code = MA_MAT_LIEN_KET_KHI_DANG_GUI;
  constructor(
    readonly giaoThuc: string,
    readonly lyDo: string,
  ) {
    super(`${giaoThuc} link lost while a request was in flight (${lyDo}) — outcome unknown`);
    this.name = "LoiMatLienKetKhiDangGui";
  }
}

export function laLoiMatLienKetKhiDangGui(err: unknown): err is LoiMatLienKetKhiDangGui {
  return err instanceof LoiMatLienKetKhiDangGui || (err as { code?: unknown } | null | undefined)?.code === MA_MAT_LIEN_KET_KHI_DANG_GUI;
}

/** Sổ yêu cầu đang bay theo PHIÊN (đối tượng client của thư viện). Một sổ cho mỗi đối tượng driver. */
export class SoYeuCauDangBay {
  private readonly theoPhien = new Map<object, Set<(e: Error) => void>>();

  constructor(private readonly giaoThuc: string) {}

  /** Bọc `p` (lời gọi thư viện trên `phien`): xong như `p`, hoặc reject ngay khi `huy(phien)`. `phien` null ⇒ trả `p` nguyên. */
  bay<T>(phien: object | null | undefined, p: Promise<T> | T): Promise<T> {
    const pp = Promise.resolve(p); // client giả (test) có thể trả giá trị đồng bộ
    if (!phien) return pp;
    let ds = this.theoPhien.get(phien);
    if (!ds) {
      ds = new Set();
      this.theoPhien.set(phien, ds);
    }
    const tap = ds;
    return new Promise<T>((resolve, reject) => {
      let xong = false;
      const go = () => {
        tap.delete(huy);
        if (tap.size === 0 && this.theoPhien.get(phien) === tap) this.theoPhien.delete(phien);
      };
      const huy = (e: Error) => {
        if (xong) return;
        xong = true;
        go();
        reject(e);
      };
      tap.add(huy);
      pp.then(
        (v) => {
          if (xong) return;
          xong = true;
          go();
          resolve(v);
        },
        (e) => {
          // kết quả muộn của một yêu cầu đã bị huỷ: nuốt (không unhandled)
          if (xong) return;
          xong = true;
          go();
          reject(e);
        },
      );
    });
  }

  /** Huỷ NGAY mọi yêu cầu đang bay của `phien`. Trả số yêu cầu bị huỷ. Idempotent. */
  huy(phien: object | null | undefined, lyDo: string): number {
    if (!phien) return 0;
    const ds = this.theoPhien.get(phien);
    if (!ds || ds.size === 0) return 0;
    this.theoPhien.delete(phien);
    const loi = new LoiMatLienKetKhiDangGui(this.giaoThuc, lyDo);
    const cac = [...ds];
    ds.clear();
    for (const h of cac) h(loi);
    return cac.length;
  }

  /** Số yêu cầu đang bay (của `phien`, hoặc mọi phiên). Cho test. */
  soDangBay(phien?: object | null): number {
    if (phien) return this.theoPhien.get(phien)?.size ?? 0;
    let n = 0;
    for (const ds of this.theoPhien.values()) n += ds.size;
    return n;
  }
}

/**
 * SCADA R1b-2b-2a T2 (mục 66, phần 1) — yêu cầu đã giao cho thư viện / thiết bị mà HẾT HẠN CỦA CHÍNH DRIVER (hẹn giờ giao dịch của thư viện:
 * modbus-serial `setTimeout(cfg.timeoutMs)`, SLMP `cfg.timeoutMs`, st-ethernet-ip `timeout_sp`, node-opcua timeoutHint; hoặc bộ hẹn DỰ PHÒNG của
 * driver `HAN_DU_PHONG_GHI_DRIVER_MS`) trước khi thiết bị trả lời ⇒ kết cục KHÔNG RÕ (lệnh có thể đã được áp). Dispatcher ánh xạ sang `timeout`
 * theo TỪNG write — cùng nhánh nhãn / bỏ đọc lại / ghi rủi ro "lệnh ghi cũ" với `LoiMatLienKetKhiDangGui` (T17), không bao giờ `failed`.
 */
export const MA_QUA_HAN_YEU_CAU_DRIVER = "OT_DRIVER_REQUEST_TIMEOUT";

/**
 * T3 fix 1 (kiem-dinh M-2) — AI hết hạn: `"thu_vien"` = hẹn giờ giao dịch / gói của CHÍNH thư viện (hoặc socket riêng của driver) đã trả lời "hết hạn"
 * (thư viện đã tự dọn yêu cầu); `"du_phong"` = bộ hẹn DỰ PHÒNG của driver hết trong khi thư viện CHƯA gọi lại (thư viện còn giữ yêu cầu ⇒ S7 hạ phiên).
 * Quyết định dựa trên trường này, KHÔNG đọc chữ của message.
 */
export type LoaiQuaHanDriver = "du_phong" | "thu_vien";

export class LoiQuaHanYeuCauDriver extends Error {
  readonly code = MA_QUA_HAN_YEU_CAU_DRIVER;
  constructor(
    readonly giaoThuc: string,
    readonly chiTiet: string,
    readonly loai: LoaiQuaHanDriver,
  ) {
    super(`${giaoThuc} request timed out in the driver (${chiTiet}) — outcome unknown`);
    this.name = "LoiQuaHanYeuCauDriver";
  }
}

export function laLoiQuaHanYeuCauDriver(err: unknown): err is LoiQuaHanYeuCauDriver {
  return err instanceof LoiQuaHanYeuCauDriver || (err as { code?: unknown } | null | undefined)?.code === MA_QUA_HAN_YEU_CAU_DRIVER;
}

/** Vì sao một write `ok: false` KHÔNG RÕ kết cục (đã giao cho thư viện / thiết bị): liên kết mất khi đang bay · driver tự hết hạn. */
export type KetCucKhongRo = "mat_lien_ket" | "qua_han_driver";

/** Lỗi có kiểu ⇒ loại "không rõ"; lỗi khác (thiết bị đã trả lời, chưa gửi, ép kiểu cục bộ) ⇒ null (`failed` như cũ). */
export function ketCucKhongRoCua(err: unknown): KetCucKhongRo | null {
  if (laLoiMatLienKetKhiDangGui(err)) return "mat_lien_ket";
  if (laLoiQuaHanYeuCauDriver(err)) return "qua_han_driver";
  return null;
}

/**
 * Bộ hẹn DỰ PHÒNG cho một lời ghi của driver (EIP ở T2; S7 / MC ở T3) — chỉ chặn một promise thư viện không bao giờ xong. Lớn hơn hạn lệnh mặc định
 * (OT_CONTROL_TIMEOUT_MS 5000) + ân hạn B3 (OT_TIMED_OUT_WRITE_GRACE_MS 1000) ⇒ trong cấu hình mặc định hạn của DISPATCHER thắng và B3 (giữ chỗ +
 * đặt lại phiên) luôn chạy khi thư viện còn giữ yêu cầu.
 */
export const HAN_DU_PHONG_GHI_DRIVER_MS = 6500;
