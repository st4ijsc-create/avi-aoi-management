import { useState, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, GripVertical, Undo2, Redo2 } from "lucide-react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";
import { toast } from "sonner";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  DragMoveEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface ProductionOrder {
  id: number;
  orderCode: string;
  companyCode: string;
  factoryId: number;
  workshopId: number;
  lineId: number;
  productModelId: number;
  targetQuantity: number;
  completedQuantity: number;
  okQuantity: number;
  ngQuantity: number;
  ntfQuantity: number;
  status: string;
  priority: number;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Schedule fields
  scheduledStartDate?: Date | null;
  scheduledEndDate?: Date | null;
}

interface ScheduleChange {
  orderId: number;
  oldStartDate: Date;
  oldEndDate: Date;
  newStartDate: Date;
  newEndDate: Date;
  oldLineId: number;
  newLineId: number;
}

interface GanttChartProps {
  orders: ProductionOrder[];
  lines: { id: number; name: string; workshopId: number }[];
  workshops: { id: number; name: string; factoryId: number }[];
  factories: { id: number; name: string }[];
  products: { id: number; name: string }[];
  onOrderClick?: (order: ProductionOrder) => void;
  onOrderReschedule?: (orderId: number, newStartDate: Date, newEndDate: Date, newLineId?: number) => Promise<void>;
}

type ViewMode = "day" | "week" | "month";

// Draggable Order Component
function DraggableOrder({
  order,
  style,
  orderIndex,
  onOrderClick,
  getProductName,
  getProgress,
  isDragging,
}: {
  order: ProductionOrder;
  style: { left: string; width: string; className: string };
  orderIndex: number;
  onOrderClick?: (order: ProductionOrder) => void;
  getProductName: (id: number) => string;
  getProgress: (order: ProductionOrder) => number;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `order-${order.id}`,
    data: { order },
  });

  const dragStyle = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: 100,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={`absolute h-10 rounded border cursor-grab transition-all hover:scale-[1.02] hover:shadow-lg ${style.className} ${
        isDragging ? "opacity-50" : ""
      }`}
      style={{
        left: style.left,
        width: style.width,
        top: `${4 + (orderIndex % 2) * 24}px`,
        ...dragStyle,
      }}
      onClick={() => onOrderClick?.(order)}
      title={`${order.orderCode} - ${getProductName(order.productModelId)} (${getProgress(order)}%)\nKéo để thay đổi lịch`}
      {...attributes}
      {...listeners}
    >
      <div className="px-2 py-1 text-white text-xs truncate flex items-center gap-1">
        <GripVertical className="w-3 h-3 opacity-60 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{order.orderCode}</div>
          <div className="flex items-center gap-1 text-[10px] opacity-90">
            <span>{getProgress(order)}%</span>
            <span>•</span>
            <span>{order.completedQuantity}/{order.targetQuantity}</span>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 rounded-b">
        <div 
          className="h-full bg-white/50 rounded-b transition-all"
          style={{ width: `${getProgress(order)}%` }}
        />
      </div>
    </div>
  );
}

