/**
 * doc 81 Đợt 1C Task 4 — hộp thoại sửa ALLOWLIST THIẾT BỊ của một khoá gateway (IOT_GATEWAY).
 * Khoá của gateway chỉ ghi được dữ liệu cho các thiết bị được chọn (cả /api/ot/ingest lẫn
 * /api/v1/ingest/*). Danh sách rỗng ⇒ gateway không ghi được gì. Lưu = `machine.gatewayAllowlist.set`
 * (server kiểm vai admin/engineer + settings_factory canEdit + phạm vi, ghi audit).
 *
 * ★ fix round 1 (#2):
 *   • Thân hộp thoại (`NoiDung`) được MOUNT LẠI mỗi lần mở (khoá theo id gateway, và bị gỡ khi đóng)
 *     ⇒ Huỷ rồi mở lại luôn hiện TRẠNG THÁI MÁY CHỦ, không còn lựa chọn cũ trôi sang.
 *   • Lựa chọn chỉ được gieo từ dữ liệu ĐỌC SAU KHI MOUNT (`isFetchedAfterMount`) — không gieo từ cache cũ.
 *   • Đọc lỗi ⇒ hiện trạng thái lỗi, KHÔNG hiện cảnh báo "danh sách rỗng", và nút Lưu bị KHOÁ: một lượt
 *     đọc hỏng không bao giờ thành một lượt lưu xoá sạch allowlist.
 *   • Mục ngoài phạm vi người xem chỉ đến dưới dạng số đếm (`outOfScopeCount`); máy chủ GIỮ chúng khi lưu.
 * ★ fix #7: gợi ý "chỉ hiện 200 mục đầu — lọc thêm" và thông báo khi không khớp.
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

/** Trần số dòng hiển thị trong danh sách chọn. */
export const SO_DONG_TOI_DA = 200;

interface Props {
  gateway: Machine | null;
  candidates: Machine[];
  onOpenChange: (open: boolean) => void;
}

export function GatewayAllowlistDialog({ gateway, candidates, onOpenChange }: Props) {
  return (
    <Dialog open={gateway != null} onOpenChange={onOpenChange}>
      {gateway != null && (
        <NoiDung key={gateway.id} gateway={gateway} candidates={candidates} onOpenChange={onOpenChange} />
      )}
    </Dialog>
  );
}

function NoiDung({ gateway, candidates, onOpenChange }: { gateway: Machine; candidates: Machine[]; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const q = trpc.machine.gatewayAllowlist.get.useQuery(
    { gatewayId: gateway.id },
    { refetchOnMount: "always", retry: false },
  );
  const utils = trpc.useUtils();
  const [chon, setChon] = useState<Set<number> | null>(null);
  const [loc, setLoc] = useState("");
  const [lyDo, setLyDo] = useState("");

  const docXong = !!q.data && q.isFetchedAfterMount && !q.isError;
  useEffect(() => {
    if (chon === null && docXong && q.data) {
      setChon(new Set(q.data.devices.filter((d) => d.isActive).map((d) => d.id)));
    }
  }, [chon, docXong, q.data]);

  const luu = trpc.machine.gatewayAllowlist.set.useMutation({
    onSuccess: async () => {
      toast.success(t("machinesTab.gatewayAllowlistSaved"));
      await utils.machine.gatewayAllowlist.get.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toastTrpcError(err),
  });

  const { hienThi, soKhop } = useMemo(() => {
    const k = loc.trim().toLowerCase();
    const khop = candidates
      .filter((m) => !k || m.code.toLowerCase().includes(k) || m.name.toLowerCase().includes(k))
      .sort((a, b) => Number(chon?.has(b.id) ?? false) - Number(chon?.has(a.id) ?? false) || a.code.localeCompare(b.code));
    return { hienThi: khop.slice(0, SO_DONG_TOI_DA), soKhop: khop.length };
  }, [candidates, loc, chon]);

  const doi = (id: number, v: boolean) =>
    setChon((cu) => {
      const moi = new Set(cu ?? []);
      if (v) moi.add(id);
      else moi.delete(id);
      return moi;
    });

  const coTheLuu = docXong && chon !== null && !luu.isPending;
  const soNgoaiPhamVi = q.data?.outOfScopeCount ?? 0;

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("machinesTab.gatewayAllowlistTitle", { code: gateway.code })}</DialogTitle>
        <DialogDescription>{t("machinesTab.gatewayAllowlistDesc")}</DialogDescription>
      </DialogHeader>
      {q.isError ? (
        <div
          role="alert"
          data-testid="gw-allowlist-load-error"
          className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t("machinesTab.gatewayAllowlistLoadError")}</span>
        </div>
      ) : chon === null ? (
        <div className="flex justify-center py-6" data-testid="gw-allowlist-loading">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {chon.size === 0 && soNgoaiPhamVi === 0 && (
            <div
              data-testid="gw-allowlist-empty-warn"
              className="flex items-start gap-2 rounded-md border border-destructive/50 p-2 text-sm text-destructive"
            >
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
            {hienThi.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2" data-testid="gw-allowlist-no-match">
                {t("machinesTab.gatewayAllowlistNoMatch")}
              </p>
            ) : (
              hienThi.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                  <Checkbox
                    aria-label={m.code}
                    checked={chon.has(m.id)}
                    onCheckedChange={(v) => doi(m.id, v === true)}
                  />
                  <span className="font-mono">{m.code}</span>
                  <span className="text-muted-foreground truncate">{m.name}</span>
                  {m.id === gateway.id && <Badge variant="outline">{t("machinesTab.gatewayAllowlistSelf")}</Badge>}
                </label>
              ))
            )}
          </div>
          {soKhop > SO_DONG_TOI_DA && (
            <p className="text-xs text-muted-foreground" data-testid="gw-allowlist-truncated">
              {t("machinesTab.gatewayAllowlistTruncated", { shown: SO_DONG_TOI_DA, total: soKhop })}
            </p>
          )}
          {soNgoaiPhamVi > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="gw-allowlist-out-of-scope">
              {t("machinesTab.gatewayAllowlistOutOfScope", { count: soNgoaiPhamVi })}
            </p>
          )}
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
          disabled={!coTheLuu}
          onClick={() => {
            if (!coTheLuu || chon === null) return;
            luu.mutate({
              gatewayId: gateway.id,
              deviceIds: Array.from(chon),
              ...(lyDo.trim() ? { reason: lyDo.trim() } : {}),
            });
          }}
        >
          {luu.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t("common.save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
