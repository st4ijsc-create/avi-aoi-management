import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';
import { Plus, Copy, Trash2, Shield, Users, Send, Eye, Edit, FileDown, FilePlus, X } from 'lucide-react';

const ACTION_LABELS: Record<string, { labelKey: string; icon: React.ReactNode }> = {
  canView: { labelKey: 'roles.view', icon: <Eye className="h-3 w-3" /> },
  canCreate: { labelKey: 'roles.create', icon: <FilePlus className="h-3 w-3" /> },
  canEdit: { labelKey: 'roles.edit', icon: <Edit className="h-3 w-3" /> },
  canDelete: { labelKey: 'roles.delete', icon: <X className="h-3 w-3" /> },
  canExport: { labelKey: 'roles.export', icon: <FileDown className="h-3 w-3" /> },
};

const CATEGORY_LABELS: Record<string, string> = {
  dashboard: 'roles.categoryDashboard',
  history: 'roles.categoryHistory',
  analytics: 'roles.categoryAnalytics',
  reports: 'roles.categoryReports',
  mqtt: 'roles.categoryMqtt',
  settings: 'roles.categorySettings',
  admin: 'roles.categoryAdmin',
  production: 'roles.categoryProduction',
  machine_monitoring: 'roles.categoryMachineMonitoring',
  annotations: 'roles.categoryAnnotations',
};

type PermTemplate = {
  category: string;
  moduleName: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
};

