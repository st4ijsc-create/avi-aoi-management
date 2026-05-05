import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
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
  syncMode?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  apiKey?: string | null;
  createdAt?: string | Date | null;
  stationId: number;
};

export function MachineRegistrationContent() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState("pending");

  const dateFnsLocale = i18n.language === 'vi' ? vi : i18n.language === 'zh' ? zhCN : enUS;
  const [searchQuery, setSearchQuery] = useState("");

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

  // API Key visibility
  const [visibleApiKeys, setVisibleApiKeys] = useState<Set<number>>(new Set());

  // Queries
  const pendingQuery = trpc.machine.listPending.useQuery();
  const allMachinesQuery = trpc.machine.list.useQuery();
  const stationsQuery = trpc.station.list.useQuery();
  const utils = trpc.useUtils();

  // Mutations
  const approveMutation = trpc.machine.approve.useMutation({
    onSuccess: (data) => {
      toast.success(t('machineRegistration.toast.approveSuccess'), {
        description: t('machineRegistration.toast.approveSuccessDesc', { apiKey: data.apiKey?.substring(0, 20) }),
      });
      setApproveDialogOpen(false);
      setSelectedMachine(null);
      utils.machine.listPending.invalidate();
      utils.machine.list.invalidate();
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
      utils.machine.listPending.invalidate();
      utils.machine.list.invalidate();
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
      utils.machine.listPending.invalidate();
      utils.machine.list.invalidate();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.revokeError'), { description: err.message });
    },
  });

  // Edit approved machine
  const editMachineMutation = trpc.machine.update.useMutation({
    onSuccess: () => {
      toast.success(t('machineRegistration.toast.editSuccess'));
      setEditDialogOpen(false);
      setEditMachine(null);
      utils.machine.listPending.invalidate();
      utils.machine.list.invalidate();
    },
    onError: (err) => {
      toast.error(t('machineRegistration.toast.editError'), { description: err.message });
    },
  });

  const pendingMachines = (pendingQuery.data ?? []) as PendingMachine[];
  const allMachines = (allMachinesQuery.data ?? []) as AllMachine[];

  // Filtered machines
  const filteredAll = allMachines.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.code.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.serialNumber?.toLowerCase().includes(q) ?? false) ||
      m.machineType.toLowerCase().includes(q)
    );
  });

  const approvedMachines = filteredAll.filter((m) => m.registrationStatus === "approved");
  const rejectedMachines = filteredAll.filter((m) => m.registrationStatus === "rejected");
  const allRegistered = filteredAll.filter((m) =>
    ["pending", "approved", "rejected"].includes(m.registrationStatus ?? "")
  );

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

  const handleRevoke = () => {
    if (!revokeMachine) return;
    revokeApprovalMutation.mutate({
      id: revokeMachine.id,
      registrationStatus: "pending",
    });
  };

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
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {t('machineRegistration.status.approved')}
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <Clock className="h-3 w-3 mr-1" /> {t('machineRegistration.status.pending')}
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <XCircle className="h-3 w-3 mr-1" /> {t('machineRegistration.status.rejected')}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <AlertTriangle className="h-3 w-3 mr-1" /> {t('machineRegistration.status.unregistered')}
          </Badge>
        );
    }
  };

  const getSyncModeBadge = (mode: string | null | undefined) => {
    if (mode === "online") {
      return (
        <Badge variant="outline" className="text-green-600 border-green-300">
          <Wifi className="h-3 w-3 mr-1" /> Online
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-gray-500 border-gray-300">
        <WifiOff className="h-3 w-3 mr-1" /> Offline
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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HardDrive className="h-6 w-6" />
              {t('machineRegistration.pageTitle')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('machineRegistration.pageSubtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                pendingQuery.refetch();
                allMachinesQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> {t('machineRegistration.refresh')}
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pendingMachines.length}</p>
                  <p className="text-sm text-muted-foreground">{t('machineRegistration.summary.pending')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{approvedMachines.length}</p>
                  <p className="text-sm text-muted-foreground">{t('machineRegistration.summary.approved')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{rejectedMachines.length}</p>
                  <p className="text-sm text-muted-foreground">{t('machineRegistration.summary.rejected')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Server className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{allMachines.length}</p>
                  <p className="text-sm text-muted-foreground">{t('machineRegistration.summary.total')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
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
                  <CheckCircle2 className="h-12 w-12 mx-auto text-green-400 mb-3" />
                  <h3 className="text-lg font-medium">{t('machineRegistration.pendingTab.emptyTitle')}</h3>
                  <p className="text-muted-foreground mt-1">
                    {t('machineRegistration.pendingTab.emptyDesc')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {pendingMachines.map((machine) => (
                  <Card
                    key={machine.id}
                    className="border-yellow-200 dark:border-yellow-800/50"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                            <Cpu className="h-5 w-5 text-yellow-600" />
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
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          {t('machineRegistration.actions.reject')}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleOpenApprove(machine)}
                          className="bg-green-600 hover:bg-green-700"
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

          {/* ── All / Approved / Rejected Tabs ── */}
          {(["all", "approved", "rejected"] as const).map((tab) => {
            const data =
              tab === "all"
                ? filteredAll
                : tab === "approved"
                  ? approvedMachines
                  : rejectedMachines;

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
                  <span className="text-sm text-muted-foreground">
                    {t('machineRegistration.table.machineCount', { count: data.length })}
                  </span>
                </div>

                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">{t('machineRegistration.table.id')}</TableHead>
                          <TableHead>{t('machineRegistration.table.machineCode')}</TableHead>
                          <TableHead>{t('machineRegistration.table.name')}</TableHead>
                          <TableHead>{t('machineRegistration.table.serialNumber')}</TableHead>
                          <TableHead>{t('machineRegistration.table.type')}</TableHead>
                          <TableHead>{t('machineRegistration.table.status')}</TableHead>
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
                              colSpan={tab !== "rejected" ? 10 : 9}
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
                                      className="h-7 w-7 text-red-500 hover:text-red-700"
                                      onClick={() =>
                                        handleOpenReject(machine as PendingMachine)
                                      }
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-green-500 hover:text-green-700"
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
                                          className="h-7 w-7 text-blue-500 hover:text-blue-700"
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
                                          className="h-7 w-7 text-orange-500 hover:text-orange-700"
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
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>

        {/* Info card */}
        <Card className="border-blue-200 dark:border-blue-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              {t('machineRegistration.guide.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4 text-sm">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold">
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
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 font-bold">
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
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 font-bold">
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
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 font-bold">
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
      </div>

      {/* ── Approve Dialog ── */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
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
              className="bg-green-600 hover:bg-green-700"
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
              <XCircle className="h-5 w-5 text-red-500" />
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
              <Undo2 className="h-5 w-5 text-orange-500" />
              {t('machineRegistration.revokeDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('machineRegistration.revokeDialog.description', { machine: revokeMachine?.name || revokeMachine?.code || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('machineRegistration.revokeDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700"
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
              <Pencil className="h-5 w-5 text-blue-500" />
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
