/**
 * MSD Floor-Life panel — doc 35 W4-C.2 (J-STD-020).
 *
 * Surfaces the previously UI-less `trpc.msd.*` router:
 *  - listActive     → live open exposures with RAG status + remaining floor-life
 *  - expiringSoon   → warning/expired highlight strip
 *  - mslTable       → MSL level → allowed floor-life (hours) reference
 *  - openExposure / startBake / closeExposure → write actions (permission-gated)
 *
 * ADVISORY only (no hard enforcement). Rendered inside the Line-Materials tabs on
 * the Feeder-Verify page. Write actions are gated by usePermissions("masterdata").
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Clock, Flame, PackageOpen, RefreshCw, ShieldCheck, Thermometer } from "lucide-react";

type MsdStatus = "ok" | "warning" | "expired" | "baking";
const MSL_LEVELS = ["1", "2", "2a", "3", "4", "5", "5a", "6"] as const;
type MslLevel = (typeof MSL_LEVELS)[number];

function StatusBadge({ status }: { status: MsdStatus | string }) {
  switch (status) {
    case "ok":
      return (
        <Badge className="bg-green-600 hover:bg-green-600">
          <ShieldCheck className="mr-1 h-3 w-3" /> OK
        </Badge>
      );
    case "warning":
      return (
        <Badge className="bg-amber-500 hover:bg-amber-500">
          <AlertTriangle className="mr-1 h-3 w-3" /> Sắp hết
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="destructive">
          <Clock className="mr-1 h-3 w-3" /> Hết hạn
        </Badge>
      );
    case "baking":
      return (
        <Badge className="bg-blue-600 hover:bg-blue-600">
          <Flame className="mr-1 h-3 w-3" /> Đang sấy
        </Badge>
      );
    default:
      return <Badge variant="secondary">{String(status)}</Badge>;
  }
}

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "∞";
  if (h < 1) return `${Math.round(h * 60)} phút`;
  if (h < 48) return `${h.toFixed(1)} giờ`;
  return `${(h / 24).toFixed(1)} ngày`;
}

export default function MsdPanel() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("masterdata", "canCreate") || hasPermission("masterdata", "canEdit");

  const active = trpc.msd.listActive.useQuery(undefined, { staleTime: 15_000, refetchInterval: 60_000 });
  const expiring = trpc.msd.expiringSoon.useQuery(undefined, { staleTime: 15_000, refetchInterval: 60_000 });
  const mslTable = trpc.msd.mslTable.useQuery(undefined, { staleTime: 300_000 });

  const [componentCode, setComponentCode] = useState("");
  const [reelId, setReelId] = useState("");
  const [mslLevel, setMslLevel] = useState<MslLevel>("3");
  const [notes, setNotes] = useState("");

  const refetchAll = () => {
    active.refetch();
    expiring.refetch();
  };

  const openExposure = trpc.msd.openExposure.useMutation({
    onSuccess: () => {
      toast.success(`Đã mở đồng hồ floor-life cho ${componentCode || "linh kiện"}`);
      setComponentCode("");
      setReelId("");
      setNotes("");
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const startBake = trpc.msd.startBake.useMutation({
    onSuccess: () => {
      toast.success("Đã bắt đầu sấy (bake)");
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const closeExposure = trpc.msd.closeExposure.useMutation({
    onSuccess: () => {
      toast.success("Đã trả về kho khô (đóng exposure)");
      refetchAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const onOpen = () => {
    if (!componentCode.trim()) return toast.error("Nhập mã linh kiện");
    openExposure.mutate({
      componentCode: componentCode.trim(),
      reelId: reelId.trim() || undefined,
      mslLevel,
      notes: notes.trim() || undefined,
    });
  };

  const rows = Array.isArray(active.data) ? active.data : [];
  const expiringRows = Array.isArray(expiring.data) ? expiring.data : [];
  const busy = openExposure.isPending || startBake.isPending || closeExposure.isPending;

  const mslEntries = useMemo(() => {
    const t = mslTable.data?.table as Record<string, number | null> | undefined;
    if (!t) return [];
    return MSL_LEVELS.map((lvl) => ({ level: lvl, hours: t[lvl] ?? null }));
  }, [mslTable.data]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Left: active list + expiring highlight */}
      <div className="space-y-4">
        {/* Expiring-soon highlight */}
        {expiringRows.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" /> Sắp hết / đã hết floor-life ({expiringRows.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {expiringRows.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono">{r.componentCode}</span>
                  <span className="text-muted-foreground">MSL {r.mslLevel}</span>
                  <span className="text-muted-foreground">còn {fmtHours(r.remainingHours)}</span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-primary" /> Exposure đang mở
                {mslTable.data && !mslTable.data.trackingEnabled && (
                  <Badge variant="outline" className="text-xs">Advisory (MSD_TRACKING_ENABLED tắt)</Badge>
                )}
              </span>
              <Button variant="ghost" size="sm" onClick={refetchAll} disabled={active.isFetching}>
                <RefreshCw className={`h-4 w-4 ${active.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </CardTitle>
            <CardDescription>Đồng hồ floor-life theo J-STD-020 cho các reel đã lấy ra khỏi kho khô</CardDescription>
          </CardHeader>
          <CardContent>
            {active.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
            ) : active.isError ? (
              <p className="py-6 text-center text-sm text-destructive">Lỗi tải dữ liệu: {active.error?.message}</p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có exposure nào đang mở.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Linh kiện</th>
                      <th className="py-2 pr-3 font-medium">Reel</th>
                      <th className="py-2 pr-3 font-medium">MSL</th>
                      <th className="py-2 pr-3 font-medium">Đã phơi</th>
                      <th className="py-2 pr-3 font-medium">Còn lại</th>
                      <th className="py-2 pr-3 font-medium">Trạng thái</th>
                      <th className="py-2 pr-0 font-medium text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-mono">{r.componentCode}</td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">{r.reelId ?? "—"}</td>
                        <td className="py-2 pr-3">{r.mslLevel}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{fmtHours(r.exposedHours)}</td>
                        <td className="py-2 pr-3">{fmtHours(r.remainingHours)}</td>
                        <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                        <td className="py-2 pr-0">
                          <div className="flex justify-end gap-1">
                            {canWrite && r.status !== "baking" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={busy}
                                onClick={() => startBake.mutate({ id: r.id })}
                              >
                                <Flame className="mr-1 h-3 w-3" /> Sấy
                              </Button>
                            )}
                            {canWrite && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={busy}
                                onClick={() => closeExposure.mutate({ id: r.id })}
                              >
                                Đóng
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MSL reference table */}
        {mslEntries.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tham chiếu MSL → floor-life (J-STD-020)</CardTitle>
              <CardDescription>Số giờ floor-life cho phép ở ≤30°C / 60%RH</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {mslEntries.map((e) => (
                  <div key={e.level} className="rounded border px-3 py-1.5 text-sm">
                    <span className="font-medium">MSL {e.level}</span>
                    <span className="ml-2 text-muted-foreground">{e.hours == null ? "không giới hạn" : fmtHours(e.hours)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: open exposure form */}
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageOpen className="h-4 w-4 text-primary" /> Mở exposure
          </CardTitle>
          <CardDescription>Bắt đầu đồng hồ floor-life khi lấy reel ra khỏi kho khô</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canWrite && (
            <p className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
              Bạn chỉ có quyền xem. Cần quyền tạo/sửa "masterdata" để mở exposure.
            </p>
          )}
          <div className="space-y-1">
            <Label>Mã linh kiện</Label>
            <Input value={componentCode} onChange={(e) => setComponentCode(e.target.value)} placeholder="VD: C0402-104" disabled={!canWrite} />
          </div>
          <div className="space-y-1">
            <Label>Mã reel (tuỳ chọn)</Label>
            <Input value={reelId} onChange={(e) => setReelId(e.target.value)} placeholder="Quét/nhập mã reel" disabled={!canWrite} />
          </div>
          <div className="space-y-1">
            <Label>Cấp MSL</Label>
            <Select value={mslLevel} onValueChange={(v) => setMslLevel(v as MslLevel)} disabled={!canWrite}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MSL_LEVELS.map((lvl) => (
                  <SelectItem key={lvl} value={lvl}>
                    MSL {lvl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ghi chú (tuỳ chọn)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú" disabled={!canWrite} />
          </div>
          <Button onClick={onOpen} disabled={!canWrite || busy} className="w-full">
            <PackageOpen className="mr-2 h-4 w-4" /> Mở exposure
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
