import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { MessageCircle, ArrowLeft, Smile, Globe, Zap } from "lucide-react";
import { AILocalKnowledgeBase } from "@/components/AILocalKnowledgeBase";

export default function AILocalKnowledgeBasePage() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  return (
    <DashboardLayout>
      <PageContainer className="max-w-4xl">
        {/* Header */}
        <PageHeader
          icon={<MessageCircle className="h-6 w-6" />}
          title={t("aiKb.title", "Trợ lý Hỗ trợ Thông minh")}
          description={t("aiKb.subtitle", "Hỏi đáp nhanh về hệ thống quản lý nhà máy — bằng tiếng Việt hoặc tiếng Anh")}
          actions={
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-hub")}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              {t("common.back", "Quay lại")}
            </Button>
          }
        />

        {/* Benefit Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Smile className="size-4 text-primary" />
                {t("aiKb.benefitEasyTitle", "Dễ sử dụng")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("aiKb.benefitEasyDesc", "Không cần kiến thức kỹ thuật. Chỉ cần hỏi như nói chuyện bình thường.")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="size-4 text-primary" />
                {t("aiKb.benefitLangTitle", "Hỏi bằng tiếng Việt")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("aiKb.benefitLangDesc", "Hỗ trợ đầy đủ tiếng Việt và tiếng Anh, tự động nhận diện ngôn ngữ.")}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                {t("aiKb.benefitInstantTitle", "Trả lời tức thì")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t("aiKb.benefitInstantDesc", "AI tìm kiếm trong toàn bộ tài liệu hệ thống và trả lời ngay lập tức.")}
            </CardContent>
          </Card>
        </div>

        {/* Main Component */}
        <AILocalKnowledgeBase />

        {/* Help Section */}
        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-base">{t("aiKb.canAskTitle", "Bạn có thể hỏi về...")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc list-inside space-y-1.5">
              <li>{t("aiKb.canAsk1", "Cách xem báo cáo lỗi và kết quả kiểm tra AOI")}</li>
              <li>{t("aiKb.canAsk2", "Cách thêm hoặc chỉnh sửa sản phẩm, chương trình kiểm tra")}</li>
              <li>{t("aiKb.canAsk3", "Hướng dẫn cài đặt thông số máy và vùng kiểm tra")}</li>
              <li>{t("aiKb.canAsk4", "Cách xuất dữ liệu và in báo cáo")}</li>
              <li>{t("aiKb.canAsk5", "Cài đặt cảnh báo và thông báo tự động")}</li>
              <li>{t("aiKb.canAsk6", "Quản lý người dùng và phân quyền")}</li>
            </ul>
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}

