import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Settings, RefreshCw, AlertTriangle, CheckCircle2, Power } from "lucide-react";

export default function SystemConfiguration() {
  const { data: configs, isLoading, refetch } = trpc.systemConfig.list.useQuery();
  const updateConfig = trpc.systemConfig.update.useMutation({
    onSuccess: () => {
      toast.success("Configuration updated successfully");
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to update configuration: ${error.message}`);
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
      toast.info("Server restart required to apply changes", {
        description: "Please restart the server manually or use the restart button below.",
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
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Settings className="w-8 h-8" />
              System Configuration
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage system-wide settings (Admin only)
            </p>
          </div>
          {hasPendingChanges && (
            <Button onClick={handleSave} disabled={updateConfig.isPending}>
              {updateConfig.isPending && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          )}
        </div>

        {/* Warning Banner */}
        {hasPendingChanges && (
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5" />
                <div>
                  <p className="font-medium">Pending Changes</p>
                  <p className="text-sm text-muted-foreground">
                    You have unsaved changes. Click "Save Changes" to apply them. Server restart
                    will be required.
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
              MQTT Broker
              {getMqttValue() ? (
                <Badge variant="default" className="ml-2">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Enabled
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-2">
                  Disabled
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Control the internal MQTT broker for mobile app communication
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="mqtt-enabled">Enable MQTT Broker</Label>
                <p className="text-sm text-muted-foreground">
                  Allows mobile devices to connect and receive real-time notifications
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
              <p className="text-xs text-orange-400 mt-4 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Requires server restart to take effect
              </p>
            )}
          </CardContent>
        </Card>

        {/* WebSocket Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="w-5 h-5" />
              WebSocket Server
              {getWebSocketValue() ? (
                <Badge variant="default" className="ml-2">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Enabled
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-2">
                  Disabled
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Control the WebSocket server for real-time dashboard updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="websocket-enabled">Enable WebSocket Server</Label>
                <p className="text-sm text-muted-foreground">
                  Enables real-time updates for dashboards and live monitoring
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
              <p className="text-xs text-orange-400 mt-4 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Requires server restart to take effect
              </p>
            )}
          </CardContent>
        </Card>

        {/* Restart Instructions */}
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-blue-400 mt-0.5" />
              <div>
                <p className="font-medium">Server Restart Required</p>
                <p className="text-sm text-muted-foreground">
                  After saving changes, restart the server to apply new configurations. You can
                  restart the server by clicking the "Restart" button in the Management UI or by
                  restarting the dev server manually.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
