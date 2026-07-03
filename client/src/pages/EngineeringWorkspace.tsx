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
import { computeIsDirty } from "@/lib/engineeringBuffer";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LineDiff } from "@/components/diff/LineDiff";
import {
  Code2, Plus, FolderGit2, FileCode, Play, Hammer, FlaskConical, Rocket,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Variable, ShieldCheck,
  Radio, Trash2, Pencil, Wifi, WifiOff, RotateCcw, GitCompare, Info,
} from "lucide-react";
import { toast } from "sonner";
import { useEngineeringStream } from "@/hooks/useEngineeringStream";

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
  const streamingEnabled = statusQ.data?.streamingEnabled ?? false;
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

  // ── W3-11: version diff (chọn 2 phiên bản) + rollback deployment ──
  const [diffBaseId, setDiffBaseId] = useState<number | null>(null);
  const [diffCompareId, setDiffCompareId] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: number; stage: string } | null>(null);
  const diffBase = useMemo(() => artifactsQ.data?.find((a) => a.id === diffBaseId) ?? null, [artifactsQ.data, diffBaseId]);
  const diffCompare = useMemo(() => artifactsQ.data?.find((a) => a.id === diffCompareId) ?? null, [artifactsQ.data, diffCompareId]);

  // Editor buffer (loaded from the selected artifact; dirty until saved as a new version).
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("text");
  useEffect(() => {
    if (artifact) {
      setCode(artifact.content ?? "");
      setLanguage(artifact.language);
    }
  }, [artifact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buffer khác bản đã lưu → chưa lưu. Validate/Build luôn chạy trên artifactId (bản đã lưu),
  // nên khi dirty phải chặn/ cảnh báo để không kiểm tra nhầm phiên bản cũ (doc 25 T3).
  const isDirty = computeIsDirty(code, artifact?.content);

  // Chọn phiên bản/dự án khác lúc dirty sẽ ghi đè buffer → hỏi xác nhận trước.
  const confirmDiscardIfDirty = () =>
    !isDirty || window.confirm(t("engineering.dirtyConfirm", "Có chỉnh sửa chưa lưu — chuyển sẽ mất thay đổi. Tiếp tục?"));

  // Chặn Validate/Build khi còn chỉnh sửa chưa lưu (kết quả sẽ thuộc phiên bản cũ).
  const requireSaved = (): boolean => {
    if (isDirty) {
      toast.warning(t("engineering.saveBeforeCheck", "Lưu phiên bản trước khi kiểm tra/build"));
      return false;
    }
    return true;
  };

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
  // W3-11 — rollback: ghi một deployment MỚI về build của lần deploy thành công trước.
  const rollbackM = trpc.programming.rollbackDeployment.useMutation({
    onSuccess: () => {
      utils.programming.listDeployments.invalidate();
      setRollbackTarget(null);
      toast.success(t("engineering.rollbackDone", "Đã khôi phục về phiên bản trước"));
    },
    onError: (e) => { setRollbackTarget(null); toast.error(e.message); },
  });

  // ── Symbols (tag table) CRUD — feeds Online Monitor ──
  const upsertSymbol = trpc.programming.upsertSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolSaved", "Đã lưu biến"));
      utils.programming.listSymbols.invalidate();
      setSymOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteSymbol = trpc.programming.deleteSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolDeleted", "Đã xóa biến"));
      utils.programming.listSymbols.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Online Monitor (watch) — start/stop server watch session + subscribe live room ──
  const [watching, setWatching] = useState(false);
  // Đổi project → dừng watch (session gắn theo project) để không rò session cũ.
  useEffect(() => { setWatching(false); }, [projectId]);
  const startWatchM = trpc.programming.startWatch.useMutation({
    onSuccess: (r) => {
      if (r.started) {
        setWatching(true);
        toast.success(t("engineering.watchStarted", "Đã mở phiên theo dõi"));
      } else {
        setWatching(false);
        const msg =
          r.reason === "no_device"
            ? t("engineering.watchNoDevice", "Dự án chưa gắn thiết bị — không có nguồn để đọc")
            : r.reason === "streaming_disabled"
              ? t("engineering.watchDisabled", "DPC_STREAMING_ENABLED đang TẮT — không mở được luồng")
              : t("engineering.watchNotStarted", "Không mở được phiên theo dõi");
        toast.warning(msg);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const stopWatchM = trpc.programming.stopWatch.useMutation({
    onSuccess: () => setWatching(false),
    onError: (e) => toast.error(e.message),
  });
  // Subscribe socket room `engineering:{deviceId}` khi đang watch (chỉ đọc giá trị live).
  const { values: liveValues, lastUpdate, connected: streamConnected } = useEngineeringStream(
    project?.deviceId ?? null,
    watching,
  );

  // ── Symbol editor dialog state (thêm/sửa một biến) ──
  const [symOpen, setSymOpen] = useState(false);
  const [symId, setSymId] = useState<number | null>(null);
  const [symName, setSymName] = useState("");
  const [symAddr, setSymAddr] = useState("");
  const [symType, setSymType] = useState("");
  const [symComment, setSymComment] = useState("");
  const [symWatchable, setSymWatchable] = useState(true);
  const openSymDialog = (s?: {
    id: number; name: string; address: string | null; dataType: string | null;
    comment: string | null; watchable: boolean;
  }) => {
    setSymId(s?.id ?? null);
    setSymName(s?.name ?? "");
    setSymAddr(s?.address ?? "");
    setSymType(s?.dataType ?? "");
    setSymComment(s?.comment ?? "");
    setSymWatchable(s?.watchable ?? true);
    setSymOpen(true);
  };

  // ── Create-project dialog state ──
  const [npOpen, setNpOpen] = useState(false);
  const [npCode, setNpCode] = useState("");
  const [npName, setNpName] = useState("");
  const [npKind, setNpKind] = useState<Kind>("stub");

  // ── Deploy form state ──
  const [deployStage, setDeployStage] = useState<"staging" | "production">("staging");
  const [signOff, setSignOff] = useState(false);
  // W2-9 — second-approver (SoD) cho deploy production: người ký duyệt + lý do bắt buộc.
  const [approverId, setApproverId] = useState<string>("");
  const [deployReason, setDeployReason] = useState("");
  const approversQ = trpc.programming.listApprovers.useQuery(undefined, { enabled: canView });
  // Loại chính người yêu cầu ra khỏi danh sách (không được tự ký).
  const approverOptions = useMemo(
    () => (approversQ.data ?? []).filter((a) => a.id !== user?.id),
    [approversQ.data, user?.id],
  );
  const isProd = deployStage === "production";
  const prodDeployReady = !isProd || (approverId !== "" && deployReason.trim().length > 0);

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
          badge={!canEdit ? <ViewOnlyBadge module="machine_control" /> : undefined}
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

        {/* W6-26 — "Khi nào dùng" + cross-link golden-thread (ranh giới IDE vs IR vs POU). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            {t("engineering.whenToUse", "When to use — the full IDE pipeline: build, simulate, sign-off & deploy device programs. Low-level motion/IO? Use the IR Editor. IEC 61131 LAD/FBD/SFC? Use POU Studio.")}
          </span>
          <span className="inline-flex items-center gap-3">
            <Link href="/engineering-home" className="font-medium text-primary hover:underline">{t("nav.engineeringHome")}</Link>
            <Link href="/ir-editor" className="font-medium text-primary hover:underline">{t("nav.irEditor")}</Link>
            <Link href="/pou-studio" className="font-medium text-primary hover:underline">{t("nav.pouStudio")}</Link>
          </span>
        </div>

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
                  onClick={() => {
                    if (p.id === projectId || !confirmDiscardIfDirty()) return;
                    setProjectId(p.id); setArtifactId(null); setBuildId(null); setSimResult(null); setDiagnostics(null);
                  }}
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
                      {isDirty && (
                        <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> {t("engineering.unsaved", "Chưa lưu")}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap gap-1">
                      {(artifactsQ.data ?? []).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => { if (a.id !== artifactId && confirmDiscardIfDirty()) setArtifactId(a.id); }}
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

                    {/* W3-11 — So sánh 2 phiên bản (diff dòng) */}
                    {(artifactsQ.data ?? []).length >= 2 && (
                      <div className="mb-3 rounded-md border bg-muted/20 p-2">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <GitCompare className="h-3.5 w-3.5" /> {t("engineering.compareVersions", "So sánh phiên bản")}
                          </span>
                          <Select value={diffBaseId != null ? String(diffBaseId) : ""} onValueChange={(v) => setDiffBaseId(Number(v))}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder={t("engineering.diffBase", "Bản gốc")} /></SelectTrigger>
                            <SelectContent>
                              {(artifactsQ.data ?? []).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">→</span>
                          <Select value={diffCompareId != null ? String(diffCompareId) : ""} onValueChange={(v) => setDiffCompareId(Number(v))}>
                            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder={t("engineering.diffCompare", "So với")} /></SelectTrigger>
                            <SelectContent>
                              {(artifactsQ.data ?? []).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>v{a.version} · {a.branch}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {diffBase && diffCompare ? (
                          <LineDiff left={diffBase.content ?? ""} right={diffCompare.content ?? ""} maxHeightClass="max-h-[300px]" />
                        ) : (
                          <p className="py-2 text-center text-xs text-muted-foreground">{t("engineering.diffPick", "Chọn 2 phiên bản để xem khác biệt")}</p>
                        )}
                      </div>
                    )}

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
                        onClick={() => { if (artifactId && requireSaved()) validateM.mutate({ artifactId }); }}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> {t("engineering.validate", "Kiểm tra")}
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        disabled={!canCreate || !artifactId || buildM.isPending}
                        onClick={() => { if (artifactId && requireSaved()) buildM.mutate({ artifactId }); }}
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
                      {/* Staging: tự ký (SoD chỉ áp dụng cho production). */}
                      {!isProd && (
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={signOff} onCheckedChange={(v) => setSignOff(Boolean(v))} />
                          <ShieldCheck className="h-3 w-3" /> {t("engineering.signOff", "Tôi ký duyệt (HITL sign-off)")}
                        </label>
                      )}
                      {/* Production: second-approver (phân tách nhiệm vụ) — người ký duyệt KHÁC người yêu cầu. */}
                      {isProd && (
                        <div>
                          <Label className="text-xs">{t("engineering.approver", "Người ký duyệt")}</Label>
                          <Select value={approverId} onValueChange={setApproverId}>
                            <SelectTrigger className="h-8 w-48">
                              <SelectValue placeholder={t("engineering.selectApprover", "Chọn người ký duyệt…")} />
                            </SelectTrigger>
                            <SelectContent>
                              {approverOptions.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name || a.username || `#${a.id}`}
                                </SelectItem>
                              ))}
                              {approverOptions.length === 0 && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  {t("engineering.noApprovers", "Không có người đủ quyền ký duyệt")}
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button
                        size="sm"
                        disabled={!canCreate || !buildId || deployM.isPending || !prodDeployReady}
                        onClick={() =>
                          buildId && deployM.mutate({
                            buildId,
                            stage: deployStage,
                            // Khóa idempotency ổn định theo (build, stage) → double-click không tạo 2 deploy.
                            idempotencyKey: `dep-${buildId}-${deployStage}`,
                            actionId: rid("act"),
                            confirmedBy: isProd
                              ? (approverId ? Number(approverId) : undefined)
                              : (signOff && user?.id ? user.id : undefined),
                            reason: isProd ? deployReason.trim() : undefined,
                          })
                        }
                      >
                        <Rocket className="mr-1 h-4 w-4" /> {t("engineering.deployBtn", "Deploy build")}
                      </Button>
                    </div>

                    {/* Production: ô lý do duyệt bắt buộc + ghi chú SoD. */}
                    {isProd && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("engineering.approvalReason", "Lý do duyệt (bắt buộc)")}</Label>
                        <Textarea
                          className="min-h-[56px] text-xs"
                          value={deployReason}
                          onChange={(e) => setDeployReason(e.target.value)}
                          placeholder={t("engineering.approvalReasonPh", "Nêu lý do / căn cứ duyệt deploy production…")}
                        />
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ShieldCheck className="h-3 w-3 shrink-0" />
                          {t("engineering.sodHint", "Deploy production cần người ký duyệt KHÁC người yêu cầu (phân tách nhiệm vụ).")}
                        </p>
                      </div>
                    )}

                    {/* Deployments audit */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>{t("engineering.stage", "Giai đoạn")}</TableHead>
                          <TableHead>{t("common.status", "Trạng thái")}</TableHead>
                          <TableHead>{t("engineering.simulated", "Mô phỏng")}</TableHead>
                          <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(deploymentsQ.data ?? []).slice(0, 10).map((d) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.id}</TableCell>
                            <TableCell>{d.stage}</TableCell>
                            <TableCell><Badge variant={d.status === "rejected" ? "destructive" : "secondary"}>{d.status}</Badge></TableCell>
                            <TableCell>{d.simulated ? <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-label={t("engineering.simulated", "Mô phỏng")} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell className="text-right">
                              {/* Rollback: chỉ cho deploy đã thành công (không phải rejected / đã rollback). */}
                              {canCreate && (d.status === "deployed" || d.status === "verified" || d.status === "simulated") && (
                                <Button
                                  size="sm" variant="outline"
                                  disabled={rollbackM.isPending}
                                  onClick={() => setRollbackTarget({ id: d.id, stage: d.stage })}
                                >
                                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("engineering.rollback", "Khôi phục")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(deploymentsQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">{t("engineering.noDeploys", "Chưa có deploy")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Symbols + Online Monitor (watch table) */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Variable className="h-4 w-4" /> {t("engineering.symbols", "Bảng biến / tag")}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Badge NGUỒN trung thực — không giả lập giá trị. */}
                        {(() => {
                          if (!streamingEnabled)
                            return (
                              <Badge variant="secondary" className="gap-1 text-[10px]">
                                <WifiOff className="h-3 w-3" /> {t("engineering.srcOff", "Nguồn: TẮT (streaming off)")}
                              </Badge>
                            );
                          if (project.deviceId == null)
                            return (
                              <Badge variant="secondary" className="gap-1 text-[10px]">
                                <WifiOff className="h-3 w-3" /> {t("engineering.srcNone", "Nguồn: chưa gắn thiết bị")}
                              </Badge>
                            );
                          return watching ? (
                            <Badge variant="default" className="gap-1 text-[10px]">
                              {streamConnected ? <Wifi className="h-3 w-3" /> : <Radio className="h-3 w-3 animate-pulse" />}
                              {t("engineering.srcLive", "Nguồn: thiết bị")} #{project.deviceId}
                              {lastUpdate == null && (
                                <span className="opacity-80">· {t("engineering.srcNoData", "chưa có dữ liệu")}</span>
                              )}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Radio className="h-3 w-3" /> {t("engineering.srcReady", "Thiết bị")} #{project.deviceId}
                            </Badge>
                          );
                        })()}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEdit}
                          onClick={() => openSymDialog()}
                        >
                          <Plus className="mr-1 h-4 w-4" /> {t("engineering.addSymbol", "Thêm biến")}
                        </Button>
                        {watching ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={stopWatchM.isPending}
                            onClick={() => stopWatchM.mutate({ projectId: project.id })}
                          >
                            <WifiOff className="mr-1 h-4 w-4" /> {t("engineering.stopWatch", "Dừng theo dõi")}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={
                              startWatchM.isPending ||
                              (symbolsQ.data ?? []).filter((s) => s.watchable).length === 0
                            }
                            onClick={() =>
                              startWatchM.mutate({
                                projectId: project.id,
                                symbols: (symbolsQ.data ?? [])
                                  .filter((s) => s.watchable)
                                  .map((s) => s.name),
                              })
                            }
                          >
                            <Radio className="mr-1 h-4 w-4" /> {t("engineering.startWatch", "Theo dõi trực tiếp")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {/* Loading / error cho bảng biến. */}
                    {symbolsQ.isLoading && (
                      <p className="py-2 text-center text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
                    )}
                    {symbolsQ.isError && (
                      <p className="py-2 text-center text-sm text-destructive">{t("common.error", "Có lỗi khi tải")}</p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("engineering.symbolName", "Tên")}</TableHead>
                          <TableHead>{t("engineering.address", "Địa chỉ")}</TableHead>
                          <TableHead>{t("engineering.dataType", "Kiểu")}</TableHead>
                          <TableHead>{t("engineering.liveValue", "Giá trị live")}</TableHead>
                          <TableHead>{t("engineering.updatedAt", "Cập nhật")}</TableHead>
                          <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(symbolsQ.data ?? []).map((s) => {
                          const live = liveValues.get(s.name);
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="font-medium">
                                {s.name}
                                {!s.watchable && (
                                  <Badge variant="outline" className="ml-1 text-[9px]">{t("engineering.noWatch", "no-watch")}</Badge>
                                )}
                              </TableCell>
                              <TableCell>{s.address ?? "—"}</TableCell>
                              <TableCell>{s.dataType ?? "—"}</TableCell>
                              <TableCell className="font-mono">
                                {live ? String(live.value) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {live ? new Date(live.ts).toLocaleTimeString() : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7"
                                    disabled={!canEdit}
                                    aria-label={t("common.edit", "Sửa")}
                                    onClick={() => openSymDialog(s)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                                    disabled={!canDelete || deleteSymbol.isPending}
                                    aria-label={t("common.delete", "Xóa")}
                                    onClick={() => {
                                      if (window.confirm(t("engineering.deleteSymbolConfirm", "Xóa biến này?")))
                                        deleteSymbol.mutate({ id: s.id });
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {!symbolsQ.isLoading && (symbolsQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">{t("engineering.noSymbols", "Chưa có biến — bấm \"Thêm biến\" để soạn bảng tag")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {watching && lastUpdate == null && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {t("engineering.watchNoDataHint", "Đang theo dõi nhưng chưa có mẫu — nguồn đọc thật cần thiết bị/adapter (chưa gắn HW).")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Symbol editor dialog (thêm/sửa một biến trong bảng tag) */}
                <Dialog open={symOpen} onOpenChange={setSymOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {symId ? t("engineering.editSymbol", "Sửa biến") : t("engineering.addSymbol", "Thêm biến")}
                      </DialogTitle>
                      <DialogDescription>{t("engineering.symbolDesc", "Một tag/biến của thiết bị để theo dõi (watch) trong Online Monitor")}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label>{t("engineering.symbolName", "Tên")}</Label>
                        <Input value={symName} onChange={(e) => setSymName(e.target.value)} placeholder="X0 / Motor_Speed" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>{t("engineering.address", "Địa chỉ")}</Label>
                          <Input value={symAddr} onChange={(e) => setSymAddr(e.target.value)} placeholder="D100 / %MW10" />
                        </div>
                        <div>
                          <Label>{t("engineering.dataType", "Kiểu")}</Label>
                          <Input value={symType} onChange={(e) => setSymType(e.target.value)} placeholder="INT / BOOL / REAL" />
                        </div>
                      </div>
                      <div>
                        <Label>{t("engineering.comment", "Ghi chú")}</Label>
                        <Input value={symComment} onChange={(e) => setSymComment(e.target.value)} />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={symWatchable} onCheckedChange={(v) => setSymWatchable(Boolean(v))} />
                        {t("engineering.watchable", "Cho phép theo dõi (watch)")}
                      </label>
                    </div>
                    <DialogFooter>
                      <Button
                        disabled={!canEdit || !symName.trim() || upsertSymbol.isPending}
                        onClick={() =>
                          upsertSymbol.mutate({
                            projectId: project.id,
                            name: symName.trim(),
                            address: symAddr.trim() || undefined,
                            dataType: symType.trim() || undefined,
                            comment: symComment.trim() || undefined,
                            watchable: symWatchable,
                          })
                        }
                      >
                        {t("common.save", "Lưu")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>
      </PageContainer>

      {/* W3-11 — xác nhận khôi phục (rollback) một deployment về phiên bản trước */}
      <AlertDialog open={rollbackTarget != null} onOpenChange={(o) => { if (!o) setRollbackTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("engineering.rollbackTitle", "Khôi phục phiên bản trước?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("engineering.rollbackDesc", "Sẽ ghi một deployment MỚI về build của lần deploy thành công trước ở giai đoạn \"{{stage}}\". Chịu cùng cổng an toàn (sign-off / flag) như deploy.", { stage: rollbackTarget?.stage ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rollbackTarget == null) return;
                // idempotencyKey/actionId ỔN ĐỊNH theo deploymentId → click lại không tạo bản trùng.
                rollbackM.mutate({
                  deploymentId: rollbackTarget.id,
                  idempotencyKey: `rollback-dep-${rollbackTarget.id}`,
                  actionId: `rollback-dep-${rollbackTarget.id}`,
                });
              }}
            >
              {t("engineering.rollback", "Khôi phục")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
