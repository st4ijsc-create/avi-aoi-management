/**
 * Doc 09 / Phase D1 — Device Programming & Control: UNIFIED ENGINEERING WORKSPACE.
 *
 * The IDE surface for authoring device PROGRAMS (Zmotion BASIC / G-code / native
 * IEC 61131-3 / robot job-lists / vendor engineering) in the platform, then
 * validate → build → simulate → (HITL sign-off) staged DEPLOY → rollback — all over
 * the programmingRouter (Phase D0).
 *
 * ADDITIVE + READ-OPEN: authoring + validate + build + simulate are always safe (no
 * device I/O). DEPLOY is gated server-side by DPC_DEPLOY_ENABLED + HITL sign-off; when
 * the flag is off the UI shows a banner and a deploy is recorded as 'simulated'.
 * RBAC reuses the control-plane modules: view = machine_monitoring, write = machine_control.
 *
 * D1 ships a dependency-free <CodeEditor>; a richer editor (Monaco) can drop in later
 * behind that component boundary. Real language adapters (Zmotion, ...) land in D2+.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { LadderEditor } from "@/components/engineering/LadderEditor";
import { TeachJogPanel } from "@/components/engineering/TeachJogPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Code2, Plus, FolderGit2, FileCode, Play, Hammer, FlaskConical, Rocket,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Variable, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

/** All target classes (mirrors server programmingKindEnum / PROGRAMMING_KINDS). */
const KINDS = [
  "stub",
  "zmotion-basic",
  "gcode",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
] as const;
type Kind = (typeof KINDS)[number];

/** Default concrete language token per kind (the adapter accepts these). */
const KIND_LANGUAGE: Record<Kind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "st",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
};

type Diagnostic = { severity: string; message: string; line?: number; symbol?: string };

