import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer, PageHeader, StatusBadge, EmptyState } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Monitor, 
  Smartphone, 
  Tablet, 
  Globe, 
  Clock, 
  MapPin, 
  LogOut, 
  Shield,
  RefreshCw,
  Trash2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// doc65 PRO-100 — fallback parse UA phía FE khi server chưa nhận diện được browser/os
// (từng hiển thị "Trình duyệt không rõ trên Hệ điều hành không rõ" trong khi chuỗi UA
// ngay bên dưới ghi rõ Windows NT 10.0 / HeadlessChrome).
function parseUaFallback(ua: string | null | undefined): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  let browser: string | null = null;
  let os: string | null = null;
  if (/HeadlessChrome\//.test(ua)) browser = "Chrome (Headless)";
  else if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
  if (/Windows NT 10\./.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}
import { vi } from "date-fns/locale";
import { useTranslation } from 'react-i18next';

export default function SessionManagement() {
  const { t } = useTranslation();
  const [revokeSessionId, setRevokeSessionId] = useState<number | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);

  const { data: sessions, isLoading, refetch } = trpc.user.getSessions.useQuery();
  
  const revokeMutation = trpc.user.revokeSession.useMutation({
    onSuccess: () => {
      toast.success(t('session.logoutSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t('session.logoutError'));
    },
  });

  const revokeAllMutation = trpc.user.revokeAllSessions.useMutation({
    onSuccess: () => {
      toast.success(t('session.logoutAllSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t('session.logoutAllError'));
    },
  });

  const getDeviceIcon = (deviceType?: string | null) => {
    switch (deviceType?.toLowerCase()) {
      case "mobile":
        return <Smartphone className="h-5 w-5" />;
      case "tablet":
        return <Tablet className="h-5 w-5" />;
      default:
        return <Monitor className="h-5 w-5" />;
    }
  };

  const handleRevokeSession = () => {
    if (revokeSessionId) {
      revokeMutation.mutate({ sessionId: revokeSessionId });
      setRevokeSessionId(null);
    }
  };

  const handleRevokeAllSessions = () => {
    // The server resolves the caller's current session from the session cookie
    // and always preserves it, revoking only the OTHER sessions.
    revokeAllMutation.mutate();
    setShowRevokeAllDialog(false);
  };

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header — DS PageHeader (shared pattern); doc65 PRO-100: icon-square đồng nhất liên màn */}
        <PageHeader
          icon={<Monitor className="h-6 w-6" />}
          title={t('session.title')}
          description={t('session.description')}
          actions={
            <>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              {/* doc65 V1 (ISA-101): đỏ filled thường trực = mượn màu alarm; hành động
                  phá hủy dùng outline + màu chữ đỏ, đỏ đậm chỉ ở dialog xác nhận. */}
              {sessions && sessions.length > 1 && (
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowRevokeAllDialog(true)}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('session.logoutAll')}
                </Button>
              )}
            </>
          }
        />

        {/* Security Notice */}
        <Card className="border-info/50 bg-info/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Shield className="h-6 w-6 text-info flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-info">{t('session.accountSecurity')}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t('session.securityNotice')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sessions List */}
        <Card>
          <CardHeader>
            <CardTitle>{t('session.activeSessions')}</CardTitle>
            <CardDescription>
              {sessions?.length || 0} {t('session.sessionsLoggedIn')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sessions && sessions.length > 0 ? (
              <div className="space-y-4">
                {sessions.map((session, index) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-4 p-4 border rounded-lg ${
                      index === 0 ? "border-success/50 bg-success/5" : ""
                    }`}
                  >
                    <div className={`p-2 rounded-full ${
                      index === 0 ? "bg-success/20 text-success" : "bg-muted"
                    }`}>
                      {getDeviceIcon(session.deviceType)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {(() => {
                            // server có thể trả sẵn CHUỖI "không rõ/Unknown" (truthy) → coi như thiếu.
                            const known = (v: string | null | undefined) => (v && !/không rõ|unknown/i.test(v) ? v : null);
                            const ua = parseUaFallback(session.userAgent);
                            const browser = known(session.browser) || ua.browser || t('session.unknownBrowser', 'Trình duyệt không rõ');
                            const os = known(session.os) || ua.os || t('session.unknownOs', 'HĐH không rõ');
                            return `${browser} ${t('session.deviceOn', 'trên')} ${os}`;
                          })()}
                        </span>
                        {index === 0 && (
                          <StatusBadge status={t('session.currentSession')} tone="success" />
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                        {session.deviceName && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {session.deviceName}
                          </span>
                        )}
                        {session.ipAddress && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {/^(::1|127\.0\.0\.1)$/.test(session.ipAddress) ? t('session.localhost', 'Máy cục bộ') : session.ipAddress}
                            {session.location && ` (${session.location})`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t('session.active')} {formatDistanceToNow(new Date(session.lastActivityAt), { 
                            addSuffix: true, 
                            locale: vi 
                          })}
                        </span>
                      </div>
                    </div>

                    {index !== 0 && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setRevokeSessionId(session.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                variant="no-data"
                icon={Monitor}
                title={t('session.noSessions')}
                description={t('session.noSessionsDescription', 'No active login sessions were found for this account.')}
              />
            )}
          </CardContent>
        </Card>

        {/* Revoke Single Session Dialog */}
        <AlertDialog open={!!revokeSessionId} onOpenChange={() => setRevokeSessionId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('session.logoutThisSession')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('session.logoutSessionDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleRevokeSession}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('session.logout')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revoke All Sessions Dialog */}
        <AlertDialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('session.logoutAllOtherSessions')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('session.logoutAllDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleRevokeAllSessions}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('session.logoutAll')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </DashboardLayout>
  );
}
