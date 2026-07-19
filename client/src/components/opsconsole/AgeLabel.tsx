/**
 * doc 67 W3 (việc 4 — perf tick) — nhãn tuổi TỰ TICK, thay cho state `now`
 * ở root OpsConsole (setInterval 1s ở root = re-render TOÀN trang mỗi giây
 * với 85+ thẻ).
 *
 * Độ phân giải trung thực theo tuổi: chỉ cần tick 1s khi tuổi <60s (đang hiện
 * số giây); từ 1 phút trở lên nhãn chỉ đổi theo phút → tick 10s là đủ.
 * memo: cha re-render (gõ search, chọn checkbox…) không làm nhãn render lại
 * khi raisedAt không đổi.
 */
import { memo, useEffect, useState } from "react";

export function formatAge(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

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
      {formatAge(now - ts)}
    </span>
  );
});

export default AgeLabel;
