import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar } from "lucide-react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";

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
}

interface GanttChartProps {
  orders: ProductionOrder[];
  lines: { id: number; name: string; workshopId: number }[];
  workshops: { id: number; name: string; factoryId: number }[];
  factories: { id: number; name: string }[];
  products: { id: number; name: string }[];
  onOrderClick?: (order: ProductionOrder) => void;
}

type ViewMode = "day" | "week" | "month";

export default function GanttChart({
  orders,
  lines,
  workshops,
  factories,
  products,
  onOrderClick,
}: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedLineId, setSelectedLineId] = useState<string>("all");
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

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
  const getOrderStyle = (order: ProductionOrder) => {
    // Estimate order duration based on target quantity (1 day per 100 items)
    const estimatedDays = Math.max(1, Math.ceil(order.targetQuantity / 100));
    const orderStart = new Date(order.createdAt);
    const orderEnd = addDays(orderStart, estimatedDays);
    
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
  };

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

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Gantt Chart - Tiến độ sản xuất
          </CardTitle>
          <div className="flex items-center gap-2">
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
      </CardHeader>
      <CardContent>
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
                    <div 
                      className="relative h-16"
                      style={{ width: `${dateRange.days.length * cellWidth}px` }}
                    >
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex">
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
                          <div
                            key={order.id}
                            className={`absolute h-10 rounded border cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg ${style.className}`}
                            style={{
                              left: style.left,
                              width: style.width,
                              top: `${4 + (orderIndex % 2) * 24}px`,
                            }}
                            onClick={() => onOrderClick?.(order)}
                            title={`${order.orderCode} - ${getProductName(order.productModelId)} (${getProgress(order)}%)`}
                          >
                            <div className="px-2 py-1 text-white text-xs truncate">
                              <div className="font-medium truncate">{order.orderCode}</div>
                              <div className="flex items-center gap-1 text-[10px] opacity-90">
                                <span>{getProgress(order)}%</span>
                                <span>•</span>
                                <span>{order.completedQuantity}/{order.targetQuantity}</span>
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
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-sm">
          <span className="text-muted-foreground">Trạng thái:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-500" />
            <span>Chờ xử lý</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span>Đang sản xuất</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span>Hoàn thành</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-orange-500" />
            <span>Tạm dừng</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>Đã hủy</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
