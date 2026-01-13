import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Building2,
  Warehouse,
  GitBranch,
  Cpu,
  Plus,
  Copy,
  RefreshCw,
  Loader2,
  Key,
  Settings as SettingsIcon,
  Pencil,
  Trash2,
  MoreHorizontal
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Factory = { id: number; code: string; name: string; address?: string | null; description?: string | null };
type Workshop = { id: number; factoryId: number; code: string; name: string; description?: string | null };
type Line = { id: number; workshopId: number; code: string; name: string; description?: string | null };
type Station = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null };
type Machine = { id: number; stationId: number; code: string; name: string; machineType: string; apiKey: string; model?: string | null; manufacturer?: string | null };

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState("factories");
  
  // Factory form
  const [factoryForm, setFactoryForm] = useState({ code: "", name: "", description: "", address: "" });
  const [factoryDialogOpen, setFactoryDialogOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<Factory | null>(null);
  const [editFactoryDialogOpen, setEditFactoryDialogOpen] = useState(false);

  // Workshop form
  const [workshopForm, setWorkshopForm] = useState({ factoryId: "", code: "", name: "", description: "" });
  const [workshopDialogOpen, setWorkshopDialogOpen] = useState(false);
  const [editingWorkshop, setEditingWorkshop] = useState<Workshop | null>(null);
  const [editWorkshopDialogOpen, setEditWorkshopDialogOpen] = useState(false);

  // Line form
  const [lineForm, setLineForm] = useState({ workshopId: "", code: "", name: "", description: "" });
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [editLineDialogOpen, setEditLineDialogOpen] = useState(false);

  // Station form
  const [stationForm, setStationForm] = useState({ lineId: "", code: "", name: "", description: "", orderIndex: "0" });
  const [stationDialogOpen, setStationDialogOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [editStationDialogOpen, setEditStationDialogOpen] = useState(false);

  // Machine form
  const [machineForm, setMachineForm] = useState({ 
    stationId: "", code: "", name: "", machineType: "AVI" as "AVI" | "AOI" | "AUTOMATION", 
    model: "", manufacturer: "", description: "" 
  });
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [editMachineDialogOpen, setEditMachineDialogOpen] = useState(false);

  // Queries
  const { data: factories, refetch: refetchFactories } = trpc.factory.list.useQuery();
  const { data: workshops, refetch: refetchWorkshops } = trpc.workshop.list.useQuery();
  const { data: lines, refetch: refetchLines } = trpc.line.list.useQuery();
  const { data: stations, refetch: refetchStations } = trpc.station.list.useQuery();
  const { data: machines, refetch: refetchMachines } = trpc.machine.list.useQuery();

  // Create Mutations
  const createFactoryMutation = trpc.factory.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo nhà máy thành công");
      setFactoryDialogOpen(false);
      setFactoryForm({ code: "", name: "", description: "", address: "" });
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const createWorkshopMutation = trpc.workshop.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo nhà xưởng thành công");
      setWorkshopDialogOpen(false);
      setWorkshopForm({ factoryId: "", code: "", name: "", description: "" });
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const createLineMutation = trpc.line.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo dây chuyền thành công");
      setLineDialogOpen(false);
      setLineForm({ workshopId: "", code: "", name: "", description: "" });
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const createStationMutation = trpc.station.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo công trạm thành công");
      setStationDialogOpen(false);
      setStationForm({ lineId: "", code: "", name: "", description: "", orderIndex: "0" });
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMachineMutation = trpc.machine.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Tạo máy thành công. API Key: ${data.apiKey}`);
      setMachineDialogOpen(false);
      setMachineForm({ stationId: "", code: "", name: "", machineType: "AVI", model: "", manufacturer: "", description: "" });
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  // Update Mutations
  const updateFactoryMutation = trpc.factory.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật nhà máy thành công");
      setEditFactoryDialogOpen(false);
      setEditingFactory(null);
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateWorkshopMutation = trpc.workshop.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật nhà xưởng thành công");
      setEditWorkshopDialogOpen(false);
      setEditingWorkshop(null);
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateLineMutation = trpc.line.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật dây chuyền thành công");
      setEditLineDialogOpen(false);
      setEditingLine(null);
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateStationMutation = trpc.station.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật công trạm thành công");
      setEditStationDialogOpen(false);
      setEditingStation(null);
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMachineMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật máy thành công");
      setEditMachineDialogOpen(false);
      setEditingMachine(null);
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  // Delete Mutations
  const deleteFactoryMutation = trpc.factory.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa nhà máy thành công");
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteWorkshopMutation = trpc.workshop.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa nhà xưởng thành công");
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteLineMutation = trpc.line.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa dây chuyền thành công");
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteStationMutation = trpc.station.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa công trạm thành công");
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMachineMutation = trpc.machine.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa máy thành công");
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchFactories();
      refetchWorkshops();
      refetchLines();
      refetchStations();
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
    },
    onError: (error) => toast.error(error.message),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Đã copy vào clipboard");
  };

  // Edit handlers
  const handleEditFactory = (factory: Factory) => {
    setEditingFactory(factory);
    setEditFactoryDialogOpen(true);
  };

  const handleEditWorkshop = (workshop: Workshop) => {
    setEditingWorkshop(workshop);
    setEditWorkshopDialogOpen(true);
  };

  const handleEditLine = (line: Line) => {
    setEditingLine(line);
    setEditLineDialogOpen(true);
  };

  const handleEditStation = (station: Station) => {
    setEditingStation(station);
    setEditStationDialogOpen(true);
  };

  const handleEditMachine = (machine: Machine) => {
    setEditingMachine(machine);
    setEditMachineDialogOpen(true);
  };

  if (!isAdmin) {
    return (
      <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/settings">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <SettingsIcon className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">Chỉ Admin mới có quyền truy cập</p>
          <p className="text-muted-foreground">Liên hệ quản trị viên để được cấp quyền</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/settings">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cài đặt hệ thống</h1>
            <p className="text-muted-foreground">Quản lý nhà máy, nhà xưởng, dây chuyền, công trạm và máy</p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => seedDataMutation.mutate()}
              disabled={seedDataMutation.isPending}
            >
              {seedDataMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Tạo dữ liệu mẫu
            </Button>
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => seedInspectionsMutation.mutate({ count: 100 })}
              disabled={seedInspectionsMutation.isPending}
            >
              {seedInspectionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Tạo 100 inspection
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="factories" className="gap-2">
              <Building2 className="h-4 w-4" />
              Nhà máy
            </TabsTrigger>
            <TabsTrigger value="workshops" className="gap-2">
              <Warehouse className="h-4 w-4" />
              Nhà xưởng
            </TabsTrigger>
            <TabsTrigger value="lines" className="gap-2">
              <GitBranch className="h-4 w-4" />
              Dây chuyền
            </TabsTrigger>
            <TabsTrigger value="stations" className="gap-2">
              <Cpu className="h-4 w-4" />
              Công trạm
            </TabsTrigger>
            <TabsTrigger value="machines" className="gap-2">
              <Cpu className="h-4 w-4" />
              Máy
            </TabsTrigger>
          </TabsList>

          {/* Factories Tab */}
          <TabsContent value="factories">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Danh sách nhà máy</CardTitle>
                    <CardDescription>{factories?.length || 0} nhà máy</CardDescription>
                  </div>
                  <Dialog open={factoryDialogOpen} onOpenChange={setFactoryDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm nhà máy
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm nhà máy mới</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Mã nhà máy *</label>
                          <Input
                            placeholder="VD: FAC001"
                            value={factoryForm.code}
                            onChange={(e) => setFactoryForm({ ...factoryForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên nhà máy *</label>
                          <Input
                            placeholder="VD: Nhà máy Bắc Ninh"
                            value={factoryForm.name}
                            onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Địa chỉ</label>
                          <Input
                            placeholder="Địa chỉ nhà máy"
                            value={factoryForm.address}
                            onChange={(e) => setFactoryForm({ ...factoryForm, address: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setFactoryDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createFactoryMutation.mutate(factoryForm)}
                          disabled={createFactoryMutation.isPending}
                        >
                          {createFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {factories?.map((factory) => (
                    <div key={factory.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{factory.name}</p>
                          <p className="text-sm text-muted-foreground">{factory.code} {factory.address && `• ${factory.address}`}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditFactory(factory)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                              <AlertDialogDescription>
                                Bạn có chắc muốn xóa nhà máy "{factory.name}"? Hành động này không thể hoàn tác.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Hủy</AlertDialogCancel>
                              <AlertDialogAction 
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteFactoryMutation.mutate({ id: factory.id })}
                              >
                                Xóa
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                  {(!factories || factories.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có nhà máy nào</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Workshops Tab */}
          <TabsContent value="workshops">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Danh sách nhà xưởng</CardTitle>
                    <CardDescription>{workshops?.length || 0} nhà xưởng</CardDescription>
                  </div>
                  <Dialog open={workshopDialogOpen} onOpenChange={setWorkshopDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm nhà xưởng
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm nhà xưởng mới</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nhà máy *</label>
                          <Select value={workshopForm.factoryId} onValueChange={(v) => setWorkshopForm({ ...workshopForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder="Chọn nhà máy" /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Mã nhà xưởng *</label>
                          <Input
                            placeholder="VD: WS001"
                            value={workshopForm.code}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên nhà xưởng *</label>
                          <Input
                            placeholder="VD: Xưởng lắp ráp A"
                            value={workshopForm.name}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setWorkshopDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createWorkshopMutation.mutate({ ...workshopForm, factoryId: parseInt(workshopForm.factoryId) })}
                          disabled={createWorkshopMutation.isPending}
                        >
                          {createWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {workshops?.map((workshop) => {
                    const factory = factories?.find(f => f.id === workshop.factoryId);
                    return (
                      <div key={workshop.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Warehouse className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{workshop.name}</p>
                            <p className="text-sm text-muted-foreground">{workshop.code} • {factory?.name || "N/A"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditWorkshop(workshop)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Bạn có chắc muốn xóa nhà xưởng "{workshop.name}"?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Hủy</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteWorkshopMutation.mutate({ id: workshop.id })}
                                >
                                  Xóa
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!workshops || workshops.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có nhà xưởng nào</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lines Tab */}
          <TabsContent value="lines">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Danh sách dây chuyền</CardTitle>
                    <CardDescription>{lines?.length || 0} dây chuyền</CardDescription>
                  </div>
                  <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm dây chuyền
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm dây chuyền mới</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nhà xưởng *</label>
                          <Select value={lineForm.workshopId} onValueChange={(v) => setLineForm({ ...lineForm, workshopId: v })}>
                            <SelectTrigger><SelectValue placeholder="Chọn nhà xưởng" /></SelectTrigger>
                            <SelectContent>
                              {workshops?.map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Mã dây chuyền *</label>
                          <Input
                            placeholder="VD: LINE001"
                            value={lineForm.code}
                            onChange={(e) => setLineForm({ ...lineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên dây chuyền *</label>
                          <Input
                            placeholder="VD: Dây chuyền SMT 1"
                            value={lineForm.name}
                            onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setLineDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createLineMutation.mutate({ ...lineForm, workshopId: parseInt(lineForm.workshopId) })}
                          disabled={createLineMutation.isPending}
                        >
                          {createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {lines?.map((line) => {
                    const workshop = workshops?.find(w => w.id === line.workshopId);
                    return (
                      <div key={line.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <GitBranch className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{line.name}</p>
                            <p className="text-sm text-muted-foreground">{line.code} • {workshop?.name || "N/A"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditLine(line)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Bạn có chắc muốn xóa dây chuyền "{line.name}"?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Hủy</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteLineMutation.mutate({ id: line.id })}
                                >
                                  Xóa
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!lines || lines.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có dây chuyền nào</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stations Tab */}
          <TabsContent value="stations">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Danh sách công trạm</CardTitle>
                    <CardDescription>{stations?.length || 0} công trạm</CardDescription>
                  </div>
                  <Dialog open={stationDialogOpen} onOpenChange={setStationDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm công trạm
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm công trạm mới</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Dây chuyền *</label>
                          <Select value={stationForm.lineId} onValueChange={(v) => setStationForm({ ...stationForm, lineId: v })}>
                            <SelectTrigger><SelectValue placeholder="Chọn dây chuyền" /></SelectTrigger>
                            <SelectContent>
                              {lines?.map((l) => (
                                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Mã công trạm *</label>
                          <Input
                            placeholder="VD: ST001"
                            value={stationForm.code}
                            onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên công trạm *</label>
                          <Input
                            placeholder="VD: Trạm kiểm tra AOI"
                            value={stationForm.name}
                            onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Thứ tự</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={stationForm.orderIndex}
                            onChange={(e) => setStationForm({ ...stationForm, orderIndex: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setStationDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createStationMutation.mutate({ 
                            ...stationForm, 
                            lineId: parseInt(stationForm.lineId),
                            orderIndex: parseInt(stationForm.orderIndex) 
                          })}
                          disabled={createStationMutation.isPending}
                        >
                          {createStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stations?.map((station) => {
                    const line = lines?.find(l => l.id === station.lineId);
                    return (
                      <div key={station.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Cpu className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{station.name}</p>
                            <p className="text-sm text-muted-foreground">{station.code} • {line?.name || "N/A"} • Thứ tự: {station.orderIndex}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditStation(station)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Bạn có chắc muốn xóa công trạm "{station.name}"?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Hủy</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteStationMutation.mutate({ id: station.id })}
                                >
                                  Xóa
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!stations || stations.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có công trạm nào</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Machines Tab */}
          <TabsContent value="machines">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Danh sách máy</CardTitle>
                    <CardDescription>{machines?.length || 0} máy</CardDescription>
                  </div>
                  <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm máy
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm máy mới</DialogTitle>
                        <DialogDescription>Sau khi tạo, hệ thống sẽ cấp API Key để máy gửi dữ liệu</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Công trạm *</label>
                          <Select value={machineForm.stationId} onValueChange={(v) => setMachineForm({ ...machineForm, stationId: v })}>
                            <SelectTrigger><SelectValue placeholder="Chọn công trạm" /></SelectTrigger>
                            <SelectContent>
                              {stations?.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Mã máy *</label>
                          <Input
                            placeholder="VD: AVI001"
                            value={machineForm.code}
                            onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên máy *</label>
                          <Input
                            placeholder="VD: Máy AVI kiểm tra PCB"
                            value={machineForm.name}
                            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Loại máy *</label>
                          <Select value={machineForm.machineType} onValueChange={(v: "AVI" | "AOI" | "AUTOMATION") => setMachineForm({ ...machineForm, machineType: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AVI">AVI (Automated Visual Inspection)</SelectItem>
                              <SelectItem value="AOI">AOI (Automated Optical Inspection)</SelectItem>
                              <SelectItem value="AUTOMATION">Automation</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Model</label>
                          <Input
                            placeholder="Model máy"
                            value={machineForm.model}
                            onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nhà sản xuất</label>
                          <Input
                            placeholder="Nhà sản xuất"
                            value={machineForm.manufacturer}
                            onChange={(e) => setMachineForm({ ...machineForm, manufacturer: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setMachineDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createMachineMutation.mutate({ 
                            ...machineForm, 
                            stationId: parseInt(machineForm.stationId)
                          })}
                          disabled={createMachineMutation.isPending}
                        >
                          {createMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {machines?.map((machine) => {
                    const station = stations?.find(s => s.id === machine.stationId);
                    return (
                      <div key={machine.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Cpu className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{machine.name}</p>
                            <p className="text-sm text-muted-foreground">{machine.code} • {machine.machineType}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => copyToClipboard(machine.apiKey)}
                          >
                            <Key className="h-3 w-3" />
                            Copy API Key
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEditMachine(machine)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Bạn có chắc muốn xóa máy "{machine.name}"?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Hủy</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteMachineMutation.mutate({ id: machine.id })}
                                >
                                  Xóa
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!machines || machines.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có máy nào</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Factory Dialog */}
      <Dialog open={editFactoryDialogOpen} onOpenChange={setEditFactoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa nhà máy</DialogTitle>
          </DialogHeader>
          {editingFactory && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã nhà máy</label>
                <Input value={editingFactory.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên nhà máy *</label>
                <Input
                  value={editingFactory.name}
                  onChange={(e) => setEditingFactory({ ...editingFactory, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Địa chỉ</label>
                <Input
                  value={editingFactory.address || ""}
                  onChange={(e) => setEditingFactory({ ...editingFactory, address: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFactoryDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingFactory && updateFactoryMutation.mutate({ 
                id: editingFactory.id, 
                name: editingFactory.name, 
                address: editingFactory.address || undefined 
              })}
              disabled={updateFactoryMutation.isPending}
            >
              {updateFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Workshop Dialog */}
      <Dialog open={editWorkshopDialogOpen} onOpenChange={setEditWorkshopDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa nhà xưởng</DialogTitle>
          </DialogHeader>
          {editingWorkshop && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nhà máy</label>
                <Select 
                  value={String(editingWorkshop.factoryId)} 
                  onValueChange={(v) => setEditingWorkshop({ ...editingWorkshop, factoryId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {factories?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã nhà xưởng</label>
                <Input value={editingWorkshop.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên nhà xưởng *</label>
                <Input
                  value={editingWorkshop.name}
                  onChange={(e) => setEditingWorkshop({ ...editingWorkshop, name: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditWorkshopDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingWorkshop && updateWorkshopMutation.mutate({ 
                id: editingWorkshop.id, 
                name: editingWorkshop.name,
                factoryId: editingWorkshop.factoryId
              })}
              disabled={updateWorkshopMutation.isPending}
            >
              {updateWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Line Dialog */}
      <Dialog open={editLineDialogOpen} onOpenChange={setEditLineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa dây chuyền</DialogTitle>
          </DialogHeader>
          {editingLine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nhà xưởng</label>
                <Select 
                  value={String(editingLine.workshopId)} 
                  onValueChange={(v) => setEditingLine({ ...editingLine, workshopId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {workshops?.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã dây chuyền</label>
                <Input value={editingLine.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên dây chuyền *</label>
                <Input
                  value={editingLine.name}
                  onChange={(e) => setEditingLine({ ...editingLine, name: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingLine && updateLineMutation.mutate({ 
                id: editingLine.id, 
                name: editingLine.name,
                workshopId: editingLine.workshopId
              })}
              disabled={updateLineMutation.isPending}
            >
              {updateLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Station Dialog */}
      <Dialog open={editStationDialogOpen} onOpenChange={setEditStationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa công trạm</DialogTitle>
          </DialogHeader>
          {editingStation && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Dây chuyền</label>
                <Select 
                  value={String(editingStation.lineId)} 
                  onValueChange={(v) => setEditingStation({ ...editingStation, lineId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {lines?.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã công trạm</label>
                <Input value={editingStation.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên công trạm *</label>
                <Input
                  value={editingStation.name}
                  onChange={(e) => setEditingStation({ ...editingStation, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Thứ tự</label>
                <Input
                  type="number"
                  value={editingStation.orderIndex}
                  onChange={(e) => setEditingStation({ ...editingStation, orderIndex: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStationDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingStation && updateStationMutation.mutate({ 
                id: editingStation.id, 
                name: editingStation.name,
                lineId: editingStation.lineId,
                orderIndex: editingStation.orderIndex
              })}
              disabled={updateStationMutation.isPending}
            >
              {updateStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Machine Dialog */}
      <Dialog open={editMachineDialogOpen} onOpenChange={setEditMachineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa máy</DialogTitle>
          </DialogHeader>
          {editingMachine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Công trạm</label>
                <Select 
                  value={String(editingMachine.stationId)} 
                  onValueChange={(v) => setEditingMachine({ ...editingMachine, stationId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stations?.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mã máy</label>
                <Input value={editingMachine.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên máy *</label>
                <Input
                  value={editingMachine.name}
                  onChange={(e) => setEditingMachine({ ...editingMachine, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
                <Input
                  value={editingMachine.model || ""}
                  onChange={(e) => setEditingMachine({ ...editingMachine, model: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nhà sản xuất</label>
                <Input
                  value={editingMachine.manufacturer || ""}
                  onChange={(e) => setEditingMachine({ ...editingMachine, manufacturer: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="flex gap-2">
                  <Input value={editingMachine.apiKey} disabled className="bg-muted font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(editingMachine.apiKey)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMachineDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingMachine && updateMachineMutation.mutate({ 
                id: editingMachine.id, 
                name: editingMachine.name,
                stationId: editingMachine.stationId,
                model: editingMachine.model || undefined,
                manufacturer: editingMachine.manufacturer || undefined
              })}
              disabled={updateMachineMutation.isPending}
            >
              {updateMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
