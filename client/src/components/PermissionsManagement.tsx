import { useState, useMemo, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  X,
  Edit,
  ChevronDown,
  LayoutDashboard,
  History,
  BarChart3,
  FileText,
  Wifi,
  Settings,
  UserCog,
  Factory,
  Monitor,
  PenTool,
} from "lucide-react";
import { toast } from "sonner";

interface PermissionModule {
  category: string;
  moduleName: string;
  displayName: string;
  description: string;
}

interface PermissionFlags {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

interface UserPermissionState {
  userId: number;
  permissions: Map<string, PermissionFlags>;
}

const CATEGORY_META: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard, color: "text-blue-500" },
  history: { label: "permissions.categoryHistory", icon: History, color: "text-emerald-500" },
  analytics: { label: "permissions.categoryAnalytics", icon: BarChart3, color: "text-violet-500" },
  reports: { label: "permissions.categoryReports", icon: FileText, color: "text-amber-500" },
  mqtt: { label: "MQTT", icon: Wifi, color: "text-cyan-500" },
  settings: { label: "permissions.categorySettings", icon: Settings, color: "text-gray-500" },
  admin: { label: "permissions.categoryAdmin", icon: UserCog, color: "text-red-500" },
  production: { label: "permissions.categoryProduction", icon: Factory, color: "text-orange-500" },
  machine_monitoring: { label: "permissions.categoryMachineMonitoring", icon: Monitor, color: "text-teal-500" },
  annotations: { label: "Annotation", icon: PenTool, color: "text-pink-500" },
};

const PERMISSION_FIELDS: { key: keyof PermissionFlags; label: string; shortLabel: string }[] = [
  { key: "canView", label: "permissions.view", shortLabel: "permissions.viewShort" },
  { key: "canCreate", label: "permissions.create", shortLabel: "permissions.createShort" },
  { key: "canEdit", label: "permissions.edit", shortLabel: "permissions.editShort" },
  { key: "canDelete", label: "permissions.delete", shortLabel: "permissions.deleteShort" },
  { key: "canExport", label: "permissions.export", shortLabel: "permissions.exportShort" },
];

const DEFAULT_PERMS: PermissionFlags = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canExport: false,
};

