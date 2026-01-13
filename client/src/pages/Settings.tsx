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
  MoreHorizontal,
  Clock,
  Upload,
  Image,
  X
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Factory = { id: number; code: string; name: string; address?: string | null; description?: string | null };
type Workshop = { id: number; factoryId: number; code: string; name: string; description?: string | null };
type Line = { id: number; workshopId: number; code: string; name: string; description?: string | null };
type Station = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null };
type Machine = { id: number; stationId: number; code: string; name: string; machineType: string; apiKey: string; model?: string | null; manufacturer?: string | null; image2DUrl?: string | null; image3DUrl?: string | null };
type ShiftConfig = { id: number; factoryId?: number | null; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number; isActive: boolean; orderIndex: number };
type LineStage = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null; stationId?: number | null };

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
  const [uploadingImage, setUploadingImage] = useState<"2D" | "3D" | null>(null);

  // Shift form
  const [shiftForm, setShiftForm] = useState({ 
    factoryId: "", name: "", code: "", 
    startHour: "6", startMinute: "0", 
    endHour: "14", endMinute: "0",
    orderIndex: "0"
  });
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftConfig | null>(null);
  const [editShiftDialogOpen, setEditShiftDialogOpen] = useState(false);

  // Stage form
  const [stageForm, setStageForm] = useState({ 
    lineId: "", code: "", name: "", description: "", orderIndex: "0", stationId: ""
  });
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<LineStage | null>(null);
  const [editStageDialogOpen, setEditStageDialogOpen] = useState(false);
  const [draggedStageId, setDraggedStageId] = useState<number | null>(null);

  // Queries
  const { data: factories, refetch: refetchFactories } = trpc.factory.list.useQuery();
  const { data: workshops, refetch: refetchWorkshops } = trpc.workshop.list.useQuery();
  const { data: lines, refetch: refetchLines } = trpc.line.list.useQuery();
  const { data: stations, refetch: refetchStations } = trpc.station.list.useQuery();
  const { data: machines, refetch: refetchMachines } = trpc.machine.list.useQuery();
  const { data: shifts, refetch: refetchShifts } = trpc.shiftConfig.list.useQuery();
  const { data: stages, refetch: refetchStages } = trpc.lineStage.list.useQuery();

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

  const createShiftMutation = trpc.shiftConfig.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo ca làm việc thành công");
      setShiftDialogOpen(false);
      setShiftForm({ factoryId: "", name: "", code: "", startHour: "6", startMinute: "0", endHour: "14", endMinute: "0", orderIndex: "0" });
      refetchShifts();
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

  const uploadImageMutation = trpc.machine.uploadImage.useMutation({
    onSuccess: (data, variables) => {
      toast.success(`Upload ảnh ${variables.imageType} thành công`);
      setUploadingImage(null);
      if (editingMachine) {
        const updatedMachine = { ...editingMachine };
        if (variables.imageType === "2D") {
          updatedMachine.image2DUrl = data.url;
        } else {
          updatedMachine.image3DUrl = data.url;
        }
        setEditingMachine(updatedMachine);
      }
      refetchMachines();
    },
    onError: (error) => {
      toast.error(error.message);
      setUploadingImage(null);
    },
  });

  // Handle image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, imageType: "2D" | "3D") => {
    const file = e.target.files?.[0];
    if (!file || !editingMachine) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn file ảnh");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Kích thước file tối đa 5MB");
      return;
    }

    setUploadingImage(imageType);

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadImageMutation.mutate({
          id: editingMachine.id,
          imageType,
          imageData: base64,
          fileName: file.name,
          contentType: file.type,
        });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error("Lỗi khi upload ảnh");
      setUploadingImage(null);
    }
  };

  const updateShiftMutation = trpc.shiftConfig.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật ca làm việc thành công");
      setEditShiftDialogOpen(false);
      setEditingShift(null);
      refetchShifts();
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

  const deleteShiftMutation = trpc.shiftConfig.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa ca làm việc thành công");
      refetchShifts();
    },
    onError: (error) => toast.error(error.message),
  });

  // Stage mutations
  const createStageMutation = trpc.lineStage.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo công đoạn thành công");
      refetchStages();
      setStageDialogOpen(false);
      setStageForm({ lineId: "", code: "", name: "", description: "", orderIndex: "0", stationId: "" });
    },
    onError: (error) => toast.error(error.message),
  });

  const updateStageMutation = trpc.lineStage.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật công đoạn thành công");
      refetchStages();
      setEditStageDialogOpen(false);
      setEditingStage(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteStageMutation = trpc.lineStage.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa công đoạn thành công");
      refetchStages();
    },
    onError: (error) => toast.error(error.message),
  });

  const reorderStageMutation = trpc.lineStage.reorder.useMutation({
    onSuccess: () => {
      toast.success("Sắp xếp lại thành công");
      refetchStages();
    },
    onError: (error: { message: string }) => toast.error(error.message),
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
          <TabsList className="grid w-full grid-cols-7">
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
            <TabsTrigger value="shifts" className="gap-2">
              <Clock className="h-4 w-4" />
              Ca làm việc
            </TabsTrigger>
            <TabsTrigger value="stages" className="gap-2">
              <GitBranch className="h-4 w-4" />
              Công đoạn
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

          {/* Shifts Tab */}
          <TabsContent value="shifts">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Cấu hình ca làm việc</CardTitle>
                    <CardDescription>Quản lý các ca làm việc trong hệ thống</CardDescription>
                  </div>
                  <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Thêm ca
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Thêm ca làm việc mới</DialogTitle>
                        <DialogDescription>Nhập thông tin ca làm việc</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Mã ca *</label>
                            <Input
                              placeholder="VD: SHIFT_1"
                              value={shiftForm.code}
                              onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Tên ca *</label>
                            <Input
                              placeholder="VD: Ca sáng"
                              value={shiftForm.name}
                              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nhà máy (để trống = áp dụng toàn hệ thống)</label>
                          <Select value={shiftForm.factoryId} onValueChange={(v) => setShiftForm({ ...shiftForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder="Tất cả nhà máy" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">Tất cả nhà máy</SelectItem>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Giờ bắt đầu *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder="Giờ"
                                value={shiftForm.startHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, startHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="Phút"
                                value={shiftForm.startMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, startMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Giờ kết thúc *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder="Giờ"
                                value={shiftForm.endHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, endHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder="Phút"
                                value={shiftForm.endMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, endMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Thứ tự hiển thị</label>
                          <Input
                            type="number"
                            value={shiftForm.orderIndex}
                            onChange={(e) => setShiftForm({ ...shiftForm, orderIndex: e.target.value })}
                            className="w-24"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Hủy</Button>
                        <Button 
                          onClick={() => createShiftMutation.mutate({
                            factoryId: shiftForm.factoryId ? parseInt(shiftForm.factoryId) : undefined,
                            code: shiftForm.code,
                            name: shiftForm.name,
                            startHour: parseInt(shiftForm.startHour),
                            startMinute: parseInt(shiftForm.startMinute),
                            endHour: parseInt(shiftForm.endHour),
                            endMinute: parseInt(shiftForm.endMinute),
                            orderIndex: parseInt(shiftForm.orderIndex),
                          })}
                          disabled={createShiftMutation.isPending || !shiftForm.code || !shiftForm.name}
                        >
                          {createShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Tạo ca
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">Mã</th>
                        <th className="p-3 text-left font-medium">Tên ca</th>
                        <th className="p-3 text-left font-medium">Nhà máy</th>
                        <th className="p-3 text-left font-medium">Thời gian</th>
                        <th className="p-3 text-left font-medium">Trạng thái</th>
                        <th className="p-3 text-right font-medium">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shifts?.map((shift) => (
                        <tr key={shift.id} className="border-b hover:bg-muted/30">
                          <td className="p-3 font-mono text-sm">{shift.code}</td>
                          <td className="p-3 font-medium">{shift.name}</td>
                          <td className="p-3">
                            {shift.factoryId 
                              ? factories?.find(f => f.id === shift.factoryId)?.name || 'N/A'
                              : <span className="text-muted-foreground">Toàn hệ thống</span>
                            }
                          </td>
                          <td className="p-3">
                            <span className="font-mono">
                              {String(shift.startHour).padStart(2, '0')}:{String(shift.startMinute).padStart(2, '0')}
                              {' - '}
                              {String(shift.endHour).padStart(2, '0')}:{String(shift.endMinute).padStart(2, '0')}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded-full text-xs ${shift.isActive ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>
                              {shift.isActive ? 'Hoạt động' : 'Tạm dừng'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => {
                                  setEditingShift(shift as ShiftConfig);
                                  setEditShiftDialogOpen(true);
                                }}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Chỉnh sửa
                                </DropdownMenuItem>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Xóa
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Bạn có chắc chắn muốn xóa ca "{shift.name}"?
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Hủy</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteShiftMutation.mutate({ id: shift.id })}>
                                        Xóa
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                      {(!shifts || shifts.length === 0) && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground">
                            Chưa có ca làm việc nào. Hãy thêm ca mới.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stages Tab */}
          <TabsContent value="stages">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Công đoạn sản xuất</CardTitle>
                    <CardDescription>{stages?.length || 0} công đoạn</CardDescription>
                  </div>
                  {isAdmin && (
                    <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Plus className="h-4 w-4" />
                          Thêm công đoạn
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Thêm công đoạn mới</DialogTitle>
                          <DialogDescription>Tạo công đoạn mới cho dây chuyền sản xuất</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Dây chuyền *</label>
                            <Select value={stageForm.lineId} onValueChange={(v) => setStageForm({ ...stageForm, lineId: v })}>
                              <SelectTrigger><SelectValue placeholder="Chọn dây chuyền" /></SelectTrigger>
                              <SelectContent>
                                {lines?.map((line) => (
                                  <SelectItem key={line.id} value={String(line.id)}>{line.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Mã công đoạn *</label>
                              <Input placeholder="VD: A, B, C..." value={stageForm.code} onChange={(e) => setStageForm({ ...stageForm, code: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Tên công đoạn *</label>
                              <Input placeholder="VD: Lắp ráp, Kiểm tra..." value={stageForm.name} onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Thứ tự</label>
                              <Input type="number" value={stageForm.orderIndex} onChange={(e) => setStageForm({ ...stageForm, orderIndex: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Trạm liên kết</label>
                              <Select value={stageForm.stationId} onValueChange={(v) => setStageForm({ ...stageForm, stationId: v })}>
                                <SelectTrigger><SelectValue placeholder="Chọn trạm" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">Không liên kết</SelectItem>
                                  {stations?.filter(s => {
                                    const line = lines?.find(l => l.id === Number(stageForm.lineId));
                                    return line && s.lineId === line.id;
                                  }).map((station) => (
                                    <SelectItem key={station.id} value={String(station.id)}>{station.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Mô tả</label>
                            <Input placeholder="Mô tả công đoạn" value={stageForm.description} onChange={(e) => setStageForm({ ...stageForm, description: e.target.value })} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Hủy</Button>
                          <Button onClick={() => createStageMutation.mutate({
                            lineId: Number(stageForm.lineId),
                            code: stageForm.code,
                            name: stageForm.name,
                            description: stageForm.description || undefined,
                            orderIndex: Number(stageForm.orderIndex),
                            stationId: stageForm.stationId ? Number(stageForm.stationId) : undefined,
                          })} disabled={!stageForm.lineId || !stageForm.code || !stageForm.name || createStageMutation.isPending}>
                            {createStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Tạo công đoạn
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {lines?.map((line) => {
                    const lineStages = stages?.filter(s => s.lineId === line.id).sort((a, b) => a.orderIndex - b.orderIndex) || [];
                    if (lineStages.length === 0) return null;
                    return (
                      <div key={line.id} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <GitBranch className="h-4 w-4 text-primary" />
                          <span className="font-medium">{line.name}</span>
                          <span className="text-sm text-muted-foreground">({lineStages.length} công đoạn)</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {lineStages.map((stage, index) => (
                            <div
                              key={stage.id}
                              draggable
                              onDragStart={() => setDraggedStageId(stage.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (draggedStageId && draggedStageId !== stage.id) {
                                  const newOrder = lineStages.map(s => s.id);
                                  const dragIndex = newOrder.indexOf(draggedStageId);
                                  const dropIndex = newOrder.indexOf(stage.id);
                                  newOrder.splice(dragIndex, 1);
                                  newOrder.splice(dropIndex, 0, draggedStageId);
                                  reorderStageMutation.mutate({ lineId: line.id, stageIds: newOrder });
                                }
                                setDraggedStageId(null);
                              }}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-move transition-all ${
                                draggedStageId === stage.id ? 'opacity-50 border-primary' : 'hover:border-primary/50'
                              }`}
                            >
                              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
                                {stage.code}
                              </span>
                              <span className="text-sm">{stage.name}</span>
                              {index < lineStages.length - 1 && (
                                <span className="text-muted-foreground">→</span>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                                    <MoreHorizontal className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => {
                                    setEditingStage(stage);
                                    setEditStageDialogOpen(true);
                                  }}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Chỉnh sửa
                                  </DropdownMenuItem>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Xóa
                                      </DropdownMenuItem>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Bạn có chắc chắn muốn xóa công đoạn "{stage.name}"?
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Hủy</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => deleteStageMutation.mutate({ id: stage.id })}>
                                          Xóa
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {(!stages || stages.length === 0) && (
                    <div className="p-8 text-center text-muted-foreground">
                      Chưa có công đoạn nào. Hãy thêm công đoạn mới.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Stage Dialog */}
      <Dialog open={editStageDialogOpen} onOpenChange={setEditStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa công đoạn</DialogTitle>
          </DialogHeader>
          {editingStage && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mã công đoạn</label>
                  <Input value={editingStage.code} onChange={(e) => setEditingStage({ ...editingStage, code: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tên công đoạn</label>
                  <Input value={editingStage.name} onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Mô tả</label>
                <Input value={editingStage.description || ''} onChange={(e) => setEditingStage({ ...editingStage, description: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStageDialogOpen(false)}>Hủy</Button>
            <Button onClick={() => editingStage && updateStageMutation.mutate({
              id: editingStage.id,
              code: editingStage.code,
              name: editingStage.name,
              description: editingStage.description || undefined,
            })} disabled={updateStageMutation.isPending}>
              {updateStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Edit Shift Dialog */}
      <Dialog open={editShiftDialogOpen} onOpenChange={setEditShiftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa ca làm việc</DialogTitle>
          </DialogHeader>
          {editingShift && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mã ca</label>
                  <Input
                    value={editingShift.code}
                    onChange={(e) => setEditingShift({ ...editingShift, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tên ca</label>
                  <Input
                    value={editingShift.name}
                    onChange={(e) => setEditingShift({ ...editingShift, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Giờ bắt đầu</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={editingShift.startHour}
                      onChange={(e) => setEditingShift({ ...editingShift, startHour: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                    <span className="self-center">:</span>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      value={editingShift.startMinute}
                      onChange={(e) => setEditingShift({ ...editingShift, startMinute: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Giờ kết thúc</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={editingShift.endHour}
                      onChange={(e) => setEditingShift({ ...editingShift, endHour: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                    <span className="self-center">:</span>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      value={editingShift.endMinute}
                      onChange={(e) => setEditingShift({ ...editingShift, endMinute: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="shiftActive"
                  checked={editingShift.isActive}
                  onChange={(e) => setEditingShift({ ...editingShift, isActive: e.target.checked })}
                  className="h-4 w-4"
                />
                <label htmlFor="shiftActive" className="text-sm">Hoạt động</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditShiftDialogOpen(false)}>Hủy</Button>
            <Button 
              onClick={() => editingShift && updateShiftMutation.mutate({ 
                id: editingShift.id, 
                name: editingShift.name,
                code: editingShift.code,
                startHour: editingShift.startHour,
                startMinute: editingShift.startMinute,
                endHour: editingShift.endHour,
                endMinute: editingShift.endMinute,
                isActive: editingShift.isActive,
              })}
              disabled={updateShiftMutation.isPending}
            >
              {updateShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
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

              {/* Image Upload Section */}
              <div className="border-t pt-4 mt-4">
                <label className="text-sm font-medium block mb-3">Ảnh máy (cho Layout và Dashboard)</label>
                <div className="grid grid-cols-2 gap-4">
                  {/* 2D Image */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Ảnh 2D</label>
                    <div className="relative">
                      {editingMachine.image2DUrl ? (
                        <div className="relative group">
                          <img
                            src={editingMachine.image2DUrl}
                            alt="2D"
                            className="w-full h-24 object-cover rounded-lg border"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setEditingMachine({ ...editingMachine, image2DUrl: null })}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                          {uploadingImage === "2D" ? (
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">Upload 2D</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleImageUpload(e, "2D")}
                            disabled={uploadingImage !== null}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* 3D Image */}
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Ảnh 3D</label>
                    <div className="relative">
                      {editingMachine.image3DUrl ? (
                        <div className="relative group">
                          <img
                            src={editingMachine.image3DUrl}
                            alt="3D"
                            className="w-full h-24 object-cover rounded-lg border"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setEditingMachine({ ...editingMachine, image3DUrl: null })}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                          {uploadingImage === "3D" ? (
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">Upload 3D</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleImageUpload(e, "3D")}
                            disabled={uploadingImage !== null}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Ảnh sẽ được hiển thị trong Layout và Dashboard. Tối đa 5MB.
                </p>
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
