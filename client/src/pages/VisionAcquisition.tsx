/**
 * Doc 81 Đợt 3 Task 2 (doc 81 §11 "Đã chốt" 2026-10-05) — VISION › THU ẢNH: trang riêng cho worker thu ảnh.
 *
 * Trước đây là tab `?tab=acquisition` (W8-C, doc 27 V14) của Equipment Integration. Integration bỏ tab đó;
 * `/equipment-integration?tab=acquisition` chuyển hướng (REPLACE) sang đây, giữ nguyên văn mọi tham số khác (vd
 * `?flyout=acq-start`) — xem `lib/engineeringLegacyRedirects.tsx`.
 *
 * CỔNG — [QĐ-3c] giữ ĐÚNG cổng cũ, KHÔNG thêm `MOD_AI` dù trang nằm trong khu Vision:
 *  - xem: quyền `machine_alerts/canView` (mục điều hướng + RouteGuard `navHref`, cùng quyền router visionAdapter);
 *  - khởi động / dừng: `machine_alerts/canCreate` (nút ẩn khi thiếu, như cũ);
 *  - cờ `LIVE_ACQUISITION_ENABLED` của server chặn KHỞI ĐỘNG (server từ chối, lý do hiện nguyên văn); trạng thái vẫn đọc
 *    được khi cờ tắt — chip trạng thái cờ 4 nhánh ở header;
 *  - giấy phép: route thuộc `MOD_OT_CONTROL` như `/equipment-integration` (shared/module-registry.ts); mục điều hướng
 *    khai `licenseModule` nên nhóm AI (MOD_AI) không ẩn nó.
 *
 * Bố cục P4 Cockpit (`CockpitLayout`, không tab): header một hàng (h1 · chip trạng thái cờ · "Khi nào dùng" · "Về nguồn
 * thu" · `StatusChipStrip` — chip "Worker lỗi" GHIM, R-2-p) · MAIN = một hàng công cụ (làm mới · Khởi động worker) +
 * bảng worker. Panel worker chỉ có MỘT instance cho cả vòng đời trang: đổi cỡ qua 1024 px, mở/đóng sheet, đổi query
 * KHÔNG unmount nó (Review Focus 3). Poll 5 s CHỈ khi trang đang hiển thị (`usePollingInterval`: tab trình duyệt ẩn ⇒
 * dừng; hiện lại ⇒ làm mới ngay) — khuôn "chỉ poll khi nhìn thấy" của Đợt 2 Task 7.
 *
 * Thao tác (R-2-n — y hệt màn cũ): khởi động = sheet `?flyout=acq-start`, MỘT lượt `startAcquisitionWorker` với cùng
 * payload và kiểm tra bắt buộc; dừng = MỘT cú bấm trên hàng worker đang chạy ⇒ `stopAcquisitionWorker {id}`. Cả hai
 * làm mới `acquisitionWorkerStatus`. Không thao tác hàng loạt.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import DashboardLayout from "@/components/DashboardLayout";
import {
  CockpitLayout,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeStack,
  PageContainer,
  StatusBadge,
  StatusChipStrip,
  chipStateFromQuery,
  useFlyout,
  useCloseOwnLayer,
  type FlyoutDefinition,
  type StatusChipItem,
} from "@/components/patterns";
import { deriveFeatureStatus } from "@/components/common/FeatureStatusGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Loader2, Lock, Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type AcqStatus = RouterOutputs["visionAdapter"]["acquisitionWorkerStatus"];
type AcqWorker = AcqStatus["workers"][number];
type StartWorkerInput = {
  id: string;
  source: { kind: "file"; directory?: string; loop?: boolean } | { kind: "mock"; width?: number; height?: number; maxFrames?: number };
  machineCode?: string;
  intervalMs?: number;
  maxFrames?: number;
  submit?: boolean;
  assessQuality?: boolean;
};

const ACQ_STATE_TONE: Record<string, "success" | "warning" | "error" | "default" | "info"> = {
  running: "success",
  completed: "info",
  stopped: "default",
  error: "error",
};

/** Worker "có lỗi": trạng thái Lỗi hoặc đã đếm lỗi frame — cùng tín hiệu màu đỏ của cột Lỗi / dòng lỗi gần nhất. */
function hasError(w: Pick<AcqWorker, "state" | "errors">): boolean {
  return w.state === "error" || w.errors > 0;
}

