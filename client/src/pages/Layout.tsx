import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Cpu,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize2,
  LayoutGrid,
  Edit,
  Eye,
  Trash2,
  Settings2,
  Box,
  Layers
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useMemo, useRef } from "react";
import { useParams } from "wouter";
import WorkshopLayoutEditor from "@/components/WorkshopLayoutEditor";

type MachineWithStats = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  image2DUrl?: string | null;
  image3DUrl?: string | null;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  stats: {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
};

export default function Layout() {
  const params = useParams<{ id?: string }>();
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>("");
  const [selectedLayout, setSelectedLayout] = useState<string>(params.id || "");
  const [activeTab, setActiveTab] = useState<string>("view");
  const [layoutType, setLayoutType] = useState<"2D" | "3D">("2D");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [isCreateLayoutOpen, setIsCreateLayoutOpen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [newLayoutType, setNewLayoutType] = useState<"2D" | "3D">("2D");
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: layouts, refetch: refetchLayouts } = trpc.layout.listByWorkshop.useQuery(
    { workshopId: parseInt(selectedWorkshop) },
    { enabled: !!selectedWorkshop }
  );
  const { data: layoutData, refetch: refetchLayout } = trpc.layout.getById.useQuery(
    { id: parseInt(selectedLayout) },
    { enabled: !!selectedLayout }
  );
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: machinesStats } = trpc.dashboard.getAllMachinesStats.useQuery({});

  const createLayoutMutation = trpc.layout.create.useMutation({
    onSuccess: (data) => {
      toast.success("Đã tạo layout mới");
      refetchLayouts();
      setSelectedLayout(String(data.id));
      setIsCreateLayoutOpen(false);
      setNewLayoutName("");
    },
    onError: (err) => toast.error(err.message),
  });

  // Combine machine positions with stats
  const machinesWithStats = useMemo<MachineWithStats[]>(() => {
    if (!layoutData?.positions || !machines || !machinesStats) return [];

    return layoutData.positions.map(pos => {
      const machine = machines.find(m => m.id === pos.machineId);
      const stats = machinesStats.find(s => s.machine.id === pos.machineId)?.stats || {
        total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0
      };

      return {
        id: pos.machineId,
        code: machine?.code || "",
        name: machine?.name || `Machine ${pos.machineId}`,
        machineType: machine?.machineType || "UNKNOWN",
        image2DUrl: machine?.image2DUrl,
        image3DUrl: machine?.image3DUrl,
        positionX: pos.positionX,
        positionY: pos.positionY,
        width: pos.width,
        height: pos.height,
        stats,
      };
    });
  }, [layoutData, machines, machinesStats]);

  // Handle zoom
  const handleZoomIn = () => setZoom(z => Math.min(z + 0.2, 3));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.2, 0.5));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Handle panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Handle wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.5, Math.min(3, z + delta)));
  };

  const getStatusColor = (yieldRate: number) => {
    if (yieldRate >= 98) return "border-green-500 shadow-green-500/20";
    if (yieldRate >= 95) return "border-yellow-500 shadow-yellow-500/20";
    return "border-red-500 shadow-red-500/20";
  };

  const getStatusIcon = (yieldRate: number) => {
    if (yieldRate >= 98) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (yieldRate >= 95) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const handleCreateLayout = () => {
    if (!selectedWorkshop || !newLayoutName.trim()) {
      toast.error("Vui lòng nhập tên layout");
      return;
    }
    createLayoutMutation.mutate({
      workshopId: parseInt(selectedWorkshop),
      name: newLayoutName.trim(),
      layoutType: newLayoutType,
      width: 1200,
      height: 800,
    });
  };

  return (
    <DashboardLayout 
      title="AVI/AOI Management" 
      navItems={navItems}
      currentPath="/layout"
    >
      <div className="space-y-6 h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Layout nhà xưởng</h1>
            <p className="text-muted-foreground">Trực quan hóa và quản lý vị trí máy trong nhà xưởng</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedWorkshop} onValueChange={(v) => {
              setSelectedWorkshop(v);
              setSelectedLayout("");
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Chọn nhà xưởng" />
              </SelectTrigger>
              <SelectContent>
                {workshops?.map((workshop) => (
                  <SelectItem key={workshop.id} value={String(workshop.id)}>
                    {workshop.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {layouts && layouts.length > 0 && (
              <Select value={selectedLayout} onValueChange={setSelectedLayout}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Chọn layout" />
                </SelectTrigger>
                <SelectContent>
                  {layouts.map((layout) => (
                    <SelectItem key={layout.id} value={String(layout.id)}>
                      {layout.name} ({layout.layoutType || "2D"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedWorkshop && (
              <Dialog open={isCreateLayoutOpen} onOpenChange={setIsCreateLayoutOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Tạo Layout
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Tạo Layout mới</DialogTitle>
                    <DialogDescription>
                      Tạo layout mới cho nhà xưởng
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Tên Layout</Label>
                      <Input
                        value={newLayoutName}
                        onChange={(e) => setNewLayoutName(e.target.value)}
                        placeholder="VD: Layout Dây chuyền SMT"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Loại Layout</Label>
                      <Select value={newLayoutType} onValueChange={(v: "2D" | "3D") => setNewLayoutType(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2D">Layout 2D</SelectItem>
                          <SelectItem value="3D">Layout 3D</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateLayoutOpen(false)}>
                      Hủy
                    </Button>
                    <Button onClick={handleCreateLayout} disabled={createLayoutMutation.isPending}>
                      {createLayoutMutation.isPending ? "Đang tạo..." : "Tạo Layout"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Main Content with Tabs */}
        {selectedLayout ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="view" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Xem Layout
              </TabsTrigger>
              <TabsTrigger value="edit" className="flex items-center gap-2">
                <Edit className="h-4 w-4" />
                Chỉnh sửa
              </TabsTrigger>
            </TabsList>

            {/* View Mode */}
            <TabsContent value="view" className="space-y-4 mt-4">
              {/* Layout Type Toggle */}
              <div className="flex items-center gap-2">
                <Button
                  variant={layoutType === "2D" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLayoutType("2D")}
                >
                  <Layers className="h-4 w-4 mr-1" />
                  2D
                </Button>
                <Button
                  variant={layoutType === "3D" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLayoutType("3D")}
                >
                  <Box className="h-4 w-4 mr-1" />
                  3D
                </Button>
              </div>

              {/* Layout Canvas */}
              <Card className="glass-card flex-1">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {layoutData?.layout?.name || "Layout"}
                      </CardTitle>
                      <CardDescription>
                        {machinesWithStats.length} máy được hiển thị • {layoutType}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={handleZoomOut}>
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground w-16 text-center">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button variant="outline" size="icon" onClick={handleZoomIn}>
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" onClick={handleResetView}>
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div 
                    ref={containerRef}
                    className="relative w-full h-[600px] bg-secondary/30 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                  >
                    {/* Grid background */}
                    <div 
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `
                          linear-gradient(to right, oklch(0.28 0.02 260 / 0.3) 1px, transparent 1px),
                          linear-gradient(to bottom, oklch(0.28 0.02 260 / 0.3) 1px, transparent 1px)
                        `,
                        backgroundSize: `${50 * zoom}px ${50 * zoom}px`,
                        transform: `translate(${pan.x}px, ${pan.y}px)`,
                      }}
                    />

                    {/* Machines */}
                    <div
                      style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "0 0",
                      }}
                    >
                      {machinesWithStats.length > 0 ? (
                        machinesWithStats.map((machine) => {
                          const imageUrl = layoutType === "2D" ? machine.image2DUrl : machine.image3DUrl;
                          
                          return (
                            <div
                              key={machine.id}
                              className={`absolute rounded-lg border-2 shadow-lg transition-all hover:scale-105 ${getStatusColor(machine.stats.yieldRate)}`}
                              style={{
                                left: machine.positionX,
                                top: machine.positionY,
                                width: machine.width,
                                height: machine.height,
                              }}
                            >
                              {/* Machine Image or Placeholder */}
                              {imageUrl ? (
                                <div className="absolute inset-0 rounded-lg overflow-hidden">
                                  <img
                                    src={imageUrl}
                                    alt={machine.name}
                                    className="w-full h-full object-cover opacity-80"
                                    draggable={false}
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-card rounded-lg" />
                              )}

                              {/* Stats Overlay */}
                              <div className="relative h-full p-2 flex flex-col">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1">
                                    <Cpu className="h-3 w-3 text-primary" />
                                    <span className="text-xs font-semibold text-foreground truncate max-w-[60px]">
                                      {machine.code}
                                    </span>
                                  </div>
                                  {getStatusIcon(machine.stats.yieldRate)}
                                </div>

                                <Badge variant="secondary" className="text-[10px] w-fit mb-1">
                                  {machine.machineType}
                                </Badge>

                                {/* Stats Grid */}
                                <div className="flex-1 grid grid-cols-2 gap-1 text-[10px]">
                                  <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                                    <div className="text-muted-foreground">FPY</div>
                                    <div className="font-bold text-primary">
                                      {machine.stats.yieldRate.toFixed(1)}%
                                    </div>
                                  </div>
                                  <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                                    <div className="text-muted-foreground">Output</div>
                                    <div className="font-bold text-foreground">
                                      {machine.stats.total}
                                    </div>
                                  </div>
                                  <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                                    <div className="text-muted-foreground">OK</div>
                                    <div className="font-bold text-green-500">
                                      {machine.stats.ok}
                                    </div>
                                  </div>
                                  <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                                    <div className="text-muted-foreground">NG</div>
                                    <div className="font-bold text-red-500">
                                      {machine.stats.ng}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                          <LayoutGrid className="h-16 w-16 mb-4 opacity-50" />
                          <p className="text-lg font-medium">Chưa có máy trong layout</p>
                          <p className="text-sm">Chuyển sang tab Chỉnh sửa để thêm máy</p>
                        </div>
                      )}
                    </div>

                    {/* Controls hint */}
                    <div className="absolute bottom-4 left-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-3 py-2 rounded-lg">
                      <Move className="h-3 w-3 inline mr-1" />
                      Kéo để di chuyển • Cuộn để zoom
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Legend */}
              <Card className="glass-card">
                <CardContent className="py-4">
                  <div className="flex items-center justify-center gap-8 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border-2 border-green-500" />
                      <span className="text-muted-foreground">FPY ≥ 98%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border-2 border-yellow-500" />
                      <span className="text-muted-foreground">FPY 95-98%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded border-2 border-red-500" />
                      <span className="text-muted-foreground">FPY &lt; 95%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Edit Mode */}
            <TabsContent value="edit" className="mt-4">
              <WorkshopLayoutEditor
                workshopId={parseInt(selectedWorkshop)}
                layoutId={parseInt(selectedLayout)}
                layoutType={layoutData?.layout?.layoutType as "2D" | "3D" || "2D"}
                onLayoutChange={() => refetchLayout()}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="glass-card">
            <CardContent className="py-12 text-center">
              <LayoutGrid className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
              <p className="text-lg font-medium text-foreground">Chưa chọn layout</p>
              <p className="text-muted-foreground mt-2">
                {selectedWorkshop 
                  ? "Chọn layout từ danh sách hoặc tạo layout mới"
                  : "Chọn nhà xưởng để xem danh sách layout"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
