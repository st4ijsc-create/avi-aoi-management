/**
 * doc 67 W3 (việc 4 — perf tick) — nhãn tuổi TỰ TICK, thay cho state `now`
 * ở root OpsConsole (setInterval 1s ở root = re-render TOÀN trang mỗi giây
 * với 85+ thẻ).
 *
 * Độ phân giải trung thực theo tuổi: chỉ cần tick 1s khi tuổi <60s (đang hiện
 * số giây); từ 1 phút trở lên nhãn chỉ đổi theo phút → tick 10s là đủ.
 * memo: cha re-render (gõ search, chọn checkbox…) không làm nhãn render lại
 * khi raisedAt không đổi.
 *
 * doc 67 W7 GĐ2 — chuỗi hiển thị dùng relTimeShort chuẩn GĐ1 (lib/format —
 * chính GĐ1 liệt kê "opsconsole ageLabel" là nguồn hợp nhất). Đối chiếu hành vi:
 * <60s giống hệt ("42s"); từ 1 phút nhãn GỌN hơn bản formatAge cũ
 * ("3m 20s"→"3m", "49h 3m"→"2h"→có bậc NGÀY "2d" cho predictive nhiều ngày) —
 * đây là điểm hợp nhất đã duyệt, và làm comment tick 10s ở trên ĐÚNG tuyệt đối
 * (nhãn giờ chỉ đổi theo phút thật). Cơ chế tick riêng GIỮ nguyên.
 */
import { memo, useEffect, useState } from "react";
import { relTimeShort } from "@/lib/format";

export const AgeLabel = memo(function AgeLabel({
  raisedAt,
  className,
}: {
  raisedAt: Date | number;
  className?: string;
}) {
  const ts = typeof raisedAt === "number" ? raisedAt : raisedAt.getTime();
  const [now, setNow] = useState(() => Date.now());
  const young = now - ts < 60_000;

  useEffect(() => {
    // young đổi false → effect chạy lại, giãn nhịp 1s → 10s.
    const id = window.setInterval(() => setNow(Date.now()), young ? 1_000 : 10_000);
    return () => window.clearInterval(id);
  }, [ts, young]);

  return (
    <span className={className} title={new Date(ts).toLocaleString("vi-VN")}>
      {relTimeShort(ts, now)}
    </span>
  );
});

export default AgeLabel;
