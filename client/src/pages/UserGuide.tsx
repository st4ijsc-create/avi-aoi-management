import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Search,
  BarChart3,
  History,
  Settings,
  Bell,
  Package,
  Factory,
  Workflow,
  FileText,
  Video,
  HelpCircle,
  ChevronRight,
  ExternalLink,
  Play,
  Clock,
  Users,
  Shield,
  Database,
  Radio,
  Calendar,
  Brain,
  Upload,
  ClipboardList,
} from "lucide-react";

// Guide sections data
const guideSections = [
  {
    id: "overview",
    title: "Tổng quan hệ thống",
    icon: <BookOpen className="h-5 w-5" />,
    description: "Giới thiệu về hệ thống AVI/AOI Management",
    content: [
      {
        title: "Giới thiệu",
        content: `Hệ thống AVI/AOI Management là giải pháp quản lý kiểm tra chất lượng tự động (Automated Visual Inspection / Automated Optical Inspection) cho nhà máy sản xuất. Hệ thống cho phép:

- Theo dõi real-time kết quả kiểm tra từ các máy AVI/AOI
- Quản lý sản phẩm, điểm đo và tiêu chuẩn chất lượng
- Phân tích SPC (Statistical Process Control) và AI
- Cảnh báo tự động khi phát hiện bất thường
- Báo cáo và thống kê đa chiều`,
      },
      {
        title: "Kiến trúc hệ thống",
        content: `Hệ thống được thiết kế theo kiến trúc phân tầng:

1. **Tầng thu thập dữ liệu**: Kết nối với máy AVI/AOI qua API và MQTT
2. **Tầng xử lý**: Xử lý dữ liệu, tính toán SPC, phân tích AI
3. **Tầng hiển thị**: Dashboard, báo cáo, cảnh báo real-time
4. **Tầng quản trị**: Quản lý người dùng, phân quyền, cấu hình`,
      },
      {
        title: "Luồng dữ liệu",
        content: `1. Máy AVI/AOI gửi kết quả kiểm tra qua API
2. Hệ thống lưu trữ và xử lý dữ liệu
3. Dashboard cập nhật real-time
4. Cảnh báo được kích hoạt nếu vượt ngưỡng
5. Dữ liệu được tổng hợp vào báo cáo`,
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard & Giám sát",
    icon: <BarChart3 className="h-5 w-5" />,
    description: "Hướng dẫn sử dụng Dashboard và các tính năng giám sát",
    content: [
      {
        title: "Dashboard chính",
        content: `Dashboard hiển thị tổng quan về hoạt động sản xuất:

- **Thống kê tổng quan**: Tổng sản lượng, OK/NG/NTF, Yield Rate
- **Biểu đồ xu hướng**: Theo dõi yield theo thời gian
- **Trạng thái máy**: Xem trạng thái hoạt động của từng máy
- **Cảnh báo gần đây**: Danh sách cảnh báo mới nhất

**Cách sử dụng**:
1. Chọn khoảng thời gian (Hôm nay, 7 ngày, 30 ngày)
2. Lọc theo nhà máy/workshop nếu cần
3. Click vào biểu đồ để xem chi tiết`,
      },
      {
        title: "Trạng thái máy",
        content: `Trang Trạng thái máy cho phép theo dõi real-time:

- **Online/Offline**: Trạng thái kết nối của máy
- **Đang chạy/Dừng**: Trạng thái hoạt động
- **Sản lượng**: Số lượng sản phẩm đã kiểm tra
- **Yield Rate**: Tỷ lệ đạt của từng máy

**Lưu ý**: Máy được coi là offline nếu không gửi heartbeat trong 5 phút`,
      },
      {
        title: "MQTT Monitor",
        content: `MQTT Monitor hiển thị dữ liệu real-time từ broker MQTT:

- Kết nối với broker MQTT nội bộ hoặc external
- Hiển thị messages theo topic
- Theo dõi trạng thái kết nối
- Debug và troubleshoot vấn đề kết nối`,
      },
      {
        title: "Custom Dashboard (Tùy chỉnh Dashboard)",
        content: `Hệ thống hỗ trợ tạo Dashboard tùy chỉnh với các widget linh hoạt:

**Các loại Widget có sẵn**:
- **Yield Rate**: Biểu đồ tỷ lệ đạt theo thời gian
- **Production Volume**: Thống kê sản lượng OK/NG/NTF
- **Machine Status**: Trạng thái máy real-time
- **Recent Alerts**: Danh sách cảnh báo gần đây
- **Top NG Points**: Pareto chart điểm lỗi
- **Throughput**: Biểu đồ năng suất theo giờ

**Cách tạo Dashboard mới**:
1. Vào trang Dashboard
2. Click biểu tượng cài đặt (Settings) ở góc trên
3. Chọn "Tạo Dashboard mới" hoặc "Sử dụng template"
4. Đặt tên và mô tả cho Dashboard

**Thêm Widget**:
1. Click nút "+ Thêm Widget"
2. Chọn loại widget từ danh sách
3. Cấu hình tiêu đề, bộ lọc, màu sắc
4. Click "Lưu" để thêm vào Dashboard

**Resize và di chuyển Widget**:
- **Kéo thả (Drag)**: Giữ chuột vào tiêu đề widget, kéo đến vị trí mới
- **Thay đổi kích thước**: Kéo góc dưới bên phải của widget
- **Xem toàn màn hình**: Click biểu tượng mở rộng trên widget

**Lưu và chia sẻ Template**:
1. Sau khi cấu hình xong, click "Lưu layout"
2. Chọn "Lưu làm template" để tái sử dụng
3. Bật "Chia sẻ" để người dùng khác có thể sử dụng

**Export Dashboard**:
- **JSON**: Xuất cấu hình để backup hoặc import lại
- **HTML**: Xuất dạng trang web tĩnh
- **PDF**: Xuất dạng báo cáo PDF

**Mẹo sử dụng**:
- Sử dụng preset themes để đồng bộ màu sắc
- Đặt auto-refresh để cập nhật dữ liệu tự động
- Sử dụng bộ lọc chung để áp dụng cho tất cả widgets`,
      },
    ],
  },
  {
    id: "production",
    title: "Quản lý sản xuất",
    icon: <ClipboardList className="h-5 w-5" />,
    description: "Hướng dẫn quản lý lệnh sản xuất và lịch sử kiểm tra",
    content: [
      {
        title: "Lệnh sản xuất",
        content: `Quản lý lệnh sản xuất (Production Orders):

**Tạo lệnh mới**:
1. Click "Thêm lệnh sản xuất"
2. Nhập mã lệnh, chọn sản phẩm
3. Nhập số lượng mục tiêu
4. Chọn dây chuyền sản xuất
5. Đặt ngày bắt đầu/kết thúc

**Gantt Chart**:
- Kéo thả để thay đổi lịch
- Xem capacity của từng dây chuyền
- Cảnh báo khi vượt quá capacity`,
      },
      {
        title: "Lịch sử kiểm tra",
        content: `Trang Lịch sử cho phép tra cứu kết quả kiểm tra:

**Tìm kiếm**:
- Theo Serial Number
- Theo nhà máy/workshop/dây chuyền
- Theo khoảng thời gian
- Theo kết quả (OK/NG/NTF)

**Xem chi tiết**:
- Click vào sản phẩm để xem chi tiết
- Xem hình ảnh thực tế vs tham chiếu
- Xem giá trị đo và tiêu chuẩn
- Sửa kết quả nếu cần (NTF)`,
      },
      {
        title: "Phân tích SPC",
        content: `Công cụ phân tích SPC (Statistical Process Control):

**Control Chart**:
- X-bar chart: Theo dõi giá trị trung bình
- R chart: Theo dõi độ biến động
- UCL/LCL: Giới hạn kiểm soát

**Histogram**: Phân bố giá trị đo

**Pareto Chart**: Phân tích nguyên nhân lỗi

**Cp/Cpk**: Chỉ số năng lực quá trình`,
      },
    ],
  },
  {
    id: "data-management",
    title: "Quản lý dữ liệu",
    icon: <Database className="h-5 w-5" />,
    description: "Hướng dẫn quản lý sản phẩm, điểm đo và cấu hình",
    content: [
      {
        title: "Quản lý sản phẩm",
        content: `Trang Sản phẩm cho phép quản lý mẫu sản phẩm:

**Tạo sản phẩm mới**:
1. Click "Thêm sản phẩm"
2. Nhập mã và tên sản phẩm
3. Upload hình ảnh tham chiếu
4. Chọn danh mục sản phẩm

**Quản lý điểm đo**:
1. Click vào sản phẩm để mở editor
2. Click trên hình để thêm điểm đo
3. Nhập tiêu chuẩn (Min/Max/Target)
4. Upload hình tham chiếu cho điểm đo`,
      },
      {
        title: "Gán sản phẩm cho máy",
        content: `Trang Gán sản phẩm cho phép mapping sản phẩm với máy:

1. Chọn máy cần gán
2. Chọn sản phẩm từ danh sách
3. Thiết lập thứ tự ưu tiên
4. Lưu cấu hình

**Lưu ý**: Một máy có thể kiểm tra nhiều sản phẩm`,
      },
      {
        title: "Layout nhà máy",
        content: `Trang Layout cho phép thiết kế sơ đồ nhà máy:

**2D Layout**:
- Kéo thả máy vào vị trí
- Xem trạng thái real-time trên layout
- Click máy để xem chi tiết

**3D Layout**:
- Xem nhà máy dạng 3D
- Xoay, zoom để quan sát
- Hiển thị metrics trên máy`,
      },
    ],
  },
  {
    id: "alerts",
    title: "Cảnh báo & Thông báo",
    icon: <Bell className="h-5 w-5" />,
    description: "Hướng dẫn cấu hình và quản lý cảnh báo",
    content: [
      {
        title: "Quy tắc cảnh báo",
        content: `Trang Quy tắc cảnh báo cho phép thiết lập cảnh báo tự động:

**Loại cảnh báo**:
- Yield thấp: Khi yield dưới ngưỡng
- NG liên tiếp: Khi có nhiều NG liên tiếp
- Máy offline: Khi máy mất kết nối
- Sản lượng thấp: Khi output dưới mục tiêu

**Cấu hình**:
1. Đặt tên quy tắc
2. Chọn loại cảnh báo
3. Thiết lập ngưỡng
4. Chọn kênh thông báo (Email, MQTT, Owner)
5. Đặt thời gian cooldown`,
      },
      {
        title: "Lịch sử cảnh báo",
        content: `Trang Cảnh báo hiển thị lịch sử các cảnh báo:

- Xem danh sách cảnh báo theo thời gian
- Lọc theo loại, mức độ nghiêm trọng
- Xem chi tiết và nguyên nhân
- Đánh dấu đã xử lý`,
      },
      {
        title: "Cảnh báo theo Category",
        content: `Thiết lập ngưỡng cảnh báo riêng cho từng danh mục sản phẩm:

1. Vào Quy tắc cảnh báo
2. Tạo quy tắc mới
3. Chọn Category áp dụng
4. Thiết lập ngưỡng phù hợp

**Ví dụ**: Category "Linh kiện điện tử" có thể có ngưỡng yield 98%, trong khi "Vỏ nhựa" là 95%`,
      },
    ],
  },
  {
    id: "reports",
    title: "Báo cáo & Thống kê",
    icon: <FileText className="h-5 w-5" />,
    description: "Hướng dẫn xem và xuất báo cáo",
    content: [
      {
        title: "Báo cáo tổng hợp",
        content: `Trang Báo cáo cung cấp các báo cáo tổng hợp:

- Báo cáo sản lượng theo ngày/tuần/tháng
- Báo cáo yield theo máy/dây chuyền
- Báo cáo lỗi theo loại
- So sánh hiệu suất giữa các nhà máy

**Xuất báo cáo**:
- Excel: Dữ liệu chi tiết
- PDF: Báo cáo định dạng
- CSV: Dữ liệu thô`,
      },
      {
        title: "Phân tích Category",
        content: `Trang Phân tích Category cung cấp:

- Biểu đồ sản lượng theo category
- So sánh yield giữa các category
- Xu hướng theo thời gian
- Bảng chi tiết với export CSV`,
      },
      {
        title: "Báo cáo định kỳ",
        content: `Cấu hình báo cáo tự động:

1. Vào Báo cáo định kỳ
2. Tạo lịch báo cáo mới
3. Chọn loại báo cáo
4. Đặt lịch (hàng ngày/tuần/tháng)
5. Nhập email nhận báo cáo

Báo cáo sẽ được gửi tự động theo lịch`,
      },
    ],
  },
  {
    id: "admin",
    title: "Quản trị hệ thống",
    icon: <Shield className="h-5 w-5" />,
    description: "Hướng dẫn quản trị và cấu hình hệ thống",
    content: [
      {
        title: "Quản lý người dùng",
        content: `Trang Người dùng cho phép quản lý tài khoản:

**Tạo người dùng**:
1. Click "Thêm người dùng"
2. Nhập thông tin (tên, email)
3. Chọn vai trò (Admin/User)
4. Gán quyền truy cập nhà máy

**Phân quyền**:
- Admin: Toàn quyền hệ thống
- User: Chỉ xem và thao tác cơ bản`,
      },
      {
        title: "Cài đặt hệ thống",
        content: `Trang Cài đặt cho phép cấu hình:

**Nhà máy & Workshop**:
- Thêm/sửa/xóa nhà máy
- Quản lý workshop, dây chuyền
- Cấu hình máy và API key

**SMTP & Email**:
- Cấu hình server email
- Test gửi email

**Cache & Performance**:
- Xóa cache
- Cấu hình TTL`,
      },
      {
        title: "API Documentation",
        content: `Trang API Docs cung cấp tài liệu tích hợp:

- Danh sách endpoints
- Mẫu request/response
- Hướng dẫn authentication
- Code samples

**Tích hợp máy AVI/AOI**:
1. Tạo API key cho máy
2. Cấu hình endpoint trên máy
3. Test kết nối
4. Bắt đầu gửi dữ liệu`,
      },
    ],
  },
];

// FAQ data
const faqItems = [
  {
    question: "Làm sao để kết nối máy AVI/AOI với hệ thống?",
    answer: "Vào Settings > Machines, tạo máy mới và lấy API key. Cấu hình API key này trên máy AVI/AOI và gọi API submit-inspection để gửi kết quả kiểm tra.",
  },
  {
    question: "Tại sao yield rate không cập nhật real-time?",
    answer: "Hệ thống sử dụng cache để tối ưu hiệu năng. Dữ liệu được cập nhật mỗi 30 giây. Bạn có thể click nút Refresh để cập nhật ngay.",
  },
  {
    question: "Làm sao để thiết lập cảnh báo khi yield thấp?",
    answer: "Vào Quy tắc cảnh báo > Thêm quy tắc > Chọn loại 'Yield thấp' > Nhập ngưỡng (ví dụ: 95%) > Chọn kênh thông báo > Lưu.",
  },
  {
    question: "Có thể xuất báo cáo tự động không?",
    answer: "Có. Vào Báo cáo định kỳ > Tạo lịch mới > Chọn loại báo cáo và tần suất > Nhập email nhận. Báo cáo sẽ được gửi tự động.",
  },
  {
    question: "Làm sao để sửa kết quả kiểm tra sai (NTF)?",
    answer: "Vào Lịch sử > Tìm sản phẩm > Click xem chi tiết > Click vào điểm đo cần sửa > Chọn 'Đánh dấu NTF' > Nhập lý do > Lưu.",
  },
  {
    question: "Hệ thống hỗ trợ bao nhiêu điểm đo trên một sản phẩm?",
    answer: "Hệ thống hỗ trợ tối đa 100 điểm đo trên một sản phẩm. Mỗi điểm đo có thể có hình ảnh tham chiếu riêng.",
  },
];

export default function UserGuide() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("overview");

  // Filter sections based on search
  const filteredSections = guideSections.filter(section =>
    section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    section.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    section.content.some(c => 
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  return (
    <DashboardLayout title="AVI/AOI Management" currentPath="/user-guide">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              Hướng dẫn sử dụng
            </h1>
            <p className="text-muted-foreground">
              Tài liệu hướng dẫn chi tiết cho hệ thống AVI/AOI Management
            </p>
          </div>

          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm trong hướng dẫn..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar - Table of Contents */}
          <Card className="lg:col-span-1 h-fit">
            <CardHeader>
              <CardTitle className="text-lg">Mục lục</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <nav className="space-y-1 p-4 pt-0">
                {guideSections.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      activeSection === section.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {section.icon}
                    <span>{section.title}</span>
                  </button>
                ))}
              </nav>
            </CardContent>
          </Card>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            <Tabs value={activeSection} onValueChange={setActiveSection}>
              <TabsList className="hidden">
                {guideSections.map(s => (
                  <TabsTrigger key={s.id} value={s.id}>{s.title}</TabsTrigger>
                ))}
              </TabsList>

              {guideSections.map(section => (
                <TabsContent key={section.id} value={section.id} className="space-y-4 mt-0">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                          {section.icon}
                        </div>
                        <div>
                          <CardTitle>{section.title}</CardTitle>
                          <CardDescription>{section.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="single" collapsible className="w-full">
                        {section.content.map((item, index) => (
                          <AccordionItem key={index} value={`item-${index}`}>
                            <AccordionTrigger className="text-left">
                              {item.title}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="prose prose-sm dark:prose-invert max-w-none">
                                {item.content.split('\n\n').map((para, i) => (
                                  <p key={i} className="whitespace-pre-wrap text-muted-foreground">
                                    {para}
                                  </p>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>

            {/* FAQ Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5" />
                  Câu hỏi thường gặp (FAQ)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {faqItems.map((faq, index) => (
                    <AccordionItem key={index} value={`faq-${index}`}>
                      <AccordionTrigger className="text-left">
                        {faq.question}
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="text-muted-foreground">{faq.answer}</p>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader>
                <CardTitle>Liên kết nhanh</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/api-docs">
                      <FileText className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">API Documentation</div>
                        <div className="text-xs text-muted-foreground">Tài liệu tích hợp API</div>
                      </div>
                    </a>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/settings">
                      <Settings className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">Cài đặt hệ thống</div>
                        <div className="text-xs text-muted-foreground">Cấu hình nhà máy, máy</div>
                      </div>
                    </a>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/mqtt-alerts">
                      <Bell className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">Quy tắc cảnh báo</div>
                        <div className="text-xs text-muted-foreground">Thiết lập cảnh báo tự động</div>
                      </div>
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
