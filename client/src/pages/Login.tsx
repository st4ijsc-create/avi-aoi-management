import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, LogIn, ExternalLink, Factory, Shield, ShieldCheck, ArrowLeft } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Login() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  
  // 2FA States
  const [requires2FA, setRequires2FA] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [otpToken, setOtpToken] = useState("");

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.username || !formData.password) {
      toast.error("Vui lòng nhập tên đăng nhập và mật khẩu");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Đăng nhập thất bại");
        return;
      }

      // Check if 2FA is required
      if (data.requires2FA) {
        setRequires2FA(true);
        setUserId(data.userId);
        toast.info("Vui lòng nhập mã xác thực 2 bước");
        return;
      }

      toast.success("Đăng nhập thành công");
      // Reload to update auth state
      window.location.href = "/";
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Đăng nhập thất bại. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  const handle2FAVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!otpToken || otpToken.length !== 6) {
      toast.error("Vui lòng nhập mã 6 chữ số");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/verify-2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, token: otpToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Xác thực thất bại");
        return;
      }

      toast.success("Đăng nhập thành công");
      window.location.href = "/";
    } catch (error) {
      console.error("2FA verification error:", error);
      toast.error("Xác thực thất bại. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setRequires2FA(false);
    setUserId(null);
    setOtpToken("");
  };

  const handleOAuthLogin = () => {
    window.location.href = getLoginUrl();
  };

  // 2FA Verification Screen
  if (requires2FA) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 mb-4">
              <ShieldCheck className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Xác thực 2 bước</h1>
            <p className="text-slate-400 mt-2">Nhập mã từ ứng dụng Authenticator</p>
          </div>

          <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
            <CardHeader className="text-center">
              <CardTitle className="text-white flex items-center justify-center gap-2">
                <Shield className="h-5 w-5 text-teal-400" />
                Xác thực bảo mật
              </CardTitle>
              <CardDescription>
                Mở ứng dụng Authenticator và nhập mã 6 chữ số
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handle2FAVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-slate-300">Mã xác thực</Label>
                  <Input
                    id="otp"
                    placeholder="000000"
                    value={otpToken}
                    onChange={(e) => setOtpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="bg-slate-700/50 border-slate-600 text-white text-center text-2xl tracking-widest font-mono"
                    maxLength={6}
                    autoFocus
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Quay lại
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || otpToken.length !== 6}
                    className="flex-1 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Đang xác thực...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        Xác nhận
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 mb-4">
            <Factory className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            <span className="text-teal-400">AVI</span>/AOI Management
          </h1>
          <p className="text-slate-400 mt-2">Hệ thống quản lý chất lượng sản xuất</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-white">Đăng nhập</CardTitle>
            <CardDescription>
              Chọn phương thức đăng nhập phù hợp
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="local" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-slate-700/50">
                <TabsTrigger value="local" className="data-[state=active]:bg-teal-600">
                  <Shield className="h-4 w-4 mr-2" />
                  Nội bộ
                </TabsTrigger>
                <TabsTrigger value="oauth" className="data-[state=active]:bg-teal-600">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Manus OAuth
                </TabsTrigger>
              </TabsList>

              <TabsContent value="local" className="mt-4">
                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-slate-300">Tên đăng nhập</Label>
                    <Input
                      id="username"
                      placeholder="Nhập tên đăng nhập"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-slate-300">Mật khẩu</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Nhập mật khẩu"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Đang đăng nhập...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4 mr-2" />
                        Đăng nhập
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="oauth" className="mt-4">
                <div className="text-center space-y-4">
                  <p className="text-slate-400 text-sm">
                    Đăng nhập bằng tài khoản Manus của bạn
                  </p>
                  <Button
                    onClick={handleOAuthLogin}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Đăng nhập với Manus
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          © 2024 AVI/AOI Management System
        </p>
      </div>
    </div>
  );
}
