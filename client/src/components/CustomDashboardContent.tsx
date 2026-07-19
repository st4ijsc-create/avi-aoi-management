import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
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
import { ConfirmDeleteDialog } from "@/components/patterns/ConfirmDeleteDialog";
import { SYSTEM_TEMPLATES } from "@/components/EmbeddedDashboardTemplates";
import { templateToCustomDashboardWidgets } from "@/lib/dashboardTemplateApply";
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
  ExternalLink,
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

// doc 67 W8 — chế độ hiển thị của LayoutGridView theo tab (việc 4):
// "mine"/"favorites" = dashboard của tôi (đủ quyền Sửa/Xóa); "shared" = danh sách
// công khai, mục KHÔNG thuộc sở hữu chỉ được Mở + Nhân bản về của tôi.
type GridMode = "mine" | "shared" | "favorites";

// doc 67 W8 (P3): `embedded` — trong hub /dashboard-center, PageHeader hub đã có
// tiêu đề nên bỏ h2+description lặp (giữ nút Tạo dashboard).
export default function CustomDashboardContent({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
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

  // doc 67 W8 (việc 4): tab "Của tôi" hiển thị CẢ dashboard đã chia sẻ (kèm badge
  // "Công khai") — trước đây filter !isPublic làm dashboard "biến mất" ngay sau khi share.
  const myLayouts = filterBySearch(allMyLayouts);
  const sharedLayouts = filterBySearch(allPublicLayouts);
  const favoriteLayouts = filterBySearch(allMyLayouts.filter(l => favoriteIds.has(l.id)));
  // Sở hữu: id nằm trong listCustomDashboards → của tôi (dùng phân quyền action ở tab Chia sẻ).
  const myLayoutIds = new Set(allMyLayouts.map(l => l.id));

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

  // doc 67 W8 (việc 3): gọi từ ConfirmDeleteDialog — ném lại lỗi để dialog giữ mở khi fail.
  const handleDeleteLayout = async (layoutId: string) => {
    try {
      await deleteMutation.mutateAsync({ id: Number(layoutId) });
      toast.success(t('dashboard.layoutDeleted'));
    } catch (e) {
      toast.error(t('dashboard.deleteError'));
      throw e;
    }
  };

  // doc 67 W8 (việc 2): MỞ XEM — CustomDashboardViewer mount ở /dashboard tab "custom";
  // deep-link kèm dashboardId (viewer + Dashboard.tsx đã đọc param này).
  const handleOpenDashboard = (layoutId: string) => {
    setLocation(`/dashboard?tab=custom&dashboardId=${encodeURIComponent(layoutId)}`);
  };

  // doc 67 W8 (việc 5): empty-state 1-click — tạo dashboard thật từ system template
  // (cùng flow apply của tab Mẫu: templateToCustomDashboardWidgets → createCustomDashboard).
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const handleApplyTemplate = async (template: (typeof SYSTEM_TEMPLATES)[number]) => {
    setApplyingTemplateId(template.id);
    try {
      await createMutation.mutateAsync({
        name: template.name,
        description: template.description,
        widgets: templateToCustomDashboardWidgets({
          widgets: template.widgets,
          layout: template.layout,
        }),
        gridCols: 4,
        isPublic: false,
      });
      toast.success(t('dashboard.templateApplied', 'Đã áp dụng template'));
    } catch (e) {
      toast.error(t('dashboard.createError'));
    } finally {
      setApplyingTemplateId(null);
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
      {/* Header — embedded (doc 67 W8 P3): bỏ h2+description lặp với PageHeader hub */}
      <div className={embedded ? "flex items-center justify-end" : "flex items-center justify-between"}>
        {!embedded && (
          <div>
            <h2 className="text-xl font-bold">{t('dashboard.customDashboard')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.customDashboardDescription')}
            </p>
          </div>
        )}
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
            <LayoutGridView layouts={myLayouts} mode="mine" />
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
            <LayoutGridView layouts={sharedLayouts} mode="shared" />
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
            <LayoutGridView layouts={favoriteLayouts} mode="favorites" />
          </AsyncBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );

  // doc 67 W8 (việc 6): preview mini-grid — sơ đồ bố cục render từ widgets[]
  // (position.x/y + size→span trên lưới gridCols), CSS grid thuần, ô màu muted —
  // phân biệt dashboard bằng mắt thay icon placeholder.
  function LayoutMiniPreview({ layout }: { layout: LayoutType }) {
    const cols = layout.gridCols || 4;
    const spanBySize: Record<string, number> = { small: 1, medium: 2, large: 3, full: cols };
    if (!layout.widgets || layout.widgets.length === 0) {
      return (
        <div className="h-32 bg-muted rounded-lg mb-3 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <LayoutGrid className="w-8 h-8 mx-auto mb-1" />
            <span className="text-xs">0 widgets</span>
          </div>
        </div>
      );
    }
    return (
      <div className="h-32 bg-muted/50 border rounded-lg mb-3 p-2 overflow-hidden" aria-hidden="true">
        <div
          className="grid h-full gap-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(0, 1fr)",
          }}
        >
          {layout.widgets.slice(0, 16).map((w, idx) => {
            const x = Math.max(0, Math.min(cols - 1, w.position?.x ?? 0));
            const span = Math.max(1, Math.min(spanBySize[w.size] ?? 2, cols - x));
            const y = Math.max(0, Math.min(5, w.position?.y ?? idx));
            return (
              <div
                key={w.id || idx}
                className="rounded-sm bg-muted-foreground/25"
                style={{ gridColumn: `${x + 1} / span ${span}`, gridRow: `${y + 1}` }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // doc 67 W8 (việc 5): empty state = grid 6 system template 1-click ("Dùng mẫu này")
  // + nút phụ "Tạo trống" — thay vì bắt user bắt đầu từ trang trắng.
  function EmptyStateTemplates() {
    return (
      <div className="space-y-4 py-4">
        <div className="text-center">
          <LayoutGrid className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-lg font-medium mb-1">{t('dashboard.noDashboard')}</h3>
          <p className="text-sm text-muted-foreground">
            Bắt đầu nhanh với một mẫu hệ thống, hoặc tạo dashboard trống.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SYSTEM_TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Card key={template.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className={`w-fit p-2 rounded-lg ${template.color} bg-opacity-10`}>
                    <Icon className={`h-5 w-5 ${template.color.replace('bg-', 'text-')}`} />
                  </div>
                  <CardTitle className="text-base mt-2">{template.name}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">
                    {template.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="outline" className="text-xs">
                      {template.widgets.length} widgets
                    </Badge>
                  </div>
                  <Button
                    className="w-full min-h-11"
                    onClick={() => handleApplyTemplate(template)}
                    disabled={createMutation.isPending}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {applyingTemplateId === template.id ? "Đang tạo…" : "Dùng mẫu này"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="text-center">
          <Button variant="outline" className="min-h-11" onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Tạo trống
          </Button>
        </div>
      </div>
    );
  }

  function LayoutGridView({ layouts, mode }: { layouts: LayoutType[]; mode: GridMode }) {
    if (layouts.length === 0) {
      // doc 67 W8 (việc 5): thật sự chưa có dashboard nào (không phải rỗng do search)
      // → quick-start bằng 6 system template.
      if (mode === "mine" && allMyLayouts.length === 0) {
        return <EmptyStateTemplates />;
      }
      return (
        <div className="text-center py-12">
          <LayoutGrid className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="text-lg font-medium mb-2">{t('dashboard.noDashboard')}</h3>
          <p className="text-muted-foreground mb-4">
            {t('dashboard.createFirstDashboard')}
          </p>
          {mode !== "shared" && (
            <Button className="min-h-11" onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t('dashboard.createDashboard')}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {layouts.map(layout => {
          // doc 67 W8 (việc 4): tab "Đã chia sẻ" chứa cả dashboard người khác —
          // chỉ mục MÌNH sở hữu mới có Sửa/Xóa/Chia sẻ; còn lại Mở + Nhân bản.
          const isOwn = mode !== "shared" || myLayoutIds.has(layout.id);
          return (
            <Card
              key={layout.id}
              role="button"
              tabIndex={0}
              className="group hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleOpenDashboard(layout.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  handleOpenDashboard(layout.id);
                }
              }}
            >
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
                  {isOwn && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 min-h-11 min-w-11"
                      aria-label={favoriteIds.has(layout.id) ? "Bỏ yêu thích" : "Yêu thích"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(layout.id);
                      }}
                    >
                      {favoriteIds.has(layout.id) ? (
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ) : (
                        <StarOff className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {/* Preview — doc 67 W8 (việc 6) */}
                <LayoutMiniPreview layout={layout} />

                {/* Meta */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <Clock className="w-3 h-3" />
                  <span>{t('dashboard.updated')}: {formatDate(layout.updatedAt)}</span>
                  <span className="ml-auto">{layout.widgets.length} widgets</span>
                  {layout.isPublic && (
                    <Badge variant="secondary">
                      <Globe className="w-3 h-3 mr-1" />
                      Công khai
                    </Badge>
                  )}
                </div>

                {/* Actions — doc 67 W8 (việc 2): 'Mở' là action chính, Sửa hạ xuống hàng phụ */}
                {isOwn ? (
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 min-h-11"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDashboard(layout.id);
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      Mở
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={t('dashboard.edit')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingLayout(layout);
                        setIsEditing(true);
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label="Nhân bản"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateLayout(layout);
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={layout.isPublic ? "Ngừng chia sẻ" : "Chia sẻ"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePublic(layout.id);
                      }}
                    >
                      {layout.isPublic ? <Lock className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    </Button>
                    {/* doc 67 W8 (việc 3): xóa phải qua AlertDialog xác nhận kèm TÊN dashboard */}
                    <ConfirmDeleteDialog
                      trigger={
                        <Button
                          variant="outline"
                          size="icon"
                          className="min-h-11 min-w-11 text-destructive"
                          aria-label="Xóa"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      }
                      itemLabel={`dashboard "${layout.name}"`}
                      onConfirm={() => handleDeleteLayout(layout.id)}
                    />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 min-h-11"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDashboard(layout.id);
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      Mở
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 min-h-11"
                      disabled={duplicateMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateLayout(layout);
                      }}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Nhân bản về của tôi
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }
}
