import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export function SMTPConfig() {
  const { t } = useTranslation();
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const { data: config, isLoading, refetch } = trpc.smtp.getConfig.useQuery();
  const updateConfigMutation = trpc.smtp.updateConfig.useMutation({
    onSuccess: () => {
      toast.success(t('settings.smtpSaved'));
      refetch();
    },
    onError: (error) => {
      toast.error(`${t('common.error')}: ${error.message}`);
    },
  });

  const testConnectionMutation = trpc.smtp.testConnection.useMutation({
    onSuccess: () => {
      toast.success(t('settings.smtpConnectionSuccess'));
      setIsTestingConnection(false);
    },
    onError: (error) => {
      toast.error(`${t('settings.smtpConnectionFailed')}: ${error.message}`);
      setIsTestingConnection(false);
    },
  });

  const [formData, setFormData] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "SYNAPSE",
  });

  useEffect(() => {
    if (config) {
      setFormData({
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        password: config.password, // Will be '********' from API
        fromEmail: config.fromEmail,
        fromName: config.fromName,
      });
    }
  }, [config]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfigMutation.mutate(formData);
  };

  const handleTestConnection = () => {
    // Validate required fields
    if (!formData.host || !formData.username || !formData.fromEmail) {
      toast.error(t('settings.smtpFillRequired'));
      return;
    }
    
    setIsTestingConnection(true);
    // Send current form data for testing
    testConnectionMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.smtpConfig')}</CardTitle>
        <CardDescription>
          {t('settings.smtpConfigDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="host">SMTP Host *</Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="smtp.gmail.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="port">Port *</Label>
              <Input
                id="port"
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="secure"
              checked={formData.secure}
              onCheckedChange={(checked) => setFormData({ ...formData, secure: checked })}
            />
            <Label htmlFor="secure">
              {t('settings.smtpUseSSL')}
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder={config ? t('settings.smtpLeaveBlank') : ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fromEmail">From Email *</Label>
              <Input
                id="fromEmail"
                type="email"
                value={formData.fromEmail}
                onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
                placeholder="noreply@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fromName">From Name *</Label>
              <Input
                id="fromName"
                value={formData.fromName}
                onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button 
              type="submit" 
              disabled={updateConfigMutation.isPending}
            >
              {updateConfigMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                t('settings.saveConfig')
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={isTestingConnection || !formData.host || !formData.username}
              className="bg-muted/50 hover:bg-muted"
            >
              {isTestingConnection ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings.testing')}
                </>
              ) : (
                t('settings.testConnection')
              )}
            </Button>
          </div>

          {config && (
            <div className="mt-4 p-3 bg-muted rounded-md text-sm">
              <p className="text-muted-foreground">
                {t('settings.smtpConfigSavedHint')}
              </p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
