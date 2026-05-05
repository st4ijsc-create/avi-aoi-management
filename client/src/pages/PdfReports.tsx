import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  FileText, Download, Loader2, CheckCircle, Search,
  Plus, Settings, Eye, Printer, Calendar, BarChart3,
  Building2, Factory, Cpu, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export function PdfReportsContent() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("inspection");

  // ─── Inspection PDF ───
  const [inspectionForm, setInspectionForm] = useState({
    inspectionId: "",
    productName: "",
    machineName: "",
    factoryName: "",
  });

  // ─── Quality PDF ───
  const [qualityForm, setQualityForm] = useState({
    title: "",
    dateFrom: "",
    dateTo: "",
    factoryId: undefined as number | undefined,
  });

  const { data: factories } = trpc.factory.list.useQuery();

  const inspectionMutation = trpc.pdfReport.generateInspectionPDF.useMutation({
    onSuccess: (data) => {
      downloadPdf(data.data, data.filename);
      toast.success(t('reports.pdfCreatedSuccess'));
    },
    onError: (err) => toast.error(err.message),
  });

  const qualityMutation = trpc.pdfReport.generateQualityPDF.useMutation({
    onSuccess: (data) => {
      downloadPdf(data.data, data.filename);
      toast.success(t('reports.pdfCreatedSuccess'));
    },
    onError: (err) => toast.error(err.message),
  });

  function downloadPdf(base64: string, filename: string) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              {t('reports.pdfReports')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('reports.pdfReportsDescription')}
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="inspection">
              <Search className="h-4 w-4 mr-1" /> {t('reports.inspectionReport')}
            </TabsTrigger>
            <TabsTrigger value="quality">
              <BarChart3 className="h-4 w-4 mr-1" /> {t('reports.qualityReport')}
            </TabsTrigger>
            <TabsTrigger value="templates">
              <Settings className="h-4 w-4 mr-1" /> {t('reports.reportTemplates')}
            </TabsTrigger>
          </TabsList>

          {/* ============ INSPECTION REPORT ============ */}
          <TabsContent value="inspection" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports.createInspectionReport')}</CardTitle>
                  <CardDescription>
                    {t('reports.enterInfoForInspectionPdf')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('reports.inspectionId')}</Label>
                    <Input
                      placeholder={t('reports.enterInspectionId')}
                      value={inspectionForm.inspectionId}
                      onChange={(e) => setInspectionForm(f => ({ ...f, inspectionId: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('reports.productName')}</Label>
                    <Input
                      placeholder={t('reports.productNamePlaceholder')}
                      value={inspectionForm.productName}
                      onChange={(e) => setInspectionForm(f => ({ ...f, productName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('reports.inspectionMachine')}</Label>
                    <Input
                      placeholder={t('reports.aoiMachineName')}
                      value={inspectionForm.machineName}
                      onChange={(e) => setInspectionForm(f => ({ ...f, machineName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('reports.factory')}</Label>
                    <Input
                      placeholder={t('reports.factoryNamePlaceholder')}
                      value={inspectionForm.factoryName}
                      onChange={(e) => setInspectionForm(f => ({ ...f, factoryName: e.target.value }))}
                    />
                  </div>
                  <Separator />
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (!inspectionForm.inspectionId) {
                        toast.error(t('reports.pleaseEnterInspectionId'));
                        return;
                      }
                      inspectionMutation.mutate({
                        inspectionId: parseInt(inspectionForm.inspectionId),
                        config: {
                          companyName: inspectionForm.factoryName || "AVI AOI Management",
                        },
                      });
                    }}
                    disabled={inspectionMutation.isPending}
                  >
                    {inspectionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1" />
                    )}
                    {t('reports.createInspectionPdf')}
                  </Button>
                </CardContent>
              </Card>

              {/* Preview info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports.reportContent')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      <div>
                        <div className="text-sm font-medium">{t('reports.overviewInfo')}</div>
                        <div className="text-xs text-muted-foreground">{t('reports.overviewInfoDesc')}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      <div>
                        <div className="text-sm font-medium">{t('reports.measurementResults')}</div>
                        <div className="text-xs text-muted-foreground">{t('reports.measurementResultsDesc')}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      <div>
                        <div className="text-sm font-medium">KPI Cards</div>
                        <div className="text-xs text-muted-foreground">Yield, total, OK rate, NG rate</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                      <div>
                        <div className="text-sm font-medium">{t('reports.professionalHeaderFooter')}</div>
                        <div className="text-xs text-muted-foreground">{t('reports.headerFooterDesc')}</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============ QUALITY REPORT ============ */}
          <TabsContent value="quality" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports.createQualityReport')}</CardTitle>
                  <CardDescription>
                    {t('reports.qualityReportDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('reports.reportTitle')}</Label>
                    <Input
                      value={qualityForm.title}
                      onChange={(e) => setQualityForm(f => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>{t('reports.fromDate')}</Label>
                      <Input
                        type="date"
                        value={qualityForm.dateFrom}
                        onChange={(e) => setQualityForm(f => ({ ...f, dateFrom: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('reports.toDate')}</Label>
                      <Input
                        type="date"
                        value={qualityForm.dateTo}
                        onChange={(e) => setQualityForm(f => ({ ...f, dateTo: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('reports.factory')}</Label>
                    <Select
                      value={qualityForm.factoryId?.toString() || "all"}
                      onValueChange={(v) => setQualityForm(f => ({ ...f, factoryId: v === "all" ? undefined : parseInt(v) }))}
                    >
                      <SelectTrigger><SelectValue placeholder={t('reports.selectFactory')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('reports.allFactories')}</SelectItem>
                        {(factories || []).map((f: any) => (
                          <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (!qualityForm.dateFrom || !qualityForm.dateTo) {
                        toast.error(t('reports.pleaseSelectTimeRange'));
                        return;
                      }
                      qualityMutation.mutate({
                        startDate: new Date(qualityForm.dateFrom),
                        endDate: new Date(qualityForm.dateTo),
                        factoryId: qualityForm.factoryId,
                        config: {
                          companyName: "AVI AOI Management",
                        },
                      });
                    }}
                    disabled={qualityMutation.isPending}
                  >
                    {qualityMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1" />
                    )}
                    {t('reports.createQualityPdf')}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('reports.professionalPdfTemplate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <div className="w-32 h-40 mx-auto bg-linear-to-br from-red-500/20 to-blue-500/20 rounded-lg flex flex-col items-center justify-center mb-4 border">
                      <FileText className="h-10 w-10 text-primary mb-2" />
                      <div className="text-xs text-muted-foreground">Quality Report</div>
                      <div className="text-[10px] text-muted-foreground mt-1">PDF Template</div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('reports.pdfTemplateDesc')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============ TEMPLATES ============ */}
          <TabsContent value="templates">
            <TemplateManager />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function TemplateManager() {
  const { t } = useTranslation();
  const { data: templates, refetch } = trpc.pdfReport.listTemplates.useQuery();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    type: "CUSTOM" as "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM",
  });

  const saveMutation = trpc.pdfReport.saveTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('reports.templateSaved'));
      refetch();
      setShowCreateDialog(false);
      setNewTemplate({ name: "", type: "CUSTOM" });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.pdfReport.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('reports.templateDeleted'));
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{t('reports.manageTemplates')}</h3>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-1" /> {t('reports.createNewTemplate')}
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {(templates || []).map((tmpl: any) => (
          <Card key={tmpl.id} className="group">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{tmpl.name}</CardTitle>
                <Badge variant="secondary" className="text-xs">{tmpl.code}</Badge>
              </div>
              <CardDescription className="text-xs">{tmpl.description || t('common.noDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Eye className="h-3 w-3 mr-1" /> {t('reports.view')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm(t('reports.confirmDeleteTemplate'))) {
                      deleteMutation.mutate(tmpl.id);
                    }
                  }}
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {(!templates || templates.length === 0) && (
          <div className="col-span-3 text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>{t('reports.noTemplatesYet')}</p>
          </div>
        )}
      </div>

      {/* Create template dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reports.createNewReportTemplate')}</DialogTitle>
            <DialogDescription className="sr-only">{t('reports.createNewReportTemplate')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('reports.templateName')}</Label>
              <Input
                value={newTemplate.name}
                onChange={(e) => setNewTemplate(t => ({ ...t, name: e.target.value }))}
                placeholder={t('reports.templateNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('reports.templateType')}</Label>
              <Select value={newTemplate.type} onValueChange={(v: any) => setNewTemplate(t => ({ ...t, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">{t('reports.daily')}</SelectItem>
                  <SelectItem value="WEEKLY">{t('reports.weekly')}</SelectItem>
                  <SelectItem value="MONTHLY">{t('reports.monthly')}</SelectItem>
                  <SelectItem value="CUSTOM">{t('reports.custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                if (!newTemplate.name) {
                  toast.error(t('reports.pleaseEnterTemplateName'));
                  return;
                }
                saveMutation.mutate({
                  name: newTemplate.name,
                  type: newTemplate.type,
                  sections: {
                    includeYieldStats: true,
                    includeNGAnalysis: true,
                    includeMachineComparison: true,
                    includeTrend: true,
                  },
                  config: {
                    companyName: "AVI AOI Management",
                  },
                });
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              {t('reports.saveTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PdfReports() {
  return (
    <DashboardLayout>
      <PdfReportsContent />
    </DashboardLayout>
  );
}
