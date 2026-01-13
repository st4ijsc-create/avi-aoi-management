import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit, Trash2, Search, Package, Factory, Calendar, Target, CheckCircle2, BarChart3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import GanttChart from "@/components/GanttChart";

export default function ProductionOrders() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("list");
  
  // Form state
  const [orderCode, setOrderCode] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [workshopId, setWorkshopId] = useState<number | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [targetQuantity, setTargetQuantity] = useState("");
  const [priority, setPriority] = useState("0");
  const [notes, setNotes] = useState("");

  // Queries
  const { data: orders, refetch } = trpc.productionOrder.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery();

  // Mutations
  const createMutation = trpc.productionOrder.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo lệnh sản xuất thành công");
      setIsCreateOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const updateMutation = trpc.productionOrder.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật lệnh sản xuất thành công");
      setIsEditOpen(false);
      setSelectedOrder(null);
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const deleteMutation = trpc.productionOrder.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa lệnh sản xuất thành công");
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const resetForm = () => {
    setOrderCode("");
    setCompanyCode("");
    setFactoryId(null);
    setWorkshopId(null);
    setLineId(null);
    setProductModelId(null);
    setTargetQuantity("");
    setPriority("0");
    setNotes("");
  };

  const handleCreate = () => {
    if (!orderCode || !companyCode || !factoryId || !workshopId || !lineId || !productModelId || !targetQuantity) {
      toast.error("Vui lòng điền đầy đủ thông tin bắt buộc");
      return;
    }
    createMutation.mutate({
      orderCode,
      companyCode,
      factoryId,
      workshopId,
      lineId,
      productModelId,
      targetQuantity: parseInt(targetQuantity),
      priority: parseInt(priority),
      notes: notes || undefined,
    });
  };

  const handleEdit = (order: any) => {
    setSelectedOrder(order);
    setOrderCode(order.orderCode);
    setCompanyCode(order.companyCode);
    setFactoryId(order.factoryId);
    setWorkshopId(order.workshopId);
    setLineId(order.lineId);
    setProductModelId(order.productModelId);
    setTargetQuantity(order.targetQuantity.toString());
    setPriority(order.priority.toString());
    setNotes(order.notes || "");
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedOrder) return;
    updateMutation.mutate({
      id: selectedOrder.id,
      orderCode,
      companyCode,
      factoryId: factoryId || undefined,
      workshopId: workshopId || undefined,
      lineId: lineId || undefined,
      productModelId: productModelId || undefined,
      targetQuantity: parseInt(targetQuantity),
      priority: parseInt(priority),
      notes: notes || undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Chờ xử lý", variant: "secondary" },
      in_progress: { label: "Đang sản xuất", variant: "default" },
      completed: { label: "Hoàn thành", variant: "outline" },
      cancelled: { label: "Đã hủy", variant: "destructive" },
      paused: { label: "Tạm dừng", variant: "secondary" },
    };
    const config = statusMap[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getProgress = (order: any) => {
    if (order.targetQuantity === 0) return 0;
    return Math.round((order.completedQuantity / order.targetQuantity) * 100);
  };

  const filteredOrders = orders?.filter((order) => {
    const matchesSearch = order.orderCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.companyCode.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const getFactoryName = (id: number) => factories?.find(f => f.id === id)?.name || "-";
  const getWorkshopName = (id: number) => workshops?.find(w => w.id === id)?.name || "-";
  const getLineName = (id: number) => lines?.find(l => l.id === id)?.name || "-";
  const getProductName = (id: number) => products?.find(p => p.id === id)?.name || "-";

  // Filter workshops by selected factory
  const filteredWorkshops = workshops?.filter(w => !factoryId || w.factoryId === factoryId);
  // Filter lines by selected workshop
  const filteredLines = lines?.filter(l => !workshopId || l.workshopId === workshopId);

  return (
    <DashboardLayout title="Lệnh sản xuất" navItems={navItems} currentPath="/production-orders">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Lệnh sản xuất</h1>
            <p className="text-muted-foreground">Quản lý các lệnh sản xuất theo dây chuyền</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" />
                Tạo lệnh mới
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Tạo lệnh sản xuất mới</DialogTitle>
                <DialogDescription>Nhập thông tin lệnh sản xuất</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mã lệnh sản xuất *</Label>
                  <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="PO-2024-001" />
                </div>
                <div className="space-y-2">
                  <Label>Mã công ty *</Label>
                  <Input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} placeholder="CORP-001" />
                </div>
                <div className="space-y-2">
                  <Label>Nhà máy *</Label>
                  <Select value={factoryId?.toString() || ""} onValueChange={(v) => { setFactoryId(parseInt(v)); setWorkshopId(null); setLineId(null); }}>
                    <SelectTrigger><SelectValue placeholder="Chọn nhà máy" /></SelectTrigger>
                    <SelectContent>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Nhà xưởng *</Label>
                  <Select value={workshopId?.toString() || ""} onValueChange={(v) => { setWorkshopId(parseInt(v)); setLineId(null); }} disabled={!factoryId}>
                    <SelectTrigger><SelectValue placeholder="Chọn nhà xưởng" /></SelectTrigger>
                    <SelectContent>
                      {filteredWorkshops?.map((w) => (
                        <SelectItem key={w.id} value={w.id.toString()}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Dây chuyền *</Label>
                  <Select value={lineId?.toString() || ""} onValueChange={(v) => setLineId(parseInt(v))} disabled={!workshopId}>
                    <SelectTrigger><SelectValue placeholder="Chọn dây chuyền" /></SelectTrigger>
                    <SelectContent>
                      {filteredLines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sản phẩm *</Label>
                  <Select value={productModelId?.toString() || ""} onValueChange={(v) => setProductModelId(parseInt(v))}>
                    <SelectTrigger><SelectValue placeholder="Chọn sản phẩm" /></SelectTrigger>
                    <SelectContent>
                      {products?.map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Số lượng mục tiêu *</Label>
                  <Input type="number" value={targetQuantity} onChange={(e) => setTargetQuantity(e.target.value)} placeholder="1000" />
                </div>
                <div className="space-y-2">
                  <Label>Độ ưu tiên</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Bình thường</SelectItem>
                      <SelectItem value="1">Cao</SelectItem>
                      <SelectItem value="2">Khẩn cấp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Ghi chú</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú thêm..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Hủy</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Đang tạo..." : "Tạo lệnh"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Package className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tổng lệnh</p>
                  <p className="text-2xl font-bold">{orders?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <Calendar className="w-6 h-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Đang sản xuất</p>
                  <p className="text-2xl font-bold">{orders?.filter(o => o.status === 'in_progress').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Hoàn thành</p>
                  <p className="text-2xl font-bold">{orders?.filter(o => o.status === 'completed').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/10 rounded-lg">
                  <Target className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tổng sản lượng</p>
                  <p className="text-2xl font-bold">{orders?.reduce((sum, o) => sum + o.completedQuantity, 0) || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* View Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="list" className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              Danh sách
            </TabsTrigger>
            <TabsTrigger value="gantt" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Gantt Chart
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="list" className="space-y-4 mt-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Tìm theo mã lệnh, mã công ty..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Trạng thái" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả trạng thái</SelectItem>
                      <SelectItem value="pending">Chờ xử lý</SelectItem>
                      <SelectItem value="in_progress">Đang sản xuất</SelectItem>
                      <SelectItem value="completed">Hoàn thành</SelectItem>
                      <SelectItem value="paused">Tạm dừng</SelectItem>
                      <SelectItem value="cancelled">Đã hủy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Orders Table */}
            <Card>
              <CardHeader>
                <CardTitle>Danh sách lệnh sản xuất</CardTitle>
                <CardDescription>Quản lý và theo dõi tiến độ các lệnh sản xuất</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã lệnh</TableHead>
                      <TableHead>Công ty</TableHead>
                      <TableHead>Dây chuyền</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Tiến độ</TableHead>
                      <TableHead>OK/NG/NTF</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders?.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.orderCode}</TableCell>
                        <TableCell>{order.companyCode}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{getLineName(order.lineId)}</div>
                            <div className="text-muted-foreground text-xs">{getWorkshopName(order.workshopId)}</div>
                          </div>
                        </TableCell>
                        <TableCell>{getProductName(order.productModelId)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${getProgress(order)}%` }}
                              />
                            </div>
                            <span className="text-sm">{order.completedQuantity}/{order.targetQuantity}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <span className="text-green-500">{order.okQuantity}</span>
                            {" / "}
                            <span className="text-red-500">{order.ngQuantity}</span>
                            {" / "}
                            <span className="text-yellow-500">{order.ntfQuantity}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(order)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Bạn có chắc muốn xóa lệnh sản xuất này?")) {
                                  deleteMutation.mutate({ id: order.id });
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!filteredOrders || filteredOrders.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Chưa có lệnh sản xuất nào
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="gantt" className="mt-4">
            <GanttChart
              orders={orders || []}
              lines={lines || []}
              workshops={workshops || []}
              factories={factories || []}
              products={products || []}
              onOrderClick={(order) => handleEdit(order)}
            />
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Chỉnh sửa lệnh sản xuất</DialogTitle>
              <DialogDescription>Cập nhật thông tin lệnh sản xuất</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mã lệnh sản xuất</Label>
                <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Mã công ty</Label>
                <Input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Số lượng mục tiêu</Label>
                <Input type="number" value={targetQuantity} onChange={(e) => setTargetQuantity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Trạng thái</Label>
                <Select value={selectedOrder?.status || "pending"} onValueChange={(v) => setSelectedOrder({ ...selectedOrder, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Chờ xử lý</SelectItem>
                    <SelectItem value="in_progress">Đang sản xuất</SelectItem>
                    <SelectItem value="completed">Hoàn thành</SelectItem>
                    <SelectItem value="paused">Tạm dừng</SelectItem>
                    <SelectItem value="cancelled">Đã hủy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Độ ưu tiên</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Bình thường</SelectItem>
                    <SelectItem value="1">Cao</SelectItem>
                    <SelectItem value="2">Khẩn cấp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Ghi chú</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>Hủy</Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
