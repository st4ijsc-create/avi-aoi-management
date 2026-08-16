/**
 * Alert Widget Component
 * Hiển thị tóm tắt cảnh báo MQTT trên Dashboard
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Bell, AlertTriangle, AlertCircle, Info, ChevronRight, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

export function AlertWidget() {
  const { t } = useTranslation();
  const { data, isLoading, refetch } = trpc.mqttClientManagement.getAlertWidgetData.useQuery(
    undefined,
    { refetchInterval: 60000 } // Refresh every minute
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">MQTT Alerts</CardTitle>
          <Bell className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-muted rounded" />
            <div className="h-4 bg-muted rounded w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasAlerts = data && data.total > 0;

  return (
    <Card className={hasAlerts && data.critical > 0 ? "border-red-500/50" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4" />
          MQTT Alerts
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">
            {data?.total || 0}
          </div>
          <div className="flex gap-2">
            {data?.critical ? (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {data.critical}
              </Badge>
            ) : null}
            {data?.warning ? (
              <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-500">
                <AlertTriangle className="h-3 w-3" />
                {data.warning}
              </Badge>
            ) : null}
            {data?.info ? (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Info className="h-3 w-3" />
                {data.info}
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Recent Alerts */}
        {data?.recentAlerts && data.recentAlerts.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground font-medium">{t("alertWidget.canhBaoGanDay", "Cảnh báo gần đây")}</div>
            {data.recentAlerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {alert.severity === "critical" && (
                    <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                  )}
                  {alert.severity === "warning" && (
                    <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                  )}
                  {alert.severity === "info" && (
                    <Info className="h-3 w-3 text-blue-500 flex-shrink-0" />
                  )}
                  <span className="truncate">{alert.title}</span>
                </div>
                <span className="text-muted-foreground flex-shrink-0 ml-2">
                  {formatDistanceToNow(new Date(alert.triggeredAt), { 
                    addSuffix: true, 
                    locale: vi 
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-4">
            Không có cảnh báo nào
          </div>
        )}

        {/* View All Link */}
        <Link href="/mqtt-profiles?tab=alerts">
          <Button variant="outline" size="sm" className="w-full">
            Xem tất cả
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Compact Alert Widget for smaller spaces
 */
export function AlertWidgetCompact() {
  const { data, isLoading } = trpc.mqttClientManagement.getAlertWidgetData.useQuery(
    undefined,
    { refetchInterval: 60000 }
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Bell className="h-4 w-4 text-muted-foreground animate-pulse" />
        <span className="text-muted-foreground">...</span>
      </div>
    );
  }

  const hasAlerts = data && data.total > 0;

  return (
    <Link href="/mqtt-profiles?tab=alerts">
      <div className={`flex items-center gap-2 text-sm cursor-pointer hover:opacity-80 ${
        hasAlerts && data.critical > 0 ? "text-red-500" : ""
      }`}>
        <Bell className={`h-4 w-4 ${hasAlerts && data.critical > 0 ? "animate-pulse" : ""}`} />
        {hasAlerts ? (
          <div className="flex items-center gap-1">
            <span className="font-medium">{data.total}</span>
            {data.critical > 0 && (
              <Badge variant="destructive" className="h-5 px-1 text-xs">
                {data.critical}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </div>
    </Link>
  );
}

export default AlertWidget;
