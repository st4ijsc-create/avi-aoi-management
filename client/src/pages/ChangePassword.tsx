import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Key, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function ChangePassword() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const changePasswordMutation = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t('auth.changePasswordSuccess'));
      setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setLocation("/profile");
    },
    onError: (error: any) => {
      toast.error(error.message || t('errors.generic'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error(t('auth.newPasswordMismatch'));
      return;
    }
    
    if (formData.newPassword.length < 6) {
      toast.error(t('auth.passwordMinLength'));
      return;
    }
    
    changePasswordMutation.mutate({
      currentPassword: formData.currentPassword,
      newPassword: formData.newPassword,
    });
  };

  // Check if user is local account
  const isLocalAccount = (user as any)?.loginMethod === "local";

  // Password strength indicator
  const getPasswordStrength = (password: string) => {
    if (!password) return { level: 0, text: "", color: "" };
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    if (strength <= 2) return { level: strength, text: t('auth.passwordWeak'), color: "bg-red-500" };
    if (strength <= 3) return { level: strength, text: t('auth.passwordMedium'), color: "bg-yellow-500" };
    return { level: strength, text: t('auth.passwordStrong'), color: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength(formData.newPassword);

  return (
    <DashboardLayout
      title={t('auth.changePassword')}
      currentPath="/change-password"
    >
      <div className="container py-6 max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              {t('auth.changePassword')}
            </CardTitle>
            <CardDescription>
              {t('auth.changePasswordDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isLocalAccount ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <AlertCircle className="h-12 w-12 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold">{t('auth.cannotChangePassword')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('auth.oauthPasswordMessage')}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setLocation("/profile")}>
                  {t('common.back')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">{t('auth.currentPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? "text" : "password"}
                      value={formData.currentPassword}
                      onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">{t('auth.newPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      value={formData.newPassword}
                      onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {formData.newPassword && (
                    <div className="space-y-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded ${
                              i <= passwordStrength.level ? passwordStrength.color : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('auth.passwordStrengthLabel')}: {passwordStrength.text}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t('auth.confirmNewPassword')}</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {formData.confirmPassword && (
                    <div className="flex items-center gap-1 text-xs">
                      {formData.newPassword === formData.confirmPassword ? (
                        <>
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          <span className="text-green-500">{t('auth.passwordMatch')}</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3 w-3 text-red-500" />
                          <span className="text-red-500">{t('auth.passwordMismatch')}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="submit"
                    disabled={changePasswordMutation.isPending}
                    className="flex-1"
                  >
                    {changePasswordMutation.isPending ? t('common.processing') : t('auth.changePassword')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/profile")}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
