import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export function SMTPConfig() {
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const { data: config, isLoading, refetch } = trpc.smtp.getConfig.useQuery();
  const updateConfigMutation = trpc.smtp.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Đã lưu cấu hình SMTP");
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const testConnectionMutation = trpc.smtp.testConnection.useMutation({
    onSuccess: () => {
      toast.success("Kết nối SMTP thành công");
      setIsTestingConnection(false);
    },
    onError: (error) => {
      toast.error(`Kết nối thất bại: ${error.message}`);
      setIsTestingConnection(false);
    },
  });

  const [formData, setFormData] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "AVI/AOI Management System",
  });

  useEffect(() => {
    if (config) {
      setFormData({
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        password: config.password, // Will be '********' from API
        fromEmail: config.fromEmail,
        fromName: config.fromName,
      });
    }
  }, [config]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfigMutation.mutate(formData);
  };

  const handleTestConnection = () => {
    // Validate required fields
    if (!formData.host || !formData.username || !formData.fromEmail) {
      toast.error("Vui lòng điền đầy đủ thông tin SMTP");
      return;
    }
    
    setIsTestingConnection(true);
    // Send current form data for testing
    testConnectionMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cấu hình SMTP</CardTitle>
        <CardDescription>
          Cấu hình máy chủ SMTP để gửi email báo cáo tự động
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="host">SMTP Host *</Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="smtp.gmail.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="port">Port *</Label>
              <Input
                id="port"
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="secure"
              checked={formData.secure}
              onCheckedChange={(checked) => setFormData({ ...formData, secure: checked })}
            />
            <Label htmlFor="secure">
              Sử dụng SSL/TLS (port 465)
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder={config ? "Để trống nếu không đổi" : ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fromEmail">From Email *</Label>
              <Input
                id="fromEmail"
                type="email"
                value={formData.fromEmail}
                onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
                placeholder="noreply@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fromName">From Name *</Label>
              <Input
                id="fromName"
                value={formData.fromName}
                onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button 
              type="submit" 
              disabled={updateConfigMutation.isPending}
            >
              {updateConfigMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                "Lưu cấu hình"
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={isTestingConnection || !formData.host || !formData.username}
              className="bg-muted/50 hover:bg-muted"
            >
              {isTestingConnection ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang kiểm tra...
                </>
              ) : (
                "Kiểm tra kết nối"
              )}
            </Button>
          </div>

          {config && (
            <div className="mt-4 p-3 bg-muted rounded-md text-sm">
              <p className="text-muted-foreground">
                Cấu hình SMTP đã được lưu. Nhấn "Kiểm tra kết nối" để verify.
              </p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
