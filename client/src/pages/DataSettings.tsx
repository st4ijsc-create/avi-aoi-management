import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { type MachineType } from "@/constants/machineTypes";

import {
  Building2,
  Warehouse,
  GitBranch,
  Cpu,
  Plus,
  Copy,
  RotateCcw,
  Loader2,
  Database,
  Clock,
  Upload,
  Image,
  X,
  ChevronDown,
  ChevronRight,
  Factory,
  Cog,
  Package,
  Workflow,
  ArrowRight,
  LayoutGrid,
  Network,
  ShieldCheck
} from "lucide-react";
import { navItems } from "@/lib/navigation";
// doc 47 IA Đợt 2 — "Tổng quan": cây mô hình nhà máy + bảng kiểm tra cấu hình.
import { FactoryTree } from "@/components/factoryConfig/FactoryTree";
import { ConfigHealthPanel } from "@/components/factoryConfig/ConfigHealthPanel";
import { FactoryConfigImportExport } from "@/components/factoryConfig/FactoryConfigImportExport";
import { FactoryConfigAudit } from "@/components/factoryConfig/FactoryConfigAudit";
import { FactorySetupWizard } from "@/components/factoryConfig/FactorySetupWizard";
import { SeedDataTab } from "@/components/factoryConfig/SeedDataTab";
import { FactoriesTab } from "@/components/factoryConfig/FactoriesTab";
import { WorkshopsTab } from "@/components/factoryConfig/WorkshopsTab";
import { LinesTab } from "@/components/factoryConfig/LinesTab";
import { StationsTab } from "@/components/factoryConfig/StationsTab";
import { MachinesTab } from "@/components/factoryConfig/MachinesTab";
import { ShiftsTab } from "@/components/factoryConfig/ShiftsTab";
import { StagesTab } from "@/components/factoryConfig/StagesTab";
import type { NavTarget } from "@/components/factoryConfig/factoryModel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
// doc 47 IA Đợt 1 — the products/process managers now live only at their own routes
// (/products, /product-mapping, /process-management, /workstation-management). The hub
// links out to them via the "Liên kết nhanh" cards instead of re-embedding them here.

import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";
import { CascadeDeleteDialog } from "@/components/CascadeDeleteDialog";
import { History } from "lucide-react";

// Row types kept LOCAL here (identical to components/factoryConfig/entityTypes.ts, which
// the extracted tab components import). Local `type Factory` coexists with the lucide
// `Factory` icon value-import via TS's separate type/value namespaces; an `import type`
// would collide. Structural typing makes both definitions interchangeable across props.
type Factory = { id: number; code: string; name: string; address?: string | null; description?: string | null };
type Workshop = { id: number; factoryId: number; code: string; name: string; description?: string | null };
type Line = { id: number; workshopId: number; code: string; name: string; description?: string | null };
type Station = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null };
type Machine = { id: number; stationId: number; code: string; name: string; machineType: string; apiKey?: string | null; model?: string | null; manufacturer?: string | null; image2DUrl?: string | null; image3DUrl?: string | null; [key: string]: any };
type ShiftConfig = { id: number; factoryId?: number | null; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number; isActive: boolean; orderIndex: number };
type LineStage = { id: number; lineId: number; code: string; name: string; orderIndex: number; description?: string | null; stationId?: number | null };

