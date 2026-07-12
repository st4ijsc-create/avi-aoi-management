import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, MetricCard } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
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
import {
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Server,
  Cpu,
  Copy,
  Eye,
  EyeOff,
  AlertTriangle,
  HardDrive,
  Wifi,
  WifiOff,
  Search,
  ShieldCheck,
  ShieldX,
  Info,
  Pencil,
  Undo2,
  Rocket,
  Recycle,
  QrCode,
  Printer,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { vi, zhCN, enUS } from "date-fns/locale";

type PendingMachine = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  serialNumber: string | null;
  firmwareVersion: string | null;
  registrationStatus: string;
  syncMode: string | null;
  model?: string | null;
  manufacturer?: string | null;
  createdAt: string | Date | null;
  stationId: number;
};

type AllMachine = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  registrationStatus?: string | null;
  lifecycleStatus?: string | null;
  syncMode?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  apiKey?: string | null;
  createdAt?: string | Date | null;
  stationId: number;
};

// Doc 27 Đợt 3 / W3-B (M2) — client copy of the legal transition map. The
// SERVER is the source of truth (drizzle/schema/hierarchy.ts,
// MACHINE_LIFECYCLE_TRANSITIONS); this mirror only pre-filters the dialog's
// options — an out-of-date choice still fails server-side with CONFLICT.
const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  commissioning: ["active"],
  active: ["maintenance", "decommissioned"],
  maintenance: ["active", "decommissioned"],
  decommissioned: ["retired", "active"],
  retired: [],
};
const LIFECYCLE_REASON_REQUIRED = ["decommissioned", "retired"];

