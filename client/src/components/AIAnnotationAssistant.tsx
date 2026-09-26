import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { toastTrpcError } from '@/lib/trpcErrors';
import {
  Wand2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Square,
  Circle,
  ArrowRight,
  Type,
  Sparkles,
  Eye,
  EyeOff,
  Check,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface SuggestedAnnotation {
  id: string;
  type: 'rectangle' | 'circle' | 'arrow' | 'text';
  color: string;
  lineWidth: number;
  text: string;
  confidence: number;
  severity: 'high' | 'medium' | 'low';
  points: { x: number; y: number }[];
  fontSize?: number;
}

interface AIAnalysisResult {
  summary: string;
  overallQuality: 'good' | 'acceptable' | 'needs_review' | 'defective';
  findingsCount: number;
}

interface AIAnnotationAssistantProps {
  imageUrl: string;
  onApplyAnnotations: (annotations: SuggestedAnnotation[]) => void;
  trigger?: React.ReactNode;
}

const severityColors = {
  high: 'text-red-500 bg-red-500/10 border-red-500/50',
  medium: 'text-orange-500 bg-orange-500/10 border-orange-500/50',
  low: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/50',
};

const qualityLabels = {
  good: { label: 'ai.quality.good', color: 'text-green-500', icon: CheckCircle2 },
  acceptable: { label: 'ai.quality.acceptable', color: 'text-blue-500', icon: CheckCircle2 },
  needs_review: { label: 'ai.quality.needsReview', color: 'text-orange-500', icon: AlertTriangle },
  defective: { label: 'ai.quality.defective', color: 'text-red-500', icon: XCircle },
};

const typeIcons = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  text: Type,
};

