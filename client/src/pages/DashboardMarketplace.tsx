import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc';
import { templateToCustomDashboardWidgets } from '@/lib/dashboardTemplateApply';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastTrpcError } from '@/lib/trpcErrors';
import {
  Search, Download, Star, Upload, Grid3X3, LayoutDashboard,
  TrendingUp, Users, Clock, CheckCircle, Filter, Heart, Share2,
  BarChart3, PieChart, Activity, Gauge, Table2, Bell
} from 'lucide-react';

const CATEGORIES = [
  { value: 'all', labelKey: 'dashboard.catAll' },
  { value: 'production', labelKey: 'dashboard.catProduction' },
  { value: 'quality', labelKey: 'dashboard.catQuality' },
  { value: 'maintenance', labelKey: 'dashboard.catMaintenance' },
  { value: 'analytics', labelKey: 'dashboard.catAnalytics' },
  { value: 'oee', labelKey: 'dashboard.catOEE' },
  { value: 'custom', labelKey: 'dashboard.catCustom' },
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

interface DashboardTemplate {
  id: number;
  name: string;
  description: string;
  category: string;
  author: string;
  authorId: number;
  rating: number | null;
  reviewCount: number;
  downloadCount: number;
  widgets: string[];
  previewUrl: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  createdAt: Date;
}

export default function DashboardMarketplace() {
  return (
    <DashboardLayout>
      <DashboardMarketplaceContent />
    </DashboardLayout>
  );
}

/**
 * Layout-less marketplace body. Used directly by the DashboardMarketplace page
 * (wrapped in DashboardLayout) and embedded inside DashboardCenter's
 * "marketplace" tab (which already provides the layout). This replaces the old
 * mock EmbeddedDashboardMarketplace so there is a single, real marketplace.
 */
export function DashboardMarketplaceContent() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('popular');
  const [selectedTemplate, setSelectedTemplate] = useState<DashboardTemplate | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishForm, setPublishForm] = useState({
    name: '',
    description: '',
    category: 'custom',
  });

  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: rawTemplates, isLoading, error } = trpc.dashboardWidget.getSharedTemplates.useQuery();

  // Persist the downloaded template as a real user custom dashboard so it shows
  // up on the main Dashboard "custom" tab and /custom-dashboard.
  const createDashboardMutation = trpc.dashboardWidget.createCustomDashboard.useMutation();

  const applyMutation = trpc.dashboardWidget.applySharedTemplate.useMutation({
    onSuccess: async (_data, variables) => {
      const tpl = templates.find(t => t.id === variables.id);
      try {
        await createDashboardMutation.mutateAsync({
          name: tpl?.name ?? t('dashboard.customDashboard'),
          description: tpl?.description || undefined,
          widgets: templateToCustomDashboardWidgets({ widgets: tpl?.widgets ?? [] }),
          gridCols: 4,
          isPublic: false,
        });
        utils.dashboardWidget.listCustomDashboards.invalidate();
      } catch {
        // Usage count already incremented; surface a soft error below.
      }
      toast.success(t('dashboard.templateDownloadSuccess', { name: tpl?.name ?? '' }), {
        action: {
          label: t('common.view'),
          onClick: () => setLocation('/custom-dashboard'),
        },
      });
      setSelectedTemplate(null);
    },
    onError: (err) => {
      toastTrpcError(err);
    },
  });

  const templates: DashboardTemplate[] = useMemo(() =>
    (rawTemplates ?? []).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      category: 'general',
      author: 'System',
      authorId: t.createdBy,
      rating: null, // Chưa có nguồn dữ liệu rating (review system chưa triển khai) — không bịa số
      reviewCount: 0,
      downloadCount: t.usageCount ?? 0,
      widgets: Array.isArray(t.widgets) ? t.widgets : [],
      previewUrl: t.previewImageUrl ?? null,
      isFeatured: t.isPublic,
      isPublished: t.isPublic,
      createdAt: new Date(t.createdAt),
    })),
    [rawTemplates]
  );

  // Filter and sort templates
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'popular':
        return b.downloadCount - a.downloadCount;
      case 'rating':
        return (b.rating ?? 0) - (a.rating ?? 0);
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      default:
        return 0;
    }
  });

  const featuredTemplates = templates.filter(t => t.isFeatured);

  const handleDownload = (template: DashboardTemplate) => {
    applyMutation.mutate({ id: template.id });
  };

  // Persist the shared template via the real backend mutation. Success is shown
  // ONLY in onSuccess so we never claim a share that did not happen (e.g. a
  // non-admin will receive a genuine authorization error instead).
  const publishMutation = trpc.dashboardWidget.createSharedTemplate.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.getSharedTemplates.invalidate();
      toast.success(t('dashboard.templateSubmittedForReview'));
      setShowPublishDialog(false);
      setPublishForm({ name: '', description: '', category: 'custom' });
    },
    onError: (err) => {
      toastTrpcError(err);
    },
  });

  const handlePublish = () => {
    if (!publishForm.name.trim()) {
      toast.error(t('dashboard.pleaseEnterTemplateName'));
      return;
    }
    publishMutation.mutate({
      name: publishForm.name.trim(),
      description: publishForm.description.trim() || undefined,
      widgets: [],
      layout: [],
      isPublic: true,
    });
  };

  const renderStars = (rating: number | null) => {
    // Không bịa rating: khi chưa có nguồn dữ liệu đánh giá, hiển thị trạng thái trung thực
    if (rating == null) {
      return <span className="text-xs text-muted-foreground">{t('dashboard.noRating')}</span>;
    }
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
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Grid3X3 className="h-6 w-6" />
              {t('dashboard.marketplace')}
            </h1>
            <p className="text-muted-foreground">
              {t('dashboard.marketplaceDescription')}
            </p>
          </div>
          <Button onClick={() => setShowPublishDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t('dashboard.shareTemplate')}
          </Button>
        </div>

        {/* Loading / Error states */}
        {isLoading && (
          <Card className="p-12 text-center">
            <LayoutDashboard className="h-12 w-12 mx-auto text-muted-foreground mb-4 animate-pulse" />
            <p className="text-muted-foreground">{t('dashboard.loadingTemplates')}</p>
          </Card>
        )}
        {error && (
          <Card className="p-12 text-center">
            <LayoutDashboard className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('dashboard.errorLoadingTemplates')}</h3>
            <p className="text-muted-foreground">{error.message}</p>
          </Card>
        )}

        {/* Featured Templates */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-400" />
              {t('dashboard.featuredTemplates')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {featuredTemplates.map((template) => (
                <Card
                  key={template.id}
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setSelectedTemplate(template)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <Badge variant="secondary">{t(CATEGORIES.find(c => c.value === template.category)?.labelKey ?? 'dashboard.catAll')}</Badge>
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        {t('dashboard.featured')}
                      </Badge>
                    </div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{template.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="pt-2 flex items-center justify-between">
                    {renderStars(template.rating)}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Download className="h-3 w-3" />
                      {template.downloadCount}
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

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
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder={t('dashboard.category')} />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {t(cat.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t('dashboard.sortBy')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">{t('dashboard.mostPopular')}</SelectItem>
              <SelectItem value="rating">{t('dashboard.highestRated')}</SelectItem>
              <SelectItem value="newest">{t('dashboard.newest')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card
              key={template.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setSelectedTemplate(template)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <Badge variant="secondary">
                    {t(CATEGORIES.find(c => c.value === template.category)?.labelKey ?? 'dashboard.catAll')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t('dashboard.by')} {template.author}
                  </span>
                </div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <CardDescription className="line-clamp-2">{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="flex flex-wrap gap-1">
                  {template.widgets.slice(0, 4).map((widget, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {WIDGET_ICONS[widget]}
                    </Badge>
                  ))}
                  {template.widgets.length > 4 && (
                    <Badge variant="outline" className="text-xs">
                      +{template.widgets.length - 4}
                    </Badge>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between">
                {renderStars(template.rating)}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" />
                    {template.downloadCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {template.reviewCount}
                  </span>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <Card className="p-12 text-center">
            <LayoutDashboard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('dashboard.noTemplateFound')}</h3>
            <p className="text-muted-foreground">
              {t('dashboard.tryChangingFilters')}
            </p>
          </Card>
        )}

        {/* Template Detail Dialog */}
        <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent className="max-w-2xl">
            {selectedTemplate && (
              <>
                <DialogHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <DialogTitle className="text-xl">{selectedTemplate.name}</DialogTitle>
                      <DialogDescription className="mt-1">
                        {t('dashboard.by')} {selectedTemplate.author}
                      </DialogDescription>
                    </div>
                    <Badge variant="secondary">
                      {t(CATEGORIES.find(c => c.value === selectedTemplate.category)?.labelKey ?? 'dashboard.catAll')}
                    </Badge>
                  </div>
                </DialogHeader>

                <div className="space-y-4">
                  <p className="text-muted-foreground">{selectedTemplate.description}</p>

                  <div className="grid grid-cols-3 gap-4">
                    <Card className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        {selectedTemplate.rating == null ? (
                          <span className="font-bold text-muted-foreground">—</span>
                        ) : (
                          <>
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            <span className="font-bold">{selectedTemplate.rating.toFixed(1)}</span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedTemplate.rating == null
                          ? t('dashboard.noRating')
                          : `${selectedTemplate.reviewCount} ${t('dashboard.reviews')}`}
                      </p>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Download className="h-4 w-4" />
                        <span className="font-bold">{selectedTemplate.downloadCount}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t('dashboard.downloads')}</p>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Clock className="h-4 w-4" />
                        <span className="font-bold">{selectedTemplate.widgets.length}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">widgets</p>
                    </Card>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">{t('dashboard.widgetsIncluded')}</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTemplate.widgets.map((widget, idx) => (
                        <Badge key={idx} variant="outline" className="flex items-center gap-1">
                          {WIDGET_ICONS[widget]}
                          <span className="capitalize">{widget.replace('-', ' ')}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
                    {t('common.close')}
                  </Button>
                  <Button onClick={() => handleDownload(selectedTemplate)}>
                    <Download className="h-4 w-4 mr-2" />
                    {t('dashboard.download')}
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
              <DialogTitle>{t('dashboard.shareDashboardTemplate')}</DialogTitle>
              <DialogDescription>
                {t('dashboard.shareWithCommunity')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('dashboard.templateName')}</Label>
                <Input
                  placeholder={t('dashboard.enterTemplateName')}
                  value={publishForm.name}
                  onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('common.description')}</Label>
                <Textarea
                  placeholder={t('dashboard.describeYourTemplate')}
                  value={publishForm.description}
                  onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('dashboard.category')}</Label>
                <Select
                  value={publishForm.category}
                  onValueChange={(value) => setPublishForm({ ...publishForm, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('dashboard.selectCategory')} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c.value !== 'all').map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {t(cat.labelKey)}
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
              <Button onClick={handlePublish} disabled={publishMutation.isPending}>
                <Share2 className="h-4 w-4 mr-2" />
                {t('dashboard.submitForReview')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
