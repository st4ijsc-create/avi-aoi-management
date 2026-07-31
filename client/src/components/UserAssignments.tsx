import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Users, 
  Building2, 
  Factory, 
  Plus, 
  Trash2, 
  Loader2,
  Shield,
  UserCheck,
  X,
  Pencil
} from "lucide-react";

export default function UserAssignments() {
  const { t } = useTranslation();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignType, setAssignType] = useState<'corporate' | 'factory'>('factory');
  const [selectedCode, setSelectedCode] = useState("");
  // Edit/reassign state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editType, setEditType] = useState<'corporate' | 'factory'>('factory');
  const [editOldCode, setEditOldCode] = useState("");
  const [editNewCode, setEditNewCode] = useState("");

  // Queries
  const { data: userAssignments, isLoading, refetch } = trpc.userAssignment.getAllUserAssignments.useQuery();
  const { data: corporateStats } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({});
  const corporates = corporateStats?.map(c => ({ code: c.corporateCode, name: c.corporateCode })) || [];
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: users } = trpc.user.list.useQuery();

  // Mutations
  const assignCorporateMutation = trpc.userAssignment.assignCorporate.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.corporateAssigned'));
      setAssignDialogOpen(false);
      setSelectedCode("");
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const assignFactoryMutation = trpc.userAssignment.assignFactory.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.factoryAssigned'));
      setAssignDialogOpen(false);
      setSelectedCode("");
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const removeCorporateMutation = trpc.userAssignment.removeCorporateAssignment.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.corporateRemoved'));
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const removeFactoryMutation = trpc.userAssignment.removeFactoryAssignment.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.factoryRemoved'));
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const reassignCorporateMutation = trpc.userAssignment.reassignCorporate.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.corporateChanged'));
      setEditDialogOpen(false);
      setEditNewCode("");
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const reassignFactoryMutation = trpc.userAssignment.reassignFactory.useMutation({
    onSuccess: () => {
      toast.success(t('assignments.factoryChanged'));
      setEditDialogOpen(false);
      setEditNewCode("");
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const handleAssign = () => {
    if (!selectedUserId || !selectedCode) {
      toast.error(t('assignments.selectAllInfo'));
      return;
    }

    if (assignType === 'corporate') {
      assignCorporateMutation.mutate({ userId: selectedUserId, corporateCode: selectedCode });
    } else {
      assignFactoryMutation.mutate({ userId: selectedUserId, factoryCode: selectedCode });
    }
  };

  const openAssignDialog = (userId: number, type: 'corporate' | 'factory') => {
    setSelectedUserId(userId);
    setAssignType(type);
    setSelectedCode("");
    setAssignDialogOpen(true);
  };

  const openEditDialog = (userId: number, type: 'corporate' | 'factory', oldCode: string) => {
    setSelectedUserId(userId);
    setEditType(type);
    setEditOldCode(oldCode);
    setEditNewCode("");
    setEditDialogOpen(true);
  };

  const handleReassign = () => {
    if (!selectedUserId || !editNewCode || editNewCode === editOldCode) {
      toast.error(t('assignments.selectDifferentValue'));
      return;
    }
    if (editType === 'corporate') {
      reassignCorporateMutation.mutate({
        userId: selectedUserId,
        oldCorporateCode: editOldCode,
        newCorporateCode: editNewCode,
      });
    } else {
      reassignFactoryMutation.mutate({
        userId: selectedUserId,
        oldFactoryCode: editOldCode,
        newFactoryCode: editNewCode,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-500" />
                {t('assignments.title')}
              </CardTitle>
              <CardDescription>
                {t('assignments.description')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">{t('assignments.user')}</TableHead>
                  <TableHead>{t('assignments.role')}</TableHead>
                  <TableHead>{t('assignments.assignedCorporate')}</TableHead>
                  <TableHead>{t('assignments.assignedFactory')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userAssignments?.map((item) => (
                  <TableRow key={item.user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{item.user.name || item.user.username}</div>
                          <div className="text-xs text-muted-foreground">{item.user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.user.role === 'admin' ? 'default' : 'secondary'}>
                        {item.user.role === 'admin' ? 'Admin' : 'User'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.user.role === 'admin' ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          {t('common.all')}
                        </Badge>
                      ) : item.corporates.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.corporates.map((c) => (
                            <Badge key={c.corporateCode} variant="outline" className="gap-1">
                              <Building2 className="h-3 w-3" />
                              {c.corporateCode}
                              <button
                                onClick={() => openEditDialog(item.user.id, 'corporate', c.corporateCode)}
                                className="ml-1 hover:text-primary"
                                title={t('assignments.changeCorporate')}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => removeCorporateMutation.mutate({ 
                                  userId: item.user.id, 
                                  corporateCode: c.corporateCode 
                                })}
                                className="hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t('assignments.notAssigned')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.user.role === 'admin' ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          {t('common.all')}
                        </Badge>
                      ) : item.factories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.factories.map((f) => (
                            <Badge key={f.factoryCode} variant="outline" className="gap-1">
                              <Factory className="h-3 w-3" />
                              {f.factoryCode}
                              <button
                                onClick={() => openEditDialog(item.user.id, 'factory', f.factoryCode)}
                                className="ml-1 hover:text-primary"
                                title={t('assignments.changeFactory')}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => removeFactoryMutation.mutate({ 
                                  userId: item.user.id, 
                                  factoryCode: f.factoryCode 
                                })}
                                className="hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t('assignments.notAssigned')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.user.role !== 'admin' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignDialog(item.user.id, 'corporate')}
                          >
                            <Building2 className="h-4 w-4 mr-1" />
                            {t('assignments.assignCorporate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignDialog(item.user.id, 'factory')}
                          >
                            <Factory className="h-4 w-4 mr-1" />
                            {t('assignments.assignFactory')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {assignType === 'corporate' ? t('assignments.assignCorporatePermission') : t('assignments.assignFactoryPermission')}
            </DialogTitle>
            <DialogDescription>
              {assignType === 'corporate' 
                ? t('assignments.selectCorporateDesc')
                : t('assignments.selectFactoryDesc')
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {assignType === 'corporate' ? t('assignments.corporate') : t('assignments.factory')}
              </label>
              <Select value={selectedCode} onValueChange={setSelectedCode}>
                <SelectTrigger>
                  <SelectValue placeholder={assignType === 'corporate' ? t('assignments.selectCorporate') : t('assignments.selectFactory')} />
                </SelectTrigger>
                <SelectContent>
                  {assignType === 'corporate' ? (
                    corporates.map((c: { code: string; name: string }) => (
                      <SelectItem key={c.code || c.name} value={c.code || c.name}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))
                  ) : (
                    factories?.map((f) => (
                      <SelectItem key={f.code || String(f.id)} value={f.code || String(f.id)}>
                        {f.code} - {f.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleAssign}
              disabled={!selectedCode || assignCorporateMutation.isPending || assignFactoryMutation.isPending}
            >
              {(assignCorporateMutation.isPending || assignFactoryMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t('assignments.assignPermission')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/Reassign Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editType === 'corporate' ? t('assignments.changeCorporate') : t('assignments.changeFactory')}
            </DialogTitle>
            <DialogDescription>
              {editType === 'corporate'
                ? t('assignments.changeCorporateDesc', { code: editOldCode })
                : t('assignments.changeFactoryDesc', { code: editOldCode })
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {t('assignments.current')}
              </label>
              <div>
                <Badge variant="outline" className="gap-1">
                  {editType === 'corporate' ? <Building2 className="h-3 w-3" /> : <Factory className="h-3 w-3" />}
                  {editOldCode}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {editType === 'corporate' ? t('assignments.newCorporate') : t('assignments.newFactory')}
              </label>
              <Select value={editNewCode} onValueChange={setEditNewCode}>
                <SelectTrigger>
                  <SelectValue placeholder={editType === 'corporate' ? t('assignments.selectNewCorporate') : t('assignments.selectNewFactory')} />
                </SelectTrigger>
                <SelectContent>
                  {editType === 'corporate' ? (
                    corporates
                      .filter((c: { code: string; name: string }) => c.code !== editOldCode)
                      .map((c: { code: string; name: string }) => (
                        <SelectItem key={c.code || c.name} value={c.code || c.name}>
                          {c.code} - {c.name}
                        </SelectItem>
                      ))
                  ) : (
                    factories
                      ?.filter((f) => f.code !== editOldCode)
                      .map((f) => (
                        <SelectItem key={f.code || String(f.id)} value={f.code || String(f.id)}>
                          {f.code} - {f.name}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleReassign}
              disabled={!editNewCode || editNewCode === editOldCode || reassignCorporateMutation.isPending || reassignFactoryMutation.isPending}
            >
              {(reassignCorporateMutation.isPending || reassignFactoryMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t('assignments.change')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
