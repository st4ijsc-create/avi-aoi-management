import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';
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
  Download,
  Crosshair,
  X,
  Activity,
  BarChart3,
  Workflow
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, useSearch } from "wouter";
import WorkshopLayoutEditor from "@/components/WorkshopLayoutEditor";
import { useTwinStream } from "@/hooks/useTwinStream";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type MachineWithStats = {
  id: number;
  positionRecordId: number;
  code: string;
  name: string;
  machineType: string;
  image2DUrl?: string | null;
  image3DUrl?: string | null;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  stationId?: number | null;
  stationCode?: string | null;
  stageName?: string | null;
  stageCode?: string | null;
  stageOrderIndex?: number | null;
  stageId?: number | null;
  stats: {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
};

export default function Layout() {
  const { t } = useTranslation();
  const params = useParams<{ id?: string }>();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
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
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [highlightedStageId, setHighlightedStageId] = useState<number | null>(null);
  
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

  // G2.7 — WIP flow overlay (read-only visualization; stream or poll fallback).
  const [showWipFlow, setShowWipFlow] = useState(false);
  const twinStream = useTwinStream({
    layoutId: selectedLayout ? parseInt(selectedLayout) : undefined,
    enabled: showWipFlow,
  });
  const wipByStation = useMemo(() => {
    const m = new Map<number, { wipCount: number; color?: string; dominantState?: string }>();
    for (const s of twinStream.stations) {
      m.set(s.stationId, { wipCount: s.wipCount, color: s.color, dominantState: s.dominantState });
    }
    return m;
  }, [twinStream.stations]);
  
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
      toast.info(t('layout.undoSuccess'));
    }
  };
  
  // Redo function
  const handleRedo = () => {
    if (historyIndex < positionHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setMachinePositions(positionHistory[newIndex]);
      toast.info(t('layout.redoSuccess'));
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
  const { data: factories } = trpc.factory.list.useQuery();
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

  // Auto-select workshop from URL params (?workshopId=X or ?factoryId=X)
  useEffect(() => {
    if (!workshops || selectedWorkshop) return;
    const wsId = searchParams.get('workshopId');
    if (wsId) {
      const found = workshops.find(w => String(w.id) === wsId);
      if (found) { setSelectedWorkshop(String(found.id)); return; }
    }
    const facId = searchParams.get('factoryId');
    if (facId && factories) {
      const facWorkshop = workshops.find(w => String(w.factoryId) === facId);
      if (facWorkshop) { setSelectedWorkshop(String(facWorkshop.id)); return; }
    }
    // Auto-select first workshop if only one
    if (workshops.length === 1) {
      setSelectedWorkshop(String(workshops[0].id));
    }
  }, [workshops, factories, searchParams.get('workshopId'), searchParams.get('factoryId')]);

  // Auto-select first layout when layouts load
  useEffect(() => {
    if (layouts && layouts.length > 0 && !selectedLayout) {
      setSelectedLayout(String(layouts[0].id));
    }
  }, [layouts]);

  const createLayoutMutation = trpc.layout.create.useMutation({
    onSuccess: (data) => {
      toast.success(t('layout.layoutCreated'));
      refetchLayouts();
      setSelectedLayout(String(data.id));
      setIsCreateLayoutOpen(false);
      setNewLayoutName("");
    },
    onError: (err) => toast.error(err.message),
  });

  // Mutation to save machine position in layout
  const updateLayoutPositionMutation = trpc.layout.updateMachinePosition.useMutation({
    onSuccess: () => {
      toast.success(t('layout.positionSaved'));
    },
    onError: (err) => toast.error(err.message),
  });

  // Initialize machine positions from layout data (canvas pixel space)
  useEffect(() => {
    if (layoutData?.positions) {
      const positions: Record<number, { x: number; y: number }> = {};
      layoutData.positions.forEach((pos: any) => {
        positions[pos.machineId] = {
          x: pos.positionX,
          y: pos.positionY,
        };
      });
      setMachinePositions(positions);
    }
  }, [layoutData]);

  // Machine drag handlers
  const handleMachineDragStart = (e: React.MouseEvent, machineId: number, machineX: number, machineY: number) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setIsDraggingMachine(true);
    setDraggedMachineId(machineId);
    // Compute click offset within the machine in canvas coordinate space
    setDragOffset({
      x: (e.clientX - rect.left - pan.x) / zoom - machineX,
      y: (e.clientY - rect.top - pan.y) / zoom - machineY,
    });
  };

  const handleMachineDrag = (e: React.MouseEvent) => {
    if (!isDraggingMachine || draggedMachineId === null || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    // Convert mouse screen position to canvas space and subtract the initial click offset
    const newX = (e.clientX - rect.left - pan.x) / zoom - dragOffset.x;
    const newY = (e.clientY - rect.top - pan.y) / zoom - dragOffset.y;
    
    // Clamp to container bounds (canvas space)
    const canvasW = rect.width / zoom;
    const canvasH = rect.height / zoom;
    const clampedX = Math.max(0, Math.min(canvasW - 150, newX));
    const clampedY = Math.max(0, Math.min(canvasH - 100, newY));
    
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
      // Find the position record ID for the dragged machine
      const machineData = machinesWithStats.find(m => m.id === draggedMachineId);
      if (pos && machineData?.positionRecordId) {
        updateLayoutPositionMutation.mutate({
          id: machineData.positionRecordId,
          positionX: Math.round(pos.x),
          positionY: Math.round(pos.y),
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

    return layoutData.positions.map((pos: any) => {
      // Use image data from positions (joined with machines in server) or fallback to machines query
      const machineFromList = machines?.find(m => m.id === pos.machineId);
      const stats = machinesStats.find(s => s.machine.id === pos.machineId)?.stats || {
        total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0
      };

      return {
        id: pos.machineId,
        positionRecordId: pos.id,
        code: pos.code || machineFromList?.code || "",
        name: pos.name || machineFromList?.name || `Machine ${pos.machineId}`,
        machineType: pos.machineType || machineFromList?.machineType || "UNKNOWN",
        image2DUrl: pos.image2DUrl || machineFromList?.image2DUrl,
        image3DUrl: pos.image3DUrl || machineFromList?.image3DUrl,
        positionX: pos.positionX,
        positionY: pos.positionY,
        width: pos.width,
        height: pos.height,
        stationId: (machineFromList as any)?.stationId ?? pos.stationId ?? null,
        stationCode: pos.stationCode ?? null,
        stageName: pos.stageName ?? null,
        stageCode: pos.stageCode ?? null,
        stageOrderIndex: pos.stageOrderIndex ?? null,
        stageId: pos.stageId ?? null,
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

  // Fit all machines in view
  const fitAllInView = useCallback(() => {
    if (!machinesWithStats.length || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    machinesWithStats.forEach(m => {
      const cp = machinePositions[m.id];
      const px = cp ? cp.x : m.positionX;
      const py = cp ? cp.y : m.positionY;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px + m.width);
      maxY = Math.max(maxY, py + m.height);
    });
    const contentW = maxX - minX + 100;
    const contentH = maxY - minY + 100;
    const newZoom = Math.min(cw / contentW, ch / contentH, 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setZoom(newZoom);
    setPan({ x: cw / 2 - centerX * newZoom, y: ch / 2 - centerY * newZoom });
  }, [machinesWithStats, machinePositions]);

  // Handle panning - only pan when NOT dragging a machine
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !isDraggingMachine) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && !isDraggingMachine) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Handle wheel zoom toward cursor position
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.3, Math.min(3, zoom + delta));
    const ratio = newZoom / zoom;
    setPan({
      x: cursorX - ratio * (cursorX - pan.x),
      y: cursorY - ratio * (cursorY - pan.y),
    });
    setZoom(newZoom);
  };

  // Export layout as image
  const handleExportImage = async () => {
    if (!containerRef.current) {
      toast.error(t('layout.cannotExportImage'));
      return;
    }

    try {
      // Use html2canvas if available, otherwise use native canvas
      const container = containerRef.current;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        toast.error(t('layout.browserNotSupportExport'));
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

      toast.success(t('layout.imageExported'));
    } catch (error) {
      console.error('Export error:', error);
      toast.error(t('layout.exportImageError'));
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
      toast.error(t('layout.pleaseEnterLayoutName'));
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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{t('layout.workshopLayout')}</h1>
              <ViewOnlyBadge module="settings_factory" />
            </div>
            <p className="text-muted-foreground">{t('layout.workshopLayoutDescription')}</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedWorkshop} onValueChange={(v) => {
              setSelectedWorkshop(v);
              setSelectedLayout("");
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('layout.selectWorkshop')} />
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
                  <SelectValue placeholder={t('layout.selectLayout')} />
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
              <PermissionGate module="settings_factory" action="canCreate">
              <Dialog open={isCreateLayoutOpen} onOpenChange={setIsCreateLayoutOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    {t('layout.createLayout')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('layout.createNewLayout')}</DialogTitle>
                    <DialogDescription>
                      {t('layout.createLayoutDescription')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('layout.layoutName')}</Label>
                      <Input
                        value={newLayoutName}
                        onChange={(e) => setNewLayoutName(e.target.value)}
                        placeholder={t('layout.layoutNamePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('layout.layoutType')}</Label>
                      <Select value={newLayoutType} onValueChange={(v: "2D" | "3D") => setNewLayoutType(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2D">{t('layout.layout2D')}</SelectItem>
                          <SelectItem value="3D">{t('layout.layout3D')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateLayoutOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button onClick={handleCreateLayout} disabled={createLayoutMutation.isPending}>
                      {createLayoutMutation.isPending ? t('layout.creating') : t('layout.createLayout')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              </PermissionGate>
            )}
          </div>
        </div>

        {/* Main Content with Tabs */}
        {selectedLayout ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="view" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                {t('layout.viewLayout')}
              </TabsTrigger>
              <TabsTrigger value="edit" className="flex items-center gap-2">
                <Edit className="h-4 w-4" />
                {t('layout.edit')}
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
                        {t('layout.machinesDisplayed', { count: machinesWithStats.length, type: layoutType })}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Undo/Redo buttons */}
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        title={t('layout.undoTooltip')}
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleRedo}
                        disabled={historyIndex >= positionHistory.length - 1}
                        title={t('layout.redoTooltip')}
                      >
                        <Redo2 className="h-4 w-4" />
                      </Button>
                      
                      <div className="w-px h-6 bg-border mx-1" />
                      
                      {/* Snap to grid toggle */}
                      <Button
                        variant={snapToGrid ? "default" : "outline"}
                        size="icon"
                        onClick={() => setSnapToGrid(!snapToGrid)}
                        title={snapToGrid ? t('layout.disableGrid') : t('layout.enableGrid')}
                      >
                        <Grid3X3 className="h-4 w-4" />
                      </Button>

                      {/* G2.7 — WIP flow overlay toggle (read-only) */}
                      <Button
                        variant={showWipFlow ? "default" : "outline"}
                        size="icon"
                        onClick={() => setShowWipFlow(v => !v)}
                        title={t('digitalTwin.tabWipFlow', 'WIP flow')}
                      >
                        <Workflow className="h-4 w-4" />
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
                      <Button variant="outline" size="icon" onClick={fitAllInView} title={t('layout.fitAllInView') || 'Fit all in view'}>
                        <Crosshair className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? t('layout.exitFullscreen') : t('layout.fullscreen')}
                      >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </Button>
                      
                      <div className="w-px h-6 bg-border mx-1" />
                      
                      {/* Export button */}
                      <Button 
                        variant="outline" 
                        size="icon" 
                        onClick={handleExportImage}
                        title={t('layout.exportImage')}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={isFullscreen ? "p-0" : ""}>
                  <div 
                    ref={containerRef}
                    className={`relative w-full bg-secondary/30 rounded-lg overflow-hidden ${isDraggingMachine ? 'cursor-grabbing' : isPanning ? 'cursor-grabbing' : 'cursor-grab'} ${isFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[600px]'}`}
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
                          
                          const isStageHighlighted = highlightedStageId != null && machine.stageId === highlightedStageId;
                          
                          return (
                            <div
                              key={machine.id}
                              className={`absolute rounded-lg border-2 shadow-lg bg-card/80 backdrop-blur cursor-move select-none ${
                                isDragged 
                                  ? 'border-primary shadow-primary/30 scale-105 z-50' 
                                  : selectedMachineId === machine.id
                                    ? 'border-primary/80 shadow-primary/20 ring-2 ring-primary/30 z-40'
                                    : isStageHighlighted
                                      ? 'border-amber-400 shadow-amber-400/30 ring-2 ring-amber-400/40 z-30'
                                      : 'border-border/50 hover:scale-105 hover:border-primary/50'
                              } transition-all duration-100`}
                              style={{
                                left: posX,
                                top: posY,
                                width: machine.width,
                                height: machine.height,
                              }}
                              onMouseDown={(e) => handleMachineDragStart(e, machine.id, posX, posY)}
                              onClick={(e) => {
                                if (!isDraggingMachine) {
                                  e.stopPropagation();
                                  setSelectedMachineId(prev => prev === machine.id ? null : machine.id);
                                  if (machine.stageId) {
                                    setHighlightedStageId(prev => prev === machine.stageId ? null : machine.stageId!);
                                  }
                                }
                              }}
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

                              {/* Yield status indicator */}
                              <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-bold shadow ${
                                machine.stats.yieldRate >= 98 ? 'bg-green-500/90 text-white' :
                                machine.stats.yieldRate >= 95 ? 'bg-yellow-500/90 text-black' :
                                machine.stats.total > 0 ? 'bg-red-500/90 text-white' : 'bg-gray-500/70 text-white'
                              }`}>
                                {machine.stats.total > 0 ? `${machine.stats.yieldRate.toFixed(1)}%` : 'N/A'}
                              </div>

                              {/* G2.7 — WIP flow badge (read-only overlay; color from server) */}
                              {showWipFlow && machine.stationId != null && wipByStation.has(machine.stationId) && (
                                <div
                                  className="absolute top-1 left-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow ring-1 ring-white/40 transition-all duration-300"
                                  style={{ backgroundColor: wipByStation.get(machine.stationId)!.color || '#3b82f6' }}
                                  title={t('digitalTwin.wipFlow.wipCount', 'WIP')}
                                >
                                  <Workflow className="h-3 w-3" />
                                  {wipByStation.get(machine.stationId)!.wipCount}
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
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-white/70">{machine.code}</span>
                                  {machine.stats.total > 0 && (
                                    <span className="text-[9px] text-white/60">
                                      {machine.stats.ok}/{machine.stats.total}
                                    </span>
                                  )}
                                </div>
                                {machine.stageName && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <span className="text-[8px] px-1 py-0 rounded bg-primary/30 text-primary font-bold">
                                      {machine.stageOrderIndex}
                                    </span>
                                    <span className="text-[9px] text-white/60 truncate">
                                      {machine.stageName}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                          <LayoutGrid className="h-16 w-16 mb-4 opacity-50" />
                          <p className="text-lg font-medium">{t('layout.noMachinesInLayout')}</p>
                          <p className="text-sm">{t('layout.switchToEditTab')}</p>
                        </div>
                      )}
                    </div>

                    {/* Controls hint */}
                    <div className="absolute bottom-4 left-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-3 py-2 rounded-lg space-x-3">
                      <span><Move className="h-3 w-3 inline mr-1" />{t('layout.controlsHint')}</span>
                      <span>|</span>
                      <span>🖱️ Scroll to zoom</span>
                      <span>|</span>
                      <span>Click machine for details</span>
                    </div>

                    {/* Selected machine info panel */}
                    {selectedMachineId && (() => {
                      const sel = machinesWithStats.find(m => m.id === selectedMachineId);
                      if (!sel) return null;
                      return (
                        <div className="absolute top-4 right-4 w-64 bg-card/95 backdrop-blur border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                            <div className="flex items-center gap-2">
                              <Cpu className="h-4 w-4 text-primary" />
                              <span className="font-semibold text-sm truncate">{sel.name}</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMachineId(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="p-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Code</span>
                              <Badge variant="outline">{sel.code}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Type</span>
                              <span>{sel.machineType}</span>
                            </div>
                            {sel.stageName && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Stage</span>
                                <div className="flex items-center gap-1">
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">{sel.stageOrderIndex}</Badge>
                                  <span>{sel.stageName}</span>
                                </div>
                              </div>
                            )}
                            {sel.stationCode && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Station</span>
                                <span>{sel.stationCode}</span>
                              </div>
                            )}
                            <div className="border-t border-border pt-2 mt-2">
                              <div className="flex items-center gap-1 mb-2">
                                <Activity className="h-3.5 w-3.5 text-primary" />
                                <span className="font-medium text-xs">Inspection Stats</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="bg-muted/40 rounded px-2 py-1">
                                  <div className="text-[10px] text-muted-foreground">Total</div>
                                  <div className="font-bold">{sel.stats.total.toLocaleString()}</div>
                                </div>
                                <div className="bg-green-500/10 rounded px-2 py-1">
                                  <div className="text-[10px] text-green-600">OK</div>
                                  <div className="font-bold text-green-600">{sel.stats.ok.toLocaleString()}</div>
                                </div>
                                <div className="bg-red-500/10 rounded px-2 py-1">
                                  <div className="text-[10px] text-red-600">NG</div>
                                  <div className="font-bold text-red-600">{sel.stats.ng.toLocaleString()}</div>
                                </div>
                                <div className="bg-yellow-500/10 rounded px-2 py-1">
                                  <div className="text-[10px] text-yellow-600">NTF</div>
                                  <div className="font-bold text-yellow-600">{sel.stats.ntf.toLocaleString()}</div>
                                </div>
                              </div>
                              <div className="mt-2">
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-muted-foreground">Yield Rate</span>
                                  <span className={`font-bold ${
                                    sel.stats.yieldRate >= 98 ? 'text-green-600' :
                                    sel.stats.yieldRate >= 95 ? 'text-yellow-600' : 'text-red-600'
                                  }`}>{sel.stats.yieldRate.toFixed(2)}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      sel.stats.yieldRate >= 98 ? 'bg-green-500' :
                                      sel.stats.yieldRate >= 95 ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${Math.min(100, sel.stats.yieldRate)}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Mini-map */}
                    {machinesWithStats.length > 0 && (
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
              <p className="text-lg font-medium text-foreground">{t('layout.noLayoutSelected')}</p>
              <p className="text-muted-foreground mt-2">
                {selectedWorkshop 
                  ? t('layout.selectLayoutOrCreate')
                  : t('layout.selectWorkshopToViewLayouts')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
