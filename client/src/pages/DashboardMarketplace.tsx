import { useState } from 'react';
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
import { toast } from 'sonner';
import {
  Search, Download, Star, Eye, Upload, Grid3X3, LayoutDashboard,
  TrendingUp, Users, Clock, CheckCircle, Filter, Heart, Share2,
  BarChart3, PieChart, Activity, Gauge, Table2, Bell
} from 'lucide-react';

const CATEGORIES = [
  { value: 'all', label: 'Tất cả' },
  { value: 'production', label: 'Sản xuất' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'maintenance', label: 'Bảo trì' },
  { value: 'analytics', label: 'Phân tích' },
  { value: 'oee', label: 'OEE' },
  { value: 'custom', label: 'Tùy chỉnh' },
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

export default function DashboardMarketplace() {
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
    toast.success(`Đã tải template "${template.name}" thành công!`);
    setSelectedTemplate(null);
  };

  const handlePublish = () => {
    if (!publishForm.name.trim()) {
      toast.error('Vui lòng nhập tên template');
      return;
    }
    toast.success('Template đã được gửi để xét duyệt!');
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
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Grid3X3 className="h-6 w-6" />
              Dashboard Marketplace
            </h1>
            <p className="text-muted-foreground">
              Khám phá và tải các dashboard templates từ cộng đồng
            </p>
          </div>
          <Button onClick={() => setShowPublishDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Chia sẻ Template
          </Button>
        </div>

        {/* Featured Templates */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-400" />
              Templates nổi bật
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
                      <Badge variant="secondary">{CATEGORIES.find(c => c.value === template.category)?.label}</Badge>
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        <Star className="h-3 w-3 mr-1 fill-current" />
                        Nổi bật
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
              placeholder="Tìm kiếm templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Danh mục" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sắp xếp" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Phổ biến nhất</SelectItem>
              <SelectItem value="rating">Đánh giá cao</SelectItem>
              <SelectItem value="newest">Mới nhất</SelectItem>
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
                    {CATEGORIES.find(c => c.value === template.category)?.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    bởi {template.author}
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
            <h3 className="text-lg font-medium mb-2">Không tìm thấy template</h3>
            <p className="text-muted-foreground">
              Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm
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
                        bởi {selectedTemplate.author}
                      </DialogDescription>
                    </div>
                    <Badge variant="secondary">
                      {CATEGORIES.find(c => c.value === selectedTemplate.category)?.label}
                    </Badge>
                  </div>
                </DialogHeader>

                <div className="space-y-4">
                  <p className="text-muted-foreground">{selectedTemplate.description}</p>

                  <div className="grid grid-cols-3 gap-4">
                    <Card className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold">{selectedTemplate.rating}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{selectedTemplate.reviewCount} đánh giá</p>
                    </Card>
                    <Card className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1 mb-1">
                        <Download className="h-4 w-4" />
                        <span className="font-bold">{selectedTemplate.downloadCount}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">lượt tải</p>
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
                    <h4 className="font-medium mb-2">Widgets bao gồm:</h4>
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
                    Đóng
                  </Button>
                  <Button variant="outline">
                    <Eye className="h-4 w-4 mr-2" />
                    Xem trước
                  </Button>
                  <Button onClick={() => handleDownload(selectedTemplate)}>
                    <Download className="h-4 w-4 mr-2" />
                    Tải về
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
              <DialogTitle>Chia sẻ Dashboard Template</DialogTitle>
              <DialogDescription>
                Chia sẻ dashboard của bạn với cộng đồng
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Tên template</Label>
                <Input
                  placeholder="Nhập tên template..."
                  value={publishForm.name}
                  onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Mô tả</Label>
                <Textarea
                  placeholder="Mô tả về template của bạn..."
                  value={publishForm.description}
                  onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Danh mục</Label>
                <Select
                  value={publishForm.category}
                  onValueChange={(value) => setPublishForm({ ...publishForm, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn danh mục" />
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
                Hủy
              </Button>
              <Button onClick={handlePublish}>
                <Share2 className="h-4 w-4 mr-2" />
                Gửi xét duyệt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
