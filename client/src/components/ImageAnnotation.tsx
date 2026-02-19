import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  Undo2,
  Redo2,
  Save,
  Trash2,
  X,
  Palette,
  MousePointer,
  Download,
  ZoomIn,
  ZoomOut,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AIAnnotationAssistant } from './AIAnnotationAssistant';

// Annotation types
export type AnnotationType = 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  type: AnnotationType;
  points: Point[];
  color: string;
  lineWidth: number;
  text?: string;
  fontSize?: number;
}

interface ImageAnnotationProps {
  imageUrl: string;
  imageId: string;
  inspectionId?: number;
  measurementResultId?: number;
  existingAnnotations?: Annotation[];
  onSave?: (annotations: Annotation[]) => Promise<void>;
  onClose?: () => void;
  readOnly?: boolean;
}

const COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#ffffff', // white
  '#000000', // black
];

const LINE_WIDTHS = [1, 2, 3, 4, 5, 8, 10];

export default function ImageAnnotation({
  imageUrl,
  imageId,
  inspectionId,
  measurementResultId,
  existingAnnotations = [],
  onSave,
  onClose,
  readOnly = false,
}: ImageAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(existingAnnotations);
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null);
  const [selectedTool, setSelectedTool] = useState<AnnotationType | 'select'>('select');
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<Annotation[][]>([existingAnnotations]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<Point | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const { t } = useTranslation();

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
    };
    img.onerror = () => {
      toast.error(t('annotation.cannotLoadImage'));
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image) return;

    // Set canvas size
    canvas.width = image.width * zoom;
    canvas.height = image.height * zoom;

    // Clear and draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw all annotations
    const allAnnotations = currentAnnotation 
      ? [...annotations, currentAnnotation] 
      : annotations;

    allAnnotations.forEach((annotation) => {
      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth * zoom;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const isSelected = annotation.id === selectedAnnotationId;
      if (isSelected) {
        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
        ctx.shadowBlur = 10;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      switch (annotation.type) {
        case 'rectangle':
          if (annotation.points.length >= 2) {
            const [start, end] = annotation.points;
            const x = start.x * zoom;
            const y = start.y * zoom;
            const width = (end.x - start.x) * zoom;
            const height = (end.y - start.y) * zoom;
            ctx.strokeRect(x, y, width, height);
          }
          break;

        case 'circle':
          if (annotation.points.length >= 2) {
            const [center, edge] = annotation.points;
            const radius = Math.sqrt(
              Math.pow((edge.x - center.x) * zoom, 2) +
              Math.pow((edge.y - center.y) * zoom, 2)
            );
            ctx.beginPath();
            ctx.arc(center.x * zoom, center.y * zoom, radius, 0, 2 * Math.PI);
            ctx.stroke();
          }
          break;

        case 'arrow':
          if (annotation.points.length >= 2) {
            const [start, end] = annotation.points;
            const startX = start.x * zoom;
            const startY = start.y * zoom;
            const endX = end.x * zoom;
            const endY = end.y * zoom;

            // Draw line
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // Draw arrowhead
            const angle = Math.atan2(endY - startY, endX - startX);
            const headLength = 15 * zoom;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX - headLength * Math.cos(angle - Math.PI / 6),
              endY - headLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX - headLength * Math.cos(angle + Math.PI / 6),
              endY - headLength * Math.sin(angle + Math.PI / 6)
            );
            ctx.stroke();
          }
          break;

        case 'freehand':
          if (annotation.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(annotation.points[0].x * zoom, annotation.points[0].y * zoom);
            for (let i = 1; i < annotation.points.length; i++) {
              ctx.lineTo(annotation.points[i].x * zoom, annotation.points[i].y * zoom);
            }
            ctx.stroke();
          }
          break;

        case 'text':
          if (annotation.points.length >= 1 && annotation.text) {
            const fontSize = (annotation.fontSize || 16) * zoom;
            ctx.font = `${fontSize}px Arial`;
            ctx.fillText(
              annotation.text,
              annotation.points[0].x * zoom,
              annotation.points[0].y * zoom
            );
          }
          break;
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    });
  }, [image, annotations, currentAnnotation, zoom, selectedAnnotationId]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Get mouse position relative to canvas
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  };

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    const pos = getMousePos(e);

    if (selectedTool === 'select') {
      // Check if clicked on an annotation
      const clickedAnnotation = annotations.find((a) => isPointInAnnotation(pos, a));
      setSelectedAnnotationId(clickedAnnotation?.id || null);
      return;
    }

    if (selectedTool === 'text') {
      setTextPosition(pos);
      return;
    }

    setIsDrawing(true);
    const newAnnotation: Annotation = {
      id: `annotation-${Date.now()}`,
      type: selectedTool,
      points: [pos],
      color: selectedColor,
      lineWidth,
    };
    setCurrentAnnotation(newAnnotation);
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentAnnotation || readOnly) return;
    const pos = getMousePos(e);

    if (currentAnnotation.type === 'freehand') {
      setCurrentAnnotation({
        ...currentAnnotation,
        points: [...currentAnnotation.points, pos],
      });
    } else {
      setCurrentAnnotation({
        ...currentAnnotation,
        points: [currentAnnotation.points[0], pos],
      });
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    if (!isDrawing || !currentAnnotation) return;
    setIsDrawing(false);

    // Add to annotations
    const newAnnotations = [...annotations, currentAnnotation];
    setAnnotations(newAnnotations);
    addToHistory(newAnnotations);
    setCurrentAnnotation(null);
  };

  // Check if point is in annotation (for selection)
  const isPointInAnnotation = (point: Point, annotation: Annotation): boolean => {
    const threshold = 10;
    switch (annotation.type) {
      case 'rectangle':
        if (annotation.points.length >= 2) {
          const [start, end] = annotation.points;
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);
          return point.x >= minX - threshold && point.x <= maxX + threshold &&
                 point.y >= minY - threshold && point.y <= maxY + threshold;
        }
        break;
      case 'circle':
        if (annotation.points.length >= 2) {
          const [center, edge] = annotation.points;
          const radius = Math.sqrt(
            Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
          );
          const distance = Math.sqrt(
            Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2)
          );
          return Math.abs(distance - radius) <= threshold;
        }
        break;
      case 'text':
        if (annotation.points.length >= 1) {
          const textPos = annotation.points[0];
          return point.x >= textPos.x - threshold && point.x <= textPos.x + 100 &&
                 point.y >= textPos.y - 20 && point.y <= textPos.y + threshold;
        }
        break;
      default:
        // For freehand and arrow, check proximity to any point
        return annotation.points.some(
          (p) => Math.abs(p.x - point.x) <= threshold && Math.abs(p.y - point.y) <= threshold
        );
    }
    return false;
  };

  // Add text annotation
  const handleAddText = () => {
    if (!textPosition || !textInput.trim()) return;

    const newAnnotation: Annotation = {
      id: `annotation-${Date.now()}`,
      type: 'text',
      points: [textPosition],
      color: selectedColor,
      lineWidth,
      text: textInput,
      fontSize: 16,
    };

    const newAnnotations = [...annotations, newAnnotation];
    setAnnotations(newAnnotations);
    addToHistory(newAnnotations);
    setTextInput('');
    setTextPosition(null);
  };

  // History management
  const addToHistory = (newAnnotations: Annotation[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newAnnotations);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setAnnotations(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setAnnotations(history[historyIndex + 1]);
    }
  };

  // Delete selected annotation
  const deleteSelected = () => {
    if (!selectedAnnotationId) return;
    const newAnnotations = annotations.filter((a) => a.id !== selectedAnnotationId);
    setAnnotations(newAnnotations);
    addToHistory(newAnnotations);
    setSelectedAnnotationId(null);
  };

  // Clear all annotations
  const clearAll = () => {
    setAnnotations([]);
    addToHistory([]);
    setSelectedAnnotationId(null);
  };

  // Save annotations
  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(annotations);
      toast.success(t('annotation.saved'));
    } catch (error) {
      toast.error(t('annotation.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  // Download annotated image
  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `annotated-${imageId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
          case 's':
            e.preventDefault();
            handleSave();
            break;
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId && !textPosition) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Escape') {
        if (textPosition) {
          setTextPosition(null);
          setTextInput('');
        } else if (onClose) {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, selectedAnnotationId, textPosition, annotations]);

  const tools = [
    { id: 'select' as const, icon: MousePointer, label: t('annotation.select') },
    { id: 'rectangle' as const, icon: Square, label: t('annotation.rectangle') },
    { id: 'circle' as const, icon: Circle, label: t('annotation.circle') },
    { id: 'arrow' as const, icon: ArrowRight, label: t('annotation.arrow') },
    { id: 'freehand' as const, icon: Pencil, label: t('annotation.freehand') },
    { id: 'text' as const, icon: Type, label: t('annotation.text') },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-2 p-2 border-b bg-muted/50 flex-wrap">
          {/* Tools */}
          <div className="flex items-center gap-1 border-r pr-2">
            <TooltipProvider>
              {tools.map((tool) => (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={selectedTool === tool.id ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => setSelectedTool(tool.id)}
                    >
                      <tool.icon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tool.label}</TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
          </div>

          {/* Colors */}
          <div className="flex items-center gap-1 border-r pr-2">
            <Palette className="h-4 w-4 text-muted-foreground mr-1" />
            {COLORS.map((color) => (
              <button
                key={color}
                className={`w-6 h-6 rounded-full border-2 ${
                  selectedColor === color ? 'border-primary ring-2 ring-primary/50' : 'border-muted'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
              />
            ))}
          </div>

          {/* Line Width */}
          <div className="flex items-center gap-2 border-r pr-2 min-w-[120px]">
            <Label className="text-xs whitespace-nowrap">{t('annotation.lineWidth')}:</Label>
            <Slider
              value={[lineWidth]}
              onValueChange={([value]) => setLineWidth(value)}
              min={1}
              max={10}
              step={1}
              className="w-20"
            />
            <span className="text-xs w-4">{lineWidth}</span>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1 border-r pr-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
                    disabled={zoom <= 0.25}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.zoomOut')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                    disabled={zoom >= 3}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.zoomIn')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 border-r pr-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={undo}
                    disabled={historyIndex <= 0}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.undo')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={redo}
                    disabled={historyIndex >= history.length - 1}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.redo')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={deleteSelected}
                    disabled={!selectedAnnotationId}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.deleteSelected')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* AI Assistant */}
          <div className="flex items-center gap-1 border-r pr-2">
            <AIAnnotationAssistant
              imageUrl={imageUrl}
              onApplyAnnotations={(aiAnnotations) => {
                const newAnnotations = [...annotations, ...aiAnnotations.map(a => ({
                  ...a,
                  id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                }))];
                setAnnotations(newAnnotations);
                addToHistory(newAnnotations);
              }}
              trigger={
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1">
                        <Wand2 className="h-4 w-4" />
                        AI {t('annotation.aiAnalysis')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('annotation.aiTooltip')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              }
            />
          </div>

          {/* Save & Download */}
          <div className="flex items-center gap-1 ml-auto">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={downloadImage}>
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('annotation.downloadAnnotated')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1"
            >
              <Save className="h-4 w-4" />
              {isSaving ? t('annotation.saving') : t('annotation.save')}
            </Button>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-4"
      >
        {image ? (
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`border shadow-lg ${
              selectedTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
            }`}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}
      </div>

      {/* Text input dialog */}
      {textPosition && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-80">
            <CardHeader>
              <CardTitle className="text-lg">{t('annotation.addText')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t('annotation.enterText')}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTextPosition(null);
                    setTextInput('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleAddText} disabled={!textInput.trim()}>
                  {t('annotation.add')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Annotation count */}
      <div className="px-4 py-2 border-t bg-muted/50 text-sm text-muted-foreground">
        {annotations.length} annotation(s) | {selectedAnnotationId ? t('annotation.oneSelected') : t('annotation.noneSelected')}
      </div>
    </div>
  );
}

export { ImageAnnotation };
