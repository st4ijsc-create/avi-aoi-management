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
 *   - R1b-1 T4 — mỗi LƯỢT PHÁT mẫu (lần đọc chính / mẫu muộn V2 tắt / loạt xấu V2) có hạn `max(2 × chu kỳ, HAN_PHAT_MAU_MS_TOI_THIEU)`:
 *     `onSample` chờ ghi DB treo không còn giữ chốt chống chồng mãi (adapter ngừng poll trong im lặng). Quá hạn ⇒ bỏ mẫu còn lại, báo
 *     tick `lyDo:"ingest_treo"` (hình: xem SuKienDoc), nhả chốt. Lượt phát quá hạn còn chạy nền (onSample đang treo rồi xong muộn) KHÔNG
 *     phát thêm mẫu nào: token lượt bị thu hồi ở hạn ⇒ mẫu của tick mới không bao giờ xen với mẫu cũ (bộ đệm giá trị hiện tại xếp theo
 *     giờ nhận — R0 I4). Lời gọi onSample ĐANG treo thì không huỷ được (mẫu đó đã giao cho sink trước mọi mẫu mới).
 *   - R1b-1 T4 — `soLanChong` tới bộ đếm: mỗi tick báo mang `chong` = số tick bị bỏ vì chồng kể từ lần báo trước.
 *   - R1b-1 T4 fix round 1 (ruling T4 c2) — LẦN ĐỌC treo quá hạn mà vẫn chưa xong (`docTreo`, cờ RIÊNG — không suy từ `chot`, vì V2 tắt
 *     `chot.giaoMuon` được đặt ngay ở hạn, TRƯỚC khi docP xong: "đọc còn treo" và "đang phát muộn / DB treo" trông như nhau trên `chot`):
 *     MỌI tick bị chặn trong trạng thái đó báo `{ok:false, timeout:true}` (không phải ingest_treo) ⇒ D1 K=2 hạ được phiên của thiết bị /
 *     driver treo. Chốt bị giữ bởi việc phát (DB treo) thì tick bị chặn chỉ đếm chồng (trung tính).
 *   - R1b-1 T4 fix round 1 (back-pressure) — giữ lời gọi onSample TREO cuối cùng bị bỏ ở hạn; khi nó chưa xong, lượt phát của tick sau bị
 *     BỎ NGAY và báo ingest_treo (≤ 1 lời gọi sink đang bay mỗi vòng poll — không dồn kết nối trong pool DB). Poll vẫn chạy (D1/T3 thấy).
 *   - Hẹn giờ hạn (đọc + phát) `unref` — như setInterval của vòng: không giữ tiến trình sống.
 */
import { laLoiTimeout, mauXauChoMoiTag } from "./chatLuong";
import type { LyDoChatLuong, OnOtSample, OtSample, OtSubscriptionHandle, OtTagAddress, SuKienDoc } from "./otDriver";

/**
 * R1b-1 T4 fix round 1 (minor 4) — như `withDeadline` (drivers/boundedClose) nhưng hẹn giờ `unref` (helper dùng chung không có tuỳ chọn
 * unref — không sửa helper của dispatcher; cùng cách `lenhHmi.voiHanUnref`).
 */
