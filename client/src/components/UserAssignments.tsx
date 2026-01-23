import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
  X
} from "lucide-react";

export default function UserAssignments() {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignType, setAssignType] = useState<'corporate' | 'factory'>('factory');
  const [selectedCode, setSelectedCode] = useState("");

  // Queries
  const { data: userAssignments, isLoading, refetch } = trpc.userAssignment.getAllUserAssignments.useQuery();
  const { data: corporateStats } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({});
  const corporates = corporateStats?.map(c => ({ code: c.corporateCode, name: c.corporateCode })) || [];
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: users } = trpc.user.list.useQuery();

  // Mutations
  const assignCorporateMutation = trpc.userAssignment.assignCorporate.useMutation({
    onSuccess: () => {
      toast.success("Gán quyền công ty thành công");
      setAssignDialogOpen(false);
      setSelectedCode("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const assignFactoryMutation = trpc.userAssignment.assignFactory.useMutation({
    onSuccess: () => {
      toast.success("Gán quyền nhà máy thành công");
      setAssignDialogOpen(false);
      setSelectedCode("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeCorporateMutation = trpc.userAssignment.removeCorporateAssignment.useMutation({
    onSuccess: () => {
      toast.success("Xóa quyền công ty thành công");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeFactoryMutation = trpc.userAssignment.removeFactoryAssignment.useMutation({
    onSuccess: () => {
      toast.success("Xóa quyền nhà máy thành công");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAssign = () => {
    if (!selectedUserId || !selectedCode) {
      toast.error("Vui lòng chọn đầy đủ thông tin");
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
                Phân quyền truy cập dữ liệu
              </CardTitle>
              <CardDescription>
                Quản lý quyền truy cập của người dùng theo công ty và nhà máy. 
                Admin có quyền truy cập tất cả dữ liệu.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Người dùng</TableHead>
                  <TableHead>Vai trò</TableHead>
                  <TableHead>Công ty được gán</TableHead>
                  <TableHead>Nhà máy được gán</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
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
                          Tất cả
                        </Badge>
                      ) : item.corporates.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.corporates.map((c) => (
                            <Badge key={c.corporateCode} variant="outline" className="gap-1">
                              <Building2 className="h-3 w-3" />
                              {c.corporateCode}
                              <button
                                onClick={() => removeCorporateMutation.mutate({ 
                                  userId: item.user.id, 
                                  corporateCode: c.corporateCode 
                                })}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Chưa gán</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.user.role === 'admin' ? (
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          Tất cả
                        </Badge>
                      ) : item.factories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.factories.map((f) => (
                            <Badge key={f.factoryCode} variant="outline" className="gap-1">
                              <Factory className="h-3 w-3" />
                              {f.factoryCode}
                              <button
                                onClick={() => removeFactoryMutation.mutate({ 
                                  userId: item.user.id, 
                                  factoryCode: f.factoryCode 
                                })}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Chưa gán</span>
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
                            Gán công ty
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignDialog(item.user.id, 'factory')}
                          >
                            <Factory className="h-4 w-4 mr-1" />
                            Gán nhà máy
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
              {assignType === 'corporate' ? 'Gán quyền công ty' : 'Gán quyền nhà máy'}
            </DialogTitle>
            <DialogDescription>
              {assignType === 'corporate' 
                ? 'Chọn công ty để gán quyền truy cập cho người dùng'
                : 'Chọn nhà máy để gán quyền truy cập cho người dùng'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {assignType === 'corporate' ? 'Công ty' : 'Nhà máy'}
              </label>
              <Select value={selectedCode} onValueChange={setSelectedCode}>
                <SelectTrigger>
                  <SelectValue placeholder={assignType === 'corporate' ? 'Chọn công ty...' : 'Chọn nhà máy...'} />
                </SelectTrigger>
                <SelectContent>
                  {assignType === 'corporate' ? (
                    corporates.map((c: { code: string; name: string }) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} - {c.name}
                      </SelectItem>
                    ))
                  ) : (
                    factories?.map((f) => (
                      <SelectItem key={f.code} value={f.code}>
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
              Hủy
            </Button>
            <Button 
              onClick={handleAssign}
              disabled={!selectedCode || assignCorporateMutation.isPending || assignFactoryMutation.isPending}
            >
              {(assignCorporateMutation.isPending || assignFactoryMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Gán quyền
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
