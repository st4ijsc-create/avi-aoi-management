import { usePermissions } from "@/_core/hooks/usePermissions";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import {
  Activity,
  HardDrive,
  Cpu,
  Wifi,
  MessageSquare,
  Play,
  Server,
  Gauge,
  ChevronDown,
  ChevronRight,
  Settings,
  Radio,
  Loader2,
} from "lucide-react";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

// Import content components from existing pages
import { MachineRegistrationContent } from "@/pages/MachineRegistration";
import { MqttClientManagementContent } from "@/pages/MqttClientManagement";
import { MqttTopicsMessagesContent } from "@/pages/MqttTopicsMessages";
import { MQTTReplayContent } from "@/pages/MQTTReplay";
import { MqttProfileManagementContent } from "@/pages/MqttProfileManagement";
import { MqttNgRateThresholdContent } from "@/pages/MqttNgRateThreshold";
import MachineMapping from "@/components/MachineMapping";
import ManualMachineMapping from "@/components/ManualMachineMapping";

export default function MonitoringSettings() {
  const { t } = useTranslation();
  const { hasPermission, loading: permsLoading } = usePermissions();
  // doc 40 DEV-02 — đồng bộ với nav row (machine_status). Trang này chỉ còn là
  // đăng ký/gán thiết bị (device-mapping), không phải quản trị hệ thống.
  const canView = hasPermission("machine_status", "canView");

  const search = useSearch();
  const [location, setLocation] = useLocation();

  // doc 40 DEV-01 — 5 tab MQTT trùng 100% ConnectivityHub. Redirect deep-link
  // ?tab=mqtt-* sang /connectivity (tab tương ứng); trang này chỉ giữ device-management
  // + machine-registration.
  const MQTT_TAB_REDIRECTS: Record<string, string> = {
    'mqtt-clients': 'clients',
    'mqtt-topics': 'topics',
    'mqtt-replay': 'replay',
    'mqtt-profiles': 'profiles',
    'mqtt-ng-rate': 'ngrate',
  };

  // Parse tab from URL query parameter
  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    const tab = params.get('tab');
    if (tab === 'mapping') return 'device-management';
    return tab || 'machine-registration';
  };

  const [activeTab, setActiveTab] = useState(getTabFromUrl);

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/monitoring-setting?tab=${tab}`);
  };

  // doc 40 DEV-01 — redirect deep-link ?tab=mqtt-* sang hub /connectivity (no reload).
  useEffect(() => {
    const params = new URLSearchParams(search);
    const tab = params.get('tab');
    if (tab && MQTT_TAB_REDIRECTS[tab]) {
      setLocation(`/connectivity?tab=${MQTT_TAB_REDIRECTS[tab]}`);
    }
  }, [search]);

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

  if (permsLoading) {
    return (
      <DashboardLayout title={t("monitoringSettings.title")} navItems={navItems} currentPath="/monitoring-setting">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!canView) {
    return (
      <DashboardLayout title={t("monitoringSettings.title")} navItems={navItems} currentPath="/monitoring-setting">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Activity className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("settings.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("settings.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("monitoringSettings.title")} navItems={navItems} currentPath="/monitoring-setting">
      <PageContainer>
        <PageHeader
          icon={<Settings className="h-5 w-5 text-primary" />}
          title={t("monitoringSettings.title")}
          description={t("monitoringSettings.description")}
        />

        <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex gap-6">
            {/* Vertical Sidebar Navigation */}
            <div className="hidden" data-legacy-hub-menu="true">

              {/* Category: Machine Management */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('machines')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-info" />
                    <span>{t("monitoringSettings.cat.machines")}</span>
                  </div>
                  {collapsedCategories['machines'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['machines'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('machine-registration')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'machine-registration' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <HardDrive className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.machineRegistration")}
                    </button>
                    <button
                      onClick={() => handleTabChange('device-management')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'device-management' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Wifi className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.deviceManagement")}
                    </button>
                  </div>
                )}
              </div>

              {/* Category: MQTT Configuration */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('mqtt')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-success" />
                    <span>{t("monitoringSettings.cat.mqtt")}</span>
                  </div>
                  {collapsedCategories['mqtt'] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {!collapsedCategories['mqtt'] && (
                  <div className="ml-6 space-y-1">
                    <button
                      onClick={() => handleTabChange('mqtt-clients')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mqtt-clients' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Wifi className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.mqttClients")}
                    </button>
                    <button
                      onClick={() => handleTabChange('mqtt-topics')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mqtt-topics' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.mqttTopics")}
                    </button>
                    <button
                      onClick={() => handleTabChange('mqtt-replay')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mqtt-replay' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Play className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.mqttReplay")}
                    </button>
                    <button
                      onClick={() => handleTabChange('mqtt-profiles')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mqtt-profiles' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Server className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.mqttProfiles")}
                    </button>
                    <button
                      onClick={() => handleTabChange('mqtt-ng-rate')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                        activeTab === 'mqtt-ng-rate' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                      }`}
                    >
                      <Gauge className="h-4 w-4" />
                      {t("monitoringSettings.sidebar.mqttNgRate")}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-w-0">
              <TabsContent value="machine-registration" className="mt-0">
                <ErrorBoundary>
                  <MachineRegistrationContent />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="device-management" className="mt-0">
                <div className="space-y-6">
                  <Card className="glass-card border-info/30 bg-info/5">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-full bg-info/20">
                          <Wifi className="h-6 w-6 text-info" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{t("settings.mqttClientsTitle")}</h3>
                          <p className="text-sm text-muted-foreground">
                            {t("settings.mqttDescription")}
                          </p>
                        </div>
                        {/* doc 40 DEV-01 — dùng wouter navigate (no full reload) thay raw <a>. */}
                        <Button onClick={() => setLocation("/connectivity?tab=clients")}>
                          {t("settings.goToMqttClients")}
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

              <TabsContent value="mqtt-clients" className="mt-0">
                <ErrorBoundary>
                  <MqttClientManagementContent />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="mqtt-topics" className="mt-0">
                <ErrorBoundary>
                  <MqttTopicsMessagesContent />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="mqtt-replay" className="mt-0">
                <ErrorBoundary>
                  <MQTTReplayContent />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="mqtt-profiles" className="mt-0">
                <ErrorBoundary>
                  <MqttProfileManagementContent />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="mqtt-ng-rate" className="mt-0">
                <ErrorBoundary>
                  <MqttNgRateThresholdContent />
                </ErrorBoundary>
              </TabsContent>
            </div>
          </div>
        </Tabs>
        </ErrorBoundary>
      </PageContainer>
    </DashboardLayout>
  );
}
