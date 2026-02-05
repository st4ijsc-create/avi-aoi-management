import { useState, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, GripVertical, Undo2, Redo2, AlertTriangle, Gauge, Download, FileSpreadsheet, FileText } from "lucide-react";
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
  dependencies?: number[] | null; // Array of order IDs that this order depends on
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

interface ProductionLine {
  id: number;
  name: string;
  workshopId: number;
  capacityPerHour?: number | null;
  maxConcurrentOrders?: number | null;
}

interface GanttChartProps {
  orders: ProductionOrder[];
  lines: ProductionLine[];
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
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 0.5, 1, 1.5, 2;
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
    hasOverlap?: boolean;
    overlappingOrders?: { orderCode: string }[];
    capacityWarning?: { type: 'concurrent' | 'capacity'; message: string } | null;
  }>({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null, hasOverlap: false, overlappingOrders: [], capacityWarning: null });
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

  // Calculate cell width based on view mode and zoom level
  const cellWidth = useMemo(() => {
    let baseWidth: number;
    switch (viewMode) {
      case "day": baseWidth = 80; break;
      case "week": baseWidth = 40; break;
      case "month": baseWidth = 20; break;
      default: baseWidth = 40;
    }
    return baseWidth * zoomLevel;
  }, [viewMode, zoomLevel]);

  // Zoom functions
  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 2));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleZoomReset = () => {
    setZoomLevel(1);
  };

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

  // Calculate capacity utilization for each line
  const getLineCapacityInfo = useCallback((lineId: number) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return null;

    const lineOrders = ordersByLine[lineId] || [];
    const activeOrders = lineOrders.filter(o => 
      o.status !== 'cancelled' && o.status !== 'completed'
    );

    // Calculate concurrent orders (overlapping schedules)
    const maxConcurrent = line.maxConcurrentOrders || 1;
    let maxOverlap = 0;
    
    activeOrders.forEach(order => {
      const orderStart = order.scheduledStartDate ? new Date(order.scheduledStartDate) : null;
      const orderEnd = order.scheduledEndDate ? new Date(order.scheduledEndDate) : null;
      if (!orderStart || !orderEnd) return;

      const overlapping = activeOrders.filter(o => {
        if (o.id === order.id) return false;
        const oStart = o.scheduledStartDate ? new Date(o.scheduledStartDate) : null;
        const oEnd = o.scheduledEndDate ? new Date(o.scheduledEndDate) : null;
        if (!oStart || !oEnd) return false;
        return orderStart < oEnd && orderEnd > oStart;
      });
      maxOverlap = Math.max(maxOverlap, overlapping.length + 1);
    });

    const concurrentUtilization = maxConcurrent > 0 ? (maxOverlap / maxConcurrent) * 100 : 0;

    // Calculate capacity utilization based on capacityPerHour
    let capacityUtilization = 0;
    if (line.capacityPerHour && line.capacityPerHour > 0) {
      const totalTargetQty = activeOrders.reduce((sum, o) => sum + (o.targetQuantity || 0), 0);
      // Estimate total hours needed
      let totalHoursScheduled = 0;
      activeOrders.forEach(order => {
        const orderStart = order.scheduledStartDate ? new Date(order.scheduledStartDate) : null;
        const orderEnd = order.scheduledEndDate ? new Date(order.scheduledEndDate) : null;
        if (orderStart && orderEnd) {
          totalHoursScheduled += (orderEnd.getTime() - orderStart.getTime()) / (1000 * 60 * 60);
        }
      });
      const maxCapacity = line.capacityPerHour * totalHoursScheduled;
      capacityUtilization = maxCapacity > 0 ? (totalTargetQty / maxCapacity) * 100 : 0;
    }

    // Determine status color
    const utilization = Math.max(concurrentUtilization, capacityUtilization);
    let status: 'low' | 'medium' | 'high' | 'overload' = 'low';
    if (utilization > 100) status = 'overload';
    else if (utilization >= 80) status = 'high';
    else if (utilization >= 50) status = 'medium';

    return {
      activeOrders: activeOrders.length,
      maxConcurrent,
      currentConcurrent: maxOverlap,
      concurrentUtilization,
      capacityPerHour: line.capacityPerHour,
      capacityUtilization,
      status,
      utilization: Math.round(utilization),
    };
  }, [lines, ordersByLine]);

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

    // Check for overlap with other orders on the same line
    const targetLine = targetLineId !== order.lineId ? targetLineId : order.lineId;
    const ordersOnLine = orders.filter(o => 
      o.lineId === targetLine && 
      o.id !== order.id && 
      o.status !== 'cancelled'
    );
    
    const overlappingOrders = ordersOnLine.filter(o => {
      const oStart = o.scheduledStartDate ? new Date(o.scheduledStartDate) : null;
      const oEnd = o.scheduledEndDate ? new Date(o.scheduledEndDate) : null;
      if (!oStart || !oEnd) return false;
      return newStartDate < oEnd && newEndDate > oStart;
    });

    // Check capacity warning
    const lineInfo = lines.find(l => l.id === targetLine);
    let capacityWarning: { type: 'concurrent' | 'capacity'; message: string } | null = null;
    
    if (lineInfo) {
      // Check concurrent orders
      const maxConcurrent = lineInfo.maxConcurrentOrders || 1;
      const concurrentOrders = ordersOnLine.filter(o => {
        if (o.status === 'completed') return false;
        const oStart = o.scheduledStartDate ? new Date(o.scheduledStartDate) : null;
        const oEnd = o.scheduledEndDate ? new Date(o.scheduledEndDate) : null;
        if (!oStart || !oEnd) return false;
        return newStartDate < oEnd && newEndDate > oStart;
      });
      
      if (concurrentOrders.length >= maxConcurrent) {
        capacityWarning = {
          type: 'concurrent',
          message: `Dây chuyền chỉ hỗ trợ tối đa ${maxConcurrent} lệnh cùng lúc. Hiện đã có ${concurrentOrders.length} lệnh trong khoảng thời gian này.`
        };
      }
      
      // Check production capacity
      if (!capacityWarning && lineInfo.capacityPerHour && order.targetQuantity) {
        const durationHours = (newEndDate.getTime() - newStartDate.getTime()) / (1000 * 60 * 60);
        const maxCapacity = lineInfo.capacityPerHour * durationHours;
        
        if (order.targetQuantity > maxCapacity) {
          capacityWarning = {
            type: 'capacity',
            message: `Số lượng ${order.targetQuantity} vượt quá năng lực dây chuyền (${Math.floor(maxCapacity)} sản phẩm trong ${durationHours.toFixed(1)} giờ với ${lineInfo.capacityPerHour} sp/giờ).`
          };
        }
      }
    }

    // Show confirmation dialog with overlap and capacity warning
    setConfirmDialog({
      open: true,
      order,
      newStartDate,
      newEndDate,
      newLineId: targetLineId !== order.lineId ? targetLineId : null,
      hasOverlap: overlappingOrders.length > 0,
      overlappingOrders: overlappingOrders.map(o => ({ orderCode: o.orderCode })),
      capacityWarning,
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
      setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null, hasOverlap: false, overlappingOrders: [], capacityWarning: null });
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

  // Export to Excel (CSV)
  const handleExportExcel = () => {
    const headers = [
      'Mã lệnh',
      'Mã công ty',
      'Dây chuyền',
      'Sản phẩm',
      'Số lượng mục tiêu',
      'Đã hoàn thành',
      'OK',
      'NG',
      'NTF',
      'Trạng thái',
      'Ngày bắt đầu',
      'Ngày kết thúc',
      'Độ ưu tiên',
    ];

    const getLineName = (lineId: number) => lines.find(l => l.id === lineId)?.name || '-';
    const getProductName = (productId: number) => products.find(p => p.id === productId)?.name || '-';
    const getStatusLabel = (status: string) => {
      const map: Record<string, string> = {
        pending: 'Chờ xử lý',
        in_progress: 'Đang sản xuất',
        completed: 'Hoàn thành',
        cancelled: 'Đã hủy',
        paused: 'Tạm dừng',
      };
      return map[status] || status;
    };
    const getPriorityLabel = (priority: number) => {
      const map: Record<number, string> = { 0: 'Bình thường', 1: 'Cao', 2: 'Khẩn cấp' };
      return map[priority] || priority.toString();
    };

    const rows = filteredOrders.map(order => [
      order.orderCode,
      order.companyCode,
      getLineName(order.lineId),
      getProductName(order.productModelId),
      order.targetQuantity,
      order.completedQuantity,
      order.okQuantity,
      order.ngQuantity,
      order.ntfQuantity,
      getStatusLabel(order.status),
      order.scheduledStartDate ? format(new Date(order.scheduledStartDate), 'dd/MM/yyyy') : '-',
      order.scheduledEndDate ? format(new Date(order.scheduledEndDate), 'dd/MM/yyyy') : '-',
      getPriorityLabel(order.priority),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gantt-chart-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Xuất Excel thành công');
  };

  // Export to PDF (HTML print)
  const handleExportPDF = () => {
    const getLineName = (lineId: number) => lines.find(l => l.id === lineId)?.name || '-';
    const getProductName = (productId: number) => products.find(p => p.id === productId)?.name || '-';
    const getStatusLabel = (status: string) => {
      const map: Record<string, string> = {
        pending: 'Chờ xử lý',
        in_progress: 'Đang sản xuất',
        completed: 'Hoàn thành',
        cancelled: 'Đã hủy',
        paused: 'Tạm dừng',
      };
      return map[status] || status;
    };
    const getStatusColor = (status: string) => {
      const map: Record<string, string> = {
        pending: '#6b7280',
        in_progress: '#3b82f6',
        completed: '#10b981',
        cancelled: '#ef4444',
        paused: '#f59e0b',
      };
      return map[status] || '#6b7280';
    };

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gantt Chart - Lịch sản xuất</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; margin-bottom: 10px; }
          .info { text-align: center; color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; font-weight: bold; }
          .status { padding: 2px 8px; border-radius: 4px; color: white; font-size: 11px; }
          .progress-bar { width: 100px; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
          .progress-fill { height: 100%; background: #3b82f6; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <h1>Gantt Chart - Lịch sản xuất</h1>
        <div class="info">
          Xuất ngày: ${format(new Date(), 'dd/MM/yyyy HH:mm')}<br/>
          Khoảng thời gian: ${format(dateRange.start, 'dd/MM/yyyy')} - ${format(dateRange.end, 'dd/MM/yyyy')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Mã lệnh</th>
              <th>Dây chuyền</th>
              <th>Sản phẩm</th>
              <th>Tiến độ</th>
              <th>OK/NG/NTF</th>
              <th>Trạng thái</th>
              <th>Ngày bắt đầu</th>
              <th>Ngày kết thúc</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOrders.map(order => {
              const progress = order.targetQuantity > 0 
                ? Math.round((order.completedQuantity / order.targetQuantity) * 100) 
                : 0;
              return `
                <tr>
                  <td><strong>${order.orderCode}</strong><br/><small style="color:#666">${order.companyCode}</small></td>
                  <td>${getLineName(order.lineId)}</td>
                  <td>${getProductName(order.productModelId)}</td>
                  <td>
                    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
                    <small>${order.completedQuantity}/${order.targetQuantity} (${progress}%)</small>
                  </td>
                  <td>
                    <span style="color:#10b981">${order.okQuantity}</span> / 
                    <span style="color:#ef4444">${order.ngQuantity}</span> / 
                    <span style="color:#f59e0b">${order.ntfQuantity}</span>
                  </td>
                  <td><span class="status" style="background:${getStatusColor(order.status)}">${getStatusLabel(order.status)}</span></td>
                  <td>${order.scheduledStartDate ? format(new Date(order.scheduledStartDate), 'dd/MM/yyyy') : '-'}</td>
                  <td>${order.scheduledEndDate ? format(new Date(order.scheduledEndDate), 'dd/MM/yyyy') : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div style="margin-top: 20px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 20px; cursor: pointer;">In / Lưu PDF</button>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    toast.success('Mở cửa sổ xuất PDF');
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
            
            {/* Zoom Controls */}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={handleZoomOut} disabled={zoomLevel <= 0.5}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2 min-w-12 text-center">{Math.round(zoomLevel * 100)}%</span>
              <Button variant="outline" size="icon" onClick={handleZoomIn} disabled={zoomLevel >= 2}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleZoomReset}>
                Reset
              </Button>
            </div>
            
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

            {/* Export Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Xuất
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportExcel}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Xuất Excel (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPDF}>
                  <FileText className="w-4 h-4 mr-2" />
                  Xuất PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  {dateRange.days.map((day) => (
                    <div
                      key={day.toISOString()}
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
                filteredLines.map(line => {
                  const capacityInfo = getLineCapacityInfo(line.id);
                  const capacityStatusColors = {
                    low: 'bg-green-500',
                    medium: 'bg-yellow-500',
                    high: 'bg-orange-500',
                    overload: 'bg-red-500',
                  };
                  const capacityStatusBg = {
                    low: 'bg-green-500/10 border-green-500/30',
                    medium: 'bg-yellow-500/10 border-yellow-500/30',
                    high: 'bg-orange-500/10 border-orange-500/30',
                    overload: 'bg-red-500/10 border-red-500/30',
                  };
                  return (
                  <div key={line.id} className="flex border-b hover:bg-muted/20">
                    {/* Line name with capacity indicator */}
                    <div className="w-48 min-w-48 p-2 border-r bg-background sticky left-0 z-10">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm flex-1">{line.name}</div>
                        {capacityInfo && (
                          <div 
                            className={`w-2 h-2 rounded-full ${capacityStatusColors[capacityInfo.status]}`}
                            title={`Tải: ${capacityInfo.utilization}%`}
                          />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{ordersByLine[line.id]?.length || 0} lệnh</span>
                        {capacityInfo && capacityInfo.utilization > 0 && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                            capacityInfo.status === 'overload' ? 'text-red-600 ' + capacityStatusBg.overload :
                            capacityInfo.status === 'high' ? 'text-orange-600 ' + capacityStatusBg.high :
                            capacityInfo.status === 'medium' ? 'text-yellow-600 ' + capacityStatusBg.medium :
                            'text-green-600 ' + capacityStatusBg.low
                          }`}>
                            {capacityInfo.utilization > 100 ? (
                              <span className="flex items-center gap-0.5">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                {capacityInfo.utilization}%
                              </span>
                            ) : (
                              `${capacityInfo.utilization}%`
                            )}
                          </span>
                        )}
                      </div>
                      {/* Capacity tooltip on hover */}
                      {capacityInfo && (capacityInfo.maxConcurrent > 1 || capacityInfo.capacityPerHour) && (
                        <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                          {capacityInfo.maxConcurrent > 1 && (
                            <div className="flex items-center gap-1">
                              <Gauge className="w-2.5 h-2.5" />
                              <span>{capacityInfo.currentConcurrent}/{capacityInfo.maxConcurrent} đồng thời</span>
                            </div>
                          )}
                          {capacityInfo.capacityPerHour && (
                            <div className="flex items-center gap-1">
                              <span>{capacityInfo.capacityPerHour} sp/giờ</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Timeline */}
                    <div className="flex-1 overflow-x-auto">
                      <DroppableTimelineRow
                        lineId={line.id}
                        width={dateRange.days.length * cellWidth}
                      >
                        {/* Grid lines */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dateRange.days.map((day) => (
                            <div
                              key={day.toISOString()}
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
                );
                })
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
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null, hasOverlap: false, overlappingOrders: [], capacityWarning: null })}>
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
            
            {/* Overlap Warning */}
            {confirmDialog.hasOverlap && confirmDialog.overlappingOrders && confirmDialog.overlappingOrders.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-yellow-600 font-medium">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>Cảnh báo: Trùng lịch!</span>
                </div>
                <p className="text-sm text-yellow-600/80">
                  Lịch này trùng với {confirmDialog.overlappingOrders.length} lệnh sản xuất khác:
                </p>
                <ul className="text-sm text-yellow-600/80 list-disc list-inside">
                  {confirmDialog.overlappingOrders.map((o, i) => (
                    <li key={i}>{o.orderCode}</li>
                  ))}
                </ul>
                <p className="text-sm text-yellow-600/80 italic">
                  Bạn vẫn có thể tiếp tục nếu chấp nhận lịch trùng.
                </p>
              </div>
            )}

            {/* Capacity Warning */}
            {confirmDialog.capacityWarning && (
              <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-red-600 font-medium">
                  <AlertTriangle className="h-5 w-5" />
                  <span>
                    Cảnh báo: {confirmDialog.capacityWarning.type === 'concurrent' ? 'Vượt số lệnh đồng thời!' : 'Vượt năng lực sản xuất!'}
                  </span>
                </div>
                <p className="text-sm text-red-600/80">
                  {confirmDialog.capacityWarning.message}
                </p>
                <p className="text-sm text-red-600/80 italic">
                  Bạn vẫn có thể tiếp tục nhưng có thể gây quá tải cho dây chuyền.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setConfirmDialog({ open: false, order: null, newStartDate: null, newEndDate: null, newLineId: null, hasOverlap: false, overlappingOrders: [], capacityWarning: null })}
              disabled={isRescheduling}
            >
              Hủy
            </Button>
            <Button 
              onClick={confirmReschedule} 
              disabled={isRescheduling}
              variant={(confirmDialog.hasOverlap || confirmDialog.capacityWarning) ? "destructive" : "default"}
            >
              {isRescheduling 
                ? "Đang xử lý..." 
                : (confirmDialog.hasOverlap || confirmDialog.capacityWarning) 
                  ? "Xác nhận (bỏ qua cảnh báo)" 
                  : "Xác nhận"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
