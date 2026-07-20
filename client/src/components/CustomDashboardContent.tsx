import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DashboardLayoutEditor, { DashboardLayout as LayoutType } from "@/components/DashboardLayoutEditor";
import { widgetDefinitions } from "@/components/DashboardWidgetLibrary";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
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
  Lock,
  Globe,
  Clock,
  Search,
  Star,
  StarOff,
  ExternalLink,
  MoreHorizontal,
  ChevronDown,
  FileText,
} from "lucide-react";

// doc 68 §3.8 (việc 5) — màu ô mini-preview theo NHÓM widget (category), giúp
// phân biệt loại nội dung bằng mắt thay vì khối xám đồng nhất.
const WIDGET_CATEGORY_COLOR: Record<string, string> = {
  metrics: "bg-blue-500/60",
  charts: "bg-violet-500/60",
  data: "bg-emerald-500/60",
  utility: "bg-amber-500/60",
};
const widgetCategoryOf = (type: string): keyof typeof WIDGET_CATEGORY_COLOR =>
  (widgetDefinitions.find((w) => w.type === type)?.category ?? "utility");

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
  // doc 68 §3.8 (việc 2) — ContextDrawer thuộc tính: giữ id dashboard đang mở +
  // bản nháp tên/mô tả để sửa tại chỗ (giảm mật độ target footer card cho persona găng).
  const [propsLayoutId, setPropsLayoutId] = useState<string | null>(null);
  const [propsName, setPropsName] = useState("");
  const [propsDesc, setPropsDesc] = useState("");

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
  // doc 68 §3.8 (việc 2) — layout đang mở trong drawer, lấy TƯƠI từ query (để switch
  // Công khai/Yêu thích phản ánh đúng sau khi toggle/invalidate).
  const propsLayout = propsLayoutId ? allMyLayouts.find((l) => l.id === propsLayoutId) ?? null : null;

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

  // doc 68 §3.8 (việc 2) — mở drawer thuộc tính cho 1 dashboard sở hữu.
  const openProps = (layout: LayoutType) => {
    setPropsLayoutId(layout.id);
    setPropsName(layout.name);
    setPropsDesc(layout.description || "");
  };

  // Lưu đổi tên/mô tả trong drawer (giữ nguyên widgets/gridCols/isPublic).
  const handleSaveProps = async (layout: LayoutType) => {
    if (!propsName.trim()) {
      toast.error(t('dashboard.enterLayoutName'));
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: Number(layout.id),
        name: propsName,
        description: propsDesc || undefined,
        widgets: layout.widgets,
        gridCols: layout.gridCols,
        isPublic: layout.isPublic,
      });
      toast.success(t('dashboard.layoutSaved'));
    } catch (e) {
      toast.error(t('dashboard.saveError'));
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
    <div className="space-y-4">
      {/* Header — non-embedded chỉ còn title (nút Tạo đã dời lên hàng tab-strip). */}
      {!embedded && (
        <div>
          <h2 className="text-xl font-bold">{t('dashboard.customDashboard')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.customDashboardDescription')}
          </p>
        </div>
      )}

      {/* doc 68 §3.8 (việc 1) — Dialog "Tạo trống" nay controlled (mở từ split-button). */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* doc 68 §3.8 (việc 1) — GỘP HÀNG ĐẦU: tab-strip trái · search giữa · CTA phải
            (xóa "vùng chết" dọc tab→CTA lẻ→search). */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="my-layouts">
              <Lock className="w-4 h-4 mr-2" />
              {t('dashboard.mine')}{myLayouts.length > 0 ? ` (${myLayouts.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="shared">
              <Globe className="w-4 h-4 mr-2" />
              {t('dashboard.shared')}{sharedLayouts.length > 0 ? ` (${sharedLayouts.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="favorites">
              <Star className="w-4 h-4 mr-2" />
              {t('dashboard.favorites')}{favoriteLayouts.length > 0 ? ` (${favoriteLayouts.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 sm:ml-auto">
            {/* Search (giữa) */}
            <div className="relative w-full sm:w-56 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('dashboard.searchDashboard')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            {/* CTA (phải) — split-button "Tạo mới ▾": Từ mẫu / Trống */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="shrink-0">
                  <Plus className="w-4 h-4 mr-2" />
                  {t('dashboard.createNew', 'Tạo mới')}
                  <ChevronDown className="w-4 h-4 ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setLocation('/dashboard-center?tab=dashboard-templates')}>
                  <FileText className="w-4 h-4 mr-2" />
                  {t('dashboard.createFromTemplate', 'Từ mẫu')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('dashboard.createBlank', 'Trống')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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

      {/* doc 68 §3.8 (việc 2) — ContextDrawer thuộc tính (thay 5 icon footer card). */}
      <ContextDrawer
        open={propsLayout !== null}
        onOpenChange={(o) => { if (!o) setPropsLayoutId(null); }}
        title={propsLayout?.name ?? t('dashboard.properties', 'Thuộc tính')}
        description={t('dashboard.propertiesHint', 'Đổi tên, mô tả, chia sẻ, yêu thích, nhân bản hoặc xóa.')}
      >
        {propsLayout && (
          <div className="space-y-5">
            {/* Hành động bố cục */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 min-h-11"
                onClick={() => {
                  setEditingLayout(propsLayout);
                  setIsEditing(true);
                  setPropsLayoutId(null);
                }}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t('dashboard.editLayout', 'Sửa bố cục')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 min-h-11"
                disabled={duplicateMutation.isPending}
                onClick={() => handleDuplicateLayout(propsLayout)}
              >
                <Copy className="w-4 h-4 mr-2" />
                {t('dashboard.duplicate', 'Nhân bản')}
              </Button>
            </div>

            <Separator />

            {/* Đổi tên + mô tả */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{t('dashboard.dashboardName')} *</Label>
                <Input value={propsName} onChange={(e) => setPropsName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('common.description')}</Label>
                <Textarea
                  value={propsDesc}
                  onChange={(e) => setPropsDesc(e.target.value)}
                  placeholder={t('dashboard.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
              <Button
                className="w-full min-h-11"
                disabled={updateMutation.isPending}
                onClick={() => handleSaveProps(propsLayout)}
              >
                {t('common.save', 'Lưu thay đổi')}
              </Button>
            </div>

            <Separator />

            {/* Công khai + Yêu thích */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {propsLayout.isPublic ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <Label className="cursor-pointer">{t('dashboard.public', 'Công khai')}</Label>
                </div>
                <Switch
                  checked={propsLayout.isPublic}
                  disabled={togglePublicMutation.isPending}
                  onCheckedChange={() => handleTogglePublic(propsLayout.id)}
                  aria-label={t('dashboard.public', 'Công khai')}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Star className={`w-4 h-4 ${favoriteIds.has(propsLayout.id) ? "fill-yellow-400 text-yellow-400" : ""}`} />
                  <Label className="cursor-pointer">{t('dashboard.favorite', 'Yêu thích')}</Label>
                </div>
                <Switch
                  checked={favoriteIds.has(propsLayout.id)}
                  disabled={toggleFavoriteMutation.isPending}
                  onCheckedChange={() => handleToggleFavorite(propsLayout.id)}
                  aria-label={t('dashboard.favorite', 'Yêu thích')}
                />
              </div>
            </div>

            <Separator />

            {/* Xóa */}
            <ConfirmDeleteDialog
              trigger={
                <Button variant="outline" className="w-full min-h-11 text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('dashboard.delete', 'Xóa')}
                </Button>
              }
              itemLabel={`dashboard "${propsLayout.name}"`}
              onConfirm={async () => {
                await handleDeleteLayout(propsLayout.id);
                setPropsLayoutId(null);
              }}
            />
          </div>
        )}
      </ContextDrawer>
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
    // doc 68 §3.8 (việc 5): nhãn/màu theo NHÓM widget — chú giải các nhóm có mặt.
    const presentCategories = Array.from(
      new Set(layout.widgets.map((w) => widgetCategoryOf(w.type)))
    );
    const categoryLabel: Record<string, string> = {
      metrics: t('widgets.category.metrics', 'Chỉ số'),
      charts: t('widgets.category.charts', 'Biểu đồ'),
      data: t('widgets.category.data', 'Dữ liệu'),
      utility: t('widgets.category.utility', 'Tiện ích'),
    };
    return (
      <div className="mb-3">
        <div className="h-32 bg-muted/50 border rounded-lg p-2 overflow-hidden" aria-hidden="true">
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
                  className={`rounded-sm ${WIDGET_CATEGORY_COLOR[widgetCategoryOf(w.type)]}`}
                  style={{ gridColumn: `${x + 1} / span ${span}`, gridRow: `${y + 1}` }}
                />
              );
            })}
          </div>
        </div>
        {presentCategories.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {presentCategories.map((cat) => (
              <span key={cat} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={`inline-block w-2 h-2 rounded-sm ${WIDGET_CATEGORY_COLOR[cat]}`} />
                {categoryLabel[cat]}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // doc 67 W8 (việc 5): empty state = grid 6 system template 1-click ("Dùng mẫu này")
  // + nút phụ "Tạo trống" — thay vì bắt user bắt đầu từ trang trắng.
  function EmptyStateTemplates() {
    return (
      <div className="space-y-3 py-2">
        {/* doc 68 §3.8 (việc 4): bỏ icon lớn + H3 trùng H1 PageHeader — 1 dòng dẫn. */}
        <p className="text-sm font-medium text-muted-foreground">
          {t('dashboard.quickStartPickTemplate', 'Bắt đầu nhanh — chọn một mẫu:')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {SYSTEM_TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <Card key={template.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  {/* doc 68 §3.8 (việc 5): chip màu nhỏ hơn + tương phản cao hơn. */}
                  <div className={`w-fit p-1.5 rounded-md ${template.color} bg-opacity-20`}>
                    <Icon className={`h-4 w-4 ${template.color.replace('bg-', 'text-')}`} />
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

                {/* Actions — doc 68 §3.8 (việc 2): 'Mở' (primary) + '⋯' mở ContextDrawer
                    thuộc tính (giảm mật độ target 5-icon cho persona găng tay). */}
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
                      aria-label={t('dashboard.properties', 'Thuộc tính')}
                      onClick={(e) => {
                        e.stopPropagation();
                        openProps(layout);
                      }}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
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
