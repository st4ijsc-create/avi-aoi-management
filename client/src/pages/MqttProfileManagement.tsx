/**
 * MQTT Profile Management Page
 * Quản lý tập trung các MQTT Profiles và gán cho máy/station/factory
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { 
  Plus, 
  Server, 
  Link2, 
  Activity, 
  Trash2, 
  Edit, 
  Copy, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  RefreshCw,
  FileJson,
  Settings2,
  Download,
  Upload,
  Heart,
  Wifi,
  WifiOff,
  History,
  FileSpreadsheet,
  Signal,
  Clock
} from "lucide-react";

export default function MqttProfileManagement() {
  const [activeTab, setActiveTab] = useState("profiles");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedProfileForAssign, setSelectedProfileForAssign] = useState<number | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importOptions, setImportOptions] = useState({ overwriteExisting: false, skipDuplicates: true });

  // Queries
  const { data: profiles, refetch: refetchProfiles } = trpc.mqttClientManagement.listProfiles.useQuery();
  const { data: assignments, refetch: refetchAssignments } = trpc.mqttClientManagement.listAssignments.useQuery();
  const { data: connectionLogs, refetch: refetchLogs } = trpc.mqttClientManagement.getConnectionLogs.useQuery({ limit: 50 });
  const { data: templates } = trpc.mqttClientManagement.listTemplates.useQuery();
  const { data: dashboardStats, refetch: refetchStats } = trpc.mqttClientManagement.getDashboardStats.useQuery();
  const { data: machinesList } = trpc.machine.list.useQuery();
  const { data: stationsList } = trpc.station.list.useQuery();
  const { data: factoriesList } = trpc.factory.list.useQuery();
  const { data: connectionHealth, refetch: refetchHealth } = trpc.mqttClientManagement.getConnectionHealth.useQuery();
  const { data: connectionStatusData, refetch: refetchConnectionStatus } = trpc.mqttClientManagement.getConnectionStatus.useQuery();
  const { data: connectionStatusSummary, refetch: refetchStatusSummary } = trpc.mqttClientManagement.getConnectionStatusSummary.useQuery();
  const { data: reconnectHistory, refetch: refetchReconnectHistory } = trpc.mqttClientManagement.getReconnectHistory.useQuery({ limit: 100 });
  const { data: reconnectStats, refetch: refetchReconnectStats } = trpc.mqttClientManagement.getReconnectStats.useQuery({ days: 7 });
  const { data: exportData, refetch: refetchExport } = trpc.mqttClientManagement.exportProfiles.useQuery(
    { includeAssignments: true, includeTemplates: true },
    { enabled: false }
  );
  const { data: assignmentReportData, refetch: refetchAssignmentReport } = trpc.mqttClientManagement.exportAssignmentReport.useQuery(
    { format: "csv" },
    { enabled: false }
  );

  // Mutations
  const createProfile = trpc.mqttClientManagement.createProfile.useMutation({
    onSuccess: () => {
      toast.success("Đã tạo profile mới");
      refetchProfiles();
      refetchStats();
      setShowCreateDialog(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateProfile = trpc.mqttClientManagement.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật profile");
      refetchProfiles();
      setEditingProfile(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteProfile = trpc.mqttClientManagement.deleteProfile.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa profile");
      refetchProfiles();
      refetchStats();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const duplicateProfile = trpc.mqttClientManagement.duplicateProfile.useMutation({
    onSuccess: () => {
      toast.success("Đã nhân bản profile");
      refetchProfiles();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const assignProfile = trpc.mqttClientManagement.assignProfile.useMutation({
    onSuccess: () => {
      toast.success("Đã gán profile");
      refetchAssignments();
      refetchStats();
      setShowAssignDialog(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const importProfiles = trpc.mqttClientManagement.importProfiles.useMutation({
    onSuccess: (result) => {
      toast.success(`Import hoàn tất: ${result.profilesImported} imported, ${result.profilesUpdated} updated, ${result.profilesSkipped} skipped`);
      if (result.errors.length > 0) {
        result.errors.forEach(err => toast.error(err));
      }
      refetchProfiles();
      refetchStats();
      setShowImportDialog(false);
      setImportFile(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const removeAssignment = trpc.mqttClientManagement.removeAssignment.useMutation({
    onSuccess: () => {
      toast.success("Đã gỡ bỏ assignment");
      refetchAssignments();
      refetchStats();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Bulk Assignment
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
  const [bulkAssignTargetType, setBulkAssignTargetType] = useState<"machine" | "station" | "factory">("machine");
  const [selectedTargets, setSelectedTargets] = useState<number[]>([]);
  const [bulkReplaceExisting, setBulkReplaceExisting] = useState(false);

  const { data: availableTargets } = trpc.mqttClientManagement.getAvailableTargets.useQuery(
    { targetType: bulkAssignTargetType, excludeAssigned: !bulkReplaceExisting },
    { enabled: showBulkAssignDialog }
  );

  const bulkAssign = trpc.mqttClientManagement.bulkAssign.useMutation({
    onSuccess: (result) => {
      toast.success(`Bulk assign hoàn tất: ${result.success} thành công, ${result.skipped} bỏ qua`);
      if (result.errors.length > 0) {
        result.errors.forEach(err => toast.error(err));
      }
      refetchAssignments();
      refetchStats();
      setShowBulkAssignDialog(false);
      setSelectedTargets([]);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleBulkAssign = () => {
    if (!selectedProfileForAssign || selectedTargets.length === 0) return;
    bulkAssign.mutate({
      profileId: selectedProfileForAssign,
      targets: selectedTargets.map(id => ({ targetType: bulkAssignTargetType, targetId: id })),
      replaceExisting: bulkReplaceExisting,
    });
  };

  // Form state for create/edit profile
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    brokerUrl: "mqtt://localhost",
    port: 1883,
    protocol: "mqtt" as "mqtt" | "mqtts" | "ws" | "wss",
    username: "",
    password: "",
    clientIdPrefix: "",
    useTls: false,
    keepAlive: 60,
    connectTimeout: 30000,
    reconnectPeriod: 5000,
    cleanSession: true,
    defaultQos: "1" as "0" | "1" | "2",
    subscribeTopics: [] as string[],
    publishTopics: [] as string[],
    messageRetain: false,
    isDefault: false,
    // Auto-Reconnect Settings
    autoReconnect: true,
    maxReconnectAttempts: 10,
    reconnectBackoffMultiplier: "1.5",
    maxReconnectDelay: 60000,
  });

  const [assignFormData, setAssignFormData] = useState({
    targetType: "machine" as "machine" | "station" | "factory",
    targetId: 0,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      brokerUrl: "mqtt://localhost",
      port: 1883,
      protocol: "mqtt",
      username: "",
      password: "",
      clientIdPrefix: "",
      useTls: false,
      keepAlive: 60,
      connectTimeout: 30000,
      reconnectPeriod: 5000,
      cleanSession: true,
      defaultQos: "1",
      subscribeTopics: [],
      publishTopics: [],
      messageRetain: false,
      isDefault: false,
      autoReconnect: true,
      maxReconnectAttempts: 10,
      reconnectBackoffMultiplier: "1.5",
      maxReconnectDelay: 60000,
    });
  };

  const handleCreateProfile = () => {
    createProfile.mutate(formData);
  };

  const handleUpdateProfile = () => {
    if (editingProfile) {
      updateProfile.mutate({ id: editingProfile.id, ...formData });
    }
  };

  const handleAssignProfile = () => {
    if (selectedProfileForAssign && assignFormData.targetId) {
      assignProfile.mutate({
        profileId: selectedProfileForAssign,
        targetType: assignFormData.targetType,
        targetId: assignFormData.targetId,
      });
    }
  };

  const openEditDialog = (profile: any) => {
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      description: profile.description || "",
      brokerUrl: profile.brokerUrl,
      port: profile.port,
      protocol: profile.protocol,
      username: profile.username || "",
      password: profile.password || "",
      clientIdPrefix: profile.clientIdPrefix || "",
      useTls: profile.useTls,
      keepAlive: profile.keepAlive,
      connectTimeout: profile.connectTimeout,
      reconnectPeriod: profile.reconnectPeriod,
      cleanSession: profile.cleanSession,
      defaultQos: profile.defaultQos,
      subscribeTopics: profile.subscribeTopics || [],
      publishTopics: profile.publishTopics || [],
      messageRetain: profile.messageRetain,
      isDefault: profile.isDefault,
      autoReconnect: profile.autoReconnect ?? true,
      maxReconnectAttempts: profile.maxReconnectAttempts ?? 10,
      reconnectBackoffMultiplier: String(profile.reconnectBackoffMultiplier ?? "1.5"),
      maxReconnectDelay: profile.maxReconnectDelay ?? 60000,
    });
  };

  const getTargetOptions = () => {
    switch (assignFormData.targetType) {
      case "machine":
        return machinesList?.map((m: any) => ({ id: m.id, name: m.name })) || [];
      case "station":
        return stationsList?.map((s: any) => ({ id: s.id, name: s.name })) || [];
      case "factory":
        return factoriesList?.map((f: any) => ({ id: f.id, name: f.name })) || [];
      default:
        return [];
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Quản lý MQTT Profiles</h1>
            <p className="text-muted-foreground">
              Cấu hình tập trung các MQTT profiles và gán cho máy/station/factory
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={async () => {
              const result = await refetchExport();
              if (result.data) {
                const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mqtt-profiles-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success('Đã xuất profiles thành công');
              }
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export Profiles
            </Button>
            <Button variant="outline" onClick={async () => {
              const result = await refetchAssignmentReport();
              if (result.data) {
                const csvData = typeof result.data.data === 'string' ? result.data.data : JSON.stringify(result.data.data);
                const blob = new Blob([csvData], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mqtt-assignments-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Đã xuất ${result.data.total} assignments thành công`);
              }
            }}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export Assignments
            </Button>
            <Button variant="outline" onClick={() => setShowImportDialog(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Tạo Profile mới
            </Button>
          </div>
        </div>

        {/* Connection Health Overview */}
        {connectionHealth && (
          <Card className={`border-l-4 ${
            connectionHealth.overall.status === 'healthy' ? 'border-l-green-500' :
            connectionHealth.overall.status === 'warning' ? 'border-l-yellow-500' :
            connectionHealth.overall.status === 'error' ? 'border-l-red-500' : 'border-l-gray-500'
          }`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="h-5 w-5" />
                  Connection Health Monitor
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => refetchHealth()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{connectionHealth.overall.totalProfiles}</div>
                  <p className="text-xs text-muted-foreground">Total Profiles</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-500 flex items-center justify-center gap-1">
                    <Wifi className="h-4 w-4" />
                    {connectionHealth.overall.healthy}
                  </div>
                  <p className="text-xs text-muted-foreground">Healthy</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-500">{connectionHealth.overall.warning}</div>
                  <p className="text-xs text-muted-foreground">Warning</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500 flex items-center justify-center gap-1">
                    <WifiOff className="h-4 w-4" />
                    {connectionHealth.overall.error}
                  </div>
                  <p className="text-xs text-muted-foreground">Error</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-500">{connectionHealth.overall.unknown}</div>
                  <p className="text-xs text-muted-foreground">Unknown</p>
                </div>
              </div>
              {/* Profile Health Details */}
              {connectionHealth.profiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium">Chi tiết kết nối:</p>
                  <div className="grid gap-2">
                    {connectionHealth.profiles.map((profile) => (
                      <div key={profile.profileId} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-2">
                          {profile.status === 'healthy' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {profile.status === 'warning' && <AlertCircle className="h-4 w-4 text-yellow-500" />}
                          {profile.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                          {profile.status === 'unknown' && <Activity className="h-4 w-4 text-gray-500" />}
                          <span className="font-medium">{profile.profileName}</span>
                          <span className="text-xs text-muted-foreground">({profile.brokerUrl}:{profile.port})</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="outline">{profile.assignmentCount} assignments</Badge>
                          <span className="text-sm">{profile.statusMessage}</span>
                          {profile.errorsLastHour > 0 && (
                            <Badge variant="destructive">{profile.errorsLastHour} errors/h</Badge>
                          )}
                          {profile.reconnectsLastHour > 0 && (
                            <Badge variant="secondary">{profile.reconnectsLastHour} reconnects/h</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Profiles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardStats?.profiles?.total || 0}</div>
              <p className="text-xs text-muted-foreground">
                {dashboardStats?.profiles?.active || 0} active
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardStats?.assignments?.total || 0}</div>
              <p className="text-xs text-muted-foreground">
                {dashboardStats?.assignments?.machines || 0} machines, {dashboardStats?.assignments?.stations || 0} stations
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Errors (24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{dashboardStats?.errorsLast24h || 0}</div>
              <p className="text-xs text-muted-foreground">Connection errors</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{templates?.length || 0}</div>
              <p className="text-xs text-muted-foreground">Topic templates</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="profiles">
              <Server className="h-4 w-4 mr-2" />
              Profiles
            </TabsTrigger>
            <TabsTrigger value="assignments">
              <Link2 className="h-4 w-4 mr-2" />
              Assignments
            </TabsTrigger>
            <TabsTrigger value="logs">
              <Activity className="h-4 w-4 mr-2" />
              Connection Logs
            </TabsTrigger>
            <TabsTrigger value="templates">
              <FileJson className="h-4 w-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="connection-status">
              <Signal className="h-4 w-4 mr-2" />
              Connection Status
            </TabsTrigger>
            <TabsTrigger value="reconnect-logs">
              <History className="h-4 w-4 mr-2" />
              Reconnect Logs
            </TabsTrigger>
          </TabsList>

          {/* Profiles Tab */}
          <TabsContent value="profiles" className="space-y-4">
            <div className="grid gap-4">
              {profiles?.map((profile: any) => (
                <Card key={profile.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{profile.name}</CardTitle>
                        {profile.isDefault && (
                          <Badge variant="secondary">Default</Badge>
                        )}
                        {profile.isActive ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(profile)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => duplicateProfile.mutate({ id: profile.id, newName: `${profile.name} (Copy)` })}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          title="Gán cho 1 target"
                          onClick={() => {
                            setSelectedProfileForAssign(profile.id);
                            setShowAssignDialog(true);
                          }}
                        >
                          <Link2 className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          title="Gán cho nhiều targets"
                          onClick={() => {
                            setSelectedProfileForAssign(profile.id);
                            setShowBulkAssignDialog(true);
                          }}
                        >
                          <Server className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-red-500"
                          onClick={() => {
                            if (confirm("Bạn có chắc muốn xóa profile này?")) {
                              deleteProfile.mutate({ id: profile.id });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription>{profile.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Broker:</span>
                        <p className="font-mono">{profile.brokerUrl}:{profile.port}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Protocol:</span>
                        <p className="uppercase">{profile.protocol}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QoS:</span>
                        <p>{profile.defaultQos}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Assignments:</span>
                        <p>{profile.assignmentCount || 0}</p>
                      </div>
                    </div>
                    {profile.subscribeTopics?.length > 0 && (
                      <div className="mt-3">
                        <span className="text-muted-foreground text-sm">Subscribe Topics:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {profile.subscribeTopics.map((topic: string, i: number) => (
                            <Badge key={i} variant="outline" className="font-mono text-xs">
                              {topic}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {(!profiles || profiles.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Chưa có profile nào. Nhấn "Tạo Profile mới" để bắt đầu.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Assignments Tab */}
          <TabsContent value="assignments" className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => refetchAssignments()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Target</th>
                    <th className="p-3 text-left font-medium">Type</th>
                    <th className="p-3 text-left font-medium">Profile</th>
                    <th className="p-3 text-left font-medium">Assigned At</th>
                    <th className="p-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments?.map((assignment: any) => (
                    <tr key={assignment.id} className="border-b">
                      <td className="p-3">{assignment.targetName}</td>
                      <td className="p-3">
                        <Badge variant="outline">{assignment.targetType}</Badge>
                      </td>
                      <td className="p-3">{assignment.profileName}</td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(assignment.assignedAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="p-3">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-500"
                          onClick={() => removeAssignment.mutate({ id: assignment.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!assignments || assignments.length === 0) && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        Chưa có assignment nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Connection Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Time</th>
                    <th className="p-3 text-left font-medium">Client ID</th>
                    <th className="p-3 text-left font-medium">Event</th>
                    <th className="p-3 text-left font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {connectionLogs?.map((log: any) => (
                    <tr key={log.id} className="border-b">
                      <td className="p-3 text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString("vi-VN")}
                      </td>
                      <td className="p-3 font-mono text-sm">{log.clientId}</td>
                      <td className="p-3">
                        <Badge 
                          variant={log.eventType === "connect" ? "default" : 
                                   log.eventType === "error" ? "destructive" : "outline"}
                        >
                          {log.eventType === "connect" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {log.eventType === "error" && <XCircle className="h-3 w-3 mr-1" />}
                          {log.eventType === "disconnect" && <AlertCircle className="h-3 w-3 mr-1" />}
                          {log.eventType}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm">{log.eventMessage || "-"}</td>
                    </tr>
                  ))}
                  {(!connectionLogs || connectionLogs.length === 0) && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
                        Chưa có log nào
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates" className="space-y-4">
            <div className="grid gap-4">
              {templates?.map((template: any) => (
                <Card key={template.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <Badge>{template.deviceType.toUpperCase()}</Badge>
                    </div>
                    <CardDescription>{template.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {template.inspectionResultTopic && (
                        <div>
                          <span className="text-muted-foreground">Inspection Result:</span>
                          <p className="font-mono text-xs">{template.inspectionResultTopic}</p>
                        </div>
                      )}
                      {template.ngAlertTopic && (
                        <div>
                          <span className="text-muted-foreground">NG Alert:</span>
                          <p className="font-mono text-xs">{template.ngAlertTopic}</p>
                        </div>
                      )}
                      {template.statusTopic && (
                        <div>
                          <span className="text-muted-foreground">Status:</span>
                          <p className="font-mono text-xs">{template.statusTopic}</p>
                        </div>
                      )}
                      {template.heartbeatTopic && (
                        <div>
                          <span className="text-muted-foreground">Heartbeat:</span>
                          <p className="font-mono text-xs">{template.heartbeatTopic}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(!templates || templates.length === 0) && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Chưa có template nào
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Connection Status Tab */}
          <TabsContent value="connection-status" className="space-y-4">
            {/* Status Summary */}
            {connectionStatusSummary && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold">{connectionStatusSummary.total}</div>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-green-500">{connectionStatusSummary.connected}</div>
                    <p className="text-xs text-muted-foreground">Connected</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-gray-500">{connectionStatusSummary.disconnected}</div>
                    <p className="text-xs text-muted-foreground">Disconnected</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-yellow-500">{connectionStatusSummary.connecting}</div>
                    <p className="text-xs text-muted-foreground">Connecting</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-red-500">{connectionStatusSummary.error}</div>
                    <p className="text-xs text-muted-foreground">Error</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-gray-400">{connectionStatusSummary.unknown}</div>
                    <p className="text-xs text-muted-foreground">Unknown</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Status List */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Connection Status Details</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => refetchConnectionStatus()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">Profile</th>
                        <th className="text-left py-2 px-3">Target</th>
                        <th className="text-left py-2 px-3">Status</th>
                        <th className="text-left py-2 px-3">Connected At</th>
                        <th className="text-left py-2 px-3">Last Heartbeat</th>
                        <th className="text-left py-2 px-3">Reconnects</th>
                        <th className="text-left py-2 px-3">Uptime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connectionStatusData?.items?.map((status: any) => (
                        <tr key={status.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3">{status.profileName}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-xs">{status.targetType}</Badge>
                              <span>{status.targetName}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={status.status === 'connected' ? 'default' : status.status === 'error' ? 'destructive' : 'secondary'}
                              className={status.status === 'connected' ? 'bg-green-500' : ''}>
                              {status.status === 'connected' && <Wifi className="h-3 w-3 mr-1" />}
                              {status.status === 'disconnected' && <WifiOff className="h-3 w-3 mr-1" />}
                              {status.status === 'error' && <XCircle className="h-3 w-3 mr-1" />}
                              {status.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            {status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '-'}
                          </td>
                          <td className="py-2 px-3 text-xs">
                            {status.lastHeartbeat ? new Date(status.lastHeartbeat).toLocaleString() : '-'}
                          </td>
                          <td className="py-2 px-3">{status.reconnectCount}</td>
                          <td className="py-2 px-3 text-xs">
                            {status.uptime ? `${Math.floor(status.uptime / 3600)}h ${Math.floor((status.uptime % 3600) / 60)}m` : '-'}
                          </td>
                        </tr>
                      ))}
                      {(!connectionStatusData?.items || connectionStatusData.items.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted-foreground">
                            Chưa có dữ liệu connection status
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Reconnect Logs Tab */}
          <TabsContent value="reconnect-logs" className="space-y-4">
            {/* Reconnect Stats Summary */}
            {reconnectStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Total Attempts</p>
                        <div className="text-2xl font-bold">{reconnectStats.summary.totalAttempts}</div>
                      </div>
                      <RefreshCw className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Success Rate</p>
                        <div className="text-2xl font-bold text-green-500">{reconnectStats.summary.successRate}%</div>
                      </div>
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Failures</p>
                        <div className="text-2xl font-bold text-red-500">{reconnectStats.summary.failureCount}</div>
                      </div>
                      <XCircle className="h-8 w-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Avg Delay</p>
                        <div className="text-2xl font-bold">{Math.round(reconnectStats.summary.avgDelay)}ms</div>
                      </div>
                      <Clock className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Daily Chart */}
            {reconnectStats?.daily && reconnectStats.daily.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Reconnect Trend (Last {reconnectStats.period} days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48 flex items-end gap-1">
                    {reconnectStats.daily.map((day: any, index: number) => {
                      const maxAttempts = Math.max(...reconnectStats.daily.map((d: any) => d.attempts || 1));
                      const height = maxAttempts > 0 ? (day.attempts / maxAttempts) * 100 : 0;
                      return (
                        <div key={index} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full bg-muted rounded-t relative" style={{ height: `${Math.max(height, 5)}%` }}>
                            <div className="absolute bottom-0 w-full bg-green-500 rounded-t" 
                              style={{ height: `${day.attempts > 0 ? (day.successes / day.attempts) * 100 : 0}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground rotate-45 origin-left">
                            {new Date(day.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-4 mt-4 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-muted rounded" />
                      <span>Total Attempts</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-green-500 rounded" />
                      <span>Successes</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reconnect History Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Reconnect History</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => refetchReconnectHistory()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3">Time</th>
                        <th className="text-left py-2 px-3">Event</th>
                        <th className="text-left py-2 px-3">Attempt #</th>
                        <th className="text-left py-2 px-3">Delay</th>
                        <th className="text-left py-2 px-3">Error</th>
                        <th className="text-left py-2 px-3">Client ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconnectHistory?.items?.map((log: any) => (
                        <tr key={log.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-3 text-xs">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={
                              log.eventType === 'success' ? 'default' : 
                              log.eventType === 'failure' || log.eventType === 'max_attempts_reached' ? 'destructive' : 'secondary'
                            } className={log.eventType === 'success' ? 'bg-green-500' : ''}>
                              {log.eventType}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">{log.attemptNumber}</td>
                          <td className="py-2 px-3">{log.reconnectDelay ? `${log.reconnectDelay}ms` : '-'}</td>
                          <td className="py-2 px-3 text-xs text-red-500 max-w-xs truncate" title={log.errorMessage}>
                            {log.errorMessage || '-'}
                          </td>
                          <td className="py-2 px-3 text-xs font-mono">{log.clientId || '-'}</td>
                        </tr>
                      ))}
                      {(!reconnectHistory?.items || reconnectHistory.items.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-muted-foreground">
                            Chưa có lịch sử reconnect
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Profile Dialog */}
        <Dialog open={showCreateDialog || !!editingProfile} onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingProfile(null);
            resetForm();
          }
        }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProfile ? "Chỉnh sửa Profile" : "Tạo Profile mới"}</DialogTitle>
              <DialogDescription>
                Cấu hình thông số kết nối MQTT broker
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Tên Profile *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Production MQTT"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="protocol">Protocol</Label>
                  <Select
                    value={formData.protocol}
                    onValueChange={(v: any) => setFormData({ ...formData, protocol: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mqtt">MQTT</SelectItem>
                      <SelectItem value="mqtts">MQTTS (TLS)</SelectItem>
                      <SelectItem value="ws">WebSocket</SelectItem>
                      <SelectItem value="wss">WebSocket Secure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Mô tả profile..."
                />
              </div>

              {/* Connection Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="brokerUrl">Broker URL *</Label>
                  <Input
                    id="brokerUrl"
                    value={formData.brokerUrl}
                    onChange={(e) => setFormData({ ...formData, brokerUrl: e.target.value })}
                    placeholder="mqtt://broker.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 1883 })}
                  />
                </div>
              </div>

              {/* Authentication */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientIdPrefix">Client ID Prefix</Label>
                <Input
                  id="clientIdPrefix"
                  value={formData.clientIdPrefix}
                  onChange={(e) => setFormData({ ...formData, clientIdPrefix: e.target.value })}
                  placeholder="avi-aoi-"
                />
              </div>

              {/* Connection Options */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="keepAlive">Keep Alive (s)</Label>
                  <Input
                    id="keepAlive"
                    type="number"
                    value={formData.keepAlive}
                    onChange={(e) => setFormData({ ...formData, keepAlive: parseInt(e.target.value) || 60 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="connectTimeout">Connect Timeout (ms)</Label>
                  <Input
                    id="connectTimeout"
                    type="number"
                    value={formData.connectTimeout}
                    onChange={(e) => setFormData({ ...formData, connectTimeout: parseInt(e.target.value) || 30000 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reconnectPeriod">Reconnect Period (ms)</Label>
                  <Input
                    id="reconnectPeriod"
                    type="number"
                    value={formData.reconnectPeriod}
                    onChange={(e) => setFormData({ ...formData, reconnectPeriod: parseInt(e.target.value) || 5000 })}
                  />
                </div>
              </div>

              {/* Auto-Reconnect Settings */}
              <div className="space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Auto-Reconnect Configuration
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.autoReconnect}
                      onCheckedChange={(v) => setFormData({ ...formData, autoReconnect: v })}
                    />
                    <Label>Enable Auto-Reconnect</Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxReconnectAttempts">Max Reconnect Attempts (0 = unlimited)</Label>
                    <Input
                      id="maxReconnectAttempts"
                      type="number"
                      min={0}
                      value={formData.maxReconnectAttempts}
                      onChange={(e) => setFormData({ ...formData, maxReconnectAttempts: parseInt(e.target.value) || 0 })}
                      disabled={!formData.autoReconnect}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reconnectBackoffMultiplier">Backoff Multiplier</Label>
                    <Input
                      id="reconnectBackoffMultiplier"
                      type="number"
                      step="0.1"
                      min={1}
                      max={5}
                      value={formData.reconnectBackoffMultiplier}
                      onChange={(e) => setFormData({ ...formData, reconnectBackoffMultiplier: e.target.value })}
                      disabled={!formData.autoReconnect}
                    />
                    <p className="text-xs text-muted-foreground">Delay tăng theo hệ số này sau mỗi lần thử lại</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxReconnectDelay">Max Reconnect Delay (ms)</Label>
                    <Input
                      id="maxReconnectDelay"
                      type="number"
                      min={1000}
                      value={formData.maxReconnectDelay}
                      onChange={(e) => setFormData({ ...formData, maxReconnectDelay: parseInt(e.target.value) || 60000 })}
                      disabled={!formData.autoReconnect}
                    />
                    <p className="text-xs text-muted-foreground">Delay tối đa giữa các lần reconnect</p>
                  </div>
                </div>
              </div>

              {/* QoS and Options */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultQos">Default QoS</Label>
                  <Select
                    value={formData.defaultQos}
                    onValueChange={(v: any) => setFormData({ ...formData, defaultQos: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - At most once</SelectItem>
                      <SelectItem value="1">1 - At least once</SelectItem>
                      <SelectItem value="2">2 - Exactly once</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-4 pt-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.cleanSession}
                      onCheckedChange={(v) => setFormData({ ...formData, cleanSession: v })}
                    />
                    <Label>Clean Session</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.useTls}
                      onCheckedChange={(v) => setFormData({ ...formData, useTls: v })}
                    />
                    <Label>Use TLS</Label>
                  </div>
                </div>
              </div>

              {/* Topics */}
              <div className="space-y-2">
                <Label htmlFor="subscribeTopics">Subscribe Topics (mỗi dòng 1 topic)</Label>
                <Textarea
                  id="subscribeTopics"
                  value={formData.subscribeTopics.join("\n")}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    subscribeTopics: e.target.value.split("\n").filter(t => t.trim()) 
                  })}
                  placeholder="factory/+/machine/+/inspection&#10;factory/+/machine/+/status"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="publishTopics">Publish Topics (mỗi dòng 1 topic)</Label>
                <Textarea
                  id="publishTopics"
                  value={formData.publishTopics.join("\n")}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    publishTopics: e.target.value.split("\n").filter(t => t.trim()) 
                  })}
                  placeholder="factory/+/machine/+/command"
                  rows={2}
                />
              </div>

              {/* Flags */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.isDefault}
                    onCheckedChange={(v) => setFormData({ ...formData, isDefault: v })}
                  />
                  <Label>Set as Default Profile</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.messageRetain}
                    onCheckedChange={(v) => setFormData({ ...formData, messageRetain: v })}
                  />
                  <Label>Message Retain</Label>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowCreateDialog(false);
                setEditingProfile(null);
                resetForm();
              }}>
                Hủy
              </Button>
              <Button 
                onClick={editingProfile ? handleUpdateProfile : handleCreateProfile}
                disabled={!formData.name || !formData.brokerUrl}
              >
                {editingProfile ? "Cập nhật" : "Tạo Profile"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Profile Dialog */}
        <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Gán Profile cho Target</DialogTitle>
              <DialogDescription>
                Chọn loại target và target cụ thể để gán profile
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Loại Target</Label>
                <Select
                  value={assignFormData.targetType}
                  onValueChange={(v: any) => setAssignFormData({ ...assignFormData, targetType: v, targetId: 0 })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="machine">Machine</SelectItem>
                    <SelectItem value="station">Station</SelectItem>
                    <SelectItem value="factory">Factory</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Target</Label>
                <Select
                  value={String(assignFormData.targetId)}
                  onValueChange={(v) => setAssignFormData({ ...assignFormData, targetId: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn target..." />
                  </SelectTrigger>
                  <SelectContent>
                    {getTargetOptions().map((opt: any) => (
                      <SelectItem key={opt.id} value={String(opt.id)}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
                Hủy
              </Button>
              <Button 
                onClick={handleAssignProfile}
                disabled={!assignFormData.targetId}
              >
                Gán Profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import Dialog */}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import MQTT Profiles</DialogTitle>
              <DialogDescription>
                Chọn file JSON đã export trước đó để import profiles
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>File JSON</Label>
                <Input
                  type="file"
                  accept=".json"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={importOptions.overwriteExisting}
                    onCheckedChange={(v) => setImportOptions({ ...importOptions, overwriteExisting: v })}
                  />
                  <Label>Ghi đè profiles trùng tên</Label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={importOptions.skipDuplicates}
                  onCheckedChange={(v) => setImportOptions({ ...importOptions, skipDuplicates: v })}
                />
                <Label>Bỏ qua profiles trùng tên (nếu không ghi đè)</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowImportDialog(false);
                setImportFile(null);
              }}>
                Hủy
              </Button>
              <Button 
                onClick={async () => {
                  if (!importFile) return;
                  try {
                    const text = await importFile.text();
                    const data = JSON.parse(text);
                    importProfiles.mutate({
                      data,
                      overwriteExisting: importOptions.overwriteExisting,
                      skipDuplicates: importOptions.skipDuplicates,
                    });
                  } catch (error) {
                    toast.error('File JSON không hợp lệ');
                  }
                }}
                disabled={!importFile || importProfiles.isPending}
              >
                {importProfiles.isPending ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Assign Dialog */}
        <Dialog open={showBulkAssignDialog} onOpenChange={setShowBulkAssignDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Gán Profile cho nhiều Targets</DialogTitle>
              <DialogDescription>
                Chọn nhiều machines/stations/factories để gán profile cùng lúc
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Loại Target</Label>
                <Select
                  value={bulkAssignTargetType}
                  onValueChange={(v: any) => {
                    setBulkAssignTargetType(v);
                    setSelectedTargets([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="machine">Machine</SelectItem>
                    <SelectItem value="station">Station</SelectItem>
                    <SelectItem value="factory">Factory</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={bulkReplaceExisting}
                  onCheckedChange={setBulkReplaceExisting}
                />
                <Label>Thay thế assignments hiện có</Label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Chọn Targets ({selectedTargets.length} đã chọn)</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTargets(availableTargets?.map(t => t.id) || [])}
                    >
                      Chọn tất cả
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTargets([])}
                    >
                      Bỏ chọn
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md max-h-60 overflow-y-auto">
                  {availableTargets?.map((target) => (
                    <div
                      key={target.id}
                      className={`flex items-center gap-2 p-2 hover:bg-muted cursor-pointer ${
                        selectedTargets.includes(target.id) ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => {
                        if (selectedTargets.includes(target.id)) {
                          setSelectedTargets(selectedTargets.filter(id => id !== target.id));
                        } else {
                          setSelectedTargets([...selectedTargets, target.id]);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTargets.includes(target.id)}
                        onChange={() => {}}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">{target.name}</span>
                      {target.code && <Badge variant="outline">{target.code}</Badge>}
                      {target.hasAssignment && <Badge variant="secondary">Đã gán</Badge>}
                    </div>
                  ))}
                  {(!availableTargets || availableTargets.length === 0) && (
                    <div className="p-4 text-center text-muted-foreground">
                      Không có target nào khả dụng
                    </div>
                  )}
                </div>
              </div>

              {selectedTargets.length > 0 && (
                <div className="bg-muted p-3 rounded-md">
                  <p className="text-sm"><strong>Preview:</strong> Sẽ gán profile cho {selectedTargets.length} {bulkAssignTargetType}(s)</p>
                  {bulkReplaceExisting && (
                    <p className="text-sm text-orange-600">Các assignments hiện có sẽ bị thay thế</p>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowBulkAssignDialog(false);
                setSelectedTargets([]);
              }}>
                Hủy
              </Button>
              <Button 
                onClick={handleBulkAssign}
                disabled={selectedTargets.length === 0 || bulkAssign.isPending}
              >
                {bulkAssign.isPending ? 'Đang gán...' : `Gán ${selectedTargets.length} targets`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
