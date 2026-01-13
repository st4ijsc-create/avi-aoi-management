import { useState, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Plus,
  Trash2,
  Edit,
  Save,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Image,
  Box,
  Layers,
  GripVertical,
  Settings2,
  Upload
} from "lucide-react";

type MachinePosition = {
  id: number;
  machineId: number;
  positionX: number;
  positionY: number;
  positionZ?: number | null;
  width: number;
  height: number;
  rotation?: number | null;
};

type MachineWithPosition = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  image2DUrl?: string | null;
  image3DUrl?: string | null;
  stationId?: number | null;
  operationStatus?: 'running' | 'stopped' | 'error' | 'maintenance' | null;
  position?: MachinePosition;
  stats?: {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
};

type WorkshopLayoutEditorProps = {
  workshopId: number;
  layoutId?: number;
  layoutType: "2D" | "3D";
  onLayoutChange?: () => void;
};

export default function WorkshopLayoutEditor({
  workshopId,
  layoutId,
  layoutType,
  onLayoutChange,
}: WorkshopLayoutEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [selectedMachine, setSelectedMachine] = useState<MachineWithPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddMachineOpen, setIsAddMachineOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Queries
  const { data: layoutData, refetch: refetchLayout } = trpc.layout.getById.useQuery(
    { id: layoutId! },
    { enabled: !!layoutId }
  );
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: machinesStats } = trpc.dashboard.getAllMachinesStats.useQuery({});
  const { data: stations } = trpc.station.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: lineStages } = trpc.lineStage.list.useQuery();

  // Mutations
  const addPositionMutation = trpc.layout.addMachinePosition.useMutation({
    onSuccess: () => {
      toast.success("Đã thêm máy vào layout");
      refetchLayout();
      onLayoutChange?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const updatePositionMutation = trpc.layout.updateMachinePosition.useMutation({
    onSuccess: () => {
      refetchLayout();
      onLayoutChange?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const removePositionMutation = trpc.layout.removeMachinePosition.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa máy khỏi layout");
      refetchLayout();
      onLayoutChange?.();
    },
    onError: (err) => toast.error(err.message),
  });

  // Combine machines with positions and stats
  const machinesWithPositions = useMemo<MachineWithPosition[]>(() => {
    if (!layoutData?.positions || !machines) return [];

    return layoutData.positions.map((pos) => {
      const machine = machines.find((m) => m.id === pos.machineId);
      const stats = machinesStats?.find((s) => s.machine.id === pos.machineId)?.stats;

      return {
        id: pos.machineId,
        code: machine?.code || "",
        name: machine?.name || `Machine ${pos.machineId}`,
        machineType: machine?.machineType || "UNKNOWN",
        image2DUrl: machine?.image2DUrl,
        image3DUrl: machine?.image3DUrl,
        stationId: machine?.stationId,
        operationStatus: (machine as any)?.operationStatus || 'stopped',
        position: {
          id: pos.id,
          machineId: pos.machineId,
          positionX: pos.positionX,
          positionY: pos.positionY,
          positionZ: pos.positionZ,
          width: pos.width,
          height: pos.height,
          rotation: pos.rotation,
        },
        stats: stats || { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 },
      };
    });
  }, [layoutData, machines, machinesStats]);

  // Available machines (not in layout)
  const availableMachines = useMemo(() => {
    if (!machines || !layoutData?.positions) return [];
    const usedIds = new Set(layoutData.positions.map((p) => p.machineId));
    return machines.filter((m) => !usedIds.has(m.id));
  }, [machines, layoutData]);

  // Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !isDragging) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && !isDragging) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.5, Math.min(3, z + delta)));
  };

  // Drag handlers for machines
  const handleMachineDragStart = (e: React.MouseEvent, machine: MachineWithPosition) => {
    e.stopPropagation();
    if (!machine.position) return;

    setIsDragging(true);
    setSelectedMachine(machine);

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = (e.clientX - rect.left - pan.x) / zoom - machine.position.positionX;
      const y = (e.clientY - rect.top - pan.y) / zoom - machine.position.positionY;
      setDragOffset({ x, y });
    }
  };

  const handleMachineDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !selectedMachine?.position) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const newX = Math.max(0, (e.clientX - rect.left - pan.x) / zoom - dragOffset.x);
        const newY = Math.max(0, (e.clientY - rect.top - pan.y) / zoom - dragOffset.y);

        // Update position visually (optimistic)
        setSelectedMachine({
          ...selectedMachine,
          position: {
            ...selectedMachine.position,
            positionX: newX,
            positionY: newY,
          },
        });
      }
    },
    [isDragging, selectedMachine, pan, zoom, dragOffset]
  );

  const handleMachineDragEnd = () => {
    if (isDragging && selectedMachine?.position) {
      // Save position to server
      updatePositionMutation.mutate({
        id: selectedMachine.position.id,
        positionX: Math.round(selectedMachine.position.positionX),
        positionY: Math.round(selectedMachine.position.positionY),
      });
    }
    setIsDragging(false);
  };

  // Add machine to layout
  const handleAddMachine = (machineId: number) => {
    if (!layoutId) return;

    addPositionMutation.mutate({
      layoutId,
      machineId,
      positionX: 100,
      positionY: 100,
      width: 120,
      height: 100,
    });
    setIsAddMachineOpen(false);
  };

  // Remove machine from layout
  const handleRemoveMachine = (positionId: number) => {
    if (confirm("Bạn có chắc muốn xóa máy này khỏi layout?")) {
      removePositionMutation.mutate({ id: positionId });
      setSelectedMachine(null);
    }
  };

  // Get status color based on yield rate
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

  if (!layoutId) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Chọn hoặc tạo layout để bắt đầu chỉnh sửa</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card className="glass-card">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsAddMachineOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Thêm máy
              </Button>
              {selectedMachine && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditDialogOpen(true)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Chỉnh sửa
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      selectedMachine.position &&
                      handleRemoveMachine(selectedMachine.position.id)
                    }
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Xóa
                  </Button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {layoutType === "2D" ? "Layout 2D" : "Layout 3D"}
              </Badge>
              <Button variant="outline" size="icon" onClick={handleZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground w-12 text-center">
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
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <div
            ref={containerRef}
            className="relative w-full h-[600px] bg-secondary/30 overflow-hidden cursor-grab active:cursor-grabbing"
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
              {machinesWithPositions.map((machine) => {
                if (!machine.position) return null;
                const isSelected = selectedMachine?.id === machine.id;
                const imageUrl = layoutType === "2D" ? machine.image2DUrl : machine.image3DUrl;

                return (
                  <div
                    key={machine.id}
                    className={`absolute rounded-lg border-2 shadow-lg transition-all cursor-move select-none ${
                      isSelected ? "ring-2 ring-primary" : ""
                    } ${getStatusColor(machine.stats?.yieldRate || 0)}`}
                    style={{
                      left: machine.position.positionX,
                      top: machine.position.positionY,
                      width: machine.position.width,
                      height: machine.position.height,
                      transform: machine.position.rotation
                        ? `rotate(${machine.position.rotation}deg)`
                        : undefined,
                    }}
                    onMouseDown={(e) => handleMachineDragStart(e, machine)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMachine(machine);
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

                    {/* Operation Status Indicator */}
                    <div className={`absolute top-1 right-1 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                      machine.operationStatus === 'running' ? 'bg-green-500/90 text-white' :
                      machine.operationStatus === 'stopped' ? 'bg-yellow-500/90 text-black' :
                      machine.operationStatus === 'error' ? 'bg-red-500/90 text-white animate-pulse' :
                      machine.operationStatus === 'maintenance' ? 'bg-blue-500/90 text-white' :
                      'bg-gray-500/90 text-white'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        machine.operationStatus === 'running' ? 'bg-white animate-pulse' :
                        machine.operationStatus === 'error' ? 'bg-white' :
                        'bg-white/70'
                      }`} />
                      {machine.operationStatus === 'running' ? 'Chạy' :
                       machine.operationStatus === 'stopped' ? 'Dừng' :
                       machine.operationStatus === 'error' ? 'Lỗi' :
                       machine.operationStatus === 'maintenance' ? 'Bảo trì' : 'N/A'}
                    </div>

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
                        {getStatusIcon(machine.stats?.yieldRate || 0)}
                      </div>

                      {/* Station Stages */}
                      {(() => {
                        // Find station for this machine
                        const station = stations?.find(s => s.id === machine.stationId);
                        // Find stages linked to this station
                        const stationStages = lineStages?.filter(stage => stage.stationId === machine.stationId) || [];
                        
                        if (station && stationStages.length > 0) {
                          return (
                            <div className="mb-1">
                              <div className="text-[9px] text-muted-foreground mb-0.5">
                                {station.name}
                              </div>
                              <div className="flex flex-wrap gap-0.5">
                                {stationStages.slice(0, 4).map((stage) => (
                                  <span
                                    key={stage.id}
                                    className="px-1 py-0.5 text-[8px] font-medium bg-primary/20 text-primary rounded"
                                    title={stage.name}
                                  >
                                    {stage.code}
                                  </span>
                                ))}
                                {stationStages.length > 4 && (
                                  <span className="px-1 py-0.5 text-[8px] text-muted-foreground">
                                    +{stationStages.length - 4}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Stats Grid */}
                      <div className="flex-1 grid grid-cols-2 gap-1 text-[10px]">
                        <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                          <div className="text-muted-foreground">FPY</div>
                          <div className="font-bold text-primary">
                            {(machine.stats?.yieldRate || 0).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                          <div className="text-muted-foreground">Output</div>
                          <div className="font-bold text-foreground">
                            {machine.stats?.total || 0}
                          </div>
                        </div>
                        <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                          <div className="text-muted-foreground">OK</div>
                          <div className="font-bold text-green-500">
                            {machine.stats?.ok || 0}
                          </div>
                        </div>
                        <div className="bg-background/60 rounded px-1 py-0.5 text-center">
                          <div className="text-muted-foreground">NG</div>
                          <div className="font-bold text-red-500">
                            {machine.stats?.ng || 0}
                          </div>
                        </div>
                      </div>

                      {/* Drag Handle */}
                      <div className="absolute top-1 left-1/2 -translate-x-1/2">
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Controls hint */}
            <div className="absolute bottom-4 left-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-3 py-2 rounded-lg">
              <Move className="h-3 w-3 inline mr-1" />
              Kéo máy để di chuyển • Cuộn để zoom • Click để chọn
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Machine Dialog */}
      <Dialog open={isAddMachineOpen} onOpenChange={setIsAddMachineOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm máy vào Layout</DialogTitle>
            <DialogDescription>
              Chọn máy để thêm vào layout hiện tại
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {availableMachines.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  Tất cả máy đã được thêm vào layout
                </p>
              ) : (
                availableMachines.map((machine) => (
                  <div
                    key={machine.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer"
                    onClick={() => handleAddMachine(machine.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Cpu className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">{machine.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {machine.code} • {machine.machineType}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">{machine.machineType}</Badge>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Edit Machine Position Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chỉnh sửa vị trí máy</DialogTitle>
            <DialogDescription>
              {selectedMachine?.name} ({selectedMachine?.code})
            </DialogDescription>
          </DialogHeader>
          {selectedMachine?.position && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vị trí X</Label>
                <Input
                  type="number"
                  value={selectedMachine.position.positionX}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      position: {
                        ...selectedMachine.position!,
                        positionX: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Vị trí Y</Label>
                <Input
                  type="number"
                  value={selectedMachine.position.positionY}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      position: {
                        ...selectedMachine.position!,
                        positionY: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Chiều rộng</Label>
                <Input
                  type="number"
                  value={selectedMachine.position.width}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      position: {
                        ...selectedMachine.position!,
                        width: parseInt(e.target.value) || 100,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Chiều cao</Label>
                <Input
                  type="number"
                  value={selectedMachine.position.height}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      position: {
                        ...selectedMachine.position!,
                        height: parseInt(e.target.value) || 80,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Góc xoay (độ)</Label>
                <Input
                  type="number"
                  value={selectedMachine.position.rotation || 0}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      position: {
                        ...selectedMachine.position!,
                        rotation: parseInt(e.target.value) || 0,
                      },
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={() => {
                if (selectedMachine?.position) {
                  updatePositionMutation.mutate({
                    id: selectedMachine.position.id,
                    positionX: selectedMachine.position.positionX,
                    positionY: selectedMachine.position.positionY,
                    width: selectedMachine.position.width,
                    height: selectedMachine.position.height,
                    rotation: selectedMachine.position.rotation ?? undefined,
                  });
                  setIsEditDialogOpen(false);
                }
              }}
              disabled={updatePositionMutation.isPending}
            >
              {updatePositionMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
