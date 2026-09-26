/**
 * KillSwitchBar — compact header control for the D2/D4 autonomy kill-switch
 * (doc69 GĐ4/E2-3), the Command Center's prominent ops control. Reuses the EXISTING
 * `trpc.aiAgent.getKillSwitchStatus` / `tripKillSwitch` / `untripKillSwitch`
 * mutations byte-for-byte the way AIBrainDashboard.tsx already wires them (read =
 * any authenticated user; trip/untrip = admin + 2FA, enforced server-side by
 * `killSwitchProcedure`). Reuses the `aiBrain.killSwitch.*` i18n strings verbatim
 * (same concept, already vi/en/zh complete) instead of duplicating a parallel key set.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldOff, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { mapTrpcError } from "@/lib/trpcErrors";

export interface KillSwitchBarProps {
  isAdmin: boolean;
}

export function KillSwitchBar({ isAdmin }: KillSwitchBarProps) {
  const { t } = useTranslation();
  const polling = usePollingInterval(5000);
  const killSwitch = trpc.aiAgent.getKillSwitchStatus.useQuery(undefined, { ...polling });
  const [tripReason, setTripReason] = useState("");
  const [open, setOpen] = useState(false);

  const tripMut = trpc.aiAgent.tripKillSwitch.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.killSwitch.tripSuccess", "Đã TRIP công tắc — mọi tự-xác-nhận autonomy bị khóa ngay."));
      setTripReason("");
      setOpen(false);
      killSwitch.refetch();
    },
    onError: (err: any) => toast.error(t("aiBrain.killSwitch.tripError", "Không thể trip công tắc."), { description: mapTrpcError(err) }),
  });
  const untripMut = trpc.aiAgent.untripKillSwitch.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.killSwitch.untripSuccess", "Đã UNTRIP công tắc."));
      killSwitch.refetch();
    },
    onError: (err: any) => toast.error(t("aiBrain.killSwitch.untripError", "Không thể untrip công tắc."), { description: mapTrpcError(err) }),
  });

  const tripped = !!killSwitch.data?.tripped;

  const handleTrip = () => {
    const reason = tripReason.trim();
    if (reason.length < 3) {
      toast.error(t("aiBrain.killSwitch.reasonPlaceholder", "Lý do dừng (bắt buộc)…"));
      return;
    }
    tripMut.mutate({ reason });
  };

  const handleUntrip = () => {
    if (
      !window.confirm(
        t(
          "aiBrain.killSwitch.untripConfirm",
          "Bạn có chắc muốn MỞ LẠI (untrip) công tắc tự vận? Autonomy có thể tự xác nhận hành động nếu được bật ở nơi khác.",
        ),
      )
    ) {
      return;
    }
    untripMut.mutate();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={tripped ? "destructive" : "outline"}
          size="sm"
          aria-label={
            tripped
              ? t("aiBrain.killSwitch.tripped", "ĐÃ TRIP — autonomy bị khóa")
              : t("aiBrain.killSwitch.notTripped", "Chưa trip — autonomy có thể chạy nếu được bật")
          }
        >
          {tripped ? <ShieldOff className="h-4 w-4 mr-1.5" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
          {tripped ? t("aiBrain.killSwitch.tripped", "ĐÃ TRIP — autonomy bị khóa") : t("aiBrain.killSwitch.notTripped", "Chưa trip — autonomy có thể chạy nếu được bật")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <ShieldAlert className="size-4 shrink-0" />
          {t("aiBrain.killSwitch.title", "Công tắc dừng khẩn cấp tự vận (autonomy)")}
        </div>
        <Badge variant={tripped ? "destructive" : "outline"} className="text-[11px]">
          {tripped ? t("aiBrain.killSwitch.tripped", "ĐÃ TRIP — autonomy bị khóa") : t("aiBrain.killSwitch.notTripped", "Chưa trip — autonomy có thể chạy nếu được bật")}
        </Badge>
        {!isAdmin ? (
          <p className="text-[11.5px] text-muted-foreground">{t("aiBrain.killSwitch.adminOnlyNote", "Chỉ admin đã bật 2FA mới có thể đổi trạng thái công tắc này.")}</p>
        ) : tripped ? (
          <Button variant="outline" size="sm" disabled={untripMut.isPending} onClick={handleUntrip}>
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            {t("aiBrain.killSwitch.untripButton", "Untrip — mở lại")}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              value={tripReason}
              onChange={(e) => setTripReason(e.target.value)}
              placeholder={t("aiBrain.killSwitch.reasonPlaceholder", "Lý do dừng (bắt buộc)…")}
              className="h-8 text-sm"
              maxLength={500}
            />
            <Button variant="destructive" size="sm" disabled={tripMut.isPending || tripReason.trim().length < 3} onClick={handleTrip}>
              <ShieldOff className="h-4 w-4 mr-1.5" />
              {t("aiBrain.killSwitch.tripButton", "Trip — dừng khẩn cấp")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default KillSwitchBar;
