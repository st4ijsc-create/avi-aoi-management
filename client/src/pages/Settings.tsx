import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  Settings as SettingsIcon
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState } from "react";



export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState("factories");
  
  // Factory form
  const [factoryForm, setFactoryForm] = useState({ code: "", name: "", description: "", address: "" });
  const [factoryDialogOpen, setFactoryDialogOpen] = useState(false);

  // Workshop form
  const [workshopForm, setWorkshopForm] = useState({ factoryId: "", code: "", name: "", description: "" });
  const [workshopDialogOpen, setWorkshopDialogOpen] = useState(false);

  // Line form
  const [lineForm, setLineForm] = useState({ workshopId: "", code: "", name: "", description: "" });
  const [lineDialogOpen, setLineDialogOpen] = useState(false);

  // Station form
  const [stationForm, setStationForm] = useState({ lineId: "", code: "", name: "", description: "", orderIndex: "0" });
  const [stationDialogOpen, setStationDialogOpen] = useState(false);

  // Machine form
  const [machineForm, setMachineForm] = useState({ 
    stationId: "", code: "", name: "", machineType: "AVI" as "AVI" | "AOI" | "AUTOMATION", 
    model: "", manufacturer: "", description: "" 
  });
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);

  // Queries
  const { data: factories, refetch: refetchFactories } = trpc.factory.list.useQuery();
  const { data: workshops, refetch: refetchWorkshops } = trpc.workshop.list.useQuery();
  const { data: lines, refetch: refetchLines } = trpc.line.list.useQuery();
  const { data: stations, refetch: refetchStations } = trpc.station.list.useQuery();
  const { data: machines, refetch: refetchMachines } = trpc.machine.list.useQuery();

  // Mutations
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Đã copy vào clipboard");
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
          <Button
            variant="outline"
            onClick={() => seedDataMutation.mutate()}
            disabled={seedDataMutation.isPending}
            className="gap-2"
          >
            {seedDataMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Tạo dữ liệu mẫu
          </Button>
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
              <SettingsIcon className="h-4 w-4" />
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
                          <p className="text-sm text-muted-foreground">{factory.code}</p>
                        </div>
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
                  {workshops?.map((workshop) => (
                    <div key={workshop.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Warehouse className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{workshop.name}</p>
                          <p className="text-sm text-muted-foreground">{workshop.code}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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
                            placeholder="VD: LINE01"
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
                  {lines?.map((line) => (
                    <div key={line.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <GitBranch className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{line.name}</p>
                          <p className="text-sm text-muted-foreground">{line.code}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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
                  {stations?.map((station) => (
                    <div key={station.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <SettingsIcon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{station.name}</p>
                          <p className="text-sm text-muted-foreground">{station.code} • Order: {station.orderIndex}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Mã máy *</label>
                            <Input
                              placeholder="VD: AVI001"
                              value={machineForm.code}
                              onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Loại máy *</label>
                            <Select value={machineForm.machineType} onValueChange={(v) => setMachineForm({ ...machineForm, machineType: v as typeof machineForm.machineType })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="AVI">AVI</SelectItem>
                                <SelectItem value="AOI">AOI</SelectItem>
                                <SelectItem value="AUTOMATION">Automation</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Tên máy *</label>
                          <Input
                            placeholder="VD: Máy kiểm tra AVI #1"
                            value={machineForm.name}
                            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
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
                              placeholder="Manufacturer"
                              value={machineForm.manufacturer}
                              onChange={(e) => setMachineForm({ ...machineForm, manufacturer: e.target.value })}
                            />
                          </div>
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
                  {machines?.map((machine) => (
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
                      </div>
                    </div>
                  ))}
                  {(!machines || machines.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">Chưa có máy nào</p>
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
