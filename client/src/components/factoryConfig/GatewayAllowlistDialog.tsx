/**
 * doc 81 Đợt 1C Task 4 — hộp thoại sửa ALLOWLIST THIẾT BỊ của một khoá gateway (IOT_GATEWAY).
 * Khoá của gateway chỉ ghi được dữ liệu cho các thiết bị được chọn (cả /api/ot/ingest lẫn
 * /api/v1/ingest/*). Danh sách rỗng ⇒ gateway không ghi được gì. Lưu = `machine.gatewayAllowlist.set`
 * (server kiểm vai admin/engineer + settings_factory canEdit, ghi audit).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, AlertTriangle } from "lucide-react";
import type { Machine } from "./entityTypes";

interface Props {
  gateway: Machine | null;
  candidates: Machine[];
  onOpenChange: (open: boolean) => void;
}

export function GatewayAllowlistDialog({ gateway, candidates, onOpenChange }: Props) {
  const { t } = useTranslation();
  const open = gateway != null;
  const q = trpc.machine.gatewayAllowlist.get.useQuery(
    { gatewayId: gateway?.id ?? 0 },
    { enabled: open },
  );
  const utils = trpc.useUtils();
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [loc, setLoc] = useState("");
  const [lyDo, setLyDo] = useState("");

  useEffect(() => {
    if (q.data) setChon(new Set(q.data.devices.filter((d) => d.isActive).map((d) => d.id)));
  }, [q.data]);
  useEffect(() => {
    if (!open) {
      setLoc("");
      setLyDo("");
    }
  }, [open]);

  const luu = trpc.machine.gatewayAllowlist.set.useMutation({
    onSuccess: async () => {
      toast.success(t("machinesTab.gatewayAllowlistSaved"));
      await utils.machine.gatewayAllowlist.get.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toastTrpcError(err),
  });

  const hienThi = useMemo(() => {
    const k = loc.trim().toLowerCase();
    return candidates
      .filter((m) => !k || m.code.toLowerCase().includes(k) || m.name.toLowerCase().includes(k))
      .sort((a, b) => Number(chon.has(b.id)) - Number(chon.has(a.id)) || a.code.localeCompare(b.code))
      .slice(0, 200);
  }, [candidates, loc, chon]);

  const doi = (id: number, v: boolean) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (v) moi.add(id);
      else moi.delete(id);
      return moi;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("machinesTab.gatewayAllowlistTitle", { code: gateway?.code ?? "" })}</DialogTitle>
          <DialogDescription>{t("machinesTab.gatewayAllowlistDesc")}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {chon.size === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{t("machinesTab.gatewayAllowlistEmptyWarn")}</span>
              </div>
            )}
            <Input
              placeholder={t("machinesTab.gatewayAllowlistSearch")}
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("machinesTab.gatewayAllowlistSelected", { count: chon.size })}
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border p-2">
              {hienThi.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                  <Checkbox checked={chon.has(m.id)} onCheckedChange={(v) => doi(m.id, v === true)} />
                  <span className="font-mono">{m.code}</span>
                  <span className="text-muted-foreground truncate">{m.name}</span>
                  {m.id === gateway?.id && (
                    <Badge variant="outline">{t("machinesTab.gatewayAllowlistSelf")}</Badge>
                  )}
                </label>
              ))}
            </div>
            {(q.data?.devices ?? []).some((d) => !d.isActive) && (
              <p className="text-xs text-muted-foreground">{t("machinesTab.gatewayAllowlistInactiveNote")}</p>
            )}
            <Input
              placeholder={t("machinesTab.gatewayAllowlistReason")}
              value={lyDo}
              maxLength={500}
              onChange={(e) => setLyDo(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            disabled={!gateway || q.isLoading || luu.isPending}
            onClick={() =>
              gateway &&
              luu.mutate({
                gatewayId: gateway.id,
                deviceIds: Array.from(chon),
                ...(lyDo.trim() ? { reason: lyDo.trim() } : {}),
              })
            }
          >
            {luu.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
