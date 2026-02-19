import { useState } from "react";
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      toast.success(t('auth.qrCodeGenerated'));
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
      toast.success(t('auth.twoFactorEnabled'));
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
      toast.success(t('auth.twoFactorDisabled'));
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
      toast.success(t('auth.backupCodesRegenerated'));
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
      toast.error(t('auth.enterSixDigitCode'));
      return;
    }
    enableMutation.mutate({ code: verificationCode });
  };

  const handleDisable = () => {
    if (!disableCode) {
      toast.error(t('auth.enterAuthOrBackupCode'));
      return;
    }
    disableMutation.mutate({ code: disableCode });
  };

  const handleRegenerate = () => {
    if (regenerateCode.length !== 6) {
      toast.error(t('auth.enterSixDigitFromApp'));
      return;
    }
    regenerateMutation.mutate({ code: regenerateCode });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('common.copied'));
  };

  const downloadBackupCodes = () => {
    const content = `AVI-AOI Management - ${t('auth.backupCodes2FA')}
=====================================
${t('auth.createdAt')}: ${new Date().toLocaleString("vi-VN")}

${t('auth.backupCodesOneTime')}:
${backupCodes.map((code, i) => `${i + 1}. ${code}`).join("\n")}

⚠️ ${t('auth.backupCodesNote')}:
- ${t('auth.storeSecurely')}
- ${t('auth.eachCodeOnce')}
- ${t('auth.regenerateWhenEmpty')}
`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avi-aoi-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('auth.backupCodesDownloaded'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t('auth.twoFactorAuth')}
        </CardTitle>
        <CardDescription>
          {t('auth.twoFactorAuthDescription')}
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
                {status?.enabled ? t('auth.twoFactorOn') : t('auth.twoFactorOff')}
              </p>
              {status?.enabled && (
                <p className="text-sm text-muted-foreground">
                  {t('auth.backupCodesRemaining', { count: status.backupCodesRemaining })}
                </p>
              )}
            </div>
          </div>
          <Badge variant={status?.enabled ? "default" : "secondary"}>
            {status?.enabled ? t('auth.active') : t('auth.notActivated')}
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
              {t('auth.regenerateBackupCodes')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDisableDialog(true)}
            >
              <ShieldOff className="h-4 w-4 mr-2" />
              {t('auth.disable2FA')}
            </Button>
          </div>
        ) : (
          <Button onClick={handleStartSetup}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            {t('auth.enable2FA')}
          </Button>
        )}

        {/* Warning for low backup codes */}
        {status?.enabled && status.backupCodesRemaining <= 3 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('common.warning')}</AlertTitle>
            <AlertDescription>
              {t('auth.lowBackupCodesWarning', { count: status.backupCodesRemaining })}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Setup Dialog */}
      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('auth.setup2FA')}</DialogTitle>
            <DialogDescription>
              {t('auth.setup2FADescription')}
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
                  {t('auth.orEnterManually')}:
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
                <Label>{t('auth.enterSixDigitFromApp')}</Label>
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
              {t('common.cancel')}
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
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.disable2FA')}</DialogTitle>
            <DialogDescription>
              {t('auth.disable2FADescription')}
            </DialogDescription>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('common.warning')}</AlertTitle>
            <AlertDescription>
              {t('auth.disable2FAWarning')}
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>{t('auth.authOrBackupCode')}</Label>
            <Input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.toUpperCase())}
              placeholder={t('auth.enterCode')}
              className="text-center font-mono"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisableDialog(false)}>
              {t('common.cancel')}
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
              {t('auth.disable2FA')}
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
              {t('auth.backupCodes')}
            </DialogTitle>
            <DialogDescription>
              {t('auth.backupCodesDescription')}
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('auth.important')}</AlertTitle>
            <AlertDescription>
              {t('auth.backupCodesViewOnce')}
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
              {t('auth.copyAll')}
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={downloadBackupCodes}
            >
              <Download className="h-4 w-4 mr-2" />
              {t('common.download')}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => setShowBackupCodesDialog(false)}
            >
              {t('auth.doneSaving')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.regenerateBackupCodes')}</DialogTitle>
            <DialogDescription>
              {t('auth.regenerateBackupCodesDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>{t('auth.verificationCode')}</Label>
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
              {t('common.cancel')}
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
              {t('auth.regenerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default TwoFactorSetup;