export default function DataSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // doc 47 RBAC — factory config is gated by the `settings_factory` permission (per the
  // matrix: admin + engineer), not a hardcoded admin-role check. Server hierarchy CRUD is
  // aligned to requirePermission("settings_factory", …). canView opens the hub;
  // canManage (canEdit) shows create/edit/delete + deleted-items controls (server still
  // enforces canCreate/canEdit/canDelete per action).
  const { hasPermission } = usePermissions();
  const canViewFactoryConfig = isAdmin || hasPermission("settings_factory", "canView");
  const canManageFactory = isAdmin || hasPermission("settings_factory", "canEdit");

  const search = useSearch();
  const [location, setLocation] = useLocation();
  
  // Parse tab from URL query parameter
  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    // doc 47 IA Đợt 2 — "Tổng quan" là tab mặc định khi không có ?tab=.
    return params.get('tab') || 'overview';
  };
  
  const [activeTab, setActiveTab] = useState(getTabFromUrl);
  // doc 47 Đợt 3 — guided top-down factory-setup wizard (opened from Overview).
  const [wizardOpen, setWizardOpen] = useState(false);
  
  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/datasettings?tab=${tab}`);
  };

  // doc 47 IA Đợt 2 — "Sửa →" từ cây/bảng-health: mở đúng tab CRUD + lọc sẵn theo cha
  // (tái dùng cơ chế chuyển-tab + bộ lọc dropdown sẵn có của hub).
  const handleConfigNavigate = (target: NavTarget) => {
    switch (target.level) {
      case "factory":
        handleTabChange("factories");
        break;
      case "workshop":
        if (target.factoryId != null) setWorkshopFilterFactory(String(target.factoryId));
        handleTabChange("workshops");
        break;
      case "line":
        if (target.workshopId != null) setLineFilterWorkshop(String(target.workshopId));
        handleTabChange("lines");
        break;
      case "station":
        if (target.lineId != null) setStationFilterLine(String(target.lineId));
        handleTabChange("stations");
        break;
      case "machine":
        if (target.stationId != null) setMachineFilterStation(String(target.stationId));
        handleTabChange("machines");
        break;
    }
  };
  
  // Sync tab with URL on mount and URL changes. doc 47 IA Đợt 1 — the products/process
  // managers no longer live here; old deep-links redirect to their single-home routes so
  // no ?tab= link lands on a dead/empty tab.
  const TAB_REDIRECTS: Record<string, string> = {
    'mapping': '/monitoring-setting?tab=device-management',
    'product-models': '/products',
    'product-categories': '/products',
    'product-machine-mapping': '/product-mapping',
    'process-management': '/process-management',
    'workstations': '/workstation-management',
    'workstation-mgmt': '/workstation-management',
  };
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    const redirect = TAB_REDIRECTS[tabFromUrl];
    if (redirect) {
      setLocation(redirect);
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

  // Bộ lọc dropdown (tìm-kiếm-văn-bản đã chuyển sang thanh search của DataTable).
  const [workshopFilterFactory, setWorkshopFilterFactory] = useState("all");
  const [lineFilterWorkshop, setLineFilterWorkshop] = useState("all");
  const [stationFilterLine, setStationFilterLine] = useState("all");
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
  const { data: workshops, refetch: refetchWorkshops, error: workshopsError, isLoading: workshopsLoading } = trpc.workshop.list.useQuery();
  const { data: lines, refetch: refetchLines, error: linesError, isLoading: linesLoading } = trpc.line.list.useQuery();
  const { data: stations, refetch: refetchStations, isLoading: stationsLoading } = trpc.station.list.useQuery();
  const { data: machines, refetch: refetchMachines, isLoading: machinesLoading } = trpc.machine.list.useQuery();
  // machine.list không còn trả apiKey (doc 42 theme 10) — lấy key theo-máy khi cần.
  const trpcUtils = trpc.useUtils();
  const { data: shifts, refetch: refetchShifts, isLoading: shiftsLoading } = trpc.shiftConfig.list.useQuery();
  const { data: stages, refetch: refetchStages, isLoading: stagesLoading } = trpc.lineStage.list.useQuery();

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
  // apiKey cho dialog sửa máy — fetch theo-máy (chi tiết khác apiKey; doc 54 P0-1
  // getById KHÔNG còn trả apiKey — key chỉ lộ 1 lần qua regenerate admin bên dưới).
  const { data: editingMachineDetail } = trpc.machine.getById.useQuery(
    { id: editingMachine?.id ?? 0 },
    { enabled: !!editingMachine }
  );
  // doc 54 P0-1 — the only way to obtain a machine key is the admin-only rotate.
  const regenApiKeyMutation = trpc.machine.regenerateApiKey.useMutation();

  // Deleted items queries (admin only, enabled when toggle is on)
  const { data: deletedFactories, refetch: refetchDeletedFactories } = trpc.factory.listDeleted.useQuery(undefined, { enabled: showDeleted && canManageFactory });
  const { data: deletedWorkshops, refetch: refetchDeletedWorkshops } = trpc.workshop.listDeleted.useQuery(undefined, { enabled: showDeleted && canManageFactory });
  const { data: deletedLines, refetch: refetchDeletedLines } = trpc.line.listDeleted.useQuery(undefined, { enabled: showDeleted && canManageFactory });
  const { data: deletedStations, refetch: refetchDeletedStations } = trpc.station.listDeleted.useQuery(undefined, { enabled: showDeleted && canManageFactory });
  const { data: deletedMachines, refetch: refetchDeletedMachines } = trpc.machine.listDeleted.useQuery(undefined, { enabled: showDeleted && canManageFactory });

  // Dữ liệu đã lọc theo bộ lọc dropdown (tìm-kiếm-văn-bản do DataTable đảm nhận).
  const filteredFactories = useMemo(() => (factories ?? []) as Factory[], [factories]);

  const filteredWorkshops = useMemo(() => {
    if (!workshops) return [];
    return workshops.filter((w: any) => workshopFilterFactory === "all" || String(w.factoryId) === workshopFilterFactory);
  }, [workshops, workshopFilterFactory]);

  const filteredLines = useMemo(() => {
    if (!lines) return [];
    return lines.filter((l: any) => lineFilterWorkshop === "all" || String(l.workshopId) === lineFilterWorkshop);
  }, [lines, lineFilterWorkshop]);

  const filteredStations = useMemo(() => {
    if (!stations) return [];
    return stations.filter((s: any) => stationFilterLine === "all" || String(s.lineId) === stationFilterLine);
  }, [stations, stationFilterLine]);

  const filteredMachines = useMemo(() => {
    if (!machines) return [];
    return machines.filter((m: any) => {
      if (machineFilterStation !== "all" && String(m.stationId) !== machineFilterStation) return false;
      if (machineFilterType !== "all" && m.machineType !== machineFilterType) return false;
      return true;
    });
  }, [machines, machineFilterStation, machineFilterType]);

  const machineTypes = useMemo(() => {
    if (!machines) return [];
    const types = new Set(machines.map((m: any) => m.machineType).filter(Boolean));
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
    onError: (error) => toastTrpcError(error),
  });

  const createWorkshopMutation = trpc.workshop.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createWorkshopSuccess"));
      setWorkshopDialogOpen(false);
      setWorkshopForm({ factoryId: "", code: "", name: "", description: "" });
      refetchWorkshops();
    },
    onError: (error) => toastTrpcError(error),
  });

  const createLineMutation = trpc.line.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createLineSuccess"));
      setLineDialogOpen(false);
      setLineForm({ factoryId: "", workshopId: "", code: "", name: "", description: "" });
      refetchLines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const createStationMutation = trpc.station.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createStationSuccess"));
      setStationDialogOpen(false);
      setStationForm({ factoryId: "", workshopId: "", lineId: "", code: "", name: "", description: "", orderIndex: "0" });
      refetchStations();
    },
    onError: (error) => toastTrpcError(error),
  });

  const createMachineMutation = trpc.machine.create.useMutation({
    onSuccess: (data) => {
      toast.success(t("settings.createMachineSuccessWithKey", { apiKey: data.apiKey }));
      setMachineDialogOpen(false);
      setMachineForm({ factoryId: "", workshopId: "", lineId: "", stationId: "", code: "", name: "", machineType: "AVI", model: "", manufacturer: "", description: "" });
      refetchMachines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const createShiftMutation = trpc.shiftConfig.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createShiftSuccess"));
      setShiftDialogOpen(false);
      setShiftForm({ factoryId: "", name: "", code: "", startHour: "6", startMinute: "0", endHour: "14", endMinute: "0", orderIndex: "0" });
      refetchShifts();
    },
    onError: (error) => toastTrpcError(error),
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
    onError: (error) => toastTrpcError(error),
  });

  const updateWorkshopMutation = trpc.workshop.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateWorkshopSuccess"));
      setEditWorkshopDialogOpen(false);
      setEditingWorkshop(null);
      refetchWorkshops();
    },
    onError: (error) => toastTrpcError(error),
  });

  const updateLineMutation = trpc.line.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateLineSuccess"));
      setEditLineDialogOpen(false);
      setEditingLine(null);
      refetchLines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const updateStationMutation = trpc.station.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateStationSuccess"));
      setEditStationDialogOpen(false);
      setEditingStation(null);
      refetchStations();
    },
    onError: (error) => toastTrpcError(error),
  });

  const updateMachineMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateMachineSuccess"));
      setEditMachineDialogOpen(false);
      setEditingMachine(null);
      refetchMachines();
    },
    onError: (error) => toastTrpcError(error),
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
      toastTrpcError(error);
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
    onError: (error) => toastTrpcError(error),
  });

  // Delete Mutations
  const deleteFactoryMutation = trpc.factory.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteFactorySuccess"));
      setFactoryToDelete(null);
      refetchFactories();
      if (showDeleted) refetchDeletedFactories();
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteWorkshopMutation = trpc.workshop.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteWorkshopSuccess"));
      setWorkshopToDelete(null);
      refetchWorkshops();
      if (showDeleted) refetchDeletedWorkshops();
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteLineMutation = trpc.line.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteLineSuccess"));
      setLineToDelete(null);
      refetchLines();
      if (showDeleted) refetchDeletedLines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteStationMutation = trpc.station.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteStationSuccess"));
      setStationToDelete(null);
      refetchStations();
      if (showDeleted) refetchDeletedStations();
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteMachineMutation = trpc.machine.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteMachineSuccess"));
      refetchMachines();
      if (showDeleted) refetchDeletedMachines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteShiftMutation = trpc.shiftConfig.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteShiftSuccess"));
      refetchShifts();
    },
    onError: (error) => toastTrpcError(error),
  });

  // Restore mutations
  const restoreFactoryMutation = trpc.factory.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchFactories();
      refetchDeletedFactories();
    },
    onError: (error) => toastTrpcError(error),
  });

  const restoreWorkshopMutation = trpc.workshop.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchWorkshops();
      refetchDeletedWorkshops();
    },
    onError: (error) => toastTrpcError(error),
  });

  const restoreLineMutation = trpc.line.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchLines();
      refetchDeletedLines();
    },
    onError: (error) => toastTrpcError(error),
  });

  const restoreStationMutation = trpc.station.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchStations();
      refetchDeletedStations();
    },
    onError: (error) => toastTrpcError(error),
  });

  const restoreMachineMutation = trpc.machine.restore.useMutation({
    onSuccess: () => {
      toast.success(t("settings.restoreSuccess"));
      refetchMachines();
      refetchDeletedMachines();
    },
    onError: (error) => toastTrpcError(error),
  });

  // Stage mutations
  const createStageMutation = trpc.lineStage.create.useMutation({
    onSuccess: () => {
      toast.success(t("settings.createStageSuccess"));
      refetchStages();
      setStageDialogOpen(false);
      setStageForm({ lineId: "", code: "", name: "", description: "", orderIndex: "0", stationId: "" });
    },
    onError: (error) => toastTrpcError(error),
  });

  const updateStageMutation = trpc.lineStage.update.useMutation({
    onSuccess: () => {
      toast.success(t("settings.updateStageSuccess"));
      refetchStages();
      setEditStageDialogOpen(false);
      setEditingStage(null);
    },
    onError: (error) => toastTrpcError(error),
  });

  const deleteStageMutation = trpc.lineStage.delete.useMutation({
    onSuccess: () => {
      toast.success(t("settings.deleteStageSuccess"));
      refetchStages();
    },
    onError: (error) => toastTrpcError(error),
  });

  const reorderStageMutation = trpc.lineStage.reorder.useMutation({
    onSuccess: () => {
      toast.success(t("settings.reorderSuccess"));
      refetchStages();
    },
    onError: (error: { message: string }) => toastTrpcError(error),
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

  // Thanh điều hướng 12 tab nội trang (khôi phục sau doc 36 ẩn menu dọc + doc 39 gỡ sidebar).
  // Nhãn/icon lấy đúng từ legacy menu bên dưới để không lệch ngữ nghĩa.
  const tabGroups = [
    {
      id: "overview",
      label: t("dataSettings.overview.catLabel", "Tổng quan"),
      icon: <LayoutGrid className="h-3.5 w-3.5 text-teal-500" />,
      items: [
        { value: "overview", label: t("dataSettings.overview.tabLabel", "Tổng quan"), icon: <LayoutGrid className="h-3.5 w-3.5" /> },
      ],
    },
    {
      id: "infrastructure",
      label: t("settings.cat.infrastructure"),
      icon: <Factory className="h-3.5 w-3.5 text-blue-500" />,
      items: [
        { value: "factories", label: t("settings.sidebar.factory"), icon: <Building2 className="h-3.5 w-3.5" /> },
        { value: "workshops", label: t("settings.sidebar.workshop"), icon: <Warehouse className="h-3.5 w-3.5" /> },
        { value: "lines", label: t("settings.sidebar.line"), icon: <GitBranch className="h-3.5 w-3.5" /> },
        { value: "stations", label: t("settings.sidebar.inspectionStation"), icon: <Cpu className="h-3.5 w-3.5" /> },
        { value: "machines", label: t("settings.sidebar.inspectionMachine"), icon: <Cpu className="h-3.5 w-3.5" /> },
      ],
    },
    {
      id: "production",
      label: t("settings.cat.production"),
      icon: <Cog className="h-3.5 w-3.5 text-green-500" />,
      items: [
        { value: "shifts", label: t("settings.sidebar.shift"), icon: <Clock className="h-3.5 w-3.5" /> },
        { value: "stages", label: t("settings.sidebar.stage"), icon: <GitBranch className="h-3.5 w-3.5" /> },
      ],
    },
    {
      id: "tools",
      label: t("dataSettings.cat.tools", "Công cụ & Nhật ký"),
      icon: <Database className="h-3.5 w-3.5 text-green-500" />,
      items: [
        // doc 47 Đợt 3 — bulk import/export (round-trip Excel/CSV) + config change audit.
        { value: "import-export", label: t("factoryIO.tabLabel", "Nhập / Xuất"), icon: <ArrowRight className="h-3.5 w-3.5" /> },
        { value: "config-audit", label: t("factoryConfigAudit.tabLabel", "Nhật ký thay đổi"), icon: <History className="h-3.5 w-3.5" /> },
        { value: "seed-data", label: t("dataSettings.sidebar.seedData", "Tạo dữ liệu mẫu"), icon: <Plus className="h-3.5 w-3.5" /> },
      ],
    },
  ];

  // doc 47 IA Đợt 1 — the hub LINKS OUT to config pages that have their own single home
  // (instead of re-embedding their managers, which caused menu/route duplication).
  const quickLinks = [
    { href: "/layout", title: t("dataSettings.quickLinks.layout"), description: t("dataSettings.quickLinks.layoutDesc"), icon: <Factory className="h-5 w-5" /> },
    { href: "/workstation-management", title: t("dataSettings.quickLinks.workstation"), description: t("dataSettings.quickLinks.workstationDesc"), icon: <Warehouse className="h-5 w-5" /> },
    { href: "/process-management", title: t("dataSettings.quickLinks.process"), description: t("dataSettings.quickLinks.processDesc"), icon: <Workflow className="h-5 w-5" /> },
    { href: "/products", title: t("dataSettings.quickLinks.products"), description: t("dataSettings.quickLinks.productsDesc"), icon: <Package className="h-5 w-5" /> },
    { href: "/product-mapping", title: t("dataSettings.quickLinks.productMapping"), description: t("dataSettings.quickLinks.productMappingDesc"), icon: <Cpu className="h-5 w-5" /> },
  ];

  if (!canViewFactoryConfig) {
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

        {/* doc 47 IA Đợt 1 — "Liên kết nhanh": the hub links out to config pages that
            have their own single home, instead of re-embedding their managers. */}
        <Card className="glass-card mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRight className="h-4 w-4 text-primary" />
              {t("dataSettings.quickLinks.title")}
            </CardTitle>
            <CardDescription>{t("dataSettings.quickLinks.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {quickLinks.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => setLocation(link.href)}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-card/50 p-4 text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  <span className="mt-0.5 shrink-0 text-primary">{link.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{link.title}</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-sm text-primary opacity-70 transition-opacity group-hover:opacity-100">
                        {t("dataSettings.quickLinks.open")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{link.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          {/* Thanh điều hướng 12 tab nội trang — khôi phục điều hướng bị mất sau doc 36/39 */}
          <div className="mb-6 space-y-2 border-b border-border/60 pb-4">
            {tabGroups.map((group) => (
              <div key={group.id} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.icon}
                  {group.label}
                </span>
                {group.items.map((item) => {
                  const isActive = activeTab === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleTabChange(item.value)}
                      aria-current={isActive ? "page" : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex gap-6">
            {/* Vertical Sidebar Navigation */}
            <div className="hidden" data-legacy-hub-menu="true">

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

              {/* doc 47 IA Đợt 1 — Products + Process categories removed here (moved to
                  their own routes; the hub links out via the Quick-links cards). */}

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

          {/* doc 47 IA Đợt 2 — "Tổng quan": cây mô hình nhà máy + bảng kiểm tra cấu hình.
              Cạnh nhau trên màn rộng (xl), xếp chồng trên màn hẹp. */}
          <TabsContent value="overview">
            {/* doc 47 Đợt 3 — guided factory-setup wizard trigger */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="text-sm text-muted-foreground">
                {t("dataSettings.overview.wizardHint", "Dựng nhà máy mới từ trên xuống bằng trình hướng dẫn — Nhà máy → Xưởng → Dây chuyền → Trạm → Máy.")}
              </div>
              <Button onClick={() => setWizardOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t("dataSettings.overview.wizardBtn", "Dựng nhà máy")}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Network className="h-4 w-4 text-primary" />
                    {t("dataSettings.overview.treeTitle", "Mô hình nhà máy")}
                  </CardTitle>
                  <CardDescription>
                    {t("dataSettings.overview.treeDesc", "Cây phân cấp Nhà máy → Xưởng → Dây chuyền → Trạm → Máy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FactoryTree onNavigate={handleConfigNavigate} />
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    {t("dataSettings.overview.healthTitle", "Kiểm tra cấu hình")}
                  </CardTitle>
                  <CardDescription>
                    {t("dataSettings.overview.healthDesc", "Phát hiện lỗ hổng cấu hình từ dữ liệu thật (chỉ đọc)")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ConfigHealthPanel onNavigate={handleConfigNavigate} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Factories Tab */}
          <TabsContent value="factories">
            <FactoriesTab
              filteredFactories={filteredFactories}
              factories={factories}
              factoriesLoading={factoriesLoading}
              deletedFactories={deletedFactories}
              isAdmin={canManageFactory}
              showDeleted={showDeleted}
              setShowDeleted={setShowDeleted}
              factoryDialogOpen={factoryDialogOpen}
              setFactoryDialogOpen={setFactoryDialogOpen}
              factoryForm={factoryForm}
              setFactoryForm={setFactoryForm}
              createFactoryMutation={createFactoryMutation}
              importFactoriesMutation={importFactoriesMutation}
              exportFactoriesMutation={exportFactoriesMutation}
              refetchFactories={refetchFactories}
              handleEditFactory={handleEditFactory}
              setFactoryToDelete={setFactoryToDelete}
              restoreFactoryMutation={restoreFactoryMutation}
            />
          </TabsContent>

          {/* Workshops Tab */}
          <TabsContent value="workshops">
            <WorkshopsTab
              filteredWorkshops={filteredWorkshops}
              workshops={workshops}
              workshopsLoading={workshopsLoading}
              deletedWorkshops={deletedWorkshops}
              factories={factories}
              isAdmin={canManageFactory}
              showDeleted={showDeleted}
              workshopFilterFactory={workshopFilterFactory}
              setWorkshopFilterFactory={setWorkshopFilterFactory}
              workshopDialogOpen={workshopDialogOpen}
              setWorkshopDialogOpen={setWorkshopDialogOpen}
              workshopForm={workshopForm}
              setWorkshopForm={setWorkshopForm}
              createWorkshopMutation={createWorkshopMutation}
              importWorkshopsMutation={importWorkshopsMutation}
              exportWorkshopsMutation={exportWorkshopsMutation}
              refetchWorkshops={refetchWorkshops}
              handleEditWorkshop={handleEditWorkshop}
              setWorkshopToDelete={setWorkshopToDelete}
              restoreWorkshopMutation={restoreWorkshopMutation}
            />
          </TabsContent>

          {/* Lines Tab */}
          <TabsContent value="lines">
            <LinesTab
              filteredLines={filteredLines}
              lines={lines}
              linesLoading={linesLoading}
              deletedLines={deletedLines}
              factories={factories}
              workshops={workshops}
              isAdmin={canManageFactory}
              showDeleted={showDeleted}
              lineFilterWorkshop={lineFilterWorkshop}
              setLineFilterWorkshop={setLineFilterWorkshop}
              lineDialogOpen={lineDialogOpen}
              setLineDialogOpen={setLineDialogOpen}
              lineForm={lineForm}
              setLineForm={setLineForm}
              createLineMutation={createLineMutation}
              importLinesMutation={importLinesMutation}
              exportLinesMutation={exportLinesMutation}
              refetchLines={refetchLines}
              handleEditLine={handleEditLine}
              setLineToDelete={setLineToDelete}
              restoreLineMutation={restoreLineMutation}
            />
          </TabsContent>

          {/* Stations Tab */}
          <TabsContent value="stations">
            <StationsTab
              filteredStations={filteredStations}
              stations={stations}
              stationsLoading={stationsLoading}
              deletedStations={deletedStations}
              factories={factories}
              workshops={workshops}
              lines={lines}
              isAdmin={canManageFactory}
              showDeleted={showDeleted}
              stationFilterLine={stationFilterLine}
              setStationFilterLine={setStationFilterLine}
              stationDialogOpen={stationDialogOpen}
              setStationDialogOpen={setStationDialogOpen}
              stationForm={stationForm}
              setStationForm={setStationForm}
              createStationMutation={createStationMutation}
              importStationsMutation={importStationsMutation}
              exportStationsMutation={exportStationsMutation}
              refetchStations={refetchStations}
              handleEditStation={handleEditStation}
              setStationToDelete={setStationToDelete}
              restoreStationMutation={restoreStationMutation}
            />
          </TabsContent>

          {/* Machines Tab */}
          <TabsContent value="machines">
            <MachinesTab
              filteredMachines={filteredMachines}
              machines={machines}
              machinesLoading={machinesLoading}
              deletedMachines={deletedMachines}
              factories={factories}
              workshops={workshops}
              lines={lines}
              stations={stations}
              machineTypes={machineTypes}
              isAdmin={canManageFactory}
              showDeleted={showDeleted}
              machineFilterStation={machineFilterStation}
              setMachineFilterStation={setMachineFilterStation}
              machineFilterType={machineFilterType}
              setMachineFilterType={setMachineFilterType}
              machineDialogOpen={machineDialogOpen}
              setMachineDialogOpen={setMachineDialogOpen}
              machineForm={machineForm}
              setMachineForm={setMachineForm}
              createMachineMutation={createMachineMutation}
              importMachinesMutation={importMachinesMutation}
              exportMachinesMutation={exportMachinesMutation}
              refetchMachines={refetchMachines}
              copyToClipboard={copyToClipboard}
              handleEditMachine={handleEditMachine}
              setMachineToDelete={setMachineToDelete}
              setDeleteMachineDialogOpen={setDeleteMachineDialogOpen}
              restoreMachineMutation={restoreMachineMutation}
            />
          </TabsContent>

          {/* Shifts Tab */}
          <TabsContent value="shifts">
            <ShiftsTab
              shifts={shifts}
              shiftsLoading={shiftsLoading}
              factories={factories}
              shiftValidation={shiftValidation}
              shiftDialogOpen={shiftDialogOpen}
              setShiftDialogOpen={setShiftDialogOpen}
              shiftForm={shiftForm}
              setShiftForm={setShiftForm}
              createShiftMutation={createShiftMutation}
              setEditingShift={setEditingShift}
              setEditShiftDialogOpen={setEditShiftDialogOpen}
              setShiftToDelete={setShiftToDelete}
              setDeleteShiftDialogOpen={setDeleteShiftDialogOpen}
            />
          </TabsContent>

          {/* Stages Tab */}
          <TabsContent value="stages">
            <StagesTab
              stages={stages}
              stagesLoading={stagesLoading}
              lines={lines}
              stations={stations}
              canManageFactory={canManageFactory}
              stageValidation={stageValidation}
              stageDialogOpen={stageDialogOpen}
              setStageDialogOpen={setStageDialogOpen}
              stageForm={stageForm}
              setStageForm={setStageForm}
              createStageMutation={createStageMutation}
              reorderStageMutation={reorderStageMutation}
              draggedStageId={draggedStageId}
              setDraggedStageId={setDraggedStageId}
              setEditingStage={setEditingStage}
              setEditStageDialogOpen={setEditStageDialogOpen}
              setStageToDelete={setStageToDelete}
              setDeleteStageDialogOpen={setDeleteStageDialogOpen}
            />
          </TabsContent>

          {/* doc 47 IA Đợt 1 — product-categories / product-machine-mapping /
              process-management / workstation-mgmt tab bodies removed; those managers
              now live only at their own routes and are reached via the Quick-links cards.
              Old ?tab= deep-links redirect (see TAB_REDIRECTS above). */}

          {/* Seed Data Tab */}
          {/* doc 47 Đợt 3 — bulk import/export (round-trip Excel/CSV) */}
          <TabsContent value="import-export">
            <FactoryConfigImportExport />
          </TabsContent>

          {/* doc 47 Đợt 3 — factory-config change audit (read-only, from audit_logs) */}
          <TabsContent value="config-audit">
            <FactoryConfigAudit />
          </TabsContent>

          <TabsContent value="seed-data">
            <SeedDataTab />
          </TabsContent>

            </div>
          </div>
        </Tabs>
        </ErrorBoundary>

        {/* doc 47 Đợt 3 — guided factory-setup wizard (top-down create) */}
        <FactorySetupWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onComplete={() => refetchFactories()}
        />
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
                  {/* doc 54 P0-1 — stored key is never read back; show masked + rotate-to-reveal. */}
                  <Input value={"•••••••• (ẩn — bấm tạo lại để lộ 1 lần)"} disabled className="bg-muted font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!editingMachineDetail?.id || regenApiKeyMutation.isPending}
                    title={t("settings.regenApiKey", "Tạo lại & sao chép key")}
                    onClick={async () => {
                      if (!editingMachineDetail?.id) return;
                      if (!window.confirm(t("settings.regenApiKeyConfirm", "Tạo lại API key sẽ VÔ HIỆU key hiện tại của máy cho tới khi cấu hình lại. Tiếp tục?"))) return;
                      const res = await regenApiKeyMutation.mutateAsync({ id: editingMachineDetail.id });
                      copyToClipboard(res?.apiKey || '');
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
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
