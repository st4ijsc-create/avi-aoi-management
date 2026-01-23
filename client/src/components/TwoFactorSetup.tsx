import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Shield, 
  ShieldCheck, 
  ShieldOff, 
  QrCode, 
  Key, 
  Copy, 
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TwoFactorSetup() {
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [showBackupCodesDialog, setShowBackupCodesDialog] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regenerateCode, setRegenerateCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showSecret, setShowSecret] = useState(false);

  // Queries
  const { data: status, refetch: refetchStatus } = trpc.twoFactor.getStatus.useQuery();

  // Mutations
  const generateSecretMutation = trpc.twoFactor.generateSecret.useMutation({
    onSuccess: () => {
      toast.success("Đã tạo mã QR. Vui lòng quét bằng ứng dụng xác thực.");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const enableMutation = trpc.twoFactor.enable.useMutation({
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setShowSetupDialog(false);
      setShowBackupCodesDialog(true);
      setVerificationCode("");
      refetchStatus();
      toast.success("Đã bật xác thực 2 yếu tố!");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const disableMutation = trpc.twoFactor.disable.useMutation({
    onSuccess: () => {
      setShowDisableDialog(false);
      setDisableCode("");
      refetchStatus();
      toast.success("Đã tắt xác thực 2 yếu tố");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const regenerateMutation = trpc.twoFactor.regenerateBackupCodes.useMutation({
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setShowRegenerateDialog(false);
      setShowBackupCodesDialog(true);
      setRegenerateCode("");
      refetchStatus();
      toast.success("Đã tạo lại mã dự phòng!");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Handlers
  const handleStartSetup = () => {
    generateSecretMutation.mutate();
    setShowSetupDialog(true);
  };

  const handleEnable = () => {
    if (verificationCode.length !== 6) {
      toast.error("Vui lòng nhập mã 6 số");
      return;
    }
    enableMutation.mutate({ code: verificationCode });
  };

  const handleDisable = () => {
    if (!disableCode) {
      toast.error("Vui lòng nhập mã xác thực hoặc mã dự phòng");
      return;
    }
    disableMutation.mutate({ code: disableCode });
  };

  const handleRegenerate = () => {
    if (regenerateCode.length !== 6) {
      toast.error("Vui lòng nhập mã 6 số từ ứng dụng xác thực");
      return;
    }
    regenerateMutation.mutate({ code: regenerateCode });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Đã sao chép!");
  };

  const downloadBackupCodes = () => {
    const content = `AVI-AOI Management - Mã dự phòng 2FA
=====================================
Ngày tạo: ${new Date().toLocaleString("vi-VN")}

Mã dự phòng (mỗi mã chỉ dùng được 1 lần):
${backupCodes.map((code, i) => `${i + 1}. ${code}`).join("\n")}

⚠️ Lưu ý:
- Lưu trữ các mã này ở nơi an toàn
- Mỗi mã chỉ có thể sử dụng một lần
- Khi hết mã, bạn cần tạo lại từ trang cài đặt
`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avi-aoi-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Đã tải xuống mã dự phòng");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Xác thực 2 yếu tố (2FA)
        </CardTitle>
        <CardDescription>
          Bảo vệ tài khoản với lớp bảo mật bổ sung bằng ứng dụng xác thực
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            {status?.enabled ? (
              <ShieldCheck className="h-8 w-8 text-green-500" />
            ) : (
              <ShieldOff className="h-8 w-8 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">
                {status?.enabled ? "Đã bật 2FA" : "Chưa bật 2FA"}
              </p>
              {status?.enabled && (
                <p className="text-sm text-muted-foreground">
                  Còn {status.backupCodesRemaining} mã dự phòng
                </p>
              )}
            </div>
          </div>
          <Badge variant={status?.enabled ? "default" : "secondary"}>
            {status?.enabled ? "Đang hoạt động" : "Chưa kích hoạt"}
          </Badge>
        </div>

        {/* Actions */}
        {status?.enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setShowRegenerateDialog(true)}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Tạo lại mã dự phòng
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDisableDialog(true)}
            >
              <ShieldOff className="h-4 w-4 mr-2" />
              Tắt 2FA
            </Button>
          </div>
        ) : (
          <Button onClick={handleStartSetup}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            Bật xác thực 2 yếu tố
          </Button>
        )}

        {/* Warning for low backup codes */}
        {status?.enabled && status.backupCodesRemaining <= 3 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Cảnh báo</AlertTitle>
            <AlertDescription>
              Bạn chỉ còn {status.backupCodesRemaining} mã dự phòng. 
              Hãy tạo lại mã mới để đảm bảo bạn có thể khôi phục tài khoản khi cần.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Setup Dialog */}
      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thiết lập xác thực 2 yếu tố</DialogTitle>
            <DialogDescription>
              Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Authy, Microsoft Authenticator)
            </DialogDescription>
          </DialogHeader>

          {generateSecretMutation.isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : generateSecretMutation.data ? (
            <div className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <img
                  src={generateSecretMutation.data.qrCode}
                  alt="QR Code"
                  className="w-48 h-48 rounded-lg border"
                />
              </div>

              {/* Manual entry */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  Hoặc nhập mã thủ công:
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all">
                    {showSecret 
                      ? generateSecretMutation.data.secret 
                      : "••••••••••••••••••••••••••••••••"}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(generateSecretMutation.data!.secret)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Verification */}
              <div className="space-y-2">
                <Label>Nhập mã 6 số từ ứng dụng xác thực</Label>
                <Input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="text-center text-2xl tracking-widest font-mono"
                  maxLength={6}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetupDialog(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleEnable}
              disabled={verificationCode.length !== 6 || enableMutation.isPending}
            >
              {enableMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tắt xác thực 2 yếu tố</DialogTitle>
            <DialogDescription>
              Nhập mã 6 số từ ứng dụng xác thực hoặc mã dự phòng để tắt 2FA
            </DialogDescription>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Cảnh báo</AlertTitle>
            <AlertDescription>
              Tắt 2FA sẽ làm giảm bảo mật tài khoản của bạn. 
              Bạn có chắc chắn muốn tiếp tục?
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Mã xác thực hoặc mã dự phòng</Label>
            <Input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.toUpperCase())}
              placeholder="Nhập mã..."
              className="text-center font-mono"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisableDialog(false)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={!disableCode || disableMutation.isPending}
            >
              {disableMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShieldOff className="h-4 w-4 mr-2" />
              )}
              Tắt 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backup Codes Dialog */}
      <Dialog open={showBackupCodesDialog} onOpenChange={setShowBackupCodesDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Mã dự phòng
            </DialogTitle>
            <DialogDescription>
              Lưu các mã này ở nơi an toàn. Mỗi mã chỉ có thể sử dụng một lần.
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Quan trọng</AlertTitle>
            <AlertDescription>
              Đây là lần duy nhất bạn có thể xem các mã này. 
              Hãy lưu lại ngay bây giờ!
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg">
            {backupCodes.map((code, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-background rounded border"
              >
                <code className="font-mono text-sm">{code}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => copyToClipboard(code)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => copyToClipboard(backupCodes.join("\n"))}
            >
              <Copy className="h-4 w-4 mr-2" />
              Sao chép tất cả
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={downloadBackupCodes}
            >
              <Download className="h-4 w-4 mr-2" />
              Tải xuống
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => setShowBackupCodesDialog(false)}
            >
              Đã lưu xong
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tạo lại mã dự phòng</DialogTitle>
            <DialogDescription>
              Các mã dự phòng cũ sẽ bị vô hiệu hóa. 
              Nhập mã 6 số từ ứng dụng xác thực để xác nhận.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Mã xác thực</Label>
            <Input
              value={regenerateCode}
              onChange={(e) => setRegenerateCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="text-center text-2xl tracking-widest font-mono"
              maxLength={6}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegenerateDialog(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleRegenerate}
              disabled={regenerateCode.length !== 6 || regenerateMutation.isPending}
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Tạo lại
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default TwoFactorSetup;
