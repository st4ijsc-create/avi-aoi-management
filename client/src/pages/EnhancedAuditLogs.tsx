import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  Activity, Shield, User, Clock, Search, Filter, Download,
  LogIn, LogOut, Plus, Edit, Trash2, Key, RefreshCw,
  TrendingUp, Users, AlertTriangle, CheckCircle, XCircle,
  ChevronLeft, ChevronRight, Eye, ArrowUpDown, History, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const ACTION_ICONS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  login: { label: "audit.actionLogin", icon: <LogIn className="h-3 w-3" />, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  login_failed: { label: "audit.actionLoginFailed", icon: <AlertTriangle className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  logout: { label: "audit.actionLogout", icon: <LogOut className="h-3 w-3" />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  create: { label: "audit.actionCreate", icon: <Plus className="h-3 w-3" />, color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  update: { label: "audit.actionUpdate", icon: <Edit className="h-3 w-3" />, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  delete: { label: "audit.actionDelete", icon: <Trash2 className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  password_change: { label: "audit.actionPasswordChange", icon: <Key className="h-3 w-3" />, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  role_change: { label: "audit.actionRoleChange", icon: <Shield className="h-3 w-3" />, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  export: { label: "audit.actionExport", icon: <TrendingUp className="h-3 w-3" />, color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  bulk_create: { label: "audit.actionBulkCreate", icon: <Plus className="h-3 w-3" />, color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  bulk_update: { label: "audit.actionBulkUpdate", icon: <Edit className="h-3 w-3" />, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  bulk_delete: { label: "audit.actionBulkDelete", icon: <Trash2 className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"];

export function EnhancedAuditLogsContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("logs");
  const [filters, setFilters] = useState({
    action: "all",
    entityType: "all",
    userId: "",
    search: "",
    sortBy: "createdAt" as "createdAt" | "action" | "entityType",
    sortOrder: "desc" as "asc" | "desc",
  });
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [entityModal, setEntityModal] = useState<{ entityType: string; entityId: number } | null>(null);
  const [statsGroupBy, setStatsGroupBy] = useState<"day" | "action" | "entity" | "user">("day");

  const isAdmin = (user as any)?.role === "admin";

  // Main log list
  const { data: logsData, isLoading, refetch } = trpc.enhancedAudit.list.useQuery({
    action: filters.action === "all" ? undefined : filters.action,
    entityType: filters.entityType === "all" ? undefined : filters.entityType,
    userId: filters.userId ? parseInt(filters.userId) : undefined,
    search: filters.search || undefined,
    startDate: dateRange.from ? new Date(dateRange.from) : undefined,
    endDate: dateRange.to ? new Date(dateRange.to) : undefined,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    limit: pageSize,
    offset: page * pageSize,
  }, { enabled: isAdmin });

  // Filter options
  const { data: filterOptions } = trpc.enhancedAudit.getFilterOptions.useQuery(
    undefined, { enabled: isAdmin }
  );

  // Stats
  const { data: statsData } = trpc.enhancedAudit.stats.useQuery({
    days: 30,
    groupBy: statsGroupBy,
  }, { enabled: isAdmin && activeTab === "stats" });

  // Activity feed
  const { data: activityFeed } = trpc.enhancedAudit.activityFeed.useQuery({
    limit: 30,
  }, { enabled: isAdmin && activeTab === "feed" });

  // Change diff for selected log
  const { data: changeDiff } = trpc.enhancedAudit.getChangeDiff.useQuery(
    selectedLogId!,
    { enabled: !!selectedLogId }
  );

  // Entity history
  const { data: entityHistory } = trpc.enhancedAudit.entityHistory.useQuery(
    { entityType: entityModal?.entityType || "", entityId: entityModal?.entityId || 0 },
    { enabled: !!entityModal }
  );

  // Export CSV
  const exportMutation = trpc.enhancedAudit.exportCsv.useMutation({
    onSuccess: (data) => {
      const binaryStr = atob(data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('audit.exportSuccess'));
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = Math.ceil((logsData?.total || 0) / pageSize);

  if (!isAdmin) {
    return (
      <>
        <div className="flex items-center justify-center h-96">
          <Card className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">{t('audit.accessDenied')}</h2>
            <p className="text-muted-foreground">{t('audit.adminRequired')}</p>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              {t('audit.title')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('audit.subtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportMutation.mutate({
                action: filters.action === "all" ? undefined : filters.action,
                entityType: filters.entityType === "all" ? undefined : filters.entityType,
                startDate: dateRange.from ? new Date(dateRange.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate: dateRange.to ? new Date(dateRange.to) : new Date(),
                userId: filters.userId ? parseInt(filters.userId) : undefined,
              })}
              disabled={exportMutation.isPending}
            >
              <Download className="h-4 w-4 mr-1" /> {t('audit.exportCsv')}
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        {statsData?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">{t('audit.totalActions')}</div>
                <div className="text-2xl font-bold">{statsData.summary.totalActions.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">{t('audit.activeUsers')}</div>
                <div className="text-2xl font-bold">{statsData.summary.uniqueUsers}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">{t('audit.actionTypes')}</div>
                <div className="text-2xl font-bold">{statsData.summary.uniqueActions}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">{t('audit.entityTypes')}</div>
                <div className="text-2xl font-bold">{statsData.summary.uniqueEntityTypes}</div>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="logs">
              <FileText className="h-4 w-4 mr-1" /> {t('audit.logs')}
            </TabsTrigger>
            <TabsTrigger value="feed">
              <Activity className="h-4 w-4 mr-1" /> {t('audit.activity')}
            </TabsTrigger>
            <TabsTrigger value="stats">
              <TrendingUp className="h-4 w-4 mr-1" /> {t('audit.statistics')}
            </TabsTrigger>
          </TabsList>

          {/* ============ TAB: LOGS ============ */}
          <TabsContent value="logs" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('common.search')}
                      value={filters.search}
                      onChange={(e) => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0); }}
                      className="pl-8"
                    />
                  </div>
                  <Select value={filters.action} onValueChange={(v) => { setFilters(f => ({ ...f, action: v })); setPage(0); }}>
                    <SelectTrigger><SelectValue placeholder={t('audit.action')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('audit.allActions')}</SelectItem>
                      {(filterOptions?.actions || []).map((a: string) => (
                        <SelectItem key={a} value={a}>
                          {t(ACTION_ICONS[a]?.label ?? a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filters.entityType} onValueChange={(v) => { setFilters(f => ({ ...f, entityType: v })); setPage(0); }}>
                    <SelectTrigger><SelectValue placeholder={t('audit.entity')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('audit.allEntities')}</SelectItem>
                      {(filterOptions?.entityTypes || []).map((e: string) => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => { setDateRange(d => ({ ...d, from: e.target.value })); setPage(0); }}
                    placeholder={t('audit.fromDate')}
                  />
                  <Input
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => { setDateRange(d => ({ ...d, to: e.target.value })); setPage(0); }}
                    placeholder={t('audit.toDate')}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Logs table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setFilters(f => ({
                            ...f,
                            sortBy: "createdAt" as const,
                            sortOrder: f.sortBy === "createdAt" && f.sortOrder === "desc" ? "asc" : "desc"
                          }))}
                        >
                          {t('audit.timestamp')} <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>{t('audit.user')}</TableHead>
                      <TableHead>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setFilters(f => ({
                            ...f,
                            sortBy: "action",
                            sortOrder: f.sortBy === "action" && f.sortOrder === "desc" ? "asc" : "desc"
                          }))}
                        >
                          {t('audit.action')} <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>{t('audit.entity')}</TableHead>
                      <TableHead>{t('audit.description')}</TableHead>
                      <TableHead className="w-20">{t('audit.details')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {t('common.loading')}
                        </TableCell>
                      </TableRow>
                    ) : !logsData?.items?.length ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {t('audit.noData')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      logsData.items.map((log: any) => {
                        const actionInfo = ACTION_ICONS[log.action] || { label: log.action, icon: <Activity className="h-3 w-3" />, color: "bg-gray-500/20 text-gray-400" };
                        return (
                          <TableRow key={log.id} className="group hover:bg-muted/50">
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              {new Date(log.timestamp || log.createdAt).toLocaleString("vi-VN")}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                                  <User className="h-3 w-3 text-primary" />
                                </div>
                                <span className="text-sm">{log.username || log.userId || "System"}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${actionInfo.color}`}>
                                {actionInfo.icon}
                                <span className="ml-1">{t(actionInfo.label)}</span>
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <button
                                className="text-sm hover:underline text-primary cursor-pointer"
                                onClick={() => log.entityId && setEntityModal({
                                  entityType: log.entityType,
                                  entityId: Number(log.entityId),
                                })}
                              >
                                {log.entityType}
                                {log.entityId ? ` #${log.entityId}` : ""}
                              </button>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-50 truncate">
                              {log.description || log.details || "-"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => setSelectedLogId(log.id)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('audit.showing', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, logsData?.total || 0), total: logsData?.total || 0 })}
                </p>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ============ TAB: ACTIVITY FEED ============ */}
          <TabsContent value="feed">
            <Card>
              <CardHeader>
                <CardTitle>{t('audit.recentActivity')}</CardTitle>
                <CardDescription>{t('audit.recentActivityDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {activityFeed?.map((item: any) => {
                    const actionInfo = ACTION_ICONS[item.action] || { label: item.action, icon: <Activity className="h-3 w-3" />, color: "bg-gray-500/20 text-gray-400" };
                    return (
                      <div key={item.id} className="flex items-start gap-3 pb-4 border-b border-border/50 last:border-0">
                        <div className={`mt-1 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${actionInfo.color}`}>
                          {actionInfo.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            <span className="font-medium">{item.username || "System"}</span>
                            {" "}
                            <span className="text-muted-foreground">{item.description || `${t(actionInfo.label)} ${item.entityType || ""}`}</span>
                          </p>
                          {item.entityId && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.entityType} #{item.entityId}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            <Clock className="inline h-3 w-3 mr-1" />
                            {item.timeAgo || new Date(item.timestamp || item.createdAt).toLocaleString("vi-VN")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {(!activityFeed || activityFeed.length === 0) && (
                    <p className="text-center py-8 text-muted-foreground">{t('audit.noActivity')}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ TAB: STATS ============ */}
          <TabsContent value="stats" className="space-y-4">
            <div className="flex gap-2 mb-4">
              <Select value={statsGroupBy} onValueChange={(v: any) => setStatsGroupBy(v)}>
                <SelectTrigger className="w-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t('audit.byDay')}</SelectItem>
                  <SelectItem value="action">{t('audit.byAction')}</SelectItem>
                  <SelectItem value="entity">{t('audit.byEntity')}</SelectItem>
                  <SelectItem value="user">{t('audit.byUser')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Bar chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('audit.activityDistribution')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-75">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={statsData?.stats || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Pie chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('audit.ratioByType')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-75">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statsData?.stats || []}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          innerRadius={50}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {(statsData?.stats || []).map((_: any, i: number) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* ============ CHANGE DIFF DIALOG ============ */}
        <Dialog open={!!selectedLogId} onOpenChange={() => setSelectedLogId(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5" /> {t('audit.changeDetails')}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('audit.changeDetails')}</DialogDescription>
            </DialogHeader>
            {changeDiff ? (
              <ScrollArea className="max-h-[70vh]">
                <div className="space-y-4">
                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t('audit.timestamp')}:</span>{" "}
                      {new Date(changeDiff.timestamp).toLocaleString("vi-VN")}
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('audit.performer')}:</span>{" "}
                      {changeDiff.userName || "System"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('audit.action')}:</span>{" "}
                      <Badge variant="outline">
                        {t(ACTION_ICONS[changeDiff.action]?.label ?? changeDiff.action)}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('audit.entity')}:</span>{" "}
                      {changeDiff.entityType} #{changeDiff.entityId}
                    </div>
                  </div>

                  <Separator />

                  {/* Changes */}
                  {changeDiff.changes?.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">{t('audit.changedFields')}</h4>
                      {changeDiff.changes.map((change: any, i: number) => (
                        <div key={i} className="rounded-md border p-3 space-y-2">
                          <div className="text-sm font-medium text-primary">{change.field}</div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-xs text-red-400 block mb-1">{t('audit.oldValue')}</span>
                              <pre className="bg-red-500/10 border border-red-500/20 rounded p-2 text-xs whitespace-pre-wrap">
                                {change.oldValue != null ? JSON.stringify(change.oldValue, null, 2) : t('audit.empty')}
                              </pre>
                            </div>
                            <div>
                              <span className="text-xs text-green-400 block mb-1">{t('audit.newValue')}</span>
                              <pre className="bg-green-500/10 border border-green-500/20 rounded p-2 text-xs whitespace-pre-wrap">
                                {change.newValue != null ? JSON.stringify(change.newValue, null, 2) : t('audit.empty')}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {changeDiff.before || changeDiff.after ? (
                        <div className="grid grid-cols-2 gap-2">
                          {changeDiff.before && (
                            <div>
                              <span className="text-xs text-red-400 block mb-1">{t('audit.before')}</span>
                              <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap overflow-auto max-h-75">
                                {JSON.stringify(changeDiff.before, null, 2)}
                              </pre>
                            </div>
                          )}
                          {changeDiff.after && (
                            <div>
                              <span className="text-xs text-green-400 block mb-1">{t('audit.after')}</span>
                              <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap overflow-auto max-h-75">
                                {JSON.stringify(changeDiff.after, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p>{t('audit.noChangeDetails')}</p>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
            )}
          </DialogContent>
        </Dialog>

        {/* ============ ENTITY HISTORY DIALOG ============ */}
        <Dialog open={!!entityModal} onOpenChange={() => setEntityModal(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                {t('audit.historyFor', { entityType: entityModal?.entityType, entityId: entityModal?.entityId })}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('audit.historyFor', { entityType: entityModal?.entityType, entityId: entityModal?.entityId })}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-3">
                {entityHistory?.history?.map((entry: any) => {
                  const actionInfo = ACTION_ICONS[entry.action] || { label: entry.action, icon: <Activity className="h-3 w-3" />, color: "bg-gray-500/20 text-gray-400" };
                  return (
                    <div key={entry.id} className="flex items-start gap-3 pb-3 border-b border-border/50 last:border-0">
                      <div className={`mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${actionInfo.color}`}>
                        {actionInfo.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">{t(actionInfo.label)}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.timestamp || entry.createdAt).toLocaleString("vi-VN")}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {entry.username || "System"}: {entry.description || "-"}
                        </p>
                        {entry.changes && entry.changes.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {entry.changes.slice(0, 3).map((c: any, i: number) => (
                              <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1">
                                <span className="font-medium">{c.field}:</span>{" "}
                                <span className="text-red-400">{String(c.oldValue ?? "")}</span> →{" "}
                                <span className="text-green-400">{String(c.newValue ?? "")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(!entityHistory || entityHistory.history.length === 0) && (
                    <p className="text-center py-8 text-muted-foreground">{t('audit.noEntityHistory')}</p>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

export default function EnhancedAuditLogs() {
  return (
    <DashboardLayout>
      <EnhancedAuditLogsContent />
    </DashboardLayout>
  );
}
