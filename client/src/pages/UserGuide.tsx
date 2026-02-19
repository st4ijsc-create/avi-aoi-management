import { useState } from "react";
import { useTranslation } from 'react-i18next';
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
    titleKey: "guide.overview.title",
    icon: <BookOpen className="h-5 w-5" />,
    descriptionKey: "guide.overview.description",
    content: [
      { titleKey: "guide.overview.introduction.title", contentKey: "guide.overview.introduction.content" },
      { titleKey: "guide.overview.architecture.title", contentKey: "guide.overview.architecture.content" },
      { titleKey: "guide.overview.dataFlow.title", contentKey: "guide.overview.dataFlow.content" },
    ],
  },
  {
    id: "dashboard",
    titleKey: "guide.dashboard.title",
    icon: <BarChart3 className="h-5 w-5" />,
    descriptionKey: "guide.dashboard.description",
    content: [
      { titleKey: "guide.dashboard.main.title", contentKey: "guide.dashboard.main.content" },
      { titleKey: "guide.dashboard.machineStatus.title", contentKey: "guide.dashboard.machineStatus.content" },
      { titleKey: "guide.dashboard.mqttMonitor.title", contentKey: "guide.dashboard.mqttMonitor.content" },
      { titleKey: "guide.dashboard.customDashboard.title", contentKey: "guide.dashboard.customDashboard.content" },
    ],
  },
  {
    id: "production",
    titleKey: "guide.production.title",
    icon: <ClipboardList className="h-5 w-5" />,
    descriptionKey: "guide.production.description",
    content: [
      { titleKey: "guide.production.orders.title", contentKey: "guide.production.orders.content" },
      { titleKey: "guide.production.history.title", contentKey: "guide.production.history.content" },
      { titleKey: "guide.production.spc.title", contentKey: "guide.production.spc.content" },
    ],
  },
  {
    id: "data-management",
    titleKey: "guide.dataManagement.title",
    icon: <Database className="h-5 w-5" />,
    descriptionKey: "guide.dataManagement.description",
    content: [
      { titleKey: "guide.dataManagement.products.title", contentKey: "guide.dataManagement.products.content" },
      { titleKey: "guide.dataManagement.assignment.title", contentKey: "guide.dataManagement.assignment.content" },
      { titleKey: "guide.dataManagement.layout.title", contentKey: "guide.dataManagement.layout.content" },
    ],
  },
  {
    id: "alerts",
    titleKey: "guide.alerts.title",
    icon: <Bell className="h-5 w-5" />,
    descriptionKey: "guide.alerts.description",
    content: [
      { titleKey: "guide.alerts.rules.title", contentKey: "guide.alerts.rules.content" },
      { titleKey: "guide.alerts.history.title", contentKey: "guide.alerts.history.content" },
      { titleKey: "guide.alerts.category.title", contentKey: "guide.alerts.category.content" },
    ],
  },
  {
    id: "reports",
    titleKey: "guide.reports.title",
    icon: <FileText className="h-5 w-5" />,
    descriptionKey: "guide.reports.description",
    content: [
      { titleKey: "guide.reports.summary.title", contentKey: "guide.reports.summary.content" },
      { titleKey: "guide.reports.categoryAnalysis.title", contentKey: "guide.reports.categoryAnalysis.content" },
      { titleKey: "guide.reports.scheduled.title", contentKey: "guide.reports.scheduled.content" },
    ],
  },
  {
    id: "admin",
    titleKey: "guide.admin.title",
    icon: <Shield className="h-5 w-5" />,
    descriptionKey: "guide.admin.description",
    content: [
      { titleKey: "guide.admin.users.title", contentKey: "guide.admin.users.content" },
      { titleKey: "guide.admin.settings.title", contentKey: "guide.admin.settings.content" },
      { titleKey: "guide.admin.api.title", contentKey: "guide.admin.api.content" },
    ],
  },
];

// FAQ data
const faqItems = [
  {
    questionKey: "guide.faq.connectMachine.question",
    answerKey: "guide.faq.connectMachine.answer",
  },
  {
    questionKey: "guide.faq.yieldNotUpdating.question",
    answerKey: "guide.faq.yieldNotUpdating.answer",
  },
  {
    questionKey: "guide.faq.lowYieldAlert.question",
    answerKey: "guide.faq.lowYieldAlert.answer",
  },
  {
    questionKey: "guide.faq.autoReport.question",
    answerKey: "guide.faq.autoReport.answer",
  },
  {
    questionKey: "guide.faq.fixNtf.question",
    answerKey: "guide.faq.fixNtf.answer",
  },
  {
    questionKey: "guide.faq.maxPoints.question",
    answerKey: "guide.faq.maxPoints.answer",
  },
];

export default function UserGuide() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("overview");

  // Filter sections based on search
  const filteredSections = guideSections.filter(section =>
    t(section.titleKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
    t(section.descriptionKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
    section.content.some(c => 
      t(c.titleKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
      t(c.contentKey).toLowerCase().includes(searchQuery.toLowerCase())
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
              {t('guide.userGuide')}
            </h1>
            <p className="text-muted-foreground">
              {t('guide.userGuideDescription')}
            </p>
          </div>

          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('guide.searchPlaceholder')}
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
              <CardTitle className="text-lg">{t('guide.tableOfContents')}</CardTitle>
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
                    <span>{t(section.titleKey)}</span>
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
                  <TabsTrigger key={s.id} value={s.id}>{t(s.titleKey)}</TabsTrigger>
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
                          <CardTitle>{t(section.titleKey)}</CardTitle>
                          <CardDescription>{t(section.descriptionKey)}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="single" collapsible className="w-full">
                        {section.content.map((item, index) => (
                          <AccordionItem key={index} value={`item-${index}`}>
                            <AccordionTrigger className="text-left">
                              {t(item.titleKey)}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="prose prose-sm dark:prose-invert max-w-none">
                                {t(item.contentKey).split('\n\n').map((para, i) => (
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
                  {t('guide.faqTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {faqItems.map((faq, index) => (
                    <AccordionItem key={index} value={`faq-${index}`}>
                      <AccordionTrigger className="text-left">
                        {t(faq.questionKey)}
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="text-muted-foreground">{t(faq.answerKey)}</p>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader>
                <CardTitle>{t('guide.quickLinks')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/api-docs">
                      <FileText className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">{t('guide.apiDocumentation')}</div>
                        <div className="text-xs text-muted-foreground">{t('guide.apiDocumentationDesc')}</div>
                      </div>
                    </a>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/settings">
                      <Settings className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">{t('guide.systemSettings')}</div>
                        <div className="text-xs text-muted-foreground">{t('guide.systemSettingsDesc')}</div>
                      </div>
                    </a>
                  </Button>
                  <Button variant="outline" className="justify-start h-auto py-4" asChild>
                    <a href="/mqtt-alerts">
                      <Bell className="h-5 w-5 mr-3" />
                      <div className="text-left">
                        <div className="font-medium">{t('guide.alertRules')}</div>
                        <div className="text-xs text-muted-foreground">{t('guide.alertRulesDesc')}</div>
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
