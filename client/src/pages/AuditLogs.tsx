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
  TrendingUp, Users, AlertTriangle, CheckCircle, XCircle
} from "lucide-react";
import { useState } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";

const ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  login: { label: "Đăng nhập", icon: <LogIn className="h-4 w-4" />, color: "bg-green-500" },
  login_failed: { label: "Đăng nhập thất bại", icon: <AlertTriangle className="h-4 w-4" />, color: "bg-red-500" },
  logout: { label: "Đăng xuất", icon: <LogOut className="h-4 w-4" />, color: "bg-blue-500" },
  create: { label: "Tạo mới", icon: <Plus className="h-4 w-4" />, color: "bg-emerald-500" },
  update: { label: "Cập nhật", icon: <Edit className="h-4 w-4" />, color: "bg-yellow-500" },
  delete: { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, color: "bg-red-500" },
  password_change: { label: "Đổi mật khẩu", icon: <Key className="h-4 w-4" />, color: "bg-purple-500" },
  role_change: { label: "Thay đổi vai trò", icon: <Shield className="h-4 w-4" />, color: "bg-orange-500" },
  export: { label: "Xuất dữ liệu", icon: <TrendingUp className="h-4 w-4" />, color: "bg-cyan-500" },
};

const ENTITY_LABELS: Record<string, string> = {
  user: "Người dùng",
  machine: "Máy",
  product: "Sản phẩm",
  inspection: "Kiểm tra",
  factory: "Nhà máy",
  workshop: "Xưởng",
  line: "Dây chuyền",
  station: "Trạm",
  alert: "Cảnh báo",
  threshold: "Ngưỡng",
  mapping: "Mapping",
  order: "Đơn hàng",
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function AuditLogs() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    status: "",
    search: "",
  });
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Check admin access
  if ((user as any)?.role !== "admin") {
    return (
      <DashboardLayout title="Lịch sử hoạt động" currentPath="/audit-logs">
        <div className="container py-12 text-center">
          <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Truy cập bị từ chối</h2>
          <p className="text-muted-foreground mt-2">
            Chỉ quản trị viên mới có quyền xem lịch sử hoạt động hệ thống.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const { data: logsData, isLoading } = trpc.audit.list.useQuery({
    action: filters.action || undefined,
    entityType: filters.entityType || undefined,
    status: filters.status as "success" | "failure" | undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const { data: stats } = trpc.audit.stats.useQuery({ days: 7 });

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

  // Prepare chart data
  const pieData = stats ? [
    { name: "Đăng nhập", value: stats.loginCount },
    { name: "Tạo mới", value: stats.createCount },
    { name: "Cập nhật", value: stats.updateCount },
    { name: "Xóa", value: stats.deleteCount },
    { name: "Thất bại", value: stats.failedLogins },
  ].filter(d => d.value > 0) : [];

  return (
    <DashboardLayout title="Lịch sử hoạt động" currentPath="/audit-logs">
      <div className="container py-6 space-y-6">
        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs" className="gap-2">
              <Activity className="h-4 w-4" />
              Nhật ký
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Thống kê
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Bộ lọc
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Hành động</Label>
                    <Select 
                      value={filters.action} 
                      onValueChange={(v) => { setFilters({ ...filters, action: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tất cả" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tất cả</SelectItem>
                        {Object.entries(ACTION_LABELS).map(([key, { label }]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Đối tượng</Label>
                    <Select 
                      value={filters.entityType} 
                      onValueChange={(v) => { setFilters({ ...filters, entityType: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tất cả" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tất cả</SelectItem>
                        {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Trạng thái</Label>
                    <Select 
                      value={filters.status} 
                      onValueChange={(v) => { setFilters({ ...filters, status: v }); setPage(0); }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tất cả" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tất cả</SelectItem>
                        <SelectItem value="success">Thành công</SelectItem>
                        <SelectItem value="failure">Thất bại</SelectItem>
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
                      Xóa bộ lọc
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
                    Nhật ký hoạt động
                  </span>
                  <Badge variant="secondary">{logsData?.total || 0} bản ghi</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Đang tải...
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Thời gian</TableHead>
                          <TableHead>Người dùng</TableHead>
                          <TableHead>Hành động</TableHead>
                          <TableHead>Đối tượng</TableHead>
                          <TableHead>Chi tiết</TableHead>
                          <TableHead className="w-[100px]">Trạng thái</TableHead>
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
                                    {log.userName || "Hệ thống"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className={`p-1 rounded ${actionInfo.color} text-white`}>
                                    {actionInfo.icon}
                                  </div>
                                  <span>{actionInfo.label}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {log.entityType && (
                                  <div>
                                    <span className="text-muted-foreground">
                                      {ENTITY_LABELS[log.entityType] || log.entityType}
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
                                    Lỗi
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {(!logsData?.logs || logsData.logs.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              Không có dữ liệu
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                          Trang {page + 1} / {totalPages}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                          >
                            Trước
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                          >
                            Sau
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
                      <p className="text-sm text-muted-foreground">Tổng hoạt động</p>
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
                      <p className="text-sm text-muted-foreground">Đăng nhập</p>
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
                      <p className="text-sm text-muted-foreground">Đăng nhập thất bại</p>
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
                      <p className="text-sm text-muted-foreground">Người dùng hoạt động</p>
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
                  <CardTitle className="text-base">Hoạt động theo ngày</CardTitle>
                  <CardDescription>7 ngày gần nhất</CardDescription>
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
                          formatter={(v: number) => [v, "Hoạt động"]}
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
                  <CardTitle className="text-base">Phân bố hoạt động</CardTitle>
                  <CardDescription>Theo loại hành động</CardDescription>
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
                <CardTitle className="text-base">Người dùng hoạt động nhiều nhất</CardTitle>
                <CardDescription>Top 10 trong 7 ngày qua</CardDescription>
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
                      <Badge variant="secondary">{u.count} hoạt động</Badge>
                    </div>
                  ))}
                  {(!stats?.topUsers || stats.topUsers.length === 0) && (
                    <p className="text-center py-4 text-muted-foreground">
                      Chưa có dữ liệu
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
