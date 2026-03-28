import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Search, Download, Star, Eye, Upload, Grid3X3,
  TrendingUp, Users, Clock, Heart, Share2,
  BarChart3, PieChart, Activity, Gauge, Table2, Bell
} from 'lucide-react';

const CATEGORIES = [
  { value: 'all', label: 'common.all' },
  { value: 'production', label: 'dashboard.categoryProduction' },
  { value: 'quality', label: 'dashboard.categoryQuality' },
  { value: 'maintenance', label: 'dashboard.categoryMaintenance' },
  { value: 'analytics', label: 'dashboard.categoryAnalytics' },
  { value: 'oee', label: 'dashboard.categoryOEE' },
  { value: 'custom', label: 'dashboard.categoryCustom' },
];

const WIDGET_ICONS: Record<string, React.ReactNode> = {
  'kpi-card': <BarChart3 className="h-4 w-4" />,
  'chart': <TrendingUp className="h-4 w-4" />,
  'pie-chart': <PieChart className="h-4 w-4" />,
  'table': <Table2 className="h-4 w-4" />,
  'gauge': <Gauge className="h-4 w-4" />,
  'activity': <Activity className="h-4 w-4" />,
  'alert-list': <Bell className="h-4 w-4" />,
};

// Mock data for marketplace templates
const MOCK_TEMPLATES = [
  {
    id: 1,
    name: 'Production Overview',
    description: 'Dashboard tổng quan sản xuất với KPIs, biểu đồ xu hướng và bảng thống kê',
    category: 'production',
    author: 'System',
    authorId: 1,
    rating: 4.8,
    reviewCount: 24,
    downloadCount: 156,
    widgets: ['kpi-card', 'chart', 'table', 'gauge'],
    previewUrl: null,
    isFeatured: true,
    isPublished: true,
    createdAt: new Date('2024-01-15'),
  },
  {
    id: 2,
    name: 'Quality Control Dashboard',
    description: 'Theo dõi chất lượng sản phẩm, tỷ lệ NG, và phân tích defects',
    category: 'quality',
    author: 'QC Team',
    authorId: 2,
    rating: 4.5,
    reviewCount: 18,
    downloadCount: 89,
    widgets: ['kpi-card', 'pie-chart', 'chart', 'alert-list'],
    previewUrl: null,
    isFeatured: true,
    isPublished: true,
    createdAt: new Date('2024-02-20'),
  },
  {
    id: 3,
    name: 'OEE Monitoring',
    description: 'Dashboard OEE với Availability, Performance, Quality metrics',
    category: 'oee',
    author: 'Maintenance',
    authorId: 3,
    rating: 4.9,
    reviewCount: 32,
    downloadCount: 203,
    widgets: ['gauge', 'gauge', 'gauge', 'chart', 'kpi-card'],
    previewUrl: null,
    isFeatured: true,
    isPublished: true,
    createdAt: new Date('2024-03-10'),
  },
  {
    id: 4,
    name: 'Machine Health',
    description: 'Theo dõi tình trạng máy móc, cảnh báo bảo trì dự đoán',
    category: 'maintenance',
    author: 'Engineering',
    authorId: 4,
    rating: 4.3,
    reviewCount: 12,
    downloadCount: 67,
    widgets: ['kpi-card', 'activity', 'alert-list', 'table'],
    previewUrl: null,
    isFeatured: false,
    isPublished: true,
    createdAt: new Date('2024-04-05'),
  },
  {
    id: 5,
    name: 'Analytics Deep Dive',
    description: 'Phân tích chuyên sâu với nhiều biểu đồ và bảng dữ liệu',
    category: 'analytics',
    author: 'Data Team',
    authorId: 5,
    rating: 4.6,
    reviewCount: 15,
    downloadCount: 78,
    widgets: ['chart', 'chart', 'pie-chart', 'table', 'table'],
    previewUrl: null,
    isFeatured: false,
    isPublished: true,
    createdAt: new Date('2024-05-12'),
  },
];

