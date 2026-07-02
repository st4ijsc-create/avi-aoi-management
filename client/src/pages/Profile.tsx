import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer } from "@/components/patterns";
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
import { useTranslation } from 'react-i18next';
import { toast } from "sonner";

export default function Profile() {
  const { t } = useTranslation();
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
      toast.success(t('profile.backupCodesGenerated'));
    },
    onError: (error: any) => {
      toast.error(error.message || t('errors.generic'));
    },
  });

  // Mutations
  const updateMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success(t('profile.updateSuccess'));
      setIsEditing(false);
      window.location.reload();
    },
    onError: (error: any) => {
      toast.error(error.message || t('errors.generic'));
    },
  });

  const setup2FAMutation = trpc.user.setup2FA.useMutation({
    onSuccess: (data) => {
      setSetupData(data);
    },
    onError: (error: any) => {
      toast.error(error.message || t('auth.twoFASetupError'));
    },
  });

  const verify2FAMutation = trpc.user.verify2FA.useMutation({
    onSuccess: () => {
      toast.success(t('auth.twoFAVerifySuccess'));
      setShow2FASetup(false);
      setSetupData(null);
      setOtpToken("");
      refetch2FAStatus();
    },
    onError: (error: any) => {
      toast.error(error.message || t('auth.invalidOTP'));
    },
  });

  const disable2FAMutation = trpc.user.disable2FA.useMutation({
    onSuccess: () => {
      toast.success(t('auth.twoFADisableSuccess'));
      setShow2FADisable(false);
      setOtpToken("");
      setDisablePassword("");
      refetch2FAStatus();
    },
    onError: (error: any) => {
      toast.error(error.message || t('errors.generic'));
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
      toast.error(t('auth.enterSixDigitCode'));
      return;
    }
    verify2FAMutation.mutate({ token: otpToken });
  };

  const handleDisable2FA = () => {
    if (otpToken.length !== 6) {
      toast.error(t('auth.enterSixDigitCode'));
      return;
    }
    disable2FAMutation.mutate({ token: otpToken, password: disablePassword || "oauth" });
  };

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
      toast.success(t('profile.secretCopied'));
    }
  };

  return (
    <DashboardLayout
      title={t('profile.title')}
      currentPath="/profile"
    >
      <PageContainer className="max-w-2xl">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {t('profile.title')}
            </CardTitle>
            <CardDescription>
              {t('profile.description')}
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
                <h3 className="text-lg font-semibold">{user?.name || t('profile.notUpdated')}</h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {(user as any)?.role === "admin" ? t('roles.admin') : t('roles.user')}
                </p>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {t('profile.fullName')}
                </Label>
                {isEditing ? (
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{user?.name || t('profile.notUpdated')}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t('profile.email')}
                </Label>
                {isEditing ? (
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{user?.email || t('profile.notUpdated')}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  {t('profile.phone')}
                </Label>
                {isEditing ? (
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.phone || t('profile.notUpdated')}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="department" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  {t('profile.department')}
                </Label>
                {isEditing ? (
                  <Input
                    id="department"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.department || t('profile.notUpdated')}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="position" className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  {t('profile.position')}
                </Label>
                {isEditing ? (
                  <Input
                    id="position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  />
                ) : (
                  <p className="text-sm p-2 bg-muted/30 rounded">{(user as any)?.position || t('profile.notUpdated')}</p>
                )}
              </div>
            </div>

            {/* Read-only Info */}
            <div className="grid gap-4 pt-4 border-t">
              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {t('profile.accountCreatedDate')}
                </Label>
                <p className="text-sm p-2 bg-muted/30 rounded">
                  {(user as any)?.createdAt 
                    ? new Date((user as any).createdAt).toLocaleDateString("vi-VN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : t('profile.unknown')}
                </p>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {t('profile.lastLogin')}
                </Label>
                <p className="text-sm p-2 bg-muted/30 rounded">
                  {(user as any)?.lastSignedIn
                    ? new Date((user as any).lastSignedIn).toLocaleString("vi-VN")
                    : t('profile.unknown')}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4">
              {isEditing ? (
                <>
                  <Button onClick={handleSave} disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
                  </Button>
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setIsEditing(true)}>
                  {t('profile.editInfo')}
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
              {t('auth.twoFactorAuth')}
            </CardTitle>
            <CardDescription>
              {t('auth.twoFactorDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                {twoFAStatus?.enabled ? (
                  <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-success" />
                  </div>
                ) : (
                  <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center">
                    <ShieldOff className="h-5 w-5 text-warning" />
                  </div>
                )}
                <div>
                  <p className="font-medium">
                    {twoFAStatus?.enabled ? t('auth.twoFAEnabled') : t('auth.twoFADisabled')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {twoFAStatus?.enabled 
                      ? t('auth.twoFAEnabledDescription')
                      : t('auth.twoFADisabledDescription')}
                  </p>
                </div>
              </div>
              <Badge variant={twoFAStatus?.enabled ? "default" : "secondary"}>
                {twoFAStatus?.enabled ? t('common.enabled') : t('common.disabled')}
              </Badge>
            </div>

            {twoFAStatus?.enabled ? (
              <Button 
                variant="destructive" 
                onClick={() => setShow2FADisable(true)}
                className="w-full"
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                {t('auth.disableTwoFA')}
              </Button>
            ) : (
              <Button 
                onClick={handleSetup2FA}
                className="w-full"
                disabled={setup2FAMutation.isPending}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {setup2FAMutation.isPending ? t('auth.twoFASettingUp') : t('auth.enableTwoFA')}
              </Button>
            )}

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t('auth.twoFARequirementDescription')}
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
                {t('profile.backupCodes')}
              </CardTitle>
              <CardDescription>
                {t('profile.backupCodesDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-info/10 flex items-center justify-center">
                    <KeyRound className="h-5 w-5 text-info" />
                  </div>
                  <div>
                    <p className="font-medium">{t('profile.backupCodesRemaining')}</p>
                    <p className="text-sm text-muted-foreground">
                      {backupCodesStatus?.unusedCount || 0} {t('profile.codesUnused')}
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
                {generateBackupCodesMutation.isPending ? t('common.generating') : t('profile.generateNewBackupCodes')}
              </Button>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t('profile.backupCodesWarning')}
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
              {t('session.loginSessions')}
            </CardTitle>
            <CardDescription>
              {t('session.manageDeviceSessions')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionManagement />
          </CardContent>
        </Card>
      </PageContainer>

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
              {t('auth.setup2FA')}
            </DialogTitle>
            <DialogDescription>
              {t('auth.scanQRDescription')}
            </DialogDescription>
          </DialogHeader>

          {setupData ? (
            <div className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <img src={setupData.qrCode} alt={t('auth.qrCodeAlt', 'QR Code')} className="w-48 h-48" />
              </div>

              {/* Manual Entry */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  {t('auth.enterSecretManually')}
                </Label>
                <div className="flex gap-2">
                  <Input 
                    value={setupData.secret} 
                    readOnly 
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={copySecret}>
                    {secretCopied ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Verify Token */}
              <div className="space-y-2">
                <Label>{t('auth.enterAuthCode')}</Label>
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
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleVerify2FA}
              disabled={!setupData || otpToken.length !== 6 || verify2FAMutation.isPending}
            >
              {verify2FAMutation.isPending ? t('auth.verifying') : t('auth.confirmAndEnable2FA')}
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
              {t('auth.disableTwoFATitle')}
            </DialogTitle>
            <DialogDescription>
              {t('auth.disableTwoFADescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t('auth.disableTwoFAWarning')}
              </AlertDescription>
            </Alert>

            {(user as any)?.loginMethod === "local" && (
              <div className="space-y-2">
                <Label>{t('auth.currentPassword')}:</Label>
                <Input
                  type="password"
                  placeholder={t('auth.enterPassword')}
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('auth.authCodeFromApp')}:</Label>
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
              {t('common.cancel')}
            </Button>
            <Button 
              variant="destructive"
              onClick={handleDisable2FA}
              disabled={otpToken.length !== 6 || disable2FAMutation.isPending}
            >
              {disable2FAMutation.isPending ? t('common.processing') : t('auth.disableTwoFAButton')}
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
              {t('profile.yourBackupCodes')}
            </DialogTitle>
            <DialogDescription>
              {t('profile.backupCodesSaveMessage')}
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
                <strong>{t('profile.important')}:</strong> {t('profile.backupCodesOnlyOnce')}
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const text = backupCodes.join('\n');
                navigator.clipboard.writeText(text);
                toast.success(t('profile.backupCodesCopied'));
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              {t('common.copy')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const text = `${t('profile.backupCodesFileTitle', 'AVI/AOI Management backup codes')}\n\n${backupCodes.join('\n')}\n\n${t('profile.backupCodesFileGeneratedAt', 'Generated at')}: ${new Date().toLocaleString('vi-VN')}`;
                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'backup-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
                toast.success(t('profile.backupCodesDownloaded'));
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              {t('common.download')}
            </Button>
            <Button onClick={() => setShowBackupCodes(false)}>
              {t('profile.saved')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
