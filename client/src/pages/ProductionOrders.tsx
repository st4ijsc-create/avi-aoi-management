import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit, Trash2, Search, Package, Factory, Calendar, Target, CheckCircle2, BarChart3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import GanttChart from "@/components/GanttChart";
import { useTranslation } from 'react-i18next';

export default function ProductionOrders() {
  const { t } = useTranslation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Debounce search input → server-side query (300ms)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);
  const [activeTab, setActiveTab] = useState("list");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; code: string } | null>(null);
  
  // Form state
  const [orderCode, setOrderCode] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [workshopId, setWorkshopId] = useState<number | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [targetQuantity, setTargetQuantity] = useState("");
  const [priority, setPriority] = useState("0");
  const [notes, setNotes] = useState("");

  // Queries — server-side filtering for status + debounced search
  const listInput = (() => {
    const q: { status?: string; search?: string } = {};
    if (statusFilter !== "all") q.status = statusFilter;
    if (debouncedSearch) q.search = debouncedSearch;
    return Object.keys(q).length > 0 ? q : undefined;
  })();
  const { data: orders, refetch } = trpc.productionOrder.list.useQuery(listInput);
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery();

  // Mutations
  const createMutation = trpc.productionOrder.create.useMutation({
    onSuccess: () => {
      toast.success(t('production.createSuccess'));
      setIsCreateOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('errors.error')}: ${error.message}`);
    },
  });

  const updateMutation = trpc.productionOrder.update.useMutation({
    onSuccess: () => {
      toast.success(t('production.updateSuccess'));
      setIsEditOpen(false);
      setSelectedOrder(null);
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('errors.error')}: ${error.message}`);
    },
  });

  const deleteMutation = trpc.productionOrder.delete.useMutation({
    onSuccess: () => {
      toast.success(t('production.deleteSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('errors.error')}: ${error.message}`);
    },
  });

  const rescheduleMutation = trpc.productionOrder.reschedule.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('errors.error')}: ${error.message}`);
      throw error; // Re-throw to handle in GanttChart
    },
  });

  // Handler for Gantt chart drag-drop reschedule
  const handleOrderReschedule = async (orderId: number, newStartDate: Date, newEndDate: Date, newLineId?: number) => {
    await rescheduleMutation.mutateAsync({
      id: orderId,
      scheduledStartDate: newStartDate,
      scheduledEndDate: newEndDate,
      lineId: newLineId,
    });
  };

  const resetForm = () => {
    setOrderCode("");
    setCompanyCode("");
    setFactoryId(null);
    setWorkshopId(null);
    setLineId(null);
    setProductModelId(null);
    setTargetQuantity("");
    setPriority("0");
    setNotes("");
  };

  const handleCreate = () => {
    if (!orderCode || !companyCode || !factoryId || !workshopId || !lineId || !productModelId || !targetQuantity) {
      toast.error(t('production.fillRequiredFields'));
      return;
    }
    createMutation.mutate({
      orderCode,
      companyCode,
      factoryId,
      workshopId,
      lineId,
      productModelId,
      targetQuantity: parseInt(targetQuantity),
      priority: parseInt(priority),
      notes: notes || undefined,
    });
  };

  const handleEdit = (order: any) => {
    setSelectedOrder(order);
    setOrderCode(order.orderCode);
    setCompanyCode(order.companyCode);
    setFactoryId(order.factoryId);
    setWorkshopId(order.workshopId);
    setLineId(order.lineId);
    setProductModelId(order.productModelId);
    setTargetQuantity(order.targetQuantity.toString());
    setPriority(order.priority.toString());
    setNotes(order.notes || "");
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedOrder) return;
    updateMutation.mutate({
      id: selectedOrder.id,
      orderCode,
      companyCode,
      factoryId: factoryId || undefined,
      workshopId: workshopId || undefined,
      lineId: lineId || undefined,
      productModelId: productModelId || undefined,
      targetQuantity: parseInt(targetQuantity),
      priority: parseInt(priority),
      notes: notes || undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: t('production.statusPending'), variant: "secondary" },
      in_progress: { label: t('production.statusInProgress'), variant: "default" },
      completed: { label: t('production.statusCompleted'), variant: "outline" },
      cancelled: { label: t('production.statusCancelled'), variant: "destructive" },
      paused: { label: t('production.statusPaused'), variant: "secondary" },
    };
    const config = statusMap[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getProgress = (order: any) => {
    if (order.targetQuantity === 0) return 0;
    return Math.round((order.completedQuantity / order.targetQuantity) * 100);
  };

  // Server already filters by debouncedSearch; mirror locally so typing feels instant
  // before the debounce timer fires.
  const filteredOrders = orders?.filter((order) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return order.orderCode.toLowerCase().includes(q)
      || order.companyCode.toLowerCase().includes(q);
  });

  const getFactoryName = (id: number) => factories?.find(f => f.id === id)?.name || "-";
  const getWorkshopName = (id: number) => workshops?.find(w => w.id === id)?.name || "-";
  const getLineName = (id: number) => lines?.find(l => l.id === id)?.name || "-";
  const getProductName = (id: number) => products?.find(p => p.id === id)?.name || "-";

  // Filter workshops by selected factory
  const filteredWorkshops = workshops?.filter(w => !factoryId || w.factoryId === factoryId);
  // Filter lines by selected workshop
  const filteredLines = lines?.filter(l => !workshopId || l.workshopId === workshopId);

  return (
    <DashboardLayout title={t('production.title')} navItems={navItems} currentPath="/production-orders">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{t('production.title')}</h1>
              <ViewOnlyBadge module="production_orders" />
            </div>
            <p className="text-muted-foreground">{t('production.description')}</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <PermissionGate module="production_orders" action="canCreate">
                <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('production.createNew')}
                </Button>
              </PermissionGate>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t('production.createNewTitle')}</DialogTitle>
                <DialogDescription>{t('production.createNewDescription')}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-1">
                <div className="space-y-2">
                  <Label>{t('production.orderCode')} *</Label>
                  <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder={t('production.orderCodePlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('production.companyCode')} *</Label>
                  <Input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} placeholder={t('production.companyCodePlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('production.factory')} *</Label>
                  <Select value={factoryId?.toString() || ""} onValueChange={(v) => { setFactoryId(parseInt(v)); setWorkshopId(null); setLineId(null); }}>
                    <SelectTrigger><SelectValue placeholder={t('production.selectFactory')} /></SelectTrigger>
                    <SelectContent>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('production.workshop')} *</Label>
                  <Select value={workshopId?.toString() || ""} onValueChange={(v) => { setWorkshopId(parseInt(v)); setLineId(null); }} disabled={!factoryId}>
                    <SelectTrigger><SelectValue placeholder={t('production.selectWorkshop')} /></SelectTrigger>
                    <SelectContent>
                      {filteredWorkshops?.map((w) => (
                        <SelectItem key={w.id} value={w.id.toString()}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('production.line')} *</Label>
                  <Select value={lineId?.toString() || ""} onValueChange={(v) => setLineId(parseInt(v))} disabled={!workshopId}>
                    <SelectTrigger><SelectValue placeholder={t('production.selectLine')} /></SelectTrigger>
                    <SelectContent>
                      {filteredLines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('production.product')} *</Label>
                  <Select value={productModelId?.toString() || ""} onValueChange={(v) => setProductModelId(parseInt(v))}>
                    <SelectTrigger><SelectValue placeholder={t('production.selectProduct')} /></SelectTrigger>
                    <SelectContent>
                      {products?.map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('production.targetQuantity')} *</Label>
                  <Input type="number" value={targetQuantity} onChange={(e) => setTargetQuantity(e.target.value)} placeholder={t('production.targetQuantityPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('production.priority')}</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{t('production.priorityNormal')}</SelectItem>
                      <SelectItem value="1">{t('production.priorityHigh')}</SelectItem>
                      <SelectItem value="2">{t('production.priorityUrgent')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>{t('production.notes')}</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('production.notesPlaceholder')} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  {createMutation.isPending ? t('common.creating') : t('production.createOrder')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Package className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('production.totalOrders')}</p>
                  <p className="text-2xl font-bold">{orders?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <Calendar className="w-6 h-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('production.statusInProgress')}</p>
                  <p className="text-2xl font-bold">{orders?.filter(o => o.status === 'in_progress').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('production.statusCompleted')}</p>
                  <p className="text-2xl font-bold">{orders?.filter(o => o.status === 'completed').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/10 rounded-lg">
                  <Target className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('production.totalOutput')}</p>
                  <p className="text-2xl font-bold">{orders?.reduce((sum, o) => sum + o.completedQuantity, 0) || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* View Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="list" className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              {t('production.list')}
            </TabsTrigger>
            <TabsTrigger value="gantt" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              {t('production.ganttChart')}
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="list" className="space-y-4 mt-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={t('production.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder={t('production.status')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('production.allStatuses')}</SelectItem>
                      <SelectItem value="pending">{t('production.statusPending')}</SelectItem>
                      <SelectItem value="in_progress">{t('production.statusInProgress')}</SelectItem>
                      <SelectItem value="completed">{t('production.statusCompleted')}</SelectItem>
                      <SelectItem value="paused">{t('production.statusPaused')}</SelectItem>
                      <SelectItem value="cancelled">{t('production.statusCancelled')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Orders Table */}
            <Card>
              <CardHeader>
                <CardTitle>{t('production.orderList')}</CardTitle>
                <CardDescription>{t('production.orderListDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[60vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t('production.orderCode')}</TableHead>
                      <TableHead>{t('production.company')}</TableHead>
                      <TableHead>{t('production.line')}</TableHead>
                      <TableHead>{t('production.product')}</TableHead>
                      <TableHead>{t('production.progress')}</TableHead>
                      <TableHead>{t('production.okNgNtf')}</TableHead>
                      <TableHead>{t('production.status')}</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders?.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.orderCode}</TableCell>
                        <TableCell>{order.companyCode}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{getLineName(order.lineId)}</div>
                            <div className="text-muted-foreground text-xs">{getWorkshopName(order.workshopId)}</div>
                          </div>
                        </TableCell>
                        <TableCell>{getProductName(order.productModelId)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${getProgress(order)}%` }}
                              />
                            </div>
                            <span className="text-sm">{order.completedQuantity}/{order.targetQuantity}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <span className="text-green-500">{order.okQuantity}</span>
                            {" / "}
                            <span className="text-red-500">{order.ngQuantity}</span>
                            {" / "}
                            <span className="text-yellow-500">{order.ntfQuantity}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <PermissionGate module="production_orders" action="canEdit">
                              <Button variant="ghost" size="icon" aria-label={t('production.editOrder')} onClick={() => handleEdit(order)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                            </PermissionGate>
                            <PermissionGate module="production_orders" action="canDelete">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t('production.deleteOrder')}
                                onClick={() => setDeleteTarget({ id: order.id, code: order.orderCode })}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </PermissionGate>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!filteredOrders || filteredOrders.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          {t('production.noOrders')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="gantt" className="mt-4">
            <GanttChart
              orders={orders || []}
              lines={lines || []}
              workshops={workshops || []}
              factories={factories || []}
              products={products || []}
              onOrderClick={(order) => handleEdit(order)}
              onOrderReschedule={handleOrderReschedule}
            />
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('production.editTitle')}</DialogTitle>
              <DialogDescription>{t('production.editDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <Label>{t('production.orderCode')}</Label>
                <Input value={orderCode} onChange={(e) => setOrderCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('production.companyCode')}</Label>
                <Input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('production.targetQuantity')}</Label>
                <Input type="number" value={targetQuantity} onChange={(e) => setTargetQuantity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('production.status')}</Label>
                <Select value={selectedOrder?.status || "pending"} onValueChange={(v) => setSelectedOrder({ ...selectedOrder, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{t('production.statusPending')}</SelectItem>
                    <SelectItem value="in_progress">{t('production.statusInProgress')}</SelectItem>
                    <SelectItem value="completed">{t('production.statusCompleted')}</SelectItem>
                    <SelectItem value="paused">{t('production.statusPaused')}</SelectItem>
                    <SelectItem value="cancelled">{t('production.statusCancelled')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('production.priority')}</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('production.priorityNormal')}</SelectItem>
                    <SelectItem value="1">{t('production.priorityHigh')}</SelectItem>
                    <SelectItem value="2">{t('production.priorityUrgent')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>{t('production.notes')}</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('production.deleteOrder')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('production.confirmDeleteDetail', { code: deleteTarget?.code ?? '', defaultValue: t('production.confirmDelete') })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  if (deleteTarget) {
                    deleteMutation.mutate({ id: deleteTarget.id });
                    setDeleteTarget(null);
                  }
                }}
              >
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
