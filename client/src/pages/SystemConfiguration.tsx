import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Settings, RefreshCw, AlertTriangle, CheckCircle2, Power } from "lucide-react";

/**
 * Embeddable system configuration content component (no DashboardLayout wrapper).
 * Used both by the standalone SystemConfiguration page and the AdminPage tab.
 */
export function SystemConfigContent() {
  const { t } = useTranslation();
  const { data: configs, isLoading, refetch } = trpc.systemConfig.list.useQuery();
  const updateConfig = trpc.systemConfig.update.useMutation({
    onSuccess: () => {
      toast.success(t('admin.configUpdatedSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('admin.configUpdateError')}: ${error.message}`);
    },
  });

  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});

  const mqttConfig = configs?.find((c) => c.configKey === "MQTT_ENABLED");
  const websocketConfig = configs?.find((c) => c.configKey === "WEBSOCKET_ENABLED");

  const handleToggle = (key: string, currentValue: string) => {
    const newValue = currentValue === "true" ? "false" : "true";
    setPendingChanges((prev) => ({ ...prev, [key]: newValue }));
  };

  const handleSave = async () => {
    try {
      for (const [key, value] of Object.entries(pendingChanges)) {
        await updateConfig.mutateAsync({ key, value });
      }
      setPendingChanges({});
      toast.info(t('admin.serverRestartRequired'), {
        description: t('admin.serverRestartDescription'),
        duration: 5000,
      });
    } catch (error) {
      // Error already handled in onError
    }
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const getMqttValue = () => {
    if (pendingChanges["MQTT_ENABLED"]) {
      return pendingChanges["MQTT_ENABLED"] === "true";
    }
    return mqttConfig?.configValue === "true";
  };

  const getWebSocketValue = () => {
    if (pendingChanges["WEBSOCKET_ENABLED"]) {
      return pendingChanges["WEBSOCKET_ENABLED"] === "true";
    }
    return websocketConfig?.configValue === "true";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — DS PageHeader (shared pattern) */}
      <PageHeader
        icon={<Settings className="h-6 w-6" />}
        title={t('admin.systemConfiguration')}
        description={t('admin.manageSettings')}
        actions={
          hasPendingChanges ? (
            <Button onClick={handleSave} disabled={updateConfig.isPending}>
              {updateConfig.isPending && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              {t('common.saveChanges')}
            </Button>
          ) : undefined
        }
      />

      {/* Warning Banner */}
      {hasPendingChanges && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
              <div>
                <p className="font-medium">{t('admin.pendingChanges')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('admin.unsavedChangesWarning')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MQTT Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="w-5 h-5" />
            {t('admin.mqttBroker')}
            {getMqttValue() ? (
              <StatusBadge status="enabled" tone="success" label={<span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('common.enabled')}</span>} className="ml-2" />
            ) : (
              <StatusBadge status="disabled" tone="default" label={t('common.disabled')} className="ml-2" />
            )}
          </CardTitle>
          <CardDescription>
            {t('admin.mqttDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="mqtt-enabled">{t('admin.enableMqtt')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('admin.mqttMobileDescription')}
              </p>
            </div>
            <Switch
              id="mqtt-enabled"
              checked={getMqttValue()}
              onCheckedChange={() =>
                handleToggle("MQTT_ENABLED", mqttConfig?.configValue || "false")
              }
            />
          </div>
          {mqttConfig?.requiresRestart && (
            <p className="text-xs text-warning mt-4 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t('admin.requiresRestart')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* WebSocket Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="w-5 h-5" />
            {t('admin.websocketServer')}
            {getWebSocketValue() ? (
              <StatusBadge status="enabled" tone="success" label={<span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('common.enabled')}</span>} className="ml-2" />
            ) : (
              <StatusBadge status="disabled" tone="default" label={t('common.disabled')} className="ml-2" />
            )}
          </CardTitle>
          <CardDescription>
            {t('admin.websocketDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="websocket-enabled">{t('admin.enableWebsocket')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('admin.websocketRealtimeDescription')}
              </p>
            </div>
            <Switch
              id="websocket-enabled"
              checked={getWebSocketValue()}
              onCheckedChange={() =>
                handleToggle("WEBSOCKET_ENABLED", websocketConfig?.configValue || "false")
              }
            />
          </div>
          {websocketConfig?.requiresRestart && (
            <p className="text-xs text-warning mt-4 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t('admin.requiresRestart')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Restart Instructions */}
      <Card className="border-info/50 bg-info/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-info mt-0.5" />
            <div>
              <p className="font-medium">{t('admin.serverRestartRequired')}</p>
              <p className="text-sm text-muted-foreground">
                {t('admin.restartInstructions')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SystemConfiguration() {
  return (
    <DashboardLayout>
      <PageContainer>
        <SystemConfigContent />
      </PageContainer>
    </DashboardLayout>
  );
}
