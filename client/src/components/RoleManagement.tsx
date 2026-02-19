import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Shield, 
  Users, 
  ClipboardCheck, 
  UserCog, 
  Wrench, 
  Eye, 
  User,
  Search,
  Filter
} from "lucide-react";
import { toast } from "sonner";

const roleIcons: Record<string, any> = {
  admin: Shield,
  supervisor: Users,
  quality_inspector: ClipboardCheck,
  operator: UserCog,
  maintenance: Wrench,
  viewer: Eye,
  user: User,
};

const roleColors: Record<string, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  supervisor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  quality_inspector: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  operator: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  maintenance: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  user: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
};

export function RoleManagement() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isChangeRoleDialogOpen, setIsChangeRoleDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState<string>("");

  // Queries
  const { data: users, isLoading: usersLoading, refetch: refetchUsers } = 
    trpc.permissions.listUsersWithPermissions.useQuery();
  
  const { data: roleTypes } = trpc.permissions.listRoleTypes.useQuery();
  
  const { data: roleStats } = trpc.permissions.getRoleStatistics.useQuery();

  // Mutations
  const updateUserRole = trpc.permissions.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success(t('roles.roleUpdated'));
      refetchUsers();
      setIsChangeRoleDialogOpen(false);
      setSelectedUser(null);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const applyRolePermissions = trpc.permissions.applyRolePermissions.useMutation({
    onSuccess: (data) => {
      toast.success(t('roles.roleUpdatedWithPermissions', { count: data.permissionsApplied }));
      refetchUsers();
      setIsChangeRoleDialogOpen(false);
      setSelectedUser(null);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const handleChangeRole = (user: any) => {
    setSelectedUser(user);
    setNewRole(user.role);
    setIsChangeRoleDialogOpen(true);
  };

  const handleConfirmRoleChange = async (applyDefaultPermissions: boolean) => {
    if (!selectedUser) return;

    if (applyDefaultPermissions) {
      await applyRolePermissions.mutateAsync({
        userId: selectedUser.id,
        role: newRole as any,
      });
    } else {
      await updateUserRole.mutateAsync({
        userId: selectedUser.id,
        role: newRole as any,
      });
    }
  };

  // Filter users
  const filteredUsers = users?.filter((user) => {
    const matchesSearch = 
      user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    
    return matchesSearch && matchesRole;
  });

  if (usersLoading) {
    return <div className="flex items-center justify-center h-64">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t('roles.title')}</h2>
        <p className="text-muted-foreground">
          {t('roles.description')}
        </p>
      </div>

      {/* Role Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        {roleTypes?.map((roleType) => {
          const Icon = roleIcons[roleType.value];
          const count = roleStats?.[roleType.value] || 0;
          
          return (
            <Card key={roleType.value}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {roleType.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {roleType.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('roles.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-[200px]">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger>
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder={t('roles.filterByRole')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('roles.allRoles')}</SelectItem>
              {roleTypes?.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('roles.users')} ({filteredUsers?.length || 0})</CardTitle>
          <CardDescription>
            {t('roles.clickToChangeRole')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredUsers?.map((user) => {
              const Icon = roleIcons[user.role];
              const roleType = roleTypes?.find((r) => r.value === user.role);
              
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => handleChangeRole(user)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${roleColors[user.role]}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">{user.name || user.username}</div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                      {user.department && (
                        <div className="text-xs text-muted-foreground">
                          {user.department} {user.position && `• ${user.position}`}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Badge className={roleColors[user.role]} variant="secondary">
                      <Icon className="mr-1 h-3 w-3" />
                      {roleType?.label}
                    </Badge>
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                    <div className="text-sm text-muted-foreground">
                      {user.permissions?.length || 0} {t('roles.permissions')}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {filteredUsers?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                {t('roles.noUsersFound')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Change Role Dialog */}
      <Dialog open={isChangeRoleDialogOpen} onOpenChange={setIsChangeRoleDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('roles.changeUserRole')}</DialogTitle>
            <DialogDescription>
              Update role for: <strong>{selectedUser?.name || selectedUser?.username}</strong>
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('roles.currentRole')}</Label>
              <div>
                <Badge className={roleColors[selectedUser?.role]} variant="secondary">
                  {roleTypes?.find((r) => r.value === selectedUser?.role)?.label}
                </Badge>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="new-role">{t('roles.newRole')}</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="new-role">
                  <SelectValue placeholder={t('roles.selectNewRole')} />
                </SelectTrigger>
                <SelectContent>
                  {roleTypes?.map((role) => {
                    const Icon = roleIcons[role.value];
                    return (
                      <SelectItem key={role.value} value={role.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <div>
                            <div className="font-medium">{role.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {role.description}
                            </div>
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            
            {newRole && newRole !== selectedUser?.role && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium mb-1">⚠️ {t('roles.permissionOptions')}:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>{t('roles.applyDefaultPermissionsLabel')}:</strong> {t('roles.applyDefaultPermissionsDesc')}</li>
                  <li>• <strong>{t('roles.keepExistingPermissionsLabel')}:</strong> {t('roles.keepExistingPermissionsDesc')}</li>
                </ul>
              </div>
            )}
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsChangeRoleDialogOpen(false);
                setSelectedUser(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleConfirmRoleChange(false)}
              disabled={!newRole || newRole === selectedUser?.role || updateUserRole.isPending}
            >
              {updateUserRole.isPending ? t('common.updating') : t('roles.keepPermissions')}
            </Button>
            <Button
              onClick={() => handleConfirmRoleChange(true)}
              disabled={!newRole || newRole === selectedUser?.role || applyRolePermissions.isPending}
            >
              {applyRolePermissions.isPending ? t('common.applying') : t('roles.applyDefaultPermissions')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