function voiHanUnref<T>(p: Promise<T>, ms: number, nhan: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${nhan} timeout after ${ms}ms`)), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const CHU_KY_MAC_DINH_MS = 5000;
/** Hạn đọc mặc định = max(2 × chu kỳ, 6 s): lưới an toàn, không được cắt lần đọc chậm-nhưng-khoẻ. */
const HAN_DOC_TOI_THIEU_MS = 6000;
/** R1b-1 T4 — hạn tối thiểu cho MỘT lượt phát mẫu; hạn = max(2 × chu kỳ, 5000). */
export const HAN_PHAT_MAU_MS_TOI_THIEU = 5000;

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
  const hanPhatMs = Math.max(2 * chuKy, HAN_PHAT_MAU_MS_TOI_THIEU);
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
  /** R1b-1 T4 — soChong đã gửi tới người nghe (trường `chong` mang phần tăng). */
  let chongDaBao = 0;
  /**
   * R1b-1 T4 fix round 1 (ruling T4 c2) — lần đọc đã QUÁ HẠN mà docP CHƯA xong (thiết bị / driver treo). Đặt ở nhánh hạn của tick, xoá khi
   * CHÍNH docP xong (resolve/reject). Chỉ cờ này làm tick bị chặn báo tick hỏng; `chot` thì không (V2 tắt: giaoMuon đặt trước khi docP xong).
   */
  let docTreo: { ma: number; tu: number; statusCode: string; reason: LyDoChatLuong } | null = null;
  /** R1b-1 T4 fix round 1 (back-pressure) — lời gọi onSample treo cuối cùng bị bỏ ở hạn; còn chưa xong ⇒ lượt phát sau bị bỏ ngay. */
  let mauTreo: Promise<unknown> | null = null;

  const baoTick = (e: SuKienDoc): void => {
    const chong = soChong - chongDaBao;
    chongDaBao = soChong;
    try {
      o.onTick?.(chong > 0 ? { ...e, chong } : e);
    } catch {
      // người nghe lỗi không được làm hỏng vòng poll
    }
  };

  /**
   * R1b-1 T4 — phát `ds` tuần tự qua onSample trong hạn `hanPhatMs`. true = quá hạn: token LƯỢT bị thu hồi ⇒ vòng phát (có thể vẫn đang
   * chờ một onSample treo) không phát thêm mẫu nào nữa, kể cả khi onSample đó xong muộn sau khi chốt đã nhả và tick mới đã phát.
   */
  const phatCoHan = async (ds: OtSample[]): Promise<boolean> => {
    if (ds.length === 0) return false;
    // Back-pressure: lời gọi sink treo trước còn bay ⇒ không mở lời gọi thứ hai; bỏ cả lượt, báo treo ngay.
    if (mauTreo !== null) return true;
    const luot = { conQuyen: true };
    const dangCho: { p: Promise<unknown> | null } = { p: null };
    const phat = (async () => {
      for (const s of ds) {
        if (dong || !luot.conQuyen) return;
        try {
          const p = Promise.resolve(o.onSample(s));
          dangCho.p = p;
          await p;
        } catch {
          // bỏ qua lỗi callback từng mẫu
        }
      }
    })();
    try {
      await voiHanUnref(phat, hanPhatMs, `${o.nhan} ingest`);
      return false;
    } catch {
      luot.conQuyen = false;
      const p = dangCho.p;
      if (p !== null) {
        mauTreo = p;
        const xong = (): void => {
          if (mauTreo === p) mauTreo = null;
        };
        p.then(xong, xong);
      }
      return true;
    }
  };
  /** Báo treo của lượt phát KHÔNG kèm lần đọc (lần đọc đã báo ở tick riêng). */
  const baoTreoPhat = (t0: number): void => {
    baoTick({ ok: false, timeout: true, lyDo: "ingest_treo", ms: Date.now() - t0, tags: [] });
  };

  const tick = async (): Promise<void> => {
    if (dong) return;
    if (dangChay || chot !== null) {
      soChong++;
      // Ruling T4 c2 — chốt bị giữ vì LẦN ĐỌC treo quá hạn ⇒ tick bị chặn là tick hỏng (D1 K=2 hạ phiên). Giữ vì phát (DB) ⇒ trung tính.
      if (docTreo !== null) {
        baoTick({ ok: false, timeout: true, ms: Date.now() - docTreo.tu, tags: [], statusCode: docTreo.statusCode, reason: docTreo.reason });
      }
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
      let docXong = false;
      const nha = (): void => {
        docXong = true;
        if (docTreo !== null && docTreo.ma === ma) docTreo = null;
        if (chot !== null && chot.ma === ma && !chot.giaoMuon) chot = null;
      };
      docP.then(nha, (e: unknown) => {
        loiCuaDoc = e;
        nha();
      });
      try {
        mau = await voiHanUnref(docP, hanMs, `${o.nhan} read`);
      } catch (err) {
        if (dong) return;
        // SCADA R0 T12 (D1) — tick lỗi mang phân loại (statusCode, reason) để otManager đếm tick hỏng (timeout / comm_lost).
        const { statusCode, reason } = o.phanLoiLoi(err);
        // Ruling T4 c2 — hạn cắt mà docP CHƯA xong ⇒ lần đọc treo; tick bị chặn sau đây báo tick hỏng tới khi docP xong.
        if (err !== loiCuaDoc && !docXong) docTreo = { ma, tu: t0, statusCode, reason };
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
              const t1 = Date.now();
              // R1b-1 T4 — phát muộn có hạn: ghi DB treo không giữ chốt (giaoMuon) mãi; quá hạn ⇒ nhả ở finally, không phát thêm.
              if ((await phatCoHan(muon)) && !dong) baoTreoPhat(t1);
            } catch {
              // lỗi muộn của lần đọc đã bỏ: đã báo tick timeout, nuốt
            } finally {
              if (chot !== null && chot.ma === ma) chot = null;
            }
          })();
        }
        baoTick({ ok: false, timeout: laLoiTimeout(err), ms: Date.now() - t0, tags: [], statusCode, reason });
        const dauDot = !dangLoi;
        dangLoi = true;
        if (o.chatLuongV2 && dauDot) {
          const t1 = Date.now();
          // R1b-1 T4 — loạt xấu cũng có hạn (ghi DB treo không giữ chốt chống chồng).
          if ((await phatCoHan(mauXauChoMoiTag(o.tags, statusCode, reason, new Date()))) && !dong) baoTreoPhat(t1);
        }
        return;
      }
      if (dong) return;
      dangLoi = false;
      const ms = Date.now() - t0;
      const treo = await phatCoHan(mau);
      if (dong) return;
      const tags = mau.map((s) => (s.reason ? { tagKey: s.tagKey, quality: s.quality, reason: s.reason } : { tagKey: s.tagKey, quality: s.quality }));
      // R1b-1 T4 — lượt phát quá hạn: lần đọc VẪN thành công (thiết bị đã trả lời) ⇒ ok:true + tag của lần đọc (D1/đọc tốt phán theo tag),
      // `timeout:true, lyDo:"ingest_treo"` để bộ đếm thấy treo (không tính loi/timeout thiết bị). `ms` = thời gian đọc, không gồm phát.
      baoTick(treo ? { ok: true, timeout: true, lyDo: "ingest_treo", ms, tags } : { ok: true, timeout: false, ms, tags });
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
