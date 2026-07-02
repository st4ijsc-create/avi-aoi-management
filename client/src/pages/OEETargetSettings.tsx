import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { navItems } from '@/lib/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader, StatusBadge } from '@/components/patterns';
import { Target, TrendingUp, AlertTriangle, CheckCircle2, Edit, Trash2, Plus, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function OEETargetSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    targetOEE: 80,
    targetAvailability: 90,
    targetPerformance: 95,
    targetQuality: 99,
    alertThreshold: 70,
    criticalThreshold: 60,
    notes: '',
  });

  const { data: machines } = trpc.machine.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: targetsRaw, refetch: refetchTargets } = trpc.oee.listTargets.useQuery();
  const targets = Array.isArray(targetsRaw) ? targetsRaw : [];
  
  const createTarget = trpc.oee.createTarget.useMutation({
    onSuccess: () => {
      toast.success(t('oee.targetCreatedSuccess'));
      refetchTargets();
      resetForm();
    },
    onError: (error) => {
      toast.error(`${t('oee.targetCreateError')}: ${error.message}`);
    },
  });

  const updateTarget = trpc.oee.updateTarget.useMutation({
    onSuccess: () => {
      toast.success(t('oee.targetUpdatedSuccess'));
      refetchTargets();
      setEditingTargetId(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(`${t('oee.targetUpdateError')}: ${error.message}`);
    },
  });

  const deleteTarget = trpc.oee.deleteTarget.useMutation({
    onSuccess: () => {
      toast.success(t('oee.targetDeletedSuccess'));
      refetchTargets();
    },
    onError: (error) => {
      toast.error(`${t('oee.targetDeleteError')}: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      targetOEE: 80,
      targetAvailability: 90,
      targetPerformance: 95,
      targetQuality: 99,
      alertThreshold: 70,
      criticalThreshold: 60,
      notes: '',
    });
    setSelectedMachineId(null);
    setSelectedLineId(null);
    setEditingTargetId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedMachineId && !selectedLineId) {
      toast.error(t('oee.selectMachineOrLine'));
      return;
    }

    const targetData = {
      machineId: selectedMachineId || undefined,
      lineId: selectedLineId || undefined,
      targetOEE: formData.targetOEE * 100, // Convert to basis points
      targetAvailability: formData.targetAvailability * 100,
      targetPerformance: formData.targetPerformance * 100,
      targetQuality: formData.targetQuality * 100,
      alertThreshold: formData.alertThreshold * 100,
      criticalThreshold: formData.criticalThreshold * 100,
      notes: formData.notes || undefined,
    };

    if (editingTargetId) {
      updateTarget.mutate({ id: editingTargetId, ...targetData });
    } else {
      createTarget.mutate(targetData);
    }
  };

  const handleEdit = (target: any) => {
    setEditingTargetId(target.id);
    setSelectedMachineId(target.machineId);
    setSelectedLineId(target.lineId);
    setFormData({
      targetOEE: target.targetOEE / 100,
      targetAvailability: target.targetAvailability / 100,
      targetPerformance: target.targetPerformance / 100,
      targetQuality: target.targetQuality / 100,
      alertThreshold: target.alertThreshold / 100,
      criticalThreshold: target.criticalThreshold / 100,
      notes: target.notes || '',
    });
  };

  const handleConfirmDelete = () => {
    if (deleteTargetId != null) {
      deleteTarget.mutate({ id: deleteTargetId });
      setDeleteTargetId(null);
    }
  };

  const getTargetDisplayName = (target: any) => {
    if (target.machineId) {
      const machine = machines?.find((item: any) => item.id === target.machineId);
      return machine ? `${machine.name} (${machine.code})` : `Machine ID: ${target.machineId}`;
    }
    if (target.lineId) {
      const line = lines?.find((item: any) => item.id === target.lineId);
      return line ? `${line.name} (${line.code})` : `Line ID: ${target.lineId}`;
    }
    return '-';
  };

  const getStatusBadge = (currentOEE: number, target: any) => {
    const oee = currentOEE / 100;
    const targetOEE = target.targetOEE / 100;
    const alertThreshold = target.alertThreshold / 100;
    const criticalThreshold = target.criticalThreshold / 100;

    if (oee >= targetOEE) {
      return <StatusBadge status="onTarget" tone="success" label={<><CheckCircle2 className="w-3 h-3 mr-1 inline" />{t('oee.onTarget')}</>} />;
    } else if (oee >= alertThreshold) {
      return <StatusBadge status="belowTarget" tone="warning" label={<><TrendingUp className="w-3 h-3 mr-1 inline" />{t('oee.belowTarget')}</>} />;
    } else if (oee >= criticalThreshold) {
      return <StatusBadge status="alert" tone="warning" label={<><AlertTriangle className="w-3 h-3 mr-1 inline" />{t('oee.alert')}</>} />;
    } else {
      return <StatusBadge status="critical" tone="error" label={<><AlertTriangle className="w-3 h-3 mr-1 inline" />{t('oee.critical')}</>} />;
    }
  };

  if (!isAdmin) {
    return (
      <DashboardLayout title={t('oee.targetSettings')} navItems={navItems} currentPath="/oee-target-settings">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Shield className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t('settings.adminOnlyAccess')}</p>
          <p className="text-muted-foreground">{t('settings.contactAdmin')}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('oee.targetSettings')} navItems={navItems} currentPath="/oee-target-settings">
      <div className="container py-6 space-y-6">
      <PageHeader
        icon={<Target className="h-6 w-6 text-primary" />}
        title={t('oee.targetSettings')}
        description={t('oee.targetSettingsDescription')}
      />

      <ErrorBoundary>
      <Tabs defaultValue="targets" className="space-y-6">
        <TabsList>
          <TabsTrigger value="targets">{t('oee.activeTargets')}</TabsTrigger>
          <TabsTrigger value="create">{t('oee.createEditTarget')}</TabsTrigger>
        </TabsList>

        <TabsContent value="targets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('oee.activeOEETargets')}</CardTitle>
              <CardDescription>{t('oee.currentTargetsStatus')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('oee.targetFor')}</TableHead>
                    <TableHead>{t('oee.oeeTarget')}</TableHead>
                    <TableHead>{t('oee.availability')}</TableHead>
                    <TableHead>{t('oee.performance')}</TableHead>
                    <TableHead>{t('oee.quality')}</TableHead>
                    <TableHead>{t('oee.alertThreshold')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets?.map((target: any) => (
                    <TableRow key={target.id}>
                      <TableCell className="font-medium">
                        {getTargetDisplayName(target)}
                      </TableCell>
                      <TableCell>{(target.targetOEE / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetAvailability / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetPerformance / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetQuality / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.alertThreshold / 100).toFixed(1)}%</TableCell>
                      <TableCell>
                        {getStatusBadge(target.targetOEE, target)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(target)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleteTargetId(target.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!targets || targets.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        {t('oee.noTargetsConfigured')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{editingTargetId ? t('oee.editTarget') : t('oee.createTarget')}</CardTitle>
              <CardDescription>
                {t('oee.setTargetDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="machine">{t('oee.targetMachine')}</Label>
                    <Select
                      value={selectedMachineId?.toString() || 'none'}
                      onValueChange={(value) => {
                        setSelectedMachineId(value && value !== 'none' ? parseInt(value) : null);
                        if (value && value !== 'none') setSelectedLineId(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('oee.selectMachine')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('common.none')}</SelectItem>
                        {machines?.map((machine: any) => (
                          <SelectItem key={machine.id} value={machine.id.toString()}>
                            {machine.name} ({machine.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="line">{t('oee.targetLine')}</Label>
                    <Select
                      value={selectedLineId?.toString() || 'none'}
                      onValueChange={(value) => {
                        setSelectedLineId(value && value !== 'none' ? parseInt(value) : null);
                        if (value && value !== 'none') setSelectedMachineId(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('oee.selectLine')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('common.none')}</SelectItem>
                        {lines?.map((line: any) => (
                          <SelectItem key={line.id} value={line.id.toString()}>
                            {line.name} ({line.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="targetOEE">{t('oee.targetOeePercent')}</Label>
                    <Input
                      id="targetOEE"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.targetOEE}
                      onChange={(e) => setFormData({ ...formData, targetOEE: parseFloat(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="targetAvailability">{t('oee.targetAvailabilityPercent')}</Label>
                    <Input
                      id="targetAvailability"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.targetAvailability}
                      onChange={(e) => setFormData({ ...formData, targetAvailability: parseFloat(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="targetPerformance">{t('oee.targetPerformancePercent')}</Label>
                    <Input
                      id="targetPerformance"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.targetPerformance}
                      onChange={(e) => setFormData({ ...formData, targetPerformance: parseFloat(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="targetQuality">{t('oee.targetQualityPercent')}</Label>
                    <Input
                      id="targetQuality"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.targetQuality}
                      onChange={(e) => setFormData({ ...formData, targetQuality: parseFloat(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="alertThreshold">{t('oee.alertThresholdPercent')}</Label>
                    <Input
                      id="alertThreshold"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.alertThreshold}
                      onChange={(e) => setFormData({ ...formData, alertThreshold: parseFloat(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="criticalThreshold">{t('oee.criticalThresholdPercent')}</Label>
                    <Input
                      id="criticalThreshold"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.criticalThreshold}
                      onChange={(e) => setFormData({ ...formData, criticalThreshold: parseFloat(e.target.value) })}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">{t('oee.notes')}</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={t('oee.notesPlaceholder')}
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={createTarget.isPending || updateTarget.isPending}>
                    <Plus className="w-4 h-4 mr-2" />
                    {editingTargetId ? t('oee.updateTarget') : t('oee.createTarget')}
                  </Button>
                  {editingTargetId && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </ErrorBoundary>

      <AlertDialog open={deleteTargetId != null} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('oee.deleteTarget', 'Delete target')}</AlertDialogTitle>
            <AlertDialogDescription>{t('oee.confirmDeleteTarget')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>{t('common.delete', 'Delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
