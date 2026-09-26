/**
 * doc 63 (FLW-01 / IA-13 / G1) — SHELL ALERT CHIP + drawer: luồng "xác nhận + xử lý
 * cảnh báo" ≤3 chạm, 0 chuyển màn, khả dụng từ MỌI trang vì sống ở header vỏ.
 *
 *   Chạm 1 — chip (đếm andon đang mở, tô theo mức nặng nhất) → Sheet overlay phải.
 *   Chạm 2 — "Tiếp nhận" (andon.acknowledge, đóng dấu MTTA server-side).
 *   Chạm 3 — "Xử lý xong" (andon.resolve; ghi chú tùy chọn, đóng dấu MTTR).
 *
 * ISA-101: KHÔNG có andon mở → chip ẨN (header im lặng). ISA-18.2: mỗi hàng mang
 * WorkUnit + lý do + tuổi; 4 trường governance đầy đủ nằm ở cockpit (FEA-A1).
 * An toàn: chỉ Ack/Resolve — KHÔNG lệnh chuyển động nào phát từ đây (ISO 10218).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { AndonBadge } from "@/components/patterns/isaStateBadges";
import { compareSeverity } from "@/lib/severityCanonical";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

function ageLabel(raisedAt: string | Date | null | undefined, minUnit: string): string {
  if (!raisedAt) return "—";
  const ms = Date.now() - new Date(raisedAt).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} ${minUnit}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function ShellAlertChip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  // Poll 15s — chip là bề mặt vỏ, nhẹ; push realtime của trang không bị đụng.
  const active = trpc.andon.active.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const rows = active.data ?? [];
  const worst = useMemo(
    () => rows.reduce<string | null>((acc, r) => (acc == null || compareSeverity(r.state, acc) > 0 ? (r.state as string) : acc), null),
    [rows],
  );

  const invalidate = () => void utils.andon.active.invalidate();
  const ackM = trpc.andon.acknowledge.useMutation({
    onSuccess: () => { toast.success(t("andonChip.acked", "Đã tiếp nhận (MTTA đã ghi).")); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const resolveM = trpc.andon.resolve.useMutation({
    onSuccess: () => { toast.success(t("andonChip.resolved", "Đã xử lý xong (MTTR đã ghi).")); setNote(""); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });

  // ISA-101 — im lặng khi không có gì bất thường (kể cả khi query lỗi/không quyền).
  if (!active.isSuccess || rows.length === 0) return null;

  const critical = rows.some((r) => String(r.state).toLowerCase() === "red" || String(r.state).toLowerCase() === "call");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("andonChip.aria", "Cảnh báo đang mở")}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
            critical
              ? "border-transparent text-white animate-pulse"
              : "border-transparent",
            className,
          )}
          style={{
            backgroundColor: critical ? "var(--alarm-critical-fill)" : "var(--alarm-medium-fill)",
            color: critical ? "var(--alarm-critical-fg)" : "var(--alarm-medium-fg)",
          }}
        >
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          {rows.length}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {t("andonChip.title", "Cảnh báo đang mở")} ({rows.length})
          </SheetTitle>
          <SheetDescription>
            {t("andonChip.desc", "Tiếp nhận rồi xử lý tại chỗ — không rời màn hình hiện tại.")}
            {worst ? <span className="ml-1"><AndonBadge state={worst} /></span> : null}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {rows.map((r) => {
            const acked = !!r.acknowledgedAt;
            return (
              <div key={r.id} className="rounded-md border p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <AndonBadge state={String(r.state)} />
                  <span className="font-medium">{r.title ?? r.reason ?? `#${r.id}`}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {ageLabel(r.raisedAt as unknown as string, t("andonChip.minShort", "ph"))}
                  </span>
                </div>
                {r.message && <div className="mt-1 text-xs text-muted-foreground">{r.message}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {!acked ? (
                    <Button size="sm" className="h-9" disabled={ackM.isPending} onClick={() => ackM.mutate({ id: r.id })}>
                      {t("andonChip.ack", "Tiếp nhận")}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{t("andonChip.ackedAt", "Đã tiếp nhận")}</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={resolveM.isPending}
                    onClick={() => resolveM.mutate({ id: r.id, notes: note.trim() || undefined })}
                  >
                    {t("andonChip.resolve", "Xử lý xong")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t p-3">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("andonChip.notePh", "Ghi chú xử lý (tùy chọn, dùng cho nút Xử lý xong)")}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ShellAlertChip;
