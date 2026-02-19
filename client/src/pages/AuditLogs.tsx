import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { 
  Activity, Shield, User, Clock, Search, Filter, 
  LogIn, LogOut, Plus, Edit, Trash2, Key, RefreshCw,
  TrendingUp, Users, AlertTriangle, CheckCircle, XCircle,
  Download
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  login: { label: "audit.actionLogin", icon: <LogIn className="h-4 w-4" />, color: "bg-green-500" },
  login_failed: { label: "audit.actionLoginFailed", icon: <AlertTriangle className="h-4 w-4" />, color: "bg-red-500" },
  logout: { label: "audit.actionLogout", icon: <LogOut className="h-4 w-4" />, color: "bg-blue-500" },
  create: { label: "audit.actionCreate", icon: <Plus className="h-4 w-4" />, color: "bg-emerald-500" },
  update: { label: "audit.actionUpdate", icon: <Edit className="h-4 w-4" />, color: "bg-yellow-500" },
  delete: { label: "audit.actionDelete", icon: <Trash2 className="h-4 w-4" />, color: "bg-red-500" },
  password_change: { label: "audit.actionPasswordChange", icon: <Key className="h-4 w-4" />, color: "bg-purple-500" },
  role_change: { label: "audit.actionRoleChange", icon: <Shield className="h-4 w-4" />, color: "bg-orange-500" },
  export: { label: "audit.actionExport", icon: <TrendingUp className="h-4 w-4" />, color: "bg-cyan-500" },
};

