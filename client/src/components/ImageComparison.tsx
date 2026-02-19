import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeftRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Layers,
  SplitSquareVertical,
  X,
  Move,
  Eye,
  EyeOff,
  RefreshCw,
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GalleryImage } from './ImageGallery';

type CompareMode = 'side-by-side' | 'overlay' | 'slider';

interface ImageComparisonProps {
  leftImage: GalleryImage | null;
  rightImage: GalleryImage | null;
  onClose?: () => void;
  onSwap?: () => void;
  onSelectLeft?: () => void;
  onSelectRight?: () => void;
  open?: boolean;
}

export function ImageComparison({
  leftImage,
  rightImage,
  onClose,
  onSwap,
  onSelectLeft,
  onSelectRight,
  open = true,
}: ImageComparisonProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CompareMode>('side-by-side');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [showLeftInfo, setShowLeftInfo] = useState(true);
  const [showRightInfo, setShowRightInfo] = useState(true);
  const [syncZoom, setSyncZoom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Reset state when images change
  useEffect(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setSliderPosition(50);
  }, [leftImage, rightImage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case 'Escape':
          onClose?.();
          break;
        case '+':
        case '=':
          e.preventDefault();
          setZoom((z) => Math.min(z + 0.25, 3));
          break;
        case '-':
          e.preventDefault();
          setZoom((z) => Math.max(z - 0.25, 0.5));
          break;
        case 's':
          e.preventDefault();
          onSwap?.();
          break;
        case '1':
          setMode('side-by-side');
          break;
        case '2':
          setMode('overlay');
          break;
        case '3':
          setMode('slider');
          break;
        case 'ArrowLeft':
          if (mode === 'slider') {
            setSliderPosition((p) => Math.max(0, p - 5));
          }
          break;
        case 'ArrowRight':
          if (mode === 'slider') {
            setSliderPosition((p) => Math.min(100, p + 5));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, mode, onClose, onSwap]);

  // Mouse handlers for panning
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

  // Slider drag handler
  const handleSliderDrag = (e: React.MouseEvent) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const resetView = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setSliderPosition(50);
    setOverlayOpacity(0.5);
  };

  const getResultBadge = (result?: string) => {
    if (!result) return null;
    const variant = result === 'OK' ? 'default' : result === 'NG' ? 'destructive' : 'secondary';
    const Icon = result === 'OK' ? CheckCircle : result === 'NG' ? XCircle : AlertTriangle;
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {result}
      </Badge>
    );
  };

  const ImageInfo = ({ image, show, side }: { image: GalleryImage | null; show: boolean; side: 'left' | 'right' }) => {
    if (!image || !show) return null;
    return (
      <div className={cn(
        "absolute bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-white text-sm",
        side === 'left' ? 'left-0 right-1/2' : 'left-1/2 right-0'
      )}>
        <div className="flex items-center gap-2 mb-1">
          {getResultBadge(image.result)}
          <span className="font-medium truncate">{image.title}</span>
        </div>
        {image.measurementPointName && (
          <p className="text-xs text-white/70 truncate">{image.measurementPointName}</p>
        )}
        {image.value !== undefined && (
          <p className="text-xs text-white/70">
            {t('common.value')}: {image.value}
            {image.standardValue !== undefined && ` (${t('common.standard')}: ${image.standardValue})`}
          </p>
        )}
      </div>
    );
  };

  if (!leftImage && !rightImage) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <SplitSquareVertical className="h-16 w-16 text-muted-foreground" />
          <h3 className="text-lg font-medium">{t('common.imageCompareMode')}</h3>
          <p className="text-muted-foreground max-w-md">
            {t('common.imageCompareDescription')}
          </p>
          <div className="flex gap-2">
            <Button onClick={onSelectLeft} variant="outline">
              {t('common.selectLeftImage')}
            </Button>
            <Button onClick={onSelectRight} variant="outline">
              {t('common.selectRightImage')}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0">
        <div className="flex flex-col h-full">
          {/* Toolbar */}
          <div className="flex items-center gap-2 p-2 border-b bg-muted/50 flex-wrap">
            {/* Mode selection */}
            <div className="flex items-center gap-1 border-r pr-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={mode === 'side-by-side' ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setMode('side-by-side')}
                    >
                      <SplitSquareVertical className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Side-by-Side (1)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={mode === 'overlay' ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setMode('overlay')}
                    >
                      <Layers className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Overlay (2)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={mode === 'slider' ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setMode('slider')}
                    >
                      <Move className="h-4 w-4 rotate-90" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Slider (3)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-1 border-r pr-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                      disabled={zoom <= 0.5}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.zoomOut')} (-)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                      disabled={zoom >= 3}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.zoomIn')} (+)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Overlay opacity (only in overlay mode) */}
            {mode === 'overlay' && (
              <div className="flex items-center gap-2 border-r pr-2 min-w-[150px]">
                <Label className="text-xs whitespace-nowrap">{t('common.opacity')}:</Label>
                <Slider
                  value={[overlayOpacity * 100]}
                  onValueChange={([value]) => setOverlayOpacity(value / 100)}
                  min={0}
                  max={100}
                  step={5}
                  className="w-24"
                />
                <span className="text-xs w-8">{Math.round(overlayOpacity * 100)}%</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1 border-r pr-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={onSwap}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.swapPosition')} (S)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={resetView}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset view</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Info toggles */}
            <div className="flex items-center gap-1 border-r pr-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showLeftInfo ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setShowLeftInfo(!showLeftInfo)}
                    >
                      {showLeftInfo ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.toggleInfoLeft')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showRightInfo ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setShowRightInfo(!showRightInfo)}
                    >
                      {showRightInfo ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('common.toggleInfoRight')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Close */}
            <div className="ml-auto">
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Comparison area */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden bg-muted/30 relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          >
            {mode === 'side-by-side' && (
              <div className="flex h-full">
                {/* Left image */}
                <div className="flex-1 relative overflow-hidden border-r">
                  {leftImage ? (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img
                          src={leftImage.url}
                          alt={leftImage.title}
                          className="max-w-full max-h-full object-contain transition-transform"
                          style={{
                            transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                          }}
                        />
                      </div>
                      <ImageInfo image={leftImage} show={showLeftInfo} side="left" />
                      <div className="absolute top-2 left-2">
                        <Badge variant="outline" className="bg-background/80">{t('common.originalImage')}</Badge>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Button onClick={onSelectLeft} variant="outline">{t('common.selectLeftImage')}</Button>
                    </div>
                  )}
                </div>

                {/* Right image */}
                <div className="flex-1 relative overflow-hidden">
                  {rightImage ? (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img
                          src={rightImage.url}
                          alt={rightImage.title}
                          className="max-w-full max-h-full object-contain transition-transform"
                          style={{
                            transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                          }}
                        />
                      </div>
                      <ImageInfo image={rightImage} show={showRightInfo} side="right" />
                      <div className="absolute top-2 right-2">
                        <Badge variant="outline" className="bg-background/80">{t('common.comparisonImage')}</Badge>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Button onClick={onSelectRight} variant="outline">{t('common.selectRightImage')}</Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'overlay' && leftImage && rightImage && (
              <div className="relative h-full flex items-center justify-center">
                <div className="relative">
                  <img
                    src={leftImage.url}
                    alt={leftImage.title}
                    className="max-w-full max-h-[calc(100vh-120px)] object-contain"
                    style={{
                      transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                    }}
                  />
                  <img
                    src={rightImage.url}
                    alt={rightImage.title}
                    className="absolute inset-0 max-w-full max-h-[calc(100vh-120px)] object-contain"
                    style={{
                      opacity: overlayOpacity,
                      transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                    }}
                  />
                </div>
                <div className="absolute bottom-4 left-4 right-4 flex justify-between">
                  {showLeftInfo && (
                    <div className="bg-black/70 text-white p-2 rounded text-sm">
                      <div className="flex items-center gap-2">
                        {getResultBadge(leftImage.result)}
                        <span>{leftImage.title}</span>
                      </div>
                    </div>
                  )}
                  {showRightInfo && (
                    <div className="bg-black/70 text-white p-2 rounded text-sm">
                      <div className="flex items-center gap-2">
                        {getResultBadge(rightImage.result)}
                        <span>{rightImage.title}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'slider' && leftImage && rightImage && (
              <div
                ref={sliderRef}
                className="relative h-full flex items-center justify-center cursor-col-resize"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const handleMove = (e: MouseEvent) => {
                    if (!sliderRef.current) return;
                    const rect = sliderRef.current.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
                    setSliderPosition(percentage);
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                }}
              >
                <div className="relative overflow-hidden" style={{ width: '100%', height: '100%' }}>
                  {/* Right image (full) */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <img
                      src={rightImage.url}
                      alt={rightImage.title}
                      className="max-w-full max-h-[calc(100vh-120px)] object-contain"
                      style={{
                        transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                      }}
                    />
                  </div>

                  {/* Left image (clipped) */}
                  <div
                    className="absolute inset-0 flex items-center justify-center overflow-hidden"
                    style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
                  >
                    <img
                      src={leftImage.url}
                      alt={leftImage.title}
                      className="max-w-full max-h-[calc(100vh-120px)] object-contain"
                      style={{
                        transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                      }}
                    />
                  </div>

                  {/* Slider line */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-col-resize"
                    style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                      <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Labels */}
                <div className="absolute top-4 left-4">
                  <Badge variant="outline" className="bg-background/80">{t('common.originalImage')}</Badge>
                </div>
                <div className="absolute top-4 right-4">
                  <Badge variant="outline" className="bg-background/80">{t('common.comparisonImage')}</Badge>
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="px-4 py-2 border-t bg-muted/50 text-sm text-muted-foreground flex justify-between">
            <span>
              {t('common.shortcuts')}: 1/2/3 ({t('common.mode')}), S ({t('common.swapPosition').toLowerCase()}), +/- (zoom), ESC ({t('common.close').toLowerCase()})
              {mode === 'slider' && `, ←/→ (${t('common.moveSlider')})`}
            </span>
            <span>
              Zoom: {Math.round(zoom * 100)}%
              {mode === 'slider' && ` | Slider: ${Math.round(sliderPosition)}%`}
              {mode === 'overlay' && ` | Opacity: ${Math.round(overlayOpacity * 100)}%`}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImageComparison;
