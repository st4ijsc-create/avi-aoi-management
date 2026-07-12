import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageContainer, PageHeader } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Search,
  Shield,
  BarChart3,
  Factory,
  Radio,
  History,
  Brain,
  FileText,
  Settings,
  HelpCircle,
  ChevronRight,
} from "lucide-react";

type GuideTopic = {
  title: string;
  content: string[];
  bullets?: string[];
};

type GuideSection = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  topics: GuideTopic[];
};

const sections: GuideSection[] = [
  {
    id: "overview",
    title: "1. Giới thiệu",
    description: "Tổng quan hệ thống MES SYNAPSE và cấu trúc menu chính",
    icon: <BookOpen className="h-5 w-5" />,
    topics: [
      {
        title: "Mục tiêu hệ thống",
        content: [
          "Hệ thống MES SYNAPSE dùng để giám sát và quản lý quy trình kiểm tra chất lượng theo thời gian thực, từ cấp tập đoàn đến từng máy.",
          "Người dùng có thể theo dõi KPI sản xuất, lịch sử kiểm tra, trạng thái thiết bị, cảnh báo chất lượng và toàn bộ vòng đời dữ liệu liên quan.",
        ],
      },
      {
        title: "Tính năng chính",
        content: [
          "Dashboard realtime hiển thị Total Output, FPY, Yield Rate, OK/NG/NTF và các cảnh báo theo ngưỡng.",
          "Theo dõi trạng thái online/offline/error của máy, xem lịch sử kiểm tra kèm ảnh và dữ liệu đo.",
          "Hỗ trợ cảnh báo tự động, báo cáo định kỳ, phân tích SPC, root cause và quản trị phân quyền người dùng.",
        ],
      },
      {
        title: "Nhóm chức năng",
        content: ["Hệ thống được tổ chức theo các nhóm menu chính dưới đây:"],
        bullets: [
          "Dashboard: Tổng quan, Drill-down, Dashboard Center",
          "Giám sát: Monitoring Settings, MQTT, Device Management",
          "Cảnh báo: Alert rules, lịch sử cảnh báo, predictive alerts",
          "Sản xuất: Production orders, lịch sử sản xuất, quản lý công đoạn",
          "Phân tích: Defect heatmap, SPC, root cause, dự đoán lỗi",
          "Dữ liệu: Cấu trúc dữ liệu nền, layout, import/export, backup",
          "Cài đặt: Cấu hình hệ thống, ngưỡng cảnh báo, OEE targets",
          "Quản trị: Users, roles/permissions, audit logs, sessions",
        ],
      },
    ],
  },
  {
    id: "security",
    title: "2. Đăng nhập và bảo mật",
    description: "Đăng nhập, 2FA, đổi mật khẩu và nguyên tắc bảo mật tài khoản",
    icon: <Shield className="h-5 w-5" />,
    topics: [
      {
        title: "Đăng nhập hệ thống",
        content: [
          "Người dùng đăng nhập bằng tài khoản được cấp. Nếu tài khoản bật xác thực 2 lớp, hệ thống yêu cầu mã OTP.",
        ],
      },
      {
        title: "Bật 2FA",
        content: ["Thực hiện theo luồng: Profile → Bảo mật → Bật 2FA → quét QR bằng Authenticator → nhập OTP xác nhận."],
      },
      {
        title: "Đổi mật khẩu",
        content: [
          "Thực hiện tại Profile → Đổi mật khẩu.",
          "Mật khẩu nên có tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "3. Dashboard chính",
    description: "Theo dõi KPI, cảnh báo yield, trạng thái kết nối và các tab phân tích nhanh",
    icon: <BarChart3 className="h-5 w-5" />,
    topics: [
      {
        title: "KPI cards",
        content: ["Dashboard hiển thị các KPI cốt lõi của dây chuyền và chất lượng."],
        bullets: [
          "Total Output: Tổng số sản phẩm đã kiểm tra",
          "OK Count / NG Count / NTF Count: Kết quả phân loại",
          "FPY = OK / (OK + NG)",
          "Yield Rate = (OK + NTF) / Total",
        ],
      },
      {
        title: "Cảnh báo yield và trạng thái máy",
        content: [
          "Phần cảnh báo hiển thị máy có yield thấp hơn ngưỡng Warning/Critical.",
          "Trạng thái kết nối thể hiện online, offline hoặc error để hỗ trợ xử lý nhanh.",
        ],
      },
      {
        title: "Các tab bổ sung",
        content: ["Tab tổng quan, NG visual và layout dây chuyền giúp phân tích nhanh theo nhiều góc nhìn."],
      },
    ],
  },
  {
    id: "corporate",
    title: "4. Quản lý tập đoàn",
    description: "Theo dõi hiệu suất nhiều nhà máy theo cấu trúc tập đoàn",
    icon: <Factory className="h-5 w-5" />,
    topics: [
      {
        title: "Corporate Dashboard",
        content: [
          "Dành cho quản lý cấp cao, cung cấp góc nhìn toàn cảnh theo cấp tập đoàn, công ty và nhà máy.",
        ],
      },
      {
        title: "So sánh hiệu suất",
        content: ["Hỗ trợ so sánh output, yield, OEE, downtime giữa các nhà máy/dây chuyền."],
      },
      {
        title: "Drill-down chi tiết",
        content: [
          "Có thể đi từ cấp tập đoàn đến công ty, nhà máy, dây chuyền và máy để phân tích nguyên nhân tại điểm phát sinh.",
        ],
      },
    ],
  },
  {
    id: "monitoring",
    title: "5. Giám sát máy",
    description: "Giám sát MQTT, trạng thái thiết bị, layout 2D/3D và quản lý kết nối",
    icon: <Radio className="h-5 w-5" />,
    topics: [
      {
        title: "MQTT Monitor",
        content: [
          "Live Stream theo dõi message realtime; History xem lại dữ liệu theo thời gian/topic; Auto-Discovery phát hiện máy mới.",
        ],
      },
      {
        title: "Device Management",
        content: [
          "Quản lý ánh xạ và đăng ký thiết bị trong Monitoring Settings → Device Management.",
          "Bao gồm cả manual registration và cơ chế auto registration legacy để tương thích hạ tầng cũ.",
        ],
      },
      {
        title: "Machine Status và Layout",
        content: [
          "Xem tình trạng heartbeat, thông số máy (nếu có) và vị trí máy trên layout để xử lý sự cố tại hiện trường.",
        ],
      },
    ],
  },
  {
    id: "history",
    title: "6. Lịch sử kiểm tra",
    description: "Tra cứu bản ghi kiểm tra, xem chi tiết và thao tác hàng loạt",
    icon: <History className="h-5 w-5" />,
    topics: [
      {
        title: "Bộ lọc tìm kiếm",
        content: [
          "Lọc theo serial, model, machine, kết quả (OK/NG/NTF), thời gian và các thuộc tính nghiệp vụ khác.",
        ],
      },
      {
        title: "Chi tiết bản ghi",
        content: ["Hiển thị ảnh, kết quả đo và annotation để truy vết đầy đủ một inspection record."],
      },
      {
        title: "Bulk operations và NTF",
        content: [
          "Hỗ trợ export/acknowledge hàng loạt và xác nhận NTF cho false positive có nhập lý do để audit.",
        ],
      },
    ],
  },
  {
    id: "quality",
    title: "7. Phân tích chất lượng",
    description: "Phân tích lỗi bằng heatmap, SPC, root cause và dự đoán",
    icon: <Brain className="h-5 w-5" />,
    topics: [
      {
        title: "Defect Heatmap",
        content: ["Hiển thị vùng lỗi tập trung để nhận diện nhanh điểm nóng cần can thiệp."],
      },
      {
        title: "Root Cause & Prediction",
        content: [
          "Kết hợp phân tích Pareto/AI để đề xuất nguyên nhân và xu hướng lỗi tương lai.",
        ],
      },
      {
        title: "SPC Analysis",
        content: ["Cung cấp control charts, capability và process performance để kiểm soát ổn định quá trình."],
      },
    ],
  },
  {
    id: "reports",
    title: "8. Báo cáo",
    description: "Báo cáo tức thì, báo cáo tự động và lịch xuất dữ liệu",
    icon: <FileText className="h-5 w-5" />,
    topics: [
      {
        title: "Báo cáo tức thì",
        content: ["Tạo nhanh báo cáo Production Summary, Quality Analysis, Machine Performance, OEE."],
      },
      {
        title: "Scheduled Reports",
        content: [
          "Lên lịch gửi báo cáo định kỳ (daily/weekly/monthly), cấu hình người nhận email và phạm vi dữ liệu.",
        ],
      },
      {
        title: "Export Scheduling",
        content: ["Lên lịch xuất lịch sử dưới dạng CSV/Excel/JSON và gửi tự động theo lịch."],
      },
    ],
  },
  {
    id: "system",
    title: "9. Cài đặt hệ thống",
    description: "Cấu hình hệ thống, ngưỡng cảnh báo, ca làm việc và OEE targets",
    icon: <Settings className="h-5 w-5" />,
    topics: [
      {
        title: "System Configuration",
        content: [
          "Quản trị tham số toàn hệ thống như tên hệ thống, timezone, ngôn ngữ, các cấu hình kỹ thuật.",
        ],
      },
      {
        title: "Yield alert thresholds",
        content: ["Thiết lập mức Warning/Critical cho FPY, Yield Rate, UPH và các chỉ số theo nhà máy/dây chuyền."],
      },
      {
        title: "Shift Configuration & OEE Targets",
        content: [
          "Khai báo ca làm việc theo phạm vi áp dụng và thiết lập target OEE (Availability, Performance, Quality, Overall).",
        ],
      },
    ],
  },
];

const faq = [
  {
    q: "Làm sao để thêm máy mới vào hệ thống?",
    a: "Vào Monitoring Settings hoặc Data Settings theo quyền được cấp, tạo máy mới và cấu hình API key tương ứng trên máy AVI/AOI.",
  },
  {
    q: "Tại sao Yield Rate khác FPY?",
    a: "FPY chỉ tính OK/(OK+NG), còn Yield Rate tính (OK+NTF)/Total nên bao gồm các trường hợp false positive đã xác nhận.",
  },
  {
    q: "Làm sao để xuất dữ liệu Excel?",
    a: "Vào History hoặc Reports, lọc dữ liệu cần xuất, chọn chức năng Export và định dạng Excel.",
  },
  {
    q: "Nên dùng WebSocket hay Polling?",
    a: "WebSocket phù hợp giám sát realtime; Polling tiết kiệm tài nguyên hơn khi chỉ cần theo dõi tổng quan theo chu kỳ.",
  },
  {
    q: "Backup dữ liệu ở đâu?",
    a: "Sử dụng Backup & Restore để tạo backup thủ công hoặc cấu hình lịch backup tự động.",
  },
];

export default function UserGuide() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState(sections[0].id);

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections;
    const q = search.toLowerCase();
    return sections.filter((section) => {
      const baseMatch = `${section.title} ${section.description}`.toLowerCase().includes(q);
      const topicMatch = section.topics.some((topic) => {
        const text = `${topic.title} ${topic.content.join(" ")} ${(topic.bullets || []).join(" ")}`.toLowerCase();
        return text.includes(q);
      });
      return baseMatch || topicMatch;
    });
  }, [search]);

  const visibleSections = filteredSections.length > 0 ? filteredSections : sections;
  const currentSection = visibleSections.find((s) => s.id === activeSection) || visibleSections[0];

  return (
    <DashboardLayout title={t("userGuide.layoutTitle", "User guide")} navItems={navItems} currentPath="/user-guide">
      <PageContainer>
        <PageHeader
          icon={<BookOpen className="h-6 w-6" />}
          title={t("userGuide.title", "MES SYNAPSE system user guide")}
          description={t(
            "userGuide.subtitle",
            "Fully aligned with the system docs: sign-in, operation, monitoring, analysis, reporting and administration.",
          )}
          badge={
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary">{t("userGuide.version", "Version 1.0.0")}</Badge>
              <Badge variant="outline">{t("userGuide.updated", "Updated: 26/01/2026")}</Badge>
            </div>
          }
          actions={
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("userGuide.searchPlaceholder", "Search by feature, workflow or keyword...")}
                className="pl-10"
              />
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Card className="lg:col-span-1 h-fit">
            <CardHeader>
              <CardTitle>{t("userGuide.tableOfContents", "Contents")}</CardTitle>
              <CardDescription>
                {t("userGuide.sectionCount", "{{count}} guide sections", { count: visibleSections.length })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {visibleSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                    currentSection.id === section.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {section.icon}
                  <span className="flex-1">{section.title}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    {currentSection.icon}
                  </div>
                  <div>
                    <CardTitle>{currentSection.title}</CardTitle>
                    <CardDescription>{currentSection.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" defaultValue={currentSection.topics.map((_, idx) => `topic-${idx}`)}>
                  {currentSection.topics.map((topic, idx) => (
                    <AccordionItem key={topic.title} value={`topic-${idx}`}>
                      <AccordionTrigger className="text-left">{topic.title}</AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        {topic.content.map((paragraph, i) => (
                          <p key={i} className="text-sm text-muted-foreground leading-6">
                            {paragraph}
                          </p>
                        ))}
                        {topic.bullets && topic.bullets.length > 0 && (
                          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                            {topic.bullets.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5" />
                  {t("userGuide.faqTitle", "10. FAQ")}
                </CardTitle>
                <CardDescription>{t("userGuide.faqDescription", "Frequently asked questions when operating the system")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible>
                  {faq.map((item, idx) => (
                    <AccordionItem key={item.q} value={`faq-${idx}`}>
                      <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground leading-6">
                        {item.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