const ENTITY_LABELS: Record<string, string> = {
  user: "audit.entityUser",
  machine: "audit.entityMachine",
  product: "audit.entityProduct",
  inspection: "audit.entityInspection",
  factory: "audit.entityFactory",
  workshop: "audit.entityWorkshop",
  line: "audit.entityLine",
  station: "audit.entityStation",
  alert: "audit.entityAlert",
  threshold: "audit.entityThreshold",
  mapping: "audit.entityMapping",
  order: "audit.entityOrder",
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function AuditLogs() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    action: "all",
    entityType: "all",
    status: "all",
    search: "",
  });
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Always call hooks before any conditional returns
  const isAdmin = (user as any)?.role === "admin";
  
  const { data: logsData, isLoading } = trpc.audit.list.useQuery({
    action: filters.action === "all" ? undefined : filters.action || undefined,
    entityType: filters.entityType === "all" ? undefined : filters.entityType || undefined,
    status: filters.status === "all" ? undefined : filters.status as "success" | "failure" | undefined,
    limit: pageSize,
    offset: page * pageSize,
  }, {
    enabled: isAdmin, // Only fetch when user is admin
  });

  const { data: stats } = trpc.audit.stats.useQuery({ days: 7 }, {
    enabled: isAdmin, // Only fetch when user is admin
  });

  // Check admin access after all hooks
  if (!isAdmin) {
    return (
      <DashboardLayout title={t('audit.title')} currentPath="/audit-logs">
        <div className="container py-12 text-center">
          <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">{t('audit.accessDenied')}</h2>
          <p className="text-muted-foreground mt-2">
            {t('audit.adminOnlyMessage')}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const totalPages = Math.ceil((logsData?.total || 0) / pageSize);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getActionInfo = (action: string) => {
    return ACTION_LABELS[action] || { 
      label: action, 
      icon: <Activity className="h-4 w-4" />, 
      color: "bg-gray-500" 
    };
  };

  // Export to CSV function
  const handleExportCSV = () => {
    if (!logsData?.logs || logsData.logs.length === 0) {
      toast.error(t('audit.noDataToExport'));
      return;
    }

    const headers = [
      t('audit.csvTime'),
      t('audit.csvUser'),
      t('audit.csvAction'),
      t('audit.csvEntity'),
      t('audit.csvEntityId'),
      t('audit.csvStatus'),
      t('audit.csvIpAddress'),
      t('audit.csvDetails')
    ];

    const rows = logsData.logs.map(log => [
      formatDate(log.createdAt),
      log.userName || t('audit.system'),
      t(ACTION_LABELS[log.action]?.label || log.action),
      t(ENTITY_LABELS[log.entityType || ""] || log.entityType || ""),
      log.entityId || "",
      log.status === "success" ? t('audit.statusSuccess') : t('audit.statusFailure'),
      log.ipAddress || "",
      log.details ? JSON.stringify(log.details) : ""
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success(t('audit.exportSuccess', { count: logsData.logs.length }));
  };

  // Prepare chart data
  const pieData = stats ? [
    { name: t('audit.actionLogin'), value: stats.loginCount },
    { name: t('audit.actionCreate'), value: stats.createCount },
    { name: t('audit.actionUpdate'), value: stats.updateCount },
    { name: t('audit.actionDelete'), value: stats.deleteCount },
    { name: t('audit.statusFailure'), value: stats.failedLogins },
  ].filter(d => d.value > 0) : [];

  return (
    <DashboardLayout title={t('audit.title')} currentPath="/audit-logs">
      <div className="container py-6 space-y-6">
        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs" className="gap-2">
              <Activity className="h-4 w-4" />
              {t('audit.logs')}
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('audit.statistics')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  {t('audit.filters')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>{t('audit.action')}</Label>
                    <Select 
                      value={filters.action} 
                      onValueChange={(v) => { setFilters({ ...filters, action: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('common.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        {Object.entries(ACTION_LABELS).map(([key, { label }]) => (
                          <SelectItem key={key} value={key}>{t(label)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('audit.entity')}</Label>
                    <Select 
                      value={filters.entityType} 
                      onValueChange={(v) => { setFilters({ ...filters, entityType: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('common.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{t(label)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('audit.statusLabel')}</Label>
                    <Select 
                      value={filters.status} 
                      onValueChange={(v) => { setFilters({ ...filters, status: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('common.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        <SelectItem value="success">{t('audit.statusSuccess')}</SelectItem>
                        <SelectItem value="failure">{t('audit.statusFailure')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>&nbsp;</Label>
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => { setFilters({ action: "", entityType: "", status: "", search: "" }); setPage(0); }}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('audit.clearFilters')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Logs Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    {t('audit.activityLog')}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{logsData?.total || 0} {t('audit.records')}</Badge>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleExportCSV}
                      disabled={!logsData?.logs || logsData.logs.length === 0}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {t('audit.exportCSV')}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">{t('audit.csvTime')}</TableHead>
                          <TableHead>{t('audit.csvUser')}</TableHead>
                          <TableHead>{t('audit.csvAction')}</TableHead>
                          <TableHead>{t('audit.csvEntity')}</TableHead>
                          <TableHead>{t('audit.csvDetails')}</TableHead>
                          <TableHead className="w-[100px]">{t('audit.csvStatus')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logsData?.logs.map((log) => {
                          const actionInfo = getActionInfo(log.action);
                          return (
                            <TableRow key={log.id}>
                              <TableCell className="text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(log.createdAt)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="h-4 w-4 text-primary" />
                                  </div>
                                  <span className="font-medium">
                                    {log.userName || t('audit.system')}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className={`p-1 rounded ${actionInfo.color} text-white`}>
                                    {actionInfo.icon}
                                  </div>
                                  <span>{t(actionInfo.label)}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {log.entityType && (
                                  <div>
                                    <span className="text-muted-foreground">
                                      {t(ENTITY_LABELS[log.entityType] || log.entityType)}
                                    </span>
                                    {log.entityName && (
                                      <span className="ml-1 font-medium">
                                        : {log.entityName}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                                {log.details && (
                                  <span title={log.details}>
                                    {(() => {
                                      try {
                                        const parsed = JSON.parse(log.details);
                                        return Object.entries(parsed)
                                          .map(([k, v]) => `${k}: ${v}`)
                                          .join(", ");
                                      } catch {
                                        return log.details;
                                      }
                                    })()}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {log.status === "success" ? (
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    OK
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-red-600 border-red-600">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    {t('audit.statusError')}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {(!logsData?.logs || logsData.logs.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              {t('audit.noData')}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                          {t('audit.page')} {page + 1} / {totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                          >
                            {t('common.previous')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                          >
                            {t('common.next')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats" className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-blue-500/10">
                      <Activity className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('audit.totalActivities')}</p>
                      <p className="text-2xl font-bold">{stats?.totalActions || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-green-500/10">
                      <LogIn className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('audit.actionLogin')}</p>
                      <p className="text-2xl font-bold">{stats?.loginCount || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-red-500/10">
                      <AlertTriangle className="h-6 w-6 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('audit.actionLoginFailed')}</p>
                      <p className="text-2xl font-bold">{stats?.failedLogins || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-purple-500/10">
                      <Users className="h-6 w-6 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('audit.activeUsers')}</p>
                      <p className="text-2xl font-bold">{stats?.topUsers?.length || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Actions by Day Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('audit.activityByDay')}</CardTitle>
                  <CardDescription>{t('audit.last7Days')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats?.actionsByDay?.slice().reverse() || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis 
                          dataKey="date" 
                          tickFormatter={(v) => new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
                          className="text-xs"
                        />
                        <YAxis className="text-xs" />
                        <Tooltip 
                          labelFormatter={(v) => new Date(v).toLocaleDateString("vi-VN")}
                          formatter={(v: number) => [v, t('audit.activities')]}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Actions Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('audit.activityDistribution')}</CardTitle>
                  <CardDescription>{t('audit.byActionType')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Users */}
            <Card>
              <CardHeader>
                  <CardTitle className="text-base">{t('audit.mostActiveUsers')}</CardTitle>
                  <CardDescription>{t('audit.top10Last7Days')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats?.topUsers?.map((u, i) => (
                    <div key={u.userName} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{u.userName}</p>
                      </div>
                      <Badge variant="secondary">{u.count} {t('audit.activities')}</Badge>
                    </div>
                  ))}
                  {(!stats?.topUsers || stats.topUsers.length === 0) && (
                    <p className="text-center py-4 text-muted-foreground">
                      {t('audit.noData')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
