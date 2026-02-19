import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
  Search, 
  Filter,
  Image as ImageIcon,
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  X,
  ExternalLink,
  Calendar,
  User
} from 'lucide-react';

interface SearchResult {
  imageId: string;
  imageUrl: string;
  annotationId: number;
  annotationType: string;
  annotationText: string | null;
  annotationColor: string;
  createdBy: string;
  createdAt: Date;
  inspectionId?: string;
  measurementPointName?: string;
}

interface AnnotationSearchProps {
  onSelectImage?: (imageId: string, imageUrl: string) => void;
}

type AnnotationType = 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';

const annotationTypeIcons: Record<AnnotationType, React.ComponentType<{ className?: string }>> = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  freehand: Pencil,
  text: Type,
};

const getAnnotationIcon = (type: string): React.ComponentType<{ className?: string }> => {
  if (type in annotationTypeIcons) {
    return annotationTypeIcons[type as AnnotationType];
  }
  return Square;
};

const annotationTypeLabels: Record<string, string> = {
  rectangle: 'annotation.search.typeRectangle',
  circle: 'annotation.search.typeCircle',
  arrow: 'annotation.search.typeArrow',
  freehand: 'annotation.search.typeFreehand',
  text: 'annotation.search.typeText',
};

export function AnnotationSearch({ onSelectImage }: AnnotationSearchProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: searchResults, isLoading, refetch } = trpc.annotation.search.useQuery(
    {
      textQuery: searchQuery || undefined,
      types: selectedTypes.length > 0 ? selectedTypes : undefined,
      color: selectedColor !== 'all' ? selectedColor : undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    },
    {
      enabled: isOpen,
    }
  );

  const handleSearch = () => {
    refetch();
  };

  const handleTypeToggle = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedTypes([]);
    setSelectedColor('all');
    setDateFrom('');
    setDateTo('');
  };

  const handleSelectImage = (result: SearchResult) => {
    if (onSelectImage) {
      onSelectImage(result.imageId, result.imageUrl);
      setIsOpen(false);
    }
  };

  const colorOptions = [
    { value: 'all', label: t('annotation.search.allColors') },
    { value: '#ef4444', label: t('annotation.search.colorRed') },
    { value: '#f97316', label: t('annotation.search.colorOrange') },
    { value: '#eab308', label: t('annotation.search.colorYellow') },
    { value: '#22c55e', label: t('annotation.search.colorGreen') },
    { value: '#3b82f6', label: t('annotation.search.colorBlue') },
    { value: '#8b5cf6', label: t('annotation.search.colorPurple') },
  ];

  const groupedResults: Record<string, SearchResult[]> = useMemo(() => {
    if (!searchResults) return {};
    return (searchResults as SearchResult[]).reduce((acc: Record<string, SearchResult[]>, result: SearchResult) => {
      const key = result.imageId;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(result);
      return acc;
    }, {} as Record<string, SearchResult[]>);
  }, [searchResults]);

  const activeFiltersCount = [
    searchQuery,
    selectedTypes.length > 0,
    selectedColor !== 'all',
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Search className="h-4 w-4" />
          {t('annotation.search.searchAnnotations')}
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t('annotation.search.searchByAnnotation')}
          </DialogTitle>
        </DialogHeader>

        {/* Search Filters */}
        <div className="space-y-4 border-b pb-4">
          {/* Text Search */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('annotation.search.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? t('annotation.search.searching') : t('common.search')}
            </Button>
            {activeFiltersCount > 0 && (
              <Button variant="ghost" size="icon" onClick={handleClearFilters}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap gap-4 items-end">
            {/* Annotation Types */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('annotation.search.annotationTypes')}</Label>
              <div className="flex gap-1">
                {(Object.keys(annotationTypeIcons) as AnnotationType[]).map((type) => {
                  const Icon = annotationTypeIcons[type];
                  return (
                    <Button
                      key={type}
                      variant={selectedTypes.includes(type) ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleTypeToggle(type)}
                      title={t(annotationTypeLabels[type])}
                    >
                      <Icon className="h-4 w-4" />
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Color Filter */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('annotation.search.color')}</Label>
              <Select value={selectedColor} onValueChange={setSelectedColor}>
                <SelectTrigger className="w-[160px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {colorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        {option.value !== 'all' && (
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: option.value }}
                          />
                        )}
                        {option.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('annotation.search.dateRange')}</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 w-[130px]"
                />
                <span className="text-muted-foreground">{t('common.to')}</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 w-[130px]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="space-y-4 p-2">
              <p className="text-sm text-muted-foreground">
                {t('annotation.search.foundResults', { annotations: searchResults.length, images: Object.keys(groupedResults).length })}
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(groupedResults).map(([imageId, annotations]: [string, SearchResult[]]) => {
                  const firstAnnotation = annotations[0];
                  return (
                    <Card 
                      key={imageId}
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => handleSelectImage(firstAnnotation)}
                    >
                      <CardContent className="p-3">
                        <div className="flex gap-3">
                          {/* Image Thumbnail */}
                          <div className="w-24 h-24 rounded-md overflow-hidden bg-muted flex-shrink-0">
                            <img
                              src={firstAnnotation.imageUrl}
                              alt="Annotated image"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/placeholder-image.png';
                              }}
                            />
                          </div>

                          {/* Annotation Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">
                                {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
                              </Badge>
                              {firstAnnotation.measurementPointName && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {firstAnnotation.measurementPointName}
                                </span>
                              )}
                            </div>

                            {/* Annotation Types Summary */}
                            <div className="flex flex-wrap gap-1 mb-2">
                              {annotations.map((ann: SearchResult, idx: number) => {
                                const IconComp = getAnnotationIcon(ann.annotationType);
                                return (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                                    style={{ 
                                      backgroundColor: `${ann.annotationColor}20`,
                                      color: ann.annotationColor 
                                    }}
                                  >
                                    <IconComp className="h-3 w-3" />
                                    {ann.annotationType}
                                    {ann.annotationText && (
                                      <span className="max-w-[80px] truncate">
                                        : {ann.annotationText}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Meta Info */}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {firstAnnotation.createdBy}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(firstAnnotation.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          {/* Action */}
                          <Button variant="ghost" size="icon" className="flex-shrink-0">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <ImageIcon className="h-12 w-12 mb-4 opacity-50" />
              <p>{t('annotation.search.noResults')}</p>
              <p className="text-sm">{t('annotation.search.tryAdjusting')}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AnnotationSearch;
