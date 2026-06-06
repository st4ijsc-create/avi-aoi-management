import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    // Note: server preserves a session only if `currentSessionId` is provided.
    // The session list does not yet expose an `isCurrent` flag, so we revoke all.
    revokeAllMutation.mutate({});
    setShowRevokeAllDialog(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('session.title')}</h1>
            <p className="text-muted-foreground">
              {t('session.description')}
            </p>
          </div>
          <div className="flex gap-2">
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
          </div>
        </div>

        {/* Security Notice */}
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Shield className="h-6 w-6 text-blue-500 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-blue-500">{t('session.accountSecurity')}</h3>
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
                  <div key={i} className="animate-pulse flex items-center gap-4 p-4 border rounded-lg">
                    <div className="h-10 w-10 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-1/3" />
                      <div className="h-3 bg-muted rounded w-1/2" />
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
                      index === 0 ? "border-green-500/50 bg-green-500/5" : ""
                    }`}
                  >
                    <div className={`p-2 rounded-full ${
                      index === 0 ? "bg-green-500/20 text-green-500" : "bg-muted"
                    }`}>
                      {getDeviceIcon(session.deviceType)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {session.browser || "Unknown Browser"} trên {session.os || "Unknown OS"}
                        </span>
                        {index === 0 && (
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            {t('session.currentSession')}
                          </Badge>
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
              <div className="text-center py-8 text-muted-foreground">
                <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t('session.noSessions')}</p>
              </div>
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
      </div>
    </DashboardLayout>
  );
}
