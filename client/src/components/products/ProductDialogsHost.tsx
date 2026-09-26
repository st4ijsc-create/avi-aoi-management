/**
 * Khối C Task 14 (QĐ-4, spec §"Tách shell") — "Product Dialogs Host": 13 dialog
 * của `ProductModels.tsx` được điều khiển HOÀN TOÀN qua prop `open`/`onOpenChange`
 * (không tự vẽ nút trigger). Radix `Dialog`/`AlertDialog` PORTAL nội dung ra
 * `document.body` khi mở — vị trí JSX của các component này KHÔNG ảnh hưởng vị
 * trí hiển thị trên màn hình, nên gom về một component riêng là DI CHUYỂN CƠ
 * HỌC (mechanical relocation), không đổi hành vi.
 *
 * PURE RELOCATION — cùng khuôn `PointDetailsForm.tsx`/`MsaStudyDialog.tsx`:
 * trang vẫn giữ TOÀN BỘ state/query/mutation/handler, chỉ truyền xuống 1:1 qua
 * props (tên giữ nguyên); `t` tự lấy lại qua hook cục bộ.
 *
 * ⚠ KHÔNG gồm `CreateProductDialog` — nó TỰ mang `DialogTrigger` (nút "Thêm sản
 * phẩm" nằm NGAY TRONG component đó), nên di chuyển ra đây sẽ làm nút biến mất
 * khỏi header danh sách sản phẩm — ĐÓ MỚI đổi hành vi. Nó ở lại
 * `ProductListPanel.tsx` (xem docblock file đó).
 * ⚠ KHÔNG sửa `BulkImportDialog.tsx` — chỉ MOUNT của nó đổi vị trí ở đây; nội
 * dung file đó không bị chạm (R-KC-8, còn allowlist BG-107, di trú alias-map
 * là việc khác, ngoài phạm vi Task 14).
 */

import type { ChangeEvent, ComponentProps, Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProductFiducialsTab } from "@/components/product-fiducials/ProductFiducialsTab";
import ProgramReleasePanel from "@/components/program-release/ProgramReleasePanel";
import PanelDefinitionPanel from "@/components/panel/PanelDefinitionPanel";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import { CentroidImportDialog } from "@/components/products/CentroidImportDialog";
import { EditProductDialog } from "@/components/products/EditProductDialog";
import { CloneProductDialog } from "@/components/products/CloneProductDialog";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";
import { PointTemplateDialog, type PointTemplateRow } from "@/components/products/PointTemplateDialog";
import { BatchSuggestDialog } from "@/components/productModels/BatchSuggestDialog";
import { MsaStudyDialog } from "@/components/productModels/MsaStudyDialog";
import { trpc } from "@/lib/trpc";
import { type MeasurementPoint, type ProductModel } from "@/components/productModels/types";

interface ProductDialogsHostProps extends ComponentProps<typeof MsaStudyDialog> {
  // ── W3-C / UX1 / W8-B — Dialog thô (không trigger riêng, chỉ open/onOpenChange) ──
  isProgramReleaseOpen: boolean;
  setIsProgramReleaseOpen: Dispatch<SetStateAction<boolean>>;
  isFiducialsOpen: boolean;
  setIsFiducialsOpen: Dispatch<SetStateAction<boolean>>;
  isPanelDefOpen: boolean;
  setIsPanelDefOpen: Dispatch<SetStateAction<boolean>>;

  // ── Edit Product ──
  isEditProductDialogOpen: boolean;
  setIsEditProductDialogOpen: Dispatch<SetStateAction<boolean>>;
  editProductCode: string;
  setEditProductCode: Dispatch<SetStateAction<string>>;
  editProductName: string;
  setEditProductName: Dispatch<SetStateAction<string>>;
  editProductDescription: string;
  setEditProductDescription: Dispatch<SetStateAction<string>>;
  editProductCategory: string;
  setEditProductCategory: Dispatch<SetStateAction<string>>;
  editProductLine: string;
  setEditProductLine: Dispatch<SetStateAction<string>>;
  editProductVariant: string;
  setEditProductVariant: Dispatch<SetStateAction<string>>;
  editProductLifecycle: "development" | "active" | "eol" | "archived";
  setEditProductLifecycle: Dispatch<SetStateAction<"development" | "active" | "eol" | "archived">>;
  editProductRevision: string;
  setEditProductRevision: Dispatch<SetStateAction<string>>;
  editProductTargetYield: string;
  setEditProductTargetYield: Dispatch<SetStateAction<string>>;
  editProductMinYield: string;
  setEditProductMinYield: Dispatch<SetStateAction<string>>;
  editProductDisplayMode: "contain" | "cover" | "stretch" | "none";
  setEditProductDisplayMode: Dispatch<SetStateAction<"contain" | "cover" | "stretch" | "none">>;
  editProductImageUrl: string;
  handleEditImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  handleUpdateProduct: () => void;
  updateProductMutation: ReturnType<typeof trpc.productModel.update.useMutation>;