function rid(prefix: string): string {
  // Non-crypto unique-ish id for idempotency/action keys (UI-side).
  return `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}

export default function EngineeringWorkspace() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const statusQ = trpc.programming.status.useQuery(undefined, { enabled: canView });
  const deployEnabled = statusQ.data?.deployEnabled ?? false;
  const adapters = statusQ.data?.adapters ?? [];

  const projectsQ = trpc.programming.listProjects.useQuery(undefined, { enabled: canView });
  const [projectId, setProjectId] = useState<number | null>(null);
  const project = useMemo(
    () => projectsQ.data?.find((p) => p.id === projectId) ?? null,
    [projectsQ.data, projectId],
  );

  const artifactsQ = trpc.programming.listArtifacts.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const artifact = useMemo(
    () => artifactsQ.data?.find((a) => a.id === artifactId) ?? null,
    [artifactsQ.data, artifactId],
  );

  // Editor buffer (loaded from the selected artifact; dirty until saved as a new version).
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("text");
  useEffect(() => {
    if (artifact) {
      setCode(artifact.content ?? "");
      setLanguage(artifact.language);
    }
  }, [artifact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null);

  const buildsQ = trpc.programming.listBuilds.useQuery(
    { artifactId: artifactId! },
    { enabled: canView && artifactId != null },
  );
  const [buildId, setBuildId] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<{ ok: boolean; warnings: string[]; timeline: any[] } | null>(null);

  const deploymentsQ = trpc.programming.listDeployments.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );
  const symbolsQ = trpc.programming.listSymbols.useQuery(
    { projectId: projectId! },
    { enabled: canView && projectId != null },
  );

  // ── Mutations ──
  const createProject = trpc.programming.createProject.useMutation({
    onSuccess: (row) => {
      toast.success(t("engineering.projectCreated", "Đã tạo project"));
      utils.programming.listProjects.invalidate();
      setProjectId(row.id);
    },
    onError: (e) => toast.error(e.message),
  });
  const createArtifact = trpc.programming.createArtifact.useMutation({
    onSuccess: (row) => {
      toast.success(t("engineering.versionSaved", "Đã lưu phiên bản v") + row.version);
      utils.programming.listArtifacts.invalidate();
      setArtifactId(row.id);
    },
    onError: (e) => toast.error(e.message),
  });
  const validateM = trpc.programming.validateArtifact.useMutation({
    onSuccess: (r) => {
      setDiagnostics(r.diagnostics as Diagnostic[]);
      utils.programming.listArtifacts.invalidate();
      r.ok ? toast.success(t("engineering.validOk", "Hợp lệ")) : toast.warning(t("engineering.validErr", "Có lỗi"));
    },
    onError: (e) => toast.error(e.message),
  });
  const buildM = trpc.programming.buildArtifact.useMutation({
    onSuccess: (b) => {
      utils.programming.listBuilds.invalidate();
      setBuildId(b.id);
      b.ok ? toast.success(t("engineering.buildOk", "Build OK")) : toast.error(t("engineering.buildFail", "Build lỗi"));
    },
    onError: (e) => toast.error(e.message),
  });
  const simulateM = trpc.programming.simulateBuild.useMutation({
    onSuccess: (r) => {
      setSimResult({ ok: r.ok, warnings: r.warnings as string[], timeline: r.timeline as any[] });
      toast.success(t("engineering.simDone", "Đã mô phỏng"));
    },
    onError: (e) => toast.error(e.message),
  });
  const deployM = trpc.programming.deployBuild.useMutation({
    onSuccess: (d) => {
      utils.programming.listDeployments.invalidate();
      toast.success(
        d.simulated
          ? t("engineering.deploySimulated", "Đã ghi nhận (SIMULATED — flag OFF / chưa sign-off)")
          : t("engineering.deployReal", "Đã deploy"),
      );
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Create-project dialog state ──
  const [npOpen, setNpOpen] = useState(false);
  const [npCode, setNpCode] = useState("");
  const [npName, setNpName] = useState("");
  const [npKind, setNpKind] = useState<Kind>("stub");

  // ── Deploy form state ──
  const [deployStage, setDeployStage] = useState<"staging" | "production">("staging");
  const [signOff, setSignOff] = useState(false);

  // ── Editor mode: a visual editor exists for ladder (rung grid) + robot (teach/jog) ──
  const [editorMode, setEditorMode] = useState<"code" | "visual">("code");
  const visualKind =
    project?.kind === "iec61131-ld" ? "ladder" : project?.kind === "robot-tm" ? "teach" : null;

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6 text-muted-foreground">{t("common.noPermission", "Bạn không có quyền xem trang này.")}</div>
      </DashboardLayout>
    );
  }

  const isImplemented = (k: string) => adapters.find((a) => a.kind === k)?.implemented ?? false;

  return (
    <DashboardLayout>
      <PageContainer fluid className="space-y-4">
        <PageHeader
          icon={<Code2 className="h-6 w-6" />}
          title={t("engineering.title", "Xưởng lập trình thiết bị")}
          description={t("engineering.subtitle", "Soạn → kiểm tra → build → mô phỏng → (sign-off) deploy cho PLC / Robot / Zmotion")}
          actions={
            <>
              <Badge variant={deployEnabled ? "default" : "secondary"}>
                {t("engineering.deployFlag", "Deploy")}: {deployEnabled ? "ON" : "OFF"}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => { statusQ.refetch(); projectsQ.refetch(); }}>
                <RefreshCw className="mr-1 h-4 w-4" /> {t("common.refresh", "Làm mới")}
              </Button>
            </>
          }
        />

        {!deployEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t("engineering.deployOffBanner", "DPC_DEPLOY_ENABLED đang TẮT — mọi deploy được ghi nhận là SIMULATED, không ghi xuống thiết bị. An toàn (E-stop/interlock) luôn nằm trên PLC chứng nhận.")}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          {/* ── Project Explorer ── */}
          <Card className="h-fit">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderGit2 className="h-4 w-4" /> {t("engineering.projects", "Dự án")}
              </CardTitle>
              <Dialog open={npOpen} onOpenChange={setNpOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={!canCreate}><Plus className="h-4 w-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("engineering.newProject", "Dự án mới")}</DialogTitle>
                    <DialogDescription>{t("engineering.newProjectDesc", "Một workspace lập trình cho một thiết bị/cell")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>{t("engineering.code", "Mã")}</Label>
                      <Input value={npCode} onChange={(e) => setNpCode(e.target.value)} placeholder="ZMC-CELL-01" />
                    </div>
                    <div>
                      <Label>{t("engineering.name", "Tên")}</Label>
                      <Input value={npName} onChange={(e) => setNpName(e.target.value)} />
                    </div>
                    <div>
                      <Label>{t("engineering.kind", "Loại thiết bị")}</Label>
                      <Select value={npKind} onValueChange={(v) => setNpKind(v as Kind)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}{isImplemented(k) ? "" : ` (${t("engineering.planned", "sắp có")})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={!npCode || !npName || createProject.isPending}
                      onClick={() => {
                        createProject.mutate({ code: npCode, name: npName, kind: npKind });
                        setNpOpen(false);
                        setNpCode(""); setNpName("");
                      }}
                    >
                      {t("common.create", "Tạo")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-1">
              {(projectsQ.data ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("engineering.noProjects", "Chưa có dự án")}</p>
              )}
              {(projectsQ.data ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setProjectId(p.id); setArtifactId(null); setBuildId(null); setSimResult(null); setDiagnostics(null); }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${projectId === p.id ? "bg-muted font-medium" : ""}`}
                >
                  <span className="truncate">{p.name}</span>
                  <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">{p.kind}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* ── Editor + actions ── */}
          <div className="space-y-4">
            {!project ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">{t("engineering.selectProject", "Chọn một dự án để bắt đầu")}</CardContent></Card>
            ) : (
              <>
                {/* Artifacts (versions) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCode className="h-4 w-4" /> {project.name} · {t("engineering.versions", "Phiên bản")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {(artifactsQ.data ?? []).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setArtifactId(a.id)}
                          className={`rounded border px-2 py-1 text-xs hover:bg-muted ${artifactId === a.id ? "border-primary bg-muted" : ""}`}
                        >
                          v{a.version} · {a.branch}
                          <Badge variant="outline" className="ml-1 text-[9px]">{a.status}</Badge>
                        </button>
                      ))}
                      {(artifactsQ.data ?? []).length === 0 && (
                        <span className="text-sm text-muted-foreground">{t("engineering.noVersions", "Chưa có phiên bản — soạn rồi lưu bên dưới")}</span>
                      )}
                    </div>

                    {/* Editor */}
                    <div className="mb-2 flex items-center gap-2">
                      <Label className="text-xs">{t("engineering.language", "Ngôn ngữ")}</Label>
                      <Input className="h-7 w-32" value={language} onChange={(e) => setLanguage(e.target.value)} />
                      {visualKind && (
                        <div className="flex overflow-hidden rounded-md border">
                          <button
                            onClick={() => setEditorMode("code")}
                            className={`px-2 py-1 text-xs ${editorMode === "code" ? "bg-muted font-medium" : ""}`}
                          >
                            {t("engineering.modeCode", "Code")}
                          </button>
                          <button
                            onClick={() => setEditorMode("visual")}
                            className={`px-2 py-1 text-xs ${editorMode === "visual" ? "bg-muted font-medium" : ""}`}
                          >
                            {visualKind === "ladder" ? t("engineering.modeLadder", "Ladder") : t("engineering.modeTeach", "Teach/Jog")}
                          </button>
                        </div>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{code.split("\n").length} {t("engineering.lines", "dòng")}</span>
                    </div>
                    {visualKind && editorMode === "visual" ? (
                      visualKind === "ladder" ? (
                        <LadderEditor value={code} onChange={setCode} />
                      ) : (
                        <TeachJogPanel value={code} onChange={setCode} />
                      )
                    ) : (
                      <CodeEditor value={code} onChange={setCode} language={language} aria-label="program-source" />
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!canCreate || !code.trim() || createArtifact.isPending}
                        onClick={() =>
                          createArtifact.mutate({
                            projectId: project.id,
                            branch: project.defaultBranch ?? "main",
                            language: language || KIND_LANGUAGE[project.kind as Kind] || "text",
                            content: code,
                          })
                        }
                      >
                        <Plus className="mr-1 h-4 w-4" /> {t("engineering.saveVersion", "Lưu phiên bản")}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!artifactId || validateM.isPending}
                        onClick={() => artifactId && validateM.mutate({ artifactId })}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> {t("engineering.validate", "Kiểm tra")}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!canCreate || !artifactId || buildM.isPending}
                        onClick={() => artifactId && buildM.mutate({ artifactId })}
                      >
                        <Hammer className="mr-1 h-4 w-4" /> {t("engineering.build", "Build")}
                      </Button>
                    </div>

                    {/* Diagnostics */}
                    {diagnostics && (
                      <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
                        {diagnostics.length === 0 ? (
                          <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> {t("engineering.noDiag", "Không có cảnh báo")}</span>
                        ) : (
                          diagnostics.map((d, i) => (
                            <div key={i} className="flex items-center gap-1">
                              {d.severity === "error" ? <XCircle className="h-3 w-3 text-destructive" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
                              <span>{d.line ? `L${d.line}: ` : ""}{d.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Builds + Simulate */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> {t("engineering.builds", "Builds & Mô phỏng")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1">
                      {(buildsQ.data ?? []).map((b) => (
                        <button
                          key={b.id}
                          onClick={() => { setBuildId(b.id); setSimResult(null); }}
                          className={`rounded border px-2 py-1 text-xs hover:bg-muted ${buildId === b.id ? "border-primary bg-muted" : ""}`}
                        >
                          #{b.id} <Badge variant={b.ok ? "default" : "destructive"} className="ml-1 text-[9px]">{b.status}</Badge>
                        </button>
                      ))}
                      {(buildsQ.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">{t("engineering.noBuilds", "Chưa có build")}</span>}
                    </div>
                    <Button
                      size="sm" variant="outline"
                      disabled={!buildId || simulateM.isPending}
                      onClick={() => buildId && simulateM.mutate({ buildId, scenario: {} })}
                    >
                      <Play className="mr-1 h-4 w-4" /> {t("engineering.simulate", "Mô phỏng (twin)")}
                    </Button>
                    {simResult && (
                      <div className="rounded-md border bg-muted/30 p-2 text-xs">
                        <div className="mb-1 font-medium">{t("engineering.timeline", "Timeline")} ({simResult.timeline.length} {t("engineering.steps", "bước")}, {simResult.ok ? "OK" : "WARN"})</div>
                        {simResult.warnings.map((w, i) => (
                          <div key={i} className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Deploy (gated) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4" /> {t("engineering.deploy", "Deploy (có kiểm soát)")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <Label className="text-xs">{t("engineering.stage", "Giai đoạn")}</Label>
                        <Select value={deployStage} onValueChange={(v) => setDeployStage(v as any)}>
                          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="staging">staging</SelectItem>
                            <SelectItem value="production">production</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={signOff} onCheckedChange={(v) => setSignOff(Boolean(v))} />
                        <ShieldCheck className="h-3 w-3" /> {t("engineering.signOff", "Tôi ký duyệt (HITL sign-off)")}
                      </label>
                      <Button
                        size="sm"
                        disabled={!canCreate || !buildId || deployM.isPending}
                        onClick={() =>
                          buildId && deployM.mutate({
                            buildId,
                            stage: deployStage,
                            idempotencyKey: rid("dep"),
                            actionId: rid("act"),
                            confirmedBy: signOff && user?.id ? user.id : undefined,
                          })
                        }
                      >
                        <Rocket className="mr-1 h-4 w-4" /> {t("engineering.deployBtn", "Deploy build")}
                      </Button>
                    </div>

                    {/* Deployments audit */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>{t("engineering.stage", "Giai đoạn")}</TableHead>
                          <TableHead>{t("common.status", "Trạng thái")}</TableHead>
                          <TableHead>{t("engineering.simulated", "Mô phỏng")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(deploymentsQ.data ?? []).slice(0, 10).map((d) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.id}</TableCell>
                            <TableCell>{d.stage}</TableCell>
                            <TableCell><Badge variant={d.status === "rejected" ? "destructive" : "secondary"}>{d.status}</Badge></TableCell>
                            <TableCell>{d.simulated ? <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-label={t("engineering.simulated", "Mô phỏng")} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                          </TableRow>
                        ))}
                        {(deploymentsQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">{t("engineering.noDeploys", "Chưa có deploy")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Symbols */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Variable className="h-4 w-4" /> {t("engineering.symbols", "Bảng biến / tag")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("engineering.symbolName", "Tên")}</TableHead>
                          <TableHead>{t("engineering.address", "Địa chỉ")}</TableHead>
                          <TableHead>{t("engineering.dataType", "Kiểu")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(symbolsQ.data ?? []).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.name}</TableCell>
                            <TableCell>{s.address ?? "—"}</TableCell>
                            <TableCell>{s.dataType ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                        {(symbolsQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">{t("engineering.noSymbols", "Chưa có biến (Online Monitor ở D6)")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