export function AIAnnotationAssistant({
  imageUrl,
  onApplyAnnotations,
  trigger,
}: AIAnnotationAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [context, setContext] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [suggestedAnnotations, setSuggestedAnnotations] = useState<SuggestedAnnotation[]>([]);
  const [selectedAnnotations, setSelectedAnnotations] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(true);
  const { t } = useTranslation();

  const analyzeImage = trpc.annotation.analyzeImage.useMutation({
    onSuccess: (data) => {
      setAnalysis(data.analysis);
      setSuggestedAnnotations(data.suggestedAnnotations);
      setSelectedAnnotations(new Set(data.suggestedAnnotations.map((a: SuggestedAnnotation) => a.id)));
      setIsAnalyzing(false);
    },
    onError: (error) => {
      toastTrpcError(error);
      setIsAnalyzing(false);
    },
  });

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    setAnalysis(null);
    setSuggestedAnnotations([]);
    analyzeImage.mutate({
      imageUrl,
      context: context || undefined,
    });
  };

  const toggleAnnotation = (id: string) => {
    setSelectedAnnotations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedAnnotations(new Set(suggestedAnnotations.map(a => a.id)));
  };

  const deselectAll = () => {
    setSelectedAnnotations(new Set());
  };

  const handleApply = () => {
    const selected = suggestedAnnotations.filter(a => selectedAnnotations.has(a.id));
    if (selected.length === 0) {
      toast.error(t('ai.selectAtLeastOne'));
      return;
    }
    onApplyAnnotations(selected);
    toast.success(t('ai.appliedAnnotations', { count: selected.length }));
    setIsOpen(false);
  };

  const QualityIcon = analysis ? qualityLabels[analysis.overallQuality].icon : CheckCircle2;

  return (
    <>
      {trigger ? (
        <div onClick={() => setIsOpen(true)}>{trigger}</div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="gap-2"
        >
          <Wand2 className="h-4 w-4" />
          {t('ai.analyze')}
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('ai.assistAnnotation')}
            </DialogTitle>
            <DialogDescription>
              {t('ai.assistAnnotationDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex gap-4">
            {/* Left: Image Preview */}
            <div className="flex-1 flex flex-col">
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <img
                  src={imageUrl}
                  alt="Analysis target"
                  className="w-full h-full object-contain"
                />
                
                {/* Overlay annotations preview */}
                {showPreview && suggestedAnnotations.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {suggestedAnnotations
                      .filter(ann => selectedAnnotations.has(ann.id))
                      .map(ann => {
                        if (ann.type === 'rectangle' && ann.points.length >= 2) {
                          const x = ann.points[0].x * 100;
                          const y = ann.points[0].y * 100;
                          const width = (ann.points[1].x - ann.points[0].x) * 100;
                          const height = (ann.points[1].y - ann.points[0].y) * 100;
                          return (
                            <rect
                              key={ann.id}
                              x={`${x}%`}
                              y={`${y}%`}
                              width={`${width}%`}
                              height={`${height}%`}
                              fill="none"
                              stroke={ann.color}
                              strokeWidth={2}
                              strokeDasharray="4"
                            />
                          );
                        }
                        if (ann.type === 'circle' && ann.points.length >= 2) {
                          const cx = ann.points[0].x * 100;
                          const cy = ann.points[0].y * 100;
                          const r = Math.abs(ann.points[1].x - ann.points[0].x) * 100;
                          return (
                            <circle
                              key={ann.id}
                              cx={`${cx}%`}
                              cy={`${cy}%`}
                              r={`${r}%`}
                              fill="none"
                              stroke={ann.color}
                              strokeWidth={2}
                              strokeDasharray="4"
                            />
                          );
                        }
                        if (ann.type === 'arrow' && ann.points.length >= 2) {
                          const x1 = ann.points[0].x * 100;
                          const y1 = ann.points[0].y * 100;
                          const x2 = ann.points[1].x * 100;
                          const y2 = ann.points[1].y * 100;
                          return (
                            <line
                              key={ann.id}
                              x1={`${x1}%`}
                              y1={`${y1}%`}
                              x2={`${x2}%`}
                              y2={`${y2}%`}
                              stroke={ann.color}
                              strokeWidth={2}
                              markerEnd="url(#arrowhead)"
                            />
                          );
                        }
                        if (ann.type === 'text' && ann.points.length >= 1) {
                          const x = ann.points[0].x * 100;
                          const y = ann.points[0].y * 100;
                          return (
                            <text
                              key={ann.id}
                              x={`${x}%`}
                              y={`${y}%`}
                              fill={ann.color}
                              fontSize={12}
                              className="font-medium"
                            >
                              {ann.text}
                            </text>
                          );
                        }
                        return null;
                      })}
                    <defs>
                      <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
                      </marker>
                    </defs>
                  </svg>
                )}

                {/* Loading overlay */}
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center text-white">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                      <p className="text-sm">{t('ai.analyzingImage')}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Context input */}
              <div className="mt-3 space-y-2">
                <label className="text-sm font-medium">{t('ai.contextOptional')}</label>
                <Textarea
                  placeholder={t('ai.contextPlaceholder')}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>

              {/* Analyze button */}
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="mt-3 w-full gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('ai.analyzing')}
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    {t('ai.analyzeWithAI')}
                  </>
                )}
              </Button>
            </div>

            {/* Right: Results */}
            <div className="w-80 flex flex-col">
              {analysis ? (
                <>
                  {/* Analysis Summary */}
                  <Card className="mb-3">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <QualityIcon className={cn("h-4 w-4", qualityLabels[analysis.overallQuality].color)} />
                        {t('ai.analysisResult')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="py-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('ai.quality')}:</span>
                        <Badge variant="outline" className={qualityLabels[analysis.overallQuality].color}>
                          {t(qualityLabels[analysis.overallQuality].label)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('ai.findings')}:</span>
                        <span className="font-medium">{analysis.findingsCount} {t('ai.regions')}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{analysis.summary}</p>
                    </CardContent>
                  </Card>

                  {/* Suggested Annotations */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{t('ai.suggestedAnnotations')}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
                        {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={selectAll}>
                        {t('common.selectAll')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={deselectAll}>
                        {t('common.deselectAll')}
                      </Button>
                    </div>
                  </div>

                  <ScrollArea className="flex-1">
                    <div className="space-y-2 pr-2">
                      {suggestedAnnotations.map((ann) => {
                        const TypeIcon = typeIcons[ann.type];
                        const isSelected = selectedAnnotations.has(ann.id);
                        return (
                          <div
                            key={ann.id}
                            className={cn(
                              "p-3 rounded-lg border cursor-pointer transition-colors",
                              isSelected ? "bg-primary/5 border-primary" : "hover:bg-muted"
                            )}
                            onClick={() => toggleAnnotation(ann.id)}
                          >
                            <div className="flex items-start gap-2">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleAnnotation(ann.id)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <TypeIcon className="h-3 w-3" style={{ color: ann.color }} />
                                  <Badge variant="outline" className={severityColors[ann.severity]}>
                                    {ann.severity === 'high' ? t('ai.severity.high') : ann.severity === 'medium' ? t('ai.severity.medium') : t('ai.severity.low')}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground ml-auto">
                                    {ann.confidence}%
                                  </span>
                                </div>
                                <p className="text-sm truncate">{ann.text}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-center p-4">
                  <div>
                    <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{t('ai.clickToStart')}</p>
                    <p className="text-xs mt-1">{t('ai.autoDetectDescription')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleApply}
              disabled={selectedAnnotations.size === 0}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              {t('common.apply')} {selectedAnnotations.size > 0 && `(${selectedAnnotations.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AIAnnotationAssistant;
