import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { 
  History, 
  RotateCcw, 
  GitCompare, 
  Plus, 
  Pencil, 
  Trash2, 
  Undo2,
  User,
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useTranslation } from "react-i18next";

interface AnnotationVersionHistoryProps {
  annotationId?: number;
  imageUrl?: string;
  onRollback?: () => void;
}

export function AnnotationVersionHistory({ 
  annotationId, 
  imageUrl,
  onRollback 
}: AnnotationVersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const { t } = useTranslation();

  const { data: versions, isLoading, refetch } = trpc.annotationHistory.list.useQuery(
    { annotationId, imageUrl, limit: 50 },
    { enabled: open && (!!annotationId || !!imageUrl) }
  );

  const { data: comparison } = trpc.annotationHistory.compare.useQuery(
    { versionId1: selectedVersions[0], versionId2: selectedVersions[1] },
    { enabled: selectedVersions.length === 2 }
  );

  const rollbackMutation = trpc.annotationHistory.rollback.useMutation({
    onSuccess: () => {
      toast.success(t('annotation.rollbackSuccess'));
      refetch();
      onRollback?.();
    },
    onError: (error) => {
      toastTrpcError(error);
    },
  });

  const getChangeTypeIcon = (changeType: string) => {
    switch (changeType) {
      case 'CREATE':
        return <Plus className="h-4 w-4 text-green-500" />;
      case 'UPDATE':
        return <Pencil className="h-4 w-4 text-blue-500" />;
      case 'DELETE':
        return <Trash2 className="h-4 w-4 text-red-500" />;
      case 'ROLLBACK':
        return <Undo2 className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getChangeTypeBadge = (changeType: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      'CREATE': 'default',
      'UPDATE': 'secondary',
      'DELETE': 'destructive',
      'ROLLBACK': 'outline',
    };
    const labels: Record<string, string> = {
      'CREATE': t('annotation.changeType.create'),
      'UPDATE': t('annotation.changeType.update'),
      'DELETE': t('annotation.changeType.delete'),
      'ROLLBACK': t('annotation.changeType.rollback'),
    };
    return (
      <Badge variant={variants[changeType] || 'secondary'}>
        {labels[changeType] || changeType}
      </Badge>
    );
  };

  const handleVersionSelect = (versionId: number) => {
    if (!compareMode) return;
    
    setSelectedVersions(prev => {
      if (prev.includes(versionId)) {
        return prev.filter(id => id !== versionId);
      }
      if (prev.length >= 2) {
        return [prev[1], versionId];
      }
      return [...prev, versionId];
    });
  };

  const handleRollback = (historyId: number) => {
    if (confirm(t('annotation.confirmRollback'))) {
      rollbackMutation.mutate({ historyId });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4 mr-2" />
          {t('annotation.history')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('annotation.versionHistory')}
          </DialogTitle>
          <DialogDescription>
            {t('annotation.versionHistoryDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          <Button
            variant={compareMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setCompareMode(!compareMode);
              setSelectedVersions([]);
            }}
          >
            <GitCompare className="h-4 w-4 mr-2" />
            {compareMode ? t('annotation.disableCompare') : t('annotation.compare')}
          </Button>
          {compareMode && selectedVersions.length === 2 && (
            <span className="text-sm text-muted-foreground">
              {t('annotation.comparing2Versions')}
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Version List */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t('annotation.versions')}</h4>
            <ScrollArea className="h-[400px] pr-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : versions?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p>{t('annotation.noHistory')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {versions?.map((version: any) => (
                    <div
                      key={version.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedVersions.includes(version.id)
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleVersionSelect(version.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getChangeTypeIcon(version.changeType)}
                          <span className="font-medium">v{version.versionNumber}</span>
                          {getChangeTypeBadge(version.changeType)}
                        </div>
                        {!compareMode && version.changeType !== 'ROLLBACK' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRollback(version.id);
                            }}
                            disabled={rollbackMutation.isPending}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      
                      {version.changeSummary && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {version.changeSummary}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {version.changedByName || 'Unknown'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(version.createdAt), "dd/MM/yyyy HH:mm", { locale: vi })}
                        </span>
                      </div>
                      
                      <div className="mt-2 text-xs">
                        <span className="text-muted-foreground">
                          {version.annotations?.length || 0} annotations
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Comparison View */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm">
              {compareMode ? t('annotation.compare') : t('common.details')}
            </h4>
            <ScrollArea className="h-[400px] pr-4">
              {compareMode && selectedVersions.length === 2 && comparison ? (
                <div className="space-y-4">
                  {/* Diff Summary */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-lg bg-green-500/10 text-center">
                      <Plus className="h-4 w-4 mx-auto text-green-500" />
                      <div className="text-lg font-bold text-green-500">{comparison.diff.added}</div>
                      <div className="text-xs text-muted-foreground">{t('annotation.added')}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-500/10 text-center">
                      <Pencil className="h-4 w-4 mx-auto text-blue-500" />
                      <div className="text-lg font-bold text-blue-500">{comparison.diff.modified}</div>
                      <div className="text-xs text-muted-foreground">{t('annotation.modified')}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/10 text-center">
                      <Trash2 className="h-4 w-4 mx-auto text-red-500" />
                      <div className="text-lg font-bold text-red-500">{comparison.diff.removed}</div>
                      <div className="text-xs text-muted-foreground">{t('common.delete')}</div>
                    </div>
                  </div>

                  <Separator />

                  {/* Version Info */}
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">v{comparison.version1?.versionNumber}</Badge>
                    <ChevronRight className="h-4 w-4" />
                    <Badge variant="outline">v{comparison.version2?.versionNumber}</Badge>
                  </div>

                  {/* Added Items */}
                  {comparison.diff.addedItems?.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-green-500 mb-2">{t('annotation.added')}</h5>
                      <div className="space-y-1">
                        {comparison.diff.addedItems.map((item: any, index: number) => (
                          <div key={index} className="p-2 rounded bg-green-500/10 text-xs">
                            <span className="font-medium">{item.type}</span>
                            {item.text && <span className="ml-2">"{item.text}"</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Modified Items */}
                  {comparison.diff.modifiedItems?.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-blue-500 mb-2">{t('annotation.modified')}</h5>
                      <div className="space-y-1">
                        {comparison.diff.modifiedItems.map((item: any, index: number) => (
                          <div key={index} className="p-2 rounded bg-blue-500/10 text-xs">
                            <span className="font-medium">{item.type}</span>
                            {item.text && <span className="ml-2">"{item.text}"</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Removed Items */}
                  {comparison.diff.removedItems?.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-red-500 mb-2">{t('annotation.deleted')}</h5>
                      <div className="space-y-1">
                        {comparison.diff.removedItems.map((item: any, index: number) => (
                          <div key={index} className="p-2 rounded bg-red-500/10 text-xs">
                            <span className="font-medium">{item.type}</span>
                            {item.text && <span className="ml-2">"{item.text}"</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : compareMode ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <GitCompare className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('annotation.select2Versions')}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <History className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('annotation.selectVersionDetail')}</p>
                  <p className="text-xs mt-1">{t('annotation.orEnableCompare')}</p>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
