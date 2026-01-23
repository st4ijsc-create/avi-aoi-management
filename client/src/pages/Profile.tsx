import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { User, Mail, Phone, Building, Briefcase, Shield, Calendar, Clock, ShieldCheck, ShieldOff, QrCode, Copy, CheckCircle2, AlertTriangle, KeyRound, Download, Monitor } from "lucide-react";
import SessionManagement from "@/components/SessionManagement";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function Profile() {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: (user as any)?.phone || "",
    department: (user as any)?.department || "",
    position: (user as any)?.position || "",
  });

  // 2FA States
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [show2FADisable, setShow2FADisable] = useState(false);
  const [otpToken, setOtpToken] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  
  // Backup Codes States
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Queries
  const { data: twoFAStatus, refetch: refetch2FAStatus } = trpc.user.get2FAStatus.useQuery();
  const { data: backupCodesStatus, refetch: refetchBackupCodes } = trpc.user.getBackupCodesStatus.useQuery();
  
  // Backup Codes Mutation
  const generateBackupCodesMutation = trpc.user.generateBackupCodes.useMutation({
    onSuccess: (data) => {
      setBackupCodes(data.codes);
      setShowBackupCodes(true);
      refetchBackupCodes();
      toast.success("Mã dự phòng đã được tạo!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Có lỗi xảy ra");
    },
  });

  // Mutations
  const updateMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật thông tin thành công!");
      setIsEditing(false);
      window.location.reload();
    },
    onError: (error: any) => {
      toast.error(error.message || "Có lỗi xảy ra");
    },
  });

  const setup2FAMutation = trpc.user.setup2FA.useMutation({
    onSuccess: (data) => {
      setSetupData(data);
    },
    onError: (error: any) => {
      toast.error(error.message || "Có lỗi xảy ra khi thiết lập 2FA");
    },
  });

  const verify2FAMutation = trpc.user.verify2FA.useMutation({
    onSuccess: () => {
      toast.success("Đã bật xác thực 2 bước thành công!");
      setShow2FASetup(false);
      setSetupData(null);
      setOtpToken("");
      refetch2FAStatus();
    },
    onError: (error: any) => {
      toast.error(error.message || "Mã xác thực không hợp lệ");
    },
  });

  const disable2FAMutation = trpc.user.disable2FA.useMutation({
    onSuccess: () => {
      toast.success("Đã tắt xác thực 2 bước!");
      setShow2FADisable(false);
      setOtpToken("");
      setDisablePassword("");
      refetch2FAStatus();
    },
    onError: (error: any) => {
      toast.error(error.message || "Có lỗi xảy ra");
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleSetup2FA = () => {
    setShow2FASetup(true);
    setup2FAMutation.mutate();
  };

  const handleVerify2FA = () => {
    if (otpToken.length !== 6) {
      toast.error("Vui lòng nhập mã 6 chữ số");
      return;
    }
    verify2FAMutation.mutate({ token: otpToken });
  };

  const handleDisable2FA = () => {
    if (otpToken.length !== 6) {
      toast.error("Vui lòng nhập mã 6 chữ số");
      return;
    }
    disable2FAMutation.mutate({ token: otpToken, password: disablePassword || "oauth" });
  };

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
      toast.success("Đã sao chép mã bí mật!");
    }
  };

  return (
    <DashboardLayout
      title="Thông tin cá nhân"
      currentPath="/profile"
    >
      <div className="container py-6 max-w-2xl space-y-6">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Thông tin cá nhân
            </CardTitle>
            <CardDescription>
              Xem và cập nhật thông tin tài khoản của bạn
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar & Basic Info */}
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{user?.name || "Chưa cập nhật"}</h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {(user as any)?.role === "admin" ? "Quản trị viên" : "Người dùng"}
                </p>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Họ và tên
                </Label>
                {isEditing ? (
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{user?.name || "Chưa cập nhật"}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                {isEditing ? (
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{user?.email || "Chưa cập nhật"}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Số điện thoại
                </Label>
                {isEditing ? (
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.phone || "Chưa cập nhật"}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="department" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Phòng ban
                </Label>
                {isEditing ? (
                  <Input
                    id="department"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.department || "Chưa cập nhật"}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="position" className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Chức vụ
                </Label>
                {isEditing ? (
                  <Input
                    id="position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.position || "Chưa cập nhật"}</p>
                )}
              </div>
            </div>

            {/* Read-only Info */}
            <div className="grid gap-4 pt-4 border-t">
              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Ngày tạo tài khoản
                </Label>
                <p className="text-sm p-2 bg-muted/30 rounded">
                  {(user as any)?.createdAt 
                    ? new Date((user as any).createdAt).toLocaleDateString("vi-VN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "Không xác định"}
                </p>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Đăng nhập lần cuối
                </Label>
                <p className="text-sm p-2 bg-muted/30 rounded">
                  {(user as any)?.lastSignedIn
                    ? new Date((user as any).lastSignedIn).toLocaleString("vi-VN")
                    : "Không xác định"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4">
              {isEditing ? (
                <>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    Hủy
                  </Button>
                </>
              ) : (
                <Button onClick={() => setIsEditing(true)}>
                  Chỉnh sửa thông tin
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2FA Security Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Xác thực 2 bước (2FA)
            </CardTitle>
            <CardDescription>
              Bảo vệ tài khoản của bạn bằng xác thực 2 bước với ứng dụng Authenticator
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {twoFAStatus?.enabled ? (
                  <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-green-500" />
                  </div>
                ) : (
                  <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                    <ShieldOff className="h-5 w-5 text-orange-500" />
                  </div>
                )}
                <div>
                  <p className="font-medium">
                    {twoFAStatus?.enabled ? "Đã bật xác thực 2 bước" : "Chưa bật xác thực 2 bước"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {twoFAStatus?.enabled 
                      ? "Tài khoản của bạn được bảo vệ bởi xác thực 2 bước"
                      : "Bật xác thực 2 bước để tăng cường bảo mật"}
                  </p>
                </div>
              </div>
              <Badge variant={twoFAStatus?.enabled ? "default" : "secondary"}>
                {twoFAStatus?.enabled ? "Đã bật" : "Chưa bật"}
              </Badge>
            </div>

            {twoFAStatus?.enabled ? (
              <Button 
                variant="destructive" 
                onClick={() => setShow2FADisable(true)}
                className="w-full"
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                Tắt xác thực 2 bước
              </Button>
            ) : (
              <Button 
                onClick={handleSetup2FA}
                className="w-full"
                disabled={setup2FAMutation.isPending}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {setup2FAMutation.isPending ? "Đang thiết lập..." : "Bật xác thực 2 bước"}
              </Button>
            )}

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Xác thực 2 bước yêu cầu bạn nhập mã từ ứng dụng Authenticator (Google Authenticator, Microsoft Authenticator, Authy...) mỗi khi đăng nhập.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Backup Codes Card */}
        {twoFAStatus?.enabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Mã dự phòng
              </CardTitle>
              <CardDescription>
                Mã dự phòng giúp bạn đăng nhập khi mất thiết bị Authenticator
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <KeyRound className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-medium">Mã dự phòng còn lại</p>
                    <p className="text-sm text-muted-foreground">
                      {backupCodesStatus?.unusedCount || 0} mã chưa sử dụng
                    </p>
                  </div>
                </div>
                <Badge variant={backupCodesStatus?.unusedCount && backupCodesStatus.unusedCount > 3 ? "default" : "destructive"}>
                  {backupCodesStatus?.unusedCount || 0}/10
                </Badge>
              </div>

              <Button 
                onClick={() => generateBackupCodesMutation.mutate()}
                className="w-full"
                disabled={generateBackupCodesMutation.isPending}
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {generateBackupCodesMutation.isPending ? "Đang tạo..." : "Tạo mã dự phòng mới"}
              </Button>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Lưu ý: Tạo mã mới sẽ vô hiệu hóa tất cả mã cũ. Hãy lưu mã ở nơi an toàn.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Session Management Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Phiên đăng nhập
            </CardTitle>
            <CardDescription>
              Quản lý các phiên đăng nhập của bạn trên các thiết bị
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionManagement />
          </CardContent>
        </Card>
      </div>

      {/* 2FA Setup Dialog */}
      <Dialog open={show2FASetup} onOpenChange={(open) => {
        setShow2FASetup(open);
        if (!open) {
          setSetupData(null);
          setOtpToken("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Thiết lập xác thực 2 bước
            </DialogTitle>
            <DialogDescription>
              Quét mã QR bằng ứng dụng Authenticator để thiết lập
            </DialogDescription>
          </DialogHeader>

          {setupData ? (
            <div className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <img src={setupData.qrCode} alt="QR Code" className="w-48 h-48" />
              </div>

              {/* Manual Entry */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  Hoặc nhập mã bí mật thủ công:
                </Label>
                <div className="flex gap-2">
                  <Input 
                    value={setupData.secret} 
                    readOnly 
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={copySecret}>
                    {secretCopied ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Verify Token */}
              <div className="space-y-2">
                <Label>Nhập mã xác thực từ ứng dụng:</Label>
                <Input
                  placeholder="000000"
                  value={otpToken}
                  onChange={(e) => setOtpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-2xl tracking-widest font-mono"
                  maxLength={6}
                />
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShow2FASetup(false)}>
              Hủy
            </Button>
            <Button 
              onClick={handleVerify2FA}
              disabled={!setupData || otpToken.length !== 6 || verify2FAMutation.isPending}
            >
              {verify2FAMutation.isPending ? "Đang xác thực..." : "Xác nhận & Bật 2FA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2FA Disable Dialog */}
      <Dialog open={show2FADisable} onOpenChange={(open) => {
        setShow2FADisable(open);
        if (!open) {
          setOtpToken("");
          setDisablePassword("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldOff className="h-5 w-5" />
              Tắt xác thực 2 bước
            </DialogTitle>
            <DialogDescription>
              Để tắt xác thực 2 bước, vui lòng xác nhận danh tính của bạn
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Tắt xác thực 2 bước sẽ làm giảm bảo mật cho tài khoản của bạn. Chỉ thực hiện nếu thực sự cần thiết.
              </AlertDescription>
            </Alert>

            {(user as any)?.loginMethod === "local" && (
              <div className="space-y-2">
                <Label>Mật khẩu hiện tại:</Label>
                <Input
                  type="password"
                  placeholder="Nhập mật khẩu"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Mã xác thực từ ứng dụng:</Label>
              <Input
                placeholder="000000"
                value={otpToken}
                onChange={(e) => setOtpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-2xl tracking-widest font-mono"
                maxLength={6}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShow2FADisable(false)}>
              Hủy
            </Button>
            <Button 
              variant="destructive"
              onClick={handleDisable2FA}
              disabled={otpToken.length !== 6 || disable2FAMutation.isPending}
            >
              {disable2FAMutation.isPending ? "Đang xử lý..." : "Tắt 2FA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backup Codes Dialog */}
      <Dialog open={showBackupCodes} onOpenChange={setShowBackupCodes}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Mã dự phòng của bạn
            </DialogTitle>
            <DialogDescription>
              Lưu các mã này ở nơi an toàn. Mỗi mã chỉ sử dụng được một lần.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
              {backupCodes.map((code, index) => (
                <div key={index} className="p-2 bg-background rounded text-center">
                  {code}
                </div>
              ))}
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Quan trọng:</strong> Đây là lần duy nhất bạn thấy các mã này. Hãy lưu lại ngay!
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const text = backupCodes.join('\n');
                navigator.clipboard.writeText(text);
                toast.success("Đã sao chép mã dự phòng!");
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Sao chép
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const text = `Mã dự phòng AVI/AOI Management\n\n${backupCodes.join('\n')}\n\nTạo lúc: ${new Date().toLocaleString('vi-VN')}`;
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'backup-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Đã tải xuống mã dự phòng!");
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Tải xuống
            </Button>
            <Button onClick={() => setShowBackupCodes(false)}>
              Đã lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
