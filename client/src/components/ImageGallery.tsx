import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ChevronLeft, 
  ChevronRight, 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Download,
  Grid3X3,
  List,
  Search,
  Filter,
  Maximize2,
  Image as ImageIcon,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CheckSquare,
  Square,
  FlipHorizontal,
  FlipVertical,
  Sun,
  Contrast,
  RefreshCw,
} from "lucide-react";
import { BulkAnnotationToolbar } from "./BulkAnnotationToolbar";
import { cn } from "@/lib/utils";

export interface GalleryImage {
  id: number | string;
  url: string;
  thumbnailUrl?: string;
  title: string;
  description?: string;
  result?: "OK" | "NG" | "NTF";
  measurementPointId?: number;
  measurementPointName?: string;
  value?: number;
  standardValue?: number;
  upperLimit?: number;
  lowerLimit?: number;
  timestamp?: Date;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  title?: string;
  showFilters?: boolean;
  showSearch?: boolean;
  initialViewMode?: "grid" | "list";
  columns?: 2 | 3 | 4 | 5 | 6;
  onImageClick?: (image: GalleryImage, index: number) => void;
  className?: string;
  enableMultiSelect?: boolean;
  onRefresh?: () => void;
  /** Open lightbox at this image index on mount */
  initialSelectedIndex?: number | null;
  /** Called when lightbox is closed (useful when opened via initialSelectedIndex) */
  onLightboxClose?: () => void;
  /** Max visible images in grid before scroll (0 = no limit) */
  maxVisibleImages?: number;
  /** Compact mode: hides toolbar, stats, view toggle — for embedding in narrow panels */
  compact?: boolean;
}

