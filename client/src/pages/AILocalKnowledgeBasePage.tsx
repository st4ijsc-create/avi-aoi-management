import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { MessageCircle, ArrowLeft, Smile, Globe, Zap } from "lucide-react";
import { AILocalKnowledgeBase } from "@/components/AILocalKnowledgeBase";

export default function AILocalKnowledgeBasePage() {
  const [, setLocation] = useLocation();

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/ai-hub")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <MessageCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Trợ lý Hỗ trợ Thông minh
            </h1>
            <p className="text-sm text-muted-foreground">
              Hỏi đáp nhanh về hệ thống quản lý nhà máy — bằng tiếng Việt hoặc tiếng Anh
            </p>
          </div>
        </div>

        {/* Benefit Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Smile className="size-4 text-primary" />
                Dễ sử dụng
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Không cần kiến thức kỹ thuật. Chỉ cần hỏi như nói chuyện bình thường.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="size-4 text-primary" />
                Hỏi bằng tiếng Việt
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Hỗ trợ đầy đủ tiếng Việt và tiếng Anh, tự động nhận diện ngôn ngữ.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                Trả lời tức thì
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              AI tìm kiếm trong toàn bộ tài liệu hệ thống và trả lời ngay lập tức.
            </CardContent>
          </Card>
        </div>

        {/* Main Component */}
        <AILocalKnowledgeBase />

        {/* Help Section */}
        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-base">Bạn có thể hỏi về...</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc list-inside space-y-1.5">
              <li>Cách xem báo cáo lỗi và kết quả kiểm tra AOI</li>
              <li>Cách thêm hoặc chỉnh sửa sản phẩm, chương trình kiểm tra</li>
              <li>Hướng dẫn cài đặt thông số máy và vùng kiểm tra</li>
              <li>Cách xuất dữ liệu và in báo cáo</li>
              <li>Cài đặt cảnh báo và thông báo tự động</li>
              <li>Quản lý người dùng và phân quyền</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

