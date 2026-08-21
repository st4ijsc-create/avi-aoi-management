/**
 * Wave 1 — Task 4: AI Specialist Studio (/ai-specialist-studio).
 *
 * The FIRST client-side front door onto the 4 specialist AI agents backend
 * (Wave 1 Tasks 1-3, already committed): trpc.aiSpecialistAgent.{listAgents,
 * run, getSessionDetail, submitFeedback}. Before this page, that backend had
 * no caller anywhere in the client — this is the "dispatch work, read the
 * result" screen.
 *
 * Two-card mechanism:
 *   1. Dispatch card — pick an agent (4 cards, names/blurbs from
 *      `listAgents`), describe the objective (+ optional module/files/
 *      advanced context), toggle repo-context, dispatch. `run` is a
 *      FIRE-AND-FORGET mutation: it returns `{ sessionId, started: true }`
 *      immediately — the model keeps working in a background process.
 *   2. Result card — once a `sessionId` exists, polls `getSessionDetail`
 *      every 2s ONLY while `status === "running"`; the `refetchInterval`
 *      callback returns `false` the instant status flips to
 *      completed/failed, so polling stops for good and never hammers the
 *      server for the rest of the session. Renders HONEST states only:
 *        - running  → spinner + "Đang chạy…", NEVER a fabricated progress %
 *        - failed   → the real `summary` error text in a destructive alert
 *        - completed→ the 7-block <SpecialistResultView> + <FeedbackBar>
 *
 * <SpecialistResultView> and <FeedbackBar> are extracted (not inlined into
 * the dispatch flow) so Wave 1 Task 5 (session history / module-audit
 * results) can render the same 7-block output + rating UI for a session it
 * didn't just dispatch.
 *
 * Reads `?agent=<id>` from the URL on mount to preselect an agent — Task 5
 * deep-links here with that param (e.g. "re-run with a different agent").
 *
 * Advisory-only (Wave 1 = "mức A — cố vấn"): this Studio can only ask a
 * specialist agent to READ + RECOMMEND. Nothing here writes to the repo,
 * generates a patch, creates a branch, or touches machine/OT control — see
 * the persistent notice under the Dispatch button.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useLocaleDate } from "@/lib/format";
import { TRPCClientError } from "@trpc/client";
import type { LucideIcon } from "lucide-react";
import {
  Wrench,
  Database,
  Server,
  LayoutPanelTop,
  FlaskConical,
  Copy,
  Check,
  AlertTriangle,
  Info,
  History,
  ClipboardList,
  Gauge,
} from "lucide-react";

// The 7 output blocks a completed specialist session always carries at
// `aggregateOutput.result` (server/services/aiSpecialistAgentService.ts
// `SpecialistAgentRunResult["output"]`, minus `reportTemplate` which the QA
// agent alone produces and this Studio does not surface).
const OUTPUT_SECTIONS = [
  "summary",
  "diagnosis",
  "actionPlan",
  "patchHints",
  "testPlan",
  "optimizationIdeas",
  "risks",
] as const;

type OutputSectionKey = (typeof OUTPUT_SECTIONS)[number];
type SpecialistOutput = Partial<Record<OutputSectionKey, string | string[] | null | undefined>>;

const AGENT_IDS = ["data-analyst", "backend-engineer", "frontend-engineer", "qa-optimizer"] as const;
type StudioAgentId = (typeof AGENT_IDS)[number];

const AGENT_ICONS: Record<StudioAgentId, LucideIcon> = {
  "data-analyst": Database,
  "backend-engineer": Server,
  "frontend-engineer": LayoutPanelTop,
  "qa-optimizer": FlaskConical,
};

function isStudioAgentId(value: string | null): value is StudioAgentId {
  return !!value && (AGENT_IDS as readonly string[]).includes(value);
}

/** Flattens a section's `string | string[]` payload to plain copy/display text. */
function sectionText(value: string | string[] | null | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join("\n") : value;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function AISpecialistStudio() {
  const { t } = useTranslation();
  const preselected = new URLSearchParams(window.location.search).get("agent");
  const [agentId, setAgentId] = useState<string>(isStudioAgentId(preselected) ? preselected : "backend-engineer");
  const [objective, setObjective] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [filesText, setFilesText] = useState("");
  const [useEyes, setUseEyes] = useState(true);
  const [currentBehavior, setCurrentBehavior] = useState("");
  const [desiredBehavior, setDesiredBehavior] = useState("");
  const [errorLogs, setErrorLogs] = useState("");
  const [codeSnippet, setCodeSnippet] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  // Which step of a (possibly multi-step) session the Result card currently
  // shows — reset to the first step whenever a different session loads.
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  // Fix round 2 (I-1/I-2/I-4) — trước đây trang này phải tự đoán
  // `repoContextUsed` để gửi kèm phiếu chấm, và cả 3 nguồn phiên (Dispatch /
  // Audit / Lịch sử) đều đoán sai được: công tắc `useEyes` là trạng thái HIỆN
  // TẠI chứ không phải lúc giao việc (công tắc chỉ khoá ~1 giây, model chạy vài
  // phút), còn "audit" thì hardcode `true` kể cả khi đọc được 0 file. Nay MÁY
  // CHỦ tự suy ra từ `repoContextSummary` đã lưu ở bước đầu tiên
  // (`deriveFeedbackFacts`, aiSpecialistAgentRouter.ts) và 3 trường đó đã bị bỏ
  // khỏi hợp đồng `submitFeedback`. Hệ quả: KHÔNG còn khái niệm "nguồn phiên",
  // và phiên mở từ tab Lịch sử CHẤM ĐIỂM ĐƯỢC như mọi phiên khác — ghi chú cũ
  // ("không khôi phục được") là sai sự thật, đã bỏ.
  const [activeTab, setActiveTab] = useState<"dispatch" | "history" | "audit" | "quality">("dispatch");

  const agents = trpc.aiSpecialistAgent.listAgents.useQuery();
  const runMutation = trpc.aiSpecialistAgent.run.useMutation();

  // Poll CHỈ khi phiên còn chạy — dừng hẳn khi completed/failed (không bao giờ
  // tiếp tục hammer server sau khi phiên đã xong).
  const session = trpc.aiSpecialistAgent.getSessionDetail.useQuery(
    { sessionId: sessionId! },
    {
      enabled: sessionId !== null,
      refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
    },
  );

  // A different session loaded (dispatch / history row / audit run) → always
  // start the Result card back on its first step.
  useEffect(() => {
    setActiveStepIdx(0);
  }, [sessionId]);

  const objectiveTrimmedLen = objective.trim().length;
  const objectiveValid = objectiveTrimmedLen >= 10;
  const dispatching = runMutation.isPending;

  async function handleDispatch() {
    if (!objectiveValid || dispatching) return;
    const files = filesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await runMutation.mutateAsync({
        agentId: agentId as "data-analyst" | "backend-engineer" | "frontend-engineer" | "qa-optimizer",
        objective: objective.trim(),
        moduleName: moduleName.trim() || undefined,
        files: files.length ? files : undefined,
        includeRepoContext: useEyes,
        language: "vi",
        currentBehavior: currentBehavior.trim() || undefined,
        desiredBehavior: desiredBehavior.trim() || undefined,
        errorLogs: errorLogs.trim() || undefined,
        codeSnippet: codeSnippet.trim() || undefined,
      });
      setSessionId(res.sessionId);
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  }

  /**
   * Task 5 — History tab row click / Audit-module "Chạy audit" both funnel
   * here: load the session into THIS SAME Result card (no second render/poll
   * scheme) and jump the Tabs back to "Giao việc" so it is immediately
   * visible. Cả 3 nguồn phiên nay đối xử NHƯ NHAU — mọi sự thật cần cho phiếu
   * chấm đều do máy chủ suy ra (xem ghi chú ở `activeTab`).
   */
  function handleLoadSession(id: number) {
    setSessionId(id);
    setActiveTab("dispatch");
  }

  const status = session.data?.status as "running" | "completed" | "failed" | undefined;
  const steps = session.data?.steps ?? [];
  // Task 5 — the dispatch flow only ever creates 1-step sessions, so reading
  // steps[0] used to be an (accidental) correct simplification. History/Audit
  // load workflow-chain and module-audit sessions here too, which carry
  // MULTIPLE steps — one per specialist agent in the chain — each with its
  // own output/model/tokens/time. Always resolve output+meta from the
  // user-selected step (default: the first) instead of the session-level
  // `aggregateOutput`, which for those modes holds `finalSummary`/
  // `orderedAgents`, not a renderable `SpecialistOutput`.
  const clampedStepIdx = steps.length > 0 ? Math.min(activeStepIdx, steps.length - 1) : 0;
  const activeStep = steps[clampedStepIdx];
  const output = activeStep?.outputPayload as SpecialistOutput | undefined;
  const metaModelId = activeStep?.modelId ?? undefined;
  // Wave 1 T4 fix round 1 — status stays undefined both while the FIRST
  // getSessionDetail response is still in flight (harmless, momentary — the
  // row was already created with status "running" server-side) AND if the
  // query errors permanently (NOT_FOUND, transient DB error, …). Without a
  // branch keyed on this, the Result card renders nothing at all in the
  // error case — never surfaced to the user. Distinguish NOT_FOUND (session
  // genuinely doesn't belong to/exist for this user) from any other error
  // so the message stays accurate instead of defaulting everything to
  // "not found".
  const sessionErrorCode =
    session.error instanceof TRPCClientError
      ? (session.error.data as { code?: string } | undefined)?.code
      : undefined;

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Wrench className="h-6 w-6 text-primary" />}
          title={t("specialistStudio.title", "Xưởng Agent chuyên môn")}
          description={t(
            "specialistStudio.subtitle",
            "Giao việc cho AI Agent chuyên môn và theo dõi kết quả theo từng phiên",
          )}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList>
            <TabsTrigger value="dispatch">
              <Wrench className="h-4 w-4 mr-1" />
              {t("specialistStudio.tabs.dispatch", "Giao việc")}
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4 mr-1" />
              {t("specialistStudio.tabs.history", "Lịch sử")}
            </TabsTrigger>
            <TabsTrigger value="audit">
              <ClipboardList className="h-4 w-4 mr-1" />
              {t("specialistStudio.tabs.audit", "Audit module")}
            </TabsTrigger>
            <TabsTrigger value="quality">
              <Gauge className="h-4 w-4 mr-1" />
              {t("specialistStudio.tabs.quality", "Chất lượng")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dispatch">
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 items-start">
          {/* ── Dispatch card ──────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t("specialistStudio.dispatch.title", "Giao việc")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("specialistStudio.dispatch.agentLabel", "Chọn Agent chuyên môn")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {agents.isLoading &&
                    AGENT_IDS.map((id) => <Skeleton key={id} className="h-24 rounded-lg" />)}
                  {(agents.data?.agents ?? []).map((agent) => {
                    const Icon = AGENT_ICONS[agent.id as StudioAgentId] ?? Wrench;
                    const selected = agentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        disabled={dispatching}
                        onClick={() => setAgentId(agent.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                          selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
                        )}
                      >
                        <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                        <span className="font-medium text-foreground">
                          {t(`agentCenter.persona.specialist-${agent.id}`, agent.name)}
                        </span>
                        <span className="text-muted-foreground line-clamp-2">
                          {t(`specialistStudio.agentBlurb.${agent.id}`, "")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialist-objective">
                  {t("specialistStudio.dispatch.objectiveLabel", "Mục tiêu")}
                </Label>
                <Textarea
                  id="specialist-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder={t(
                    "specialistStudio.dispatch.objectivePlaceholder",
                    "Mô tả việc cần agent phân tích hoặc khuyến nghị…",
                  )}
                  maxLength={8000}
                  rows={4}
                  disabled={dispatching}
                  aria-invalid={objectiveTrimmedLen > 0 && !objectiveValid}
                />
                <p className={cn("text-xs", objectiveValid ? "text-muted-foreground" : "text-destructive")}>
                  {t("specialistStudio.dispatch.objectiveHint", "Tối thiểu 10 ký tự")} ({objectiveTrimmedLen}/8000)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialist-module">{t("specialistStudio.dispatch.moduleLabel", "Module")}</Label>
                <Input
                  id="specialist-module"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder={t("specialistStudio.dispatch.modulePlaceholder", "Ví dụ: production-dashboard")}
                  maxLength={200}
                  disabled={dispatching}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="specialist-files">
                  {t("specialistStudio.dispatch.filesLabel", "File liên quan")}
                </Label>
                <Textarea
                  id="specialist-files"
                  value={filesText}
                  onChange={(e) => setFilesText(e.target.value)}
                  placeholder={t(
                    "specialistStudio.dispatch.filesPlaceholder",
                    "client/src/pages/...\nserver/routers/...",
                  )}
                  rows={3}
                  disabled={dispatching}
                />
                <p className="text-xs text-muted-foreground">
                  {t("specialistStudio.dispatch.filesHint", "Mỗi dòng một đường dẫn file")}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="specialist-repo-context">
                    {t("specialistStudio.dispatch.repoContextLabel", "Cho agent đọc mã nguồn")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "specialistStudio.dispatch.repoContextHint",
                      "Agent đọc nội dung file liên quan + tri thức nội bộ trước khi trả lời (nội dung đã được lọc bí mật trước khi vào prompt).",
                    )}
                  </p>
                </div>
                <Switch
                  id="specialist-repo-context"
                  checked={useEyes}
                  onCheckedChange={setUseEyes}
                  disabled={dispatching}
                />
              </div>

              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t("specialistStudio.dispatch.advancedTitle", "Nâng cao")}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="specialist-current-behavior">
                      {t("specialistStudio.dispatch.currentBehaviorLabel", "Hành vi hiện tại")}
                    </Label>
                    <Textarea
                      id="specialist-current-behavior"
                      value={currentBehavior}
                      onChange={(e) => setCurrentBehavior(e.target.value)}
                      rows={2}
                      disabled={dispatching}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="specialist-desired-behavior">
                      {t("specialistStudio.dispatch.desiredBehaviorLabel", "Hành vi mong muốn")}
                    </Label>
                    <Textarea
                      id="specialist-desired-behavior"
                      value={desiredBehavior}
                      onChange={(e) => setDesiredBehavior(e.target.value)}
                      rows={2}
                      disabled={dispatching}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="specialist-error-logs">
                      {t("specialistStudio.dispatch.errorLogsLabel", "Log lỗi")}
                    </Label>
                    <Textarea
                      id="specialist-error-logs"
                      value={errorLogs}
                      onChange={(e) => setErrorLogs(e.target.value)}
                      rows={2}
                      disabled={dispatching}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="specialist-code-snippet">
                      {t("specialistStudio.dispatch.codeSnippetLabel", "Đoạn mã liên quan")}
                    </Label>
                    <Textarea
                      id="specialist-code-snippet"
                      value={codeSnippet}
                      onChange={(e) => setCodeSnippet(e.target.value)}
                      rows={4}
                      className="font-mono text-xs"
                      disabled={dispatching}
                    />
                  </div>
                </div>
              </details>

              <Button className="w-full" onClick={handleDispatch} disabled={!objectiveValid || dispatching}>
                {dispatching ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {t("specialistStudio.dispatch.submitting", "Đang giao việc…")}
                  </>
                ) : (
                  t("specialistStudio.dispatch.submit", "Giao việc")
                )}
              </Button>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {t(
                  "specialistStudio.advisoryNotice",
                  "Agent chỉ đưa ra KHUYẾN NGHỊ — không có thay đổi nào được áp dụng vào mã nguồn.",
                )}
              </p>
            </CardContent>
          </Card>

          {/* ── Result card ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>{t("specialistStudio.result.title", "Kết quả")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionId === null && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "specialistStudio.result.idle",
                    'Điền thông tin bên trái và bấm "Giao việc" để nhận khuyến nghị từ agent.',
                  )}
                </p>
              )}

              {/* status stays undefined both while the first response is still
                  loading (harmless — the row is already "running" server-side)
                  AND if the query errors permanently. Never leave the card
                  blank in the latter case. */}
              {sessionId !== null && status === undefined && session.isError && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
                  <AlertDescription>
                    {sessionErrorCode === "NOT_FOUND"
                      ? t("specialistStudio.result.notFound", "Không tìm thấy phiên này.")
                      : t("specialistStudio.result.loadError", "Không thể tải kết quả phiên lúc này.")}
                  </AlertDescription>
                </Alert>
              )}

              {sessionId !== null && (status === "running" || (status === undefined && !session.isError)) && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Spinner className="h-5 w-5" />
                  {t("specialistStudio.result.running", "Đang chạy…")}
                </div>
              )}

              {sessionId !== null && status === "failed" && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
                  <AlertDescription>{session.data?.summary}</AlertDescription>
                </Alert>
              )}

              {sessionId !== null && status === "completed" && (
                <>
                  {/* Task 5 — a workflow-chain/module-audit session carries >1
                      step (one per specialist agent). Let the user switch
                      which step's output the result view below renders. */}
                  {steps.length > 1 && (
                    <>
                      {session.data?.summary && (
                        <Alert>
                          <Info />
                          <AlertTitle>{t("specialistStudio.result.chainSummaryTitle", "Tóm tắt chuỗi")}</AlertTitle>
                          <AlertDescription>{session.data.summary}</AlertDescription>
                        </Alert>
                      )}
                      <div
                        className="flex flex-wrap gap-1.5"
                        role="tablist"
                        aria-label={t("specialistStudio.result.stepSelectorAria", "Chọn bước")}
                      >
                        {steps.map((step, idx) => (
                          <Button
                            key={step.id}
                            type="button"
                            size="sm"
                            variant={idx === clampedStepIdx ? "default" : "outline"}
                            aria-pressed={idx === clampedStepIdx}
                            onClick={() => setActiveStepIdx(idx)}
                          >
                            {idx + 1}. {t(`agentCenter.persona.specialist-${step.agentId}`, step.agentId)}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                  <SpecialistResultView
                    output={output}
                    modelId={metaModelId}
                    tokensPrompt={activeStep?.tokensPrompt}
                    tokensGenerated={activeStep?.tokensGenerated}
                    totalTimeMs={activeStep?.totalTimeMs}
                  />
                  {/* Spec §11 — nói thẳng agent ĐÃ ĐỌC ĐƯỢC GÌ. Không có dòng
                      này thì "đã bật công tắc đọc mã" và "thật sự đọc được
                      file" nhìn giống hệt nhau trên màn hình. */}
                  <RepoContextNotice step={activeStep} />
                  {/* Mọi phiên đã hoàn tất đều chấm điểm được — kể cả phiên mở
                      từ tab Lịch sử. `agentId`/`moduleName`/`repoContextUsed`
                      do MÁY CHỦ suy ra từ chính phiên đó, client không gửi. */}
                  <div className="border-t pt-4">
                    <p className="mb-2 text-sm font-medium">
                      {t("specialistStudio.feedback.title", "Đánh giá kết quả này")}
                    </p>
                    <FeedbackBar sessionId={sessionId} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
          </TabsContent>

          <TabsContent value="history">
            <SpecialistHistoryTab onSelectSession={handleLoadSession} />
          </TabsContent>

          <TabsContent value="audit">
            <SpecialistAuditTab onSessionStarted={handleLoadSession} />
          </TabsContent>

          <TabsContent value="quality">
            <SpecialistQualityTab />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

/**
 * Renders the 7 fixed output blocks of a completed specialist session
 * (`aggregateOutput.result`), each with a copy button, plus a meta strip
 * (model/tokens/time). Extracted so Wave 1 Task 5 (session history /
 * module-audit result views) can reuse it for a session it did not itself
 * dispatch — it takes plain data, no dispatch/poll state.
 */
export function SpecialistResultView({
  output,
  modelId,
  tokensPrompt,
  tokensGenerated,
  totalTimeMs,
}: {
  output: SpecialistOutput | undefined;
  modelId?: string | null;
  tokensPrompt?: number | null;
  tokensGenerated?: number | null;
  totalTimeMs?: number | null;
}) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const hasMeta = !!modelId || tokensPrompt != null || tokensGenerated != null || totalTimeMs != null;

  async function copySection(key: string, text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(t("specialistStudio.result.copied", "Đã sao chép"));
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard permission denied/unavailable — non-critical UX affordance,
      // fail silently rather than surface a scary error for a copy button.
    }
  }

  return (
    <div className="space-y-3">
      {hasMeta && (
        <div className="flex flex-wrap gap-2 text-xs">
          {modelId && (
            <Badge variant="outline">
              {t("specialistStudio.result.meta.model", "Model")}: {modelId}
            </Badge>
          )}
          {(tokensPrompt != null || tokensGenerated != null) && (
            <Badge variant="outline">
              {t("specialistStudio.result.meta.tokens", "Token (prompt / sinh)")}: {tokensPrompt ?? "–"} /{" "}
              {tokensGenerated ?? "–"}
            </Badge>
          )}
          {totalTimeMs != null && (
            <Badge variant="outline">
              {t("specialistStudio.result.meta.time", "Thời gian")}: {formatDuration(totalTimeMs)}
            </Badge>
          )}
        </div>
      )}

      {OUTPUT_SECTIONS.map((key) => {
        const raw = output?.[key];
        const text = sectionText(raw);
        return (
          <div key={key} className="rounded-lg border p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium">{t(`specialistStudio.result.section.${key}`, key)}</span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={!text}
                onClick={() => copySection(key, text)}
                aria-label={t("specialistStudio.result.copy", "Sao chép")}
              >
                {copiedKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {Array.isArray(raw) && raw.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {raw.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : text ? (
              <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("specialistStudio.result.sectionEmpty", "Không có nội dung")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Bản tóm tắt ngữ cảnh repo mà máy chủ lưu ở `inputPayload` của mỗi bước. */
type RepoContextSummary = {
  filesRead?: number;
  skipped?: number;
  truncated?: number;
  totalBytes?: number;
};

function repoContextSummaryOf(step: { inputPayload?: unknown } | undefined): RepoContextSummary | null {
  const s = (step?.inputPayload as { repoContextSummary?: RepoContextSummary } | null | undefined)
    ?.repoContextSummary;
  return s && typeof s === "object" ? s : null;
}

/**
 * Fix round 2 (I-2, spec §11) — dòng sự thật "agent đã đọc được gì".
 *
 * Bật công tắc "cho agent đọc mã nguồn" KHÔNG đồng nghĩa agent đọc được file
 * nào: bỏ trống ô "File liên quan", gõ sai đường dẫn, file `.py`, file trong
 * `node_modules/`… đều cho ra 0 file, và khi đó prompt GIỐNG HỆT lúc tắt mắt.
 * Không hiện con số này thì hai tình huống đó không phân biệt được trên màn
 * hình, và người dùng sẽ chấm điểm một phiên "mù" như thể nó có mắt.
 *
 * Phiên cũ (chạy trước bản này) không có `repoContextSummary` — nói thẳng là
 * KHÔNG BIẾT, không đoán bừa.
 */
function RepoContextNotice({ step }: { step: { inputPayload?: unknown } | undefined }) {
  const { t } = useTranslation();
  const summary = repoContextSummaryOf(step);

  if (!summary) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("specialistStudio.result.repoContext.unknown", "Phiên này không ghi lại số file agent đã đọc.")}
      </p>
    );
  }

  const filesRead = Number(summary.filesRead ?? 0);
  if (filesRead <= 0) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{t("specialistStudio.result.repoContext.noneTitle", "Agent không đọc được file nào")}</AlertTitle>
        <AlertDescription>
          {t(
            "specialistStudio.result.repoContext.none",
            "Khuyến nghị dưới đây được đưa ra KHÔNG có mã nguồn thật (bỏ qua {{skipped}} đường dẫn). Kiểm tra lại ô \"File liên quan\".",
            { skipped: Number(summary.skipped ?? 0) },
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      {t(
        "specialistStudio.result.repoContext.summary",
        "Agent đã đọc {{filesRead}} file · bỏ qua {{skipped}} · cắt bớt {{truncated}}",
        {
          filesRead,
          skipped: Number(summary.skipped ?? 0),
          truncated: Number(summary.truncated ?? 0),
        },
      )}
    </p>
  );
}

/**
 * 3-button usefulness rating + optional free-text reason, wired to
 * `trpc.aiSpecialistAgent.submitFeedback`. Extracted (not inlined) so Wave 1
 * Task 5 can attach the same rating strip to a session viewed from history.
 *
 * Fix round 2 (I-4) — chỉ còn nhận `sessionId`. `agentId`/`moduleName`/
 * `repoContextUsed` đã bị BỎ khỏi hợp đồng `submitFeedback`: máy chủ nắm sự
 * thật về phiên, client thì không.
 */
export function FeedbackBar({ sessionId }: { sessionId: number }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = trpc.aiSpecialistAgent.submitFeedback.useMutation();

  const RATINGS = [
    { key: "useful", label: t("specialistStudio.rating.useful", "Dùng được") },
    { key: "partial", label: t("specialistStudio.rating.partial", "Dùng được một phần") },
    { key: "useless", label: t("specialistStudio.rating.useless", "Vô dụng") },
  ] as const;

  async function rate(rating: (typeof RATINGS)[number]["key"]) {
    try {
      await submit.mutateAsync({
        sessionId,
        rating,
        reason: reason || undefined,
      });
      setSaved(true);
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {RATINGS.map((r) => (
        <Button key={r.key} type="button" variant="outline" size="sm" disabled={submit.isPending} onClick={() => rate(r.key)}>
          {r.label}
        </Button>
      ))}
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder={t("specialistStudio.reasonPlaceholder", "Lý do (tuỳ chọn)")}
        className="h-9 max-w-xs"
        disabled={submit.isPending}
      />
      {saved && (
        <span className="text-sm text-muted-foreground">{t("specialistStudio.feedbackSaved", "Đã ghi nhận")}</span>
      )}
    </div>
  );
}

/**
 * Task 5, Step 1 — "Lịch sử" tab: `listSessions.useQuery({ limit: 20 })`
 * rendered as a table (time / session type / agent(s) / module / status /
 * objective). Clicking a row hands the sessionId to the SAME Result card the
 * Dispatch tab uses (via `onSelectSession` → `handleLoadSession`) — no
 * separate result view or poll is built here.
 */
function SpecialistHistoryTab({ onSelectSession }: { onSelectSession: (sessionId: number) => void }) {
  const { t } = useTranslation();
  const { dateTime } = useLocaleDate();
  const sessionsQuery = trpc.aiSpecialistAgent.listSessions.useQuery({ limit: 20 });
  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("specialistStudio.history.title", "Lịch sử")}</CardTitle>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        )}

        {sessionsQuery.isError && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
            <AlertDescription>
              {t("specialistStudio.history.loadError", "Không thể tải lịch sử phiên lúc này.")}
            </AlertDescription>
          </Alert>
        )}

        {sessionsQuery.data && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("specialistStudio.history.empty", "Chưa có phiên nào.")}
          </p>
        )}

        {sessions.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("specialistStudio.history.col.time", "Thời gian")}</TableHead>
                <TableHead>{t("specialistStudio.history.col.type", "Loại phiên")}</TableHead>
                <TableHead>{t("specialistStudio.history.col.agent", "Agent")}</TableHead>
                <TableHead>{t("specialistStudio.history.col.module", "Module")}</TableHead>
                <TableHead>{t("specialistStudio.history.col.status", "Trạng thái")}</TableHead>
                <TableHead>{t("specialistStudio.history.col.objective", "Mục tiêu")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={t("specialistStudio.history.rowAria", "Xem kết quả phiên #{{id}}", { id: s.id })}
                  onClick={() => onSelectSession(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectSession(s.id);
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {dateTime(s.createdAt)}
                  </TableCell>
                  <TableCell>{t(`specialistStudio.sessionType.${s.sessionType}`, s.sessionType)}</TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {(s.requestedAgents ?? []).map((a) => t(`agentCenter.persona.specialist-${a}`, a)).join(", ") || "—"}
                  </TableCell>
                  <TableCell>{s.moduleName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} label={t(`specialistStudio.status.${s.status}`, s.status)} />
                  </TableCell>
                  <TableCell className="max-w-xs truncate whitespace-normal" title={s.objective}>
                    {s.objective}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Task 5, Step 2 — "Audit module" tab: `listModuleAuditPresets.useQuery()`
 * renders each of the (5) presets as a card; "Chạy audit" fires
 * `runModuleAudit` (fire-and-forget — returns `{ sessionId, started }`
 * immediately) and hands the id to `onSessionStarted`, which loads it into
 * the shared Result card and starts the SAME poll the Dispatch tab uses.
 */
function SpecialistAuditTab({ onSessionStarted }: { onSessionStarted: (sessionId: number) => void }) {
  const { t } = useTranslation();
  const presetsQuery = trpc.aiSpecialistAgent.listModuleAuditPresets.useQuery();
  const runAudit = trpc.aiSpecialistAgent.runModuleAudit.useMutation();
  const presets = presetsQuery.data?.presets ?? [];

  async function handleRun(presetId: string) {
    try {
      const res = await runAudit.mutateAsync({ presetId });
      onSessionStarted(res.sessionId);
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("specialistStudio.audit.title", "Audit module")}</CardTitle>
      </CardHeader>
      <CardContent>
        {presetsQuery.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-lg" />
            ))}
          </div>
        )}

        {presetsQuery.isError && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
            <AlertDescription>
              {t("specialistStudio.audit.loadError", "Không thể tải danh sách audit lúc này.")}
            </AlertDescription>
          </Alert>
        )}

        {presetsQuery.data && presets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("specialistStudio.audit.empty", "Chưa có audit preset nào.")}
          </p>
        )}

        {presets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {presets.map((preset) => {
              const running = runAudit.isPending && runAudit.variables?.presetId === preset.id;
              return (
                <div key={preset.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-foreground">{preset.label}</p>
                    <p className="text-xs text-muted-foreground">{preset.moduleName}</p>
                  </div>
                  <p className="line-clamp-3 flex-1 text-sm text-foreground/90">{preset.objective}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="self-start"
                    disabled={runAudit.isPending}
                    onClick={() => handleRun(preset.id)}
                  >
                    {running ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        {t("specialistStudio.audit.running", "Đang chạy…")}
                      </>
                    ) : (
                      t("specialistStudio.audit.run", "Chạy audit")
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Task 5, Step 3 — "Chất lượng" tab.
 *
 * HAI PHẠM VI, ghi nhãn rõ ràng (fix round 2, I-3):
 *  - Bảng chi tiết agent×module: `{ mineOnly: true }` — phiếu CỦA BẠN.
 *  - Khối "Luật quyết định mức B": `getQualityScoreboard()` KHÔNG tham số =
 *    TOÀN TỔ CHỨC. Trước đây khối này cũng dùng số của riêng người đang xem, nên
 *    3 kỹ sư mỗi người 8 phiếu (24 phiếu toàn công ty, đã quá ngưỡng 20) mà ai
 *    cũng thấy "còn thiếu 12 phiếu" — con số thật sự quyết định mức B KHÔNG
 *    hiển thị ở đâu cả. Backend đã hỗ trợ sẵn phạm vi này.
 *
 * 3 trạng thái của khối quyết định đều ĐO từ `overall`, không suy diễn:
 *   1. total < 20            → "Chưa đủ dữ liệu để quyết định" + shortfall count
 *   2. total ≥ 20, useful<50 → enough volume, but the bar is not met
 *   3. total ≥ 20, useful≥50 → criteria met
 */
function SpecialistQualityTab() {
  const { t } = useTranslation();
  const scoreboard = trpc.aiSpecialistAgent.getQualityScoreboard.useQuery({ mineOnly: true });
  const orgScoreboard = trpc.aiSpecialistAgent.getQualityScoreboard.useQuery(undefined);
  const rows = scoreboard.data?.rows ?? [];
  const overall = scoreboard.data?.overall;
  const totalRatings = overall?.total ?? 0;
  const usefulPct = overall?.usefulPct ?? 0;

  const MIN_RATINGS = 20;
  const MIN_USEFUL_PCT = 50;
  const orgTotal = orgScoreboard.data?.overall.total ?? 0;
  const orgUsefulPct = orgScoreboard.data?.overall.usefulPct ?? 0;
  const enoughVolume = orgTotal >= MIN_RATINGS;
  const meetsBar = enoughVolume && orgUsefulPct >= MIN_USEFUL_PCT;
  const remaining = Math.max(MIN_RATINGS - orgTotal, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("specialistStudio.quality.title", "Chất lượng")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {scoreboard.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}

          {scoreboard.isError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
              <AlertDescription>
                {t("specialistStudio.quality.loadError", "Không thể tải bảng điểm chất lượng lúc này.")}
              </AlertDescription>
            </Alert>
          )}

          {scoreboard.data && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {t("specialistStudio.quality.totalRatings", "Tổng số phiếu")}: {totalRatings}
                </Badge>
                <Badge variant="outline">
                  {t("specialistStudio.quality.usefulPct", "% Dùng được")}: {totalRatings > 0 ? `${usefulPct}%` : "—"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("specialistStudio.quality.scopeMineNote", "Số liệu trong thẻ này CHỈ tính phiếu của bạn.")}
              </p>

              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("specialistStudio.quality.empty", "Chưa có đánh giá nào.")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("specialistStudio.quality.col.agent", "Agent")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.module", "Module")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.total", "Tổng")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.useful", "Dùng được %")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.partial", "Một phần %")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.useless", "Vô dụng %")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.withEyes", "Có đọc mã %")}</TableHead>
                      <TableHead>{t("specialistStudio.quality.col.withoutEyes", "Không đọc mã %")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={`${r.agentId}::${r.moduleName ?? ""}`}>
                        <TableCell>{t(`agentCenter.persona.specialist-${r.agentId}`, r.agentId)}</TableCell>
                        <TableCell>{r.moduleName ?? "—"}</TableCell>
                        <TableCell>{r.total}</TableCell>
                        <TableCell>{r.usefulPct}%</TableCell>
                        <TableCell>{r.partialPct}%</TableCell>
                        <TableCell>{r.uselessPct}%</TableCell>
                        <TableCell>{r.withEyesUsefulPct == null ? "—" : `${r.withEyesUsefulPct}%`}</TableCell>
                        <TableCell>{r.withoutEyesUsefulPct == null ? "—" : `${r.withoutEyesUsefulPct}%`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("specialistStudio.quality.decisionRule.title", "Luật quyết định mức B")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {t("specialistStudio.quality.decisionRule.criteria", "Điều kiện: ≥20 phiếu đánh giá và % Dùng được ≥ 50%.")}
          </p>
          <p className="text-muted-foreground">
            {t(
              "specialistStudio.quality.decisionRule.scopeNote",
              "Số liệu dưới đây tính trên TOÀN TỔ CHỨC (phiếu của mọi người dùng) — đúng phạm vi mà luật quyết định yêu cầu.",
            )}
          </p>

          {orgScoreboard.isLoading && <Skeleton className="h-16 w-full rounded-lg" />}

          {orgScoreboard.isError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{t("specialistStudio.result.failedTitle", "Phiên chạy lỗi")}</AlertTitle>
              <AlertDescription>
                {t("specialistStudio.quality.loadError", "Không thể tải bảng điểm chất lượng lúc này.")}
              </AlertDescription>
            </Alert>
          )}

          {orgScoreboard.data && (
            <>
              <p className="text-muted-foreground">
                {t("specialistStudio.quality.decisionRule.current", "Hiện có {{total}} phiếu, % Dùng được {{pct}}.", {
                  total: orgTotal,
                  // Same "never show 0% for an empty set" convention as the badge
                  // above — pct already carries its own "%" (or the "—" fallback).
                  pct: orgTotal > 0 ? `${orgUsefulPct}%` : "—",
                })}
              </p>
              {!enoughVolume ? (
                <p className="font-medium text-foreground">
                  {t("specialistStudio.quality.decisionRule.insufficient", "Chưa đủ dữ liệu để quyết định.")}{" "}
                  {t("specialistStudio.quality.decisionRule.remaining", "Còn thiếu {{remaining}} phiếu để đạt tối thiểu 20.", {
                    remaining,
                  })}
                </p>
              ) : meetsBar ? (
                <p className="font-medium text-success">
                  {t("specialistStudio.quality.decisionRule.met", "Đủ điều kiện — có thể xem xét chuyển mức B.")}
                </p>
              ) : (
                <p className="font-medium text-warning">
                  {t("specialistStudio.quality.decisionRule.belowThreshold", "Đủ số phiếu nhưng % Dùng được chưa đạt 50%.")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
