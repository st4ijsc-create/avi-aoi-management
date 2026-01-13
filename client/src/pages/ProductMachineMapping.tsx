import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Package,
  Cpu,
  Plus,
  Loader2,
  Trash2,
  Link,
  Unlink,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState } from "react";

export default function ProductMachineMapping() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [selectedMachineId, setSelectedMachineId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery();
  const { data: mappings, refetch: refetchMappings } = trpc.productMachineMapping.list.useQuery();

  // Mutations
  const createMappingMutation = trpc.productMachineMapping.create.useMutation({
    onSuccess: () => {
      toast.success("Gán sản phẩm cho máy thành công");
      setDialogOpen(false);
      setSelectedMachineId("");
      setSelectedProductId("");
      refetchMappings();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMappingMutation = trpc.productMachineMapping.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa gán sản phẩm thành công");
      refetchMappings();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleActiveMutation = trpc.productMachineMapping.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật trạng thái thành công");
      refetchMappings();
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Group mappings by machinechine
  const mappingsByMachine = mappings?.reduce((acc, mapping) => {
    const machineId = mapping.machineId;
    if (!acc[machineId]) {
      acc[machineId] = [];
    }
    acc[machineId].push(mapping);
    return acc;
  }, {} as Record<number, typeof mappings>);

  return (
    <DashboardLayout
      title="Gán sản phẩm - Máy"
      navItems={navItems}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gán sản phẩm cho máy</h1>
            <p className="text-muted-foreground">
              Cấu hình sản phẩm nào được phép chạy trên máy nào
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" disabled={!isAdmin}>
                <Plus className="h-4 w-4" />
                Thêm gán mới
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gán sản phẩm cho máy</DialogTitle>
                <DialogDescription>
                  Chọn máy và sản phẩm để tạo liên kết
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Máy *</label>
                  <Select value={selectedMachineId} onValueChange={setSelectedMachineId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn máy" />
                    </SelectTrigger>
                    <SelectContent>
                      {machines?.map((machine) => (
                        <SelectItem key={machine.id} value={String(machine.id)}>
                          {machine.name} ({machine.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Sản phẩm *</label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn sản phẩm" />
                    </SelectTrigger>
                    <SelectContent>
                      {products?.map((product) => (
                        <SelectItem key={product.id} value={String(product.id)}>
                         {product?.name} ({product?.code})                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Hủy</Button>
                <Button 
                  onClick={() => createMappingMutation.mutate({
                    machineId: parseInt(selectedMachineId),
                    productModelId: parseInt(selectedProductId),
                  })}
                  disabled={createMappingMutation.isPending || !selectedMachineId || !selectedProductId}
                >
                  {createMappingMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Tạo liên kết
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Mappings by Machine */}
        <div className="grid gap-6">
          {machines?.map((machine) => {
            const machineMappings = mappingsByMachine?.[machine.id] || [];
            
            return (
              <Card key={machine.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Cpu className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{machine.name}</CardTitle>
                      <CardDescription>
                        {machine.code} • {machine.machineType} • {machineMappings.length} sản phẩm được gán
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {machineMappings.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {machineMappings.map((mapping: any) => {
                        const product = products?.find(p => p.id === mapping.productModelId);
                        return (
                          <div 
                            key={mapping.id} 
                            className={`flex items-center justify-between p-3 rounded-lg border ${
                              mapping.isActive ? 'bg-green-500/5 border-green-500/20' : 'bg-muted/50 border-border'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded ${mapping.isActive ? 'bg-green-500/10' : 'bg-muted'}`}>
                                <Package className={`h-4 w-4 ${mapping.isActive ? 'text-green-500' : 'text-muted-foreground'}`} />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{product?.name || 'N/A'}</p>
                                <p className="text-xs text-muted-foreground">{product?.code}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => toggleActiveMutation.mutate({ 
                                  id: mapping.id, 
                                  isActive: !mapping.isActive 
                                } as any)}
                                disabled={!isAdmin}
                              >
                                {mapping.isActive ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    disabled={!isAdmin}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Bạn có chắc chắn muốn xóa liên kết giữa máy "{machine.name}" và sản phẩm "{product?.name}"?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Hủy</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMappingMutation.mutate({ id: mapping.id })}>
                                      Xóa
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Unlink className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Chưa có sản phẩm nào được gán cho máy này
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-3 gap-2"
                        onClick={() => {
                          setSelectedMachineId(String(machine.id));
                          setDialogOpen(true);
                        }}
                        disabled={!isAdmin}
                      >
                        <Link className="h-4 w-4" />
                        Gán sản phẩm
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {(!machines || machines.length === 0) && (
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Cpu className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Chưa có máy nào trong hệ thống. Vui lòng thêm máy trước.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
