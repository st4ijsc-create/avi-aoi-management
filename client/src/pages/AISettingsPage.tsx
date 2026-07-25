import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader } from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  TestTube2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings2,
  Brain,
  Shield,
  Database,
  RefreshCw,
  Save,
  Server,
  Globe,
  Cpu,
  HardDrive,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { toast } from 'sonner';

type ApiKeyProvider = 'openai' | 'azure_openai' | 'huggingface' | 'custom';
type ApiKeyStatus = 'active' | 'inactive' | 'expired' | 'error';

interface ApiKeyEntry {
  id: number;
  name: string;
  provider: ApiKeyProvider;
  maskedKey?: string;
  endpoint?: string | null;
  status: ApiKeyStatus;
  lastTestedAt?: string | Date | null;
  createdAt?: string | Date;
}

const PROVIDER_INFO: Record<ApiKeyProvider, { label: string; icon: React.ReactNode; color: string }> = {
  openai: { label: 'OpenAI', icon: <Brain className="h-4 w-4" />, color: 'bg-success/10 text-success' },
  azure_openai: { label: 'Azure OpenAI', icon: <Globe className="h-4 w-4" />, color: 'bg-info/10 text-info' },
  huggingface: { label: 'Hugging Face', icon: <Cpu className="h-4 w-4" />, color: 'bg-warning/10 text-warning' },
  custom: { label: 'Custom', icon: <Server className="h-4 w-4" />, color: 'bg-primary/10 text-primary' },
};

const STATUS_CONFIG: Record<ApiKeyStatus, { label: string; icon: React.ReactNode; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  active: { label: 'Active', icon: <CheckCircle2 className="h-3 w-3" />, variant: 'default' },
  inactive: { label: 'Inactive', icon: <AlertTriangle className="h-3 w-3" />, variant: 'secondary' },
  expired: { label: 'Expired', icon: <Clock className="h-3 w-3" />, variant: 'outline' },
  error: { label: 'Error', icon: <XCircle className="h-3 w-3" />, variant: 'destructive' },
};

export default function AISettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('api-keys');

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Settings2 className="h-6 w-6" />}
          title={t('aiSettings.title', 'AI Settings')}
          description={t('aiSettings.description', 'Manage AI model configurations, API keys, and system settings')}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              {t('aiSettings.tabs.apiKeys', 'API Keys')}
            </TabsTrigger>
            <TabsTrigger value="model-config" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              {t('aiSettings.tabs.modelConfig', 'Model Config')}
            </TabsTrigger>
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t('aiSettings.tabs.system', 'System')}
            </TabsTrigger>
            <TabsTrigger value="hybrid" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t('aiSettings.tabs.hybrid', 'Hybrid Provider')}
            </TabsTrigger>
          </TabsList>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-4">
            <ApiKeysSection />
          </TabsContent>

          {/* Model Config Tab */}
          <TabsContent value="model-config" className="space-y-4">
            <ModelConfigSection />
          </TabsContent>

          {/* System Tab */}
          <TabsContent value="system" className="space-y-4">
            <SystemConfigSection />
          </TabsContent>

          {/* Hybrid Provider Tab (S2.6) */}
          <TabsContent value="hybrid" className="space-y-4">
            <HybridProviderSection />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ─── API Keys Management Section ─────────────────────────────────────────────

