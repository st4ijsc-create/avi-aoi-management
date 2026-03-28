import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Search, 
  Download, 
  Star, 
  Upload, 
  Filter,
  LayoutDashboard,
  TrendingUp,
  Activity,
  Bell,
  BarChart3,
  Settings,
  Eye,
  Heart
} from "lucide-react";

const CATEGORIES = [
  { value: "all", labelKey: "dashboard.catAll", icon: LayoutDashboard },
  { value: "production", labelKey: "dashboard.catProduction", icon: Activity },
  { value: "quality", labelKey: "dashboard.catQuality", icon: TrendingUp },
  { value: "monitoring", labelKey: "dashboard.catMonitoring", icon: Eye },
  { value: "alerts", labelKey: "dashboard.catAlerts", icon: Bell },
  { value: "analytics", labelKey: "dashboard.catAnalytics", icon: BarChart3 },
  { value: "management", labelKey: "dashboard.catManagement", icon: Settings },
];

export default function TemplateMarketplace() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "rating" | "downloads">("newest");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  
  // Publish form state
  const [publishForm, setPublishForm] = useState({
    templateId: 0,
    title: "",
    description: "",
    category: "production",
    tags: "",
  });

  const { data: templates, isLoading, refetch } = trpc.system.marketplace.list.useQuery({
    category: category === "all" ? undefined : category,
    search: search || undefined,
    sortBy,
    limit: 50,
  });

  const { data: myTemplates } = trpc.dashboard.listTemplates.useQuery();
  const { data: featuredTemplates } = trpc.system.marketplace.list.useQuery({
    isFeatured: true,
    limit: 6,
  });

  const publishMutation = trpc.system.marketplace.publish.useMutation({
    onSuccess: () => {
      toast.success(t('dashboard.templatePublishedSuccess'));
      setPublishDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.error') + ": " + error.message);
    },
  });

  const downloadMutation = trpc.system.marketplace.download.useMutation({
    onSuccess: (template) => {
      toast.success(t('dashboard.templateDownloaded'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.error') + ": " + error.message);
    },
  });

  const handlePublish = () => {
    if (!user) return;
    publishMutation.mutate({
      templateId: publishForm.templateId,
      publisherId: user.id,
      title: publishForm.title,
      description: publishForm.description,
      category: publishForm.category,
      tags: publishForm.tags.split(",").map(t => t.trim()).filter(Boolean),
    });
  };

  const handleDownload = (id: number) => {
    downloadMutation.mutate({ id });
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
            }`}
          />
        ))}
      </div>
    );
  };

  const getCategoryIcon = (cat: string) => {
    const found = CATEGORIES.find(c => c.value === cat);
    if (found) {
      const Icon = found.icon;
      return <Icon className="h-4 w-4" />;
    }
    return <LayoutDashboard className="h-4 w-4" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('dashboard.templateMarketplace')}</h1>
            <p className="text-muted-foreground">
              {t('dashboard.marketplaceDescription')}
            </p>
          </div>
          {user?.role === "admin" && (
            <Button onClick={() => setPublishDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {t('dashboard.publishTemplate')}
            </Button>
          )}
        </div>

        {/* Featured Templates */}
        {featuredTemplates && featuredTemplates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-red-500" />
                Featured Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {featuredTemplates.map((template: any) => (
                  <Card key={template.id} className="border-2 border-primary/20">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(template.category)}
                          <Badge variant="secondary">{template.category}</Badge>
                        </div>
                        <Badge variant="default">Featured</Badge>
                      </div>
                      <CardTitle className="text-lg">{template.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-2">
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {template.description || t('dashboard.noDescription')}
                      </p>
                      <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                        {renderStars(Number(template.rating) || 0)}
                        <span>({template.ratingCount})</span>
                        <span className="flex items-center gap-1">
                          <Download className="h-3 w-3" />
                          {template.downloadCount}
                        </span>
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        className="w-full" 
                        onClick={() => handleDownload(template.id)}
                        disabled={downloadMutation.isPending}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {t('dashboard.download')}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search and Filter */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('dashboard.searchTemplates')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder={t('dashboard.category')} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex items-center gap-2">
                        <cat.icon className="h-4 w-4" />
                        {t(cat.labelKey)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder={t('dashboard.sortBy')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">{t('dashboard.newest')}</SelectItem>
                  <SelectItem value="rating">{t('dashboard.highestRated')}</SelectItem>
                  <SelectItem value="downloads">{t('dashboard.mostDownloaded')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Templates Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="h-6 w-3/4 rounded bg-muted" />
                </CardHeader>
                <CardContent>
                  <div className="h-16 rounded bg-muted" />
                </CardContent>
              </Card>
            ))
          ) : templates && templates.length > 0 ? (
            templates.map((template: any) => (
              <Card key={template.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(template.category)}
                      <Badge variant="outline">{template.category}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">v{template.version}</span>
                  </div>
                  <CardTitle className="text-lg line-clamp-1">{template.title}</CardTitle>
                </CardHeader>
                <CardContent className="pb-2">
                  <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                    {template.description || t('dashboard.noDescription')}
                  </p>
                  <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                    {renderStars(Number(template.rating) || 0)}
                    <span>({template.ratingCount})</span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      {template.downloadCount} {t('dashboard.downloads')}
                    </span>
                  </div>
                  {template.tags && template.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {template.tags.slice(0, 3).map((tag: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => {
                      setSelectedTemplate(template);
                      setDetailDialogOpen(true);
                    }}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {t('corporate.details')}
                  </Button>
                  <Button 
                    className="flex-1"
                    onClick={() => handleDownload(template.id)}
                    disabled={downloadMutation.isPending}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t('dashboard.download')}
                  </Button>
                </CardFooter>
              </Card>
            ))
          ) : (
            <div className="col-span-full text-center py-12">
              <LayoutDashboard className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">{t('dashboard.noTemplatesYet')}</h3>
              <p className="text-muted-foreground">
                {t('dashboard.beFirstToPublish')}
              </p>
            </div>
          )}
        </div>

        {/* Publish Dialog */}
        <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('dashboard.publishToMarketplace')}</DialogTitle>
              <DialogDescription>
                {t('dashboard.shareWithCommunity')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('dashboard.selectTemplate')}</Label>
                <Select 
                  value={publishForm.templateId.toString()} 
                  onValueChange={(v) => setPublishForm({ ...publishForm, templateId: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('dashboard.selectTemplateToPublish')} />
                  </SelectTrigger>
                  <SelectContent>
                    {myTemplates?.filter((t: any) => t.templateType !== "system").map((t: any) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('dashboard.title')}</Label>
                <Input
                  value={publishForm.title}
                  onChange={(e) => setPublishForm({ ...publishForm, title: e.target.value })}
                  placeholder={t('dashboard.displayNameOnMarketplace')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('common.description')}</Label>
                <Textarea
                  value={publishForm.description}
                  onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                  placeholder={t('dashboard.describeYourTemplate')}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('dashboard.category')}</Label>
                <Select 
                  value={publishForm.category} 
                  onValueChange={(v) => setPublishForm({ ...publishForm, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c.value !== "all").map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        <div className="flex items-center gap-2">
                          <cat.icon className="h-4 w-4" />
                          {t(cat.labelKey)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('dashboard.tags')}</Label>
                <Input
                  value={publishForm.tags}
                  onChange={(e) => setPublishForm({ ...publishForm, tags: e.target.value })}
                  placeholder="dashboard, production, realtime"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button 
                onClick={handlePublish}
                disabled={!publishForm.templateId || !publishForm.title || publishMutation.isPending}
              >
                {publishMutation.isPending ? t('dashboard.publishing') : t('dashboard.publish')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedTemplate?.title}</DialogTitle>
              <DialogDescription>
                {t('dashboard.templateDetails')}
              </DialogDescription>
            </DialogHeader>
            {selectedTemplate && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {getCategoryIcon(selectedTemplate.category)}
                  <Badge>{selectedTemplate.category}</Badge>
                  <span className="text-sm text-muted-foreground">v{selectedTemplate.version}</span>
                </div>
                <p className="text-sm">{selectedTemplate.description || t('dashboard.noDescription')}</p>
                <div className="flex items-center gap-4">
                  {renderStars(Number(selectedTemplate.rating) || 0)}
                  <span className="text-sm text-muted-foreground">
                    ({selectedTemplate.ratingCount} {t('dashboard.reviews')})
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  <Download className="inline h-4 w-4 mr-1" />
                  {selectedTemplate.downloadCount} {t('dashboard.downloads')}
                </div>
                {selectedTemplate.tags && selectedTemplate.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedTemplate.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
                {t('common.close')}
              </Button>
              <Button 
                onClick={() => {
                  if (selectedTemplate) {
                    handleDownload(selectedTemplate.id);
                    setDetailDialogOpen(false);
                  }
                }}
                disabled={downloadMutation.isPending}
              >
                <Download className="mr-2 h-4 w-4" />
                {t('dashboard.download')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
