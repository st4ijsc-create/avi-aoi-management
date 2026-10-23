/**
 * SCADA R0 (C1/C5) — vòng poll DÙNG CHUNG cho mọi driver OT (và stub).
 *
 *   - Lần đọc ĐẦU chạy ngay lúc tạo vòng (T12 D2), sau đó mỗi `intervalMs`.
 *   - Chống chồng tick: tick tới khi tick trước chưa xong ⇒ BỎ QUA (đếm `soLanChong()`), không dồn hàng đợi.
 *   - Mỗi lần đọc bọc `withDeadline` (`deadlineMs ?? max(2×intervalMs, 6000)`): đọc treo không giữ vòng mãi mãi. Chốt chống chồng chỉ nhả khi
 *     CHÍNH lần đọc xong (hạn không huỷ được đọc): PLC treo ⇒ không dồn đọc song song. Kết quả muộn: V2 bật ⇒ nuốt; V2 tắt ⇒ VẪN phát
 *     khi về (final I1, hành vi trước R0), tick đó vẫn báo timeout.
 *   - Mất liên lạc: báo `onTick({ok:false, timeout})`; khi `chatLuongV2` và là tick ĐẦU của đợt lỗi ⇒ phát MỘT loạt
 *     mẫu `bad` (mỗi tag một mẫu). Các tick lỗi tiếp theo im lặng; có lại một tick tốt ⇒ đợt lỗi kết thúc.
 *   - Lỗi `onSample` của một mẫu bị nuốt (giữ hành vi cũ của driver); `close()` dừng hẳn, tick dở dang không phát gì nữa.
 */
import { withDeadline } from "./drivers/boundedClose";
import { laLoiTimeout, mauXauChoMoiTag } from "./chatLuong";
import type { LyDoChatLuong, OnOtSample, OtSample, OtSubscriptionHandle, OtTagAddress, SuKienDoc } from "./otDriver";

const CHU_KY_MAC_DINH_MS = 5000;
/** Hạn đọc mặc định = max(2 × chu kỳ, 6 s): lưới an toàn, không được cắt lần đọc chậm-nhưng-khoẻ. */
const HAN_DOC_TOI_THIEU_MS = 6000;

export interface TuyChonVongPollChung {
  tags: OtTagAddress[];
  intervalMs: number;
  /** Hạn cứng cho MỘT lần đọc; mặc định = max(2 × intervalMs, 6000). */
  deadlineMs?: number;
  doc: (tags: OtTagAddress[]) => Promise<OtSample[]>;
  onSample: OnOtSample;
  onTick?: (e: SuKienDoc) => void;
  phanLoiLoi: (err: unknown) => { statusCode: string; reason: LyDoChatLuong };
  /** Cờ OT_CHAT_LUONG_V2_ENABLED đã đọc sẵn: bật ⇒ phát mẫu xấu khi mất liên lạc. */
  chatLuongV2: boolean;
  /** Nhãn cho thông điệp timeout (không chứa bí mật). */
  nhan: string;
}