export default function EmbeddedDashboardMarketplace() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('popular');
  const [selectedTemplate, setSelectedTemplate] = useState<typeof MOCK_TEMPLATES[0] | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishForm, setPublishForm] = useState({
    name: '',
    description: '',
    category: 'custom',
  });

  // Filter and sort templates
  const filteredTemplates = MOCK_TEMPLATES.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'popular':
        return b.downloadCount - a.downloadCount;
      case 'rating':
        return b.rating - a.rating;
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      default:
        return 0;
    }
  });

  const featuredTemplates = MOCK_TEMPLATES.filter(t => t.isFeatured);

  const handleDownload = (template: typeof MOCK_TEMPLATES[0]) => {
    toast.success(t('dashboard.templateDownloaded', { name: template.name }));
    setSelectedTemplate(null);
  };

  const handlePublish = () => {
    if (!publishForm.name.trim()) {
      toast.error(t('dashboard.enterTemplateName'));
      return;
    }
    toast.success(t('dashboard.templateSubmitted'));
    setShowPublishDialog(false);
    setPublishForm({ name: '', description: '', category: 'custom' });
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-3 w-3 ${star <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
          />
        ))}
        <span className="ml-1 text-xs text-muted-foreground">{rating.toFixed(1)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Dashboard Marketplace
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.exploreTemplates')}
          </p>
        </div>
        <Button onClick={() => setShowPublishDialog(true)}>
          <Upload className="mr-2 h-4 w-4" />
          {t('dashboard.shareTemplate')}
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('dashboard.searchTemplates')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t('dashboard.category')} />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {t(cat.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder={t('dashboard.sortBy')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">{t('dashboard.mostPopular')}</SelectItem>
            <SelectItem value="rating">{t('dashboard.highestRated')}</SelectItem>
            <SelectItem value="newest">{t('dashboard.newest')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Featured Templates */}
      {featuredTemplates.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            <h3 className="text-lg font-semibold">{t('dashboard.featuredTemplates')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredTemplates.slice(0, 3).map((template) => (
              <Card key={template.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <Badge variant="secondary" className="text-xs">{template.category}</Badge>
                    {renderStars(template.rating)}
                  </div>
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">
                    {template.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <div className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      {template.downloadCount}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {template.author}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {template.widgets.slice(0, 3).map((widget, idx) => (
                      <div key={idx} className="flex items-center gap-1 bg-secondary px-2 py-1 rounded text-xs">
                        {WIDGET_ICONS[widget] || <BarChart3 className="h-3 w-3" />}
                      </div>
                    ))}
                    {template.widgets.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{template.widgets.length - 3}
                      </Badge>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <Eye className="mr-1 h-3 w-3" />
                    {t('common.view')}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDownload(template)}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    {t('common.download')}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* All Templates */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">
          {t('dashboard.allTemplates')} ({filteredTemplates.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between mb-2">
                  <Badge variant="secondary" className="text-xs">{template.category}</Badge>
                  {renderStars(template.rating)}
                </div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <CardDescription className="text-xs line-clamp-2">
                  {template.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                  <div className="flex items-center gap-1">
                    <Download className="h-3 w-3" />
                    {template.downloadCount}
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {template.author}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(template.createdAt).toLocaleDateString('vi-VN')}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {template.widgets.slice(0, 3).map((widget, idx) => (
                    <div key={idx} className="flex items-center gap-1 bg-secondary px-2 py-1 rounded text-xs">
                      {WIDGET_ICONS[widget] || <BarChart3 className="h-3 w-3" />}
                    </div>
                  ))}
                  {template.widgets.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{template.widgets.length - 3}
                    </Badge>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setSelectedTemplate(template)}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  {t('common.view')}
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleDownload(template)}
                >
                  <Download className="mr-1 h-3 w-3" />
                  {t('common.download')}
                </Button>
                <Button variant="ghost" size="sm">
                  <Heart className="h-3 w-3" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>

      {/* Template Detail Dialog */}
      <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
        <DialogContent className="max-w-2xl">
          {selectedTemplate && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <DialogTitle className="text-xl">{selectedTemplate.name}</DialogTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary">{selectedTemplate.category}</Badge>
                      {renderStars(selectedTemplate.rating)}
                      <span className="text-xs text-muted-foreground">
                        ({selectedTemplate.reviewCount} {t('dashboard.reviews')})
                      </span>
                    </div>
                  </div>
                </div>
                <DialogDescription className="mt-3">
                  {selectedTemplate.description}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2">{t('dashboard.information')}</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>{t('dashboard.author')}: {selectedTemplate.author}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Download className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedTemplate.downloadCount} {t('dashboard.downloads')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{new Date(selectedTemplate.createdAt).toLocaleDateString('vi-VN')}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold mb-2">Widgets ({selectedTemplate.widgets.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.widgets.map((widget, idx) => (
                      <Badge key={idx} variant="outline">
                        <span className="mr-1">{WIDGET_ICONS[widget] || <BarChart3 className="h-3 w-3" />}</span>
                        {widget}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                  {t('common.close')}
                </Button>
                <Button onClick={() => handleDownload(selectedTemplate)}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('common.download')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.shareTemplate')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.shareTemplateDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="publish-name">{t('dashboard.templateName')}</Label>
              <Input
                id="publish-name"
                placeholder={t('dashboard.enterTemplateName')}
                value={publishForm.name}
                onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="publish-desc">{t('common.description')}</Label>
              <Textarea
                id="publish-desc"
                placeholder={t('dashboard.describeTemplate')}
                value={publishForm.description}
                onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="publish-category">{t('dashboard.category')}</Label>
              <Select value={publishForm.category} onValueChange={(value) => setPublishForm({ ...publishForm, category: value })}>
                <SelectTrigger id="publish-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter(c => c.value !== 'all').map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublishDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handlePublish}>
              <Share2 className="mr-2 h-4 w-4" />
              {t('dashboard.share')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
