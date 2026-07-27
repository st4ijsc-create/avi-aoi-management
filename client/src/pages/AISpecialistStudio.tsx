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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
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
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
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
        objective,
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
      toast.error(err?.message || t("specialistStudio.dispatch.dispatchError", "Không giao được việc — thử lại."));
    }
  }

  const status = session.data?.status as "running" | "completed" | "failed" | undefined;
  const aggregateOutput = session.data?.aggregateOutput as
    | { result?: SpecialistOutput; modelId?: string }
    | undefined;
  const output = aggregateOutput?.result;
  const firstStep = session.data?.steps?.[0];
  const metaModelId = aggregateOutput?.modelId ?? firstStep?.modelId ?? undefined;

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

              {sessionId !== null && status === "running" && (
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
                  <SpecialistResultView
                    output={output}
                    modelId={metaModelId}
                    tokensPrompt={firstStep?.tokensPrompt}
                    tokensGenerated={firstStep?.tokensGenerated}
                    totalTimeMs={firstStep?.totalTimeMs}
                  />
                  <div className="border-t pt-4">
                    <p className="mb-2 text-sm font-medium">
                      {t("specialistStudio.feedback.title", "Đánh giá kết quả này")}
                    </p>
                    <FeedbackBar
                      sessionId={sessionId}
                      agentId={agentId}
                      moduleName={moduleName.trim() || undefined}
                      repoContextUsed={useEyes}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
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

/**
 * 3-button usefulness rating + optional free-text reason, wired to
 * `trpc.aiSpecialistAgent.submitFeedback`. Extracted (not inlined) so Wave 1
 * Task 5 can attach the same rating strip to a session viewed from history.
 */
export function FeedbackBar({
  sessionId,
  agentId,
  moduleName,
  repoContextUsed,
}: {
  sessionId: number;
  agentId: string;
  moduleName?: string;
  repoContextUsed: boolean;
}) {
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
        agentId,
        moduleName,
        rating,
        reason: reason || undefined,
        repoContextUsed,
      });
      setSaved(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save feedback");
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
