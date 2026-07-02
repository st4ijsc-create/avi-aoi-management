import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MACHINE_TYPES, type MachineType } from "@/constants/machineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";

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
  FolderTree,
  Package,
  Workflow,
  Wrench,
  Search,
  Filter
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import WorkstationManagement from "@/components/WorkstationManagement";
import { ProcessManagementContent } from "@/pages/ProcessManagement";
import { ProductCategoryManagement } from "@/components/ProductCategoryManagement";
import { ProductMachineMappingContent } from "@/components/ProductMachineMappingContent";
import { ExcelImportExport } from "@/components/ExcelImportExport";

import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { ValidationMessage } from "@/components/ValidationMessage";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";
import { CascadeDeleteDialog } from "@/components/CascadeDeleteDialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Eye } from "lucide-react";

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
    if (tabFromUrl === 'mapping') {
      setLocation('/monitoring-setting?tab=device-management');
      return;
    }
    if (tabFromUrl === 'workstations') {
      setLocation('/datasettings?tab=workstation-mgmt');
      return;
    }
    if (tabFromUrl === 'product-models') {
      setLocation('/products');
      return;
    }
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  
  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  // Search & Filter states
  const [factorySearch, setFactorySearch] = useState("");
  const [workshopSearch, setWorkshopSearch] = useState("");
  const [workshopFilterFactory, setWorkshopFilterFactory] = useState("all");
  const [lineSearch, setLineSearch] = useState("");
  const [lineFilterWorkshop, setLineFilterWorkshop] = useState("all");
  const [stationSearch, setStationSearch] = useState("");
  const [stationFilterLine, setStationFilterLine] = useState("all");
  const [machineSearch, setMachineSearch] = useState("");
  const [machineFilterStation, setMachineFilterStation] = useState("all");
  const [machineFilterType, setMachineFilterType] = useState("all");

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
  const [lineForm, setLineForm] = useState({ factoryId: "", workshopId: "", code: "", name: "", description: "" });
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [editLineDialogOpen, setEditLineDialogOpen] = useState(false);

  // Station form
  const [stationForm, setStationForm] = useState({ factoryId: "", workshopId: "", lineId: "", code: "", name: "", description: "", orderIndex: "0" });
  const [stationDialogOpen, setStationDialogOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [editStationDialogOpen, setEditStationDialogOpen] = useState(false);

  // Machine form
  const [machineForm, setMachineForm] = useState({ 
    factoryId: "", workshopId: "", lineId: "", stationId: "", code: "", name: "", machineType: "AVI" as MachineType,
    model: "", manufacturer: "", description: ""
  });
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [editMachineDialogOpen, setEditMachineDialogOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<"2D" | "3D" | null>(null);

  // Cascade filter states for edit dialogs
  const [editLineFactoryId, setEditLineFactoryId] = useState("");
  const [editStationFactoryId, setEditStationFactoryId] = useState("");
  const [editStationWorkshopId, setEditStationWorkshopId] = useState("");
  const [editMachineFactoryId, setEditMachineFactoryId] = useState("");
  const [editMachineWorkshopId, setEditMachineWorkshopId] = useState("");
  const [editMachineLineId, setEditMachineLineId] = useState("");

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

  // Cascade delete dialog states
  const [factoryToDelete, setFactoryToDelete] = useState<Factory | null>(null);
  const [workshopToDelete, setWorkshopToDelete] = useState<Workshop | null>(null);
  const [lineToDelete, setLineToDelete] = useState<Line | null>(null);
  const [stationToDelete, setStationToDelete] = useState<Station | null>(null);

  // Show deleted items toggle (admin only)
  const [showDeleted, setShowDeleted] = useState(false);

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

  // Cascade info queries (enabled when delete dialog is open)
  const { data: factoryCascadeInfo, isLoading: factoryCascadeLoading } = trpc.factory.cascadeInfo.useQuery(
    { id: factoryToDelete?.id ?? 0 },
    { enabled: !!factoryToDelete }
  );
  const { data: workshopCascadeInfo, isLoading: workshopCascadeLoading } = trpc.workshop.cascadeInfo.useQuery(
    { id: workshopToDelete?.id ?? 0 },
    { enabled: !!workshopToDelete }
  );
  const { data: lineCascadeInfo, isLoading: lineCascadeLoading } = trpc.line.cascadeInfo.useQuery(
    { id: lineToDelete?.id ?? 0 },
    { enabled: !!lineToDelete }
  );
  const { data: stationCascadeInfo, isLoading: stationCascadeLoading } = trpc.station.cascadeInfo.useQuery(
    { id: stationToDelete?.id ?? 0 },
    { enabled: !!stationToDelete }
  );

  // Deleted items queries (admin only, enabled when toggle is on)
  const { data: deletedFactories, refetch: refetchDeletedFactories } = trpc.factory.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedWorkshops, refetch: refetchDeletedWorkshops } = trpc.workshop.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedLines, refetch: refetchDeletedLines } = trpc.line.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedStations, refetch: refetchDeletedStations } = trpc.station.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedMachines, refetch: refetchDeletedMachines } = trpc.machine.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });

  // Filtered data
  const filteredFactories = useMemo(() => {
    if (!factories) return [];
    const q = factorySearch.toLowerCase().trim();
    return factories.filter((f: Factory) => {
      if (q && !f.name.toLowerCase().includes(q) && !f.code.toLowerCase().includes(q) && !(f.address || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [factories, factorySearch]);

  const filteredWorkshops = useMemo(() => {
    if (!workshops) return [];
    const q = workshopSearch.toLowerCase().trim();
    return workshops.filter((w: any) => {
      if (workshopFilterFactory !== "all" && String(w.factoryId) !== workshopFilterFactory) return false;
      if (q && !w.name.toLowerCase().includes(q) && !w.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [workshops, workshopSearch, workshopFilterFactory]);

  const filteredLines = useMemo(() => {
    if (!lines) return [];
    const q = lineSearch.toLowerCase().trim();
    return lines.filter((l: any) => {
      if (lineFilterWorkshop !== "all" && String(l.workshopId) !== lineFilterWorkshop) return false;
      if (q && !l.name.toLowerCase().includes(q) && !l.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, lineSearch, lineFilterWorkshop]);

  const filteredStations = useMemo(() => {
    if (!stations) return [];
    const q = stationSearch.toLowerCase().trim();
    return stations.filter((s: any) => {
      if (stationFilterLine !== "all" && String(s.lineId) !== stationFilterLine) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [stations, stationSearch, stationFilterLine]);

  const filteredMachines = useMemo(() => {
    if (!machines) return [];
    const q = machineSearch.toLowerCase().trim();
    return machines.filter((m: any) => {
      if (machineFilterStation !== "all" && String(m.stationId) !== machineFilterStation) return false;
      if (machineFilterType !== "all" && m.type !== machineFilterType) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.code.toLowerCase().includes(q) && !(m.type || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [machines, machineSearch, machineFilterStation, machineFilterType]);

  const machineTypes = useMemo(() => {
    if (!machines) return [];
    const types = new Set(machines.map((m: any) => m.type).filter(Boolean));
    return Array.from(types) as string[];
  }, [machines]);

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
      setLineForm({ factoryId: "", workshopId: "", code: "", name: "", description: "" });
      refetchLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const createStationMutation = trpc.station.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createStationSuccess"));
      setStationDialogOpen(false);
      setStationForm({ factoryId: "", workshopId: "", lineId: "", code: "", name: "", description: "", orderIndex: "0" });
      refetchStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const createMachineMutation = trpc.machine.create.useMutation({
    onSuccess: (data) => {
      toast.success(t("settings.createMachineSuccessWithKey", { apiKey: data.apiKey }));
      setMachineDialogOpen(false);
      setMachineForm({ factoryId: "", workshopId: "", lineId: "", stationId: "", code: "", name: "", machineType: "AVI", model: "", manufacturer: "", description: "" });
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

  // Import/Export Mutations
  const importFactoriesMutation = trpc.import.importFactories.useMutation();
  const importWorkshopsMutation = trpc.import.importWorkshops.useMutation();
  const importLinesMutation = trpc.import.importLines.useMutation();
  const importStationsMutation = trpc.import.importStations.useMutation();
  const importMachinesMutation = trpc.import.importMachines.useMutation();
  const exportFactoriesMutation = trpc.export.exportFactories.useMutation();
  const exportWorkshopsMutation = trpc.export.exportWorkshops.useMutation();
  const exportLinesMutation = trpc.export.exportLines.useMutation();
  const exportStationsMutation = trpc.export.exportStations.useMutation();
  const exportMachinesMutation = trpc.export.exportMachines.useMutation();

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

  // Seed Data Mutations
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu cơ sở mẫu thành công!'),
    onError: (error) => toast.error(error.message),
  });

  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: () => toast.success('Đã tạo 100 bản ghi kiểm tra mẫu thành công!'),
    onError: (error) => toast.error(error.message),
  });

  const seedWorkstationAnalyticsMutation = trpc.seedData.seedWorkstationAnalytics.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu phân tích trạm làm việc mẫu thành công!'),
    onError: (error) => toast.error(error.message),
  });

  // Delete Mutations
  const deleteFactoryMutation = trpc.factory.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteFactorySuccess"));
      setFactoryToDelete(null);
      refetchFactories();
      if (showDeleted) refetchDeletedFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteWorkshopMutation = trpc.workshop.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteWorkshopSuccess"));
      setWorkshopToDelete(null);
      refetchWorkshops();
      if (showDeleted) refetchDeletedWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteLineMutation = trpc.line.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteLineSuccess"));
      setLineToDelete(null);
      refetchLines();
      if (showDeleted) refetchDeletedLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteStationMutation = trpc.station.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteStationSuccess"));
      setStationToDelete(null);
      refetchStations();
      if (showDeleted) refetchDeletedStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMachineMutation = trpc.machine.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteMachineSuccess"));
      refetchMachines();
      if (showDeleted) refetchDeletedMachines();
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

  // Restore mutations
  const restoreFactoryMutation = trpc.factory.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchFactories();
      refetchDeletedFactories();
    },
    onError: (error) => toast.error(error.message),
  });

  const restoreWorkshopMutation = trpc.workshop.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchWorkshops();
      refetchDeletedWorkshops();
    },
    onError: (error) => toast.error(error.message),
  });

  const restoreLineMutation = trpc.line.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchLines();
      refetchDeletedLines();
    },
    onError: (error) => toast.error(error.message),
  });

  const restoreStationMutation = trpc.station.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchStations();
      refetchDeletedStations();
    },
    onError: (error) => toast.error(error.message),
  });

  const restoreMachineMutation = trpc.machine.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchMachines();
      refetchDeletedMachines();
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
    const workshop = workshops?.find(w => w.id === line.workshopId);
    setEditLineFactoryId(workshop ? String(workshop.factoryId) : "");
    setEditingLine(line);
    setEditLineDialogOpen(true);
  };

  const handleEditStation = (station: Station) => {
    const line = lines?.find(l => l.id === station.lineId);
    const workshop = line ? workshops?.find(w => w.id === line.workshopId) : null;
    setEditStationWorkshopId(line ? String(line.workshopId) : "");
    setEditStationFactoryId(workshop ? String(workshop.factoryId) : "");
    setEditingStation(station);
    setEditStationDialogOpen(true);
  };

  const handleEditMachine = (machine: Machine) => {
    const station = stations?.find(s => s.id === machine.stationId);
    const line = station ? lines?.find(l => l.id === station.lineId) : null;
    const workshop = line ? workshops?.find(w => w.id === line.workshopId) : null;
    setEditMachineLineId(station ? String(station.lineId) : "");
    setEditMachineWorkshopId(line ? String(line.workshopId) : "");
    setEditMachineFactoryId(workshop ? String(workshop.factoryId) : "");
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
      <PageContainer>
        <PageHeader
          icon={<Database className="h-6 w-6" />}
          title={t("dataSettings.title")}
          description={t("dataSettings.description")}
        />

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

              {/* Category: Tools */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('tools')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-green-500" />
                    <span>Công cụ</span>
                  </div>
                  {collapsedCategories['tools'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['tools'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('seed-data')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'seed-data' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Plus className="h-4 w-4" />
                      Tạo dữ liệu mẫu
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
                    <CardDescription>{t("settings.factoryCount", { count: filteredFactories.length })} {factorySearch && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="nhà máy"
                    templateData={[{ code: "F001", name: "Factory 1", description: "", address: "", region: "", country: "", isActive: true }]}
                    templateFilename="factories_template.xlsx"
                    onImport={async (data, replaceIfExists) => importFactoriesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportFactoriesMutation.mutateAsync()}
                    onImportComplete={() => refetchFactories()}
                  />
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
                        <DialogDescription className="sr-only">{t("settings.addFactoryNew")}</DialogDescription>
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
                </div>
              </CardHeader>
              <CardContent>
                {isAdmin && (
                  <div className="flex items-center gap-2 mb-4">
                    <Switch id="show-deleted" checked={showDeleted} onCheckedChange={setShowDeleted} />
                    <Label htmlFor="show-deleted" className="text-sm text-muted-foreground flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      {t("settings.showDeleted")}
                    </Label>
                  </div>
                )}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder={t("dataSettings.searchFactoryPlaceholder")}
                      value={factorySearch}
                      onChange={(e) => setFactorySearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  {filteredFactories.map((factory) => (
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
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive hover:text-destructive"
                          onClick={() => setFactoryToDelete(factory)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {/* Deleted factories (admin) */}
                  {showDeleted && isAdmin && deletedFactories && deletedFactories.length > 0 && (
                    <>
                      <div className="border-t pt-3 mt-3">
                        <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                      </div>
                      {deletedFactories.map((factory: Factory) => (
                        <div key={factory.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{factory.name}</p>
                              <p className="text-sm text-muted-foreground">{factory.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreFactoryMutation.mutate({ id: factory.id })}
                            disabled={restoreFactoryMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {filteredFactories.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">{factorySearch ? t("common.noResults") : t("settings.noFactory")}</p>
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
                    <CardDescription>{t("settings.workshopCount", { count: filteredWorkshops.length })} {(workshopSearch || workshopFilterFactory !== "all") && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="phân xưởng"
                    templateData={[{ factoryCode: "F001", code: "W001", name: "Workshop 1", description: "", isActive: true }]}
                    templateFilename="workshops_template.xlsx"
                    onImport={async (data, replaceIfExists) => importWorkshopsMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportWorkshopsMutation.mutateAsync()}
                    onImportComplete={() => refetchWorkshops()}
                  />
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
                        <DialogDescription className="sr-only">{t("settings.addWorkshopNew")}</DialogDescription>
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
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder={t("dataSettings.searchWorkshopPlaceholder")}
                      value={workshopSearch}
                      onChange={(e) => setWorkshopSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={workshopFilterFactory} onValueChange={setWorkshopFilterFactory}>
                    <SelectTrigger className="w-50">
                      <SelectValue placeholder={t("dataSettings.filterByFactory")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all")} {t("dashboard.factory").toLowerCase()}</SelectItem>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  {filteredWorkshops.map((workshop) => {
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
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => setWorkshopToDelete(workshop)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {/* Deleted workshops (admin) */}
                  {showDeleted && isAdmin && deletedWorkshops && deletedWorkshops.length > 0 && (
                    <>
                      <div className="border-t pt-3 mt-3">
                        <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                      </div>
                      {deletedWorkshops.map((workshop: Workshop) => (
                        <div key={workshop.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Warehouse className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{workshop.name}</p>
                              <p className="text-sm text-muted-foreground">{workshop.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreWorkshopMutation.mutate({ id: workshop.id })}
                            disabled={restoreWorkshopMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {filteredWorkshops.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">{(workshopSearch || workshopFilterFactory !== "all") ? t("common.noResults") : t("settings.noWorkshop")}</p>
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
                    <CardDescription>{t("settings.lineCount", { count: filteredLines.length })} {(lineSearch || lineFilterWorkshop !== "all") && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="dây chuyền"
                    templateData={[{ workshopCode: "W001", code: "L001", name: "Line 1", description: "", capacityPerHour: 100, maxConcurrentOrders: 1, isActive: true }]}
                    templateFilename="lines_template.xlsx"
                    onImport={async (data, replaceIfExists) => importLinesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportLinesMutation.mutateAsync()}
                    onImportComplete={() => refetchLines()}
                  />
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
                        <DialogDescription className="sr-only">{t("settings.addLineNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={lineForm.factoryId} onValueChange={(v) => setLineForm({ ...lineForm, factoryId: v, workshopId: "" })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.workshop")} *</label>
                          <Select value={lineForm.workshopId} onValueChange={(v) => setLineForm({ ...lineForm, workshopId: v })} disabled={!lineForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={lineForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === lineForm.factoryId).map((w) => (
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
                          onClick={() => createLineMutation.mutate({ code: lineForm.code, name: lineForm.name, description: lineForm.description, workshopId: parseInt(lineForm.workshopId) })}
                          disabled={createLineMutation.isPending}
                        >
                          {createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder={t("dataSettings.searchLinePlaceholder")}
                      value={lineSearch}
                      onChange={(e) => setLineSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={lineFilterWorkshop} onValueChange={setLineFilterWorkshop}>
                    <SelectTrigger className="w-50">
                      <SelectValue placeholder={t("dataSettings.filterByWorkshop")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all")} {t("dashboard.workshop").toLowerCase()}</SelectItem>
                      {workshops?.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  {filteredLines.map((line) => {
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
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => setLineToDelete(line)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {/* Deleted lines (admin) */}
                  {showDeleted && isAdmin && deletedLines && deletedLines.length > 0 && (
                    <>
                      <div className="border-t pt-3 mt-3">
                        <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                      </div>
                      {deletedLines.map((line: any) => (
                        <div key={line.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <GitBranch className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{line.name}</p>
                              <p className="text-sm text-muted-foreground">{line.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreLineMutation.mutate({ id: line.id })}
                            disabled={restoreLineMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {filteredLines.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">{(lineSearch || lineFilterWorkshop !== "all") ? t("common.noResults") : t("settings.noLine")}</p>
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
                    <CardDescription>{t("settings.stationCount", { count: filteredStations.length })} {(stationSearch || stationFilterLine !== "all") && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="trạm"
                    templateData={[{ lineCode: "L001", code: "S001", name: "Station 1", description: "", orderIndex: 1, isActive: true }]}
                    templateFilename="stations_template.xlsx"
                    onImport={async (data, replaceIfExists) => importStationsMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportStationsMutation.mutateAsync()}
                    onImportComplete={() => refetchStations()}
                  />
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
                        <DialogDescription className="sr-only">{t("settings.addStationNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={stationForm.factoryId} onValueChange={(v) => setStationForm({ ...stationForm, factoryId: v, workshopId: "", lineId: "" })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.workshop")} *</label>
                          <Select value={stationForm.workshopId} onValueChange={(v) => setStationForm({ ...stationForm, workshopId: v, lineId: "" })} disabled={!stationForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={stationForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === stationForm.factoryId).map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.line")} *</label>
                          <Select value={stationForm.lineId} onValueChange={(v) => setStationForm({ ...stationForm, lineId: v })} disabled={!stationForm.workshopId}>
                            <SelectTrigger><SelectValue placeholder={stationForm.workshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                            <SelectContent>
                              {lines?.filter(l => String(l.workshopId) === stationForm.workshopId).map((l) => (
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
                            code: stationForm.code, 
                            name: stationForm.name, 
                            description: stationForm.description,
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
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder={t("dataSettings.searchStationPlaceholder")}
                      value={stationSearch}
                      onChange={(e) => setStationSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={stationFilterLine} onValueChange={setStationFilterLine}>
                    <SelectTrigger className="w-50">
                      <SelectValue placeholder={t("dataSettings.filterByLine")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all")} {t("dashboard.line").toLowerCase()}</SelectItem>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  {filteredStations.map((station) => {
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
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => setStationToDelete(station)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {/* Deleted stations (admin) */}
                  {showDeleted && isAdmin && deletedStations && deletedStations.length > 0 && (
                    <>
                      <div className="border-t pt-3 mt-3">
                        <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                      </div>
                      {deletedStations.map((station: any) => (
                        <div key={station.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Cpu className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{station.name}</p>
                              <p className="text-sm text-muted-foreground">{station.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreStationMutation.mutate({ id: station.id })}
                            disabled={restoreStationMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {filteredStations.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">{(stationSearch || stationFilterLine !== "all") ? t("common.noResults") : t("settings.noStation")}</p>
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
                    <CardDescription>{t("settings.machineCount", { count: filteredMachines.length })} {(machineSearch || machineFilterStation !== "all" || machineFilterType !== "all") && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="máy"
                    templateData={[{ stationCode: "S001", code: "M001", name: "Machine 1", machineType: "AVI", model: "", manufacturer: "", isActive: true }]}
                    templateFilename="machines_template.xlsx"
                    onImport={async (data, replaceIfExists) => importMachinesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportMachinesMutation.mutateAsync()}
                    onImportComplete={() => refetchMachines()}
                  />
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
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={machineForm.factoryId} onValueChange={(v) => setMachineForm({ ...machineForm, factoryId: v, workshopId: "", lineId: "", stationId: "" })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.workshop")} *</label>
                          <Select value={machineForm.workshopId} onValueChange={(v) => setMachineForm({ ...machineForm, workshopId: v, lineId: "", stationId: "" })} disabled={!machineForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === machineForm.factoryId).map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.line")} *</label>
                          <Select value={machineForm.lineId} onValueChange={(v) => setMachineForm({ ...machineForm, lineId: v, stationId: "" })} disabled={!machineForm.workshopId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.workshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                            <SelectContent>
                              {lines?.filter(l => String(l.workshopId) === machineForm.workshopId).map((l) => (
                                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.sidebar.workstation")} *</label>
                          <Select value={machineForm.stationId} onValueChange={(v) => setMachineForm({ ...machineForm, stationId: v })} disabled={!machineForm.lineId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.lineId ? t("settings.selectStation") : t("dataSettings.selectLineFirst")} /></SelectTrigger>
                            <SelectContent>
                              {stations?.filter(s => String(s.lineId) === machineForm.lineId).map((s) => (
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
                          <Select value={machineForm.machineType} onValueChange={(v: MachineType) => setMachineForm({ ...machineForm, machineType: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MACHINE_TYPES.map((mt) => (
                                <SelectItem key={mt} value={mt}>{machineTypeLabel(t, mt)}</SelectItem>
                              ))}
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
                            code: machineForm.code, 
                            name: machineForm.name, 
                            description: machineForm.description,
                            machineType: machineForm.machineType,
                            model: machineForm.model,
                            manufacturer: machineForm.manufacturer,
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
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder={t("dataSettings.searchMachinePlaceholder")}
                      value={machineSearch}
                      onChange={(e) => setMachineSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={machineFilterStation} onValueChange={setMachineFilterStation}>
                    <SelectTrigger className="w-50">
                      <SelectValue placeholder={t("dataSettings.filterByStation")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all")} {t("settings.sidebar.workstation").toLowerCase()}</SelectItem>
                      {stations?.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={machineFilterType} onValueChange={setMachineFilterType}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder={t("dataSettings.filterByType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all")} {t("settings.machineType").toLowerCase()}</SelectItem>
                      {machineTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  {filteredMachines.map((machine) => {
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
                  {filteredMachines.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">{(machineSearch || machineFilterStation !== "all" || machineFilterType !== "all") ? t("common.noResults") : t("settings.noMachine")}</p>
                  )}
                  {/* Deleted machines (admin) */}
                  {showDeleted && isAdmin && deletedMachines && deletedMachines.length > 0 && (
                    <>
                      <div className="border-t pt-3 mt-3">
                        <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                      </div>
                      {deletedMachines.map((machine: any) => (
                        <div key={machine.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Cpu className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{machine.name}</p>
                              <p className="text-sm text-muted-foreground">{machine.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreMachineMutation.mutate({ id: machine.id })}
                            disabled={restoreMachineMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
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
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("settings.tableCode")}</TableHead>
                        <TableHead>{t("settings.tableShiftName")}</TableHead>
                        <TableHead>{t("settings.tableFactory")}</TableHead>
                        <TableHead>{t("settings.tableTime")}</TableHead>
                        <TableHead>{t("settings.tableStatus")}</TableHead>
                        <TableHead className="text-right">{t("settings.tableActions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shifts?.map((shift) => (
                        <TableRow key={shift.id}>
                          <TableCell className="font-mono text-sm">{shift.code}</TableCell>
                          <TableCell className="font-medium">{shift.name}</TableCell>
                          <TableCell>
                            {shift.factoryId
                              ? factories?.find(f => f.id === shift.factoryId)?.name || t('common.na')
                              : <span className="text-muted-foreground">{t("settings.entireSystem")}</span>
                            }
                          </TableCell>
                          <TableCell>
                            <span className="font-mono">
                              {String(shift.startHour).padStart(2, '0')}:{String(shift.startMinute).padStart(2, '0')}
                              {' - '}
                              {String(shift.endHour).padStart(2, '0')}:{String(shift.endMinute).padStart(2, '0')}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={shift.isActive ? 'border-success/30 bg-success/15 text-success' : 'text-muted-foreground'}
                            >
                              {shift.isActive ? t('settings.shiftActive') : t('settings.shiftPaused')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
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
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!shifts || shifts.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={6} className="p-8 text-center text-muted-foreground">{t("settings.noShifts")}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
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

          {/* Product Categories Tab */}
          <TabsContent value="product-categories">
            <ProductCategoryManagement />
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

          {/* Seed Data Tab */}
          <TabsContent value="seed-data">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-green-500" />
                  Tạo dữ liệu mẫu
                </CardTitle>
                <CardDescription>
                  Tạo dữ liệu mẫu để kiểm tra và demo hệ thống. Chỉ dùng trên môi trường phát triển.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-dashed">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Dữ liệu cơ sở</CardTitle>
                      <CardDescription className="text-xs">Tạo nhà máy, dây chuyền, máy móc và sản phẩm mẫu</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => seedDataMutation.mutate()}
                        disabled={seedDataMutation.isPending}
                        className="w-full"
                        variant="outline"
                      >
                        {seedDataMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang tạo...</> : 'Tạo dữ liệu cơ sở'}
                      </Button>
                    </CardContent>
                  </Card>
                  <Card className="border-dashed">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Dữ liệu kiểm tra</CardTitle>
                      <CardDescription className="text-xs">Tạo 100 bản ghi kiểm tra mẫu (OK/NG)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => seedInspectionsMutation.mutate({ count: 100 })}
                        disabled={seedInspectionsMutation.isPending}
                        className="w-full"
                        variant="outline"
                      >
                        {seedInspectionsMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang tạo...</> : 'Tạo 100 bản ghi kiểm tra'}
                      </Button>
                    </CardContent>
                  </Card>
                  <Card className="border-dashed">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Phân tích trạm làm việc</CardTitle>
                      <CardDescription className="text-xs">Tạo 500 bản ghi phân tích 7 ngày gần đây</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => seedWorkstationAnalyticsMutation.mutate({ inspectionCount: 500, daysBack: 7 })}
                        disabled={seedWorkstationAnalyticsMutation.isPending}
                        className="w-full"
                        variant="outline"
                      >
                        {seedWorkstationAnalyticsMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang tạo...</> : 'Tạo dữ liệu phân tích'}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  ⚠️ Dữ liệu mẫu sẽ được thêm vào cơ sở dữ liệu hiện tại. Đảm bảo đã có cấu hình nhà máy và sản phẩm trước khi tạo dữ liệu kiểm tra.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

            </div>
          </div>
        </Tabs>
        </ErrorBoundary>
      </PageContainer>

      {/* Edit Stage Dialog */}
      <Dialog open={editStageDialogOpen} onOpenChange={setEditStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.editStage")}</DialogTitle>
            <DialogDescription className="sr-only">{t("settings.editStage")}</DialogDescription>
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
            <DialogDescription className="sr-only">{t("settings.editFactory")}</DialogDescription>
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
            <DialogDescription className="sr-only">{t("settings.editWorkshop")}</DialogDescription>
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
            <DialogDescription className="sr-only">{t("settings.editLine")}</DialogDescription>
          </DialogHeader>
          {editingLine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.factory")}</label>
                <Select 
                  value={editLineFactoryId} 
                  onValueChange={(v) => {
                    setEditLineFactoryId(v);
                    setEditingLine({ ...editingLine, workshopId: 0 });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                  <SelectContent>
                    {factories?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.workshop")}</label>
                <Select 
                  value={String(editingLine.workshopId)} 
                  onValueChange={(v) => setEditingLine({ ...editingLine, workshopId: parseInt(v) })}
                  disabled={!editLineFactoryId}
                >
                  <SelectTrigger><SelectValue placeholder={editLineFactoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                  <SelectContent>
                    {workshops?.filter(w => String(w.factoryId) === editLineFactoryId).map((w) => (
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
            <DialogDescription className="sr-only">{t("settings.editStation")}</DialogDescription>
          </DialogHeader>
          {editingStation && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.factory")}</label>
                <Select 
                  value={editStationFactoryId} 
                  onValueChange={(v) => {
                    setEditStationFactoryId(v);
                    setEditStationWorkshopId("");
                    setEditingStation({ ...editingStation, lineId: 0 });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                  <SelectContent>
                    {factories?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.workshop")}</label>
                <Select 
                  value={editStationWorkshopId} 
                  onValueChange={(v) => {
                    setEditStationWorkshopId(v);
                    setEditingStation({ ...editingStation, lineId: 0 });
                  }}
                  disabled={!editStationFactoryId}
                >
                  <SelectTrigger><SelectValue placeholder={editStationFactoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                  <SelectContent>
                    {workshops?.filter(w => String(w.factoryId) === editStationFactoryId).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.line")}</label>
                <Select 
                  value={String(editingStation.lineId)} 
                  onValueChange={(v) => setEditingStation({ ...editingStation, lineId: parseInt(v) })}
                  disabled={!editStationWorkshopId}
                >
                  <SelectTrigger><SelectValue placeholder={editStationWorkshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                  <SelectContent>
                    {lines?.filter(l => String(l.workshopId) === editStationWorkshopId).map((l) => (
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
            <DialogDescription className="sr-only">{t("settings.editShift")}</DialogDescription>
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
            <DialogDescription className="sr-only">{t("settings.editMachine")}</DialogDescription>
          </DialogHeader>
          {editingMachine && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.factory")}</label>
                <Select 
                  value={editMachineFactoryId} 
                  onValueChange={(v) => {
                    setEditMachineFactoryId(v);
                    setEditMachineWorkshopId("");
                    setEditMachineLineId("");
                    setEditingMachine({ ...editingMachine, stationId: 0 });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                  <SelectContent>
                    {factories?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.workshop")}</label>
                <Select 
                  value={editMachineWorkshopId} 
                  onValueChange={(v) => {
                    setEditMachineWorkshopId(v);
                    setEditMachineLineId("");
                    setEditingMachine({ ...editingMachine, stationId: 0 });
                  }}
                  disabled={!editMachineFactoryId}
                >
                  <SelectTrigger><SelectValue placeholder={editMachineFactoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                  <SelectContent>
                    {workshops?.filter(w => String(w.factoryId) === editMachineFactoryId).map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dashboard.line")}</label>
                <Select 
                  value={editMachineLineId} 
                  onValueChange={(v) => {
                    setEditMachineLineId(v);
                    setEditingMachine({ ...editingMachine, stationId: 0 });
                  }}
                  disabled={!editMachineWorkshopId}
                >
                  <SelectTrigger><SelectValue placeholder={editMachineWorkshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                  <SelectContent>
                    {lines?.filter(l => String(l.workshopId) === editMachineWorkshopId).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("settings.sidebar.workstation")}</label>
                <Select 
                  value={String(editingMachine.stationId)} 
                  onValueChange={(v) => setEditingMachine({ ...editingMachine, stationId: parseInt(v) })}
                  disabled={!editMachineLineId}
                >
                  <SelectTrigger><SelectValue placeholder={editMachineLineId ? t("settings.selectStation") : t("dataSettings.selectLineFirst")} /></SelectTrigger>
                  <SelectContent>
                    {stations?.filter(s => String(s.lineId) === editMachineLineId).map((s) => (
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

      {/* Cascade Delete Dialogs for hierarchy entities */}
      <CascadeDeleteDialog
        open={!!factoryToDelete}
        onOpenChange={(open) => !open && setFactoryToDelete(null)}
        entityType="factory"
        entityName={factoryToDelete?.name}
        cascadeInfo={factoryCascadeInfo}
        isLoadingInfo={factoryCascadeLoading}
        onDeleteSingle={() => factoryToDelete && deleteFactoryMutation.mutate({ id: factoryToDelete.id })}
        onDeleteCascade={() => factoryToDelete && deleteFactoryMutation.mutate({ id: factoryToDelete.id, cascade: true })}
        isDeleting={deleteFactoryMutation.isPending}
      />

      <CascadeDeleteDialog
        open={!!workshopToDelete}
        onOpenChange={(open) => !open && setWorkshopToDelete(null)}
        entityType="workshop"
        entityName={workshopToDelete?.name}
        cascadeInfo={workshopCascadeInfo}
        isLoadingInfo={workshopCascadeLoading}
        onDeleteSingle={() => workshopToDelete && deleteWorkshopMutation.mutate({ id: workshopToDelete.id })}
        onDeleteCascade={() => workshopToDelete && deleteWorkshopMutation.mutate({ id: workshopToDelete.id, cascade: true })}
        isDeleting={deleteWorkshopMutation.isPending}
      />

      <CascadeDeleteDialog
        open={!!lineToDelete}
        onOpenChange={(open) => !open && setLineToDelete(null)}
        entityType="line"
        entityName={lineToDelete?.name}
        cascadeInfo={lineCascadeInfo}
        isLoadingInfo={lineCascadeLoading}
        onDeleteSingle={() => lineToDelete && deleteLineMutation.mutate({ id: lineToDelete.id })}
        onDeleteCascade={() => lineToDelete && deleteLineMutation.mutate({ id: lineToDelete.id, cascade: true })}
        isDeleting={deleteLineMutation.isPending}
      />

      <CascadeDeleteDialog
        open={!!stationToDelete}
        onOpenChange={(open) => !open && setStationToDelete(null)}
        entityType="station"
        entityName={stationToDelete?.name}
        cascadeInfo={stationCascadeInfo}
        isLoadingInfo={stationCascadeLoading}
        onDeleteSingle={() => stationToDelete && deleteStationMutation.mutate({ id: stationToDelete.id })}
        onDeleteCascade={() => stationToDelete && deleteStationMutation.mutate({ id: stationToDelete.id, cascade: true })}
        isDeleting={deleteStationMutation.isPending}
      />
    </DashboardLayout>
  );
}
