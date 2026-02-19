import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  LayoutTemplate, Plus, Save, Trash2, Copy, Eye, Edit,
  BarChart3, LineChart, PieChart, Table2, Type, Image,
  Minus, Activity, Cpu, Clock, GripVertical, Settings,
  Loader2, ArrowLeft, X, LayoutGrid, Maximize2, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart as RechartsLineChart, Line, PieChart as RechartsPieChart, Pie, Cell, Legend,
} from "recharts";

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"];

const WIDGET_ICONS: Record<string, React.ReactNode> = {
  kpi_card: <Activity className="h-4 w-4" />,
  bar_chart: <BarChart3 className="h-4 w-4" />,
  line_chart: <LineChart className="h-4 w-4" />,
  pie_chart: <PieChart className="h-4 w-4" />,
  table: <Table2 className="h-4 w-4" />,
  text_block: <Type className="h-4 w-4" />,
  divider: <Minus className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  yield_trend: <LineChart className="h-4 w-4" />,
  ng_analysis: <BarChart3 className="h-4 w-4" />,
  machine_comparison: <Cpu className="h-4 w-4" />,
  shift_analysis: <Clock className="h-4 w-4" />,
  heatmap: <LayoutGrid className="h-4 w-4" />,
};

interface ReportWidget {
  id: string;
  type: string;
  title: string;
  config: Record<string, any>;
  width: "full" | "half" | "third";
  order: number;
}

interface ReportDefinition {
  id?: number;
  name: string;
  description: string;
  widgets: ReportWidget[];
  filters: Record<string, any>;
  isPublic: boolean;
}

const DEFAULT_REPORT: ReportDefinition = {
  name: "",
  description: "",
  widgets: [],
  filters: { days: 7 },
  isPublic: false,
};

