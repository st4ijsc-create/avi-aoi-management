import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Plus, 
  Edit, 
  Trash2, 
  GripVertical,
  Settings,
  Workflow,
  Factory
} from "lucide-react";

const PROCESS_TYPES = [
  { value: 'SMT', label: 'SMT (Surface Mount)', color: 'bg-blue-500' },
  { value: 'DIP', label: 'DIP (Through-hole)', color: 'bg-green-500' },
  { value: 'ASSEMBLY', label: 'Assembly', color: 'bg-purple-500' },
  { value: 'TESTING', label: 'Testing', color: 'bg-orange-500' },
  { value: 'PACKAGING', label: 'Packaging', color: 'bg-pink-500' },
  { value: 'INSPECTION', label: 'Inspection', color: 'bg-yellow-500' },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-500' },
] as const;

type ProcessType = typeof PROCESS_TYPES[number]['value'];

interface ProcessFormData {
  code: string;
  name: string;
  description: string;
  processType: ProcessType;
  cycleTimeTarget: string;
  color: string;
  icon: string;
}

const defaultFormData: ProcessFormData = {
  code: '',
  name: '',
  description: '',
  processType: 'OTHER',
  cycleTimeTarget: '',
  color: '#3b82f6',
  icon: '',
};

export default function ProcessManagement() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<number | null>(null);
  const [formData, setFormData] = useState<ProcessFormData>(defaultFormData);
  const [filterType, setFilterType] = useState<string>("all");

  const utils = trpc.useUtils();

  // Fetch processes
  const { data: processes, isLoading } = trpc.process.list.useQuery(
    filterType !== "all" ? { processType: filterType as ProcessType } : undefined
  );

  // Mutations
  const createMutation = trpc.process.create.useMutation({
    onSuccess: () => {
      toast.success("Process created successfully");
      setIsCreateDialogOpen(false);
      setFormData(defaultFormData);
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = trpc.process.update.useMutation({
    onSuccess: () => {
      toast.success("Process updated successfully");
      setIsEditDialogOpen(false);
      setSelectedProcess(null);
      setFormData(defaultFormData);
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.process.delete.useMutation({
    onSuccess: () => {
      toast.success("Process deleted successfully");
      utils.process.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreate = () => {
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      processType: formData.processType,
      cycleTimeTarget: formData.cycleTimeTarget ? Number(formData.cycleTimeTarget) : undefined,
      color: formData.color,
      icon: formData.icon || undefined,
    });
  };

  const handleUpdate = () => {
    if (!selectedProcess) return;
    updateMutation.mutate({
      id: selectedProcess,
      code: formData.code,
      name: formData.name,
      description: formData.description || undefined,
      processType: formData.processType,
      cycleTimeTarget: formData.cycleTimeTarget ? Number(formData.cycleTimeTarget) : undefined,
      color: formData.color,
      icon: formData.icon || undefined,
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this process?")) {
      deleteMutation.mutate({ id });
    }
  };

  const handleEdit = (process: NonNullable<typeof processes>[number]) => {
    setSelectedProcess(process.id);
    setFormData({
      code: process.code,
      name: process.name,
      description: process.description || '',
      processType: process.processType as ProcessType,
      cycleTimeTarget: process.cycleTimeTarget || '',
      color: process.color || '#3b82f6',
      icon: process.icon || '',
    });
    setIsEditDialogOpen(true);
  };

  const getProcessTypeInfo = (type: string) => {
    return PROCESS_TYPES.find(t => t.value === type) || PROCESS_TYPES[PROCESS_TYPES.length - 1];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6" />
            Process Management
          </h1>
          <p className="text-muted-foreground">
            Define and manage production processes and stages
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Process
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Process</DialogTitle>
              <DialogDescription>
                Add a new production process to your workflow
              </DialogDescription>
            </DialogHeader>
            <ProcessForm 
              formData={formData} 
              setFormData={setFormData} 
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Label>Filter by Type:</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {PROCESS_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Process List */}
      <Card>
        <CardHeader>
          <CardTitle>Production Processes</CardTitle>
          <CardDescription>
            Drag to reorder processes in the production flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : processes && processes.length > 0 ? (
            <div className="space-y-3">
              {processes.map((process, index) => {
                const typeInfo = getProcessTypeInfo(process.processType);
                return (
                  <div
                    key={process.id}
                    className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="cursor-grab text-muted-foreground">
                      <GripVertical className="h-5 w-5" />
                    </div>
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg text-white font-bold"
                      style={{ backgroundColor: process.color || '#3b82f6' }}
                    >
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{process.name}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {process.code}
                        </Badge>
                        <Badge className={`${typeInfo.color} text-white`}>
                          {typeInfo.label}
                        </Badge>
                        {!process.isActive && (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </div>
                      {process.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {process.description}
                        </p>
                      )}
                      {process.cycleTimeTarget && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Target Cycle Time: {process.cycleTimeTarget}s
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(process)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(process.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Factory className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No processes defined yet</p>
              <p className="text-sm">Click "Add Process" to create your first production process</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Process</DialogTitle>
            <DialogDescription>
              Update process details
            </DialogDescription>
          </DialogHeader>
          <ProcessForm 
            formData={formData} 
            setFormData={setFormData} 
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Process Form Component
function ProcessForm({ 
  formData, 
  setFormData 
}: { 
  formData: ProcessFormData; 
  setFormData: React.Dispatch<React.SetStateAction<ProcessFormData>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Code *</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
            placeholder="e.g., SMT-01"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="processType">Type *</Label>
          <Select 
            value={formData.processType} 
            onValueChange={(v) => setFormData(prev => ({ ...prev, processType: v as ProcessType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROCESS_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., SMT Line 1"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Optional description"
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cycleTimeTarget">Target Cycle Time (s)</Label>
          <Input
            id="cycleTimeTarget"
            type="number"
            value={formData.cycleTimeTarget}
            onChange={(e) => setFormData(prev => ({ ...prev, cycleTimeTarget: e.target.value }))}
            placeholder="e.g., 30"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="color">Color</Label>
          <div className="flex gap-2">
            <Input
              id="color"
              type="color"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              className="w-12 h-10 p-1"
            />
            <Input
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="#3b82f6"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
