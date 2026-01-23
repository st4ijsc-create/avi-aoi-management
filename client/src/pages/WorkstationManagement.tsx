import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Factory, 
  Layers,
  Settings2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3
} from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

type Workstation = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  lineId: number | null;
  workshopId: number | null;
  factoryId: number | null;
  processType: string | null;
  orderIndex: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const PROCESS_TYPES = [
  { value: "SMT", label: "SMT", color: "bg-blue-500" },
  { value: "DIP", label: "DIP", color: "bg-green-500" },
  { value: "ASSEMBLY", label: "Lắp ráp", color: "bg-yellow-500" },
  { value: "TESTING", label: "Kiểm tra", color: "bg-purple-500" },
  { value: "PACKAGING", label: "Đóng gói", color: "bg-orange-500" },
  { value: "OTHER", label: "Khác", color: "bg-gray-500" },
];

export default function WorkstationManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLineId, setFilterLineId] = useState<string>("all");
  const [filterFactoryId, setFilterFactoryId] = useState<string>("all");
  const [filterProcessType, setFilterProcessType] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    lineId: "",
    workshopId: "",
    factoryId: "",
    processType: "OTHER",
    orderIndex: 0,
    isActive: true,
  });

  // Queries
  const { data: workstations, isLoading, refetch } = trpc.workstation.list.useQuery({
    lineId: filterLineId !== "all" ? parseInt(filterLineId) : undefined,
    factoryId: filterFactoryId !== "all" ? parseInt(filterFactoryId) : undefined,
  });
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Mutations
  const createMutation = trpc.workstation.create.useMutation({
    onSuccess: () => {
      toast.success("Đã tạo công trạm mới");
      refetch();
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.workstation.update.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật công trạm");
      refetch();
      setEditingWorkstation(null);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.workstation.delete.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa công trạm");
      refetch();
      setDeleteConfirmId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Filter workstations
  const filteredWorkstations = useMemo(() => {
    if (!workstations) return [];
    
    return workstations.filter((ws) => {
      const matchesSearch = 
        ws.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ws.name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesProcessType = filterProcessType === "all" || ws.processType === filterProcessType;
      
      return matchesSearch && matchesProcessType;
    });
  }, [workstations, searchQuery, filterProcessType]);

  // Stats
  const stats = useMemo(() => {
    if (!workstations) return { total: 0, active: 0, inactive: 0, byProcessType: {} as Record<string, number> };
    
    const byProcessType: Record<string, number> = {};
    let active = 0;
    let inactive = 0;
    
    workstations.forEach((ws) => {
      if (ws.isActive) active++;
      else inactive++;
      
      const type = ws.processType || "OTHER";
      byProcessType[type] = (byProcessType[type] || 0) + 1;
    });
    
    return { total: workstations.length, active, inactive, byProcessType };
  }, [workstations]);

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      lineId: "",
      workshopId: "",
      factoryId: "",
      processType: "OTHER",
      orderIndex: 0,
      isActive: true,
    });
  };

  const handleCreate = () => {
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
    });
  };

  const handleUpdate = () => {
    if (!editingWorkstation) return;
    
    updateMutation.mutate({
      id: editingWorkstation.id,
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
      isActive: formData.isActive,
    });
  };

  const openEditDialog = (ws: Workstation) => {
    setEditingWorkstation(ws);
    setFormData({
      code: ws.code,
      name: ws.name,
      description: ws.description || "",
      lineId: ws.lineId?.toString() || "",
      workshopId: ws.workshopId?.toString() || "",
      factoryId: ws.factoryId?.toString() || "",
      processType: ws.processType || "OTHER",
      orderIndex: ws.orderIndex,
      isActive: ws.isActive,
    });
  };

  const getProcessTypeInfo = (type: string | null) => {
    return PROCESS_TYPES.find((pt) => pt.value === type) || PROCESS_TYPES[5];
  };

  const getFactoryName = (factoryId: number | null) => {
    if (!factoryId || !factories) return "-";
    return factories.find((f) => f.id === factoryId)?.name || "-";
  };

  const getLineName = (lineId: number | null) => {
    if (!lineId || !lines) return "-";
    return lines.find((l) => l.id === lineId)?.name || "-";
  };

  return (
    <DashboardLayout navItems={navItems}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Quản lý Công trạm</h1>
            <p className="text-muted-foreground">
              Quản lý danh sách công trạm trong các dây chuyền sản xuất
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Thêm công trạm
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tổng công trạm
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Đang hoạt động
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                Tạm dừng
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.inactive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                Theo loại
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(stats.byProcessType).map(([type, count]) => {
                  const info = getProcessTypeInfo(type);
                  return (
                    <Badge key={type} variant="secondary" className="text-xs">
                      {info.label}: {count}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Bộ lọc</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo mã hoặc tên..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <Select value={filterFactoryId} onValueChange={setFilterFactoryId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Nhà máy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả nhà máy</SelectItem>
                  {factories?.map((f) => (
                    <SelectItem key={f.id} value={f.id.toString()}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterLineId} onValueChange={setFilterLineId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Dây chuyền" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả dây chuyền</SelectItem>
                  {lines?.map((l) => (
                    <SelectItem key={l.id} value={l.id.toString()}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProcessType} onValueChange={setFilterProcessType}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Loại công đoạn" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả loại</SelectItem>
                  {PROCESS_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {pt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Danh sách công trạm</CardTitle>
            <CardDescription>
              {filteredWorkstations.length} công trạm
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Nhà máy</TableHead>
                  <TableHead>Dây chuyền</TableHead>
                  <TableHead>Thứ tự</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Đang tải...
                    </TableCell>
                  </TableRow>
                ) : filteredWorkstations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Không có công trạm nào
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredWorkstations.map((ws) => {
                    const processInfo = getProcessTypeInfo(ws.processType);
                    return (
                      <TableRow key={ws.id}>
                        <TableCell className="font-mono">{ws.code}</TableCell>
                        <TableCell className="font-medium">{ws.name}</TableCell>
                        <TableCell>
                          <Badge className={`${processInfo.color} text-white`}>
                            {processInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell>{getFactoryName(ws.factoryId)}</TableCell>
                        <TableCell>{getLineName(ws.lineId)}</TableCell>
                        <TableCell>{ws.orderIndex}</TableCell>
                        <TableCell>
                          <Badge variant={ws.isActive ? "default" : "secondary"}>
                            {ws.isActive ? "Hoạt động" : "Tạm dừng"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(ws)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Chỉnh sửa
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-red-600"
                                onClick={() => setDeleteConfirmId(ws.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Xóa
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog 
          open={isCreateDialogOpen || !!editingWorkstation} 
          onOpenChange={(open) => {
            if (!open) {
              setIsCreateDialogOpen(false);
              setEditingWorkstation(null);
              resetForm();
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingWorkstation ? "Chỉnh sửa công trạm" : "Thêm công trạm mới"}
              </DialogTitle>
              <DialogDescription>
                {editingWorkstation 
                  ? "Cập nhật thông tin công trạm" 
                  : "Điền thông tin để tạo công trạm mới"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Mã công trạm *</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="VD: WS001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Tên công trạm *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="VD: Công trạm SMT 1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Mô tả công trạm..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Loại công đoạn</Label>
                  <Select 
                    value={formData.processType} 
                    onValueChange={(v) => setFormData({ ...formData, processType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESS_TYPES.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {pt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderIndex">Thứ tự</Label>
                  <Input
                    id="orderIndex"
                    type="number"
                    value={formData.orderIndex}
                    onChange={(e) => setFormData({ ...formData, orderIndex: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nhà máy</Label>
                  <Select 
                    value={formData.factoryId} 
                    onValueChange={(v) => setFormData({ ...formData, factoryId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn nhà máy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Không chọn</SelectItem>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Dây chuyền</Label>
                  <Select 
                    value={formData.lineId} 
                    onValueChange={(v) => setFormData({ ...formData, lineId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn dây chuyền" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Không chọn</SelectItem>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="isActive">Trạng thái hoạt động</Label>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsCreateDialogOpen(false);
                  setEditingWorkstation(null);
                  resetForm();
                }}
              >
                Hủy
              </Button>
              <Button 
                onClick={editingWorkstation ? handleUpdate : handleCreate}
                disabled={!formData.code || !formData.name || createMutation.isPending || updateMutation.isPending}
              >
                {editingWorkstation ? "Cập nhật" : "Tạo mới"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                Xác nhận xóa
              </DialogTitle>
              <DialogDescription>
                Bạn có chắc chắn muốn xóa công trạm này? Hành động này không thể hoàn tác.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                Hủy
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
              >
                Xóa
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
