import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Factory, 
  Layers,
  Settings2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BarChart3
} from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type Workstation = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  lineId: number | null;
  workshopId: number | null;
  factoryId: number | null;
  processType: string | null;
  orderIndex: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const PROCESS_TYPES = [
  { value: "SMT", label: "SMT", color: "bg-blue-500" },
  { value: "DIP", label: "DIP", color: "bg-green-500" },
  { value: "ASSEMBLY", label: "machines.assembly", color: "bg-yellow-500" },
  { value: "TESTING", label: "machines.testing", color: "bg-purple-500" },
  { value: "PACKAGING", label: "machines.packaging", color: "bg-orange-500" },
  { value: "OTHER", label: "machines.other", color: "bg-gray-500" },
];

export default function WorkstationManagement() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLineId, setFilterLineId] = useState<string>("all");
  const [filterFactoryId, setFilterFactoryId] = useState<string>("all");
  const [filterProcessType, setFilterProcessType] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    lineId: "",
    workshopId: "",
    factoryId: "",
    processType: "OTHER",
    orderIndex: 0,
    isActive: true,
  });

  // Queries
  const { data: workstations, isLoading, refetch } = trpc.workstation.list.useQuery({
    lineId: filterLineId !== "all" ? parseInt(filterLineId) : undefined,
    factoryId: filterFactoryId !== "all" ? parseInt(filterFactoryId) : undefined,
  });
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Mutations
  const createMutation = trpc.workstation.create.useMutation({
    onSuccess: () => {
      toast.success(t('machines.createSuccess'));
      refetch();
      setIsCreateDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.workstation.update.useMutation({
    onSuccess: () => {
      toast.success(t('machines.updateSuccess'));
      refetch();
      setEditingWorkstation(null);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.workstation.delete.useMutation({
    onSuccess: () => {
      toast.success(t('machines.deleteSuccess'));
      refetch();
      setDeleteConfirmId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Filter workstations
  const filteredWorkstations = useMemo(() => {
    if (!workstations) return [];
    
    return workstations.filter((ws) => {
      const matchesSearch = 
        ws.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ws.name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesProcessType = filterProcessType === "all" || ws.processType === filterProcessType;
      
      return matchesSearch && matchesProcessType;
    });
  }, [workstations, searchQuery, filterProcessType]);

  // Stats
  const stats = useMemo(() => {
    if (!workstations) return { total: 0, active: 0, inactive: 0, byProcessType: {} as Record<string, number> };
    
    const byProcessType: Record<string, number> = {};
    let active = 0;
    let inactive = 0;
    
    workstations.forEach((ws) => {
      if (ws.isActive) active++;
      else inactive++;
      
      const type = ws.processType || "OTHER";
      byProcessType[type] = (byProcessType[type] || 0) + 1;
    });
    
    return { total: workstations.length, active, inactive, byProcessType };
  }, [workstations]);

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      lineId: "",
      workshopId: "",
      factoryId: "",
      processType: "OTHER",
      orderIndex: 0,
      isActive: true,
    });
  };

  const handleCreate = () => {
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId && formData.lineId !== 'none' ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId && formData.workshopId !== 'none' ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId && formData.factoryId !== 'none' ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
    });
  };

  const handleUpdate = () => {
    if (!editingWorkstation) return;
    
    updateMutation.mutate({
      id: editingWorkstation.id,
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      lineId: formData.lineId && formData.lineId !== 'none' ? parseInt(formData.lineId) : undefined,
      workshopId: formData.workshopId && formData.workshopId !== 'none' ? parseInt(formData.workshopId) : undefined,
      factoryId: formData.factoryId && formData.factoryId !== 'none' ? parseInt(formData.factoryId) : undefined,
      processType: formData.processType as any,
      orderIndex: formData.orderIndex,
      isActive: formData.isActive,
    });
  };

  const openEditDialog = (ws: Workstation) => {
    setEditingWorkstation(ws);
    setFormData({
      code: ws.code,
      name: ws.name,
      description: ws.description || "",
      lineId: ws.lineId?.toString() || "",
      workshopId: ws.workshopId?.toString() || "",
      factoryId: ws.factoryId?.toString() || "",
      processType: ws.processType || "OTHER",
      orderIndex: ws.orderIndex,
      isActive: ws.isActive,
    });
  };

  const getProcessTypeInfo = (type: string | null) => {
    return PROCESS_TYPES.find((pt) => pt.value === type) || PROCESS_TYPES[5];
  };

  const getFactoryName = (factoryId: number | null) => {
    if (!factoryId || !factories) return "-";
    return factories.find((f) => f.id === factoryId)?.name || "-";
  };

  const getLineName = (lineId: number | null) => {
    if (!lineId || !lines) return "-";
    return lines.find((l) => l.id === lineId)?.name || "-";
  };

  return (
    <DashboardLayout navItems={navItems}>
      <div className="space-y-6">
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {t('machines.title')}<ViewOnlyBadge module="settings_factory" />
            </span>
          }
          description={t('machines.subtitle')}
          actions={
            <PermissionGate module="settings_factory" action="canCreate">
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('machines.addWorkstation')}
              </Button>
            </PermissionGate>
          }
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('machines.totalWorkstations')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                {t('machines.activeStatus')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                {t('machines.pausedStatus')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.inactive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" />
                {t('machines.byType')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(stats.byProcessType).map(([type, count]) => {
                  const info = getProcessTypeInfo(type);
                  return (
                    <Badge key={type} variant="secondary" className="text-xs">
                      {info.label.startsWith('machines.') ? t(info.label) : info.label}: {count}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('machines.filters')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t('machines.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <Select value={filterFactoryId} onValueChange={setFilterFactoryId}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.factory')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allFactories')}</SelectItem>
                  {factories?.map((f) => (
                    <SelectItem key={f.id} value={f.id.toString()}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterLineId} onValueChange={setFilterLineId}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.line')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allLines')}</SelectItem>
                  {lines?.map((l) => (
                    <SelectItem key={l.id} value={l.id.toString()}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProcessType} onValueChange={setFilterProcessType}>
                <SelectTrigger className="w-45">
                  <SelectValue placeholder={t('machines.processType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allTypes')}</SelectItem>
                  {PROCESS_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {pt.label.startsWith('machines.') ? t(pt.label) : pt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>{t('machines.workstationList')}</CardTitle>
            <CardDescription>
              {t('machines.workstationCount', { count: filteredWorkstations.length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('machines.code')}</TableHead>
                  <TableHead>{t('machines.name')}</TableHead>
                  <TableHead>{t('machines.type')}</TableHead>
                  <TableHead>{t('machines.factory')}</TableHead>
                  <TableHead>{t('machines.line')}</TableHead>
                  <TableHead>{t('machines.order')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="w-12.5"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {t('machines.loading')}
                    </TableCell>
                  </TableRow>
                ) : filteredWorkstations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {t('machines.noWorkstations')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredWorkstations.map((ws) => {
                    const processInfo = getProcessTypeInfo(ws.processType);
                    return (
                      <TableRow key={ws.id}>
                        <TableCell className="font-mono">{ws.code}</TableCell>
                        <TableCell className="font-medium">{ws.name}</TableCell>
                        <TableCell>
                          <Badge className={`${processInfo.color} text-white`}>
                            {processInfo.label.startsWith('machines.') ? t(processInfo.label) : processInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell>{getFactoryName(ws.factoryId)}</TableCell>
                        <TableCell>{getLineName(ws.lineId)}</TableCell>
                        <TableCell>{ws.orderIndex}</TableCell>
                        <TableCell>
                          <Badge variant={ws.isActive ? "default" : "secondary"}>
                            {ws.isActive ? t('machines.active') : t('machines.paused')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <PermissionGate module="settings_factory" action="canEdit">
                                <DropdownMenuItem onClick={() => openEditDialog(ws)}>
                                  <Edit className="w-4 h-4 mr-2" />
                                  {t('machines.edit')}
                                </DropdownMenuItem>
                              </PermissionGate>
                              <PermissionGate module="settings_factory" action="canDelete">
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => setDeleteConfirmId(ws.id)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  {t('machines.delete')}
                                </DropdownMenuItem>
                              </PermissionGate>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog 
          open={isCreateDialogOpen || !!editingWorkstation} 
          onOpenChange={(open) => {
            if (!open) {
              setIsCreateDialogOpen(false);
              setEditingWorkstation(null);
              resetForm();
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingWorkstation ? t('machines.editWorkstation') : t('machines.addNewWorkstation')}
              </DialogTitle>
              <DialogDescription>
                {editingWorkstation 
                  ? t('machines.editDesc') 
                  : t('machines.createDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">{t('machines.workstationCode')}</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder={t('machines.codePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">{t('machines.workstationName')}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('machines.namePlaceholder')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t('machines.description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('machines.descriptionPlaceholder')}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('machines.processType')}</Label>
                  <Select 
                    value={formData.processType} 
                    onValueChange={(v) => setFormData({ ...formData, processType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROCESS_TYPES.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {pt.label.startsWith('machines.') ? t(pt.label) : pt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderIndex">{t('machines.order')}</Label>
                  <Input
                    id="orderIndex"
                    type="number"
                    value={formData.orderIndex}
                    onChange={(e) => setFormData({ ...formData, orderIndex: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('machines.factory')}</Label>
                  <Select 
                    value={formData.factoryId} 
                    onValueChange={(v) => setFormData({ ...formData, factoryId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('machines.selectFactory')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('machines.noSelection')}</SelectItem>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('machines.line')}</Label>
                  <Select 
                    value={formData.lineId} 
                    onValueChange={(v) => setFormData({ ...formData, lineId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('machines.selectLine')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('machines.noSelection')}</SelectItem>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="isActive">{t('machines.activeStatusLabel')}</Label>
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsCreateDialogOpen(false);
                  setEditingWorkstation(null);
                  resetForm();
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={editingWorkstation ? handleUpdate : handleCreate}
                disabled={!formData.code || !formData.name || createMutation.isPending || updateMutation.isPending}
              >
                {editingWorkstation ? t('machines.update') : t('machines.createNew')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                {t('machines.confirmDelete')}
              </DialogTitle>
              <DialogDescription>
                {t('machines.deleteConfirmMessage')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                {t('common.cancel')}
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
              >
                {t('machines.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
