/**
 * ProductChangeoverWizard — "/product-changeover" (doc 40 Wave 4, persona operator).
 *
 * Trợ lý "Đổi sản phẩm" 4 bước dành cho VẬN HÀNH tại xưởng (tablet, chạm, chữ to,
 * ít bước). Mục tiêu: khi chuyển dây chuyền sang một mã sản phẩm khác, người vận
 * hành đi qua một luồng có kiểm soát — KHÔNG bao giờ tự actuate máy — chỉ:
 *
 *   Bước 1 — Chọn máy + quét/nhập barcode work-order/sản phẩm (BarcodeScanner)
 *            → resolve mã sản phẩm qua productModel.getByCode.
 *   Bước 2 — Xác định chương trình kiểm tra qua product-machine mapping +
 *            điểm sẵn-sàng (productModel.getReadiness). Hiện ĐỎ/XANH rõ ràng.
 *   Bước 3 — Chuỗi feeder-verify: quét từng slot + reel (feederVerify.verifyScan),
 *            hiện khớp/lệch và trạng thái setup (feederVerify.setupStatus).
 *   Bước 4 — Xác nhận, HOẶC gửi yêu-cầu-đổi-recipe cho giám sát (andon.raise,
 *            reason="setup") — chỉ báo hiệu, không ghi lệnh xuống máy.
 *
 * TẤT CẢ dữ liệu là THẬT (honest-null). Nút "Gửi yêu cầu" gọi API andon THẬT.
 * Không có nút no-op. Theme-aware. i18n fallback tiếng Việt.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import BarcodeScanner from "@/components/BarcodeScanner";
// doc 63 DEP-08 — hàng đợi đổi model duyệt 2 người (request operator → approve có 2FA).
import ChangeoverQueue from "@/components/changeover/ChangeoverQueue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  ScanLine,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Package,
  Cpu,
  ClipboardCheck,
  SendHorizonal,
  Home,
  ShieldAlert,
} from "lucide-react";

// ── Bước indicator (chữ to, hợp tablet) ──────────────────────────────────────
function StepDots({ step }: { step: number }) {
  const { t } = useTranslation();
  const labels = [
    t("changeoverWizard.step1.short", "Quét mã"),
    t("changeoverWizard.step2.short", "Chương trình"),
    t("changeoverWizard.step3.short", "Feeder"),
    t("changeoverWizard.step4.short", "Xác nhận"),
  ];
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold",
                done && "bg-success text-success-foreground",
                active && "bg-primary text-primary-foreground ring-4 ring-primary/30",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="h-5 w-5" /> : n}
            </div>
            <span
              className={cn(
                "hidden text-sm font-semibold sm:inline",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {n < 4 && <div className="h-0.5 flex-1 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

type MachineLite = {
  id: number;
  code: string;
  name: string;
  machineType?: string | null;
  registrationStatus?: string | null;
  lifecycleStatus?: string | null;
};

export default function ProductChangeoverWizard() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  const [step, setStep] = useState(1);
  const [machineId, setMachineId] = useState<number | undefined>();
  const [barcode, setBarcode] = useState("");
  const [resolvedCode, setResolvedCode] = useState(""); // code actually looked up
  const [scannerOpen, setScannerOpen] = useState(false);

  // Feeder-verify scan inputs (bước 3)
  const [slotCode, setSlotCode] = useState("");
  const [scannedReel, setScannedReel] = useState("");
  const [feederScannerOpen, setFeederScannerOpen] = useState(false);

  // ── Máy đã duyệt + đang hoạt động (dữ liệu THẬT) ──────────────────────────
  const machinesQuery = trpc.machine.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const machines = useMemo<MachineLite[]>(() => {
    const rows = (machinesQuery.data ?? []) as MachineLite[];
    return rows.filter(
      (m) =>
        (m.registrationStatus ?? "approved") === "approved" &&
        (m.lifecycleStatus ?? "active") !== "retired" &&
        (m.lifecycleStatus ?? "active") !== "decommissioned",
    );
  }, [machinesQuery.data]);
  const selectedMachine = machines.find((m) => m.id === machineId);

  // ── Resolve sản phẩm theo barcode/mã (bước 1 → 2) ─────────────────────────
  const productQuery = trpc.productModel.getByCode.useQuery(
    { code: resolvedCode },
    { enabled: resolvedCode.trim().length > 0, retry: false, refetchOnWindowFocus: false },
  );
  const productModel = productQuery.data?.productModel ?? null;
  const productModelId = productModel?.id;

  // ── Readiness + mapping (bước 2) ──────────────────────────────────────────
  const readinessQuery = trpc.productModel.getReadiness.useQuery(
    { productModelId: productModelId! },
    { enabled: !!productModelId, retry: false, refetchOnWindowFocus: false },
  );
  const mappingQuery = trpc.productMachineMapping.list.useQuery(
    { machineId: machineId!, productModelId: productModelId! },
    { enabled: !!machineId && !!productModelId, retry: false, refetchOnWindowFocus: false },
  );
  const readiness = readinessQuery.data ?? null;
  const mappings = (mappingQuery.data ?? []) as Array<{ id: number; isActive?: boolean | null }>;
  const activeMapping = mappings.find((m) => m.isActive !== false);

  // Chương trình sẵn sàng chạy? XANH = có mapping active + readiness không "blocked".
  const programReady =
    !!activeMapping && (readiness ? readiness.band !== "blocked" : true);

  // ── Feeder-verify (bước 3) ────────────────────────────────────────────────
  const setupStatusQuery = trpc.feederVerify.setupStatus.useQuery(
    { machineId: machineId!, productModelId: productModelId ?? null },
    { enabled: !!machineId && step === 3, retry: false, refetchOnWindowFocus: false, refetchInterval: 5000 },
  );
  const historyQuery = trpc.feederVerify.listForSetup.useQuery(
    { machineId: machineId!, productModelId: productModelId ?? null, limit: 30 },
    { enabled: !!machineId && step === 3, retry: false, refetchOnWindowFocus: false },
  );
  const setupStatus = setupStatusQuery.data ?? null;
  const utils = trpc.useUtils();

  const verifyScan = trpc.feederVerify.verifyScan.useMutation({
    onSuccess: (res) => {
      if (res.verdict === "match") {
        toast.success(t("changeoverWizard.step3.matchToast", "Khớp — slot đã đúng vật tư"));
      } else {
        toast.error(t("changeoverWizard.step3.mismatchToast", "LỆCH — kiểm tra lại reel/slot"));
      }
      setScannedReel("");
      setSlotCode("");
      utils.feederVerify.setupStatus.invalidate();
      utils.feederVerify.listForSetup.invalidate();
    },
    onError: (err) => {
      toast.error(t("changeoverWizard.step3.scanError", "Không ghi được lần quét"), {
        description: mapTrpcError(err),
      });
    },
  });

  // ── Gửi yêu cầu đổi recipe cho giám sát (bước 4) — CHỈ báo hiệu ────────────
  const raiseAndon = trpc.andon.raise.useMutation({
    onSuccess: () => {
      toast.success(
        t("changeoverWizard.step4.requestSentToast", "Đã gửi yêu cầu đổi recipe cho giám sát"),
      );
      navigate("/operator");
    },
    onError: (err) => {
      toast.error(t("changeoverWizard.step4.requestError", "Không gửi được yêu cầu"), {
        description: mapTrpcError(err),
      });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const lookup = (code: string) => {
    const c = code.trim();
    if (!c) return;
    setBarcode(c);
    setResolvedCode(c);
  };

  const canNextFrom1 = !!machineId && !!productModel;
  const canNextFrom2 = programReady;

  const goNext = () => setStep((s) => Math.min(4, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const doVerifyScan = () => {
    if (!machineId || !slotCode.trim()) {
      toast.error(t("changeoverWizard.step3.needSlot", "Nhập/quét mã slot trước"));
      return;
    }
    verifyScan.mutate({
      machineId,
      slotCode: slotCode.trim(),
      scannedReel: scannedReel.trim() || undefined,
      scannedComponentCode: scannedReel.trim() || undefined,
      productModelId: productModelId ?? null,
    });
  };

  const sendRecipeRequest = () => {
    if (!machineId || !productModel) return;
    raiseAndon.mutate({
      state: "call",
      reason: "setup",
      title: t("changeoverWizard.step4.requestTitle", {
        defaultValue: "Yêu cầu đổi recipe: {{product}} trên {{machine}}",
        product: productModel.code,
        machine: selectedMachine?.code ?? String(machineId),
      }),
      message: t("changeoverWizard.step4.requestMsg", {
        defaultValue:
          "Vận hành đã setup xong đổi sang {{product}} ({{name}}). Đề nghị giám sát duyệt/nạp recipe.",
        product: productModel.code,
        name: productModel.name,
      }),
      machineId,
    });
  };

  return (
    <DashboardLayout>
      <PageContainer className="max-w-3xl">
        <PageHeader
          icon={<Package className="h-6 w-6" />}
          title={t("changeoverWizard.title", "Đổi sản phẩm")}
          description={t(
            "changeoverWizard.subtitle",
            "Bốn bước có kiểm soát — hệ thống không tự đổi recipe trên máy",
          )}
        />

        <StepDots step={step} />

        {/* ── BƯỚC 1 — Chọn máy + quét barcode ── */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t("changeoverWizard.step1.title", "1. Chọn máy và quét mã sản phẩm")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-base">
                  {t("changeoverWizard.step1.machineLabel", "Máy / dây chuyền")}
                </Label>
                <Select
                  value={machineId?.toString() ?? ""}
                  onValueChange={(v) => setMachineId(Number(v))}
                >
                  <SelectTrigger className="h-14 text-lg">
                    <SelectValue
                      placeholder={t("changeoverWizard.step1.machinePlaceholder", "Chọn máy…")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()} className="text-base">
                        {m.code} — {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {machinesQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">
                    {t("common.loading", "Đang tải…")}
                  </p>
                )}
                {!machinesQuery.isLoading && machines.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("changeoverWizard.step1.noMachines", "Chưa có máy nào được duyệt")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-base">
                  {t("changeoverWizard.step1.barcodeLabel", "Barcode work-order / mã sản phẩm")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && lookup(barcode)}
                    placeholder={t("changeoverWizard.step1.barcodePlaceholder", "Quét hoặc nhập mã…")}
                    className="h-14 text-lg"
                  />
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="h-14 shrink-0 px-5"
                    onClick={() => setScannerOpen(true)}
                  >
                    <ScanLine className="mr-2 h-5 w-5" />
                    {t("changeoverWizard.step1.scan", "Quét")}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12 w-full text-base"
                  disabled={!barcode.trim()}
                  onClick={() => lookup(barcode)}
                >
                  {t("changeoverWizard.step1.lookup", "Tra cứu sản phẩm")}
                </Button>
              </div>

              {/* Kết quả resolve */}
              {resolvedCode && (
                <div className="rounded-xl border-2 p-4">
                  {productQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {t("changeoverWizard.step1.resolving", "Đang tra cứu…")}
                    </div>
                  ) : productModel ? (
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-8 w-8 shrink-0 text-success" />
                      <div>
                        <p className="text-lg font-bold">{productModel.name}</p>
                        <p className="font-mono text-sm text-muted-foreground">
                          {productModel.code}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-destructive">
                      <XCircle className="h-8 w-8 shrink-0" />
                      <div>
                        <p className="text-lg font-bold">
                          {t("changeoverWizard.step1.notFound", "Không tìm thấy sản phẩm")}
                        </p>
                        <p className="text-sm">
                          {t("changeoverWizard.step1.notFoundHint", {
                            defaultValue: "Mã '{{code}}' chưa được khai báo. Kiểm tra lại.",
                            code: resolvedCode,
                          })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── BƯỚC 2 — Chương trình + Readiness ── */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t("changeoverWizard.step2.title", "2. Chương trình kiểm tra & mức sẵn sàng")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Đèn ĐỎ / XANH lớn */}
              <div
                className={cn(
                  "flex items-center gap-4 rounded-2xl border-2 p-5",
                  programReady
                    ? "border-success/40 bg-success/10"
                    : "border-destructive/40 bg-destructive/10",
                )}
              >
                {programReady ? (
                  <CheckCircle2 className="h-12 w-12 shrink-0 text-success" />
                ) : (
                  <ShieldAlert className="h-12 w-12 shrink-0 text-destructive" />
                )}
                <div>
                  <p className="text-2xl font-bold">
                    {programReady
                      ? t("changeoverWizard.step2.ready", "SẴN SÀNG")
                      : t("changeoverWizard.step2.notReady", "CHƯA SẴN SÀNG")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {activeMapping
                      ? t("changeoverWizard.step2.mapped", {
                          defaultValue: "{{product}} đã được gán cho máy này",
                          product: productModel?.code ?? "",
                        })
                      : t("changeoverWizard.step2.notMapped", {
                          defaultValue: "Sản phẩm chưa được gán chạy trên {{machine}}",
                          machine: selectedMachine?.code ?? "",
                        })}
                  </p>
                </div>
              </div>

              {/* Readiness score + checklist */}
              {readinessQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("changeoverWizard.step2.loadingReadiness", "Đang tính mức sẵn sàng…")}
                </div>
              ) : readiness ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold">
                      {t("changeoverWizard.step2.readinessScore", "Mức cấu hình sản phẩm")}
                    </span>
                    <Badge
                      className={cn(
                        "text-base",
                        readiness.band === "ready" && "bg-success text-success-foreground",
                        readiness.band === "in_progress" && "bg-warning text-warning-foreground",
                        readiness.band === "blocked" && "bg-destructive text-destructive-foreground",
                      )}
                    >
                      {readiness.score}%
                    </Badge>
                  </div>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {readiness.items
                      .filter((it) => it.weight > 0)
                      .map((it) => (
                        <li key={it.key} className="flex items-center gap-2 text-sm">
                          {it.status === "ok" ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          ) : it.status === "na" ? (
                            <span className="h-4 w-4 shrink-0 text-center text-muted-foreground">–</span>
                          ) : (
                            <XCircle
                              className={cn(
                                "h-4 w-4 shrink-0",
                                it.status === "missing" ? "text-destructive" : "text-warning",
                              )}
                            />
                          )}
                          <span className="text-muted-foreground">{it.detail}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("changeoverWizard.step2.noReadiness", "Chưa có dữ liệu sẵn sàng")}
                </p>
              )}

              {!programReady && (
                <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                  {t(
                    "changeoverWizard.step2.blockedHint",
                    "Sản phẩm chưa gán cho máy hoặc chưa đủ cấu hình. Bạn vẫn có thể gửi yêu cầu cho giám sát ở bước cuối.",
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── BƯỚC 3 — Feeder verify ── */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t("changeoverWizard.step3.title", "3. Kiểm tra feeder (quét slot + reel)")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Trạng thái setup */}
              {setupStatus && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-2xl font-bold">{setupStatus.loadedSlotCount}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("changeoverWizard.step3.loaded", "Slot đã nạp")}
                    </p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-2xl font-bold text-success">{setupStatus.matchedSlotCount}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("changeoverWizard.step3.matched", "Đã khớp")}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-center",
                      setupStatus.hasMismatch && "border-destructive/50 bg-destructive/10",
                    )}
                  >
                    <p
                      className={cn(
                        "text-2xl font-bold",
                        setupStatus.hasMismatch ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {setupStatus.hasMismatch ? "!" : "0"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("changeoverWizard.step3.mismatch", "Lệch")}
                    </p>
                  </div>
                </div>
              )}

              {/* Nhập/quét slot + reel */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-base">
                    {t("changeoverWizard.step3.slotLabel", "Mã slot")}
                  </Label>
                  <Input
                    value={slotCode}
                    onChange={(e) => setSlotCode(e.target.value)}
                    placeholder={t("changeoverWizard.step3.slotPlaceholder", "VD: F01")}
                    className="h-14 text-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base">
                    {t("changeoverWizard.step3.reelLabel", "Reel / mã linh kiện")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={scannedReel}
                      onChange={(e) => setScannedReel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doVerifyScan()}
                      placeholder={t("changeoverWizard.step3.reelPlaceholder", "Quét mã reel…")}
                      className="h-14 text-lg"
                    />
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      className="h-14 shrink-0 px-4"
                      onClick={() => setFeederScannerOpen(true)}
                    >
                      <ScanLine className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                size="lg"
                className="h-14 w-full text-lg"
                disabled={!slotCode.trim() || verifyScan.isPending}
                onClick={doVerifyScan}
              >
                {verifyScan.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <ClipboardCheck className="mr-2 h-5 w-5" />
                )}
                {t("changeoverWizard.step3.verify", "Kiểm tra slot này")}
              </Button>

              {/* Lịch sử quét gần đây */}
              {(historyQuery.data ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-muted-foreground">
                    {t("changeoverWizard.step3.recent", "Lần quét gần đây")}
                  </p>
                  <ul className="divide-y rounded-lg border">
                    {(historyQuery.data as Array<any>).slice(0, 8).map((r) => (
                      <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="font-mono">
                          {r.slotCode ?? "—"}
                          {r.scannedComponentCode ? ` · ${r.scannedComponentCode}` : ""}
                        </span>
                        {r.verdict === "match" ? (
                          <Badge className="bg-success text-success-foreground">
                            {t("changeoverWizard.step3.ok", "Khớp")}
                          </Badge>
                        ) : (
                          <Badge className="bg-destructive text-destructive-foreground">
                            {t("changeoverWizard.step3.ng", "Lệch")}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {setupStatus?.enforced === false && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "changeoverWizard.step3.advisoryNote",
                    "Kiểm tra feeder đang ở chế độ khuyến nghị (không chặn chạy máy).",
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── BƯỚC 4 — Xác nhận / gửi yêu cầu ── */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t("changeoverWizard.step4.title", "4. Xác nhận đổi sản phẩm")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="space-y-2 rounded-xl border p-4 text-base">
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Cpu className="h-4 w-4" /> {t("changeoverWizard.step4.machine", "Máy")}
                  </dt>
                  <dd className="font-semibold">
                    {selectedMachine ? `${selectedMachine.code} — ${selectedMachine.name}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Package className="h-4 w-4" /> {t("changeoverWizard.step4.product", "Sản phẩm")}
                  </dt>
                  <dd className="font-semibold">
                    {productModel ? `${productModel.code} — ${productModel.name}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <ClipboardCheck className="h-4 w-4" />
                    {t("changeoverWizard.step4.feeder", "Feeder")}
                  </dt>
                  <dd className="font-semibold">
                    {setupStatus
                      ? t("changeoverWizard.step4.feederSummary", {
                          defaultValue: "{{matched}}/{{loaded}} khớp",
                          matched: setupStatus.matchedSlotCount,
                          loaded: setupStatus.loadedSlotCount,
                        })
                      : "—"}
                  </dd>
                </div>
              </dl>

              {setupStatus?.hasMismatch && (
                <div className="flex items-center gap-3 rounded-xl border-2 border-destructive/40 bg-destructive/10 p-4 text-destructive">
                  <ShieldAlert className="h-6 w-6 shrink-0" />
                  <p className="text-sm font-medium">
                    {t(
                      "changeoverWizard.step4.mismatchWarn",
                      "Còn slot LỆCH ở bước feeder. Nên xử lý trước khi chạy.",
                    )}
                  </p>
                </div>
              )}

              <div className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                {t(
                  "changeoverWizard.step4.actuateNote",
                  "Hệ thống KHÔNG tự nạp recipe xuống máy. Gửi yêu cầu để giám sát duyệt và nạp chương trình.",
                )}
              </div>

              <Button
                type="button"
                size="lg"
                className="h-16 w-full text-lg"
                disabled={raiseAndon.isPending || !machineId || !productModel}
                onClick={sendRecipeRequest}
              >
                {raiseAndon.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <SendHorizonal className="mr-2 h-5 w-5" />
                )}
                {t("changeoverWizard.step4.sendRequest", "Gửi yêu cầu đổi recipe cho giám sát")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-14 w-full text-base"
                onClick={() => navigate("/operator")}
              >
                <Home className="mr-2 h-5 w-5" />
                {t("changeoverWizard.step4.finish", "Hoàn tất & về màn hình vận hành")}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Điều hướng bước (Trước / Tiếp) ── */}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="h-14 px-6 text-base"
            disabled={step === 1}
            onClick={goBack}
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            {t("changeoverWizard.back", "Trước")}
          </Button>
          {step < 4 && (
            <Button
              type="button"
              size="lg"
              className="h-14 px-8 text-lg"
              disabled={(step === 1 && !canNextFrom1) || (step === 2 && !canNextFrom2)}
              onClick={goNext}
            >
              {t("changeoverWizard.next", "Tiếp")}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          )}
        </div>

        {/* doc 63 DEP-08 — yêu cầu & phê duyệt đổi model cho máy đang chọn */}
        <div className="mt-4">
          <ChangeoverQueue machineId={machineId} />
        </div>
      </PageContainer>

      {/* Scanner cho barcode sản phẩm (bước 1) */}
      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(code) => lookup(code)}
      />
      {/* Scanner cho reel feeder (bước 3) */}
      <BarcodeScanner
        open={feederScannerOpen}
        onOpenChange={setFeederScannerOpen}
        onScan={(code) => {
          setScannedReel(code);
          setFeederScannerOpen(false);
        }}
      />
    </DashboardLayout>
  );
}
