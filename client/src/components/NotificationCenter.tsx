import { useMemo, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';
import { useSocket, InspectionAlert } from "@/hooks/useSocket";
import { useEcosystemEvents, type EcosystemEvent } from "@/hooks/useEcosystemEvents";
import { useAuth } from "@/_core/hooks/useAuth";
import { loadNotifPrefs, saveNotifPrefs, filterAlertsByPrefs, type NotificationPrefs } from "@/lib/notificationPrefs";
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
  const { t } = useTranslation();

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

  // U1-c — subscribe to the UNIFIED alert stream so ALL alert classes (safety,
  // andon, SPC, escalation, maintenance, anomaly, quality-gate, …) reach the global
  // notifier — not just inspection:alert. Toast the significant bands; keep a list.
  const seenEcoIds = useRef<Set<string>>(new Set());
  const handleEcoAlert = (evt: EcosystemEvent) => {
    if (seenEcoIds.current.has(evt.id)) return;
    seenEcoIds.current.add(evt.id);
    if (evt.severity === "critical") {
      toast.error(evt.title, { duration: 6000, icon: <XCircle className="h-4 w-4 text-red-500" /> });
    } else if (evt.severity === "high") {
      toast.warning(evt.title, { duration: 5000, icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> });
    }
  };
  const { events: ecoAlerts, clear: clearEcoAlerts, dismiss: dismissEcoAlert } = useEcosystemEvents({
    factoryId,
    workshopId,
    machineId,
    alertsOnly: true,
    onEvent: handleEcoAlert,
  });
  // Skip inspection/ng/yield here — those already arrive via useSocket (avoid dupes).
  const extraEcoAlerts = useMemo(
    () => ecoAlerts.filter((e) => e.kind !== "inspection" && e.kind !== "ng" && e.kind !== "yield"),
    [ecoAlerts],
  );

  // U8 — per-user notification prefs (high-priority-only / snooze). Presentation filter only.
  const { user } = useAuth();
  const userKey = String((user as any)?.id ?? (user as any)?.openId ?? "anon");
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotifPrefs(userKey));
  const updatePrefs = (patch: Partial<NotificationPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveNotifPrefs(userKey, next);
      return next;
    });
  };
  const visibleAlerts = useMemo(() => filterAlertsByPrefs(alerts, prefs), [alerts, prefs]);
  // U8 prefs (high-priority-only / snooze) apply to the ecosystem alerts too.
  const visibleEcoAlerts = useMemo(() => {
    if (prefs.snoozeUntil > Date.now()) return [];
    if (prefs.highPriorityOnly) return extraEcoAlerts.filter((e) => e.severity === "high" || e.severity === "critical");
    return extraEcoAlerts;
  }, [extraEcoAlerts, prefs]);
  const unreadCount = visibleAlerts.length + visibleEcoAlerts.length;
  const clearAll = () => { clearAlerts(); clearEcoAlerts(); };

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
              {t('notifications.title')}
              {isConnected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-500" />
              )}
            </SheetTitle>
            {(alerts.length > 0 || extraEcoAlerts.length > 0) && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                {t('notifications.clearAll')}
              </Button>
            )}
          </div>
          <SheetDescription>
            {isConnected
              ? t('notifications.connectedRealtime')
              : t('notifications.reconnecting')}
          </SheetDescription>
          {/* U8 — quick prefs: high-priority-only + snooze (presentation filter) */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Button
              variant={prefs.highPriorityOnly ? "default" : "outline"}
              size="sm"
              className="h-7"
              onClick={() => updatePrefs({ highPriorityOnly: !prefs.highPriorityOnly })}
            >
              {t('notifications.highPriorityOnly', 'Chỉ ưu tiên cao')}
            </Button>
            <Button
              variant={prefs.snoozeUntil > Date.now() ? "default" : "outline"}
              size="sm"
              className="h-7"
              onClick={() =>
                updatePrefs({ snoozeUntil: prefs.snoozeUntil > Date.now() ? 0 : Date.now() + 60 * 60 * 1000 })
              }
            >
              {prefs.snoozeUntil > Date.now()
                ? t('notifications.snoozed', 'Đang tạm tắt')
                : t('notifications.snooze1h', 'Tạm tắt 1 giờ')}
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-150px)] mt-4">
          {visibleAlerts.length === 0 && visibleEcoAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-12 w-12 mb-2 opacity-20" />
              <p>{t('notifications.noNew')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* U1-c — unified alert-stream items (safety/andon/SPC/escalation/…) */}
              {visibleEcoAlerts.map((evt, index) => (
                <div
                  key={`eco-${evt.id}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="mt-0.5">
                    {evt.severity === "critical" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : evt.severity === "high" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-blue-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={evt.severity === "critical" ? "destructive" : "secondary"}
                        className="text-xs uppercase"
                      >
                        {evt.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatTime(new Date(evt.ts))}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{evt.title}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => dismissEcoAlert(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {visibleAlerts.map((alert, index) => (
                <div
                  key={`${alert.timestamp}-${index}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="mt-0.5">{getAlertIcon(alert.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getAlertBadgeVariant(alert.type) as "default" | "secondary" | "destructive"} className="text-xs">
                        {alert.type === "NG_ALERT"
                          ? t('notifications.ngAlert')
                          : alert.type === "YIELD_WARNING"
                          ? t('notifications.yieldWarning')
                          : t('notifications.notification')}
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
