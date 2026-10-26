/**
 * Khối cảnh báo nổi bật dùng chung của M12 (ISA-101: màu bão hoà chỉ cho bất thường) — viền trái + biểu tượng + chữ, không chỉ màu.
 * R1b-2a T7 fix round 1 — tách khỏi `BangKenh.tsx` (BangKenh re-export cùng tên) để `HopKhaiHangLoat` ↔ `BangKenh` không import vòng.
 */
import { AlertTriangle } from "lucide-react";

export function KhoiCanhBao({ children, tone = "--alarm-high", testId }: { children: React.ReactNode; tone?: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="flex items-start gap-1.5 rounded-sm border-l-4 px-2 py-1 text-xs font-medium whitespace-normal"
      style={{ borderLeftColor: `var(${tone})`, color: `var(${tone})` }}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-foreground">{children}</span>
    </div>
  );
}
