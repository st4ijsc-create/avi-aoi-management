import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { 
  CheckCircle, 
  XCircle, 
  Search, 
  Shield, 
  User, 
  Save, 
  X 
} from "lucide-react";
import { toast } from "sonner";

interface PermissionModule {
  category: string;
  moduleName: string;
  displayName: string;
  description: string;
}

interface UserPermissionState {
  userId: number;
  permissions: Map<string, {
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canExport: boolean;
  }>;
}

export function PermissionsManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [permissionState, setPermissionState] = useState<UserPermissionState | null>(null);

  // Queries
  const { data: usersWithPermissions, isLoading: usersLoading, refetch: refetchUsers } = 
    trpc.permissions.listUsersWithPermissions.useQuery();
  
  const { data: availableModules, isLoading: modulesLoading } = 
    trpc.permissions.getAvailableModules.useQuery();

  // Mutations
  const batchUpdateMutation = trpc.permissions.batchUpdateUserPermissions.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật quyền thành công");
      refetchUsers();
      setEditMode(false);
      setPermissionState(null);
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  // Filter users
  const filteredUsers = useMemo(() => {
    if (!usersWithPermissions) return [];
    if (!searchTerm) return usersWithPermissions;
    
    const search = searchTerm.toLowerCase();
    return usersWithPermissions.filter((user: any) => 
      user.username?.toLowerCase().includes(search) ||
      user.email?.toLowerCase().includes(search)
    );
  }, [usersWithPermissions, searchTerm]);

  // Get selected user
  const selectedUser = useMemo(() => {
    if (!selectedUserId || !usersWithPermissions) return null;
    return usersWithPermissions.find((u: any) => u.id === selectedUserId);
  }, [selectedUserId, usersWithPermissions]);

  // Group modules by category
  const modulesByCategory = useMemo(() => {
    if (!availableModules) return {};
    
    return availableModules.reduce((acc, module) => {
      if (!acc[module.category]) {
        acc[module.category] = [];
      }
      acc[module.category].push(module);
      return acc;
    }, {} as Record<string, PermissionModule[]>);
  }, [availableModules]);

  // Initialize edit mode
  const handleEditUser = (userId: number) => {
    const user = usersWithPermissions?.find((u: any) => u.id === userId);
    if (!user) return;

    // Build permission state from existing permissions
    const permMap = new Map<string, any>();
    user.permissions?.forEach((perm: any) => {
      permMap.set(perm.moduleName, {
        category: perm.category,
        canView: perm.canView,
        canCreate: perm.canCreate,
        canEdit: perm.canEdit,
        canDelete: perm.canDelete,
        canExport: perm.canExport,
      });
    });

    setSelectedUserId(userId);
    setPermissionState({
      userId,
      permissions: permMap,
    });
    setEditMode(true);
  };

  // Update permission in state
  const updatePermission = (moduleName: string, category: string, field: string, value: boolean) => {
    if (!permissionState) return;

    const current = permissionState.permissions.get(moduleName) || {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
    };

    permissionState.permissions.set(moduleName, {
      ...current,
      [field]: value,
    });

    setPermissionState({ ...permissionState });
  };

  // Save permissions
  const handleSave = () => {
    if (!permissionState) return;

    // Convert Map to array format for API
    const permissionsArray = Array.from(permissionState.permissions.entries())
      .map(([moduleName, perms]) => {
        // Get module info
        const module = availableModules?.find(m => m.moduleName === moduleName);
        if (!module) return null;

        // Only include if at least one permission is granted
        if (!perms.canView && !perms.canCreate && !perms.canEdit && !perms.canDelete && !perms.canExport) {
          return null;
        }

        return {
          category: module.category,
          moduleName,
          canView: perms.canView,
          canCreate: perms.canCreate,
          canEdit: perms.canEdit,
          canDelete: perms.canDelete,
          canExport: perms.canExport,
        };
      })
      .filter(Boolean) as any[];

    batchUpdateMutation.mutate({
      userId: permissionState.userId,
      permissions: permissionsArray,
    });
  };

  // Cancel edit
  const handleCancel = () => {
    setEditMode(false);
    setPermissionState(null);
    setSelectedUserId(null);
  };

  if (usersLoading || modulesLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">Đang tải...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Quản lý quyền người dùng
          </CardTitle>
          <CardDescription>
            Phân quyền truy cập các module và chức năng cho từng người dùng
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm người dùng..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant="outline" className="whitespace-nowrap">
              {filteredUsers.length} người dùng
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* User List */}
      <Card>
        <CardHeader>
          <CardTitle>Danh sách người dùng</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Người dùng</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-center">Số quyền</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {user.username}
                    </div>
                  </TableCell>
                  <TableCell>{user.email || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {user.role === 'admin' ? 'Admin' : 'User'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Hoạt động
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Vô hiệu hóa
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{user.permissions?.length || 0}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditUser(user.id)}
                    >
                      <Shield className="h-4 w-4 mr-1" />
                      Phân quyền
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Không tìm thấy người dùng
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Permissions Dialog */}
      <Dialog open={editMode} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Phân quyền - {selectedUser?.username}
            </DialogTitle>
            <DialogDescription>
              Chọn các quyền truy cập cho người dùng này. Mỗi module có thể có các quyền: Xem, Tạo, Sửa, Xóa, Xuất file
            </DialogDescription>
          </DialogHeader>

          {permissionState && (
            <Tabs defaultValue="dashboard" className="w-full">
              <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
                {Object.keys(modulesByCategory).map((category) => (
                  <TabsTrigger key={category} value={category} className="capitalize">
                    {category}
                  </TabsTrigger>
                ))}
              </TabsList>

              {Object.entries(modulesByCategory).map(([category, modules]) => (
                <TabsContent key={category} value={category} className="space-y-4">
                  {modules.map((module) => {
                    const current = permissionState.permissions.get(module.moduleName) || {
                      canView: false,
                      canCreate: false,
                      canEdit: false,
                      canDelete: false,
                      canExport: false,
                    };

                    return (
                      <Card key={module.moduleName}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{module.displayName}</CardTitle>
                          <CardDescription className="text-sm">
                            {module.description}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={current.canView}
                                onCheckedChange={(checked) =>
                                  updatePermission(module.moduleName, module.category, 'canView', checked)
                                }
                              />
                              <Label className="cursor-pointer">Xem</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={current.canCreate}
                                onCheckedChange={(checked) =>
                                  updatePermission(module.moduleName, module.category, 'canCreate', checked)
                                }
                              />
                              <Label className="cursor-pointer">Tạo</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={current.canEdit}
                                onCheckedChange={(checked) =>
                                  updatePermission(module.moduleName, module.category, 'canEdit', checked)
                                }
                              />
                              <Label className="cursor-pointer">Sửa</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={current.canDelete}
                                onCheckedChange={(checked) =>
                                  updatePermission(module.moduleName, module.category, 'canDelete', checked)
                                }
                              />
                              <Label className="cursor-pointer">Xóa</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={current.canExport}
                                onCheckedChange={(checked) =>
                                  updatePermission(module.moduleName, module.category, 'canExport', checked)
                                }
                              />
                              <Label className="cursor-pointer">Xuất</Label>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </TabsContent>
              ))}
            </Tabs>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={batchUpdateMutation.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Hủy
            </Button>
            <Button
              onClick={handleSave}
              disabled={batchUpdateMutation.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {batchUpdateMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
