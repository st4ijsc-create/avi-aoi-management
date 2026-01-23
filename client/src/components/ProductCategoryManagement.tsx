import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  FolderTree, 
  Loader2,
  ChevronRight,
  ChevronDown,
  Package,
  Palette
} from "lucide-react";

// Color options for categories
const colorOptions = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#10b981", label: "Green" },
  { value: "#f59e0b", label: "Orange" },
  { value: "#ef4444", label: "Red" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#84cc16", label: "Lime" },
];

// Icon options
const iconOptions = [
  { value: "Package", label: "Package" },
  { value: "Box", label: "Box" },
  { value: "Cpu", label: "CPU" },
  { value: "Monitor", label: "Monitor" },
  { value: "Smartphone", label: "Smartphone" },
  { value: "HardDrive", label: "Hard Drive" },
  { value: "Zap", label: "Zap" },
  { value: "Settings", label: "Settings" },
];

type CategoryWithChildren = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  parentId: number | null;
  color: string | null;
  icon: string | null;
  orderIndex: number;
  productCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: CategoryWithChildren[];
};

export function ProductCategoryManagement() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithChildren | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  
  // Form state
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    parentId: null as number | null,
    color: "#3b82f6",
    icon: "Package",
  });

  // Queries
  const { data: categories, isLoading, refetch } = trpc.productCategory.list.useQuery({});
  const { data: categoryTree } = trpc.productCategory.getTree.useQuery();

  // Mutations
  const createMutation = trpc.productCategory.create.useMutation({
    onSuccess: () => {
      toast.success("Đã tạo danh mục thành công");
      setIsDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể tạo danh mục");
    },
  });

  const updateMutation = trpc.productCategory.update.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật danh mục thành công");
      setIsDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể cập nhật danh mục");
    },
  });

  const deleteMutation = trpc.productCategory.delete.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa danh mục thành công");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa danh mục");
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      parentId: null,
      color: "#3b82f6",
      icon: "Package",
    });
    setEditingCategory(null);
  };

  const handleOpenDialog = (category?: CategoryWithChildren) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        code: category.code,
        name: category.name,
        description: category.description || "",
        parentId: category.parentId,
        color: category.color || "#3b82f6",
        icon: category.icon || "Package",
      });
    } else {
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.code || !formData.name) {
      toast.error("Vui lòng nhập mã và tên danh mục");
      return;
    }

    if (editingCategory) {
      updateMutation.mutate({
        id: editingCategory.id,
        ...formData,
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (category: CategoryWithChildren) => {
    if (category.productCount > 0) {
      toast.error("Không thể xóa danh mục có sản phẩm");
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa danh mục "${category.name}"?`)) {
      deleteMutation.mutate({ id: category.id });
    }
  };

  const toggleExpand = (categoryId: number) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const renderCategoryRow = (category: CategoryWithChildren, level: number = 0): React.ReactNode => {
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category.id);

    return (
      <>
        <TableRow key={category.id} className="hover:bg-muted/50">
          <TableCell>
            <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 24}px` }}>
              {hasChildren ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => toggleExpand(category.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <div className="w-6" />
              )}
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: category.color || "#3b82f6" }}
              />
              <span className="font-mono text-sm">{category.code}</span>
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{category.name}</span>
            </div>
          </TableCell>
          <TableCell>
            <span className="text-muted-foreground text-sm line-clamp-1">
              {category.description || "-"}
            </span>
          </TableCell>
          <TableCell>
            <Badge variant="secondary">{category.productCount}</Badge>
          </TableCell>
          <TableCell>
            <Badge variant={category.isActive ? "default" : "outline"}>
              {category.isActive ? "Hoạt động" : "Tạm dừng"}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleOpenDialog(category)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(category)}
                disabled={category.productCount > 0}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {hasChildren && isExpanded && category.children.map(child => 
          renderCategoryRow(child, level + 1)
        )}
      </>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Get root categories for tree view
  const rootCategories = categoryTree || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="h-5 w-5" />
                Quản lý danh mục sản phẩm
              </CardTitle>
              <CardDescription>
                Tạo và quản lý cấu trúc phân cấp danh mục sản phẩm
              </CardDescription>
            </div>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Thêm danh mục
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rootCategories.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderTree className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Chưa có danh mục nào</p>
              <p className="text-sm">Bắt đầu bằng cách tạo danh mục đầu tiên</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Mã</TableHead>
                  <TableHead>Tên danh mục</TableHead>
                  <TableHead>Mô tả</TableHead>
                  <TableHead className="w-[100px]">Sản phẩm</TableHead>
                  <TableHead className="w-[100px]">Trạng thái</TableHead>
                  <TableHead className="w-[100px]">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rootCategories.map(category => renderCategoryRow(category as CategoryWithChildren))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Chỉnh sửa danh mục" : "Thêm danh mục mới"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Cập nhật thông tin danh mục sản phẩm"
                : "Tạo danh mục mới để phân loại sản phẩm"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Mã danh mục *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="VD: ELEC-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Tên danh mục *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="VD: Linh kiện điện tử"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Mô tả</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Mô tả chi tiết về danh mục..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Danh mục cha</Label>
              <Select
                value={formData.parentId?.toString() || "none"}
                onValueChange={(value) => 
                  setFormData({ ...formData, parentId: value === "none" ? null : parseInt(value) })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục cha (tùy chọn)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Không có (danh mục gốc)</SelectItem>
                  {categories?.filter(c => c.id !== editingCategory?.id).map((cat) => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Màu sắc
                </Label>
                <Select
                  value={formData.color}
                  onValueChange={(value) => setFormData({ ...formData, color: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map((color) => (
                      <SelectItem key={color.value} value={color.value}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: color.value }}
                          />
                          {color.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Icon</Label>
                <Select
                  value={formData.icon}
                  onValueChange={(value) => setFormData({ ...formData, icon: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {iconOptions.map((icon) => (
                      <SelectItem key={icon.value} value={icon.value}>
                        {icon.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingCategory ? "Cập nhật" : "Tạo mới"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
