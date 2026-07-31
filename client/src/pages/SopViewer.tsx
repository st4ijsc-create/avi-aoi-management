/**
 * doc 44 W6-1 (G5.14) — e-SOP VIEWER (SYNAPSE LDS-L5 §6.2, persona vận hành).
 *
 * Hiển thị ĐÚNG BƯỚC HIỆN TẠI theo ngữ cảnh (sản phẩm/trạm) — spec §6.2. Checklist
 * BẮT BUỘC: bước requires_confirm phải xác nhận (khớp expected_input nếu có) mới
 * cho tiếp; media (ảnh) từng bước. Ghi vết thao tác tay qua sop_executions.
 *
 * Đọc trpc.sop.{resolveActive,get,execution}; thực thi qua
 * trpc.sop.{startExecution,confirmStep,finishExecution} (operatorProcedure server).
 * Route /sop/:sopId? — RouteGuard machine_status (đọc-mở). ISA-101 nền trung tính.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Loader2, Play, ScanLine } from "lucide-react";

import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer, PageHeader, SectionCard, StatusBadge, ProductModelSelect, EntityPicker } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CURRENT_PATH = "/sop";

export default function SopViewer() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [, params] = useRoute("/sop/:sopId?");
  const crumbs = buildBreadcrumbs(location, t);

  const routeSopId = params?.sopId && /^\d+$/.test(params.sopId) ? Number(params.sopId) : null;

  // ── Ngữ cảnh (chỉ dùng khi không truyền sopId trực tiếp) ─────────────────────
  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [stationId, setStationId] = useState<number | null>(null);

  const stationsQ = trpc.station.list.useQuery(undefined, { enabled: routeSopId == null });
  const stationOptions = useMemo(
    () => (stationsQ.data ?? []).map((s: { id: number; code?: string | null; name?: string | null }) => ({
      value: s.id,
      label: s.name ?? s.code ?? `#${s.id}`,
      sublabel: s.code ?? undefined,
    })),
    [stationsQ.data],
  );

  // SOP: theo sopId trực tiếp, hoặc resolveActive theo ngữ cảnh.
  const directQ = trpc.sop.get.useQuery({ id: routeSopId ?? 0 }, { enabled: routeSopId != null });
  const resolveQ = trpc.sop.resolveActive.useQuery(
    { productModelId, stationId },
    { enabled: routeSopId == null && (productModelId != null || stationId != null) },
  );
  const sop = routeSopId != null ? directQ.data : resolveQ.data;
  const loadingSop = routeSopId != null ? directQ.isLoading : resolveQ.isFetching;

  const steps = useMemo(() => (sop?.steps ?? []).slice().sort((a, b) => a.stepNo - b.stepNo), [sop]);

  // ── Phiên thực thi ────────────────────────────────────────────────────────────
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [scanInput, setScanInput] = useState("");

  const utils = trpc.useUtils();
  const execQ = trpc.sop.execution.useQuery({ id: executionId ?? 0 }, { enabled: executionId != null });
  const confirmedSet = useMemo(
    () => new Set((execQ.data?.stepConfirmations ?? []).map((c) => c.stepNo)),
    [execQ.data],
  );
  const progress = execQ.data?.progress ?? null;

  // Reset khi đổi SOP.
  useEffect(() => {
    setExecutionId(null);
    setStepIndex(0);
    setScanInput("");
  }, [sop?.id]);

  const startM = trpc.sop.startExecution.useMutation({
    onSuccess: (row) => { setExecutionId(row.id); setStepIndex(0); toast.success(t("sop.view.started", "Đã bắt đầu SOP")); },
    onError: (e) => toastTrpcError(e),
  });
  const confirmM = trpc.sop.confirmStep.useMutation({
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(t(`sop.view.confirmErr.${r.code}`, {
          defaultValue:
            r.code === "INPUT_MISMATCH" ? "Giá trị quét không khớp yêu cầu" :
            r.code === "INPUT_REQUIRED" ? "Bước này cần quét/nhập giá trị" : "Không xác nhận được bước",
        }));
        return;
      }
      setScanInput("");
      void utils.sop.execution.invalidate();
      // Tự tiến tới bước kế nếu còn.
      if (stepIndex < steps.length - 1) setStepIndex((i) => i + 1);
      toast.success(t("sop.view.stepConfirmed", "Đã xác nhận bước"));
    },
    onError: (e) => toastTrpcError(e),
  });
  const finishM = trpc.sop.finishExecution.useMutation({
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(t("sop.view.finishIncomplete", "Còn bước bắt buộc chưa xác nhận"));
        void utils.sop.execution.invalidate();
        return;
      }
      toast.success(t("sop.view.finished", "Đã hoàn tất SOP"));
      void utils.sop.execution.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  const currentStep = steps[stepIndex] ?? null;
  const isConfirmed = currentStep ? confirmedSet.has(currentStep.stepNo) : false;
  const requiresScan = !!currentStep?.requiresConfirm && !!currentStep?.expectedInput;
  const canFinish = progress?.complete ?? false;

  const started = executionId != null;

  return (
    <DashboardLayout title={t("sop.view.title", "e-SOP")} navItems={navItems} currentPath={CURRENT_PATH}>
      <PageContainer className="space-y-6">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<ClipboardList className="h-6 w-6" />}
          title={t("sop.view.title", "Quy trình thao tác (e-SOP)")}
          description={t("sop.view.subtitle", "Hướng dẫn từng bước theo sản phẩm/trạm; xác nhận checklist bắt buộc mới cho tiếp.")}
        />

        {/* ── Chọn ngữ cảnh khi không có sopId ───────────────────────────────────── */}
        {routeSopId == null && (
          <SectionCard title={t("sop.view.context", "Ngữ cảnh")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("sop.view.product", "Sản phẩm")}</Label>
                <ProductModelSelect value={productModelId} onChange={(v) => setProductModelId(v as number | null)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("sop.view.station", "Trạm")}</Label>
                <EntityPicker
                  options={stationOptions}
                  value={stationId}
                  onChange={(v) => setStationId(v as number | null)}
                  placeholder={t("sop.view.stationPh", "Chọn trạm…")}
                />
              </div>
            </div>
          </SectionCard>
        )}

        {loadingSop && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loadingSop && !sop && (
          <EmptyState
            icon={ClipboardList}
            title={t("sop.view.noSop", "Không có e-SOP cho ngữ cảnh này")}
            description={t("sop.view.noSopDesc", "Chọn sản phẩm/trạm khác, hoặc yêu cầu kỹ sư kích hoạt một SOP phù hợp.")}
          />
        )}

        {!loadingSop && sop && (
          <>
            {/* ── Header SOP + tiến độ ─────────────────────────────────────────── */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{sop.title}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono">{sop.code}</span> · v{sop.version}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={sop.status} label={t(`sop.status.${sop.status}`, sop.status)} />
                    {!started ? (
                      <Button onClick={() => startM.mutate({ sopId: sop.id, stationId: stationId ?? sop.stationId ?? undefined })} disabled={startM.isPending || steps.length === 0}>
                        <Play className="mr-1 h-4 w-4" /> {t("sop.view.start", "Bắt đầu")}
                      </Button>
                    ) : (
                      <Button
                        variant={canFinish ? "default" : "outline"}
                        disabled={!canFinish || finishM.isPending}
                        onClick={() => executionId != null && finishM.mutate({ executionId })}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> {t("sop.view.finish", "Hoàn tất")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Thanh tiến độ theo bước bắt buộc. */}
                {started && progress && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {t("sop.view.progress", "Đã xác nhận {{done}}/{{req}} bước bắt buộc", {
                          done: progress.satisfiedRequired,
                          req: progress.requiredSteps,
                        })}
                      </span>
                      <span>
                        {t("sop.view.stepOf", "Bước {{n}}/{{total}}", { n: stepIndex + 1, total: steps.length })}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-success transition-all"
                        style={{
                          width: `${progress.requiredSteps > 0 ? (progress.satisfiedRequired / progress.requiredSteps) * 100 : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {steps.length === 0 && (
              <EmptyState
                icon={ClipboardList}
                title={t("sop.view.noSteps", "SOP chưa có bước nào")}
                description={t("sop.view.noStepsDesc", "Yêu cầu kỹ sư bổ sung các bước cho SOP này.")}
              />
            )}

            {/* ── Bước hiện tại ─────────────────────────────────────────────────── */}
            {started && currentStep && (
              <SectionCard
                title={t("sop.view.currentStep", "Bước {{n}}", { n: currentStep.stepNo })}
              >
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        isConfirmed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isConfirmed ? <CheckCircle2 className="h-5 w-5" /> : currentStep.stepNo}
                    </span>
                    <p className="whitespace-pre-wrap text-base leading-relaxed">{currentStep.text}</p>
                  </div>

                  {/* Media (ảnh minh hoạ bước). */}
                  {currentStep.mediaRef && (
                    <img
                      src={currentStep.mediaRef}
                      alt={t("sop.view.stepMedia", "Minh hoạ bước {{n}}", { n: currentStep.stepNo })}
                      className="max-h-72 rounded-md border object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  )}

                  {/* Checklist bắt buộc. */}
                  {currentStep.requiresConfirm && (
                    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-3">
                      <p className="flex items-center gap-2 text-sm font-medium text-warning">
                        <ScanLine className="h-4 w-4" />
                        {t("sop.view.confirmRequired", "Bước này bắt buộc xác nhận mới cho tiếp")}
                      </p>
                      {requiresScan && (
                        <div className="space-y-1.5">
                          <Label>{t("sop.view.scanLabel", "Quét/nhập giá trị yêu cầu")}</Label>
                          <Input
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            placeholder={t("sop.view.scanPh", "Quét mã jig/vật tư…")}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && executionId != null && !isConfirmed) {
                                confirmM.mutate({ executionId, stepNo: currentStep.stepNo, input: scanInput });
                              }
                            }}
                          />
                        </div>
                      )}
                      <Button
                        disabled={confirmM.isPending || isConfirmed || (requiresScan && scanInput.trim() === "")}
                        onClick={() =>
                          executionId != null &&
                          confirmM.mutate({ executionId, stepNo: currentStep.stepNo, input: requiresScan ? scanInput : null })
                        }
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        {isConfirmed ? t("sop.view.confirmed", "Đã xác nhận") : t("sop.view.confirm", "Xác nhận bước")}
                      </Button>
                    </div>
                  )}

                  {/* Điều hướng. Bước bắt buộc CHƯA xác nhận → khoá "Tiếp". */}
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
                      <ChevronLeft className="mr-1 h-4 w-4" /> {t("sop.view.prev", "Trước")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={stepIndex >= steps.length - 1 || (currentStep.requiresConfirm && !isConfirmed)}
                      onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                      title={currentStep.requiresConfirm && !isConfirmed ? t("sop.view.confirmToAdvance", "Xác nhận bước để tiếp tục") : undefined}
                    >
                      {t("sop.view.next", "Tiếp")} <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* ── Danh sách bước (tổng quan) ────────────────────────────────────── */}
            {steps.length > 0 && (
              <SectionCard title={t("sop.view.allSteps", "Toàn bộ bước")}>
                <ol className="space-y-1.5">
                  {steps.map((s, i) => {
                    const done = confirmedSet.has(s.stepNo);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          disabled={!started}
                          onClick={() => setStepIndex(i)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors",
                            i === stepIndex && started ? "border-primary bg-accent/40" : "hover:bg-accent/30",
                            !started && "cursor-default opacity-80",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                              done ? "bg-success/15 text-success" : s.requiresConfirm ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {done ? "✓" : s.stepNo}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{s.text}</span>
                          {s.requiresConfirm && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-warning">
                              {t("sop.view.mustConfirm", "bắt buộc")}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </SectionCard>
            )}
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
