import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Monitor, 
  Smartphone, 
  Tablet, 
  Globe, 
  MapPin, 
  Clock, 
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  Trash2,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

// Device type icons
const deviceIcons: Record<string, React.ReactNode> = {
  desktop: <Monitor className="h-5 w-5" />,
  mobile: <Smartphone className="h-5 w-5" />,
  tablet: <Tablet className="h-5 w-5" />,
  unknown: <Globe className="h-5 w-5" />,
};

// Browser icons (simplified)
const getBrowserIcon = (browser: string) => {
  const browserLower = browser.toLowerCase();
  if (browserLower.includes("chrome")) return "🌐";
  if (browserLower.includes("firefox")) return "🦊";
  if (browserLower.includes("safari")) return "🧭";
  if (browserLower.includes("edge")) return "🌊";
  if (browserLower.includes("opera")) return "🔴";
  return "🌐";
};

export function SessionManagement() {
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<number | null>(null);

  // Queries
  const { data: sessions, isLoading, refetch } = trpc.session.list.useQuery();
  const { data: sessionCount } = trpc.session.count.useQuery();

  // Mutations
  const revokeMutation = trpc.session.revoke.useMutation({
    onSuccess: () => {
      toast.success("Đã đăng xuất khỏi thiết bị");
      setSessionToRevoke(null);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const revokeAllMutation = trpc.session.revokeAll.useMutation({
    onSuccess: () => {
      toast.success("Đã đăng xuất khỏi tất cả thiết bị khác");
      setShowRevokeAllDialog(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleRevoke = (sessionId: number) => {
    revokeMutation.mutate({ sessionId });
  };

  const handleRevokeAll = () => {
    revokeAllMutation.mutate();
  };

  const formatLastActivity = (date: Date) => {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: vi });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Quản lý phiên đăng nhập
            </CardTitle>
            <CardDescription>
              Xem và quản lý các thiết bị đang đăng nhập vào tài khoản của bạn
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            {sessions && sessions.length > 1 && (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={() => setShowRevokeAllDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Đăng xuất tất cả
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Session count */}
        <div className="flex items-center gap-2 mb-4 p-3 bg-muted/50 rounded-lg">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm">
            {sessionCount?.count || 0} phiên đang hoạt động
          </span>
        </div>

        {/* Sessions list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : sessions && sessions.length > 0 ? (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`p-4 rounded-lg border ${
                    session.isCurrent 
                      ? "border-primary bg-primary/5" 
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {/* Device icon */}
                      <div className={`p-2 rounded-lg ${
                        session.isCurrent ? "bg-primary/10" : "bg-muted"
                      }`}>
                        {deviceIcons[session.deviceType] || deviceIcons.unknown}
                      </div>

                      {/* Device info */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {getBrowserIcon(session.browser)} {session.browser}
                          </span>
                          {session.isCurrent && (
                            <Badge variant="default" className="text-xs">
                              Phiên hiện tại
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {session.os} • {session.deviceName}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {session.location}
                          </span>
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {session.ipAddress}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Hoạt động {formatLastActivity(session.lastActivityAt)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    {!session.isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setSessionToRevoke(session.id)}
                      >
                        <LogOut className="h-4 w-4 mr-1" />
                        Đăng xuất
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Không có phiên đăng nhập nào</p>
          </div>
        )}
      </CardContent>

      {/* Revoke single session dialog */}
      <Dialog open={sessionToRevoke !== null} onOpenChange={() => setSessionToRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đăng xuất khỏi thiết bị</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn đăng xuất khỏi thiết bị này? 
              Thiết bị sẽ cần đăng nhập lại để truy cập tài khoản.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionToRevoke(null)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={() => sessionToRevoke && handleRevoke(sessionToRevoke)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Đăng xuất
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke all sessions dialog */}
      <Dialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đăng xuất tất cả thiết bị</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn đăng xuất khỏi tất cả thiết bị khác? 
              Chỉ phiên hiện tại sẽ được giữ lại.
            </DialogDescription>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Cảnh báo</AlertTitle>
            <AlertDescription>
              Tất cả các thiết bị khác sẽ bị đăng xuất ngay lập tức và cần đăng nhập lại.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevokeAllDialog(false)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokeAll}
              disabled={revokeAllMutation.isPending}
            >
              {revokeAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Đăng xuất tất cả
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default SessionManagement;
