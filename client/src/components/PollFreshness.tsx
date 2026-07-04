/**
 * PollFreshness — nhãn "cập nhật Ns trước" cho các bảng dùng react-query POLL
 * (không có socket push riêng). Nguồn thời gian là `dataUpdatedAt` của react-query.
 *
 * TRUNG THỰC: đây KHÔNG phải "live" (dữ liệu tới bằng poll định kỳ), nên nhãn chỉ
 * cho biết dữ liệu vừa được làm mới bao lâu trước — tránh gán mác "trực tiếp" sai.
 * Khi đang refetch thì hiện trạng thái "đang cập nhật".
 *
 * i18n: realtime.lastEvent ("Cập nhật {{ago}} trước") + realtime.refreshing.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

/** Định dạng khoảng cách "Ns / Nm / Nh" (giống RealtimeBadge). */
function formatAgo(ms: number): string {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function PollFreshness({
  updatedAt,
  isFetching = false,
  className,
}: {
  /** react-query dataUpdatedAt (mốc mili-giây lần fetch thành công gần nhất). */
  updatedAt: number | undefined;
  /** Đang refetch → hiện trạng thái "đang cập nhật" + icon xoay. */
  isFetching?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  // Tick mỗi giây để "Ns trước" luôn tươi khi còn mount.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!updatedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const ago = useMemo(() => {
    if (!updatedAt) return null;
    return formatAgo(Date.now() - updatedAt);
  }, [updatedAt]);

  const label = isFetching
    ? t("realtime.refreshing", "Đang cập nhật…")
    : ago != null
      ? t("realtime.lastEvent", { ago })
      : t("realtime.polling", "Định kỳ");

  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        className,
      )}
    >
      <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
      {label}
    </span>
  );
}

export default PollFreshness;
