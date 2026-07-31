import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { mapTrpcError } from '@/lib/trpcErrors';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  CheckSquare,
  Square,
  Copy,
  Trash2,
  Download,
  FileText,
  Loader2,
  X,
  LayoutTemplate,
  Wand2
} from 'lucide-react';

interface SelectedImage {
  id: string;
  url: string;
  inspectionId?: number;
}

interface BulkAnnotationToolbarProps {
  selectedImages: SelectedImage[];
  onClearSelection: () => void;
  onSelectAll?: () => void;
  totalImages?: number;
  onRefresh?: () => void;
}

export function BulkAnnotationToolbar({
  selectedImages,
  onClearSelection,
  onSelectAll,
  totalImages = 0,
  onRefresh,
}: BulkAnnotationToolbarProps) {
  const { t } = useTranslation();
  const [isApplyTemplateOpen, setIsApplyTemplateOpen] = useState(false);
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch templates
  const { data: templates } = trpc.annotationTemplate.list.useQuery();

  // Mutations
  const bulkApplyTemplate = trpc.annotation.bulkApplyTemplate.useMutation({
    onSuccess: (data) => {
      toast.success(t('annotation.bulk.templateApplied', { count: data.appliedCount }));
      setIsApplyTemplateOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${mapTrpcError(error)}`);
    },
  });

  const copyAnnotations = trpc.annotation.copyAnnotations.useMutation({
    onSuccess: (data) => {
      toast.success(t('annotation.bulk.annotationsCopied', { count: data.copiedCount }));
      setIsCopyDialogOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`${t('common.error')}: ${mapTrpcError(error)}`);
    },
  });

  const bulkDelete = trpc.annotation.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(t('annotation.bulk.annotationsDeleted', { count: data.deletedCount }));
      setIsDeleteDialogOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`${t('common.error')}: ${mapTrpcError(error)}`);
    },
  });

  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) {
      toast.error(t('annotation.bulk.selectTemplate'));
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      await bulkApplyTemplate.mutateAsync({
        templateId: parseInt(selectedTemplateId),
        imageUrls: selectedImages.map(img => img.url),
        inspectionIds: selectedImages.map(img => img.inspectionId).filter(Boolean) as number[],
      });
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  const handleCopyAnnotations = async () => {
    if (!sourceImageUrl) {
      toast.error(t('annotation.bulk.selectSourceImage'));
      return;
    }

    const targetImages = selectedImages.filter(img => img.url !== sourceImageUrl);
    if (targetImages.length === 0) {
      toast.error(t('annotation.bulk.noTargetImages'));
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      await copyAnnotations.mutateAsync({
        sourceImageUrl,
        targetImageUrls: targetImages.map(img => img.url),
        targetInspectionIds: targetImages.map(img => img.inspectionId).filter(Boolean) as number[],
      });
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  const handleBulkDelete = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      await bulkDelete.mutateAsync({
        imageUrls: selectedImages.map(img => img.url),
      });
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  if (selectedImages.length === 0) {
    return null;
  }

  return (
    <>
      {/* Floating Toolbar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background border rounded-lg shadow-lg p-3 flex items-center gap-3">
        <div className="flex items-center gap-2 pr-3 border-r">
          <Badge variant="secondary" className="gap-1">
            <CheckSquare className="h-3 w-3" />
            {selectedImages.length} {t('annotation.bulk.selected')}
          </Badge>
          {totalImages > 0 && (
            <span className="text-xs text-muted-foreground">
              / {totalImages}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onSelectAll && (
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              <Square className="h-4 w-4 mr-1" />
              {t('common.selectAll')}
            </Button>
          )}

          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsApplyTemplateOpen(true)}
            className="gap-1"
          >
            <LayoutTemplate className="h-4 w-4" />
            Áp dụng Template
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsCopyDialogOpen(true)}
            className="gap-1"
          >
            <Copy className="h-4 w-4" />
            {t('annotation.bulk.copy')}
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsDeleteDialogOpen(true)}
            className="gap-1 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClearSelection}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            {t('annotation.bulk.deselect')}
          </Button>
        </div>
      </div>

      {/* Apply Template Dialog */}
      <Dialog open={isApplyTemplateOpen} onOpenChange={setIsApplyTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" />
              {t('annotation.bulk.applyTemplateTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('annotation.bulk.applyTemplateDesc', { count: selectedImages.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('annotation.bulk.chooseTemplate')}</label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('annotation.bulk.selectTemplatePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {templates?.map((template: any) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {template.name}
                        <Badge variant="outline" className="text-xs">
                          {template.annotations?.length || 0} annotations
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground text-center">
                  Đang xử lý...
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApplyTemplateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleApplyTemplate} 
              disabled={!selectedTemplateId || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('annotation.bulk.processing')}
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  {t('common.apply')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy Annotations Dialog */}
      <Dialog open={isCopyDialogOpen} onOpenChange={setIsCopyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5" />
              {t('annotation.bulk.copyAnnotation')}
            </DialogTitle>
            <DialogDescription>
              {t('annotation.bulk.copyAnnotationDesc', { count: selectedImages.length - 1 })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('annotation.bulk.selectSource')}</label>
              <Select value={sourceImageUrl} onValueChange={setSourceImageUrl}>
                <SelectTrigger>
                  <SelectValue placeholder={t('annotation.bulk.selectSourcePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {selectedImages.map((img) => (
                    <SelectItem key={img.id} value={img.url}>
                      <div className="flex items-center gap-2">
                        <img 
                          src={img.url} 
                          alt="" 
                          className="w-8 h-8 object-cover rounded"
                        />
                        <span className="truncate max-w-[200px]">{img.id}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground text-center">
                  {t('annotation.bulk.copying')}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCopyDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleCopyAnnotations} 
              disabled={!sourceImageUrl || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('annotation.bulk.copying')}
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  {t('annotation.bulk.copy')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {t('annotation.bulk.confirmDeleteTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('annotation.bulk.confirmDeleteDesc', { count: selectedImages.length })}
            </DialogDescription>
          </DialogHeader>

          {isProcessing && (
            <div className="space-y-2 py-4">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">
                {t('annotation.bulk.deleting')}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              variant="destructive"
              onClick={handleBulkDelete} 
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('annotation.bulk.deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('annotation.bulk.deleteAll')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BulkAnnotationToolbar;
