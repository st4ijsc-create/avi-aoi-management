import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardLayoutEditor, { DashboardLayout as LayoutType } from "@/components/DashboardLayoutEditor";
import { toast } from "sonner";
import { 
  Plus, 
  LayoutGrid, 
  Edit, 
  Trash2, 
  Copy, 
  Eye, 
  Share2,
  Lock,
  Globe,
  Clock,
  Search,
  Star,
  StarOff,
} from "lucide-react";

// Mock data for saved layouts
const mockLayouts: LayoutType[] = [
  {
    id: "layout_1",
    name: "Production Overview",
    description: "Dashboard tổng quan sản xuất với KPIs chính",
    widgets: [
      { id: "w1", type: "kpi-card", title: "Yield Rate", size: "small", position: { x: 0, y: 0 }, config: { dataSource: "yield_rate" } },
      { id: "w2", type: "kpi-card", title: "NG Rate", size: "small", position: { x: 1, y: 0 }, config: { dataSource: "ng_rate" } },
      { id: "w3", type: "line-chart", title: "Trend", size: "large", position: { x: 0, y: 1 }, config: { dataSource: "yield_trend" } },
    ],
    gridCols: 4,
    isPublic: false,
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-20"),
  },
  {
    id: "layout_2",
    name: "Quality Metrics",
    description: "Dashboard theo dõi chất lượng sản phẩm",
    widgets: [
      { id: "w4", type: "pie-chart", title: "Result Distribution", size: "medium", position: { x: 0, y: 0 }, config: { dataSource: "result_distribution" } },
      { id: "w5", type: "bar-chart", title: "NG by Machine", size: "medium", position: { x: 2, y: 0 }, config: { dataSource: "ng_by_machine" } },
      { id: "w6", type: "alert-list", title: "Recent Alerts", size: "full", position: { x: 0, y: 1 }, config: { maxItems: 5 } },
    ],
    gridCols: 4,
    isPublic: true,
    createdAt: new Date("2024-01-10"),
    updatedAt: new Date("2024-01-18"),
  },
];

export default function CustomDashboard() {
  const [layouts, setLayouts] = useState<LayoutType[]>(mockLayouts);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("my-layouts");
  const [isEditing, setIsEditing] = useState(false);
  const [editingLayout, setEditingLayout] = useState<LayoutType | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [newLayoutDesc, setNewLayoutDesc] = useState("");
  const [favorites, setFavorites] = useState<string[]>(["layout_1"]);

  const filteredLayouts = layouts.filter(layout => 
    layout.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    layout.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const myLayouts = filteredLayouts.filter(l => !l.isPublic);
  const sharedLayouts = filteredLayouts.filter(l => l.isPublic);
  const favoriteLayouts = filteredLayouts.filter(l => favorites.includes(l.id));

  const handleCreateLayout = () => {
    if (!newLayoutName.trim()) {
      toast.error("Vui lòng nhập tên layout");
      return;
    }

    const newLayout: LayoutType = {
      id: `layout_${Date.now()}`,
      name: newLayoutName,
      description: newLayoutDesc,
      widgets: [],
      gridCols: 4,
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setLayouts(prev => [...prev, newLayout]);
    setEditingLayout(newLayout);
    setIsEditing(true);
    setIsCreateOpen(false);
    setNewLayoutName("");
    setNewLayoutDesc("");
    toast.success("Đã tạo layout mới");
  };

  const handleSaveLayout = (layout: LayoutType) => {
    setLayouts(prev => prev.map(l => l.id === layout.id ? layout : l));
    setIsEditing(false);
    setEditingLayout(null);
    toast.success("Đã lưu layout");
  };

  const handleDeleteLayout = (layoutId: string) => {
    setLayouts(prev => prev.filter(l => l.id !== layoutId));
    toast.success("Đã xóa layout");
  };

  const handleDuplicateLayout = (layout: LayoutType) => {
    const newLayout: LayoutType = {
      ...layout,
      id: `layout_${Date.now()}`,
      name: `${layout.name} (Copy)`,
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setLayouts(prev => [...prev, newLayout]);
    toast.success("Đã sao chép layout");
  };

  const handleToggleFavorite = (layoutId: string) => {
    setFavorites(prev => 
      prev.includes(layoutId) 
        ? prev.filter(id => id !== layoutId)
        : [...prev, layoutId]
    );
  };

  const handleTogglePublic = (layoutId: string) => {
    setLayouts(prev => prev.map(l => 
      l.id === layoutId ? { ...l, isPublic: !l.isPublic } : l
    ));
    toast.success("Đã cập nhật trạng thái chia sẻ");
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Editing mode
  if (isEditing && editingLayout) {
    return (
      <div className="h-screen">
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
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Custom Dashboard</h1>
            <p className="text-muted-foreground">
              Tạo và quản lý các dashboard tùy chỉnh
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Tạo Dashboard
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Tạo Dashboard mới</DialogTitle>
                <DialogDescription>
                  Nhập thông tin cho dashboard mới
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Tên dashboard *</Label>
                  <Input
                    value={newLayoutName}
                    onChange={(e) => setNewLayoutName(e.target.value)}
                    placeholder="VD: Production Overview"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Mô tả</Label>
                  <Textarea
                    value={newLayoutDesc}
                    onChange={(e) => setNewLayoutDesc(e.target.value)}
                    placeholder="Mô tả ngắn về dashboard..."
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Hủy
                </Button>
                <Button onClick={handleCreateLayout}>
                  Tạo & Thiết kế
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Tìm kiếm dashboard..."
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
              Của tôi ({myLayouts.length})
            </TabsTrigger>
            <TabsTrigger value="shared">
              <Globe className="w-4 h-4 mr-2" />
              Được chia sẻ ({sharedLayouts.length})
            </TabsTrigger>
            <TabsTrigger value="favorites">
              <Star className="w-4 h-4 mr-2" />
              Yêu thích ({favoriteLayouts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-layouts" className="mt-4">
            <LayoutGridView layouts={myLayouts} />
          </TabsContent>

          <TabsContent value="shared" className="mt-4">
            <LayoutGridView layouts={sharedLayouts} />
          </TabsContent>

          <TabsContent value="favorites" className="mt-4">
            <LayoutGridView layouts={favoriteLayouts} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );

  function LayoutGridView({ layouts }: { layouts: LayoutType[] }) {
    if (layouts.length === 0) {
      return (
        <div className="text-center py-12">
          <LayoutGrid className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="text-lg font-medium mb-2">Chưa có dashboard</h3>
          <p className="text-muted-foreground mb-4">
            Tạo dashboard đầu tiên của bạn
          </p>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Tạo Dashboard
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
                    {layout.description || "Không có mô tả"}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleToggleFavorite(layout.id)}
                >
                  {favorites.includes(layout.id) ? (
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
                <span>Cập nhật: {formatDate(layout.updatedAt)}</span>
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
                  Chỉnh sửa
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
