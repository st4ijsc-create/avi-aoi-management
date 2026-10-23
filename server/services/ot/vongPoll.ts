/**
 * SCADA R0 (C1/C5) — vòng poll DÙNG CHUNG cho mọi driver OT (và stub).
 *
 *   - Chống chồng tick: tick tới khi tick trước chưa xong ⇒ BỎ QUA (đếm `soLanChong()`), không dồn hàng đợi.
 *   - Mỗi lần đọc bọc `withDeadline` (`deadlineMs ?? intervalMs`): đọc treo không giữ vòng mãi mãi.
 *   - Mất liên lạc: báo `onTick({ok:false, timeout})`; khi `chatLuongV2` và là tick ĐẦU của đợt lỗi ⇒ phát MỘT loạt
 *     mẫu `bad` (mỗi tag một mẫu). Các tick lỗi tiếp theo im lặng; có lại một tick tốt ⇒ đợt lỗi kết thúc.
 *   - Lỗi `onSample` của một mẫu bị nuốt (giữ hành vi cũ của driver); `close()` dừng hẳn, tick dở dang không phát gì nữa.
 */
import { withDeadline } from "./drivers/boundedClose";
import { laLoiTimeout, mauXauChoMoiTag } from "./chatLuong";
import type { LyDoChatLuong, OnOtSample, OtSample, OtSubscriptionHandle, OtTagAddress, SuKienDoc } from "./otDriver";

const CHU_KY_MAC_DINH_MS = 5000;

export interface TuyChonVongPollChung {
  tags: OtTagAddress[];
  intervalMs: number;
  /** Hạn cứng cho MỘT lần đọc; mặc định = intervalMs. */
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
  const hanMs = o.deadlineMs !== undefined && o.deadlineMs > 0 ? o.deadlineMs : chuKy;
  let dong = false;
  let dangChay = false;
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
    if (dangChay) {
      soChong++;
      return;
    }
    dangChay = true;
    const t0 = Date.now();
    try {
      let mau: OtSample[];
      try {
        mau = await withDeadline(
          (async () => o.doc(o.tags))(),
          hanMs,
          `${o.nhan} read`,
        );
      } catch (err) {
        if (dong) return;
        baoTick({ ok: false, timeout: laLoiTimeout(err), ms: Date.now() - t0, tags: [] });
        const dauDot = !dangLoi;
        dangLoi = true;
        if (o.chatLuongV2 && dauDot) {
          const { statusCode, reason } = o.phanLoiLoi(err);
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
      baoTick({ ok: true, timeout: false, ms, tags: mau.map((s) => ({ tagKey: s.tagKey, quality: s.quality })) });
    } finally {
      dangChay = false;
    }
  };

  const timer = setInterval(() => void tick(), chuKy);
  if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();

  return {
    close: async () => {
      dong = true;
      clearInterval(timer);
    },
    soLanChong: () => soChong,
  };
}
