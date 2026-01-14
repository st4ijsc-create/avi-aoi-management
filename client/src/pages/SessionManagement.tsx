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

export default function SessionManagement() {
  const [revokeSessionId, setRevokeSessionId] = useState<number | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);

  const { data: sessions, isLoading, refetch } = trpc.user.getSessions.useQuery();
  
  const revokeMutation = trpc.user.revokeSession.useMutation({
    onSuccess: () => {
      toast.success("Đã đăng xuất phiên thành công");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể đăng xuất phiên");
    },
  });

  const revokeAllMutation = trpc.user.revokeAllSessions.useMutation({
    onSuccess: () => {
      toast.success("Đã đăng xuất tất cả các phiên khác");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể đăng xuất các phiên");
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
    revokeAllMutation.mutate({ exceptCurrentSession: true });
    setShowRevokeAllDialog(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Quản lý phiên đăng nhập</h1>
            <p className="text-muted-foreground">
              Xem và quản lý các thiết bị đang đăng nhập vào tài khoản của bạn
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            {sessions && sessions.length > 1 && (
              <Button 
                variant="destructive" 
                onClick={() => setShowRevokeAllDialog(true)}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Đăng xuất tất cả
              </Button>
            )}
          </div>
        </div>

        {/* Security Notice */}
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Shield className="h-6 w-6 text-blue-500 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-blue-500">Bảo mật tài khoản</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Nếu bạn thấy phiên đăng nhập không quen thuộc, hãy đăng xuất ngay và đổi mật khẩu. 
                Bật xác thực 2 bước để tăng cường bảo mật.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sessions List */}
        <Card>
          <CardHeader>
            <CardTitle>Các phiên đang hoạt động</CardTitle>
            <CardDescription>
              {sessions?.length || 0} phiên đang đăng nhập
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
                            Phiên hiện tại
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
                          Hoạt động {formatDistanceToNow(new Date(session.lastActivityAt), { 
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
                <p>Không có phiên đăng nhập nào</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revoke Single Session Dialog */}
        <AlertDialog open={!!revokeSessionId} onOpenChange={() => setRevokeSessionId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Đăng xuất phiên này?</AlertDialogTitle>
              <AlertDialogDescription>
                Thiết bị này sẽ bị đăng xuất và cần đăng nhập lại để truy cập tài khoản.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleRevokeSession}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Đăng xuất
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Revoke All Sessions Dialog */}
        <AlertDialog open={showRevokeAllDialog} onOpenChange={setShowRevokeAllDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Đăng xuất tất cả các phiên khác?</AlertDialogTitle>
              <AlertDialogDescription>
                Tất cả các thiết bị khác sẽ bị đăng xuất. Chỉ phiên hiện tại của bạn được giữ lại.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleRevokeAllSessions}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Đăng xuất tất cả
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
