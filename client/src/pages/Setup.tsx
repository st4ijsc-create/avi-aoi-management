import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { Loader2, Shield } from "lucide-react";

export default function Setup() {
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    confirmPassword: "",
  });

  const { errors, touched, validate, handleBlur, hasError, getFieldError } = useFormValidation({
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
          return "Mật khẩu không khớp";
        }
        return null;
      },
    },
  });

  const setupAdminMutation = trpc.auth.setupAdmin.useMutation({
    onSuccess: () => {
      toast.success("Tạo admin thành công! Đang chuyển đến trang đăng nhập...");
      setTimeout(() => {
        window.location.href = "/api/oauth/login";
      }, 1500);
    },
    onError: (error) => {
      toast.error(error.message || "Có lỗi xảy ra khi tạo admin");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const isValid = validate(form);

    if (!isValid) {
      toast.error("Vui lòng kiểm tra lại thông tin");
      return;
    }

    setupAdminMutation.mutate({
      email: form.email,
      name: form.name,
      password: form.password,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">Cài đặt Admin</CardTitle>
          <CardDescription className="text-center">
            Tạo tài khoản admin đầu tiên cho hệ thống
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <Label htmlFor="name">Tên</Label>
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
              <Label htmlFor="password">Mật khẩu</Label>
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
              <Label htmlFor="confirmPassword">Xác nhận mật khẩu</Label>
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
                  Đang tạo...
                </>
              ) : (
                "Tạo Admin"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