export default function RoleBuilder() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [editRoleId, setEditRoleId] = useState<number | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyRoleId, setApplyRoleId] = useState<number | null>(null);
  const [applyUserId, setApplyUserId] = useState<string>('');
  const [applyOverwrite, setApplyOverwrite] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [dupSourceType, setDupSourceType] = useState<'builtin' | 'custom'>('builtin');
  const [dupSourceBuiltin, setDupSourceBuiltin] = useState<string>('');
  const [dupSourceCustomId, setDupSourceCustomId] = useState<string>('');
  const [dupName, setDupName] = useState('');
  const [dupDesc, setDupDesc] = useState('');

  // Queries
  const { data: roles, refetch: refetchRoles } = trpc.permissions.listRoles.useQuery();
  const { data: builtInRoles } = trpc.permissions.getBuiltInRoles.useQuery();
  const { data: availableModules } = trpc.permissions.getAvailableModules.useQuery();

  // Mutations
  const createRole = trpc.permissions.createRole.useMutation();
  const updateRole = trpc.permissions.updateRole.useMutation();
  const deleteRole = trpc.permissions.deleteRole.useMutation();
  const duplicateRole = trpc.permissions.duplicateRole.useMutation();
  const applyRoleToUser = trpc.permissions.applyRoleToUser.useMutation();
  const applyBuiltInRoleToUser = trpc.permissions.applyBuiltInRoleToUser.useMutation();

  // Group available modules by category
  const modulesByCategory = useMemo(() => {
    if (!availableModules) return {};
    const groups: Record<string, typeof availableModules> = {};
    for (const mod of availableModules) {
      if (!groups[mod.category]) groups[mod.category] = [];
      groups[mod.category].push(mod);
    }
    return groups;
  }, [availableModules]);

  // Current editing role
  const editingRole = useMemo(() => {
    if (!editRoleId || !roles) return null;
    return roles.find((r: any) => r.id === editRoleId) || null;
  }, [editRoleId, roles]);

  const editingPermissions = useMemo<PermTemplate[]>(() => {
    if (!editingRole) return [];
    return (editingRole.permissions as PermTemplate[]) || [];
  }, [editingRole]);

  // Group editing permissions by category for display
  const editingPermsByCategory = useMemo(() => {
    const map: Record<string, Record<string, PermTemplate>> = {};
    for (const p of editingPermissions) {
      if (!map[p.category]) map[p.category] = {};
      map[p.category][p.moduleName] = p;
    }
    return map;
  }, [editingPermissions]);

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) {
      toast.error(t('roles.pleaseEnterRoleName'));
      return;
    }
    try {
      // Create with default empty permissions from available modules
      const defaultPerms = (availableModules || []).map((mod: any) => ({
        category: mod.category,
        moduleName: mod.moduleName,
        canView: false,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canExport: false,
      }));
      await createRole.mutateAsync({
        name: newRoleName.trim(),
        description: newRoleDesc.trim() || undefined,
        permissions: defaultPerms,
      });
      toast.success(t('roles.roleCreated'));
      setCreateOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      refetchRoles();
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  const handleDuplicateRole = async () => {
    if (!dupName.trim()) {
      toast.error(t('roles.pleaseEnterNewRoleName'));
      return;
    }
    try {
      await duplicateRole.mutateAsync({
        sourceRoleId: dupSourceType === 'custom' ? Number(dupSourceCustomId) : undefined,
        sourceBuiltInRole: dupSourceType === 'builtin' ? dupSourceBuiltin : undefined,
        newName: dupName.trim(),
        description: dupDesc.trim() || undefined,
      });
      toast.success(t('roles.roleDuplicated'));
      setDuplicateOpen(false);
      setDupName('');
      setDupDesc('');
      refetchRoles();
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  const handleDeleteRole = async (roleId: number) => {
    try {
      await deleteRole.mutateAsync({ id: roleId });
      toast.success(t('roles.roleDeleted'));
      if (editRoleId === roleId) setEditRoleId(null);
      refetchRoles();
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  const handleTogglePermission = async (
    moduleName: string,
    category: string,
    action: string,
    currentValue: boolean,
  ) => {
    if (!editingRole) return;

    // Build updated permissions array
    const updatedPerms = [...editingPermissions];
    const idx = updatedPerms.findIndex(p => p.moduleName === moduleName);

    if (idx >= 0) {
      updatedPerms[idx] = { ...updatedPerms[idx], [action]: !currentValue };
    } else {
      // Module not in list yet, add it
      updatedPerms.push({
        category,
        moduleName,
        canView: action === 'canView' ? true : false,
        canCreate: action === 'canCreate' ? true : false,
        canEdit: action === 'canEdit' ? true : false,
        canDelete: action === 'canDelete' ? true : false,
        canExport: action === 'canExport' ? true : false,
      });
    }

    try {
      await updateRole.mutateAsync({
        id: editingRole.id,
        permissions: updatedPerms,
      });
      refetchRoles();
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  const handleToggleCategoryAll = async (category: string, action: string, enable: boolean) => {
    if (!editingRole || !modulesByCategory[category]) return;

    const updatedPerms = [...editingPermissions];
    for (const mod of modulesByCategory[category]) {
      const idx = updatedPerms.findIndex(p => p.moduleName === mod.moduleName);
      if (idx >= 0) {
        updatedPerms[idx] = { ...updatedPerms[idx], [action]: enable };
      } else {
        updatedPerms.push({
          category,
          moduleName: mod.moduleName,
          canView: action === 'canView' ? enable : false,
          canCreate: action === 'canCreate' ? enable : false,
          canEdit: action === 'canEdit' ? enable : false,
          canDelete: action === 'canDelete' ? enable : false,
          canExport: action === 'canExport' ? enable : false,
        });
      }
    }

    try {
      await updateRole.mutateAsync({
        id: editingRole.id,
        permissions: updatedPerms,
      });
      refetchRoles();
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  const handleApplyRole = async () => {
    if (!applyRoleId || !applyUserId) {
      toast.error(t('roles.pleaseSelectRoleAndUser'));
      return;
    }
    try {
      const result = await applyRoleToUser.mutateAsync({
        roleId: applyRoleId,
        userId: Number(applyUserId),
        overwrite: applyOverwrite,
      });
      toast.success(t('roles.permissionsApplied', { applied: result.applied, skipped: result.skipped }));
      setApplyOpen(false);
    } catch (error: any) {
      toast.error(t('common.error') + ': ' + error.message);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6" />
              {t('roles.customRoleManagement')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('roles.roleManagementDescription')}
            </p>
          </div>
          <div className="flex gap-2">
            {/* Create Role Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('roles.createNewRole')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('roles.createNewRole')}</DialogTitle>
                  <DialogDescription>
                    {t('roles.createRoleDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>{t('roles.roleName')}</Label>
                    <Input
                      value={newRoleName}
                      onChange={e => setNewRoleName(e.target.value)}
                      placeholder={t('roles.roleNamePlaceholder')}
                    />
                  </div>
                  <div>
                    <Label>{t('common.description')}</Label>
                    <Input
                      value={newRoleDesc}
                      onChange={e => setNewRoleDesc(e.target.value)}
                      placeholder={t('roles.roleDescriptionPlaceholder')}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
                  <Button onClick={handleCreateRole} disabled={createRole.isPending}>
                    {t('roles.create')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Duplicate Role Dialog */}
            <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Copy className="h-4 w-4 mr-2" />
                  {t('roles.duplicateRole')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('roles.duplicateRole')}</DialogTitle>
                  <DialogDescription>
                    {t('roles.duplicateRoleDescription')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>{t('roles.source')}</Label>
                    <Select
                      value={dupSourceType}
                      onValueChange={v => setDupSourceType(v as 'builtin' | 'custom')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="builtin">{t('roles.systemRole')}</SelectItem>
                        <SelectItem value="custom">{t('roles.customRole')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {dupSourceType === 'builtin' ? (
                    <div>
                      <Label>{t('roles.systemRole')}</Label>
                      <Select value={dupSourceBuiltin} onValueChange={setDupSourceBuiltin}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('roles.selectRole')} />
                        </SelectTrigger>
                        <SelectContent>
                          {builtInRoles?.map((r: any) => (
                            <SelectItem key={r.name} value={r.name}>
                              {r.name} ({r.permissionCount} {t('roles.permissions')})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label>{t('roles.customRole')}</Label>
                      <Select value={dupSourceCustomId} onValueChange={setDupSourceCustomId}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('roles.selectRole')} />
                        </SelectTrigger>
                        <SelectContent>
                          {roles?.map((r: any) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div>
                    <Label>{t('roles.newRoleName')}</Label>
                    <Input
                      value={dupName}
                      onChange={e => setDupName(e.target.value)}
                      placeholder={t('roles.newRoleNamePlaceholder')}
                    />
                  </div>
                  <div>
                    <Label>{t('common.description')}</Label>
                    <Input
                      value={dupDesc}
                      onChange={e => setDupDesc(e.target.value)}
                      placeholder={t('roles.newRoleDescriptionPlaceholder')}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDuplicateOpen(false)}>{t('common.cancel')}</Button>
                  <Button onClick={handleDuplicateRole} disabled={duplicateRole.isPending}>
                    {t('roles.duplicate')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Roles List */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Role List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">{t('roles.roleList')}</CardTitle>
              <CardDescription>
                {roles?.length || 0} {t('roles.customRolesCount')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Built-in roles info */}
              <div className="text-sm text-muted-foreground mb-3 pb-3 border-b">
                <span className="font-medium">{t('roles.systemRoles')}:</span>{' '}
                {builtInRoles?.map((r: any) => r.name).join(', ') || '...'}
              </div>

              {roles?.map((role: any) => (
                <div
                  key={role.id}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    editRoleId === role.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setEditRoleId(role.id)}
                >
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {role.name}
                      {role.isSystem && (
                        <Badge variant="secondary" className="text-xs">System</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {role.description || t('roles.noDescription')}
                    </div>
                    <div className="text-xs mt-1">
                      <Badge variant="outline" className="text-xs">
                        {((role.permissions as any[]) || []).filter(
                          (p: any) => p.canView || p.canCreate || p.canEdit || p.canDelete || p.canExport,
                        ).length}{' '}
                        {t('roles.activePermissions')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setApplyRoleId(role.id);
                        setApplyOpen(true);
                      }}
                      title={t('roles.applyToUser')}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    {!role.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRole(role.id);
                        }}
                        title={t('roles.deleteRole')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {(!roles || roles.length === 0) && (
                <div className="text-center text-muted-foreground py-8">
                  {t('roles.noCustomRoles')}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Permission Editor */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {editingRole
                  ? t('roles.configurePermissions', { name: editingRole.name })
                  : t('roles.selectRoleToConfigure')}
              </CardTitle>
              {editingRole && (
                <CardDescription>
                  {t('roles.permissionEditorHint')}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {!editingRole ? (
                <div className="text-center text-muted-foreground py-12">
                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('roles.selectRoleFromList')}</p>
                </div>
              ) : editingRole.isSystem ? (
                <div className="text-center text-muted-foreground py-12">
                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t('roles.systemRoleReadOnly')}</p>
                </div>
              ) : (
                <Accordion type="multiple" className="w-full">
                  {Object.entries(modulesByCategory).map(([category, modules]) => {
                    const categoryPerms = editingPermsByCategory[category] || {};

                    return (
                      <AccordionItem key={category} value={category}>
                        <AccordionTrigger className="text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <span>{t(CATEGORY_LABELS[category] || category)}</span>
                            <Badge variant="outline" className="text-xs">
                              {modules.length} modules
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[200px]">Module</TableHead>
                                {Object.entries(ACTION_LABELS).map(([action, { labelKey, icon }]) => (
                                  <TableHead key={action} className="text-center w-[80px]">
                                    <div className="flex flex-col items-center gap-1">
                                      <span className="text-xs">{t(labelKey)}</span>
                                      <Checkbox
                                        checked={
                                          modules.every(
                                            (mod: any) => categoryPerms[mod.moduleName]?.[action as keyof PermTemplate],
                                          )
                                        }
                                        onCheckedChange={(checked) =>
                                          handleToggleCategoryAll(category, action, !!checked)
                                        }
                                        className="h-3.5 w-3.5"
                                      />
                                    </div>
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {modules.map((mod: any) => {
                                const perm = categoryPerms[mod.moduleName];
                                return (
                                  <TableRow key={mod.moduleName}>
                                    <TableCell>
                                      <div>
                                        <div className="font-medium text-xs">{mod.displayName}</div>
                                        <div className="text-xs text-muted-foreground">{mod.moduleName}</div>
                                      </div>
                                    </TableCell>
                                    {Object.keys(ACTION_LABELS).map(action => (
                                      <TableCell key={action} className="text-center">
                                        <Checkbox
                                          checked={!!(perm && perm[action as keyof PermTemplate])}
                                          onCheckedChange={() =>
                                            handleTogglePermission(
                                              mod.moduleName,
                                              category,
                                              action,
                                              !!(perm && perm[action as keyof PermTemplate]),
                                            )
                                          }
                                        />
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Apply Role Dialog */}
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('roles.applyRoleToUser')}</DialogTitle>
              <DialogDescription>
                {t('roles.applyRoleDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>{t('roles.userId')}</Label>
                <Input
                  type="number"
                  value={applyUserId}
                  onChange={e => setApplyUserId(e.target.value)}
                  placeholder={t('roles.userIdPlaceholder')}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="overwrite"
                  checked={applyOverwrite}
                  onCheckedChange={v => setApplyOverwrite(!!v)}
                />
                <Label htmlFor="overwrite" className="text-sm">
                  {t('roles.overwritePermissions')}
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApplyOpen(false)}>{t('common.cancel')}</Button>
              <Button
                onClick={handleApplyRole}
                disabled={applyRoleToUser.isPending}
              >
                <Users className="h-4 w-4 mr-2" />
                {t('roles.apply')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