export function ImageGallery({
  images,
  title = "Image Gallery",
  showFilters = true,
  showSearch = true,
  initialViewMode = "grid",
  columns = 4,
  onImageClick,
  className,
  enableMultiSelect = true,
  onRefresh,
  initialSelectedIndex = null,
  onLightboxClose,
  maxVisibleImages = 0,
  compact = false,
}: ImageGalleryProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"grid" | "list">(initialViewMode);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initialSelectedIndex);
  const [filter, setFilter] = useState<"all" | "OK" | "NG" | "NTF">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Image processing state
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [invert, setInvert] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(false);
  
  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  const toggleImageSelection = (imageId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  };

  const selectAllImages = () => {
    setSelectedImages(new Set(filteredImages.map(img => String(img.id))));
  };

  const clearSelection = () => {
    setSelectedImages(new Set());
    setIsMultiSelectMode(false);
  };

  const getSelectedImagesData = () => {
    return filteredImages
      .filter(img => selectedImages.has(String(img.id)))
      .map(img => ({
        id: String(img.id),
        url: img.url,
        inspectionId: img.measurementPointId,
      }));
  };

  // Filter and search images
  const filteredImages = images.filter((img) => {
    const matchesFilter = filter === "all" || img.result === filter;
    const matchesSearch = !searchQuery || 
      img.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      img.measurementPointName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      img.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const selectedImage = selectedIndex !== null ? filteredImages[selectedIndex] : null;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIndex === null) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          navigatePrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          navigateNext();
          break;
        case "Escape":
          e.preventDefault();
          closeLightbox();
          break;
        case "+":
        case "=":
          e.preventDefault();
          handleZoomIn();
          break;
        case "-":
          e.preventDefault();
          handleZoomOut();
          break;
        case "r":
          e.preventDefault();
          handleRotate();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filteredImages.length]);

  const openLightbox = useCallback((index: number) => {
    setSelectedIndex(index);
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setBrightness(100);
    setContrast(100);
    setFlipH(false);
    setFlipV(false);
    setInvert(false);
    if (onImageClick) {
      onImageClick(filteredImages[index], index);
    }
  }, [filteredImages, onImageClick]);

  const closeLightbox = useCallback(() => {
    setSelectedIndex(null);
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setBrightness(100);
    setContrast(100);
    setFlipH(false);
    setFlipV(false);
    setInvert(false);
    setShowAdjustments(false);
    if (onLightboxClose) onLightboxClose();
  }, [onLightboxClose]);

  const navigatePrev = useCallback(() => {
    if (selectedIndex === null) return;
    const newIndex = selectedIndex > 0 ? selectedIndex - 1 : filteredImages.length - 1;
    setSelectedIndex(newIndex);
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, [selectedIndex, filteredImages.length]);

  const navigateNext = useCallback(() => {
    if (selectedIndex === null) return;
    const newIndex = selectedIndex < filteredImages.length - 1 ? selectedIndex + 1 : 0;
    setSelectedIndex(newIndex);
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, [selectedIndex, filteredImages.length]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleResetAdjustments = () => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setBrightness(100);
    setContrast(100);
    setFlipH(false);
    setFlipV(false);
    setInvert(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDownload = async () => {
    if (!selectedImage) return;
    try {
      const response = await fetch(selectedImage.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedImage.title || "image"}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const getResultIcon = (result?: string) => {
    switch (result) {
      case "OK":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "NG":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "NTF":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      default:
        return null;
    }
  };

  const getResultBadge = (result?: string) => {
    switch (result) {
      case "OK":
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/50">OK</Badge>;
      case "NG":
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/50">NG</Badge>;
      case "NTF":
        return <Badge className="bg-orange-500/20 text-orange-500 border-orange-500/50">NTF</Badge>;
      default:
        return null;
    }
  };

  const getColumnClass = () => {
    switch (columns) {
      case 2: return "grid-cols-2";
      case 3: return "grid-cols-2 md:grid-cols-3";
      case 4: return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
      case 5: return "grid-cols-2 md:grid-cols-3 lg:grid-cols-5";
      case 6: return "grid-cols-2 md:grid-cols-4 lg:grid-cols-6";
      default: return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
    }
  };

  // Stats
  const stats = {
    total: images.length,
    ok: images.filter(i => i.result === "OK").length,
    ng: images.filter(i => i.result === "NG").length,
    ntf: images.filter(i => i.result === "NTF").length,
  };

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-4", className)}>
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between gap-2",
        !compact && "flex-col md:flex-row md:items-center gap-4"
      )}>
        <div className="min-w-0">
          <h3 className={cn(compact ? "text-xs font-semibold truncate" : "text-lg font-semibold")}>{title}</h3>
          {!compact && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span>{t('common.total')}: {stats.total}</span>
              <span className="text-green-500">OK: {stats.ok}</span>
              <span className="text-red-500">NG: {stats.ng}</span>
              <span className="text-orange-500">NTF: {stats.ntf}</span>
            </div>
          )}
        </div>

        {!compact && (
        <div className="flex items-center gap-2">
          {/* Search */}
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('common.search') + '...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48"
              />
            </div>
          )}

          {/* Filter */}
          {showFilters && (
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-32">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="OK">OK</SelectItem>
                <SelectItem value="NG">NG</SelectItem>
                <SelectItem value="NTF">NTF</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Multi-Select Toggle */}
          {enableMultiSelect && (
            <Button
              variant={isMultiSelectMode ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setIsMultiSelectMode(!isMultiSelectMode);
                if (isMultiSelectMode) {
                  setSelectedImages(new Set());
                }
              }}
              className="gap-1"
            >
              <CheckSquare className="h-4 w-4" />
              {isMultiSelectMode ? t('common.exitSelect') : t('common.multiSelect')}
            </Button>
          )}

          {/* View Mode Toggle */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="rounded-r-none"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="rounded-l-none"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        )}
      </div>

      {/* Gallery Content */}
      {filteredImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mb-4" />
          <p>{t('common.noImages')}</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className={cn(
          maxVisibleImages > 0 && "max-h-70 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent pr-0.5"
        )}>
          <div className={cn("grid", compact ? "gap-2" : "gap-4", getColumnClass())}>
          {filteredImages.map((image, index) => {
            const imageId = String(image.id);
            const isSelected = selectedImages.has(imageId);
            return (
              <div
                key={image.id}
                className={cn(
                  "group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer transition-all",
                  isSelected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"
                )}
                onClick={() => {
                  if (isMultiSelectMode) {
                    toggleImageSelection(imageId);
                  } else {
                    openLightbox(index);
                  }
                }}
              >
                <ImageWithLoader
                  src={image.thumbnailUrl || image.url}
                  alt={image.title}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                
                {/* Overlay */}
                <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                {/* Selection Checkbox */}
                {isMultiSelectMode && (
                  <div 
                    className="absolute top-2 left-2 z-10"
                    onClick={(e) => toggleImageSelection(imageId, e)}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded border-2 flex items-center justify-center transition-colors",
                      isSelected 
                        ? "bg-primary border-primary text-primary-foreground" 
                        : "bg-black/50 border-white/70 hover:border-white"
                    )}>
                      {isSelected && <CheckSquare className="h-4 w-4" />}
                    </div>
                  </div>
                )}

                {/* Result Badge */}
                {image.result && (
                  <div className={cn("absolute top-2", isMultiSelectMode ? "right-2" : "right-2")}>
                    {getResultBadge(image.result)}
                  </div>
                )}

                {/* Info Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-sm font-medium truncate">{image.title}</p>
                  {image.measurementPointName && (
                    <p className="text-xs opacity-80 truncate">{image.measurementPointName}</p>
                  )}
                </div>

                {/* Expand Icon - only show when not in multi-select mode */}
                {!isMultiSelectMode && (
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black/50 rounded-full p-1.5">
                      <Maximize2 className="h-4 w-4 text-white" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}          </div>        </div>
      ) : (
        <div className="space-y-2">
          {filteredImages.map((image, index) => {
            const imageId = String(image.id);
            const isSelected = selectedImages.has(imageId);
            return (
              <div
                key={image.id}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg border bg-card cursor-pointer transition-colors",
                  isSelected ? "ring-2 ring-primary bg-primary/5" : "hover:bg-accent/50"
                )}
                onClick={() => {
                  if (isMultiSelectMode) {
                    toggleImageSelection(imageId);
                  } else {
                    openLightbox(index);
                  }
                }}
              >
                {/* Selection Checkbox */}
                {isMultiSelectMode && (
                  <div 
                    className="shrink-0"
                    onClick={(e) => toggleImageSelection(imageId, e)}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                      isSelected 
                        ? "bg-primary border-primary text-primary-foreground" 
                        : "border-muted-foreground/50 hover:border-primary"
                    )}>
                      {isSelected && <CheckSquare className="h-3 w-3" />}
                    </div>
                  </div>
                )}
                <div className="relative w-16 h-16 rounded-md overflow-hidden shrink-0">
                  <ImageWithLoader
                    src={image.thumbnailUrl || image.url}
                    alt={image.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{image.title}</p>
                    {getResultIcon(image.result)}
                  </div>
                  {image.measurementPointName && (
                    <p className="text-sm text-muted-foreground truncate">{image.measurementPointName}</p>
                  )}
                  {image.value !== undefined && (
                    <p className="text-sm text-muted-foreground">
                      {t('common.value')}: {image.value} 
                      {image.standardValue !== undefined && ` / ${t('common.standard')}: ${image.standardValue}`}
                    </p>
                  )}
                </div>
                {image.result && (
                  <div className="shrink-0">
                    {getResultBadge(image.result)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Dialog */}
      <Dialog open={selectedIndex !== null} onOpenChange={(open) => !open && closeLightbox()}>
        <DialogContent className="max-w-[90vw] w-[90vw] max-h-[85vh] p-0 overflow-hidden" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Image viewer</DialogTitle>
            <DialogDescription>Image lightbox</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col h-[80vh]">
            {/* Lightbox Header */}
            <div className="flex items-center justify-between p-4 border-b bg-background">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  {selectedIndex !== null ? selectedIndex + 1 : 0} / {filteredImages.length}
                </span>
                {selectedImage && (
                  <>
                    <span className="font-medium">{selectedImage.title}</span>
                    {selectedImage.result && getResultBadge(selectedImage.result)}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={handleZoomOut} title={t('common.zoomOut') + ' (-)'}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" onClick={handleZoomIn} title={t('common.zoomIn') + ' (+)'}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="icon" onClick={handleRotate} title={t('common.rotate') + ' (R)'}>
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button variant={flipH ? "secondary" : "ghost"} size="icon" onClick={() => setFlipH(f => !f)} title={t('common.flipHorizontal') || 'Flip H'}>
                  <FlipHorizontal className="h-4 w-4" />
                </Button>
                <Button variant={flipV ? "secondary" : "ghost"} size="icon" onClick={() => setFlipV(f => !f)} title={t('common.flipVertical') || 'Flip V'}>
                  <FlipVertical className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant={showAdjustments ? "secondary" : "ghost"} size="icon" onClick={() => setShowAdjustments(s => !s)} title={t('common.adjustments') || 'Adjustments'}>
                  <Sun className="h-4 w-4" />
                </Button>
                <Button variant={invert ? "secondary" : "ghost"} size="icon" onClick={() => setInvert(i => !i)} title={t('common.invert') || 'Invert'}>
                  <Contrast className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleResetAdjustments} title={t('common.reset') || 'Reset'}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="icon" onClick={handleDownload} title={t('common.download')}>
                  <Download className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={closeLightbox} title={t('common.close') + ' (ESC)'} className="hover:bg-destructive/20 hover:text-destructive">
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Brightness/Contrast Adjustments Panel */}
            {showAdjustments && (
              <div className="flex items-center gap-4 px-4 py-2 border-b bg-background/95">
                <div className="flex items-center gap-2 flex-1">
                  <Sun className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground w-20 shrink-0">{t('common.brightness') || 'Brightness'}: {brightness}%</span>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <Contrast className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground w-20 shrink-0">{t('common.contrast') || 'Contrast'}: {contrast}%</span>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>
            )}

            {/* Lightbox Content */}
            <div 
              className="flex-1 relative bg-black/90 overflow-hidden"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={(e) => {
                e.preventDefault();
                if (e.deltaY < 0) {
                  setZoom((z) => Math.min(z + 0.15, 5));
                } else {
                  setZoom((z) => {
                    const next = Math.max(z - 0.15, 0.5);
                    if (next <= 1) setPosition({ x: 0, y: 0 });
                    return next;
                  });
                }
              }}
            >
              {/* Navigation Buttons */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full h-12 w-12"
                onClick={(e) => { e.stopPropagation(); navigatePrev(); }}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full h-12 w-12"
                onClick={(e) => { e.stopPropagation(); navigateNext(); }}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>

              {/* Image */}
              <div className="flex items-center justify-center h-full">
                {selectedImage && (
                  <img
                    ref={imageRef}
                    src={selectedImage.url}
                    alt={selectedImage.title}
                    className="max-w-full max-h-full object-contain transition-transform"
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg) translate(${position.x / zoom}px, ${position.y / zoom}px) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                      filter: `brightness(${brightness}%) contrast(${contrast}%)${invert ? ' invert(1)' : ''}`,
                      cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                    }}
                    draggable={false}
                  />
                )}
              </div>
            </div>

            {/* Lightbox Footer - Image Details */}
            {selectedImage && (
              <div className="p-4 border-t bg-background">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {selectedImage.measurementPointName && (
                    <div>
                      <span className="text-muted-foreground">{t('products.measurementPoint')}:</span>
                      <p className="font-medium">{selectedImage.measurementPointName}</p>
                    </div>
                  )}
                  {selectedImage.value !== undefined && (
                    <div>
                      <span className="text-muted-foreground">{t('common.value')}:</span>
                      <p className="font-medium">{selectedImage.value}</p>
                    </div>
                  )}
                  {selectedImage.standardValue !== undefined && (
                    <div>
                      <span className="text-muted-foreground">{t('common.standardValue')}:</span>
                      <p className="font-medium">{selectedImage.standardValue}</p>
                    </div>
                  )}
                  {(selectedImage.upperLimit !== undefined || selectedImage.lowerLimit !== undefined) && (
                    <div>
                      <span className="text-muted-foreground">{t('common.limit')}:</span>
                      <p className="font-medium">
                        {selectedImage.lowerLimit ?? "-"} ~ {selectedImage.upperLimit ?? "-"}
                      </p>
                    </div>
                  )}
                  {selectedImage.description && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">{t('common.description')}:</span>
                      <p className="font-medium">{selectedImage.description}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Thumbnail Strip */}
            <div className="p-2 border-t bg-background overflow-x-auto">
              <div className="flex gap-2">
                {filteredImages.map((image, index) => (
                  <div
                    key={image.id}
                    className={cn(
                      "relative w-16 h-16 rounded-md overflow-hidden shrink-0 cursor-pointer border-2 transition-all",
                      index === selectedIndex ? "border-primary ring-2 ring-primary/50" : "border-transparent hover:border-muted-foreground/50"
                    )}
                    onClick={() => {
                      setSelectedIndex(index);
                      setZoom(1);
                      setRotation(0);
                      setPosition({ x: 0, y: 0 });
                    }}
                  >
                    <img
                      src={image.thumbnailUrl || image.url}
                      alt={image.title}
                      className="w-full h-full object-cover"
                    />
                    {image.result && (
                      <div className="absolute bottom-0.5 right-0.5">
                        {getResultIcon(image.result)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Annotation Toolbar */}
      {enableMultiSelect && selectedImages.size > 0 && (
        <BulkAnnotationToolbar
          selectedImages={getSelectedImagesData()}
          onClearSelection={clearSelection}
          onSelectAll={selectAllImages}
          totalImages={filteredImages.length}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

// Image with loading state
function ImageWithLoader({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <>
      {isLoading && (
        <Skeleton className="absolute inset-0" />
      )}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={cn(className, isLoading && "opacity-0")}
          onLoad={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); setError(true); }}
        />
      )}
    </>
  );
}

export default ImageGallery;
