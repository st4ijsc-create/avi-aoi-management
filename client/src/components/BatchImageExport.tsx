import React, { useState } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Download,
  FileArchive,
  FileText,
  CheckSquare,
  Square,
  Loader2,
  Image as ImageIcon,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { GalleryImage } from './ImageGallery';

interface BatchImageExportProps {
  images: GalleryImage[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
}

export function BatchImageExport({ images, onSelectionChange }: BatchImageExportProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportType, setExportType] = useState<'zip' | 'pdf' | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const toggleSelection = (id: string | number) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
    onSelectionChange?.(Array.from(newSelection));
  };

  const selectAll = () => {
    const allIds = new Set(images.map((img) => img.id));
    setSelectedIds(allIds);
    onSelectionChange?.(Array.from(allIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    onSelectionChange?.([]);
  };

  const getSelectedImages = () => {
    return images.filter((img) => selectedIds.has(img.id));
  };

  const exportToZip = async () => {
    const selectedImages = getSelectedImages();
    if (selectedImages.length === 0) {
      toast.error('Vui lòng chọn ít nhất một ảnh');
      return;
    }

    setIsExporting(true);
    setExportType('zip');
    setExportProgress(0);

    try {
      const zip = new JSZip();
      const folder = zip.folder('images');

      for (let i = 0; i < selectedImages.length; i++) {
        const img = selectedImages[i];
        try {
          const response = await fetch(img.url);
          const blob = await response.blob();
          const extension = img.url.split('.').pop()?.split('?')[0] || 'jpg';
          const filename = `${img.title.replace(/[^a-zA-Z0-9]/g, '_')}_${i + 1}.${extension}`;
          folder?.file(filename, blob);
        } catch (error) {
          console.error(`Failed to fetch image: ${img.url}`, error);
        }
        setExportProgress(((i + 1) / selectedImages.length) * 100);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `images_export_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Đã xuất ${selectedImages.length} ảnh thành công`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Lỗi khi xuất ảnh');
    } finally {
      setIsExporting(false);
      setExportType(null);
      setShowExportDialog(false);
    }
  };

  const exportToPdf = async () => {
    const selectedImages = getSelectedImages();
    if (selectedImages.length === 0) {
      toast.error('Vui lòng chọn ít nhất một ảnh');
      return;
    }

    setIsExporting(true);
    setExportType('pdf');
    setExportProgress(0);

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - 2 * margin;

      // Title page
      pdf.setFontSize(24);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Báo Cáo Hình Ảnh Kiểm Tra', pageWidth / 2, 40, { align: 'center' });

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}`, pageWidth / 2, 55, { align: 'center' });
      pdf.text(`Tổng số ảnh: ${selectedImages.length}`, pageWidth / 2, 65, { align: 'center' });

      // Summary stats
      const okCount = selectedImages.filter((img) => img.result === 'OK').length;
      const ngCount = selectedImages.filter((img) => img.result === 'NG').length;
      const ntfCount = selectedImages.filter((img) => img.result === 'NTF').length;

      pdf.setFontSize(14);
      pdf.text('Thống kê:', margin, 85);
      pdf.setFontSize(11);
      pdf.setTextColor(34, 197, 94); // green
      pdf.text(`OK: ${okCount}`, margin + 10, 95);
      pdf.setTextColor(239, 68, 68); // red
      pdf.text(`NG: ${ngCount}`, margin + 50, 95);
      pdf.setTextColor(234, 179, 8); // yellow
      pdf.text(`NTF: ${ntfCount}`, margin + 90, 95);
      pdf.setTextColor(0, 0, 0);

      // Images
      for (let i = 0; i < selectedImages.length; i++) {
        const img = selectedImages[i];
        pdf.addPage();

        // Header
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Ảnh ${i + 1}/${selectedImages.length}`, margin, 20);

        // Image info
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        let yPos = 30;

        pdf.text(`Tiêu đề: ${img.title}`, margin, yPos);
        yPos += 6;

        if (img.measurementPointName) {
          pdf.text(`Điểm đo: ${img.measurementPointName}`, margin, yPos);
          yPos += 6;
        }

        if (img.result) {
          const resultColor = img.result === 'OK' ? [34, 197, 94] : img.result === 'NG' ? [239, 68, 68] : [234, 179, 8];
          pdf.setTextColor(resultColor[0], resultColor[1], resultColor[2]);
          pdf.text(`Kết quả: ${img.result}`, margin, yPos);
          pdf.setTextColor(0, 0, 0);
          yPos += 6;
        }

        if (img.value !== undefined) {
          pdf.text(`Giá trị đo: ${img.value}`, margin, yPos);
          yPos += 6;
        }

        if (img.standardValue !== undefined) {
          pdf.text(`Giá trị chuẩn: ${img.standardValue}`, margin, yPos);
          yPos += 6;
        }

        if (img.upperLimit !== undefined && img.lowerLimit !== undefined) {
          pdf.text(`Giới hạn: ${img.lowerLimit} - ${img.upperLimit}`, margin, yPos);
          yPos += 6;
        }

        if (img.timestamp) {
          pdf.text(`Thời gian: ${new Date(img.timestamp).toLocaleString('vi-VN')}`, margin, yPos);
          yPos += 6;
        }

        if (img.description) {
          pdf.text(`Ghi chú: ${img.description}`, margin, yPos);
          yPos += 6;
        }

        // Add image
        try {
          const response = await fetch(img.url);
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });

          const imgElement = document.createElement('img');
          await new Promise<void>((resolve) => {
            imgElement.onload = () => resolve();
            imgElement.src = base64;
          });

          const imgWidth = imgElement.width;
          const imgHeight = imgElement.height;
          const maxWidth = contentWidth;
          const maxHeight = pageHeight - yPos - margin - 20;
          
          let displayWidth = maxWidth;
          let displayHeight = (imgHeight / imgWidth) * displayWidth;
          
          if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = (imgWidth / imgHeight) * displayHeight;
          }

          const xPos = margin + (contentWidth - displayWidth) / 2;
          pdf.addImage(base64, 'JPEG', xPos, yPos + 5, displayWidth, displayHeight);
        } catch (error) {
          console.error(`Failed to add image to PDF: ${img.url}`, error);
          pdf.setTextColor(239, 68, 68);
          pdf.text('Không thể tải hình ảnh', margin, yPos + 20);
          pdf.setTextColor(0, 0, 0);
        }

        setExportProgress(((i + 1) / selectedImages.length) * 100);
      }

      // Footer on each page
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(128, 128, 128);
        pdf.text(
          `Trang ${i}/${totalPages} - AVI/AOI Management System`,
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' }
        );
      }

      pdf.save(`inspection_report_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`Đã xuất báo cáo PDF với ${selectedImages.length} ảnh`);
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('Lỗi khi xuất PDF');
    } finally {
      setIsExporting(false);
      setExportType(null);
      setShowExportDialog(false);
    }
  };

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  return (
    <>
      {/* Selection toolbar */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={selectAll}
            className="gap-1"
          >
            <CheckSquare className="h-4 w-4" />
            Chọn tất cả
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={deselectAll}
            disabled={!hasSelection}
            className="gap-1"
          >
            <Square className="h-4 w-4" />
            Bỏ chọn
          </Button>
        </div>

        <div className="flex-1 text-center">
          <Badge variant={hasSelection ? 'default' : 'secondary'}>
            {selectedCount} / {images.length} ảnh đã chọn
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExportDialog(true)}
            disabled={!hasSelection || isExporting}
            className="gap-1"
          >
            <Download className="h-4 w-4" />
            Xuất ({selectedCount})
          </Button>
        </div>
      </div>

      {/* Image grid with checkboxes */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {images.map((img) => (
          <div
            key={img.id}
            className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
              selectedIds.has(img.id)
                ? 'border-primary ring-2 ring-primary/50'
                : 'border-transparent hover:border-muted-foreground/30'
            }`}
            onClick={() => toggleSelection(img.id)}
          >
            {/* Checkbox */}
            <div className="absolute top-2 left-2 z-10">
              <Checkbox
                checked={selectedIds.has(img.id)}
                onCheckedChange={() => toggleSelection(img.id)}
                className="bg-background/80 border-2"
              />
            </div>

            {/* Result badge */}
            {img.result && (
              <div className="absolute top-2 right-2 z-10">
                <Badge
                  variant={
                    img.result === 'OK'
                      ? 'default'
                      : img.result === 'NG'
                      ? 'destructive'
                      : 'secondary'
                  }
                  className="gap-1"
                >
                  {img.result === 'OK' && <CheckCircle className="h-3 w-3" />}
                  {img.result === 'NG' && <XCircle className="h-3 w-3" />}
                  {img.result === 'NTF' && <AlertTriangle className="h-3 w-3" />}
                  {img.result}
                </Badge>
              </div>
            )}

            {/* Image */}
            <div className="aspect-square bg-muted">
              <img
                src={img.thumbnailUrl || img.url}
                alt={img.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>

            {/* Title overlay */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <p className="text-white text-xs truncate">{img.title}</p>
              {img.measurementPointName && (
                <p className="text-white/70 text-xs truncate">{img.measurementPointName}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Export dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xuất hình ảnh</DialogTitle>
            <DialogDescription>
              Chọn định dạng xuất cho {selectedCount} ảnh đã chọn
            </DialogDescription>
          </DialogHeader>

          {isExporting ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>
                  Đang xuất {exportType === 'zip' ? 'ZIP' : 'PDF'}...
                </span>
              </div>
              <Progress value={exportProgress} />
              <p className="text-sm text-muted-foreground text-center">
                {Math.round(exportProgress)}%
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 py-4">
              <Card
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={exportToZip}
              >
                <CardContent className="flex flex-col items-center justify-center p-6">
                  <FileArchive className="h-12 w-12 text-muted-foreground mb-2" />
                  <h3 className="font-medium">Xuất ZIP</h3>
                  <p className="text-xs text-muted-foreground text-center mt-1">
                    Tải tất cả ảnh gốc trong file nén
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={exportToPdf}
              >
                <CardContent className="flex flex-col items-center justify-center p-6">
                  <FileText className="h-12 w-12 text-muted-foreground mb-2" />
                  <h3 className="font-medium">Xuất PDF</h3>
                  <p className="text-xs text-muted-foreground text-center mt-1">
                    Báo cáo với ảnh và thông tin chi tiết
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              disabled={isExporting}
            >
              Hủy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BatchImageExport;
