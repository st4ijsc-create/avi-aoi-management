/**
 * Trần SỐ THỦ TỤC trong MỘT yêu cầu tRPC batch — dùng chung server (từ chối) và client (`httpBatchLink.maxItems` tự chia batch).
 *
 * ★★★ Vì sao (rà bảo mật 2026-10-24, scada-master tái hiện): adapter tRPC không giới hạn `maxBatchSize` ⇒ MỘT yêu cầu HTTP chở được hàng trăm thủ tục và lách bộ giới hạn 300 yêu cầu/phút
 * (đếm theo yêu cầu HTTP) cho mọi thao tác đắt — ca nặng nhất: 30 lần thử TOTP trong một batch.
 *
 * ĐO TRƯỚC (Playwright đếm `/api/trpc/a,b,c` trên 53 lượt tải ~50 trang nặng — dashboard, twin, cockpit, SCADA diag, flow studio, war-room, quality…, tài khoản engineer1, dev server :3014):
 * 270 batch, gần như toàn ≤ 7 thủ tục (khung chung của layout = 6); đuôi: 18 (/war-room), 11 (/dashboard, /quality-cockpit?tab=gates), 10 (/engineering-home lần đầu). p99 ≈ 11, max = 18.
 * Trần = 25 ≥ 2 × p99 (22) và ≥ max đo được (18); tối thiểu theo yêu cầu là 20. Client chia batch theo CÙNG hằng này nên trang N+1 (nhiều query cùng tick) không bao giờ bị từ chối.
 */
export const TRPC_MAX_BATCH_SIZE = 25;

/** Số thủ tục trong path của một batch (`a,b,c` ⇒ 3). Path rỗng ⇒ 0. Đã giải mã %2C để không né bằng mã hoá. */
export function demThuTucTrongBatch(path: string): number {
  let giaiMa = path;
  try {
    giaiMa = decodeURIComponent(path);
  } catch {
    /* path hỏng: đếm thô — vẫn chặt hơn là bỏ qua */
  }
  const phan = giaiMa.replace(/^\/+/, "");
  return phan === "" ? 0 : phan.split(",").length;
}
