import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  Bookmark, 
  Plus, 
  Search, 
  AlertTriangle, 
  Ruler, 
  Stamp,
  Layers,
  Trash2,
  Check
} from 'lucide-react';

interface Annotation {
  id: string;
  type: 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  text?: string;
  fontSize?: number;
  radius?: number;
}

interface AnnotationTemplate {
  id: number;
  name: string;
  category: 'defect_marker' | 'measurement_guide' | 'quality_stamp' | 'custom';
  description: string | null;
  annotations: Annotation[];
  previewUrl: string | null;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: Date;
}

interface AnnotationTemplatesProps {
  onApplyTemplate: (annotations: Annotation[]) => void;
  currentAnnotations?: Annotation[];
}

const categoryIcons = {
  defect_marker: AlertTriangle,
  measurement_guide: Ruler,
  quality_stamp: Stamp,
  custom: Layers,
};

const categoryLabels = {
  defect_marker: 'Defect Markers',
  measurement_guide: 'Measurement Guides',
  quality_stamp: 'Quality Stamps',
  custom: 'Custom Templates',
};

const categoryColors = {
  defect_marker: 'bg-red-500/10 text-red-500 border-red-500/20',
  measurement_guide: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  quality_stamp: 'bg-green-500/10 text-green-500 border-green-500/20',
  custom: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
};

