/**
 * doc 48 R4 (tech-debt) — "Product Foundation tab body" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction } from "react";
import { type RouterOutputs, type ProductModel } from "./types";
import { useAuth } from "@/_core/hooks/useAuth";
import { PermissionGate } from "@/components/PermissionGate";
import { ProductLotAcceptancePanel } from "@/components/products/ProductLotAcceptancePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Eye, Layers, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ProductFoundationTabProps {
  createInstrumentMutation: ReturnType<typeof trpc.measurementInstrument.create.useMutation>;
  createProductViewMutation: ReturnType<typeof trpc.productView.create.useMutation>;
  createSamplingPlanMutation: ReturnType<typeof trpc.samplingPlan.create.useMutation>;
  deleteInstrumentMutation: ReturnType<typeof trpc.measurementInstrument.delete.useMutation>;
  deleteProductViewMutation: ReturnType<typeof trpc.productView.delete.useMutation>;
  deleteSamplingPlanMutation: ReturnType<typeof trpc.samplingPlan.delete.useMutation>;
  handleCreateInstrument: () => void;
  handleCreateProductView: () => void;
  handleCreateSamplingPlan: () => void;
  measurementInstruments: RouterOutputs["measurementInstrument"]["list"] | undefined;
  msaStudies: RouterOutputs["msaWizard"]["listByProduct"] | undefined;
  newInstrumentCode: string;
  newInstrumentName: string;
  newInstrumentType: string;
  newSamplingCode: string;
  newSamplingName: string;
  newSamplingStrategy: "fixed_n" | "aql" | "risk_based";
  newViewCode: string;
  newViewName: string;
  newViewType: "top" | "bottom" | "side" | "isometric" | "custom";
  openMsaWizard: () => void;
  productViews: RouterOutputs["productView"]["listByProduct"] | undefined;
  samplingPlans: RouterOutputs["samplingPlan"]["listByProduct"] | undefined;
  selectedProduct: ProductModel | null;
  setIsMsaDialogOpen: Dispatch<SetStateAction<boolean>>;
  setMsaWizardStep: Dispatch<SetStateAction<1 | 2 | 3>>;
  setNewInstrumentCode: Dispatch<SetStateAction<string>>;
  setNewInstrumentName: Dispatch<SetStateAction<string>>;
  setNewInstrumentType: Dispatch<SetStateAction<string>>;
  setNewSamplingCode: Dispatch<SetStateAction<string>>;
  setNewSamplingName: Dispatch<SetStateAction<string>>;
  setNewSamplingStrategy: Dispatch<SetStateAction<"fixed_n" | "aql" | "risk_based">>;
  setNewViewCode: Dispatch<SetStateAction<string>>;
  setNewViewName: Dispatch<SetStateAction<string>>;
  setNewViewType: Dispatch<SetStateAction<"top" | "bottom" | "side" | "isometric" | "custom">>;
  setSelectedMsaStudyId: Dispatch<SetStateAction<number | undefined>>;
}

export function ProductFoundationTab(props: ProductFoundationTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    createInstrumentMutation, createProductViewMutation, createSamplingPlanMutation, deleteInstrumentMutation,
    deleteProductViewMutation, deleteSamplingPlanMutation, handleCreateInstrument, handleCreateProductView,
    handleCreateSamplingPlan, measurementInstruments, msaStudies, newInstrumentCode,
    newInstrumentName, newInstrumentType, newSamplingCode, newSamplingName,
    newSamplingStrategy, newViewCode, newViewName, newViewType,
    openMsaWizard, productViews, samplingPlans, selectedProduct,
    setIsMsaDialogOpen, setMsaWizardStep, setNewInstrumentCode, setNewInstrumentName,
    setNewInstrumentType, setNewSamplingCode, setNewSamplingName, setNewSamplingStrategy,
    setNewViewCode, setNewViewName, setNewViewType, setSelectedMsaStudyId,
  } = props;
  return (
    <>
                <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2">
                  <Layers className="h-4 w-4 text-info shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    {t("products.foundationBanner", "Đây là dữ liệu chuẩn dùng chung — cũng quản lý được trong Cài đặt › Chất lượng.")}
                  </p>
                </div>
              <div className="border-t pt-4 mt-4 space-y-4">
                <h3 className="font-semibold text-sm">{t("products.foundationSection")}</h3>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.instruments")}</h4>
                      <Badge variant="secondary">{measurementInstruments?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newInstrumentCode}
                        onChange={(e) => setNewInstrumentCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newInstrumentName}
                        onChange={(e) => setNewInstrumentName(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.type")}
                        value={newInstrumentType}
                        onChange={(e) => setNewInstrumentType(e.target.value)}
                      />
                      <Button size="sm" className="w-full" onClick={handleCreateInstrument} disabled={createInstrumentMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addInstrument")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(measurementInstruments || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <PermissionGate module="settings_products" action="canDelete">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-destructive"
                              onClick={() => deleteInstrumentMutation.mutate({ id: item.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </PermissionGate>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.samplingPlans")}</h4>
                      <Badge variant="secondary">{samplingPlans?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newSamplingCode}
                        onChange={(e) => setNewSamplingCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newSamplingName}
                        onChange={(e) => setNewSamplingName(e.target.value)}
                      />
                      <Select value={newSamplingStrategy} onValueChange={(v) => setNewSamplingStrategy(v as "fixed_n" | "aql" | "risk_based")}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("products.strategy")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed_n">{t("products.strategyFixedN")}</SelectItem>
                          <SelectItem value="aql">{t("products.strategyAql")}</SelectItem>
                          <SelectItem value="risk_based">{t("products.strategyRiskBased")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={handleCreateSamplingPlan} disabled={createSamplingPlanMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addSamplingPlan")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(samplingPlans || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <PermissionGate module="settings_products" action="canDelete">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-destructive"
                              onClick={() => deleteSamplingPlanMutation.mutate({ id: item.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </PermissionGate>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Doc 31 OP5 (decision #3) — AQL lot acceptance board + config */}
                  {selectedProduct && (
                    <ProductLotAcceptancePanel
                      productModelId={selectedProduct.id}
                      canEdit={user?.role === "admin"}
                    />
                  )}

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.productViews")}</h4>
                      <Badge variant="secondary">{productViews?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newViewCode}
                        onChange={(e) => setNewViewCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newViewName}
                        onChange={(e) => setNewViewName(e.target.value)}
                      />
                      <Select value={newViewType} onValueChange={(v) => setNewViewType(v as "top" | "bottom" | "side" | "isometric" | "custom")}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("products.viewType")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top">{t("products.viewTop")}</SelectItem>
                          <SelectItem value="bottom">{t("products.viewBottom")}</SelectItem>
                          <SelectItem value="side">{t("products.viewSide")}</SelectItem>
                          <SelectItem value="isometric">{t("products.viewIsometric")}</SelectItem>
                          <SelectItem value="custom">{t("products.viewCustom")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={handleCreateProductView} disabled={createProductViewMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addProductView")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(productViews || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <PermissionGate module="settings_products" action="canDelete">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-destructive"
                              onClick={() => deleteProductViewMutation.mutate({ id: item.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </PermissionGate>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.msaStudies")}</h4>
                      <Badge variant="secondary">{msaStudies?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Button size="sm" className="w-full" onClick={openMsaWizard}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.startMsaWizard")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(msaStudies || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.studyCode} - {item.status}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => {
                              setSelectedMsaStudyId(item.id);
                              setMsaWizardStep(item.status === "completed" ? 3 : 2);
                              setIsMsaDialogOpen(true);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
    </>
  );
}
