/**
 * Stencil cycle-counter panel — doc 35 W4-C.3.
 *
 * Surfaces the previously UI-less `trpc.stencil.*` router:
 *  - status({ stencilToolId })      → live worn status (prints vs life-limit)
 *  - recordPrints({...})            → accrue print cycles + optional clean/tension (gated)
 *  - listUsage({ stencilToolId })   → recent usage ledger
 *
 * There is no tools-master list procedure exposed to the client, so the stencil is
 * selected by its numeric tool id (from the tools master). Recording works
 * regardless of STENCIL_TRACKING_ENABLED; the worn side-effect is what the flag gates.
 * Write action gated by usePermissions("masterdata").
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { AlertTriangle, Gauge, Layers, RefreshCw, Search } from "lucide-react";

export default function StencilPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("masterdata", "canCreate") || hasPermission("masterdata", "canEdit");

  const [toolIdInput, setToolIdInput] = useState("");
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [printCount, setPrintCount] = useState("");
  const [cleaned, setCleaned] = useState(false);
  const [tensionValue, setTensionValue] = useState("");
  const [notes, setNotes] = useState("");

  const status = trpc.stencil.status.useQuery(
    { stencilToolId: selectedToolId ?? 0 },
    { enabled: selectedToolId != null, staleTime: 15_000 },
  );
  const usage = trpc.stencil.listUsage.useQuery(
    { stencilToolId: selectedToolId ?? 0, limit: 50 },
    { enabled: selectedToolId != null, staleTime: 15_000 },
  );

  const record = trpc.stencil.recordPrints.useMutation({
    onSuccess: (res: any) => {
      toast.success(t("stencil.daGhiLuotIn", { count: printCount || 0, total: res?.totalPrints ?? "?" }));
      setPrintCount("");
      setTensionValue("");
      setCleaned(false);
      setNotes("");
      status.refetch();
      usage.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });

  const onSelect = () => {
    const id = Number(toolIdInput.trim());
    if (!Number.isInteger(id) || id <= 0) return toast.error(t("stencilPanel.nhapIdKhuonInStencil", "Nhập ID khuôn in (stencil tool) hợp lệ"));
    setSelectedToolId(id);
  };

  const onRecord = () => {
    if (selectedToolId == null) return toast.error(t("stencilPanel.chonKhuonInTruoc", "Chọn khuôn in trước"));
    const n = Number(printCount);
    if (!Number.isFinite(n) || n < 0) return toast.error(t("stencilPanel.soLuotInKhongHop", "Số lượt in không hợp lệ"));
    record.mutate({
      stencilToolId: selectedToolId,
      printCount: Math.trunc(n),
      cleanedAt: cleaned ? new Date() : undefined,
      tensionCheckAt: tensionValue.trim() ? new Date() : undefined,
      tensionValue: tensionValue.trim() ? Number(tensionValue) : undefined,
      notes: notes.trim() || undefined,
    });
  };

  const s = status.data;
  const lifePct =
    s && s.lifeLimit != null && s.lifeLimit > 0 ? Math.min(100, Math.round((s.totalPrints / s.lifeLimit) * 100)) : null;
  const usageRows = Array.isArray(usage.data) ? usage.data : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Left: selector + status + usage ledger */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary" /> Khuôn in (stencil)
            </CardTitle>
            <CardDescription>{t("stencil.chonKhuonInTheoId", "Chọn khuôn in theo ID (tool id trong master khuôn/thiết bị)")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={toolIdInput}
                onChange={(e) => setToolIdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSelect()}
                placeholder={t("stencil.idKhuonInVd12", "ID khuôn in, VD: 12")}
                inputMode="numeric"
              />
              <Button onClick={onSelect} variant="secondary">
                <Search className="mr-2 h-4 w-4" /> Xem
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedToolId != null && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" /> Trạng thái tuổi thọ
                  {s && !s.trackingEnabled && (
                    <Badge variant="outline" className="text-xs">{t("stencil.advisoryStencilTrackingEnabledTat", "Advisory (STENCIL_TRACKING_ENABLED tắt)")}</Badge>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    status.refetch();
                    usage.refetch();
                  }}
                  disabled={status.isFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${status.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("stencil.dangTai", "Đang tải…")}</p>
              ) : status.isError ? (
                <p className="py-6 text-center text-sm text-destructive">Lỗi: {mapTrpcError(status.error)}</p>
              ) : s ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{s.code ?? `Tool #${s.stencilToolId}`}</div>
                      <div className="text-sm text-muted-foreground">{s.name ?? "—"}</div>
                    </div>
                    {s.worn ? (
                      <Badge variant="destructive">
                        <AlertTriangle className="mr-1 h-3 w-3" /> Đã mòn
                      </Badge>
                    ) : (
                      <Badge className="bg-green-600 hover:bg-green-600">{t("stencil.conTot", "Còn tốt")}</Badge>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {s.totalPrints.toLocaleString()} / {s.lifeLimit == null ? "∞" : s.lifeLimit.toLocaleString()} lượt in
                      </span>
                      {lifePct != null && <span className="font-medium">{lifePct}%</span>}
                    </div>
                    <Progress
                      value={lifePct ?? 0}
                      className={s.worn ? "[&_[data-slot=progress-indicator]]:bg-destructive" : undefined}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Baseline</div>
                      <div className="font-medium">{s.baselineUsed.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("stencil.daGhiNhan", "Đã ghi nhận")}</div>
                      <div className="font-medium">{s.accruedPrints.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("stencil.conLai", "Còn lại")}</div>
                      <div className="font-medium">{s.remaining == null ? "∞" : s.remaining.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("stencil.veSinhGanNhat", "Vệ sinh gần nhất")}</div>
                      <div className="font-medium">{s.lastCleanedAt ? new Date(s.lastCleanedAt).toLocaleDateString() : "—"}</div>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        )}

        {selectedToolId != null && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("stencil.lichSuSuDungGan", "Lịch sử sử dụng gần đây")}</CardTitle>
            </CardHeader>
            <CardContent>
              {usage.isLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("stencil.dangTai2", "Đang tải…")}</p>
              ) : usageRows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("stencil.chuaCoBanGhiSu", "Chưa có bản ghi sử dụng.")}</p>
              ) : (
                <div className="divide-y">
                  {usageRows.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-medium">+{Number(r.printCount).toLocaleString()} lượt</span>
                      <span className="text-muted-foreground">
                        {r.cleanedAt ? t("stencilPanel.veSinh", "· vệ sinh ") : ""}
                        {r.tensionValue != null ? t("stencil.lucCangGiaTri", { value: r.tensionValue }) : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: record prints form */}
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("stencil.ghiLuotIn", "Ghi lượt in")}</CardTitle>
          <CardDescription>{t("stencil.congDonSoChuKy", "Cộng dồn số chu kỳ in + tuỳ chọn vệ sinh / kiểm tra lực căng")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canWrite && (
            <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
              Bạn chỉ có quyền xem. Cần quyền tạo/sửa "masterdata" để ghi lượt in.
            </p>
          )}
          {selectedToolId == null && (
            <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">{t("stencil.chonKhuonInTruocKhi", "Chọn khuôn in trước khi ghi.")}</p>
          )}
          <div className="space-y-1">
            <Label>{t("stencil.soLuotInThem", "Số lượt in thêm")}</Label>
            <Input
              value={printCount}
              onChange={(e) => setPrintCount(e.target.value)}
              placeholder="VD: 500"
              inputMode="numeric"
              disabled={!canWrite || selectedToolId == null}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cleaned}
              onChange={(e) => setCleaned(e.target.checked)}
              disabled={!canWrite || selectedToolId == null}
            />
            Đã vệ sinh khuôn (ghi mốc thời gian hiện tại)
          </label>
          <div className="space-y-1">
            <Label>{t("stencil.giaTriLucCangTuy", "Giá trị lực căng (tuỳ chọn)")}</Label>
            <Input
              value={tensionValue}
              onChange={(e) => setTensionValue(e.target.value)}
              placeholder="VD: 38 (N/mm)"
              inputMode="decimal"
              disabled={!canWrite || selectedToolId == null}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("stencil.ghiChuTuyChon", "Ghi chú (tuỳ chọn)")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("stencil.ghiChu", "Ghi chú")} disabled={!canWrite || selectedToolId == null} />
          </div>
          <Button onClick={onRecord} disabled={!canWrite || selectedToolId == null || record.isPending} className="w-full">
            Ghi lượt in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
