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
    title: "userGuide.overview.1GioiThieu",
    description: "userGuide.overview.tongQuanHeThongMes",
    icon: <BookOpen className="h-5 w-5" />,
    topics: [
      {
        title: "userGuide.overview.mucTieuHeThong",
        content: [
          "userGuide.overview.heThongMesSynapseDung",
          "userGuide.overview.nguoiDungCoTheTheo",
        ],
      },
      {
        title: "userGuide.overview.tinhNangChinh",
        content: [
          "userGuide.overview.dashboardRealtimeHienThiTotal",
          "userGuide.overview.theoDoiTrangThaiOnline",
          "userGuide.overview.hoTroCanhBaoTu",
        ],
      },
      {
        title: "userGuide.overview.nhomChucNang",
        content: ["userGuide.overview.heThongDuocToChuc"],
        bullets: [
          "userGuide.overview.dashboardTongQuanDrillDown",
          "userGuide.overview.giamSatMonitoringSettingsMqtt",
          "userGuide.overview.canhBaoAlertRulesLich",
          "userGuide.overview.sanXuatProductionOrdersLich",
          "userGuide.overview.phanTichDefectHeatmapSpc",
          "userGuide.overview.duLieuCauTrucDu",
          "userGuide.overview.caiDatCauHinhHe",
          "userGuide.overview.quanTriUsersRolesPermissions",
        ],
      },
    ],
  },
  {
    id: "security",
    title: "userGuide.security.2DangNhapVaBao",
    description: "userGuide.security.dangNhap2faDoiMat",
    icon: <Shield className="h-5 w-5" />,
    topics: [
      {
        title: "userGuide.security.dangNhapHeThong",
        content: [
          "userGuide.security.nguoiDungDangNhapBang",
        ],
      },
      {
        title: "userGuide.security.bat2fa",
        content: ["userGuide.security.thucHienTheoLuongProfile"],
      },
      {
        title: "userGuide.security.doiMatKhau",
        content: [
          "userGuide.security.thucHienTaiProfileDoi",
          "userGuide.security.matKhauNenCoToi",
        ],
      },
    ],
  },
  {
    id: "dashboard",
    title: "userGuide.dashboard.3DashboardChinh",
    description: "userGuide.dashboard.theoDoiKpiCanhBao",
    icon: <BarChart3 className="h-5 w-5" />,
    topics: [
      {
        title: "KPI cards",
        content: ["userGuide.dashboard.dashboardHienThiCacKpi"],
        bullets: [
          "userGuide.dashboard.totalOutputTongSoSan",
          "userGuide.dashboard.okCountNgCountNtf",
          "FPY = OK / (OK + NG)",
          "Yield Rate = (OK + NTF) / Total",
        ],
      },
      {
        title: "userGuide.dashboard.canhBaoYieldVaTrang",
        content: [
          "userGuide.dashboard.phanCanhBaoHienThi",
          "userGuide.dashboard.trangThaiKetNoiThe",
        ],
      },
      {
        title: "userGuide.dashboard.cacTabBoSung",
        content: ["userGuide.dashboard.tabTongQuanNgVisual"],
      },
    ],
  },
  {
    id: "corporate",
    title: "userGuide.corporate.4QuanLyTapDoan",
    description: "userGuide.corporate.theoDoiHieuSuatNhieu",
    icon: <Factory className="h-5 w-5" />,
    topics: [
      {
        title: "Corporate Dashboard",
        content: [
          "userGuide.corporate.danhChoQuanLyCap",
        ],
      },
      {
        title: "userGuide.corporate.soSanhHieuSuat",
        content: ["userGuide.corporate.hoTroSoSanhOutput"],
      },
      {
        title: "userGuide.corporate.drillDownChiTiet",
        content: [
          "userGuide.corporate.coTheDiTuCap",
        ],
      },
    ],
  },
  {
    id: "monitoring",
    title: "userGuide.monitoring.5GiamSatMay",
    description: "userGuide.monitoring.giamSatMqttTrangThai",
    icon: <Radio className="h-5 w-5" />,
    topics: [
      {
        title: "MQTT Monitor",
        content: [
          "userGuide.monitoring.liveStreamTheoDoiMessage",
        ],
      },
      {
        title: "Device Management",
        content: [
          "userGuide.monitoring.quanLyAnhXaVa",
          "userGuide.monitoring.baoGomCaManualRegistration",
        ],
      },
      {
        title: "userGuide.monitoring.machineStatusVaLayout",
        content: [
          "userGuide.monitoring.xemTinhTrangHeartbeatThong",
        ],
      },
    ],
  },
  {
    id: "history",
    title: "userGuide.history.6LichSuKiemTra",
    description: "userGuide.history.traCuuBanGhiKiem",
    icon: <History className="h-5 w-5" />,
    topics: [
      {
        title: "userGuide.history.boLocTimKiem",
        content: [
          "userGuide.history.locTheoSerialModelMachine",
        ],
      },
      {
        title: "userGuide.history.chiTietBanGhi",
        content: ["userGuide.history.hienThiAnhKetQua"],
      },
      {
        title: "userGuide.history.bulkOperationsVaNtf",
        content: [
          "userGuide.history.hoTroExportAcknowledgeHang",
        ],
      },
    ],
  },
  {
    id: "quality",
    title: "userGuide.quality.7PhanTichChatLuong",
    description: "userGuide.quality.phanTichLoiBangHeatmap",
    icon: <Brain className="h-5 w-5" />,
    topics: [
      {
        title: "Defect Heatmap",
        content: ["userGuide.quality.hienThiVungLoiTap"],
      },
      {
        title: "Root Cause & Prediction",
        content: [
          "userGuide.quality.ketHopPhanTichPareto",
        ],
      },
      {
        title: "SPC Analysis",
        content: ["userGuide.quality.cungCapControlChartsCapability"],
      },
    ],
  },
  {
    id: "reports",
    title: "userGuide.reports.8BaoCao",
    description: "userGuide.reports.baoCaoTucThiBao",
    icon: <FileText className="h-5 w-5" />,
    topics: [
      {
        title: "userGuide.reports.baoCaoTucThi",
        content: ["userGuide.reports.taoNhanhBaoCaoProduction"],
      },
      {
        title: "Scheduled Reports",
        content: [
          "userGuide.reports.lenLichGuiBaoCao",
        ],
      },
      {
        title: "Export Scheduling",
        content: ["userGuide.reports.lenLichXuatLichSu"],
      },
    ],
  },
  {
    id: "system",
    title: "userGuide.system.9CaiDatHeThong",
    description: "userGuide.system.cauHinhHeThongNguong",
    icon: <Settings className="h-5 w-5" />,
    topics: [
      {
        title: "System Configuration",
        content: [
          "userGuide.system.quanTriThamSoToan",
        ],
      },
      {
        title: "Yield alert thresholds",
        content: ["userGuide.system.thietLapMucWarningCritical"],
      },
      {
        title: "Shift Configuration & OEE Targets",
        content: [
          "userGuide.system.khaiBaoCaLamViec",
        ],
      },
    ],
  },
];

