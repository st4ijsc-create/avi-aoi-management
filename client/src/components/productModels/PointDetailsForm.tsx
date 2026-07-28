/**
 * doc 48 R4 (tech-debt) — "Point Details Form (measurement-point editor column)" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction, ChangeEvent } from "react";
import { type RouterOutputs, mapCatalogCategoryToLegacyType, type MaterialCondition, type MeasurementPoint, type ToleranceMode } from "./types";
import { useAuth } from "@/_core/hooks/useAuth";
import AIThresholdSuggestButton from "@/components/AIThresholdSuggestButton";
import { PendingSuggestionCard } from "./PendingSuggestionCard";
import { ValidationMessage } from "@/components/ValidationMessage";
import { PointCriteriaEditor, type PointCriteriaItem } from "@/components/products/PointCriteriaEditor";
import { PointLightingEditor } from "@/components/products/PointLightingEditor";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/useFormValidation";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Copy, Image as ImageIcon, MousePointer, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface PointDetailsFormProps {
  confirmDeletePoint: () => void;
  handleDuplicatePoint: () => void;
  handlePointImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  handleSavePoint: () => void;
  imageSourceMode: "upload" | "auto-crop";
  isEditMode: boolean;
  isSavingPoint: boolean;
  measurementInstruments: RouterOutputs["measurementInstrument"]["list"] | undefined;
  measurementPoints: MeasurementPoint[];
  measurementTypeCatalog: RouterOutputs["measurementTypeCatalog"]["list"] | undefined;
  pointAreaMax: string;
  pointAreaMin: string;
  pointAreaNominal: string;
  pointAreaUnit: string;
  pointCode: string;
  pointComponentCode: string;
  pointCoplanarityMax: string;
  pointCriteria: PointCriteriaItem[];
  pointCropHeight: number;
  pointCropWidth: number;
  pointDatumRefsInput: string;
  pointDescription: string;
  pointFitClass: string;
  pointHeightMax: string;
  pointHeightMin: string;
  pointHeightNominal: string;
  pointHeightUnit: string;
  pointLowerLimit: string;
  pointMaterialCondition: MaterialCondition | "";
  pointMeasurementTypeCode: string;
  pointName: string;
  pointNominalValue: string;
  pointOffsetXMax: string;
  pointOffsetYMax: string;
  pointPositionZ: string;
  pointPreferredInstrumentId: number | undefined;
  pointPreferredSamplingPlanId: number | undefined;
  pointProductViewId: number | undefined;
  pointRefDesignator: string;
  pointReferenceImageUrl: string;
  pointThicknessMax: string;
  pointThicknessMin: string;
  pointTiltMax: string;
  pointTolMinus: string;
  pointTolPlus: string;
  pointToleranceMode: ToleranceMode;
  pointType: MeasurementPoint["measurementType"];
  pointUnit: string;
  pointUpperLimit: string;
  pointValidation: ReturnType<typeof useFormValidation<{ code: string; name: string; lowerLimit: string; upperLimit: string }>>;
  pointVoidPctMax: string;
  pointVolumeMax: string;
  pointVolumeMin: string;
  pointVolumeNominal: string;
  pointVolumeUnit: string;
  pointWarpageMax: string;
  pointWorkstationId: number | undefined;
  productViews: RouterOutputs["productView"]["listByProduct"] | undefined;
  refetchPoints: () => void;
  samplingPlans: RouterOutputs["samplingPlan"]["listByProduct"] | undefined;
  saveWillRequireApproval: boolean;
  selectedPointIndex: number | null;
  setImageSourceMode: Dispatch<SetStateAction<"upload" | "auto-crop">>;
  setPointAreaMax: Dispatch<SetStateAction<string>>;
  setPointAreaMin: Dispatch<SetStateAction<string>>;
  setPointAreaNominal: Dispatch<SetStateAction<string>>;
  setPointAreaUnit: Dispatch<SetStateAction<string>>;
  setPointCode: Dispatch<SetStateAction<string>>;
  setPointComponentCode: Dispatch<SetStateAction<string>>;
  setPointCoplanarityMax: Dispatch<SetStateAction<string>>;
  setPointCriteria: Dispatch<SetStateAction<PointCriteriaItem[]>>;
  setPointCropHeight: Dispatch<SetStateAction<number>>;
  setPointCropWidth: Dispatch<SetStateAction<number>>;
  setPointDatumRefsInput: Dispatch<SetStateAction<string>>;
  setPointDescription: Dispatch<SetStateAction<string>>;
  setPointFitClass: Dispatch<SetStateAction<string>>;
  setPointHeightMax: Dispatch<SetStateAction<string>>;
  setPointHeightMin: Dispatch<SetStateAction<string>>;
  setPointHeightNominal: Dispatch<SetStateAction<string>>;
  setPointHeightUnit: Dispatch<SetStateAction<string>>;
  setPointLowerLimit: Dispatch<SetStateAction<string>>;
  setPointMaterialCondition: Dispatch<SetStateAction<MaterialCondition | "">>;
  setPointMeasurementTypeCode: Dispatch<SetStateAction<string>>;
  setPointName: Dispatch<SetStateAction<string>>;
  setPointNominalValue: Dispatch<SetStateAction<string>>;
  setPointOffsetXMax: Dispatch<SetStateAction<string>>;
  setPointOffsetYMax: Dispatch<SetStateAction<string>>;
  setPointPositionZ: Dispatch<SetStateAction<string>>;
  setPointPreferredInstrumentId: Dispatch<SetStateAction<number | undefined>>;
  setPointPreferredSamplingPlanId: Dispatch<SetStateAction<number | undefined>>;
  setPointProductViewId: Dispatch<SetStateAction<number | undefined>>;
  setPointRefDesignator: Dispatch<SetStateAction<string>>;
  setPointReferenceImageUrl: Dispatch<SetStateAction<string>>;
  setPointThicknessMax: Dispatch<SetStateAction<string>>;
  setPointThicknessMin: Dispatch<SetStateAction<string>>;
  setPointTiltMax: Dispatch<SetStateAction<string>>;
  setPointTolMinus: Dispatch<SetStateAction<string>>;
  setPointTolPlus: Dispatch<SetStateAction<string>>;
  setPointToleranceMode: Dispatch<SetStateAction<ToleranceMode>>;
  setPointType: Dispatch<SetStateAction<MeasurementPoint["measurementType"]>>;
  setPointUnit: Dispatch<SetStateAction<string>>;
  setPointUpperLimit: Dispatch<SetStateAction<string>>;
  setPointVoidPctMax: Dispatch<SetStateAction<string>>;
  setPointVolumeMax: Dispatch<SetStateAction<string>>;
  setPointVolumeMin: Dispatch<SetStateAction<string>>;
  setPointVolumeNominal: Dispatch<SetStateAction<string>>;
  setPointVolumeUnit: Dispatch<SetStateAction<string>>;
  setPointWarpageMax: Dispatch<SetStateAction<string>>;
  setPointWorkstationId: Dispatch<SetStateAction<number | undefined>>;
  showCoatingSection: boolean;
  showCoplanaritySection: boolean;
  showGdtSection: boolean;
  showPositionSection: boolean;
  showSolderSection: boolean;
  showToleranceSection: boolean;
  showXraySection: boolean;
  workstations: RouterOutputs["workstation"]["list"] | undefined;
}

export function PointDetailsForm(props: PointDetailsFormProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // PHỤ LỤC (Task 2 review của Task 1) — nộp-mới (AIThresholdSuggestButton.onSubmitted)
  // và quyết-định (PendingSuggestionCard.onDecided) đều dẫn tới CÙNG một trạng thái
  // cần làm mới: badge "N đề xuất AI" trên bảng điểm đo (countPendingByProduct) và
  // danh sách đề xuất mà PendingSuggestionCard đọc (list). Gom vào MỘT hàm để hai
  // đường không lệch nhau (đó chính là lỗ hổng mà bản review Task 1 phát hiện).
  const refreshSuggestionState = () => {
    void utils.thresholdApproval.countPendingByProduct.invalidate();
    void utils.thresholdApproval.list.invalidate();
  };
  const {
    confirmDeletePoint, handleDuplicatePoint, handlePointImageUpload, handleSavePoint,
    imageSourceMode, isEditMode, isSavingPoint, measurementInstruments,
    measurementPoints, measurementTypeCatalog, pointAreaMax, pointAreaMin,
    pointAreaNominal, pointAreaUnit, pointCode, pointComponentCode,
    pointCoplanarityMax, pointCriteria, pointCropHeight, pointCropWidth,
    pointDatumRefsInput, pointDescription, pointFitClass, pointHeightMax,
    pointHeightMin, pointHeightNominal, pointHeightUnit, pointLowerLimit,
    pointMaterialCondition, pointMeasurementTypeCode, pointName, pointNominalValue,
    pointOffsetXMax, pointOffsetYMax, pointPositionZ, pointPreferredInstrumentId,
    pointPreferredSamplingPlanId, pointProductViewId, pointRefDesignator, pointReferenceImageUrl,
    pointThicknessMax, pointThicknessMin, pointTiltMax, pointTolMinus,
    pointTolPlus, pointToleranceMode, pointType, pointUnit,
    pointUpperLimit, pointValidation, pointVoidPctMax, pointVolumeMax,
    pointVolumeMin, pointVolumeNominal, pointVolumeUnit, pointWarpageMax,
    pointWorkstationId, productViews, refetchPoints, samplingPlans,
    saveWillRequireApproval, selectedPointIndex, setImageSourceMode, setPointAreaMax,
    setPointAreaMin, setPointAreaNominal, setPointAreaUnit, setPointCode,
    setPointComponentCode, setPointCoplanarityMax, setPointCriteria, setPointCropHeight,
    setPointCropWidth, setPointDatumRefsInput, setPointDescription, setPointFitClass,
    setPointHeightMax, setPointHeightMin, setPointHeightNominal, setPointHeightUnit,
    setPointLowerLimit, setPointMaterialCondition, setPointMeasurementTypeCode, setPointName,
    setPointNominalValue, setPointOffsetXMax, setPointOffsetYMax, setPointPositionZ,
    setPointPreferredInstrumentId, setPointPreferredSamplingPlanId, setPointProductViewId, setPointRefDesignator,
    setPointReferenceImageUrl, setPointThicknessMax, setPointThicknessMin, setPointTiltMax,
    setPointTolMinus, setPointTolPlus, setPointToleranceMode, setPointType,
    setPointUnit, setPointUpperLimit, setPointVoidPctMax, setPointVolumeMax,
    setPointVolumeMin, setPointVolumeNominal, setPointVolumeUnit, setPointWarpageMax,
    setPointWorkstationId, showCoatingSection, showCoplanaritySection, showGdtSection,
    showPositionSection, showSolderSection, showToleranceSection, showXraySection,
    workstations,
  } = props;
  return (
    <>
                <div className="xl:col-span-1">
                  {selectedPointIndex !== null ? (
                    <ScrollArea className="h-137.5">
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{t("products.pointDetails")} #{selectedPointIndex + 1}</h4>
                          {isEditMode && (
                            <Button size="sm" variant="ghost" onClick={handleDuplicatePoint}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="pointCode">{t("products.pointCodeLabel")} <span className="text-destructive">*</span></Label>
                          <Input
                            id="pointCode"
                            value={pointCode}
                            onChange={(e) => setPointCode(e.target.value)}
                            onBlur={() => pointValidation.handleBlur("code", pointCode)}
                            disabled={!isEditMode}
                            className={pointValidation.hasError("code") ? "border-destructive" : ""}
                          />
                          <ValidationMessage error={pointValidation.getFieldError("code")} />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointName">{t("products.pointNameLabel")} <span className="text-destructive">*</span></Label>
                          <Input
                            id="pointName"
                            value={pointName}
                            onChange={(e) => setPointName(e.target.value)}
                            onBlur={() => pointValidation.handleBlur("name", pointName)}
                            disabled={!isEditMode}
                            className={pointValidation.hasError("name") ? "border-destructive" : ""}
                          />
                          <ValidationMessage error={pointValidation.getFieldError("name")} />
                        </div>

                        {/* ── CƠ BẢN: loại đo (1 selector duy nhất) + badge nhóm suy ra (doc 43 Đợt 2 §3.3) ── */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="pointMeasurementTypeCode">{t("measurementPointP2.measurementTypeCode")}</Label>
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {t("products.pointGroupBadge", "Nhóm")}: {(() => {
                                const labels: Record<string, string> = {
                                  VISUAL: t("products.typeVisualLabel", "Trực quan"),
                                  DIMENSION: t("products.typeDimension"),
                                  POSITION: t("products.typePosition"),
                                  COLOR: t("products.typeColor"),
                                  SURFACE: t("products.typeSurface"),
                                  ELECTRICAL: t("products.typeElectrical"),
                                  OTHER: t("products.typeOther"),
                                };
                                return labels[pointType] || pointType;
                              })()}
                            </Badge>
                          </div>
                          <Select
                            value={pointMeasurementTypeCode || "none"}
                            onValueChange={(v) => {
                              const nextCode = v === "none" ? "" : v;
                              setPointMeasurementTypeCode(nextCode);
                              const selected = measurementTypeCatalog?.find((item) => item.code === nextCode);
                              if (selected?.category) {
                                setPointType(mapCatalogCategoryToLegacyType(selected.category));
                              }
                            }}
                            disabled={!isEditMode}
                          >
                            <SelectTrigger id="pointMeasurementTypeCode">
                              <SelectValue placeholder={t("measurementPointP2.selectMeasurementTypeCode")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t("common.none")}</SelectItem>
                              {measurementTypeCatalog?.map((item) => (
                                <SelectItem key={item.id} value={item.code}>
                                  {item.code} {item.nameEn ? `- ${item.nameEn}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Fallback: sản phẩm cũ chưa gán mã catalog → vẫn cho chọn 7 nhóm legacy (giữ tương thích) */}
                        {!pointMeasurementTypeCode && (
                          <div className="space-y-2">
                            <Label htmlFor="pointType">{t("products.pointType")}</Label>
                            <Select
                              value={pointType}
                              onValueChange={(v) => setPointType(v as MeasurementPoint["measurementType"])}
                              disabled={!isEditMode}
                            >
                              <SelectTrigger id="pointType">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="VISUAL">{t("products.typeVisualLabel", "Trực quan")}</SelectItem>
                                <SelectItem value="DIMENSION">{t("products.typeDimension")}</SelectItem>
                                <SelectItem value="POSITION">{t("products.typePosition")}</SelectItem>
                                <SelectItem value="COLOR">{t("products.typeColor")}</SelectItem>
                                <SelectItem value="SURFACE">{t("products.typeSurface")}</SelectItem>
                                <SelectItem value="ELECTRICAL">{t("products.typeElectrical")}</SelectItem>
                                <SelectItem value="OTHER">{t("products.typeOther")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="pointDescription">{t("products.descriptionLabel")}</Label>
                          <Textarea
                            id="pointDescription"
                            value={pointDescription}
                            onChange={(e) => setPointDescription(e.target.value)}
                            disabled={!isEditMode}
                            rows={2}
                          />
                        </div>

                        {/* Doc 31 MP1/PM6 — component linkage: refDesignator (board
                            position) + componentCode (materials.code) light up the
                            Pareto-by-package analytic. Shown for every point type. */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-2">
                            <Label htmlFor="pointRefDesignator">{t("products.refDesignator", "Ref. designator")}</Label>
                            <Input
                              id="pointRefDesignator"
                              value={pointRefDesignator}
                              onChange={(e) => setPointRefDesignator(e.target.value)}
                              disabled={!isEditMode}
                              placeholder="R12, U3..."
                            />
                            <p className="text-xs text-muted-foreground">{t("products.refDesignatorHint", "Board position of the component this point measures.")}</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="pointComponentCode">{t("products.componentCode", "Component code")}</Label>
                            <Input
                              id="pointComponentCode"
                              value={pointComponentCode}
                              onChange={(e) => setPointComponentCode(e.target.value)}
                              disabled={!isEditMode}
                              placeholder="materials.code"
                            />
                            <p className="text-xs text-muted-foreground">{t("products.componentCodeHint", "Links to the material master (enables Pareto-by-package).")}</p>
                          </div>
                        </div>

                        {/* Vị trí readout (CORE) */}
                        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
                          <p>{t("products.position")}: ({measurementPoints[selectedPointIndex]?.positionX}, {measurementPoints[selectedPointIndex]?.positionY})</p>
                          <p>{t("products.radius")}: {measurementPoints[selectedPointIndex]?.radius}px</p>
                        </div>

                        {/* ── Nhóm gập: Progressive disclosure (doc 43 Đợt 2 §3.1) ── */}
                        <Accordion
                          type="multiple"
                          key={selectedPointIndex ?? -1}
                          defaultValue={["thresholds"]}
                          className="w-full space-y-2"
                        >
                          {/* ①  Ngưỡng & dung sai — chỉ hiện + mở sẵn cho loại có ngưỡng */}
                          {showToleranceSection && (
                            <AccordionItem value="thresholds" className="border rounded-md px-3">
                              <AccordionTrigger className="py-3">{t("products.sectionThresholds", "Ngưỡng & dung sai")}</AccordionTrigger>
                              <AccordionContent className="space-y-4">
                                <div className="space-y-2">
                                  <Label htmlFor="pointToleranceMode">{t("measurementPointP2.toleranceMode")}</Label>
                                  <Select
                                    value={pointToleranceMode}
                                    onValueChange={(v) => setPointToleranceMode(v as ToleranceMode)}
                                    disabled={!isEditMode}
                                  >
                                    <SelectTrigger id="pointToleranceMode">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="range">{t("measurementPointP2.toleranceModes.range")}</SelectItem>
                                      <SelectItem value="bilateral">{t("measurementPointP2.toleranceModes.bilateral")}</SelectItem>
                                      <SelectItem value="min_only">{t("measurementPointP2.toleranceModes.min_only")}</SelectItem>
                                      <SelectItem value="max_only">{t("measurementPointP2.toleranceModes.max_only")}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="pointLowerLimit">{t("products.lowerLimit")}</Label>
                                    <Input
                                      id="pointLowerLimit"
                                      value={pointLowerLimit}
                                      onChange={(e) => setPointLowerLimit(e.target.value)}
                                      onBlur={() => pointValidation.handleBlur("lowerLimit", pointLowerLimit)}
                                      disabled={!isEditMode}
                                      className={pointValidation.hasError("lowerLimit") ? "border-destructive" : ""}
                                    />
                                    <ValidationMessage error={pointValidation.getFieldError("lowerLimit")} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="pointUpperLimit">{t("products.upperLimit")}</Label>
                                    <Input
                                      id="pointUpperLimit"
                                      value={pointUpperLimit}
                                      onChange={(e) => setPointUpperLimit(e.target.value)}
                                      onBlur={() => pointValidation.handleBlur("upperLimit", pointUpperLimit)}
                                      disabled={!isEditMode}
                                      className={pointValidation.hasError("upperLimit") ? "border-destructive" : ""}
                                    />
                                    <ValidationMessage error={pointValidation.getFieldError("upperLimit")} />
                                  </div>
                                </div>
                                {/* AI Threshold Advisor — only for a persisted point in edit mode.
                                    Wave 2 đường A (Task 2): đề xuất ĐANG CHỜ hiện NGAY ở đây (PendingSuggestionCard)
                                    — cạnh nút "xin đề xuất mới" — thay vì chỉ hiện ở /threshold-approvals. */}
                                {isEditMode && selectedPointIndex !== null && measurementPoints[selectedPointIndex]?.id ? (
                                  <>
                                    <PendingSuggestionCard
                                      pointDefId={measurementPoints[selectedPointIndex]!.id as number}
                                      currentUserId={user?.id}
                                      onDecided={refreshSuggestionState}
                                    />
                                    <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
                                      <span className="text-xs text-muted-foreground">
                                        {t("thresholdAdvisor.pointHint", "Để AI tính LSL/USL/mục tiêu từ dữ liệu đo gần đây")}
                                      </span>
                                      <AIThresholdSuggestButton
                                        target={{ kind: "point", measurementPointId: measurementPoints[selectedPointIndex]!.id! }}
                                        onApplied={() => refetchPoints()}
                                        onSubmitted={() => { refetchPoints(); refreshSuggestionState(); }}
                                      />
                                    </div>
                                  </>
                                ) : null}
                                <div className="space-y-2">
                                  <Label htmlFor="pointNominalValue">{t("products.nominalValue")}</Label>
                                  <Input
                                    id="pointNominalValue"
                                    value={pointNominalValue}
                                    onChange={(e) => setPointNominalValue(e.target.value)}
                                    disabled={!isEditMode}
                                  />
                                </div>
                                {pointToleranceMode === "bilateral" && (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointTolPlus">{t("measurementPointP2.tolPlus")}</Label>
                                      <Input
                                        id="pointTolPlus"
                                        value={pointTolPlus}
                                        onChange={(e) => setPointTolPlus(e.target.value)}
                                        disabled={!isEditMode}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointTolMinus">{t("measurementPointP2.tolMinus")}</Label>
                                      <Input
                                        id="pointTolMinus"
                                        value={pointTolMinus}
                                        onChange={(e) => setPointTolMinus(e.target.value)}
                                        disabled={!isEditMode}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div className="space-y-2">
                                  <Label htmlFor="pointUnit">{t("products.unit")}</Label>
                                  <Input
                                    id="pointUnit"
                                    value={pointUnit}
                                    onChange={(e) => setPointUnit(e.target.value)}
                                    disabled={!isEditMode}
                                    placeholder="mm, V, A..."
                                  />
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          )}

                          {/* ②  Nâng cao theo loại — chỉ mount khối đúng loại thực chọn (doc 43 Đợt 2 §3.2) */}
                          <AccordionItem value="advanced" className="border rounded-md px-3">
                            <AccordionTrigger className="py-3">{t("products.sectionAdvanced", "Nâng cao theo loại")}</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              {showGdtSection && (
                                <>
                                  <div className="space-y-2">
                                    <Label htmlFor="pointDatumRefs">{t("measurementPointP2.datumRefs")}</Label>
                                    <Input
                                      id="pointDatumRefs"
                                      value={pointDatumRefsInput}
                                      onChange={(e) => setPointDatumRefsInput(e.target.value)}
                                      disabled={!isEditMode}
                                      placeholder="A,B,C"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointMaterialCondition">{t("measurementPointP2.materialCondition")}</Label>
                                      <Select
                                        value={pointMaterialCondition || "none"}
                                        onValueChange={(v) => setPointMaterialCondition(v === "none" ? "" : (v as MaterialCondition))}
                                        disabled={!isEditMode}
                                      >
                                        <SelectTrigger id="pointMaterialCondition">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">{t("common.none")}</SelectItem>
                                          <SelectItem value="MMC">MMC</SelectItem>
                                          <SelectItem value="LMC">LMC</SelectItem>
                                          <SelectItem value="RFS">RFS</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointFitClass">{t("measurementPointP2.fitClass")}</Label>
                                      <Input
                                        id="pointFitClass"
                                        value={pointFitClass}
                                        onChange={(e) => setPointFitClass(e.target.value)}
                                        disabled={!isEditMode}
                                        placeholder="H7/g6"
                                      />
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* SOLDER — solder paste/joint metrics (height/area/volume + nominal) */}
                              {showSolderSection && (
                                <>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointHeightMin">{t("measurementPointP2.heightMin")}</Label>
                                      <Input id="pointHeightMin" value={pointHeightMin} onChange={(e) => setPointHeightMin(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointHeightMax">{t("measurementPointP2.heightMax")}</Label>
                                      <Input id="pointHeightMax" value={pointHeightMax} onChange={(e) => setPointHeightMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointHeightUnit">{t("measurementPointP2.heightUnit")}</Label>
                                      <Input id="pointHeightUnit" value={pointHeightUnit} onChange={(e) => setPointHeightUnit(e.target.value)} disabled={!isEditMode} placeholder="um" />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointAreaMin">{t("measurementPointP2.areaMin")}</Label>
                                      <Input id="pointAreaMin" value={pointAreaMin} onChange={(e) => setPointAreaMin(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointAreaMax">{t("measurementPointP2.areaMax")}</Label>
                                      <Input id="pointAreaMax" value={pointAreaMax} onChange={(e) => setPointAreaMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointAreaUnit">{t("measurementPointP2.areaUnit")}</Label>
                                      <Input id="pointAreaUnit" value={pointAreaUnit} onChange={(e) => setPointAreaUnit(e.target.value)} disabled={!isEditMode} placeholder="%" />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointVolumeMin">{t("measurementPointP2.volumeMin")}</Label>
                                      <Input id="pointVolumeMin" value={pointVolumeMin} onChange={(e) => setPointVolumeMin(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointVolumeMax">{t("measurementPointP2.volumeMax")}</Label>
                                      <Input id="pointVolumeMax" value={pointVolumeMax} onChange={(e) => setPointVolumeMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointVolumeUnit">{t("measurementPointP2.volumeUnit")}</Label>
                                      <Input id="pointVolumeUnit" value={pointVolumeUnit} onChange={(e) => setPointVolumeUnit(e.target.value)} disabled={!isEditMode} placeholder="%" />
                                    </div>
                                  </div>
                                  {/* Doc 31 MP6 — nominal targets for solder metrics */}
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointHeightNominal">{t("measurementPointP2.heightNominal")}</Label>
                                      <Input id="pointHeightNominal" value={pointHeightNominal} onChange={(e) => setPointHeightNominal(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointAreaNominal">{t("measurementPointP2.areaNominal")}</Label>
                                      <Input id="pointAreaNominal" value={pointAreaNominal} onChange={(e) => setPointAreaNominal(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointVolumeNominal">{t("measurementPointP2.volumeNominal")}</Label>
                                      <Input id="pointVolumeNominal" value={pointVolumeNominal} onChange={(e) => setPointVolumeNominal(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* XRAY — void percentage */}
                              {showXraySection && (
                                <div className="space-y-2">
                                  <Label htmlFor="pointVoidPctMax">{t("measurementPointP2.voidPctMax")}</Label>
                                  <Input id="pointVoidPctMax" value={pointVoidPctMax} onChange={(e) => setPointVoidPctMax(e.target.value)} disabled={!isEditMode} />
                                </div>
                              )}

                              {/* Doc 31 MP6 — BGA coplanarity + warpage (solder/xray) */}
                              {showCoplanaritySection && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="pointCoplanarityMax">{t("measurementPointP2.coplanarityMax")}</Label>
                                    <Input id="pointCoplanarityMax" value={pointCoplanarityMax} onChange={(e) => setPointCoplanarityMax(e.target.value)} disabled={!isEditMode} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="pointWarpageMax">{t("measurementPointP2.warpageMax")}</Label>
                                    <Input id="pointWarpageMax" value={pointWarpageMax} onChange={(e) => setPointWarpageMax(e.target.value)} disabled={!isEditMode} />
                                  </div>
                                </div>
                              )}

                              {/* Doc 31 MP6 — placement offset + tilt + Z (position) */}
                              {showPositionSection && (
                                <>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="space-y-2">
                                      <Label htmlFor="pointOffsetXMax">{t("measurementPointP2.offsetXMax")}</Label>
                                      <Input id="pointOffsetXMax" value={pointOffsetXMax} onChange={(e) => setPointOffsetXMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointOffsetYMax">{t("measurementPointP2.offsetYMax")}</Label>
                                      <Input id="pointOffsetYMax" value={pointOffsetYMax} onChange={(e) => setPointOffsetYMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="pointTiltMax">{t("measurementPointP2.tiltMax")}</Label>
                                      <Input id="pointTiltMax" value={pointTiltMax} onChange={(e) => setPointTiltMax(e.target.value)} disabled={!isEditMode} />
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="pointPositionZ">{t("measurementPointP2.positionZ")}</Label>
                                    <Input id="pointPositionZ" value={pointPositionZ} onChange={(e) => setPointPositionZ(e.target.value)} disabled={!isEditMode} />
                                  </div>
                                </>
                              )}

                              {/* Doc 31 MP6 — coating / surface thickness */}
                              {showCoatingSection && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="pointThicknessMin">{t("measurementPointP2.thicknessMin")}</Label>
                                    <Input id="pointThicknessMin" value={pointThicknessMin} onChange={(e) => setPointThicknessMin(e.target.value)} disabled={!isEditMode} />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="pointThicknessMax">{t("measurementPointP2.thicknessMax")}</Label>
                                    <Input id="pointThicknessMax" value={pointThicknessMax} onChange={(e) => setPointThicknessMax(e.target.value)} disabled={!isEditMode} />
                                  </div>
                                </div>
                              )}

                              {/* Doc 31 MP6 — pass/fail criteria (áp cho mọi loại) */}
                              <PointCriteriaEditor
                                value={pointCriteria}
                                onChange={setPointCriteria}
                                disabled={!isEditMode}
                              />
                            </AccordionContent>
                          </AccordionItem>

                          {/* ③  Chất lượng — dụng cụ / lấy mẫu / góc nhìn + độ sẵn sàng gọn */}
                          <AccordionItem value="quality" className="border rounded-md px-3">
                            <AccordionTrigger className="py-3">{t("products.sectionQuality", "Chất lượng")}</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="pointPreferredInstrument">{t("products.preferredInstrument", "Thiết bị đo ưu tiên")}</Label>
                                <Select
                                  value={pointPreferredInstrumentId?.toString() || "__none"}
                                  onValueChange={(value) => setPointPreferredInstrumentId(value === "__none" ? undefined : parseInt(value, 10))}
                                >
                                  <SelectTrigger id="pointPreferredInstrument" disabled={!isEditMode}>
                                    <SelectValue placeholder={t("products.selectPreferredInstrument", "Chọn dụng cụ ưu tiên")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none">{t("common.none")}</SelectItem>
                                    {(measurementInstruments || []).map((inst: any) => (
                                      <SelectItem key={inst.id} value={String(inst.id)} disabled={!inst.isActive}>
                                        {inst.code} - {inst.name}
                                        {inst.mmPerPixel && ` (cal: ${inst.mmPerPixel} mm/px)`}
                                        {!inst.isActive && " [inactive]"}
                                        {!inst.mmPerPixel && " [uncalibrated]"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {pointPreferredInstrumentId && (
                                  (() => {
                                    const selected = (measurementInstruments || []).find((i: any) => i.id === pointPreferredInstrumentId);
                                    return (
                                      <>
                                        {selected?.isActive === false && (
                                          <p className="text-xs text-warning">⚠️ {t("products.instrumentInactiveWarn", "Dụng cụ đã ngừng hoạt động, sẽ bị từ chối khi lưu.")}</p>
                                        )}
                                        {!selected?.mmPerPixel && (
                                          <p className="text-xs text-warning">⚠️ {t("products.instrumentNoCalWarn", "Dụng cụ chưa hiệu chuẩn mmPerPixel (chỉ dùng toạ độ pixel).")}</p>
                                        )}
                                      </>
                                    );
                                  })()
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="pointPreferredSamplingPlan">{t("products.preferredSamplingPlan", "Kế hoạch lấy mẫu")}</Label>
                                <Select
                                  value={pointPreferredSamplingPlanId?.toString() || "__none"}
                                  onValueChange={(value) => setPointPreferredSamplingPlanId(value === "__none" ? undefined : parseInt(value, 10))}
                                >
                                  <SelectTrigger id="pointPreferredSamplingPlan" disabled={!isEditMode}>
                                    <SelectValue placeholder={t("products.selectSamplingPlan", "Chọn kế hoạch lấy mẫu")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none">{t("common.none")}</SelectItem>
                                    {(samplingPlans || []).map((plan: any) => (
                                      <SelectItem key={plan.id} value={String(plan.id)} disabled={!plan.isActive}>
                                        {plan.code} - {plan.strategy}
                                        {!plan.isActive && " (inactive)"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {pointPreferredSamplingPlanId && (samplingPlans || []).find((p: any) => p.id === pointPreferredSamplingPlanId)?.isActive === false && (
                                  <p className="text-xs text-warning">⚠️ {t("products.samplingInactiveWarn", "Kế hoạch lấy mẫu đã ngừng, sẽ bị từ chối khi lưu.")}</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="pointProductView">{t("products.productViewCamera", "Khung nhìn / Camera")}</Label>
                                <Select
                                  value={pointProductViewId?.toString() || "__none"}
                                  onValueChange={(value) => setPointProductViewId(value === "__none" ? undefined : parseInt(value, 10))}
                                >
                                  <SelectTrigger id="pointProductView" disabled={!isEditMode}>
                                    <SelectValue placeholder={t("products.selectProductView", "Chọn góc nhìn / camera (tuỳ chọn)")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none">{t("products.allViews", "Mọi góc nhìn")}</SelectItem>
                                    {(productViews || []).map((view: any) => (
                                      <SelectItem key={view.id} value={String(view.id)} disabled={!view.isActive}>
                                        {view.viewType === "custom" ? view.name : view.viewType.toUpperCase()} ({view.code})
                                        {!view.isActive && " [inactive]"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {pointProductViewId && (productViews || []).find((v: any) => v.id === pointProductViewId)?.isActive === false && (
                                  <p className="text-xs text-warning">⚠️ {t("products.viewInactiveWarn", "Góc nhìn đã ngừng, sẽ bị từ chối khi lưu.")}</p>
                                )}
                              </div>

                              {/* Độ sẵn sàng chất lượng — gọn 1 dòng (thay box P3.3 lặp) */}
                              {selectedPointIndex !== null && (() => {
                                const instrument = (measurementInstruments || []).find((i: any) => i.id === pointPreferredInstrumentId);
                                const samplingPlan = (samplingPlans || []).find((p: any) => p.id === pointPreferredSamplingPlanId);
                                const hasCalibration = !!instrument?.mmPerPixel;
                                const hasAQL = !!(samplingPlan?.aqlCritical || samplingPlan?.aqlMajor || samplingPlan?.aqlMinor);
                                const hasView = pointProductViewId !== undefined;
                                const readinessCount = (hasCalibration ? 1 : 0) + (hasAQL ? 1 : 0) + (hasView ? 1 : 0);
                                const ready = readinessCount === 3;
                                const partial = readinessCount === 2;
                                const color = ready ? "text-success" : partial ? "text-warning" : "text-destructive";
                                const icon = ready ? "✓" : partial ? "⚠️" : "❌";
                                const label = ready
                                  ? t("products.readinessReady", "Sẵn sàng")
                                  : partial
                                    ? t("products.readinessPartial", "Một phần")
                                    : t("products.readinessIncomplete", "Chưa đủ");
                                return (
                                  <p className={`text-xs ${color}`}>
                                    {icon} {t("products.qualityReadiness", "Mức sẵn sàng chất lượng")}: <span className="font-semibold">{label}</span> ({readinessCount}/3)
                                  </p>
                                );
                              })()}
                            </AccordionContent>
                          </AccordionItem>

                          {/* ④  Ảnh & vùng cắt — ảnh tham chiếu / workstation / vùng cắt / công thức chiếu sáng */}
                          <AccordionItem value="image" className="border rounded-md px-3">
                            <AccordionTrigger className="py-3">{t("products.sectionImage", "Ảnh & vùng cắt")}</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              {/* Reference Image for Point */}
                              <div className="space-y-2">
                                <Label>{t("products.pointReferenceImage")}</Label>
                                {pointReferenceImageUrl && (
                                  <div className="relative">
                                    <img
                                      src={pointReferenceImageUrl}
                                      alt="Point reference"
                                      className="w-full rounded border"
                                    />
                                    {isEditMode && (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="absolute top-1 right-1 h-6 w-6 p-0"
                                        onClick={() => setPointReferenceImageUrl("")}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                )}
                                {!pointReferenceImageUrl && !isEditMode && (
                                  <div className="flex items-center justify-center h-20 bg-muted/30 rounded border border-dashed text-muted-foreground text-sm">
                                    <ImageIcon className="h-4 w-4 mr-1" />
                                    {t("products.noReferenceImagePoint")}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="pointWorkstation">{t("products.workstationOptional")}</Label>
                                <Select value={pointWorkstationId?.toString() || ""} onValueChange={(value) => setPointWorkstationId(value ? parseInt(value) : undefined)}>
                                  <SelectTrigger id="pointWorkstation" disabled={!isEditMode}>
                                    <SelectValue placeholder={t("products.selectWorkstation")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {workstations?.map((ws) => (
                                      <SelectItem key={ws.id} value={ws.id.toString()}>
                                        <div className="flex items-center gap-2">
                                          <span>{ws.code} - {ws.name}</span>
                                          <Badge variant={ws.isActive ? "default" : "secondary"} className="ml-2">
                                            {ws.isActive ? t('common.active') : t('common.inactive')}
                                          </Badge>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Vùng cắt ảnh mẫu */}
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">{t("products.cropAreaLabel")}</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label htmlFor="cropWidth" className="text-xs text-muted-foreground">{t("products.width")} (px)</Label>
                                    <Input
                                      id="cropWidth"
                                      type="number"
                                      value={pointCropWidth}
                                      onChange={(e) => setPointCropWidth(parseInt(e.target.value) || 100)}
                                      disabled={!isEditMode}
                                      min={20}
                                      max={500}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="cropHeight" className="text-xs text-muted-foreground">{t("products.height")} (px)</Label>
                                    <Input
                                      id="cropHeight"
                                      type="number"
                                      value={pointCropHeight}
                                      onChange={(e) => setPointCropHeight(parseInt(e.target.value) || 100)}
                                      disabled={!isEditMode}
                                      min={20}
                                      max={500}
                                    />
                                  </div>
                                </div>
                                {/* Image Source Mode Selection */}
                                <div className="flex gap-2 mt-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={imageSourceMode === "auto-crop" ? "default" : "outline"}
                                    onClick={() => setImageSourceMode("auto-crop")}
                                    className="flex-1 text-xs"
                                    disabled={!isEditMode}
                                  >
                                    {t("products.autoCrop")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={imageSourceMode === "upload" ? "default" : "outline"}
                                    onClick={() => setImageSourceMode("upload")}
                                    className="flex-1 text-xs"
                                    disabled={!isEditMode}
                                  >
                                    {t("products.uploadImage")}
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {imageSourceMode === "auto-crop"
                                    ? t("products.autoCropDesc")
                                    : t("products.uploadDesc")}
                                </p>
                                {imageSourceMode === "upload" && isEditMode && (
                                  <div className="mt-2">
                                    <Label htmlFor="pointImageUpload" className="text-xs text-muted-foreground">{t("products.uploadPointImage")}</Label>
                                    <Input
                                      id="pointImageUpload"
                                      type="file"
                                      accept="image/*"
                                      onChange={handlePointImageUpload}
                                      className="text-xs"
                                    />
                                  </div>
                                )}
                              </div>

                              {/* Doc 31 MP6 — per-point lighting recipe (công thức chiếu sáng) */}
                              {selectedPointIndex !== null && measurementPoints[selectedPointIndex]?.id ? (
                                <PointLightingEditor
                                  pointDefId={measurementPoints[selectedPointIndex]!.id as number}
                                  canEdit={isEditMode && (user?.role === "admin")}
                                />
                              ) : (
                                <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
                                  {t("measurementPointP2.lightingSaveFirst")}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>

                        {/* Doc 43 Đợt 4 (A) — báo trước khi đổi ngưỡng trên sản phẩm
                            active sẽ phải qua hàng đợi duyệt (thay vì toast 403 im lặng). */}
                        {isEditMode && saveWillRequireApproval && (
                          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 mt-2">
                            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                            <p className="text-xs text-warning">
                              {t("products.thresholdApprovalBanner", "Sản phẩm đang hoạt động — thay đổi ngưỡng cần được duyệt. Nhấn “Gửi yêu cầu duyệt” để tạo yêu cầu.")}
                            </p>
                          </div>
                        )}
                        {isEditMode && (
                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              onClick={handleSavePoint}
                              className="flex-1"
                              disabled={isSavingPoint}
                            >
                              {isSavingPoint ? (
                                <>
                                  <div className="h-4 w-4 mr-1 animate-spin rounded-full border-2 border-background border-t-transparent" />
                                  {t("products.saving")}
                                </>
                              ) : saveWillRequireApproval ? (
                                <>
                                  <Save className="h-4 w-4 mr-1" />
                                  {t("products.submitForApproval", "Gửi yêu cầu duyệt")}
                                </>
                              ) : (
                                <>
                                  <Save className="h-4 w-4 mr-1" />
                                  {t("common.save")}
                                </>
                              )}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={confirmDeletePoint} disabled={isSavingPoint}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground border rounded-lg bg-muted/20">
                      <div className="text-center">
                        <MousePointer className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t("products.selectPointToView")}</p>
                        {isEditMode && (
                          <p className="text-xs mt-1">{t("products.orClickAddPoint")}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
    </>
  );
}
