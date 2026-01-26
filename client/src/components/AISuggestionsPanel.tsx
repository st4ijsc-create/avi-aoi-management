import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  Brain,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  RefreshCw,
  Target,
  Lightbulb,
  TrendingUp,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface AISuggestionsPanelProps {
  inspectionId: number;
  measurementResultId?: number;
  onFeedbackSubmitted?: () => void;
}

const suggestionTypeLabels: Record<string, string> = {
  DEFECT_CLASSIFICATION: 'Phân loại lỗi',
  ROOT_CAUSE: 'Nguyên nhân gốc',
  CORRECTIVE_ACTION: 'Hành động khắc phục',
  QUALITY_PREDICTION: 'Dự đoán chất lượng',
  PROCESS_OPTIMIZATION: 'Tối ưu quy trình',
};

const suggestionTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  DEFECT_CLASSIFICATION: Target,
  ROOT_CAUSE: AlertCircle,
  CORRECTIVE_ACTION: Lightbulb,
  QUALITY_PREDICTION: TrendingUp,
  PROCESS_OPTIMIZATION: Settings2,
};

const feedbackTypeLabels: Record<string, { label: string; color: string }> = {
  CORRECT: { label: 'Chính xác', color: 'text-green-500 bg-green-500/10' },
  INCORRECT: { label: 'Không chính xác', color: 'text-red-500 bg-red-500/10' },
  PARTIAL: { label: 'Một phần đúng', color: 'text-yellow-500 bg-yellow-500/10' },
  UNSURE: { label: 'Không chắc chắn', color: 'text-gray-500 bg-gray-500/10' },
};

const errorCategoryLabels: Record<string, string> = {
  FALSE_POSITIVE: 'Dương tính giả',
  FALSE_NEGATIVE: 'Âm tính giả',
  MISCLASSIFICATION: 'Phân loại sai',
  WRONG_LOCATION: 'Sai vị trí',
  WRONG_SEVERITY: 'Sai mức độ',
  OTHER: 'Khác',
};

