import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { UserPlus, X, Users, Building2, Factory } from 'lucide-react';
import { navItems } from '@/lib/navigation';

export default function UserAssignments() {
  const { t } = useTranslation();
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [corporateCode, setCorporateCode] = useState<string>('');
  const [factoryCode, setFactoryCode] = useState<string>('');

  const { data: allAssignments, refetch } = trpc.userAssignment.getAllUserAssignments.useQuery();
  const assignCorporate = trpc.userAssignment.assignCorporate.useMutation();
  const assignFactory = trpc.userAssignment.assignFactory.useMutation();
  const removeCorporate = trpc.userAssignment.removeCorporateAssignment.useMutation();
  const removeFactory = trpc.userAssignment.removeFactoryAssignment.useMutation();

  const handleAssignCorporate = async () => {
    if (!selectedUser || !corporateCode.trim()) {
      toast.error(t('users.selectUserAndCorporateCode'));
      return;
    }
    
    try {
      await assignCorporate.mutateAsync({
        userId: selectedUser,
        corporateCode: corporateCode.trim(),
      });
      toast.success(t('users.assignedCorporateSuccess'));
      setCorporateCode('');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleAssignFactory = async () => {
    if (!selectedUser || !factoryCode.trim()) {
      toast.error(t('users.selectUserAndFactoryCode'));
      return;
    }
    
    try {
      await assignFactory.mutateAsync({
        userId: selectedUser,
        factoryCode: factoryCode.trim(),
      });
      toast.success(t('users.assignedFactorySuccess'));
      setFactoryCode('');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleRemoveCorporate = async (userId: number, corporateCode: string) => {
    try {
      await removeCorporate.mutateAsync({ userId, corporateCode });
      toast.success(t('users.removedCorporateAssignment'));
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleRemoveFactory = async (userId: number, factoryCode: string) => {
    try {
      await removeFactory.mutateAsync({ userId, factoryCode });
      toast.success(t('users.removedFactoryAssignment'));
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  return (
    <DashboardLayout
      title={t('users.userAssignments')}
      navItems={navItems}
      currentPath="/user-assignments"
    >
      <div className="space-y-6">
        {/* Assignment Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              {t('users.assignUserToCorporateFactory')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* User Selection */}
            <div>
              <Label>{t('users.selectUser')}</Label>
              <Select value={selectedUser?.toString() || ''} onValueChange={(v) => setSelectedUser(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder={t('users.selectUser')} />
                </SelectTrigger>
                <SelectContent>
                  {allAssignments?.map((item) => (
                    <SelectItem key={item.user.id} value={item.user.id.toString()}>
                      <div className="flex items-center gap-2">
                        <span>{item.user.name || item.user.email}</span>
                        <Badge variant="outline" className="text-xs">{item.user.role}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Corporate Assignment */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>{t('users.corporateCode')}</Label>
                <Input
                  placeholder={t('users.enterCorporateCode')}
                  value={corporateCode}
                  onChange={(e) => setCorporateCode(e.target.value)}
                />
              </div>
              <Button 
                onClick={handleAssignCorporate} 
                disabled={!selectedUser || !corporateCode.trim() || assignCorporate.isPending}
                className="w-full"
              >
                <Building2 className="h-4 w-4 mr-2" />
                {t('users.assignCorporate')}
              </Button>
            </div>

            {/* Factory Assignment */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>{t('users.factoryCode')}</Label>
                <Input
                  placeholder={t('users.enterFactoryCode')}
                  value={factoryCode}
                  onChange={(e) => setFactoryCode(e.target.value)}
                />
              </div>
              <Button 
                onClick={handleAssignFactory} 
                disabled={!selectedUser || !factoryCode.trim() || assignFactory.isPending}
                className="w-full"
              >
                <Factory className="h-4 w-4 mr-2" />
                {t('users.assignFactory')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User Assignments List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('users.userAssignments')}
          </h3>
          
          {allAssignments?.map((item) => (
            <Card key={item.user.id}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{item.user.name || item.user.email}</span>
                    <Badge variant={item.user.role === 'admin' ? 'default' : 'secondary'}>
                      {item.user.role}
                    </Badge>
                  </div>
                  {item.user.email && (
                    <span className="text-sm font-normal text-muted-foreground">{item.user.email}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Corporate Assignments */}
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {t('users.corporateAssignments')}:
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {item.corporates.map((corp) => (
                      <Badge key={corp.id} variant="secondary" className="flex items-center gap-1">
                        {corp.corporateCode}
                        <X 
                          className="h-3 w-3 cursor-pointer hover:text-destructive" 
                          onClick={() => handleRemoveCorporate(item.user.id, corp.corporateCode)}
                        />
                      </Badge>
                    ))}
                    {item.corporates.length === 0 && (
                      <span className="text-muted-foreground text-sm">{t('users.noCorporateAssignments')}</span>
                    )}
                  </div>
                </div>

                {/* Factory Assignments */}
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Factory className="h-4 w-4" />
                    {t('users.factoryAssignments')}:
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {item.factories.map((factory) => (
                      <Badge key={factory.id} variant="secondary" className="flex items-center gap-1">
                        {factory.factoryCode}
                        <X 
                          className="h-3 w-3 cursor-pointer hover:text-destructive" 
                          onClick={() => handleRemoveFactory(item.user.id, factory.factoryCode)}
                        />
                      </Badge>
                    ))}
                    {item.factories.length === 0 && (
                      <span className="text-muted-foreground text-sm">{t('users.noFactoryAssignments')}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {allAssignments?.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t('users.noUsersFound')}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
