import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { 
  Download, 
  Upload, 
  Archive, 
  History, 
  Settings,
  Building2,
  Factory,
  Package,
  Workflow,
  AlertTriangle,
  Users,
  Calendar,
  FileJson,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw
} from "lucide-react";

// Backup categories
const BACKUP_CATEGORIES = [
  {
    id: "corporate",
    name: "Corporate & Factory",
    description: "Cấu trúc tổ chức, nhà máy, workshop, dây chuyền",
    icon: Building2,
    tables: ["corporates", "factories", "workshops", "productionLines", "lineStages", "workstations"],
  },
  {
    id: "products",
    name: "Sản phẩm & Mapping",
    description: "Model sản phẩm, category, measurement points, machine mapping",
    icon: Package,
    tables: ["productModels", "productCategories", "measurementPointDefs", "productMachineMappings"],
  },
  {
    id: "processes",
    name: "Quy trình sản xuất",
    description: "Công đoạn, quy trình, cấu hình ca làm việc",
    icon: Workflow,
    tables: ["processes", "shiftConfigs"],
  },
  {
    id: "alerts",
    name: "Cảnh báo & Rules",
    description: "Quy tắc cảnh báo MQTT, cấu hình thông báo",
    icon: AlertTriangle,
    tables: ["mqttAlertRules"],
  },
  {
    id: "users",
    name: "Người dùng & Phân quyền",
    description: "Tài khoản, vai trò, phân quyền truy cập",
    icon: Users,
    tables: ["users", "userAssignments"],
  },
  {
    id: "reports",
    name: "Báo cáo định kỳ",
    description: "Lịch gửi báo cáo, cấu hình SMTP",
    icon: Calendar,
    tables: ["scheduledReports", "smtpConfig"],
  },
];

interface BackupHistory {
  id: number;
  name: string;
  description: string;
  categories: string[];
  createdAt: Date;
  createdBy: string;
  size: string;
  status: "success" | "failed" | "pending";
}

