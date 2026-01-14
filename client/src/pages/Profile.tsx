import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { User, Mail, Phone, Building, Briefcase, Shield, Calendar, Clock } from "lucide-react";
import { useState } from "react";
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

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  return (
    <DashboardLayout
      title="Thông tin cá nhân"
      currentPath="/profile"
    >
      <div className="container py-6 max-w-2xl">
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
      </div>
    </DashboardLayout>
  );
}
