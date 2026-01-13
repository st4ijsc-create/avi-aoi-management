import { useState } from "react";
import { useSocket, InspectionAlert } from "@/hooks/useSocket";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, X, AlertTriangle, XCircle, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

interface NotificationCenterProps {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
}

export function NotificationCenter({ factoryId, workshopId, machineId }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleAlert = (alert: InspectionAlert) => {
    // Show toast notification for important alerts
    if (alert.type === "NG_ALERT") {
      toast.error(alert.message, {
        duration: 5000,
        icon: <XCircle className="h-4 w-4 text-red-500" />,
      });
    } else if (alert.type === "YIELD_WARNING") {
      toast.warning(alert.message, {
        duration: 5000,
        icon: <TrendingDown className="h-4 w-4 text-amber-500" />,
      });
    }
  };

  const { isConnected, alerts, clearAlerts, dismissAlert } = useSocket({
    factoryId,
    workshopId,
    machineId,
    onAlert: handleAlert,
  });

  const unreadCount = alerts.length;

  const getAlertIcon = (type: InspectionAlert["type"]) => {
    switch (type) {
      case "NG_ALERT":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "YIELD_WARNING":
        return <TrendingDown className="h-4 w-4 text-amber-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-blue-500" />;
    }
  };

  const getAlertBadgeVariant = (type: InspectionAlert["type"]) => {
    switch (type) {
      case "NG_ALERT":
        return "destructive";
      case "YIELD_WARNING":
        return "secondary";
      default:
        return "default";
    }
  };

  const formatTime = (timestamp: Date) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Thông báo
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-500" />
              )}
            </SheetTitle>
            {alerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAlerts}>
                Xóa tất cả
              </Button>
            )}
          </div>
          <SheetDescription>
            {isConnected
              ? "Đang kết nối realtime - nhận thông báo tức thì"
              : "Đang kết nối lại..."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-150px)] mt-4">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-12 w-12 mb-2 opacity-20" />
              <p>Không có thông báo mới</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert, index) => (
                <div
                  key={`${alert.timestamp}-${index}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="mt-0.5">{getAlertIcon(alert.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getAlertBadgeVariant(alert.type) as "default" | "secondary" | "destructive"} className="text-xs">
                        {alert.type === "NG_ALERT"
                          ? "Sản phẩm NG"
                          : alert.type === "YIELD_WARNING"
                          ? "Cảnh báo Yield"
                          : "Thông báo"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(alert.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">{alert.machineName}</p>
                    <p className="text-sm text-muted-foreground">{alert.message}</p>
                    {alert.serialNumber && (
                      <p className="text-xs text-muted-foreground mt-1">
                        SN: {alert.serialNumber}
                      </p>
                    )}
                    {alert.yieldRate !== undefined && (
                      <p className="text-xs text-amber-500 mt-1">
                        Yield Rate: {alert.yieldRate.toFixed(2)}%
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => dismissAlert(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
