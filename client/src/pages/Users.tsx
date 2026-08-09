import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { mapTrpcError } from "@/lib/trpcErrors";
// ★★★ Pha 7 / vá NHÀ TÙ I-4 — chủ DUY NHẤT của "tài khoản xác thực nội bộ".
// ⚠ Nút này phải khớp `user.updatePassword`: vị từ cũ giấu ĐÚNG nút mà admin cần để gỡ nhà tù hộ
//   4 tài khoản `loginMethod = 'password'`.
import { laXacThucNoiBo } from "@shared/xacThucNoiBo";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, PageContainer, MetricCard } from "@/components/patterns";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Users as UsersIcon,
  Shield,
  User,
  Search,
  Pencil,
  Trash2,
  Plus,
  Key,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Calendar,
  Clock,
  Loader2,
  UserCheck,
  UserX,
  RefreshCw
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type UserType = {
  id: number;
  openId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export default function Users() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const canView = hasPermission("admin_users", "canView");
  // Same gate the single-row edit action uses; drives the bulk bar + selection UI.
  const canEdit = hasPermission("admin_users", "canEdit");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    name: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    role: "user" as "user" | "admin",
  });
  
  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    role: "user" as "user" | "admin",
    isActive: true,
  });
  
  // Password dialog
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  
  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserType | null>(null);

  // Bulk multi-select (mirrors ThresholdApprovalsPage): a Set of user ids picked
  // from the current filtered view, plus a role to apply and a pending confirm.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRole, setBulkRole] = useState<"user" | "admin">("user");
  const [bulkConfirm, setBulkConfirm] = useState<"activate" | "deactivate" | "setRole" | null>(null);
  const [isBulkRunning, setIsBulkRunning] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: users, refetch: refetchUsers, isLoading } = trpc.user.list.useQuery();

  const createMutation = trpc.user.create.useMutation({
    onSuccess: () => {
      toast.success(t('users.createSuccess'));
      setCreateDialogOpen(false);
      resetCreateForm();
      refetchUsers();
    },
    onError: (error) => {
      toast.error(t('users.createError'), { description: mapTrpcError(error) });
    },
  });

  const updateMutation = trpc.user.update.useMutation({
    onSuccess: () => {
      toast.success(t('users.updateSuccess'));
      setEditDialogOpen(false);
      setEditingUser(null);
      refetchUsers();
    },
    onError: (error) => {
      toast.error(t('users.updateError'), { description: mapTrpcError(error) });
    },
  });

  const updatePasswordMutation = trpc.user.updatePassword.useMutation({
    onSuccess: () => {
      toast.success(t('users.passwordChangeSuccess'));
      setPasswordDialogOpen(false);
      setPasswordForm({ newPassword: "", confirmPassword: "" });
    },
    onError: (error) => {
      toast.error(mapTrpcError(error));
    },
  });

  const deleteMutation = trpc.user.delete.useMutation({
    onSuccess: () => {
      toast.success(t('users.deleteSuccess'));
      setDeleteDialogOpen(false);
      setUserToDelete(null);
      refetchUsers();
    },
    onError: (error) => {
      toast.error(t('users.deleteError'), { description: mapTrpcError(error) });
    },
  });

  // Bulk hooks reuse the SAME endpoints as the single-row actions (user.update /
  // user.updateRole) but without onSuccess/onError so looping them doesn't emit
  // one toast per id — we tally results ourselves and toast a single summary.
  const bulkUpdateMutation = trpc.user.update.useMutation();
  const bulkUpdateRoleMutation = trpc.user.updateRole.useMutation();

  const resetCreateForm = () => {
    setCreateForm({
      username: "",
      password: "",
      confirmPassword: "",
      name: "",
      email: "",
      phone: "",
      department: "",
      position: "",
      role: "user",
    });
  };

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password || !createForm.name) {
      toast.error(t('users.fillRequired'));
      return;
    }
    if (createForm.password !== createForm.confirmPassword) {
      toast.error(t('users.passwordMismatch'));
      return;
    }
    if (createForm.password.length < 6) {
      toast.error(t('users.passwordMinLength'));
      return;
    }

    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        username: createForm.username,
        password: createForm.password,
        name: createForm.name,
        email: createForm.email || undefined,
        phone: createForm.phone || undefined,
        department: createForm.department || undefined,
        position: createForm.position || undefined,
        role: createForm.role,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (user: UserType) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      department: user.department || "",
      position: user.position || "",
      role: user.role,
      isActive: user.isActive,
    });
    setEditDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingUser) return;

    setIsSubmitting(true);
    try {
      await updateMutation.mutateAsync({
        id: editingUser.id,
        name: editForm.name || undefined,
        email: editForm.email || null,
        phone: editForm.phone || null,
        department: editForm.department || null,
        position: editForm.position || null,
        role: editForm.role,
        isActive: editForm.isActive,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePassword = (user: UserType) => {
    setEditingUser(user);
    setPasswordForm({ newPassword: "", confirmPassword: "" });
    setPasswordDialogOpen(true);
  };

  const handleUpdatePassword = async () => {
    if (!editingUser) return;
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error(t('users.passwordMismatch'));
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error(t('users.passwordMinLength'));
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePasswordMutation.mutateAsync({
        id: editingUser.id,
        newPassword: passwordForm.newPassword,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (user: UserType) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    await deleteMutation.mutateAsync({ userId: userToDelete.id });
  };

  // Filter users
  const filteredUsers = users?.filter((user: any) => {
    const matchesSearch = 
      (user.name?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (user.username?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (user.email?.toLowerCase() || "").includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "active" && user.isActive) ||
      (statusFilter === "inactive" && !user.isActive);
    return matchesSearch && matchesRole && matchesStatus;
  }) || [];

  // ---- Bulk selection over the CURRENT filtered view ----
  const filteredUserIds: number[] = filteredUsers.map((u: { id: number }) => u.id);
  const allSelected = filteredUserIds.length > 0 && filteredUserIds.every((id) => selected.has(id));
  const someSelected = filteredUserIds.some((id) => selected.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false;
  const selectedCount = filteredUserIds.filter((id) => selected.has(id)).length;

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(filteredUserIds) : new Set());
  const toggleOne = (id: number, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // Run a bulk action by calling the existing single mutation per selected id.
  // Deactivate + role-change skip the current admin's own id (server rejects it
  // too); activate is harmless on self so it's kept. We tally ok/failed/skipped.
  const runBulk = async (action: "activate" | "deactivate" | "setRole") => {
    const ids = filteredUserIds.filter((id) => selected.has(id));
    const skipSelf = action !== "activate";
    const targetIds = skipSelf ? ids.filter((id) => id !== currentUser?.id) : ids;
    const skippedSelf = ids.length - targetIds.length;

    setIsBulkRunning(true);
    try {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          try {
            if (action === "setRole") {
              await bulkUpdateRoleMutation.mutateAsync({ userId: id, role: bulkRole });
            } else {
              await bulkUpdateMutation.mutateAsync({ id, isActive: action === "activate" });
            }
            return true;
          } catch {
            return false;
          }
        }),
      );
      const updated = results.filter(Boolean).length;
      const failed = results.length - updated;
      toast.success(
        t("users.bulkSummary", "Updated {{updated}}, failed {{failed}}{{skipped}}", {
          updated,
          failed,
          skipped: skippedSelf > 0
            ? t("users.bulkSkippedSelf", " (skipped yourself)")
            : "",
        }),
      );
      refetchUsers();
      clearSelection();
    } finally {
      setIsBulkRunning(false);
      setBulkConfirm(null);
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (permsLoading) {
    return (
      <DashboardLayout title={t('users.title')} navItems={navItems}>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!canView) {
    return (
      <DashboardLayout title={t('users.title')} navItems={navItems}>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t('users.noAccess')}</h3>
              <p className="text-muted-foreground">
                {t('users.adminOnly')}
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('users.management')} navItems={navItems}>
      <PageContainer>
        <PageHeader
          icon={<UsersIcon className="h-6 w-6 text-primary" />}
          title={t('users.management')}
          description={t('users.manageAccounts')}
          badge={<ViewOnlyBadge module="admin_users" />}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => refetchUsers()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <PermissionGate module="admin_users" action="canCreate">
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('users.addUser')}
                </Button>
              </PermissionGate>
            </>
          }
        />

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            icon={<UsersIcon className="h-5 w-5" />}
            label={t('users.totalUsers')}
            value={users?.length || 0}
          />
          <MetricCard
            icon={<Shield className="h-5 w-5" />}
            label="Admin"
            value={users?.filter((u: any) => u.role === "admin").length || 0}
          />
          <MetricCard
            icon={<UserCheck className="h-5 w-5" />}
            label={t('users.active')}
            value={users?.filter((u: any) => u.isActive).length || 0}
            tone="success"
          />
          <MetricCard
            icon={<UserX className="h-5 w-5" />}
            label={t('users.disabled')}
            value={users?.filter((u: any) => !u.isActive).length || 0}
            tone="danger"
          />
        </div>

        {/* Main Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t('users.userList')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('users.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-37.5">
                  <SelectValue placeholder={t('users.role')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('users.allRoles')}</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-37.5">
                  <SelectValue placeholder={t('common.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('users.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Bulk action bar — same gate as the single-row edit action */}
            {canEdit && selectedCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4 rounded-md border bg-muted/40 p-3">
                <span className="text-sm font-medium mr-1">
                  {t("users.bulkSelected", "{{count}} selected", { count: selectedCount })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBulkRunning}
                  aria-label={t("users.bulkActivate", "Activate selected")}
                  onClick={() => setBulkConfirm("activate")}
                >
                  <UserCheck className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t("users.bulkActivate", "Activate selected")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive/80"
                  disabled={isBulkRunning}
                  aria-label={t("users.bulkDeactivate", "Deactivate selected")}
                  onClick={() => setBulkConfirm("deactivate")}
                >
                  <UserX className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t("users.bulkDeactivate", "Deactivate selected")}
                </Button>
                <div className="flex items-center gap-2">
                  <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as "user" | "admin")}>
                    <SelectTrigger className="w-32" aria-label={t("users.bulkRoleSelect", "Role to apply")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">{t("users.roleUser", "User")}</SelectItem>
                      <SelectItem value="admin">{t("users.roleAdmin", "Admin")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBulkRunning}
                    aria-label={t("users.bulkSetRoleApply", "Apply role to selected")}
                    onClick={() => setBulkConfirm("setRole")}
                  >
                    {isBulkRunning && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                    {t("users.bulkSetRole", "Set role")}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isBulkRunning}
                  onClick={clearSelection}
                >
                  {t("users.bulkClear", "Clear")}
                </Button>
              </div>
            )}

            {/* Table */}
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <EmptyState
                variant="no-results"
                icon={UsersIcon}
                title={t('users.noUsersFound')}
              />
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canEdit && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={headerChecked}
                            disabled={filteredUserIds.length === 0}
                            onCheckedChange={(v) => toggleAll(v === true)}
                            aria-label={t("users.selectAll", "Select all users in view")}
                          />
                        </TableHead>
                      )}
                      <TableHead>{t('users.user')}</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>{t('users.department')}</TableHead>
                      <TableHead>{t('users.role')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('users.lastLogin')}</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user: any) => (
                      <TableRow key={user.id}>
                        {canEdit && (
                          <TableCell>
                            <Checkbox
                              checked={selected.has(user.id)}
                              onCheckedChange={(v) => toggleOne(user.id, v === true)}
                              aria-label={t("users.selectRow", "Select {{name}}", { name: user.name || user.username || `#${user.id}` })}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-linear-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-white font-semibold">
                              {user.name?.charAt(0).toUpperCase() || "U"}
                            </div>
                            <div>
                              <div className="font-medium">{user.name || t('users.unnamed')}</div>
                              <div className="text-sm text-muted-foreground flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {user.email || t('users.noEmail')}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-sm bg-muted px-2 py-1 rounded">
                            {user.username || "-"}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {user.department && (
                              <div className="flex items-center gap-1">
                                <Building2 className="h-3 w-3 text-muted-foreground" />
                                {user.department}
                              </div>
                            )}
                            {user.position && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Briefcase className="h-3 w-3" />
                                {user.position}
                              </div>
                            )}
                            {!user.department && !user.position && "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {user.role === "admin" ? (
                              <><Shield className="h-3 w-3 mr-1" /> Admin</>
                            ) : (
                              <><User className="h-3 w-3 mr-1" /> User</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? "outline" : "destructive"}>
                            {user.isActive ? t('common.active') : t('users.inactive')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(user.lastSignedIn)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <PermissionGate module="admin_users" action="canEdit">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("common.edit", "Edit")}
                                onClick={() => handleEdit(user)}
                              >
                                <Pencil aria-hidden="true" className="h-4 w-4" />
                              </Button>
                            </PermissionGate>
                            {laXacThucNoiBo(user.loginMethod) && (
                              <PermissionGate module="admin_users" action="canEdit">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={t("users.changePassword", "Change password")}
                                  onClick={() => handleChangePassword(user)}
                                >
                                  <Key aria-hidden="true" className="h-4 w-4" />
                                </Button>
                              </PermissionGate>
                            )}
                            <PermissionGate module="admin_users" action="canDelete">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("common.delete", "Delete")}
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => handleDelete(user)}
                                disabled={user.id === currentUser?.id}
                              >
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                              </Button>
                            </PermissionGate>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageContainer>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('users.addNewUser')}</DialogTitle>
            <DialogDescription>
              {t('users.createAccountDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('users.loginName')} *</Label>
                <Input
                  id="username"
                  placeholder="username"
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">{t('users.fullName')} *</Label>
                <Input
                  id="name"
                  placeholder="Nguyễn Văn A"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">{t('users.password')} *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t('users.minChars')}
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('users.confirmPassword')} *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t('users.reenterPassword')}
                  value={createForm.confirmPassword}
                  onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t('users.phone')}</Label>
                <Input
                  id="phone"
                  placeholder="0123456789"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="department">{t('users.department')}</Label>
                <Input
                  id="department"
                  placeholder={t('users.departmentPlaceholder')}
                  value={createForm.department}
                  onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">{t('users.position')}</Label>
                <Input
                  id="position"
                  placeholder={t('users.positionPlaceholder')}
                  value={createForm.position}
                  onChange={(e) => setCreateForm({ ...createForm, position: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{t('users.role')}</Label>
              <Select
                value={createForm.role}
                onValueChange={(v) => setCreateForm({ ...createForm, role: v as "user" | "admin" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('users.roleUser')}</SelectItem>
                  <SelectItem value="admin">{t('users.roleAdmin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('users.createUser')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('users.editUser')}</DialogTitle>
            <DialogDescription>
              {t('users.updateInfoFor', { name: editingUser?.name || editingUser?.username })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editName">{t('users.fullName')}</Label>
                <Input
                  id="editName"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEmail">Email</Label>
                <Input
                  id="editEmail"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editPhone">{t('users.phone')}</Label>
                <Input
                  id="editPhone"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDepartment">{t('users.department')}</Label>
                <Input
                  id="editDepartment"
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editPosition">{t('users.position')}</Label>
                <Input
                  id="editPosition"
                  value={editForm.position}
                  onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editRole">{t('users.role')}</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm({ ...editForm, role: v as "user" | "admin" })}
                  disabled={editingUser?.id === currentUser?.id}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="editIsActive">{t('users.activeStatus')}</Label>
              <Switch
                id="editIsActive"
                checked={editForm.isActive}
                onCheckedChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
                disabled={editingUser?.id === currentUser?.id}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('common.update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('users.changePassword')}</DialogTitle>
            <DialogDescription>
              {t('users.setNewPasswordFor', { name: editingUser?.name || editingUser?.username })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t('users.newPassword')}</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder={t('users.minChars')}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword">{t('users.confirmPassword')}</Label>
              <Input
                id="confirmNewPassword"
                type="password"
                placeholder={t('users.reenterNewPassword')}
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdatePassword} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('users.changePassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.confirmDeleteUser')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('users.confirmDeleteDesc', { name: userToDelete?.name || userToDelete?.username })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Action Confirmation Dialog */}
      <AlertDialog open={bulkConfirm !== null} onOpenChange={(o) => { if (!o && !isBulkRunning) setBulkConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === "activate" && t("users.bulkConfirmActivateTitle", "Activate selected users?")}
              {bulkConfirm === "deactivate" && t("users.bulkConfirmDeactivateTitle", "Deactivate selected users?")}
              {bulkConfirm === "setRole" && t("users.bulkConfirmSetRoleTitle", "Change role for selected users?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === "activate" &&
                t("users.bulkConfirmActivateDesc", "This will activate {{count}} user(s).", { count: selectedCount })}
              {bulkConfirm === "deactivate" &&
                t("users.bulkConfirmDeactivateDesc", "This will deactivate {{count}} user(s). Your own account is skipped.", { count: selectedCount })}
              {bulkConfirm === "setRole" &&
                t("users.bulkConfirmSetRoleDesc", "This will set the role of {{count}} user(s) to {{role}}. Your own account is skipped.", { count: selectedCount, role: bulkRole })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkRunning}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={bulkConfirm === "deactivate" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              disabled={isBulkRunning}
              onClick={(e) => { e.preventDefault(); if (bulkConfirm) void runBulk(bulkConfirm); }}
            >
              {isBulkRunning && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              {t('common.confirm', 'Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
