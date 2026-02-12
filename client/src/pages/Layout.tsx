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
  Minimize2,
  LayoutGrid,
  Edit,
  Eye,
  Trash2,
  Settings2,
  Box,
  Layers,
  Undo2,
  Redo2,
  Grid3X3,
  Download
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import React, { useState, useMemo, useRef, useEffect } from "react";
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [newLayoutType, setNewLayoutType] = useState<"2D" | "3D">("2D");
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drag & drop state for machines
  const [isDraggingMachine, setIsDraggingMachine] = useState(false);
  const [draggedMachineId, setDraggedMachineId] = useState<number | null>(null);
  const [machinePositions, setMachinePositions] = useState<Record<number, { x: number; y: number }>>({}); 
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Undo/Redo state
  const [positionHistory, setPositionHistory] = useState<Record<number, { x: number; y: number }>[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const GRID_SIZE = 50; // Grid size in pixels
  
  // Save position to history
  const saveToHistory = (newPositions: Record<number, { x: number; y: number }>) => {
    const newHistory = positionHistory.slice(0, historyIndex + 1);
    newHistory.push({ ...newPositions });
    setPositionHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };
  
  // Undo function
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setMachinePositions(positionHistory[newIndex]);
      toast.info("Hoàn tác thành công");
    }
  };
  
  // Redo function
  const handleRedo = () => {
    if (historyIndex < positionHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setMachinePositions(positionHistory[newIndex]);
      toast.info("Làm lại thành công");
    }
  };
  
  // Snap position to grid
  const snapPosition = (x: number, y: number) => {
    if (!snapToGrid) return { x, y };
    return {
      x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(y / GRID_SIZE) * GRID_SIZE,
    };
  };

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

  // Mutation to save machine layout position
  const updateMachinePositionMutation = trpc.machine.updateLayoutPosition.useMutation({
    onSuccess: () => {
      toast.success("Đã lưu vị trí máy");
    },
    onError: (err) => toast.error(err.message),
  });

  // Initialize machine positions from database
  useEffect(() => {
    if (machines && machines.length > 0) {
      const positions: Record<number, { x: number; y: number }> = {};
      machines.forEach((m) => {
        if (m.layoutPositionX !== null && m.layoutPositionY !== null) {
          positions[m.id] = {
            x: parseFloat(m.layoutPositionX as string),
            y: parseFloat(m.layoutPositionY as string),
          };
        }
      });
      setMachinePositions(positions);
    }
  }, [machines]);

  // Machine drag handlers
  const handleMachineDragStart = (e: React.MouseEvent, machineId: number, machineX: number, machineY: number) => {
    e.stopPropagation();
    setIsDraggingMachine(true);
    setDraggedMachineId(machineId);
    setDragOffset({
      x: e.clientX - machineX,
      y: e.clientY - machineY,
    });
  };

  const handleMachineDrag = (e: React.MouseEvent) => {
    if (!isDraggingMachine || draggedMachineId === null || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const newX = (e.clientX - dragOffset.x - rect.left - pan.x) / zoom;
    const newY = (e.clientY - dragOffset.y - rect.top - pan.y) / zoom;
    
    // Clamp to container bounds
    const clampedX = Math.max(0, Math.min(rect.width / zoom - 150, newX));
    const clampedY = Math.max(0, Math.min(rect.height / zoom - 100, newY));
    
    // Apply snap to grid
    const snappedPos = snapPosition(clampedX, clampedY);
    
    setMachinePositions(prev => ({
      ...prev,
      [draggedMachineId]: snappedPos
    }));
  };

  const handleMachineDragEnd = () => {
    if (isDraggingMachine && draggedMachineId !== null && containerRef.current) {
      const pos = machinePositions[draggedMachineId];
      if (pos) {
        const rect = containerRef.current.getBoundingClientRect();
        // Normalize to 0-1 range
        const normalizedX = pos.x / (rect.width / zoom);
        const normalizedY = pos.y / (rect.height / zoom);
        
        updateMachinePositionMutation.mutate({
          id: draggedMachineId,
          layoutPositionX: Math.max(0, Math.min(1, normalizedX)),
          layoutPositionY: Math.max(0, Math.min(1, normalizedY)),
        });
        
        // Save to history for undo/redo
        saveToHistory({ ...machinePositions });
      }
    }
    setIsDraggingMachine(false);
    setDraggedMachineId(null);
  };

  // Combine machine positions with stats
  const machinesWithStats = useMemo<MachineWithStats[]>(() => {
    if (!layoutData?.positions || !machinesStats) return [];

    return layoutData.positions.map(pos => {
      // Use image data from positions (joined with machines in server) or fallback to machines query
      const machineFromList = machines?.find(m => m.id === pos.machineId);
      const stats = machinesStats.find(s => s.machine.id === pos.machineId)?.stats || {
        total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0
      };

      return {
        id: pos.machineId,
        code: (pos as any).code || machineFromList?.code || "",
        name: (pos as any).name || machineFromList?.name || `Machine ${pos.machineId}`,
        machineType: (pos as any).machineType || machineFromList?.machineType || "UNKNOWN",
        image2DUrl: (pos as any).image2DUrl || machineFromList?.image2DUrl,
        image3DUrl: (pos as any).image3DUrl || machineFromList?.image3DUrl,
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

  // Export layout as image
  const handleExportImage = async () => {
    if (!containerRef.current) {
      toast.error("Không thể xuất hình ảnh");
      return;
    }

    try {
      // Use html2canvas if available, otherwise use native canvas
      const container = containerRef.current;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        toast.error("Trình duyệt không hỗ trợ xuất hình ảnh");
        return;
      }

      // Set canvas size
      canvas.width = container.offsetWidth * 2; // 2x for better quality
      canvas.height = container.offsetHeight * 2;
      ctx.scale(2, 2);

      // Draw background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, container.offsetWidth, container.offsetHeight);

      // Draw grid
      ctx.strokeStyle = 'rgba(100, 100, 150, 0.3)';
      ctx.lineWidth = 1;
      for (let x = 0; x < container.offsetWidth; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, container.offsetHeight);
        ctx.stroke();
      }
      for (let y = 0; y < container.offsetHeight; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(container.offsetWidth, y);
        ctx.stroke();
      }

      // Draw machines
      machinesWithStats.forEach((machine) => {
        const customPos = machinePositions[machine.id];
        const posX = customPos ? customPos.x : machine.positionX;
        const posY = customPos ? customPos.y : machine.positionY;

        // Machine box
        ctx.fillStyle = 'rgba(30, 30, 60, 0.9)';
        ctx.strokeStyle = machine.stats.yieldRate >= 98 ? '#22c55e' : 
                          machine.stats.yieldRate >= 95 ? '#eab308' : '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(posX, posY, machine.width, machine.height, 8);
        ctx.fill();
        ctx.stroke();

        // Machine name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(machine.name, posX + 8, posY + machine.height - 20);
        
        // Machine code
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '10px sans-serif';
        ctx.fillText(machine.code, posX + 8, posY + machine.height - 8);
      });

      // Add watermark
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '12px sans-serif';
      ctx.fillText(`AVI/AOI Layout - ${new Date().toLocaleDateString('vi-VN')}`, 10, container.offsetHeight - 10);

      // Download
      const link = document.createElement('a');
      link.download = `layout-${layoutData?.layout?.name || 'export'}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      toast.success("Đã xuất hình ảnh layout");
    } catch (error) {
      console.error('Export error:', error);
      toast.error("Lỗi khi xuất hình ảnh");
    }
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
              <Card className={`glass-card flex-1 ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}>
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
                      {/* Undo/Redo buttons */}
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        title="Hoàn tác (Ctrl+Z)"
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleRedo}
                        disabled={historyIndex >= positionHistory.length - 1}
                        title="Làm lại (Ctrl+Y)"
                      >
                        <Redo2 className="h-4 w-4" />
                      </Button>
                      
                      <div className="w-px h-6 bg-border mx-1" />
                      
                      {/* Snap to grid toggle */}
                      <Button 
                        variant={snapToGrid ? "default" : "outline"} 
                        size="icon" 
                        onClick={() => setSnapToGrid(!snapToGrid)}
                        title={snapToGrid ? "Tắt căn lưới" : "Bật căn lưới"}
                      >
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                      
                      <div className="w-px h-6 bg-border mx-1" />
                      
                      {/* Zoom controls */}
                      <Button variant="outline" size="icon" onClick={handleZoomOut}>
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground w-16 text-center">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button variant="outline" size="icon" onClick={handleZoomIn}>
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" onClick={handleResetView} title="Reset view">
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
                      >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </Button>
                      
                      <div className="w-px h-6 bg-border mx-1" />
                      
                      {/* Export button */}
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleExportImage}
                        title="Xuất hình ảnh"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={isFullscreen ? "p-0" : ""}>
                  <div 
                    ref={containerRef}
                    className={`relative w-full bg-secondary/30 rounded-lg overflow-hidden ${isDraggingMachine ? 'cursor-grabbing' : 'cursor-grab'} ${isFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[600px]'}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={(e) => {
                      handleMouseMove(e);
                      handleMachineDrag(e);
                    }}
                    onMouseUp={() => {
                      handleMouseUp();
                      handleMachineDragEnd();
                    }}
                    onMouseLeave={() => {
                      handleMouseUp();
                      handleMachineDragEnd();
                    }}
                    onWheel={handleWheel}
                  >
                    {/* Grid background */}
                    <div 
                      className="absolute inset-0 transition-opacity duration-200"
                      style={{
                        backgroundImage: snapToGrid ? `
                          linear-gradient(to right, oklch(0.28 0.02 260 / 0.5) 1px, transparent 1px),
                          linear-gradient(to bottom, oklch(0.28 0.02 260 / 0.5) 1px, transparent 1px)
                        ` : `
                          linear-gradient(to right, oklch(0.28 0.02 260 / 0.2) 1px, transparent 1px),
                          linear-gradient(to bottom, oklch(0.28 0.02 260 / 0.2) 1px, transparent 1px)
                        `,
                        backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
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
                          // Fallback logic: use 2D or 3D image based on layoutType, fallback to available image, then default
                          const preferredImage = layoutType === "2D" ? machine.image2DUrl : machine.image3DUrl;
                          const fallbackImage = layoutType === "2D" ? machine.image3DUrl : machine.image2DUrl;
                          const imageUrl = preferredImage || fallbackImage || '/default-machine-2d.svg';
                          const customPos = machinePositions[machine.id];
                          const posX = customPos ? customPos.x : machine.positionX;
                          const posY = customPos ? customPos.y : machine.positionY;
                          const isDragged = draggedMachineId === machine.id;
                          
                          return (
                            <div
                              key={machine.id}
                              className={`absolute rounded-lg border-2 shadow-lg bg-card/80 backdrop-blur cursor-move select-none ${
                                isDragged 
                                  ? 'border-primary shadow-primary/30 scale-105 z-50' 
                                  : 'border-border/50 hover:scale-105 hover:border-primary/50'
                              } transition-all duration-100`}
                              style={{
                                left: posX,
                                top: posY,
                                width: machine.width,
                                height: machine.height,
                              }}
                              onMouseDown={(e) => handleMachineDragStart(e, machine.id, posX, posY)}
                            >
                              {/* Machine Image or Placeholder */}
                              {imageUrl ? (
                                <div className="absolute inset-0 rounded-lg overflow-hidden">
                                  <img
                                    src={imageUrl}
                                    alt={machine.name}
                                    className="w-full h-full object-cover"
                                    draggable={false}
                                  />
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-muted/30 rounded-lg flex items-center justify-center">
                                  <Cpu className="h-8 w-8 text-muted-foreground/50" />
                                </div>
                              )}

                              {/* Simple Label Overlay */}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-lg">
                                <div className="flex items-center gap-1">
                                  <Cpu className="h-3 w-3 text-primary" />
                                  <span className="text-xs font-semibold text-white truncate">
                                    {machine.name}
                                  </span>
                                </div>
                                <span className="text-[10px] text-white/70">{machine.code}</span>
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
                      Kéo để di chuyển • Cuộn để zoom • Kéo máy để thay đổi vị trí
                    </div>

                    {/* Mini-map for fullscreen mode */}
                    {isFullscreen && machinesWithStats.length > 0 && (
                      <div className="absolute bottom-4 right-4 w-48 h-32 bg-card/90 backdrop-blur border border-border/50 rounded-lg overflow-hidden shadow-lg">
                        <div className="absolute inset-0 p-2">
                          <div 
                            className="relative w-full h-full bg-secondary/30 rounded cursor-pointer hover:bg-secondary/40 transition-colors"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const clickX = (e.clientX - rect.left) / rect.width;
                              const clickY = (e.clientY - rect.top) / rect.height;
                              // Convert mini-map click to viewport pan position
                              const newPanX = -(clickX * 1200 * zoom - (containerRef.current?.clientWidth || 800) / 2);
                              const newPanY = -(clickY * 600 * zoom - (containerRef.current?.clientHeight || 600) / 2);
                              setPan({ x: newPanX, y: newPanY });
                            }}
                          >
                            {/* Mini machines */}
                            {machinesWithStats.map((machine) => {
                              const customPos = machinePositions[machine.id];
                              const posX = customPos ? customPos.x : machine.positionX;
                              const posY = customPos ? customPos.y : machine.positionY;
                              // Scale positions to mini-map (assuming layout is 1200x600)
                              const miniX = (posX / 1200) * 100;
                              const miniY = (posY / 600) * 100;
                              return (
                                <div
                                  key={machine.id}
                                  className="absolute w-2 h-2 bg-primary rounded-sm pointer-events-none"
                                  style={{
                                    left: `${Math.min(95, Math.max(0, miniX))}%`,
                                    top: `${Math.min(90, Math.max(0, miniY))}%`,
                                  }}
                                  title={machine.name}
                                />
                              );
                            })}
                            {/* Viewport indicator */}
                            <div
                              className="absolute border-2 border-primary/50 rounded bg-primary/10 pointer-events-none transition-all duration-200"
                              style={{
                                left: `${Math.max(0, -pan.x / (1200 * zoom) * 100)}%`,
                                top: `${Math.max(0, -pan.y / (600 * zoom) * 100)}%`,
                                width: `${Math.min(100, 100 / zoom)}%`,
                                height: `${Math.min(100, 100 / zoom)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="absolute top-1 left-2 text-[10px] text-muted-foreground font-medium">
                          Mini-map (click to navigate)
                        </div>
                      </div>
                    )}
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