export default function BackupRestore() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [backupName, setBackupName] = useState("");
  const [backupDescription, setBackupDescription] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [importPreview, setImportPreview] = useState<{
    categories: string[];
    recordCounts: Record<string, number>;
    createdAt: string;
    version: string;
  } | null>(null);

  // Mock backup history - in real implementation, this would come from API
  const [backupHistory] = useState<BackupHistory[]>([
    {
      id: 1,
      name: "Full System Backup",
      description: "Sao lưu toàn bộ cấu hình hệ thống",
      categories: ["corporate", "products", "processes", "alerts", "users", "reports"],
      createdAt: new Date(Date.now() - 86400000),
      createdBy: "admin",
      size: "2.5 MB",
      status: "success",
    },
    {
      id: 2,
      name: "Products Only",
      description: "Sao lưu cấu hình sản phẩm",
      categories: ["products"],
      createdAt: new Date(Date.now() - 172800000),
      createdBy: "admin",
      size: "512 KB",
      status: "success",
    },
  ]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev => 
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const selectAllCategories = () => {
    setSelectedCategories(BACKUP_CATEGORIES.map(c => c.id));
  };

  const deselectAllCategories = () => {
    setSelectedCategories([]);
  };

  const { data: exportData, refetch: fetchExportData } = trpc.system.exportConfig.useQuery(
    { categories: selectedCategories },
    { enabled: false }
  );

  const handleExport = async () => {
    if (selectedCategories.length === 0) {
      toast.error("Vui lòng chọn ít nhất một danh mục để sao lưu");
      return;
    }

    setIsExporting(true);
    try {
      const result = await fetchExportData();
      if (result.data) {
        const exportPayload = {
          version: "1.0",
          createdAt: new Date().toISOString(),
          name: backupName || `Backup_${new Date().toISOString().split('T')[0]}`,
          description: backupDescription,
          categories: selectedCategories,
          data: result.data,
        };

        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exportPayload.name.replace(/\s+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success("Đã xuất file backup thành công");
      }
    } catch (error) {
      toast.error("Lỗi khi xuất backup: " + (error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setImportData(content);
        
        const parsed = JSON.parse(content);
        setImportPreview({
          categories: parsed.categories || [],
          recordCounts: Object.fromEntries(
            Object.entries(parsed.data || {}).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.length : 0
            ])
          ),
          createdAt: parsed.createdAt || "Unknown",
          version: parsed.version || "Unknown",
        });
      } catch {
        toast.error("File không hợp lệ. Vui lòng chọn file JSON backup.");
        setImportData("");
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  };

  const importConfigMutation = trpc.system.importConfig.useMutation({
    onSuccess: (result) => {
      toast.success(`Đã khôi phục ${result.imported} bản ghi thành công`);
      setImportDialogOpen(false);
      setImportData("");
      setImportPreview(null);
    },
    onError: (error) => {
      toast.error("Lỗi khi khôi phục: " + error.message);
    },
  });

  const handleImport = () => {
    if (!importData) {
      toast.error("Vui lòng chọn file backup");
      return;
    }

    try {
      const parsed = JSON.parse(importData);
      importConfigMutation.mutate({
        data: parsed.data,
        categories: parsed.categories,
        overwrite: false,
      });
    } catch {
      toast.error("Dữ liệu backup không hợp lệ");
    }
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Không có quyền truy cập</h2>
            <p className="text-muted-foreground">
              Chỉ admin mới có thể truy cập tính năng Backup/Restore
            </p>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Archive className="h-6 w-6" />
              Backup & Restore
            </h1>
            <p className="text-muted-foreground mt-1">
              Sao lưu và khôi phục cấu hình hệ thống
            </p>
          </div>
        </div>

        <Tabs defaultValue="backup" className="space-y-6">
          <TabsList>
            <TabsTrigger value="backup" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Sao lưu
            </TabsTrigger>
            <TabsTrigger value="restore" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Khôi phục
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Lịch sử
            </TabsTrigger>
          </TabsList>

          {/* Backup Tab */}
          <TabsContent value="backup" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Cấu hình Backup
                </CardTitle>
                <CardDescription>
                  Chọn các danh mục cần sao lưu và nhập thông tin mô tả
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Backup info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="backupName">Tên backup</Label>
                    <Input
                      id="backupName"
                      value={backupName}
                      onChange={(e) => setBackupName(e.target.value)}
                      placeholder="VD: Full_Backup_2025_01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="backupDescription">Mô tả</Label>
                    <Input
                      id="backupDescription"
                      value={backupDescription}
                      onChange={(e) => setBackupDescription(e.target.value)}
                      placeholder="Mô tả ngắn về backup..."
                    />
                  </div>
                </div>

                {/* Category selection */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Chọn danh mục</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAllCategories}>
                        Chọn tất cả
                      </Button>
                      <Button variant="outline" size="sm" onClick={deselectAllCategories}>
                        Bỏ chọn
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {BACKUP_CATEGORIES.map((category) => {
                      const Icon = category.icon;
                      const isSelected = selectedCategories.includes(category.id);
                      return (
                        <Card 
                          key={category.id}
                          className={`cursor-pointer transition-all ${
                            isSelected ? "border-primary bg-primary/5" : "hover:border-muted-foreground/50"
                          }`}
                          onClick={() => toggleCategory(category.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Checkbox 
                                checked={isSelected}
                                onCheckedChange={() => toggleCategory(category.id)}
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-medium">{category.name}</span>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {category.description}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {category.tables.length} bảng
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                {/* Export button */}
                <div className="flex justify-end">
                  <Button 
                    onClick={handleExport} 
                    disabled={isExporting || selectedCategories.length === 0}
                    className="min-w-[150px]"
                  >
                    {isExporting ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Đang xuất...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Xuất Backup
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Restore Tab */}
          <TabsContent value="restore" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Khôi phục từ Backup
                </CardTitle>
                <CardDescription>
                  Tải lên file backup JSON để khôi phục cấu hình hệ thống
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* File upload */}
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <FileJson className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground mb-4">
                      Kéo thả file backup hoặc click để chọn file
                    </p>
                    <Input
                      type="file"
                      accept=".json"
                      onChange={handleImportFileChange}
                      className="max-w-xs mx-auto"
                    />
                  </div>

                  {/* Preview */}
                  {importPreview && (
                    <Card className="bg-muted/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Preview Backup</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Version:</span>
                            <span className="ml-2 font-medium">{importPreview.version}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Ngày tạo:</span>
                            <span className="ml-2 font-medium">
                              {new Date(importPreview.createdAt).toLocaleString("vi-VN")}
                            </span>
                          </div>
                        </div>
                        
                        <div>
                          <span className="text-sm text-muted-foreground">Danh mục:</span>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {importPreview.categories.map((cat) => (
                              <Badge key={cat} variant="secondary">{cat}</Badge>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="text-sm text-muted-foreground">Số bản ghi:</span>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                            {Object.entries(importPreview.recordCounts).map(([table, count]) => (
                              <div key={table} className="text-sm">
                                <span className="text-muted-foreground">{table}:</span>
                                <span className="ml-1 font-medium">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end pt-4">
                          <Button 
                            onClick={handleImport}
                            disabled={importConfigMutation.isPending}
                          >
                            {importConfigMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                Đang khôi phục...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4 mr-2" />
                                Khôi phục
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Lịch sử Backup
                </CardTitle>
                <CardDescription>
                  Xem lịch sử các lần sao lưu trước đó
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {backupHistory.map((backup) => (
                    <Card key={backup.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{backup.name}</span>
                            {backup.status === "success" && (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            )}
                            {backup.status === "failed" && (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            {backup.status === "pending" && (
                              <Clock className="h-4 w-4 text-yellow-500" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{backup.description}</p>
                          <div className="flex flex-wrap gap-2">
                            {backup.categories.map((cat) => (
                              <Badge key={cat} variant="outline" className="text-xs">
                                {cat}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Bởi: {backup.createdBy}</span>
                            <span>Kích thước: {backup.size}</span>
                            <span>{backup.createdAt.toLocaleString("vi-VN")}</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-1" />
                          Tải về
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
