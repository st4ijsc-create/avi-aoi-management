import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, LogIn, ExternalLink, Factory, Shield } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Login() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });

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

  const handleOAuthLogin = () => {
    window.location.href = getLoginUrl();
  };

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
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="local" className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Nội bộ
                </TabsTrigger>
                <TabsTrigger value="oauth" className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Manus
                </TabsTrigger>
              </TabsList>

              <TabsContent value="local">
                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Tên đăng nhập</Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Nhập tên đăng nhập"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      disabled={isLoading}
                      className="bg-slate-700 border-slate-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Mật khẩu</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Nhập mật khẩu"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      disabled={isLoading}
                      className="bg-slate-700 border-slate-600"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-teal-600 hover:bg-teal-700"
                    disabled={isLoading}
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
                <p className="text-xs text-slate-500 text-center mt-4">
                  Tài khoản nội bộ được quản lý bởi Admin hệ thống
                </p>
              </TabsContent>

              <TabsContent value="oauth">
                <div className="space-y-4">
                  <p className="text-sm text-slate-400 text-center">
                    Đăng nhập bằng tài khoản Manus của bạn để truy cập hệ thống
                  </p>
                  <Button 
                    onClick={handleOAuthLogin}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Đăng nhập với Manus
                  </Button>
                  <p className="text-xs text-slate-500 text-center">
                    Sử dụng cho tài khoản đã đăng ký qua Manus OAuth
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-slate-500 text-sm mt-6">
          © 2024 AVI/AOI Factory Management System
        </p>
      </div>
    </div>
  );
}
