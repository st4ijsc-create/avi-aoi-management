import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader, PageContainer } from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { navItems } from '@/lib/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ModelCardManageButton } from '@/components/ai/ModelCardManageButton';
import { GitBranch, CheckCircle2, Clock, Archive, RefreshCw, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { toastTrpcError } from '@/lib/trpcErrors';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type VersionStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'VALIDATING' | 'UPLOADING' | 'FAILED';

const STATUS_CONFIG: Record<VersionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ACTIVE:     { label: 'Active',     variant: 'default' },
  INACTIVE:   { label: 'Inactive',   variant: 'secondary' },
  ARCHIVED:   { label: 'Archived',   variant: 'outline' },
  VALIDATING: { label: 'Validating', variant: 'secondary' },
  UPLOADING:  { label: 'Uploading',  variant: 'secondary' },
  FAILED:     { label: 'Failed',     variant: 'destructive' },
};

export default function ModelVersionsPage() {
  const { t } = useTranslation();
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  // WS-1: pending activation of a version that FAILED the quality gate — confirmed
  // via <AlertDialog> instead of a blocking window.confirm().
  const [gateWarn, setGateWarn] = useState<
    { modelId: number; versionId: number; reason?: string } | null
  >(null);

  // Fetch all models
  const { data: models, isLoading: modelsLoading } = trpc.aiModel.list.useQuery({
    limit: 100,
  });

  // Fetch versions for selected model
  const {
    data: versions,
    isLoading: versionsLoading,
    refetch: refetchVersions,
  } = trpc.aiModel.listVersions.useQuery(
    { modelId: selectedModelId! },
    { enabled: selectedModelId !== null },
  );

  const activateVersion = trpc.aiModel.activateVersion.useMutation({
    onSuccess: () => {
      toast.success('Version activated successfully');
      refetchVersions();
      setActivatingId(null);
    },
    onError: (err) => {
      toastTrpcError(err);
      setActivatingId(null);
    },
  });

  const doActivate = (modelId: number, versionId: number) => {
    setActivatingId(versionId);
    activateVersion.mutate({ modelId, versionId });
  };

  const handleActivate = (modelId: number, versionId: number, gatePass?: boolean, gateReason?: string) => {
    // WS-1: warn before activating a version that FAILED the quality gate
    // (accuracy regressed vs. baseline) via a confirmation dialog.
    if (gatePass === false) {
      setGateWarn({ modelId, versionId, reason: gateReason });
      return;
    }
    doActivate(modelId, versionId);
  };

  const selectedModel = models?.find(m => m.id === selectedModelId);

  return (
    <DashboardLayout title="Model Version Registry" navItems={navItems} currentPath="/model-versions">
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<GitBranch className="h-6 w-6 text-primary" />}
          title={t('mv.title', 'Model Version Registry')}
          description={t('mv.subtitle', 'Manage, compare and activate model versions across your AI models')}
          actions={
            selectedModelId ? (
              <Button variant="outline" size="sm" onClick={() => refetchVersions()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh', 'Refresh')}
              </Button>
            ) : undefined
          }
        />

        {/* Model Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('mv.selectModel', 'Select Model')}</CardTitle>
          </CardHeader>
          <CardContent>
            {modelsLoading ? (
              <Skeleton className="h-10 w-64" />
            ) : (
              <Select
                value={selectedModelId?.toString() ?? ''}
                onValueChange={(v) => setSelectedModelId(Number(v))}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder={t('mv.chooseModel', 'Choose an AI model...')} />
                </SelectTrigger>
                <SelectContent>
                  {models?.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">({m.code})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Versions Table */}
        {selectedModelId ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                {t('mv.versionsFor', '{{name}} — Versions', { name: selectedModel?.name ?? 'Model' })}
              </CardTitle>
              <CardDescription>
                {t('mv.activateHint', 'Click "Activate" to make a version the live inference model. This will evict the session cache.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* D3 (doc69 Giai đoạn 4/Wave 3) — model-card governance affordance: warns
                  when activation is currently blocked without an approved card, and is
                  always the entry point to view/create/approve one. */}
              <ModelCardManageButton modelId={selectedModelId} onChanged={() => refetchVersions()} />
              {versionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !versions || versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Archive className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">{t('mv.noVersions', 'No versions found for this model')}</p>
                  <p className="text-xs mt-1">{t('mv.noVersionsHint', 'Upload a model file to create the first version')}</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[480px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('mv.version', 'Version')}</TableHead>
                        <TableHead>{t('common.status', 'Status')}</TableHead>
                        <TableHead>{t('mv.metrics', 'Metrics (Acc / F1)')}</TableHead>
                        <TableHead>{t('mv.gate', 'Quality Gate')}</TableHead>
                        <TableHead>{t('mv.changelog', 'Changelog')}</TableHead>
                        <TableHead>{t('mv.created', 'Created')}</TableHead>
                        <TableHead className="text-right">{t('common.action', 'Action')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((v: any) => {
                        const statusKey = (v.status as VersionStatus) ?? 'INACTIVE';
                        const cfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.INACTIVE;
                        const isActive = v.status === 'ACTIVE';
                        const isActivating = activatingId === v.id;
                        const m = (v.metrics ?? {}) as { accuracy?: number; f1Score?: number };
                        const gatePass = (v.evalReport as any)?.gate?.pass as boolean | undefined;
                        const gateReason = (v.evalReport as any)?.gate?.reason as string | undefined;

                        return (
                          <TableRow key={v.id} className={cn(isActive && 'bg-primary/5')}>
                            <TableCell className="font-mono font-medium">
                              <div className="flex items-center gap-2">
                                {isActive && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                                {v.version}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {m.accuracy != null
                                ? `${(m.accuracy * 100).toFixed(1)}% / ${m.f1Score != null ? (m.f1Score * 100).toFixed(1) + '%' : '—'}`
                                : <span className="italic opacity-50">—</span>}
                            </TableCell>
                            <TableCell>
                              {gatePass === undefined ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : gatePass ? (
                                <Badge variant="default">{t('mv.gatePass', 'Pass')}</Badge>
                              ) : (
                                <Badge variant="destructive" title={gateReason}>{t('mv.gateFail', 'Fail')}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              <p className="text-sm text-muted-foreground truncate">
                                {v.changeLog ?? <span className="italic opacity-50">{t('mv.noChangelog', 'No changelog')}</span>}
                              </p>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {v.createdAt
                                  ? format(new Date(v.createdAt), 'dd MMM yyyy HH:mm')
                                  : '—'}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {!isActive && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isActivating || activateVersion.isPending}
                                  onClick={() => handleActivate(selectedModelId, v.id, gatePass, gateReason)}
                                >
                                  {isActivating ? (
                                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 mr-1" />
                                  )}
                                  {t('mv.activate', 'Activate')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <GitBranch className="h-12 w-12 mb-4 opacity-30" />
              <p>{t('mv.selectPrompt', 'Select a model above to view its version history')}</p>
            </CardContent>
          </Card>
        )}

        {/* WS-1: gate-fail activation confirmation */}
        <AlertDialog open={gateWarn !== null} onOpenChange={(open) => { if (!open) setGateWarn(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('mv.gateWarnTitle', 'Kích hoạt phiên bản không đạt Quality Gate?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('mv.gateWarn', 'Phiên bản này KHÔNG vượt quality gate (accuracy giảm so với baseline). Vẫn kích hoạt?')}
                {gateWarn?.reason ? <span className="mt-2 block text-xs">{gateWarn.reason}</span> : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel', 'Hủy')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (gateWarn) doActivate(gateWarn.modelId, gateWarn.versionId);
                  setGateWarn(null);
                }}
              >
                {t('mv.activateAnyway', 'Vẫn kích hoạt')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </DashboardLayout>
  );
}