export function AnnotationTemplates({ onApplyTemplate, currentAnnotations }: AnnotationTemplatesProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateCategory, setNewTemplateCategory] = useState<'defect_marker' | 'measurement_guide' | 'quality_stamp' | 'custom'>('custom');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');

  const { data: templates, refetch } = trpc.annotationTemplate.list.useQuery({
    category: selectedCategory === 'all' ? undefined : selectedCategory as any,
    search: searchQuery || undefined,
  });

  const saveMutation = trpc.annotationTemplate.create.useMutation({
    onSuccess: () => {
      toast.success('Template saved successfully');
      setSaveDialogOpen(false);
      setNewTemplateName('');
      setNewTemplateDescription('');
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to save template: ' + error.message);
    },
  });

  const deleteMutation = trpc.annotationTemplate.delete.useMutation({
    onSuccess: () => {
      toast.success('Template deleted');
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to delete template: ' + error.message);
    },
  });

  const handleApplyTemplate = (template: AnnotationTemplate) => {
    // Generate new IDs for annotations to avoid conflicts
    const newAnnotations = template.annotations.map((ann, index) => ({
      ...ann,
      id: `${template.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${index}`,
    }));
    onApplyTemplate(newAnnotations);
    toast.success(`Applied template: ${template.name}`);
    setIsOpen(false);
  };

  const handleSaveAsTemplate = () => {
    if (!currentAnnotations || currentAnnotations.length === 0) {
      toast.error('No annotations to save as template');
      return;
    }
    if (!newTemplateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    saveMutation.mutate({
      name: newTemplateName,
      category: newTemplateCategory,
      description: newTemplateDescription || undefined,
      annotations: currentAnnotations,
    });
  };

  const handleDeleteTemplate = (id: number, isSystem: boolean) => {
    if (isSystem) {
      toast.error('Cannot delete system templates');
      return;
    }
    if (confirm('Are you sure you want to delete this template?')) {
      deleteMutation.mutate({ id });
    }
  };

  const renderAnnotationPreview = (annotations: Annotation[]) => {
    return (
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <rect width="100" height="100" fill="#1a1a2e" rx="4" />
        {annotations.map((ann, index) => {
          switch (ann.type) {
            case 'rectangle':
              if (ann.points.length >= 2) {
                const x = Math.min(ann.points[0].x, ann.points[1].x);
                const y = Math.min(ann.points[0].y, ann.points[1].y);
                const width = Math.abs(ann.points[1].x - ann.points[0].x);
                const height = Math.abs(ann.points[1].y - ann.points[0].y);
                return (
                  <rect
                    key={index}
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.lineWidth}
                  />
                );
              }
              return null;
            case 'circle':
              return (
                <circle
                  key={index}
                  cx={ann.points[0]?.x || 50}
                  cy={ann.points[0]?.y || 50}
                  r={ann.radius || 15}
                  fill="none"
                  stroke={ann.color}
                  strokeWidth={ann.lineWidth}
                />
              );
            case 'arrow':
              if (ann.points.length >= 2) {
                const start = ann.points[0];
                const end = ann.points[ann.points.length - 1];
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                const arrowSize = 8;
                return (
                  <g key={index}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke={ann.color}
                      strokeWidth={ann.lineWidth}
                    />
                    <polygon
                      points={`
                        ${end.x},${end.y}
                        ${end.x - arrowSize * Math.cos(angle - Math.PI / 6)},${end.y - arrowSize * Math.sin(angle - Math.PI / 6)}
                        ${end.x - arrowSize * Math.cos(angle + Math.PI / 6)},${end.y - arrowSize * Math.sin(angle + Math.PI / 6)}
                      `}
                      fill={ann.color}
                    />
                  </g>
                );
              }
              return null;
            case 'freehand':
              if (ann.points.length > 1) {
                const pathData = ann.points
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                  .join(' ');
                return (
                  <path
                    key={index}
                    d={pathData}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.lineWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              }
              return null;
            case 'text':
              return (
                <text
                  key={index}
                  x={ann.points[0]?.x || 50}
                  y={ann.points[0]?.y || 50}
                  fill={ann.color}
                  fontSize={ann.fontSize || 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontWeight="bold"
                >
                  {ann.text || 'Text'}
                </text>
              );
            default:
              return null;
          }
        })}
      </svg>
    );
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Bookmark className="h-4 w-4" />
            Templates
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="h-5 w-5" />
              Annotation Templates
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="defect_marker">Defect Markers</SelectItem>
                <SelectItem value="measurement_guide">Measurement Guides</SelectItem>
                <SelectItem value="quality_stamp">Quality Stamps</SelectItem>
                <SelectItem value="custom">Custom Templates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="browse" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="browse">Browse Templates</TabsTrigger>
              <TabsTrigger value="save">Save Current</TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="flex-1 overflow-auto">
              {templates && templates.length > 0 ? (
                <div className="grid grid-cols-3 gap-4 p-2">
                  {templates.map((template: AnnotationTemplate) => {
                    const Icon = categoryIcons[template.category];
                    return (
                      <Card
                        key={template.id}
                        className="cursor-pointer hover:border-primary transition-colors group"
                        onClick={() => handleApplyTemplate(template)}
                      >
                        <CardHeader className="p-3 pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded ${categoryColors[template.category]}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <CardTitle className="text-sm font-medium">{template.name}</CardTitle>
                            </div>
                            {!template.isSystem && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTemplate(template.id, template.isSystem);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-0">
                          <div className="aspect-square rounded-md overflow-hidden border bg-muted/50 mb-2">
                            {renderAnnotationPreview(template.annotations)}
                          </div>
                          {template.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {template.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {template.annotations.length} annotation{template.annotations.length !== 1 ? 's' : ''}
                            </Badge>
                            {template.isSystem && (
                              <Badge variant="secondary" className="text-xs">System</Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Bookmark className="h-12 w-12 mb-4 opacity-50" />
                  <p>No templates found</p>
                  <p className="text-sm">Try adjusting your search or category filter</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="save" className="flex-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Save Current Annotations as Template</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentAnnotations && currentAnnotations.length > 0 ? (
                    <>
                      <div className="aspect-video rounded-md overflow-hidden border bg-muted/50 max-w-xs">
                        {renderAnnotationPreview(currentAnnotations)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {currentAnnotations.length} annotation{currentAnnotations.length !== 1 ? 's' : ''} will be saved
                      </p>
                      <div className="space-y-3">
                        <div>
                          <Label>Template Name</Label>
                          <Input
                            value={newTemplateName}
                            onChange={(e) => setNewTemplateName(e.target.value)}
                            placeholder="Enter template name"
                          />
                        </div>
                        <div>
                          <Label>Category</Label>
                          <Select value={newTemplateCategory} onValueChange={(v) => setNewTemplateCategory(v as any)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="defect_marker">Defect Marker</SelectItem>
                              <SelectItem value="measurement_guide">Measurement Guide</SelectItem>
                              <SelectItem value="quality_stamp">Quality Stamp</SelectItem>
                              <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Description (Optional)</Label>
                          <Input
                            value={newTemplateDescription}
                            onChange={(e) => setNewTemplateDescription(e.target.value)}
                            placeholder="Brief description of the template"
                          />
                        </div>
                        <Button onClick={handleSaveAsTemplate} disabled={saveMutation.isPending} className="w-full">
                          {saveMutation.isPending ? 'Saving...' : 'Save Template'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Layers className="h-12 w-12 mb-4 opacity-50" />
                      <p>No annotations to save</p>
                      <p className="text-sm">Draw some annotations first, then save as template</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AnnotationTemplates;