export function AISuggestionsPanel({ inspectionId, measurementResultId, onFeedbackSubmitted }: AISuggestionsPanelProps) {
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);
  const [feedbackForm, setFeedbackForm] = useState<{
    suggestionId: number;
    feedbackType: string;
    errorCategory?: string;
    correctedValue?: string;
    correctionNotes?: string;
  } | null>(null);

  // Fetch suggestions for this inspection
  const { data: suggestions, isLoading, refetch } = trpc.aiFeedback.getSuggestionsByInspection.useQuery(
    { inspectionId },
    { enabled: inspectionId > 0 }
  );

  // Submit feedback mutation
  const submitFeedbackMutation = trpc.aiFeedback.submitFeedback.useMutation({
    onSuccess: () => {
      toast.success('Đã gửi phản hồi thành công');
      setFeedbackForm(null);
      refetch();
      onFeedbackSubmitted?.();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const handleSubmitFeedback = () => {
    if (!feedbackForm) return;
    
    submitFeedbackMutation.mutate({
      suggestionId: feedbackForm.suggestionId,
      feedbackType: feedbackForm.feedbackType as "CORRECT" | "INCORRECT" | "PARTIAL" | "UNSURE",
      errorCategory: feedbackForm.errorCategory as "FALSE_POSITIVE" | "FALSE_NEGATIVE" | "MISCLASSIFICATION" | "WRONG_LOCATION" | "WRONG_SEVERITY" | "OTHER" | undefined,
      correctedValue: feedbackForm.correctedValue,
      correctionNotes: feedbackForm.correctionNotes,
    });
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-500';
    if (confidence >= 0.6) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            AI Suggestions
          </CardTitle>
          <CardDescription>Gợi ý từ AI để cải thiện chất lượng</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Sparkles className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">Chưa có gợi ý AI cho inspection này</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="h-5 w-5 text-primary" />
              AI Suggestions
              <Badge variant="secondary" className="ml-2">
                {suggestions.length}
              </Badge>
            </CardTitle>
            <CardDescription>Gợi ý từ AI để cải thiện chất lượng</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[500px]">
          <div className="space-y-3">
            {suggestions.map((suggestion) => {
              const TypeIcon = suggestionTypeIcons[suggestion.suggestionType] || Brain;
              const confidence = parseFloat(suggestion.confidence);
              const isExpanded = expandedSuggestion === suggestion.id;
              const isFeedbackOpen = feedbackForm?.suggestionId === suggestion.id;

              return (
                <Collapsible
                  key={suggestion.id}
                  open={isExpanded}
                  onOpenChange={() => setExpandedSuggestion(isExpanded ? null : suggestion.id)}
                >
                  <div className={cn(
                    "border rounded-lg p-3 transition-colors",
                    suggestion.status === "ACCEPTED" && "border-green-500/50 bg-green-500/5",
                    suggestion.status === "REJECTED" && "border-red-500/50 bg-red-500/5",
                    suggestion.status === "REVIEWED" && "border-yellow-500/50 bg-yellow-500/5",
                  )}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg",
                          suggestion.status === "PENDING" ? "bg-primary/10" : "bg-muted"
                        )}>
                          <TypeIcon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">
                              {suggestionTypeLabels[suggestion.suggestionType]}
                            </span>
                            <Badge variant="outline" className={cn("text-xs", getConfidenceColor(confidence))}>
                              {(confidence * 100).toFixed(0)}% confidence
                            </Badge>
                            {suggestion.status !== "PENDING" && (
                              <Badge 
                                variant="secondary" 
                                className={cn(
                                  "text-xs",
                                  suggestion.status === "ACCEPTED" && "bg-green-500/20 text-green-500",
                                  suggestion.status === "REJECTED" && "bg-red-500/20 text-red-500",
                                  suggestion.status === "REVIEWED" && "bg-yellow-500/20 text-yellow-500",
                                )}
                              >
                                {suggestion.status === "ACCEPTED" ? "Đã chấp nhận" : 
                                 suggestion.status === "REJECTED" ? "Đã từ chối" : "Đã xem xét"}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {suggestion.suggestion}
                          </p>
                        </div>
                        <div className="flex items-center">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent className="mt-3 pt-3 border-t">
                      {/* Full suggestion */}
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Gợi ý chi tiết</Label>
                          <p className="text-sm mt-1">{suggestion.suggestion}</p>
                        </div>

                        {suggestion.reasoning && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Lý do</Label>
                            <p className="text-sm mt-1 text-muted-foreground">{suggestion.reasoning}</p>
                          </div>
                        )}

                        {/* Confidence bar */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Độ tin cậy</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={confidence * 100} className="flex-1 h-2" />
                            <span className={cn("text-sm font-medium", getConfidenceColor(confidence))}>
                              {(confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>

                        {/* Alternatives */}
                        {suggestion.alternatives && (suggestion.alternatives as Array<{suggestion: string; confidence: number}>).length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Gợi ý thay thế</Label>
                            <div className="space-y-1 mt-1">
                              {(suggestion.alternatives as Array<{suggestion: string; confidence: number}>).map((alt, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                    {(alt.confidence * 100).toFixed(0)}%
                                  </span>
                                  <span>{alt.suggestion}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Model info */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Model: {suggestion.modelName} v{suggestion.modelVersion}</span>
                          <span>•</span>
                          <span>{format(new Date(suggestion.createdAt), 'dd/MM/yyyy HH:mm', { locale: vi })}</span>
                        </div>

                        {/* Feedback section */}
                        {suggestion.status === "PENDING" && !isFeedbackOpen && (
                          <div className="flex items-center gap-2 pt-2">
                            <span className="text-xs text-muted-foreground">Đánh giá gợi ý này:</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFeedbackForm({
                                  suggestionId: suggestion.id,
                                  feedbackType: 'CORRECT',
                                });
                              }}
                            >
                              <ThumbsUp className="h-4 w-4 mr-1" />
                              Chính xác
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFeedbackForm({
                                  suggestionId: suggestion.id,
                                  feedbackType: 'INCORRECT',
                                });
                              }}
                            >
                              <ThumbsDown className="h-4 w-4 mr-1" />
                              Không đúng
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-yellow-500 hover:text-yellow-600 hover:bg-yellow-500/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFeedbackForm({
                                  suggestionId: suggestion.id,
                                  feedbackType: 'PARTIAL',
                                });
                              }}
                            >
                              <HelpCircle className="h-4 w-4 mr-1" />
                              Một phần
                            </Button>
                          </div>
                        )}

                        {/* Feedback form */}
                        {isFeedbackOpen && (
                          <div className="pt-3 border-t space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Phản hồi:</span>
                              <Badge className={feedbackTypeLabels[feedbackForm.feedbackType]?.color}>
                                {feedbackTypeLabels[feedbackForm.feedbackType]?.label}
                              </Badge>
                            </div>

                            {feedbackForm.feedbackType === 'INCORRECT' && (
                              <div>
                                <Label className="text-xs">Loại lỗi</Label>
                                <Select
                                  value={feedbackForm.errorCategory || ''}
                                  onValueChange={(value) => setFeedbackForm({
                                    ...feedbackForm,
                                    errorCategory: value,
                                  })}
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Chọn loại lỗi" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(errorCategoryLabels).map(([key, label]) => (
                                      <SelectItem key={key} value={key}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {(feedbackForm.feedbackType === 'INCORRECT' || feedbackForm.feedbackType === 'PARTIAL') && (
                              <div>
                                <Label className="text-xs">Giá trị đúng (nếu có)</Label>
                                <Textarea
                                  className="mt-1"
                                  placeholder="Nhập giá trị đúng..."
                                  value={feedbackForm.correctedValue || ''}
                                  onChange={(e) => setFeedbackForm({
                                    ...feedbackForm,
                                    correctedValue: e.target.value,
                                  })}
                                  rows={2}
                                />
                              </div>
                            )}

                            <div>
                              <Label className="text-xs">Ghi chú (tùy chọn)</Label>
                              <Textarea
                                className="mt-1"
                                placeholder="Thêm ghi chú..."
                                value={feedbackForm.correctionNotes || ''}
                                onChange={(e) => setFeedbackForm({
                                  ...feedbackForm,
                                  correctionNotes: e.target.value,
                                })}
                                rows={2}
                              />
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={handleSubmitFeedback}
                                disabled={submitFeedbackMutation.isPending}
                              >
                                {submitFeedbackMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4 mr-1" />
                                )}
                                Gửi phản hồi
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setFeedbackForm(null)}
                              >
                                Hủy
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default AISuggestionsPanel;