type TFn = (key: string, fallback: string) => string;

/**
 * Dải chip header. "Worker lỗi" là số CẢNH BÁO ⇒ GHIM (R-2-p: không bao giờ vào "+N"), tông đỏ khi > 0.
 * Chưa có dữ liệu ⇒ value undefined (chip tự in "Đang tải"/"Lỗi", không in 0).
 */
export function buildAcquisitionChips(
  t: TFn,
  status: { workers: readonly Pick<AcqWorker, "state" | "errors">[] } | undefined,
  state: StatusChipItem["state"],
): StatusChipItem[] {
  const workers = status?.workers ?? [];
  const errorCount = workers.filter(hasError).length;
  return [
    {
      id: "workers-error",
      label: t("visionAcq.chip.errors", "Workers with errors"),
      value: status ? errorCount : undefined,
      state,
      tone: errorCount > 0 ? "error" : "default",
      pinned: true,
      source: t("visionAcq.chip.srcErrors", "Server worker registry (acquisitionWorkerStatus) — state Error or frame errors above 0"),
    },
    {
      id: "workers-running",
      label: t("visionAcq.chip.running", "Running"),
      value: status ? `${workers.filter((w) => w.state === "running").length}/${workers.length}` : undefined,
      state,
      tone: "success",
      source: t("visionAcq.chip.srcRunning", "Running workers over all workers registered in this server session (acquisitionWorkerStatus)"),
    },
  ];
}

