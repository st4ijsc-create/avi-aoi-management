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
import { Bell, X, AlertTriangle, XCircle, TrendingDown, Wifi, WifiOff, Inbox, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { safeInternalPath } from "@shared/internalPath";

/**
 * doc 81 Đợt 3b Task 3 — hộp thư của CHÍNH người dùng (bảng `notifications`, router `notification.*` sẵn có; server
 * lọc theo `ctx.user.id`). Client không join phòng socket `user:{id}` (không phát `auth:user`) và router giao việc
 * ghi thẳng vào bảng không qua socket ⇒ POLL, chỉ khi tab hiển thị. GỘP với cảnh báo socket cũ, không thay.
 */
const INBOX_POLL_MS = 30_000;
const INBOX_LIMIT = 20;

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
  // doc 81 Đợt 3b Task 3 — hộp thư server (của chính mình). Không chịu bộ lọc U8 (đó là bộ lọc NHIỄU cảnh báo);
  // đây là việc được giao cho riêng người này, lưu bền trong bảng.
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const signedIn = !!(user as { id?: number } | null)?.id;
  const unreadPoll = usePollingInterval(signedIn ? INBOX_POLL_MS : false);
  const listPoll = usePollingInterval(signedIn && isOpen ? INBOX_POLL_MS : false);
  const inboxUnreadQ = trpc.notification.unreadCount.useQuery(undefined, { ...unreadPoll, enabled: signedIn });
  const inboxQ = trpc.notification.list.useQuery({ limit: INBOX_LIMIT }, { ...listPoll, staleTime: 0, enabled: signedIn && isOpen });
  const refreshInbox = () => {
    void utils.notification.list.invalidate();
    void utils.notification.unreadCount.invalidate();
  };
  const markRead = trpc.notification.markAsRead.useMutation({ onSettled: refreshInbox });
  const markAllRead = trpc.notification.markAllAsRead.useMutation({ onSettled: refreshInbox });
  const inbox = inboxQ.data ?? [];
  const inboxUnread = Number(inboxUnreadQ.data ?? 0) || 0;
  const openInboxItem = (n: { id: number; isRead: boolean; actionUrl: string | null }) => {
    if (!n.isRead) markRead.mutate({ id: n.id });
    // Kiểm LẠI ở client (server đã trả null cho URL lạ): chỉ đường nội bộ tương đối mới được đi theo.
    const href = safeInternalPath(n.actionUrl);
    if (!href) return;
    setIsOpen(false);
    setLocation(href);
  };

  const unreadCount = visibleAlerts.length + visibleEcoAlerts.length + inboxUnread;
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
        <Button variant="ghost" size="icon" className="relative" aria-label={t('notifications.title')}>
          <Bell className="h-5 w-5" aria-hidden="true" />
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
          {/* doc 81 Đợt 3b Task 3 — hộp thư của chính người dùng (bảng notifications), TRÊN các cảnh báo cũ. */}
          {(inbox.length > 0 || inboxQ.isError) && (
            <section data-testid="notif-inbox" aria-label={t('notifications.inbox.title')} className="mb-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  {t('notifications.inbox.title')}
                  {inboxUnread > 0 && (
                    <Badge variant="secondary" className="text-xs" title={t('notifications.inbox.unread')}>
                      {inboxUnread}
                    </Badge>
                  )}
                </h3>
                {inboxUnread > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={markAllRead.isPending}
                    onClick={() => markAllRead.mutate()}
                  >
                    {t('notifications.inbox.markAllRead')}
                  </Button>
                )}
              </div>
              {inboxQ.isError && (
                <p className="text-xs text-destructive">{t('notifications.inbox.loadFailed')}</p>
              )}
              <ul className="space-y-2">
                {inbox.map((n) => {
                  const blocked = n.actionUrl != null && safeInternalPath(n.actionUrl) == null;
                  return (
                    <li key={`inbox-${n.id}`}>
                      <button
                        type="button"
                        data-testid="notif-inbox-item"
                        data-unread={n.isRead ? "false" : "true"}
                        onClick={() => openInboxItem(n)}
                        className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted ${n.isRead ? "bg-muted/30" : "bg-primary/5"}`}
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? "bg-transparent" : "bg-primary"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${n.isRead ? "" : "font-medium"}`}>{n.title}</span>
                          <span className="block text-sm text-muted-foreground line-clamp-2">{n.message}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                          {blocked && (
                            <span className="mt-1 flex items-center gap-1 text-xs text-destructive">
                              <Link2Off className="h-3 w-3" aria-hidden="true" />
                              {t('notifications.inbox.linkBlocked')}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {visibleAlerts.length === 0 && visibleEcoAlerts.length === 0 ? (
            inbox.length > 0 || inboxQ.isError ? null : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-12 w-12 mb-2 opacity-20" />
              <p>{t('notifications.noNew')}</p>
            </div>
            )
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