export function PermissionsManagement() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [moduleSearchTerm, setModuleSearchTerm] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [permissionState, setPermissionState] = useState<UserPermissionState | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);

  // Queries
  const { data: usersWithPermissions, isLoading: usersLoading, refetch: refetchUsers } = 
    trpc.permissions.listUsersWithPermissions.useQuery();
  
  const { data: availableModules, isLoading: modulesLoading } = 
    trpc.permissions.getAvailableModules.useQuery();

  // Mutations
  const batchUpdateMutation = trpc.permissions.batchUpdateUserPermissions.useMutation({
    onSuccess: () => {
      toast.success(t('permissions.permissionsUpdated'));
      refetchUsers();
      setEditMode(false);
      setPermissionState(null);
      setModuleSearchTerm("");
      setExpandedCategories([]);
    },
    onError: (error) => {
      toast.error(t('common.errorMessage', { message: error.message }));
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
    if (!permissionState || !usersWithPermissions) return null;
    return usersWithPermissions.find((u: any) => u.id === permissionState.userId);
  }, [permissionState, usersWithPermissions]);

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

  // Filter modules in edit dialog
  const filteredModulesByCategory = useMemo(() => {
    if (!moduleSearchTerm) return modulesByCategory;

    const search = moduleSearchTerm.toLowerCase();
    const result: Record<string, PermissionModule[]> = {};
    
    for (const [cat, modules] of Object.entries(modulesByCategory)) {
      const filtered = modules.filter(
        (m) =>
          m.displayName.toLowerCase().includes(search) ||
          m.description.toLowerCase().includes(search) ||
          m.moduleName.toLowerCase().includes(search)
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [modulesByCategory, moduleSearchTerm]);

  // Count granted permissions per category
  const getCategoryStats = useCallback(
    (category: string, modules: PermissionModule[]) => {
      if (!permissionState) return { granted: 0, total: modules.length };
      let granted = 0;
      for (const m of modules) {
        const p = permissionState.permissions.get(m.moduleName);
        if (p && (p.canView || p.canCreate || p.canEdit || p.canDelete || p.canExport)) {
          granted++;
        }
      }
      return { granted, total: modules.length };
    },
    [permissionState]
  );

  // Count total granted for user
  const totalGranted = useMemo(() => {
    if (!permissionState || !availableModules) return 0;
    let count = 0;
    for (const m of availableModules) {
      const p = permissionState.permissions.get(m.moduleName);
      if (p && (p.canView || p.canCreate || p.canEdit || p.canDelete || p.canExport)) {
        count++;
      }
    }
    return count;
  }, [permissionState, availableModules]);

  // Initialize edit mode
  const handleEditUser = (userId: number) => {
    const user = usersWithPermissions?.find((u: any) => u.id === userId);
    if (!user) return;

    const permMap = new Map<string, PermissionFlags>();
    user.permissions?.forEach((perm: any) => {
      permMap.set(perm.moduleName, {
        canView: perm.canView,
        canCreate: perm.canCreate,
        canEdit: perm.canEdit,
        canDelete: perm.canDelete,
        canExport: perm.canExport,
      });
    });

    setPermissionState({ userId, permissions: permMap });
    setEditMode(true);
    // Auto-expand categories that have permissions
    const cats = new Set<string>();
    user.permissions?.forEach((perm: any) => {
      if (perm.category) cats.add(perm.category);
    });
    setExpandedCategories(Array.from(cats));
  };

  // Update single permission
  const updatePermission = useCallback(
    (moduleName: string, field: keyof PermissionFlags, value: boolean) => {
      if (!permissionState) return;
      const newMap = new Map(permissionState.permissions);
      const current = newMap.get(moduleName) || { ...DEFAULT_PERMS };
      newMap.set(moduleName, { ...current, [field]: value });
      setPermissionState({ ...permissionState, permissions: newMap });
    },
    [permissionState]
  );

  // Toggle all permissions for a module
  const toggleAllForModule = useCallback(
    (moduleName: string, enabled: boolean) => {
      if (!permissionState) return;
      const newMap = new Map(permissionState.permissions);
      newMap.set(moduleName, {
        canView: enabled,
        canCreate: enabled,
        canEdit: enabled,
        canDelete: enabled,
        canExport: enabled,
      });
      setPermissionState({ ...permissionState, permissions: newMap });
    },
    [permissionState]
  );

  // Toggle all modules in a category
  const toggleCategory = useCallback(
    (modules: PermissionModule[], enabled: boolean) => {
      if (!permissionState) return;
      const newMap = new Map(permissionState.permissions);
      for (const m of modules) {
        newMap.set(m.moduleName, {
          canView: enabled,
          canCreate: enabled,
          canEdit: enabled,
          canDelete: enabled,
          canExport: enabled,
        });
      }
      setPermissionState({ ...permissionState, permissions: newMap });
    },
    [permissionState]
  );

  // Check if all modules in category are fully granted
  const isCategoryFullyGranted = useCallback(
    (modules: PermissionModule[]) => {
      if (!permissionState) return false;
      return modules.every((m) => {
        const p = permissionState.permissions.get(m.moduleName);
        return p && p.canView && p.canCreate && p.canEdit && p.canDelete && p.canExport;
      });
    },
    [permissionState]
  );

  // Check if module has all permissions
  const isModuleFullyGranted = useCallback(
    (moduleName: string) => {
      if (!permissionState) return false;
      const p = permissionState.permissions.get(moduleName);
      return !!(p && p.canView && p.canCreate && p.canEdit && p.canDelete && p.canExport);
    },
    [permissionState]
  );

  // Check if module has any permission
  const hasAnyPermission = useCallback(
    (moduleName: string) => {
      if (!permissionState) return false;
      const p = permissionState.permissions.get(moduleName);
      return !!(p && (p.canView || p.canCreate || p.canEdit || p.canDelete || p.canExport));
    },
    [permissionState]
  );

  // Save permissions
  const handleSave = () => {
    if (!permissionState) return;

    const permissionsArray = Array.from(permissionState.permissions.entries())
      .map(([moduleName, perms]) => {
        const module = availableModules?.find((m) => m.moduleName === moduleName);
        if (!module) return null;
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
    setModuleSearchTerm("");
    setExpandedCategories([]);
  };

  if (usersLoading || modulesLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">{t('common.loading')}</div>
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
            {t('permissions.manageUserPermissions')}
          </CardTitle>
          <CardDescription>
            {t('permissions.manageUserPermissionsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('permissions.searchUsers')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant="outline" className="whitespace-nowrap">
              {filteredUsers.length} {t('permissions.users')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* User List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('permissions.userList')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('permissions.user')}</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>{t('permissions.role')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-center">{t('permissions.moduleCount')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user: any) => {
                const permCount = user.permissions?.length || 0;
                const hasPerms = permCount > 0;

                return (
                  <TableRow key={user.id} className={hasPerms ? "bg-muted/30" : ""}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {user.username}
                      </div>
                    </TableCell>
                    <TableCell>{user.email || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                        {user.role || "user"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.isActive !== false ? (
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          {t('permissions.active')}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" />
                          {t('permissions.disabled')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={hasPerms ? "default" : "outline"}>
                        {permCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={hasPerms ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleEditUser(user.id)}
                      >
                        {hasPerms ? (
                          <>
                            <Edit className="h-4 w-4 mr-1" />
                            {t('common.edit')}
                          </>
                        ) : (
                          <>
                            <Shield className="h-4 w-4 mr-1" />
                            {t('permissions.assignPermissions')}
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t('permissions.noUsersFound')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Permissions Dialog */}
      <Dialog open={editMode} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0">
          {/* Dialog Header - Fixed */}
          <div className="px-6 pt-6 pb-4 border-b space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5" />
                {selectedUser?.permissions?.length > 0 ? t('permissions.editPermissions') : t('permissions.assignPermissions')} - {selectedUser?.username}
              </DialogTitle>
              <DialogDescription>
                {t('permissions.editPermissionsDesc')}
              </DialogDescription>
            </DialogHeader>

            {/* Summary bar + Module search */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('permissions.searchModules')}
                  value={moduleSearchTerm}
                  onChange={(e) => setModuleSearchTerm(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>
              <Badge variant="secondary" className="whitespace-nowrap gap-1">
                <Shield className="h-3 w-3" />
                {totalGranted} / {availableModules?.length || 0} module
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  const allCats = Object.keys(filteredModulesByCategory);
                  setExpandedCategories(
                    expandedCategories.length === allCats.length ? [] : allCats
                  );
                }}
              >
                <ChevronDown className="h-4 w-4 mr-1" />
                {expandedCategories.length === Object.keys(filteredModulesByCategory).length
                  ? t('permissions.collapse')
                  : t('permissions.expand')}
              </Button>
            </div>
          </div>

          {/* Scrollable module list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-4">
              {permissionState && (
                <Accordion
                  type="multiple"
                  value={expandedCategories}
                  onValueChange={setExpandedCategories}
                  className="space-y-2"
                >
                  {Object.entries(filteredModulesByCategory).map(([category, modules]) => {
                    const meta = CATEGORY_META[category] || {
                      label: category,
                      icon: Shield,
                      color: "text-gray-500",
                    };
                    const Icon = meta.icon;
                    const stats = getCategoryStats(category, modules);
                    const allGranted = isCategoryFullyGranted(modules);

                    return (
                      <AccordionItem
                        key={category}
                        value={category}
                        className="border rounded-lg px-4"
                      >
                        <div className="flex items-center py-3">
                        <AccordionTrigger className="hover:no-underline flex-1 py-0">
                          <div className="flex items-center gap-3 flex-1">
                            <Icon className={`h-5 w-5 ${meta.color}`} />
                            <span className="font-semibold">{t(meta.label)}</span>
                            <Badge
                              variant={stats.granted > 0 ? "default" : "outline"}
                              className="text-xs"
                            >
                              {stats.granted}/{stats.total}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        {/* Select all checkbox at category level - outside trigger to avoid nested buttons */}
                        <div
                          className="mr-4 flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={allGranted}
                            onCheckedChange={(checked) =>
                              toggleCategory(modules, !!checked)
                            }
                          />
                          <span className="text-xs text-muted-foreground font-normal">
                            {t('common.all')}
                          </span>
                        </div>
                      </div>
                        <AccordionContent className="pt-2 pb-4">
                          <div className="space-y-3">
                            {modules.map((module) => {
                              const current =
                                permissionState.permissions.get(module.moduleName) || {
                                  ...DEFAULT_PERMS,
                                };
                              const hasAny = hasAnyPermission(module.moduleName);
                              const allPerms = isModuleFullyGranted(module.moduleName);

                              return (
                                <div
                                  key={module.moduleName}
                                  className={`rounded-lg border p-4 transition-colors ${
                                    hasAny
                                      ? "border-primary/30 bg-primary/5"
                                      : "border-border hover:border-muted-foreground/30"
                                  }`}
                                >
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">
                                          {module.displayName}
                                        </span>
                                        {hasAny && (
                                          <Badge variant="outline" className="text-[10px] h-5">
                                            {t('permissions.granted')}
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {module.description}
                                      </p>
                                    </div>
                                    <div
                                      className="flex items-center gap-2 ml-4"
                                      title={t('permissions.selectAllForModule')}
                                    >
                                      <Checkbox
                                        checked={allPerms}
                                        onCheckedChange={(checked) =>
                                          toggleAllForModule(module.moduleName, !!checked)
                                        }
                                      />
                                      <span className="text-xs text-muted-foreground">{t('common.all')}</span>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-5 gap-3">
                                    {PERMISSION_FIELDS.map((field) => (
                                      <div
                                        key={field.key}
                                        className="flex items-center gap-2"
                                      >
                                        <Switch
                                          checked={current[field.key]}
                                          onCheckedChange={(checked) =>
                                            updatePermission(
                                              module.moduleName,
                                              field.key,
                                              checked
                                            )
                                          }
                                          className="scale-90"
                                        />
                                        <Label className="cursor-pointer text-xs">
                                          {t(field.shortLabel)}
                                        </Label>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}

              {Object.keys(filteredModulesByCategory).length === 0 && moduleSearchTerm && (
                <div className="text-center py-8 text-muted-foreground">
                  {t('permissions.noModulesMatching', { term: moduleSearchTerm })}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer - Fixed */}
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {t('permissions.selectedModules', { count: totalGranted })}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={batchUpdateMutation.isPending}
              >
                <X className="h-4 w-4 mr-1" />
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={batchUpdateMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                {batchUpdateMutation.isPending ? t('common.saving') : t('permissions.saveChanges')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