export default function VisionAcquisition() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  // RBAC = router visionAdapter (không đổi): machine_alerts/canView để đọc, canCreate để khởi động/dừng.
  const canViewAcq = hasPermission("machine_alerts", "canView");
  const canControlAcq = hasPermission("machine_alerts", "canCreate");
  const utils = trpc.useUtils();

  // Poll 5 s chỉ khi trang đang hiển thị (tab trình duyệt ẩn ⇒ dừng; hiện lại ⇒ làm mới ngay).
  const polling = usePollingInterval(canViewAcq ? 5_000 : false);
  const statusQ = trpc.visionAdapter.acquisitionWorkerStatus.useQuery(undefined, {
    enabled: canViewAcq,
    retry: false,
    ...polling,
  });
  const sourcesQ = trpc.visionAdapter.listAcquisitionSources.useQuery(undefined, {
    enabled: canViewAcq,
    retry: false,
    staleTime: 60_000,
  });

  const refreshAcq = () => void utils.visionAdapter.acquisitionWorkerStatus.invalidate();

  const startAcqM = trpc.visionAdapter.startAcquisitionWorker.useMutation({
    onSuccess: () => {
      toast.success(t("visionAcq.started", "Acquisition worker started"));
      refreshAcq();
    },
    // PRECONDITION_FAILED mang lý do từ chối trung thực của server (cờ tắt, trùng id, cấu hình tắt, nguồn không mở
    // được) — hiện nguyên văn.
    onError: (e) => toastTrpcError(e),
  });
  const stopM = trpc.visionAdapter.stopAcquisitionWorker.useMutation({
    onSuccess: () => {
      toast.success(t("visionAcq.stopped", "Acquisition worker stopped"));
      refreshAcq();
    },
    onError: (e) => toastTrpcError(e),
  });

  const status = statusQ.data as AcqStatus | undefined;
  const workers = status?.workers ?? [];
  const liveStatus = deriveFeatureStatus(statusQ, (d: AcqStatus) => d.liveEnabled);

  const flyouts: Record<string, FlyoutDefinition> = {};
  if (canViewAcq && canControlAcq) {
    flyouts["acq-start"] = {
      size: "md",
      title: t("visionAcq.startTitle", "Start acquisition worker"),
      description: t(
        "visionAcq.startHint",
        "File source replays a capture folder; mock generates synthetic frames. Submission stamps NTF ('needs inspection') — acquisition is not judgement.",
      ),
      render: () => (
        <StartAcquisitionWorkerForm pending={startAcqM.isPending} onSubmit={(cfg, done) => startAcqM.mutate(cfg, { onSuccess: done })} />
      ),
    };
  }

  const chipItems = canViewAcq ? buildAcquisitionChips((k, f) => t(k, f), status, chipStateFromQuery(statusQ)) : [];

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        <PageContainer className="space-y-0">
          <CockpitLayout
            icon={<Camera />}
            title={t("visionAcq.title", "Image acquisition")}
            notices={
              canViewAcq ? (
                <>
                  {/* Cờ thu ảnh trực tiếp của server — 4 trạng thái trung thực (đang kiểm tra / lỗi / tắt / bật). */}
                  <FeatureStatusNoticeChip
                    status={liveStatus}
                    subject={t("visionAcq.liveSubject", "Live acquisition")}
                    offMessage={t(
                      "visionAcq.flagOff",
                      "Live acquisition is turned off on the server. Status stays readable; starting a worker will be refused until an administrator turns it on.",
                    )}
                    errorMessage={t("visionAcq.flagError", "Could not read the worker status, so whether live acquisition is on is unknown.")}
                  />
                  <NoticeStack
                    items={[
                      {
                        id: "whenToUse:visionAcq.whenToUse",
                        kind: "whenToUse",
                        content: (
                          <p data-when-to-use="visionAcq.whenToUse">
                            {t(
                              "visionAcq.whenToUse",
                              "When to use — start, watch and stop image-acquisition workers (file replay / mock frames) that feed the inspection ingest path.",
                            )}
                          </p>
                        ),
                      },
                      {
                        id: "about-sources",
                        kind: "hint",
                        label: t("visionAcq.aboutChip", "About sources"),
                        content: (
                          <p>
                            {t(
                              "visionAcq.desc",
                              "Grab → quality metrics → optional NTF submit through the same canonical ingest path. File/mock sources are real today; GenICam stays a stub until a camera driver is bound.",
                            )}
                          </p>
                        ),
                      },
                    ]}
                  />
                </>
              ) : undefined
            }
            chips={chipItems.length ? <StatusChipStrip items={chipItems} /> : undefined}
            toolbar={canViewAcq ? <AcquisitionToolbar canControl={canControlAcq} onRefresh={refreshAcq} /> : undefined}
            main={
              <AcquisitionWorkersPanel
                canView={canViewAcq}
                canControl={canControlAcq}
                loading={statusQ.isLoading}
                workers={workers}
                sources={sourcesQ.data?.sources}
                stopPending={stopM.isPending}
                onStop={(id) => stopM.mutate({ id })}
              />
            }
            mainName="vision-acquisition"
          />
        </PageContainer>
      </FlyoutHost>
    </DashboardLayout>
  );
}

function AcquisitionToolbar({ canControl, onRefresh }: { canControl: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  return (
    <>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRefresh} title={t("common.refresh", "Refresh")} aria-label={t("common.refresh", "Refresh")}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      {canControl && (
        <Button size="sm" variant="outline" className="h-8" onClick={() => flyout.open("acq-start")}>
          <Play className="mr-1 h-4 w-4" />
          {t("visionAcq.start", "Start worker")}
        </Button>
      )}
    </>
  );
}

