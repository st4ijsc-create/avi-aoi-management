// WD-1 (doc 31 Đợt D · gap UX1) — Product Onboarding Wizard (/product-onboarding).
//
// The product-config journey used to be 9-10 disjoint destinations across 3 nav
// groups with no product-side wizard (the /aoi-onboarding wizard is machine-only,
// and ProductFiducialsTab had full CRUD but ZERO importers → fiducials were
// unreachable). This wizard STITCHES the existing surfaces into one guided,
// non-linear, resumable flow. It rebuilds nothing: each step either embeds an
// existing panel (fiducials / golden / panel-def / program-release) or deep-links
// to an existing editor (measurement points, thresholds, machine mapping). The
// only new state is a resumable draft (productOnboardingRouter).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { trpc } from "@/lib/trpc";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import ProductGoldenSamplesPanel from "@/components/products/ProductGoldenSamplesPanel";
import PanelDefinitionPanel from "@/components/panel/PanelDefinitionPanel";
import ProgramReleasePanel from "@/components/program-release/ProgramReleasePanel";

import { Step1Product } from "@/components/productOnboarding/Step1Product";
import { DeepLinkStep } from "@/components/productOnboarding/DeepLinkStep";
import { ReviewStep } from "@/components/productOnboarding/ReviewStep";
import { ResumeDraftsPicker } from "@/components/productOnboarding/ResumeDraftsPicker";
import { OnboardingFiducialsStep } from "@/components/productOnboarding/OnboardingFiducialsStep";
import {
  PRODUCT_ONBOARDING_STEPS,
  REVIEW_STEP_INDEX,
  computeReadiness,
  mergeStepStatus,
  pointHasLimits,
  requiredIncompleteSteps,
  type ManualStepMark,
  type OnboardingReadinessInput,
  type OnboardingStepState,
  type StepStatus,
} from "@/components/productOnboarding/types";

const STATUS_ICON: Record<StepStatus, ReactNode> = {
  done: <CheckCircle2 className="h-4 w-4 text-success" />,
  skipped: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
  todo: <Circle className="h-4 w-4 text-muted-foreground/40" />,
};

