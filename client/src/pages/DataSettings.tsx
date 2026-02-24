import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

import { 
  Building2,
  Warehouse,
  GitBranch,
  Cpu,
  Plus,
  Copy,
  Loader2,
  Key,
  Database,
  Pencil,
  Trash2,
  MoreHorizontal,
  Clock,
  Upload,
  Image,
  X,
  ChevronDown,
  ChevronRight,
  Factory,
  Cog,
  Award,
  Wifi,
  FolderTree,
  Package,
  Workflow,
  Wrench
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import MachineMapping from "@/components/MachineMapping";
import ManualMachineMapping from "@/components/ManualMachineMapping";

import WorkstationManagement from "@/components/WorkstationManagement";
import { ProcessManagementContent } from "@/pages/ProcessManagement";
import { ProductCategoryManagement } from "@/components/ProductCategoryManagement";
import { ProductMachineMappingContent } from "@/components/ProductMachineMappingContent";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { ValidationMessage } from "@/components/ValidationMessage";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";

type Factory = { id: number; code: string; name: string; address?: string | null; description?: string | null };
type Workshop = { id: number; factoryId: number; code: string; name: string; description?: string | null };
type Line = { id: number; workshopId: number; code: string; name: string; description?: string | null };
type Station = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null };
type Machine = { id: number; stationId: number; code: string; name: string; machineType: string; apiKey: string | null; model?: string | null; manufacturer?: string | null; image2DUrl?: string | null; image3DUrl?: string | null; [key: string]: any };
type ShiftConfig = { id: number; factoryId?: number | null; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number; isActive: boolean; orderIndex: number };
type LineStage = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null; stationId?: number | null };

