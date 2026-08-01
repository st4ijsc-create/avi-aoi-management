import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageContainer, PageHeader } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Cpu, Sparkles, UserRound, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

const getEnvText = (value?: string) => value?.trim() || "";

export default function AboutSystem() {
  const { t } = useTranslation();
  const systemHighlights = t("aboutPage.system.highlights", { returnObjects: true }) as string[];
  const developmentStack = t("aboutPage.stack.items", { returnObjects: true }) as string[];

  const companyName = getEnvText(import.meta.env.VITE_ABOUT_COMPANY_NAME) || t("aboutPage.company.name");
  const companyDescription =
    getEnvText(import.meta.env.VITE_ABOUT_COMPANY_DESCRIPTION) || t("aboutPage.company.description");
  const developerTeam =
    getEnvText(import.meta.env.VITE_ABOUT_DEVELOPER_TEAM) || t("aboutPage.developer.teamValue");
  const developerRole =
    getEnvText(import.meta.env.VITE_ABOUT_DEVELOPER_ROLE) || t("aboutPage.developer.roleValue");
  const developerContact =
    getEnvText(import.meta.env.VITE_ABOUT_DEVELOPER_CONTACT) || t("aboutPage.developer.contactValue");

  return (
    <DashboardLayout title={t("aboutPage.layoutTitle")} navItems={navItems} currentPath="/about-system">
      <PageContainer>
        <div className="rounded-2xl border bg-linear-to-r from-primary/10 via-primary/5 to-transparent p-6">
          <PageHeader
            icon={<Cpu className="h-6 w-6" />}
            title={t("aboutPage.hero.title")}
            description={t("aboutPage.hero.description")}
            badge={
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">{t("aboutPage.hero.version")}</Badge>
                <Badge variant="outline">{t("aboutPage.hero.updated")}</Badge>
              </div>
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("aboutPage.system.title")}
              </CardTitle>
              <CardDescription>
                {t("aboutPage.system.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {systemHighlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                {t("aboutPage.stack.title")}
              </CardTitle>
              <CardDescription>{t("aboutPage.stack.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {developmentStack.map((item) => (
                <div key={item} className="rounded-md border bg-muted/30 px-3 py-2">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {t("aboutPage.company.title")}
              </CardTitle>
              <CardDescription>{companyDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{companyName}</p>
              <p>{t("aboutPage.company.paragraph1")}</p>
              <p>{t("aboutPage.company.paragraph2")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" />
                {t("aboutPage.developer.title")}
              </CardTitle>
              <CardDescription>{t("aboutPage.developer.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">{t("aboutPage.developer.teamLabel")}</p>
                <p>{developerTeam}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">{t("aboutPage.developer.roleLabel")}</p>
                <p>{developerRole}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">{t("aboutPage.developer.contactLabel")}</p>
                <p>{developerContact}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
