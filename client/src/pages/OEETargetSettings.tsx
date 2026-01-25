import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Target, TrendingUp, AlertTriangle, CheckCircle2, Edit, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function OEETargetSettings() {
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  
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
      toast.success('OEE target created successfully');
      refetchTargets();
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create target: ${error.message}`);
    },
  });

  const updateTarget = trpc.oee.updateTarget.useMutation({
    onSuccess: () => {
      toast.success('OEE target updated successfully');
      refetchTargets();
      setEditingTargetId(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to update target: ${error.message}`);
    },
  });

  const deleteTarget = trpc.oee.deleteTarget.useMutation({
    onSuccess: () => {
      toast.success('OEE target deleted successfully');
      refetchTargets();
    },
    onError: (error) => {
      toast.error(`Failed to delete target: ${error.message}`);
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
      toast.error('Please select either a machine or a line');
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

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this target?')) {
      deleteTarget.mutate({ id });
    }
  };

  const getStatusBadge = (currentOEE: number, target: any) => {
    const oee = currentOEE / 100;
    const targetOEE = target.targetOEE / 100;
    const alertThreshold = target.alertThreshold / 100;
    const criticalThreshold = target.criticalThreshold / 100;

    if (oee >= targetOEE) {
      return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />On Target</Badge>;
    } else if (oee >= alertThreshold) {
      return <Badge className="bg-yellow-500"><TrendingUp className="w-3 h-3 mr-1" />Below Target</Badge>;
    } else if (oee >= criticalThreshold) {
      return <Badge className="bg-orange-500"><AlertTriangle className="w-3 h-3 mr-1" />Alert</Badge>;
    } else {
      return <Badge className="bg-red-500"><AlertTriangle className="w-3 h-3 mr-1" />Critical</Badge>;
    }
  };

  return (
    <div className="container py-6">
      <div className="flex items-center gap-3 mb-6">
        <Target className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">OEE Target Settings</h1>
          <p className="text-muted-foreground">Set and manage OEE targets for machines and production lines</p>
        </div>
      </div>

      <Tabs defaultValue="targets" className="space-y-6">
        <TabsList>
          <TabsTrigger value="targets">Active Targets</TabsTrigger>
          <TabsTrigger value="create">Create/Edit Target</TabsTrigger>
        </TabsList>

        <TabsContent value="targets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active OEE Targets</CardTitle>
              <CardDescription>Current OEE targets and their status</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Target For</TableHead>
                    <TableHead>OEE Target</TableHead>
                    <TableHead>Availability</TableHead>
                    <TableHead>Performance</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Alert Threshold</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets?.map((target: any) => (
                    <TableRow key={target.id}>
                      <TableCell className="font-medium">
                        {target.machineId ? `Machine ID: ${target.machineId}` : `Line ID: ${target.lineId}`}
                      </TableCell>
                      <TableCell>{(target.targetOEE / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetAvailability / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetPerformance / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.targetQuality / 100).toFixed(1)}%</TableCell>
                      <TableCell>{(target.alertThreshold / 100).toFixed(1)}%</TableCell>
                      <TableCell>
                        <Badge className="bg-green-500">Active</Badge>
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
                            onClick={() => handleDelete(target.id)}
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
                        No OEE targets configured. Create one to get started.
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
              <CardTitle>{editingTargetId ? 'Edit' : 'Create'} OEE Target</CardTitle>
              <CardDescription>
                Set OEE targets for a specific machine or production line
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="machine">Target Machine (Optional)</Label>
                    <Select
                      value={selectedMachineId?.toString() || ''}
                      onValueChange={(value) => {
                        setSelectedMachineId(value ? parseInt(value) : null);
                        if (value) setSelectedLineId(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select machine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {machines?.map((machine: any) => (
                          <SelectItem key={machine.id} value={machine.id.toString()}>
                            {machine.name} ({machine.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="line">Target Line (Optional)</Label>
                    <Select
                      value={selectedLineId?.toString() || ''}
                      onValueChange={(value) => {
                        setSelectedLineId(value ? parseInt(value) : null);
                        if (value) setSelectedMachineId(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select line" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
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
                    <Label htmlFor="targetOEE">Target OEE (%)</Label>
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
                    <Label htmlFor="targetAvailability">Target Availability (%)</Label>
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
                    <Label htmlFor="targetPerformance">Target Performance (%)</Label>
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
                    <Label htmlFor="targetQuality">Target Quality (%)</Label>
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
                    <Label htmlFor="alertThreshold">Alert Threshold (%)</Label>
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
                    <Label htmlFor="criticalThreshold">Critical Threshold (%)</Label>
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
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Additional notes about this target..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={createTarget.isPending || updateTarget.isPending}>
                    <Plus className="w-4 h-4 mr-2" />
                    {editingTargetId ? 'Update' : 'Create'} Target
                  </Button>
                  {editingTargetId && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
