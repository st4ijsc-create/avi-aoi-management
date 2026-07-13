import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, StatusBadge, EmptyState } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
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
import type { NavTarget } from "@/components/factoryConfig/factoryModel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
// doc 47 IA Đợt 1 — the products/process managers now live only at their own routes
// (/products, /product-mapping, /process-management, /workstation-management). The hub
// links out to them via the "Liên kết nhanh" cards instead of re-embedding them here.
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
import { RotateCcw, Eye, History } from "lucide-react";

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
  // apiKey cho dialog sửa máy — fetch theo-máy (list đã bỏ apiKey khỏi payload)
  const { data: editingMachineDetail } = trpc.machine.getById.useQuery(
    { id: editingMachine?.id ?? 0 },
    { enabled: !!editingMachine }
  );

  // Deleted items queries (admin only, enabled when toggle is on)
  const { data: deletedFactories, refetch: refetchDeletedFactories } = trpc.factory.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedWorkshops, refetch: refetchDeletedWorkshops } = trpc.workshop.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedLines, refetch: refetchDeletedLines } = trpc.line.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedStations, refetch: refetchDeletedStations } = trpc.station.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });
  const { data: deletedMachines, refetch: refetchDeletedMachines } = trpc.machine.listDeleted.useQuery(undefined, { enabled: showDeleted && isAdmin });

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

  // Seed Data Mutations
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu cơ sở mẫu thành công!'),
    onError: (error) => toastTrpcError(error),
  });

  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: () => toast.success('Đã tạo 100 bản ghi kiểm tra mẫu thành công!'),
    onError: (error) => toastTrpcError(error),
  });

  const seedWorkstationAnalyticsMutation = trpc.seedData.seedWorkstationAnalytics.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu phân tích trạm làm việc mẫu thành công!'),
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
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.factoryList")}</CardTitle>
                    <CardDescription>{t("settings.factoryCount", { count: filteredFactories.length })}</CardDescription>
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
                <DataTable<Factory>
                  data={filteredFactories}
                  getRowId={(f) => f.id}
                  loading={factoriesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchFactoryPlaceholder")}
                  emptyState={(factories?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Building2}
                      title={t("settings.noFactory")}
                      description={t("dataSettings.emptyFactoryDesc", "Chưa có nhà máy nào. Tạo nhà máy đầu tiên để bắt đầu.")}
                      actionLabel={t("settings.addFactory")}
                      onAction={() => setFactoryDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.factoryName"), cell: (f) => <span className="font-medium text-foreground">{f.name}</span>, sortValue: (f) => f.name, filterValue: (f) => f.name },
                    { id: "code", header: t("settings.factoryCode"), width: "160px", cell: (f) => <span className="font-mono text-sm text-muted-foreground">{f.code}</span>, sortValue: (f) => f.code, filterValue: (f) => f.code },
                    { id: "address", header: t("settings.address"), cell: (f) => <span className="text-sm text-muted-foreground">{f.address || t("common.na")}</span>, filterValue: (f) => f.address || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (f) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditFactory(f)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setFactoryToDelete(f)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted factories (admin) */}
                {showDeleted && isAdmin && deletedFactories && deletedFactories.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
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
                  </div>
                )}
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
                    <CardDescription>{t("settings.workshopCount", { count: filteredWorkshops.length })} {workshopFilterFactory !== "all" && `(${t("common.filtered")})`}</CardDescription>
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
                <DataTable<Workshop>
                  data={filteredWorkshops}
                  getRowId={(w) => w.id}
                  loading={workshopsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchWorkshopPlaceholder")}
                  toolbar={
                    <Select value={workshopFilterFactory} onValueChange={setWorkshopFilterFactory}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByFactory")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.factory").toLowerCase()}</SelectItem>
                        {factories?.map((f) => (
                          <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(workshops?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Warehouse}
                      title={t("settings.noWorkshop")}
                      description={t("dataSettings.emptyWorkshopDesc", "Chưa có phân xưởng nào. Thêm phân xưởng để tổ chức nhà máy.")}
                      actionLabel={t("settings.addWorkshop")}
                      onAction={() => setWorkshopDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.workshopName"), cell: (w) => <span className="font-medium text-foreground">{w.name}</span>, sortValue: (w) => w.name, filterValue: (w) => w.name },
                    { id: "code", header: t("settings.workshopCode"), width: "160px", cell: (w) => <span className="font-mono text-sm text-muted-foreground">{w.code}</span>, sortValue: (w) => w.code, filterValue: (w) => w.code },
                    { id: "factory", header: t("dashboard.factory"), cell: (w) => <span className="text-sm text-muted-foreground">{factories?.find(f => f.id === w.factoryId)?.name || t("common.na")}</span>, sortValue: (w) => factories?.find(f => f.id === w.factoryId)?.name || "", filterValue: (w) => factories?.find(f => f.id === w.factoryId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (w) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditWorkshop(w)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setWorkshopToDelete(w)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted workshops (admin) */}
                {showDeleted && isAdmin && deletedWorkshops && deletedWorkshops.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
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
                  </div>
                )}
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
                    <CardDescription>{t("settings.lineCount", { count: filteredLines.length })} {lineFilterWorkshop !== "all" && `(${t("common.filtered")})`}</CardDescription>
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
                <DataTable<Line>
                  data={filteredLines}
                  getRowId={(l) => l.id}
                  loading={linesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchLinePlaceholder")}
                  toolbar={
                    <Select value={lineFilterWorkshop} onValueChange={setLineFilterWorkshop}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByWorkshop")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.workshop").toLowerCase()}</SelectItem>
                        {workshops?.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(lines?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={GitBranch}
                      title={t("settings.noLine")}
                      description={t("dataSettings.emptyLineDesc", "Chưa có dây chuyền nào. Thêm dây chuyền vào phân xưởng.")}
                      actionLabel={t("settings.addLine")}
                      onAction={() => setLineDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.lineName"), cell: (l) => <span className="font-medium text-foreground">{l.name}</span>, sortValue: (l) => l.name, filterValue: (l) => l.name },
                    { id: "code", header: t("settings.lineCode"), width: "160px", cell: (l) => <span className="font-mono text-sm text-muted-foreground">{l.code}</span>, sortValue: (l) => l.code, filterValue: (l) => l.code },
                    { id: "workshop", header: t("dashboard.workshop"), cell: (l) => <span className="text-sm text-muted-foreground">{workshops?.find(w => w.id === l.workshopId)?.name || t("common.na")}</span>, sortValue: (l) => workshops?.find(w => w.id === l.workshopId)?.name || "", filterValue: (l) => workshops?.find(w => w.id === l.workshopId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (l) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditLine(l)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setLineToDelete(l)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted lines (admin) */}
                {showDeleted && isAdmin && deletedLines && deletedLines.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
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
                  </div>
                )}
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
                    <CardDescription>{t("settings.stationCount", { count: filteredStations.length })} {stationFilterLine !== "all" && `(${t("common.filtered")})`}</CardDescription>
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
                <DataTable<Station>
                  data={filteredStations}
                  getRowId={(s) => s.id}
                  loading={stationsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchStationPlaceholder")}
                  initialSort={{ columnId: "order", dir: "asc" }}
                  toolbar={
                    <Select value={stationFilterLine} onValueChange={setStationFilterLine}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByLine")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.line").toLowerCase()}</SelectItem>
                        {lines?.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(stations?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Cpu}
                      title={t("settings.noStation")}
                      description={t("dataSettings.emptyStationDesc", "Chưa có trạm nào. Thêm trạm kiểm tra vào dây chuyền.")}
                      actionLabel={t("settings.addStation")}
                      onAction={() => setStationDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.stationName"), cell: (s) => <span className="font-medium text-foreground">{s.name}</span>, sortValue: (s) => s.name, filterValue: (s) => s.name },
                    { id: "code", header: t("settings.stationCode"), width: "160px", cell: (s) => <span className="font-mono text-sm text-muted-foreground">{s.code}</span>, sortValue: (s) => s.code, filterValue: (s) => s.code },
                    { id: "line", header: t("dashboard.line"), cell: (s) => <span className="text-sm text-muted-foreground">{lines?.find(l => l.id === s.lineId)?.name || t("common.na")}</span>, sortValue: (s) => lines?.find(l => l.id === s.lineId)?.name || "", filterValue: (s) => lines?.find(l => l.id === s.lineId)?.name || "" },
                    { id: "order", header: t("settings.order"), align: "right", width: "100px", cell: (s) => <span className="tabular-nums text-sm text-muted-foreground">{s.orderIndex.toLocaleString('vi-VN')}</span>, sortValue: (s) => s.orderIndex },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (s) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditStation(s)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setStationToDelete(s)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted stations (admin) */}
                {showDeleted && isAdmin && deletedStations && deletedStations.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
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
                  </div>
                )}
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
                    <CardDescription>{t("settings.machineCount", { count: filteredMachines.length })} {(machineFilterStation !== "all" || machineFilterType !== "all") && `(${t("common.filtered")})`}</CardDescription>
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
                <DataTable<Machine>
                  data={filteredMachines}
                  getRowId={(m) => m.id}
                  loading={machinesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchMachinePlaceholder")}
                  toolbar={
                    <>
                      <Select value={machineFilterStation} onValueChange={setMachineFilterStation}>
                        <SelectTrigger className="w-48 h-9">
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
                        <SelectTrigger className="w-40 h-9">
                          <SelectValue placeholder={t("dataSettings.filterByType")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("common.all")} {t("settings.machineType").toLowerCase()}</SelectItem>
                          {machineTypes.map((type) => (
                            <SelectItem key={type} value={type}>{machineTypeLabel(t, type as MachineType)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  }
                  emptyState={(machines?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Cpu}
                      title={t("settings.noMachine")}
                      description={t("dataSettings.emptyMachineDesc", "Chưa có máy nào. Thêm máy kiểm tra vào trạm.")}
                      actionLabel={t("settings.addMachine")}
                      onAction={() => setMachineDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.machineName"), cell: (m) => <span className="font-medium text-foreground">{m.name}</span>, sortValue: (m) => m.name, filterValue: (m) => m.name },
                    { id: "code", header: t("settings.machineCode"), width: "160px", cell: (m) => <span className="font-mono text-sm text-muted-foreground">{m.code}</span>, sortValue: (m) => m.code, filterValue: (m) => m.code },
                    { id: "type", header: t("settings.machineType"), width: "140px", cell: (m) => <StatusBadge status={m.machineType} tone="info" label={machineTypeLabel(t, m.machineType as MachineType)} />, sortValue: (m) => m.machineType, filterValue: (m) => `${m.machineType} ${machineTypeLabel(t, m.machineType as MachineType)}` },
                    { id: "station", header: t("settings.sidebar.workstation"), cell: (m) => <span className="text-sm text-muted-foreground">{stations?.find(s => s.id === m.stationId)?.name || t("common.na")}</span>, sortValue: (m) => stations?.find(s => s.id === m.stationId)?.name || "", filterValue: (m) => stations?.find(s => s.id === m.stationId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "180px", cell: (m) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={async () => {
                            const detail = await trpcUtils.machine.getById.fetch({ id: m.id });
                            copyToClipboard(detail?.apiKey || '');
                          }}
                        >
                          <Key className="h-3 w-3" />
                          {t("settings.copyApiKey")}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleEditMachine(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setMachineToDelete(m);
                            setDeleteMachineDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted machines (admin) */}
                {showDeleted && isAdmin && deletedMachines && deletedMachines.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
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
                  </div>
                )}
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
                <DataTable<ShiftConfig>
                  data={(shifts ?? []) as ShiftConfig[]}
                  getRowId={(s) => s.id}
                  loading={shiftsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchShiftPlaceholder", "Tìm ca theo tên hoặc mã…")}
                  initialSort={{ columnId: "order", dir: "asc" }}
                  emptyState={(shifts?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Clock}
                      title={t("settings.noShifts")}
                      description={t("dataSettings.emptyShiftDesc", "Chưa có ca làm việc nào. Thêm ca để cấu hình lịch sản xuất.")}
                      actionLabel={t("settings.addShift")}
                      onAction={() => setShiftDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "code", header: t("settings.tableCode"), width: "140px", cell: (s) => <span className="font-mono text-sm">{s.code}</span>, sortValue: (s) => s.code, filterValue: (s) => s.code },
                    { id: "name", header: t("settings.tableShiftName"), cell: (s) => <span className="font-medium">{s.name}</span>, sortValue: (s) => s.name, filterValue: (s) => s.name },
                    { id: "factory", header: t("settings.tableFactory"), cell: (s) => s.factoryId
                        ? <span>{factories?.find(f => f.id === s.factoryId)?.name || t('common.na')}</span>
                        : <span className="text-muted-foreground">{t("settings.entireSystem")}</span>,
                      sortValue: (s) => s.factoryId ? (factories?.find(f => f.id === s.factoryId)?.name || "") : "",
                      filterValue: (s) => s.factoryId ? (factories?.find(f => f.id === s.factoryId)?.name || "") : "" },
                    { id: "time", header: t("settings.tableTime"), width: "150px", cell: (s) => (
                      <span className="font-mono tabular-nums">
                        {String(s.startHour).padStart(2, '0')}:{String(s.startMinute).padStart(2, '0')}
                        {' - '}
                        {String(s.endHour).padStart(2, '0')}:{String(s.endMinute).padStart(2, '0')}
                      </span>
                    ), sortValue: (s) => s.startHour * 60 + s.startMinute },
                    { id: "status", header: t("settings.tableStatus"), width: "130px", cell: (s) => (
                      <StatusBadge status={s.isActive ? "active" : "paused"} tone={s.isActive ? "success" : "default"} label={s.isActive ? t('settings.shiftActive') : t('settings.shiftPaused')} />
                    ), sortValue: (s) => s.isActive ? 1 : 0 },
                    { id: "order", header: t("settings.orderDisplay"), align: "right", width: "80px", cell: (s) => <span className="tabular-nums text-sm text-muted-foreground">{s.orderIndex.toLocaleString('vi-VN')}</span>, sortValue: (s) => s.orderIndex },
                    { id: "actions", header: "", align: "right", width: "64px", cell: (s) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            setEditingShift(s);
                            setEditShiftDialogOpen(true);
                          }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t("settings.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setShiftToDelete(s);
                              setDeleteShiftDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) },
                  ]}
                />
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
                  {stagesLoading && (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">{t("common.loading", "Đang tải…")}</span>
                    </div>
                  )}
                  {!stagesLoading && (!stages || stages.length === 0) && (
                    <EmptyState
                      variant="no-data"
                      icon={GitBranch}
                      title={t("settings.noStages")}
                      description={t("dataSettings.emptyStageDesc", "Chưa có công đoạn nào. Thêm công đoạn để định nghĩa luồng sản xuất theo dây chuyền.")}
                      actionLabel={isAdmin ? t("settings.addStage") : undefined}
                      onAction={isAdmin ? () => setStageDialogOpen(true) : undefined}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
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
                  <Input value={editingMachineDetail?.apiKey || ''} disabled className="bg-muted font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(editingMachineDetail?.apiKey || '')}>
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
