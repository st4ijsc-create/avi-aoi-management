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
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          title={t('session.title')}
          description={t('session.description')}
          actions={
            <>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              {sessions && sessions.length > 1 && (
                <Button
                  variant="destructive"
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
                          {session.browser || t('session.unknownBrowser', 'Unknown browser')} {t('session.deviceOn', 'on')} {session.os || t('session.unknownOs', 'Unknown OS')}
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
                            {session.ipAddress}
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
