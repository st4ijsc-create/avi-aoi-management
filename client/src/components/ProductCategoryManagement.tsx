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
  Palette,
  Download,
  Upload,
  FileJson,
  AlertCircle,
  CheckCircle2
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

// Type for import preview
type ImportPreview = {
  toCreate: { code: string; name: string; parentCode?: string }[];
  toUpdate: { code: string; name: string; changes: string[] }[];
  errors: string[];
};

export function ProductCategoryManagement() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithChildren | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  
  // Import/Export state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  
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

  // Export all categories to JSON
  const handleExportAll = () => {
    if (!categories || categories.length === 0) {
      toast.error("Không có danh mục nào để xuất");
      return;
    }

    const exportData = categories.map(cat => ({
      code: cat.code,
      name: cat.name,
      description: cat.description,
      parentCode: categories.find(p => p.id === cat.parentId)?.code || null,
      color: cat.color,
      icon: cat.icon,
      orderIndex: cat.orderIndex,
      isActive: cat.isActive,
    }));

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `product-categories-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${categories.length} danh mục`);
  };

  // Validate and preview import JSON
  const handlePreviewImport = () => {
    if (!importJsonText.trim()) {
      toast.error("Vui lòng nhập hoặc dán nội dung JSON");
      return;
    }

    try {
      const data = JSON.parse(importJsonText);
      
      if (!Array.isArray(data)) {
        toast.error("JSON phải là một mảng các danh mục");
        return;
      }

      const preview: ImportPreview = {
        toCreate: [],
        toUpdate: [],
        errors: [],
      };

      const existingCodes = new Set(categories?.map(c => c.code) || []);

      data.forEach((item: any, index: number) => {
        // Validate required fields
        if (!item.code || typeof item.code !== 'string') {
          preview.errors.push(`Dòng ${index + 1}: Thiếu hoặc sai định dạng mã (code)`);
          return;
        }
        if (!item.name || typeof item.name !== 'string') {
          preview.errors.push(`Dòng ${index + 1}: Thiếu hoặc sai định dạng tên (name)`);
          return;
        }

        // Check if category exists
        if (existingCodes.has(item.code)) {
          const existing = categories?.find(c => c.code === item.code);
          const changes: string[] = [];
          if (existing) {
            if (item.name !== existing.name) changes.push(`Tên: ${existing.name} → ${item.name}`);
            if (item.description !== existing.description) changes.push('Mô tả');
            if (item.color !== existing.color) changes.push('Màu sắc');
            if (item.icon !== existing.icon) changes.push('Icon');
          }
          if (changes.length > 0) {
            preview.toUpdate.push({ code: item.code, name: item.name, changes });
          }
        } else {
          preview.toCreate.push({
            code: item.code,
            name: item.name,
            parentCode: item.parentCode,
          });
        }
      });

      setImportPreview(preview);

      if (preview.errors.length > 0) {
        toast.error(`Có ${preview.errors.length} lỗi trong dữ liệu`);
      } else if (preview.toCreate.length === 0 && preview.toUpdate.length === 0) {
        toast.info("Không có thay đổi nào cần thực hiện");
      } else {
        toast.success(`Sẵn sàng: ${preview.toCreate.length} tạo mới, ${preview.toUpdate.length} cập nhật`);
      }
    } catch (e) {
      toast.error("JSON không hợp lệ. Vui lòng kiểm tra lại định dạng.");
      setImportPreview(null);
    }
  };

  // Execute import
  const handleExecuteImport = async () => {
    if (!importPreview || (importPreview.toCreate.length === 0 && importPreview.toUpdate.length === 0)) {
      return;
    }

    setIsImporting(true);
    try {
      const data = JSON.parse(importJsonText);
      let created = 0;
      let updated = 0;

      // Process in order to handle parent references
      for (const item of data) {
        const existingCategory = categories?.find(c => c.code === item.code);
        const parentCategory = item.parentCode ? categories?.find(c => c.code === item.parentCode) : null;

        if (existingCategory) {
          // Update existing
          await updateMutation.mutateAsync({
            id: existingCategory.id,
            code: item.code,
            name: item.name,
            description: item.description || "",
            parentId: parentCategory?.id || null,
            color: item.color || "#3b82f6",
            icon: item.icon || "Package",
          });
          updated++;
        } else {
          // Create new
          await createMutation.mutateAsync({
            code: item.code,
            name: item.name,
            description: item.description || "",
            parentId: parentCategory?.id || null,
            color: item.color || "#3b82f6",
            icon: item.icon || "Package",
          });
          created++;
        }
      }

      toast.success(`Import hoàn tất: ${created} tạo mới, ${updated} cập nhật`);
      setIsImportDialogOpen(false);
      setImportJsonText("");
      setImportPreview(null);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Lỗi khi import dữ liệu");
    } finally {
      setIsImporting(false);
    }
  };

  // Handle file upload for import
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      toast.error("Vui lòng chọn file JSON");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportJsonText(content);
      setImportPreview(null);
    };
    reader.readAsText(file);
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
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleExportAll} disabled={!categories || categories.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Xuất JSON
              </Button>
              <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Nhập JSON
              </Button>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Thêm danh mục
              </Button>
            </div>
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

      {/* Import Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
        setIsImportDialogOpen(open);
        if (!open) {
          setImportJsonText("");
          setImportPreview(null);
        }
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              Nhập danh mục từ JSON
            </DialogTitle>
            <DialogDescription>
              Tải lên file JSON hoặc dán nội dung JSON để nhập danh mục sản phẩm
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* File upload */}
            <div className="space-y-2">
              <Label>Tải file JSON</Label>
              <Input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="cursor-pointer"
              />
            </div>

            {/* Or paste JSON */}
            <div className="space-y-2">
              <Label>Hoặc dán nội dung JSON</Label>
              <Textarea
                value={importJsonText}
                onChange={(e) => {
                  setImportJsonText(e.target.value);
                  setImportPreview(null);
                }}
                placeholder='[{"code": "ELEC", "name": "Linh kiện điện tử", ...}]'
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            {/* Preview button */}
            <Button
              variant="outline"
              onClick={handlePreviewImport}
              disabled={!importJsonText.trim()}
              className="w-full"
            >
              Kiểm tra và xem trước
            </Button>

            {/* Preview results */}
            {importPreview && (
              <div className="space-y-3 border rounded-lg p-4">
                <h4 className="font-medium">Kết quả kiểm tra:</h4>
                
                {/* Errors */}
                {importPreview.errors.length > 0 && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-red-600 font-medium mb-2">
                      <AlertCircle className="h-4 w-4" />
                      <span>{importPreview.errors.length} lỗi</span>
                    </div>
                    <ul className="text-sm text-red-600/80 list-disc list-inside max-h-32 overflow-y-auto">
                      {importPreview.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* To Create */}
                {importPreview.toCreate.length > 0 && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-green-600 font-medium mb-2">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{importPreview.toCreate.length} danh mục mới</span>
                    </div>
                    <ul className="text-sm text-green-600/80 list-disc list-inside max-h-32 overflow-y-auto">
                      {importPreview.toCreate.map((item, i) => (
                        <li key={i}>
                          <span className="font-mono">{item.code}</span> - {item.name}
                          {item.parentCode && <span className="text-muted-foreground"> (cha: {item.parentCode})</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* To Update */}
                {importPreview.toUpdate.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-yellow-600 font-medium mb-2">
                      <Pencil className="h-4 w-4" />
                      <span>{importPreview.toUpdate.length} danh mục cập nhật</span>
                    </div>
                    <ul className="text-sm text-yellow-600/80 list-disc list-inside max-h-32 overflow-y-auto">
                      {importPreview.toUpdate.map((item, i) => (
                        <li key={i}>
                          <span className="font-mono">{item.code}</span> - {item.name}
                          <span className="text-muted-foreground"> ({item.changes.join(', ')})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              onClick={handleExecuteImport}
              disabled={
                isImporting ||
                !importPreview ||
                importPreview.errors.length > 0 ||
                (importPreview.toCreate.length === 0 && importPreview.toUpdate.length === 0)
              }
            >
              {isImporting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Thực hiện nhập
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
