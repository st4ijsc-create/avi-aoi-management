import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardLayoutEditor, { DashboardLayout as LayoutType } from "@/components/DashboardLayoutEditor";
import AsyncBoundary from "@/components/AsyncBoundary";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Plus, 
  LayoutGrid, 
  Edit, 
  Trash2, 
  Copy, 
  Share2,
  Lock,
  Globe,
  Clock,
  Search,
  Star,
  StarOff,
} from "lucide-react";

// Map server dashboard record to client LayoutType
function mapToLayout(d: any): LayoutType {
  return {
    id: String(d.id),
    name: d.name,
    description: d.description || undefined,
    widgets: (d.widgets as any[]) || [],
    gridCols: d.gridCols || 4,
    isPublic: d.isPublic || false,
    createdAt: new Date(d.createdAt),
    updatedAt: new Date(d.updatedAt),
  };
}

export default function CustomDashboardContent() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("my-layouts");
  const [isEditing, setIsEditing] = useState(false);
  const [editingLayout, setEditingLayout] = useState<LayoutType | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [newLayoutDesc, setNewLayoutDesc] = useState("");

  // Queries
  const utils = trpc.useUtils();
  const myDashboardsQuery = trpc.dashboardWidget.listCustomDashboards.useQuery();
  const publicDashboardsQuery = trpc.dashboardWidget.listPublicDashboards.useQuery();

  // Mutations
  const createMutation = trpc.dashboardWidget.createCustomDashboard.useMutation({
    onSuccess: () => utils.dashboardWidget.listCustomDashboards.invalidate(),
  });
  const updateMutation = trpc.dashboardWidget.updateCustomDashboard.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listCustomDashboards.invalidate();
      utils.dashboardWidget.listPublicDashboards.invalidate();
    },
  });
  const deleteMutation = trpc.dashboardWidget.deleteCustomDashboard.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listCustomDashboards.invalidate();
      utils.dashboardWidget.listPublicDashboards.invalidate();
    },
  });
  const duplicateMutation = trpc.dashboardWidget.duplicateCustomDashboard.useMutation({
    onSuccess: () => utils.dashboardWidget.listCustomDashboards.invalidate(),
  });
  const toggleFavoriteMutation = trpc.dashboardWidget.toggleCustomDashboardFavorite.useMutation({
    onSuccess: () => utils.dashboardWidget.listCustomDashboards.invalidate(),
  });
  const togglePublicMutation = trpc.dashboardWidget.toggleCustomDashboardPublic.useMutation({
    onSuccess: () => {
      utils.dashboardWidget.listCustomDashboards.invalidate();
      utils.dashboardWidget.listPublicDashboards.invalidate();
    },
  });

  // Derive layouts from server data
  const allMyLayouts = (myDashboardsQuery.data || []).map(mapToLayout);
  const allPublicLayouts = (publicDashboardsQuery.data || []).map(mapToLayout);
  const favoriteIds = new Set(
    (myDashboardsQuery.data || []).filter((d: any) => d.isFavorite).map((d: any) => String(d.id))
  );

  const filterBySearch = (layouts: LayoutType[]) =>
    layouts.filter(layout =>
      layout.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      layout.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const myLayouts = filterBySearch(allMyLayouts.filter(l => !l.isPublic));
  const sharedLayouts = filterBySearch(allPublicLayouts);
  const favoriteLayouts = filterBySearch(allMyLayouts.filter(l => favoriteIds.has(l.id)));

  const handleCreateLayout = async () => {
    if (!newLayoutName.trim()) {
      toast.error(t('dashboard.enterLayoutName'));
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        name: newLayoutName,
        description: newLayoutDesc || undefined,
        widgets: [],
        gridCols: 4,
        isPublic: false,
      });
      const newLayout: LayoutType = {
        id: String(result?.id),
        name: newLayoutName,
        description: newLayoutDesc || undefined,
        widgets: [],
        gridCols: 4,
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setEditingLayout(newLayout);
      setIsEditing(true);
      setIsCreateOpen(false);
      setNewLayoutName("");
      setNewLayoutDesc("");
      toast.success(t('dashboard.layoutCreated'));
    } catch (e) {
      toast.error(t('dashboard.createError'));
    }
  };

  const handleSaveLayout = async (layout: LayoutType) => {
    try {
      await updateMutation.mutateAsync({
        id: Number(layout.id),
        name: layout.name,
        description: layout.description,
        widgets: layout.widgets,
        gridCols: layout.gridCols,
        isPublic: layout.isPublic,
      });
      setIsEditing(false);
      setEditingLayout(null);
      toast.success(t('dashboard.layoutSaved'));
    } catch (e) {
      toast.error(t('dashboard.saveError'));
    }
  };

  const handleDeleteLayout = async (layoutId: string) => {
    try {
      await deleteMutation.mutateAsync({ id: Number(layoutId) });
      toast.success(t('dashboard.layoutDeleted'));
    } catch (e) {
      toast.error(t('dashboard.deleteError'));
    }
  };

  const handleDuplicateLayout = async (layout: LayoutType) => {
    try {
      await duplicateMutation.mutateAsync({ id: Number(layout.id) });
      toast.success(t('dashboard.layoutDuplicated'));
    } catch (e) {
      toast.error(t('dashboard.duplicateError'));
    }
  };

  const handleToggleFavorite = async (layoutId: string) => {
    try {
      await toggleFavoriteMutation.mutateAsync({ id: Number(layoutId) });
    } catch (e) {
      toast.error(t('dashboard.favoriteError'));
    }
  };

  const handleTogglePublic = async (layoutId: string) => {
    try {
      await togglePublicMutation.mutateAsync({ id: Number(layoutId) });
      toast.success(t('dashboard.shareStatusUpdated'));
    } catch (e) {
      toast.error(t('dashboard.shareStatusError'));
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Editing mode - render fullscreen without DashboardLayout wrapper
  if (isEditing && editingLayout) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <DashboardLayoutEditor
          layout={editingLayout}
          onSave={handleSaveLayout}
          onCancel={() => {
            setIsEditing(false);
            setEditingLayout(null);
          }}
        />
      </div>
    );
  }

  // Layout list view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t('dashboard.customDashboard')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.customDashboardDescription')}
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('dashboard.createDashboard')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('dashboard.createNewDashboard')}</DialogTitle>
              <DialogDescription>
                {t('dashboard.enterNewDashboardInfo')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('dashboard.dashboardName')} *</Label>
                <Input
                  value={newLayoutName}
                  onChange={(e) => setNewLayoutName(e.target.value)}
                  placeholder="VD: Production Overview"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('common.description')}</Label>
                <Textarea
                  value={newLayoutDesc}
                  onChange={(e) => setNewLayoutDesc(e.target.value)}
                  placeholder={t('dashboard.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleCreateLayout}>
                {t('dashboard.createAndDesign')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t('dashboard.searchDashboard')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="my-layouts">
            <Lock className="w-4 h-4 mr-2" />
            {t('dashboard.mine')} ({myLayouts.length})
          </TabsTrigger>
          <TabsTrigger value="shared">
            <Globe className="w-4 h-4 mr-2" />
            {t('dashboard.shared')} ({sharedLayouts.length})
          </TabsTrigger>
          <TabsTrigger value="favorites">
            <Star className="w-4 h-4 mr-2" />
            {t('dashboard.favorites')} ({favoriteLayouts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-layouts" className="mt-4">
          <AsyncBoundary
            isLoading={myDashboardsQuery.isLoading}
            isError={myDashboardsQuery.isError}
            error={myDashboardsQuery.error}
            onRetry={() => myDashboardsQuery.refetch()}
            preset="cards"
            errorTitle="Không tải được danh sách bảng điều khiển"
            retryLabel="Thử lại"
          >
            <LayoutGridView layouts={myLayouts} />
          </AsyncBoundary>
        </TabsContent>

        <TabsContent value="shared" className="mt-4">
          <AsyncBoundary
            isLoading={publicDashboardsQuery.isLoading}
            isError={publicDashboardsQuery.isError}
            error={publicDashboardsQuery.error}
            onRetry={() => publicDashboardsQuery.refetch()}
            preset="cards"
            errorTitle="Không tải được danh sách bảng điều khiển chia sẻ"
            retryLabel="Thử lại"
          >
            <LayoutGridView layouts={sharedLayouts} />
          </AsyncBoundary>
        </TabsContent>

        <TabsContent value="favorites" className="mt-4">
          <AsyncBoundary
            isLoading={myDashboardsQuery.isLoading}
            isError={myDashboardsQuery.isError}
            error={myDashboardsQuery.error}
            onRetry={() => myDashboardsQuery.refetch()}
            preset="cards"
            errorTitle="Không tải được danh sách bảng điều khiển"
            retryLabel="Thử lại"
          >
            <LayoutGridView layouts={favoriteLayouts} />
          </AsyncBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );

  function LayoutGridView({ layouts }: { layouts: LayoutType[] }) {
    if (layouts.length === 0) {
      return (
        <div className="text-center py-12">
          <LayoutGrid className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="text-lg font-medium mb-2">{t('dashboard.noDashboard')}</h3>
          <p className="text-muted-foreground mb-4">
            {t('dashboard.createFirstDashboard')}
          </p>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('dashboard.createDashboard')}
          </Button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {layouts.map(layout => (
          <Card key={layout.id} className="group hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">
                    {layout.name}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {layout.description || t('dashboard.noDescription')}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleToggleFavorite(layout.id)}
                >
                  {favoriteIds.has(layout.id) ? (
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  ) : (
                    <StarOff className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Preview */}
              <div className="h-32 bg-muted rounded-lg mb-3 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <LayoutGrid className="w-8 h-8 mx-auto mb-1" />
                  <span className="text-xs">{layout.widgets.length} widgets</span>
                </div>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Clock className="w-3 h-3" />
                <span>{t('dashboard.updated')}: {formatDate(layout.updatedAt)}</span>
                {layout.isPublic && (
                  <Badge variant="secondary" className="ml-auto">
                    <Globe className="w-3 h-3 mr-1" />
                    Public
                  </Badge>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setEditingLayout(layout);
                    setIsEditing(true);
                  }}
                >
                  <Edit className="w-3 h-3 mr-1" />
                  {t('dashboard.edit')}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleDuplicateLayout(layout)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleTogglePublic(layout.id)}
                >
                  {layout.isPublic ? <Lock className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-destructive"
                  onClick={() => handleDeleteLayout(layout.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
}
