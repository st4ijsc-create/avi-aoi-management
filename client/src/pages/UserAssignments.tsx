import { useState } from 'react';
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
      toast.error('Please select user and enter corporate code');
      return;
    }
    
    try {
      await assignCorporate.mutateAsync({
        userId: selectedUser,
        corporateCode: corporateCode.trim(),
      });
      toast.success('Assigned corporate successfully');
      setCorporateCode('');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleAssignFactory = async () => {
    if (!selectedUser || !factoryCode.trim()) {
      toast.error('Please select user and enter factory code');
      return;
    }
    
    try {
      await assignFactory.mutateAsync({
        userId: selectedUser,
        factoryCode: factoryCode.trim(),
      });
      toast.success('Assigned factory successfully');
      setFactoryCode('');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleRemoveCorporate = async (userId: number, corporateCode: string) => {
    try {
      await removeCorporate.mutateAsync({ userId, corporateCode });
      toast.success('Removed corporate assignment');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  const handleRemoveFactory = async (userId: number, factoryCode: string) => {
    try {
      await removeFactory.mutateAsync({ userId, factoryCode });
      toast.success('Removed factory assignment');
      refetch();
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  return (
    <DashboardLayout
      title="User Assignments"
      navItems={navItems}
      currentPath="/user-assignments"
    >
      <div className="space-y-6">
        {/* Assignment Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Assign User to Corporate/Factory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* User Selection */}
            <div>
              <Label>Select User</Label>
              <Select value={selectedUser?.toString() || ''} onValueChange={(v) => setSelectedUser(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select User" />
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
                <Label>Corporate Code</Label>
                <Input
                  placeholder="Enter corporate code (e.g., CORP001)"
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
                Assign Corporate
              </Button>
            </div>

            {/* Factory Assignment */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2">
                <Label>Factory Code</Label>
                <Input
                  placeholder="Enter factory code (e.g., FAC001)"
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
                Assign Factory
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User Assignments List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            User Assignments
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
                    Corporate Assignments:
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
                      <span className="text-muted-foreground text-sm">No corporate assignments</span>
                    )}
                  </div>
                </div>

                {/* Factory Assignments */}
                <div>
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Factory className="h-4 w-4" />
                    Factory Assignments:
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
                      <span className="text-muted-foreground text-sm">No factory assignments</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {allAssignments?.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No users found
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