function AcquisitionWorkersPanel({
  canView, canControl, loading, workers, sources, stopPending, onStop,
}: {
  canView: boolean;
  canControl: boolean;
  loading: boolean;
  workers: AcqWorker[];
  sources: { kind: string; available: boolean; description?: string }[] | undefined;
  stopPending: boolean;
  onStop: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (!canView) {
    return (
      <div data-acq-panel="" className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        {t("visionAcq.noPermission", "Viewing acquisition workers requires the machine-alerts view permission.")}
      </div>
    );
  }

  return (
    <div data-acq-panel="" className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("visionAcq.col.id", "Worker")}</TableHead>
            <TableHead>{t("visionAcq.col.status", "Status")}</TableHead>
            <TableHead>{t("visionAcq.col.source", "Source")}</TableHead>
            <TableHead className="text-right">{t("visionAcq.col.frames", "Frames")}</TableHead>
            <TableHead className="text-right">{t("visionAcq.col.submitted", "Submitted")}</TableHead>
            <TableHead className="text-right">{t("visionAcq.col.errors", "Errors")}</TableHead>
            <TableHead>{t("visionAcq.col.last", "Last frame / error")}</TableHead>
            {canControl && <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={canControl ? 8 : 7} className="py-8 text-center text-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </TableCell>
            </TableRow>
          )}
          {!loading && workers.length === 0 && (
            <TableRow>
              <TableCell colSpan={canControl ? 8 : 7} className="py-8 text-center text-muted-foreground">
                {t("visionAcq.empty", "No acquisition workers registered in this server session.")}
              </TableCell>
            </TableRow>
          )}
          {workers.map((w) => {
            const lastEntry = w.ledger.length > 0 ? w.ledger[w.ledger.length - 1] : null;
            return (
              <TableRow key={w.id} data-worker-id={w.id}>
                <TableCell>
                  <span className="font-mono text-xs font-medium">{w.id}</span>
                  <p className="text-[10px] text-muted-foreground">
                    {t("visionAcq.since", "since")} {new Date(w.startedAt).toLocaleString()}
                    {w.stoppedAt ? ` → ${new Date(w.stoppedAt).toLocaleTimeString()}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <StatusBadge status={w.state} tone={ACQ_STATE_TONE[w.state] ?? "default"} label={t(`visionAcq.state.${w.state}`, w.state)} />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-[11px]">{w.config.source.kind}</Badge>
                  {w.config.submit && (
                    <Badge variant="outline" className="ml-1 text-[10px]" title={w.config.machineCode ?? undefined}>
                      {t("visionAcq.submits", "submits NTF")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{w.framesGrabbed}</TableCell>
                <TableCell className="text-right font-mono text-xs">{w.submitted}</TableCell>
                <TableCell className={`text-right font-mono text-xs ${w.errors > 0 ? "text-destructive" : ""}`}>{w.errors}</TableCell>
                <TableCell className="max-w-56">
                  {w.lastError ? (
                    <span className="block truncate text-xs text-destructive" title={w.lastError}>{w.lastError}</span>
                  ) : lastEntry ? (
                    <span className="text-xs text-muted-foreground">
                      #{lastEntry.frameId} · {new Date(lastEntry.at).toLocaleTimeString()}
                      {lastEntry.quality
                        ? lastEntry.quality.acceptable
                          ? ` · ${t("visionAcq.qualityOk", "quality OK")}`
                          : ` · ${t("visionAcq.qualityBad", "quality poor")}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                {canControl && (
                  <TableCell className="text-right">
                    {w.state === "running" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive hover:text-destructive/80"
                        disabled={stopPending}
                        onClick={() => onStop(w.id)}
                      >
                        <Square className="mr-1 h-3.5 w-3.5" />
                        {t("visionAcq.stop", "Stop")}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Dòng khám phá — loại nguồn nào dùng được ngay. */}
      {sources && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("visionAcq.sources", "Source kinds")}:</span>
          {sources.map((s) => (
            <Badge
              key={s.kind}
              variant="outline"
              className={`font-mono text-[10px] ${s.available ? "" : "text-muted-foreground line-through"}`}
              title={s.description}
            >
              {s.kind}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

// ── Sheet: khởi động worker thu ảnh (file / mock — các nguồn THẬT hôm nay). Dời NGUYÊN VĂN từ EquipmentIntegration
// (cùng kiểm tra bắt buộc, cùng payload, cùng giới hạn chu kỳ).
function StartAcquisitionWorkerForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (cfg: StartWorkerInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"file" | "mock">("file");
  const [directory, setDirectory] = useState("");
  const [loop, setLoop] = useState(false);
  const [mockMaxFrames, setMockMaxFrames] = useState("20");
  const [intervalMs, setIntervalMs] = useState("2000");
  const [submit, setSubmit] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [assessQuality, setAssessQuality] = useState(true);

  const dirty = id !== "" || kind !== "file" || directory !== "" || loop || mockMaxFrames !== "20" || intervalMs !== "2000" || submit || machineCode !== "" || !assessQuality;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSubmit = () => {
    if (!id.trim()) {
      toast.error(t("visionAcq.idRequired", "Worker id is required.")); return;
    }
    if (kind === "file" && !directory.trim()) {
      toast.error(t("visionAcq.dirRequired", "Directory is required for a file source.")); return;
    }
    if (submit && !machineCode.trim()) {
      toast.error(t("visionAcq.machineRequired", "Submitting frames requires a machine code.")); return;
    }
    onSubmit(
      {
        id: id.trim(),
        source: kind === "file"
          ? { kind: "file", directory: directory.trim(), loop }
          : { kind: "mock", maxFrames: Math.max(0, parseInt(mockMaxFrames) || 0) },
        machineCode: machineCode.trim() || undefined,
        intervalMs: Math.min(3_600_000, Math.max(50, parseInt(intervalMs) || 2000)),
        submit,
        assessQuality,
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-id`}>{t("visionAcq.col.id", "Worker")}</Label>
          <Input id={`${uid}-id`} value={id} placeholder="replay-line1" onChange={(e) => setId(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-kind`}>{t("visionAcq.kind", "Source kind")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "file" | "mock")}>
            <SelectTrigger id={`${uid}-kind`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="file">file</SelectItem>
              <SelectItem value="mock">mock</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {kind === "file" ? (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-dir`}>{t("visionAcq.directory", "Directory (on the server)")}</Label>
            <Input id={`${uid}-dir`} value={directory} placeholder="D:\\captures\\line1" onChange={(e) => setDirectory(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={loop} onCheckedChange={(v) => setLoop(Boolean(v))} />
            {t("visionAcq.loop", "Loop the folder (soak test)")}
          </label>
        </>
      ) : (
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-max`}>{t("visionAcq.maxFrames", "Max frames (0 = until stopped)")}</Label>
          <Input id={`${uid}-max`} type="number" min={0} value={mockMaxFrames} onChange={(e) => setMockMaxFrames(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-interval`}>{t("visionAcq.interval", "Interval (ms)")}</Label>
          <Input id={`${uid}-interval`} type="number" min={50} value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-mc`}>{t("visionAcq.machineCode", "Machine code")}</Label>
          <Input id={`${uid}-mc`} value={machineCode} placeholder="AOI-01" onChange={(e) => setMachineCode(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={submit} onCheckedChange={(v) => setSubmit(Boolean(v))} />
        {t("visionAcq.submitFrames", "Submit each frame as a canonical NTF inspection (requires machine code)")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={assessQuality} onCheckedChange={(v) => setAssessQuality(Boolean(v))} />
        {t("visionAcq.assessQuality", "Run image-quality metrics per frame")}
      </label>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={doSubmit} disabled={pending}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          <Play className="mr-1 h-4 w-4" />
          {t("visionAcq.start", "Start worker")}
        </Button>
      </SheetFooter>
    </div>
  );
}