  // ── Delete Product ──
  isDeleteProductDialogOpen: boolean;
  setIsDeleteProductDialogOpen: Dispatch<SetStateAction<boolean>>;
  handleDeleteProduct: () => void;
  deleteProductMutation: ReturnType<typeof trpc.productModel.delete.useMutation>;

  // ── Clone Product ──
  isCloneProductDialogOpen: boolean;
  setIsCloneProductDialogOpen: Dispatch<SetStateAction<boolean>>;
  cloneSourceProduct: ProductModel | null;
  cloneNewCode: string;
  setCloneNewCode: Dispatch<SetStateAction<string>>;
  cloneNewName: string;
  setCloneNewName: Dispatch<SetStateAction<string>>;
  cloneNewRevision: string;
  setCloneNewRevision: Dispatch<SetStateAction<string>>;
  cloneCopyMappings: boolean;
  setCloneCopyMappings: Dispatch<SetStateAction<boolean>>;
  handleCloneProduct: () => void;
  cloneProductMutation: ReturnType<typeof trpc.productModel.clone.useMutation>;

  // ── Delete Point ──
  isDeletePointDialogOpen: boolean;
  setIsDeletePointDialogOpen: Dispatch<SetStateAction<boolean>>;
  selectedPointIndex: number | null;
  handleDeletePoint: () => void;
  deletePointMutation: ReturnType<typeof trpc.measurementPoint.delete.useMutation>;

  // ── Xung đột optimistic-lock (Doc 31 UX3) ──
  pointConflict: { current: Record<string, any>; loaded: MeasurementPoint; pointData: Record<string, any>; pointId: number } | null;
  setPointConflict: Dispatch<
    SetStateAction<{ current: Record<string, any>; loaded: MeasurementPoint; pointData: Record<string, any>; pointId: number } | null>
  >;
  handleReloadConflict: () => void;
  handleOverwriteConflict: () => void;
  isSavingPoint: boolean;

  // ── Bulk Import / Centroid Import ──
  isBulkImportDialogOpen: boolean;
  setIsBulkImportDialogOpen: Dispatch<SetStateAction<boolean>>;
  isCentroidImportOpen: boolean;
  setIsCentroidImportOpen: Dispatch<SetStateAction<boolean>>;
  refetchPoints: () => void;

  // ── Template Dialog ──
  isTemplateDialogOpen: boolean;
  setIsTemplateDialogOpen: Dispatch<SetStateAction<boolean>>;
  templateName: string;
  setTemplateName: Dispatch<SetStateAction<string>>;
  templateCategory: string;
  setTemplateCategory: Dispatch<SetStateAction<string>>;
  templateDescription: string;
  setTemplateDescription: Dispatch<SetStateAction<string>>;
  isSavingTemplate: boolean;
  templates: PointTemplateRow[] | undefined;
  handleSaveAsTemplate: () => void;
  handleApplyTemplate: (template: { id: number; name: string; points?: unknown }) => void;
  deleteTemplateMutation: ReturnType<typeof trpc.template.delete.useMutation>;

  // ── Batch Suggest (Wave 2 đường A, Task 3) ──
  isBatchSuggestOpen: boolean;
  selectedPointIds: Set<number>;
  setIsBatchSuggestOpen: Dispatch<SetStateAction<boolean>>;
}

