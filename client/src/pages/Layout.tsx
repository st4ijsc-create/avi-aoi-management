import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  Cpu,
  Plus,
  BarChart3,
  History,
  LayoutGrid,
  Settings,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize2
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { useParams } from "wouter";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
  { href: "/history", label: "Lịch sử", icon: <History className="h-4 w-4" /> },
  { href: "/layout", label: "Layout", icon: <LayoutGrid className="h-4 w-4" /> },
  { href: "/settings", label: "Cài đặt", icon: <Settings className="h-4 w-4" /> },
  { href: "/api-docs", label: "API Docs", icon: <FileText className="h-4 w-4" /> },
];

type MachineWithStats = {
  id: number;
  code: string;
  name: string;
  machineType: string;
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: layouts } = trpc.layout.listByWorkshop.useQuery(
    { workshopId: parseInt(selectedWorkshop) },
    { enabled: !!selectedWorkshop }
  );
  const { data: layoutData } = trpc.layout.getById.useQuery(
    { id: parseInt(selectedLayout) },
    { enabled: !!selectedLayout }
  );
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: machinesStats } = trpc.dashboard.getAllMachinesStats.useQuery({});

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
    if (yieldRate >= 98) return "border-success glow-success";
    if (yieldRate >= 95) return "border-warning";
    return "border-destructive glow-destructive";
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
            <p className="text-muted-foreground">Trực quan hóa vị trí máy và thông tin realtime</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedWorkshop} onValueChange={setSelectedWorkshop}>
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
                      {layout.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Layout Canvas */}
        <Card className="glass-card flex-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {layoutData?.layout?.name || "Layout 2D"}
                </CardTitle>
                <CardDescription>
                  {machinesWithStats.length} máy được hiển thị
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
                  machinesWithStats.map((machine) => (
                    <div
                      key={machine.id}
                      className={`absolute bg-card border-2 rounded-lg shadow-lg transition-all hover:scale-105 ${getStatusColor(machine.stats.yieldRate)}`}
                      style={{
                        left: machine.positionX,
                        top: machine.positionY,
                        width: machine.width,
                        height: machine.height,
                      }}
                    >
                      <div className="p-2 h-full flex flex-col">
                        <div className="flex items-center gap-1 mb-1">
                          <Cpu className="h-3 w-3 text-primary" />
                          <span className="text-xs font-semibold text-foreground truncate">
                            {machine.name}
                          </span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] w-fit mb-1">
                          {machine.machineType}
                        </Badge>
                        <div className="flex-1 grid grid-cols-2 gap-1 text-[10px]">
                          <div className="text-center">
                            <p className="text-muted-foreground">Total</p>
                            <p className="font-bold text-foreground">{machine.stats.total}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">Yield</p>
                            <p className="font-bold text-primary">{machine.stats.yieldRate.toFixed(1)}%</p>
                          </div>
                          <div className="text-center">
                            <p className="flex items-center justify-center gap-0.5">
                              <CheckCircle2 className="h-2 w-2 text-success" />
                              <span className="text-success">{machine.stats.ok}</span>
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="flex items-center justify-center gap-0.5">
                              <XCircle className="h-2 w-2 text-destructive" />
                              <span className="text-destructive">{machine.stats.ng}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                    <LayoutGrid className="h-16 w-16 mb-4 opacity-50" />
                    <p className="text-lg font-medium">Chưa có layout</p>
                    <p className="text-sm">Chọn nhà xưởng và layout để xem trực quan hóa</p>
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
                <div className="w-4 h-4 rounded border-2 border-success glow-success" />
                <span className="text-muted-foreground">Yield ≥ 98%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border-2 border-warning" />
                <span className="text-muted-foreground">Yield 95-98%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border-2 border-destructive glow-destructive" />
                <span className="text-muted-foreground">Yield &lt; 95%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
