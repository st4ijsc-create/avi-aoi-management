import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Shield,
  ShieldCheck,
  Plus,
  Edit,
  Trash2,
  Copy,
  Play,
  BookOpen,
  Settings,
  Factory as FactoryIcon,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

const STANDARD_COLORS: Record<string, string> = {
  "IPC-A-610": "bg-blue-500",
  "IATF 16949": "bg-purple-500",
  "SMT": "bg-green-500",
  "AS9100": "bg-orange-500",
  "ISO 13485": "bg-red-500",
  "General": "bg-gray-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  electronics: "Điện tử",
  automotive: "Ô tô",
  aerospace: "Hàng không",
  medical: "Y tế",
  general: "Chung",
};

export function QualityGateTemplatesContent() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("builtin");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [selectedLineId, setSelectedLineId] = useState<string>("");

  // Form state for custom templates
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formStandard, setFormStandard] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formRules, setFormRules] = useState<any[]>([
    { type: "yield_rate", comparison: "lt", value: 95, action: "alert", enabled: true },
  ]);

  const utils = trpc.useUtils();
  const { data: builtinTemplates, isLoading: builtinLoading } =
    trpc.qualityGateTemplate.listBuiltin.useQuery();
  const { data: customTemplates, isLoading: customLoading, refetch: refetchCustom } =
    trpc.qualityGateTemplate.listCustom.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  const createMutation = trpc.qualityGateTemplate.createCustom.useMutation({
    onSuccess: () => {
      toast.success(t("qualityGateTemplates.createSuccess", "Tạo template thành công"));
      setIsCreateOpen(false);
      resetForm();
      refetchCustom();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteMutation = trpc.qualityGateTemplate.deleteCustom.useMutation({
    onSuccess: () => {
      toast.success(t("qualityGateTemplates.deleteSuccess", "Xóa template thành công"));
      refetchCustom();
    },
    onError: (err) => toastTrpcError(err),
  });

  const applyMutation = trpc.qualityGateTemplate.applyToLine.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("qualityGateTemplates.applySuccess", "Đã áp dụng {{count}} quy tắc cho dây chuyền", {
          count: data.gatesCreated,
        })
      );
      setIsApplyOpen(false);
      setSelectedTemplate(null);
      setSelectedLineId("");
    },
    onError: (err) => toastTrpcError(err),
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormStandard("");
    setFormCategory("general");
    setFormRules([{ type: "yield_rate", comparison: "lt", value: 95, action: "alert", enabled: true }]);
  };

  const handleAddRule = () => {
    setFormRules([...formRules, { type: "yield_rate", comparison: "lt", value: 95, action: "alert", enabled: true }]);
  };

  const handleRemoveRule = (index: number) => {
    setFormRules(formRules.filter((_, i) => i !== index));
  };

  const handleRuleChange = (index: number, field: string, value: any) => {
    const updated = [...formRules];
    updated[index] = { ...updated[index], [field]: value };
    setFormRules(updated);
  };

  const handleCreate = () => {
    if (!formName.trim()) {
      toast.error(t("qualityGateTemplates.nameRequired", "Tên template không được để trống"));
      return;
    }
    createMutation.mutate({
      name: formName,
      description: formDescription,
      standard: formStandard,
      category: formCategory as any,
      rules: formRules,
    });
  };

  const handleApplyTemplate = () => {
    if (!selectedTemplate || !selectedLineId) {
      toast.error(t("qualityGateTemplates.selectLineRequired", "Vui lòng chọn dây chuyền"));
      return;
    }
    const templateId = selectedTemplate.isBuiltin
      ? selectedTemplate.id
      : `custom:${selectedTemplate.id}`;
    applyMutation.mutate({
      templateId,
      lineId: Number(selectedLineId),
    });
  };

  const openApplyDialog = (template: any, isBuiltin: boolean) => {
    setSelectedTemplate({ ...template, isBuiltin });
    setIsApplyOpen(true);
  };

  return (
    <>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              {t("qualityGateTemplates.title", "Thư viện Quality Gate Templates")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t(
                "qualityGateTemplates.description",
                "Quản lý template tiêu chuẩn chất lượng - IPC-A-610, IATF 16949, SMT, AS9100, ISO 13485"
              )}
            </p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("qualityGateTemplates.createCustom", "Tạo template mới")}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="builtin">
              <BookOpen className="h-4 w-4 mr-1" />
              {t("qualityGateTemplates.builtinTab", "Templates có sẵn")} ({builtinTemplates?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="custom">
              <Settings className="h-4 w-4 mr-1" />
              {t("qualityGateTemplates.customTab", "Templates tùy chỉnh")} ({customTemplates?.length || 0})
            </TabsTrigger>
          </TabsList>

          {/* Built-in Templates */}
          <TabsContent value="builtin">
            {builtinLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-[300px]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {builtinTemplates?.map((template: any) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isBuiltin
                    onApply={() => openApplyDialog(template, true)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Custom Templates */}
          <TabsContent value="custom">
            {customLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[300px]" />
                ))}
              </div>
            ) : customTemplates?.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Settings className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {t("qualityGateTemplates.noCustom", "Chưa có template tùy chỉnh")}
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)} className="mt-4" variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    {t("qualityGateTemplates.createFirst", "Tạo template đầu tiên")}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customTemplates?.map((template: any) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isBuiltin={false}
                    onApply={() => openApplyDialog(template, false)}
                    onDelete={() => deleteMutation.mutate({ id: template.id })}
                    t={t}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Custom Template Dialog */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("qualityGateTemplates.createTitle", "Tạo Quality Gate Template")}</DialogTitle>
              <DialogDescription>
                {t("qualityGateTemplates.createDesc", "Định nghĩa quy tắc chất lượng tùy chỉnh")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("common.name", "Tên")}</Label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="VD: Custom QC Template" />
                </div>
                <div>
                  <Label>{t("qualityGateTemplates.standard", "Tiêu chuẩn")}</Label>
                  <Input value={formStandard} onChange={(e) => setFormStandard(e.target.value)} placeholder="VD: Internal QC" />
                </div>
              </div>
              <div>
                <Label>{t("common.description", "Mô tả")}</Label>
                <Textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
              </div>
              <div>
                <Label>{t("qualityGateTemplates.category", "Danh mục")}</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Rules */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-base font-semibold">{t("qualityGateTemplates.rules", "Quy tắc")}</Label>
                  <Button variant="outline" size="sm" onClick={handleAddRule}>
                    <Plus className="h-3 w-3 mr-1" />
                    {t("qualityGateTemplates.addRule", "Thêm quy tắc")}
                  </Button>
                </div>
                <div className="space-y-3">
                  {formRules.map((rule, index) => (
                    <div key={index} className="grid grid-cols-5 gap-2 items-end border rounded-lg p-3">
                      <div>
                        <Label className="text-xs">{t("qualityGates.type", "Loại")}</Label>
                        <Select value={rule.type} onValueChange={(v) => handleRuleChange(index, "type", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yield_rate">Yield Rate</SelectItem>
                            <SelectItem value="ng_count">NG Count</SelectItem>
                            <SelectItem value="ng_rate">NG Rate</SelectItem>
                            <SelectItem value="cpk_threshold">CPK Threshold</SelectItem>
                            <SelectItem value="consecutive_ng">Consecutive NG</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">{t("qualityGates.comparison", "So sánh")}</Label>
                        <Select value={rule.comparison} onValueChange={(v) => handleRuleChange(index, "comparison", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lt">&lt;</SelectItem>
                            <SelectItem value="lte">≤</SelectItem>
                            <SelectItem value="gt">&gt;</SelectItem>
                            <SelectItem value="gte">≥</SelectItem>
                            <SelectItem value="eq">=</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">{t("qualityGates.value", "Giá trị")}</Label>
                        <Input
                          type="number"
                          value={rule.value}
                          onChange={(e) => handleRuleChange(index, "value", Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t("qualityGates.action", "Hành động")}</Label>
                        <Select value={rule.action} onValueChange={(v) => handleRuleChange(index, "action", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="alert">{t("qgTemplates.canhBao", "Cảnh báo")}</SelectItem>
                            <SelectItem value="pause">{t("qgTemplates.tamDung", "Tạm dừng")}</SelectItem>
                            <SelectItem value="stop">{t("qgTemplates.dungHan", "Dừng hẳn")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveRule(index)} disabled={formRules.length <= 1}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                {t("common.cancel", "Hủy")}
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.creating", "Đang tạo...") : t("common.create", "Tạo")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Apply Template Dialog */}
        <Dialog open={isApplyOpen} onOpenChange={setIsApplyOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("qualityGateTemplates.applyTitle", "Áp dụng Template cho Dây chuyền")}
              </DialogTitle>
              <DialogDescription>
                {selectedTemplate?.name} - {selectedTemplate?.rules?.length || 0}{" "}
                {t("qualityGateTemplates.rulesCount", "quy tắc")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t("common.selectLine", "Chọn dây chuyền")}</Label>
                <Select value={selectedLineId} onValueChange={setSelectedLineId}>
                  <SelectTrigger><SelectValue placeholder={t("qualityGateTemplates.selectLine", "Chọn dây chuyền...")} /></SelectTrigger>
                  <SelectContent>
                    {lines?.map((line: any) => (
                      <SelectItem key={line.id} value={String(line.id)}>{line.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTemplate?.rules && (
                <div>
                  <Label className="text-sm font-semibold mb-2 block">
                    {t("qualityGateTemplates.rulesToApply", "Quy tắc sẽ áp dụng:")}
                  </Label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {selectedTemplate.rules.map((rule: any, i: number) => {
                      // Normalize field names (server uses gateType/comparisonOperator/threshold, UI uses type/comparison/value)
                      const type = rule.gateType || rule.type;
                      const comparison = rule.comparisonOperator || rule.comparison;
                      const value = rule.threshold ?? rule.value;
                      return (
                        <div key={i} className="text-sm flex items-center gap-2 p-2 rounded bg-muted">
                          <CheckCircle className="h-3 w-3 text-success" />
                          <span>
                            {type} {comparison} {value} → {rule.action}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsApplyOpen(false)}>
                {t("common.cancel", "Hủy")}
              </Button>
              <Button onClick={handleApplyTemplate} disabled={applyMutation.isPending}>
                <Play className="h-4 w-4 mr-2" />
                {applyMutation.isPending
                  ? t("common.applying", "Đang áp dụng...")
                  : t("qualityGateTemplates.apply", "Áp dụng")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

function TemplateCard({
  template,
  isBuiltin,
  onApply,
  onDelete,
  t,
}: {
  template: any;
  isBuiltin: boolean;
  onApply: () => void;
  onDelete?: () => void;
  t: any;
}) {
  const standardColor = STANDARD_COLORS[template.standard] || STANDARD_COLORS["General"];

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isBuiltin ? (
              <ShieldCheck className="h-5 w-5 text-success" />
            ) : (
              <Settings className="h-5 w-5 text-info" />
            )}
            <CardTitle className="text-base">{template.name}</CardTitle>
          </div>
          <Badge className={`${standardColor} text-white`}>{template.standard || "Custom"}</Badge>
        </div>
        <CardDescription className="text-sm">{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">{CATEGORY_LABELS[template.category] || template.category}</Badge>
          <span className="text-muted-foreground">
            {template.rules?.length || 0} {t("qualityGateTemplates.rulesCount", "quy tắc")}
          </span>
        </div>

        {/* Rules preview */}
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {template.rules?.slice(0, 4).map((rule: any, i: number) => {
            // Normalize field names (server uses gateType/comparisonOperator/threshold, UI uses type/comparison/value)
            const type = rule.gateType || rule.type;
            const comparison = rule.comparisonOperator || rule.comparison;
            const value = rule.threshold ?? rule.value;
            return (
              <div key={i} className="text-xs flex items-center gap-1 text-muted-foreground">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {type} {comparison} {value} → {rule.action}
                </span>
              </div>
            );
          })}
          {template.rules?.length > 4 && (
            <div className="text-xs text-muted-foreground">
              +{template.rules.length - 4} {t("qualityGateTemplates.moreRules", "quy tắc khác")}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button size="sm" className="flex-1" onClick={onApply}>
            <Play className="h-3 w-3 mr-1" />
            {t("qualityGateTemplates.applyToLine", "Áp dụng")}
          </Button>
          {!isBuiltin && onDelete && (
            <Button size="sm" variant="destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function QualityGateTemplates() {
  return (
    <DashboardLayout>
      <QualityGateTemplatesContent />
    </DashboardLayout>
  );
}