export function MachineRegistrationContent() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("pending");

  const dateFnsLocale = i18n.language === 'vi' ? vi : i18n.language === 'zh' ? zhCN : enUS;

  // ── F9 (doc 27 Đợt 5 / W5-E) — server-side search + pagination ──────────
  const PAGE_SIZE = 50;
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  // Search / tab changes restart at page 1.
  useEffect(() => { setPage(1); }, [debouncedSearch, activeTab]);

  // Bulk approve (pending tab) — multi-select re-using machine.approve per id.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  // Approve dialog
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<PendingMachine | null>(null);
  const [approveCode, setApproveCode] = useState("");
  const [approveName, setApproveName] = useState("");
  const [approveStationId, setApproveStationId] = useState<number | undefined>();

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectMachine, setRejectMachineState] = useState<PendingMachine | null>(null);

  // Revoke dialog
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeMachine, setRevokeMachine] = useState<AllMachine | null>(null);

  // Edit approved machine dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMachine, setEditMachine] = useState<AllMachine | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editStationId, setEditStationId] = useState<number | undefined>();

  // Lifecycle dialog (doc 27 Đợt 3 / W3-B — M2)
  const [lifecycleDialogOpen, setLifecycleDialogOpen] = useState(false);
  const [lifecycleMachine, setLifecycleMachine] = useState<AllMachine | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<string>("");
  const [lifecycleReason, setLifecycleReason] = useState("");

  // API Key visibility
  const [visibleApiKeys, setVisibleApiKeys] = useState<Set<number>>(new Set());

  // ── QR asset-tag (doc 40 Wave 4, persona operator) ────────────────────────
  // Generate scan-to-open QR labels encoding the machine profile URL
  // (`/machine/:id`). A technician sticks the printed tag on the machine and
  // scans it to open the full cockpit. Uses the already-installed `qrcode` dep
  // (dynamic import → out of the main bundle).
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrItems, setQrItems] = useState<
    Array<{ id: number; code: string; name: string; url: string; dataUrl: string }>
  >([]);

  const openQrDialog = async (targets: Array<{ id: number; code: string; name: string }>) => {
    if (targets.length === 0) {
      toast.info(t('machineRegistration.qr.noMachines', 'Không có máy nào để tạo QR'));
      return;
    }
    setQrItems([]);
    setQrDialogOpen(true);
    setQrLoading(true);
    try {
      const QRCode = await import('qrcode');
      const origin = window.location.origin;
      const items = await Promise.all(
        targets.map(async (m) => {
          const url = `${origin}/machine/${m.id}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 1 });
          return { id: m.id, code: m.code, name: m.name, url, dataUrl };
        }),
      );
      setQrItems(items);
    } catch (err) {
      console.error('QR generation failed', err);
      toast.error(t('machineRegistration.qr.genError', 'Không tạo được mã QR'));
      setQrDialogOpen(false);
    } finally {
      setQrLoading(false);
    }
  };

  // Queries
  const pendingQuery = trpc.machine.listPending.useQuery();
  // F9: the table tabs read a PAGED server-side query (search + status filter +
  // limit/offset) instead of filtering the full machine.list client-side.
  const listStatusForTab =
    activeTab === "approved" ? ("approved" as const)
    : activeTab === "rejected" ? ("rejected" as const)
    : undefined;
  const pagedQuery = trpc.machine.listPaged.useQuery({
    search: debouncedSearch || undefined,
    registrationStatus: listStatusForTab,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const summaryQuery = trpc.machine.registrationSummary.useQuery();
  const stationsQuery = trpc.station.list.useQuery();
  const utils = trpc.useUtils();

  const invalidateMachines = () => {
    utils.machine.listPending.invalidate();
    utils.machine.list.invalidate();
    utils.machine.listPaged.invalidate();
    utils.machine.registrationSummary.invalidate();
  };

  // Mutations
  const approveMutation = trpc.machine.approve.useMutation({
    onSuccess: (data) => {
      toast.success(t('machineRegistration.toast.approveSuccess'), {
        description: t('machineRegistration.toast.approveSuccessDesc', { apiKey: data.apiKey?.substring(0, 20) }),
      });
      setApproveDialogOpen(false);
      setSelectedMachine(null);
      invalidateMachines();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.approveError'), { description: err.message });
    },
  });

  const rejectMutation = trpc.machine.reject.useMutation({
    onSuccess: () => {
      toast.success(t('machineRegistration.toast.rejectSuccess'));
      setRejectDialogOpen(false);
      setRejectMachineState(null);
      setRejectReason("");
      invalidateMachines();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.rejectError'), { description: err.message });
    },
  });

  // Revoke approval (set back to pending)
  const revokeApprovalMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success(t('machineRegistration.toast.revokeSuccess'));
      setRevokeDialogOpen(false);
      setRevokeMachine(null);
      invalidateMachines();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.revokeError'), { description: err.message });
    },
  });

  // Set lifecycle status (M2). CONFLICT (illegal transition / duplicate code)
  // surfaces err.message from the server as the toast description.
  const setLifecycleMutation = trpc.machine.setLifecycleStatus.useMutation({
    onSuccess: (data) => {
      toast.success(t('machineRegistration.lifecycle.toast.success', {
        status: t(`machineRegistration.lifecycle.status.${data.lifecycleStatus}`),
      }));
      setLifecycleDialogOpen(false);
      setLifecycleMachine(null);
      setLifecycleReason("");
      invalidateMachines();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.lifecycle.toast.error'), { description: err.message });
    },
  });

  // Edit approved machine
  const editMachineMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success(t('machineRegistration.toast.editSuccess'));
      setEditDialogOpen(false);
      setEditMachine(null);
      invalidateMachines();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.editError'), { description: err.message });
    },
  });

  const pendingMachines = (pendingQuery.data ?? []) as PendingMachine[];
  // F9 — page of machines for the current tab (search/status applied server-side).
  const pagedMachines = (pagedQuery.data?.items ?? []) as AllMachine[];
  const pagedTotal = pagedQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(pagedTotal / PAGE_SIZE));
  const registrationSummary = summaryQuery.data ?? { pending: 0, approved: 0, rejected: 0, total: 0 };

  // Handlers
  const handleOpenApprove = (machine: PendingMachine) => {
    setSelectedMachine(machine);
    setApproveCode(machine.code?.startsWith("SN-") ? "" : machine.code);
    setApproveName(machine.name);
    setApproveStationId(machine.stationId);
    setApproveDialogOpen(true);
  };

  const handleApprove = () => {
    if (!selectedMachine) return;
    approveMutation.mutate({
      id: selectedMachine.id,
      code: approveCode || undefined,
      name: approveName || undefined,
      stationId: approveStationId,
    });
  };

  const handleOpenReject = (machine: PendingMachine) => {
    setRejectMachineState(machine);
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const handleReject = () => {
    if (!rejectMachine) return;
    rejectMutation.mutate({
      id: rejectMachine.id,
      reason: rejectReason || undefined,
    });
  };

  const handleOpenRevoke = (machine: AllMachine) => {
    setRevokeMachine(machine);
    setRevokeDialogOpen(true);
  };

  // ── F9 — bulk approve: one machine.approve call per selected id (no code /
  // name / station overrides — the existing values are kept; individual
  // failures are counted and reported, not silently swallowed). ─────────────
  const bulkApproveMutation = trpc.machine.approve.useMutation();
  const toggleBulkSelected = (id: number) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleBulkApprove = async () => {
    const ids = pendingMachines.filter((m) => bulkSelected.has(m.id)).map((m) => m.id);
    if (ids.length === 0) return;
    setIsBulkApproving(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await bulkApproveMutation.mutateAsync({ id });
        ok++;
      } catch {
        failed++;
      }
    }
    setIsBulkApproving(false);
    setBulkSelected(new Set());
    invalidateMachines();
    if (failed === 0) {
      toast.success(t('machineRegistration.bulk.approveDone', { count: ok }));
    } else {
      toast.warning(t('machineRegistration.bulk.approvePartial', { ok, fail: failed }));
    }
  };

  const handleRevoke = () => {
    if (!revokeMachine) return;
    revokeApprovalMutation.mutate({
      id: revokeMachine.id,
      registrationStatus: "pending",
    });
  };

  const handleOpenLifecycle = (machine: AllMachine) => {
    setLifecycleMachine(machine);
    const allowed = LIFECYCLE_TRANSITIONS[machine.lifecycleStatus ?? "active"] ?? [];
    setLifecycleTarget(allowed[0] ?? "");
    setLifecycleReason("");
    setLifecycleDialogOpen(true);
  };

  const handleLifecycleSave = () => {
    if (!lifecycleMachine || !lifecycleTarget) return;
    setLifecycleMutation.mutate({
      id: lifecycleMachine.id,
      status: lifecycleTarget as "commissioning" | "active" | "maintenance" | "decommissioned" | "retired",
      reason: lifecycleReason.trim() || undefined,
    });
  };

  const lifecycleAllowed = LIFECYCLE_TRANSITIONS[lifecycleMachine?.lifecycleStatus ?? "active"] ?? [];
  const lifecycleReasonMissing =
    LIFECYCLE_REASON_REQUIRED.includes(lifecycleTarget) && lifecycleReason.trim().length === 0;

  const handleOpenEdit = (machine: AllMachine) => {
    setEditMachine(machine);
    setEditCode(machine.code);
    setEditName(machine.name);
    setEditStationId(machine.stationId);
    setEditDialogOpen(true);
  };

  const handleEditSave = () => {
    if (!editMachine) return;
    editMachineMutation.mutate({
      id: editMachine.id,
      name: editName || undefined,
      stationId: editStationId,
    });
  };

  const toggleApiKeyVisibility = (machineId: number) => {
    setVisibleApiKeys((prev) => {
      const next = new Set(prev);
      if (next.has(machineId)) next.delete(machineId);
      else next.add(machineId);
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('machineRegistration.actions.copyApiKey'));
  };

  const getStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "approved":
        return (
          <Badge variant="outline" className="border-success/30 bg-success/15 text-success">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {t('machineRegistration.status.approved')}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
            <Clock className="h-3 w-3 mr-1" /> {t('machineRegistration.status.pending')}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">
            <XCircle className="h-3 w-3 mr-1" /> {t('machineRegistration.status.rejected')}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <AlertTriangle className="h-3 w-3 mr-1" /> {t('machineRegistration.status.unregistered')}
          </Badge>
        );
    }
  };

  // M2 — asset lifecycle badge (semantic tones, mirrors getStatusBadge style)
  const getLifecycleBadge = (status: string | null | undefined) => {
    const s = status ?? "active";
    const label = t(`machineRegistration.lifecycle.status.${s}`, { defaultValue: s });
    switch (s) {
      case "active":
        return (
          <Badge variant="outline" className="border-success/30 bg-success/15 text-success">{label}</Badge>
        );
      case "commissioning":
        return (
          <Badge variant="outline" className="border-info/30 bg-info/15 text-info">{label}</Badge>
        );
      case "maintenance":
        return (
          <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">{label}</Badge>
        );
      case "retired":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">{label}</Badge>
        );
      case "decommissioned":
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">{label}</Badge>
        );
    }
  };

  const getSyncModeBadge = (mode: string | null | undefined) => {
    if (mode === "online") {
      return (
        <Badge variant="outline" className="border-success/30 text-success">
          <Wifi className="h-3 w-3 mr-1" /> {t('machineRegistration.sync.online')}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <WifiOff className="h-3 w-3 mr-1" /> {t('machineRegistration.sync.offline')}
      </Badge>
    );
  };

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    try {
      const d = typeof date === "string" ? new Date(date) : date;
      return format(d, "dd/MM/yyyy HH:mm");
    } catch {
      return "—";
    }
  };

  const formatTimeAgo = (date: string | Date | null | undefined) => {
    if (!date) return "";
    try {
      const d = typeof date === "string" ? new Date(date) : date;
      return formatDistanceToNow(d, { addSuffix: true, locale: dateFnsLocale });
    } catch {
      return "";
    }
  };

  const stations = stationsQuery.data ?? [];

  return (
    <>
      <PageContainer>
        {/* Header — DS PageHeader (shared pattern) */}
        <PageHeader
          icon={<HardDrive className="h-6 w-6" />}
          title={t('machineRegistration.pageTitle')}
          description={t('machineRegistration.pageSubtitle')}
          actions={
            <>
              <Button
                size="sm"
                onClick={() => navigate("/machine-onboarding")}
              >
                <Rocket className="h-4 w-4 mr-1" /> {t('machineRegistration.openWizard')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagedMachines.length === 0}
                onClick={() => openQrDialog(pagedMachines)}
              >
                <QrCode className="h-4 w-4 mr-1" /> {t('machineRegistration.qr.bulkButton', 'In QR hàng loạt')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  pendingQuery.refetch();
                  pagedQuery.refetch();
                  summaryQuery.refetch();
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> {t('machineRegistration.refresh')}
              </Button>
            </>
          }
        />

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<Clock className="h-5 w-5" />}
            label={t('machineRegistration.summary.pending')}
            value={pendingMachines.length}
            tone={pendingMachines.length > 0 ? "warning" : "default"}
          />
          <MetricCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label={t('machineRegistration.summary.approved')}
            value={registrationSummary.approved}
            tone="success"
          />
          <MetricCard
            icon={<XCircle className="h-5 w-5" />}
            label={t('machineRegistration.summary.rejected')}
            value={registrationSummary.rejected}
            tone={registrationSummary.rejected > 0 ? "error" : "default"}
          />
          <MetricCard
            icon={<Server className="h-5 w-5" />}
            label={t('machineRegistration.summary.total')}
            value={registrationSummary.total}
            tone="info"
          />
        </div>

        {/* Main content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="pending" className="gap-1">
              <Clock className="h-4 w-4" />
              {t('machineRegistration.tabs.pending')}
              {pendingMachines.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {pendingMachines.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-1">
              <Server className="h-4 w-4" />
              {t('machineRegistration.tabs.all')}
            </TabsTrigger>
            <TabsTrigger value="approved" className="gap-1">
              <ShieldCheck className="h-4 w-4" />
              {t('machineRegistration.tabs.approved')}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="gap-1">
              <ShieldX className="h-4 w-4" />
              {t('machineRegistration.tabs.rejected')}
            </TabsTrigger>
          </TabsList>

          {/* ── Pending Tab ── */}
          <TabsContent value="pending" className="space-y-4">
            {pendingMachines.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-success mb-3" />
                  <h3 className="text-lg font-medium">{t('machineRegistration.pendingTab.emptyTitle')}</h3>
                  <p className="text-muted-foreground mt-1">
                    {t('machineRegistration.pendingTab.emptyDesc')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {/* F9 — bulk approve bar */}
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={bulkSelected.size > 0 && bulkSelected.size === pendingMachines.length}
                      onChange={(e) =>
                        setBulkSelected(e.target.checked
                          ? new Set(pendingMachines.map((m) => m.id))
                          : new Set())
                      }
                    />
                    {t('machineRegistration.bulk.selectAll')}
                  </label>
                  <Button
                    size="sm"
                    disabled={bulkSelected.size === 0 || isBulkApproving}
                    onClick={handleBulkApprove}
                    className="bg-success text-success-foreground hover:bg-success/90"
                  >
                    {isBulkApproving ? (
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                    )}
                    {t('machineRegistration.bulk.approveSelected', { count: bulkSelected.size })}
                  </Button>
                </div>
                {pendingMachines.map((machine) => (
                  <Card
                    key={machine.id}
                    className="border-warning/40"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            aria-label={t('machineRegistration.bulk.selectOne', { name: machine.name })}
                            checked={bulkSelected.has(machine.id)}
                            onChange={() => toggleBulkSelected(machine.id)}
                          />
                          <div className="p-2 bg-warning/15 rounded-lg">
                            <Cpu className="h-5 w-5 text-warning" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">{machine.name}</CardTitle>
                            <CardDescription>
                              S/N: {machine.serialNumber ?? machine.code}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(machine.registrationStatus)}
                          {getSyncModeBadge(machine.syncMode)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.machineType')}</p>
                          <p className="font-medium">{machine.machineType}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.model')}</p>
                          <p className="font-medium">{machine.model ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.manufacturer')}</p>
                          <p className="font-medium">{machine.manufacturer ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.firmware')}</p>
                          <p className="font-medium">{machine.firmwareVersion ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.currentCode')}</p>
                          <p className="font-medium font-mono text-sm">{machine.code}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('machineRegistration.machineCard.registeredAt')}</p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="font-medium cursor-default">
                                {formatDate(machine.createdAt)}
                              </p>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatTimeAgo(machine.createdAt)}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenReject(machine)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          {t('machineRegistration.actions.reject')}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleOpenApprove(machine)}
                          className="bg-success text-success-foreground hover:bg-success/90"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          {t('machineRegistration.actions.approveAllocate')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── All / Approved / Rejected Tabs — F9: server-side paged ── */}
          {(["all", "approved", "rejected"] as const).map((tab) => {
            const data = pagedMachines;

            return (
              <TabsContent key={tab} value={tab} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('machineRegistration.table.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {pagedQuery.isFetching && (
                    <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {t('machineRegistration.table.machineCount', { count: pagedTotal })}
                  </span>
                </div>

                <Card>
                  <CardContent className="p-0">
                    <div className="w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">{t('machineRegistration.table.id')}</TableHead>
                          <TableHead>{t('machineRegistration.table.machineCode')}</TableHead>
                          <TableHead>{t('machineRegistration.table.name')}</TableHead>
                          <TableHead>{t('machineRegistration.table.serialNumber')}</TableHead>
                          <TableHead>{t('machineRegistration.table.type')}</TableHead>
                          <TableHead>{t('machineRegistration.table.status')}</TableHead>
                          <TableHead>{t('machineRegistration.lifecycle.columnTitle')}</TableHead>
                          <TableHead>{t('machineRegistration.table.sync')}</TableHead>
                          <TableHead>{t('machineRegistration.table.firmware')}</TableHead>
                          {tab !== "rejected" && <TableHead>{t('machineRegistration.table.apiKey')}</TableHead>}
                          <TableHead className="text-right">{t('machineRegistration.table.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={tab !== "rejected" ? 11 : 10}
                              className="text-center py-8 text-muted-foreground"
                            >
                              {t('machineRegistration.table.noResults')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          data.map((machine) => (
                            <TableRow key={machine.id}>
                              <TableCell className="font-mono text-xs">
                                {machine.id}
                              </TableCell>
                              <TableCell className="font-mono font-medium">
                                {machine.code}
                              </TableCell>
                              <TableCell>{machine.name}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {machine.serialNumber ?? "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{machine.machineType}</Badge>
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(machine.registrationStatus)}
                              </TableCell>
                              <TableCell>
                                {getLifecycleBadge(machine.lifecycleStatus)}
                              </TableCell>
                              <TableCell>
                                {getSyncModeBadge(machine.syncMode)}
                              </TableCell>
                              <TableCell className="text-xs">
                                {machine.firmwareVersion ?? "—"}
                              </TableCell>
                              {tab !== "rejected" && (
                                <TableCell>
                                  {machine.apiKey ? (
                                    <div className="flex items-center gap-1">
                                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[120px] truncate">
                                        {visibleApiKeys.has(machine.id)
                                          ? machine.apiKey
                                          : "••••••••••••"}
                                      </code>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() =>
                                          toggleApiKeyVisibility(machine.id)
                                        }
                                      >
                                        {visibleApiKeys.has(machine.id) ? (
                                          <EyeOff className="h-3 w-3" />
                                        ) : (
                                          <Eye className="h-3 w-3" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() =>
                                          copyToClipboard(machine.apiKey!)
                                        }
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="text-right">
                                {machine.registrationStatus === "pending" && (
                                  <div className="flex gap-1 justify-end">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() =>
                                        handleOpenReject(machine as PendingMachine)
                                      }
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-success hover:text-success"
                                      onClick={() =>
                                        handleOpenApprove(machine as PendingMachine)
                                      }
                                    >
                                      <CheckCircle2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                                {machine.registrationStatus === "approved" && (
                                  <div className="flex gap-1 justify-end">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={() => openQrDialog([machine])}
                                        >
                                          <QrCode className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('machineRegistration.qr.rowAction', 'Tạo nhãn QR')}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          disabled={(LIFECYCLE_TRANSITIONS[machine.lifecycleStatus ?? "active"] ?? []).length === 0}
                                          onClick={() => handleOpenLifecycle(machine)}
                                        >
                                          <Recycle className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('machineRegistration.lifecycle.action')}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-info hover:text-info"
                                          onClick={() => handleOpenEdit(machine)}
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('machineRegistration.actions.edit')}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-warning hover:text-warning"
                                          onClick={() => handleOpenRevoke(machine)}
                                        >
                                          <Undo2 className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('machineRegistration.actions.revokeApproval')}</TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                                {machine.registrationStatus === "rejected" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleOpenApprove(machine as PendingMachine)
                                    }
                                  >
                                    {t('machineRegistration.actions.reApprove')}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* F9 — pagination controls */}
                {pagedTotal > PAGE_SIZE && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t('machineRegistration.pagination.showing', {
                        from: (page - 1) * PAGE_SIZE + 1,
                        to: Math.min(page * PAGE_SIZE, pagedTotal),
                        total: pagedTotal,
                      })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1 || pagedQuery.isFetching}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        {t('machineRegistration.pagination.prev')}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {t('machineRegistration.pagination.pageOf', { page, pages: totalPages })}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages || pagedQuery.isFetching}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        {t('machineRegistration.pagination.next')}
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>

        {/* Info card */}
        <Card className="border-info/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-info" />
              {t('machineRegistration.guide.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4 text-sm">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-info/15 flex items-center justify-center text-info font-bold">
                  1
                </div>
                <div>
                  <p className="font-medium">{t('machineRegistration.guide.step1Title')}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {t('machineRegistration.guide.step1Desc')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-warning/15 flex items-center justify-center text-warning font-bold">
                  2
                </div>
                <div>
                  <p className="font-medium">{t('machineRegistration.guide.step2Title')}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {t('machineRegistration.guide.step2Desc')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-success/15 flex items-center justify-center text-success font-bold">
                  3
                </div>
                <div>
                  <p className="font-medium">{t('machineRegistration.guide.step3Title')}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {t('machineRegistration.guide.step3Desc')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
                  4
                </div>
                <div>
                  <p className="font-medium">{t('machineRegistration.guide.step4Title')}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {t('machineRegistration.guide.step4Desc')}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageContainer>

      {/* ── Approve Dialog ── */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              {t('machineRegistration.approveDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('machineRegistration.approveDialog.description')}{" "}
              <strong>{selectedMachine?.serialNumber ?? selectedMachine?.code}</strong>
            </DialogDescription>
          </DialogHeader>

          {selectedMachine && (
            <div className="space-y-4">
              {/* Machine info summary */}
              <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineRegistration.approveDialog.serialNumber')}</span>
                  <span className="font-mono">{selectedMachine.serialNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineRegistration.approveDialog.machineType')}</span>
                  <span>{selectedMachine.machineType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineRegistration.approveDialog.model')}</span>
                  <span>{selectedMachine.model ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('machineRegistration.approveDialog.firmware')}</span>
                  <span>{selectedMachine.firmwareVersion ?? "—"}</span>
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="approve-code">{t('machineRegistration.approveDialog.machineCode')}</Label>
                  <Input
                    id="approve-code"
                    value={approveCode}
                    onChange={(e) => setApproveCode(e.target.value)}
                    placeholder={t('machineRegistration.approveDialog.machineCodePlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('machineRegistration.approveDialog.machineCodeHint', { code: selectedMachine.code })}
                  </p>
                </div>
                <div>
                  <Label htmlFor="approve-name">{t('machineRegistration.approveDialog.machineName')}</Label>
                  <Input
                    id="approve-name"
                    value={approveName}
                    onChange={(e) => setApproveName(e.target.value)}
                    placeholder={t('machineRegistration.approveDialog.machineNamePlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="approve-station">{t('machineRegistration.approveDialog.station')}</Label>
                  <Select
                    value={approveStationId?.toString() ?? ""}
                    onValueChange={(v) => setApproveStationId(Number(v))}
                  >
                    <SelectTrigger id="approve-station">
                      <SelectValue placeholder={t('machineRegistration.approveDialog.stationPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {stations.map((s: any) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          {s.code} — {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveDialogOpen(false)}
            >
              {t('machineRegistration.approveDialog.cancel')}
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {approveMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              {t('machineRegistration.approveDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog ── */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              {t('machineRegistration.rejectDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('machineRegistration.rejectDialog.description')}{" "}
              <strong>{rejectMachine?.serialNumber ?? rejectMachine?.code}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="reject-reason">{t('machineRegistration.rejectDialog.reasonLabel')}</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('machineRegistration.rejectDialog.reasonPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              {t('machineRegistration.rejectDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-1" />
              )}
              {t('machineRegistration.rejectDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke Approval Dialog ── */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-warning" />
              {t('machineRegistration.revokeDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('machineRegistration.revokeDialog.description', { machine: revokeMachine?.name || revokeMachine?.code || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('machineRegistration.revokeDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={handleRevoke}
              disabled={revokeApprovalMutation.isPending}
            >
              {revokeApprovalMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4 mr-1" />
              )}
              {t('machineRegistration.revokeDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Edit Approved Machine Dialog ── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-info" />
              {t('machineRegistration.editDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('machineRegistration.editDialog.description')}{" "}
              <strong>{editMachine?.serialNumber ?? editMachine?.code}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="edit-name">{t('machineRegistration.editDialog.nameLabel')}</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('machineRegistration.editDialog.namePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="edit-station">{t('machineRegistration.editDialog.stationLabel')}</Label>
              <Select
                value={editStationId?.toString() ?? ""}
                onValueChange={(v) => setEditStationId(Number(v))}
              >
                <SelectTrigger id="edit-station">
                  <SelectValue placeholder={t('machineRegistration.editDialog.stationPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {stations?.map((station) => (
                    <SelectItem key={station.id} value={station.id.toString()}>
                      {station.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
            >
              {t('machineRegistration.editDialog.cancel')}
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={editMachineMutation.isPending}
            >
              {editMachineMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4 mr-1" />
              )}
              {t('machineRegistration.editDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Lifecycle Dialog (doc 27 Đợt 3 / W3-B — M2) ── */}
      <Dialog open={lifecycleDialogOpen} onOpenChange={setLifecycleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Recycle className="h-5 w-5" />
              {t('machineRegistration.lifecycle.dialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('machineRegistration.lifecycle.dialog.description')}{" "}
              <strong>{lifecycleMachine?.name ?? lifecycleMachine?.code}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 p-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('machineRegistration.lifecycle.dialog.currentLabel')}</span>
              {getLifecycleBadge(lifecycleMachine?.lifecycleStatus)}
            </div>
            <div>
              <Label htmlFor="lifecycle-target">{t('machineRegistration.lifecycle.dialog.targetLabel')}</Label>
              <Select value={lifecycleTarget} onValueChange={setLifecycleTarget}>
                <SelectTrigger id="lifecycle-target">
                  <SelectValue placeholder={t('machineRegistration.lifecycle.dialog.targetPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {lifecycleAllowed.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`machineRegistration.lifecycle.status.${s}`, { defaultValue: s })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lifecycleAllowed.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('machineRegistration.lifecycle.dialog.noTransitions')}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="lifecycle-reason">
                {LIFECYCLE_REASON_REQUIRED.includes(lifecycleTarget)
                  ? t('machineRegistration.lifecycle.dialog.reasonRequiredLabel')
                  : t('machineRegistration.lifecycle.dialog.reasonLabel')}
              </Label>
              <Textarea
                id="lifecycle-reason"
                value={lifecycleReason}
                onChange={(e) => setLifecycleReason(e.target.value)}
                placeholder={t('machineRegistration.lifecycle.dialog.reasonPlaceholder')}
                rows={3}
              />
              {lifecycleReasonMissing && (
                <p className="text-xs text-destructive mt-1">
                  {t('machineRegistration.lifecycle.dialog.reasonRequiredHint')}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLifecycleDialogOpen(false)}>
              {t('machineRegistration.lifecycle.dialog.cancel')}
            </Button>
            <Button
              onClick={handleLifecycleSave}
              disabled={setLifecycleMutation.isPending || !lifecycleTarget || lifecycleReasonMissing}
            >
              {setLifecycleMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Recycle className="h-4 w-4 mr-1" />
              )}
              {t('machineRegistration.lifecycle.dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── QR Asset-Tag Dialog (doc 40 Wave 4) ── */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              {t('machineRegistration.qr.dialogTitle', 'Nhãn QR dán lên máy')}
            </DialogTitle>
            <DialogDescription>
              {t('machineRegistration.qr.dialogDesc', 'Quét nhãn để mở hồ sơ máy (/machine/:id). In và dán lên thân máy.')}
            </DialogDescription>
          </DialogHeader>

          {qrLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              {t('machineRegistration.qr.generating', 'Đang tạo mã QR…')}
            </div>
          ) : (
            <div className="print-area grid grid-cols-2 gap-4 sm:grid-cols-3">
              {qrItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col items-center gap-1 rounded-lg border p-3 text-center"
                >
                  <img
                    src={item.dataUrl}
                    alt={`QR ${item.code}`}
                    className="h-32 w-32"
                    width={128}
                    height={128}
                  />
                  <p className="font-mono text-sm font-semibold">{item.code}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{item.name}</p>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setQrDialogOpen(false)}>
              {t('machineRegistration.qr.close', 'Đóng')}
            </Button>
            <Button
              onClick={() => window.print()}
              disabled={qrLoading || qrItems.length === 0}
            >
              <Printer className="h-4 w-4 mr-1" />
              {t('machineRegistration.qr.print', 'In nhãn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function MachineRegistration() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/machine-registration">
      <MachineRegistrationContent />
    </DashboardLayout>
  );
}