export function taoVongPoll(o: TuyChonVongPollChung): OtSubscriptionHandle & { soLanChong(): number } {
  const chuKy = o.intervalMs > 0 ? o.intervalMs : CHU_KY_MAC_DINH_MS;
  const hanMs = o.deadlineMs !== undefined && o.deadlineMs > 0 ? o.deadlineMs : Math.max(2 * chuKy, HAN_DOC_TOI_THIEU_MS);
  let dong = false;
  let dangChay = false;
  /**
   * CHỐT chống chồng của lần đọc đang bay: lần đọc đã bị bỏ khi quá hạn vẫn có thể đang chạy (withDeadline không huỷ được) ⇒ giữ chốt tới khi
   * chính nó xong. `ma` = số thứ tự lần đọc SỞ HỮU chốt; `giaoMuon` = việc phát kết quả muộn (V2 tắt, final I1) đã nhận quyền sở hữu ⇒ chỉ
   * nó được nhả (sau khi phát XONG), `nha` của docP thì không. null = không có chốt.
   */
  let chot: { ma: number; giaoMuon: boolean } | null = null;
  let soLanDoc = 0;
  let dangLoi = false;
  let soChong = 0;

  const baoTick = (e: SuKienDoc): void => {
    try {
      o.onTick?.(e);
    } catch {
      // người nghe lỗi không được làm hỏng vòng poll
    }
  };

  const tick = async (): Promise<void> => {
    if (dong) return;
    if (dangChay || chot !== null) {
      soChong++;
      return;
    }
    dangChay = true;
    const t0 = Date.now();
    try {
      let mau: OtSample[];
      const ma = ++soLanDoc;
      const KHONG_LOI = Symbol("khong-loi");
      /** Lỗi do CHÍNH docP ném (phân biệt với lỗi quá hạn của withDeadline). */
      let loiCuaDoc: unknown = KHONG_LOI;
      const docP: Promise<OtSample[]> = (async () => o.doc(o.tags))();
      chot = { ma, giaoMuon: false };
      // Chốt chỉ nhả khi CHÍNH docP xong (không phải ở hạn) — TRỪ khi việc phát muộn đã nhận quyền sở hữu chốt (nó tự nhả sau khi phát xong).
      // V2 bật: kết quả/lỗi muộn của lần đọc đã bỏ bị nuốt ở đây.
      const nha = (): void => {
        if (chot !== null && chot.ma === ma && !chot.giaoMuon) chot = null;
      };
      docP.then(nha, (e: unknown) => {
        loiCuaDoc = e;
        nha();
      });
      try {
        mau = await withDeadline(docP, hanMs, `${o.nhan} read`);
      } catch (err) {
        if (dong) return;
        // SCADA R0 final I1 — cờ V2 TẮT (hành vi trước R0): hạn vòng poll cắt lần đọc ⇒ kết quả muộn VẪN phát khi về (driver tuần tự: hai
        // thanh ghi không trả lời không được chặn mãi các tag khoẻ). Tick vẫn báo timeout (bộ đếm, D1) như cũ. close() ⇒ không phát gì.
        // Residual fix: việc phát muộn NHẬN quyền sở hữu chốt NGAY tại đây (đồng bộ, trước mọi await — giữa lúc docP xong và lúc này không
        // tick nào chạy được) và chỉ nó nhả chốt, SAU khi phát XONG: không lần đọc mới nào chạy giữa lúc phát mẫu muộn (onSample chờ ghi DB),
        // mẫu cũ không bao giờ tới sau mẫu mới cùng tag (bộ đệm xếp theo thứ tự nhận — I4).
        if (!o.chatLuongV2 && err !== loiCuaDoc) {
          chot = { ma, giaoMuon: true };
          void (async () => {
            try {
              const muon = await docP;
              for (const s of muon) {
                if (dong) return;
                try {
                  await o.onSample(s);
                } catch {
                  // bỏ qua lỗi callback từng mẫu
                }
              }
            } catch {
              // lỗi muộn của lần đọc đã bỏ: đã báo tick timeout, nuốt
            } finally {
              if (chot !== null && chot.ma === ma) chot = null;
            }
          })();
        }
        // SCADA R0 T12 (D1) — tick lỗi mang phân loại (statusCode, reason) để otManager đếm tick hỏng (timeout / comm_lost).
        const { statusCode, reason } = o.phanLoiLoi(err);
        baoTick({ ok: false, timeout: laLoiTimeout(err), ms: Date.now() - t0, tags: [], statusCode, reason });
        const dauDot = !dangLoi;
        dangLoi = true;
        if (o.chatLuongV2 && dauDot) {
          for (const s of mauXauChoMoiTag(o.tags, statusCode, reason, new Date())) {
            if (dong) return;
            try {
              await o.onSample(s);
            } catch {
              // bỏ qua lỗi callback từng mẫu
            }
          }
        }
        return;
      }
      if (dong) return;
      dangLoi = false;
      const ms = Date.now() - t0;
      for (const s of mau) {
        if (dong) return;
        try {
          await o.onSample(s);
        } catch {
          // bỏ qua lỗi callback từng mẫu
        }
      }
      if (dong) return;
      baoTick({
        ok: true,
        timeout: false,
        ms,
        tags: mau.map((s) => (s.reason ? { tagKey: s.tagKey, quality: s.quality, reason: s.reason } : { tagKey: s.tagKey, quality: s.quality })),
      });
    } finally {
      dangChay = false;
    }
  };

  const timer = setInterval(() => void tick(), chuKy);
  if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
  // SCADA R0 T12 (D2) — lần đọc ĐẦU chạy NGAY lúc subscribe (không chờ một chu kỳ): nối lại xong ⇒ dữ liệu tốt sau MỘT lần đọc,
  // không phải sau một chu kỳ + một lần đọc. Chốt chống chồng giữ nguyên (tick ở mốc chu kỳ bị bỏ nếu lần đọc đầu chưa xong).
  void tick();

  return {
    close: async () => {
      dong = true;
      clearInterval(timer);
    },
    soLanChong: () => soChong,
  };
}
