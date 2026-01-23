import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  Cog, 
  Plus, 
  Pencil, 
  Trash2, 
  Loader2,
  Factory,
  GitBranch,
  Warehouse
} from "lucide-react";

type Workstation = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  lineId?: number | null;
  workshopId?: number | null;
  factoryId?: number | null;
  processType?: string | null;
  orderIndex?: number | null;
  isActive: boolean;
};

const processTypes = [
  { value: 'SMT', label: 'SMT' },
  { value: 'DIP', label: 'DIP' },
  { value: 'ASSEMBLY', label: 'Assembly' },
  { value: 'TESTING', label: 'Testing' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'OTHER', label: 'Other' },
];

export default function WorkstationManagement() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    lineId: "",
    workshopId: "",
    factoryId: "",
    processType: "",
    orderIndex: "0",
  });

  // Queries
  const { data: workstations, isLoading, refetch } = trpc.workstation.list.useQuery({});
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Mutations
  const createMutation = trpc.workstation.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo công trạm thành công");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.workstation.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật công trạm thành công");
      setEditDialogOpen(false);
      setEditingWorkstation(null);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.workstation.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa công trạm thành công");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setForm({
      code: "",
      name: "",
      description: "",
      lineId: "",
      workshopId: "",
      factoryId: "",
      processType: "",
      orderIndex: "0",
    });
  };

  const handleCreate = () => {
    if (!form.code || !form.name) {
      toast.error("Vui lòng nhập mã và tên công trạm");
      return;
    }

    createMutation.mutate({
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      lineId: form.lineId ? parseInt(form.lineId) : undefined,
      workshopId: form.workshopId ? parseInt(form.workshopId) : undefined,
      factoryId: form.factoryId ? parseInt(form.factoryId) : undefined,
      processType: form.processType as any || undefined,
      orderIndex: parseInt(form.orderIndex) || 0,
    });
  };

  const handleUpdate = () => {
    if (!editingWorkstation) return;

    updateMutation.mutate({
      id: editingWorkstation.id,
      code: editingWorkstation.code,
      name: editingWorkstation.name,
      description: editingWorkstation.description || undefined,
      lineId: editingWorkstation.lineId,
      workshopId: editingWorkstation.workshopId,
      factoryId: editingWorkstation.factoryId,
      processType: editingWorkstation.processType as any || undefined,
      orderIndex: editingWorkstation.orderIndex || 0,
      isActive: editingWorkstation.isActive,
    });
  };

  const openEditDialog = (ws: Workstation) => {
    setEditingWorkstation({ ...ws });
    setEditDialogOpen(true);
  };

  const getFactoryName = (factoryId?: number | null) => {
    if (!factoryId) return "-";
    return factories?.find(f => f.id === factoryId)?.name || "-";
  };

  const getWorkshopName = (workshopId?: number | null) => {
    if (!workshopId) return "-";
    return workshops?.find(w => w.id === workshopId)?.name || "-";
  };

  const getLineName = (lineId?: number | null) => {
    if (!lineId) return "-";
    return lines?.find(l => l.id === lineId)?.name || "-";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cog className="h-5 w-5 text-orange-500" />
                Quản lý công trạm (Workstation)
              </CardTitle>
              <CardDescription>
                {workstations?.length || 0} công trạm
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Thêm công trạm
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Thêm công trạm mới</DialogTitle>
                  <DialogDescription>
                    Tạo công trạm mới trong hệ thống
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Mã công trạm *</label>
                      <Input
                        placeholder="VD: WS001"
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tên công trạm *</label>
                      <Input
                        placeholder="VD: Công trạm SMT 1"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mô tả</label>
                    <Input
                      placeholder="Mô tả công trạm"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Nhà máy</label>
                      <Select value={form.factoryId} onValueChange={(v) => setForm({ ...form, factoryId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn nhà máy..." />
                        </SelectTrigger>
                        <SelectContent>
                          {factories?.map((f) => (
                            <SelectItem key={f.id} value={f.id.toString()}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Nhà xưởng</label>
                      <Select value={form.workshopId} onValueChange={(v) => setForm({ ...form, workshopId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn nhà xưởng..." />
                        </SelectTrigger>
                        <SelectContent>
                          {workshops?.map((w) => (
                            <SelectItem key={w.id} value={w.id.toString()}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Dây chuyền</label>
                      <Select value={form.lineId} onValueChange={(v) => setForm({ ...form, lineId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn dây chuyền..." />
                        </SelectTrigger>
                        <SelectContent>
                          {lines?.map((l) => (
                            <SelectItem key={l.id} value={l.id.toString()}>
                              {l.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Loại công đoạn</label>
                      <Select value={form.processType} onValueChange={(v) => setForm({ ...form, processType: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn loại..." />
                        </SelectTrigger>
                        <SelectContent>
                          {processTypes.map((pt) => (
                            <SelectItem key={pt.value} value={pt.value}>
                              {pt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Thứ tự</label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.orderIndex}
                      onChange={(e) => setForm({ ...form, orderIndex: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Hủy
                  </Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Tạo
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Nhà máy</TableHead>
                  <TableHead>Dây chuyền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workstations?.map((ws) => (
                  <TableRow key={ws.id}>
                    <TableCell className="font-medium">{ws.code}</TableCell>
                    <TableCell>{ws.name}</TableCell>
                    <TableCell>
                      {ws.processType && (
                        <Badge variant="outline">{ws.processType}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Factory className="h-3 w-3" />
                        {getFactoryName(ws.factoryId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <GitBranch className="h-3 w-3" />
                        {getLineName(ws.lineId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ws.isActive ? "default" : "secondary"}>
                        {ws.isActive ? "Hoạt động" : "Tạm dừng"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(ws)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Bạn có chắc muốn xóa công trạm này?")) {
                              deleteMutation.mutate(ws.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!workstations || workstations.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Chưa có công trạm nào. Nhấn "Thêm công trạm" để tạo mới.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa công trạm</DialogTitle>
          </DialogHeader>
          {editingWorkstation && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mã công trạm</label>
                  <Input
                    value={editingWorkstation.code}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tên công trạm</label>
                  <Input
                    value={editingWorkstation.name}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mô tả</label>
                <Input
                  value={editingWorkstation.description || ""}
                  onChange={(e) => setEditingWorkstation({ ...editingWorkstation, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nhà máy</label>
                  <Select 
                    value={editingWorkstation.factoryId?.toString() || ""} 
                    onValueChange={(v) => setEditingWorkstation({ ...editingWorkstation, factoryId: v ? parseInt(v) : null })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn nhà máy..." />
                    </SelectTrigger>
                    <SelectContent>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Dây chuyền</label>
                  <Select 
                    value={editingWorkstation.lineId?.toString() || ""} 
                    onValueChange={(v) => setEditingWorkstation({ ...editingWorkstation, lineId: v ? parseInt(v) : null })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn dây chuyền..." />
                    </SelectTrigger>
                    <SelectContent>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Loại công đoạn</label>
                  <Select 
                    value={editingWorkstation.processType || ""} 
                    onValueChange={(v) => setEditingWorkstation({ ...editingWorkstation, processType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn loại..." />
                    </SelectTrigger>
                    <SelectContent>
                      {processTypes.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {pt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Thứ tự</label>
                  <Input
                    type="number"
                    value={editingWorkstation.orderIndex || 0}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, orderIndex: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Trạng thái hoạt động</label>
                <Switch
                  checked={editingWorkstation.isActive}
                  onCheckedChange={(checked) => setEditingWorkstation({ ...editingWorkstation, isActive: checked })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
