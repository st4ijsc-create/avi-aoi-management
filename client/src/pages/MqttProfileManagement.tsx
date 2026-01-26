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
  Settings2
} from "lucide-react";

export default function MqttProfileManagement() {
  const [activeTab, setActiveTab] = useState("profiles");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedProfileForAssign, setSelectedProfileForAssign] = useState<number | null>(null);

  // Queries
  const { data: profiles, refetch: refetchProfiles } = trpc.mqttClientManagement.listProfiles.useQuery();
  const { data: assignments, refetch: refetchAssignments } = trpc.mqttClientManagement.listAssignments.useQuery();
  const { data: connectionLogs, refetch: refetchLogs } = trpc.mqttClientManagement.getConnectionLogs.useQuery({ limit: 50 });
  const { data: templates } = trpc.mqttClientManagement.listTemplates.useQuery();
  const { data: dashboardStats, refetch: refetchStats } = trpc.mqttClientManagement.getDashboardStats.useQuery();
  const { data: machinesList } = trpc.machine.list.useQuery();
  const { data: stationsList } = trpc.station.list.useQuery();
  const { data: factoriesList } = trpc.factory.list.useQuery();

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
          <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Tạo Profile mới
          </Button>
        </div>

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
      </div>
    </DashboardLayout>
  );
}