export function ProductDialogsHost(props: ProductDialogsHostProps) {
  const { t } = useTranslation();
  const {
    isProgramReleaseOpen, setIsProgramReleaseOpen, isFiducialsOpen, setIsFiducialsOpen,
    isPanelDefOpen, setIsPanelDefOpen, selectedProduct,
    isEditProductDialogOpen, setIsEditProductDialogOpen, editProductCode, setEditProductCode,
    editProductName, setEditProductName, editProductDescription, setEditProductDescription,
    editProductCategory, setEditProductCategory, editProductLine, setEditProductLine,
    editProductVariant, setEditProductVariant, editProductLifecycle, setEditProductLifecycle,
    editProductRevision, setEditProductRevision, editProductTargetYield, setEditProductTargetYield,
    editProductMinYield, setEditProductMinYield, editProductDisplayMode, setEditProductDisplayMode,
    editProductImageUrl, handleEditImageUpload, handleUpdateProduct, updateProductMutation,
    isDeleteProductDialogOpen, setIsDeleteProductDialogOpen, handleDeleteProduct, deleteProductMutation,
    isCloneProductDialogOpen, setIsCloneProductDialogOpen, cloneSourceProduct,
    cloneNewCode, setCloneNewCode, cloneNewName, setCloneNewName,
    cloneNewRevision, setCloneNewRevision, cloneCopyMappings, setCloneCopyMappings,
    handleCloneProduct, cloneProductMutation,
    isDeletePointDialogOpen, setIsDeletePointDialogOpen, selectedPointIndex, handleDeletePoint, deletePointMutation,
    pointConflict, setPointConflict, handleReloadConflict, handleOverwriteConflict, isSavingPoint,
    isBulkImportDialogOpen, setIsBulkImportDialogOpen, isCentroidImportOpen, setIsCentroidImportOpen, refetchPoints,
    isTemplateDialogOpen, setIsTemplateDialogOpen, templateName, setTemplateName,
    templateCategory, setTemplateCategory, templateDescription, setTemplateDescription,
    isSavingTemplate, measurementPoints, templates, handleSaveAsTemplate, handleApplyTemplate, deleteTemplateMutation,
    isBatchSuggestOpen, selectedPointIds, setIsBatchSuggestOpen,
    addMsaObservationMutation, batchAddMsaObservationsMutation, completeMsaStudyMutation,
    generateMsaMatrixMutation, handleAddMsaObservation, handleApplyMsaCsvMapping,
    handleApplyMsaPreset, handleBatchImportMsaObservations, handleCompleteMsaStudy,
    handleDeleteMsaCsvPreset, handleFillNextMsaCell, handleGenerateMsaMatrix,
    handleLoadMsaCsvPreset, handleMsaCsvFileSelected, handleSaveMsaCsvPreset,
    handleStartMsaStudy, isMsaDialogOpen, measurementInstruments,
    msaAutoAddNext, msaBatchInput, msaBatchPreview, msaBatchSkipDuplicates, msaCellStats,
    msaCsvColumnMap, msaCsvFileInputRef, msaCsvHasHeader, msaCsvHeaders,
    msaCsvPresetName, msaCsvPresetOptions, msaCsvRows, msaCsvSelectedPresetKey,
    msaCsvSourceKey, msaInstrumentId, msaLastSummary, msaMatrixBaseValue,
    msaMatrixNoisePct, msaMatrixOverwriteExisting, msaMeasuredValue,
    msaMeasurementPointId, msaOperatorCount, msaOperatorName,
    msaPartCount, msaPartLabel, msaStudyCode,
    msaStudyData, msaStudyName, msaSuggestBaseValue,
    msaTrialCount, msaTrialNo, msaWizardStep,
    setIsMsaDialogOpen, setMsaAutoAddNext,
    setMsaBatchInput, setMsaBatchSkipDuplicates, setMsaCsvColumnMap,
    setMsaCsvHasHeader, setMsaCsvPresetName, setMsaCsvSourceKey,
    setMsaInstrumentId, setMsaMatrixBaseValue, setMsaMatrixNoisePct,
    setMsaMatrixOverwriteExisting, setMsaMeasuredValue, setMsaMeasurementPointId,
    setMsaOperatorCount, setMsaOperatorName, setMsaPartCount,
    setMsaPartLabel, setMsaStudyCode, setMsaStudyName,
    setMsaSuggestBaseValue, setMsaTrialCount, setMsaTrialNo,
    setMsaWizardStep, startMsaStudyMutation,
  } = props;

  return (
    <>
      {/* W3-C (doc 27 §2 M9) — Phát hành chương trình (inspection-program release workflow) */}
      <Dialog open={isProgramReleaseOpen} onOpenChange={setIsProgramReleaseOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("programRelease.title")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("programRelease.desc")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isProgramReleaseOpen && (
            <ProgramReleasePanel productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      {/* Doc 31 UX1 (WD-1) — Fiducial marks editor (mounts the orphaned ProductFiducialsTab) */}
      <Dialog open={isFiducialsOpen} onOpenChange={setIsFiducialsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("products.fiducialsButton", "Fiducials")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("products.fiducialsDesc", "Alignment fiducial marks used to register the board before inspection.")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isFiducialsOpen && (
            <ProductFiducialsTab productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      {/* W8-B (doc 29 §2 — M12b) — Panel N-up definition editor */}
      <Dialog open={isPanelDefOpen} onOpenChange={setIsPanelDefOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("panelDef.title")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("panelDef.desc")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isPanelDefOpen && (
            <PanelDefinitionPanel productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      <MsaStudyDialog
        addMsaObservationMutation={addMsaObservationMutation} batchAddMsaObservationsMutation={batchAddMsaObservationsMutation} completeMsaStudyMutation={completeMsaStudyMutation}
        generateMsaMatrixMutation={generateMsaMatrixMutation} handleAddMsaObservation={handleAddMsaObservation} handleApplyMsaCsvMapping={handleApplyMsaCsvMapping}
        handleApplyMsaPreset={handleApplyMsaPreset} handleBatchImportMsaObservations={handleBatchImportMsaObservations} handleCompleteMsaStudy={handleCompleteMsaStudy}
        handleDeleteMsaCsvPreset={handleDeleteMsaCsvPreset} handleFillNextMsaCell={handleFillNextMsaCell} handleGenerateMsaMatrix={handleGenerateMsaMatrix}
        handleLoadMsaCsvPreset={handleLoadMsaCsvPreset} handleMsaCsvFileSelected={handleMsaCsvFileSelected} handleSaveMsaCsvPreset={handleSaveMsaCsvPreset}
        handleStartMsaStudy={handleStartMsaStudy} isMsaDialogOpen={isMsaDialogOpen} measurementInstruments={measurementInstruments}
        measurementPoints={measurementPoints} msaAutoAddNext={msaAutoAddNext} msaBatchInput={msaBatchInput}
        msaBatchPreview={msaBatchPreview} msaBatchSkipDuplicates={msaBatchSkipDuplicates} msaCellStats={msaCellStats}
        msaCsvColumnMap={msaCsvColumnMap} msaCsvFileInputRef={msaCsvFileInputRef} msaCsvHasHeader={msaCsvHasHeader}
        msaCsvHeaders={msaCsvHeaders} msaCsvPresetName={msaCsvPresetName} msaCsvPresetOptions={msaCsvPresetOptions}
        msaCsvRows={msaCsvRows} msaCsvSelectedPresetKey={msaCsvSelectedPresetKey} msaCsvSourceKey={msaCsvSourceKey}
        msaInstrumentId={msaInstrumentId} msaLastSummary={msaLastSummary} msaMatrixBaseValue={msaMatrixBaseValue}
        msaMatrixNoisePct={msaMatrixNoisePct} msaMatrixOverwriteExisting={msaMatrixOverwriteExisting} msaMeasuredValue={msaMeasuredValue}
        msaMeasurementPointId={msaMeasurementPointId} msaOperatorCount={msaOperatorCount} msaOperatorName={msaOperatorName}
        msaPartCount={msaPartCount} msaPartLabel={msaPartLabel} msaStudyCode={msaStudyCode}
        msaStudyData={msaStudyData} msaStudyName={msaStudyName} msaSuggestBaseValue={msaSuggestBaseValue}
        msaTrialCount={msaTrialCount} msaTrialNo={msaTrialNo} msaWizardStep={msaWizardStep}
        selectedProduct={selectedProduct} setIsMsaDialogOpen={setIsMsaDialogOpen} setMsaAutoAddNext={setMsaAutoAddNext}
        setMsaBatchInput={setMsaBatchInput} setMsaBatchSkipDuplicates={setMsaBatchSkipDuplicates} setMsaCsvColumnMap={setMsaCsvColumnMap}
        setMsaCsvHasHeader={setMsaCsvHasHeader} setMsaCsvPresetName={setMsaCsvPresetName} setMsaCsvSourceKey={setMsaCsvSourceKey}
        setMsaInstrumentId={setMsaInstrumentId} setMsaMatrixBaseValue={setMsaMatrixBaseValue} setMsaMatrixNoisePct={setMsaMatrixNoisePct}
        setMsaMatrixOverwriteExisting={setMsaMatrixOverwriteExisting} setMsaMeasuredValue={setMsaMeasuredValue} setMsaMeasurementPointId={setMsaMeasurementPointId}
        setMsaOperatorCount={setMsaOperatorCount} setMsaOperatorName={setMsaOperatorName} setMsaPartCount={setMsaPartCount}
        setMsaPartLabel={setMsaPartLabel} setMsaStudyCode={setMsaStudyCode} setMsaStudyName={setMsaStudyName}
        setMsaSuggestBaseValue={setMsaSuggestBaseValue} setMsaTrialCount={setMsaTrialCount} setMsaTrialNo={setMsaTrialNo}
        setMsaWizardStep={setMsaWizardStep} startMsaStudyMutation={startMsaStudyMutation}
      />

      {/* Edit Product Dialog — Doc 31 UX4 (WE-3): extracted to components/products/EditProductDialog */}
      <EditProductDialog
        open={isEditProductDialogOpen}
        onOpenChange={setIsEditProductDialogOpen}
        code={editProductCode} setCode={setEditProductCode}
        name={editProductName} setName={setEditProductName}
        description={editProductDescription} setDescription={setEditProductDescription}
        category={editProductCategory} setCategory={setEditProductCategory}
        line={editProductLine} setLine={setEditProductLine}
        variant={editProductVariant} setVariant={setEditProductVariant}
        lifecycle={editProductLifecycle} setLifecycle={setEditProductLifecycle}
        revision={editProductRevision} setRevision={setEditProductRevision}
        targetYield={editProductTargetYield} setTargetYield={setEditProductTargetYield}
        minYield={editProductMinYield} setMinYield={setEditProductMinYield}
        displayMode={editProductDisplayMode} setDisplayMode={setEditProductDisplayMode}
        imageUrl={editProductImageUrl}
        currentImageUrl={selectedProduct?.referenceImageUrl}
        onImageUpload={handleEditImageUpload}
        onSave={handleUpdateProduct}
        isSaving={updateProductMutation.isPending}
      />

      {/* Delete Product Confirmation */}
      <DeleteConfirmDialog
        open={isDeleteProductDialogOpen}
        onOpenChange={setIsDeleteProductDialogOpen}
        itemType={t("products.productItemType")}
        itemName={selectedProduct?.name}
        onConfirm={handleDeleteProduct}
        isLoading={deleteProductMutation.isPending}
      />

      {/* Clone Product Dialog — Doc 31 PM1 (WC-2) · UX4 (WE-3): extracted to components/products/CloneProductDialog */}
      <CloneProductDialog
        open={isCloneProductDialogOpen}
        onOpenChange={setIsCloneProductDialogOpen}
        sourceProduct={cloneSourceProduct}
        newCode={cloneNewCode} setNewCode={setCloneNewCode}
        newName={cloneNewName} setNewName={setCloneNewName}
        newRevision={cloneNewRevision} setNewRevision={setCloneNewRevision}
        copyMappings={cloneCopyMappings} setCopyMappings={setCloneCopyMappings}
        onClone={handleCloneProduct}
        isCloning={cloneProductMutation.isPending}
      />

      {/* Delete Point Confirmation */}
      <DeleteConfirmDialog
        open={isDeletePointDialogOpen}
        onOpenChange={setIsDeletePointDialogOpen}
        itemType={t("products.pointItemType")}
        itemName={selectedPointIndex !== null ? measurementPoints[selectedPointIndex]?.name : undefined}
        onConfirm={handleDeletePoint}
        isLoading={deletePointMutation.isPending}
      />

      {/* Doc 31 UX3 — optimistic-lock conflict: reload vs overwrite-anyway */}
      <AlertDialog open={pointConflict !== null} onOpenChange={(o) => { if (!o) setPointConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t("products.conflict.title", "Điểm đo đã bị thay đổi")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "products.conflict.body",
                "Một người khác đã thay đổi điểm đo này kể từ khi bạn mở. Tải lại để xem thay đổi của họ, hoặc ghi đè bằng thay đổi của bạn.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pointConflict && (() => {
            const fields: Array<[string, string]> = [
              ["code", t("products.pointCode", "Code")],
              ["name", t("common.name", "Name")],
              ["lowerLimit", t("products.lowerLimit", "Lower limit")],
              ["upperLimit", t("products.upperLimit", "Upper limit")],
              ["nominalValue", t("products.nominalValue", "Nominal")],
              ["componentCode", t("products.componentCode", "Component")],
              ["refDesignator", t("products.refDesignator", "RefDes")],
              ["positionX", "X"],
              ["positionY", "Y"],
              ["radius", t("products.radius", "Radius")],
            ];
            const norm = (v: any) => (v === null || v === undefined ? "" : String(v));
            const changed = fields.filter(([k]) => norm(pointConflict.current[k]) !== norm((pointConflict.loaded as any)[k]));
            if (changed.length === 0) return null;
            return (
              <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
                <p className="font-medium mb-1">{t("products.conflict.theirChanges", "Thay đổi của người khác:")}</p>
                <ul className="space-y-0.5">
                  {changed.map(([k, label]) => (
                    <li key={k} className="flex items-center gap-1">
                      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                      <span className="line-through text-destructive/80">{norm((pointConflict.loaded as any)[k]) || "—"}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-success font-medium">{norm(pointConflict.current[k]) || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPointConflict(null)}>
              {t("common.cancel", "Hủy")}
            </AlertDialogCancel>
            <Button variant="outline" onClick={handleReloadConflict} disabled={isSavingPoint}>
              {t("products.conflict.reload", "Tải lại")}
            </Button>
            <Button variant="destructive" onClick={handleOverwriteConflict} disabled={isSavingPoint}>
              {t("products.conflict.overwrite", "Ghi đè")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Import Dialog */}
      {selectedProduct && (
        <BulkImportDialog
          open={isBulkImportDialogOpen}
          onOpenChange={setIsBulkImportDialogOpen}
          productModelId={selectedProduct.id}
          productModelName={selectedProduct.name}
          onSuccess={() => {
            refetchPoints();
          }}
        />
      )}

      {/* Doc 31 MP5/PM4 (Đợt C) — centroid / pick-place import wizard */}
      {selectedProduct && (
        <CentroidImportDialog
          open={isCentroidImportOpen}
          onOpenChange={setIsCentroidImportOpen}
          productModelId={selectedProduct.id}
          productModelName={selectedProduct.name}
          onSuccess={() => {
            refetchPoints();
          }}
        />
      )}

      {/* Template Dialog — Doc 31 UX4 (WE-3): extracted to components/products/PointTemplateDialog */}
      <PointTemplateDialog
        open={isTemplateDialogOpen}
        onOpenChange={setIsTemplateDialogOpen}
        name={templateName} setName={setTemplateName}
        category={templateCategory} setCategory={setTemplateCategory}
        description={templateDescription} setDescription={setTemplateDescription}
        isSaving={isSavingTemplate}
        pointCount={measurementPoints.length}
        templates={templates}
        onSaveAsTemplate={handleSaveAsTemplate}
        onApplyTemplate={handleApplyTemplate}
        onDeleteTemplate={(id) => deleteTemplateMutation.mutate({ id })}
      />

      {/* Wave 2 đường A (Task 3) — đề xuất ngưỡng hàng loạt cho N điểm đã chọn.
          Vòng sửa 1 (review Task 3, Minor #3) — bỏ prop currentUserId chết (dialog
          này chỉ ĐỀ XUẤT, không DUYỆT, nên không cần biết ai đang thao tác). */}
      <BatchSuggestDialog
        open={isBatchSuggestOpen}
        pointDefIds={Array.from(selectedPointIds)}
        onClose={() => setIsBatchSuggestOpen(false)}
      />
    </>
  );
}