export function ProductOnboardingWizardContent() {
  const { t } = useTranslation();
  const search = useSearch();

  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [productCode, setProductCode] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState<OnboardingStepState>({});
  const hydratedRef = useRef(false);
  const urlStepAppliedRef = useRef(false);

  const enabled = !!productModelId && productModelId > 0;
  const pid = productModelId ?? 0;

  // ── Product identity from the catalog (also resolves ?product= deep-links) ──
  const { data: products } = trpc.productModel.list.useQuery({});

  // Deep-link: /product-onboarding?product=<id>[&step=<key>] (e.g. returning from
  // the point editor). Applied once so it doesn't fight manual navigation.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const p = params.get("product");
    if (p && !productModelId) {
      const idNum = Number(p);
      if (Number.isFinite(idNum) && idNum > 0) {
        setProductModelId(idNum);
        hydratedRef.current = false;
      }
    }
    const s = params.get("step");
    if (s && !urlStepAppliedRef.current) {
      const idx = PRODUCT_ONBOARDING_STEPS.findIndex((x) => x.key === s);
      if (idx >= 0) {
        setStep(idx);
        urlStepAppliedRef.current = true;
      }
    }
  }, [search, productModelId]);

  // Resolve the human code once products load / product changes.
  useEffect(() => {
    if (!productModelId || !products) return;
    const p = (products as any[]).find((x) => x.id === productModelId);
    if (p) setProductCode(p.code);
  }, [productModelId, products]);

  const selectedProduct = useMemo(
    () => (products as any[] | undefined)?.find((x) => x.id === productModelId) ?? null,
    [products, productModelId],
  );

  // ── Resumable draft ────────────────────────────────────────────────────────
  const draftQuery = trpc.productOnboarding.getDraft.useQuery(
    { productModelId: pid },
    { enabled },
  );
  const saveDraftMut = trpc.productOnboarding.saveDraft.useMutation();
  const completeMut = trpc.productOnboarding.complete.useMutation();

  // Hydrate manual marks + resume step once per product.
  useEffect(() => {
    if (hydratedRef.current || !draftQuery.data) return;
    const d = draftQuery.data;
    setManual(((d.stepState as OnboardingStepState) ?? {}));
    if (!urlStepAppliedRef.current && typeof d.currentStep === "number") {
      setStep(Math.min(Math.max(d.currentStep, 0), REVIEW_STEP_INDEX));
    }
    hydratedRef.current = true;
  }, [draftQuery.data]);

  const persist = useCallback(
    (nextStep: number, nextManual: OnboardingStepState, id = productModelId) => {
      if (!id) return;
      saveDraftMut.mutate({ productModelId: id, currentStep: nextStep, stepState: nextManual });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productModelId],
  );

  // ── Live readiness (all from EXISTING queries — no new server endpoint) ─────
  const pointsQ = trpc.measurementPoint.listByProductModel.useQuery({ productModelId: pid }, { enabled });
  const fidQ = trpc.fiducialMark.listByProductModel.useQuery({ productModelId: pid }, { enabled });
  const goldenQ = trpc.goldenSample.listByProduct.useQuery({ productModelId: pid }, { enabled });
  const panelQ = trpc.productPanel.listByProduct.useQuery({ productModelId: pid }, { enabled });
  const releaseQ = trpc.inspectionProgram.list.useQuery({ productModelId: pid }, { enabled });
  const mapQ = trpc.productMachineMapping.list.useQuery(undefined, { enabled });

  const input: OnboardingReadinessInput = useMemo(() => {
    const points = (pointsQ.data as any[]) ?? [];
    const mappings = ((mapQ.data as any[]) ?? []).filter((m) => m.productModelId === productModelId);
    return {
      hasProduct: enabled,
      hasImageDims: !!(selectedProduct?.imageWidth && selectedProduct?.imageHeight),
      fiducialCount: ((fidQ.data as any[]) ?? []).length,
      pointCount: points.length,
      pointsWithLimits: points.filter((p) => pointHasLimits(p)).length,
      goldenCount: ((goldenQ.data as any[]) ?? []).length,
      panelCount: ((panelQ.data as any[]) ?? []).length,
      releaseCount: ((releaseQ.data as any[]) ?? []).length,
      mappingCount: mappings.length,
    };
  }, [pointsQ.data, fidQ.data, goldenQ.data, panelQ.data, releaseQ.data, mapQ.data, selectedProduct, enabled, productModelId]);

  const readiness = useMemo(() => computeReadiness(input), [input]);

  const refetchAll = useCallback(() => {
    pointsQ.refetch(); fidQ.refetch(); goldenQ.refetch();
    panelQ.refetch(); releaseQ.refetch(); mapQ.refetch();
  }, [pointsQ, fidQ, goldenQ, panelQ, releaseQ, mapQ]);

  // ── Navigation + marking ────────────────────────────────────────────────────
  const goToStep = (n: number) => {
    const clamped = Math.min(Math.max(n, 0), REVIEW_STEP_INDEX);
    if (clamped > 0 && !enabled) return; // can't leave step 1 without a product
    setStep(clamped);
    persist(clamped, manual);
  };
  const onNext = () => goToStep(step + 1);
  const onBack = () => goToStep(step - 1);

  const markStep = (key: string, mark: ManualStepMark | null) => {
    const next = { ...manual };
    if (mark) next[key] = mark;
    else delete next[key];
    setManual(next);
    persist(step, next);
  };

  const chooseProduct = (id: number, code: string) => {
    setProductModelId(id);
    setProductCode(code);
    hydratedRef.current = false;
    setStep(1);
    persist(1, manual, id);
  };

  // H3 #2 — resume an in-progress draft from the step-0 picker: jump to its
  // product + last step, and let the draft query re-hydrate its manual marks.
  const resumeDraft = (id: number, code: string | null, currentStep: number) => {
    setProductModelId(id);
    if (code) setProductCode(code);
    hydratedRef.current = false;      // re-hydrate manual marks for this draft
    urlStepAppliedRef.current = true; // keep the resumed step (don't let hydrate override)
    setStep(Math.min(Math.max(currentStep, 0), REVIEW_STEP_INDEX));
  };

  const onFinish = () => {
    if (!productModelId) return;
    // H3 #1 — defense in depth: never complete while required steps are missing.
    const missing = requiredIncompleteSteps(readiness.derived, manual);
    if (missing.length > 0) {
      toast.error(
        t("productOnboarding.review.guardBlocked", {
          defaultValue: "Còn {{count}} bước bắt buộc chưa hoàn thành",
          count: missing.length,
        }),
      );
      return;
    }
    completeMut.mutate(
      { productModelId, currentStep: REVIEW_STEP_INDEX, stepState: manual },
      { onSuccess: () => { draftQuery.refetch(); } },
    );
  };

  // ── Step body ────────────────────────────────────────────────────────────────
  const stepKey = PRODUCT_ONBOARDING_STEPS[step].key;
  const productsUrl = `/products?product=${pid}`;
  const mappingUrl = `/product-mapping?product=${pid}`;

  const renderStep = () => {
    switch (stepKey) {
      case "product":
        return <Step1Product productModelId={productModelId} onProductChosen={chooseProduct} />;
      case "fiducials":
        return enabled ? <OnboardingFiducialsStep productModelId={pid} /> : null;
      case "points":
        return (
          <DeepLinkStep
            href={productsUrl}
            openLabel={t("productOnboarding.points.open", "Open point editor")}
            onRefresh={refetchAll}
          >
            <p className="text-sm">
              {t("productOnboarding.points.count", {
                defaultValue: "{{count}} measurement points defined",
                count: input.pointCount,
              })}
            </p>
          </DeepLinkStep>
        );
      case "thresholds":
        return (
          <DeepLinkStep
            href={productsUrl}
            openLabel={t("productOnboarding.thresholds.open", "Open point editor (limits)")}
            onRefresh={refetchAll}
          >
            <p className="text-sm">
              {t("productOnboarding.thresholds.summary", {
                defaultValue: "{{withLimits}}/{{total}} points have LSL/USL ({{pct}}%)",
                withLimits: input.pointsWithLimits,
                total: input.pointCount,
                pct: readiness.limitPct,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "productOnboarding.thresholds.hint",
                "Set limits per point in the editor, or use the AI Threshold advisor to propose them for approval.",
              )}
            </p>
          </DeepLinkStep>
        );
      case "golden":
        return enabled && productCode
          ? <ProductGoldenSamplesPanel productModelId={pid} productCode={productCode} />
          : null;
      case "panel":
        return enabled ? <PanelDefinitionPanel productModelId={pid} /> : null;
      case "release":
        return enabled ? <ProgramReleasePanel productModelId={pid} /> : null;
      case "mapping":
        return (
          <DeepLinkStep
            href={mappingUrl}
            openLabel={t("productOnboarding.mapping.open", "Open machine mapping")}
            onRefresh={refetchAll}
          >
            <p className="text-sm">
              {t("productOnboarding.mapping.count", {
                defaultValue: "{{count}} machine mapping(s) for this product",
                count: input.mappingCount,
              })}
            </p>
          </DeepLinkStep>
        );
      case "review":
        return (
          <ReviewStep
            input={input}
            readiness={readiness}
            manual={manual}
            onGoToStep={goToStep}
            onFinish={onFinish}
            finishing={completeMut.isPending}
          />
        );
      default:
        return null;
    }
  };

  const currentMeta = PRODUCT_ONBOARDING_STEPS[step];
  const currentStatus = mergeStepStatus(stepKey, readiness.derived[stepKey], manual[stepKey]);
  const completed = completeMut.data?.status === "completed";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title={t("productOnboarding.title", "Product setup wizard")}
        description={t(
          "productOnboarding.subtitle",
          "Guided end-to-end setup for a product: image, fiducials, points, limits, golden, panel, release and machine mapping — resumable.",
        )}
      />

      {completed && (
        <div className="rounded border border-success/30 bg-success/10 p-3 text-sm text-success flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {t("productOnboarding.completedBanner", "Setup marked complete. You can keep refining any step.")}
        </div>
      )}

      {/* Progress + clickable stepper (non-linear) */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {productCode
            ? t("productOnboarding.configuring", { defaultValue: "Configuring {{code}}", code: productCode })
            : t("productOnboarding.noProduct", "Start by creating or selecting a product")}
        </span>
        {enabled && <span className="font-semibold">{readiness.percent}%</span>}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
        {PRODUCT_ONBOARDING_STEPS.map((s, i) => {
          const stStatus = s.key === "review"
            ? "todo"
            : mergeStepStatus(s.key, readiness.derived[s.key], manual[s.key]);
          const disabled = i > 0 && !enabled;
          return (
            <button
              key={s.key}
              type="button"
              disabled={disabled}
              onClick={() => goToStep(i)}
              className={cn(
                "flex flex-col items-center gap-1 rounded border p-2 text-center text-xs transition-colors",
                i === step ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                disabled && "opacity-40 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-1">
                {s.key !== "review" && STATUS_ICON[stStatus as StepStatus]}
                <span className="font-medium">{i + 1}</span>
              </div>
              <span className="leading-tight">{t(`productOnboarding.steps.${s.key}`, s.key)}</span>
              {s.optional && (
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  {t("productOnboarding.optional", "optional")}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Resume-picker: step 0 with no product yet → offer unfinished drafts. */}
      {step === 0 && !enabled && <ResumeDraftsPicker onResume={resumeDraft} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {t(`productOnboarding.steps.${stepKey}`, stepKey)}
                {stepKey !== "review" && (
                  <span className="text-xs font-normal text-muted-foreground capitalize">
                    {t(`productOnboarding.status.${currentStatus}`, currentStatus)}
                  </span>
                )}
              </CardTitle>
              <CardDescription>{t(`productOnboarding.stepDesc.${stepKey}`, "")}</CardDescription>
            </div>
            {/* Optional steps: an explicit skip / un-skip toggle. */}
            {currentMeta.optional && enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  markStep(stepKey, manual[stepKey]?.status === "skipped" ? null : { status: "skipped" })
                }
              >
                {manual[stepKey]?.status === "skipped"
                  ? t("productOnboarding.unskip", "Un-skip")
                  : t("productOnboarding.skip", "Skip this step")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>{renderStep()}</CardContent>
      </Card>

      {/* Prev / Next */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={step === 0}>
          {t("common.back", "Back")}
        </Button>
        <Button onClick={onNext} disabled={step >= REVIEW_STEP_INDEX || (!enabled && step === 0)}>
          {t("common.next", "Next")}
        </Button>
      </div>
    </div>
  );
}

export default function ProductOnboardingWizard() {
  return (
    <DashboardLayout title="SYNAPSE" navItems={navItems} currentPath="/product-onboarding">
      <ProductOnboardingWizardContent />
    </DashboardLayout>
  );
}