// Droppable Timeline Row
function DroppableTimelineRow({
  lineId,
  children,
  width,
  isOver,
}: {
  lineId: number;
  children: React.ReactNode;
  width: number;
  isOver?: boolean;
}) {
  const { setNodeRef, isOver: dropping } = useDroppable({
    id: `line-${lineId}`,
    data: { lineId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative h-16 transition-colors ${
        dropping || isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""
      }`}
      style={{ width: `${width}px` }}
    >
      {children}
    </div>
  );
}

export default function GanttChart({
  orders,
  lines,
  workshops,
  factories,
  products,
  onOrderClick,
  onOrderReschedule,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedLineId, setSelectedLineId] = useState<string>("all");
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>("all");
  const [activeOrder, setActiveOrder] = useState<ProductionOrder | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    order: ProductionOrder | null;
    newStartDate: Date | null;
    newEndDate: Date | null;
    newLineId: number | null;
  }>({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null });
  const [undoStack, setUndoStack] = useState<ScheduleChange[]>([]);
  const [redoStack, setRedoStack] = useState<ScheduleChange[]>([]);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum drag distance before activation
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    let start: Date, end: Date;
    
    switch (viewMode) {
      case "day":
        start = addDays(currentDate, -3);
        end = addDays(currentDate, 10);
        break;
      case "week":
        start = startOfWeek(currentDate, { weekStartsOn: 1 });
        end = addDays(start, 27); // 4 weeks
        break;
      case "month":
        start = startOfMonth(currentDate);
        end = endOfMonth(addDays(start, 60)); // ~2 months
        break;
      default:
        start = currentDate;
        end = addDays(currentDate, 14);
    }
    
    return { start, end, days: eachDayOfInterval({ start, end }) };
  }, [viewMode, currentDate]);

  // Filter lines based on selected factory
  const filteredLines = useMemo(() => {
    if (selectedFactoryId === "all") return lines;
    const workshopIds = workshops
      .filter(w => w.factoryId === parseInt(selectedFactoryId))
      .map(w => w.id);
    return lines.filter(l => workshopIds.includes(l.workshopId));
  }, [lines, workshops, selectedFactoryId]);

  // Filter orders based on selected line and factory
  const filteredOrders = useMemo(() => {
    let result = orders;
    
    if (selectedLineId !== "all") {
      result = result.filter(o => o.lineId === parseInt(selectedLineId));
    }
    
    if (selectedFactoryId !== "all") {
      const workshopIds = workshops
        .filter(w => w.factoryId === parseInt(selectedFactoryId))
        .map(w => w.id);
      result = result.filter(o => workshopIds.includes(o.workshopId));
    }
    
    return result;
  }, [orders, selectedLineId, selectedFactoryId, workshops]);

  // Group orders by line
  const ordersByLine = useMemo(() => {
    const grouped: Record<number, ProductionOrder[]> = {};
    
    filteredLines.forEach(line => {
      grouped[line.id] = filteredOrders.filter(o => o.lineId === line.id);
    });
    
    return grouped;
  }, [filteredOrders, filteredLines]);

  // Calculate cell width based on view mode
  const cellWidth = useMemo(() => {
    switch (viewMode) {
      case "day": return 80;
      case "week": return 40;
      case "month": return 20;
      default: return 40;
    }
  }, [viewMode]);

  // Calculate order position and width
  const getOrderStyle = useCallback((order: ProductionOrder) => {
    // Use scheduled dates if available, otherwise estimate from createdAt
    const orderStart = order.scheduledStartDate 
      ? new Date(order.scheduledStartDate) 
      : new Date(order.createdAt);
    
    // Estimate order duration based on target quantity (1 day per 100 items)
    const estimatedDays = Math.max(1, Math.ceil(order.targetQuantity / 100));
    const orderEnd = order.scheduledEndDate 
      ? new Date(order.scheduledEndDate)
      : addDays(orderStart, estimatedDays);
    
    const startOffset = differenceInDays(orderStart, dateRange.start);
    const duration = differenceInDays(orderEnd, orderStart);
    
    const left = Math.max(0, startOffset * cellWidth);
    const width = Math.max(cellWidth, duration * cellWidth);
    
    // Status colors
    const statusColors: Record<string, string> = {
      pending: "bg-yellow-500/80 border-yellow-600",
      in_progress: "bg-blue-500/80 border-blue-600",
      completed: "bg-green-500/80 border-green-600",
      paused: "bg-orange-500/80 border-orange-600",
      cancelled: "bg-red-500/80 border-red-600",
    };
    
    return {
      left: `${left}px`,
      width: `${width}px`,
      className: statusColors[order.status] || "bg-gray-500/80 border-gray-600",
    };
  }, [dateRange.start, cellWidth]);

  // Navigate timeline
  const navigateTimeline = (direction: "prev" | "next") => {
    const days = viewMode === "day" ? 7 : viewMode === "week" ? 14 : 30;
    setCurrentDate(prev => addDays(prev, direction === "next" ? days : -days));
  };

  // Scroll to today
  const scrollToToday = () => {
    setCurrentDate(new Date());
    setTimeout(() => {
      if (scrollRef.current) {
        const todayIndex = dateRange.days.findIndex(d => isToday(d));
        if (todayIndex >= 0) {
          scrollRef.current.scrollLeft = todayIndex * cellWidth - 200;
        }
      }
    }, 100);
  };

  // Get line name helper
  const getLineName = (lineId: number) => lines.find(l => l.id === lineId)?.name || `Line ${lineId}`;
  const getProductName = (productId: number) => products.find(p => p.id === productId)?.name || "-";
  const getProgress = (order: ProductionOrder) => {
    if (order.targetQuantity === 0) return 0;
    return Math.round((order.completedQuantity / order.targetQuantity) * 100);
  };

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const order = (active.data.current as { order: ProductionOrder })?.order;
    if (order) {
      setActiveOrder(order);
    }
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveOrder(null);

    if (!over || !active.data.current) return;

    const order = (active.data.current as { order: ProductionOrder }).order;
    const targetLineId = (over.data.current as { lineId: number })?.lineId;

    if (!order || !targetLineId) return;

    // Calculate new dates based on drag distance
    const daysMoved = Math.round(delta.x / cellWidth);
    if (daysMoved === 0 && targetLineId === order.lineId) return;

    const currentStart = order.scheduledStartDate 
      ? new Date(order.scheduledStartDate) 
      : new Date(order.createdAt);
    const estimatedDays = Math.max(1, Math.ceil(order.targetQuantity / 100));
    const currentEnd = order.scheduledEndDate 
      ? new Date(order.scheduledEndDate)
      : addDays(currentStart, estimatedDays);

    const newStartDate = addDays(currentStart, daysMoved);
    const newEndDate = addDays(currentEnd, daysMoved);

    // Show confirmation dialog
    setConfirmDialog({
      open: true,
      order,
      newStartDate,
      newEndDate,
      newLineId: targetLineId !== order.lineId ? targetLineId : null,
    });
  };

  // Confirm reschedule
  const confirmReschedule = async () => {
    if (!confirmDialog.order || !confirmDialog.newStartDate || !confirmDialog.newEndDate) return;

    const order = confirmDialog.order;
    const currentStart = order.scheduledStartDate 
      ? new Date(order.scheduledStartDate) 
      : new Date(order.createdAt);
    const estimatedDays = Math.max(1, Math.ceil(order.targetQuantity / 100));
    const currentEnd = order.scheduledEndDate 
      ? new Date(order.scheduledEndDate)
      : addDays(currentStart, estimatedDays);

    // Save to undo stack
    const change: ScheduleChange = {
      orderId: order.id,
      oldStartDate: currentStart,
      oldEndDate: currentEnd,
      newStartDate: confirmDialog.newStartDate,
      newEndDate: confirmDialog.newEndDate,
      oldLineId: order.lineId,
      newLineId: confirmDialog.newLineId || order.lineId,
    };

    setUndoStack(prev => [...prev, change]);
    setRedoStack([]); // Clear redo stack on new action

    setIsRescheduling(true);
    try {
      if (onOrderReschedule) {
        await onOrderReschedule(
          order.id,
          confirmDialog.newStartDate,
          confirmDialog.newEndDate,
          confirmDialog.newLineId || undefined
        );
        toast.success(`Đã cập nhật lịch cho ${order.orderCode}`);
      } else {
        toast.info("Chức năng cập nhật lịch chưa được kết nối");
      }
    } catch (error) {
      toast.error("Không thể cập nhật lịch");
      // Remove from undo stack on error
      setUndoStack(prev => prev.slice(0, -1));
    } finally {
      setIsRescheduling(false);
      setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null });
    }
  };

  // Undo last action
  const handleUndo = async () => {
    if (undoStack.length === 0 || !onOrderReschedule) return;

    const lastChange = undoStack[undoStack.length - 1];
    setIsRescheduling(true);
    try {
      await onOrderReschedule(
        lastChange.orderId,
        lastChange.oldStartDate,
        lastChange.oldEndDate,
        lastChange.oldLineId
      );
      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev, lastChange]);
      toast.success("Đã hoàn tác thay đổi");
    } catch (error) {
      toast.error("Không thể hoàn tác");
    } finally {
      setIsRescheduling(false);
    }
  };

  // Redo last undone action
  const handleRedo = async () => {
    if (redoStack.length === 0 || !onOrderReschedule) return;

    const lastUndo = redoStack[redoStack.length - 1];
    setIsRescheduling(true);
    try {
      await onOrderReschedule(
        lastUndo.orderId,
        lastUndo.newStartDate,
        lastUndo.newEndDate,
        lastUndo.newLineId
      );
      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev, lastUndo]);
      toast.success("Đã làm lại thay đổi");
    } catch (error) {
      toast.error("Không thể làm lại");
    } finally {
      setIsRescheduling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Gantt Chart - Tiến độ sản xuất
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Undo/Redo */}
            {onOrderReschedule && (
              <div className="flex items-center gap-1 mr-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={handleUndo}
                  disabled={undoStack.length === 0 || isRescheduling}
                  title="Hoàn tác (Undo)"
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={handleRedo}
                  disabled={redoStack.length === 0 || isRescheduling}
                  title="Làm lại (Redo)"
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Factory Filter */}
            <Select value={selectedFactoryId} onValueChange={setSelectedFactoryId}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Nhà máy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả nhà máy</SelectItem>
                {factories.map(f => (
                  <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Line Filter */}
            <Select value={selectedLineId} onValueChange={setSelectedLineId}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Dây chuyền" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả dây chuyền</SelectItem>
                {filteredLines.map(l => (
                  <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* View Mode */}
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Theo ngày</SelectItem>
                <SelectItem value="week">Theo tuần</SelectItem>
                <SelectItem value="month">Theo tháng</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Navigation */}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => navigateTimeline("prev")}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={scrollToToday}>
                Hôm nay
              </Button>
              <Button variant="outline" size="icon" onClick={() => navigateTimeline("next")}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        
        {/* Drag hint */}
        {onOrderReschedule && (
          <p className="text-xs text-muted-foreground mt-2">
            💡 Kéo thả các lệnh sản xuất để thay đổi lịch. Có thể kéo sang dây chuyền khác.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="border rounded-lg overflow-hidden">
            {/* Header - Date columns */}
            <div className="flex border-b bg-muted/50">
              {/* Line name column */}
              <div className="w-48 min-w-48 p-2 border-r font-medium bg-muted sticky left-0 z-10">
                Dây chuyền
              </div>
              
              {/* Date columns */}
              <div className="flex-1 overflow-x-auto" ref={scrollRef}>
                <div className="flex" style={{ width: `${dateRange.days.length * cellWidth}px` }}>
                  {dateRange.days.map((day, index) => (
                    <div
                      key={index}
                      className={`flex-shrink-0 p-1 text-center text-xs border-r ${
                        isToday(day) ? "bg-primary/10 font-bold" : ""
                      } ${day.getDay() === 0 || day.getDay() === 6 ? "bg-muted/30" : ""}`}
                      style={{ width: `${cellWidth}px` }}
                    >
                      <div className="font-medium">
                        {viewMode === "month" 
                          ? format(day, "d", { locale: vi })
                          : format(day, "EEE", { locale: vi })}
                      </div>
                      <div className="text-muted-foreground">
                        {viewMode === "month"
                          ? (day.getDate() === 1 ? format(day, "MMM", { locale: vi }) : "")
                          : format(day, "d/M", { locale: vi })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Body - Lines and orders */}
            <div className="max-h-[500px] overflow-y-auto">
              {filteredLines.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Không có dây chuyền nào
                </div>
              ) : (
                filteredLines.map(line => (
                  <div key={line.id} className="flex border-b hover:bg-muted/20">
                    {/* Line name */}
                    <div className="w-48 min-w-48 p-2 border-r bg-background sticky left-0 z-10">
                      <div className="font-medium text-sm">{line.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {ordersByLine[line.id]?.length || 0} lệnh
                      </div>
                    </div>
                    
                    {/* Timeline */}
                    <div className="flex-1 overflow-x-auto">
                      <DroppableTimelineRow
                        lineId={line.id}
                        width={dateRange.days.length * cellWidth}
                      >
                        {/* Grid lines */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dateRange.days.map((day, index) => (
                            <div
                              key={index}
                              className={`flex-shrink-0 border-r ${
                                isToday(day) ? "bg-primary/5" : ""
                              } ${day.getDay() === 0 || day.getDay() === 6 ? "bg-muted/20" : ""}`}
                              style={{ width: `${cellWidth}px` }}
                            />
                          ))}
                        </div>
                        
                        {/* Orders */}
                        {ordersByLine[line.id]?.map((order, orderIndex) => {
                          const style = getOrderStyle(order);
                          return (
                            <DraggableOrder
                              key={order.id}
                              order={order}
                              style={style}
                              orderIndex={orderIndex}
                              onOrderClick={onOrderClick}
                              getProductName={getProductName}
                              getProgress={getProgress}
                              isDragging={activeOrder?.id === order.id}
                            />
                          );
                        })}
                      </DroppableTimelineRow>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeOrder && (
              <div
                className={`h-10 rounded border shadow-lg ${getOrderStyle(activeOrder).className}`}
                style={{ width: getOrderStyle(activeOrder).width }}
              >
                <div className="px-2 py-1 text-white text-xs truncate">
                  <div className="font-medium truncate">{activeOrder.orderCode}</div>
                  <div className="flex items-center gap-1 text-[10px] opacity-90">
                    <span>{getProgress(activeOrder)}%</span>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-xs flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-500/80 border border-yellow-600" />
            <span>Chờ xử lý</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-500/80 border border-blue-600" />
            <span>Đang sản xuất</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500/80 border border-green-600" />
            <span>Hoàn thành</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-orange-500/80 border border-orange-600" />
            <span>Tạm dừng</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500/80 border border-red-600" />
            <span>Đã hủy</span>
          </div>
        </div>
      </CardContent>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận thay đổi lịch</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p>
              Bạn có muốn thay đổi lịch cho lệnh <strong>{confirmDialog.order?.orderCode}</strong>?
            </p>
            {confirmDialog.newStartDate && confirmDialog.newEndDate && (
              <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ngày bắt đầu mới:</span>
                  <span className="font-medium">{format(confirmDialog.newStartDate, "dd/MM/yyyy", { locale: vi })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ngày kết thúc mới:</span>
                  <span className="font-medium">{format(confirmDialog.newEndDate, "dd/MM/yyyy", { locale: vi })}</span>
                </div>
                {confirmDialog.newLineId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dây chuyền mới:</span>
                    <span className="font-medium">{getLineName(confirmDialog.newLineId)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null })}
              disabled={isRescheduling}
            >
              Hủy
            </Button>
            <Button onClick={confirmReschedule} disabled={isRescheduling}>
              {isRescheduling ? "Đang xử lý..." : "Xác nhận"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
