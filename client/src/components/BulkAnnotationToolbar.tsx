import { useState } from 'react';
import { trpc } from '@/lib/trpc';
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
      toast.success(`Đã áp dụng template cho ${data.appliedCount} hình ảnh`);
      setIsApplyTemplateOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const copyAnnotations = trpc.annotation.copyAnnotations.useMutation({
    onSuccess: (data) => {
      toast.success(`Đã sao chép annotation đến ${data.copiedCount} hình ảnh`);
      setIsCopyDialogOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const bulkDelete = trpc.annotation.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`Đã xóa annotation từ ${data.deletedCount} hình ảnh`);
      setIsDeleteDialogOpen(false);
      onClearSelection();
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) {
      toast.error('Vui lòng chọn template');
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
      toast.error('Vui lòng chọn hình ảnh nguồn');
      return;
    }

    const targetImages = selectedImages.filter(img => img.url !== sourceImageUrl);
    if (targetImages.length === 0) {
      toast.error('Không có hình ảnh đích để sao chép');
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
            {selectedImages.length} đã chọn
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
              Chọn tất cả
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
            Sao chép
          </Button>

          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsDeleteDialogOpen(true)}
            className="gap-1 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Xóa
          </Button>

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClearSelection}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Bỏ chọn
          </Button>
        </div>
      </div>

      {/* Apply Template Dialog */}
      <Dialog open={isApplyTemplateOpen} onOpenChange={setIsApplyTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" />
              Áp dụng Template Annotation
            </DialogTitle>
            <DialogDescription>
              Áp dụng template annotation cho {selectedImages.length} hình ảnh đã chọn.
              Annotation mới sẽ được thêm vào các annotation hiện có.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chọn Template</label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn template..." />
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
              Hủy
            </Button>
            <Button 
              onClick={handleApplyTemplate} 
              disabled={!selectedTemplateId || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Áp dụng
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
              Sao chép Annotation
            </DialogTitle>
            <DialogDescription>
              Sao chép annotation từ một hình ảnh nguồn đến {selectedImages.length - 1} hình ảnh còn lại.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chọn hình ảnh nguồn</label>
              <Select value={sourceImageUrl} onValueChange={setSourceImageUrl}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn hình ảnh nguồn..." />
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
                  Đang sao chép...
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCopyDialogOpen(false)}>
              Hủy
            </Button>
            <Button 
              onClick={handleCopyAnnotations} 
              disabled={!sourceImageUrl || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang sao chép...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Sao chép
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
              Xác nhận xóa Annotation
            </DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa tất cả annotation từ {selectedImages.length} hình ảnh đã chọn?
              Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>

          {isProcessing && (
            <div className="space-y-2 py-4">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">
                Đang xóa...
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Hủy
            </Button>
            <Button 
              variant="destructive"
              onClick={handleBulkDelete} 
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang xóa...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Xóa tất cả
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
