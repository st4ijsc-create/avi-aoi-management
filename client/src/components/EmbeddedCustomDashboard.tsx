import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export default function EmbeddedCustomDashboard() {
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
  const favoriteLayouts = layouts.filter(l => favorites.includes(l.id));

  const handleCreateLayout = () => {
    if (!newLayoutName.trim()) {
      toast.error("Vui lòng nhập tên dashboard");
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

    setLayouts([...layouts, newLayout]);
    setEditingLayout(newLayout);
    setIsEditing(true);
    setIsCreateOpen(false);
    setNewLayoutName("");
    setNewLayoutDesc("");
    toast.success("Đã tạo dashboard mới");
  };

  const handleEditLayout = (layout: LayoutType) => {
    setEditingLayout(layout);
    setIsEditing(true);
  };

  const handleDeleteLayout = (layoutId: string) => {
    setLayouts(layouts.filter(l => l.id !== layoutId));
    setFavorites(favorites.filter(id => id !== layoutId));
    toast.success("Đã xóa dashboard");
  };

  const handleDuplicateLayout = (layout: LayoutType) => {
    const duplicated: LayoutType = {
      ...layout,
      id: `layout_${Date.now()}`,
      name: `${layout.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setLayouts([...layouts, duplicated]);
    toast.success("Đã nhân bản dashboard");
  };

  const handleToggleFavorite = (layoutId: string) => {
    if (favorites.includes(layoutId)) {
      setFavorites(favorites.filter(id => id !== layoutId));
    } else {
      setFavorites([...favorites, layoutId]);
    }
  };

  const handleSaveLayout = (layout: LayoutType) => {
    setLayouts(layouts.map(l => l.id === layout.id ? { ...layout, updatedAt: new Date() } : l));
    setIsEditing(false);
    setEditingLayout(null);
    toast.success("Đã lưu dashboard");
  };

  if (isEditing && editingLayout) {
    return (
      <DashboardLayoutEditor
        layout={editingLayout}
        onSave={handleSaveLayout}
        onCancel={() => {
          setIsEditing(false);
          setEditingLayout(null);
        }}
      />
    );
  }

  // Layout list view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Custom Dashboard</h2>
          <p className="text-sm text-muted-foreground">
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
                <Label htmlFor="name">Tên Dashboard</Label>
                <Input
                  id="name"
                  placeholder="Ví dụ: Production Overview"
                  value={newLayoutName}
                  onChange={(e) => setNewLayoutName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea
                  id="description"
                  placeholder="Mô tả ngắn gọn về dashboard..."
                  value={newLayoutDesc}
                  onChange={(e) => setNewLayoutDesc(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Hủy
              </Button>
              <Button onClick={handleCreateLayout}>
                Tạo mới
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Tìm kiếm dashboard..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="my-layouts">Dashboard của tôi ({myLayouts.length})</TabsTrigger>
          <TabsTrigger value="shared">Được chia sẻ ({sharedLayouts.length})</TabsTrigger>
          <TabsTrigger value="favorites">Yêu thích ({favorites.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="my-layouts" className="space-y-4 mt-4">
          {myLayouts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <LayoutGrid className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Chưa có dashboard nào</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Tạo dashboard đầu tiên để bắt đầu tùy chỉnh
                </p>
                <Button onClick={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Tạo Dashboard
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myLayouts.map(layout => (
                <Card key={layout.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base">{layout.name}</CardTitle>
                        <CardDescription className="line-clamp-2 text-xs">
                          {layout.description}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
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
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <Clock className="w-3 h-3" />
                      <span>Cập nhật: {layout.updatedAt.toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      <Badge variant="secondary" className="text-xs">
                        {layout.widgets.length} widgets
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {layout.gridCols} cột
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleEditLayout(layout)}
                      >
                        <Edit className="w-3 h-3 mr-1" />
                        Chỉnh sửa
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicateLayout(layout)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteLayout(layout.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="shared" className="space-y-4 mt-4">
          {sharedLayouts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Share2 className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Chưa có dashboard được chia sẻ</h3>
                <p className="text-muted-foreground text-center">
                  Các dashboard được chia sẻ công khai sẽ hiển thị ở đây
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedLayouts.map(layout => (
                <Card key={layout.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base">{layout.name}</CardTitle>
                        <CardDescription className="line-clamp-2 text-xs">
                          {layout.description}
                        </CardDescription>
                      </div>
                      <Badge variant="default" className="text-xs">
                        <Globe className="w-3 h-3 mr-1" />
                        Public
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDuplicateLayout(layout)}
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Sao chép
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditLayout(layout)}
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="favorites" className="space-y-4 mt-4">
          {favoriteLayouts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Star className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Chưa có dashboard yêu thích</h3>
                <p className="text-muted-foreground text-center">
                  Đánh dấu sao để thêm dashboard vào danh sách yêu thích
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {favoriteLayouts.map(layout => (
                <Card key={layout.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base">{layout.name}</CardTitle>
                        <CardDescription className="line-clamp-2 text-xs">
                          {layout.description}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleFavorite(layout.id)}
                      >
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleEditLayout(layout)}
                      >
                        <Edit className="w-3 h-3 mr-1" />
                        Chỉnh sửa
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDuplicateLayout(layout)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
