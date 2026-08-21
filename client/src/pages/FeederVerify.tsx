/**
 * Line Materials hub — doc 35 W4-C (Feeder-Verify / MSD / Stencil).
 *
 * Full-width tabbed page covering all "vật tư tại line" backends:
 *   1. Feeder Verify — pick a machine, scan (slot + reel) before a run; the server
 *      resolves the EXPECTED component for that slot and records a match/mismatch.
 *      Enforcement (block run on mismatch) is gated server-side by
 *      FEEDER_VERIFY_ENFORCED (default OFF); recording works regardless.
 *   2. MSD Floor-Life — J-STD-020 floor-life clock (trpc.msd.*), advisory.
 *   3. Stencil — cycle counter vs life-limit (trpc.stencil.*), advisory.
 *
 * NAV WIRING: route /feeder-verify + nav entry handled by the wave-lead (not this
 * file). The nav LABEL should now read "Vật tư tại line (Feeder/MSD/Stencil)".
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { ScanLine, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Thermometer, Layers } from "lucide-react";
import MsdPanel from "@/components/materials/MsdPanel";
import StencilPanel from "@/components/materials/StencilPanel";

/** Tab 1 — existing feeder-setup scan verification (behavior unchanged). */
function FeederVerifyTab() {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState<number | null>(null);
  const [slotCode, setSlotCode] = useState("");
  const [scannedReel, setScannedReel] = useState("");

  const machinesQuery = trpc.machine.list.useQuery(undefined, { staleTime: 60_000 });
  const machines: Array<{ id: number; code: string; name: string }> = useMemo(
    () => (Array.isArray(machinesQuery.data) ? (machinesQuery.data as any[]) : []),
    [machinesQuery.data],
  );

  const setupStatus = trpc.feederVerify.setupStatus.useQuery(
    { machineId: machineId ?? 0 },
    { enabled: machineId != null },
  );
  const recent = trpc.feederVerify.listForSetup.useQuery(
    { machineId: machineId ?? 0, limit: 25 },
    { enabled: machineId != null },
  );

  const verify = trpc.feederVerify.verifyScan.useMutation({
    onSuccess: (res) => {
      if (res.verdict === "match") toast.success(t("feederVerify.khopSlot", { slot: slotCode || "?", code: res.expectedComponentCode ?? "?" }));
      else
        toast.error(
          t("feederVerify.lechSlot", { slot: slotCode || "?", expected: res.expectedComponentCode ?? "?", scanned: res.scannedComponentCode || "?" }),
        );
      setScannedReel("");
      setupStatus.refetch();
      recent.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });

  const onVerify = () => {
    if (machineId == null) return toast.error(t("feederVerify.chonMayTruoc", "Chọn máy trước"));
    if (!scannedReel.trim()) return toast.error(t("feederVerify.quetNhapMaReel", "Quét/nhập mã reel"));
    verify.mutate({ machineId, slotCode: slotCode.trim() || undefined, scannedReel: scannedReel.trim() });
  };

  const status = setupStatus.data;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
          {/* Scan panel */}
          <Card>
            <CardHeader>
              <CardTitle>{t("feederVerify.quetKiemTra", "Quét kiểm tra")}</CardTitle>
              <CardDescription>{t("feederVerify.chonMayNhapSlotVa", "Chọn máy, nhập slot và quét reel")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t("feederVerify.may", "Máy")}</Label>
                <Select
                  value={machineId != null ? String(machineId) : undefined}
                  onValueChange={(v) => setMachineId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("feederVerify.chonMay", "Chọn máy…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.code} — {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("feederVerify.slotViTriFeeder", "Slot / vị trí feeder")}</Label>
                <Input value={slotCode} onChange={(e) => setSlotCode(e.target.value)} placeholder="VD: F01" />
              </div>
              <div className="space-y-1">
                <Label>{t("feederVerify.maReelQuetBarcode", "Mã reel (quét barcode)")}</Label>
                <Input
                  value={scannedReel}
                  onChange={(e) => setScannedReel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onVerify()}
                  placeholder={t("feederVerify.quetHoacNhapMaReel", "Quét hoặc nhập mã reel/linh kiện")}
                  autoFocus
                />
              </div>
              <Button onClick={onVerify} disabled={verify.isPending || machineId == null} className="w-full">
                <ScanLine className="mr-2 h-4 w-4" /> Kiểm tra
              </Button>
            </CardContent>
          </Card>

          {/* Status panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{t("feederVerify.trangThaiSetup", "Trạng thái setup")}</span>
                <Button variant="ghost" size="sm" onClick={() => setupStatus.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>
                {status?.enforced ? t("feederVerify.cheDoChanChayKhi", "Chế độ CHẶN chạy khi có lệch (FEEDER_VERIFY_ENFORCED bật)") : t("feederVerify.cheDoCanhBaoKhong", "Chế độ cảnh báo (không chặn)")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {machineId == null ? (
                <p className="text-sm text-muted-foreground">{t("feederVerify.chonMayDeXemTrang", "Chọn máy để xem trạng thái.")}</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    {status?.complete ? (
                      <Badge className="bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />{t("feederVerify.hoanTat", "Hoàn tất")}</Badge>
                    ) : (
                      <Badge variant="secondary"><AlertTriangle className="mr-1 h-3 w-3" />{t("feederVerify.chuaHoanTat", "Chưa hoàn tất")}</Badge>
                    )}
                    {status?.hasMismatch && (
                      <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />{t("feederVerify.coLech", "Có lệch")}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Slot đã nạp: {status?.loadedSlotCount ?? 0} · đã kiểm: {status?.verifiedSlotCount ?? 0} · khớp:{" "}
                    {status?.matchedSlotCount ?? 0}
                  </div>
                  <div className="divide-y rounded border">
                    {(status?.slots ?? []).map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="font-mono">{s.slotCode ?? "—"}</span>
                        <span className="text-muted-foreground">
                          {s.expectedComponentCode ?? "?"} vs {s.scannedComponentCode ?? "?"}
                        </span>
                        {s.latestVerdict === "match" ? (
                          <Badge className="bg-green-600">match</Badge>
                        ) : (
                          <Badge variant="destructive">mismatch</Badge>
                        )}
                      </div>
                    ))}
                    {(status?.slots?.length ?? 0) === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">{t("feederVerify.chuaCoLuotKiemNao", "Chưa có lượt kiểm nào.")}</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent checks */}
        {machineId != null && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t("feederVerify.lichSuKiemTraGan", "Lịch sử kiểm tra gần đây")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {(recent.data ?? []).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono">{r.slotCode ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {r.expectedComponentCode ?? "?"} → {r.scannedComponentCode ?? "?"}
                    </span>
                    {r.verdict === "match" ? (
                      <Badge className="bg-green-600">match</Badge>
                    ) : (
                      <Badge variant="destructive">mismatch</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {r.verifiedAt ? new Date(r.verifiedAt).toLocaleString() : ""}
                    </span>
                  </div>
                ))}
                {(recent.data?.length ?? 0) === 0 && (
                  <div className="py-2 text-sm text-muted-foreground">{t("feederVerify.chuaCoDuLieu", "Chưa có dữ liệu.")}</div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
    </>
  );
}

export default function FeederVerify() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("feeder");

  return (
    <DashboardLayout>
      <PageContainer fluid>
        <PageHeader
          title={t("feederVerify.vatTuTaiLine", "Vật tư tại line")}
          description={t("feederVerify.kiemTraNapFeederDong", "Kiểm tra nạp Feeder · đồng hồ floor-life MSD (J-STD-020) · đếm chu kỳ khuôn in Stencil (doc 35 W4-C)")}
          icon={<ScanLine className="h-6 w-6 text-primary" />}
        />

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="feeder" className="gap-2">
              <ScanLine className="h-4 w-4" /> Kiểm tra Feeder
            </TabsTrigger>
            <TabsTrigger value="msd" className="gap-2">
              <Thermometer className="h-4 w-4" /> MSD Floor-Life
            </TabsTrigger>
            <TabsTrigger value="stencil" className="gap-2">
              <Layers className="h-4 w-4" /> Khuôn in Stencil
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feeder">
            <FeederVerifyTab />
          </TabsContent>
          <TabsContent value="msd">
            <MsdPanel />
          </TabsContent>
          <TabsContent value="stencil">
            <StencilPanel />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
