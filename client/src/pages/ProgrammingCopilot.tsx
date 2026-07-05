/**
 * Doc 34 · P3 — PROGRAMMING COPILOT (standalone page, route /programming-copilot).
 *
 * The full-page home for the in-app Programming Copilot: hosts the reusable
 * <ProgrammingCopilotPanel> (kind / mode / vendor pickers + result) so an engineer can
 * generate / complete / translate / review / explain device code without a project open.
 *
 * ADVISORY + DISPLAY-ONLY: this page opens NO device path. Generated code is validated by the
 * safety substrate server-side and shown for review; to build, simulate & deploy, the engineer
 * takes it into the Engineering Workspace (the existing gated pipeline). Role-gated in App.tsx
 * with RouteGuard requirePermission="machine_monitoring" (mirrors /ir-editor, /pou-studio).
 */
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Info } from "lucide-react";
import { ProgrammingCopilotPanel } from "@/components/programming/ProgrammingCopilotPanel";

export default function ProgrammingCopilot() {
  const { t } = useTranslation();

  return (
    <DashboardLayout>
      <PageContainer className="max-w-4xl">
        <PageHeader
          icon={<Bot className="h-6 w-6 text-primary" />}
          title={t("progCopilot.title", "Programming Copilot")}
          description={t(
            "progCopilot.subtitle",
            "AI drafts, completes, translates, reviews and explains device code — grounded in vendor manuals and validated by the safety substrate. You review, simulate and sign off.",
          )}
        />

        {/* When-to-use + cross-link to the full authoring pipeline. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            {t(
              "progCopilot.whenToUse",
              "Draft or understand device code fast. To build, simulate and deploy, take the code into the Engineering Workspace.",
            )}
          </span>
          <Link href="/engineering" className="font-medium text-primary hover:underline">
            {t("nav.engineeringWorkspace", "Engineering Workspace")}
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5 text-primary" />
              {t("progCopilot.cardTitle", "Generate device code")}
            </CardTitle>
            <CardDescription>
              {t(
                "progCopilot.cardSubtitle",
                "Pick a program kind, mode and (optionally) a vendor, describe what you need, then generate.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProgrammingCopilotPanel variant="full" />
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
