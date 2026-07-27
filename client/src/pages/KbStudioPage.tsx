/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-2) — Training Studio.
 *
 * The management layer over E3-1's doc-ingest (`kbIngestRouter`) + E3-2's own corpus/job
 * registry (`kbStudioRouter`): an operator creates/picks a corpus, uploads a document or
 * ingests a URL (Source), watches ingest jobs (Jobs), inspects registered corpora (Corpus),
 * samples what got ingested (Eval), and sees a "coming in E3-6" placeholder for LoRA
 * fine-tuning (Model Builder). Mirrors AIAgentCommandCenter.tsx's gating pattern exactly:
 * admin/engineer only (client-side check here is UX-only — the REAL enforcement is
 * kbStudioRouter.ts's `roleProcedure("admin","engineer").use(require2FA)`, narrower still —
 * admin-only — for the destructive deleteCorpus mutation).
 *
 * `KB_STUDIO_ENABLED` (server flag, default OFF) is surfaced via the EXISTING
 * `trpc.kbIngest.status` query (E3-1) — no duplicate status endpoint was added in E3-2. When
 * off, ingest is inert and this page shows an honest "feature disabled" banner while still
 * letting an operator browse corpus/job history (those reads don't depend on the flag).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, RefreshCw, ShieldAlert } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceTab } from "@/components/kbStudio/SourceTab";
import { JobsTab } from "@/components/kbStudio/JobsTab";
import { CorpusTab } from "@/components/kbStudio/CorpusTab";
import { EvalTab } from "@/components/kbStudio/EvalTab";
import { ModelBuilderTab } from "@/components/kbStudio/ModelBuilderTab";

export default function KbStudioPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOpsRole = user?.role === "admin" || user?.role === "engineer";
  const [activeTab, setActiveTab] = useState("source");

  const statusQuery = trpc.kbIngest.status.useQuery(undefined, { enabled: isOpsRole });
  const utils = trpc.useUtils();

  const refreshAll = () => {
    void statusQuery.refetch();
    void utils.kbStudio.listCorpora.invalidate();
    void utils.kbStudio.listJobs.invalidate();
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<GraduationCap className="h-6 w-6 text-primary" />}
          title={t("kbStudio.title")}
          description={t("kbStudio.subtitle")}
          actions={
            isOpsRole && (
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                {t("kbStudio.refresh")}
              </Button>
            )
          }
        />

        {!isOpsRole ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <ShieldAlert className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("kbStudio.permissionDenied.title")}</p>
              <p className="text-sm max-w-md text-muted-foreground">{t("kbStudio.permissionDenied.desc")}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {statusQuery.isError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                <ShieldAlert className="size-4 shrink-0" />
                {t("kbStudio.loadError")}
              </div>
            )}
            {statusQuery.data && !statusQuery.data.enabled && (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>{t("kbStudio.disabled.title")}</AlertTitle>
                <AlertDescription>{t("kbStudio.disabled.desc")}</AlertDescription>
              </Alert>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="source">{t("kbStudio.tabs.source")}</TabsTrigger>
                <TabsTrigger value="jobs">{t("kbStudio.tabs.jobs")}</TabsTrigger>
                <TabsTrigger value="corpus">{t("kbStudio.tabs.corpus")}</TabsTrigger>
                <TabsTrigger value="eval">{t("kbStudio.tabs.eval")}</TabsTrigger>
                <TabsTrigger value="modelBuilder">{t("kbStudio.tabs.modelBuilder")}</TabsTrigger>
              </TabsList>

              <TabsContent value="source">
                <SourceTab
                  enabled={statusQuery.data?.enabled ?? false}
                  webIngestEnabled={statusQuery.data?.webIngestEnabled ?? false}
                  maxUploadBytes={statusQuery.data?.maxUploadBytes ?? 20 * 1024 * 1024}
                  allowedTypes={statusQuery.data?.allowedTypes ?? ["pdf", "docx", "md", "txt"]}
                />
              </TabsContent>
              <TabsContent value="jobs">
                <JobsTab />
              </TabsContent>
              <TabsContent value="corpus">
                <CorpusTab />
              </TabsContent>
              <TabsContent value="eval">
                <EvalTab />
              </TabsContent>
              <TabsContent value="modelBuilder">
                <ModelBuilderTab />
              </TabsContent>
            </Tabs>
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