export default function DataSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const [location, setLocation] = useLocation();
  
  // Parse tab from URL query parameter
  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    return params.get('tab') || 'factories';
  };
  
  const [activeTab, setActiveTab] = useState(getTabFromUrl);
  
  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/datasettings?tab=${tab}`);
  };
  
  // Sync tab with URL on mount and URL changes
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  
  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };
  
  // Factory form
  const [factoryForm, setFactoryForm] = useState({ code: "", name: "", description: "", address: "" });
  const [factoryDialogOpen, setFactoryDialogOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<Factory | null>(null);
  const [editFactoryDialogOpen, setEditFactoryDialogOpen] = useState(false);

  // Workshop form
  const [workshopForm, setWorkshopForm] = useState({ factoryId: "", code: "", name: "", description: "" });
  const [workshopDialogOpen, setWorkshopDialogOpen] = useState(false);
  const [editingWorkshop, setEditingWorkshop] = useState<Workshop | null>(null);
  const [editWorkshopDialogOpen, setEditWorkshopDialogOpen] = useState(false);

  // Line form
  const [lineForm, setLineForm] = useState({ workshopId: "", code: "", name: "", description: "" });
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [editLineDialogOpen, setEditLineDialogOpen] = useState(false);

  // Station form
  const [stationForm, setStationForm] = useState({ lineId: "", code: "", name: "", description: "", orderIndex: "0" });
  const [stationDialogOpen, setStationDialogOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [editStationDialogOpen, setEditStationDialogOpen] = useState(false);

  // Machine form
  const [machineForm, setMachineForm] = useState({ 
    stationId: "", code: "", name: "", machineType: "AVI" as "AVI" | "AOI" | "AUTOMATION", 
    model: "", manufacturer: "", description: "" 
  });
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [editMachineDialogOpen, setEditMachineDialogOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<"2D" | "3D" | null>(null);

  // Shift form
  const [shiftForm, setShiftForm] = useState({ 
    factoryId: "all", name: "", code: "", 
    startHour: "6", startMinute: "0", 
    endHour: "14", endMinute: "0",
    orderIndex: "0"
  });
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftConfig | null>(null);
  const [editShiftDialogOpen, setEditShiftDialogOpen] = useState(false);

  // Stage form
  const [stageForm, setStageForm] = useState({ 
    lineId: "", code: "", name: "", description: "", orderIndex: "0", stationId: "none"
  });
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<LineStage | null>(null);
  const [editStageDialogOpen, setEditStageDialogOpen] = useState(false);
  const [draggedStageId, setDraggedStageId] = useState<number | null>(null);

  // Delete confirm dialog states
  const [deleteShiftDialogOpen, setDeleteShiftDialogOpen] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<ShiftConfig | null>(null);
  const [deleteStageDialogOpen, setDeleteStageDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<LineStage | null>(null);
  const [deleteMachineDialogOpen, setDeleteMachineDialogOpen] = useState(false);
  const [machineToDelete, setMachineToDelete] = useState<Machine | null>(null);

  // Shift form validation
  const shiftValidation = useFormValidation<{
    code: string;
    name: string;
    startHour: string;
    endHour: string;
  }>({
    code: { required: true, minLength: 1, maxLength: 20, pattern: ValidationPatterns.code },
    name: { required: true, minLength: 2, maxLength: 100 },
    startHour: { required: true, min: 0, max: 23 },
    endHour: { required: true, min: 0, max: 23 },
  });

  // Stage form validation
  const stageValidation = useFormValidation<{
    lineId: string;
    code: string;
    name: string;
  }>({
    lineId: { required: true },
    code: { required: true, minLength: 1, maxLength: 20, pattern: ValidationPatterns.code },
    name: { required: true, minLength: 2, maxLength: 100 },
  });

  // Queries
  const { data: factories, refetch: refetchFactories, error: factoriesError, isLoading: factoriesLoading } = trpc.factory.list.useQuery();
  const { data: workshops, refetch: refetchWorkshops, error: workshopsError } = trpc.workshop.list.useQuery();
  const { data: lines, refetch: refetchLines, error: linesError } = trpc.line.list.useQuery();
  const { data: stations, refetch: refetchStations } = trpc.station.list.useQuery();
  const { data: machines, refetch: refetchMachines } = trpc.machine.list.useQuery();
  const { data: shifts, refetch: refetchShifts } = trpc.shiftConfig.list.useQuery();
  const { data: stages, refetch: refetchStages } = trpc.lineStage.list.useQuery();

  // Create Mutations
  const createFactoryMutation = trpc.factory.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createFactorySuccess"));
      setFactoryDialogOpen(false);
      setFactoryForm({ code: "", name: "", description: "", address: "" });
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const createWorkshopMutation = trpc.workshop.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createWorkshopSuccess"));
      setWorkshopDialogOpen(false);
      setWorkshopForm({ factoryId: "", code: "", name: "", description: "" });
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const createLineMutation = trpc.line.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createLineSuccess"));
      setLineDialogOpen(false);
      setLineForm({ workshopId: "", code: "", name: "", description: "" });
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const createStationMutation = trpc.station.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createStationSuccess"));
      setStationDialogOpen(false);
      setStationForm({ lineId: "", code: "", name: "", description: "", orderIndex: "0" });
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMachineMutation = trpc.machine.create.useMutation({
    onSuccess: (data) => {
      toast.success(t("settings.createMachineSuccessWithKey", { apiKey: data.apiKey }));
      setMachineDialogOpen(false);
      setMachineForm({ stationId: "", code: "", name: "", machineType: "AVI", model: "", manufacturer: "", description: "" });
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  const createShiftMutation = trpc.shiftConfig.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createShiftSuccess"));
      setShiftDialogOpen(false);
      setShiftForm({ factoryId: "", name: "", code: "", startHour: "6", startMinute: "0", endHour: "14", endMinute: "0", orderIndex: "0" });
      refetchShifts();
    },
    onError: (error) => toast.error(error.message),
  });

  // Update Mutations
  const updateFactoryMutation = trpc.factory.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateFactorySuccess"));
      setEditFactoryDialogOpen(false);
      setEditingFactory(null);
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateWorkshopMutation = trpc.workshop.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateWorkshopSuccess"));
      setEditWorkshopDialogOpen(false);
      setEditingWorkshop(null);
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateLineMutation = trpc.line.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateLineSuccess"));
      setEditLineDialogOpen(false);
      setEditingLine(null);
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateStationMutation = trpc.station.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateStationSuccess"));
      setEditStationDialogOpen(false);
      setEditingStation(null);
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMachineMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateMachineSuccess"));
      setEditMachineDialogOpen(false);
      setEditingMachine(null);
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadImageMutation = trpc.machine.uploadImage.useMutation({
    onSuccess: (data, variables) => {
      toast.success(t("settings.uploadImageSuccess", { imageType: variables.imageType }));
      setUploadingImage(null);
      if (editingMachine) {
        const updatedMachine = { ...editingMachine };
        if (variables.imageType === "2D") {
          updatedMachine.image2DUrl = data.url;
        } else {
          updatedMachine.image3DUrl = data.url;
        }
        setEditingMachine(updatedMachine);
      }
      refetchMachines();
    },
    onError: (error) => {
      toast.error(error.message);
      setUploadingImage(null);
    },
  });

  // Handle image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, imageType: "2D" | "3D") => {
    const file = e.target.files?.[0];
    if (!file || !editingMachine) return;

    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.pleaseSelectImageFile"));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("settings.maxFileSize5mb"));
      return;
    }

    setUploadingImage(imageType);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadImageMutation.mutate({
          id: editingMachine.id,
          imageType,
          imageData: base64,
          fileName: file.name,
          contentType: file.type,
        });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error(t("settings.uploadImageError"));
      setUploadingImage(null);
    }
  };

  const updateShiftMutation = trpc.shiftConfig.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateShiftSuccess"));
      setEditShiftDialogOpen(false);
      setEditingShift(null);
      refetchShifts();
    },
    onError: (error) => toast.error(error.message),
  });

  // Delete Mutations
  const deleteFactoryMutation = trpc.factory.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteFactorySuccess"));
      refetchFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteWorkshopMutation = trpc.workshop.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteWorkshopSuccess"));
      refetchWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteLineMutation = trpc.line.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteLineSuccess"));
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteStationMutation = trpc.station.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteStationSuccess"));
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMachineMutation = trpc.machine.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteMachineSuccess"));
      refetchMachines();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteShiftMutation = trpc.shiftConfig.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteShiftSuccess"));
      refetchShifts();
    },
    onError: (error) => toast.error(error.message),
  });

  // Stage mutations
  const createStageMutation = trpc.lineStage.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createStageSuccess"));
      refetchStages();
      setStageDialogOpen(false);
      setStageForm({ lineId: "", code: "", name: "", description: "", orderIndex: "0", stationId: "" });
    },
    onError: (error) => toast.error(error.message),
  });

  const updateStageMutation = trpc.lineStage.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateStageSuccess"));
      refetchStages();
      setEditStageDialogOpen(false);
      setEditingStage(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteStageMutation = trpc.lineStage.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteStageSuccess"));
      refetchStages();
    },
    onError: (error) => toast.error(error.message),
  });

  const reorderStageMutation = trpc.lineStage.reorder.useMutation({
    onSuccess: () => {
      toast.success(t("settings.reorderSuccess"));
      refetchStages();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("settings.copiedToClipboard"));
  };

  // Edit handlers
  const handleEditFactory = (factory: Factory) => {
    setEditingFactory(factory);
    setEditFactoryDialogOpen(true);
  };

  const handleEditWorkshop = (workshop: Workshop) => {
    setEditingWorkshop(workshop);
    setEditWorkshopDialogOpen(true);
  };

  const handleEditLine = (line: Line) => {
    setEditingLine(line);
    setEditLineDialogOpen(true);
  };

  const handleEditStation = (station: Station) => {
    setEditingStation(station);
    setEditStationDialogOpen(true);
  };

  const handleEditMachine = (machine: Machine) => {
    setEditingMachine(machine);
    setEditMachineDialogOpen(true);
  };

  if (!isAdmin) {
    return (
      <DashboardLayout title={t("dataSettings.title")} navItems={navItems} currentPath="/datasettings">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Database className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("settings.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("settings.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("dataSettings.title")} navItems={navItems} currentPath="/datasettings">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Database className="h-6 w-6 text-primary" />
              {t("dataSettings.title")}
            </h1>
            <p className="text-muted-foreground">{t("dataSettings.description")}</p>
          </div>
        </div>

        <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex gap-6">
            {/* Vertical Sidebar Navigation */}
            <div className="w-64 shrink-0 space-y-1">

              {/* Category: Infrastructure */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('infrastructure')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Factory className="h-4 w-4 text-blue-500" />
                    <span>{t("settings.cat.infrastructure")}</span>
                  </div>
                  {collapsedCategories['infrastructure'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['infrastructure'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('factories')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'factories' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                      {t("settings.sidebar.factory")}
                    </button>
                    <button
                      onClick={() => handleTabChange('workshops')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'workshops' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Warehouse className="h-4 w-4" />
                      {t("settings.sidebar.workshop")}
                    </button>
                    <button
                      onClick={() => handleTabChange('lines')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'lines' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <GitBranch className="h-4 w-4" />
                      {t("settings.sidebar.line")}
                    </button>
                    <button
                      onClick={() => handleTabChange('stations')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'stations' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Cpu className="h-4 w-4" />
                      {t("settings.sidebar.inspectionStation")}
                    </button>
                    <button
                      onClick={() => handleTabChange('machines')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'machines' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Cpu className="h-4 w-4" />
                      {t("settings.sidebar.inspectionMachine")}
                    </button>
                    <button
                      onClick={() => handleTabChange('workstations')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'workstations' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Cog className="h-4 w-4" />
                      {t("settings.sidebar.workstation")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: Production */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('production')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Cog className="h-4 w-4 text-green-500" />
                    <span>{t("settings.cat.production")}</span>
                  </div>
                  {collapsedCategories['production'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['production'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('shifts')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'shifts' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Clock className="h-4 w-4" />
                      {t("settings.sidebar.shift")}
                    </button>
                    <button
                      onClick={() => handleTabChange('stages')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'stages' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <GitBranch className="h-4 w-4" />
                      {t("settings.sidebar.stage")}
                    </button>
                    <button
                      onClick={() => handleTabChange('mapping')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mapping' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Wifi className="h-4 w-4" />
                      {t("settings.sidebar.mapping")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: Products */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('products')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-orange-500" />
                    <span>{t("settings.cat.products")}</span>
                  </div>
                  {collapsedCategories['products'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['products'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('product-categories')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'product-categories' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                    >
                      <FolderTree className="h-4 w-4" />
                      {t("settings.sidebar.productCategory")}
                    </button>
                    <button
                      onClick={() => handleTabChange('product-models')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'product-models' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Award className="h-4 w-4" />
                      {t("settings.sidebar.productModel")}
                    </button>
                    <button
                      onClick={() => handleTabChange('product-machine-mapping')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'product-machine-mapping' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Cpu className="h-4 w-4" />
                      {t("settings.sidebar.productMapping")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: Process Management */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('process')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-purple-500" />
                    <span>{t("dataSettings.cat.process")}</span>
                  </div>
                  {collapsedCategories['process'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['process'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('process-management')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'process-management' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Workflow className="h-4 w-4" />
                      {t("dataSettings.sidebar.processManagement")}
                    </button>
                    <button
                      onClick={() => handleTabChange('workstation-mgmt')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'workstation-mgmt' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Wrench className="h-4 w-4" />
                      {t("dataSettings.sidebar.workstationManagement")}
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-w-0">

          {/* Factories Tab */}
          <TabsContent value="factories">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.factoryList")}</CardTitle>
                    <CardDescription>{t("settings.factoryCount", { count: factories?.length || 0 })}</CardDescription>
                  </div>
                  <Dialog open={factoryDialogOpen} onOpenChange={setFactoryDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addFactory")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addFactoryNew")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryCode")} *</label>
                          <Input
                            placeholder={t("settings.factoryCodePlaceholder")}
                            value={factoryForm.code}
                            onChange={(e) => setFactoryForm({ ...factoryForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryName")} *</label>
                          <Input
                            placeholder={t("settings.factoryNamePlaceholder")}
                            value={factoryForm.name}
                            onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.address")}</label>
                          <Input
                            placeholder={t("settings.addressPlaceholder")}
                            value={factoryForm.address}
                            onChange={(e) => setFactoryForm({ ...factoryForm, address: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setFactoryDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button 
                          onClick={() => createFactoryMutation.mutate(factoryForm)}
                          disabled={createFactoryMutation.isPending}
                        >
                          {createFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {factories?.map((factory) => (
                    <div key={factory.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{factory.name}</p>
                          <p className="text-sm text-muted-foreground">{factory.code} {factory.address && `• ${factory.address}`}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEditFactory(factory)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("settings.deleteFactoryConfirm", { name: factory.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction 
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteFactoryMutation.mutate({ id: factory.id })}
                              >{t("common.delete")}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                  {(!factories || factories.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">{t("settings.noFactory")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Workshops Tab */}
          <TabsContent value="workshops">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.workshopList")}</CardTitle>
                    <CardDescription>{t("settings.workshopCount", { count: workshops?.length || 0 })}</CardDescription>
                  </div>
                  <Dialog open={workshopDialogOpen} onOpenChange={setWorkshopDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addWorkshop")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addWorkshopNew")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={workshopForm.factoryId} onValueChange={(v) => setWorkshopForm({ ...workshopForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.workshopCode")} *</label>
                          <Input
                            placeholder={t("settings.workshopCodePlaceholder")}
                            value={workshopForm.code}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.workshopName")} *</label>
                          <Input
                            placeholder={t("settings.workshopNamePlaceholder")}
                            value={workshopForm.name}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setWorkshopDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button 
                          onClick={() => createWorkshopMutation.mutate({ ...workshopForm, factoryId: parseInt(workshopForm.factoryId) })}
                          disabled={createWorkshopMutation.isPending}
                        >
                          {createWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {workshops?.map((workshop) => {
                    const factory = factories?.find(f => f.id === workshop.factoryId);
                    return (
                      <div key={workshop.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Warehouse className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{workshop.name}</p>
                            <p className="text-sm text-muted-foreground">{workshop.code} • {factory?.name || t("common.na")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditWorkshop(workshop)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("settings.deleteWorkshopConfirm", { name: workshop.name })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteWorkshopMutation.mutate({ id: workshop.id })}
                                >{t("common.delete")}</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!workshops || workshops.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">{t("settings.noWorkshop")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lines Tab */}
          <TabsContent value="lines">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.lineList")}</CardTitle>
                    <CardDescription>{t("settings.lineCount", { count: lines?.length || 0 })}</CardDescription>
                  </div>
                  <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addLine")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addLineNew")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.workshop")} *</label>
                          <Select value={lineForm.workshopId} onValueChange={(v) => setLineForm({ ...lineForm, workshopId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectWorkshop")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.lineCode")} *</label>
                          <Input
                            placeholder={t("settings.lineCodePlaceholder")}
                            value={lineForm.code}
                            onChange={(e) => setLineForm({ ...lineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.lineName")} *</label>
                          <Input
                            placeholder={t("settings.lineNamePlaceholder")}
                            value={lineForm.name}
                            onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setLineDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createLineMutation.mutate({ ...lineForm, workshopId: parseInt(lineForm.workshopId) })}
                          disabled={createLineMutation.isPending}
                        >
                          {createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {lines?.map((line) => {
                    const workshop = workshops?.find(w => w.id === line.workshopId);
                    return (
                      <div key={line.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <GitBranch className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{line.name}</p>
                            <p className="text-sm text-muted-foreground">{line.code} • {workshop?.name || t("common.na")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditLine(line)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("settings.deleteLineConfirm", { name: line.name })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteLineMutation.mutate({ id: line.id })}
                                >{t("common.delete")}</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!lines || lines.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">{t("settings.noLine")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stations Tab */}
          <TabsContent value="stations">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.stationList")}</CardTitle>
                    <CardDescription>{t("settings.stationCount", { count: stations?.length || 0 })}</CardDescription>
                  </div>
                  <Dialog open={stationDialogOpen} onOpenChange={setStationDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addStation")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addStationNew")}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.line")} *</label>
                          <Select value={stationForm.lineId} onValueChange={(v) => setStationForm({ ...stationForm, lineId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectLine")} /></SelectTrigger>
                            <SelectContent>
                              {lines?.map((l) => (
                                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.stationCode")} *</label>
                          <Input
                            placeholder={t("settings.stationCodePlaceholder")}
                            value={stationForm.code}
                            onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.stationName")} *</label>
                          <Input
                            placeholder={t("settings.stationNamePlaceholder")}
                            value={stationForm.name}
                            onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.order")}</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={stationForm.orderIndex}
                            onChange={(e) => setStationForm({ ...stationForm, orderIndex: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setStationDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button 
                          onClick={() => createStationMutation.mutate({ 
                            ...stationForm, 
                            lineId: parseInt(stationForm.lineId),
                            orderIndex: parseInt(stationForm.orderIndex) 
                          })}
                          disabled={createStationMutation.isPending}
                        >
                          {createStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stations?.map((station) => {
                    const line = lines?.find(l => l.id === station.lineId);
                    return (
                      <div key={station.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Cpu className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{station.name}</p>
                            <p className="text-sm text-muted-foreground">{station.code} • {line?.name || t("common.na")} • {t("settings.orderLabel")} {station.orderIndex}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEditStation(station)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("settings.confirmDelete")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("settings.deleteStationConfirm", { name: station.name })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction 
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteStationMutation.mutate({ id: station.id })}
                                >{t("common.delete")}</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {(!stations || stations.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">{t("settings.noStation")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Machines Tab */}
          <TabsContent value="machines">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.machineList")}</CardTitle>
                    <CardDescription>{t("settings.machineCount", { count: machines?.length || 0 })}</CardDescription>
                  </div>
                  <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addMachine")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addMachineNew")}</DialogTitle>
                        <DialogDescription>{t("settings.addMachineDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.sidebar.workstation")} *</label>
                          <Select value={machineForm.stationId} onValueChange={(v) => setMachineForm({ ...machineForm, stationId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectStation")} /></SelectTrigger>
                            <SelectContent>
                              {stations?.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineCode")} *</label>
                          <Input
                            placeholder={t("settings.machineCodePlaceholder")}
                            value={machineForm.code}
                            onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineName")} *</label>
                          <Input
                            placeholder={t("settings.machineNamePlaceholder")}
                            value={machineForm.name}
                            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineType")} *</label>
                          <Select value={machineForm.machineType} onValueChange={(v: "AVI" | "AOI" | "AUTOMATION") => setMachineForm({ ...machineForm, machineType: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AVI">{t("settings.machineTypeAVI")}</SelectItem>
                              <SelectItem value="AOI">{t("settings.machineTypeAOI")}</SelectItem>
                              <SelectItem value="AUTOMATION">{t("settings.machineTypeAutomation")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.model")}</label>
                          <Input
                            placeholder={t("settings.modelPlaceholder")}
                            value={machineForm.model}
                            onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.manufacturer")}</label>
                          <Input
                            placeholder={t("settings.manufacturerPlaceholder")}
                            value={machineForm.manufacturer}
                            onChange={(e) => setMachineForm({ ...machineForm, manufacturer: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setMachineDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button 
                          onClick={() => createMachineMutation.mutate({ 
                            ...machineForm, 
                            stationId: parseInt(machineForm.stationId)
                          })}
                          disabled={createMachineMutation.isPending}
                        >
                          {createMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {machines?.map((machine) => {
                    const station = stations?.find(s => s.id === machine.stationId);
                    return (
                      <div key={machine.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Cpu className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{machine.name}</p>
                            <p className="text-sm text-muted-foreground">{machine.code} • {machine.machineType}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => copyToClipboard(machine.apiKey || '')}
                          >
                            <Key className="h-3 w-3" />
                            {t("settings.copyApiKey")}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEditMachine(machine)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setMachineToDelete(machine);
                              setDeleteMachineDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {(!machines || machines.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">{t("settings.noMachine")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Workstations Tab */}
          <TabsContent value="workstations">
            <WorkstationManagement />
          </TabsContent>

          {/* Shifts Tab */}
          <TabsContent value="shifts">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.shiftConfig")}</CardTitle>
                    <CardDescription>{t("settings.shiftConfigDesc")}</CardDescription>
                  </div>
                  <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addShift")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addShiftNew")}</DialogTitle>
                        <DialogDescription>{t("settings.addShiftDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.shiftCode")}<span className="text-destructive">*</span></label>
                            <Input
                              placeholder={t("settings.shiftCodePlaceholder")}
                              value={shiftForm.code}
                              onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value })}
                              onBlur={() => shiftValidation.handleBlur("code", shiftForm.code)}
                              className={shiftValidation.hasError("code") ? "border-destructive" : ""}
                            />
                            <ValidationMessage error={shiftValidation.getFieldError("code")} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.shiftName")}<span className="text-destructive">*</span></label>
                            <Input
                              placeholder={t("settings.shiftNamePlaceholder")}
                              value={shiftForm.name}
                              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                              onBlur={() => shiftValidation.handleBlur("name", shiftForm.name)}
                              className={shiftValidation.hasError("name") ? "border-destructive" : ""}
                            />
                            <ValidationMessage error={shiftValidation.getFieldError("name")} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryOptional")}</label>
                          <Select value={shiftForm.factoryId} onValueChange={(v) => setShiftForm({ ...shiftForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.allFactoriesShift")} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("settings.allFactoriesShift")}</SelectItem>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.startTime")} *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder={t("settings.hourPlaceholder")}
                                value={shiftForm.startHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, startHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder={t("settings.minutePlaceholder")}
                                value={shiftForm.startMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, startMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.endTime")} *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder={t("settings.hourPlaceholder")}
                                value={shiftForm.endHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, endHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder={t("settings.minutePlaceholder")}
                                value={shiftForm.endMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, endMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.orderDisplay")}</label>
                          <Input
                            type="number"
                            value={shiftForm.orderIndex}
                            onChange={(e) => setShiftForm({ ...shiftForm, orderIndex: e.target.value })}
                            className="w-24"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button 
                          onClick={() => createShiftMutation.mutate({
                            factoryId: shiftForm.factoryId && shiftForm.factoryId !== "all" ? parseInt(shiftForm.factoryId) : undefined,
                            code: shiftForm.code,
                            name: shiftForm.name,
                            startHour: parseInt(shiftForm.startHour),
                            startMinute: parseInt(shiftForm.startMinute),
                            endHour: parseInt(shiftForm.endHour),
                            endMinute: parseInt(shiftForm.endMinute),
                            orderIndex: parseInt(shiftForm.orderIndex),
                          })}
                          disabled={createShiftMutation.isPending || !shiftForm.code || !shiftForm.name}
                        >
                          {createShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("settings.createShiftBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">{t("settings.tableCode")}</th>
                        <th className="p-3 text-left font-medium">{t("settings.tableShiftName")}</th>
                        <th className="p-3 text-left font-medium">{t("settings.tableFactory")}</th>
                        <th className="p-3 text-left font-medium">{t("settings.tableTime")}</th>
                        <th className="p-3 text-left font-medium">{t("settings.tableStatus")}</th>
                        <th className="p-3 text-right font-medium">{t("settings.tableActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shifts?.map((shift) => (
                        <tr key={shift.id} className="border-b hover:bg-muted/30">
                          <td className="p-3 font-mono text-sm">{shift.code}</td>
                          <td className="p-3 font-medium">{shift.name}</td>
                          <td className="p-3">
                            {shift.factoryId 
                              ? factories?.find(f => f.id === shift.factoryId)?.name || t('common.na')
                              : <span className="text-muted-foreground">{t("settings.entireSystem")}</span>
                            }
                          </td>
                          <td className="p-3">
                            <span className="font-mono">
                              {String(shift.startHour).padStart(2, '0')}:{String(shift.startMinute).padStart(2, '0')}
                              {' - '}
                              {String(shift.endHour).padStart(2, '0')}:{String(shift.endMinute).padStart(2, '0')}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded-full text-xs ${shift.isActive ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'}`}>
                              {shift.isActive ? t('settings.shiftActive') : t('settings.shiftPaused')}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => {
                                  setEditingShift(shift as ShiftConfig);
                                  setEditShiftDialogOpen(true);
                                }}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  {t("settings.edit")}
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => {
                                    setShiftToDelete(shift);
                                    setDeleteShiftDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t("common.delete")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                      {(!shifts || shifts.length === 0) && (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-muted-foreground">{t("settings.noShifts")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stages Tab */}
          <TabsContent value="stages">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.productionStages")}</CardTitle>
                    <CardDescription>{t("settings.stageCount", { count: stages?.length || 0 })}</CardDescription>
                  </div>
                  {isAdmin && (
                    <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Plus className="h-4 w-4" />
                          {t("settings.addStage")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("settings.addStageNew")}</DialogTitle>
                          <DialogDescription>{t("settings.addStageDesc")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("dashboard.line")}<span className="text-destructive">*</span></label>
                            <Select value={stageForm.lineId} onValueChange={(v) => {
                              setStageForm({ ...stageForm, lineId: v });
                              stageValidation.validateSingleField("lineId", v);
                            }}>
                              <SelectTrigger className={stageValidation.hasError("lineId") ? "border-destructive" : ""}><SelectValue placeholder={t("settings.selectLine")} /></SelectTrigger>
                              <SelectContent>
                                {lines?.map((line) => (
                                  <SelectItem key={line.id} value={String(line.id)}>{line.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <ValidationMessage error={stageValidation.getFieldError("lineId")} />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.stageCode")}<span className="text-destructive">*</span></label>
                              <Input 
                                placeholder={t("settings.stageCodePlaceholder")} 
                                value={stageForm.code} 
                                onChange={(e) => setStageForm({ ...stageForm, code: e.target.value })}
                                onBlur={() => stageValidation.handleBlur("code", stageForm.code)}
                                className={stageValidation.hasError("code") ? "border-destructive" : ""}
                              />
                              <ValidationMessage error={stageValidation.getFieldError("code")} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.stageName")}<span className="text-destructive">*</span></label>
                              <Input 
                                placeholder={t("settings.stageNamePlaceholder")} 
                                value={stageForm.name} 
                                onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })}
                                onBlur={() => stageValidation.handleBlur("name", stageForm.name)}
                                className={stageValidation.hasError("name") ? "border-destructive" : ""}
                              />
                              <ValidationMessage error={stageValidation.getFieldError("name")} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.order")}</label>
                              <Input type="number" value={stageForm.orderIndex} onChange={(e) => setStageForm({ ...stageForm, orderIndex: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.linkedStation")}</label>
                              <Select value={stageForm.stationId} onValueChange={(v) => setStageForm({ ...stageForm, stationId: v })}>
                                <SelectTrigger><SelectValue placeholder={t("settings.selectStation2")} /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">{t("settings.noLink")}</SelectItem>
                                  {stations?.filter(s => {
                                    const line = lines?.find(l => l.id === Number(stageForm.lineId));
                                    return line && s.lineId === line.id;
                                  }).map((station) => (
                                    <SelectItem key={station.id} value={String(station.id)}>{station.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("common.description")}</label>
                            <Input placeholder={t("settings.descriptionPlaceholder")} value={stageForm.description} onChange={(e) => setStageForm({ ...stageForm, description: e.target.value })} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setStageDialogOpen(false)}>{t("common.cancel")}</Button>
                          <Button onClick={() => createStageMutation.mutate({
                            lineId: Number(stageForm.lineId),
                            code: stageForm.code,
                            name: stageForm.name,
                            description: stageForm.description || undefined,
                            orderIndex: Number(stageForm.orderIndex),
                            stationId: stageForm.stationId && stageForm.stationId !== "none" ? Number(stageForm.stationId) : undefined,
                          })} disabled={!stageForm.lineId || !stageForm.code || !stageForm.name || createStageMutation.isPending}>
                            {createStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {t("settings.createStageBtn")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {lines?.map((line) => {
                    const lineStages = stages?.filter(s => s.lineId === line.id).sort((a, b) => a.orderIndex - b.orderIndex) || [];
                    if (lineStages.length === 0) return null;
                    return (
                      <div key={line.id} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <GitBranch className="h-4 w-4 text-primary" />
                          <span className="font-medium">{line.name}</span>
                          <span className="text-sm text-muted-foreground">({t("settings.stageCountLabel", { count: lineStages.length })})</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {lineStages.map((stage, index) => (
                            <div
                              key={stage.id}
                              draggable
                              onDragStart={() => setDraggedStageId(stage.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (draggedStageId && draggedStageId !== stage.id) {
                                  const newOrder = lineStages.map(s => s.id);
                                  const dragIndex = newOrder.indexOf(draggedStageId);
                                  const dropIndex = newOrder.indexOf(stage.id);
                                  newOrder.splice(dragIndex, 1);
                                  newOrder.splice(dropIndex, 0, draggedStageId);
                                  reorderStageMutation.mutate({ lineId: line.id, stageIds: newOrder });
                                }
                                setDraggedStageId(null);
                              }}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-move transition-all ${
                                draggedStageId === stage.id ? 'opacity-50 border-primary' : 'hover:border-primary/50'
                              }`}
                            >
                              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
                                {stage.code}
                              </span>
                              <span className="text-sm">{stage.name}</span>
                              {index < lineStages.length - 1 && (
                                <span className="text-muted-foreground">→</span>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                                    <MoreHorizontal className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => {
                                    setEditingStage(stage);
                                    setEditStageDialogOpen(true);
                                  }}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    {t("settings.edit")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    className="text-destructive"
                                    onClick={() => {
                                      setStageToDelete(stage);
                                      setDeleteStageDialogOpen(true);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    {t("common.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {(!stages || stages.length === 0) && (
                    <div className="p-8 text-center text-muted-foreground">{t("settings.noStages")}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Machine Mapping Tab */}
          <TabsContent value="mapping">
            <div className="space-y-6">
              <Card className="glass-card border-blue-500/30 bg-blue-500/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-full bg-blue-500/20">
                      <Wifi className="h-6 w-6 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{t("settings.mqttClientsTitle")}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t("settings.mqttDescription")}
                      </p>
                    </div>
                    <Button asChild>
                      <a href="/mqtt-clients">
                        {t("settings.goToMqttClients")}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-primary" />
                    {t("settings.manualRegistrationTitle")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.manualRegistrationDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ManualMachineMapping />
                </CardContent>
              </Card>
              
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wifi className="h-5 w-5 text-primary" />
                    {t("settings.autoRegistrationLegacy")}
                  </CardTitle>
                  <CardDescription>
                    {t("settings.webSocketDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <MachineMapping />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Product Categories Tab */}
          <TabsContent value="product-categories">
            <ProductCategoryManagement />
          </TabsContent>

          {/* Product Models Tab */}
          <TabsContent value="product-models">
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.productModels")}</CardTitle>
                <CardDescription>{t("settings.productModelsDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                  <Package className="h-16 w-16 text-muted-foreground" />
                  <div className="text-center space-y-2">
                    <p className="text-lg font-medium">{t("settings.manageProductModels")}</p>
                    <p className="text-sm text-muted-foreground">{t("settings.manageProductModelsDesc")}</p>
                  </div>
                  <Button 
                    onClick={() => setLocation("/products")}
                    className="gap-2"
                  >
                    <Package className="h-4 w-4" />
                    {t("settings.openProductModelsPage")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Product Machine Mapping Tab */}
          <TabsContent value="product-machine-mapping">
            <ProductMachineMappingContent />
          </TabsContent>

          {/* Process Management Tab */}
          <TabsContent value="process-management">
            <ProcessManagementContent />
          </TabsContent>

          {/* Workstation Management Tab */}
          <TabsContent value="workstation-mgmt">
            <WorkstationManagement />
          </TabsContent>

            </div>
          </div>
        </Tabs>
        </ErrorBoundary>
      </div>

      {/* Edit Stage Dialog */}
      <Dialog open={editStageDialogOpen} onOpenChange={setEditStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editStage")}</DialogTitle>
          </DialogHeader>
          {editingStage && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.stageCode")}</label>
                  <Input value={editingStage.code} onChange={(e) => setEditingStage({ ...editingStage, code: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.stageName")}</label>
                  <Input value={editingStage.name} onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("common.description")}</label>
                <Input value={editingStage.description || ''} onChange={(e) => setEditingStage({ ...editingStage, description: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStageDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => editingStage && updateStageMutation.mutate({
              id: editingStage.id,
              code: editingStage.code,
              name: editingStage.name,
              description: editingStage.description || undefined,
            })} disabled={updateStageMutation.isPending}>
              {updateStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Factory Dialog */}
      <Dialog open={editFactoryDialogOpen} onOpenChange={setEditFactoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editFactory")}</DialogTitle>
          </DialogHeader>
          {editingFactory && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.factoryCode")}</label>
                <Input value={editingFactory.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.factoryName")} *</label>
                <Input
                  value={editingFactory.name}
                  onChange={(e) => setEditingFactory({ ...editingFactory, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.address")}</label>
                <Input
                  value={editingFactory.address || ""}
                  onChange={(e) => setEditingFactory({ ...editingFactory, address: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFactoryDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingFactory && updateFactoryMutation.mutate({ 
                id: editingFactory.id, 
                name: editingFactory.name, 
                address: editingFactory.address || undefined 
              })}
              disabled={updateFactoryMutation.isPending}
            >
              {updateFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Workshop Dialog */}
      <Dialog open={editWorkshopDialogOpen} onOpenChange={setEditWorkshopDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editWorkshop")}</DialogTitle>
          </DialogHeader>
          {editingWorkshop && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.factory")}</label>
                <Select 
                  value={String(editingWorkshop.factoryId)} 
                  onValueChange={(v) => setEditingWorkshop({ ...editingWorkshop, factoryId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {factories?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.workshopCode")}</label>
                <Input value={editingWorkshop.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.workshopName")} *</label>
                <Input
                  value={editingWorkshop.name}
                  onChange={(e) => setEditingWorkshop({ ...editingWorkshop, name: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditWorkshopDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingWorkshop && updateWorkshopMutation.mutate({ 
                id: editingWorkshop.id, 
                name: editingWorkshop.name,
                factoryId: editingWorkshop.factoryId
              })}
              disabled={updateWorkshopMutation.isPending}
            >
              {updateWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Line Dialog */}
      <Dialog open={editLineDialogOpen} onOpenChange={setEditLineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editLine")}</DialogTitle>
          </DialogHeader>
          {editingLine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.workshop")}</label>
                <Select 
                  value={String(editingLine.workshopId)} 
                  onValueChange={(v) => setEditingLine({ ...editingLine, workshopId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {workshops?.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.lineCode")}</label>
                <Input value={editingLine.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.lineName")} *</label>
                <Input
                  value={editingLine.name}
                  onChange={(e) => setEditingLine({ ...editingLine, name: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingLine && updateLineMutation.mutate({ 
                id: editingLine.id, 
                name: editingLine.name,
                workshopId: editingLine.workshopId
              })}
              disabled={updateLineMutation.isPending}
            >
              {updateLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Station Dialog */}
      <Dialog open={editStationDialogOpen} onOpenChange={setEditStationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editStation")}</DialogTitle>
          </DialogHeader>
          {editingStation && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.line")}</label>
                <Select 
                  value={String(editingStation.lineId)} 
                  onValueChange={(v) => setEditingStation({ ...editingStation, lineId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {lines?.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.stationCode")}</label>
                <Input value={editingStation.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.stationName")} *</label>
                <Input
                  value={editingStation.name}
                  onChange={(e) => setEditingStation({ ...editingStation, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.order")}</label>
                <Input
                  type="number"
                  value={editingStation.orderIndex}
                  onChange={(e) => setEditingStation({ ...editingStation, orderIndex: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStationDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingStation && updateStationMutation.mutate({ 
                id: editingStation.id, 
                name: editingStation.name,
                lineId: editingStation.lineId,
                orderIndex: editingStation.orderIndex
              })}
              disabled={updateStationMutation.isPending}
            >
              {updateStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Shift Dialog */}
      <Dialog open={editShiftDialogOpen} onOpenChange={setEditShiftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editShift")}</DialogTitle>
          </DialogHeader>
          {editingShift && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.shiftCode")}</label>
                  <Input
                    value={editingShift.code}
                    onChange={(e) => setEditingShift({ ...editingShift, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.shiftName")}</label>
                  <Input
                    value={editingShift.name}
                    onChange={(e) => setEditingShift({ ...editingShift, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.startTime")}</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={editingShift.startHour}
                      onChange={(e) => setEditingShift({ ...editingShift, startHour: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                    <span className="self-center">:</span>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      value={editingShift.startMinute}
                      onChange={(e) => setEditingShift({ ...editingShift, startMinute: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("settings.endTime")}</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={editingShift.endHour}
                      onChange={(e) => setEditingShift({ ...editingShift, endHour: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                    <span className="self-center">:</span>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      value={editingShift.endMinute}
                      onChange={(e) => setEditingShift({ ...editingShift, endMinute: parseInt(e.target.value) || 0 })}
                      className="w-20"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="shiftActive"
                  checked={editingShift.isActive}
                  onChange={(e) => setEditingShift({ ...editingShift, isActive: e.target.checked })}
                  className="h-4 w-4"
                />
                <label htmlFor="shiftActive" className="text-sm">{t("settings.active")}</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditShiftDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingShift && updateShiftMutation.mutate({ 
                id: editingShift.id, 
                name: editingShift.name,
                code: editingShift.code,
                startHour: editingShift.startHour,
                startMinute: editingShift.startMinute,
                endHour: editingShift.endHour,
                endMinute: editingShift.endMinute,
                isActive: editingShift.isActive,
              })}
              disabled={updateShiftMutation.isPending}
            >
              {updateShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Machine Dialog */}
      <Dialog open={editMachineDialogOpen} onOpenChange={setEditMachineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editMachine")}</DialogTitle>
          </DialogHeader>
          {editingMachine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.sidebar.workstation")}</label>
                <Select 
                  value={String(editingMachine.stationId)} 
                  onValueChange={(v) => setEditingMachine({ ...editingMachine, stationId: parseInt(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stations?.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.machineCode")}</label>
                <Input value={editingMachine.code} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.machineName")} *</label>
                <Input
                  value={editingMachine.name}
                  onChange={(e) => setEditingMachine({ ...editingMachine, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.model")}</label>
                <Input
                  value={editingMachine.model || ""}
                  onChange={(e) => setEditingMachine({ ...editingMachine, model: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.manufacturer")}</label>
                <Input
                  value={editingMachine.manufacturer || ""}
                  onChange={(e) => setEditingMachine({ ...editingMachine, manufacturer: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.apiKey")}</label>
                <div className="flex gap-2">
                  <Input value={editingMachine.apiKey || ''} disabled className="bg-muted font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(editingMachine.apiKey || '')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Image Upload Section */}
              <div className="border-t pt-4 mt-4">
                <label className="text-sm font-medium block mb-3">{t("settings.machineImage")}</label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t("settings.image2D")}</label>
                    <div className="relative">
                      {editingMachine.image2DUrl ? (
                        <div className="relative group">
                          <img src={editingMachine.image2DUrl} alt="2D" className="w-full h-24 object-cover rounded-lg border" />
                          <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditingMachine({ ...editingMachine, image2DUrl: null })}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                          {uploadingImage === "2D" ? (
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">{t("settings.upload2D")}</span>
                            </>
                          )}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, "2D")} disabled={uploadingImage !== null} />
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t("settings.image3D")}</label>
                    <div className="relative">
                      {editingMachine.image3DUrl ? (
                        <div className="relative group">
                          <img src={editingMachine.image3DUrl} alt="3D" className="w-full h-24 object-cover rounded-lg border" />
                          <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setEditingMachine({ ...editingMachine, image3DUrl: null })}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                          {uploadingImage === "3D" ? (
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                              <span className="text-xs text-muted-foreground">{t("settings.upload3D")}</span>
                            </>
                          )}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, "3D")} disabled={uploadingImage !== null} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{t("settings.imageNote")}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMachineDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button 
              onClick={() => editingMachine && updateMachineMutation.mutate({ 
                id: editingMachine.id, 
                name: editingMachine.name,
                stationId: editingMachine.stationId,
                model: editingMachine.model || undefined,
                manufacturer: editingMachine.manufacturer || undefined
              })}
              disabled={updateMachineMutation.isPending}
            >
              {updateMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialogs */}
      <DeleteConfirmDialog
        open={deleteShiftDialogOpen}
        onOpenChange={setDeleteShiftDialogOpen}
        itemType={t("settings.sidebar.shift")}
        itemName={shiftToDelete?.name}
        onConfirm={() => {
          if (shiftToDelete) {
            deleteShiftMutation.mutate({ id: shiftToDelete.id });
            setDeleteShiftDialogOpen(false);
            setShiftToDelete(null);
          }
        }}
        isLoading={deleteShiftMutation.isPending}
      />

      <DeleteConfirmDialog
        open={deleteStageDialogOpen}
        onOpenChange={setDeleteStageDialogOpen}
        itemType={t("settings.sidebar.stage")}
        itemName={stageToDelete?.name}
        onConfirm={() => {
          if (stageToDelete) {
            deleteStageMutation.mutate({ id: stageToDelete.id });
            setDeleteStageDialogOpen(false);
            setStageToDelete(null);
          }
        }}
        isLoading={deleteStageMutation.isPending}
      />

      <DeleteConfirmDialog
        open={deleteMachineDialogOpen}
        onOpenChange={setDeleteMachineDialogOpen}
        itemType={t("settings.machineCount")}
        itemName={machineToDelete?.name}
        onConfirm={() => {
          if (machineToDelete) {
            deleteMachineMutation.mutate({ id: machineToDelete.id });
            setDeleteMachineDialogOpen(false);
            setMachineToDelete(null);
          }
        }}
        isLoading={deleteMachineMutation.isPending}
      />
    </DashboardLayout>
  );
}