const faq = [
  {
    q: "userGuide.system.lamSaoDeThemMay",
    a: "userGuide.system.vaoMonitoringSettingsHoacData",
  },
  {
    q: "userGuide.system.taiSaoYieldRateKhac",
    a: "userGuide.system.fpyChiTinhOkOk",
  },
  {
    q: "userGuide.system.lamSaoDeXuatDu",
    a: "userGuide.system.vaoHistoryHoacReportsLoc",
  },
  {
    q: "userGuide.system.nenDungWebsocketHayPolling",
    a: "userGuide.system.websocketPhuHopGiamSat",
  },
  {
    q: "userGuide.system.backupDuLieuODau",
    a: "userGuide.system.suDungBackupRestoreDe",
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
      const baseMatch = `${t(section.title)} ${t(section.description)}`.toLowerCase().includes(q);
      const topicMatch = section.topics.some((topic) => {
        const text = `${t(topic.title)} ${topic.content.map((c) => t(c)).join(" ")} ${(topic.bullets || []).map((b) => t(b)).join(" ")}`.toLowerCase();
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
                  <span className="flex-1">{t(section.title)}</span>
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
                      <AccordionTrigger className="text-left">{t(topic.title)}</AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        {topic.content.map((paragraph, i) => (
                          <p key={i} className="text-sm text-muted-foreground leading-6">
                            {t(paragraph)}
                          </p>
                        ))}
                        {topic.bullets && topic.bullets.length > 0 && (
                          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                            {topic.bullets.map((item) => (
                              <li key={item}>{t(item)}</li>
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