function ApiKeysSection() {
  const { t } = useTranslation();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set());

  // Fetch API keys
  const { data: apiKeys, isLoading, refetch } = trpc.aiSettings.listApiKeys.useQuery();
  const createMutation = trpc.aiSettings.createApiKey.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.apiKeys.created', 'API key created successfully'));
      refetch();
      setShowAddDialog(false);
    },
    onError: (err) => {
      toast.error(`${t('common.error', 'Error')}: ${err.message}`);
    },
  });
  const deleteMutation = trpc.aiSettings.deleteApiKey.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.apiKeys.deleted', 'API key deleted'));
      refetch();
    },
  });
  const testMutation = trpc.aiSettings.testApiKey.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('aiSettings.apiKeys.testSuccess', 'Connection successful'));
      } else {
        toast.error(t('aiSettings.apiKeys.testFailed', 'Connection failed'));
      }
      refetch();
    },
  });
  const toggleMutation = trpc.aiSettings.toggleApiKey.useMutation({
    onSuccess: () => { refetch(); },
  });

  const toggleKeyVisibility = (id: number) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  const keys: ApiKeyEntry[] = apiKeys ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('aiSettings.apiKeys.title', 'API Key Management')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('aiSettings.apiKeys.description', 'Configure API keys for external AI services')}
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t('aiSettings.apiKeys.add', 'Add API Key')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <AddApiKeyForm
              onSubmit={(data) => createMutation.mutate(data)}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {keys.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Key className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">{t('aiSettings.apiKeys.empty', 'No API Keys Configured')}</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {t('aiSettings.apiKeys.emptyDesc', 'Add API keys to connect to external AI providers like OpenAI, Azure, or Hugging Face.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {keys.map((key) => {
            const provider = PROVIDER_INFO[key.provider] ?? PROVIDER_INFO.custom;
            const status = STATUS_CONFIG[key.status] ?? STATUS_CONFIG.inactive;
            return (
              <Card key={key.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={cn('p-2 rounded-lg', provider.color)}>
                        {provider.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{key.name}</span>
                          <Badge variant={status.variant} className="flex items-center gap-1 text-xs">
                            {status.icon}
                            {status.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{provider.label}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                            {visibleKeys.has(key.id) ? (key.maskedKey ?? '••••••••••••') : '••••••••••••' + (key.maskedKey?.slice(-4) ?? '')}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleKeyVisibility(key.id)}
                          >
                            {visibleKeys.has(key.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </Button>
                        </div>
                        {key.endpoint && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('aiSettings.apiKeys.endpoint', 'Endpoint')}: {key.endpoint}
                          </p>
                        )}
                        {key.lastTestedAt && (
                          <p className="text-xs text-muted-foreground">
                            {t('aiSettings.apiKeys.lastTested', 'Last tested')}: {format(new Date(key.lastTestedAt), 'dd/MM/yyyy HH:mm')}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={key.status === 'active'}
                        onCheckedChange={() => toggleMutation.mutate({ id: key.id })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => testMutation.mutate({ id: key.id })}
                        disabled={testMutation.isPending}
                      >
                        <TestTube2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteMutation.mutate({ id: key.id })}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Add API Key Form ────────────────────────────────────────────────────────

function AddApiKeyForm({ onSubmit, isLoading }: {
  onSubmit: (data: { name: string; provider: ApiKeyProvider; apiKey: string; endpoint?: string }) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ApiKeyProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, provider, apiKey, endpoint: endpoint || undefined });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t('aiSettings.apiKeys.addTitle', 'Add New API Key')}</DialogTitle>
        <DialogDescription>
          {t('aiSettings.apiKeys.addDesc', 'Configure a new API key for an AI service provider. Keys are encrypted at rest.')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>{t('aiSettings.apiKeys.name', 'Name')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('aiSettings.apiKeys.namePlaceholder', 'e.g. Production OpenAI Key')}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>{t('aiSettings.apiKeys.provider', 'Provider')}</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ApiKeyProvider)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-2">
                    {info.icon}
                    {info.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t('aiSettings.apiKeys.key', 'API Key')}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
          />
        </div>
        {(provider === 'azure_openai' || provider === 'custom') && (
          <div className="space-y-2">
            <Label>{t('aiSettings.apiKeys.endpoint', 'Endpoint')}</Label>
            <Input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://..."
            />
          </div>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" type="button">{t('common.cancel', 'Cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={isLoading || !name || !apiKey}>
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
          {t('aiSettings.apiKeys.add', 'Add API Key')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Model Configuration Section ─────────────────────────────────────────────

function ModelConfigSection() {
  const { t } = useTranslation();
  const { data: models, isLoading } = trpc.aiModel.list.useQuery();
  const { data: config, isLoading: configLoading } = trpc.aiSettings.getConfig.useQuery();
  const updateConfigMutation = trpc.aiSettings.updateConfig.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.saved', 'Settings saved'));
    },
  });

  const [defaultModel, setDefaultModel] = useState('');
  const [confidenceThreshold, setConfidenceThreshold] = useState('0.85');
  const [maxConcurrentInferences, setMaxConcurrentInferences] = useState('4');
  const [enableGpuAcceleration, setEnableGpuAcceleration] = useState(true);
  const [autoscaleEnabled, setAutoscaleEnabled] = useState(false);

  // Sync config when loaded
  useEffect(() => {
    if (config) {
      if (config.defaultModelId) setDefaultModel(String(config.defaultModelId));
      if (config.confidenceThreshold) setConfidenceThreshold(String(config.confidenceThreshold));
      if (config.maxConcurrentInferences) setMaxConcurrentInferences(String(config.maxConcurrentInferences));
      if (config.gpuAcceleration !== undefined) setEnableGpuAcceleration(config.gpuAcceleration);
      if (config.autoScale !== undefined) setAutoscaleEnabled(config.autoScale);
    }
  }, [config]);

  const handleSave = () => {
    updateConfigMutation.mutate({
      defaultModelId: defaultModel ? Number(defaultModel) : undefined,
      confidenceThreshold: Number(confidenceThreshold),
      maxConcurrentInferences: Number(maxConcurrentInferences),
      gpuAcceleration: enableGpuAcceleration,
      autoScale: autoscaleEnabled,
    });
  };

  const modelList = models ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiSettings.modelConfig.title', 'Model Configuration')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('aiSettings.modelConfig.description', 'Configure default model behavior and inference parameters')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Default Model */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" />
              {t('aiSettings.modelConfig.defaultModel', 'Default Model')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger>
                <SelectValue placeholder={t('aiSettings.modelConfig.selectModel', 'Select a model')} />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m: any) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name} ({m.format})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Confidence Threshold */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t('aiSettings.modelConfig.confidence', 'Confidence Threshold')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(e.target.value)}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                ({(Number(confidenceThreshold) * 100).toFixed(0)}%)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Max Concurrent Inferences */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              {t('aiSettings.modelConfig.maxConcurrent', 'Max Concurrent Inferences')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              type="number"
              min="1"
              max="32"
              value={maxConcurrentInferences}
              onChange={(e) => setMaxConcurrentInferences(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* GPU Acceleration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              {t('aiSettings.modelConfig.gpu', 'GPU Acceleration')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {enableGpuAcceleration
                  ? t('aiSettings.modelConfig.gpuEnabled', 'GPU enabled')
                  : t('aiSettings.modelConfig.gpuDisabled', 'CPU only')}
              </span>
              <Switch checked={enableGpuAcceleration} onCheckedChange={setEnableGpuAcceleration} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Autoscale */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                {t('aiSettings.modelConfig.autoscale', 'Auto-scale Inference Workers')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('aiSettings.modelConfig.autoscaleDesc', 'Automatically adjust the number of inference workers based on demand')}
              </p>
            </div>
            <Switch checked={autoscaleEnabled} onCheckedChange={setAutoscaleEnabled} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateConfigMutation.isPending}>
          {updateConfigMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {t('common.save', 'Save')}
        </Button>
      </div>
    </div>
  );
}

// ─── System Configuration Section ────────────────────────────────────────────

function SystemConfigSection() {
  const { t } = useTranslation();
  const { data: sysConfig, isLoading } = trpc.aiSettings.getSystemConfig.useQuery();
  const updateMutation = trpc.aiSettings.updateSystemConfig.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.saved', 'Settings saved'));
    },
  });

  const [enableAiFeatures, setEnableAiFeatures] = useState(true);
  const [logInferenceRequests, setLogInferenceRequests] = useState(true);
  const [retentionDays, setRetentionDays] = useState('90');
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState('500');

  // Sync system config when loaded
  useEffect(() => {
    if (sysConfig) {
      if (sysConfig.aiEnabled !== undefined) setEnableAiFeatures(sysConfig.aiEnabled);
      if (sysConfig.inferenceLogging !== undefined) setLogInferenceRequests(sysConfig.inferenceLogging);
      if (sysConfig.dataRetentionDays) setRetentionDays(String(sysConfig.dataRetentionDays));
      if (sysConfig.maxUploadSizeMb) setMaxUploadSizeMb(String(sysConfig.maxUploadSizeMb));
    }
  }, [sysConfig]);

  const handleSave = () => {
    updateMutation.mutate({
      aiEnabled: enableAiFeatures,
      inferenceLogging: logInferenceRequests,
      dataRetentionDays: Number(retentionDays),
      maxUploadSizeMb: Number(maxUploadSizeMb),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiSettings.system.title', 'System Configuration')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('aiSettings.system.description', 'Global AI system settings and resource limits')}
        </p>
      </div>

      <div className="grid gap-4">
        {/* Enable AI Features */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{t('aiSettings.system.enableAi', 'Enable AI Features')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('aiSettings.system.enableAiDesc', 'Master switch to enable or disable all AI features across the system')}
                </p>
              </div>
              <Switch checked={enableAiFeatures} onCheckedChange={setEnableAiFeatures} />
            </div>
          </CardContent>
        </Card>

        {/* Inference Logging */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{t('aiSettings.system.logInference', 'Log Inference Requests')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('aiSettings.system.logInferenceDesc', 'Store inference request/response data for auditing and analysis')}
                </p>
              </div>
              <Switch checked={logInferenceRequests} onCheckedChange={setLogInferenceRequests} />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Data Retention */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4" />
                {t('aiSettings.system.retention', 'Data Retention (days)')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                min="7"
                max="365"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('aiSettings.system.retentionDesc', 'How long to keep AI inference logs and results')}
              </p>
            </CardContent>
          </Card>

          {/* Max Upload Size */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                {t('aiSettings.system.maxUpload', 'Max Model Upload Size (MB)')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                min="10"
                max="5000"
                value={maxUploadSizeMb}
                onChange={(e) => setMaxUploadSizeMb(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('aiSettings.system.maxUploadDesc', 'Maximum file size for model uploads')}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {t('common.save', 'Save')}
        </Button>
      </div>
    </div>
  );
}

// ─── Hybrid Provider Section (S2.6) ──────────────────────────────────────────

function HybridProviderSection() {
  const { t } = useTranslation();
  const { data, isLoading, refetch } = trpc.aiSettings.getHybridProviderStatus.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const setConfig = trpc.aiSettings.setHybridProviderConfig.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.hybrid.configUpdated', 'Provider config updated'));
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const resetBreaker = trpc.aiSettings.resetHybridBreaker.useMutation({
    onSuccess: () => {
      toast.success(t('aiSettings.hybrid.breakerReset', 'Breaker reset'));
      refetch();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const { config, ggufAvailable, openaiConfigured, breakers, recentEvents } = data;
  const breakerKeys = Object.keys(breakers);

  return (
    <div className="space-y-4">
      {/* Provider Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('aiSettings.hybrid.provider', 'Primary Provider & Fallback')}
          </CardTitle>
          <CardDescription>
            {t('aiSettings.hybrid.providerDesc', 'Choose primary AI provider; fallback automatically engages on failure or open circuit.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('aiSettings.hybrid.primary', 'Primary Provider')}</Label>
              <Select
                value={config.primary}
                onValueChange={(v) => setConfig.mutate({ primary: v as 'openai' | 'gguf' })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai" disabled={!openaiConfigured}>
                    OpenAI {!openaiConfigured && '(no API key)'}
                  </SelectItem>
                  <SelectItem value="gguf" disabled={!ggufAvailable}>
                    GGUF (local) {!ggufAvailable && '(unavailable)'}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('aiSettings.hybrid.fallback', 'Fallback Enabled')}</Label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  checked={config.fallbackEnabled}
                  onCheckedChange={(v) => setConfig.mutate({ fallbackEnabled: v })}
                />
                <span className="text-sm text-muted-foreground">
                  {config.fallbackEnabled
                    ? t('aiSettings.hybrid.fallbackOn', 'Auto-failover ON')
                    : t('aiSettings.hybrid.fallbackOff', 'Disabled — primary only')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant={openaiConfigured ? 'default' : 'secondary'}>
              <Globe className="h-3 w-3 mr-1" /> OpenAI: {openaiConfigured ? 'Configured' : 'Missing key'}
            </Badge>
            <Badge variant={ggufAvailable ? 'default' : 'secondary'}>
              <HardDrive className="h-3 w-3 mr-1" /> GGUF: {ggufAvailable ? 'Available' : 'Not loaded'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Model Paths */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            {t('aiSettings.hybrid.models', 'Model Configuration')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ModelRow label="Cloud Text Model" value={config.cloudTextModel || '—'} />
          <ModelRow label="Cloud Vision Model" value={config.cloudVisionModel || '—'} />
          <ModelRow label="GGUF Text Model" value={config.ggufTextModel || '—'} />
          <ModelRow label="GGUF Vision Model" value={config.ggufVisionModel || '—'} />
          <ModelRow label="GGUF Vision MMProj" value={config.ggufVisionMmproj || '—'} />
        </CardContent>
      </Card>

      {/* Circuit Breakers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {t('aiSettings.hybrid.breakers', 'Circuit Breakers')}
            </CardTitle>
            <CardDescription>
              {t('aiSettings.hybrid.breakersDesc', '3 failures within 60s opens the circuit for 5 minutes.')}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => resetBreaker.mutate({})}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {t('aiSettings.hybrid.resetAll', 'Reset all')}
          </Button>
        </CardHeader>
        <CardContent>
          {breakerKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('aiSettings.hybrid.noBreakers', 'No breaker activity yet.')}
            </p>
          ) : (
            <div className="space-y-2">
              {breakerKeys.map((k) => {
                const b = breakers[k];
                return (
                  <div key={k} className="flex items-center justify-between border rounded-md p-3">
                    <div className="flex items-center gap-3">
                      <Badge variant={b.open ? 'destructive' : 'default'}>
                        {b.open ? 'OPEN' : 'CLOSED'}
                      </Badge>
                      <span className="font-mono text-sm">{k}</span>
                      <span className="text-xs text-muted-foreground">
                        fails: {b.consecutiveFailures}
                        {b.open && ` · until ${format(new Date(b.openUntil), 'HH:mm:ss')}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.lastError && (
                        <span className="text-xs text-destructive truncate max-w-xs" title={b.lastError}>
                          {b.lastError}
                        </span>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => resetBreaker.mutate({ key: k })}>
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {t('aiSettings.hybrid.events', 'Recent AI Events')}
          </CardTitle>
          <CardDescription>
            {t('aiSettings.hybrid.eventsDesc', 'Latest 100 provider invocations (auto-refresh 10s).')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 w-full">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('aiSettings.hybrid.noEvents', 'No events recorded yet.')}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-left">
                    <th className="p-2">Time</th>
                    <th className="p-2">Cap</th>
                    <th className="p-2">Provider</th>
                    <th className="p-2">Model</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">ms</th>
                    <th className="p-2 text-right">tok/s</th>
                    <th className="p-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((e, i) => (
                    <tr key={i} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono whitespace-nowrap">
                        {format(new Date(e.ts), 'HH:mm:ss')}
                      </td>
                      <td className="p-2">{e.capability}</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">
                          {e.provider}
                          {e.fallbackUsed && ' (fb)'}
                        </Badge>
                      </td>
                      <td className="p-2 font-mono truncate max-w-40" title={e.model}>{e.model}</td>
                      <td className="p-2">
                        {e.success ? (
                          <Badge variant="default" className="text-xs">OK</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">FAIL</Badge>
                        )}
                      </td>
                      <td className="p-2 text-right">{e.totalTimeMs}</td>
                      <td className="p-2 text-right">{e.tokensPerSecond?.toFixed(1) ?? '—'}</td>
                      <td className="p-2 text-destructive truncate max-w-50" title={e.error}>{e.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function ModelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
