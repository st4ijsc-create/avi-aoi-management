import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { navItems } from '@/lib/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitBranch, CheckCircle2, Clock, Archive, RefreshCw, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
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
      toast.error(err.message ?? 'Failed to activate version');
      setActivatingId(null);
    },
  });

  const handleActivate = (modelId: number, versionId: number) => {
    setActivatingId(versionId);
    activateVersion.mutate({ modelId, versionId });
  };

  const selectedModel = models?.find(m => m.id === selectedModelId);

  return (
    <DashboardLayout title="Model Version Registry" navItems={navItems} currentPath="/model-versions">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <GitBranch className="h-6 w-6 text-primary" />
              Model Version Registry
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage, compare and activate model versions across your AI models
            </p>
          </div>
          {selectedModelId && (
            <Button variant="outline" size="sm" onClick={() => refetchVersions()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
        </div>

        {/* Model Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Model</CardTitle>
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
                  <SelectValue placeholder="Choose an AI model..." />
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
                {selectedModel?.name ?? 'Model'} — Versions
              </CardTitle>
              <CardDescription>
                Click "Activate" to make a version the live inference model. This will evict the session cache.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {versionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !versions || versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Archive className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">No versions found for this model</p>
                  <p className="text-xs mt-1">Upload a model file to create the first version</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[480px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Changelog</TableHead>
                        <TableHead>File Size</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((v: any) => {
                        const statusKey = (v.status as VersionStatus) ?? 'INACTIVE';
                        const cfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.INACTIVE;
                        const isActive = v.status === 'ACTIVE';
                        const isActivating = activatingId === v.id;

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
                            <TableCell className="max-w-xs">
                              <p className="text-sm text-muted-foreground truncate">
                                {v.changeLog ?? <span className="italic opacity-50">No changelog</span>}
                              </p>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {v.fileSizeBytes
                                ? `${(v.fileSizeBytes / 1_048_576).toFixed(1)} MB`
                                : '—'}
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
                                  onClick={() => handleActivate(selectedModelId, v.id)}
                                >
                                  {isActivating ? (
                                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 mr-1" />
                                  )}
                                  Activate
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
              <p>Select a model above to view its version history</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
