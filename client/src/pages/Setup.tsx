import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { useTranslation } from 'react-i18next';
import { Loader2, Shield } from "lucide-react";
import { BRAND } from "@/config/brand";

export default function Setup() {
  const { t } = useTranslation();
  const BrandMark = BRAND.logoIcon;
  const [form, setForm] = useState({
    username: "",
    email: "",
    name: "",
    password: "",
    confirmPassword: "",
  });

  const { errors, touched, validate, handleBlur, hasError, getFieldError } = useFormValidation({
    username: {
      required: true,
      minLength: 3,
      maxLength: 50,
    },
    email: {
      required: true,
      pattern: ValidationPatterns.email,
    },
    name: {
      required: true,
      minLength: 2,
    },
    password: {
      required: true,
      minLength: 8,
    },
    confirmPassword: {
      required: true,
      custom: (value: string) => {
        if (value !== form.password) {
          return t('auth.passwordMismatch');
        }
        return null;
      },
    },
  });

  const setupAdminMutation = trpc.auth.setupAdmin.useMutation({
    onSuccess: () => {
      toast.success(t('setup.adminCreatedSuccess'));
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    },
    onError: (error) => {
      toast.error(error.message || t('setup.adminCreatedError'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const isValid = validate(form);

    if (!isValid) {
      toast.error(t('setup.pleaseCheckInfo'));
      return;
    }

    setupAdminMutation.mutate({
      username: form.username,
      email: form.email,
      name: form.name,
      password: form.password,
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* Continuum identity — first-run value line */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <BrandMark className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{BRAND.name}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {t(BRAND.taglineKey, BRAND.tagline)}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {t("setup.welcomeValue", "Let's get your operations platform started — create the first administrator to begin.")}
        </p>
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">{t('setup.adminSetup')}</CardTitle>
          <CardDescription className="text-center">
            {t('setup.createFirstAdmin')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.username')}</Label>
              <Input
                id="username"
                type="text"
                placeholder="admin"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                onBlur={(e) => handleBlur("username", e.target.value)}
                className={hasError("username") ? "border-red-500" : ""}
              />
              {hasError("username") && (
                <p className="text-sm text-red-500">{getFieldError("username")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={(e) => handleBlur("email", e.target.value)}
                className={hasError("email") ? "border-red-500" : ""}
              />
              {hasError("email") && (
                <p className="text-sm text-red-500">{getFieldError("email")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">{t('profile.name')}</Label>
              <Input
                id="name"
                type="text"
                placeholder="Nguyễn Văn A"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={(e) => handleBlur("name", e.target.value)}
                className={hasError("name") ? "border-red-500" : ""}
              />
              {hasError("name") && (
                <p className="text-sm text-red-500">{getFieldError("name")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onBlur={(e) => handleBlur("password", e.target.value)}
                className={hasError("password") ? "border-red-500" : ""}
              />
              {hasError("password") && (
                <p className="text-sm text-red-500">{getFieldError("password")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                onBlur={(e) => handleBlur("confirmPassword", e.target.value)}
                className={hasError("confirmPassword") ? "border-red-500" : ""}
              />
              {hasError("confirmPassword") && (
                <p className="text-sm text-red-500">{getFieldError("confirmPassword")}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={setupAdminMutation.isPending}
            >
              {setupAdminMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('setup.creating')}
                </>
              ) : (
                t('setup.createAdmin')
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
