import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const [location, setLocation] = useLocation();

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

  if (!isAdmin) {
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Settings className="h-6 w-6 text-primary" />
              {t("monitoringSettings.title")}
            </h1>
            <p className="text-muted-foreground">{t("monitoringSettings.description")}</p>
          </div>
        </div>

        <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex gap-6">
            {/* Vertical Sidebar Navigation */}
            <div className="w-64 shrink-0 space-y-1">

              {/* Category: Machine Management */}
              <div className="space-y-1">
                <button
                  onClick={() => toggleCategory('machines')}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-blue-500" />
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
                    <Radio className="h-4 w-4 text-green-500" />
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
      </div>
    </DashboardLayout>
  );
}