export default function ReportBuilder() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("list");
  const [editingReport, setEditingReport] = useState<ReportDefinition | null>(null);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [editingWidget, setEditingWidget] = useState<string | null>(null);

  // Queries
  const { data: reports, refetch } = trpc.reportBuilder.list.useQuery();
  const { data: widgetTypes } = trpc.reportBuilder.getWidgetTypes.useQuery();

  // Mutations
  const saveMutation = trpc.reportBuilder.save.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportSaved'));
      refetch();
      setEditingReport(null);
      setActiveTab("list");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.reportBuilder.update.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportUpdated'));
      refetch();
      setEditingReport(null);
      setActiveTab("list");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.reportBuilder.delete.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportDeleted'));
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const duplicateMutation = trpc.reportBuilder.duplicate.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportDuplicated'));
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // Add widget
  const addWidget = useCallback((type: string) => {
    if (!editingReport) return;
    const widgetDef = widgetTypes?.find((w: any) => w.type === type);
    const newWidget: ReportWidget = {
      id: `widget_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      title: widgetDef?.label || type,
      config: {},
      width: type === "divider" || type === "text_block" ? "full" : "half",
      order: editingReport.widgets.length,
    };
    setEditingReport({
      ...editingReport,
      widgets: [...editingReport.widgets, newWidget],
    });
    setShowWidgetPicker(false);
  }, [editingReport, widgetTypes]);

  // Remove widget
  const removeWidget = useCallback((widgetId: string) => {
    if (!editingReport) return;
    setEditingReport({
      ...editingReport,
      widgets: editingReport.widgets.filter(w => w.id !== widgetId),
    });
  }, [editingReport]);

  // Move widget
  const moveWidget = useCallback((widgetId: string, direction: "up" | "down") => {
    if (!editingReport) return;
    const idx = editingReport.widgets.findIndex(w => w.id === widgetId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= editingReport.widgets.length) return;
    const newWidgets = [...editingReport.widgets];
    [newWidgets[idx], newWidgets[newIdx]] = [newWidgets[newIdx], newWidgets[idx]];
    setEditingReport({ ...editingReport, widgets: newWidgets });
  }, [editingReport]);

  // Update widget config
  const updateWidget = useCallback((widgetId: string, updates: Partial<ReportWidget>) => {
    if (!editingReport) return;
    setEditingReport({
      ...editingReport,
      widgets: editingReport.widgets.map(w =>
        w.id === widgetId ? { ...w, ...updates } : w
      ),
    });
  }, [editingReport]);

  // Save handler
  const handleSave = () => {
    if (!editingReport) return;
    if (!editingReport.name.trim()) {
      toast.error(t('reports.pleaseEnterReportName'));
      return;
    }
    const widgetsForServer = editingReport.widgets.map((w, idx) => ({
      id: w.id,
      type: w.type as "kpi_card" | "bar_chart" | "line_chart" | "pie_chart" | "table" | "text_block" | "divider" | "image" | "yield_trend" | "ng_analysis" | "machine_comparison" | "shift_analysis" | "heatmap",
      title: w.title,
      x: 0,
      y: idx * 4,
      w: w.width === "full" ? 12 : w.width === "half" ? 6 : 4,
      h: 4,
      config: w.config,
    }));
    const payload: any = {
      name: editingReport.name,
      description: editingReport.description,
      widgets: widgetsForServer,
      layout: { columns: 12 },
      filters: editingReport.filters,
      styling: {},
      isPublic: editingReport.isPublic,
    };
    if (editingReport.id) {
      updateMutation.mutate({ id: editingReport.id, data: payload as any });
    } else {
      saveMutation.mutate(payload as any);
    }
  };

  // Load report for editing
  const loadReport = (report: any) => {
    const parsed = report.sections ? (typeof report.sections === "string" ? JSON.parse(report.sections) : report.sections) : {};
    setEditingReport({
      id: report.id,
      name: report.name || "",
      description: report.description || "",
      widgets: parsed.widgets || [],
      filters: parsed.filters || { days: 7 },
      isPublic: parsed.isPublic || false,
    });
    setActiveTab("editor");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutTemplate className="h-6 w-6 text-primary" />
              Report Builder
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('reports.reportBuilderDescription')}
            </p>
          </div>
          {activeTab === "list" && (
            <Button onClick={() => {
              setEditingReport({ ...DEFAULT_REPORT });
              setActiveTab("editor");
            }}>
              <Plus className="h-4 w-4 mr-1" /> {t('reports.createNew')}
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="list">
              <FileText className="h-4 w-4 mr-1" /> {t('reports.list')}
            </TabsTrigger>
            {editingReport && (
              <TabsTrigger value="editor">
                <Edit className="h-4 w-4 mr-1" /> {t('reports.editor')}
              </TabsTrigger>
            )}
            {editingReport && (
              <TabsTrigger value="preview">
                <Eye className="h-4 w-4 mr-1" /> {t('reports.preview')}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ============ TAB: LIST ============ */}
          <TabsContent value="list">
            <div className="grid md:grid-cols-3 gap-4">
              {((reports as any)?.reports || []).map((report: any) => (
                <Card key={report.id} className="group hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm">{report.name}</CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {report.description || t('common.noDescription')}
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {report.type || "CUSTOM"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => loadReport(report)}>
                        <Edit className="h-3 w-3 mr-1" /> {t('common.edit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => duplicateMutation.mutate({ id: report.id, newName: report.name + ` (${t('reports.copy')})` })}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm(t('reports.confirmDeleteReport'))) deleteMutation.mutate(report.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {(!reports || !((reports as any)?.reports?.length)) && (
                <div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <LayoutTemplate className="h-16 w-16 mb-4 opacity-30" />
                  <p className="text-lg">{t('reports.noCustomReports')}</p>
                  <p className="text-sm mt-1">{t('reports.createFirstReportDragDrop')}</p>
                  <Button className="mt-4" onClick={() => {
                    setEditingReport({ ...DEFAULT_REPORT });
                    setActiveTab("editor");
                  }}>
                    <Plus className="h-4 w-4 mr-1" /> {t('reports.createNewReport')}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ============ TAB: EDITOR ============ */}
          <TabsContent value="editor">
            {editingReport && (
              <div className="grid md:grid-cols-[300px_1fr] gap-6">
                {/* Left sidebar - Report settings */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t('reports.reportInfo')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('reports.reportName')}</Label>
                        <Input
                          value={editingReport.name}
                          onChange={(e) => setEditingReport({ ...editingReport, name: e.target.value })}
                          placeholder={t('reports.reportNamePlaceholder')}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('common.description')}</Label>
                        <Textarea
                          value={editingReport.description}
                          onChange={(e) => setEditingReport({ ...editingReport, description: e.target.value })}
                          placeholder={t('reports.shortDescription')}
                          rows={2}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('reports.public')}</Label>
                        <Switch
                          checked={editingReport.isPublic}
                          onCheckedChange={(v) => setEditingReport({ ...editingReport, isPublic: v })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('reports.timeRangeDays')}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={editingReport.filters.days || 7}
                          onChange={(e) => setEditingReport({
                            ...editingReport,
                            filters: { ...editingReport.filters, days: parseInt(e.target.value) || 7 },
                          })}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t('reports.addWidget')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-2">
                        {(widgetTypes || []).map((wt: any) => (
                          <button
                            key={wt.type}
                            className="flex flex-col items-center gap-1 p-2 rounded-md border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-center"
                            onClick={() => addWidget(wt.type)}
                          >
                            <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center">
                              {WIDGET_ICONS[wt.type] || <LayoutGrid className="h-4 w-4" />}
                            </div>
                            <span className="text-[10px] leading-tight">{wt.label}</span>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={handleSave} disabled={saveMutation.isPending || updateMutation.isPending}>
                      {(saveMutation.isPending || updateMutation.isPending) ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      {t('reports.save')}
                    </Button>
                    <Button variant="outline" onClick={() => {
                      setEditingReport(null);
                      setActiveTab("list");
                    }}>
                      <ArrowLeft className="h-4 w-4 mr-1" /> {t('reports.goBack')}
                    </Button>
                  </div>
                </div>

                {/* Right - Widget canvas */}
                <Card className="min-h-[500px]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      Canvas ({editingReport.widgets.length} widgets)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {editingReport.widgets.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
                        <LayoutGrid className="h-12 w-12 mb-3 opacity-30" />
                        <p>{t('reports.selectWidgetFromLeft')}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {editingReport.widgets.map((widget, idx) => (
                          <div
                            key={widget.id}
                            className={`border rounded-lg p-3 group hover:border-primary/50 transition-colors ${
                              widget.width === "full" ? "w-full" :
                              widget.width === "half" ? "w-full" : "w-full"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                                {WIDGET_ICONS[widget.type] || <LayoutGrid className="h-4 w-4" />}
                                <span className="text-sm font-medium">{widget.title}</span>
                                <Badge variant="secondary" className="text-[10px]">{widget.type}</Badge>
                                <Badge variant="outline" className="text-[10px]">{widget.width}</Badge>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => moveWidget(widget.id, "up")}
                                  disabled={idx === 0}
                                >
                                  ↑
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => moveWidget(widget.id, "down")}
                                  disabled={idx === editingReport.widgets.length - 1}
                                >
                                  ↓
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => setEditingWidget(editingWidget === widget.id ? null : widget.id)}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                  onClick={() => removeWidget(widget.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {/* Widget config panel */}
                            {editingWidget === widget.id && (
                              <div className="mt-2 p-3 bg-muted/30 rounded-md space-y-3 border-t">
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t('reports.widgetTitle')}</Label>
                                    <Input
                                      value={widget.title}
                                      onChange={(e) => updateWidget(widget.id, { title: e.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t('reports.widgetWidth')}</Label>
                                    <Select
                                      value={widget.width}
                                      onValueChange={(v: any) => updateWidget(widget.id, { width: v })}
                                    >
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="full">{t('reports.widthFull')}</SelectItem>
                                        <SelectItem value="half">1/2</SelectItem>
                                        <SelectItem value="third">1/3</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                {widget.type === "text_block" && (
                                  <div className="space-y-1">
                                    <Label className="text-xs">{t('reports.content')}</Label>
                                    <Textarea
                                      value={widget.config.content || ""}
                                      onChange={(e) => updateWidget(widget.id, {
                                        config: { ...widget.config, content: e.target.value },
                                      })}
                                      rows={3}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ============ TAB: PREVIEW ============ */}
          <TabsContent value="preview">
            {editingReport && <ReportPreview report={editingReport} />}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ReportPreview({ report }: { report: ReportDefinition }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{report.name || t('reports.untitledReport')}</CardTitle>
          <CardDescription>{report.description}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {report.widgets.map((widget) => {
          const colSpan = widget.width === "full" ? "col-span-2" : widget.width === "third" ? "col-span-1" : "col-span-1";
          return (
            <div key={widget.id} className={colSpan}>
              <WidgetPreview widget={widget} days={report.filters.days || 7} />
            </div>
          );
        })}
      </div>

      {report.widgets.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Eye className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{t('reports.addWidgetsToPreview')}</p>
        </div>
      )}
    </div>
  );
}

function WidgetPreview({ widget, days }: { widget: ReportWidget; days: number }) {
  const { t } = useTranslation();
  const { data } = trpc.reportBuilder.getWidgetData.useQuery({
    widgetType: widget.type,
    config: widget.config,
    filters: {
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    },
  });

  if (widget.type === "divider") {
    return <Separator className="my-4" />;
  }

  if (widget.type === "text_block") {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="whitespace-pre-wrap">{widget.config.content || t('reports.emptyContent')}</p>
        </CardContent>
      </Card>
    );
  }

  if (widget.type === "kpi_card") {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">{widget.title}</div>
          <div className="text-3xl font-bold mt-1">
            {data?.value != null ? data.value.toLocaleString() : "—"}
          </div>
          {(data as any)?.change != null && (
            <Badge variant="outline" className={`mt-1 text-xs ${(data as any).change >= 0 ? "text-green-400" : "text-red-400"}`}>
              {(data as any).change >= 0 ? "+" : ""}{(data as any).change.toFixed(1)}%
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  // Chart widgets
  if (["bar_chart", "ng_analysis", "machine_comparison", "shift_analysis"].includes(widget.type)) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(data as any)?.data || []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                  {((data as any)?.data || []).map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (["line_chart", "yield_trend"].includes(widget.type)) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={(data as any)?.data || []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                />
                <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (widget.type === "pie_chart") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={(data as any)?.data || []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={40}
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {((data as any)?.data || []).map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (widget.type === "table") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[200px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  {((data as any)?.columns || [t('reports.name'), t('reports.value')]).map((col: string, i: number) => (
                    <th key={i} className="p-2 text-left font-medium">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {((data as any)?.rows || []).map((row: any, i: number) => (
                  <tr key={i} className="border-b border-border/30">
                    {Object.values(row).map((val: any, j: number) => (
                      <td key={j} className="p-2">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  // Fallback
  return (
    <Card>
      <CardContent className="p-4 text-center text-muted-foreground">
        <div className="h-7 w-7 rounded bg-muted mx-auto mb-2 flex items-center justify-center">
          {WIDGET_ICONS[widget.type] || <LayoutGrid className="h-4 w-4" />}
        </div>
        <span className="text-xs">{widget.title} ({widget.type})</span>
      </CardContent>
    </Card>
  );
}
